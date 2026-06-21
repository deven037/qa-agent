'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

const inputCls = 'w-full h-11 px-4 rounded-2xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/40 transition border border-white/30 bg-white/20 backdrop-blur-md'
const labelCls = 'text-white/70 text-[11px] font-semibold uppercase tracking-widest'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, username, email, password }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) {
      setError(data.error ?? 'Registration failed')
    } else {
      router.push('/login')
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 30%, #8b5cf6 55%, #4f46e5 80%, #4338ca 100%)' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/login">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl border border-white/25 mb-4"
              style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)' }}>
              <span className="text-white font-black text-2xl">Q</span>
            </div>
          </Link>
          <h1 className="text-white font-bold text-2xl tracking-tight">Create account</h1>
          <p className="text-white/50 text-sm mt-1">Join your team on QA Agent</p>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1.5 mb-8">
          {['Name', 'Username', 'Email', 'Password'].map((_, i) => {
            const filled = [name, username, email, password].filter(Boolean).length
            return (
              <div key={i} className={`flex-1 h-1 rounded-full transition-all duration-300 ${i < filled ? 'bg-white' : 'bg-white/20'}`} />
            )
          })}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Full name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Jane Smith" className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g, '_'))} required placeholder="jane_smith" autoComplete="username" className={inputCls} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Work email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="jane@company.com" className={inputCls} />
          </div>

          <div className="space-y-1.5">
            <label className={labelCls}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="Min. 8 characters" className={inputCls} />
            {password.length > 0 && (
              <div className="flex gap-1.5 pt-1">
                {[password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password)].map((ok, i) => (
                  <div key={i} className={`flex-1 h-1 rounded-full transition-all ${ok ? 'bg-emerald-400' : 'bg-white/20'}`} />
                ))}
              </div>
            )}
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
            className="w-full h-11 rounded-2xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 border border-white/25 mt-1"
            style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/50">
          Already have an account?{' '}
          <Link href="/login" className="text-white font-semibold hover:underline transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
