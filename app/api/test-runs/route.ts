import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { TestRun } from '@/lib/db/models/TestRun'
import dbConnect from '@/lib/db/mongoose'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const appId = req.nextUrl.searchParams.get('appId')
  if (!appId) return NextResponse.json({ error: 'appId required' }, { status: 400 })

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20'), 50)

  await dbConnect
  const runs = await TestRun.find({ appId })
    .sort({ executedAt: -1 })
    .limit(limit)
    .select('-steps -navEvents')
    .lean()

  return NextResponse.json(runs)
}
