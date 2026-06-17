import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { listJiraProjects } from '@/lib/jira/client'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const projects = await listJiraProjects()
    return NextResponse.json(projects)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
