import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { buildTestStepAdf, TestStep } from '@/lib/jira/client'

function getBaseUrl() { return process.env.JIRA_BASE_URL! }
function getAuthHeader() {
  return `Basic ${Buffer.from(`${process.env.JIRA_ADMIN_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`
}

function parseQaTestCasesComment(body: string): TestStep[] {
  const raw = body.replace('[QA-TESTCASES]\n', '')
  const blocks = raw.split(/\n\s*---\s*\n/).map(b => b.trim()).filter(Boolean)
  return blocks.flatMap((block) => {
    const stepsMatch = block.match(/steps\s*:\s*\n([\s\S]+?)(?=\n\s*expected\s*:|$)/i)
    const expectedMatch = block.match(/expected\s*:\s*(.+)/i)
    const steps = stepsMatch
      ? stepsMatch[1].split('\n').map(s => s.trim()).filter(Boolean)
          .map(s => s.replace(/^(\d+[.)]\s*|[-*•]\s*)/, '').trim()).filter(Boolean)
      : []
    const expected = expectedMatch?.[1]?.trim() ?? ''
    return steps.map(step => ({ step, expected }))
  }).filter(s => s.step)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectKey } = await req.json()

  const results: { key: string; status: string; steps?: number }[] = []

  try {
    // Fetch all Test Case issues in the project
    const jql = `project = ${projectKey} AND issuetype = "Test Case" ORDER BY created DESC`
    const searchRes = await fetch(
      `${getBaseUrl()}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary`,
      { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } }
    )
    if (!searchRes.ok) return NextResponse.json({ error: 'Failed to search issues' }, { status: 500 })
    const searchData = await searchRes.json()
    const issues: { key: string }[] = searchData.issues ?? []

    for (const issue of issues) {
      // Fetch comments
      const commentsRes = await fetch(
        `${getBaseUrl()}/rest/api/3/issue/${issue.key}/comment`,
        { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } }
      )
      if (!commentsRes.ok) { results.push({ key: issue.key, status: 'error fetching comments' }); continue }
      const commentsData = await commentsRes.json()
      const tcComment = (commentsData.comments ?? []).find(
        (c: { body: unknown }) => {
          const text = typeof c.body === 'string'
            ? c.body
            : (c.body as { content?: { content?: { text?: string }[] }[] })?.content?.flatMap(p => p.content ?? []).map(n => n.text ?? '').join('') ?? ''
          return text.startsWith('[QA-TESTCASES]')
        }
      )

      if (!tcComment) { results.push({ key: issue.key, status: 'no QA-TESTCASES comment' }); continue }

      // Extract plain text from comment body (may be ADF or plain string)
      let commentText: string
      if (typeof tcComment.body === 'string') {
        commentText = tcComment.body
      } else {
        // ADF → plain text
        const extractText = (node: unknown): string => {
          if (!node || typeof node !== 'object') return ''
          const n = node as { type?: string; text?: string; content?: unknown[] }
          if (n.type === 'text') return n.text ?? ''
          return (n.content ?? []).map(extractText).join(n.type === 'paragraph' ? '\n' : '')
        }
        commentText = extractText(tcComment.body)
      }

      const steps = parseQaTestCasesComment(commentText)
      if (steps.length === 0) { results.push({ key: issue.key, status: 'parsed 0 steps' }); continue }

      // Save as ADF table to description
      const adf = buildTestStepAdf(steps)
      const putRes = await fetch(`${getBaseUrl()}/rest/api/3/issue/${issue.key}`, {
        method: 'PUT',
        headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { description: adf } }),
      })

      if (putRes.ok) {
        results.push({ key: issue.key, status: 'migrated', steps: steps.length })
      } else {
        const err = await putRes.text()
        results.push({ key: issue.key, status: `PUT failed: ${err.slice(0, 100)}` })
      }
    }

    return NextResponse.json({ migrated: results.filter(r => r.status === 'migrated').length, results })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
