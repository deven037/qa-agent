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

async function getProjectId(projectKey: string): Promise<string> {
  const res = await fetch(`${getBaseUrl()}/rest/api/3/project/${projectKey}`,
    { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } }
  )
  if (!res.ok) throw new Error(`Could not fetch project ${projectKey}: ${res.status}`)
  const data = await res.json()
  return String(data.id)
}

export async function syncIssueTypes(targetProjectKey: string, sourceProjectKey: string): Promise<{ added: string[]; skipped: string[]; debug: Record<string, unknown> }> {
  const headers = { Authorization: getAuthHeader(), 'Content-Type': 'application/json', Accept: 'application/json' }
  const base = getBaseUrl()

  const [srcRes, tgtRes] = await Promise.all([
    fetch(`${base}/rest/api/3/project/${sourceProjectKey}`, { headers }).then(r => r.json()),
    fetch(`${base}/rest/api/3/project/${targetProjectKey}`, { headers }).then(r => r.json()),
  ])

  const srcTypes: { name: string; id: string }[] = srcRes.issueTypes ?? []
  const tgtTypes: { name: string; id: string }[] = tgtRes.issueTypes ?? []
  const tgtNames = new Set(tgtTypes.map((t) => t.name.toLowerCase()))
  const targetProjectId = String(tgtRes.id)

  const missing = srcTypes.filter((t) => !tgtNames.has(t.name.toLowerCase()))
  const added: string[] = []
  const skipped: string[] = []
  const debugLog: Record<string, unknown> = { targetProjectId, missing: missing.map(t => t.name) }

  // Get the issue type scheme for the target project
  const schemeRes = await fetch(`${base}/rest/api/3/issuetypescheme/project?projectId=${targetProjectId}`, { headers })
  const schemeData = await schemeRes.json()
  const schemeId = schemeData?.values?.[0]?.issueTypeScheme?.id
  debugLog.schemeId = schemeId ?? null
  debugLog.schemeData = schemeData

  // Fetch all issue types — global + project-scoped for the target
  const [allTypesRes, projTypesRes] = await Promise.all([
    fetch(`${base}/rest/api/3/issuetype`, { headers }),
    fetch(`${base}/rest/api/3/issuetype/project?projectId=${targetProjectId}`, { headers }),
  ])
  const allTypes: { id: string; name: string; scope?: { type: string } }[] = allTypesRes.ok ? await allTypesRes.json() : []
  const projTypes: { id: string; name: string }[] = projTypesRes.ok ? await projTypesRes.json() : []

  // Map name → id: project-scoped types for target take priority over global
  const projByName = new Map(projTypes.map((t) => [t.name.toLowerCase(), t.id]))
  const globalByName = new Map(
    allTypes.filter(t => !t.scope || t.scope.type === 'GLOBAL').map((t) => [t.name.toLowerCase(), t.id])
  )
  debugLog.projTypes = projTypes.map(t => ({ name: t.name, id: t.id }))

  for (const issueType of missing) {
    const name = issueType.name.toLowerCase()

    // Step 1: a project-scoped version already exists in target (previous attempt) — assign to scheme
    const existingProjId = projByName.get(name)
    if (existingProjId && schemeId) {
      const r = await fetch(`${base}/rest/api/3/issuetypescheme/${schemeId}/issuetype`, {
        method: 'PUT', headers,
        body: JSON.stringify({ issueTypeIds: [existingProjId] }),
      })
      if (r.ok) { added.push(issueType.name); continue }
      debugLog[`${issueType.name}_existingProjAssign`] = await r.text()
    }

    // Step 2: assign the global version to the scheme
    const globalId = globalByName.get(name)
    if (globalId && schemeId) {
      const r = await fetch(`${base}/rest/api/3/issuetypescheme/${schemeId}/issuetype`, {
        method: 'PUT', headers,
        body: JSON.stringify({ issueTypeIds: [globalId] }),
      })
      if (r.ok) { added.push(issueType.name); continue }
      debugLog[`${issueType.name}_globalAssign`] = await r.text()
    }

    // Step 3: create a new project-scoped issue type then assign to scheme
    const r2 = await fetch(`${base}/rest/api/3/issuetype`, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: issueType.name,
        type: 'standard',
        scope: { type: 'PROJECT', project: { id: targetProjectId } },
      }),
    })
    if (r2.ok) {
      const created: { id: string } = await r2.json()
      if (schemeId) {
        await fetch(`${base}/rest/api/3/issuetypescheme/${schemeId}/issuetype`, {
          method: 'PUT', headers,
          body: JSON.stringify({ issueTypeIds: [created.id] }),
        })
      }
      added.push(issueType.name)
      continue
    }
    debugLog[`${issueType.name}_createErr`] = await r2.text()
    debugLog[`${issueType.name}_globalId`] = globalId ?? null
    debugLog[`${issueType.name}_existingProjId`] = existingProjId ?? null
    skipped.push(issueType.name)
  }

  return { added, skipped, debug: debugLog }
}

