import { readFileSync } from 'fs'

// Load .env.local
const env = readFileSync('.env.local', 'utf8')
for (const line of env.split('\n')) {
  const [k, ...v] = line.split('=')
  if (k && v.length) process.env[k.trim()] = v.join('=').trim()
}

const BASE = process.env.JIRA_BASE_URL
const AUTH = 'Basic ' + Buffer.from(`${process.env.JIRA_ADMIN_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')

function extractText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(extractText).join(node.type === 'paragraph' ? '\n' : '')
}

function parseSteps(text) {
  const raw = text.replace('[QA-TESTCASES]\n', '')
  const blocks = raw.split(/\n\s*---\s*\n/).map(b => b.trim()).filter(Boolean)
  return blocks.flatMap(block => {
    const stepsMatch = block.match(/steps\s*:\s*\n([\s\S]+?)(?=\n\s*expected\s*:|$)/i)
    const expectedMatch = block.match(/expected\s*:\s*(.+)/i)
    const steps = stepsMatch
      ? stepsMatch[1].split('\n').map(s => s.trim()).filter(Boolean).map(s => s.replace(/^(\d+[.)]\s*|[-*•]\s*)/, '').trim()).filter(Boolean)
      : []
    const expected = expectedMatch?.[1]?.trim() ?? ''
    return steps.map(step => ({ step, expected }))
  }).filter(s => s.step)
}

function buildTestStepAdf(steps) {
  function cell(text, isHeader = false) {
    return {
      type: isHeader ? 'tableHeader' : 'tableCell',
      attrs: {},
      content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
    }
  }
  return {
    type: 'doc',
    version: 1,
    content: [{
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: [
        { type: 'tableRow', content: [cell('#', true), cell('Test Step', true), cell('Expected Result', true)] },
        ...steps.map((s, i) => ({
          type: 'tableRow',
          content: [cell(String(i + 1)), cell(s.step), cell(s.expected)],
        })),
      ],
    }],
  }
}

async function run() {
  const jql = 'project = KAN AND issuetype = "Test Case" ORDER BY created DESC'
  const searchRes = await fetch(`${BASE}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary`, {
    headers: { Authorization: AUTH, Accept: 'application/json' }
  })
  const searchData = await searchRes.json()
  const issues = searchData.issues ?? []
  console.log(`Found ${issues.length} Test Case issues\n`)

  for (const issue of issues) {
    const commentsRes = await fetch(`${BASE}/rest/api/3/issue/${issue.key}/comment`, {
      headers: { Authorization: AUTH, Accept: 'application/json' }
    })
    const commentsData = await commentsRes.json()
    const tcComment = (commentsData.comments ?? []).find(c => extractText(c.body).startsWith('[QA-TESTCASES]'))

    if (!tcComment) {
      console.log(`${issue.key}  — no QA-TESTCASES comment, skipping`)
      continue
    }

    const text = extractText(tcComment.body)
    const steps = parseSteps(text)
    if (!steps.length) {
      console.log(`${issue.key}  — parsed 0 steps, skipping`)
      continue
    }

    const adf = buildTestStepAdf(steps)
    const putRes = await fetch(`${BASE}/rest/api/3/issue/${issue.key}`, {
      method: 'PUT',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { description: adf } }),
    })

    if (putRes.ok) {
      console.log(`${issue.key}  ✓ migrated (${steps.length} steps)`)
    } else {
      const err = await putRes.text()
      console.log(`${issue.key}  ✗ failed: ${err.slice(0, 120)}`)
    }
  }
  console.log('\nDone.')
}

run().catch(console.error)
