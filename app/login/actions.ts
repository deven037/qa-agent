'use server'

import { signIn } from '@/auth'
import { AuthError } from 'next-auth'

export async function loginAction(username: string, password: string) {
  try {
    await signIn('credentials', { username, password, redirectTo: '/' })
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: 'Invalid username or password' }
    }
    // Next.js throws a NEXT_REDIRECT on success — re-throw it
    throw e
  }
}
