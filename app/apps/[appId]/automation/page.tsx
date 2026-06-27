'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Play, Loader2, Monitor, EyeOff, Plus, Pencil, Check, X,
  CheckCircle2, XCircle, MinusCircle, Terminal, Copy, RefreshCw, FileText,
} from 'lucide-react'
import Link from 'next/link'
import type { AgentEvent, ExecutionResult } from '@/lib/agents/playwright-mcp-agent'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlannedStep { step: string; expected: string }
interface ConsoleEntry { ts: string; type: AgentEvent['type'] | 'system'; text: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowTs() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

const EVENT_STYLE: Record<string, { tag: string; color: string }> = {
  log:            { tag: 'LOG',  color: 'text-slate-400' },
  system:         { tag: 'SYS',  color: 'text-slate-500' },
  plan_start:     { tag: 'PLAN', color: 'text-indigo-400' },
  plan_step:      { tag: 'PLAN', color: 'text-indigo-300' },
  plan_done:      { tag: 'PLAN', color: 'text-indigo-400' },
  agent_thinking: { tag: 'AI',   color: 'text-blue-400' },
  llm_response:   { tag: 'LLM',  color: 'text-purple-400' },
  dom_inspect:    { tag: 'DOM',  color: 'text-cyan-400' },
  locator_try:    { tag: '→',    color: 'text-slate-400' },
  nav:            { tag: 'NAV',  color: 'text-teal-400' },
  tc_start:       { tag: 'TC',   color: 'text-slate-300' },
  step_start:     { tag: 'STEP', color: 'text-slate-400' },
  step_heal:      { tag: 'HEAL', color: 'text-amber-400' },
  step_done:      { tag: '✓',    color: 'text-emerald-400' },
  tc_analyzing:   { tag: 'ANLZ', color: 'text-amber-300' },
  tc_done:        { tag: 'DONE', color: 'text-white' },
}

function eventText(e: AgentEvent): string {
  switch (e.type) {
    case 'log': return e.text || ''
    case 'plan_start': return e.text || 'Planning steps…'
    case 'plan_step': return `  ${(e.stepIndex ?? 0) + 1}. ${e.text || e.plannedStep?.step || ''}`
    case 'plan_done': return e.text || 'Plan ready'
    case 'agent_thinking': return e.text || ''
    case 'llm_response': return e.rationale || e.text || `${e.action} → ${e.locator || ''}`
    case 'dom_inspect': return `${e.fieldCount ?? 0} field(s) on ${e.url || 'page'}`
    case 'locator_try': return `${e.success ? '✓' : '✗'} ${e.locator || ''}`
    case 'nav': return `→ ${e.url || ''}`
    case 'tc_start': return `Test: ${e.title || e.id}`
    case 'step_start': return `Step ${(e.stepIndex ?? 0) + 1}: ${e.step || ''}`
    case 'step_heal': return `Healing attempt ${e.attempt}: ${e.rationale || ''}`
    case 'step_done': return `${e.status === 'passed' ? 'PASS' : 'FAIL'} — Step ${(e.stepIndex ?? 0) + 1}${e.error ? `: ${e.error}` : ''}`
    case 'tc_analyzing': return `Analyzing: ${e.reason || ''}`
    case 'tc_done': return `${e.status?.toUpperCase()} — ${(e.duration ?? 0) / 1000}s`
    default: return e.text || JSON.stringify(e)
  }
}

function stepDoneColor(e: AgentEvent) {
  if (e.type !== 'step_done') return ''
  return e.status === 'passed' ? 'text-emerald-400' : 'text-red-400'
}

function locatorTryColor(e: AgentEvent) {
  if (e.type !== 'locator_try') return ''
  return e.success ? 'text-emerald-500' : 'text-red-500'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AutomationPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const appId = params.appId as string

  // Mode
  const [mode, setMode] = useState<'jira' | 'freeform'>('jira')

  // Jira
  const [issueKey, setIssueKey] = useState(searchParams.get('issueKey') ?? '')
  const [fetchingIssue, setFetchingIssue] = useState(false)
  const [recentIssues, setRecentIssues] = useState<{ key: string; summary: string }[]>([])
  const [jiraSteps, setJiraSteps] = useState<PlannedStep[]>([])

  // Free-form
  const [instruction, setInstruction] = useState('')

  // Plan panel (editable)
  const [planSteps, setPlanSteps] = useState<PlannedStep[]>([])
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editBuf, setEditBuf] = useState('')

