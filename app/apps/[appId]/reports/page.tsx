'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, XCircle, Clock, FileText } from 'lucide-react'

interface RunSummary {
  runId: string
  title: string
  issueKey?: string
  status: 'passed' | 'failed'
  passed: number
  failed: number
  duration: number
  browser: string
  executedAt: string
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function ReportsListPage() {
  const params = useParams()
  const appId = params.appId as string
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/test-runs?appId=${appId}&limit=20`)
      .then(r => r.json())
      .then(setRuns)
      .finally(() => setLoading(false))
  }, [appId])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <FileText className="w-5 h-5 text-violet-500" />
        <h1 className="text-base font-semibold text-slate-800">Recent Test Reports</h1>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">auto-deleted after 2 days</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 rounded-full border-2 border-violet-400/30 border-t-violet-500 animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="text-sm">No test reports yet.</p>
          <p className="text-xs mt-1">Run a test from the Automation page to see reports here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map(run => (
            <Link
              key={run.runId}
              href={`/apps/${appId}/reports/${run.runId}`}
              className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 bg-white hover:border-violet-300 hover:shadow-sm transition-all group"
            >
              {run.status === 'passed'
                ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                : <XCircle className="w-5 h-5 text-red-500 shrink-0" />}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{run.title}</p>
                {run.issueKey && (
                  <p className="text-xs text-slate-400 font-mono">{run.issueKey}</p>
                )}
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-500 shrink-0">
                <span className="text-emerald-600 font-medium">✓ {run.passed}</span>
                <span className="text-red-500 font-medium">✗ {run.failed}</span>
                <span>{(run.duration / 1000).toFixed(1)}s</span>
                <span className="font-mono text-slate-400">{run.browser}</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(run.executedAt)}</span>
              </div>

              <span className="text-violet-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                View →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
