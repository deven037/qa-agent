export interface JiraChild {
  key: string
  summary: string
  issueType: string
  status: string
}

export interface TestStep {
  step: string
  expected: string
}

export interface JiraIssue {
  key: string
  summary: string
  issueType: string
  status: string
  priority: string
  reporter: string
  assignee: string
  assigneeAvatar: string
  reporterAvatar: string
  created: string
  description: string
  acceptanceCriteria: string
  comments: JiraComment[]
  children: JiraChild[]
  parentKey?: string
  parentSummary?: string
  testSteps?: TestStep[]
}

export interface JiraComment {
  id: string
  body: string
  author: string
}

export interface JiraProject {
  key: string
  name: string
  id: string
}

function getBaseUrl() {
  const url = process.env.JIRA_BASE_URL
  if (!url) throw new Error('JIRA_BASE_URL is not set in environment')
  return url
}

function getAuthHeader() {
  const email = process.env.JIRA_ADMIN_EMAIL
  const token = process.env.JIRA_API_TOKEN
  if (!email || !token) throw new Error('JIRA_ADMIN_EMAIL or JIRA_API_TOKEN is not set')
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
}

// ── ADF test-step table helpers ───────────────────────────────────────────────

export function buildTestStepAdf(steps: TestStep[]): object {
  function cell(text: string, isHeader = false) {
    return {
      type: isHeader ? 'tableHeader' : 'tableCell',
      attrs: {},
      content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
    }
  }
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'table',
        attrs: { isNumberColumnEnabled: false, layout: 'default' },
        content: [
          {
            type: 'tableRow',
            content: [cell('#', true), cell('Test Step', true), cell('Expected Result', true)],
          },
          ...steps.map((s, i) => ({
            type: 'tableRow',
            content: [cell(String(i + 1)), cell(s.step), cell(s.expected)],
          })),
        ],
      },
    ],
  }
}

function parseTestStepsFromAdf(adf: unknown): TestStep[] | null {
  if (!adf || typeof adf !== 'object') return null
  const doc = adf as { content?: unknown[] }
  const table = doc.content?.find((n: unknown) => (n as { type?: string }).type === 'table') as { content?: unknown[] } | undefined
  if (!table) return null

  const rows = (table.content ?? []) as { type: string; content: unknown[] }[]
  const dataRows = rows.filter((r) => r.type === 'tableRow').slice(1) // skip header
  if (dataRows.length === 0) return null

  return dataRows.map((row) => {
    const cells = (row.content ?? []) as { content: unknown[] }[]
    const getText = (cell: { content: unknown[] }) => {
      const para = (cell.content ?? []) as { content?: unknown[] }[]
      return para.flatMap((p) => (p.content ?? []) as { type?: string; text?: string }[])
        .filter((n) => n.type === 'text')
        .map((n) => n.text ?? '')
        .join('')
    }
    return {
      step: getText(cells[1] ?? { content: [] }),
      expected: getText(cells[2] ?? { content: [] }),
    }
  }).filter(s => s.step || s.expected)
}

function adfToText(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return String(adf ?? '')
  const node = adf as { type?: string; text?: string; content?: unknown[] }
  if (node.type === 'text') return node.text ?? ''
  if (Array.isArray(node.content)) {
    return node.content.map(adfToText).join(node.type === 'paragraph' ? '\n' : '')
  }
  return ''
}

export async function getJiraAccountId(email: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${getBaseUrl()}/rest/api/3/users/search?query=${encodeURIComponent(email)}&maxResults=10`,
      { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } }
    )
    if (!res.ok) return null
    const users = await res.json()
    const match = Array.isArray(users)
      ? users.find((u: { emailAddress?: string; accountType?: string }) =>
          u.emailAddress?.toLowerCase() === email.toLowerCase() && u.accountType === 'atlassian'
        )
      : null
    return match?.accountId ?? null
  } catch {
    return null
  }
}

export async function verifyJiraUser(email: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${getBaseUrl()}/rest/api/3/users/search?query=${encodeURIComponent(email)}&maxResults=10`,
      { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } }
    )
    if (!res.ok) return false
    const users = await res.json()
    return Array.isArray(users) && users.some(
      (u: { emailAddress?: string }) =>
        u.emailAddress?.toLowerCase() === email.toLowerCase()
    )
  } catch {
    return false
  }
}

