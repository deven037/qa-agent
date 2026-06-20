'use client'

import { useState, useRef, Fragment } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Play, ChevronDown, ChevronRight, Clock, CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import StreamingOutput, { StreamingOutputHandle } from './StreamingOutput'

interface TestIssue {
  key: string
  summary: string
  status: 'passed' | 'failed' | 'partial' | 'not-run'
  lastExecuted?: string
  createdAt?: string
}

interface Props {
  issues: TestIssue[]
  appId: string
}

const STATUS_CONFIG = {
  passed:    { label: 'Passed',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  failed:    { label: 'Failed',   color: 'bg-red-100 text-red-700 border-red-200',             icon: XCircle },
  partial:   { label: 'Partial',  color: 'bg-amber-100 text-amber-700 border-amber-200',       icon: MinusCircle },
  'not-run': { label: 'Not Run',  color: 'bg-slate-100 text-slate-500 border-slate-200',       icon: Clock },
}

export default function AutomationTable({ issues, appId }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const refs = useRef<Record<string, StreamingOutputHandle | null>>({})

  function handleRun(key: string) {
    setExpanded(key)
    setTimeout(() => refs.current[key]?.start(), 100)
  }

  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
        <Clock className="w-8 h-8 text-slate-300" />
        <p className="text-sm">No automation tests yet. Generate scripts from the Automation page.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Issue</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Title</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Last Run</th>
            <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => {
            const cfg = STATUS_CONFIG[issue.status]
            const Icon = cfg.icon
            const isExpanded = expanded === issue.key
            return (
              <Fragment key={issue.key}>
                <tr className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4">
                    <span className="font-mono text-xs text-violet-600 font-semibold">{issue.key}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-700 max-w-xs truncate">{issue.summary}</td>
                  <td className="py-3 px-4">
                    <Badge className={`text-xs border gap-1 ${cfg.color}`}>
                      <Icon className="w-3 h-3" />
                      {cfg.label}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 text-slate-400 text-xs">{issue.lastExecuted ?? '—'}</td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        size="sm"
                        onClick={() => handleRun(issue.key)}
                        className="bg-violet-600 hover:bg-violet-700 h-7 px-3 text-xs gap-1.5"
                      >
                        <Play className="w-3 h-3" />
                        Run
                      </Button>
                      <button
                        onClick={() => setExpanded(isExpanded ? null : issue.key)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={5} className="px-4 pb-4 pt-2 bg-slate-50">
                      <StreamingOutput
                        ref={(el) => { refs.current[issue.key] = el }}
                        endpoint="/api/agents/execute"
                        body={{ issueKey: issue.key, appId, headed: false }}
                        label={`Running ${issue.key}...`}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
