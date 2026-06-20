import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { fetchJiraIssue } from '@/lib/jira/client'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key } = await params
  try {
    const issue = await fetchJiraIssue(key)
    return NextResponse.json(issue)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
