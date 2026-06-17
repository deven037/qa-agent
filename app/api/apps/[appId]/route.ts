import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { readApps, writeApps } from '@/lib/config/store'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { appId } = await params
  const app = readApps().find((a) => a.id === appId)
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(app)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { appId } = await params
  const apps = readApps().filter((a) => a.id !== appId)
  writeApps(apps)
  return NextResponse.json({ ok: true })
}
