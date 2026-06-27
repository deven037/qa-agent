'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'

export interface TestStep {
  description: string
  action: string
  target: string
  value?: string
  locator?: string | null
  expected: string
  verified?: boolean
}

export interface TestCase {
  id: string
  title: string
  type: 'positive' | 'negative' | 'edge'
  priority: 'high' | 'medium' | 'low'
  steps: string[]
  stepExpected?: string[]
  expectedResult: string
  structuredSteps?: TestStep[]
  verificationStatus?: { verified: number; total: number; unresolvedIndices: number[] }
}

interface Props {
  testCases: TestCase[]
  onChange: (cases: TestCase[]) => void
}

const TYPE_COLORS: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  negative: 'bg-red-100 text-red-700 border-red-200',
  edge: 'bg-amber-100 text-amber-700 border-amber-200',
}
const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-50 text-red-600 border-red-200',
  medium: 'bg-amber-50 text-amber-600 border-amber-200',
  low: 'bg-slate-50 text-slate-500 border-slate-200',
}

export default function EditableTestCases({ testCases, onChange }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([testCases[0]?.id]))

  function update(idx: number, updated: Partial<TestCase>) {
    const next = testCases.map((tc, i) => i === idx ? { ...tc, ...updated } : tc)
    onChange(next)
  }

  function updateStep(tcIdx: number, stepIdx: number, value: string) {
    const steps = [...testCases[tcIdx].steps]
    steps[stepIdx] = value
    update(tcIdx, { steps })
  }

  function updateStepExpected(tcIdx: number, stepIdx: number, value: string) {
    const stepExpected = [...(testCases[tcIdx].stepExpected ?? testCases[tcIdx].steps.map(() => ''))]
    stepExpected[stepIdx] = value
    update(tcIdx, { stepExpected })
  }

  function addStep(tcIdx: number) {
    const steps = [...testCases[tcIdx].steps, '']
    const stepExpected = [...(testCases[tcIdx].stepExpected ?? testCases[tcIdx].steps.map(() => '')), '']
    update(tcIdx, { steps, stepExpected })
  }

  function removeStep(tcIdx: number, stepIdx: number) {
    const steps = testCases[tcIdx].steps.filter((_, i) => i !== stepIdx)
    const stepExpected = (testCases[tcIdx].stepExpected ?? []).filter((_, i) => i !== stepIdx)
    update(tcIdx, { steps, stepExpected })
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {testCases.map((tc, tcIdx) => (
        <div key={tc.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
          {/* Header */}
          <button
            onClick={() => toggleExpand(tc.id)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
          >
            {expanded.has(tc.id)
              ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
              : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
            <span className="text-xs font-mono text-slate-400 shrink-0">{tc.id}</span>
            <span className="text-sm font-medium text-slate-800 flex-1 truncate">{tc.title}</span>
            <Badge className={`text-xs border ${TYPE_COLORS[tc.type]}`}>{tc.type}</Badge>
            <Badge className={`text-xs border ${PRIORITY_COLORS[tc.priority]}`}>{tc.priority}</Badge>
          </button>

          {/* Body */}
          {expanded.has(tc.id) && (
            <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-3">
              {/* Title edit */}
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Title</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  value={tc.title}
                  onChange={(e) => update(tcIdx, { title: e.target.value })}
                />
              </div>

              {/* Steps with inline expected results */}
              <div>
                <div className="grid grid-cols-[24px_1fr_1fr_20px] gap-x-2 mb-1.5">
                  <div />
                  <label className="text-xs font-medium text-slate-500">Steps</label>
                  <label className="text-xs font-medium text-emerald-600">Expected Result</label>
                  <div />
                </div>
                <div className="space-y-2">
                  {tc.steps.map((step, stepIdx) => (
                    <div key={stepIdx} className="grid grid-cols-[24px_1fr_1fr_20px] gap-x-2 items-start">
                      <span className="text-xs text-slate-400 pt-2 text-right">{stepIdx + 1}.</span>
                      <input
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                        value={step}
                        onChange={(e) => updateStep(tcIdx, stepIdx, e.target.value)}
                        placeholder={`Step ${stepIdx + 1}…`}
                      />
                      <input
                        className="border border-emerald-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-emerald-50/40 placeholder:text-slate-300"
                        value={(tc.stepExpected ?? [])[stepIdx] ?? ''}
                        onChange={(e) => updateStepExpected(tcIdx, stepIdx, e.target.value)}
                        placeholder="Expected outcome…"
                      />
                      <button
                        onClick={() => removeStep(tcIdx, stepIdx)}
                        className="text-slate-300 hover:text-red-400 transition-colors pt-2"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addStep(tcIdx)}
                    className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 mt-1 col-start-2"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add step
                  </button>
                </div>
              </div>

              {/* Overall Expected Result */}
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Overall Expected Result</label>
                <textarea
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
                  rows={2}
                  value={tc.expectedResult}
                  onChange={(e) => update(tcIdx, { expectedResult: e.target.value })}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
