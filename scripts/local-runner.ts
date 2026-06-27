/**
 * QA Agent Local Runner
 *
 * Runs Playwright tests in headed mode on your local machine and streams
 * events back to the QA platform server.
 *
 * Usage:
 *   npx tsx scripts/local-runner.ts --server https://your-qa-site.com --token <token>
 *
 * The token is shown in the QA platform UI under "Execution Mode → Local Runner".
 */

import { playwrightMcpAgent, replaySavedScript, AgentEvent, ResolvedStepRecord } from '../lib/agents/playwright-mcp-agent'
import { readApps } from '../lib/config/store'
import { fetchJiraIssue, extractPlaywrightScript, savePlaywrightScript, postJiraComment } from '../lib/jira/client'
import { planStepsFromInstruction } from '../lib/agents/step-planner'
import { compileScript } from '../lib/agents/script-compiler'
import type { RunnerJob } from '../lib/runner/job-store'
import type { TestCase } from '../lib/agents/testcase-agent'

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(name: string): string | undefined {
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : undefined
}
const SERVER = getArg('--server') ?? 'http://localhost:3000'
const TOKEN = getArg('--token') ?? ''

if (!TOKEN) {
  console.error('Error: --token is required. Get it from the QA platform UI → Execution Mode → Local Runner.')
  process.exit(1)
}

const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

// ── Helpers ───────────────────────────────────────────────────────────────────
async function poll(): Promise<RunnerJob | null> {
  const res = await fetch(`${SERVER}/api/runner/poll`, { headers: HEADERS })
  if (!res.ok) {
    if (res.status === 401) { console.error('Invalid token — check --token.'); process.exit(1) }
    return null
  }
  const { job } = await res.json() as { job: RunnerJob | null }
  return job
}

async function postSignal(jobId: string, signal: unknown): Promise<void> {
  await fetch(`${SERVER}/api/runner/events`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ jobId, signal }),
  }).catch(() => {})
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ── Job execution ─────────────────────────────────────────────────────────────
async function runJob(job: RunnerJob): Promise<void> {
  console.log(`\n[Runner] Picked up job ${job.id} — appId=${job.appId} freeform=${job.freeform}`)

  const onEvent = (e: AgentEvent) => {
    process.stdout.write(`  ${e.type}: ${e.text ?? ''}\n`)
    postSignal(job.id, e)
  }

  try {
    const app = (await readApps()).find(a => a.id === job.appId)
    if (!app) throw new Error(`App ${job.appId} not found`)

    if (job.freeform) {
      const instruction = job.instruction ?? ''
      const planned = await planStepsFromInstruction(instruction, app, onEvent)
      const testCases: TestCase[] = [{
        id: 'local-1', title: instruction.slice(0, 80), type: 'positive', priority: 'high',
        steps: planned.map(s => s.step), stepExpected: planned.map(s => s.expected),
        expectedResult: planned.at(-1)?.expected ?? '',
      }]
      await playwrightMcpAgent(testCases, app, onEvent, { browser: job.browser, instructions: job.instructions, headed: true })
    } else {
      const issueKey = job.issueKey!
      const issue = await fetchJiraIssue(issueKey)
      const testSteps = issue.testSteps ?? []

      if (testSteps.length === 0) throw new Error(`No test steps found for ${issueKey}`)

      const savedScriptRaw = extractPlaywrightScript(issue.comments)
      let savedSteps: ResolvedStepRecord[] | null = null
      if (savedScriptRaw) {
        const jsonMatch = savedScriptRaw.match(/\/\*RESOLVED_STEPS:([\s\S]+?)\*\//)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]) as ResolvedStepRecord[]
          if (parsed.length === testSteps.length) savedSteps = parsed
          else onEvent({ type: 'log', text: `Saved script has ${parsed.length} step(s) but issue has ${testSteps.length} — re-running with AI…` })
        }
      }

      if (savedSteps) {
        onEvent({ type: 'log', text: `Replaying saved script (${savedSteps.length} steps, no LLM)` })
        const result = await replaySavedScript(issue.summary, savedSteps, app, onEvent, { browser: job.browser, headed: true })
        if (result.failed > 0) {
          onEvent({ type: 'log', text: 'Saved script failed — re-running with AI…' })
          const testCases: TestCase[] = [{
            id: issueKey, title: issue.summary, type: 'positive', priority: 'high',
            steps: testSteps.map(s => s.step), stepExpected: testSteps.map(s => s.expected),
            expectedResult: testSteps.at(-1)?.expected ?? '',
          }]
          const fallback = await playwrightMcpAgent(testCases, app, onEvent, { browser: job.browser, instructions: job.instructions, headed: true })
          if (fallback.failed === 0 && fallback.resolvedSteps?.length === testSteps.length) {
            await saveScript(issueKey, issue.summary, fallback, issue.comments, onEvent)
          }
          await postJiraComment(issueKey, buildResults(issueKey, fallback))
        } else {
          await postJiraComment(issueKey, buildResults(issueKey, result))
        }
      } else {
        const testCases: TestCase[] = [{
          id: issueKey, title: issue.summary, type: 'positive', priority: 'high',
          steps: testSteps.map(s => s.step), stepExpected: testSteps.map(s => s.expected),
          expectedResult: testSteps.at(-1)?.expected ?? '',
        }]
        const result = await playwrightMcpAgent(testCases, app, onEvent, { browser: job.browser, instructions: job.instructions, headed: true })
        if (result.failed === 0 && result.resolvedSteps?.length === testSteps.length) {
          await saveScript(issueKey, issue.summary, result, issue.comments, onEvent)
        }
        await postJiraComment(issueKey, buildResults(issueKey, result))
      }
    }

    await postSignal(job.id, { type: '__DONE__' })
    console.log(`[Runner] Job ${job.id} complete.`)
  } catch (e) {
    const msg = String(e)
    console.error(`[Runner] Job ${job.id} failed: ${msg}`)
    await postSignal(job.id, { type: '__ERROR__', message: msg })
  }
}

