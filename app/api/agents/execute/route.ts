import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { fetchJiraIssue, postJiraComment, extractPlaywrightScript, savePlaywrightScript } from '@/lib/jira/client'
import { TestCase } from '@/lib/agents/testcase-agent'
import { inferRelevantPages } from '@/lib/knowledge/retriever'
import { playwrightMcpAgent, replaySavedScript, AgentEvent, ExecutionResult, ResolvedStepRecord } from '@/lib/agents/playwright-mcp-agent'
import { planStepsFromInstruction } from '@/lib/agents/step-planner'
import { compileScript } from '@/lib/agents/script-compiler'
import { createJob, subscribeToJob, JobSignal } from '@/lib/runner/job-store'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { issueKey, appId, headed = false, browser = 'chromium', instructions = '', freeform = false, instruction = '', runnerMode = 'server' } = await req.json()

  if (!appId) return new Response('appId required', { status: 400 })
  if (!freeform && !issueKey) return new Response('issueKey required for Jira mode', { status: 400 })
  if (freeform && !instruction) return new Response('instruction required for freeform mode', { status: 400 })

  const app = (await readApps()).find((a) => a.id === appId)
  if (!app) return new Response('App not found', { status: 404 })

  // ── Local runner mode: hand job to runner script on user's machine ──────────
  if (runnerMode === 'local') {
    const jobId = createJob({ appId, issueKey, instruction, freeform, browser, instructions })
    const localStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const send = (s: string) => controller.enqueue(encoder.encode(s))
        send(`data: ${JSON.stringify({ type: 'log', text: `Job ${jobId} queued — waiting for local runner…` })}\n\n`)

        const unsub = subscribeToJob(jobId, (signal: JobSignal) => {
          if (signal.type === '__DONE__') {
            send(`data: [DONE] ${JSON.stringify({ passed: 0, failed: 0, skipped: 0, duration: 0, testResults: [] })}\n\n`)
            unsub()
            controller.close()
          } else if (signal.type === '__ERROR__') {
            const msg = (signal as { type: '__ERROR__'; message: string }).message
            send(`data: [ERROR] ${msg}\n\n`)
            unsub()
            controller.close()
          } else {
            send(`data: ${JSON.stringify(signal)}\n\n`)
          }
        })

        // Timeout if runner never connects
        setTimeout(() => {
          send(`data: [ERROR] Local runner did not connect within 60 s. Is it running?\n\n`)
          unsub()
          controller.close()
        }, 60_000)
      },
    })
    return new Response(localStream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const sendEvent = (event: AgentEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      const log = (text: string) => sendEvent({ type: 'log', text })

      try {
        let testCases: TestCase[]
        let scenarioText: string

        if (freeform) {
          log(`Loading app knowledge for freeform execution…`)
          const relevantPages = await inferRelevantPages(appId, instruction, 6)
          log(`Loaded ${relevantPages.length} page(s). Planning steps…`)

          const plannedSteps = await planStepsFromInstruction(instruction, app, relevantPages, sendEvent)
          scenarioText = instruction

          testCases = [{
            id: 'freeform-1',
            title: instruction.slice(0, 80),
            type: 'positive',
            priority: 'high',
            steps: plannedSteps.map(s => s.step),
            stepExpected: plannedSteps.map(s => s.expected),
            expectedResult: plannedSteps.at(-1)?.expected ?? '',
          }]

          log(`Plan ready — ${plannedSteps.length} step(s). Starting execution…`)
          const result = await playwrightMcpAgent(testCases, app, relevantPages, sendEvent, { browser, instructions, headed })
          controller.enqueue(encoder.encode(`data: [DONE] ${JSON.stringify(result)}\n\n`))
        } else {
          log(`Loading issue ${issueKey} from Jira…`)
          const issue = await fetchJiraIssue(issueKey)
          const testSteps = issue.testSteps ?? []

          if (testSteps.length === 0) {
            controller.enqueue(encoder.encode(`data: [ERROR] No test steps found for ${issueKey}. Add test steps in the Work Items drawer first.\n\n`))
            controller.close()
            return
          }

          // ── Check for saved Playwright script ─────────────────────────────
          const savedScriptRaw = extractPlaywrightScript(issue.comments)
          let savedSteps: ResolvedStepRecord[] | null = null
          if (savedScriptRaw) {
            try {
              const jsonMatch = savedScriptRaw.match(/\/\*RESOLVED_STEPS:([\s\S]+?)\*\//)
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[1]) as ResolvedStepRecord[]
                // Only trust the saved script if it covers ALL current test steps
                if (parsed.length === testSteps.length) {
                  savedSteps = parsed
                } else {
                  log(`Saved script has ${parsed.length} step(s) but issue now has ${testSteps.length} — re-running with AI to regenerate…`)
                }
              }
            } catch { /* malformed, fall through to full agent */ }
          }

          if (savedSteps && savedSteps.length > 0) {
            // ── Replay saved script — no LLM ────────────────────────────────
            sendEvent({ type: 'plan_start', text: `Replaying saved script for ${issueKey} (${savedSteps.length} steps, no LLM needed)` })
            for (let i = 0; i < savedSteps.length; i++) {
              sendEvent({ type: 'plan_step', stepIndex: i, plannedStep: { step: savedSteps[i].original, expected: '' }, text: savedSteps[i].original })
            }
            sendEvent({ type: 'plan_done', text: `Script loaded — replaying ${savedSteps.length} step(s)` })
            log('Saved script found — skipping LLM, running directly…')

            const result = await replaySavedScript(issue.summary, savedSteps, app, sendEvent, { browser, headed })

            if (result.failed > 0) {
              // Script broke (app changed) — fall back to full agent and regenerate
              log('Saved script failed — app may have changed. Re-running with AI and updating script…')
              sendEvent({ type: 'plan_start', text: 'Regenerating script with AI…' })
              const relevantPages = await inferRelevantPages(appId, issue.summary, 6)
              const testCasesFallback: TestCase[] = [{
                id: issue.key, title: issue.summary, type: 'positive', priority: 'high',
                steps: testSteps.map(s => s.step), stepExpected: testSteps.map(s => s.expected),
                expectedResult: testSteps.at(-1)?.expected ?? '',
              }]
              const fallbackResult = await playwrightMcpAgent(testCasesFallback, app, relevantPages, sendEvent, { browser, instructions, headed })
              await saveAndPostScript(issueKey, issue.summary, fallbackResult, issue.comments, sendEvent, log)
              await postJiraComment(issueKey, buildJiraResults(issueKey, fallbackResult))
              controller.enqueue(encoder.encode(`data: [DONE] ${JSON.stringify(fallbackResult)}\n\n`))
            } else {
              await postJiraComment(issueKey, buildJiraResults(issueKey, result))
              log('Results posted to Jira.')
              controller.enqueue(encoder.encode(`data: [DONE] ${JSON.stringify(result)}\n\n`))
            }
          } else {
            // ── First run — use full AI agent ────────────────────────────────
            sendEvent({ type: 'plan_start', text: `Loading ${testSteps.length} step(s) from Jira ${issueKey}` })
            for (let i = 0; i < testSteps.length; i++) {
              sendEvent({ type: 'plan_step', stepIndex: i, plannedStep: { step: testSteps[i].step, expected: testSteps[i].expected }, text: testSteps[i].step })
            }
            sendEvent({ type: 'plan_done', text: `${testSteps.length} step(s) loaded — AI will resolve locators` })

            const testCasesFirst: TestCase[] = [{
              id: issue.key, title: issue.summary, type: 'positive', priority: 'high',
              steps: testSteps.map(s => s.step), stepExpected: testSteps.map(s => s.expected),
              expectedResult: testSteps.at(-1)?.expected ?? '',
            }]

            const relevantPages = await inferRelevantPages(appId, `${issue.summary} ${testSteps.map(s => s.step).join(' ')}`, 6)
            log(`Loaded ${relevantPages.length} page(s). Starting first-run AI execution…`)

            const result = await playwrightMcpAgent(testCasesFirst, app, relevantPages, sendEvent, { browser, instructions, headed })

            if (result.failed === 0 && result.resolvedSteps && result.resolvedSteps.length === testSteps.length) {
              await saveAndPostScript(issueKey, issue.summary, result, issue.comments, sendEvent, log)
            } else if (result.failed === 0 && result.resolvedSteps && result.resolvedSteps.length < testSteps.length) {
              log(`Script not saved — only ${result.resolvedSteps.length}/${testSteps.length} steps were captured. Re-run to generate script.`)
            }

            await postJiraComment(issueKey, buildJiraResults(issueKey, result))
            log('Results posted to Jira.')
            controller.enqueue(encoder.encode(`data: [DONE] ${JSON.stringify(result)}\n\n`))
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`data: [ERROR] ${String(e)}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}


async function saveAndPostScript(
  issueKey: string,
  title: string,
  result: ExecutionResult,
  comments: { id: string; body: string; author: string }[],
  sendEvent: (e: AgentEvent) => void,
  log: (t: string) => void,
) {
  try {
    const steps = result.resolvedSteps!
    const playwrightCode = compileScript(steps, '', title)
    // Embed resolved steps as a JSON comment inside the script for replay
    const resolvedJson = `/*RESOLVED_STEPS:${JSON.stringify(steps)}*/`
    const fullScript = `${playwrightCode}\n\n${resolvedJson}`
    await savePlaywrightScript(issueKey, fullScript, comments)
    sendEvent({ type: 'log', text: `Script saved to Jira ${issueKey} — next run will skip AI and replay directly` })
    log(`Playwright script saved to ${issueKey}.`)
  } catch (e) {
    log(`Script save failed (non-fatal): ${String(e)}`)
  }
}

function buildJiraResults(issueKey: string, result: ExecutionResult): string {
  const lines = [
    '[QA-RESULTS]',
    `Agent-Driven Playwright Execution for ${issueKey}`,
    `✅ Passed: ${result.passed}  ❌ Failed: ${result.failed}  ⏭️ Skipped: ${result.skipped}`,
    `⏱️ Duration: ${(result.duration / 1000).toFixed(2)}s`,
    '',
  ]
  for (const t of result.testResults) {
    const icon = t.status === 'passed' ? '✅' : t.status === 'failed' ? '❌' : '⏭️'
    lines.push(`${icon} ${t.title}`)
    if (t.error) lines.push(`   ↳ ${t.error}`)
  }
  return lines.join('\n')
}
