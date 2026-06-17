import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import dbConnect from '@/lib/db/mongoose'
import { User } from '@/lib/db/models/User'
import { verifyJiraUser } from '@/lib/jira/client'

export async function POST(req: NextRequest) {
  const { name, email, password } = await req.json()
  if (!name || !email || !password) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  const isJiraMember = await verifyJiraUser(email)
  if (!isJiraMember) {
    return NextResponse.json(
      { error: 'This email is not part of the Jira organization. Contact your admin.' },
      { status: 403 }
    )
  }

  await dbConnect
  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
  }
  const passwordHash = await bcrypt.hash(password, 12)
  await User.create({ name, email: email.toLowerCase(), passwordHash })
  return NextResponse.json({ ok: true })
}
