'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type AuthStrategy = 'no-auth' | 'email-password' | 'api-key'

export default function AddAppButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [jiraProjectKey, setJiraProjectKey] = useState('')
  const [authStrategy, setAuthStrategy] = useState<AuthStrategy>('no-auth')
  const [appEmail, setAppEmail] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)

  function reset() {
    setName(''); setBaseUrl(''); setJiraProjectKey('')
    setAuthStrategy('no-auth'); setAppEmail(''); setAppPassword(''); setApiKey('')
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

      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, baseUrl, jiraProjectKey, authStrategy, credentials }),
      })
      if (!res.ok) throw new Error('Failed')
      const newApp = await res.json()
      toast.success('Application added — starting knowledge crawl in background')
      setOpen(false)
      reset()
      router.refresh()
      // Fire-and-forget knowledge crawl
      fetch(`/api/apps/${newApp.id}/explore`, { method: 'POST' }).catch(() => {})
    } catch {
      toast.error('Failed to add application. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="bg-violet-600 hover:bg-violet-700">
        + Add App
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Add New Application</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>App Name</Label>
            <Input placeholder="My Web App" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Base URL</Label>
            <Input placeholder="https://staging.myapp.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Jira Project Key</Label>
            <Input placeholder="PROJ" value={jiraProjectKey} onChange={(e) => setJiraProjectKey(e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-2">
            <Label>Authentication</Label>
            <select
              className="w-full border rounded-md px-3 py-2 text-sm"
              value={authStrategy}
              onChange={(e) => setAuthStrategy(e.target.value as AuthStrategy)}
            >
              <option value="no-auth">No Authentication</option>
              <option value="email-password">Email + Password</option>
              <option value="api-key">API Key</option>
            </select>
          </div>

          {authStrategy === 'email-password' && (
            <>
              <div className="space-y-2">
                <Label>Email / Username</Label>
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={appEmail}
                  onChange={(e) => setAppEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                />
              </div>
            </>
          )}

          {authStrategy === 'api-key' && (
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); reset() }} className="flex-1">Cancel</Button>
            <Button
              onClick={handleAdd}
              disabled={loading || !name || !baseUrl || !jiraProjectKey}
              className="flex-1 bg-violet-600 hover:bg-violet-700"
            >
              {loading ? 'Adding...' : 'Add App'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
