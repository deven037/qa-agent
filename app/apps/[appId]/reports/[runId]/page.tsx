'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  CheckCircle2, XCircle, ChevronDown, ChevronRight,
  ArrowLeft, Clock, Globe, Cpu, AlertTriangle, Zap, MousePointer2,
} from 'lucide-react'
import type { TestRunDoc, StepRecord } from '@/lib/db/models/TestRun'

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function expiresAt(createdAt: string) {
  const d = new Date(new Date(createdAt).getTime() + 172800000)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function StepCard({ step, index }: { step: StepRecord; index: number }) {
  const [open, setOpen] = useState(step.status === 'failed')
  const passed = step.status === 'passed'

  return (
    <div className={`rounded-xl border ${passed ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'} shadow-sm`}>
      {/* Header */}
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        {passed
          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
        <span className="text-xs text-slate-400 font-mono shrink-0 w-5">#{index + 1}</span>
        <span className="text-sm text-slate-700 flex-1 text-left font-medium">{step.description}</span>
        <div className="flex items-center gap-2 shrink-0">
          {step.healingAttempts > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
              <Zap className="w-3 h-3" /> healed
            </span>
          )}
          {step.duration != null && (
            <span className="text-xs text-slate-400 font-mono">{(step.duration / 1000).toFixed(2)}s</span>
          )}
          {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">

          {/* Meta grid */}
          <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
            {step.action && <>
              <span className="text-slate-400 flex items-center gap-1.5"><MousePointer2 className="w-3.5 h-3.5" />Action</span>
              <span className="text-violet-600 font-mono font-medium">{step.action}</span>
            </>}
            {step.resolvedLocator && <>
              <span className="text-slate-400">Locator used</span>
              <code className="text-emerald-700 font-mono bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-xs">{step.resolvedLocator}</code>
            </>}
            {step.pageUrl && <>
              <span className="text-slate-400">Page URL</span>
              <span className="text-slate-600 text-xs truncate">{step.pageUrl}</span>
            </>}
            {step.domFieldCount != null && <>
              <span className="text-slate-400">DOM fields</span>
              <span className="text-slate-600 text-xs">{step.domFieldCount} input{step.domFieldCount !== 1 ? 's' : ''} found</span>
            </>}
          </div>

          {/* Locator attempts */}
          {step.locatorAttempts.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Locator Attempts</p>
              <div className="space-y-1.5">
                {step.locatorAttempts.map((a, i) => (
                  <div key={i} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-mono border ${
                    a.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}>
                    <span className={`font-bold shrink-0 ${a.success ? 'text-emerald-500' : 'text-red-400'}`}>{a.success ? '✓' : '✗'}</span>
                    <code className="flex-1 truncate">{a.locator}</code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Healing */}
          {step.healingAttempts > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5 mb-1">
                <Zap className="w-3.5 h-3.5" />
                Self-healed — {step.healingAttempts} attempt{step.healingAttempts > 1 ? 's' : ''}
              </p>
              {step.healingRationale && (
                <p className="text-xs text-amber-600">{step.healingRationale}</p>
              )}
            </div>
          )}

          {/* Error */}
          {step.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-xs font-semibold text-red-600 flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Error
              </p>
              <p className="text-xs text-red-700 font-mono">{step.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ReportPage() {
  const params = useParams()
  const appId = params.appId as string
  const runId = params.runId as string

  const [run, setRun] = useState<TestRunDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch(`/api/test-runs/${runId}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (d) setRun(d) })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [runId])

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin" />
      </div>
    )
  }

  if (notFound || !run) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-4">
        <AlertTriangle className="w-10 h-10 text-amber-400" />
        <h1 className="text-xl font-semibold text-slate-700">Report not found or expired</h1>
        <p className="text-slate-500 text-sm">Reports are automatically deleted 2 days after execution.</p>
        <Link href={`/apps/${appId}/automation`} className="text-violet-600 hover:text-violet-700 text-sm flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Automation
        </Link>
      </div>
    )
  }

  const passed = run.failed === 0
  const partial = run.passed > 0 && run.failed > 0
  const healedCount = run.steps.filter(s => s.healingAttempts > 0).length

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

      {/* Back */}
      <Link href={`/apps/${appId}/automation`}
        className="inline-flex items-center gap-1.5 text-slate-500 hover:text-violet-600 text-sm transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Automation
      </Link>

      {/* Header card */}
      <div className={`rounded-2xl border p-6 ${
        passed ? 'border-emerald-200 bg-emerald-50' :
        partial ? 'border-amber-200 bg-amber-50' :
                  'border-red-200 bg-red-50'
      }`}>
        <div className="flex items-start gap-4">
          {passed
            ? <CheckCircle2 className="w-9 h-9 text-emerald-500 shrink-0 mt-0.5" />
            : <XCircle className="w-9 h-9 text-red-500 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-slate-800 leading-snug">{run.title}</h1>
            {run.issueKey && (
              <span className="text-xs text-slate-500 font-mono mt-0.5 block">{run.issueKey}</span>
            )}
            <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{timeAgo(String(run.executedAt))}</span>
              <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" />{run.browser}</span>
              <span className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" />{run.runner} runner</span>
            </div>
          </div>
          <span className={`text-2xl font-bold shrink-0 ${
            passed ? 'text-emerald-600' : partial ? 'text-amber-600' : 'text-red-600'
          }`}>
            {passed ? 'PASSED' : partial ? 'PARTIAL' : 'FAILED'}
          </span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Passed', value: run.passed, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
          { label: 'Failed', value: run.failed, color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
          { label: 'Duration', value: `${(run.duration / 1000).toFixed(2)}s`, color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' },
          { label: 'Healed', value: healedCount, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`rounded-xl border ${bg} px-4 py-3 text-center`}>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-0.5 font-medium">{label}</div>
          </div>
        ))}
      </div>

      {/* Steps */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Steps ({run.steps.length})</h2>
        <div className="space-y-2">
          {run.steps.map((step, i) => (
            <StepCard key={i} step={step} index={i} />
          ))}
        </div>
      </div>

      {/* Navigation timeline */}
      {run.navEvents.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Navigation Timeline</h2>
          <div className="rounded-xl bg-white border border-slate-200 shadow-sm divide-y divide-slate-100">
            {run.navEvents.map((nav, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <span className="text-slate-400 font-mono shrink-0 w-5">#{i + 1}</span>
                <span className="text-teal-500 font-bold shrink-0">→</span>
                <span className="text-slate-700 font-mono truncate flex-1">{nav.url}</span>
                {nav.stepIndex >= 0 && (
                  <span className="text-slate-400 shrink-0">step {nav.stepIndex + 1}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <p className="text-xs text-slate-400 text-center pb-4">
        ⏰ This report expires on {expiresAt(String(run.createdAt))}
      </p>
    </div>
  )
}