async function saveScript(
  issueKey: string, title: string,
  result: Awaited<ReturnType<typeof playwrightMcpAgent>>,
  comments: { id: string; body: string; author: string }[],
  onEvent: (e: AgentEvent) => void,
) {
  try {
    const script = compileScript(result.resolvedSteps!, '', title)
    const full = `${script}\n\n/*RESOLVED_STEPS:${JSON.stringify(result.resolvedSteps)}*/`
    await savePlaywrightScript(issueKey, full, comments)
    onEvent({ type: 'log', text: `Script saved to Jira ${issueKey}` })
  } catch (e) {
    onEvent({ type: 'log', text: `Script save failed (non-fatal): ${String(e)}` })
  }
}

function buildResults(issueKey: string, result: Awaited<ReturnType<typeof playwrightMcpAgent>>): string {
  const lines = [
    '[QA-RESULTS]', `Agent-Driven Playwright Execution for ${issueKey}`,
    `✅ Passed: ${result.passed}  ❌ Failed: ${result.failed}  ⏭️ Skipped: ${result.skipped}`,
    `⏱️ Duration: ${(result.duration / 1000).toFixed(2)}s`, '',
  ]
  for (const t of result.testResults) {
    const icon = t.status === 'passed' ? '✅' : t.status === 'failed' ? '❌' : '⏭️'
    lines.push(`${icon} ${t.title}`)
    if (t.error) lines.push(`   ↳ ${t.error}`)
  }
  return lines.join('\n')
}

// ── Main poll loop ────────────────────────────────────────────────────────────
console.log(`[Runner] Starting — server: ${SERVER}`)
console.log(`[Runner] Polling for jobs every 2 s… (Ctrl+C to stop)\n`)

;(async () => {
  while (true) {
    try {
      const job = await poll()
      if (job) {
        await runJob(job)
      } else {
        await sleep(2000)
      }
    } catch (e) {
      console.error('[Runner] Poll error:', e)
      await sleep(5000)
    }
  }
})()
