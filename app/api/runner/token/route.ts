import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { readRunnerToken, regenerateRunnerToken } from '@/lib/config/store'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const token = await readRunnerToken()
  return NextResponse.json({ token })
}

export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const token = await regenerateRunnerToken()
  return NextResponse.json({ token })
}
