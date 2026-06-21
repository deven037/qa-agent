'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { LayoutDashboard, ClipboardList, TestTube, Zap, Home, Settings } from 'lucide-react'

interface Props {
  appId: string
  appName: string
  jiraProjectKey: string
}

const NAV_ITEMS = [
  { label: 'Dashboard', href: 'dashboard', icon: LayoutDashboard },
  { label: 'Work Items', href: 'work-items', icon: ClipboardList },
  { label: 'Manual TC Creation', href: 'manual-tc', icon: TestTube },
  { label: 'Automation', href: 'automation', icon: Zap },
  { label: 'Settings', href: 'settings', icon: Settings },
]

export default function AppNavbar({ appId, appName, jiraProjectKey }: Props) {
  const pathname = usePathname()
  const base = `/apps/${appId}`

  return (
    <nav className="bg-gradient-to-r from-violet-600 via-violet-700 to-indigo-700 shadow-lg" style={{ fontFamily: 'var(--font-jakarta), sans-serif' }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Left: app identity */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-white font-bold text-base tracking-[-0.02em]">{appName}</span>
            <Badge className="bg-white/15 text-white/90 border-white/20 text-xs font-mono font-normal hover:bg-white/25">
              {jiraProjectKey}
            </Badge>
          </div>

          {/* Center: nav links */}
          <div className="flex items-center gap-1">
            {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
              const active = pathname === `${base}/${href}` || pathname.startsWith(`${base}/${href}/`)
              return (
                <Link
                  key={href}
                  href={`${base}/${href}`}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm tracking-[-0.01em] transition-all whitespace-nowrap ${
                    active
                      ? 'bg-white text-violet-700 shadow-sm font-medium'
                      : 'text-white/70 hover:text-white hover:bg-white/10 font-normal'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </Link>
              )
            })}
          </div>

          {/* Right: back to main dashboard */}
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm font-normal tracking-[-0.01em] transition-colors shrink-0"
          >
            <Home className="w-4 h-4" />
            <span className="hidden sm:inline">Apps</span>
          </Link>
        </div>
      </div>
    </nav>
  )
}
