import { chromium, Browser, Page, Locator } from 'playwright'
import { AppConfig } from '@/lib/config/store'
import { PageKnowledge } from '@/lib/db/models/AppKnowledge'
import { TestCase } from '@/lib/agents/testcase-agent'
import { callLLM } from '@/lib/ai/gemini'
import { fillPrompt } from '@/lib/prompts/loader'
import { formatPagesForParsing, formatLocatorsForCurrentPage, formatKnowledgeForAnalyst } from '@/lib/knowledge/formatter'

// ─── Shared event types (imported by route and UI) ────────────────────────────

export interface AgentEvent {
  type: 'tc_start' | 'step_start' | 'step_heal' | 'step_done' | 'tc_done' | 'tc_analyzing' | 'log'
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
}

interface ParsedStep {
  action: 'navigate' | 'click' | 'fill' | 'assert' | 'wait'
  target: string
  value?: string
}

// ─── Locator resolution ───────────────────────────────────────────────────────

function resolveLocatorString(page: Page, locatorStr: string): Locator {
  let m: RegExpMatchArray | null

  // getByLabel — match quoted content (handles escaped quotes inside via .+? non-greedy)
  m = locatorStr.match(/getByLabel\(['"](.+?)['"]\s*(?:,\s*\{[^}]*\})?\)/)
  if (m) return page.getByLabel(m[1], { exact: false })

  // getByPlaceholder
  m = locatorStr.match(/getByPlaceholder\(['"](.+?)['"]\s*(?:,\s*\{[^}]*\})?\)/)
  if (m) return page.getByPlaceholder(m[1], { exact: false })

  // getByRole with name option — must come before bare getByRole
  m = locatorStr.match(/getByRole\(['"](\w+)['"]\s*,\s*\{[^}]*name:\s*['"](.+?)['"]\s*[^}]*\}/)
  if (m) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return page.getByRole(m[1] as any, { name: m[2], exact: false })
  }

  // getByRole bare (no name)
  m = locatorStr.match(/getByRole\(['"](\w+)['"]\s*\)/)
  if (m) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return page.getByRole(m[1] as any)
  }

  // getByText
  m = locatorStr.match(/getByText\(['"](.+?)['"]\s*(?:,\s*\{[^}]*\})?\)/)
  if (m) return page.getByText(m[1], { exact: false })

  // page.locator('selector') — handles input[name="..."], [aria-label="..."], CSS
  m = locatorStr.match(/locator\(['"](.+?)['"]\)/)
  if (m) return page.locator(m[1])

  // Last resort — treat entire string as a CSS selector
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

// ─── Step parsing ─────────────────────────────────────────────────────────────

async function parseSteps(steps: string[], pages: PageKnowledge[], appConfig: AppConfig): Promise<ParsedStep[]> {
  const prompt = fillPrompt('step-parser', {
    app_name: appConfig.name,
    base_url: appConfig.baseUrl,
    pages_list: formatPagesForParsing(pages),
    numbered_steps: steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    step_count: String(steps.length),
  })

  try {
    const raw = await callLLM(prompt, 'You are a test automation expert. Return valid JSON arrays only. No markdown.')
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('No JSON array')
    const parsed = JSON.parse(match[0]) as ParsedStep[]
    if (parsed.length === steps.length) return parsed
    while (parsed.length < steps.length) parsed.push({ action: 'click', target: steps[parsed.length] })
    return parsed.slice(0, steps.length)
  } catch {
    // Regex-based fallback
    return steps.map((step): ParsedStep => {
      const lower = step.toLowerCase()
      if (/navigat|go to|open|visit/.test(lower)) {
        const pathMatch = step.match(/\/[a-z/\-_]+/)
        return { action: 'navigate', target: pathMatch?.[0] || '/' }
      }
      if (/fill|enter|type|input/.test(lower)) {
        const valueMatch = step.match(/['"]([^'"]+)['"]/) || step.match(/:\s+(.+)$/)
        return { action: 'fill', target: step, value: valueMatch?.[1] || '' }
      }
      if (/click|press|submit|tap/.test(lower)) return { action: 'click', target: step }
      if (/verify|assert|check|should|expect/.test(lower)) return { action: 'assert', target: 'url', value: '' }
      if (/wait|until/.test(lower)) return { action: 'wait', target: 'url', value: '' }
      return { action: 'click', target: step }
    })
  }
}

// ─── Self-healing ─────────────────────────────────────────────────────────────

async function getAriaSnapshot(page: Page): Promise<string> {
  // Scroll down then back to top to trigger lazy-loaded content before snapshot
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(300)
    await page.evaluate(() => window.scrollTo(0, 0))
  } catch { /* ignore */ }

  try {
    // Prefer main content area to avoid nav/footer noise
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

    // Verify the healed locator actually finds an element before committing to it
    try {
      const resolved = resolveLocatorString(page, result.locator)
      const count = await resolved.count()
      if (count === 0) {
        onEvent({ type: 'step_heal', tcId, stepIndex, attempt, rationale: `LLM suggested "${result.locator}" but 0 elements found — discarded` })
        return null
      }
    } catch {
      // resolveLocatorString or count threw — discard the locator, don't waste an attempt
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

async function tryFill(loc: Locator, val: string, timeout = 7000): Promise<boolean> {
  try {
    await loc.first().waitFor({ state: 'visible', timeout })
    await loc.first().fill(val, { timeout })
    return true
  } catch { return false }
}

async function tryClick(loc: Locator, timeout = 7000): Promise<boolean> {
  try {
    await loc.first().waitFor({ state: 'visible', timeout })
    await loc.first().click({ timeout })
    return true
  } catch { return false }
}

async function executeAction(page: Page, parsed: ParsedStep, resolvedLocator: string | null, baseUrl: string): Promise<void> {
  const { action, target, value } = parsed

  switch (action) {
    case 'navigate': {
      const path = target.startsWith('http') ? target : `${baseUrl}${target.startsWith('/') ? '' : '/'}${target}`
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20000 })
      const afterUrl = page.url()
      // Detect silent redirect to login (auth wall blocked navigation)
      if (afterUrl.includes('login') && !path.includes('login') && !path.includes('signin')) {
        throw new Error(`Navigation blocked — redirected to login page. Expected: ${path}, got: ${afterUrl}`)
      }
      break
    }

    case 'fill': {
      const fillVal = value || ''
      // 1. Specific RAG or healed locator (most accurate)
      if (resolvedLocator && await tryFill(resolveLocatorString(page, resolvedLocator), fillVal)) break
      // 2. Semantic fallbacks — work on most well-built apps
      if (await tryFill(page.getByLabel(target, { exact: false }), fillVal)) break
      if (await tryFill(page.getByPlaceholder(target, { exact: false }), fillVal)) break
      if (await tryFill(page.getByRole('textbox', { name: target, exact: false }), fillVal)) break
      throw new Error(`Could not fill "${target}" — tried specific locator, getByLabel, getByPlaceholder, getByRole(textbox) (current URL: ${page.url()})`)
    }

    case 'click': {
      // 1. Specific RAG or healed locator
      if (resolvedLocator && await tryClick(resolveLocatorString(page, resolvedLocator))) break
      // 2. Semantic fallbacks
      if (await tryClick(page.getByRole('button', { name: target, exact: false }))) break
      if (await tryClick(page.getByRole('link', { name: target, exact: false }))) break
      if (await tryClick(page.getByText(target, { exact: false }))) break
      if (await tryClick(page.getByRole('menuitem', { name: target, exact: false }))) break
      throw new Error(`Could not click "${target}" — tried specific locator, button/link/text/menuitem (current URL: ${page.url()})`)
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
      if (tl === 'url' || tl.includes('url') || tl.includes('redirect') || tl.includes('navigat')) {
        if (value) {
          const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          await page.waitForURL(new RegExp(escaped), { timeout: 15000 })
        } else {
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 })
        }
      } else if (resolvedLocator) {
        const loc = resolveLocatorString(page, resolvedLocator)
        await loc.waitFor({ timeout: 10000 })
      } else {
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 })
      }
      break
    }
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
  const { headed = false } = options
  const baseUrl = appConfig.baseUrl.replace(/\/$/, '')

  const tcResults: ExecutionResult['testResults'] = []

  const browser: Browser = await chromium.launch({ headless: !headed })

  try {
    for (const tc of testCases) {
      const tcStart = Date.now()
      onEvent({ type: 'tc_start', id: tc.id, title: tc.title })

      if (!tc.steps || tc.steps.length === 0) {
        onEvent({ type: 'tc_done', id: tc.id, status: 'passed', duration: 0 })
        tcResults.push({ title: `${tc.id}: ${tc.title}`, status: 'skipped', duration: 0, retries: 0 })
        continue
      }

      onEvent({ type: 'log', text: `Parsing ${tc.steps.length} steps for ${tc.id}…` })
      let parsedSteps = await parseSteps(tc.steps, pages, appConfig)

      const ctx = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 800 },
      })
      const page = await ctx.newPage()

      let tcFailed = false
      let tcError: string | undefined
      const completedSteps: { step: string; status: string }[] = []

      try {
        for (let i = 0; i < tc.steps.length; i++) {
          const step = tc.steps[i]
          const parsed = parsedSteps[i]

          onEvent({ type: 'step_start', tcId: tc.id, stepIndex: i, step })

          let resolvedLocator =
            parsed.action === 'fill' || parsed.action === 'click'
              ? findBestLocator(parsed.target, pages)
              : null

          let stepError: Error | null = null
          let healingAttempts = 0
          let usedLocator = resolvedLocator || undefined

          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await executeAction(page, parsed, resolvedLocator, baseUrl)
              stepError = null
              break
            } catch (err) {
              stepError = err instanceof Error ? err : new Error(String(err))
              if (attempt < 2) {
                // Pass the last tried locator so the healer doesn't suggest the same one
                const healed = await healStep(
                  page, step, parsed, stepError, pages, onEvent,
                  tc.id, i, attempt + 1, resolvedLocator ?? undefined,
                )
                if (healed) {
                  resolvedLocator = healed
                  usedLocator = healed
                  healingAttempts++
                }
                // Do NOT break on null — let the loop try again with semantic fallbacks in executeAction
              }
            }
          }

          if (stepError) {
            // All healing attempts exhausted — call scenario analyst before giving up
            const recovery = await analyzeStuckScenario(page, tc, i, completedSteps, tc.steps.slice(i + 1), pages, onEvent)

            if (recovery.action === 'navigate' && recovery.navTarget) {
              // Navigate to the right page and retry the stuck step once
              try {
                await page.goto(`${baseUrl}${recovery.navTarget}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
                await executeAction(page, parsed, resolvedLocator, baseUrl)
                stepError = null
                onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'passed', locatorUsed: usedLocator, healingAttempts })
                completedSteps.push({ step, status: 'passed' })
                continue
              } catch (retryErr) {
                stepError = retryErr instanceof Error ? retryErr : new Error(String(retryErr))
              }
            } else if (recovery.action === 'revise' && recovery.revisedSteps && recovery.revisedSteps.length > 0) {
              // Replace remaining parsed steps and re-run from current position
              const newSteps = recovery.revisedSteps
              parsedSteps = [...parsedSteps.slice(0, i), ...newSteps]
              // Adjust tc.steps length to match if needed
              const revised = parsedSteps[i]
              try {
                const newLocator = revised.action === 'fill' || revised.action === 'click'
                  ? findBestLocator(revised.target, pages)
                  : null
                await executeAction(page, revised, newLocator, baseUrl)
                stepError = null
                onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'passed', locatorUsed: newLocator || undefined, healingAttempts })
                completedSteps.push({ step, status: 'passed' })
                continue
              } catch (retryErr) {
                stepError = retryErr instanceof Error ? retryErr : new Error(String(retryErr))
              }
            }
            // skip or failed recovery
            const reason = recovery.reason || stepError.message
            onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'failed', locatorUsed: usedLocator, error: reason, healingAttempts })
            completedSteps.push({ step, status: 'failed' })
            tcFailed = true
            tcError = `Step ${i + 1} failed: ${reason}`
            break
          } else {
            onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'passed', locatorUsed: usedLocator, healingAttempts })
            completedSteps.push({ step, status: 'passed' })
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

  return { passed, failed, skipped, duration: totalDuration, testResults: tcResults }
}
