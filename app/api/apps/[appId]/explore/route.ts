import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { deepExplorationAgent } from '@/lib/agents/deep-exploration-agent'
import { upsertKnowledge, getKnowledgeStatus } from '@/lib/db/knowledge-store'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })
  const { appId } = await params
  const status = await getKnowledgeStatus(appId).catch(() => null)
  return Response.json(status ?? { status: 'not_started' })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })
  const { appId } = await params
  await upsertKnowledge({
    appId,
    status: 'failed',
    crawlError: 'Cancelled by user',
    crawlCompletedAt: new Date(),
  } as Parameters<typeof upsertKnowledge>[0])
  return Response.json({ ok: true })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { appId } = await params
  const app = (await readApps()).find((a) => a.id === appId)
  if (!app) return new Response('App not found', { status: 404 })

  const abortController = new AbortController()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (text: string) => {
        try { controller.enqueue(encoder.encode(text)) } catch { /* client disconnected */ }
      }

      // Mark as crawling
      await upsertKnowledge({
        appId,
        baseUrl: app.baseUrl,
        status: 'crawling',
        pages: [],
        totalPages: 0,
        authRequired: false,
        crawlStartedAt: new Date(),
        crawlCompletedAt: null,
        crawlError: null,
        version: 1,
      } as Parameters<typeof upsertKnowledge>[0])

      send(`[DeepCrawl] Starting knowledge crawl for "${app.name}"...\n`)

      try {
        const pages = await deepExplorationAgent(app, send, abortController.signal)

        if (abortController.signal.aborted) {
          await upsertKnowledge({
            appId,
            status: 'failed',
            crawlError: 'Cancelled by user',
            crawlCompletedAt: new Date(),
          } as Parameters<typeof upsertKnowledge>[0])
          send(`[CANCELLED] Crawl cancelled\n`)
        } else {
          const authRequired = pages.some((p) => p.module === 'auth')
          await upsertKnowledge({
            appId,
            baseUrl: app.baseUrl,
            status: 'ready',
            pages,
            totalPages: pages.length,
            authRequired,
            crawlCompletedAt: new Date(),
            crawlError: null,
          } as Parameters<typeof upsertKnowledge>[0])
          send(`[DONE] Knowledge base ready — ${pages.length} pages indexed\n`)
        }
      } catch (e) {
        const errMsg = String(e).split('\n')[0]
        await upsertKnowledge({
          appId,
          status: 'failed',
          crawlError: errMsg,
          crawlCompletedAt: new Date(),
        } as Parameters<typeof upsertKnowledge>[0])
        send(`[ERROR] Crawl failed: ${errMsg}\n`)
      } finally {
        controller.close()
      }
    },
    cancel() {
      abortController.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  })
}
