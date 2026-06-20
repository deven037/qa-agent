import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { readApps } from '@/lib/config/store'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import AddAppButton from '@/components/dashboard/AddAppButton'

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const apps = readApps()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">Q</div>
          <span className="font-semibold text-slate-800">QA Agent</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{session.user?.email}</span>
          <form action="/api/auth/signout" method="post">
            <Button variant="outline" size="sm" type="submit">Sign out</Button>
          </form>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Applications</h1>
            <p className="text-slate-500 text-sm mt-1">Select an app to run a QA pipeline on a Jira issue.</p>
          </div>
          <AddAppButton />
        </div>

        {apps.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <p className="text-lg">No applications configured yet.</p>
            <p className="text-sm mt-1">Click &quot;+ Add App&quot; to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {apps.map((app) => (
              <Link key={app.id} href={`/apps/${app.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{app.name}</CardTitle>
                      <Badge variant="outline" className="text-xs">{app.jiraProjectKey}</Badge>
                    </div>
                    <CardDescription className="text-xs truncate">{app.baseUrl}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs capitalize font-normal">
                        {app.authStrategy.replace('-', ' ')}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
