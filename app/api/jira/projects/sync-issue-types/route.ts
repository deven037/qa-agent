import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { syncIssueTypes } from '@/lib/jira/client'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { targetProjectKey, sourceProjectKey } = await req.json()
  if (!targetProjectKey || !sourceProjectKey)
    return NextResponse.json({ error: 'targetProjectKey and sourceProjectKey are required' }, { status: 400 })
  try {
    const result = await syncIssueTypes(targetProjectKey, sourceProjectKey)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[sync-issue-types]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
