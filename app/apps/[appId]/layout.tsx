import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { readApps } from '@/lib/config/store'
import AppNavbar from '@/components/apps/AppNavbar'
import InactivityGuard from '@/components/apps/InactivityGuard'

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ appId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const { appId } = await params
  const app = (await readApps()).find((a) => a.id === appId)
  if (!app) notFound()

  return (
    <div className="min-h-screen bg-slate-50">
      <InactivityGuard />
      <AppNavbar
        appId={app.id}
        appName={app.name}
        jiraProjectKey={app.jiraProjectKey}
      />
      <main className="max-w-7xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  )
}
