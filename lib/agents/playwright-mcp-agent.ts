import { chromium, firefox, webkit, Browser, Page, Locator, FrameLocator } from 'playwright'
import { AppConfig, formatCredentialsForLLM } from '@/lib/config/store'
import { TestCase } from '@/lib/agents/testcase-agent'
import { callLLM } from '@/lib/ai/gemini'
import { fillPrompt, loadGlobalInstructions } from '@/lib/prompts/loader'

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

// ─── Error classification ─────────────────────────────────────────────────────

export type ErrorClass =
  | 'not_found'        // 0 elements matched
  | 'strict_mode'      // >1 elements matched — locator too broad
  | 'not_visible'      // element exists but hidden / off-screen
  | 'not_interactable' // element exists, visible, but disabled / covered
  | 'nav_blocked'      // navigation redirected unexpectedly
  | 'timeout'          // page/element didn't settle in time
  | 'other'

export function classifyError(err: Error): { cls: ErrorClass; matchCount?: number } {
  const msg = err.message.toLowerCase()

  // "strict mode violation: locator('...') resolved to 3 elements"
  const strictMatch = err.message.match(/resolved to (\d+) elements/)
  if (strictMatch || msg.includes('strict mode')) {
    return { cls: 'strict_mode', matchCount: strictMatch ? parseInt(strictMatch[1]) : undefined }
  }

  if (msg.includes('not visible') || msg.includes('hidden') || msg.includes('display: none') || msg.includes('visibility: hidden')) {
    return { cls: 'not_visible' }
  }

  if (msg.includes('not enabled') || msg.includes('disabled') || msg.includes('not interactable') || msg.includes('pointer-events: none')) {
    return { cls: 'not_interactable' }
  }

  if (msg.includes('redirected to login') || msg.includes('nav_blocked')) {
    return { cls: 'nav_blocked' }
  }

  // Navigation timeout — page didn't load in time
  if (msg.includes('timeout') && (msg.includes('navigation') || msg.includes('goto') || msg.includes('exceeded') && !msg.includes('locator'))) {
    return { cls: 'timeout' }
  }

  // Timeout usually means 0 elements — they never appeared
  if (msg.includes('timeout') && (msg.includes('waiting for') || msg.includes('locator'))) {
    return { cls: 'not_found' }
  }

  if (msg.includes('no elements') || msg.includes('0 elements') || msg.includes('could not find') || msg.includes('could not fill') || msg.includes('could not click')) {
    return { cls: 'not_found' }
  }

  return { cls: 'other' }
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

// ─── Element context extractor ────────────────────────────────────────────────
// Extracts parent element context so healer can generate scoped locators.
// Used when element is not uniquely identifiable (strict mode / ambiguous).

async function extractElementContext(page: Page, targetText: string): Promise<string> {
  try {
    const ctx = await page.evaluate((target) => {
      const trim = (s: string | null | undefined) => s?.trim().slice(0, 80) || ''
      const results: string[] = []

      // Find all elements whose text includes the target
      const all = Array.from(document.querySelectorAll('a, button, input, [role="button"]'))
      const matches = all.filter(el => {
        const text = trim((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label'))
        return text.toLowerCase().includes(target.toLowerCase())
      })

      for (const el of matches.slice(0, 5)) {
        const tag = el.tagName.toLowerCase()
        const cls = Array.from(el.classList).slice(0, 3).join('.')
        const id = el.id ? `#${el.id}` : ''
        const ariaLabel = el.getAttribute('aria-label') || ''
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-cy') || ''
        const href = (el as HTMLAnchorElement).href || ''
        const onclick = el.hasAttribute('onclick') ? 'onclick' : ''

        // Walk up to find a meaningful parent (section, article, li, [class*="product"], etc.)
        let parent = el.parentElement
        const parentInfo: string[] = []
        for (let depth = 0; depth < 5 && parent; depth++, parent = parent.parentElement) {
          const pTag = parent.tagName.toLowerCase()
          const pCls = Array.from(parent.classList).slice(0, 2).join('.')
          const pId = parent.id ? `#${parent.id}` : ''
          // Stop at meaningful semantic containers
          if (['section', 'article', 'li', 'form', 'nav', 'header', 'main', 'aside'].includes(pTag) || pId || pCls) {
            parentInfo.push(`${pTag}${pId || '.' + pCls || ''}`)
            if (parentInfo.length >= 2) break
          }
        }

        const self = `<${tag}${id ? ' id="' + id.slice(1) + '"' : ''}${cls ? ' class="' + cls + '"' : ''}${ariaLabel ? ' aria-label="' + ariaLabel + '"' : ''}${testId ? ' data-testid="' + testId + '"' : ''}${onclick ? ' ' + onclick : ''}${href ? ' href="...' + href.slice(-20) + '"' : ''}>`
        results.push(`${parentInfo.join(' > ')} > ${self}`)
      }

      return results.join('\n') || '(context unavailable)'
    }, targetText)

    return `Matching DOM elements for "${targetText}":\n${ctx}`
  } catch {
    return '(context unavailable)'
  }
}

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

// ─── Element map ─────────────────────────────────────────────────────────────
// Pre-computes best Playwright locator for every interactive element on the page.
// Used by TC generation to embed locators at write-time, not resolve-time.

export interface ElementDef {
  type: 'input' | 'button' | 'link' | 'select'
  label: string
  locator: string   // valid Playwright locator string
  path?: string     // for links: href path
}

export async function extractElementMap(page: Page): Promise<ElementDef[]> {
  try {
    const raw = await page.evaluate((): Array<{
      type: string; label: string; name: string; id: string;
      inputType: string; placeholder: string; href: string;
      dataTestId: string; ariaLabel: string; text: string
    }> => {
      const results: Array<{
        type: string; label: string; name: string; id: string;
        inputType: string; placeholder: string; href: string;
        dataTestId: string; ariaLabel: string; text: string
      }> = []
      const trim = (s: string | null | undefined) => s?.trim().replace(/\s+/g, ' ') || ''

      // Inputs / textareas / selects
      document.querySelectorAll<HTMLInputElement>(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
      ).forEach(el => {
        const labelEl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null
        results.push({
          type: el.tagName === 'SELECT' ? 'select' : 'input',
          label: trim(labelEl?.textContent) || trim(el.getAttribute('aria-label')) || '',
          name: el.name || '', id: el.id || '',
          inputType: (el as HTMLInputElement).type || 'text',
          placeholder: trim((el as HTMLInputElement).placeholder),
          href: '', dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-cy') || '',
          ariaLabel: trim(el.getAttribute('aria-label')), text: '',
        })
      })

      // Buttons
      document.querySelectorAll<HTMLElement>(
        'button, [role="button"], input[type="submit"], input[type="button"]'
      ).forEach(el => {
        const text = trim((el as HTMLInputElement).value || el.innerText || el.getAttribute('aria-label'))
        if (!text || text.length > 100) return
        results.push({
          type: 'button', label: text, name: '', id: el.id || '',
          inputType: '', placeholder: '', href: '',
          dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-cy') || '',
          ariaLabel: trim(el.getAttribute('aria-label')), text,
        })
      })

      // Links
      document.querySelectorAll<HTMLAnchorElement>('a[href], a[onclick]').forEach(el => {
        const text = trim(el.innerText || el.getAttribute('aria-label'))
        if (!text || text.length > 80) return
        const href = el.getAttribute('href') || ''
        if (/^#|javascript:/i.test(href) && !text) return
        results.push({
          type: 'link', label: text, name: '', id: el.id || '',
          inputType: '', placeholder: '', href,
          dataTestId: el.getAttribute('data-testid') || '',
          ariaLabel: trim(el.getAttribute('aria-label')), text,
        })
      })

      return results
    })

    return raw
      .filter(el => el.label)
      .map(el => {
        let locator: string
        if (el.type === 'input' || el.type === 'select') {
          if (el.dataTestId)       locator = `[data-testid="${el.dataTestId}"]`
          else if (el.inputType === 'password') locator = 'input[type="password"]'
          else if (el.name)        locator = `${el.type === 'select' ? 'select' : 'input'}[name="${el.name}"]`
          else if (el.id)          locator = `#${el.id}`
          else                     locator = el.label ? `getByLabel:${el.label}` : `getByPlaceholder:${el.placeholder}`
        } else if (el.type === 'button') {
          if (el.dataTestId)       locator = `[data-testid="${el.dataTestId}"]`
          else if (el.id)          locator = `#${el.id}`
          else                     locator = `getByRole:button:${el.label}`
        } else {
          if (el.dataTestId)       locator = `[data-testid="${el.dataTestId}"]`
          else if (el.href && !/^javascript:/i.test(el.href)) locator = `getByRole:link:${el.label}`
          else                     locator = `getByText:${el.label}`
        }
        return {
          type: el.type as ElementDef['type'],
          label: el.label,
          locator,
          path: el.href || undefined,
        }
      })
      .slice(0, 200)
  } catch {
    return []
  }
}

// ─── DOM field extraction ─────────────────────────────────────────────────────
// Extracts raw input metadata directly from DOM — bypasses ARIA bugs like
// Shopify's pattern where <div id="X"> shadows <input id="X">.

export async function extractDomFields(page: Page): Promise<{ fields: string; interactive: string }> {
  try {
    const result = await page.evaluate(() => {
      // Form fields
      const fields = Array.from(
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

      // Interactive elements: buttons + CTA links
      const trim = (s: string | null | undefined) => s?.trim().replace(/\s+/g, ' ') || ''
      const buttons = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, [role="button"], input[type="submit"], input[type="button"]'
        )
      ).slice(0, 60).map(el => {
        const text = trim((el as HTMLInputElement).value || el.innerText || el.getAttribute('aria-label'))
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-cy') || ''
        const elId = el.id || ''
        const cssClass = Array.from(el.classList).filter(c => !/^(fa|icon|glyphicon|d-|m-|p-)/.test(c)).slice(0, 2).join('.')
        return { kind: 'button' as const, text, testId, id: elId, cssClass }
      }).filter(b => b.text)

      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href], a[onclick], a[href="javascript:void(0)"]')
      ).slice(0, 80).map(el => {
        const text = trim(el.innerText || el.getAttribute('aria-label'))
        const href = el.getAttribute('href') || ''
        const cssClass = Array.from(el.classList).filter(c => !/^(fa|icon|nav|d-|m-)/.test(c)).slice(0, 2).join('.')
        const testId = el.getAttribute('data-testid') || ''
        const elId = el.id || ''
        return { kind: 'link' as const, text, href, cssClass, testId, id: elId }
      }).filter(l => l.text)

      return { fields, buttons, links }
    })

    const fieldsStr = result.fields.length === 0
      ? '(no form fields found)'
      : result.fields.map(f =>
          `  label="${f.label}" name="${f.name}" id="${f.id}" type="${f.type}" placeholder="${f.placeholder}"`
        ).join('\n')

    const interactiveStr = [
      ...result.buttons.map(b =>
        `  [button] text="${b.text}"${b.testId ? ` data-testid="${b.testId}"` : ''}${b.id ? ` id="${b.id}"` : ''}${b.cssClass ? ` class="${b.cssClass}"` : ''}`
      ),
      ...result.links.map(l =>
        `  [link] text="${l.text}" href="${l.href}"${l.cssClass ? ` class="${l.cssClass}"` : ''}${l.testId ? ` data-testid="${l.testId}"` : ''}${l.id ? ` id="${l.id}"` : ''}`
      ),
    ].join('\n') || '(no interactive elements found)'

    return { fields: fieldsStr, interactive: interactiveStr }
  } catch {
    return { fields: '(could not extract DOM fields)', interactive: '(could not extract interactive elements)' }
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

// ─── Instruction merging ──────────────────────────────────────────────────────

function mergeInstructions(appConfig: AppConfig): string {
  const global = loadGlobalInstructions()
  const perApp = appConfig.automationInstructions?.trim()
  return perApp ? `${global}\n\n## App-Specific Overrides\n${perApp}` : global
}

// ─── Proactive LLM step resolver ─────────────────────────────────────────────

async function resolveStepWithLLM(
  page: Page,
  step: string,
  expected: string,
  appConfig: AppConfig,
  onEvent?: (e: AgentEvent) => void,
): Promise<ParsedStep> {
  await waitForStable(page)
  const [ariaSnap, { fields: domFieldsRaw, interactive: domInteractive }] = await Promise.all([getAriaSnapshot(page), extractDomFields(page)])

  // Strip [inferred] tag before passing step to resolver — it's a TC annotation, not part of the action
  const cleanStep = step.replace(/\s*\[inferred\]/gi, '').trim()

  const fieldCount = (domFieldsRaw.match(/label=/g) || []).length
  onEvent?.({ type: 'dom_inspect', url: page.url(), fieldCount, text: `${fieldCount} field(s) found on ${page.url()}` })
  onEvent?.({ type: 'agent_thinking', text: `Resolving locator for: ${cleanStep}` })

  const instructions = mergeInstructions(appConfig)
  const prompt = fillPrompt('step-resolver', {
    current_url: page.url(),
    aria_snapshot: ariaSnap,
    dom_fields: domFieldsRaw,
    dom_interactive: domInteractive,
    knowledge_base: '(no KB — live DOM is the source of truth)',
    app_credentials: formatCredentialsForLLM(appConfig),
    step: cleanStep,
    expected: expected || '(not specified)',
    custom_instructions: instructions,
  })

  // ── Field-matching: pure DOM reasoning, no ARIA noise ──────────────────────
  // Parse all fields from DOM extraction into structured list
  const domFieldLines = domFieldsRaw.split('\n').filter(l => l.includes('name='))
  const domFields = domFieldLines.map(l => {
    const get = (attr: string) => l.match(new RegExp(`${attr}="([^"]*)"`)) ?.[1] ?? ''
    return { label: get('label'), name: get('name'), id: get('id'), type: get('type'), placeholder: get('placeholder') }
  })

  // Extract target field name from step ("Fill 'First Name' with 'John'" → "First Name")
  const targetMatch = cleanStep.match(/['"]([^'"]+)['"]/i)
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
    const valueMatch = cleanStep.match(/with\s+['"]([^'"]+)['"]/i)
    onEvent?.({ type: 'llm_response', action: 'fill', locator, rationale: `matched "${targetLabel}" → ${locator}` })
    return { action: 'fill', target: targetLabel, value: valueMatch?.[1] ?? '', locator }
  }

  // type="password" shortcut
  if (/password/i.test(targetLabel)) {
    const pwField = domFields.find(f => f.type === 'password')
    if (pwField) {
      const locator = pwField.name ? `page.locator('input[name="${pwField.name}"]')` : `page.locator('input[type="password"]')`
      const valueMatch = cleanStep.match(/with\s+['"]([^'"]+)['"]/i)
      onEvent?.({ type: 'llm_response', action: 'fill', locator, rationale: `password type → ${locator}` })
      return { action: 'fill', target: 'password', value: valueMatch?.[1] ?? '', locator }
    }
  }

  // ── Click fast path: scan domInteractive for the target text ─────────────────
  const isClickStep = /^(?:click|press|tap|submit)/i.test(cleanStep) || /\bclick\b/i.test(cleanStep)
  if (isClickStep) {
    const clickTarget = cleanStep.match(/['"]([^'"]+)['"]/i)?.[1] ?? targetLabel
    const interactiveLines = domInteractive.split('\n').filter(l => l.trim())
    const matched = interactiveLines.find(l => {
      const lineText = l.toLowerCase()
      return clickTarget.toLowerCase().split(/\s+/).every(w => lineText.includes(w))
    })
    if (matched) {
      const testIdMatch = matched.match(/data-testid="([^"]+)"/)
      const idMatch = matched.match(/\bid="([^"]+)"/)
      const textMatch = matched.match(/text="([^"]+)"/)
      const isLink = matched.includes('[link]')
      let locator: string
      if (testIdMatch) locator = `page.locator('[data-testid="${testIdMatch[1]}"]')`
      else if (idMatch) locator = `page.locator('#${idMatch[1]}')`
      else if (textMatch && isLink) locator = `page.getByRole('link', { name: '${textMatch[1]}' })`
      else if (textMatch) locator = `page.getByRole('button', { name: '${textMatch[1]}' })`
      else locator = `page.getByText('${clickTarget}')`
      onEvent?.({ type: 'llm_response', action: 'click', locator, rationale: `DOM interactive match: "${clickTarget}" → ${locator}` })
      return { action: 'click', target: clickTarget, locator }
    }
  }

  // LLM fallback: only when direct DOM match fails — pass minimal focused prompt
  const fieldList = domFields.map((f, i) =>
    `${i + 1}. label="${f.label}" name="${f.name}" id="${f.id}" type="${f.type}" placeholder="${f.placeholder}"`
  ).join('\n')

  const focusedPrompt = `You are a Playwright locator expert. A form on ${page.url()} has these input fields:\n${fieldList}\n\nTest step: "${cleanStep}"\n\nWhich field index matches the target? Return JSON only:\n{"index": <1-based number>, "locator": "<playwright locator expression>", "value": "<value to type>"}`

  try {
    const raw = await callLLM(focusedPrompt, `You are a senior QA automation engineer.\n${instructions}\nReturn a single JSON object only. No markdown. No explanation.`)
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
    const raw = await callLLM(prompt, `You are a senior QA automation engineer.\n${instructions}\nReturn a single JSON object only. No markdown.`)
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
  appConfig: AppConfig,
  onEvent: (e: AgentEvent) => void,
  tcId: string,
  stepIndex: number,
  attempt: number,
  triedLocators: string[] = [],
): Promise<string | null> {
  const { cls: errorClass, matchCount } = classifyError(error)
  onEvent({ type: 'step_heal', tcId, stepIndex, attempt, rationale: `Analyzing (error: ${errorClass})…` })

  try {
    const [ariaStr, elementContext] = await Promise.all([
      getAriaSnapshot(page),
      // Extract DOM context for the target element — essential for strict mode and not_found
      (errorClass === 'strict_mode' || errorClass === 'not_found')
        ? extractElementContext(page, parsedStep.target)
        : Promise.resolve(''),
    ])

    const instructions = mergeInstructions(appConfig)

    const triedStr = triedLocators.length > 0
      ? triedLocators.map((l, i) => `${i + 1}. ${l}`).join('\n')
      : '(none)'

    // Build error-class-specific advice for the LLM
    const errorAdvice = buildErrorAdvice(errorClass, matchCount, parsedStep.target)

    const prompt = fillPrompt('step-healer', {
      step,
      action_json: JSON.stringify(parsedStep),
      error: error.message.slice(0, 300),
      error_class: errorAdvice,
      current_url: page.url(),
      aria_snapshot: ariaStr,
      element_context: elementContext || '(not extracted)',
      known_locators: '(live DOM is primary — no KB locators)',
      previously_tried: triedStr,
      custom_instructions: instructions,
    })

    const raw = await callLLM(
      prompt,
      `You are a senior QA automation engineer and Playwright expert. Think like a human: classify the failure, look at context, generate the most specific locator that will uniquely match the target.\n${instructions}\nReturn JSON only.`
    )
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null

    const result = JSON.parse(match[0]) as { locator: string; rationale: string }

    if (triedLocators.includes(result.locator)) {
      onEvent({ type: 'step_heal', tcId, stepIndex, attempt, rationale: `LLM repeated already-tried locator "${result.locator}" — discarded` })
      return null
    }

    try {
      const resolved = resolveLocatorString(page, result.locator)
      const count = await resolved.count()

      if (count === 0) {
        triedLocators.push(result.locator)
        onEvent({ type: 'step_heal', tcId, stepIndex, attempt, rationale: `"${result.locator}" → 0 elements — discarded` })
        return null
      }

      // Strict mode: locator matches multiple elements — try auto-scoping with .first() as last resort
      if (count > 1) {
        const firstLocator = result.locator.replace(/\)$/, ').first()')
        onEvent({ type: 'step_heal', tcId, stepIndex, attempt, rationale: `"${result.locator}" → ${count} elements — auto-scoping to .first()` })
        triedLocators.push(result.locator)
        return firstLocator
      }
    } catch {
      triedLocators.push(result.locator)
      return null
    }

    onEvent({ type: 'step_heal', tcId, stepIndex, attempt, rationale: result.rationale })
    return result.locator
  } catch {
    return null
  }
}

