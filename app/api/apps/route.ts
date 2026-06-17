import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { readApps, writeApps } from '@/lib/config/store'
import { nanoid } from 'nanoid'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(readApps())
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const newApp = {
    id: `app_${nanoid(8)}`,
    name: body.name,
    jiraProjectKey: body.jiraProjectKey,
    baseUrl: body.baseUrl,
    authStrategy: body.authStrategy,
    credentialEnvVars: body.credentialEnvVars ?? {},
    playwrightTestsDir: `playwright-tests/${body.name.toLowerCase().replace(/\s+/g, '-')}`,
    createdAt: new Date().toISOString(),
  }
  const apps = readApps()
  writeApps([...apps, newApp])
  return NextResponse.json(newApp)
}
