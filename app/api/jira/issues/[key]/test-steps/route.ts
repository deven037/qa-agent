import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { buildTestStepAdf } from '@/lib/jira/client'

function getBaseUrl() { return process.env.JIRA_BASE_URL! }
function getAuthHeader() {
  return `Basic ${Buffer.from(`${process.env.JIRA_ADMIN_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key } = await params
  const { steps } = await req.json() // [{ step, expected }]

  const adf = buildTestStepAdf(steps)

  const res = await fetch(`${getBaseUrl()}/rest/api/3/issue/${key}`, {
    method: 'PUT',
    headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { description: adf } }),
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: res.status })
  }
  return NextResponse.json({ ok: true })
}
