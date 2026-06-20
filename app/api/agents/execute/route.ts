import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { fetchJiraIssue, findExistingTestCases, postJiraComment, parseTestCasesFromMarkdown } from '@/lib/jira/client'
import { TestCase } from '@/lib/agents/testcase-agent'
import { inferRelevantPages } from '@/lib/knowledge/retriever'
import { playwrightMcpAgent, AgentEvent, ExecutionResult } from '@/lib/agents/playwright-mcp-agent'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { issueKey, appId, headed = false, browser = 'chromium', instructions = '' } = await req.json()
  if (!issueKey || !appId) return new Response('issueKey and appId required', { status: 400 })

  const app = readApps().find((a) => a.id === appId)
  if (!app) return new Response('App not found', { status: 404 })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const sendEvent = (event: AgentEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      const log = (text: string) => sendEvent({ type: 'log', text })

      try {
        // Load test cases from Jira
        log(`Loading test cases for ${issueKey}…`)
        const issue = await fetchJiraIssue(issueKey)
        const markdown = findExistingTestCases(issue.comments)

        if (!markdown) {
          controller.enqueue(encoder.encode(`data: [ERROR] No test cases found for ${issueKey}. Generate test cases first.\n\n`))
          controller.close()
          return
        }

        const testCases = parseTestCasesFromMarkdown(markdown)
        log(`Found ${testCases.length} test case(s). Loading app knowledge…`)

        // Load RAG pages
        const scenarioText = `${issue.summary} ${testCases.map((tc) => tc.title).join(' ')}`
        const relevantPages = await inferRelevantPages(appId, scenarioText, 6)
        log(`Loaded ${relevantPages.length} page(s) from knowledge base. Starting execution…`)

        // Run agent-driven execution
        const result = await playwrightMcpAgent(testCases, app, relevantPages, sendEvent, { browser, instructions, headed })

        // Post results to Jira
        try {
          await postJiraComment(issueKey, buildJiraResults(issueKey, result))
          log('Results posted to Jira.')
        } catch { /* non-fatal */ }

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
