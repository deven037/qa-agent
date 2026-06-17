import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createJiraProject } from '@/lib/jira/client'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, key } = await req.json()
  if (!name || !key) return NextResponse.json({ error: 'name and key are required' }, { status: 400 })
  try {
    const project = await createJiraProject(name, key)
    return NextResponse.json(project)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
