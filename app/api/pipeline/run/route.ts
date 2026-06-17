import { NextRequest } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { runPipeline, SSEEvent } from '@/lib/orchestrator/pipeline'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { issueKey, appId, issueType } = await req.json()
  if (!issueKey || !appId) return new Response('issueKey and appId are required', { status: 400 })

  const apps = readApps()
  const appConfig = apps.find((a) => a.id === appId)
  if (!appConfig) return new Response('App not found', { status: 404 })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const emit = (event: SSEEvent) => {
        const data = `data: ${JSON.stringify(event)}\n\n`
        controller.enqueue(encoder.encode(data))
      }

      try {
        await runPipeline(issueKey, appConfig, emit, issueType)
        controller.enqueue(encoder.encode('data: {"agent":"system","type":"done","data":"Pipeline complete"}\n\n'))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        controller.enqueue(
          encoder.encode(`data: {"agent":"system","type":"error","data":${JSON.stringify(message)}}\n\n`)
        )
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
