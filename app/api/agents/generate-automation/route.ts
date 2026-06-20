import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { fetchJiraIssue, findExistingTestCases, attachFileToJiraIssue, parseTestCasesFromMarkdown } from '@/lib/jira/client'
import { automationAgent } from '@/lib/agents/automation-agent'
import { TestCase } from '@/lib/agents/testcase-agent'
import { inferRelevantPages, getLocatorContext } from '@/lib/knowledge/retriever'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { issueKey, appId, browser = 'chromium', instructions = '', includeNegative = true, includeScreenshots = false } = await req.json()
  if (!issueKey || !appId) return new Response('issueKey and appId required', { status: 400 })

  const app = (await readApps()).find((a) => a.id === appId)
  if (!app) return new Response('App not found', { status: 404 })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (text: string) => controller.enqueue(encoder.encode(`data: ${text}\n\n`))

      try {
        const issue = await fetchJiraIssue(issueKey)
        const existingMarkdown = findExistingTestCases(issue.comments)

        let testCases: TestCase[]
        if (existingMarkdown) {
          send(`\n📋 Found existing test cases in Jira — using them.\n`)
          testCases = parseTestCasesFromMarkdown(existingMarkdown)
        } else {
          send(`\n⚠️ No test cases found for ${issueKey}. Please generate test cases first.\n`)
          controller.enqueue(encoder.encode(`data: [ERROR] No test cases found. Generate test cases first.\n\n`))
          controller.close()
          return
        }

        // Load real locators from knowledge base
        const scenarioText = testCases.map((tc) => tc.title).join(' ')
        const relevantPages = await inferRelevantPages(appId, scenarioText, 5)
        const locatorContext = getLocatorContext(relevantPages)
        if (relevantPages.length > 0) {
          send(`\n🗺️ Loaded real UI locators from ${relevantPages.length} page(s) in knowledge base\n`)
        }

        send(`\n🤖 Generating Playwright automation script (${browser}, ${includeNegative ? 'positive + negative' : 'positive only'})...\n`)
        const script = await automationAgent(issueKey, testCases, app, send, locatorContext || undefined, { browser, instructions, includeNegative, includeScreenshots })

        await attachFileToJiraIssue(issueKey, `${issueKey}.spec.ts`, script)
        send(`\n✅ Script saved to Jira and disk.\n`)

        controller.enqueue(encoder.encode(`data: [DONE] ${JSON.stringify(script)}\n\n`))
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

