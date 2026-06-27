import { NextRequest } from 'next/server'
import { nanoid } from 'nanoid'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { fetchJiraIssue, postJiraComment } from '@/lib/jira/client'
import { TestCase } from '@/lib/agents/testcase-agent'
import { AgentEvent, ExecutionResult } from '@/lib/agents/playwright-mcp-agent'
import { autonomousMcpAgent } from '@/lib/agents/autonomous-mcp-agent'
import { planStepsFromInstruction } from '@/lib/agents/step-planner'
import { createJob, subscribeToJob, JobSignal } from '@/lib/runner/job-store'
import { TestRun, StepRecord, NavEvent } from '@/lib/db/models/TestRun'
import dbConnect from '@/lib/db/mongoose'

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

      // ── Event capture for report ─────────────────────────────────────────────
      const steps: StepRecord[] = []
      const navEvents: NavEvent[] = []
      let currentStep: StepRecord | null = null

      const sendEvent = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

        switch (event.type) {
          case 'step_start':
            currentStep = {
              stepIndex: event.stepIndex ?? steps.length,
              description: event.step ?? '',
              status: 'failed',
              locatorAttempts: [],
              healingAttempts: 0,
            }
            break
          case 'dom_inspect':
            if (currentStep) { currentStep.pageUrl = event.url; currentStep.domFieldCount = event.fieldCount }
            break
          case 'llm_response':
            if (currentStep) { currentStep.action = event.action; currentStep.resolvedLocator = event.locator }
            break
          case 'locator_try':
            if (currentStep && event.locator != null) {
              currentStep.locatorAttempts.push({ locator: event.locator, success: event.success ?? false })
            }
            break
          case 'step_heal':
            if (currentStep) {
              currentStep.healingAttempts = event.attempt ?? currentStep.healingAttempts + 1
              if (event.rationale) currentStep.healingRationale = event.rationale
            }
            break
          case 'step_done':
            if (currentStep) {
              currentStep.status = event.status ?? 'failed'
              currentStep.duration = event.duration
              currentStep.error = event.error
              steps.push(currentStep)
              currentStep = null
            }
            break
          case 'nav':
            if (event.url) navEvents.push({ url: event.url, stepIndex: currentStep?.stepIndex ?? -1 })
            break
        }
      }
      const log = (text: string) => sendEvent({ type: 'log', text })

      const saveRun = async (result: ExecutionResult, issueKey?: string, title?: string, browser = 'chromium') => {
        try {
          await dbConnect
          const runId = nanoid(12)
          await TestRun.create({
            runId,
            appId,
            issueKey,
            title: title ?? (freeform ? instruction.slice(0, 120) : issueKey ?? 'Unknown'),
            status: result.failed > 0 ? 'failed' : 'passed',
            passed: result.passed,
            failed: result.failed,
            skipped: result.skipped ?? 0,
            duration: result.duration,
            steps,
            navEvents,
            browser,
            runner: 'server',
            executedAt: new Date(),
            createdAt: new Date(),
          })
          controller.enqueue(encoder.encode(`data: [RUN_ID] ${runId}\n\n`))
        } catch (e) {
          log(`Report save failed (non-fatal): ${String(e)}`)
        }
      }

      try {
        // ── Autonomous agent — single conversation drives the full TC ──────────
        let testCases: TestCase[]

        if (freeform) {
          log(`[Auto] Planning steps for: ${instruction.slice(0, 80)}…`)
          const plannedSteps = await planStepsFromInstruction(instruction, app, sendEvent)
          if (plannedSteps.length === 0) {
            controller.enqueue(encoder.encode(`data: [ERROR] Planner produced no steps — try a more specific instruction.\n\n`))
            controller.close(); return
          }
          testCases = [{
            id: 'auto-freeform-1', title: instruction.slice(0, 80), type: 'positive', priority: 'high',
            steps: plannedSteps.map(s => s.step), stepExpected: plannedSteps.map(s => s.expected),
            expectedResult: plannedSteps.at(-1)?.expected ?? '',
          }]
          sendEvent({ type: 'plan_done', text: `${plannedSteps.length} step(s) planned — autonomous agent starting…` })
        } else {
          log(`Loading ${issueKey} from Jira…`)
          const issue = await fetchJiraIssue(issueKey)
          const testSteps = issue.testSteps ?? []
          if (testSteps.length === 0) {
            controller.enqueue(encoder.encode(`data: [ERROR] No test steps found for ${issueKey}. Add test steps in the Work Items drawer first.\n\n`))
            controller.close(); return
          }
          sendEvent({ type: 'plan_start', text: `Loading ${testSteps.length} step(s) from Jira ${issueKey}` })
          for (let i = 0; i < testSteps.length; i++) {
            sendEvent({ type: 'plan_step', stepIndex: i, plannedStep: { step: testSteps[i].step, expected: testSteps[i].expected }, text: testSteps[i].step })
          }
          sendEvent({ type: 'plan_done', text: `${testSteps.length} step(s) loaded — autonomous agent starting…` })
          testCases = [{ id: issue.key, title: issue.summary, type: 'positive', priority: 'high',
            steps: testSteps.map(s => s.step), stepExpected: testSteps.map(s => s.expected),
            expectedResult: testSteps.at(-1)?.expected ?? '' }]
        }

        log('[Auto] Autonomous agent initializing…')
        const result = await autonomousMcpAgent(testCases, app, sendEvent, { browser })
        if (issueKey) await postJiraComment(issueKey, buildJiraResults(issueKey, result))
        await saveRun(result, issueKey, freeform ? instruction.slice(0, 120) : issueKey, String(browser))
        controller.enqueue(encoder.encode(`data: [DONE] ${JSON.stringify(result)}\n\n`))
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
