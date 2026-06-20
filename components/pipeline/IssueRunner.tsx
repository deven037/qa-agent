'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppConfig } from '@/lib/config/store'
import AgentCard from './AgentCard'
import ResultsPanel from '../results/ResultsPanel'
import TestCasesPanel from './TestCasesPanel'
import WorkItemPanel from './WorkItemPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentName = 'requirement' | 'scenario' | 'testcase' | 'exploration' | 'automation' | 'review' | 'execution'
type AgentStatus = 'pending' | 'running' | 'done' | 'error'
type UIStep = 'home' | 'similar' | 'type-select' | 'preview' | 'pipeline'

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

function typeIcon(type: string) {
  const icons: Record<string, string> = { Story: '📖', Bug: '🐛', Task: '✅', 'Test Case': '🧪', Epic: '⚡' }
  return icons[type] ?? '📄'
}

// ─── Right-panel sub-views ────────────────────────────────────────────────────

function SimilarResultsPanel({
  issues, onUse, onCreateNew, onBack,
}: { issues: SimilarIssue[]; onUse: (k: string) => void; onCreateNew: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">
          {issues.length > 0 ? `${issues.length} Similar Issue${issues.length > 1 ? 's' : ''}` : 'No similar issues'}
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Use an existing issue or create a new work item</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
        {issues.map((issue) => (
          <div key={issue.key} className="flex items-start justify-between gap-3 p-3.5 border border-slate-100 rounded-xl bg-slate-50 hover:border-violet-200 hover:bg-violet-50 transition-all">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-xs shrink-0 font-mono">{issue.key}</Badge>
                <span className="text-sm font-medium text-slate-700 truncate">{issue.summary}</span>
              </div>
              {issue.description && <p className="text-xs text-slate-400 line-clamp-2">{issue.description.slice(0, 120)}</p>}
            </div>
            <Button size="sm" onClick={() => onUse(issue.key)} className="bg-violet-600 hover:bg-violet-700 shrink-0">
              Use
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-slate-100" />
          <span className="text-xs text-slate-400">or</span>
          <div className="flex-1 h-px bg-slate-100" />
        </div>
        <Button variant="outline" onClick={onCreateNew} className="w-full border-violet-300 text-violet-700 hover:bg-violet-50">
          + Create new work item
        </Button>
      </div>
      <div className="px-5 py-3 border-t border-slate-100">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-slate-400 text-xs">← Edit prompt</Button>
      </div>
    </div>
  )
}

function TypeSelectPanel({ onSelect, onBack }: { onSelect: (t: string) => void; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">Choose Work Item Type</h2>
        <p className="text-xs text-slate-400 mt-0.5">AI will fill in the details from your prompt</p>
      </div>
      <div className="flex-1 px-5 py-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ISSUE_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => onSelect(type)}
              className="flex flex-col items-center gap-1.5 p-4 border-2 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition-all text-sm font-medium text-slate-700 border-slate-200"
            >
              <span className="text-2xl">{typeIcon(type)}</span>
              {type}
            </button>
          ))}
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-slate-400 text-xs">← Back</Button>
      </div>
    </div>
  )
}

