'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, ArrowRight, Zap, FlaskConical, Bug, CheckCircle2 } from 'lucide-react'
import { loginAction } from './actions'

const PILLS = [
  { icon: Zap, label: 'AI automation' },
  { icon: FlaskConical, label: 'Test generation' },
  { icon: Bug, label: 'Jira sync' },
  { icon: CheckCircle2, label: 'Multi-app' },
]

const inputCls = [
  'w-full h-12 px-4 rounded-2xl text-sm text-white placeholder:text-white/40',
  'focus:outline-none focus:ring-2 focus:ring-white/40 transition',
  'border border-white/30 bg-white/25 backdrop-blur-md',
].join(' ')

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await loginAction(username, password)
    // If result is returned, it means an error occurred (success throws a redirect)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 30%, #8b5cf6 55%, #4f46e5 80%, #4338ca 100%)' }}
    >
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center">

        {/* Logo */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 border border-white/20"
          style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(16px)' }}
        >
          <span className="text-white font-black text-3xl">Q</span>
        </div>

        {/* Brand + description */}
        <h1 className="text-white font-bold text-3xl tracking-tight mb-2">QA Agent</h1>
        <p className="text-white/50 text-sm text-center leading-relaxed mb-4 max-w-[280px]">
          Generate test cases with AI, automate Playwright runs, and sync bugs to Jira — all in one place.
        </p>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {PILLS.map(({ icon: Icon, label }) => (
            <div key={label}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 border border-white/15 text-white/50 text-xs"
              style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)' }}>
              <Icon className="w-3 h-3" />
              {label}
            </div>
          ))}
        </div>

        <div className="w-full border-t border-white/10 mb-8" />

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="username" className="text-white/70 text-[11px] font-semibold uppercase tracking-widest">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              placeholder="your-username"
              className={inputCls}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-white/70 text-[11px] font-semibold uppercase tracking-widest">
                Password
              </label>
              <Link href="/reset-password" className="text-white/50 hover:text-white text-xs transition-colors">
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className={inputCls}
            />
          </div>

          {error && (
            <div className="text-rose-300 text-xs px-4 py-3 rounded-xl border border-rose-400/20"
              style={{ background: 'rgba(244,63,94,0.12)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-2xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 mt-2 border border-white/20"
            style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
              : <><span>Sign in</span><ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>

        <p className="mt-6 text-sm text-white/50">
          No account?{' '}
          <Link href="/register" className="text-white font-semibold hover:underline transition-colors">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
