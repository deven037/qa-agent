import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import dbConnect from '@/lib/db/mongoose'
import { User } from '@/lib/db/models/User'
import { authConfig } from './auth.config'

class InvalidCredentials extends CredentialsSignin {
  code = 'invalid_credentials'
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null
        await dbConnect
        const input = String(credentials.username).trim()
        const user = await User.findOne({ name: { $regex: `^${input}$`, $options: 'i' } })
        if (!user) throw new InvalidCredentials()
        const valid = await bcrypt.compare(String(credentials.password), user.passwordHash)
        if (!valid) throw new InvalidCredentials()
        return { id: String(user._id), name: user.name, email: user.email }
      },
    }),
  ],
})