  // Settings
  const [browser, setBrowser] = useState<'chromium' | 'firefox' | 'webkit'>('chromium')
  const [runnerMode, setRunnerMode] = useState<'server' | 'local'>('server')
  const [runnerToken, setRunnerToken] = useState<string | null>(null)
  const [loadingToken, setLoadingToken] = useState(false)

  // Execution
  const [isExecuting, setIsExecuting] = useState(false)
  const [consoleLines, setConsoleLines] = useState<ConsoleEntry[]>([])
  const [execResult, setExecResult] = useState<ExecutionResult | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const consoleEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll console
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [consoleLines])

  // Load recent issues
  useEffect(() => {
    const key = searchParams.get('issueKey')
    if (key) { setIssueKey(key); loadIssue(key) }

    async function loadRecent() {
      try {
        const apps = await (await fetch('/api/apps')).json()
        const app = apps.find((a: { id: string }) => a.id === appId)
        const pk = app?.jiraProjectKey ?? ''
        if (!pk) return
        const res = await fetch(`/api/jira/issues?project=${pk}&q=&type=Test+Case`)
        if (res.ok) setRecentIssues(await res.json())
      } catch { /* ignore */ }
    }
    loadRecent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadIssue(key: string) {
    if (!key.trim()) return
    setFetchingIssue(true); setJiraSteps([])
    try {
      const res = await fetch(`/api/jira/issues/${key.trim().toUpperCase()}`)
      if (res.ok) {
        const issue = await res.json()
        const steps: PlannedStep[] = (issue.testSteps ?? []).map((s: PlannedStep) => ({ step: s.step, expected: s.expected }))
        setJiraSteps(steps)
        setPlanSteps(steps)
      } else toast.error('Issue not found')
    } catch { toast.error('Failed to fetch issue') }
    finally { setFetchingIssue(false) }
  }

  const addLine = useCallback((type: AgentEvent['type'] | 'system', text: string) => {
    setConsoleLines(prev => [...prev, { ts: nowTs(), type, text }])
  }, [])

  function handleAgentEvent(e: AgentEvent) {
    if (e.type === 'plan_step' && e.plannedStep) {
      setPlanSteps(prev => {
        const next = [...prev]
        next[e.stepIndex!] = e.plannedStep!
        return next
      })
    }
    const style = EVENT_STYLE[e.type]
    const text = stepDoneColor(e) || locatorTryColor(e) ? eventText(e) : eventText(e)
    addLine(e.type, text)
    void style
  }

  function startEdit(idx: number) { setEditingIdx(idx); setEditBuf(planSteps[idx].step) }
  function saveEdit(idx: number) {
    setPlanSteps(prev => prev.map((s, i) => i === idx ? { ...s, step: editBuf } : s))
    setEditingIdx(null)
  }
  function removeStep(idx: number) { setPlanSteps(prev => prev.filter((_, i) => i !== idx)) }
  function addStep() { setPlanSteps(prev => [...prev, { step: '', expected: '' }]); setEditingIdx(planSteps.length); setEditBuf('') }

  async function fetchToken() {
    setLoadingToken(true)
    try {
      const res = await fetch('/api/runner/token')
      if (res.ok) {
        setRunnerToken((await res.json()).token)
      } else {
        toast.error(`Failed to load token: ${res.status} ${res.statusText}`)
      }
    } catch (e) {
      toast.error(`Token fetch error: ${String(e)}`)
    } finally {
      setLoadingToken(false)
    }
  }

  async function regenerateToken() {
    setLoadingToken(true)
    try {
      const res = await fetch('/api/runner/token', { method: 'POST' })
      if (res.ok) {
        setRunnerToken((await res.json()).token)
        toast.success('Token regenerated')
      } else {
        toast.error(`Failed to regenerate token: ${res.status} ${res.statusText}`)
      }
    } catch (e) {
      toast.error(`Token error: ${String(e)}`)
    } finally {
      setLoadingToken(false)
    }
  }

  useEffect(() => {
    if (runnerMode === 'local' && !runnerToken) fetchToken()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerMode])

  async function handleExecute() {
    if (isExecuting) return
    if (mode === 'freeform' && !instruction.trim()) { toast.error('Enter an instruction first'); return }
    if (mode === 'jira' && !issueKey.trim()) { toast.error('Enter a Jira issue key first'); return }

    setIsExecuting(true)
    setConsoleLines([])
    setExecResult(null)
    setRunId(null)
    if (mode === 'freeform') setPlanSteps([])

    const controller = new AbortController()
    abortRef.current = controller

    const body = mode === 'freeform'
      ? { appId, freeform: true, instruction: instruction.trim(), browser, headed: runnerMode === 'local', runnerMode }
      : { appId, freeform: false, issueKey: issueKey.trim(), browser, headed: runnerMode === 'local', runnerMode }

    try {
      const res = await fetch('/api/agents/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) { toast.error(`Execute failed: ${res.statusText}`); return }

      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data.startsWith('[DONE]')) {
            try { setExecResult(JSON.parse(data.slice(7))) } catch { /* ignore */ }
          } else if (data.startsWith('[RUN_ID]')) {
            setRunId(data.slice(9).trim())
          } else if (data.startsWith('[ERROR]')) {
            addLine('system', `ERROR: ${data.slice(8)}`)
            toast.error(data.slice(8))
          } else {
            try { handleAgentEvent(JSON.parse(data) as AgentEvent) } catch { /* ignore */ }
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error(String(e))
    } finally {
      setIsExecuting(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] min-h-0">

      {/* Header bar */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-violet-600" />
          <h1 className="text-base font-semibold text-slate-800">QA Agent Console</h1>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => { setMode('jira'); setPlanSteps(jiraSteps) }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'jira' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Jira Issue
          </button>
          <button
            onClick={() => { setMode('freeform'); setPlanSteps([]) }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'freeform' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Free-form
          </button>
        </div>
      </div>

      {/* Split panel */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* ── Left: Instruction + Plan ── */}
        <div className="w-96 shrink-0 flex flex-col gap-3 min-h-0">

          {/* Instruction input */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shrink-0">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                {mode === 'jira' ? 'Jira Issue' : 'Instruction'}
              </p>
            </div>
            <div className="p-4 space-y-2.5">
              {mode === 'jira' ? (
                <>
                  <div className="flex gap-2">
                    <input
                      value={issueKey}
                      onChange={e => setIssueKey(e.target.value.toUpperCase())}
                      onKeyDown={e => { if (e.key === 'Enter') loadIssue(issueKey) }}
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                      placeholder="KAN-5"
                    />
                    <Button onClick={() => loadIssue(issueKey)} disabled={fetchingIssue || !issueKey.trim()}
                      className="bg-violet-600 hover:bg-violet-700 px-4">
                      {fetchingIssue ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load'}
                    </Button>
                  </div>
                  {!jiraSteps.length && recentIssues.length > 0 && (
                    <div className="space-y-1.5 max-h-44 overflow-auto">
                      {recentIssues.map(r => (
                        <button key={r.key} onClick={() => { setIssueKey(r.key); loadIssue(r.key) }}
                          className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 border border-slate-200 bg-slate-50 rounded-lg hover:border-violet-300 hover:bg-violet-50 transition-all">
                          <span className="font-mono text-xs text-violet-700 border border-violet-200 bg-white px-2 py-0.5 rounded shrink-0">{r.key}</span>
                          <span className="text-sm text-slate-600 truncate">{r.summary}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <textarea
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  rows={4}
                  placeholder="e.g. Test the login flow with admin credentials and verify dashboard loads"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                />
              )}
            </div>
          </div>

          {/* Plan panel */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                Plan {planSteps.length > 0 ? <span className="text-violet-600 ml-1">· {planSteps.length} steps</span> : ''}
              </p>
              {isExecuting && <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />}
            </div>

            <div className="flex-1 overflow-auto p-3 space-y-1">
              {planSteps.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10">
                  {isExecuting ? 'AI is planning…' : mode === 'freeform' ? 'Plan will appear here after execution starts' : 'Load a Jira issue to see its steps'}
                </p>
              ) : planSteps.map((s, i) => (
                <div key={i} className="group flex items-start gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <span className="text-xs text-slate-400 font-mono mt-0.5 w-5 shrink-0 text-right">{i + 1}.</span>
                  {editingIdx === i ? (
                    <div className="flex-1 flex gap-1.5">
                      <input
                        autoFocus
                        value={editBuf}
                        onChange={e => setEditBuf(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(i); if (e.key === 'Escape') setEditingIdx(null) }}
                        className="flex-1 border border-violet-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                      />
                      <button onClick={() => saveEdit(i)} className="text-emerald-600 hover:text-emerald-700"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingIdx(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-start justify-between gap-2 min-w-0">
                      <p className="text-sm text-slate-700 leading-snug flex-1 min-w-0">{s.step || <span className="text-slate-400 italic">empty step</span>}</p>
                      <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                        <button onClick={() => startEdit(i)} className="text-slate-400 hover:text-violet-600 p-1 rounded hover:bg-violet-50"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => removeStep(i)} className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-red-50"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 p-2.5 shrink-0">
              <button onClick={addStep} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-violet-600 hover:bg-violet-50 transition-all">
                <Plus className="w-4 h-4" /> Add step
              </button>
            </div>
          </div>

          {/* Settings + Execute */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3.5 shrink-0">
            {/* Browser */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500 shrink-0 w-20">Browser</span>
              <div className="flex gap-1.5">
                {(['chromium', 'firefox', 'webkit'] as const).map(b => (
                  <button key={b} onClick={() => setBrowser(b)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all capitalize ${browser === b ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}>
                    {b}
                  </button>
                ))}
              </div>
            </div>

            {/* Execution mode */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500 shrink-0 w-20">Execution</span>
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => setRunnerMode('server')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${runnerMode === 'server' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                  <EyeOff className="w-3.5 h-3.5" /> Server
                </button>
                <button onClick={() => setRunnerMode('local')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${runnerMode === 'local' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Monitor className="w-3.5 h-3.5" /> Local
                </button>
              </div>
            </div>

            {/* Local runner setup instructions */}
            {runnerMode === 'local' && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Terminal command</p>
                  {loadingToken && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
                </div>
                <div className="bg-zinc-950 p-3 space-y-3">
                  {loadingToken ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500 py-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading token…</div>
                  ) : runnerToken ? (
                    <>
                      <div className="space-y-1">
                        <p className="text-[11px] text-zinc-500 font-mono">npx tsx scripts/local-runner.ts \</p>
                        <p className="text-[11px] text-zinc-400 font-mono pl-4 break-all">--server {typeof window !== 'undefined' ? window.location.origin : ''} \</p>
                        <p className="text-[11px] text-emerald-400 font-mono pl-4 break-all">--token {runnerToken}</p>
                      </div>
                      <div className="flex items-center gap-3 pt-1 border-t border-zinc-800">
                        <button
                          onClick={() => { navigator.clipboard.writeText(`npx tsx scripts/local-runner.ts --server ${window.location.origin} --token ${runnerToken}`); toast.success('Copied!') }}
                          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors">
                          <Copy className="w-3.5 h-3.5" /> Copy
                        </button>
                        <button onClick={regenerateToken}
                          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-amber-400 transition-colors">
                          <RefreshCw className="w-3.5 h-3.5" /> Regenerate token
                        </button>
                      </div>
                    </>
                  ) : (
                    <button onClick={fetchToken} className="text-xs text-violet-400 hover:underline py-1">Load token</button>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={handleExecute} disabled={isExecuting}
                className="flex-1 bg-violet-600 hover:bg-violet-700 gap-1.5">
                {isExecuting ? <><Loader2 className="w-4 h-4 animate-spin" /> Executing…</> : <><Play className="w-4 h-4" /> Execute</>}
              </Button>
              {isExecuting && (
                <button onClick={() => { abortRef.current?.abort(); setIsExecuting(false) }}
                  className="text-xs text-red-500 hover:text-red-700 underline shrink-0">
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Console ── */}
        <div className="flex-1 flex flex-col bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 min-h-0">
          {/* Console header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900 shrink-0">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-zinc-500 font-mono ml-2">qa-agent console</span>
            {isExecuting && (
              <Badge className="ml-auto bg-violet-900/60 text-violet-300 border border-violet-700 text-xs px-2 py-0">
                <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" /> running
              </Badge>
            )}
          </div>

          {/* Console output */}
          <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-5 min-h-0">
            {consoleLines.length === 0 ? (
              <div className="text-zinc-600 text-center py-16">
                <Terminal className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>Console output will appear here</p>
                <p className="mt-1 text-zinc-700">Enter an instruction or Jira issue, then click Execute</p>
              </div>
            ) : consoleLines.map((line, i) => {
              const style = EVENT_STYLE[line.type] ?? { tag: '···', color: 'text-slate-400' }
              const extra = line.type === 'step_done'
                ? (line.text.startsWith('PASS') ? 'text-emerald-400' : 'text-red-400')
                : line.type === 'locator_try'
                ? (line.text.startsWith('✓') ? 'text-emerald-500' : 'text-red-500')
                : style.color
              return (
                <div key={i} className="flex gap-2 hover:bg-zinc-900/50 px-1 rounded">
                  <span className="text-zinc-700 shrink-0 w-16">{line.ts}</span>
                  <span className={`shrink-0 w-10 text-right ${style.color} opacity-70`}>[{style.tag}]</span>
                  <span className={extra}>{line.text}</span>
                </div>
              )
            })}
            <div ref={consoleEndRef} />
          </div>

          {/* Summary bar */}
          {execResult && (
            <div className={`shrink-0 flex items-center gap-4 px-4 py-2.5 border-t border-zinc-800 ${
              execResult.failed === 0 ? 'bg-emerald-950/60' : execResult.passed === 0 ? 'bg-red-950/60' : 'bg-amber-950/60'
            }`}>
              {execResult.failed === 0
                ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                : execResult.passed === 0
                ? <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                : <MinusCircle className="w-4 h-4 text-amber-400 shrink-0" />}
              <span className="text-xs font-mono">
                <span className="text-emerald-400">✓ {execResult.passed} passed</span>
                <span className="text-zinc-600 mx-2">·</span>
                <span className="text-red-400">✗ {execResult.failed} failed</span>
                <span className="text-zinc-600 mx-2">·</span>
                <span className="text-zinc-500">⏱ {(execResult.duration / 1000).toFixed(2)}s</span>
              </span>
              {runId && (
                <Link
                  href={`/apps/${appId}/reports/${runId}`}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-lg bg-violet-600/30 hover:bg-violet-600/50 text-violet-300 hover:text-violet-100 text-xs font-medium transition-all border border-violet-500/30"
                >
                  <FileText className="w-3.5 h-3.5" />
                  View Full Report
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
