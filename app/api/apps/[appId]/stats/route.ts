import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { readApps } from '@/lib/config/store'
import { searchJiraIssues } from '@/lib/jira/client'

const TYPES = ['Story', 'Bug', 'Task', 'Test Case', 'Epic']

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { appId } = await params
  const app = (await readApps()).find((a) => a.id === appId)
  if (!app) return NextResponse.json({ error: 'App not found' }, { status: 404 })

  try {
    const results = await Promise.all(
      TYPES.map((type) => searchJiraIssues(app.jiraProjectKey, '', type).catch(() => []))
    )

    const byType: Record<string, number> = {}
    TYPES.forEach((type, i) => { byType[type] = results[i].length })

    // All issues flat for module grouping
    const allIssues = results.flat()
    const moduleCounts: Record<string, number> = {}
    for (const issue of allIssues) {
      const module = issue.summary.split(/[-:–]/)[0].trim().slice(0, 30) || 'Other'
      moduleCounts[module] = (moduleCounts[module] ?? 0) + 1
    }

    const byModule = Object.entries(moduleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }))

    return NextResponse.json({ byType, byModule })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
