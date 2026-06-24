'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { XCircle, ChevronDown, ChevronUp } from 'lucide-react'

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
  const router = useRouter()
  const [crawling, setCrawling] = useState(false)      // true only when WE started this crawl (has active stream)
  const [recovering, setRecovering] = useState(false)  // true when crawl is in-progress from another session (polling only)
  const [logs, setLogs] = useState<string[]>([])
  const [currentStatus, setCurrentStatus] = useState(knowledgeStatus)
  const [showLogs, setShowLogs] = useState(false)
  const [storePassword, setStorePassword] = useState(initialStorePassword ?? '')
  const [savingPassword, setSavingPassword] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [navWarning, setNavWarning] = useState<{ href: string } | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs
  useEffect(() => {
    if (showLogs) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, showLogs])

  // If page loads with status=crawling but no active stream → poll silently (no nav intercept)
  useEffect(() => {
    if (knowledgeStatus?.status !== 'crawling') return
    setRecovering(true)
    setShowLogs(true)
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/apps/${appId}/explore`)
        const data = await res.json()
        setCurrentStatus(data)
        if (data.status !== 'crawling') {
          clearInterval(interval)
          setRecovering(false)
          if (data.status === 'ready') toast.success(`Knowledge base ready — ${data.totalPages} pages indexed`)
        }
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Navigation warning — only when WE have an active stream, not during passive polling
  useEffect(() => {
    if (!crawling) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    // Intercept Next.js link clicks
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('http')) return
      e.preventDefault()
      e.stopPropagation()
      setNavWarning({ href })
    }
    document.addEventListener('click', handleClick, true)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleClick, true)
    }
  }, [crawling])

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

  const cancelCrawl = useCallback(async () => {
    setCancelling(true)
    try {
      readerRef.current?.cancel()
      readerRef.current = null
      await fetch(`/api/apps/${appId}/explore`, { method: 'DELETE' })
      setCurrentStatus((s) => s ? { ...s, status: 'failed' } : null)
      setCrawling(false)
      setRecovering(false)
      setLogs((prev) => [...prev, '[CANCELLED] Crawl cancelled by user\n'])
      toast.info('Crawl cancelled')
    } catch {
      toast.error('Failed to cancel crawl')
    } finally {
      setCancelling(false)
    }
  }, [appId])

  async function startCrawl() {
    setCrawling(true)
    setLogs([])
    setShowLogs(true)
    setCurrentStatus((s) => s ? { ...s, status: 'crawling' } : { status: 'crawling', totalPages: 0, crawlCompletedAt: null, version: 1 })

    try {
      const res = await fetch(`/api/apps/${appId}/explore`, { method: 'POST' })
      if (!res.ok || !res.body) throw new Error('Failed to start crawl')

      const reader = res.body.getReader()
      readerRef.current = reader
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
        } else if (text.includes('[CANCELLED]')) {
          setCurrentStatus((s) => s ? { ...s, status: 'failed' } : null)
        }
      }
    } catch (e) {
      if (!cancelling) {
        toast.error('Crawl failed: ' + String(e))
        setCurrentStatus((s) => s ? { ...s, status: 'failed' } : null)
      }
    } finally {
      readerRef.current = null
      setCrawling(false)
    }
  }

  const { text: statusText, color: statusColor } = statusLabel(currentStatus?.status)

  return (
    <>
      {/* Navigation warning modal */}
      {navWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <XCircle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Crawl in progress</h3>
                <p className="text-xs text-slate-500 mt-0.5">Navigating away will stop the crawl logs. The crawl will continue in the background.</p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <Button
                className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                size="sm"
                onClick={() => setNavWarning(null)}
              >
                Stay on page
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                size="sm"
                onClick={() => {
                  setNavWarning(null)
                  router.push(navWarning.href)
                }}
              >
                Leave anyway
              </Button>
            </div>
            <button
              className="w-full mt-2 text-xs text-red-500 hover:text-red-600 py-1"
              onClick={async () => {
                setNavWarning(null)
                await cancelCrawl()
                router.push(navWarning.href)
              }}
            >
              Cancel crawl &amp; leave
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Knowledge Base</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Persistent UI knowledge used to generate accurate test cases and selectors
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(crawling || recovering) && (
              <Button
                size="sm"
                variant="outline"
                onClick={cancelCrawl}
                disabled={cancelling}
                className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 text-xs"
              >
                <XCircle className="w-3.5 h-3.5 mr-1" />
                {cancelling ? 'Cancelling…' : 'Cancel Crawl'}
              </Button>
            )}
            <Button
              size="sm"
              onClick={startCrawl}
              disabled={crawling || recovering}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {(crawling || recovering) ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  Crawling…
                </span>
              ) : currentStatus?.status === 'ready' ? 'Re-explore' : 'Start Crawl'}
            </Button>
          </div>
        </div>

        {/* Store password */}
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

        {/* Status row */}
        <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Status</p>
            <p className={`font-semibold mt-0.5 ${statusColor} flex items-center gap-1.5`}>
              {(crawling || recovering) && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />}
              {statusText}
            </p>
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

        {/* Logs toggle + panel */}
        {(crawling || recovering || logs.length > 0) && (
          <div className="mt-4">
            <button
              className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium mb-2"
              onClick={() => setShowLogs((v) => !v)}
            >
              {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showLogs ? 'Hide' : 'Show'} crawl log
            </button>
            {showLogs && (
              <div className="bg-slate-900 rounded-lg p-3 max-h-52 overflow-y-auto font-mono text-xs text-slate-200 whitespace-pre-wrap">
                {logs.length > 0 ? logs.join('') : ''}
                {crawling && logs.length === 0 && (
                  <span className="text-amber-400 animate-pulse">Connecting to crawl stream…</span>
                )}
                {recovering && logs.length === 0 && (
                  <span className="text-amber-400">Crawl in progress (started in another tab) — polling for completion…</span>
                )}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
