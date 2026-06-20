'use client'

import { useState, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, ExternalLink, Plus, ChevronDown, FileText, MessageSquare, CheckSquare, X } from 'lucide-react'

const ISSUE_TYPES = ['All', 'Story', 'Bug', 'Task', 'Test Case', 'Epic']
const ISSUE_KEY_RE = /^[A-Z]+-\d+$/

interface FullIssue {
  key: string
  summary: string
  description?: string
  acceptanceCriteria?: string
  comments?: { id: string; body: string; author: string }[]
}
interface SearchResult { key: string; summary: string }

interface Props {
  projectKey: string
  prompt: string
  searching: boolean
  onPromptChange: (v: string) => void
  onFindSimilar: () => void
  onRunPipeline: (key: string) => void
  onCreateNew: () => void
}

export default function WorkItemPanel({
  projectKey, prompt, searching, onPromptChange, onFindSimilar, onRunPipeline, onCreateNew,
}: Props) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [typeOpen, setTypeOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [foundIssue, setFoundIssue] = useState<FullIssue | null>(null)
  const [notFound, setNotFound] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function performSearch(q: string, type: string) {
    if (!q.trim()) { setResults(null); setFoundIssue(null); setNotFound(false); return }
    setSearchLoading(true)
    setNotFound(false)
    setFoundIssue(null)
    setResults(null)
    try {
      if (ISSUE_KEY_RE.test(q.trim().toUpperCase())) {
        await loadFullIssue(q.trim().toUpperCase(), false)
      } else {
        const typeParam = type !== 'All' ? `&type=${encodeURIComponent(type)}` : ''
        const res = await fetch(`/api/jira/issues?project=${projectKey}&q=${encodeURIComponent(q)}${typeParam}`)
        if (res.ok) {
          const data: SearchResult[] = await res.json()
          if (data.length === 0) setNotFound(true)
          else if (data.length === 1) await loadFullIssue(data[0].key, false)
          else setResults(data)
        } else { setNotFound(true) }
      }
    } catch { setNotFound(true) }
    finally { setSearchLoading(false) }
  }

  async function loadFullIssue(key: string, setLoading = true) {
    if (setLoading) setSearchLoading(true)
    setResults(null)
    try {
      const res = await fetch(`/api/jira/issues/${key}`)
      if (res.ok) {
        const data = await res.json()
        setFoundIssue({
          key: data.key,
          summary: data.summary,
          description: data.description,
          acceptanceCriteria: data.acceptanceCriteria,
          comments: data.comments,
        })
        setNotFound(false)
      } else { setNotFound(true) }
    } catch { setNotFound(true) }
    finally { if (setLoading) setSearchLoading(false) }
  }

  function handleQueryChange(v: string) {
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => performSearch(v, typeFilter), 500)
  }

  function handleTypeChange(t: string) {
    setTypeFilter(t)
    setTypeOpen(false)
    if (query.trim()) performSearch(query, t)
  }

  const jiraBaseUrl = process.env.NEXT_PUBLIC_JIRA_BASE_URL ?? ''

  return (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* ══ SECTION 1: Find a Work Item ══════════════════════════════════════ */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4 text-violet-500" />
          <h2 className="text-sm font-semibold text-slate-800">Find a Work Item</h2>
        </div>

        {/* Search row */}
        <div className="flex gap-2">
          <div className="relative">
            <button
              onClick={() => setTypeOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 h-9 text-sm border border-slate-200 rounded-lg bg-white hover:border-violet-300 transition-colors text-slate-600 whitespace-nowrap"
            >
              {typeFilter}
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {typeOpen && (
              <div className="absolute top-10 left-0 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 min-w-[130px]">
                {ISSUE_TYPES.map((t) => (
                  <button key={t} onClick={() => handleTypeChange(t)}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${typeFilter === t ? 'text-violet-700 bg-violet-50 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="KAN-5 or search by title..."
              className="w-full h-9 pl-9 pr-8 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
            />
            {searchLoading && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-violet-400 text-xs animate-pulse">•••</span>
            )}
            {query && !searchLoading && (
              <button onClick={() => { setQuery(''); setFoundIssue(null); setResults(null); setNotFound(false) }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Multiple results list */}
        {results && results.length > 1 && (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-slate-400 mb-1.5">{results.length} results — click to view details</p>
            {results.map((r) => (
              <button key={r.key} onClick={() => loadFullIssue(r.key)}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 border border-slate-100 rounded-lg hover:border-violet-200 hover:bg-violet-50 transition-all group">
                <Badge variant="outline" className="font-mono text-xs shrink-0">{r.key}</Badge>
                <span className="text-sm text-slate-600 group-hover:text-slate-800 truncate">{r.summary}</span>
              </button>
            ))}
          </div>
        )}

        {/* Not found */}
        {notFound && (
          <div className="mt-3 border border-slate-200 rounded-xl p-3 text-center">
            <p className="text-sm text-slate-400">No work item found for &quot;{query}&quot;</p>
          </div>
        )}

        {/* Found issue — full details */}
        {foundIssue && (
          <div className="mt-3 border border-violet-200 rounded-xl bg-white overflow-hidden shadow-sm">
            {/* Issue header */}
            <div className="px-4 py-3 bg-violet-50 border-b border-violet-100 flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="font-mono text-xs border-violet-300 text-violet-700 shrink-0">{foundIssue.key}</Badge>
                  <a href={`${jiraBaseUrl}/browse/${foundIssue.key}`} target="_blank" rel="noreferrer"
                    className="text-slate-400 hover:text-violet-600 transition-colors shrink-0">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <p className="text-sm font-semibold text-slate-800 leading-snug">{foundIssue.summary}</p>
              </div>
              <Button size="sm" onClick={() => onRunPipeline(foundIssue.key)}
                className="bg-violet-600 hover:bg-violet-700 text-xs shrink-0 h-8 px-3">
                Run Pipeline →
              </Button>
            </div>

            {/* Description */}
            {foundIssue.description && (
              <div className="px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Description</span>
                </div>
                <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{foundIssue.description}</p>
              </div>
            )}

            {/* Acceptance Criteria */}
            {foundIssue.acceptanceCriteria && (
              <div className="px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Acceptance Criteria</span>
                </div>
                <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{foundIssue.acceptanceCriteria}</p>
              </div>
            )}

            {/* Comments (non-QA ones) */}
            {foundIssue.comments && foundIssue.comments.filter(c => !c.body.startsWith('[QA-')).length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Comments ({foundIssue.comments.filter(c => !c.body.startsWith('[QA-')).length})
                  </span>
                </div>
                <div className="space-y-2">
                  {foundIssue.comments.filter(c => !c.body.startsWith('[QA-')).slice(0, 3).map((comment) => (
                    <div key={comment.id} className="text-xs bg-slate-50 rounded-lg px-3 py-2">
                      <span className="font-medium text-slate-600">{comment.author}: </span>
                      <span className="text-slate-500">{comment.body.slice(0, 200)}{comment.body.length > 200 ? '…' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ Divider ══════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-3 px-5 py-1">
        <div className="flex-1 h-px bg-slate-100" />
      </div>

      {/* ══ SECTION 2: Create a Work Item ════════════════════════════════════ */}
      <div className="px-5 pt-4 pb-6">
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-4 h-4 text-violet-500" />
          <h2 className="text-sm font-semibold text-slate-800">Create a Work Item</h2>
        </div>

        <textarea
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent bg-white"
          rows={4}
          placeholder="Describe what you want to test, e.g. User should be able to login with email and password and see their dashboard"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onFindSimilar() }}
        />
        <div className="flex items-center justify-between mt-2.5">
          <p className="text-xs text-slate-400">Cmd+Enter to find similar first</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFindSimilar} disabled={searching || !prompt.trim()}
              className="text-sm border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-700">
              {searching ? 'Searching...' : 'Find Similar'}
            </Button>
            <Button onClick={onCreateNew} disabled={!prompt.trim()}
              className="bg-violet-600 hover:bg-violet-700 text-sm gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              Create New
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
