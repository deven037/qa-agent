import { NextRequest } from 'next/server'
import { auth } from '@/auth'

export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })
  return Response.json({ status: 'live_recon' })
}

export async function DELETE(_req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })
  return Response.json({ ok: true })
}

export async function POST(_req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })
  return Response.json({ message: 'Knowledge base crawl removed — live recon is used automatically during TC generation.' })
}
