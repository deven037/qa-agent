import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { readApps } from '@/lib/config/store'
import { searchJiraIssues, fetchJiraIssue } from '@/lib/jira/client'
import WorkItemTypeChart from '@/components/apps/WorkItemTypeChart'
import ModuleChart from '@/components/apps/ModuleChart'
import AutomationTable from '@/components/apps/AutomationTable'
import KnowledgeCard from '@/components/apps/KnowledgeCard'
import { getKnowledgeStatus } from '@/lib/db/knowledge-store'

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
  const app = readApps().find((a) => a.id === appId)!
  const knowledgeStatus = await getKnowledgeStatus(appId).catch(() => null)

  // Fetch counts per type for the work item chart
  const typeCounts = await Promise.all(
    ISSUE_TYPES.map((t) => searchJiraIssues(app.jiraProjectKey, '', t).catch(() => []))
  )
  const byType: Record<string, number> = {}
  ISSUE_TYPES.forEach((t, i) => { byType[t] = typeCounts[i].length })

  // Module grouping from all issues
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

  // Automation tests: all issues that have a .spec.ts attachment (use Task/Test Case type issues)
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

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Items', value: total, color: 'from-violet-500 to-violet-600' },
          { label: 'Test Cases', value: byType['Test Case'] ?? 0, color: 'from-indigo-500 to-indigo-600' },
          { label: 'Bugs', value: byType['Bug'] ?? 0, color: 'from-rose-500 to-rose-600' },
          { label: 'Automation Tests', value: automationIssues.length, color: 'from-emerald-500 to-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`bg-gradient-to-br ${color} rounded-xl p-4 text-white shadow-sm`}>
            <p className="text-white/70 text-xs font-medium uppercase tracking-wide">{label}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-1">Work Items by Type</h2>
          <p className="text-xs text-slate-400 mb-4">Distribution across {app.jiraProjectKey}</p>
          <WorkItemTypeChart data={byType} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-1">Test Cases by Module</h2>
          <p className="text-xs text-slate-400 mb-4">Grouped by issue title prefix</p>
          <ModuleChart data={byModule} />
        </div>
      </div>

      {/* Knowledge Base card */}
      <KnowledgeCard appId={appId} knowledgeStatus={knowledgeStatus} storePassword={app.storePassword} />

      {/* Automation tests table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Automation Tests</h2>
            <p className="text-xs text-slate-400 mt-0.5">{automationIssues.length} test{automationIssues.length !== 1 ? 's' : ''} tracked</p>
          </div>
        </div>
        <AutomationTable issues={automationIssues} appId={appId} />
      </div>
    </div>
  )
}
