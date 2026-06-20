import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import dbConnect from '@/lib/db/mongoose'
import { User } from '@/lib/db/models/User'

export async function POST(req: NextRequest) {
  const { email, newPassword } = await req.json()

  if (!email || !newPassword) {
    return NextResponse.json({ error: 'Email and new password are required' }, { status: 400 })
  }

  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  await dbConnect

  const user = await User.findOne({ email: email.toLowerCase() })
  if (!user) {
    // Return same message to avoid email enumeration
    return NextResponse.json({ ok: true })
  }

  const passwordHash = await bcrypt.hash(newPassword, 12)
  await User.updateOne({ _id: user._id }, { $set: { passwordHash } })

  return NextResponse.json({ ok: true })
}