export async function fetchJiraIssue(issueKey: string): Promise<JiraIssue> {
  const res = await fetch(`${getBaseUrl()}/rest/api/3/issue/${issueKey}?expand=renderedFields`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Jira fetch failed: ${res.status}`)
  const data = await res.json()

  const rawDesc = data.fields.description
  const testSteps = parseTestStepsFromAdf(rawDesc) ?? undefined
  const description = adfToText(rawDesc)

  const commentsRes = await fetch(`${getBaseUrl()}/rest/api/3/issue/${issueKey}/comment`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/json' },
  })
  const commentsData = await commentsRes.json()
  const comments: JiraComment[] = (commentsData.comments ?? []).map(
    (c: { id: string; body: unknown; author?: { displayName?: string } }) => ({
      id: c.id,
      body: adfToText(c.body),
      author: c.author?.displayName ?? 'Unknown',
    })
  )

  const acField = data.fields['customfield_10016'] ?? data.fields['acceptance_criteria'] ?? ''
  const acceptanceCriteria = typeof acField === 'string' ? acField : adfToText(acField)

  // Fetch child issues (stories under epic, test cases under story, etc.)
  const childRes = await fetch(
    `${getBaseUrl()}/rest/api/3/search/jql?jql=parent=${issueKey}&fields=summary,issuetype,status&maxResults=20`,
    { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } }
  )
  const childData = await childRes.json()
  const children: JiraChild[] = (childData.issues ?? []).map(
    (c: { key: string; fields: { summary: string; issuetype?: { name: string }; status?: { name: string } } }) => ({
      key: c.key,
      summary: c.fields.summary ?? '',
      issueType: c.fields.issuetype?.name ?? '',
      status: c.fields.status?.name ?? '',
    })
  )

  const parentField = data.fields.parent
  return {
    key: issueKey,
    summary: data.fields.summary ?? '',
    issueType: data.fields.issuetype?.name ?? '',
    status: data.fields.status?.name ?? '',
    priority: data.fields.priority?.name ?? '',
    reporter: data.fields.reporter?.displayName ?? '',
    created: data.fields.created ?? '',
    description,
    acceptanceCriteria,
    comments,
    children,
    assignee: data.fields.assignee?.displayName ?? '',
    assigneeAvatar: data.fields.assignee?.avatarUrls?.['24x24'] ?? '',
    reporterAvatar: data.fields.reporter?.avatarUrls?.['24x24'] ?? '',
    parentKey: parentField?.key,
    parentSummary: parentField?.fields?.summary,
    testSteps,
  }
}

export async function postJiraComment(issueKey: string, body: string): Promise<void> {
  await fetch(`${getBaseUrl()}/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
      },
    }),
  })
}

export async function attachFileToJiraIssue(issueKey: string, filename: string, content: string): Promise<void> {
  const formData = new FormData()
  formData.append('file', new Blob([content], { type: 'text/plain' }), filename)
  await fetch(`${getBaseUrl()}/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: { Authorization: getAuthHeader(), 'X-Atlassian-Token': 'no-check' },
    body: formData,
  })
}

export async function listJiraProjects(): Promise<JiraProject[]> {
  const res = await fetch(`${getBaseUrl()}/rest/api/3/project/search?maxResults=50`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Failed to list projects: ${res.status}`)
  const data = await res.json()
  return (data.values ?? []).map((p: { key: string; name: string; id: string }) => ({
    key: p.key,
    name: p.name,
    id: p.id,
  }))
}

