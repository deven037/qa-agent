'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { AppConfig } from '@/lib/config/store'
import AgentCard from './AgentCard'
import ResultsPanel from '../results/ResultsPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentName = 'requirement' | 'scenario' | 'testcase' | 'exploration' | 'automation' | 'review' | 'execution'
type AgentStatus = 'pending' | 'running' | 'done' | 'error'
type UIStep = 'prompt' | 'similar' | 'type-select' | 'preview' | 'pipeline'

interface AgentState { status: AgentStatus; output: string }
interface SimilarIssue { key: string; summary: string; description?: string }
interface WorkItemFields {
  summary: string
  description: string
  issueType: string
  acceptanceCriteria?: string
  stepsToReproduce?: string
  expectedResult?: string
  actualResult?: string
  preconditions?: string
  testSteps?: { action: string; expectedResult: string }[]
  priority?: string
}

const ISSUE_TYPES = ['Story', 'Bug', 'Task', 'Test Case', 'Epic']
const AGENT_ORDER: AgentName[] = ['requirement', 'scenario', 'testcase', 'exploration', 'automation', 'review', 'execution']
const AGENT_LABELS: Record<AgentName, string> = {
  requirement: 'Requirement Analysis',
  scenario: 'Scenario Check',
  testcase: 'Test Case Generation',
  exploration: 'App Exploration',
  automation: 'Automation Generation',
  review: 'Code Review',
  execution: 'Test Execution',
}

