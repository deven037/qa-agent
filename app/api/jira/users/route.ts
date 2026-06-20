import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

function getBaseUrl() {
  return process.env.JIRA_BASE_URL!
}
function getAuthHeader() {
  const e = process.env.JIRA_ADMIN_EMAIL!
  const t = process.env.JIRA_API_TOKEN!
  return `Basic ${Buffer.from(`${e}:${t}`).toString('base64')}`
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const project = searchParams.get('project') ?? ''
  const query = searchParams.get('q') ?? ''

  try {
    // Assignable users for the project
    const url = project
      ? `${getBaseUrl()}/rest/api/3/user/assignable/search?project=${project}&query=${encodeURIComponent(query)}&maxResults=20`
      : `${getBaseUrl()}/rest/api/3/users/search?query=${encodeURIComponent(query)}&maxResults=20`

    const res = await fetch(url, { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } })
    if (!res.ok) return NextResponse.json([], { status: 200 })

    const data = await res.json()
    const users = (Array.isArray(data) ? data : [])
      .filter((u: { accountType?: string; active?: boolean }) => u.accountType === 'atlassian' && u.active !== false)
      .map((u: { accountId: string; displayName: string; emailAddress?: string; avatarUrls?: Record<string, string> }) => ({
        accountId: u.accountId,
        displayName: u.displayName,
        email: u.emailAddress ?? '',
        avatar: u.avatarUrls?.['24x24'] ?? '',
      }))

    return NextResponse.json(users)
  } catch {
    return NextResponse.json([])
  }
}
