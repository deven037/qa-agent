'use client'

import { useEffect } from 'react'
import { signOut } from 'next-auth/react'

const COOKIE = 'qa_boot_id'

function getCookie(name: string): string | null {
  return document.cookie.split('; ').find((r) => r.startsWith(name + '='))?.split('=')[1] ?? null
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; SameSite=Lax`
}

export default function BootGuard() {
  useEffect(() => {
    const authPaths = ['/login', '/register', '/reset-password']
    if (authPaths.some((p) => window.location.pathname.startsWith(p))) return

    fetch('/api/boot-id', { cache: 'no-store' })
      .then((r) => r.text())
      .then((serverBootId) => {
        const clientBootId = getCookie(COOKIE)
        if (!clientBootId || clientBootId !== serverBootId) {
          setCookie(COOKIE, serverBootId)
          signOut({ callbackUrl: '/login' })
        }
      })
      .catch(() => {/* ignore network errors */})
  }, [])

  return null
}