export async function cloneJiraProjectSchemes(targetProjectKey: string, sourceProjectKey: string): Promise<void> {
  const [sourceProjectId, targetProjectId] = await Promise.all([
    getProjectId(sourceProjectKey),
    getProjectId(targetProjectKey),
  ])

  const headers = { Authorization: getAuthHeader(), 'Content-Type': 'application/json', Accept: 'application/json' }
  const base = getBaseUrl()
  const errors: string[] = []

  // Fetch each scheme for the source project via dedicated endpoints
  const [issueTypeSchemeRes, workflowSchemeRes, screenSchemeRes, fieldSchemeRes] = await Promise.all([
    fetch(`${base}/rest/api/3/issuetypescheme/project?projectId=${sourceProjectId}`, { headers }),
    fetch(`${base}/rest/api/3/workflowscheme/project?projectId=${sourceProjectId}`, { headers }),
    fetch(`${base}/rest/api/3/issuetypescreenscheme/project?projectId=${sourceProjectId}`, { headers }),
    fetch(`${base}/rest/api/3/fieldconfigurationscheme/project?projectId=${sourceProjectId}`, { headers }),
  ])

  const [issueTypeSchemeData, workflowSchemeData, screenSchemeData, fieldSchemeData] = await Promise.all([
    issueTypeSchemeRes.json(),
    workflowSchemeRes.json(),
    screenSchemeRes.json(),
    fieldSchemeRes.json(),
  ])

  const issueTypeSchemeId = issueTypeSchemeData?.values?.[0]?.issueTypeScheme?.id
  const workflowSchemeId  = workflowSchemeData?.values?.[0]?.workflowScheme?.id
  const screenSchemeId    = screenSchemeData?.values?.[0]?.issueTypeScreenScheme?.id
  const fieldSchemeId     = fieldSchemeData?.values?.[0]?.fieldConfigurationScheme?.id

  // Apply each scheme to the target project
  if (issueTypeSchemeId) {
    const r = await fetch(`${base}/rest/api/3/issuetypescheme/project`, {
      method: 'PUT', headers,
      body: JSON.stringify({ issueTypeSchemeId, projectId: targetProjectId }),
    })
    if (!r.ok) errors.push(`issueTypeScheme: ${await r.text()}`)
  }

  if (workflowSchemeId) {
    const r = await fetch(`${base}/rest/api/3/workflowscheme/project`, {
      method: 'PUT', headers,
      body: JSON.stringify({ workflowSchemeId, projectId: targetProjectId }),
    })
    if (!r.ok) errors.push(`workflowScheme: ${await r.text()}`)
  }

  if (screenSchemeId) {
    const r = await fetch(`${base}/rest/api/3/issuetypescreenscheme/project`, {
      method: 'PUT', headers,
      body: JSON.stringify({ issueTypeScreenSchemeId: screenSchemeId, projectId: targetProjectId }),
    })
    if (!r.ok) errors.push(`screenScheme: ${await r.text()}`)
  }

  if (fieldSchemeId) {
    const r = await fetch(`${base}/rest/api/3/fieldconfigurationscheme/project`, {
      method: 'PUT', headers,
      body: JSON.stringify({ fieldConfigurationSchemeId: fieldSchemeId, projectId: targetProjectId }),
    })
    if (!r.ok) errors.push(`fieldScheme: ${await r.text()}`)
  }

  if (!issueTypeSchemeId && !workflowSchemeId && !screenSchemeId) {
    throw new Error('No schemes found on source project — it may be using default/global schemes that cannot be cloned')
  }

  if (errors.length > 0) throw new Error(errors.join(' | '))
}

