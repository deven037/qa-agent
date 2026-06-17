import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { writeJiraConfig, writeApps, readApps } from '@/lib/config/store'
import { nanoid } from 'nanoid'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { app } = await req.json()

  // Save Jira config from env vars (no user entry needed)
  writeJiraConfig({
    baseUrl: process.env.JIRA_BASE_URL ?? '',
    email: process.env.JIRA_ADMIN_EMAIL ?? '',
    apiToken: process.env.JIRA_API_TOKEN ?? '',
    defaultProjectKey: app.jiraProjectKey,
  })

  const newApp = {
    id: `app_${nanoid(8)}`,
    name: app.name,
    jiraProjectKey: app.jiraProjectKey,
    baseUrl: app.baseUrl,
    authStrategy: app.authStrategy,
    credentialEnvVars: app.credentialEnvVars ?? {},
    playwrightTestsDir: `playwright-tests/${app.name.toLowerCase().replace(/\s+/g, '-')}`,
    createdAt: new Date().toISOString(),
  }

  const apps = readApps()
  writeApps([...apps, newApp])

  return NextResponse.json({ ok: true, appId: newApp.id })
}
