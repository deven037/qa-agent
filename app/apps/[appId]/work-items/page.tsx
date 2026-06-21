'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Search, Plus, FileText, CheckSquare, MessageSquare, ExternalLink,
  X, BookOpen, Bug, Layers, Zap, ClipboardList, Loader2, ChevronDown, ChevronUp,
  GitBranch, FlaskConical, Wrench, AlertTriangle, Info, Save, Link,
} from 'lucide-react'
import { toast } from 'sonner'

interface SearchResult { key: string; summary: string }

interface IssueChild { key: string; summary: string; issueType: string; status: string }

interface TestStep { step: string; expected: string }

interface FullIssue {
  key: string
  summary: string
  issueType: string
  status: string
  priority: string
  reporter: string
  assignee: string
  assigneeAvatar: string
  reporterAvatar: string
  created: string
  description?: string
  acceptanceCriteria?: string
  comments?: { id: string; body: string; author: string }[]
  children?: IssueChild[]
  parentKey?: string
  parentSummary?: string
  testSteps?: TestStep[]
}

// Color + icon config per issue type
const TYPE_CONFIG: Record<string, { color: string; header: string; headerGrad: string; icon: React.ElementType; badge: string; emptyText: string }> = {
  Story:       { color: 'border-violet-100 bg-white',    header: 'bg-violet-600',  headerGrad: 'from-violet-500 to-violet-700',  icon: BookOpen,      badge: 'bg-violet-50 text-violet-700 border-violet-200',   emptyText: 'Stories describe individual user-facing requirements, tested with manual test cases.' },
  Bug:         { color: 'border-red-100 bg-white',       header: 'bg-red-500',     headerGrad: 'from-red-500 to-rose-600',        icon: Bug,           badge: 'bg-red-50 text-red-700 border-red-200',            emptyText: 'Bugs track defects found during testing. Link them to test cases to verify the fix.' },
  Task:        { color: 'border-blue-100 bg-white',      header: 'bg-blue-600',    headerGrad: 'from-blue-500 to-blue-700',       icon: ClipboardList, badge: 'bg-blue-50 text-blue-700 border-blue-200',          emptyText: 'Tasks are units of work. Add test steps to automate or manually verify them.' },
  Epic:        { color: 'border-orange-100 bg-white',    header: 'bg-orange-500',  headerGrad: 'from-orange-500 to-orange-600',   icon: Layers,        badge: 'bg-orange-50 text-orange-700 border-orange-200',    emptyText: 'Epics group large features. Break them into Stories covering individual requirements.' },
  'Test Case': { color: 'border-emerald-100 bg-white',   header: 'bg-emerald-600', headerGrad: 'from-emerald-500 to-teal-600',    icon: Zap,           badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', emptyText: 'Test Cases define steps and expected results to verify features or fixes.' },
}

const DEFAULT_CONFIG = { color: 'border-slate-100 bg-white', header: 'bg-slate-500', headerGrad: 'from-slate-500 to-slate-600', icon: ClipboardList, badge: 'bg-slate-50 text-slate-700 border-slate-200', emptyText: 'No items found.' }

function getConfig(type: string) {
  return TYPE_CONFIG[type] ?? DEFAULT_CONFIG
}

// ── Per-type drawer config ───────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  'To Do':       'bg-slate-100 text-slate-600',
  'In Progress': 'bg-blue-100 text-blue-700',
  'Done':        'bg-green-100 text-green-700',
  'In Review':   'bg-violet-100 text-violet-700',
}

const PRIORITY_COLOR: Record<string, string> = {
  Low:      'text-slate-500',
  Medium:   'text-amber-600',
  High:     'text-orange-600',
  Critical: 'text-red-600',
  Highest:  'text-red-700',
}

// Header gradient per issue type
const DRAWER_HEADER: Record<string, string> = {
  Epic:        'from-orange-500 to-orange-600',
  Story:       'from-violet-600 to-indigo-600',
  Task:        'from-blue-600 to-blue-700',
  Bug:         'from-red-500 to-red-600',
  'Test Case': 'from-emerald-600 to-emerald-700',
}

// ── User types & components ──────────────────────────────────────────────────

interface JiraUser { accountId: string; displayName: string; email: string; avatar: string }

