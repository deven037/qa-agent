'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface TestResult {
  title: string
  status: 'passed' | 'failed' | 'skipped'
  duration: number
  error?: string
}

interface ExecutionResult {
  passed: number
  failed: number
  skipped: number
  duration: number
  testResults: TestResult[]
  error?: string
}

interface TestCase {
  id: string
  title: string
  type: string
  priority: string
}

interface Props {
  executionResult: Record<string, unknown>
  testCases: unknown[]
  issueKey: string
}

const STATUS_BADGE: Record<string, string> = {
  passed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-slate-100 text-slate-500',
}

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-600',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-slate-100 text-slate-500',
}

export default function ResultsPanel({ executionResult, testCases, issueKey }: Props) {
  const result = executionResult as unknown as ExecutionResult
  const cases = testCases as TestCase[]

  return (
    <div className="space-y-4">
      {/* Execution summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution Results — {issueKey}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 text-center mb-4">
            <div>
              <div className="text-2xl font-bold text-green-600">{result.passed ?? 0}</div>
              <div className="text-xs text-slate-400">Passed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-500">{result.failed ?? 0}</div>
              <div className="text-xs text-slate-400">Failed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-400">{result.skipped ?? 0}</div>
              <div className="text-xs text-slate-400">Skipped</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-600">{((result.duration ?? 0) / 1000).toFixed(1)}s</div>
              <div className="text-xs text-slate-400">Duration</div>
            </div>
          </div>

          {result.testResults?.length > 0 && (
            <div className="space-y-1">
              {result.testResults.map((t, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 px-3 bg-slate-50 rounded text-sm">
                  <span className="text-slate-700">{t.title}</span>
                  <div className="flex items-center gap-2">
                    {t.duration > 0 && <span className="text-xs text-slate-400">{t.duration}ms</span>}
                    <Badge className={`text-xs ${STATUS_BADGE[t.status] ?? ''}`}>{t.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.error && (
            <p className="text-sm text-red-500 mt-2">Execution error: {result.error}</p>
          )}
        </CardContent>
      </Card>

      {/* Test cases */}
      {cases.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generated Test Cases ({cases.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {cases.map((tc) => (
                <div key={tc.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded text-sm">
                  <div>
                    <span className="font-mono text-xs text-slate-400 mr-2">{tc.id}</span>
                    <span className="text-slate-700">{tc.title}</span>
                  </div>
                  <div className="flex gap-1">
                    <Badge variant="outline" className="text-xs capitalize">{tc.type}</Badge>
                    <Badge className={`text-xs ${PRIORITY_BADGE[tc.priority] ?? ''}`}>{tc.priority}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
