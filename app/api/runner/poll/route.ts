import { NextRequest, NextResponse } from 'next/server'
import { readRunnerToken } from '@/lib/config/store'
import { getNextPendingJob, markRunning } from '@/lib/runner/job-store'

export async function GET(req: NextRequest) {
  const token = await readRunnerToken()
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const job = getNextPendingJob()
  if (job) markRunning(job.id)
  return NextResponse.json({ job: job ?? null })
}
