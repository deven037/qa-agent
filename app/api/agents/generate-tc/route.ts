import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { fetchJiraIssue, findExistingScenarios } from '@/lib/jira/client'
import { requirementAgent } from '@/lib/agents/requirement-agent'
import { testCaseAgent, TestCase } from '@/lib/agents/testcase-agent'
import { streamGemini } from '@/lib/ai/gemini'
import { inferRelevantPages, getPageContext } from '@/lib/knowledge/retriever'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { issueKey, appId } = await req.json()
  if (!issueKey || !appId) return new Response('issueKey and appId required', { status: 400 })

  const app = readApps().find((a) => a.id === appId)
  if (!app) return new Response('App not found', { status: 404 })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (text: string) => controller.enqueue(encoder.encode(`data: ${text}\n\n`))

      try {
        let issue
        try {
          issue = await fetchJiraIssue(issueKey)
        } catch (e) {
          const msg = String(e)
          if (msg.includes('404')) {
            controller.enqueue(encoder.encode(`data: [ERROR] Issue ${issueKey} not found in Jira. Check the issue key and try again.\n\n`))
          } else {
            controller.enqueue(encoder.encode(`data: [ERROR] Could not fetch ${issueKey} from Jira: ${msg}\n\n`))
          }
          controller.close()
          return
        }

        send(`🔍 Analyzing requirements for ${issueKey}...\n`)
        const requirements = await requirementAgent(issue, send)

        // Load relevant UI context from knowledge base
        const scenarioText = `${requirements.summary} ${requirements.testScope} ${requirements.riskAreas?.join(' ') ?? ''}`
        const relevantPages = await inferRelevantPages(appId, scenarioText, 5)
        const appContext = getPageContext(relevantPages)
        if (relevantPages.length > 0) {
          send(`📚 Loaded UI knowledge for ${relevantPages.length} relevant page(s)\n`)
        }

        send(`📋 Generating test scenarios...\n`)
        let scenarios: string
        const existing = findExistingScenarios(issue.comments)
        if (existing) {
          send('Found existing scenarios in Jira — reusing.\n')
          scenarios = existing
        } else {
          scenarios = await generateScenarios(requirements, send)
        }

        send(`🧪 Generating test cases...\n`)
        const testCases: TestCase[] = await testCaseAgent(requirements, scenarios, true, send, appContext || undefined)

        send(`✅ ${testCases.length} test case(s) generated. Review before saving.\n`)

        controller.enqueue(encoder.encode(`data: [DONE] ${JSON.stringify(testCases)}\n\n`))
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

async function generateScenarios(
  requirements: Awaited<ReturnType<typeof requirementAgent>>,
  onChunk: (text: string) => void
): Promise<string> {
  const prompt = `Based on these requirements, generate test scenarios:
${JSON.stringify(requirements, null, 2)}

Write clear test scenarios:
Scenario 1: [Title]
- Given: [precondition]
- When: [action]
- Then: [expected outcome]

Cover happy path, error cases, and edge cases.`
  return streamGemini(prompt, 'You are a QA engineer writing BDD-style test scenarios.', onChunk)
}
