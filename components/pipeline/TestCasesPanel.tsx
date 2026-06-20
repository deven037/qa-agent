'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ClipboardList, RefreshCw } from 'lucide-react'

interface Issue { key: string; summary: string }

interface Props {
  projectKey: string
  onSelectIssue: (key: string) => void
  selectedKey?: string
}

export default function TestCasesPanel({ projectKey, onSelectIssue, selectedKey }: Props) {
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function fetchIssues() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/jira/issues?project=${projectKey}&q=`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setIssues(data)
    } catch {
      setError('Could not load test cases.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchIssues() }, [projectKey])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-violet-500" />
            <h2 className="text-sm font-semibold text-slate-800">Test Cases</h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 pl-6">
            {loading ? 'Loading...' : `${issues.length} in ${projectKey}`}
          </p>
        </div>
        <button
          onClick={fetchIssues}
          disabled={loading}
          className="p-1.5 rounded-md text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-1.5">
        {loading && (
          <>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-3 rounded-lg bg-slate-50 animate-pulse space-y-2">
                <div className="h-3.5 w-14 bg-slate-200 rounded-full" />
                <div className="h-3 w-full bg-slate-200 rounded" />
                <div className="h-3 w-3/4 bg-slate-200 rounded" />
              </div>
            ))}
          </>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center h-40 text-center px-4 space-y-2">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={fetchIssues} className="text-xs text-violet-600 hover:underline">Retry</button>
          </div>
        )}

        {!loading && !error && issues.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-center px-4 space-y-1.5">
            <ClipboardList className="w-8 h-8 text-slate-200" />
            <p className="text-sm text-slate-400 font-medium">No test cases yet</p>
            <p className="text-xs text-slate-300">Create one using the panel on the right</p>
          </div>
        )}

        {!loading && !error && issues.map((issue) => (
          <button
            key={issue.key}
            onClick={() => onSelectIssue(issue.key)}
            className={`w-full text-left p-3 rounded-lg border transition-all group ${
              selectedKey === issue.key
                ? 'border-violet-300 bg-violet-50 shadow-sm'
                : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Badge
              variant="outline"
              className={`text-xs mb-1.5 font-mono ${selectedKey === issue.key ? 'border-violet-300 text-violet-700' : ''}`}
            >
              {issue.key}
            </Badge>
            <p className={`text-xs leading-snug line-clamp-2 ${
              selectedKey === issue.key ? 'text-violet-700' : 'text-slate-600 group-hover:text-slate-800'
            }`}>
              {issue.summary}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