export async function createJiraProject(name: string, key: string): Promise<JiraProject> {
  const res = await fetch(`${getBaseUrl()}/rest/api/3/project`, {
    method: 'POST',
    headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      name,
      key: key.toUpperCase(),
      projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-scrum-classic',
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to create project: ${err}`)
  }
  const data = await res.json()
  return { key: data.key, name: data.name, id: String(data.id) }
}

export interface JiraIssueFields {
  summary: string
  description: string
  issueType: string
  parentKey?: string
  assigneeAccountId?: string
  reporterAccountId?: string
  acceptanceCriteria?: string
  stepsToReproduce?: string
  expectedResult?: string
  actualResult?: string
  testSteps?: { action: string; expectedResult: string }[]
  preconditions?: string
  priority?: string
}

// Pass the type name through as-is — valid types come from /api/jira/issue-types
const ISSUE_TYPE_MAP: Record<string, string> = {}

export async function createJiraIssue(projectKey: string, fields: JiraIssueFields): Promise<{ key: string; summary: string }> {
  const buildAdf = (text: string) => ({
    type: 'doc',
    version: 1,
    content: text.split('\n').filter(Boolean).map((line) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    })),
  })

  const body: Record<string, unknown> = {
    fields: {
      project: { key: projectKey },
      summary: fields.summary,
      description: buildAdf(fields.description),
      issuetype: { name: ISSUE_TYPE_MAP[fields.issueType] ?? fields.issueType },
      ...(fields.parentKey ? { parent: { key: fields.parentKey } } : {}),
      ...(fields.assigneeAccountId ? { assignee: { accountId: fields.assigneeAccountId } } : {}),
      ...(fields.reporterAccountId ? { reporter: { accountId: fields.reporterAccountId } } : {}),
    },
  }

  const res = await fetch(`${getBaseUrl()}/rest/api/3/issue`, {
    method: 'POST',
    headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to create Jira issue: ${err}`)
  }
  const data = await res.json()
  return { key: data.key, summary: fields.summary }
}

export async function searchJiraSimilar(projectKey: string, prompt: string): Promise<{ key: string; summary: string; description?: string }[]> {
  const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'will', 'they', 'when', 'what', 'your', 'been', 'were', 'also', 'into', 'than', 'then', 'some', 'more'])
  const keywords = prompt
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w.toLowerCase()))
    .slice(0, 6)

  if (keywords.length === 0) return []

  // Search each keyword independently with OR so partial matches surface
  const summaryConditions = keywords.map((k) => `summary ~ "${k}"`).join(' OR ')
  const jql = `project = ${projectKey} AND (${summaryConditions}) ORDER BY created DESC`
  const res = await fetch(
    `${getBaseUrl()}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=5&fields=summary,description`,
    { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } }
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data.issues ?? []).map((i: { key: string; fields: { summary: string; description: unknown } }) => ({
    key: i.key,
    summary: i.fields.summary,
    description: adfToText(i.fields.description),
  }))
}

export async function searchJiraIssues(projectKey: string, query: string, issueType?: string): Promise<{ key: string; summary: string }[]> {
  const conditions = [`project = ${projectKey}`]
  if (query) {
    const isKey = /^[A-Z]+-\d+$/i.test(query.trim())
    if (isKey) {
      conditions.push(`key = "${query.trim().toUpperCase()}"`)
    } else {
      // Use text ~ for full-text search (covers summary, description, comments)
      // Also try summary ~ for partial word matches
      conditions.push(`(summary ~ "${query}*" OR text ~ "${query}")`)
    }
  }
  if (issueType) conditions.push(`issuetype = "${issueType}"`)
  const jql = `${conditions.join(' AND ')} ORDER BY created DESC`
  const res = await fetch(
    `${getBaseUrl()}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=20&fields=summary`,
    { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } }
  )
  if (!res.ok) throw new Error(`Jira search failed: ${res.status}`)
  const data = await res.json()
  return (data.issues ?? []).map((i: { key: string; fields: { summary: string } }) => ({
    key: i.key,
    summary: i.fields.summary,
  }))
}

