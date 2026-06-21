import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { readApps } from '@/lib/config/store'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import AddAppButton from '@/components/dashboard/AddAppButton'
import { ExternalLink, LayoutDashboard, LogOut, Search } from 'lucide-react'
import AppSearch from '@/components/dashboard/AppSearch'

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const apps = await readApps()

  const userName = session.user?.name ?? session.user?.email ?? 'User'
  const firstName = userName.split(' ')[0]
  const initials = userName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

  const APP_COLORS = [
    { from: '#7c3aed', to: '#4f46e5' },
    { from: '#059669', to: '#0d9488' },
    { from: '#e11d48', to: '#db2777' },
    { from: '#d97706', to: '#ea580c' },
    { from: '#2563eb', to: '#0891b2' },
    { from: '#7c3aed', to: '#be185d' },
    { from: '#065f46', to: '#1d4ed8' },
  ]

  return (
    <div className="min-h-screen" style={{ background: '#f8f7ff' }}>
      {/* dot grid background */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, #c4b5fd 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          opacity: 0.35,
        }}
      />

      {/* Header */}
      <header className="relative z-10 bg-gradient-to-r from-violet-600 via-violet-700 to-indigo-700 px-6 h-14 flex items-center justify-between sticky top-0 shadow-lg shadow-violet-900/20">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-white/15 rounded-lg flex items-center justify-center text-white font-bold text-xs border border-white/20">Q</div>
          <span className="font-semibold text-white text-sm tracking-tight">QA Agent</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-semibold border border-white/20">
              {initials}
            </div>
            <span className="text-sm text-white/80 hidden sm:block">{session.user?.name ?? session.user?.email}</span>
          </div>
          <form action="/api/auth/signout" method="post">
            <Button variant="outline" size="sm" type="submit" className="gap-1.5 text-white border-white/25 bg-white/10 hover:bg-white/20 text-xs h-8">
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </Button>
          </form>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-10">

        {/* Page header */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <p className="text-xs font-semibold text-violet-500 uppercase tracking-widest mb-1">Workspace</p>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Good to see you, {firstName}
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {apps.length === 0
                ? 'Add your first app to get started.'
                : `${apps.length} app${apps.length !== 1 ? 's' : ''} in your workspace`}
            </p>
          </div>
          <AddAppButton />
        </div>

        {apps.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-28 text-center">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-violet-200">
                <LayoutDashboard className="w-9 h-9 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-400 rounded-full border-2 border-white flex items-center justify-center">
                <span className="text-white text-[9px] font-bold">+</span>
              </div>
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">No applications yet</h2>
            <p className="text-sm text-slate-400 mb-7 max-w-xs">
              Create your first app to start running AI-powered QA pipelines against your Jira projects.
            </p>
            <AddAppButton />
          </div>
        ) : (
          <>
            {/* Search — shown once there are enough apps to need it */}
            {apps.length >= 4 && <AppSearch />}

            {/* App grid — auto-fill so it scales from 2 to 20+ apps */}
            <div
              id="app-grid"
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
            >
              {apps.map((app, idx) => {
                const color = APP_COLORS[idx % APP_COLORS.length]
                const initial = app.name.slice(0, 1).toUpperCase()

                return (
                  <Link key={app.id} href={`/apps/${app.id}`} className="group block" data-app-name={app.name.toLowerCase()} data-app-key={(app.jiraProjectKey ?? '').toLowerCase()}>
                    <div className="relative bg-white rounded-2xl border border-slate-200/70 hover:border-violet-200 hover:shadow-xl hover:shadow-violet-100/60 hover:-translate-y-0.5 transition-all duration-200 overflow-hidden h-full">
                      {/* Top gradient bar */}
                      <div className="h-1 w-full" style={{ background: `linear-gradient(to right, ${color.from}, ${color.to})` }} />

                      <div className="p-5">
                        {/* Avatar + key */}
                        <div className="flex items-start justify-between mb-4">
                          <div
                            className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-md"
                            style={{ background: `linear-gradient(135deg, ${color.from}, ${color.to})` }}
                          >
                            {initial}
                          </div>
                          <span className="font-mono text-[11px] text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md mt-0.5">
                            {app.jiraProjectKey || '—'}
                          </span>
                        </div>

                        {/* Name + URL */}
                        <h2 className="font-semibold text-slate-800 text-sm mb-1 group-hover:text-violet-700 transition-colors leading-snug">
                          {app.name}
                        </h2>
                        {app.baseUrl ? (
                          <p className="text-xs text-slate-400 truncate flex items-center gap-1">
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            {app.baseUrl.replace(/^https?:\/\//, '')}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-300">No URL configured</p>
                        )}

                        {/* Footer */}
                        <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-[11px] text-slate-400 capitalize bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                            {app.authStrategy?.replace('-', ' ') ?? 'no auth'}
                          </span>
                          <span className="text-[11px] font-medium text-violet-500 opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0 flex items-center gap-0.5">
                            Open <span className="text-base leading-none">→</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}

              {/* "Add another" ghost card — always visible so adding feels natural */}
              <div className="group block">
                <AddAppButton ghost />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
