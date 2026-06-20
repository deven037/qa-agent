'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Search, Plus, FileText, CheckSquare, MessageSquare, ExternalLink,
  X, BookOpen, Bug, Layers, Zap, ClipboardList, Loader2, ChevronDown, ChevronUp,
  GitBranch, FlaskConical, Wrench, AlertTriangle, Info,
} from 'lucide-react'
import { toast } from 'sonner'

interface SearchResult { key: string; summary: string }

interface IssueChild { key: string; summary: string; issueType: string; status: string }

interface FullIssue {
  key: string
  summary: string
  issueType: string
  status: string
  priority: string
  reporter: string
  created: string
  description?: string
  acceptanceCriteria?: string
  comments?: { id: string; body: string; author: string }[]
  children?: IssueChild[]
  parentKey?: string
  parentSummary?: string
}

// Color + icon config per issue type
const TYPE_CONFIG: Record<string, { color: string; header: string; icon: React.ElementType; badge: string }> = {
  Story:       { color: 'border-violet-200 bg-violet-50',  header: 'bg-violet-600',  icon: BookOpen,     badge: 'bg-violet-100 text-violet-700 border-violet-200' },
  Bug:         { color: 'border-red-200 bg-red-50',        header: 'bg-red-500',      icon: Bug,          badge: 'bg-red-100 text-red-700 border-red-200' },
  Task:        { color: 'border-blue-200 bg-blue-50',      header: 'bg-blue-600',     icon: ClipboardList, badge: 'bg-blue-100 text-blue-700 border-blue-200' },
  Epic:        { color: 'border-orange-200 bg-orange-50',  header: 'bg-orange-500',   icon: Layers,       badge: 'bg-orange-100 text-orange-700 border-orange-200' },
  'Test Case': { color: 'border-emerald-200 bg-emerald-50', header: 'bg-emerald-600', icon: Zap,          badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
}

const DEFAULT_CONFIG = { color: 'border-slate-200 bg-slate-50', header: 'bg-slate-500', icon: ClipboardList, badge: 'bg-slate-100 text-slate-700 border-slate-200' }

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

function DrawerMeta({ issue }: { issue: FullIssue }) {
  const statusCls = STATUS_COLOR[issue.status] ?? 'bg-slate-100 text-slate-600'
  const priorityCls = PRIORITY_COLOR[issue.priority] ?? 'text-slate-500'
  const created = issue.created ? new Date(issue.created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  return (
    <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusCls}`}>{issue.status}</span>
      {issue.priority && (
        <span className={`text-xs font-medium ${priorityCls}`}>↑ {issue.priority}</span>
      )}
      {issue.reporter && (
        <span className="text-xs text-slate-400">by {issue.reporter}</span>
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
  issue, onClose, appId, router, onCreateChild, openIssueFromDrawer,
}: {
  issue: FullIssue
  onClose: () => void
  appId: string
  router: ReturnType<typeof useRouter>
  onCreateChild?: (type: string, parentKey?: string) => void
  openIssueFromDrawer?: (key: string) => void
}) {
  const jiraBase = process.env.NEXT_PUBLIC_JIRA_BASE_URL ?? ''
  const type = issue.issueType
  const headerGrad = DRAWER_HEADER[type] ?? 'from-slate-600 to-slate-700'
  const userComments = issue.comments?.filter((c) => !c.body.startsWith('[QA-')) ?? []

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
          onClick={() => nav(`/apps/${appId}/automation?issueKey=${issue.key}`)}
          className="bg-red-600 hover:bg-red-700 text-xs gap-1.5">
          <Zap className="w-3.5 h-3.5" /> Generate Regression Automation
        </Button>
        <Button size="sm" variant="outline"
          onClick={() => nav(`/apps/${appId}/manual-tc?issueKey=${issue.key}`)}
          className="border-red-300 text-red-700 hover:bg-red-50 text-xs gap-1.5">
          <FlaskConical className="w-3.5 h-3.5" /> Link Manual Test Case
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
          onClick={() => nav(`/apps/${appId}/automation?issueKey=${issue.key}`)}
          className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5">
          <Zap className="w-3.5 h-3.5" /> Generate Automation
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
        <DrawerMeta issue={issue} />

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

          {/* Test Case: manual steps in description */}
          {type === 'Test Case' && issue.description && (
            <DrawerSection icon={FlaskConical} label="Manual Test Steps">
              <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{issue.description}</p>
            </DrawerSection>
          )}
          {type === 'Test Case' && (
            <DrawerSection icon={Info} label="What goes in a Test Case">
              <p className="text-xs text-slate-500 leading-relaxed">
                Manual test cases contain step-by-step instructions: <strong>Preconditions</strong>, <strong>Steps</strong> (Given / When / Then), and <strong>Expected Result</strong>. Use &quot;Generate Automation&quot; to convert them to Playwright scripts.
              </p>
            </DrawerSection>
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

  return (
    <div className={`border rounded-xl overflow-hidden ${cfg.color}`}>
      {/* Header */}
      <div className={`${cfg.header} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-white/80" />
          <span className="text-sm font-semibold text-white">
            {type === 'Story' ? 'Stories' : type === 'Bug' ? 'Bugs' : type === 'Epic' ? 'Epics' : `${type}s`}
          </span>
          {!loading && (
            <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-medium">
              {issues.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onCreateClick(type)}
            className="flex items-center gap-1 text-xs text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-2 py-1 rounded-lg transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
          <button onClick={() => setCollapsed((c) => !c)} className="text-white/60 hover:text-white">
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="p-3 space-y-1.5">
          {loading ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              <span className="text-xs text-slate-400">Loading…</span>
            </div>
          ) : issues.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">
              No {type === 'Story' ? 'stories' : type === 'Bug' ? 'bugs' : type === 'Epic' ? 'epics' : `${type.toLowerCase()}s`} found
            </p>
          ) : (
            <>
              {issues.slice(0, 5).map((issue) => (
                <button
                  key={issue.key}
                  onClick={() => onSelect(issue.key)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 bg-white rounded-lg border border-white hover:border-slate-200 hover:shadow-sm transition-all group"
                >
                  <Badge variant="outline" className={`font-mono text-xs shrink-0 ${cfg.badge}`}>
                    {issue.key}
                  </Badge>
                  <span className="text-sm text-slate-700 truncate group-hover:text-slate-900">{issue.summary}</span>
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
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!summary.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/jira/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: projectKey,
          fields: { summary, description: desc, issueType: createType, ...(parentKey ? { parentKey } : {}) },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Created ${data.key}`)
        onCreated(data.key, createType, summary)
      } else toast.error('Failed to create issue')
    } catch { toast.error('Failed to create issue') }
    finally { setCreating(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Plus className="w-4 h-4 text-violet-600" /> Create Work Item
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        {parentKey && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            <Layers className="w-3.5 h-3.5 text-orange-500 shrink-0" />
            <span className="text-xs text-orange-700">
              Under Epic <span className="font-mono font-semibold">{parentKey}</span>
              {parentSummary && <span className="text-orange-500"> — {parentSummary}</span>}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Type</label>
            <select value={createType} onChange={(e) => setCreateType(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400">
              {issueTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Summary *</label>
            <input value={summary} onChange={(e) => setSummary(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              placeholder="Brief title..." autoFocus />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Description</label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400"
            placeholder="Optional description…" />
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !summary.trim()} className="bg-violet-600 hover:bg-violet-700">
            {creating ? 'Creating…' : 'Create'}
          </Button>
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
    <div className="border border-slate-200 rounded-xl bg-white p-4 shadow-sm flex flex-col h-full">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Issue Distribution</h3>
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
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search across all work items…"
              className="w-full h-10 pl-10 pr-9 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 text-sm transition-colors"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults(null) }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <Button onClick={() => { setCreateDefaultType(issueTypes[0] ?? 'Task'); setCreateParentKey(undefined); setCreateParentSummary(undefined); setShowCreate(true) }}
            className="bg-violet-600 hover:bg-violet-700 gap-1.5 shrink-0">
            <Plus className="w-4 h-4" /> New Item
          </Button>
        </div>

        {/* Search results dropdown */}
        {(searching || searchResults) && searchQuery && (
          <div className="mt-2 space-y-1">
            {searching ? (
              <div className="flex items-center gap-2 py-2 px-3 text-xs text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
              </div>
            ) : searchResults && searchResults.length === 0 ? (
              <p className="text-xs text-slate-400 px-3 py-2">No results found</p>
            ) : searchResults?.map((r) => (
              <button key={r.key} onClick={() => openIssue(r.key)}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 border border-slate-100 bg-slate-50 rounded-lg hover:border-violet-200 hover:bg-violet-50 transition-all">
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
