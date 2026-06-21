'use client'

import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'

export default function AppSearch() {
  const [query, setQuery] = useState('')

  useEffect(() => {
    const grid = document.getElementById('app-grid')
    if (!grid) return
    const cards = grid.querySelectorAll<HTMLElement>('[data-app-name]')
    const q = query.toLowerCase()
    cards.forEach((card) => {
      const name = card.dataset.appName ?? ''
      const key = card.dataset.appKey ?? ''
      card.style.display = (!q || name.includes(q) || key.includes(q)) ? '' : 'none'
    })
  }, [query])

  return (
    <div className="relative mb-5 max-w-xs">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        type="text"
        placeholder="Search apps…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition shadow-sm"
      />
    </div>
  )
}
