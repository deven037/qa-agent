'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Zap, FlaskConical, Bug, CheckCircle2 } from 'lucide-react'

const FEATURES = [
  { icon: Zap, label: 'AI-powered automation', desc: 'Generate and run Playwright tests from natural language' },
  { icon: FlaskConical, label: 'Smart test cases', desc: 'Auto-create structured test cases from Jira work items' },
  { icon: Bug, label: 'Bug tracking', desc: 'Sync issues and results directly back to Jira' },
  { icon: CheckCircle2, label: 'Multi-app support', desc: 'Manage QA across all your projects in one place' },
]

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await signIn('credentials', { username, password, redirect: false })
    setLoading(false)
    if (result?.error) {
      setError('Invalid username or password')
    } else {
      router.push('/')
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden sm:flex sm:w-1/2 relative overflow-hidden bg-gradient-to-br from-violet-600 via-violet-700 to-indigo-900 flex-col justify-between p-12">
        {/* Background decoration */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-80px] right-[-80px] w-80 h-80 rounded-full bg-white/5" />
          <div className="absolute top-[30%] left-[-60px] w-56 h-56 rounded-full bg-white/5" />
          <div className="absolute bottom-[-60px] right-[20%] w-72 h-72 rounded-full bg-white/5" />
          <div className="absolute bottom-[20%] left-[10%] w-32 h-32 rounded-full bg-indigo-500/20" />
        </div>

        {/* Logo */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-bold text-lg border border-white/30">
              Q
            </div>
            <span className="text-white font-bold text-xl tracking-tight">QA Agent</span>
          </div>
        </div>

        {/* Headline */}
        <div className="relative space-y-6">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight tracking-tight">
              Intelligent QA,<br />
              <span className="text-violet-200">automated.</span>
            </h1>
            <p className="text-white/60 text-base mt-4 leading-relaxed max-w-sm">
              AI-driven testing that writes, runs, and reports — so your team ships with confidence.
            </p>
          </div>

          <div className="space-y-4">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-violet-200" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{label}</p>
                  <p className="text-white/50 text-xs mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer quote */}
        <div className="relative border-t border-white/10 pt-6">
          <p className="text-white/40 text-xs">
            Built for engineering teams who ship fast and test smarter.
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="sm:hidden flex items-center gap-2 mb-10">
            <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center text-white font-bold">Q</div>
            <span className="text-slate-800 font-bold text-lg">QA Agent</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Welcome back</h2>
            <p className="text-slate-500 text-sm mt-1">Sign in to your workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-sm font-medium text-slate-700">Username</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                placeholder="your-username"
                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
                <Link href="/reset-password" className="text-xs text-violet-600 hover:text-violet-700 transition-colors">
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
                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
              />
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold hover:from-violet-700 hover:to-indigo-700 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-violet-200 mt-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            No account?{' '}
            <Link href="/register" className="text-violet-600 hover:text-violet-700 font-medium transition-colors">
              Create one
            </Link>
          </p>

          {/* Decorative dots */}
          <div className="mt-16 flex justify-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-300" />
            <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
          </div>
        </div>
      </div>
    </div>
  )
}
