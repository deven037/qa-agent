import { getKnowledge, getKnowledgeStatus } from '@/lib/db/knowledge-store'
import { PageKnowledge } from '@/lib/db/models/AppKnowledge'

const STOP_WORDS = new Set(['the', 'and', 'with', 'for', 'that', 'this', 'from', 'have', 'will', 'user', 'test', 'verify', 'should', 'able', 'into', 'after', 'then', 'when'])

function stem(word: string): string {
  return word
    .replace(/ation$/, '')
    .replace(/tion$/, '')
    .replace(/ing$/, '')
    .replace(/ness$/, '')
    .replace(/ment$/, '')
    .replace(/ed$/, '')
    .replace(/er$/, '')
    .replace(/s$/, '')
}

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
    .map(stem)
    .filter((w) => w.length > 2)
}

function scorePageRelevance(page: PageKnowledge, tokens: string[]): number {
  const corpusParts = [
    page.title,
    page.path,
    page.module,
    ...page.headings,
    ...page.forms.map((f) => f.formName),
    ...page.forms.flatMap((f) => f.fields.map((field) => `${field.label ?? ''} ${field.placeholder ?? ''}`)),
    ...page.visibleTextSample,
    ...page.buttons.map((b) => b.name ?? ''),
  ]
  const corpus = corpusParts.map(stem).join(' ').toLowerCase()
  const stemmedCorpus = corpusParts.join(' ').toLowerCase().split(/\s+/).map(stem).join(' ')

  let score = tokens.filter((t) => stemmedCorpus.includes(t) || corpus.includes(t)).length

  // Bonus: path directly matches a token (e.g. /login matches "login")
  for (const t of tokens) {
    if (page.path.toLowerCase().includes(t)) score += 3
    if (page.module.toLowerCase().includes(t)) score += 2
  }

  return score
}

export async function inferRelevantPages(appId: string, text: string, topK = 5): Promise<PageKnowledge[]> {
  const knowledge = await getKnowledge(appId)
  if (!knowledge || knowledge.status !== 'ready' || !knowledge.pages?.length) return []

  // Deduplicate pages by path (keep first occurrence — crawl order gives landing pages priority)
  const seenPaths = new Set<string>()
  const uniquePages = knowledge.pages.filter((p) => {
    if (seenPaths.has(p.path)) return false
    seenPaths.add(p.path)
    return true
  })

  const tokens = tokenize(text)
  if (tokens.length === 0) return uniquePages.slice(0, topK)

  const scored = uniquePages.map((p) => ({ page: p, score: scorePageRelevance(p, tokens) }))
  scored.sort((a, b) => b.score - a.score)

  // Always include auth pages (login/register have the most important locators)
  const authPages = uniquePages.filter((p) => p.module === 'auth' || p.path.includes('register'))
  const topPages = scored.slice(0, topK).map((s) => s.page)

  const combined = [...topPages]
  for (const ap of authPages) {
    if (!combined.find((p) => p.path === ap.path)) combined.push(ap)
  }

  return combined.slice(0, topK + 2)
}

