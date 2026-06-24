import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { TestRun } from '@/lib/db/models/TestRun'
import dbConnect from '@/lib/db/mongoose'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { runId } = await params
  await dbConnect
  const run = await TestRun.findOne({ runId }).lean()
  if (!run) return NextResponse.json({ error: 'Report not found or expired' }, { status: 404 })

  return NextResponse.json(run)
}
