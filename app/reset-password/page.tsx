'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, KeyRound, CheckCircle2, ArrowLeft } from 'lucide-react'

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
    if (newPassword !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, newPassword }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
    } else {
      setSuccess(true)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Grid pattern */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(rgba(139,92,246,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.07) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }}
      />
      {/* Glow orbs */}
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[300px] rounded-full bg-violet-600/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-1/4 left-1/4 w-64 h-64 rounded-full bg-indigo-600/10 blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Back link */}
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-sm mb-8 transition-colors group"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          Back to sign in
        </Link>

        {success ? (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 text-center shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Password updated</h2>
            <p className="text-slate-400 text-sm mb-7">Your password has been reset successfully. You can now sign in.</p>
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center h-11 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold hover:from-violet-700 hover:to-indigo-700 transition-all shadow-lg shadow-violet-900/40"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <>
            {/* Icon + heading */}
            <div className="mb-7">
              <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-5">
                <KeyRound className="w-5 h-5 text-violet-400" />
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">Reset password</h1>
              <p className="text-slate-400 text-sm mt-2">Enter your email and choose a new password below.</p>
            </div>

            {/* Form card */}
            <div className="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-3xl p-8 shadow-2xl">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-sm font-medium text-slate-300">Email address</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="your@email.com"
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-700 bg-slate-800/60 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="newPassword" className="text-sm font-medium text-slate-300">New password</label>
                  <input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="Min. 8 characters"
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-700 bg-slate-800/60 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="confirm" className="text-sm font-medium text-slate-300">Confirm password</label>
                  <div className="relative">
                    <input
                      id="confirm"
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      placeholder="Re-enter new password"
                      className={`w-full h-11 px-3.5 rounded-xl border bg-slate-800/60 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:border-transparent transition ${
                        confirm.length > 0
                          ? passwordsMatch
                            ? 'border-emerald-500/50 focus:ring-emerald-500'
                            : 'border-rose-500/50 focus:ring-rose-500'
                          : 'border-slate-700 focus:ring-violet-500'
                      }`}
                    />
                    {confirm.length > 0 && (
                      <div className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${passwordsMatch ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {passwordsMatch ? 'Matches' : 'No match'}
                      </div>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm px-4 py-3 rounded-xl">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold hover:from-violet-700 hover:to-indigo-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-violet-900/40 mt-1"
                >
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating…</> : 'Update password'}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