export function findExistingScenarios(comments: JiraComment[]): string | null {
  const match = comments.find((c) => c.body.startsWith('[QA-SCENARIOS]'))
  return match ? match.body.replace('[QA-SCENARIOS]\n', '') : null
}

export function findExistingTestCases(comments: JiraComment[]): string | null {
  const match = comments.find((c) => c.body.startsWith('[QA-TESTCASES]'))
  return match ? match.body.replace('[QA-TESTCASES]\n', '') : null
}

/**
 * Parses [QA-TESTCASES] markdown into TestCase objects.
 * Tolerant of manual edits: extra blank lines, lowercase headers,
 * bullet/dash/numbered steps, missing sections.
 */
export function parseTestCasesFromMarkdown(markdown: string): import('@/lib/agents/testcase-agent').TestCase[] {
  // Split on --- separator (with flexible surrounding whitespace)
  const blocks = markdown.split(/\n\s*---\s*\n/)
  return blocks
    .map((block, idx) => {
      block = block.trim()
      if (!block) return null

      // Title: **TC-001: Some Title** (type | priority)
      const titleMatch = block.match(/\*\*(.+?)\*\*/)
      const typeMatch = block.match(/\((positive|negative|edge)/i)
      const priorityMatch = block.match(/(high|medium|low)\s+priority/i)

      const fullTitle = titleMatch?.[1]?.trim() ?? `TC-${String(idx + 1).padStart(3, '0')}: Test Case`
      const idMatch = fullTitle.match(/^(TC-\d+)[:\s]+(.+)$/)

      // Steps: find the section between "Steps:" and "Expected:" (or end of block)
      // Case-insensitive, tolerant of extra blank lines around the header
      const stepsMatch = block.match(/steps\s*:\s*\n([\s\S]+?)(?=\n\s*expected\s*:|$)/i)
      const steps = stepsMatch
        ? stepsMatch[1]
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            // Strip leading numbering (1. 2.) or bullets (- * •)
            .map((s) => s.replace(/^(\d+[.)]\s*|[-*•]\s*)/, ''))
            .filter(Boolean)
        : []

      // Expected: grab everything after "Expected:" to end of block
      const expectedMatch = block.match(/expected\s*:\s*(.+)/i)
      const expectedResult = expectedMatch?.[1]?.trim() ?? ''

      return {
        id: idMatch?.[1] ?? `TC-${String(idx + 1).padStart(3, '0')}`,
        title: idMatch?.[2]?.trim() ?? fullTitle,
        type: ((typeMatch?.[1]?.toLowerCase()) as import('@/lib/agents/testcase-agent').TestCase['type']) ?? 'positive',
        priority: ((priorityMatch?.[1]?.toLowerCase()) as import('@/lib/agents/testcase-agent').TestCase['priority']) ?? 'medium',
        steps,
        expectedResult,
      }
    })
    .filter((tc): tc is NonNullable<typeof tc> => tc !== null && tc.steps.length > 0)
}

export async function fetchAutomationScript(issueKey: string): Promise<string | null> {
  const res = await fetch(
    `${getBaseUrl()}/rest/api/3/issue/${issueKey}?fields=attachment`,
    { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } }
  )
  if (!res.ok) return null
  const data = await res.json()
  const attachments: { filename: string; content: string }[] = data.fields?.attachment ?? []
  const spec = attachments.find((a) => a.filename === `${issueKey}.spec.ts`)
  if (!spec) return null
  const contentRes = await fetch(spec.content, {
    headers: { Authorization: getAuthHeader() },
  })
  if (!contentRes.ok) return null
  return contentRes.text()
}
