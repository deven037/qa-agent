import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import dbConnect from '@/lib/db/mongoose'
import { User } from '@/lib/db/models/User'
import { verifyJiraUser } from '@/lib/jira/client'

export async function POST(req: NextRequest) {
  const { name, username, email, password } = await req.json()
  if (!name || !username || !email || !password) {
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
  const existingEmail = await User.findOne({ email: email.toLowerCase() })
  if (existingEmail) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
  }
  const existingUsername = await User.findOne({ username: username.toLowerCase().trim() })
  if (existingUsername) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
  }
  const passwordHash = await bcrypt.hash(password, 12)
  await User.create({ name, username: username.toLowerCase().trim(), email: email.toLowerCase(), passwordHash })
  return NextResponse.json({ ok: true })
}
