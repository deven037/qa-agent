import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { fetchJiraIssue, findExistingScenarios } from '@/lib/jira/client'
import { requirementAgent } from '@/lib/agents/requirement-agent'
import { testCaseAgent, TestCase } from '@/lib/agents/testcase-agent'
import { streamGemini } from '@/lib/ai/gemini'
import { formatCredentialsForLLM } from '@/lib/config/store'
import { fetchSitemap } from '@/lib/utils/sitemap'
import { identifyRelevantPages } from '@/lib/agents/page-identifier-agent'
import { liveReconAgent } from '@/lib/agents/live-recon-agent'
import { verifyTestCases } from '@/lib/agents/step-verifier'

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

        // Step 1: Live recon — capture real page structure from the app
        send(`⚡ Capturing live app structure...\n`)
        const sitemapPaths = await fetchSitemap(app.baseUrl)
        if (sitemapPaths.length) send(`🗺️ Found ${sitemapPaths.length} URLs in sitemap\n`)
        const pagesToCapture = await identifyRelevantPages(requirements, sitemapPaths, app, send)
        send(`🎯 Targeting: ${pagesToCapture.join(', ')}\n`)
        const reconResult = await liveReconAgent(app, pagesToCapture, send)
        const appContext = reconResult.appContext
        const pageInventory = reconResult.pageInventory
        const elementMapContext = reconResult.elementMapContext
        if (elementMapContext) send(`🗂️ Element map built — ${reconResult.pages.reduce((n, p) => n + p.elementMap.length, 0)} interactive elements mapped\n`)

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

        // Step 3: Generate test cases with element map → structured steps with embedded locators
        send(`🧪 Generating test cases with pre-resolved locators...\n`)
        const credBlock = formatCredentialsForLLM(app)
        const rawTestCases: TestCase[] = await testCaseAgent(
          requirements, scenarios, true, send,
          appContext || undefined, credBlock, elementMapContext || undefined
        )

        // Step 4: Pre-flight verification — validate every locator against the live app, auto-fix failures
        send(`🔍 Pre-verifying test steps against live app...\n`)
        const testCases = await verifyTestCases(rawTestCases, app, send)

        const totalSteps = testCases.reduce((n, tc) => n + (tc.verificationStatus?.total ?? tc.steps.length), 0)
        const verifiedSteps = testCases.reduce((n, tc) => n + (tc.verificationStatus?.verified ?? tc.steps.length), 0)
        send(`✅ ${testCases.length} test case(s) ready — ${verifiedSteps}/${totalSteps} steps pre-verified.\n`)
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
- If a required page is missing from App Pages, write a natural step using domain knowledge and mark it [inferred]
- One scenario only.`

  return streamGemini(prompt, 'You are a QA engineer. Write a concrete BDD scenario using only real app elements provided.', onChunk)
}