function PreviewPanel({
  selectedType, generatingFields, workItemFields, setWorkItemFields, error, creatingIssue, onCreateAndRun, onBack,
}: {
  selectedType: string
  generatingFields: boolean
  workItemFields: WorkItemFields | null
  setWorkItemFields: (f: WorkItemFields) => void
  error: string
  creatingIssue: boolean
  onCreateAndRun: () => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Preview — {selectedType}</h2>
          <p className="text-xs text-slate-400 mt-0.5">Edit fields then create and run the pipeline</p>
        </div>
        {!generatingFields && workItemFields && (
          <Badge className="bg-violet-100 text-violet-700 text-xs">AI Generated</Badge>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {generatingFields ? (
          <div className="flex items-center justify-center h-32 gap-2 text-sm text-slate-500">
            <span className="animate-spin text-violet-500">◐</span>
            Generating {selectedType} fields...
          </div>
        ) : workItemFields ? (
          <>
            <div className="space-y-1.5">
              <Label>Summary</Label>
              <Input value={workItemFields.summary} onChange={(e) => setWorkItemFields({ ...workItemFields, summary: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <textarea className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" rows={4}
                value={workItemFields.description} onChange={(e) => setWorkItemFields({ ...workItemFields, description: e.target.value })} />
            </div>
            {workItemFields.acceptanceCriteria !== undefined && (
              <div className="space-y-1.5">
                <Label>Acceptance Criteria</Label>
                <textarea className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" rows={3}
                  value={workItemFields.acceptanceCriteria} onChange={(e) => setWorkItemFields({ ...workItemFields, acceptanceCriteria: e.target.value })} />
              </div>
            )}
            {workItemFields.stepsToReproduce !== undefined && (
              <div className="space-y-1.5">
                <Label>Steps to Reproduce</Label>
                <textarea className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" rows={3}
                  value={workItemFields.stepsToReproduce} onChange={(e) => setWorkItemFields({ ...workItemFields, stepsToReproduce: e.target.value })} />
              </div>
            )}
            {workItemFields.expectedResult !== undefined && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Expected Result</Label>
                  <textarea className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" rows={2}
                    value={workItemFields.expectedResult} onChange={(e) => setWorkItemFields({ ...workItemFields, expectedResult: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Actual Result</Label>
                  <textarea className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" rows={2}
                    value={workItemFields.actualResult} onChange={(e) => setWorkItemFields({ ...workItemFields, actualResult: e.target.value })} />
                </div>
              </div>
            )}
            {workItemFields.preconditions !== undefined && (
              <div className="space-y-1.5">
                <Label>Preconditions</Label>
                <textarea className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" rows={2}
                  value={workItemFields.preconditions} onChange={(e) => setWorkItemFields({ ...workItemFields, preconditions: e.target.value })} />
              </div>
            )}
            {workItemFields.testSteps && workItemFields.testSteps.length > 0 && (
              <div className="space-y-1.5">
                <Label>Test Steps</Label>
                <div className="space-y-2">
                  {workItemFields.testSteps.map((step, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2 p-2 bg-slate-50 rounded text-sm">
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Step {i + 1} — Action</p>
                        <textarea className="w-full border rounded px-2 py-1 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white" rows={2}
                          value={step.action}
                          onChange={(e) => {
                            const updated = [...workItemFields.testSteps!]
                            updated[i] = { ...updated[i], action: e.target.value }
                            setWorkItemFields({ ...workItemFields, testSteps: updated })
                          }} />
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Expected</p>
                        <textarea className="w-full border rounded px-2 py-1 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white" rows={2}
                          value={step.expectedResult}
                          onChange={(e) => {
                            const updated = [...workItemFields.testSteps!]
                            updated[i] = { ...updated[i], expectedResult: e.target.value }
                            setWorkItemFields({ ...workItemFields, testSteps: updated })
                          }} />
                      </div>
                    </div>
                  ))}
                  <button type="button"
                    onClick={() => setWorkItemFields({ ...workItemFields, testSteps: [...(workItemFields.testSteps ?? []), { action: '', expectedResult: '' }] })}
                    className="text-xs text-violet-600 hover:underline">
                    + Add step
                  </button>
                </div>
              </div>
            )}
            {workItemFields.priority && (
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <select className="border rounded-md px-3 py-2 text-sm"
                  value={workItemFields.priority} onChange={(e) => setWorkItemFields({ ...workItemFields, priority: e.target.value })}>
                  {['Critical', 'High', 'Medium', 'Low'].map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
          </>
        ) : (
          <p className="text-sm text-red-500">{error || 'Failed to generate fields.'}</p>
        )}
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
        <Button variant="outline" onClick={onBack} className="flex-1">← Back</Button>
        {workItemFields && !generatingFields && (
          <Button onClick={onCreateAndRun} disabled={creatingIssue} className="flex-1 bg-violet-600 hover:bg-violet-700">
            {creatingIssue ? 'Creating...' : 'Create & Run →'}
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function IssueRunner({ app }: { app: AppConfig }) {
  const [uiStep, setUiStep] = useState<UIStep>('home')
  const [rightContent, setRightContent] = useState<'search' | 'similar' | 'type-select' | 'preview'>('search')
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

  async function handleFindSimilar() {
    if (!prompt.trim()) return
    setSearching(true)
    setError('')
    try {
      const res = await fetch(`/api/jira/issues?project=${app.jiraProjectKey}&q=${encodeURIComponent(prompt)}&mode=similar`)
      const data = await res.json()
      setSimilarIssues(data)
      setRightContent('similar')
    } catch {
      setError('Failed to search Jira.')
    }
    setSearching(false)
  }

  function useExistingIssue(key: string) {
    setSelectedIssueKey(key)
    setUiStep('pipeline')
    runPipeline(key)
  }

  async function handleTypeSelected(type: string) {
    setSelectedType(type)
    setGeneratingFields(true)
    setRightContent('preview')
    setWorkItemFields(null)
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

  // ── Right panel content ────────────────────────────────────────────────────
  const rightPanel = (
    <>
      {rightContent === 'search' && (
        <WorkItemPanel
          projectKey={app.jiraProjectKey}
          prompt={prompt}
          searching={searching}
          onPromptChange={setPrompt}
          onFindSimilar={handleFindSimilar}
          onRunPipeline={useExistingIssue}
          onCreateNew={() => setRightContent('type-select')}
        />
      )}
      {rightContent === 'similar' && (
        <SimilarResultsPanel
          issues={similarIssues}
          onUse={useExistingIssue}
          onCreateNew={() => setRightContent('type-select')}
          onBack={() => setRightContent('search')}
        />
      )}
      {rightContent === 'type-select' && (
        <TypeSelectPanel
          onSelect={handleTypeSelected}
          onBack={() => setRightContent(similarIssues.length > 0 ? 'similar' : 'search')}
        />
      )}
      {rightContent === 'preview' && (
        <PreviewPanel
          selectedType={selectedType}
          generatingFields={generatingFields}
          workItemFields={workItemFields}
          setWorkItemFields={setWorkItemFields}
          error={error}
          creatingIssue={creatingIssue}
          onCreateAndRun={handleCreateAndRun}
          onBack={() => setRightContent('type-select')}
        />
      )}
    </>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {uiStep !== 'pipeline' && (
        <>
          {/* Mobile: tabs */}
          <div className="lg:hidden">
            <Tabs defaultValue="workitem">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="testcases">Test Cases</TabsTrigger>
                <TabsTrigger value="workitem">Work Item</TabsTrigger>
              </TabsList>
              <TabsContent value="testcases" className="mt-3">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
                  <TestCasesPanel
                    projectKey={app.jiraProjectKey}
                    onSelectIssue={useExistingIssue}
                    selectedKey={selectedIssueKey}
                  />
                </div>
              </TabsContent>
              <TabsContent value="workitem" className="mt-3">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
                  {rightPanel}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Desktop: two columns */}
          <div className="hidden lg:grid lg:grid-cols-[300px_1fr] gap-5" style={{ minHeight: 620 }}>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <TestCasesPanel
                projectKey={app.jiraProjectKey}
                onSelectIssue={useExistingIssue}
                selectedKey={selectedIssueKey}
              />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              {rightPanel}
            </div>
          </div>
        </>
      )}

      {uiStep === 'pipeline' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-3 px-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant="outline">{selectedIssueKey}</Badge>
                <span className="text-sm text-slate-600 truncate max-w-xs">{workItemFields?.summary ?? prompt}</span>
              </div>
              <div className="flex items-center gap-2">
                {done && <Badge className="bg-green-500 text-white">Complete</Badge>}
                {running && <Badge className="bg-violet-100 text-violet-700 animate-pulse">Running</Badge>}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-400"
                  onClick={() => { setUiStep('home'); setRightContent('search') }}
                >
                  ← Back
                </Button>
              </div>
            </CardContent>
          </Card>

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
