import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { addStandardFieldsToProjectScreens } from '@/lib/jira/client'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { projectKey } = await req.json()
  if (!projectKey) return NextResponse.json({ error: 'projectKey is required' }, { status: 400 })
  try {
    await addStandardFieldsToProjectScreens(projectKey)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
