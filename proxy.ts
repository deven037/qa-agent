import NextAuth from 'next-auth'
import { authConfig } from './auth.config'
import type { NextRequest } from 'next/server'

const { auth } = NextAuth(authConfig)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function proxy(request: NextRequest): any {
  // auth() used as Next.js proxy handler
  return (auth as unknown as (req: NextRequest) => unknown)(request)
}

export const config = {
  matcher: ['/((?!api/auth|api/register|_next/static|_next/image|favicon.ico|login|register).*)'],
}
