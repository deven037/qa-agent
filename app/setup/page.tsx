'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type Step = 1 | 2

interface AppForm {
  name: string
  baseUrl: string
  jiraProjectKey: string
  authStrategy: 'no-auth' | 'email-password' | 'api-key'
  appEmail: string
  appPassword: string
  apiKey: string
}

const STEPS = ['Select Project', 'Add Application']

export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [jiraProjects, setJiraProjects] = useState<{ key: string; name: string }[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState('')
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectKey, setNewProjectKey] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [app, setApp] = useState<AppForm>({
    name: '', baseUrl: '', jiraProjectKey: '', authStrategy: 'no-auth', appEmail: '', appPassword: '', apiKey: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/jira/projects')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setJiraProjects(data)
        else setProjectsError('Failed to load Jira projects')
      })
      .catch(() => setProjectsError('Could not connect to Jira'))
      .finally(() => setProjectsLoading(false))
  }, [])

  async function handleCreateProject() {
    if (!newProjectName || !newProjectKey) return
    setCreatingProject(true)
    try {
      const res = await fetch('/api/jira/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName, key: newProjectKey }),
      })
      const created = await res.json()
      if (!res.ok) throw new Error(created.error ?? 'Failed to create project')
      setJiraProjects((prev) => [...prev, created])
      setApp((a) => ({ ...a, jiraProjectKey: created.key }))
      setShowCreateProject(false)
      setNewProjectName('')
      setNewProjectKey('')
    } catch (e) {
      setProjectsError(String(e))
    }
    setCreatingProject(false)
  }

  async function finishSetup() {
    setLoading(true)
    setError('')
    try {
      const credentialEnvVars: Record<string, string> = {}
      if (app.authStrategy === 'email-password') {
        credentialEnvVars.email = 'APP_EMAIL'
        credentialEnvVars.password = 'APP_PASSWORD'
      } else if (app.authStrategy === 'api-key') {
        credentialEnvVars.apiKey = 'APP_API_KEY'
      }

      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: { ...app, credentialEnvVars } }),
      })
      if (!res.ok) throw new Error('Setup failed')
      router.push('/dashboard')
    } catch {
      setError('Setup failed. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            {STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <Badge
                  variant={step === i + 1 ? 'default' : step > i + 1 ? 'secondary' : 'outline'}
                  className={step === i + 1 ? 'bg-violet-600' : ''}
                >
                  {i + 1}
                </Badge>
                <span className={`text-sm ${step === i + 1 ? 'font-semibold text-violet-700' : 'text-slate-400'}`}>
                  {label}
                </span>
                {i < 1 && <span className="text-slate-300 mx-1">→</span>}
              </div>
            ))}
          </div>
          <CardTitle>{STEPS[step - 1]}</CardTitle>
          <CardDescription>
            {step === 1 && 'Choose a Jira project to link with this application, or create a new one.'}
            {step === 2 && 'Configure the application you want to test.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {step === 1 && (
            <>
              {projectsLoading ? (
                <p className="text-sm text-slate-400">Loading Jira projects...</p>
              ) : projectsError ? (
                <p className="text-sm text-red-500">{projectsError}</p>
              ) : (
                <div className="space-y-2">
                  <Label>Select Jira Project</Label>
                  <select
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    value={app.jiraProjectKey}
                    onChange={(e) => setApp({ ...app, jiraProjectKey: e.target.value })}
                  >
                    <option value="">Choose a project...</option>
                    {jiraProjects.map((p) => (
                      <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Create new project */}
              {!showCreateProject ? (
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="text-sm text-violet-600 hover:underline"
                >
                  + Create a new Jira project
                </button>
              ) : (
                <div className="space-y-3 p-3 border rounded-md bg-slate-50">
                  <p className="text-sm font-medium text-slate-700">New Jira Project</p>
                  <div className="space-y-2">
                    <Label>Project Name</Label>
                    <Input
                      placeholder="My QA Project"
                      value={newProjectName}
                      onChange={(e) => {
                        setNewProjectName(e.target.value)
                        setNewProjectKey(e.target.value.replace(/\s+/g, '').toUpperCase().slice(0, 10))
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Project Key</Label>
                    <Input
                      placeholder="MQP"
                      value={newProjectKey}
                      onChange={(e) => setNewProjectKey(e.target.value.toUpperCase().slice(0, 10))}
                    />
                    <p className="text-xs text-slate-400">Short identifier used in issue keys, e.g. MQP-1</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowCreateProject(false)}>Cancel</Button>
                    <Button
                      size="sm"
                      className="bg-violet-600 hover:bg-violet-700"
                      onClick={handleCreateProject}
                      disabled={creatingProject || !newProjectName || !newProjectKey}
                    >
                      {creatingProject ? 'Creating...' : 'Create Project'}
                    </Button>
                  </div>
                </div>
              )}

              <Button
                onClick={() => setStep(2)}
                className="w-full bg-violet-600 hover:bg-violet-700"
                disabled={!app.jiraProjectKey}
              >
                Continue
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-2">
                <Label>Application Name</Label>
                <Input placeholder="My Web App" value={app.name} onChange={(e) => setApp({ ...app, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Base URL</Label>
                <Input placeholder="https://staging.myapp.com" value={app.baseUrl} onChange={(e) => setApp({ ...app, baseUrl: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Authentication</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={app.authStrategy}
                  onChange={(e) => setApp({ ...app, authStrategy: e.target.value as AppForm['authStrategy'] })}
                >
                  <option value="no-auth">No Authentication</option>
                  <option value="email-password">Email + Password</option>
                  <option value="api-key">API Key</option>
                </select>
              </div>
              {app.authStrategy === 'email-password' && (
                <div className="space-y-2 p-3 bg-slate-50 rounded-md">
                  <p className="text-xs text-slate-500">Stored as environment variables in .env.local</p>
                  <div className="space-y-2">
                    <Label>App Email (APP_EMAIL)</Label>
                    <Input type="email" value={app.appEmail} onChange={(e) => setApp({ ...app, appEmail: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>App Password (APP_PASSWORD)</Label>
                    <Input type="password" value={app.appPassword} onChange={(e) => setApp({ ...app, appPassword: e.target.value })} />
                  </div>
                </div>
              )}
              {app.authStrategy === 'api-key' && (
                <div className="space-y-2 p-3 bg-slate-50 rounded-md">
                  <Label>API Key (APP_API_KEY)</Label>
                  <Input type="password" value={app.apiKey} onChange={(e) => setApp({ ...app, apiKey: e.target.value })} />
                </div>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
                <Button onClick={finishSetup} className="flex-1 bg-violet-600 hover:bg-violet-700" disabled={loading || !app.name || !app.baseUrl}>
                  {loading ? 'Finishing setup...' : 'Finish Setup'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
