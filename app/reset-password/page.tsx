'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react'

const inputCls = 'w-full h-11 px-4 rounded-2xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/40 transition border border-white/30 bg-white/20 backdrop-blur-md'
const labelCls = 'text-white/70 text-[11px] font-semibold uppercase tracking-widest'

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const passwordsMatch = confirm.length > 0 && newPassword === confirm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, newPassword }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) setError(data.error ?? 'Something went wrong')
    else setSuccess(true)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 30%, #8b5cf6 55%, #4f46e5 80%, #4338ca 100%)' }}
    >
      <div className="w-full max-w-sm">
        <Link href="/login"
          className="inline-flex items-center gap-1.5 text-white/50 hover:text-white text-sm mb-8 transition-colors group">
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          Back to sign in
        </Link>

        {success ? (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl border border-white/25 mb-5"
              style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)' }}>
              <CheckCircle2 className="w-8 h-8 text-emerald-300" />
            </div>
            <h2 className="text-white font-bold text-2xl mb-2">Password updated</h2>
            <p className="text-white/50 text-sm mb-8">Your password has been reset. You can now sign in.</p>
            <Link href="/login"
              className="w-full h-11 rounded-2xl text-white text-sm font-semibold flex items-center justify-center border border-white/25 transition-all active:scale-[0.98]"
              style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}>
              Go to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl border border-white/25 mb-4"
                style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)' }}>
                <span className="text-white font-black text-2xl">Q</span>
              </div>
              <h1 className="text-white font-bold text-2xl tracking-tight">Reset password</h1>
              <p className="text-white/50 text-sm mt-1">Enter your email and choose a new password.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className={labelCls}>Email address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="your@email.com" autoComplete="email" className={inputCls} />
              </div>

              <div className="space-y-1.5">
                <label className={labelCls}>New password</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} placeholder="Min. 8 characters" className={inputCls} />
              </div>

              <div className="space-y-1.5">
                <label className={labelCls}>Confirm password</label>
                <div className="relative">
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    placeholder="Re-enter password"
                    className={`${inputCls} ${confirm.length > 0 ? (passwordsMatch ? 'border-emerald-400/50' : 'border-rose-400/50') : ''}`}
                  />
                  {confirm.length > 0 && (
                    <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium ${passwordsMatch ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {passwordsMatch ? 'Matches' : 'No match'}
                    </span>
                  )}
                </div>
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
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating…</> : 'Update password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