function buildErrorAdvice(cls: ErrorClass, matchCount: number | undefined, target: string): string {
  switch (cls) {
    case 'strict_mode':
      return `STRICT MODE — locator matched ${matchCount ?? 'multiple'} elements for "${target}". The locator is too broad. You MUST scope it:\n` +
        `  Option A: Use a CSS ancestor → page.locator('.product-details a.cart') or page.locator('li:has-text("${target}") button')\n` +
        `  Option B: Use has-text on ancestor → page.locator('section:has-text("unique heading")').getByRole('button',{name:'${target}'})\n` +
        `  Option C: Add .nth(0) only if ordering is deterministic — page.getByRole('link',{name:'${target}'}).nth(0)`

    case 'not_found':
      return `NOT FOUND — 0 elements matched for "${target}". Try a fundamentally different locator type:\n` +
        `  - If element is a link acting as button: page.locator('a:has-text("${target}")') or page.locator('a.classname')\n` +
        `  - If element has data-testid: page.locator('[data-testid*="${target.toLowerCase().replace(/\s+/g, '-')}"]')\n` +
        `  - If element has aria-label: page.locator('[aria-label*="${target}"]')\n` +
        `  - Check element_context below — the DOM parent and CSS class reveal the right selector`

    case 'not_visible':
      return `NOT VISIBLE — element exists but is hidden or off-screen for "${target}".\n` +
        `  - The element may be in a collapsed accordion/tab — check if a parent needs clicking first\n` +
        `  - Return the SAME locator but action should scroll: the executor will scrollIntoViewIfNeeded\n` +
        `  - If behind an overlay/modal, the overlay must be dismissed first\n` +
        `  - If inside a dropdown: the dropdown trigger must be clicked first`

    case 'not_interactable':
      return `NOT INTERACTABLE — element is visible but disabled/covered for "${target}".\n` +
        `  - Element may be disabled — check if a prerequisite step is missing\n` +
        `  - Element may be covered by an overlay — look for z-index elements in ARIA\n` +
        `  - Try force-clicking: add "force":true to the action\n` +
        `  - Look for a sibling/nearby element that is the actual interactive target`

    case 'timeout':
      return `TIMEOUT — page may still be loading or element appears after user action.\n` +
        `  - Return action:"wait" with target:"networkidle" if page is loading\n` +
        `  - Or return the correct locator — executor will retry with longer timeout`

    default:
      return `UNKNOWN ERROR — analyze the error message and ARIA snapshot to determine the right fix.`
  }
}

