'use client'

import { useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ShieldCheck, ShieldX, RefreshCw, Wand2, AlertTriangle, AlertCircle, Lightbulb, Copy, Check } from 'lucide-react'
import type { CodeReviewOutput, ReviewIssue } from '@/lib/agents/code-reviewer-agent'

const SEVERITY_META = {
  critical: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50 border-red-200', badge: 'bg-red-100 text-red-700', label: 'Critical' },
  warning:  { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-700', label: 'Warning' },
  suggestion: { icon: Lightbulb, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', badge: 'bg-blue-100 text-blue-700', label: 'Suggestion' },
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 90 ? 'text-emerald-600' : score >= 70 ? 'text-amber-600' : 'text-red-600'
  const ring = score >= 90 ? 'border-emerald-300 bg-emerald-50' : score >= 70 ? 'border-amber-300 bg-amber-50' : 'border-red-300 bg-red-50'
  return (
    <div className={`flex flex-col items-center justify-center w-20 h-20 rounded-full border-4 ${ring} shrink-0`}>
      <span className={`text-2xl font-bold ${color}`}>{score}</span>
      <span className="text-xs text-slate-500 font-medium">/ 100</span>
    </div>
  )
}

function IssueGroup({ severity, issues }: { severity: ReviewIssue['severity']; issues: ReviewIssue[] }) {
  const meta = SEVERITY_META[severity]
  const Icon = meta.icon
  if (issues.length === 0) return null
  return (
    <div className={`rounded-lg border ${meta.bg} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${meta.color}`} />
        <span className={`text-sm font-semibold ${meta.color}`}>{meta.label} ({issues.length})</span>
      </div>
      {issues.map((issue, i) => (
        <div key={i} className="pl-6 space-y-1">
          <div className="flex items-start gap-2">
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${meta.badge} shrink-0 mt-0.5`}>{issue.category}</span>
            {issue.line && <span className="text-xs text-slate-400 mt-0.5">line {issue.line}</span>}
          </div>
          <p className="text-sm text-slate-700">{issue.message}</p>
          {issue.fix && (
            <p className="text-xs text-slate-500 italic">Fix: {issue.fix}</p>
          )}
        </div>
      ))}
    </div>
  )
}

export default function CodeReviewPage() {
  const params = useParams()
  const appId = params.appId as string

  const [code, setCode] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [result, setResult] = useState<CodeReviewOutput | null>(null)
  const [streamLog, setStreamLog] = useState('')
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function runReview() {
    if (!code.trim()) return
    setReviewing(true)
    setResult(null)
    setStreamLog('')

    try {
      const res = await fetch(`/api/agents/code-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, appId }),
      })
      if (!res.ok || !res.body) throw new Error('Failed to start review')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)

        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload.startsWith('[DONE]')) {
            try { setResult(JSON.parse(payload.slice(7))) } catch { /* ignore */ }
          } else if (payload.startsWith('[ERROR]')) {
            setStreamLog((p) => p + '\n' + payload)
          } else {
            setStreamLog((p) => p + payload)
          }
        }
      }
    } catch (e) {
      setStreamLog((p) => p + `\nError: ${String(e)}`)
    } finally {
      setReviewing(false)
    }
  }

  function applyFix() {
    if (result?.revisedCode) {
      setCode(result.revisedCode)
      setResult(null)
      setStreamLog('')
      textareaRef.current?.focus()
    }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const criticals = result?.issues.filter((i) => i.severity === 'critical') ?? []
  const warnings = result?.issues.filter((i) => i.severity === 'warning') ?? []
  const suggestions = result?.issues.filter((i) => i.severity === 'suggestion') ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 tracking-tight">Code Review</h1>
        <p className="text-sm text-slate-500 mt-1">Senior architect review of platform source code — security, Next.js patterns, TypeScript quality, API design, React, and database usage.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left: code editor */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Playwright TypeScript</span>
            <div className="flex gap-2">
              <button onClick={copyCode} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste any platform source file here — API route, React component, lib utility, Mongoose model, agent..."
            className="w-full h-[520px] font-mono text-xs bg-slate-900 text-slate-100 rounded-xl border border-slate-700 p-4 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 leading-relaxed"
            spellCheck={false}
          />
          <Button
            onClick={runReview}
            disabled={reviewing || !code.trim()}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            {reviewing ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" /> Reviewing…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Run Code Review
              </span>
            )}
          </Button>
        </div>

        {/* Right: results */}
        <div className="space-y-4">
          {!result && !reviewing && !streamLog && (
            <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-slate-200 text-slate-400">
              <ShieldCheck className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Review results will appear here</p>
              <p className="text-xs mt-1">Paste code and click Run Code Review</p>
            </div>
          )}

          {reviewing && !result && (
            <div className="bg-slate-900 rounded-xl p-4 min-h-40 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
              {streamLog || <span className="text-amber-400 animate-pulse">Analyzing code…</span>}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Score + verdict */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center gap-4">
                  <ScoreBadge score={result.score} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {result.approved ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                          <ShieldCheck className="w-3 h-3 mr-1" /> Approved
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700 border-red-200">
                          <ShieldX className="w-3 h-3 mr-1" /> Needs Revision
                        </Badge>
                      )}
                      <span className="text-xs text-slate-400">
                        {criticals.length > 0 && `${criticals.length} critical`}
                        {warnings.length > 0 && ` · ${warnings.length} warning`}
                        {suggestions.length > 0 && ` · ${suggestions.length} suggestion`}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 leading-snug">{result.summary}</p>
                  </div>
                </div>

                {result.revisedCode && (
                  <Button
                    onClick={applyFix}
                    className="mt-4 w-full bg-violet-600 hover:bg-violet-700 text-white"
                    size="sm"
                  >
                    <Wand2 className="w-4 h-4 mr-2" /> Apply Auto-Fix
                  </Button>
                )}
              </div>

              {/* Issue groups */}
              <IssueGroup severity="critical" issues={criticals} />
              <IssueGroup severity="warning" issues={warnings} />
              <IssueGroup severity="suggestion" issues={suggestions} />

              {/* Re-review after fix */}
              <Button
                variant="outline"
                onClick={runReview}
                disabled={reviewing}
                className="w-full text-sm"
                size="sm"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-2" /> Re-Review
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