export async function getJiraProjectSchemes(projectKey: string): Promise<Record<string, string>> {
  const fields = ['issueTypeScheme', 'workflowScheme', 'issueTypeScreenScheme', 'fieldConfigurationScheme', 'notificationScheme', 'permissionScheme']
  const url = `${getBaseUrl()}/rest/api/3/project/${projectKey}?expand=${fields.join(',')}`
  const res = await fetch(url, { headers: { Authorization: getAuthHeader(), Accept: 'application/json' } })
  if (!res.ok) return {}
  const data = await res.json()
  const schemes: Record<string, string> = {}
  for (const field of fields) {
    const val = data[field]
    if (val?.id) schemes[field] = String(val.id)
  }
  return schemes
}

export async function getJiraMyselfAccountId(): Promise<string> {
  const res = await fetch(`${getBaseUrl()}/rest/api/3/myself`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Failed to get Jira user: ${res.status}`)
  const data = await res.json()
  return data.accountId as string
}

// Adds standard fields (Reporter, Assignee, Priority) to every screen in a project
export async function addStandardFieldsToProjectScreens(projectKey: string): Promise<void> {
  const headers = { Authorization: getAuthHeader(), 'Content-Type': 'application/json', Accept: 'application/json' }
  const base = getBaseUrl()

  // Standard field IDs we want on every screen
  const STANDARD_FIELDS = ['reporter', 'assignee', 'priority', 'description', 'labels']

  // Get project ID
  const projRes = await fetch(`${base}/rest/api/3/project/${projectKey}`, { headers })
  if (!projRes.ok) return
  const proj = await projRes.json()
  const projectId = String(proj.id)

  // Get the issue type screen scheme for this project → screen scheme → screens
  const isssRes = await fetch(`${base}/rest/api/3/issuetypescreenscheme/project?projectId=${projectId}`, { headers })
  const isssData = await isssRes.json()
  const isssId = isssData?.values?.[0]?.issueTypeScreenScheme?.id
  if (!isssId) return

  // Get mappings from that scheme → screen scheme IDs
  const mappingsRes = await fetch(`${base}/rest/api/3/issuetypescreenscheme/${isssId}/mapping`, { headers })
  const mappingsData = await mappingsRes.json()
  const screenSchemeIds = new Set<string>(
    (mappingsData?.values ?? []).map((m: { screenSchemeId: string }) => m.screenSchemeId)
  )

  // For each screen scheme, get the screen IDs
  const screenIds = new Set<string>()
  await Promise.all(Array.from(screenSchemeIds).map(async (ssId) => {
    const ssRes = await fetch(`${base}/rest/api/3/screenscheme/${ssId}`, { headers })
    if (!ssRes.ok) return
    const ss = await ssRes.json()
    const screens = ss.screens ?? {}
    Object.values(screens).forEach((id) => screenIds.add(String(id)))
  }))

  // For each screen, get tab 0 and add missing fields
  await Promise.all(Array.from(screenIds).map(async (screenId) => {
    const tabsRes = await fetch(`${base}/rest/api/3/screens/${screenId}/tabs`, { headers })
    if (!tabsRes.ok) return
    const tabs: { id: string }[] = await tabsRes.json()
    const tabId = tabs[0]?.id
    if (!tabId) return

    // Get existing fields on this tab
    const fieldsRes = await fetch(`${base}/rest/api/3/screens/${screenId}/tabs/${tabId}/fields`, { headers })
    const existing: { id: string }[] = fieldsRes.ok ? await fieldsRes.json() : []
    const existingIds = new Set(existing.map((f) => f.id))

    // Add each missing standard field
    await Promise.all(
      STANDARD_FIELDS
        .filter((fid) => !existingIds.has(fid))
        .map((fid) =>
          fetch(`${base}/rest/api/3/screens/${screenId}/tabs/${tabId}/fields`, {
            method: 'POST', headers,
            body: JSON.stringify({ fieldId: fid }),
          })
        )
    )
  }))
}

export async function createJiraProject(name: string, key: string, sourceProjectKey?: string): Promise<JiraProject> {
  const [leadAccountId, sourceSchemes] = await Promise.all([
    getJiraMyselfAccountId(),
    sourceProjectKey ? getJiraProjectSchemes(sourceProjectKey) : Promise.resolve({}),
  ])

  const body: Record<string, unknown> = {
    name,
    key: key.toUpperCase(),
    projectTypeKey: 'software',
    // Kanban classic — company-managed, no backlog, issues go straight to board columns
    projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
    leadAccountId,
    assigneeType: 'UNASSIGNED',
  }

  if (Object.keys(sourceSchemes).length > 0) {
    // Clone schemes from source project — preserves issue types, workflows, board config
    for (const [schemeField, schemeId] of Object.entries(sourceSchemes)) {
      body[schemeField] = { id: schemeId }
    }
  }

  const res = await fetch(`${getBaseUrl()}/rest/api/3/project`, {
    method: 'POST',
    headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to create project: ${err}`)
  }
  const data = await res.json()
  // Add Reporter, Assignee, Priority etc. to every screen in the new project
  await addStandardFieldsToProjectScreens(data.key).catch(() => {})
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

