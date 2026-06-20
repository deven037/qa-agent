'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { signOut } from 'next-auth/react'

const INACTIVE_MS = 10 * 60 * 1000  // 10 minutes
const COUNTDOWN_S = 60               // 1 minute warning

export default function InactivityGuard() {
  const [showWarning, setShowWarning] = useState(false)
  const [countdown, setCountdown] = useState(COUNTDOWN_S)

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearCountdown = () => {
    if (countdownInterval.current) {
      clearInterval(countdownInterval.current)
      countdownInterval.current = null
    }
  }

  const startCountdown = useCallback(() => {
    setShowWarning(true)
    setCountdown(COUNTDOWN_S)
    clearCountdown()
    countdownInterval.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearCountdown()
          signOut({ callbackUrl: '/login' })
          return 0
        }
        return c - 1
      })
    }, 1000)
  }, [])

  const resetTimer = useCallback(() => {
    if (showWarning) return  // don't reset while warning is showing
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(startCountdown, INACTIVE_MS)
  }, [showWarning, startCountdown])

  const staySignedIn = () => {
    setShowWarning(false)
    clearCountdown()
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(startCountdown, INACTIVE_MS)
  }

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }))
    inactivityTimer.current = setTimeout(startCountdown, INACTIVE_MS)

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer))
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      clearCountdown()
    }
  }, [resetTimer, startCountdown])

  if (!showWarning) return null

  const pct = (countdown / COUNTDOWN_S) * 100
  const radius = 28
  const circ = 2 * Math.PI * radius
  const strokeDash = (pct / 100) * circ

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8 flex flex-col items-center gap-5 animate-in fade-in zoom-in-95 duration-200">
        {/* Circular countdown */}
        <div className="relative flex items-center justify-center">
          <svg width="80" height="80" className="-rotate-90">
            <circle cx="40" cy="40" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="5" />
            <circle
              cx="40" cy="40" r={radius}
              fill="none"
              stroke={countdown <= 10 ? '#ef4444' : '#7c3aed'}
              strokeWidth="5"
              strokeDasharray={`${strokeDash} ${circ}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 1s linear, stroke 0.3s' }}
            />
          </svg>
          <span className={`absolute text-2xl font-semibold tabular-nums ${countdown <= 10 ? 'text-red-500' : 'text-slate-800'}`}>
            {countdown}
          </span>
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold text-slate-800">Still there?</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            You've been inactive for 10 minutes.<br />
            You'll be signed out in <span className={`font-medium ${countdown <= 10 ? 'text-red-500' : 'text-violet-600'}`}>{countdown} second{countdown !== 1 ? 's' : ''}</span>.
          </p>
        </div>

        <div className="flex gap-3 w-full">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Sign out now
          </button>
          <button
            onClick={staySignedIn}
            className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  )
}
