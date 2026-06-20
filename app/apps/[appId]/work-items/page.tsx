'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, Plus, FileText, CheckSquare, MessageSquare, ExternalLink, ChevronDown, X } from 'lucide-react'
import { toast } from 'sonner'

const ISSUE_KEY_RE = /^[A-Z]+-\d+$/

interface FullIssue {
  key: string
  summary: string
  description?: string
  acceptanceCriteria?: string
  comments?: { id: string; body: string; author: string }[]
}
interface SearchResult { key: string; summary: string }

export default function WorkItemsPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const appId = params.appId as string

  const [query, setQuery] = useState(searchParams.get('issueKey') ?? '')
  const [issueTypes, setIssueTypes] = useState<string[]>(['Story', 'Task', 'Bug', 'Epic'])
  const [typeFilter, setTypeFilter] = useState('All')
  const [typeOpen, setTypeOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [foundIssue, setFoundIssue] = useState<FullIssue | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createSummary, setCreateSummary] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createType, setCreateType] = useState('Task')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load real issue types from Jira + auto-load recent issues
  useEffect(() => {
    async function init() {
      let projectKey = ''
      try {
        const appsRes = await fetch('/api/apps')
        const apps = await appsRes.json()
        const app = apps.find((a: { id: string }) => a.id === appId)
        projectKey = app?.jiraProjectKey ?? ''
        const res = await fetch(`/api/jira/issue-types${projectKey ? `?project=${projectKey}` : ''}`)
        if (res.ok) {
          const types: string[] = await res.json()
          if (types.length > 0) {
            setIssueTypes(types)
            setCreateType(types[0])
          }
        }
      } catch { /* keep defaults */ }

      const key = searchParams.get('issueKey')
      if (key) {
        setQuery(key)
        fetchIssue(key)
      } else if (projectKey) {
        // Auto-load recent issues on first visit
        setLoading(true)
        try {
          const res = await fetch(`/api/jira/issues?project=${projectKey}&q=`)
          if (res.ok) {
            const data: SearchResult[] = await res.json()
            if (data.length > 0) setResults(data)
          }
        } catch { /* ignore */ }
        finally { setLoading(false) }
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchIssue(key: string) {
    setLoading(true); setNotFound(false); setFoundIssue(null); setResults(null); setShowCreate(false)
    try {
      const res = await fetch(`/api/jira/issues/${key.trim().toUpperCase()}`)
      if (res.ok) { setFoundIssue(await res.json()) }
      else { setNotFound(true) }
    } catch { setNotFound(true) }
    finally { setLoading(false) }
  }

  async function searchIssues(q: string, type: string) {
    if (!q.trim()) { setResults(null); setFoundIssue(null); setNotFound(false); return }
    setLoading(true); setNotFound(false); setFoundIssue(null); setResults(null)
    try {
      if (ISSUE_KEY_RE.test(q.trim().toUpperCase())) {
        await fetchIssue(q.trim())
        return
      }
      const typeParam = type !== 'All' ? `&type=${encodeURIComponent(type)}` : ''
      const res = await fetch(`/api/jira/issues?project=${searchParams.get('project') ?? ''}&q=${encodeURIComponent(q)}${typeParam}`)
      if (res.ok) {
        const data: SearchResult[] = await res.json()
        if (data.length === 0) setNotFound(true)
        else if (data.length === 1) await fetchIssue(data[0].key)
        else setResults(data)
      } else setNotFound(true)
    } catch { setNotFound(true) }
    finally { setLoading(false) }
  }

  function handleQueryChange(v: string) {
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchIssues(v, typeFilter), 500)
  }

  async function handleCreate() {
    if (!createSummary.trim()) return
    setCreating(true)
    try {
      // We need the project key — read from the app
      const appsRes = await fetch('/api/apps')
      const apps = await appsRes.json()
      const app = apps.find((a: { id: string }) => a.id === appId)
      const res = await fetch('/api/jira/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: app.jiraProjectKey,
          fields: { summary: createSummary, description: createDesc, issueType: createType },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Created ${data.key}`)
        setShowCreate(false)
        await fetchIssue(data.key)
        setQuery(data.key)
      } else toast.error('Failed to create issue')
    } catch { toast.error('Failed to create issue') }
    finally { setCreating(false) }
  }

  const jiraBase = process.env.NEXT_PUBLIC_JIRA_BASE_URL ?? ''

  return (
    <div className="space-y-5">
      {/* Search container */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-emerald-800 mb-3 flex items-center gap-2">
          <Search className="w-4 h-4" /> Find a Work Item
        </h2>
        <div className="flex gap-2">
          {/* Type dropdown */}
          <div className="relative">
            <button
              onClick={() => setTypeOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 h-10 text-sm border border-emerald-300 rounded-lg bg-white hover:border-emerald-400 text-slate-700 whitespace-nowrap"
            >
              {typeFilter} <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {typeOpen && (
              <div className="absolute top-11 left-0 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[130px]">
                {['All', ...issueTypes].map((t) => (
                  <button key={t} onClick={() => { setTypeFilter(t); setTypeOpen(false); if (query) searchIssues(query, t) }}
                    className={`w-full text-left px-3 py-2 text-sm ${typeFilter === t ? 'text-violet-700 bg-violet-50 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Enter issue key (KAN-5) or search by title..."
              className="w-full h-10 pl-10 pr-9 border border-emerald-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
            />
            {query && (
              <button onClick={() => { setQuery(''); setFoundIssue(null); setResults(null); setNotFound(false) }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <Button onClick={() => searchIssues(query, typeFilter)} disabled={loading || !query.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 h-10 px-5">
            {loading ? 'Searching...' : 'Fetch'}
          </Button>
        </div>

        {/* Results list */}
        {results && results.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-emerald-700 mb-1">{results.length} issue{results.length !== 1 ? 's' : ''} — click to view</p>
            {results.map((r) => (
              <button key={r.key} onClick={() => fetchIssue(r.key)}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 border border-emerald-200 bg-white rounded-lg hover:border-emerald-400 hover:bg-emerald-50 transition-all group">
                <Badge variant="outline" className="font-mono text-xs shrink-0">{r.key}</Badge>
                <span className="text-sm text-slate-600 truncate">{r.summary}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results container */}
      {(foundIssue || notFound || showCreate) && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {notFound && !showCreate && (
            <div className="p-8 text-center space-y-3">
              <p className="text-slate-500 text-sm">No work item found for &quot;{query}&quot;</p>
              <Button onClick={() => setShowCreate(true)} className="bg-violet-600 hover:bg-violet-700 gap-1.5">
                <Plus className="w-4 h-4" /> Create New Work Item
              </Button>
            </div>
          )}

          {showCreate && (
            <div className="p-6 space-y-4">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <Plus className="w-4 h-4 text-violet-600" /> Create Work Item
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">Type</label>
                  <select value={createType} onChange={(e) => setCreateType(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400">
                    {issueTypes.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">Summary *</label>
                  <input value={createSummary} onChange={(e) => setCreateSummary(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                    placeholder="Brief title..." />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Description</label>
                <textarea value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} rows={3}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="Description..." />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={creating || !createSummary.trim()} className="bg-violet-600 hover:bg-violet-700">
                  {creating ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </div>
          )}

          {foundIssue && (
            <div>
              {/* Issue header */}
              <div className="px-5 py-4 bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-slate-100 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge variant="outline" className="font-mono text-xs border-violet-300 text-violet-700 shrink-0">{foundIssue.key}</Badge>
                    <a href={`${jiraBase}/browse/${foundIssue.key}`} target="_blank" rel="noreferrer"
                      className="text-slate-400 hover:text-violet-600">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  <h3 className="font-semibold text-slate-800 text-base">{foundIssue.summary}</h3>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => router.push(`/apps/${appId}/manual-tc?issueKey=${foundIssue.key}`)}
                    className="border-violet-300 text-violet-700 hover:bg-violet-50 text-xs">
                    Generate Test Cases →
                  </Button>
                  <Button size="sm" onClick={() => router.push(`/apps/${appId}/automation?issueKey=${foundIssue.key}`)}
                    className="bg-violet-600 hover:bg-violet-700 text-xs">
                    Generate Automation →
                  </Button>
                </div>
              </div>

              {foundIssue.description && (
                <div className="px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 mb-2">
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Description</span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{foundIssue.description}</p>
                </div>
              )}

              {foundIssue.acceptanceCriteria && (
                <div className="px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 mb-2">
                    <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Acceptance Criteria</span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{foundIssue.acceptanceCriteria}</p>
                </div>
              )}

              {foundIssue.comments && foundIssue.comments.filter((c) => !c.body.startsWith('[QA-')).length > 0 && (
                <div className="px-5 py-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Comments ({foundIssue.comments.filter((c) => !c.body.startsWith('[QA-')).length})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {foundIssue.comments.filter((c) => !c.body.startsWith('[QA-')).slice(0, 3).map((c) => (
                      <div key={c.id} className="bg-slate-50 rounded-lg px-3 py-2 text-xs">
                        <span className="font-medium text-slate-600">{c.author}: </span>
                        <span className="text-slate-500">{c.body.slice(0, 200)}{c.body.length > 200 ? '…' : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
