import { chromium, firefox, webkit, Browser, Page, Locator, FrameLocator } from 'playwright'
import { AppConfig } from '@/lib/config/store'
import { PageKnowledge } from '@/lib/db/models/AppKnowledge'
import { TestCase } from '@/lib/agents/testcase-agent'
import { callLLM } from '@/lib/ai/gemini'
import { fillPrompt } from '@/lib/prompts/loader'
import { formatPagesForParsing, formatLocatorsForCurrentPage, formatKnowledgeForAnalyst } from '@/lib/knowledge/formatter'

// ─── Shared event types ───────────────────────────────────────────────────────

export interface AgentEvent {
  type:
    | 'tc_start' | 'step_start' | 'step_heal' | 'step_done' | 'tc_done' | 'tc_analyzing' | 'log'
    | 'plan_start' | 'plan_step' | 'plan_done'
    | 'agent_thinking' | 'llm_response' | 'dom_inspect' | 'locator_try' | 'nav'
  id?: string
  title?: string
  tcId?: string
  stepIndex?: number
  step?: string
  status?: 'passed' | 'failed'
  locatorUsed?: string
  error?: string
  healingAttempts?: number
  attempt?: number
  rationale?: string
  duration?: number
  text?: string
  reason?: string
  // new console fields
  locator?: string
  success?: boolean
  url?: string
  fieldCount?: number
  action?: string
  plannedStep?: { step: string; expected: string }
}

export interface ExecutionResult {
  passed: number
  failed: number
  skipped: number
  duration: number
  testResults: Array<{
    title: string
    status: 'passed' | 'failed' | 'skipped'
    duration: number
    error?: string
    errorStack?: string
    retries: number
  }>
  resolvedSteps?: ResolvedStepRecord[]
}

export interface ParsedStep {
  action: 'navigate' | 'click' | 'fill' | 'assert' | 'wait'
  target: string
  value?: string
  locator?: string
}

export interface ResolvedStepRecord {
  original: string
  parsed: ParsedStep
}

// ─── Locator resolution ───────────────────────────────────────────────────────

