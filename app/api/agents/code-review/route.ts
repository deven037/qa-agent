import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { codeReviewerAgent } from '@/lib/agents/code-reviewer-agent'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { code, appId } = await req.json()
  if (!code || !appId) return new Response('code and appId required', { status: 400 })

  const app = (await readApps()).find((a) => a.id === appId)
  if (!app) return new Response('App not found', { status: 404 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (text: string) => {
        try { controller.enqueue(encoder.encode(`data: ${text}\n\n`)) } catch { /* client disconnected */ }
      }

      try {
        const result = await codeReviewerAgent(code, app, (chunk) => send(chunk))
        controller.enqueue(encoder.encode(`data: [DONE] ${JSON.stringify(result)}\n\n`))
      } catch (e) {
        controller.enqueue(encoder.encode(`data: [ERROR] ${String(e)}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
