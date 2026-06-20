'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface KnowledgeStatus {
  status: string
  totalPages: number
  crawlCompletedAt: Date | null
  version: number
}

interface Props {
  appId: string
  knowledgeStatus: KnowledgeStatus | null
  storePassword?: string
}

function statusLabel(status: string | undefined): { text: string; color: string } {
  if (!status) return { text: 'Not crawled', color: 'text-slate-400' }
  if (status === 'ready') return { text: 'Ready', color: 'text-emerald-600' }
  if (status === 'crawling') return { text: 'Crawling...', color: 'text-amber-500' }
  return { text: 'Failed', color: 'text-rose-500' }
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return 'Never'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function KnowledgeCard({ appId, knowledgeStatus, storePassword: initialStorePassword }: Props) {
  const [crawling, setCrawling] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [currentStatus, setCurrentStatus] = useState(knowledgeStatus)
  const [showLogs, setShowLogs] = useState(false)
  const [storePassword, setStorePassword] = useState(initialStorePassword ?? '')
  const [savingPassword, setSavingPassword] = useState(false)

  async function saveStorePassword() {
    setSavingPassword(true)
    try {
      const res = await fetch(`/api/apps/${appId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storePassword: storePassword || undefined }),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Store password saved')
    } catch {
      toast.error('Failed to save store password')
    } finally {
      setSavingPassword(false)
    }
  }

  async function startCrawl() {
    setCrawling(true)
    setLogs([])
    setShowLogs(true)
    setCurrentStatus((s) => s ? { ...s, status: 'crawling' } : { status: 'crawling', totalPages: 0, crawlCompletedAt: null, version: 1 })

    try {
      const res = await fetch(`/api/apps/${appId}/explore`, { method: 'POST' })
      if (!res.ok || !res.body) throw new Error('Failed to start crawl')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let pageCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        setLogs((prev) => [...prev, text])

        const match = text.match(/(\d+) pages (captured|indexed)/)
        if (match) pageCount = parseInt(match[1])

        if (text.includes('[DONE]')) {
          setCurrentStatus({ status: 'ready', totalPages: pageCount, crawlCompletedAt: new Date(), version: 1 })
          toast.success(`Knowledge base ready — ${pageCount} pages indexed`)
        } else if (text.includes('[ERROR]')) {
          setCurrentStatus((s) => s ? { ...s, status: 'failed' } : null)
          toast.error('Knowledge crawl failed')
        }
      }
    } catch (e) {
      toast.error('Crawl failed: ' + String(e))
      setCurrentStatus((s) => s ? { ...s, status: 'failed' } : null)
    } finally {
      setCrawling(false)
    }
  }

  const { text: statusText, color: statusColor } = statusLabel(currentStatus?.status)

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Knowledge Base</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Persistent UI knowledge used to generate accurate test cases and selectors
          </p>
        </div>
        <Button
          size="sm"
          onClick={startCrawl}
          disabled={crawling}
          className="shrink-0 bg-violet-600 hover:bg-violet-700 text-white"
        >
          {crawling ? 'Crawling...' : currentStatus?.status === 'ready' ? 'Re-explore' : 'Start Crawl'}
        </Button>
      </div>

      {/* Store password — for Shopify preview stores and other password-gated apps */}
      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1">
          <label className="text-xs text-slate-500 font-medium block mb-1">
            Store / App Password <span className="text-slate-400">(required if the site has a password gate)</span>
          </label>
          <Input
            type="password"
            placeholder="Leave blank if not required"
            value={storePassword}
            onChange={(e) => setStorePassword(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={saveStorePassword}
          disabled={savingPassword}
          className="shrink-0 mt-5 h-8 text-xs"
        >
          {savingPassword ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Status</p>
          <p className={`font-semibold mt-0.5 ${statusColor}`}>{statusText}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Pages indexed</p>
          <p className="font-semibold text-slate-800 mt-0.5">{currentStatus?.totalPages ?? 0}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Last crawled</p>
          <p className="font-semibold text-slate-800 mt-0.5">{formatDate(currentStatus?.crawlCompletedAt)}</p>
        </div>
      </div>

      {showLogs && logs.length > 0 && (
        <div className="mt-4">
          <button
            className="text-xs text-violet-600 hover:underline mb-2"
            onClick={() => setShowLogs((v) => !v)}
          >
            {showLogs ? 'Hide' : 'Show'} crawl log
          </button>
          <div className="bg-slate-900 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs text-slate-200 whitespace-pre-wrap">
            {logs.join('')}
          </div>
        </div>
      )}

      {!showLogs && logs.length > 0 && (
        <button
          className="text-xs text-violet-600 hover:underline mt-3"
          onClick={() => setShowLogs(true)}
        >
          Show crawl log
        </button>
      )}
    </div>
  )
}
