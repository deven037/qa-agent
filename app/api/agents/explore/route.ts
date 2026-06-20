import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { fetchJiraIssue } from '@/lib/jira/client'
import { inferRelevantPages } from '@/lib/knowledge/retriever'
import { getKnowledgeStatus } from '@/lib/db/knowledge-store'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { appId, issueKey, prompt: customPrompt } = await req.json()
  const app = readApps().find((a) => a.id === appId)
  if (!app) return new Response('App not found', { status: 404 })

  // Build scenario string from Jira issue or custom prompt
  let scenario = customPrompt || ''
  if (issueKey) {
    try {
      const issue = await fetchJiraIssue(issueKey)
      const description = typeof issue.description === 'string' ? issue.description.slice(0, 300) : ''
      scenario = `${issue.summary}${description ? ` — ${description}` : ''}`
    } catch {
      // fall back to custom prompt
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (text: string) => controller.enqueue(encoder.encode(`data: ${text}\n\n`))

      try {
        // Use persistent knowledge base if available
        const kbStatus = await getKnowledgeStatus(appId)

        if (kbStatus?.status === 'ready' && kbStatus.totalPages > 0) {
          send(`[Explore] Using knowledge base (${kbStatus.totalPages} pages indexed)\n`)
          send(`[Explore] Scenario: "${scenario || 'General exploration'}"\n`)
          send(`[Explore] Finding relevant pages for this scenario...\n\n`)

          const relevantPages = await inferRelevantPages(appId, scenario, 6)

          send(`[Explore] Found ${relevantPages.length} relevant page(s):\n`)
          for (const page of relevantPages) {
            const forms = Array.isArray(page.forms) ? page.forms : []
            const buttons = Array.isArray(page.buttons) ? page.buttons : []
            send(`  • "${page.title}" (${page.path}) — ${forms.length} form(s), ${buttons.length} button(s)\n`)
            for (const form of forms) {
              const fields = Array.isArray(form.fields)
                ? form.fields
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .map((f: any) => f.label || f.placeholder || f.htmlName || '')
                    .filter(Boolean)
                : []
              if (fields.length > 0) send(`    Fields: ${fields.join(', ')}\n`)
            }
          }

          send(`[Explore] Done — ${relevantPages.length} page(s) ready for test case generation.\n`)

          const pagesSummary = relevantPages.map((p) => {
            const forms = Array.isArray(p.forms) ? p.forms : []
            const buttons = Array.isArray(p.buttons) ? p.buttons : []
            return {
              title: p.title,
              path: p.path,
              module: p.module,
              formsCount: forms.length,
              buttonsCount: buttons.length,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              forms: forms.map((f: any) => ({
                name: f.formName || '',
                fields: Array.isArray(f.fields)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ? f.fields.map((field: any) => field.label || field.placeholder || field.htmlName || '').filter(Boolean)
                  : [],
                submitLabel: f.submitButtonLocator
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ? (f.submitButtonLocator.match(/name:\s*['"]([^'"]+)['"]/) || [])[1] ?? null
                  : null,
              })),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              buttons: buttons.slice(0, 6).map((b: any) => b.name || '').filter(Boolean),
            }
          })

          controller.enqueue(encoder.encode(`data: [DONE] ${JSON.stringify({ pages: pagesSummary })}\n\n`))
        } else {
          // No knowledge base yet — prompt user to crawl first
          send(`[Explore] No knowledge base found for this app.\n`)
          send(`[Explore] Go to the Dashboard and click "Start Crawl" to index the app first.\n`)
          send(`[Explore] Tip: crawling takes ~2 minutes and dramatically improves test quality.\n\n`)

          // Emit a minimal context so generation can still proceed
          const fallbackContext = `No UI knowledge available. App URL: ${app.baseUrl}. Please run a knowledge crawl from the app dashboard.`
          controller.enqueue(encoder.encode(`data: [DONE] ${JSON.stringify(fallbackContext)}\n\n`))
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
