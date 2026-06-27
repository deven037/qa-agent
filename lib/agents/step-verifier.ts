import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { AppConfig } from '@/lib/config/store'
import { TestCase, TestStep } from './testcase-agent'
import { callLLM } from '@/lib/ai/gemini'

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveLocatorToSelector(locatorStr: string): string {
  // Convert display locators back to raw selectors for .locator() calls
  return locatorStr
    .replace(/^page\.locator\(['"](.+)['"]\)$/, '$1')
    .replace(/^page\.getByRole\('(\w+)',\s*\{\s*name:\s*['"](.+)['"]\s*\}\)$/, '[role="$1"]:has-text("$2")')
    .replace(/^page\.getByLabel\(['"](.+)['"]\)$/, '[aria-label="$1"], label:has-text("$1") + input, label:has-text("$1") ~ input')
    .replace(/^page\.getByText\(['"](.+)['"]\)$/, ':has-text("$1")')
}

async function verifyLocator(page: Page, locatorStr: string): Promise<boolean> {
  try {
    const sel = resolveLocatorToSelector(locatorStr)
    const count = await page.locator(sel).count()
    return count === 1
  } catch {
    return false
  }
}

async function fixLocator(
  page: Page,
  step: TestStep,
  send: (text: string) => void,
): Promise<string | null> {
  try {
    const ariaSnap = await page.locator('body').ariaSnapshot({ timeout: 4000 })
      .catch(() => '').then(s => s.slice(0, 4000))

    const prompt = `A Playwright locator failed to match exactly one element. Fix it.

Page URL: ${page.url()}
ARIA snapshot:
${ariaSnap}

Failed step: "${step.description}"
Action: ${step.action}
Target: "${step.target}"
Failed locator: ${step.locator ?? '(none)'}

Return a corrected Playwright locator expression ONLY — no explanation, no markdown.
Must be one of: page.locator('css'), page.getByRole('role',{name:'text'}), page.getByLabel('text'), page.getByText('text').
Return "null" if no reliable locator can be found.`

    const raw = await callLLM(prompt, 'You are a Playwright expert. Return a single locator expression or the word null.')
    const cleaned = raw.trim().replace(/```\w*\n?|\n?```/g, '').trim()
    if (cleaned === 'null' || !cleaned.startsWith('page.')) return null
    // Verify the fixed locator actually works
    const ok = await verifyLocator(page, cleaned)
    return ok ? cleaned : null
  } catch {
    return null
  }
}

// ── Auth: reuse pattern from live-recon-agent ─────────────────────────────────

async function performLogin(context: BrowserContext, appConfig: AppConfig): Promise<boolean> {
  if (appConfig.authStrategy === 'no-auth') return true

  const creds = appConfig.credentials ?? {}
  const emailVal = Object.entries(creds).find(([k]) => /email|username|user|login/i.test(k))?.[1]
  const passVal = Object.entries(creds).find(([k]) => /password|pass|pwd/i.test(k))?.[1]
  if (!emailVal || !passVal) return false

  const loginCandidates = [
    '/login', '/signin', '/sign-in', '/account/login', '/user/login',
    '/index.php?rt=account/login', '/my-account', '/auth/login',
  ]
  const base = appConfig.baseUrl.replace(/\/$/, '')
  const page = await context.newPage()
  try {
    for (const candidate of loginCandidates) {
      try {
        await page.goto(`${base}${candidate}`, { waitUntil: 'domcontentloaded', timeout: 6000 })
        const hasPassword = await page.$('input[type="password"]')
        if (hasPassword) {
          const emailSel = 'input[type="email"], input[name*="email" i], input[name*="user" i], input[name*="login" i]'
          await page.locator(emailSel).first().fill(emailVal, { timeout: 4000 })
          await page.locator('input[type="password"]').first().fill(passVal, { timeout: 4000 })
          await page.locator('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click({ timeout: 4000 })
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
          const afterUrl = page.url()
          const loginPart = new URL(`${base}${candidate}`).pathname
          return !afterUrl.includes(loginPart.substring(0, 10))
        }
      } catch { /* try next */ }
    }
    return false
  } finally {
    await page.close().catch(() => {})
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function verifyTestCases(
  testCases: TestCase[],
  appConfig: AppConfig,
  send: (text: string) => void,
  signal?: AbortSignal,
): Promise<TestCase[]> {
  // Only verify TCs that have structured steps with locators
  const hasStructured = testCases.some(tc => tc.structuredSteps && tc.structuredSteps.some(s => s.locator))
  if (!hasStructured) return testCases

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })

    const loggedIn = await Promise.race([
      performLogin(context, appConfig),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 15000)),
    ])
    if (!loggedIn && appConfig.authStrategy !== 'no-auth') {
      send(`⚠️  Verifier: login skipped — verifying public pages only\n`)
    }

    const base = appConfig.baseUrl.replace(/\/$/, '')
    const results: TestCase[] = []

    for (const tc of testCases) {
      if (signal?.aborted) { results.push(tc); continue }

      if (!tc.structuredSteps || tc.structuredSteps.length === 0) {
        results.push(tc); continue
      }

      const page = await context.newPage()
      try {
        let currentPath = '/'
        const updatedSteps: TestStep[] = []
        const unresolvedIndices: number[] = []

        for (let i = 0; i < tc.structuredSteps.length; i++) {
          const step = { ...tc.structuredSteps[i] }

          // Track navigation to know what page we're on
          if (step.action === 'navigate') {
            const target = step.target.startsWith('http') ? step.target : `${base}${step.target.startsWith('/') ? '' : '/'}${step.target}`
            try {
              await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 })
              await page.waitForTimeout(600)
              currentPath = step.target
            } catch { /* navigation failed, keep going */ }
            step.verified = true
            updatedSteps.push(step)
            continue
          }

          // Skip non-locator steps
          if (!step.locator || step.action === 'wait') {
            step.verified = step.locator === null ? false : true
            if (!step.verified) unresolvedIndices.push(i)
            updatedSteps.push(step)
            continue
          }

          // Verify the locator against the live page
          const ok = await verifyLocator(page, step.locator)
          if (ok) {
            step.verified = true
          } else {
            // Try to auto-fix
            send(`  🔧 Step ${i + 1} locator unresolved on ${currentPath} — attempting fix...\n`)
            const fixed = await fixLocator(page, step, send)
            if (fixed) {
              step.locator = fixed
              step.verified = true
              send(`  ✓ Fixed: ${fixed}\n`)
            } else {
              step.verified = false
              unresolvedIndices.push(i)
            }
          }
          updatedSteps.push(step)
        }

        const verified = updatedSteps.filter(s => s.verified !== false).length
        const total = updatedSteps.length

        results.push({
          ...tc,
          structuredSteps: updatedSteps,
          steps: updatedSteps.map(s => s.description),
          stepExpected: updatedSteps.map(s => s.expected),
          verificationStatus: { verified, total, unresolvedIndices },
        })

        send(`  TC "${tc.title}": ${verified}/${total} steps verified${unresolvedIndices.length ? ` (${unresolvedIndices.length} unresolved)` : ' ✓'}\n`)
      } finally {
        await page.close().catch(() => {})
      }
    }

    return results
  } catch (err) {
    send(`⚠️  Step verification failed (${String(err)}) — using unverified TCs\n`)
    return testCases
  } finally {
    await browser?.close().catch(() => {})
  }
}
