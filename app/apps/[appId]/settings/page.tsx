'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Save, Trash2, ChevronDown, FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'

function toJiraKey(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10)
  return words.map((w) => w[0]).join('').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10)
}

interface JiraProject { key: string; name: string; id: string }

type AuthStrategy = 'no-auth' | 'email-password' | 'api-key'

interface AppForm {
  name: string
  baseUrl: string
  jiraProjectKey: string
  authStrategy: AuthStrategy
  email: string
  password: string
  apiKey: string
}

export default function SettingsPage() {
  const { appId } = useParams<{ appId: string }>()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [projects, setProjects] = useState<JiraProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [cloningSchemes, setCloningSchemes] = useState(false)
  const [cloneSourceKey, setCloneSourceKey] = useState('')
  const [syncingTypes, setSyncingTypes] = useState(false)
  const [syncingFields, setSyncingFields] = useState(false)
  const [editingKey, setEditingKey] = useState(false)

  const [form, setForm] = useState<AppForm>({
    name: '',
    baseUrl: '',
    jiraProjectKey: '',
    authStrategy: 'no-auth',
    email: '',
    password: '',
    apiKey: '',
  })

  useEffect(() => {
    fetch(`/api/apps/${appId}`)
      .then((r) => r.json())
      .then((app) => {
        setForm({
          name: app.name ?? '',
          baseUrl: app.baseUrl ?? '',
          jiraProjectKey: app.jiraProjectKey ?? '',
          authStrategy: app.authStrategy ?? 'no-auth',
          email: app.credentials?.email ?? '',
          password: app.credentials?.password ?? '',
          apiKey: app.credentials?.apiKey ?? '',
        })
      })
      .catch(() => toast.error('Failed to load app settings'))
      .finally(() => setLoading(false))

    setLoadingProjects(true)
    fetch('/api/jira/projects')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) ? setProjects(data) : setProjects([]))
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false))
  }, [appId])

  function set(field: keyof AppForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const credentials: Record<string, string> = {}
      if (form.authStrategy === 'email-password') {
        if (form.email) credentials.email = form.email
        if (form.password) credentials.password = form.password
      } else if (form.authStrategy === 'api-key') {
        if (form.apiKey) credentials.apiKey = form.apiKey
      }

      const res = await fetch(`/api/apps/${appId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          baseUrl: form.baseUrl,
          jiraProjectKey: form.jiraProjectKey,
          authStrategy: form.authStrategy,
          credentials,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success('Settings saved')
      router.push(`/apps/${appId}/dashboard`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const [customKey, setCustomKey] = useState('')

  async function handleCloneSchemes() {
    if (!form.jiraProjectKey) return toast.error('Select a target Jira project first')
    if (!cloneSourceKey) return toast.error('Select a source project to clone from')
    if (cloneSourceKey === form.jiraProjectKey) return toast.error('Source and target must be different projects')
    setCloningSchemes(true)
    try {
      const res = await fetch('/api/jira/projects/clone-schemes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProjectKey: form.jiraProjectKey, sourceProjectKey: cloneSourceKey }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to clone settings')
      }
      toast.success(`Settings cloned from ${cloneSourceKey} → ${form.jiraProjectKey}`)
      setCloneSourceKey('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to clone settings')
    } finally {
      setCloningSchemes(false)
    }
  }

  async function handleSyncIssueTypes() {
    if (!form.jiraProjectKey) return toast.error('Select a target Jira project first')
    if (!cloneSourceKey) return toast.error('Select a source project to sync from')
    setSyncingTypes(true)
    try {
      const res = await fetch('/api/jira/projects/sync-issue-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProjectKey: form.jiraProjectKey, sourceProjectKey: cloneSourceKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to sync issue types')
      if (data.added.length > 0) {
        toast.success(`Added issue types: ${data.added.join(', ')}`)
      } else {
        toast.info('No missing issue types — projects are already in sync')
      }
      if (data.skipped.length > 0) {
        toast.warning(`Could not add: ${data.skipped.join(', ')}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to sync issue types')
    } finally {
      setSyncingTypes(false)
    }
  }

  async function handleSyncFields() {
    if (!form.jiraProjectKey) return toast.error('Select a Jira project first')
    setSyncingFields(true)
    try {
      const res = await fetch('/api/jira/projects/sync-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey: form.jiraProjectKey }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed')
      }
      toast.success('Reporter, Assignee & Priority fields added to project screens')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to sync fields')
    } finally {
      setSyncingFields(false)
    }
  }

  async function handleCreateJiraProject() {
    if (!form.name) return toast.error('App name is required to create a Jira project')
    const key = (customKey || toJiraKey(form.name)).toUpperCase()
    setCreatingProject(true)
    try {
      const res = await fetch('/api/jira/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          key,
          sourceProjectKey: form.jiraProjectKey || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to create Jira project')
      }
      const project: JiraProject = await res.json()
      setProjects((prev) => [...prev, project])
      set('jiraProjectKey', project.key)
      toast.success(`Jira project "${project.key}" created`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create Jira project')
    } finally {
      setCreatingProject(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/apps/${appId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      toast.success('App deleted')
      router.push('/dashboard')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete')
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">App Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Update this app&apos;s configuration and credentials.</p>
      </div>

      {/* General */}
      <section className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        <div className="px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">General</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <Field label="App Name">
            <input
              className={input}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="My Web App"
            />
          </Field>
          <Field label="Base URL">
            <input
              className={input}
              value={form.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
              placeholder="https://staging.myapp.com"
            />
          </Field>
          <Field label="Jira Project">
            {loadingProjects ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading projects…
              </div>
            ) : projects.length > 0 ? (
              <div className="relative">
                <select
                  className={`${input} appearance-none pr-8`}
                  value={form.jiraProjectKey}
                  onChange={(e) => set('jiraProjectKey', e.target.value)}
                >
                  <option value="">Select a project…</option>
                  {projects.map((p) => (
                    <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            ) : (
              <input
                className={`${input} font-mono uppercase`}
                value={form.jiraProjectKey}
                onChange={(e) => set('jiraProjectKey', e.target.value.toUpperCase())}
                placeholder="KAN"
              />
            )}
            <p className="text-xs text-slate-400 mt-1">Issues from this Jira project will appear in Work Items.</p>

            {/* Clone schemes from another project */}
            {form.jiraProjectKey && projects.length > 1 && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                <p className="text-xs font-medium text-blue-700">Clone settings into <span className="font-mono">{form.jiraProjectKey}</span></p>
                <p className="text-xs text-blue-600">Copies issue types, workflows and board config from another project into the current one.</p>
                <div className="flex gap-2 items-center">
                  <div className="relative flex-1">
                    <select
                      className={`${input} appearance-none pr-8`}
                      value={cloneSourceKey}
                      onChange={(e) => setCloneSourceKey(e.target.value)}
                    >
                      <option value="">Select source project…</option>
                      {projects.filter((p) => p.key !== form.jiraProjectKey).map((p) => (
                        <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSyncIssueTypes}
                    disabled={syncingTypes || !cloneSourceKey}
                    className="bg-blue-600 hover:bg-blue-700 text-white shrink-0"
                  >
                    {syncingTypes
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Syncing…</>
                      : 'Sync Issue Types'
                    }
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSyncFields}
                  disabled={syncingFields}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white mt-2"
                >
                  {syncingFields
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Adding fields…</>
                    : 'Fix Missing Fields (Reporter, Assignee, Priority)'
                  }
                </Button>
              </div>
            )}

            {form.jiraProjectKey && projects.some((p) => p.key === form.jiraProjectKey) ? (
              /* Project already linked and exists in Jira — offer to edit the key */
              !editingKey ? (
                <button
                  type="button"
                  onClick={() => { setEditingKey(true); setCustomKey(form.jiraProjectKey) }}
                  className="mt-2 text-xs text-violet-600 hover:text-violet-700 underline underline-offset-2"
                >
                  Change project key
                </button>
              ) : (
                <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <p className="text-xs font-medium text-slate-600">Edit Jira project key</p>
                  <div className="flex gap-2 items-center">
                    <input
                      className={`${input} font-mono uppercase flex-1`}
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                      placeholder="KEY"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => { set('jiraProjectKey', customKey); setEditingKey(false) }}
                      disabled={!customKey}
                      className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
                    >
                      Apply
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingKey(false)}
                      className="shrink-0"
                    >
                      Cancel
                    </Button>
                  </div>
                  <p className="text-xs text-slate-400">This only updates the key saved in this app — it does not rename the Jira project.</p>
                </div>
              )
            ) : (
              /* No project linked yet — show create panel */
              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <p className="text-xs font-medium text-slate-600">Create a new Jira project for this app</p>
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <input
                      className={`${input} font-mono uppercase`}
                      value={customKey || toJiraKey(form.name)}
                      onChange={(e) => setCustomKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                      placeholder={toJiraKey(form.name) || 'KEY'}
                    />
                    <p className="text-xs text-slate-400 mt-1">Jira project key — short tag like CRM, WEB, SHOP</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCreateJiraProject}
                    disabled={creatingProject || !form.name}
                    className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
                  >
                    {creatingProject
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Creating…</>
                      : <><FolderPlus className="w-3.5 h-3.5 mr-1.5" /> Create</>
                    }
                  </Button>
                </div>
              </div>
            )}
          </Field>
        </div>
      </section>

      {/* Auth */}
      <section className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        <div className="px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Authentication</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <Field label="Strategy">
            <select
              className={input}
              value={form.authStrategy}
              onChange={(e) => set('authStrategy', e.target.value as AuthStrategy)}
            >
              <option value="no-auth">No Auth</option>
              <option value="email-password">Email + Password</option>
              <option value="api-key">API Key</option>
            </select>
          </Field>

          {form.authStrategy === 'email-password' && (
            <>
              <Field label="Email">
                <input
                  className={input}
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  placeholder="user@example.com"
                />
              </Field>
              <Field label="Password">
                <input
                  className={input}
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  placeholder="••••••••"
                />
              </Field>
            </>
          )}

          {form.authStrategy === 'api-key' && (
            <Field label="API Key">
              <input
                className={input}
                value={form.apiKey}
                onChange={(e) => set('apiKey', e.target.value)}
                placeholder="sk-..."
              />
            </Field>
          )}
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button onClick={handleSave} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>

        <Button
          variant="ghost"
          onClick={handleDelete}
          disabled={deleting}
          className={confirmDelete ? 'text-red-600 border border-red-300 hover:bg-red-50' : 'text-red-500 hover:text-red-600 hover:bg-red-50'}
        >
          {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
          {confirmDelete ? 'Confirm Delete' : 'Delete App'}
        </Button>
      </div>
      {confirmDelete && (
        <p className="text-xs text-red-500 -mt-4">
          This will permanently delete the app and all its data. Click again to confirm.
        </p>
      )}
    </div>
  )
}

const input = 'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