async function getActiveSprintId(projectKey: string): Promise<string | null> {
  const base = getBaseUrl()
  const headers = { Authorization: getAuthHeader(), Accept: 'application/json' }
  // Find the board for this project
  const boardRes = await fetch(`${base}/rest/agile/1.0/board?projectKeyOrId=${projectKey}&type=scrum`, { headers })
  if (!boardRes.ok) return null
  const boardData = await boardRes.json()
  const boardId = boardData?.values?.[0]?.id
  if (!boardId) return null
  // Get the active sprint on that board
  const sprintRes = await fetch(`${base}/rest/agile/1.0/board/${boardId}/sprint?state=active`, { headers })
  if (!sprintRes.ok) return null
  const sprintData = await sprintRes.json()
  return sprintData?.values?.[0]?.id ? String(sprintData.values[0].id) : null
}

export async function createJiraIssue(projectKey: string, fields: JiraIssueFields): Promise<{ key: string; summary: string }> {
  const buildAdf = (text: string) => ({
    type: 'doc',
    version: 1,
    content: text.split('\n').filter(Boolean).map((line) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    })),
  })

  // Try to get active sprint so issues land on the board, not the backlog
  const activeSprintId = await getActiveSprintId(projectKey).catch(() => null)

  const adf = buildAdf(fields.description ?? '')
  const body: Record<string, unknown> = {
    fields: {
      project: { key: projectKey },
      summary: fields.summary,
      ...(adf.content.length > 0 ? { description: adf } : {}),
      issuetype: { name: ISSUE_TYPE_MAP[fields.issueType] ?? fields.issueType },
      ...(activeSprintId ? { sprint: { id: Number(activeSprintId) } } : {}),
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

const SCRIPT_MARKER = '[PLAYWRIGHT_SCRIPT]'

export function extractPlaywrightScript(comments: JiraComment[]): string | null {
  const comment = comments.find(c => c.body.includes(SCRIPT_MARKER))
  if (!comment) return null
  const after = comment.body.slice(comment.body.indexOf(SCRIPT_MARKER) + SCRIPT_MARKER.length).trim()
  // Strip code fences if present
  return after.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim() || null
}

export async function savePlaywrightScript(issueKey: string, script: string, comments: JiraComment[]): Promise<void> {
  const body = `${SCRIPT_MARKER}\n\`\`\`typescript\n${script}\n\`\`\``
  // Update existing script comment if one already exists
  const existing = comments.find(c => c.body.includes(SCRIPT_MARKER))
  if (existing) {
    await fetch(`${getBaseUrl()}/rest/api/3/issue/${issueKey}/comment/${existing.id}`, {
      method: 'PUT',
      headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: {
          type: 'doc', version: 1,
          content: [{ type: 'codeBlock', attrs: { language: 'typescript' }, content: [{ type: 'text', text: `${SCRIPT_MARKER}\n${script}` }] }],
        },
      }),
    })
  } else {
    await fetch(`${getBaseUrl()}/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: {
          type: 'doc', version: 1,
          content: [{ type: 'codeBlock', attrs: { language: 'typescript' }, content: [{ type: 'text', text: `${SCRIPT_MARKER}\n${script}` }] }],
        },
      }),
    })
  }
}
