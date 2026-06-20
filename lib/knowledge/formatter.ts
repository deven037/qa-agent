import { PageKnowledge } from '@/lib/db/models/AppKnowledge'

export function formatPagesForParsing(pages: PageKnowledge[]): string {
  if (pages.length === 0) return '(no page knowledge available)'
  return pages
    .map((p) => {
      const fields = p.forms
        .flatMap((f) => f.fields.map((field) => field.label || field.placeholder || field.htmlName || ''))
        .filter(Boolean)
      const fieldStr = fields.length > 0 ? ` — fields: ${fields.join(', ')}` : ''
      return `- ${p.path}: ${p.title} (${p.module})${fieldStr}`
    })
    .join('\n')
}

export function formatLocatorsForCurrentPage(pages: PageKnowledge[], currentUrl: string): string {
  let targetPages = pages

  try {
    const url = new URL(currentUrl)
    const currentPath = url.pathname
    const matching = pages.filter((p) => p.path === currentPath || currentPath.startsWith(p.path))
    if (matching.length > 0) targetPages = matching
  } catch {
    // keep all pages if URL is unparseable
  }

  const lines: string[] = []
  for (const p of targetPages) {
    for (const form of p.forms) {
      for (const field of form.fields) {
        const name = field.label || field.placeholder || field.htmlName
        const best = field.locators.getByLabel || field.locators.getByPlaceholder || field.locators.getByRole || field.locators.byName
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
        const loc = btn.locators.getByRole || btn.locators.getByText
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
            const best = field.locators.getByLabel || field.locators.getByPlaceholder || field.locators.getByRole || field.locators.byName || '(no locator)'
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
