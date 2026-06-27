import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { readApps } from '@/lib/config/store'
import { searchJiraIssues, fetchJiraIssue } from '@/lib/jira/client'
import WorkItemTypeChart from '@/components/apps/WorkItemTypeChart'
import ModuleChart from '@/components/apps/ModuleChart'
import AutomationTable from '@/components/apps/AutomationTable'
import { BookOpen, Bug, FlaskConical, Zap, ArrowUpRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'

const ISSUE_TYPES = ['Story', 'Bug', 'Task', 'Test Case', 'Epic']

function parseLastExecution(body: string): string | undefined {
  const match = body.match(/(\d{4}-\d{2}-\d{2})|(\w+ \d+, \d{4})/)
  return match?.[0]
}

function parseStatus(comments: { body: string }[]): 'passed' | 'failed' | 'partial' | 'not-run' {
  const resultComment = [...comments].reverse().find((c) => c.body.startsWith('[QA-RESULTS]'))
  if (!resultComment) return 'not-run'
  const passed = Number(resultComment.body.match(/Passed: (\d+)/)?.[1] ?? 0)
  const failed = Number(resultComment.body.match(/Failed: (\d+)/)?.[1] ?? 0)
  if (failed === 0 && passed > 0) return 'passed'
  if (passed === 0 && failed > 0) return 'failed'
  if (passed > 0 && failed > 0) return 'partial'
  return 'not-run'
}

export default async function DashboardPage({ params }: { params: Promise<{ appId: string }> }) {
  const session = await auth()
  if (!session) redirect('/login')

  const { appId } = await params
  const app = (await readApps()).find((a) => a.id === appId)!
  const typeCounts = await Promise.all(
    ISSUE_TYPES.map((t) => searchJiraIssues(app.jiraProjectKey, '', t).catch(() => []))
  )
  const byType: Record<string, number> = {}
  ISSUE_TYPES.forEach((t, i) => { byType[t] = typeCounts[i].length })

  const allIssues = typeCounts.flat()
  const moduleCounts: Record<string, number> = {}
  for (const issue of allIssues) {
    const mod = issue.summary.split(/[-:–]/)[0].trim().slice(0, 30) || 'Other'
    moduleCounts[mod] = (moduleCounts[mod] ?? 0) + 1
  }
  const byModule = Object.entries(moduleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }))

  const automationCandidates = [...typeCounts[2], ...typeCounts[3]].slice(0, 20)
  const fullIssues = await Promise.all(
    automationCandidates.map((i) => fetchJiraIssue(i.key).catch(() => null))
  )
  const automationIssues = fullIssues
    .filter((i) => i !== null)
    .filter((i) => i!.comments.some((c) => c.body.startsWith('[QA-TESTCASES]') || c.body.startsWith('[QA-RESULTS]')))
    .map((i) => {
      const resultComment = [...i!.comments].reverse().find((c) => c.body.startsWith('[QA-RESULTS]'))
      return {
        key: i!.key,
        summary: i!.summary,
        status: parseStatus(i!.comments),
        lastExecuted: resultComment ? parseLastExecution(resultComment.body) : undefined,
      }
    })

  const total = Object.values(byType).reduce((a, b) => a + b, 0)
  const passedTests = automationIssues.filter(i => i.status === 'passed').length
  const failedTests = automationIssues.filter(i => i.status === 'failed').length

  return (
    <div className="space-y-6">

      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-violet-700 to-indigo-800 px-8 py-7 text-white shadow-lg shadow-violet-200">
        {/* decorative circles */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 top-8 h-28 w-28 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-20 w-40 rounded-full bg-white/5" />

        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">App dashboard</p>
            <h1 className="text-2xl font-bold tracking-tight">{app.name}</h1>
            <div className="flex items-center gap-3 mt-2">
              <span className="bg-white/15 border border-white/20 text-white/90 text-xs font-mono px-2.5 py-0.5 rounded-md">
                {app.jiraProjectKey}
              </span>
              {app.baseUrl && (
                <a
                  href={app.baseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-white/60 hover:text-white text-xs transition-colors"
                >
                  {app.baseUrl} <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          {/* status pills */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className={`text-xs font-medium px-3 py-1 rounded-full ${
              failedTests > 0 ? 'bg-rose-500/30 text-rose-100' :
              passedTests > 0 ? 'bg-emerald-500/30 text-emerald-100' :
              'bg-white/10 text-white/50'
            }`}>
              {failedTests > 0 ? `${failedTests} test${failedTests > 1 ? 's' : ''} failing` :
               passedTests > 0 ? `${passedTests} passing` : 'No automation run'}
            </span>
            <span className="text-xs font-medium px-3 py-1 rounded-full bg-violet-500/30 text-violet-100">
              Live recon · active
            </span>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {([
          { label: 'Total items', value: total, icon: BookOpen, href: 'work-items', from: 'from-violet-500', to: 'to-violet-600', glow: 'shadow-violet-200' },
          { label: 'Test cases', value: byType['Test Case'] ?? 0, icon: FlaskConical, href: 'work-items', from: 'from-indigo-500', to: 'to-indigo-600', glow: 'shadow-indigo-200' },
          { label: 'Bugs', value: byType['Bug'] ?? 0, icon: Bug, href: 'work-items', from: 'from-rose-500', to: 'to-rose-600', glow: 'shadow-rose-200' },
          { label: 'Automation', value: automationIssues.length, icon: Zap, href: 'automation', from: 'from-emerald-500', to: 'to-emerald-600', glow: 'shadow-emerald-200' },
        ] as const).map(({ label, value, icon: Icon, href, from, to, glow }) => (
          <Link
            key={label}
            href={href}
            className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${from} ${to} p-5 text-white shadow-md ${glow} hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200`}
          >
            <div className="pointer-events-none absolute -bottom-3 -right-3 h-20 w-20 rounded-full bg-black/10" />
            <div className="flex items-start justify-between">
              <div className="bg-white/20 rounded-xl p-2">
                <Icon className="w-4 h-4" />
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition-colors" />
            </div>
            <p className="text-3xl font-bold mt-3 tracking-tight">{value}</p>
            <p className="text-white/70 text-xs mt-0.5 capitalize">{label}</p>
          </Link>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-slate-800">Work items by type</h2>
            <span className="text-xs font-mono bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md">{app.jiraProjectKey}</span>
          </div>
          <p className="text-xs text-slate-400 mb-5">Distribution across all issue types</p>
          <WorkItemTypeChart data={byType} />
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-slate-800">Test cases by module</h2>
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md">{byModule.length} groups</span>
          </div>
          <p className="text-xs text-slate-400 mb-5">Grouped by issue title prefix</p>
          <ModuleChart data={byModule} />
        </div>
      </div>

      {/* Automation tests */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Automation tests</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {automationIssues.length} test{automationIssues.length !== 1 ? 's' : ''} tracked
              {passedTests > 0 && <> · <span className="text-emerald-600 font-medium">{passedTests} passing</span></>}
              {failedTests > 0 && <> · <span className="text-rose-600 font-medium">{failedTests} failing</span></>}
            </p>
          </div>
          <Link
            href={`/apps/${appId}/automation`}
            className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium transition-colors"
          >
            View all <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        <AutomationTable issues={automationIssues} appId={appId} />
      </div>
    </div>
  )
}
