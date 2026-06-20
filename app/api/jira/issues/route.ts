import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { searchJiraIssues, searchJiraSimilar, createJiraIssue } from '@/lib/jira/client'
import { generateWorkItemFields } from '@/lib/ai/gemini'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const project = searchParams.get('project') ?? ''
  const query = searchParams.get('q') ?? ''
  const mode = searchParams.get('mode') ?? 'search'
  const type = searchParams.get('type') ?? ''

  try {
    if (mode === 'similar') {
      const issues = await searchJiraSimilar(project, query)
      return NextResponse.json(issues)
    }
    const issues = await searchJiraIssues(project, query, type || undefined)
    return NextResponse.json(issues)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { project, prompt, issueType, fields } = await req.json()

  try {
    // If fields are already provided (user confirmed preview), create directly
    if (fields) {
      const issue = await createJiraIssue(project, fields)
      return NextResponse.json(issue)
    }

    // Otherwise generate fields from prompt using AI
    const generated = await generateWorkItemFields(prompt, issueType)
    return NextResponse.json({ generated })
  } catch (e) {
    console.error('[POST /api/jira/issues] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
