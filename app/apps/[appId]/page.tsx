import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { readApps } from '@/lib/config/store'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import IssueRunner from '@/components/pipeline/IssueRunner'

export default async function AppPage({ params }: { params: Promise<{ appId: string }> }) {
  const session = await auth()
  if (!session) redirect('/login')
  const { appId } = await params
  const app = readApps().find((a) => a.id === appId)
  if (!app) notFound()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-3">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600 text-sm">Dashboard</Link>
        <span className="text-slate-300">/</span>
        <span className="font-semibold text-slate-800">{app.name}</span>
        <Badge variant="outline">{app.jiraProjectKey}</Badge>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-8">
        <IssueRunner app={app} />
      </main>
    </div>
  )
}
