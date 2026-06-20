import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { readApps, writeApps } from '@/lib/config/store'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { appId } = await params
  const apps = await readApps()
  const app = apps.find((a) => a.id === appId)
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(app)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { appId } = await params
  const body = await req.json()
  const apps = await readApps()
  const idx = apps.findIndex((a) => a.id === appId)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  apps[idx] = { ...apps[idx], ...body }
  await writeApps(apps)
  return NextResponse.json(apps[idx])
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { appId } = await params
  const apps = (await readApps()).filter((a) => a.id !== appId)
  await writeApps(apps)
  return NextResponse.json({ ok: true })
}