// ─── Scenario analyst ─────────────────────────────────────────────────────────

async function analyzeStuckScenario(
  page: Page,
  tc: TestCase,
  stepIndex: number,
  completedSteps: { step: string; status: string }[],
  remainingSteps: string[],
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
    page_knowledge: '(live DOM only — no KB)',
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

async function executeAction(page: Page, parsed: ParsedStep, baseUrl: string, onEvent?: (e: AgentEvent) => void): Promise<void> {
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
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45000 })
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
      // 2. button
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

      throw new Error(`Could not click "${target}" — tried all strategies. URL: ${page.url()}`)
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
        await executeAction(page, parsed, baseUrl, onEvent)
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

          // Use pre-verified structured step if available
          const ss = tc.structuredSteps?.[i]
          if (ss?.locator && ss.verified) {
            const rawLoc = ss.locator.replace(/^page\.locator\((['"])(.*)\1\)$/, '$2')
              .replace(/^page\./, '')
            parsed = { action: ss.action as ParsedStep['action'], target: ss.target, value: ss.value, locator: ss.locator }
            parsedStepsCache[i] = parsed
            onEvent({ type: 'agent_thinking', text: `Pre-verified locator: ${ss.locator}` })
          } else if (parsedStepsCache[i]) {
            parsed = parsedStepsCache[i]!
          } else {
            const regexParsed = parseStepRegex(step)
            // Use LLM for: fill steps, unknown steps, click steps with [inferred] tag
            const needsLLM = !regexParsed
              || regexParsed.action === 'fill'
              || (regexParsed.action === 'click' && /\[inferred\]/i.test(step))

            if (!needsLLM) {
              // navigate / assert / wait / plain click: regex + executor's built-in strategies
              parsed = regexParsed!
              onEvent({ type: 'agent_thinking', text: `${regexParsed!.action} step — using direct strategy` })
            } else if (regexParsed?.action === 'fill' || (!regexParsed && /fill|enter|type|input/i.test(step))) {
              // fill: LLM for page-grounded locator
              const llmParsed = await resolveStepWithLLM(page, step, expected, appConfig, onEvent)
              parsed = regexParsed ? { ...regexParsed, locator: llmParsed.locator || regexParsed.locator } : llmParsed
            } else {
              // click [inferred] or unknown: LLM resolves against live DOM
              const llmParsed = await resolveStepWithLLM(page, step, expected, appConfig, onEvent)
              parsed = regexParsed ? { ...regexParsed, locator: llmParsed.locator || regexParsed.locator } : llmParsed
            }
            parsedStepsCache[i] = parsed
          }

          let stepError: Error | null = null
          let healingAttempts = 0
          let usedLocator = parsed.locator || undefined
          // Track ALL tried/discarded locators so healer doesn't repeat them
          const triedLocators: string[] = usedLocator ? [usedLocator] : []

          // Up to 3 attempts: primary + 2 LLM heals
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await executeAction(page, parsed, baseUrl, onEvent)
              stepError = null
              break
            } catch (err) {
              stepError = err instanceof Error ? err : new Error(String(err))
              if (attempt < 2) {
                const healed = await healStep(
                  page, step, parsed, stepError, appConfig, onEvent,
                  tc.id, i, attempt + 1, triedLocators,
                )
                if (healed) {
                  parsed = { ...parsed, locator: healed }
                  parsedStepsCache[i] = parsed
                  usedLocator = healed
                  triedLocators.push(healed)
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
            const recovery = await analyzeStuckScenario(page, tc, i, completedSteps, tc.steps.slice(i + 1), onEvent)

            if (recovery.action === 'navigate' && recovery.navTarget) {
              try {
                await page.goto(`${baseUrl}${recovery.navTarget}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
                await waitForStable(page)
                await executeAction(page, parsed, baseUrl, onEvent)
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
                await executeAction(page, revised, baseUrl, onEvent)
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
