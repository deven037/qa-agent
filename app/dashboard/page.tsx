import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { readApps } from '@/lib/config/store'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import AddAppButton from '@/components/dashboard/AddAppButton'
import { ExternalLink, LayoutDashboard, LogOut } from 'lucide-react'

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const apps = await readApps()

  const userName = session.user?.name ?? session.user?.email ?? 'User'
  const initials = userName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Header */}
      <header className="bg-gradient-to-r from-violet-600 via-violet-700 to-indigo-700 shadow-lg px-6 h-14 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-white/15 rounded-lg flex items-center justify-center text-white font-bold text-xs">Q</div>
          <span className="font-semibold text-white text-sm tracking-tight">QA Agent</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-semibold">
              {initials}
            </div>
            <span className="text-sm text-white hidden sm:block">{session.user?.name ?? session.user?.email}</span>
          </div>
          <form action="/api/auth/signout" method="post">
            <Button variant="outline" size="sm" type="submit" className="gap-1.5 text-white border-white/30 bg-white/10 hover:bg-white/20 text-xs h-8">
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Page title */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-xs font-medium text-violet-600 uppercase tracking-widest mb-1">Workspace</p>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Applications</h1>
            <p className="text-sm text-slate-400 mt-1">Select an app to run QA pipelines on Jira issues.</p>
          </div>
          <AddAppButton />
        </div>

        {apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center mb-4">
              <LayoutDashboard className="w-6 h-6 text-violet-400" />
            </div>
            <p className="text-slate-700 font-medium">No applications yet</p>
            <p className="text-sm text-slate-400 mt-1 mb-5">Add your first app to get started with automated QA.</p>
            <AddAppButton />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {apps.map((app) => {
              const initial = app.name.slice(0, 1).toUpperCase()
              const colors = [
                'from-violet-500 to-indigo-500',
                'from-emerald-500 to-teal-500',
                'from-rose-500 to-pink-500',
                'from-amber-500 to-orange-500',
                'from-blue-500 to-cyan-500',
              ]
              const color = colors[app.name.charCodeAt(0) % colors.length]

              return (
                <Link key={app.id} href={`/apps/${app.id}`} className="group block">
                  <div className="bg-white rounded-2xl border border-slate-200/80 hover:border-violet-300 hover:shadow-lg hover:shadow-violet-100/50 transition-all duration-200 overflow-hidden h-full">
                    {/* Card top bar */}
                    <div className={`h-1.5 w-full bg-gradient-to-r ${color}`} />

                    <div className="p-5">
                      <div className="flex items-start justify-between mb-4">
                        {/* App avatar */}
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-base shadow-sm`}>
                          {initial}
                        </div>
                        <Badge variant="outline" className="font-mono text-[11px] text-slate-500 border-slate-200">
                          {app.jiraProjectKey}
                        </Badge>
                      </div>

                      <h2 className="font-semibold text-slate-800 text-sm mb-1 group-hover:text-violet-700 transition-colors">
                        {app.name}
                      </h2>
                      <p className="text-xs text-slate-400 truncate flex items-center gap-1">
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        {app.baseUrl}
                      </p>

                      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                        <Badge className="text-[11px] bg-slate-100 text-slate-500 border-0 font-normal capitalize">
                          {app.authStrategy.replace('-', ' ')}
                        </Badge>
                        <span className="text-[11px] text-violet-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                          Open →
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
