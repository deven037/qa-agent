import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

function getBaseUrl() {
  const url = process.env.JIRA_BASE_URL
  if (!url) throw new Error('JIRA_BASE_URL not set')
  return url
}

function getAuthHeader() {
  const email = process.env.JIRA_ADMIN_EMAIL
  const token = process.env.JIRA_API_TOKEN
  if (!email || !token) throw new Error('Jira credentials not set')
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key } = await params
  const res = await fetch(`${getBaseUrl()}/rest/api/3/issue/${key}/transitions`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/json' },
  })
  if (!res.ok) return NextResponse.json({ error: 'Failed to fetch transitions' }, { status: res.status })
  const data = await res.json()

  const STATUS_ORDER = ['To Do', 'In Progress', 'In Review', 'Done']

  // Deduplicate by toStatus — keep the first transition per target status
  const seen = new Set<string>()
  const transitions = (data.transitions ?? [])
    .map((t: { id: string; name: string; to: { name: string } }) => ({
      id: t.id,
      name: t.name,
      toStatus: t.to?.name as string,
    }))
    .filter((t: { toStatus: string }) => {
      if (!t.toStatus || seen.has(t.toStatus)) return false
      seen.add(t.toStatus)
      return true
    })
    .sort((a: { toStatus: string }, b: { toStatus: string }) => {
      const ai = STATUS_ORDER.indexOf(a.toStatus)
      const bi = STATUS_ORDER.indexOf(b.toStatus)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })

  return NextResponse.json(transitions)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key } = await params
  const { transitionId } = await req.json()

  const res = await fetch(`${getBaseUrl()}/rest/api/3/issue/${key}/transitions`, {
    method: 'POST',
    headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id: transitionId } }),
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: res.status })
  }
  return NextResponse.json({ ok: true })
}