function UserAvatar({ name, avatar, size = 20 }: { name: string; avatar?: string; size?: number }) {
  if (avatar) return <img src={avatar} alt={name} className="rounded-full shrink-0" style={{ width: size, height: size }} />
  return (
    <span className="rounded-full bg-violet-200 text-violet-700 font-bold flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

function UserChip({ label, name, avatar, emptyLabel, color = 'violet' }: {
  label: string; name?: string; avatar?: string; emptyLabel?: string; color?: 'violet' | 'slate'
}) {
  const cls = color === 'violet'
    ? 'bg-violet-50 text-violet-700 border-violet-200'
    : 'bg-slate-50 text-slate-600 border-slate-200'
  if (!name) return emptyLabel
    ? <span className="text-xs text-slate-400 italic">{emptyLabel}</span>
    : null
  return (
    <span className={`flex items-center gap-1.5 text-xs border px-2 py-0.5 rounded-full font-medium ${cls}`} title={label}>
      <UserAvatar name={name} avatar={avatar} size={16} />
      {name}
    </span>
  )
}

function UserPicker({ label, projectKey, value, onChange }: {
  label: string
  projectKey: string
  value: JiraUser | null
  onChange: (u: JiraUser | null) => void
}) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<JiraUser[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectKey) return
    // Load initial list
    fetch(`/api/jira/users?project=${projectKey}&q=`)
      .then(r => r.ok ? r.json() : [])
      .then(setUsers)
      .catch(() => {})
  }, [projectKey])

  async function handleSearch(q: string) {
    setQuery(q)
    if (!q.trim()) { setOpen(false); return }
    setLoading(true)
    setOpen(true)
    try {
      const res = await fetch(`/api/jira/users?project=${projectKey}&q=${encodeURIComponent(q)}`)
      const data: JiraUser[] = res.ok ? await res.json() : []
      setUsers(data)
    } catch { setUsers([]) }
    finally { setLoading(false) }
  }

  const filtered = query
    ? users.filter(u => u.displayName.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase()))
    : users

  return (
    <div className="relative">
      <label className="text-xs font-medium text-slate-500 mb-1 block">{label}</label>
      <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-violet-400 ${value ? 'border-violet-300 bg-violet-50' : 'border-slate-200'}`}>
        {value && <UserAvatar name={value.displayName} avatar={value.avatar} size={18} />}
        <input
          type="text"
          value={value ? value.displayName : query}
          onChange={(e) => { if (value) { onChange(null); setQuery(e.target.value); setOpen(true) } else handleSearch(e.target.value) }}
          onFocus={() => { if (!value) setOpen(users.length > 0) }}
          placeholder={`Search ${label.toLowerCase()}…`}
          className="flex-1 bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400 min-w-0"
        />
        {value && (
          <button onClick={() => { onChange(null); setQuery('') }} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && !value && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg w-full max-h-48 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">No users found</p>
            ) : filtered.map((u) => (
              <button key={u.accountId} onClick={() => { onChange(u); setOpen(false); setQuery('') }}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-violet-50 transition-colors">
                <UserAvatar name={u.displayName} avatar={u.avatar} size={24} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{u.displayName}</p>
                  {u.email && <p className="text-xs text-slate-400 truncate">{u.email}</p>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

interface Transition { id: string; name: string; toStatus: string }

function StatusDropdown({ issueKey, currentStatus, onStatusChange }: {
  issueKey: string
  currentStatus: string
  onStatusChange: (newStatus: string) => void
}) {
  const [transitions, setTransitions] = useState<Transition[]>([])
  const [open, setOpen] = useState(false)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    fetch(`/api/jira/issues/${issueKey}/transitions`)
      .then(r => r.ok ? r.json() : [])
      .then(setTransitions)
      .catch(() => {})
  }, [issueKey])

  const statusCls = STATUS_COLOR[currentStatus] ?? 'bg-slate-100 text-slate-600'

  async function applyTransition(t: Transition) {
    setOpen(false)
    setApplying(true)
    try {
      const res = await fetch(`/api/jira/issues/${issueKey}/transitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transitionId: t.id }),
      })
      if (res.ok) {
        onStatusChange(t.toStatus)
        toast.success(`Status updated to "${t.toStatus}"`)
      } else {
        toast.error('Failed to update status')
      }
    } catch {
      toast.error('Failed to update status')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={applying || transitions.length === 0}
        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-all ${statusCls} ${transitions.length > 0 ? 'hover:ring-2 hover:ring-offset-1 hover:ring-slate-300 cursor-pointer' : 'cursor-default'}`}
      >
        {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        {currentStatus}
        {transitions.length > 0 && <ChevronDown className="w-3 h-3 opacity-60" />}
      </button>

      {open && transitions.length > 0 && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[140px] overflow-hidden">
            {transitions.map((t) => (
              <button
                key={t.id}
                onClick={() => applyTransition(t)}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-50 transition-colors ${t.toStatus === currentStatus ? 'font-semibold text-slate-800' : 'text-slate-600'}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  t.toStatus === 'Done' ? 'bg-green-500' :
                  t.toStatus === 'In Progress' ? 'bg-blue-500' :
                  t.toStatus === 'In Review' ? 'bg-violet-500' : 'bg-slate-400'
                }`} />
                {t.toStatus}
                {t.toStatus === currentStatus && <span className="ml-auto text-slate-400">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Test Step Table ───────────────────────────────────────────────────────────

function TestStepTable({ issueKey, initialSteps }: { issueKey: string; initialSteps: TestStep[] }) {
  const [steps, setSteps] = useState<TestStep[]>(
    initialSteps.length > 0 ? initialSteps : [{ step: '', expected: '' }]
  )
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const hasSteps = initialSteps.length > 0

  function update(idx: number, field: keyof TestStep, value: string) {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
    setDirty(true)
  }

  function addStep() {
    setSteps(prev => [...prev, { step: '', expected: '' }])
    setDirty(true)
  }

  function removeStep(idx: number) {
    setSteps(prev => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }

  async function save() {
    const filled = steps.filter(s => s.step.trim() || s.expected.trim())
    if (filled.length === 0) return
    setSaving(true)
    try {
      // Build ADF table via API (server handles ADF construction)
      const res = await fetch(`/api/jira/issues/${issueKey}/test-steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: filled }),
      })
      if (res.ok) { toast.success('Test steps saved to Jira'); setDirty(false) }
      else toast.error('Failed to save test steps')
    } catch { toast.error('Failed to save test steps') }
    finally { setSaving(false) }
  }

  return (
    <div className="px-5 py-4 border-b border-slate-100 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <FlaskConical className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Test Steps</span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button size="sm" onClick={save} disabled={saving}
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1">
              <Save className="w-3 h-3" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
          <button onClick={addStep}
            className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium">
            <Plus className="w-3.5 h-3.5" /> Add Step
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 overflow-hidden text-xs">
        {/* Header */}
        <div className="grid grid-cols-[32px_1fr_1fr] bg-slate-100 border-b border-slate-200">
          <div className="px-2 py-2 text-center font-semibold text-slate-500">#</div>
          <div className="px-3 py-2 font-semibold text-slate-600 border-l border-slate-200">Test Step</div>
          <div className="px-3 py-2 font-semibold text-slate-600 border-l border-slate-200">Expected Result</div>
        </div>
        {/* Rows */}
        {steps.map((s, i) => (
          <div key={i} className="grid grid-cols-[32px_1fr_1fr] border-b border-slate-100 last:border-0 group hover:bg-slate-50">
            <div className="flex items-start justify-center pt-2.5 text-slate-400 font-mono text-xs">{i + 1}</div>
            <div className="border-l border-slate-100 p-1">
              <textarea
                value={s.step}
                onChange={e => update(i, 'step', e.target.value)}
                rows={2}
                placeholder="Describe the action…"
                className="w-full text-xs text-slate-700 resize-none outline-none bg-transparent px-2 py-1 rounded focus:bg-white focus:ring-1 focus:ring-violet-300 placeholder:text-slate-300"
              />
            </div>
            <div className="border-l border-slate-100 p-1 relative">
              <textarea
                value={s.expected}
                onChange={e => update(i, 'expected', e.target.value)}
                rows={2}
                placeholder="Expected outcome…"
                className="w-full text-xs text-slate-700 resize-none outline-none bg-transparent px-2 py-1 rounded focus:bg-white focus:ring-1 focus:ring-emerald-300 placeholder:text-slate-300"
              />
              {steps.length > 1 && (
                <button onClick={() => removeStep(i)}
                  className="absolute top-1 right-1 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}
        {/* Add row shortcut */}
        <button onClick={addStep}
          className="w-full py-2 text-xs text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors flex items-center justify-center gap-1.5 border-t border-slate-100">
          <Plus className="w-3 h-3" /> Add step
        </button>
      </div>

      {/* Run Test button — only when steps exist */}
      {(hasSteps || steps.some(s => s.step.trim())) && !dirty && (
        <button
          onClick={() => {
            // navigate — issueKey is in scope via closure from parent (passed via prop)
            window.location.href = window.location.pathname.replace(/\/work-items.*/, `/automation?issueKey=${issueKey}`)
          }}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
        >
          <Zap className="w-4 h-4" /> Run Test
        </button>
      )}
    </div>
  )
}

function InlineAssigneePicker({ issueKey, projectKey, current, currentAvatar, onChanged }: {
  issueKey: string
  projectKey: string
  current: string
  currentAvatar: string
  onChanged: (name: string, avatar: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState<JiraUser[]>([])
  const [query, setQuery] = useState('')

  async function loadUsers(q = '') {
    try {
      const res = await fetch(`/api/jira/users?project=${projectKey}&q=${encodeURIComponent(q)}`)
      const data: JiraUser[] = res.ok ? await res.json() : []
      setUsers(data)
    } catch { setUsers([]) }
  }

  async function assign(u: JiraUser | null) {
    setSaving(true)
    setOpen(false)
    try {
      const res = await fetch(`/api/jira/issues/${issueKey}/assignee`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: u?.accountId ?? null }),
      })
      if (res.ok) {
        onChanged(u?.displayName ?? '', u?.avatar ?? '')
        toast.success(u ? `Assigned to ${u.displayName}` : 'Unassigned')
      } else toast.error('Failed to update assignee')
    } catch { toast.error('Failed to update assignee') }
    finally { setSaving(false) }
  }

  const filtered = query
    ? users.filter(u => u.displayName.toLowerCase().includes(query.toLowerCase()))
    : users

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(o => !o); if (!open) loadUsers() }}
        disabled={saving}
        title="Change assignee"
        className={`flex items-center gap-1.5 text-xs border px-2 py-0.5 rounded-full font-medium transition-colors
          ${current
            ? 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
            : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100 italic'}`}
      >
        {current
          ? <><UserAvatar name={current} avatar={currentAvatar} size={16} />{saving ? 'Saving…' : current}</>
          : <>{saving ? 'Saving…' : 'Unassigned'}</>}
        <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-40 bg-white border border-slate-200 rounded-lg shadow-xl w-56">
            <div className="p-2 border-b border-slate-100">
              <input
                autoFocus
                value={query}
                onChange={e => { setQuery(e.target.value); loadUsers(e.target.value) }}
                placeholder="Search people…"
                className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <div className="max-h-40 overflow-y-auto py-1">
              {current && (
                <button onClick={() => assign(null)}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600 flex items-center gap-2">
                  <X className="w-3 h-3" /> Unassign
                </button>
              )}
              {filtered.length === 0
                ? <p className="px-3 py-2 text-xs text-slate-400">No users found</p>
                : filtered.map(u => (
                  <button key={u.accountId} onClick={() => assign(u)}
                    className="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-violet-50 transition-colors">
                    <UserAvatar name={u.displayName} avatar={u.avatar} size={22} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-700 truncate">{u.displayName}</p>
                      {u.email && <p className="text-xs text-slate-400 truncate">{u.email}</p>}
                    </div>
                    {u.displayName === current && <span className="ml-auto text-violet-500 text-xs">✓</span>}
                  </button>
                ))
              }
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function DrawerMeta({ issue, projectKey, onStatusChange }: {
  issue: FullIssue
  projectKey: string
  onStatusChange: (s: string) => void
}) {
  const priorityCls = PRIORITY_COLOR[issue.priority] ?? 'text-slate-500'
  const created = issue.created ? new Date(issue.created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  const [assigneeName, setAssigneeName] = useState(issue.assignee)
  const [assigneeAvatar, setAssigneeAvatar] = useState(issue.assigneeAvatar)

  return (
    <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
      <StatusDropdown issueKey={issue.key} currentStatus={issue.status} onStatusChange={onStatusChange} />
      {issue.priority && (
        <span className={`text-xs font-medium ${priorityCls}`}>↑ {issue.priority}</span>
      )}
      {/* Assignee — clickable to change */}
      <InlineAssigneePicker
        issueKey={issue.key}
        projectKey={projectKey}
        current={assigneeName}
        currentAvatar={assigneeAvatar}
        onChanged={(name, avatar) => { setAssigneeName(name); setAssigneeAvatar(avatar) }}
      />
      {/* Reporter */}
      {issue.reporter && (
        <UserChip label="Reporter" name={issue.reporter} avatar={issue.reporterAvatar} color="slate" />
      )}
      {created && (
        <span className="text-xs text-slate-400 ml-auto">{created}</span>
      )}
    </div>
  )
}

function DrawerSection({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      {children}
    </div>
  )
}

// ── Issue Detail Drawer ──────────────────────────────────────────────────────

function IssueDrawer({
  issue, onClose, appId, router, projectKey, onCreateChild, openIssueFromDrawer,
}: {
  issue: FullIssue
  onClose: () => void
  appId: string
  router: ReturnType<typeof useRouter>
  projectKey: string
  onCreateChild?: (type: string, parentKey?: string) => void
  openIssueFromDrawer?: (key: string) => void
}) {
  const jiraBase = process.env.NEXT_PUBLIC_JIRA_BASE_URL ?? ''
  const type = issue.issueType
  const headerGrad = DRAWER_HEADER[type] ?? 'from-slate-600 to-slate-700'
  const userComments = issue.comments?.filter((c) => !c.body.startsWith('[QA-')) ?? []
  const [currentStatus, setCurrentStatus] = useState(issue.status)

  function nav(path: string) { router.push(path); onClose() }

  // Actions per type
  function DrawerActions() {
    if (type === 'Epic') return (
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-2">
        <Button size="sm" variant="outline"
          onClick={() => { onClose(); onCreateChild?.('Story', issue.key) }}
          className="border-orange-300 text-orange-700 hover:bg-orange-50 text-xs gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Create Story under Epic
        </Button>
        <a href={`${jiraBase}/browse/${issue.key}`} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline" className="text-xs gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> View in Jira
          </Button>
        </a>
      </div>
    )

    if (type === 'Story') return (
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-2">
        <Button size="sm"
          onClick={() => nav(`/apps/${appId}/manual-tc?issueKey=${issue.key}`)}
          className="bg-violet-600 hover:bg-violet-700 text-xs gap-1.5">
          <FlaskConical className="w-3.5 h-3.5" /> Generate Manual Test Cases
        </Button>
        <a href={`${jiraBase}/browse/${issue.key}`} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline" className="text-xs gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> View in Jira
          </Button>
        </a>
      </div>
    )

    if (type === 'Task') return (
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-2">
        <a href={`${jiraBase}/browse/${issue.key}`} target="_blank" rel="noreferrer">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-xs gap-1.5">
            <Wrench className="w-3.5 h-3.5" /> Update in Jira
          </Button>
        </a>
      </div>
    )

    if (type === 'Bug') return (
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-2">
        <Button size="sm"
          onClick={() => nav(`/apps/${appId}/manual-tc?issueKey=${issue.key}`)}
          className="bg-red-600 hover:bg-red-700 text-xs gap-1.5">
          <FlaskConical className="w-3.5 h-3.5" /> Generate Manual TC
        </Button>
        <Button size="sm" variant="outline"
          onClick={() => nav(`/apps/${appId}/manual-tc?issueKey=${issue.key}`)}
          className="border-red-300 text-red-700 hover:bg-red-50 text-xs gap-1.5">
          <Link className="w-3.5 h-3.5" /> Link Test Case
        </Button>
        <a href={`${jiraBase}/browse/${issue.key}`} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline" className="text-xs gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> View in Jira
          </Button>
        </a>
      </div>
    )

    if (type === 'Test Case') return (
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-2">
        <Button size="sm"
          onClick={() => nav(`/apps/${appId}/manual-tc?issueKey=${issue.key}`)}
          className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5">
          <FlaskConical className="w-3.5 h-3.5" /> Generate Test Cases
        </Button>
        <a href={`${jiraBase}/browse/${issue.key}`} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline" className="text-xs gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> View in Jira
          </Button>
        </a>
      </div>
    )

    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className={`px-5 py-4 bg-gradient-to-r ${headerGrad} flex items-start justify-between gap-3`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <Badge className="font-mono text-xs bg-white/20 text-white border-white/30">{issue.key}</Badge>
              <Badge className="text-xs bg-white/10 text-white border-white/20">{type}</Badge>
              <a href={`${jiraBase}/browse/${issue.key}`} target="_blank" rel="noreferrer" className="text-white/60 hover:text-white">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <h3 className="font-semibold text-white text-base leading-snug">{issue.summary}</h3>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white mt-0.5 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Parent breadcrumb */}
        {issue.parentKey && (
          <div className="px-5 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-1.5 text-xs text-slate-500">
            <Layers className="w-3 h-3 text-orange-400 shrink-0" />
            <span>Under</span>
            <button onClick={() => { onClose(); setTimeout(() => openIssueFromDrawer?.(issue.parentKey!), 50) }}
              className="font-mono text-orange-600 hover:underline font-medium">
              {issue.parentKey}
            </button>
            {issue.parentSummary && <span className="truncate text-slate-400">— {issue.parentSummary}</span>}
          </div>
        )}

        {/* Meta row */}
        <DrawerMeta issue={{ ...issue, status: currentStatus }} projectKey={projectKey} onStatusChange={setCurrentStatus} />

        {/* Type-specific actions */}
        <DrawerActions />

        {/* Body — fields per type */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">

          {/* Epic: describe the feature initiative */}
          {type === 'Epic' && issue.description && (
            <DrawerSection icon={FileText} label="Feature Description">
              <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{issue.description}</p>
            </DrawerSection>
          )}
          {type === 'Epic' && issue.children && issue.children.length > 0 && (
            <DrawerSection icon={BookOpen} label={`Child Stories (${issue.children.length})`}>
              <div className="space-y-1.5">
                {issue.children.map((c) => (
                  <button key={c.key} onClick={() => openIssueFromDrawer?.(c.key)}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 bg-violet-50 border border-violet-100 rounded-lg hover:border-violet-300 transition-all">
                    <Badge variant="outline" className="font-mono text-xs shrink-0 bg-violet-100 text-violet-700 border-violet-200">{c.key}</Badge>
                    <span className="text-sm text-slate-700 truncate">{c.summary}</span>
                    <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLOR[c.status] ?? 'bg-slate-100 text-slate-500'}`}>{c.status}</span>
                  </button>
                ))}
              </div>
            </DrawerSection>
          )}
          {type === 'Epic' && (
            <DrawerSection icon={Info} label="What goes in an Epic">
              <p className="text-xs text-slate-500 leading-relaxed">
                Epics represent large features or initiatives. Break them down into <strong>Stories</strong> that describe individual user-facing requirements. Stories are then linked to manual test cases.
              </p>
            </DrawerSection>
          )}

          {/* Story: what goes in */}
          {type === 'Story' && (
            <DrawerSection icon={Info} label="What goes in a Story">
              <p className="text-xs text-slate-500 leading-relaxed">
                Include: <strong>User story</strong> ("As a… I want… So that…"), <strong>Acceptance criteria</strong>, and the <strong>scope</strong> of what's being tested. Link to manual test cases that verify the story is complete.
              </p>
            </DrawerSection>
          )}

          {/* Story: description + acceptance criteria */}
          {type === 'Story' && issue.description && (
            <DrawerSection icon={FileText} label="User Story">
              <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{issue.description}</p>
            </DrawerSection>
          )}
          {type === 'Story' && issue.acceptanceCriteria && (
            <DrawerSection icon={CheckSquare} label="Acceptance Criteria">
              <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{issue.acceptanceCriteria}</p>
            </DrawerSection>
          )}
          {type === 'Story' && issue.children && issue.children.length > 0 && (
            <DrawerSection icon={FlaskConical} label={`Linked Test Cases (${issue.children.length})`}>
              <div className="space-y-1.5">
                {issue.children.map((c) => (
                  <button key={c.key} onClick={() => openIssueFromDrawer?.(c.key)}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg hover:border-emerald-300 transition-all">
                    <Badge variant="outline" className="font-mono text-xs shrink-0 bg-emerald-100 text-emerald-700 border-emerald-200">{c.key}</Badge>
                    <span className="text-sm text-slate-700 truncate">{c.summary}</span>
                    <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLOR[c.status] ?? 'bg-slate-100 text-slate-500'}`}>{c.status}</span>
                  </button>
                ))}
              </div>
            </DrawerSection>
          )}

          {/* Task: description of work done / to be done */}
          {type === 'Task' && issue.description && (
            <DrawerSection icon={Wrench} label="Task Description">
              <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{issue.description}</p>
            </DrawerSection>
          )}
          {type === 'Task' && (
            <DrawerSection icon={Info} label="What goes in a Task">
              <p className="text-xs text-slate-500 leading-relaxed">
                Tasks track technical work items. Add a description of what needs to be done, update status as work progresses, and log time spent directly in Jira.
              </p>
            </DrawerSection>
          )}

          {/* Bug: description contains steps to reproduce, expected vs actual */}
          {type === 'Bug' && issue.description && (
            <DrawerSection icon={AlertTriangle} label="Bug Description / Steps to Reproduce">
              <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{issue.description}</p>
            </DrawerSection>
          )}
          {type === 'Bug' && (
            <DrawerSection icon={Info} label="What goes in a Bug">
              <p className="text-xs text-slate-500 leading-relaxed">
                Include: <strong>Steps to reproduce</strong>, <strong>Expected result</strong>, <strong>Actual result</strong>, environment, and severity. Link the related manual test case that caught this bug.
              </p>
            </DrawerSection>
          )}

          {/* Test Case: interactive step table */}
          {type === 'Test Case' && (
            <TestStepTable issueKey={issue.key} initialSteps={issue.testSteps ?? []} />
          )}

          {/* Comments — all types */}
          {userComments.length > 0 && (
            <DrawerSection icon={MessageSquare} label={`Comments (${userComments.length})`}>
              <div className="space-y-2">
                {userComments.slice(0, 5).map((c) => (
                  <div key={c.id} className="bg-slate-50 rounded-lg px-3 py-2 text-xs">
                    <span className="font-medium text-slate-600">{c.author}: </span>
                    <span className="text-slate-500">{c.body.slice(0, 200)}{c.body.length > 200 ? '…' : ''}</span>
                  </div>
                ))}
              </div>
            </DrawerSection>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Type Container ───────────────────────────────────────────────────────────

function TypeContainer({
  type, issues, loading, onSelect, onCreateClick,
}: {
  type: string
  issues: SearchResult[]
  loading: boolean
  onSelect: (key: string) => void
  onCreateClick: (type: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const cfg = getConfig(type)
  const Icon = cfg.icon

  const pluralLabel = type === 'Story' ? 'Stories' : type === 'Bug' ? 'Bugs' : type === 'Epic' ? 'Epics' : `${type}s`

  return (
    <div className={`border rounded-2xl overflow-hidden shadow-sm ${cfg.color}`}>
      {/* Header */}
      <div className={`bg-gradient-to-r ${cfg.headerGrad} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center">
            <Icon className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">{pluralLabel}</span>
          {!loading && (
            <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-medium tabular-nums">
              {issues.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onCreateClick(type)}
            className="flex items-center gap-1 text-xs text-white font-medium bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-lg transition-all"
          >
            <Plus className="w-3 h-3" /> New
          </button>
          <button onClick={() => setCollapsed((c) => !c)} className="w-6 h-6 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-all">
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="p-3 space-y-1.5">
          {loading ? (
            <div className="flex items-center gap-2 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
              <span className="text-xs text-slate-400">Loading…</span>
            </div>
          ) : issues.length === 0 ? (
            <div className="py-6 px-3 text-center space-y-1">
              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-2">
                <Icon className="w-4 h-4 text-slate-300" />
              </div>
              <p className="text-xs font-medium text-slate-400">No {pluralLabel.toLowerCase()} found</p>
              <p className="text-xs text-slate-300 leading-relaxed max-w-[200px] mx-auto">{cfg.emptyText}</p>
            </div>
          ) : (
            <>
              {issues.slice(0, 5).map((issue) => (
                <button
                  key={issue.key}
                  onClick={() => onSelect(issue.key)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 bg-white rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all group"
                >
                  <Badge variant="outline" className={`font-mono text-xs shrink-0 ${cfg.badge}`}>
                    {issue.key}
                  </Badge>
                  <span className="text-sm text-slate-700 truncate group-hover:text-slate-900">
                    {issue.summary}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400 shrink-0 ml-auto" />
                </button>
              ))}
              {issues.length > 5 && (
                <p className="text-xs text-center text-slate-400 pt-1">+{issues.length - 5} more</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({
  issueTypes, defaultType, projectKey, parentKey, parentSummary, onClose, onCreated,
}: {
  issueTypes: string[]
  defaultType: string
  projectKey: string
  parentKey?: string
  parentSummary?: string
  onClose: () => void
  onCreated: (key: string, type: string, summary: string) => void
}) {
  const [createType, setCreateType] = useState(defaultType)
  const [summary, setSummary] = useState('')
  const [desc, setDesc] = useState('')
  const [assignee, setAssignee] = useState<JiraUser | null>(null)
  const [reporter, setReporter] = useState<JiraUser | null>(null)
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!summary.trim()) return
    if (!projectKey) {
      toast.error('No Jira project linked — go to Settings and set a project key')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/jira/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: projectKey,
          fields: {
            summary, description: desc, issueType: createType,
            ...(parentKey ? { parentKey } : {}),
            ...(assignee ? { assigneeAccountId: assignee.accountId } : {}),
            ...(reporter ? { reporterAccountId: reporter.accountId } : {}),
          },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Created ${data.key}`)
        onCreated(data.key, createType, summary)
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Failed to create issue')
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to create issue') }
    finally { setCreating(false) }
  }

  const TYPE_COLOR: Record<string, string> = {
    Task: 'bg-blue-100 text-blue-700',
    Story: 'bg-purple-100 text-purple-700',
    Bug: 'bg-red-100 text-red-700',
    Epic: 'bg-orange-100 text-orange-700',
    'Test Case': 'bg-emerald-100 text-emerald-700',
    Subtask: 'bg-slate-100 text-slate-600',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,10,30,0.5)', backdropFilter: 'blur(4px)' }}>
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-indigo-700 px-6 pt-5 pb-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center">
                <Plus className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-white font-semibold text-sm">Create work item</span>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors">
              <X className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
          <p className="text-white/50 text-xs mt-1 pl-8">
            {projectKey && <span className="font-mono">{projectKey}</span>}
            {parentKey && <span> · under <span className="font-mono font-semibold text-white/70">{parentKey}</span>{parentSummary && ` — ${parentSummary}`}</span>}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Type chips */}
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-2">Type</label>
            <div className="flex flex-wrap gap-2">
              {issueTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setCreateType(t)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                    createType === t
                      ? 'border-violet-500 bg-violet-50 text-violet-700 shadow-sm'
                      : `border-slate-200 ${TYPE_COLOR[t] ?? 'bg-slate-50 text-slate-600'} hover:border-slate-300`
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">
              Summary <span className="text-rose-400">*</span>
            </label>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
              placeholder="Brief title…"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Description</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm resize-none placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
              placeholder="Optional description…"
            />
          </div>

          {/* Assignee + Reporter */}
          <div className="grid grid-cols-2 gap-3">
            <UserPicker label="Assignee" projectKey={projectKey} value={assignee} onChange={setAssignee} />
            <UserPicker label="Reporter" projectKey={projectKey} value={reporter} onChange={setReporter} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {summary.trim() ? `Creating as ${createType}` : 'Enter a title to continue'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="h-9 px-4 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 active:scale-[0.98] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !summary.trim()}
              className="h-9 px-5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-sm font-semibold shadow-md shadow-violet-200 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {creating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</> : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Pie Chart ────────────────────────────────────────────────────────────────

const PIE_COLORS: Record<string, string> = {
  Story: '#7c3aed',
  Bug: '#ef4444',
  Task: '#2563eb',
  Epic: '#f97316',
  'Test Case': '#059669',
}
const DEFAULT_PIE_COLOR = '#64748b'

function IssuesPieChart({ issueTypes, issuesByType, loading }: {
  issueTypes: string[]
  issuesByType: Record<string, SearchResult[]>
  loading: boolean
}) {
  const data = issueTypes.map((t) => ({
    type: t,
    count: issuesByType[t]?.length ?? 0,
    color: PIE_COLORS[t] ?? DEFAULT_PIE_COLOR,
  })).filter((d) => d.count > 0)

  const total = data.reduce((s, d) => s + d.count, 0)

  // Build SVG pie slices (handle single-item 100% case with a full circle)
  const R = 70; const cx = 90; const cy = 90
  let angle = -Math.PI / 2
  const slices = data.length === 1
    ? [{ ...data[0], frac: 1, path: `M${cx},${cy - R} A${R},${R} 0 1 1 ${cx - 0.01},${cy - R} Z` }]
    : data.map((d) => {
        const frac = d.count / total
        const start = angle
        angle += frac * 2 * Math.PI
        const end = angle
        const x1 = cx + R * Math.cos(start); const y1 = cy + R * Math.sin(start)
        const x2 = cx + R * Math.cos(end);   const y2 = cy + R * Math.sin(end)
        const large = frac > 0.5 ? 1 : 0
        return { ...d, frac, path: `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z` }
      })

  return (
    <div className="border border-slate-100 rounded-2xl bg-white p-5 shadow-sm flex flex-col h-full">
      <h3 className="text-sm font-semibold text-slate-700 mb-4">Issue Distribution</h3>
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
        </div>
      ) : total === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-slate-400">No issues yet</div>
      ) : (
        <div className="flex items-center gap-4 flex-1">
          {/* SVG donut */}
          <div className="shrink-0">
            <svg width="180" height="180" viewBox="0 0 180 180">
              {slices.map((s) => (
                <path key={s.type} d={s.path} fill={s.color} stroke="white" strokeWidth="2" />
              ))}
              {/* Center hole */}
              <circle cx={cx} cy={cy} r={38} fill="white" />
              <text x={cx} y={cy - 6} textAnchor="middle" className="text-xl font-bold" style={{ fontSize: 22, fontWeight: 700, fill: '#1e293b' }}>{total}</text>
              <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: 10, fill: '#94a3b8' }}>total</text>
            </svg>
          </div>
          {/* Legend */}
          <div className="space-y-2 flex-1">
            {data.map((d) => (
              <div key={d.type} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-xs text-slate-600 truncate">{d.type}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs font-semibold text-slate-800">{d.count}</span>
                  <span className="text-xs text-slate-400">({Math.round((d.count / total) * 100)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function WorkItemsPage() {
  const params = useParams()
  const router = useRouter()
  const appId = params.appId as string

  const [projectKey, setProjectKey] = useState('')
  const [issueTypes, setIssueTypes] = useState<string[]>([])
  const [issuesByType, setIssuesByType] = useState<Record<string, SearchResult[]>>({})
  const [loadingTypes, setLoadingTypes] = useState<Record<string, boolean>>({})

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  const [selectedIssue, setSelectedIssue] = useState<FullIssue | null>(null)
  const [fetchingIssue, setFetchingIssue] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [createDefaultType, setCreateDefaultType] = useState('')
  const [createParentKey, setCreateParentKey] = useState<string | undefined>()
  const [createParentSummary, setCreateParentSummary] = useState<string | undefined>()

  // Init: fetch project key → issue types → issues per type
  useEffect(() => {
    async function init() {
      try {
        const appsRes = await fetch('/api/apps')
        const apps = await appsRes.json()
        const app = apps.find((a: { id: string }) => a.id === appId)
        const pk = app?.jiraProjectKey ?? ''
        setProjectKey(pk)

        const typesRes = await fetch(`/api/jira/issue-types${pk ? `?project=${pk}` : ''}`)
        const types: string[] = typesRes.ok ? await typesRes.json() : ['Story', 'Task', 'Bug', 'Epic']
        setIssueTypes(types)
        setCreateDefaultType(types[0] ?? 'Task')

        // Fetch issues for each type in parallel
        const loadingInit: Record<string, boolean> = {}
        types.forEach((t) => { loadingInit[t] = true })
        setLoadingTypes(loadingInit)

        await Promise.all(types.map(async (type) => {
          try {
            const res = await fetch(`/api/jira/issues?project=${pk}&q=&type=${encodeURIComponent(type)}`)
            const data: SearchResult[] = res.ok ? await res.json() : []
            setIssuesByType((prev) => ({ ...prev, [type]: data }))
          } catch {
            setIssuesByType((prev) => ({ ...prev, [type]: [] }))
          } finally {
            setLoadingTypes((prev) => ({ ...prev, [type]: false }))
          }
        }))
      } catch { /* ignore */ }
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openIssue(key: string) {
    setFetchingIssue(true)
    try {
      const res = await fetch(`/api/jira/issues/${key.trim().toUpperCase()}`)
      if (res.ok) setSelectedIssue(await res.json())
      else toast.error('Issue not found')
    } catch { toast.error('Failed to load issue') }
    finally { setFetchingIssue(false) }
  }

  async function handleSearch(q: string) {
    setSearchQuery(q)
    if (!q.trim()) { setSearchResults(null); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/jira/issues?project=${projectKey}&q=${encodeURIComponent(q)}`)
      const data: SearchResult[] = res.ok ? await res.json() : []
      setSearchResults(data)
    } catch { setSearchResults([]) }
    finally { setSearching(false) }
  }

  function handleCreated(key: string, type: string, summary: string) {
    setShowCreate(false)
    setCreateParentKey(undefined)
    setCreateParentSummary(undefined)
    // Prepend new issue to the correct type bucket
    setIssuesByType((prev) => ({
      ...prev,
      [type]: [{ key, summary }, ...(prev[type] ?? [])],
    }))
    openIssue(key)
  }

  return (
    <div className="space-y-5">

      {/* Global search bar */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search across all work items…"
            className="flex-1 text-sm text-slate-700 placeholder:text-slate-400 bg-transparent focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchResults(null) }}
              className="w-5 h-5 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors shrink-0">
              <X className="w-3 h-3 text-slate-500" />
            </button>
          )}
        </div>

        {/* Search results */}
        {(searching || searchResults) && searchQuery && (
          <div className="border-t border-slate-100 px-3 pb-3 pt-2 space-y-1">
            {searching ? (
              <div className="flex items-center gap-2 py-2 px-2 text-xs text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
              </div>
            ) : searchResults && searchResults.length === 0 ? (
              <p className="text-xs text-slate-400 px-2 py-2">No results found</p>
            ) : searchResults?.map((r) => (
              <button key={r.key} onClick={() => openIssue(r.key)}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-100 hover:border-violet-200 hover:bg-violet-50 transition-all">
                <Badge variant="outline" className="font-mono text-xs shrink-0">{r.key}</Badge>
                <span className="text-sm text-slate-600 truncate">{r.summary}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Per-type containers + pie chart */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {issueTypes.map((type) => (
          <TypeContainer
            key={type}
            type={type}
            issues={issuesByType[type] ?? []}
            loading={loadingTypes[type] ?? true}
            onSelect={openIssue}
            onCreateClick={(t) => { setCreateDefaultType(t); setShowCreate(true) }}
          />
        ))}
        {/* Fill the empty grid slot with the pie chart */}
        {issueTypes.length % 2 !== 0 && (
          <IssuesPieChart
            issueTypes={issueTypes}
            issuesByType={issuesByType}
            loading={Object.values(loadingTypes).some(Boolean)}
          />
        )}
        {/* If even number of types, add chart as full-width row below */}
        {issueTypes.length % 2 === 0 && (
          <div className="md:col-span-2">
            <div className="max-w-sm">
              <IssuesPieChart
                issueTypes={issueTypes}
                issuesByType={issuesByType}
                loading={Object.values(loadingTypes).some(Boolean)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Issue detail drawer */}
      {(selectedIssue || fetchingIssue) && (
        fetchingIssue ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
          </div>
        ) : selectedIssue ? (
          <IssueDrawer
            issue={selectedIssue}
            onClose={() => setSelectedIssue(null)}
            appId={appId}
            router={router}
            projectKey={projectKey}
            openIssueFromDrawer={(key) => { setSelectedIssue(null); setTimeout(() => openIssue(key), 50) }}
            onCreateChild={(type, parentKey) => {
              setSelectedIssue(null)
              setCreateDefaultType(type)
              setCreateParentKey(parentKey)
              setCreateParentSummary(selectedIssue?.summary)
              setShowCreate(true)
            }}
          />
        ) : null
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          issueTypes={issueTypes}
          defaultType={createDefaultType}
          projectKey={projectKey}
          parentKey={createParentKey}
          parentSummary={createParentSummary}
          onClose={() => { setShowCreate(false); setCreateParentKey(undefined); setCreateParentSummary(undefined) }}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