// Compact inventory used by the scenario generator — real paths + element names only
export function getPageInventory(pages: PageKnowledge[]): string {
  if (pages.length === 0) return '(no pages crawled — run knowledge base crawl first)'

  return pages.map((page) => {
    const lines: string[] = [`[${page.module.toUpperCase()}] "${page.title}" → path: ${page.path}`]

    for (const form of page.forms) {
      const fields = form.fields
        .filter((f) => f.label || f.placeholder || f.htmlName)
        .map((f) => `"${f.label || f.placeholder || f.htmlName}"`)
      if (fields.length) lines.push(`  Fields: ${fields.join(', ')}`)
      if (form.submitButtonLocator) {
        const btn = form.submitButtonLocator.match(/name:\s*['"](.+?)['"]/)?.[1]
        if (btn) lines.push(`  Submit: "${btn}"`)
      }
    }

    const actionBtns = page.buttons
      .filter((b) => b.name && !/back to top|scroll|share|print|close|dismiss/i.test(b.name))
      .slice(0, 5)
      .map((b) => `"${b.name}"`)
    if (actionBtns.length) lines.push(`  Buttons/Links: ${actionBtns.join(', ')}`)

    const navLinks = page.links
      ?.filter((l) => l.text && l.path && !l.path.includes('javascript'))
      .slice(0, 5)
      .map((l) => `"${l.text}" → ${l.path}`)
    if (navLinks?.length) lines.push(`  Nav links: ${navLinks.join(' | ')}`)

    return lines.join('\n')
  }).join('\n\n')
}

export function getPageContext(pages: PageKnowledge[]): string {
  if (pages.length === 0) return ''

  const lines: string[] = [
    '=== APP UI KNOWLEDGE ===',
    'Use these field names, button labels, and paths verbatim in your steps.',
    'DO NOT generate steps for elements listed here unless the scenario explicitly requires them.',
    '',
  ]

  for (const page of pages) {
    lines.push(`Page: "${page.title}" — path: ${page.path} (${page.module})`)

    for (const form of page.forms) {
      const namedFields = form.fields.filter((f) => f.label || f.placeholder || f.htmlName)
      if (!namedFields.length && !form.submitButtonLocator) continue
      lines.push(`  Form: "${form.formName}"`)
      for (const field of namedFields) {
        const name = field.label || field.placeholder || field.htmlName || '(unnamed)'
        const type = field.inputType || 'text'
        const req = field.required ? ' [required]' : ''
        lines.push(`    • Field: "${name}" (${type})${req}`)
        if (field.validationMessages.length) {
          lines.push(`      Validation: ${field.validationMessages.join(' | ')}`)
        }
      }
      if (form.submitButtonLocator) {
        const btnName = form.submitButtonLocator.match(/name:\s*['"](.+?)['"]/)?.[1] || 'Submit'
        lines.push(`    • Submit button: "${btnName}"`)
      }
    }

    // Only show buttons directly relevant to actions (not nav/utility buttons)
    const actionButtons = page.buttons
      .filter((b) => b.name && !/back to top|scroll|share|print|close|dismiss/i.test(b.name))
      .slice(0, 6)
    if (actionButtons.length) {
      lines.push(`  Action buttons: ${actionButtons.map((b) => `"${b.name}"`).join(', ')}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}

export function getLocatorContext(pages: PageKnowledge[]): string {
  if (pages.length === 0) return ''

  const lines: string[] = [
    '=== REAL UI LOCATORS — use these exactly, do not guess ===',
    '',
  ]

  for (const page of pages) {
    lines.push(`Page: ${page.path} — "${page.title}"`)

    for (const form of page.forms) {
      const usableFields = form.fields.filter((f) => {
        const best = f.locators?.getByLabel || f.locators?.getByPlaceholder || f.locators?.getByRole || f.locators?.byName
        return !!(best && (f.label || f.placeholder || f.htmlName))
      })
      if (!usableFields.length && !form.submitButtonLocator) continue
      lines.push(`  Form: "${form.formName}"`)
      for (const field of usableFields) {
        const name = field.label || field.placeholder || field.htmlName!
        const bestLocator = field.locators.getByLabel || field.locators.getByPlaceholder || field.locators.getByRole || field.locators.byName!
        lines.push(`    ${name} → ${bestLocator}`)
        if (field.validationMessages.length) {
          lines.push(`      Empty-submit errors: ${field.validationMessages.map((m) => `"${m}"`).join(' | ')}`)
        }
      }
      if (form.submitButtonLocator) lines.push(`    Submit → ${form.submitButtonLocator}`)
    }

    const interactiveButtons = page.buttons.filter((b) => b.name && b.locators.getByRole)
    if (interactiveButtons.length) {
      lines.push(`  Buttons:`)
      for (const btn of interactiveButtons.slice(0, 8)) {
        lines.push(`    ${btn.name} → ${btn.locators.getByRole}`)
      }
    }

    lines.push('')
  }

  return lines.join('\n')
}

export async function isKnowledgeStale(appId: string): Promise<boolean> {
  const status = await getKnowledgeStatus(appId)
  if (!status || status.status !== 'ready') return true
  if (!status.crawlCompletedAt) return true
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  return new Date(status.crawlCompletedAt).getTime() < sevenDaysAgo
}
