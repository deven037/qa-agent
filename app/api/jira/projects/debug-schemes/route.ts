import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { readJiraConfig } from '@/lib/config/store'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  const config = await readJiraConfig()
  const baseUrl = config?.baseUrl
  const authHeader = 'Basic ' + Buffer.from(`${config?.email}:${config?.apiToken}`).toString('base64')
  const headers = { Authorization: authHeader, Accept: 'application/json' }

  const projRes = await fetch(`${baseUrl}/rest/api/3/project/${key}`, { headers })
  const proj = await projRes.json()
  const projectId = proj.id

  const [its, ws, iss, fcs] = await Promise.all([
    fetch(`${baseUrl}/rest/api/3/issuetypescheme/project?projectId=${projectId}`, { headers }).then(r => r.json()),
    fetch(`${baseUrl}/rest/api/3/workflowscheme/project?projectId=${projectId}`, { headers }).then(r => r.json()),
    fetch(`${baseUrl}/rest/api/3/issuetypescreenscheme/project?projectId=${projectId}`, { headers }).then(r => r.json()),
    fetch(`${baseUrl}/rest/api/3/fieldconfigurationscheme/project?projectId=${projectId}`, { headers }).then(r => r.json()),
  ])

  return NextResponse.json({
    projectId,
    issueTypeScheme: its?.values?.[0]?.issueTypeScheme ?? null,
    workflowScheme: ws?.values?.[0]?.workflowScheme ?? null,
    issueTypeScreenScheme: iss?.values?.[0]?.issueTypeScreenScheme ?? null,
    fieldConfigurationScheme: fcs?.values?.[0]?.fieldConfigurationScheme ?? null,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { source, target } = await req.json()

  const config = await readJiraConfig()
  const baseUrl = config?.baseUrl
  const authHeader = 'Basic ' + Buffer.from(`${config?.email}:${config?.apiToken}`).toString('base64')
  const headers = { Authorization: authHeader, Accept: 'application/json' }

  const [srcRes, tgtRes] = await Promise.all([
    fetch(`${baseUrl}/rest/api/3/project/${source}`, { headers }).then(r => r.json()),
    fetch(`${baseUrl}/rest/api/3/project/${target}`, { headers }).then(r => r.json()),
  ])

  return NextResponse.json({
    source: { key: srcRes.key, issueTypes: srcRes.issueTypes?.map((t: {name:string,id:string}) => ({ name: t.name, id: t.id })) },
    target: { key: tgtRes.key, issueTypes: tgtRes.issueTypes?.map((t: {name:string,id:string}) => ({ name: t.name, id: t.id })) },
  })
}
