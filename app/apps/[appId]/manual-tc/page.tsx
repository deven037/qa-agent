'use client'

import { useState, useRef, useEffect } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import StreamingOutput, { StreamingOutputHandle } from '@/components/apps/StreamingOutput'
import { Telescope, TestTube, Save, Zap, CheckCircle, RefreshCw, ChevronRight, ArrowRight } from 'lucide-react'

const STEPS = [
  { id: 1, label: 'Input', icon: TestTube },
  { id: 2, label: 'Explore App', icon: Telescope },
  { id: 3, label: 'Generate TCs', icon: Zap },
  { id: 4, label: 'Review & Save', icon: Save },
]

interface ExploredPage {
  title: string
  path: string
  module: string
  formsCount: number
  buttonsCount: number
  forms: { name: string; fields: string[]; submitLabel: string | null }[]
  buttons: string[]
}

export default function ManualTCPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const appId = params.appId as string

  const [step, setStep] = useState(1)
  const [issueKey, setIssueKey] = useState(searchParams.get('issueKey') ?? '')
  const [prompt, setPrompt] = useState(searchParams.get('prompt') ?? '')
  const [exploredPages, setExploredPages] = useState<ExploredPage[]>([])
  const [exploreRound, setExploreRound] = useState(0)
  const [exploreDone, setExploreDone] = useState(false)

  const exploreRef = useRef<StreamingOutputHandle>(null)

  useEffect(() => {
    const key = searchParams.get('issueKey')
    if (key) setIssueKey(key)
  }, [searchParams])

  function handleExploreDone(data: string) {
    try {
      const parsed = JSON.parse(data)
      if (parsed.pages) setExploredPages(parsed.pages)
    } catch { /* plain context string fallback */ }
    setExploreDone(true)
  }

  function handleExploreAgain() {
    setExploreDone(false)
    setExploredPages([])
    setExploreRound((r) => r + 1)
    setTimeout(() => exploreRef.current?.start(), 100)
  }

  function handleContinue() {
    const params = new URLSearchParams()
    if (issueKey.trim()) params.set('issueKey', issueKey.trim())
    if (prompt.trim()) params.set('prompt', prompt.trim())
    router.push(`/apps/${appId}/manual-tc/review?${params.toString()}`)
  }

  const moduleColor: Record<string, string> = {
    auth: 'bg-blue-100 text-blue-700',
    checkout: 'bg-amber-100 text-amber-700',
    account: 'bg-purple-100 text-purple-700',
    catalog: 'bg-emerald-100 text-emerald-700',
    other: 'bg-slate-100 text-slate-600',
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const done = step > s.id
          const active = step === s.id
          const isReviewStep = s.id >= 3
          return (
            <div key={s.id} className="flex items-center flex-1">
              <button
                onClick={() => {
                  if (done) setStep(s.id)
                  else if (isReviewStep && exploreDone) handleContinue()
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active ? 'bg-violet-600 text-white shadow-md' :
                  done ? 'bg-emerald-100 text-emerald-700 cursor-pointer hover:bg-emerald-200' :
                  isReviewStep && exploreDone ? 'bg-white border border-violet-200 text-violet-500 cursor-pointer hover:bg-violet-50' :
                  'bg-white border border-slate-200 text-slate-400 cursor-default'
                }`}
              >
                {done ? <CheckCircle className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{s.id}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 ${step > s.id ? 'bg-emerald-300' : 'bg-slate-200'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Step 1 — Input */}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4 ${step !== 1 ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <Badge className="bg-violet-100 text-violet-700 border-violet-200">Step 1</Badge>
          <h2 className="text-sm font-semibold text-slate-800">What do you want to test?</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Issue Key (optional)</label>
            <input
              value={issueKey}
              onChange={(e) => setIssueKey(e.target.value.toUpperCase())}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 font-mono"
              placeholder="KAN-5"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Or describe what to test</label>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              placeholder="e.g. User login flow with email and password"
            />
          </div>
        </div>
        {step === 1 && (
          <Button
            onClick={() => {
              if (issueKey.trim() || prompt.trim()) {
                setStep(2)
                setTimeout(() => exploreRef.current?.start(), 200)
              }
            }}
            disabled={!issueKey.trim() && !prompt.trim()}
            className="bg-violet-600 hover:bg-violet-700"
          >
            Start → Explore App
          </Button>
        )}
      </div>

      {/* Step 2 — Explore */}
      {step >= 2 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200">Step 2</Badge>
              <h2 className="text-sm font-semibold text-slate-800">App Exploration</h2>
            </div>
            {exploreDone && (
              <Button size="sm" variant="outline" onClick={handleExploreAgain} className="gap-1.5 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50">
                <RefreshCw className="w-3.5 h-3.5" /> Explore Again
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">Finds UI pages relevant to your scenario from the app knowledge base.</p>

          <StreamingOutput
            key={exploreRound}
            ref={exploreRef}
            endpoint="/api/agents/explore"
            body={{ appId, issueKey: issueKey.trim() || undefined, prompt: prompt.trim() || undefined }}
            onDone={handleExploreDone}
            label="App Explorer"
          />

          {/* Structured page results */}
          {exploreDone && exploredPages.length > 0 && (
            <div className="space-y-3 pt-1">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                {exploredPages.length} relevant page{exploredPages.length !== 1 ? 's' : ''} found
              </p>
              <div className="grid gap-3">
                {exploredPages.map((page) => (
                  <div key={page.path} className="border border-slate-200 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-slate-800">{page.title}</span>
                      <code className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{page.path}</code>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${moduleColor[page.module] ?? moduleColor.other}`}>
                        {page.module}
                      </span>
                    </div>
                    {page.forms.map((form, fi) => (
                      <div key={fi} className="ml-2 border-l-2 border-violet-200 pl-3 space-y-1">
                        <p className="text-xs font-semibold text-violet-700">Form: {form.name}</p>
                        {form.fields.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {form.fields.map((field, i) => (
                              <span key={i} className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full">
                                {field}
                              </span>
                            ))}
                          </div>
                        )}
                        {form.submitLabel && (
                          <p className="text-xs text-slate-500">Submit: <span className="font-medium text-slate-700">"{form.submitLabel}"</span></p>
                        )}
                      </div>
                    ))}
                    {page.buttons.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 ml-2">
                        {page.buttons.map((btn, i) => (
                          <span key={i} className="text-xs bg-slate-50 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full">
                            {btn}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {exploreDone && (
            <Button onClick={handleContinue} className="bg-violet-600 hover:bg-violet-700 gap-1.5">
              Continue → Generate Test Cases <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
