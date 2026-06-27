'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TestTube, Zap, Save, CheckCircle, ArrowRight } from 'lucide-react'

const STEPS = [
  { id: 1, label: 'Input', icon: TestTube },
  { id: 2, label: 'Generate TCs', icon: Zap },
  { id: 3, label: 'Review & Save', icon: Save },
]

export default function ManualTCPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const appId = params.appId as string

  const [issueKey, setIssueKey] = useState(searchParams.get('issueKey') ?? '')
  const [prompt, setPrompt] = useState(searchParams.get('prompt') ?? '')

  useEffect(() => {
    const key = searchParams.get('issueKey')
    if (key) setIssueKey(key)
  }, [searchParams])

  function handleContinue() {
    const p = new URLSearchParams()
    if (issueKey.trim()) p.set('issueKey', issueKey.trim())
    if (prompt.trim()) p.set('prompt', prompt.trim())
    router.push(`/apps/${appId}/manual-tc/review?${p.toString()}`)
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const active = s.id === 1
          const done = false
          return (
            <div key={s.id} className="flex items-center flex-1">
              <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${
                active ? 'bg-violet-600 text-white shadow-md' :
                done ? 'bg-emerald-100 text-emerald-700' :
                'bg-white border border-slate-200 text-slate-400'
              }`}>
                {done ? <CheckCircle className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{s.id}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="h-0.5 flex-1 mx-1 bg-slate-200" />
              )}
            </div>
          )
        })}
      </div>

      {/* Step 1 — Input */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
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
        <Button
          onClick={handleContinue}
          disabled={!issueKey.trim() && !prompt.trim()}
          className="bg-violet-600 hover:bg-violet-700 gap-1.5"
        >
          Generate Test Cases <ArrowRight className="w-4 h-4" />
        </Button>
        <p className="text-xs text-slate-400">
          Live page capture runs automatically — no crawl setup needed.
        </p>
      </div>
    </div>
  )
}
