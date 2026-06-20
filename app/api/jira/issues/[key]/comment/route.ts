import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { postJiraComment } from '@/lib/jira/client'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key } = await params
  const { body } = await req.json()
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 })

  try {
    await postJiraComment(key, body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
