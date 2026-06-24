import { PageKnowledge } from '@/lib/db/models/AppKnowledge'

export function formatPagesForParsing(pages: PageKnowledge[]): string {
  if (pages.length === 0) return '(no page knowledge available)'
  return pages.map((p) => {
    const lines: string[] = [`[${p.module.toUpperCase()}] ${p.title} — ${p.path}`]
    for (const form of p.forms) {
      for (const field of form.fields) {
        const name = field.label || field.placeholder || field.htmlName || ''
        if (!name) continue
        // Best locator in priority order: testId > id > name attr > label > placeholder > role
        const loc = field.locators.byTestId || field.locators.byId || field.locators.byName
          || field.locators.getByLabel || field.locators.getByPlaceholder || field.locators.getByRole
        const type = field.inputType ? ` [${field.inputType}]` : ''
        const req = field.required ? ' *' : ''
        lines.push(`  ${name}${type}${req} → ${loc || '(no locator)'}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const opts = (field as any).selectOptions as string[] | undefined
        if (opts?.length) lines.push(`    options: ${opts.slice(0, 10).join(', ')}`)
      }
      if (form.submitButtonLocator) lines.push(`  [submit] → ${form.submitButtonLocator}`)
    }
    for (const btn of p.buttons.slice(0, 6)) {
      const loc = btn.locators.byTestId || btn.locators.byId || btn.locators.getByRole || btn.locators.getByText
      if (btn.name && loc) lines.push(`  [btn] ${btn.name} → ${loc}`)
    }
    return lines.join('\n')
  }).join('\n\n')
}

export function formatLocatorsForCurrentPage(pages: PageKnowledge[], currentUrl: string): string {
  let targetPages = pages

  try {
    const url = new URL(currentUrl)
    const currentPath = url.pathname
    const currentQuery = url.search // e.g. "?rt=account/login"

    // Try full URL match first (for query-param routed apps like ?rt=...)
    const fullMatch = pages.filter((p) => {
      try {
        const pu = new URL(p.path.startsWith('http') ? p.path : `http://x${p.path}`)
        return pu.pathname === currentPath && pu.search === currentQuery
      } catch { return false }
    })

    if (fullMatch.length > 0) {
      targetPages = fullMatch
    } else {
      // Fall back to pathname match
      const pathMatch = pages.filter((p) => p.path === currentPath || currentPath.startsWith(p.path))
      if (pathMatch.length > 0) targetPages = pathMatch
    }
  } catch {
    // keep all pages if URL is unparseable
  }

  const lines: string[] = []
  for (const p of targetPages) {
    for (const form of p.forms) {
      for (const field of form.fields) {
        const name = field.label || field.placeholder || field.htmlName
        const best = field.locators.byTestId || field.locators.byId || field.locators.byName
          || field.locators.getByLabel || field.locators.getByPlaceholder || field.locators.getByRole
        if (name && best) lines.push(`${name} → ${best}`)
      }
      if (form.submitButtonLocator) {
        const m = form.submitButtonLocator.match(/name:\s*['"](.+?)['"]/)
        const btnName = m?.[1] || 'Submit'
        lines.push(`${btnName} → ${form.submitButtonLocator}`)
      }
    }
    for (const btn of p.buttons) {
      if (btn.name) {
        const loc = btn.locators.byTestId || btn.locators.byId || btn.locators.getByRole || btn.locators.getByText
        if (loc) lines.push(`${btn.name} → ${loc}`)
      }
    }
  }

  return lines.slice(0, 40).join('\n') || '(none)'
}

export function formatKnowledgeForAnalyst(pages: PageKnowledge[]): string {
  if (pages.length === 0) return '(no page knowledge available)'
  return pages
    .map((p) => {
      const parts: string[] = [`### ${p.path} — ${p.title} (${p.module})`]

      for (const form of p.forms) {
        if (form.fields.length > 0) {
          parts.push(`Form fields:`)
          for (const field of form.fields) {
            const name = field.label || field.placeholder || field.htmlName || '(unnamed)'
            const best = field.locators.byTestId || field.locators.byId || field.locators.byName
              || field.locators.getByLabel || field.locators.getByPlaceholder || field.locators.getByRole || '(no locator)'
            parts.push(`  - ${name}: ${best}`)
          }
        }
        if (form.submitButtonLocator) {
          parts.push(`  Submit: ${form.submitButtonLocator}`)
        }
      }

      if (p.buttons.length > 0) {
        parts.push(`Buttons: ${p.buttons.map((b) => b.name || '(unnamed)').filter(Boolean).join(', ')}`)
      }

      if (p.links && p.links.length > 0) {
        parts.push(`Links: ${p.links.slice(0, 8).map((l) => `${l.text} → ${l.href}`).join(', ')}`)
      }

      return parts.join('\n')
    })
    .join('\n\n')
}
