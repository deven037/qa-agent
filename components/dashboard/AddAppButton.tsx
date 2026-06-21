'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Globe, KeyRound, Layers, X, Sparkles } from 'lucide-react'

type AuthStrategy = 'no-auth' | 'email-password' | 'api-key'
interface JiraProject { key: string; name: string; id: string }

function toJiraKey(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10)
  return words.map((w) => w[0]).join('').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10)
}

const inputCls = 'w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition'
const selectCls = 'w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition appearance-none cursor-pointer'

export default function AddAppButton({ ghost }: { ghost?: boolean } = {}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [authStrategy, setAuthStrategy] = useState<AuthStrategy>('no-auth')
  const [appEmail, setAppEmail] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [customKey, setCustomKey] = useState('')
  const [sourceProjectKey, setSourceProjectKey] = useState('')
  const [projects, setProjects] = useState<JiraProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!open) return
    setLoadingProjects(true)
    fetch('/api/jira/projects')
      .then((r) => r.json())
      .then((data: unknown) => setProjects(Array.isArray(data) ? (data as JiraProject[]) : []))
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false))
  }, [open])

  function reset() {
    setName(''); setBaseUrl(''); setCustomKey(''); setSourceProjectKey('')
    setAuthStrategy('no-auth'); setAppEmail(''); setAppPassword(''); setApiKey('')
    setStatus('')
  }

  async function handleAdd() {
    setLoading(true)
    try {
      const credentials: Record<string, string> = {}
      if (authStrategy === 'email-password') {
        if (appEmail) credentials.email = appEmail
        if (appPassword) credentials.password = appPassword
      } else if (authStrategy === 'api-key') {
        if (apiKey) credentials.apiKey = apiKey
      }

      setStatus('Creating Jira project…')
      const jiraKey = (customKey || toJiraKey(name)).toUpperCase()
      const jiraRes = await fetch('/api/jira/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, key: jiraKey, sourceProjectKey: sourceProjectKey || undefined }),
      })
      if (!jiraRes.ok) {
        const err = await jiraRes.json()
        throw new Error(err.error ?? 'Failed to create Jira project')
      }
      const jiraProject = await jiraRes.json()

      setStatus('Creating application…')
      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, baseUrl, jiraProjectKey: jiraProject.key, authStrategy, credentials }),
      })
      if (!res.ok) throw new Error('Failed to create app')
      const newApp = await res.json()

      toast.success(`App created — Jira project "${jiraProject.key}" is ready`)
      setOpen(false)
      reset()
      router.refresh()
      fetch(`/api/apps/${newApp.id}/explore`, { method: 'POST' }).catch(() => {})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add application')
    } finally {
      setLoading(false)
      setStatus('')
    }
  }

  if (!open) {
    if (ghost) {
      return (
        <button
          onClick={() => setOpen(true)}
          className="h-full min-h-[148px] w-full rounded-2xl border-2 border-dashed border-slate-200 hover:border-violet-300 hover:bg-violet-50/50 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-violet-500 transition-all duration-200 group"
        >
          <div className="w-10 h-10 rounded-xl border-2 border-dashed border-slate-200 group-hover:border-violet-300 flex items-center justify-center text-xl transition-colors">+</div>
          <span className="text-xs font-medium">Add new app</span>
        </button>
      )
    }
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-sm font-semibold shadow-md shadow-violet-200 active:scale-[0.98] transition-all"
      >
        + Add App
      </button>
    )
  }

  const previewKey = customKey || (name ? toJiraKey(name) : 'KEY')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(15,10,30,0.55)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">

        {/* Modal header */}
        <div className="relative bg-gradient-to-br from-violet-600 to-indigo-700 px-6 pt-6 pb-8">
          <div className="absolute top-4 right-4">
            <button
              onClick={() => { setOpen(false); reset() }}
              className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
            >
              <X className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-white/70 text-xs font-medium uppercase tracking-widest">New application</span>
          </div>
          <h2 className="text-xl font-bold text-white">Add application</h2>
          <p className="text-white/60 text-sm mt-1">A Jira project & board will be created automatically.</p>

          {/* Key preview badge */}
          <div className="absolute -bottom-4 right-6 bg-white rounded-xl px-3 py-1.5 shadow-lg border border-slate-100 flex items-center gap-2">
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">Jira key</span>
            <span className="font-mono font-bold text-violet-700 text-sm">{previewKey}</span>
          </div>
        </div>

        {/* Form body */}
        <div className="px-6 pt-8 pb-6 space-y-4">

          {/* App name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">App name</label>
            <input
              className={inputCls}
              placeholder="My Web App"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Base URL + Jira key side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                <Globe className="w-3 h-3" /> Base URL
              </label>
              <input
                className={inputCls}
                placeholder="https://staging.app.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                <Layers className="w-3 h-3" /> Jira key
              </label>
              <input
                className={inputCls + ' font-mono uppercase'}
                placeholder={name ? toJiraKey(name) : 'CRM'}
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
              />
            </div>
          </div>

          {/* Copy structure from */}
          {projects.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Copy structure from</label>
              <div className="relative">
                <select
                  className={selectCls}
                  value={sourceProjectKey}
                  onChange={(e) => setSourceProjectKey(e.target.value)}
                >
                  <option value="">Default Kanban template</option>
                  {projects.map((p) => (
                    <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">▾</div>
              </div>
              <p className="text-xs text-slate-400">Copies issue types & workflows from the selected project.</p>
            </div>
          )}
          {loadingProjects && <p className="text-xs text-slate-400">Loading projects…</p>}

          {/* Auth */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
              <KeyRound className="w-3 h-3" /> Authentication
            </label>
            <div className="relative">
              <select
                className={selectCls}
                value={authStrategy}
                onChange={(e) => setAuthStrategy(e.target.value as AuthStrategy)}
              >
                <option value="no-auth">No Authentication</option>
                <option value="email-password">Email + Password</option>
                <option value="api-key">API Key</option>
              </select>
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">▾</div>
            </div>
          </div>

          {authStrategy === 'email-password' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</label>
                <input className={inputCls} type="email" placeholder="user@example.com" value={appEmail} onChange={(e) => setAppEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Password</label>
                <input className={inputCls} type="password" placeholder="••••••••" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} />
              </div>
            </div>
          )}

          {authStrategy === 'api-key' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">API Key</label>
              <input className={inputCls} type="password" placeholder="sk-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
          )}

          {/* Status */}
          {status && (
            <div className="flex items-center gap-2.5 bg-violet-50 border border-violet-100 text-violet-700 text-sm px-4 py-2.5 rounded-xl">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              {status}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => { setOpen(false); reset() }}
              disabled={loading}
              className="flex-1 h-10 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={loading || !name || !baseUrl}
              className="flex-1 h-10 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-sm font-semibold shadow-md shadow-violet-200 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : 'Add App'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
