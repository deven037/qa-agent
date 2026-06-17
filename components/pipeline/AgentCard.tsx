'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Props {
  name: string
  status: 'pending' | 'running' | 'done' | 'error'
  output: string
  isScenarioCheck?: boolean
}

const STATUS_STYLES = {
  pending: 'bg-slate-100 text-slate-400',
  running: 'bg-violet-100 text-violet-600',
  done: 'bg-green-100 text-green-600',
  error: 'bg-red-100 text-red-600',
}

const STATUS_ICONS = {
  pending: '○',
  running: '◐',
  done: '✓',
  error: '✕',
}

export default function AgentCard({ name, status, output, isScenarioCheck }: Props) {
  const [expanded, setExpanded] = useState(status === 'running')

  useEffect(() => {
    if (status === 'running') setExpanded(true)
    if (status === 'done') setExpanded(false)
  }, [status])

  const borderColor = isScenarioCheck
    ? 'border-l-blue-400'
    : status === 'running'
    ? 'border-l-violet-500'
    : status === 'done'
    ? 'border-l-green-400'
    : status === 'error'
    ? 'border-l-red-400'
    : 'border-l-slate-200'

  return (
    <Card className={`border-l-4 ${borderColor} transition-all`}>
      <CardHeader
        className="py-3 px-4 cursor-pointer flex-row items-center justify-between space-y-0"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${STATUS_STYLES[status]}`}>
            {status === 'running' ? <span className="animate-spin">◐</span> : STATUS_ICONS[status]}
          </span>
          <span className="font-medium text-sm">{name}</span>
          {isScenarioCheck && <Badge variant="outline" className="text-xs border-blue-300 text-blue-600">Jira Lookup</Badge>}
        </div>
        <Badge variant="outline" className="text-xs capitalize">{status}</Badge>
      </CardHeader>
      {expanded && output && (
        <CardContent className="pt-0 px-4 pb-4">
          <pre className="text-xs text-slate-600 bg-slate-50 rounded-md p-3 overflow-auto max-h-64 whitespace-pre-wrap font-mono">
            {output}
          </pre>
        </CardContent>
      )}
    </Card>
  )
}
