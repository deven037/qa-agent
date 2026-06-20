'use client'

import { useState, useRef, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Search, Play, CheckCircle2, XCircle, MinusCircle, Monitor, EyeOff,
  Loader2, Wrench, ChevronDown, ChevronRight,
} from 'lucide-react'
import type { AgentEvent, ExecutionResult } from '@/lib/agents/playwright-mcp-agent'

// ─── UI types ─────────────────────────────────────────────────────────────────

interface StepLiveResult {
  step: string
  status: 'pending' | 'running' | 'healing' | 'passed' | 'failed'
  locatorUsed?: string
  error?: string
  healingAttempts: number
  healingRationale?: string
}

interface TCLiveResult {
  id: string
  title: string
  status: 'pending' | 'running' | 'passed' | 'failed'
  steps: StepLiveResult[]
  analyzing?: boolean
  analyzeReason?: string
}

interface TestStep {
  step: string
  expected: string
}

interface FullIssue {
  key: string
  summary: string
  testSteps?: TestStep[]
  comments?: { id: string; body: string; author: string }[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AutomationPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const appId = params.appId as string

  const [issueKey, setIssueKey] = useState(searchParams.get('issueKey') ?? '')
  const [issue, setIssue] = useState<FullIssue | null>(null)
  const [fetchingIssue, setFetchingIssue] = useState(false)
  const [recentIssues, setRecentIssues] = useState<{ key: string; summary: string }[]>([])

  const [browser, setBrowser] = useState<'chromium' | 'firefox' | 'webkit'>('chromium')
  const [headed, setHeaded] = useState(false)
  const [instructions, setInstructions] = useState('')

  const [isExecuting, setIsExecuting] = useState(false)
  const [agentLogs, setAgentLogs] = useState<string[]>([])
  const [tcResults, setTcResults] = useState<TCLiveResult[]>([])
  const [expandedTCs, setExpandedTCs] = useState<Set<string>>(new Set())
  const [execResult, setExecResult] = useState<ExecutionResult | null>(null)
  const [execAt, setExecAt] = useState<Date | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const key = searchParams.get('issueKey')
    if (key) {
      setIssueKey(key)
      loadIssue(key)
    }
    // Auto-load recent issues list
    async function loadRecent() {
      try {
        const appsRes = await fetch('/api/apps')
        const apps = await appsRes.json()
        const app = apps.find((a: { id: string }) => a.id === appId)
        const projectKey = app?.jiraProjectKey ?? ''
        if (!projectKey) return
        const res = await fetch(`/api/jira/issues?project=${projectKey}&q=`)
        if (res.ok) setRecentIssues(await res.json())
      } catch { /* ignore */ }
    }
    loadRecent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [agentLogs])

  async function loadIssue(key: string) {
    if (!key.trim()) return
    setFetchingIssue(true); setIssue(null)
    try {
      const res = await fetch(`/api/jira/issues/${key.trim().toUpperCase()}`)
      if (res.ok) setIssue(await res.json())
      else toast.error('Issue not found')
    } catch { toast.error('Failed to fetch issue') }
    finally { setFetchingIssue(false) }
  }

