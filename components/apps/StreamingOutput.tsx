'use client'

import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

export interface StreamingOutputHandle {
  start: () => void
  reset: () => void
}

interface Props {
  endpoint: string
  body: Record<string, unknown>
  onDone?: (data: string) => void
  onError?: (msg: string) => void
  autoStart?: boolean
  label?: string
}

const StreamingOutput = forwardRef<StreamingOutputHandle, Props>(
  ({ endpoint, body, onDone, onError, autoStart = false, label = 'Running...' }, ref) => {
    const [lines, setLines] = useState<string[]>([])
    const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
    const containerRef = useRef<HTMLPreElement>(null)
    const abortRef = useRef<AbortController | null>(null)

    useImperativeHandle(ref, () => ({ start: run, reset }))

    useEffect(() => {
      if (autoStart) run()
      return () => abortRef.current?.abort()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Auto-scroll
    useEffect(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
      }
    }, [lines])

    function reset() {
      abortRef.current?.abort()
      setLines([])
      setStatus('idle')
    }

    async function run() {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      setLines([])
      setStatus('running')

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortRef.current.signal,
        })

        const reader = res.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''
        let finalStatus: 'done' | 'error' = 'done'

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const rawPart of parts) {
            // strip leading newlines that arise when a prior text value ends with \n
            const part = rawPart.replace(/^\n+/, '')
            if (!part.startsWith('data: ')) continue
            const text = part.slice(6)
            if (text.startsWith('[DONE] ')) {
              finalStatus = 'done'
              onDone?.(text.slice(7))
            } else if (text.startsWith('[ERROR] ')) {
              finalStatus = 'error'
              onError?.(text.slice(8))
              setLines((l) => [...l, `❌ ${text.slice(8)}`])
            } else {
              setLines((l) => [...l, text])
            }
          }
        }
        setStatus(finalStatus)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setStatus('error')
        setLines((l) => [...l, `❌ ${String(e)}`])
        onError?.(String(e))
      }
    }

    return (
      <div className="rounded-xl overflow-hidden border border-slate-700">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-slate-400 text-xs font-mono ml-2 flex-1">{label}</span>
          {status === 'running' && <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />}
          {status === 'done' && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
          {status === 'error' && <XCircle className="w-3.5 h-3.5 text-red-400" />}
        </div>
        <pre
          ref={containerRef}
          className="bg-slate-900 text-green-400 font-mono text-xs p-4 overflow-auto max-h-64 leading-relaxed whitespace-pre-wrap"
        >
          {lines.length === 0 && status === 'idle' && (
            <span className="text-slate-500">Output will appear here...</span>
          )}
          {lines.join('')}
          {status === 'running' && <span className="animate-pulse text-violet-400">▋</span>}
        </pre>
      </div>
    )
  }
)

StreamingOutput.displayName = 'StreamingOutput'
export default StreamingOutput