function initialAgents(): Record<AgentName, AgentState> {
  return Object.fromEntries(AGENT_ORDER.map((a) => [a, { status: 'pending', output: '' }])) as Record<AgentName, AgentState>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function IssueRunner({ app }: { app: AppConfig }) {
  const [uiStep, setUiStep] = useState<UIStep>('prompt')
  const [prompt, setPrompt] = useState('')
  const [searching, setSearching] = useState(false)
  const [similarIssues, setSimilarIssues] = useState<SimilarIssue[]>([])
  const [selectedIssueKey, setSelectedIssueKey] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [generatingFields, setGeneratingFields] = useState(false)
  const [workItemFields, setWorkItemFields] = useState<WorkItemFields | null>(null)
  const [creatingIssue, setCreatingIssue] = useState(false)
  const [agents, setAgents] = useState<Record<AgentName, AgentState>>(initialAgents())
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [executionResult, setExecutionResult] = useState<Record<string, unknown> | null>(null)
  const [testCases, setTestCases] = useState<unknown[]>([])
  const [error, setError] = useState('')

  // ── Step 1: check for similar issues ──────────────────────────────────────
  async function handlePromptSubmit() {
    if (!prompt.trim()) return
    setSearching(true)
    setError('')
    try {
      const res = await fetch(
        `/api/jira/issues?project=${app.jiraProjectKey}&q=${encodeURIComponent(prompt)}&mode=similar`
      )
      const data = await res.json()
      setSimilarIssues(data)
      setUiStep('similar')
    } catch {
      setError('Failed to search Jira. Check connection.')
    }
    setSearching(false)
  }

  // ── Step 2a: use an existing issue ────────────────────────────────────────
  function useExistingIssue(key: string) {
    setSelectedIssueKey(key)
    setUiStep('pipeline')
    runPipeline(key)
  }

  // ── Step 2b: create new — select type ─────────────────────────────────────
  async function handleTypeSelected(type: string) {
    setSelectedType(type)
    setGeneratingFields(true)
    setUiStep('preview')
    setError('')
    try {
      const res = await fetch('/api/jira/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: app.jiraProjectKey, prompt, issueType: type }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (!data.generated) throw new Error('No fields returned from AI')
      setWorkItemFields(data.generated)
    } catch (e) {
      setError(`Failed to generate fields: ${String(e)}`)
    }
    setGeneratingFields(false)
  }

  // ── Step 3: confirm & create in Jira ──────────────────────────────────────
  async function handleCreateAndRun() {
    if (!workItemFields) return
    setCreatingIssue(true)
    setError('')
    try {
      const res = await fetch('/api/jira/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: app.jiraProjectKey, fields: workItemFields }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSelectedIssueKey(data.key)
      setUiStep('pipeline')
      runPipeline(data.key)
    } catch (e) {
      setError(String(e))
    }
    setCreatingIssue(false)
  }

  // ── Pipeline runner ────────────────────────────────────────────────────────
  async function runPipeline(issueKey: string) {
    setRunning(true)
    setDone(false)
    setAgents(initialAgents())
    setExecutionResult(null)
    setTestCases([])

    const res = await fetch('/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueKey, appId: app.id, issueType: selectedType || undefined }),
    })

    const reader = res.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done: streamDone, value } = await reader.read()
      if (streamDone) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          const { agent, type, data } = event
          if (agent === 'system' && type === 'done') { setDone(true); continue }
          if (agent === 'system' && type === 'error') { setError(`Pipeline error: ${data}`); setRunning(false); continue }
          const a = agent as AgentName
          if (!AGENT_ORDER.includes(a)) continue
          if (type === 'start') setAgents((p) => ({ ...p, [a]: { status: 'running', output: '' } }))
          else if (type === 'chunk' || type === 'info') setAgents((p) => ({ ...p, [a]: { ...p[a], output: p[a].output + data } }))
          else if (type === 'done') {
            setAgents((p) => ({ ...p, [a]: { ...p[a], status: 'done' } }))
            if (a === 'execution') { try { setExecutionResult(JSON.parse(data)) } catch { /* ignore */ } }
            if (a === 'testcase') { try { setTestCases(JSON.parse(data)) } catch { /* ignore */ } }
          } else if (type === 'error') setAgents((p) => ({ ...p, [a]: { ...p[a], status: 'error' } }))
        } catch { /* malformed SSE */ }
      }
    }
    setRunning(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Step: Prompt */}
      {uiStep === 'prompt' && (
        <Card>
          <CardHeader><CardTitle className="text-base">What do you want to test?</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
              rows={3}
              placeholder="e.g. User should be able to login with email and password and see their dashboard"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePromptSubmit() }}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button
              onClick={handlePromptSubmit}
              disabled={searching || !prompt.trim()}
              className="bg-violet-600 hover:bg-violet-700"
            >
              {searching ? 'Searching Jira...' : 'Continue →'}
            </Button>
            <p className="text-xs text-slate-400">Tip: Cmd+Enter to continue</p>
          </CardContent>
        </Card>
      )}

      {/* Step: Similar issues */}
      {uiStep === 'similar' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {similarIssues.length > 0 ? `Found ${similarIssues.length} similar issue${similarIssues.length > 1 ? 's' : ''}` : 'No similar issues found'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {similarIssues.length > 0 && (
              <>
                <p className="text-sm text-slate-500">Use an existing issue or create a new one.</p>
                <div className="space-y-2">
                  {similarIssues.map((issue) => (
                    <div key={issue.key} className="flex items-start justify-between gap-3 p-3 border rounded-md bg-slate-50 hover:bg-violet-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs shrink-0">{issue.key}</Badge>
                          <span className="text-sm font-medium text-slate-700 truncate">{issue.summary}</span>
                        </div>
                        {issue.description && (
                          <p className="text-xs text-slate-400 line-clamp-2">{issue.description.slice(0, 120)}...</p>
                        )}
                      </div>
                      <Button size="sm" onClick={() => useExistingIssue(issue.key)} className="bg-violet-600 hover:bg-violet-700 shrink-0">
                        Use this
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-xs text-slate-400">or</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
              </>
            )}
            <div className="space-y-2">
              <p className="text-sm text-slate-600 font-medium">Create a new work item</p>
              <Button variant="outline" onClick={() => setUiStep('type-select')} className="w-full border-violet-300 text-violet-700 hover:bg-violet-50">
                + Create new →
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setUiStep('prompt')} className="text-slate-400">
              ← Edit prompt
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step: Work item type selection */}
      {uiStep === 'type-select' && (
        <Card>
          <CardHeader><CardTitle className="text-base">What type of work item?</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-500">AI will fill in the details based on your prompt.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ISSUE_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => handleTypeSelected(type)}
                  className="flex flex-col items-center gap-1 p-4 border-2 rounded-lg hover:border-violet-400 hover:bg-violet-50 transition-all text-sm font-medium text-slate-700"
                >
                  <span className="text-xl">{typeIcon(type)}</span>
                  {type}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setUiStep('similar')} className="text-slate-400">
              ← Back
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step: Preview & edit generated fields */}
      {uiStep === 'preview' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Preview — {selectedType}</CardTitle>
              {!generatingFields && workItemFields && (
                <Badge className="bg-violet-100 text-violet-700">AI Generated</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {generatingFields ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
                <span className="animate-spin text-violet-500">◐</span>
                Generating {selectedType} fields...
              </div>
            ) : workItemFields ? (
              <>
                <div className="space-y-2">
                  <Label>Summary</Label>
                  <Input value={workItemFields.summary} onChange={(e) => setWorkItemFields({ ...workItemFields, summary: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <textarea
                    className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
                    rows={4}
                    value={workItemFields.description}
                    onChange={(e) => setWorkItemFields({ ...workItemFields, description: e.target.value })}
                  />
                </div>

                {workItemFields.acceptanceCriteria !== undefined && (
                  <div className="space-y-2">
                    <Label>Acceptance Criteria</Label>
                    <textarea
                      className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
                      rows={3}
                      value={workItemFields.acceptanceCriteria}
                      onChange={(e) => setWorkItemFields({ ...workItemFields, acceptanceCriteria: e.target.value })}
                    />
                  </div>
                )}

                {workItemFields.stepsToReproduce !== undefined && (
                  <div className="space-y-2">
                    <Label>Steps to Reproduce</Label>
                    <textarea
                      className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
                      rows={3}
                      value={workItemFields.stepsToReproduce}
                      onChange={(e) => setWorkItemFields({ ...workItemFields, stepsToReproduce: e.target.value })}
                    />
                  </div>
                )}

                {workItemFields.expectedResult !== undefined && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Expected Result</Label>
                      <textarea className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" rows={2}
                        value={workItemFields.expectedResult}
                        onChange={(e) => setWorkItemFields({ ...workItemFields, expectedResult: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Actual Result</Label>
                      <textarea className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" rows={2}
                        value={workItemFields.actualResult}
                        onChange={(e) => setWorkItemFields({ ...workItemFields, actualResult: e.target.value })} />
                    </div>
                  </div>
                )}

                {workItemFields.preconditions !== undefined && (
                  <div className="space-y-2">
                    <Label>Preconditions</Label>
                    <textarea className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" rows={2}
                      value={workItemFields.preconditions}
                      onChange={(e) => setWorkItemFields({ ...workItemFields, preconditions: e.target.value })} />
                  </div>
                )}

                {workItemFields.testSteps && workItemFields.testSteps.length > 0 && (
                  <div className="space-y-2">
                    <Label>Test Steps</Label>
                    <div className="space-y-2">
                      {workItemFields.testSteps.map((step, i) => (
                        <div key={i} className="grid grid-cols-2 gap-2 p-2 bg-slate-50 rounded text-sm">
                          <div>
                            <p className="text-xs text-slate-400 mb-1">Step {i + 1} — Action</p>
                            <textarea
                              className="w-full border rounded px-2 py-1 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white"
                              rows={2}
                              value={step.action}
                              onChange={(e) => {
                                const updated = [...workItemFields.testSteps!]
                                updated[i] = { ...updated[i], action: e.target.value }
                                setWorkItemFields({ ...workItemFields, testSteps: updated })
                              }}
                            />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400 mb-1">Expected</p>
                            <textarea
                              className="w-full border rounded px-2 py-1 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white"
                              rows={2}
                              value={step.expectedResult}
                              onChange={(e) => {
                                const updated = [...workItemFields.testSteps!]
                                updated[i] = { ...updated[i], expectedResult: e.target.value }
                                setWorkItemFields({ ...workItemFields, testSteps: updated })
                              }}
                            />
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setWorkItemFields({ ...workItemFields, testSteps: [...(workItemFields.testSteps ?? []), { action: '', expectedResult: '' }] })}
                        className="text-xs text-violet-600 hover:underline"
                      >
                        + Add step
                      </button>
                    </div>
                  </div>
                )}

                {workItemFields.priority && (
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <select
                      className="border rounded-md px-3 py-2 text-sm"
                      value={workItemFields.priority}
                      onChange={(e) => setWorkItemFields({ ...workItemFields, priority: e.target.value })}
                    >
                      {['Critical', 'High', 'Medium', 'Low'].map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                )}

                {error && <p className="text-sm text-red-500">{error}</p>}

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={() => setUiStep('type-select')} className="flex-1">← Back</Button>
                  <Button onClick={handleCreateAndRun} disabled={creatingIssue} className="flex-1 bg-violet-600 hover:bg-violet-700">
                    {creatingIssue ? 'Creating in Jira...' : 'Create & Run Pipeline →'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-red-500">{error || 'Failed to generate fields.'}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step: Pipeline running */}
      {uiStep === 'pipeline' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-3 px-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant="outline">{selectedIssueKey}</Badge>
                <span className="text-sm text-slate-600 truncate max-w-xs">{workItemFields?.summary ?? prompt}</span>
              </div>
              {done && <Badge className="bg-green-500 text-white">Complete</Badge>}
              {running && <Badge className="bg-violet-100 text-violet-700 animate-pulse">Running</Badge>}
            </CardContent>
          </Card>

          {/* Progress bar */}
          <div className="flex gap-1 h-1.5 rounded-full overflow-hidden bg-slate-200">
            {AGENT_ORDER.map((a) => (
              <div key={a} className={`flex-1 transition-all ${
                agents[a].status === 'done' ? 'bg-violet-500'
                : agents[a].status === 'running' ? 'bg-violet-300 animate-pulse'
                : agents[a].status === 'error' ? 'bg-red-400'
                : ''
              }`} />
            ))}
          </div>

          {AGENT_ORDER.map((agent) => (
            <AgentCard
              key={agent}
              name={AGENT_LABELS[agent]}
              status={agents[agent].status}
              output={agents[agent].output}
              isScenarioCheck={agent === 'scenario'}
            />
          ))}

          {done && executionResult && (
            <ResultsPanel executionResult={executionResult} testCases={testCases} issueKey={selectedIssueKey} />
          )}
        </div>
      )}
    </div>
  )
}

function typeIcon(type: string) {
  const icons: Record<string, string> = {
    Story: '📖',
    Bug: '🐛',
    Task: '✅',
    'Test Case': '🧪',
    Epic: '⚡',
  }
  return icons[type] ?? '📄'
}