  function toggleTC(id: string) {
    setExpandedTCs((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case 'log':
        setAgentLogs((prev) => [...prev, event.text!])
        break

      case 'tc_start':
        setTcResults((prev) => [
          ...prev,
          { id: event.id!, title: event.title!, status: 'running', steps: [] },
        ])
        setExpandedTCs((prev) => new Set([...prev, event.id!]))
        break

      case 'step_start':
        setTcResults((prev) =>
          prev.map((tc) =>
            tc.id === event.tcId
              ? { ...tc, steps: [...tc.steps, { step: event.step!, status: 'running', healingAttempts: 0 }] }
              : tc
          )
        )
        break

      case 'step_heal':
        setTcResults((prev) =>
          prev.map((tc) =>
            tc.id === event.tcId
              ? {
                  ...tc,
                  steps: tc.steps.map((s, i) =>
                    i === event.stepIndex
                      ? { ...s, status: 'healing', healingAttempts: event.attempt!, healingRationale: event.rationale }
                      : s
                  ),
                }
              : tc
          )
        )
        break

      case 'step_done':
        setTcResults((prev) =>
          prev.map((tc) =>
            tc.id === event.tcId
              ? {
                  ...tc,
                  steps: tc.steps.map((s, i) =>
                    i === event.stepIndex
                      ? { ...s, status: event.status!, locatorUsed: event.locatorUsed, error: event.error, healingAttempts: event.healingAttempts! }
                      : s
                  ),
                }
              : tc
          )
        )
        break

      case 'tc_analyzing':
        setTcResults((prev) =>
          prev.map((tc) =>
            tc.id === event.tcId
              ? { ...tc, analyzing: true, analyzeReason: event.reason }
              : tc
          )
        )
        break

      case 'tc_done':
        setTcResults((prev) =>
          prev.map((tc) => (tc.id === event.id ? { ...tc, status: event.status!, analyzing: false } : tc))
        )
        break
    }
  }

  async function handleExecute() {
    if (!issue) return
    setIsExecuting(true)
    setTcResults([])
    setExecResult(null)
    setAgentLogs([])
    setExpandedTCs(new Set())

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/agents/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueKey: issueKey.trim(), appId, browser, headed, instructions: instructions.trim() || undefined }),
        signal: controller.signal,
      })

      if (!res.ok) { toast.error(`Execute failed: ${res.statusText}`); return }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()

          if (data.startsWith('[DONE]')) {
            try { setExecResult(JSON.parse(data.slice(7))); setExecAt(new Date()) } catch { /* ignore */ }
          } else if (data.startsWith('[ERROR]')) {
            toast.error(data.slice(8))
          } else {
            try { handleAgentEvent(JSON.parse(data) as AgentEvent) } catch { /* ignore non-JSON lines */ }
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error(String(e))
    } finally {
      setIsExecuting(false)
    }
  }

  const hasSteps = (issue?.testSteps?.length ?? 0) > 0

  return (
    <div className="space-y-5">

      {/* Container 1 — Find Issue */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 bg-gradient-to-r from-violet-600 to-violet-700 flex items-center gap-2">
          <Search className="w-4 h-4 text-white/80" />
          <h2 className="text-sm font-semibold text-white">Find Test Case</h2>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <input
              value={issueKey}
              onChange={(e) => setIssueKey(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') loadIssue(issueKey) }}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
              placeholder="KAN-5"
            />
            <Button onClick={() => loadIssue(issueKey)} disabled={fetchingIssue || !issueKey.trim()}
              className="bg-violet-600 hover:bg-violet-700">
              {fetchingIssue ? 'Fetching…' : 'Fetch'}
            </Button>
          </div>

          {/* Recent issues picker — shown when no issue is loaded */}
          {!issue && recentIssues.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-slate-500 font-medium">Recent issues — click to load</p>
              {recentIssues.map((r) => (
                <button
                  key={r.key}
                  onClick={() => { setIssueKey(r.key); loadIssue(r.key) }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 border border-slate-200 bg-slate-50 rounded-lg hover:border-violet-300 hover:bg-violet-50 transition-all"
                >
                  <span className="font-mono text-xs text-violet-700 border border-violet-200 bg-white px-1.5 py-0.5 rounded shrink-0">{r.key}</span>
                  <span className="text-sm text-slate-600 truncate">{r.summary}</span>
                </button>
              ))}
            </div>
          )}

          {issue && (
            <div className="border border-violet-200 bg-violet-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs border-violet-300 text-violet-700">{issue.key}</Badge>
                <span className="text-sm font-semibold text-slate-800">{issue.summary}</span>
              </div>
              {hasSteps ? (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-2">{issue.testSteps!.length} test step{issue.testSteps!.length !== 1 ? 's' : ''} loaded from Jira:</p>
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="px-3 py-2 text-left font-semibold text-slate-500 w-8">#</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-500">Test Step</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-500">Expected Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issue.testSteps!.map((s, i) => (
                          <tr key={i} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-2 text-slate-400 font-mono">{i + 1}</td>
                            <td className="px-3 py-2 text-slate-700">{s.step}</td>
                            <td className="px-3 py-2 text-slate-500">{s.expected || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⚠️ No test steps found. <a href={`/apps/${appId}/work-items`} className="underline">Add them in Work Items →</a>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Container 2 — Execute */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-700 flex items-center gap-2">
          <Play className="w-4 h-4 text-white/80" />
          <h2 className="text-sm font-semibold text-white">Execute Tests</h2>
        </div>
        <div className="p-5 space-y-5">

          {/* Settings — shown when test cases exist */}
          {issue && hasSteps && (
            <div className="border border-emerald-100 bg-emerald-50 rounded-xl p-4 space-y-4">
              <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Execution Settings</p>

              {/* Browser */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">Browser</label>
                <div className="flex gap-2">
                  {(['chromium', 'firefox', 'webkit'] as const).map((b) => (
                    <button
                      key={b}
                      onClick={() => setBrowser(b)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${
                        browser === b
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              {/* Run mode */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">Run mode</label>
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 w-fit">
                  <button
                    onClick={() => setHeaded(false)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${!headed ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <EyeOff className="w-3.5 h-3.5" /> Headless
                  </button>
                  <button
                    onClick={() => setHeaded(true)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${headed ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <Monitor className="w-3.5 h-3.5" /> Headed
                  </button>
                </div>
                {headed && <p className="text-xs text-amber-600">Browser window will open on the server</p>}
              </div>

              {/* Instructions */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">
                  Custom instructions <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={2}
                  placeholder="e.g. Focus on error message assertions, use slow motion, etc."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={handleExecute}
              disabled={!issue || !hasSteps || isExecuting}
              className="bg-emerald-600 hover:bg-emerald-700 gap-1.5"
            >
              {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isExecuting ? 'Executing…' : 'Execute Tests'}
            </Button>
            {isExecuting && (
              <button
                onClick={() => { abortRef.current?.abort(); setIsExecuting(false) }}
                className="text-xs text-red-500 hover:text-red-700 underline"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Agent logs */}
          {agentLogs.length > 0 && (
            <div className="bg-slate-900 rounded-xl p-3 max-h-28 overflow-auto">
              {agentLogs.map((log, i) => (
                <p key={i} className="text-xs text-slate-400 font-mono">{log}</p>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}

          {/* Live TC results */}
          {tcResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Live Execution</p>
              {tcResults.map((tc) => (
                <div key={tc.id} className={`rounded-xl border overflow-hidden ${
                  tc.status === 'passed' ? 'border-emerald-200' :
                  tc.status === 'failed' ? 'border-red-200' : 'border-slate-200'
                }`}>
                  {/* TC header */}
                  <button
                    onClick={() => toggleTC(tc.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      tc.status === 'passed' ? 'bg-emerald-50 hover:bg-emerald-100' :
                      tc.status === 'failed' ? 'bg-red-50 hover:bg-red-100' :
                      'bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    {tc.status === 'passed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : tc.status === 'failed' ? (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-slate-400 shrink-0 animate-spin" />
                    )}
                    <span className="text-sm font-semibold text-slate-800 flex-1">{tc.id}: {tc.title}</span>
                    <Badge variant="outline" className="text-xs font-mono shrink-0">
                      {tc.steps.filter(s => s.status === 'passed').length}/{tc.steps.length} steps
                    </Badge>
                    {expandedTCs.has(tc.id) ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                  </button>

                  {/* Scenario analyst banner */}
                  {tc.analyzing && (
                    <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 flex items-center gap-2 text-xs text-amber-700">
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      <span>{tc.analyzeReason || 'Analyzing scenario…'}</span>
                    </div>
                  )}

                  {/* Steps */}
                  {expandedTCs.has(tc.id) && tc.steps.length > 0 && (
                    <div className="divide-y divide-slate-100 border-t border-slate-100">
                      {tc.steps.map((s, i) => (
                        <div key={i} className="px-4 py-2.5 space-y-1">
                          <div className="flex items-start gap-2.5">
                            {/* Step status icon */}
                            <div className="mt-0.5 shrink-0">
                              {s.status === 'passed' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              ) : s.status === 'failed' ? (
                                <XCircle className="w-3.5 h-3.5 text-red-500" />
                              ) : s.status === 'healing' ? (
                                <Wrench className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                              ) : s.status === 'running' ? (
                                <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                              ) : (
                                <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-300" />
                              )}
                            </div>

                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="text-xs text-slate-700 leading-snug">{i + 1}. {s.step}</p>

                              {/* Healing indicator */}
                              {(s.status === 'healing' || s.healingAttempts > 0) && (
                                <div className={`text-xs px-2 py-1 rounded-md flex items-center gap-1.5 ${
                                  s.status === 'healing' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-500'
                                }`}>
                                  <Wrench className="w-3 h-3 shrink-0" />
                                  {s.status === 'healing'
                                    ? `Self-healing attempt ${s.healingAttempts}/2… ${s.healingRationale || ''}`
                                    : `Healed (${s.healingAttempts} attempt${s.healingAttempts > 1 ? 's' : ''})`
                                  }
                                </div>
                              )}

                              {/* Locator pill */}
                              {s.locatorUsed && s.status === 'passed' && (
                                <span className="inline-block text-xs bg-slate-100 text-slate-500 font-mono px-2 py-0.5 rounded-md max-w-full truncate" title={s.locatorUsed}>
                                  {s.locatorUsed}
                                </span>
                              )}

                              {/* Error */}
                              {s.error && (
                                <p className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-md">{s.error}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Final summary */}
          {execResult && (() => {
            const total = execResult.passed + execResult.failed + execResult.skipped
            const allPassed = execResult.failed === 0 && execResult.passed > 0
            const allFailed = execResult.passed === 0 && execResult.failed > 0
            return (
              <div className="space-y-3 pt-1">
                <div className={`rounded-xl px-5 py-4 border flex items-center justify-between gap-4 ${
                  allPassed ? 'bg-emerald-50 border-emerald-300' :
                  allFailed ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'
                }`}>
                  <div className="flex items-center gap-3">
                    {allPassed
                      ? <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" />
                      : allFailed
                      ? <XCircle className="w-7 h-7 text-red-500 shrink-0" />
                      : <MinusCircle className="w-7 h-7 text-amber-500 shrink-0" />}
                    <div>
                      <p className={`text-lg font-bold ${allPassed ? 'text-emerald-700' : allFailed ? 'text-red-700' : 'text-amber-700'}`}>
                        {allPassed ? 'All Tests Passed' : allFailed ? 'All Tests Failed' : 'Partial Pass'}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {execAt ? `Run at ${execAt.toLocaleTimeString()}` : ''} · {(execResult.duration / 1000).toFixed(2)}s total
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    {[
                      { label: 'Passed', value: execResult.passed, color: 'text-emerald-700 bg-emerald-100' },
                      { label: 'Failed', value: execResult.failed, color: 'text-red-700 bg-red-100' },
                      { label: 'Skipped', value: execResult.skipped, color: 'text-slate-600 bg-slate-100' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className={`text-center px-3 py-1.5 rounded-lg ${color}`}>
                        <p className="text-xl font-bold leading-none">{value}</p>
                        <p className="text-xs font-medium mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {total > 0 && (
                  <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
                    {execResult.passed > 0 && <div className="bg-emerald-500" style={{ width: `${(execResult.passed / total) * 100}%` }} />}
                    {execResult.failed > 0 && <div className="bg-red-500" style={{ width: `${(execResult.failed / total) * 100}%` }} />}
                    {execResult.skipped > 0 && <div className="bg-slate-300" style={{ width: `${(execResult.skipped / total) * 100}%` }} />}
                  </div>
                )}

                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  Results posted to Jira as a comment on {issueKey}
                </p>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
