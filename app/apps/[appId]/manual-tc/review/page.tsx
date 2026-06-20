'use client'

import { useState, useRef } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import StreamingOutput, { StreamingOutputHandle } from '@/components/apps/StreamingOutput'
import EditableTestCases, { TestCase } from '@/components/apps/EditableTestCases'
import { toast } from 'sonner'
import { Telescope, TestTube, Save, Zap, CheckCircle, FileText, X, ArrowLeft, RefreshCw } from 'lucide-react'

const STEPS = [
  { id: 1, label: 'Input', icon: TestTube },
  { id: 2, label: 'Explore App', icon: Telescope },
  { id: 3, label: 'Generate TCs', icon: Zap },
  { id: 4, label: 'Review & Save', icon: Save },
]

export default function ManualTCReviewPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const appId = params.appId as string

  const issueKey = searchParams.get('issueKey') ?? ''
  const prompt = searchParams.get('prompt') ?? ''

  const [pageStep, setPageStep] = useState(3) // 3 = Generate, 4 = Review
  const [testCases, setTestCases] = useState<TestCase[]>([])
  const [generateDone, setGenerateDone] = useState(false)
  const [generateRound, setGenerateRound] = useState(0)
  const [saving, setSaving] = useState(false)

  const generateRef = useRef<StreamingOutputHandle>(null)

  function handleGenerateDone(data: string) {
    try {
      const parsed: TestCase[] = JSON.parse(data)
      setTestCases(parsed)
      setGenerateDone(true)
      setPageStep(4)
    } catch {
      toast.error('Failed to parse generated test cases')
    }
  }

  function handleRegenerate() {
    setGenerateDone(false)
    setTestCases([])
    setPageStep(3)
    setGenerateRound((r) => r + 1)
    setTimeout(() => generateRef.current?.start(), 100)
  }

  function goBack() {
    const p = new URLSearchParams()
    if (issueKey) p.set('issueKey', issueKey)
    if (prompt) p.set('prompt', prompt)
    router.push(`/apps/${appId}/manual-tc?${p.toString()}`)
  }

  async function handleSave() {
    if (!issueKey.trim()) { toast.error('No issue key — go back and enter one'); return }
    if (testCases.length === 0) { toast.error('No test cases to save'); return }
    setSaving(true)
    try {
      const steps = testCases.flatMap((tc) =>
        tc.steps.map((s, i) => ({ step: s, expected: tc.stepExpected?.[i] || tc.expectedResult }))
      )
      const res = await fetch(`/api/jira/issues/${issueKey.trim().toUpperCase()}/test-steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps }),
      })
      if (res.ok) {
        toast.success('Test steps saved to Jira!')
        setTimeout(() => router.push(`/apps/${appId}/work-items`), 800)
      } else {
        toast.error('Failed to save to Jira')
      }
    } catch {
      toast.error('Failed to save to Jira')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const isPast = s.id <= 2
          const isDone = pageStep > s.id
          const active = pageStep === s.id
          return (
            <div key={s.id} className="flex items-center flex-1">
              <button
                onClick={() => {
                  if (isPast) goBack()
                  else if (isDone) setPageStep(s.id)
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active ? 'bg-violet-600 text-white shadow-md' :
                  isDone || isPast ? 'bg-emerald-100 text-emerald-700 cursor-pointer hover:bg-emerald-200' :
                  'bg-white border border-slate-200 text-slate-400 cursor-default'
                }`}
              >
                {(isDone || isPast) && !active ? <CheckCircle className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{s.id}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 ${isDone || isPast ? 'bg-emerald-300' : 'bg-slate-200'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Context strip */}
      <div className="flex items-center gap-3 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
        <button onClick={goBack} className="flex items-center gap-1.5 text-violet-600 hover:text-violet-800 font-medium shrink-0">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Explore
        </button>
        <span className="text-slate-300">|</span>
        {issueKey && <span>Issue: <span className="font-mono font-semibold text-slate-700">{issueKey}</span></span>}
        {prompt && <span className="truncate">"{prompt}"</span>}
      </div>

      {/* Step 3 — Generate */}
      <div className={`bg-slate-900 rounded-xl shadow-sm p-6 space-y-4 ${pageStep > 3 ? 'border border-emerald-800/60' : 'border border-slate-700'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {pageStep > 3
              ? <Badge className="bg-emerald-900/60 text-emerald-400 border-emerald-700 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Step 3</Badge>
              : <Badge className="bg-amber-900/60 text-amber-400 border-amber-700">Step 3</Badge>
            }
            <h2 className="text-sm font-semibold text-slate-100">Generate Test Cases</h2>
          </div>
          {generateDone && (
            <Button size="sm" variant="outline" onClick={handleRegenerate} className="gap-1.5 text-xs border-amber-600 text-amber-400 hover:bg-amber-900/30">
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-400">AI writes test cases using real field names and UI structure from the exploration.</p>

        <StreamingOutput
          key={generateRound}
          ref={generateRef}
          endpoint="/api/agents/generate-tc"
          body={{ issueKey: issueKey || undefined, appId }}
          onDone={handleGenerateDone}
          onError={(e) => toast.error(`Generation failed: ${e}`)}
          label="Test Case Generator"
          autoStart
        />

        {/* TC preview cards — shown before proceeding to review */}
        {generateDone && pageStep === 3 && testCases.length > 0 && (
          <div className="space-y-3 pt-1">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              {testCases.length} test case{testCases.length !== 1 ? 's' : ''} generated
            </p>
            {testCases.map((tc) => (
              <div key={tc.id} className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="font-mono text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-semibold">{tc.id}</span>
                  <span className="font-semibold text-sm text-slate-800">{tc.title}</span>
                  <div className="flex gap-1.5 ml-auto">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      tc.type === 'positive' ? 'bg-emerald-100 text-emerald-700' :
                      tc.type === 'negative' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                    }`}>{tc.type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      tc.priority === 'high' ? 'bg-red-100 text-red-700' :
                      tc.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-600'
                    }`}>{tc.priority}</span>
                  </div>
                </div>
                <ol className="space-y-1.5">
                  {tc.steps.map((step, i) => (
                    <li key={i} className="grid grid-cols-[20px_1fr_1fr] gap-x-3 items-start text-sm">
                      <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                      <span className="text-slate-700">{step}</span>
                      {tc.stepExpected?.[i] && (
                        <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5 self-start">{tc.stepExpected[i]}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            <Button onClick={() => setPageStep(4)} className="bg-violet-600 hover:bg-violet-700 gap-1.5">
              <FileText className="w-4 h-4" /> Proceed to Review & Save
            </Button>
          </div>
        )}
      </div>

      {/* Step 4 — Review & Save */}
      {pageStep >= 4 && testCases.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Step 4</Badge>
              <h2 className="text-sm font-semibold text-slate-800">
                Review & Save ({testCases.length} test case{testCases.length !== 1 ? 's' : ''})
              </h2>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={goBack}
                className="bg-red-500 hover:bg-red-600 text-white text-sm gap-1.5">
                <X className="w-4 h-4" /> Cancel
              </Button>
              <Button variant="outline"
                onClick={() => router.push(`/apps/${appId}/automation?issueKey=${issueKey}`)}
                className="border-violet-300 text-violet-700 hover:bg-violet-50 text-sm">
                Generate Automation →
              </Button>
              <Button onClick={handleSave} disabled={saving || !issueKey.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 gap-1.5">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save to Jira'}
              </Button>
            </div>
          </div>

          {!issueKey.trim() && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No issue key found. <button onClick={goBack} className="underline font-medium">Go back</button> and enter one.
            </p>
          )}

          {/* Jira table preview */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Jira test step table preview
            </p>
            <div className="rounded border border-slate-200 overflow-hidden text-xs">
              <div className="grid grid-cols-[32px_1fr_1fr] bg-slate-200">
                <div className="px-2 py-1.5 text-center font-semibold text-slate-600">#</div>
                <div className="px-3 py-1.5 font-semibold text-slate-600 border-l border-slate-300">Test Step</div>
                <div className="px-3 py-1.5 font-semibold text-slate-600 border-l border-slate-300">Expected Result</div>
              </div>
              {testCases.flatMap((tc) =>
                tc.steps.map((s, si) => ({ step: s, expected: tc.stepExpected?.[si] || tc.expectedResult }))
              ).map((row, i) => (
                <div key={i} className="grid grid-cols-[32px_1fr_1fr] border-t border-slate-200 bg-white">
                  <div className="px-2 py-1.5 text-center text-slate-400 font-mono">{i + 1}</div>
                  <div className="px-3 py-1.5 text-slate-700 border-l border-slate-100">{row.step}</div>
                  <div className="px-3 py-1.5 text-slate-600 border-l border-slate-100">{row.expected}</div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-400">Edit the test cases below before saving:</p>
          <EditableTestCases testCases={testCases} onChange={setTestCases} />
        </div>
      )}
    </div>
  )
}
