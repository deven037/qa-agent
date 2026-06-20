import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'

function getBaseUrl() { return process.env.JIRA_BASE_URL ?? '' }
function getAuthHeader() {
  const email = process.env.JIRA_ADMIN_EMAIL ?? ''
  const token = process.env.JIRA_API_TOKEN ?? ''
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const projectKey = searchParams.get('project') ?? ''

  try {
    // Fetch issue types scoped to the project if key provided, otherwise all
    const url = projectKey
      ? `${getBaseUrl()}/rest/api/3/project/${projectKey}`
      : `${getBaseUrl()}/rest/api/3/issuetype`

    const res = await fetch(url, {
      headers: { Authorization: getAuthHeader(), Accept: 'application/json' },
    })

    if (!res.ok) throw new Error(`Jira returned ${res.status}`)
    const data = await res.json()

    let types: string[]
    if (projectKey && data.issueTypes) {
      // Project detail endpoint returns issueTypes array
      types = (data.issueTypes as { name: string; subtask: boolean }[])
        .filter((t) => !t.subtask)
        .map((t) => t.name)
    } else if (Array.isArray(data)) {
      types = (data as { name: string; subtask: boolean }[])
        .filter((t) => !t.subtask)
        .map((t) => t.name)
        .filter((v, i, a) => a.indexOf(v) === i)
    } else {
      types = ['Story', 'Task', 'Bug', 'Epic']
    }

    return NextResponse.json(types)
  } catch (e) {
    // Return safe defaults on error
    return NextResponse.json(['Story', 'Task', 'Bug', 'Epic'])
  }
}
