import { NextRequest, NextResponse } from 'next/server'
import { readRunnerToken } from '@/lib/config/store'
import { emitJobEvent, jobExists, markDone } from '@/lib/runner/job-store'

export async function POST(req: NextRequest) {
  const token = await readRunnerToken()
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as { jobId: string; signal: unknown }
  const { jobId, signal } = body

  if (!jobExists(jobId)) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const s = signal as { type: string }
  emitJobEvent(jobId, s as Parameters<typeof emitJobEvent>[1])

  if (s.type === '__DONE__' || s.type === '__ERROR__') {
    markDone(jobId)
  }

  return NextResponse.json({ ok: true })
}