function resolveLocatorString(page: Page, locatorStr: string): Locator {
  let m: RegExpMatchArray | null

  m = locatorStr.match(/getByLabel\(['"](.+?)['"]\s*(?:,\s*\{[^}]*\})?\)/)
  if (m) return page.getByLabel(m[1], { exact: false })

  m = locatorStr.match(/getByPlaceholder\(['"](.+?)['"]\s*(?:,\s*\{[^}]*\})?\)/)
  if (m) return page.getByPlaceholder(m[1], { exact: false })

  m = locatorStr.match(/getByRole\(['"](\w+)['"]\s*,\s*\{[^}]*name:\s*['"](.+?)['"]\s*[^}]*\}/)
  if (m) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return page.getByRole(m[1] as any, { name: m[2], exact: false })
  }

  m = locatorStr.match(/getByRole\(['"](\w+)['"]\s*\)/)
  if (m) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return page.getByRole(m[1] as any)
  }

  m = locatorStr.match(/getByText\(['"](.+?)['"]\s*(?:,\s*\{[^}]*\})?\)/)
  if (m) return page.getByText(m[1], { exact: false })

  // page.locator('selector') — selector may contain double quotes like input[name="x"]
  m = locatorStr.match(/locator\('([^']+)'\)/)
  if (m) return page.locator(m[1])

  // page.locator("selector") — selector may contain single quotes
  m = locatorStr.match(/locator\("([^"]+)"\)/)
  if (m) return page.locator(m[1])

  // Raw CSS selector (no wrapper) — use as-is
  return page.locator(locatorStr)
}

function scoreMatch(name: string, tl: string): number {
  if (!name) return 0
  if (name === tl) return 10
  if (name.startsWith(tl)) return 7
  if (tl.startsWith(name)) return 5
  if (name.includes(tl)) return 3
  if (tl.includes(name)) return 2
  return 0
}

function findBestLocator(target: string, pages: PageKnowledge[]): string | null {
  const tl = target.toLowerCase().trim()
  let best: { locator: string; score: number } | null = null

  const consider = (locator: string | null | undefined, score: number) => {
    if (locator && score > (best?.score ?? 0)) best = { locator, score }
  }

  for (const pg of pages) {
    for (const form of pg.forms) {
      for (const field of form.fields) {
        const name = (field.label || field.placeholder || field.htmlName || '').toLowerCase()
        const score = scoreMatch(name, tl)
        if (score > 0) {
          consider(field.locators.getByLabel || field.locators.getByPlaceholder || field.locators.getByRole || field.locators.byName, score)
        }
      }
      if (form.submitButtonLocator) {
        const m = form.submitButtonLocator.match(/name:\s*['"](.+?)['"]/)
        if (m) consider(form.submitButtonLocator, scoreMatch(m[1].toLowerCase(), tl))
      }
    }
    for (const btn of pg.buttons) {
      const name = (btn.name || btn.label || '').toLowerCase()
      const score = scoreMatch(name, tl)
      if (score > 0) {
        consider(btn.locators.getByRole || btn.locators.getByText || btn.locators.getByLabel, score)
      }
    }
  }

  return (best as { locator: string; score: number } | null)?.locator ?? null
}

// Returns only the byName (CSS input[name=...]) locator from KB — most reliable
// on sites with broken ARIA (e.g. Shopify's <div id="X"> / <input id="X"> pattern)
function findBestLocatorByName(target: string, pages: PageKnowledge[]): string | null {
  const tl = target.toLowerCase().trim()
  let best: { locator: string; score: number } | null = null
  const consider = (locator: string | null | undefined, score: number) => {
    if (locator && score > ((best as { locator: string; score: number } | null)?.score ?? 0))
      best = { locator, score }
  }
  for (const pg of pages) {
    for (const form of pg.forms) {
      for (const field of form.fields) {
        const name = (field.label || field.placeholder || field.htmlName || '').toLowerCase()
        const score = scoreMatch(name, tl)
        if (score > 0) consider(field.locators.byName, score)
      }
    }
  }
  return (best as { locator: string; score: number } | null)?.locator ?? null
}

// ─── Locator index — built once per execution, replaces per-step O(n) scans ──

interface LocatorIndex {
  primary: Map<string, string>  // target.toLowerCase() → best locator
  byName: Map<string, string>   // target.toLowerCase() → byName locator
}

function buildLocatorIndex(pages: PageKnowledge[]): LocatorIndex {
  const primary = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const pg of pages) {
    for (const form of pg.forms) {
      for (const field of form.fields) {
        const key = (field.label || field.placeholder || field.htmlName || '').toLowerCase().trim()
        if (!key) continue
        if (!primary.has(key)) {
          const loc = field.locators.getByLabel || field.locators.getByPlaceholder || field.locators.getByRole || field.locators.byName
          if (loc) primary.set(key, loc)
        }
        if (!byName.has(key) && field.locators.byName) byName.set(key, field.locators.byName)
      }
      if (form.submitButtonLocator) {
        const m = form.submitButtonLocator.match(/name:\s*['"](.+?)['"]/)
        if (m && !primary.has(m[1].toLowerCase())) primary.set(m[1].toLowerCase(), form.submitButtonLocator)
      }
    }
    for (const btn of pg.buttons) {
      const key = (btn.name || btn.label || '').toLowerCase().trim()
      if (!key || primary.has(key)) continue
      const loc = btn.locators.getByRole || btn.locators.getByText || btn.locators.getByLabel
      if (loc) primary.set(key, loc)
    }
  }
  return { primary, byName }
}

function indexedLocator(target: string, index: LocatorIndex): string | null {
  const tl = target.toLowerCase().trim()
  // Exact match first, then prefix/substring
  if (index.primary.has(tl)) return index.primary.get(tl)!
  for (const [key, loc] of index.primary) {
    if (key.startsWith(tl) || tl.startsWith(key)) return loc
  }
  return null
}

function indexedLocatorByName(target: string, index: LocatorIndex): string | null {
  const tl = target.toLowerCase().trim()
  if (index.byName.has(tl)) return index.byName.get(tl)!
  for (const [key, loc] of index.byName) {
    if (key.startsWith(tl) || tl.startsWith(key)) return loc
  }
  return null
}

// ─── Page stability ───────────────────────────────────────────────────────────

async function waitForStable(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 800 }).catch(() => {})
}

// ─── Overlay dismissal ────────────────────────────────────────────────────────

// ─── Structural overlay detection + LLM dismiss ──────────────────────────────
// Does NOT rely on button text — works for any language, any custom popup.

async function dismissOverlays(
  page: Page,
  onEvent?: (e: AgentEvent) => void,
): Promise<void> {
  // Up to 2 passes — overlays can stack (cookie banner → newsletter popup)
  for (let pass = 0; pass < 2; pass++) {
    // Step 1: find visible overlay containers by structure, not text
    const overlayInfo = await page.evaluate(() => {
      // Candidates: role=dialog/alertdialog, semantic class patterns, high-z-index fixed elements
      const candidates = Array.from(document.querySelectorAll(
        '[role="dialog"],[role="alertdialog"],[aria-modal="true"],' +
        '[class*="modal"],[class*="popup"],[class*="overlay"],[class*="banner"],' +
        '[class*="cookie"],[class*="consent"],[class*="gdpr"],[class*="drawer"],' +
        '[id*="modal"],[id*="popup"],[id*="cookie"],[id*="consent"]'
      ))

      for (const el of candidates) {
        const style = window.getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        // Must be visible, cover meaningful area, not a tiny widget
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
        if (rect.width < 100 || rect.height < 40) continue

        const buttons = Array.from(el.querySelectorAll('button,[role="button"],a[href="#"]'))
          .filter(b => {
            const r = b.getBoundingClientRect()
            return r.width > 0 && r.height > 0
          })
          .map(b => ({
            text: (b.textContent ?? '').trim().slice(0, 60),
            ariaLabel: b.getAttribute('aria-label') ?? '',
            className: b.className ?? '',
            id: b.id ?? '',
          }))

        if (buttons.length === 0) continue

        return {
          overlayText: (el.textContent ?? '').slice(0, 400).trim(),
          buttons,
        }
      }
      return null
    })

    if (!overlayInfo) break  // no overlay found

    // Step 2: ask LLM which button closes/dismisses (not accepts a signup or buys something)
    const buttonList = overlayInfo.buttons
      .map((b, i) => `${i}: text="${b.text}" aria-label="${b.ariaLabel}" class="${b.className}"`)
      .join('\n')

    const llmPrompt = `A web page has an overlay/popup with this content:\n"${overlayInfo.overlayText}"\n\nButtons available:\n${buttonList}\n\nWhich button index (0-based) closes or dismisses this overlay WITHOUT accepting a newsletter, making a purchase, or signing up? If none dismiss it, return -1.\n\nReturn JSON only: {"index": <number>, "reason": "<one line>"}`

    let dismissIndex = -1
    try {
      const raw = await callLLM(llmPrompt, 'You are a browser automation expert. Return JSON only, no markdown.')
      const match = raw.replace(/```json?/gi, '').replace(/```/g, '').match(/\{[\s\S]*\}/)
      if (match) {
        const result = JSON.parse(match[0]) as { index: number; reason: string }
        dismissIndex = result.index ?? -1
        if (dismissIndex >= 0) {
          onEvent?.({ type: 'log', text: `Overlay detected — dismissing via button ${dismissIndex}: ${result.reason}` })
        }
      }
    } catch { /* fall through to structural fallback */ }

    // Step 3: structural fallback if LLM fails — click the button least likely to be a primary CTA
    // Heuristic: close/dismiss buttons are usually short text (×, Close, X) or last in the list
    if (dismissIndex < 0) {
      const closeIdx = overlayInfo.buttons.findIndex(b =>
        /^[×✕✖x]$/i.test(b.text) ||
        /close|dismiss|cancel|skip|no.?thanks|later/i.test(b.text + b.ariaLabel + b.className)
      )
      dismissIndex = closeIdx >= 0 ? closeIdx : overlayInfo.buttons.length - 1
      onEvent?.({ type: 'log', text: `Overlay detected — using structural heuristic, clicking button ${dismissIndex}` })
    }

    if (dismissIndex < 0 || dismissIndex >= overlayInfo.buttons.length) break

    // Step 4: click the identified button
    try {
      const btn = overlayInfo.buttons[dismissIndex]
      const selectors = [
        btn.id ? `#${btn.id}` : null,
        btn.ariaLabel ? `[aria-label="${btn.ariaLabel}"]` : null,
        btn.text ? `button:has-text("${btn.text.slice(0, 20)}")` : null,
        '[role="dialog"] button', '[aria-modal="true"] button',
      ].filter(Boolean) as string[]

      let clicked = false
      for (const sel of selectors) {
        const el = page.locator(sel).first()
        const visible = await el.isVisible({ timeout: 300 }).catch(() => false)
        if (visible) {
          await el.click({ force: true, timeout: 800 }).catch(() => {})
          clicked = true
          break
        }
      }
      if (clicked) await waitForStable(page)
    } catch { /* non-fatal */ }
  }
}

// ─── ARIA snapshot ────────────────────────────────────────────────────────────

async function getAriaSnapshot(page: Page): Promise<string> {
  try {
    const main = page.locator('main, [role="main"], #content, #app, body').first()
    const snap = await main.ariaSnapshot({ timeout: 5000 })
    return snap.slice(0, 6000)
  } catch {
    try {
      return (await page.evaluate(() => document.body.innerText)).slice(0, 3000)
    } catch {
      return '(snapshot unavailable)'
    }
  }
}

// ─── DOM field extraction ─────────────────────────────────────────────────────
// Extracts raw input metadata directly from DOM — bypasses ARIA bugs like
// Shopify's pattern where <div id="X"> shadows <input id="X">.

async function extractDomFields(page: Page): Promise<string> {
  try {
    const fields = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select')
      ).map(el => {
        const labelEl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null
        const ariaLabel = el.getAttribute('aria-label') || ''
        return {
          label: labelEl?.textContent?.trim() || ariaLabel,
          name: el.name || '',
          id: el.id || '',
          type: (el as HTMLInputElement).type || 'text',
          placeholder: (el as HTMLInputElement).placeholder || '',
        }
      }).filter(f => f.name || f.label || f.id)
    })
    if (fields.length === 0) return '(no interactive form fields found)'
    return fields.map(f =>
      `  label="${f.label}" name="${f.name}" id="${f.id}" type="${f.type}" placeholder="${f.placeholder}"`
    ).join('\n')
  } catch {
    return '(could not extract DOM fields)'
  }
}

// ─── Robust action helpers ────────────────────────────────────────────────────

async function tryFill(locator: Locator, value: string): Promise<boolean> {
  try {
    const first = locator.first()
    await first.waitFor({ state: 'visible', timeout: 3000 })
    if (!await first.isEnabled()) return false
    await first.scrollIntoViewIfNeeded()
    // Triple-click selects all pre-existing text before typing
    await first.click({ clickCount: 3, timeout: 2000 })
    try {
      await first.fill(value, { timeout: 3000 })
    } catch {
      // Slow-type fallback for React/Vue controlled inputs
      await first.press('Control+a')
      await first.type(value, { delay: 30 })
    }
    // Fire DOM events for JS-driven inputs
    await first.dispatchEvent('input')
    await first.dispatchEvent('change')
    return true
  } catch { return false }
}

async function tryClick(locator: Locator): Promise<boolean> {
  try {
    const first = locator.first()
    await first.waitFor({ state: 'visible', timeout: 1500 })
    await first.scrollIntoViewIfNeeded()
    await first.click({ timeout: 3000 })
    return true
  } catch {
    // Force-click bypasses pointer-events:none / overlay coverage
    try {
      await locator.first().click({ force: true, timeout: 2000 })
      return true
    } catch { return false }
  }
}

// ─── iframe-aware search ──────────────────────────────────────────────────────

async function findAcrossFrames(
  page: Page,
  buildLocator: (ctx: Page | FrameLocator) => Locator,
  action: (loc: Locator) => Promise<boolean>,
): Promise<boolean> {
  if (await action(buildLocator(page))) return true

  const frames = page.frames().filter(f => f !== page.mainFrame())
  for (const frame of frames) {
    try {
      const fl = page.frameLocator(`iframe[src="${frame.url()}"], iframe`).first()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (await action(buildLocator(fl as any))) return true
    } catch { /* skip frame */ }
  }
  return false
}

// ─── Regex fast path ──────────────────────────────────────────────────────────

function parseStepRegex(step: string): ParsedStep | null {
  let m: RegExpMatchArray | null
  const s = step.trim()

  // ── Navigate ──────────────────────────────────────────────────────────────
  m = s.match(/^navigat\w*\s+to\s+(\S+)/i)
  if (m) return { action: 'navigate', target: m[1] }

  m = s.match(/^(?:go\s+to|open|visit)\s+(\S+)/i)
  if (m) return { action: 'navigate', target: m[1] }

  // ── Fill ──────────────────────────────────────────────────────────────────
  // Fill 'Field' with 'value'
  m = s.match(/^fill\s+['"](.+?)['"]\s+with\s+['"](.+?)['"]/i)
  if (m) return { action: 'fill', target: m[1], value: m[2] }

  // Enter/type 'value' in/into 'field'
  m = s.match(/^(?:enter|type|input)\s+['"](.+?)['"]\s+(?:in(?:to)?|for)\s+['"](.+?)['"]/i)
  if (m) return { action: 'fill', target: m[2], value: m[1] }

  // ── Click ─────────────────────────────────────────────────────────────────
  // Click 'Button' / Click on 'Button'
  m = s.match(/^click\s+(?:on\s+)?['"](.+?)['"]/i)
  if (m) return { action: 'click', target: m[1] }

  // Click the 'Button' button / Click the Login link
  m = s.match(/^click\s+the\s+['"]?(.+?)['"]?\s+(?:button|link|tab|checkbox|radio|icon|menu|item|option)s?$/i)
  if (m) return { action: 'click', target: m[1].replace(/['"]/g, '').trim() }

  // Click 'Button' button (no "the")
  m = s.match(/^click\s+['"]?(.+?)['"]?\s+(?:button|link|tab|checkbox|radio|icon)s?$/i)
  if (m) return { action: 'click', target: m[1].replace(/['"]/g, '').trim() }

  // Press / Submit / Tap 'Label'
  m = s.match(/^(?:press|submit|tap)\s+['"](.+?)['"]/i)
  if (m) return { action: 'click', target: m[1] }

  // Press / Submit / Tap the Login/Submit/etc button (no quotes)
  m = s.match(/^(?:press|submit|tap)\s+(?:the\s+)?(.+?)\s+(?:button|link)$/i)
  if (m) return { action: 'click', target: m[1].trim() }

  // ── Assert ────────────────────────────────────────────────────────────────
  // Verify URL contains /path
  m = s.match(/^(?:verify|assert|check|confirm)\s+(?:the\s+)?url\s+(?:contains?|includes?|has)\s+(\S+)/i)
  if (m) return { action: 'assert', target: 'url', value: m[1] }

  // Verify 'text' is visible/shown/displayed/present
  m = s.match(/^(?:verify|assert|check|confirm)\s+['"](.+?)['"]\s+(?:is\s+)?(?:visible|shown|displayed|present)/i)
  if (m) return { action: 'assert', target: m[1] }

  // Verify user is redirected to /path  OR  Verify page is /path
  m = s.match(/^(?:verify|assert|check|confirm)\s+.+?(?:redirect\w*\s+to|navigat\w*\s+to|on\s+(?:the\s+)?page)\s+(\S+)/i)
  if (m) return { action: 'assert', target: 'url', value: m[1] }

  // Verify 'text' is/appears/exists (no visible keyword)
  m = s.match(/^(?:verify|assert|check|confirm)\s+(?:that\s+)?['"](.+?)['"][^a-z]*(?:is|appears?|exists?)?$/i)
  if (m) return { action: 'assert', target: m[1] }

  // Should see / User should see 'text'
  m = s.match(/^(?:.+\s+)?should\s+(?:see|show|display|have)\s+['"](.+?)['"]/i)
  if (m) return { action: 'assert', target: m[1] }

  // ── Wait ──────────────────────────────────────────────────────────────────
  m = s.match(/^(?:wait\s+for|wait)\s+['"](.+?)['"]/i)
  if (m) return { action: 'wait', target: m[1] }

  m = s.match(/^(?:wait\s+for|wait)\s+(?:the\s+)?(?:page|page load|navigation)/i)
  if (m) return { action: 'wait', target: 'page_load' }

  return null
}

// ─── Proactive LLM step resolver ─────────────────────────────────────────────

async function resolveStepWithLLM(
  page: Page,
  step: string,
  expected: string,
  pages: PageKnowledge[],
  appConfig: AppConfig,
  onEvent?: (e: AgentEvent) => void,
): Promise<ParsedStep> {
  await waitForStable(page)
  const [ariaSnap, domFieldsRaw] = await Promise.all([getAriaSnapshot(page), extractDomFields(page)])

  const fieldCount = (domFieldsRaw.match(/label=/g) || []).length
  onEvent?.({ type: 'dom_inspect', url: page.url(), fieldCount, text: `${fieldCount} field(s) found on ${page.url()}` })
  onEvent?.({ type: 'agent_thinking', text: `Resolving locator for: ${step}` })

  const kbHints = formatPagesForParsing(pages)

  const prompt = fillPrompt('step-resolver', {
    current_url: page.url(),
    aria_snapshot: ariaSnap,
    dom_fields: domFieldsRaw,
    knowledge_base: kbHints,
    step,
    expected: expected || '(not specified)',
  })

  // ── Field-matching: pure DOM reasoning, no ARIA noise ──────────────────────
  // Parse all fields from DOM extraction into structured list
  const domFieldLines = domFieldsRaw.split('\n').filter(l => l.includes('name='))
  const domFields = domFieldLines.map(l => {
    const get = (attr: string) => l.match(new RegExp(`${attr}="([^"]*)"`)) ?.[1] ?? ''
    return { label: get('label'), name: get('name'), id: get('id'), type: get('type'), placeholder: get('placeholder') }
  })

  // Extract target field name from step ("Fill 'First Name' with 'John'" → "First Name")
  const targetMatch = step.match(/['"]([^'"]+)['"]/i)
  const targetLabel = targetMatch?.[1]?.toLowerCase() ?? ''

  // Direct match: label / placeholder / id / name contains the target word(s)
  const targetWords = targetLabel.split(/\s+/).filter(w => w.length > 1)
  const directMatch = domFields.find(f => {
    const hay = `${f.label} ${f.placeholder} ${f.id} ${f.name}`.toLowerCase()
    return targetWords.every(w => hay.includes(w))
  })
  if (directMatch) {
    const locator = directMatch.name
      ? `page.locator('input[name="${directMatch.name}"]')`
      : directMatch.type === 'password'
      ? `page.locator('input[type="password"]')`
      : `page.getByLabel('${directMatch.label || directMatch.placeholder}')`
    const valueMatch = step.match(/with\s+['"]([^'"]+)['"]/i)
    onEvent?.({ type: 'llm_response', action: 'fill', locator, rationale: `matched "${targetLabel}" → ${locator}` })
    return { action: 'fill', target: targetLabel, value: valueMatch?.[1] ?? '', locator }
  }

  // type="password" shortcut
  if (/password/i.test(targetLabel)) {
    const pwField = domFields.find(f => f.type === 'password')
    if (pwField) {
      const locator = pwField.name ? `page.locator('input[name="${pwField.name}"]')` : `page.locator('input[type="password"]')`
      const valueMatch = step.match(/with\s+['"]([^'"]+)['"]/i)
      onEvent?.({ type: 'llm_response', action: 'fill', locator, rationale: `password type → ${locator}` })
      return { action: 'fill', target: 'password', value: valueMatch?.[1] ?? '', locator }
    }
  }

  // LLM fallback: only when direct DOM match fails — pass minimal focused prompt
  const fieldList = domFields.map((f, i) =>
    `${i + 1}. label="${f.label}" name="${f.name}" id="${f.id}" type="${f.type}" placeholder="${f.placeholder}"`
  ).join('\n')

  const focusedPrompt = `You are a Playwright locator expert. A form on ${page.url()} has these input fields:\n${fieldList}\n\nTest step: "${step}"\n\nWhich field index matches the target? Return JSON only:\n{"index": <1-based number>, "locator": "<playwright locator expression>", "value": "<value to type>"}`

  try {
    const raw = await callLLM(focusedPrompt, 'Return a single JSON object only. No markdown. No explanation.')
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON')
    const result = JSON.parse(match[0]) as { index?: number; locator?: string; value?: string }
    if (result.locator) {
      onEvent?.({ type: 'llm_response', action: 'fill', locator: result.locator, rationale: `LLM matched field ${result.index} → ${result.locator}` })
      const valueMatch = step.match(/with\s+['"]([^'"]+)['"]/i)
      return { action: 'fill', target: targetLabel, value: result.value ?? valueMatch?.[1] ?? '', locator: result.locator }
    }
  } catch { /* fall through to full resolver */ }

  // Full resolver as last resort
  try {
    const raw = await callLLM(prompt, 'You are a Playwright automation expert. Return a single JSON object only. No markdown.')
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object in response')
    const parsed = JSON.parse(match[0]) as ParsedStep
    if (!parsed.action || !parsed.target) throw new Error('Missing action or target')
    onEvent?.({ type: 'llm_response', action: parsed.action, locator: parsed.locator, rationale: `${parsed.action} → ${parsed.locator || parsed.target}` })
    return parsed
  } catch {
    // Regex fallback when LLM fails
    const lower = step.toLowerCase()
    if (/navigat|go to|open|visit/.test(lower)) {
      const pathMatch = step.match(/\/[a-z/\-_]+/)
      return { action: 'navigate', target: pathMatch?.[0] || '/' }
    }
    if (/fill|enter|type|input/.test(lower)) {
      const valueMatch = step.match(/['"]([^'"]+)['"]/)
      return { action: 'fill', target: step, value: valueMatch?.[1] || '' }
    }
    if (/click|press|submit|tap/.test(lower)) return { action: 'click', target: step }
    if (/verify|assert|check|should|expect/.test(lower)) return { action: 'assert', target: 'url', value: '' }
    return { action: 'wait', target: 'page_load' }
  }
}

// ─── Per-step expected result assertion ───────────────────────────────────────

async function assertExpectedResult(page: Page, expected: string): Promise<void> {
  if (!expected || expected === '(not specified)') return
  await waitForStable(page)

  // URL assertion
  const urlMatch = expected.match(/\/[a-z0-9/_-]+/)
  if (urlMatch && /redirect|url|navigat|page/i.test(expected)) {
    if (!page.url().includes(urlMatch[0])) {
      throw new Error(`Expected URL to contain "${urlMatch[0]}", got "${page.url()}"`)
    }
    return
  }

  // Quoted text visibility
  const quoted = expected.match(/['"]([^'"]{3,})['"]/)
  if (quoted) {
    const visible = await page.getByText(quoted[1], { exact: false }).isVisible({ timeout: 3000 }).catch(() => false)
    if (!visible) throw new Error(`Expected "${quoted[1]}" to be visible on page`)
  }
}

// ─── Self-healing ─────────────────────────────────────────────────────────────

async function healStep(
  page: Page,
  step: string,
  parsedStep: ParsedStep,
  error: Error,
  pages: PageKnowledge[],
  onEvent: (e: AgentEvent) => void,
  tcId: string,
  stepIndex: number,
  attempt: number,
  previouslyTriedLocator?: string,
): Promise<string | null> {
  onEvent({ type: 'step_heal', tcId, stepIndex, attempt, rationale: 'Analyzing live page DOM for a working locator…' })

  try {
    const ariaStr = await getAriaSnapshot(page)

    const prompt = fillPrompt('step-healer', {
      step,
      action_json: JSON.stringify(parsedStep),
      error: error.message,
      current_url: page.url(),
      aria_snapshot: ariaStr,
      known_locators: formatLocatorsForCurrentPage(pages, page.url()),
      previously_tried: previouslyTriedLocator || '(none)',
    })

    const raw = await callLLM(prompt, 'You are a Playwright expert. Return JSON only with a working locator expression.')
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null

    const result = JSON.parse(match[0]) as { locator: string; rationale: string }

    try {
      const resolved = resolveLocatorString(page, result.locator)
      const count = await resolved.count()
      if (count === 0) {
        onEvent({ type: 'step_heal', tcId, stepIndex, attempt, rationale: `LLM suggested "${result.locator}" but 0 elements found — discarded` })
        return null
      }
    } catch {
      return null
    }

    onEvent({ type: 'step_heal', tcId, stepIndex, attempt, rationale: result.rationale })
    return result.locator
  } catch {
    return null
  }
}

// ─── Scenario analyst ─────────────────────────────────────────────────────────

async function analyzeStuckScenario(
  page: Page,
  tc: TestCase,
  stepIndex: number,
  completedSteps: { step: string; status: string }[],
  remainingSteps: string[],
  pages: PageKnowledge[],
  onEvent: (e: AgentEvent) => void,
): Promise<{ action: 'revise' | 'skip' | 'navigate'; revisedSteps?: ParsedStep[]; navTarget?: string; reason: string }> {
  onEvent({ type: 'tc_analyzing', tcId: tc.id, reason: 'Exhausted all healing attempts — running scenario analysis…' })

  let ariaStr = ''
  try {
    ariaStr = (await page.locator('body').ariaSnapshot()).slice(0, 3000)
  } catch {
    try {
      ariaStr = (await page.evaluate(() => document.body.innerText)).slice(0, 2000)
    } catch {
      ariaStr = '(snapshot unavailable)'
    }
  }

  const completedStr = completedSteps.length > 0
    ? completedSteps.map((s, i) => `${i + 1}. [${s.status}] ${s.step}`).join('\n')
    : '(none yet)'

  const remainingStr = remainingSteps.length > 0
    ? remainingSteps.map((s, i) => `${stepIndex + i + 2}. ${s}`).join('\n')
    : '(none)'

  const prompt = fillPrompt('scenario-analyst', {
    tc_title: tc.title,
    tc_expected: tc.expectedResult || '(not specified)',
    completed_steps: completedStr,
    stuck_step: `${stepIndex + 1}. ${tc.steps[stepIndex]}`,
    remaining_steps: remainingStr,
    current_url: page.url(),
    aria_snapshot: ariaStr,
    page_knowledge: formatKnowledgeForAnalyst(pages),
  })

  try {
    const raw = await callLLM(prompt, 'You are a senior QA automation engineer. Return JSON only.')
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON')

    const result = JSON.parse(match[0]) as {
      action: 'revise' | 'skip' | 'navigate'
      revisedSteps?: ParsedStep[]
      navTarget?: string
      reason: string
    }
    onEvent({ type: 'tc_analyzing', tcId: tc.id, reason: `Analyst decision: ${result.action} — ${result.reason}` })
    return result
  } catch {
    return { action: 'skip', reason: 'Scenario analyst failed to parse response — marking TC as failed' }
  }
}

// ─── Action executor ──────────────────────────────────────────────────────────

async function executeAction(page: Page, parsed: ParsedStep, pages: PageKnowledge[], baseUrl: string, locIndex?: LocatorIndex, onEvent?: (e: AgentEvent) => void): Promise<void> {
  const { action, target, value } = parsed
  const resolvedLocator = parsed.locator && parsed.locator.length > 0 ? parsed.locator : null

  const emitTry = (locator: string, attempt: number, success: boolean) =>
    onEvent?.({ type: 'locator_try', locator, attempt, success })

  if (action === 'fill' || action === 'click') {
    await dismissOverlays(page, onEvent)
    await waitForStable(page)
  }

  switch (action) {
    case 'navigate': {
      const path = target.startsWith('http') ? target : `${baseUrl}${target.startsWith('/') ? '' : '/'}${target}`
      onEvent?.({ type: 'nav', url: path, text: `Navigating to ${path}` })
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20000 })
      await waitForStable(page)
      // Dismiss overlays that appear immediately after page load (cookie banners, popups)
      await dismissOverlays(page, onEvent)
      const afterUrl = page.url()
      if (afterUrl.includes('login') && !path.includes('login') && !path.includes('signin')) {
        throw new Error(`Navigation blocked — redirected to login. Expected: ${path}, got: ${afterUrl}`)
      }
      break
    }

    case 'fill': {
      const fillVal = value || ''

      // 1. LLM-resolved locator — grounded in live ARIA + raw DOM fields (primary)
      if (resolvedLocator) {
        const ok = await tryFill(resolveLocatorString(page, resolvedLocator), fillVal)
        emitTry(resolvedLocator, 1, ok)
        if (ok) break
      }
      // 2. KB byName CSS selector — input[name="..."] is immune to ARIA bugs (reliable fallback)
      const kbByName = locIndex ? indexedLocatorByName(target, locIndex) : findBestLocatorByName(target, pages)
      if (kbByName) {
        const ok = await tryFill(resolveLocatorString(page, kbByName), fillVal)
        emitTry(kbByName, 2, ok)
        if (ok) break
      }
      // 3. KB primary locator (getByLabel/getByRole) — for sites with clean ARIA
      const kbLocatorFill = locIndex ? indexedLocator(target, locIndex) : findBestLocator(target, pages)
      if (kbLocatorFill) {
        const ok = await tryFill(resolveLocatorString(page, kbLocatorFill), fillVal)
        emitTry(kbLocatorFill, 3, ok)
        if (ok) break
      }

      throw new Error(`Could not fill "${target}". LLM locator: ${resolvedLocator || '(none)'}. URL: ${page.url()}`)
    }

    case 'click': {
      const slugDash = target.toLowerCase().replace(/\s+/g, '-')

      const tryWithEmit = async (locStr: string, attempt: number, loc: Locator): Promise<boolean> => {
        const ok = await tryClick(loc)
        emitTry(locStr, attempt, ok)
        return ok
      }

      // 1. LLM-resolved locator — grounded in live ARIA (primary)
      if (resolvedLocator && await tryWithEmit(resolvedLocator, 1, resolveLocatorString(page, resolvedLocator))) break
      // 2. KB locator
      const kbLocatorClick = locIndex ? indexedLocator(target, locIndex) : findBestLocator(target, pages)
      if (kbLocatorClick && await tryWithEmit(kbLocatorClick, 2, resolveLocatorString(page, kbLocatorClick))) break
      // 3. button
      if (await tryWithEmit(`getByRole('button','${target}')`, 3, page.getByRole('button', { name: target, exact: false }))) break
      // 4. link
      if (await tryWithEmit(`getByRole('link','${target}')`, 4, page.getByRole('link', { name: target, exact: false }))) break
      // 5. text match
      if (await tryWithEmit(`getByText('${target}')`, 5, page.getByText(target, { exact: false }))) break
      // 6. menuitem
      if (await tryWithEmit(`getByRole('menuitem','${target}')`, 6, page.getByRole('menuitem', { name: target, exact: false }))) break
      // 7. tab
      if (await tryWithEmit(`getByRole('tab','${target}')`, 7, page.getByRole('tab', { name: target, exact: false }))) break
      // 8. data-testid
      if (await tryWithEmit(`[data-testid*="${slugDash}"]`, 8, page.locator(`[data-testid*="${slugDash}"]`))) break
      // 9. iframe fallback
      const iframeClicked = await findAcrossFrames(
        page,
        (ctx) => (ctx as Page).getByRole('button', { name: target, exact: false }),
        tryClick,
      )
      if (iframeClicked) { emitTry(`iframe:getByRole('button','${target}')`, 9, true); break }

      throw new Error(`Could not click "${target}" — tried 9 strategies. URL: ${page.url()}`)
    }

    case 'assert': {
      const tl = target.toLowerCase()
      if (tl === 'url' || tl.includes('url') || tl.includes('redirect') || tl.includes('page')) {
        const currentUrl = page.url()
        if (value && !currentUrl.includes(value)) {
          throw new Error(`URL assertion failed: expected "${value}" in URL, got "${currentUrl}"`)
        }
      } else if (resolvedLocator) {
        const loc = resolveLocatorString(page, resolvedLocator)
        const visible = await loc.isVisible()
        if (!visible) throw new Error(`Assertion failed: "${target}" is not visible`)
      } else {
        const txt = value || target
        const visible = await page.getByText(txt, { exact: false }).isVisible()
        if (!visible) throw new Error(`Assertion failed: text not visible: "${txt}"`)
      }
      break
    }

    case 'wait': {
      const tl = target.toLowerCase()
      if (tl === 'page_load' || tl === 'url' || tl.includes('url') || tl.includes('redirect') || tl.includes('navigat')) {
        if (value) {
          const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          await page.waitForURL(new RegExp(escaped), { timeout: 15000 })
        } else {
          await waitForStable(page)
        }
      } else if (resolvedLocator) {
        const loc = resolveLocatorString(page, resolvedLocator)
        await loc.waitFor({ timeout: 10000 })
      } else {
        await waitForStable(page)
      }
      break
    }
  }
}

// ─── Saved-script replay (no LLM — uses pre-resolved locators) ───────────────

export async function replaySavedScript(
  title: string,
  savedSteps: ResolvedStepRecord[],
  appConfig: AppConfig,
  onEvent: (e: AgentEvent) => void,
  options: { browser?: string; headed?: boolean } = {},
): Promise<ExecutionResult> {
  const { headed = false, browser: browserType = 'chromium' } = options
  const baseUrl = appConfig.baseUrl.replace(/\/$/, '')
  const pw = browserType === 'firefox' ? firefox : browserType === 'webkit' ? webkit : chromium
  const browser: Browser = await pw.launch({
    headless: !headed,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
  })

  const tcStart = Date.now()
  const tcId = 'saved-script'
  onEvent({ type: 'tc_start', id: tcId, title })

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  let failed = false
  let failError: string | undefined

  try {
    for (let i = 0; i < savedSteps.length; i++) {
      const { original, parsed } = savedSteps[i]
      onEvent({ type: 'step_start', tcId, stepIndex: i, step: original })
      try {
        await executeAction(page, parsed, [], baseUrl, undefined, onEvent)
        onEvent({ type: 'step_done', tcId, stepIndex: i, status: 'passed', locatorUsed: parsed.locator, healingAttempts: 0 })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        onEvent({ type: 'step_done', tcId, stepIndex: i, status: 'failed', error: msg, healingAttempts: 0 })
        failed = true
        failError = `Step ${i + 1} failed: ${msg}`
        break
      }
    }
  } finally {
    await page.close()
    await ctx.close()
    await browser.close()
  }

  const duration = Date.now() - tcStart
  const status = failed ? 'failed' : 'passed'
  onEvent({ type: 'tc_done', id: tcId, status, duration })

  return {
    passed: failed ? 0 : 1,
    failed: failed ? 1 : 0,
    skipped: 0,
    duration,
    testResults: [{ title, status, duration, error: failError, retries: 0 }],
    resolvedSteps: failed ? undefined : savedSteps,
  }
}

// ─── Main agent ───────────────────────────────────────────────────────────────

export async function playwrightMcpAgent(
  testCases: TestCase[],
  appConfig: AppConfig,
  pages: PageKnowledge[],
  onEvent: (e: AgentEvent) => void,
  options: { browser?: string; instructions?: string; headed?: boolean } = {},
): Promise<ExecutionResult> {
  const { headed = false, browser: browserType = 'chromium' } = options
  const baseUrl = appConfig.baseUrl.replace(/\/$/, '')

  const tcResults: ExecutionResult['testResults'] = []
  const allResolvedSteps: ResolvedStepRecord[] = []
  const pw = browserType === 'firefox' ? firefox : browserType === 'webkit' ? webkit : chromium
  const browser: Browser = await pw.launch({
    headless: !headed,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
    ],
  })

  try {
    for (const tc of testCases) {
      const tcStart = Date.now()
      onEvent({ type: 'tc_start', id: tc.id, title: tc.title })

      if (!tc.steps || tc.steps.length === 0) {
        onEvent({ type: 'tc_done', id: tc.id, status: 'passed', duration: 0 })
        tcResults.push({ title: `${tc.id}: ${tc.title}`, status: 'skipped', duration: 0, retries: 0 })
        continue
      }

      const ctx = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 800 },
      })
      const page = await ctx.newPage()

      let tcFailed = false
      let tcError: string | undefined
      const completedSteps: { step: string; status: string }[] = []
      // Cache resolved steps so analyst revisions can override them
      const parsedStepsCache: (ParsedStep | null)[] = new Array(tc.steps.length).fill(null)
      // Build locator index once per TC — avoids O(pages×forms×fields) per-step scans
      const locatorIndex = buildLocatorIndex(pages)

      try {
        for (let i = 0; i < tc.steps.length; i++) {
          const step = tc.steps[i]
          const expected = tc.stepExpected?.[i] ?? ''

          onEvent({ type: 'step_start', tcId: tc.id, stepIndex: i, step })

          // Resolve step:
          // - navigate/assert/wait: regex is deterministic, no LLM needed
          // - fill/click: regex parses action/target/value but ALWAYS calls LLM for a
          //   page-grounded locator (reads live ARIA + raw DOM fields so it picks the
          //   right selector even on sites with broken ARIA like Shopify)
          let parsed: ParsedStep
          if (parsedStepsCache[i]) {
            parsed = parsedStepsCache[i]!
          } else {
            const regexParsed = parseStepRegex(step)
            if (regexParsed && regexParsed.action !== 'fill') {
              // navigate / assert / wait / click: regex + executor's built-in strategies
              // LLM is NOT called — it reliably returns wrong locators for non-fill steps
              parsed = regexParsed
              onEvent({ type: 'agent_thinking', text: `${regexParsed.action} step — using direct strategy (no LLM needed)` })
            } else if (regexParsed?.action === 'fill' || (!regexParsed && /fill|enter|type|input/i.test(step))) {
              // fill: call LLM to get a page-grounded locator from live ARIA + DOM fields
              const llmParsed = await resolveStepWithLLM(page, step, expected, pages, appConfig, onEvent)
              parsed = regexParsed ? { ...regexParsed, locator: llmParsed.locator || regexParsed.locator } : llmParsed
            } else {
              // Unknown step shape — try LLM to interpret it
              const llmParsed = await resolveStepWithLLM(page, step, expected, pages, appConfig, onEvent)
              parsed = llmParsed
            }
            parsedStepsCache[i] = parsed
          }

          let stepError: Error | null = null
          let healingAttempts = 0
          let usedLocator = parsed.locator || indexedLocator(parsed.target, locatorIndex) || undefined

          // Up to 3 attempts: primary + 2 LLM heals
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await executeAction(page, parsed, pages, baseUrl, locatorIndex, onEvent)
              stepError = null
              break
            } catch (err) {
              stepError = err instanceof Error ? err : new Error(String(err))
              if (attempt < 2) {
                const healed = await healStep(
                  page, step, parsed, stepError, pages, onEvent,
                  tc.id, i, attempt + 1, usedLocator,
                )
                if (healed) {
                  parsed = { ...parsed, locator: healed }
                  parsedStepsCache[i] = parsed
                  usedLocator = healed
                  healingAttempts++
                }
              }
            }
          }

          // Check expected result after successful action
          if (!stepError && expected) {
            try {
              await assertExpectedResult(page, expected)
            } catch (assertErr) {
              stepError = assertErr instanceof Error ? assertErr : new Error(String(assertErr))
            }
          }

          if (stepError) {
            // Scenario analyst as last resort
            const recovery = await analyzeStuckScenario(page, tc, i, completedSteps, tc.steps.slice(i + 1), pages, onEvent)

            if (recovery.action === 'navigate' && recovery.navTarget) {
              try {
                await page.goto(`${baseUrl}${recovery.navTarget}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
                await waitForStable(page)
                await executeAction(page, parsed, pages, baseUrl, locatorIndex, onEvent)
                stepError = null
                onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'passed', locatorUsed: usedLocator, healingAttempts })
                completedSteps.push({ step, status: 'passed' })
                allResolvedSteps.push({ original: step, parsed })
                continue
              } catch (retryErr) {
                stepError = retryErr instanceof Error ? retryErr : new Error(String(retryErr))
              }
            } else if (recovery.action === 'revise' && recovery.revisedSteps && recovery.revisedSteps.length > 0) {
              const revised = recovery.revisedSteps[0]
              parsedStepsCache[i] = revised
              try {
                await executeAction(page, revised, pages, baseUrl, locatorIndex, onEvent)
                stepError = null
                onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'passed', locatorUsed: revised.locator || undefined, healingAttempts })
                completedSteps.push({ step, status: 'passed' })
                allResolvedSteps.push({ original: step, parsed: revised })
                continue
              } catch (retryErr) {
                stepError = retryErr instanceof Error ? retryErr : new Error(String(retryErr))
              }
            }

            const reason = recovery.reason || stepError.message
            onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'failed', locatorUsed: usedLocator, error: reason, healingAttempts })
            completedSteps.push({ step, status: 'failed' })
            tcFailed = true
            tcError = `Step ${i + 1} failed: ${reason}`
            break
          } else {
            onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'passed', locatorUsed: usedLocator, healingAttempts })
            completedSteps.push({ step, status: 'passed' })
            allResolvedSteps.push({ original: step, parsed })
          }
        }
      } catch (err) {
        tcFailed = true
        tcError = String(err)
      } finally {
        await page.close()
        await ctx.close()
      }

      const tcDuration = Date.now() - tcStart
      const tcStatus = tcFailed ? 'failed' : 'passed'
      onEvent({ type: 'tc_done', id: tc.id, status: tcStatus, duration: tcDuration })

      tcResults.push({
        title: `${tc.id}: ${tc.title}`,
        status: tcStatus,
        duration: tcDuration,
        error: tcError,
        retries: 0,
      })
    }
  } finally {
    await browser.close()
  }

  const passed = tcResults.filter((t) => t.status === 'passed').length
  const failed = tcResults.filter((t) => t.status === 'failed').length
  const skipped = tcResults.filter((t) => t.status === 'skipped').length
  const totalDuration = tcResults.reduce((sum, t) => sum + t.duration, 0)

  return { passed, failed, skipped, duration: totalDuration, testResults: tcResults, resolvedSteps: allResolvedSteps }
}
