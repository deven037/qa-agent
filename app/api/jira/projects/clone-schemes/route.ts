import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { cloneJiraProjectSchemes } from '@/lib/jira/client'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { targetProjectKey, sourceProjectKey } = await req.json()
  if (!targetProjectKey || !sourceProjectKey)
    return NextResponse.json({ error: 'targetProjectKey and sourceProjectKey are required' }, { status: 400 })
  try {
    await cloneJiraProjectSchemes(targetProjectKey, sourceProjectKey)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
