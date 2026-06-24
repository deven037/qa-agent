import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { fetchJiraIssue, findExistingScenarios } from '@/lib/jira/client'
import { requirementAgent } from '@/lib/agents/requirement-agent'
import { testCaseAgent, TestCase } from '@/lib/agents/testcase-agent'
import { streamGemini } from '@/lib/ai/gemini'
import { inferRelevantPages, getPageContext, getPageInventory } from '@/lib/knowledge/retriever'
import { formatCredentialsForLLM } from '@/lib/config/store'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { issueKey, appId, prompt: customPrompt } = await req.json()
  if ((!issueKey && !customPrompt) || !appId) return new Response('issueKey or prompt, and appId required', { status: 400 })

  const app = (await readApps()).find((a) => a.id === appId)
  if (!app) return new Response('App not found', { status: 404 })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (text: string) => controller.enqueue(encoder.encode(`data: ${text}\n\n`))

      try {
        let issue: Awaited<ReturnType<typeof fetchJiraIssue>> | null = null
        if (issueKey) {
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
        }

        if (!issue) {
          issue = {
            key: 'PROMPT', summary: customPrompt, issueType: 'Task', status: 'To Do',
            priority: 'Medium', reporter: '', assignee: '', assigneeAvatar: '', reporterAvatar: '',
            created: new Date().toISOString(), description: customPrompt,
            acceptanceCriteria: '', comments: [], children: [], testSteps: [],
          }
        }

        send(`🔍 Analyzing requirements...\n`)
        const requirements = await requirementAgent(issue, send)

        // Step 1: Load KB pages BEFORE generating scenarios — so scenarios are grounded in real app structure
        send(`📚 Loading app knowledge base...\n`)
        const testScope = Array.isArray(requirements.testScope) ? requirements.testScope.join(' ') : String(requirements.testScope ?? '')
        const searchText = `${requirements.summary} ${testScope}`
        const relevantPages = await inferRelevantPages(appId, searchText, 8)
        const appContext = getPageContext(relevantPages)
        const pageInventory = getPageInventory(relevantPages)

        if (relevantPages.length > 0) {
          send(`📚 Loaded ${relevantPages.length} relevant page(s) from knowledge base\n`)
        } else {
          send(`⚠️ No KB pages found — crawl the app first for best results\n`)
        }

        // Step 2: Generate scenario WITH app structure — produces concrete paths/elements, not vague text
        send(`📋 Generating app-grounded test scenario...\n`)
        let scenarios: string
        const existing = findExistingScenarios(issue.comments)
        if (existing) {
          send('Found existing scenarios in Jira — reusing.\n')
          scenarios = existing
        } else {
          scenarios = await generateScenarios(requirements, pageInventory, send)
        }

        // Step 3: Generate test cases with both scenarios AND full page context
        send(`🧪 Generating test cases from real app structure...\n`)
        const credBlock = formatCredentialsForLLM(app)
        const testCases: TestCase[] = await testCaseAgent(requirements, scenarios, true, send, appContext || undefined, credBlock)

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
  pageInventory: string,
  onChunk: (text: string) => void
): Promise<string> {
  const hasInventory = pageInventory && !pageInventory.includes('(no pages')

  const appSection = hasInventory
    ? `\n## Real App Pages (use these exact paths and element names in your scenario)\n${pageInventory}\n`
    : ''

  const prompt = `You are a QA engineer writing a BDD scenario grounded in the real application structure.

## Requirements
${JSON.stringify(requirements, null, 2)}
${appSection}
## Task
Write exactly ONE scenario for the primary happy-path flow.

Format:
Scenario 1: [Title]
- Given: [what must be true before the test — be brief]
- When: [EVERY user action in order — use real paths and element names from the App Pages above]
- Then: [the final observable outcome]

Rules:
- Navigation steps MUST use the exact path from App Pages (e.g. "navigates to /index.php?rt=account/login")
- Form fill steps MUST use exact field names from App Pages (e.g. "fills 'E-Mail Address'")
- Click steps MUST use exact button/link text from App Pages (e.g. "clicks 'Login' button")
- Do NOT invent page paths, field names, or button labels not present in App Pages
- If a required page is missing from App Pages, mention it as "(page not crawled — path unknown)"
- One scenario only.`

  return streamGemini(prompt, 'You are a QA engineer. Write a concrete BDD scenario using only real app elements provided.', onChunk)
}
