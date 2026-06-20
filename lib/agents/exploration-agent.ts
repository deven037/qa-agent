import { chromium, Page } from 'playwright'
import { AppConfig } from '@/lib/config/store'
import { streamGemini } from '@/lib/ai/gemini'

export interface InteractionResult {
  action: string
  outcome: string
  url: string
}

export interface PageSnapshot {
  url: string
  title: string
  buttons: string[]
  links: { text: string; href: string }[]
  inputs: { label: string; type: string; placeholder: string; name: string; id: string }[]
  headings: string[]
  visibleText: string[]
  errorMessages: string[]
}

export interface ExplorationResult {
  baseUrl: string
  scenario: string
  snapshots: PageSnapshot[]
  interactions: InteractionResult[]
  authRequired: boolean
  notes: string[]
}

async function snapshotPage(page: Page): Promise<PageSnapshot> {
  const url = page.url()
  const title = await page.title()

  const data = await page.evaluate(() => {
    const getText = (el: Element) => (el as HTMLElement).innerText?.trim().slice(0, 100) || ''

    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'))
      .map((el) => (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '')
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 40)

    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((el) => ({ text: getText(el) || el.getAttribute('aria-label') || '', href: (el as HTMLAnchorElement).href }))
      .filter((l) => l.text)
      .filter((l, i, a) => a.findIndex((x) => x.href === l.href) === i)
      .slice(0, 40)

    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).map((el) => {
      const input = el as HTMLInputElement
      const id = input.id || ''
      const label = id ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() || '' : ''
      const ariaLabel = input.getAttribute('aria-label') || ''
      return {
        label: label || ariaLabel,
        type: input.type || el.tagName.toLowerCase(),
        placeholder: input.placeholder || '',
        name: input.name || '',
        id,
      }
    }).filter((i) => i.label || i.placeholder || i.name).slice(0, 25)

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(getText).filter(Boolean).slice(0, 10)

    const visibleText = Array.from(document.querySelectorAll('p, label, span, td, th, li, .error, [class*="error"], [class*="alert"], [class*="message"]'))
      .map(getText)
      .filter((t) => t.length > 3 && t.length < 120)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 50)

    const errorMessages = Array.from(document.querySelectorAll('[class*="error"], [class*="alert"], [class*="warning"], [role="alert"]'))
      .map(getText).filter(Boolean).slice(0, 10)

    return { buttons, links, inputs, headings, visibleText, errorMessages }
  })

  return { url, title, ...data }
}

function getCredentials(appConfig: AppConfig): { email: string | null; password: string | null } {
  const creds = appConfig.credentials ?? {}
  return {
    email: creds.email || null,
    password: creds.password || null,
  }
}

async function tryLogin(page: Page, appConfig: AppConfig, onLog: (s: string) => void): Promise<boolean> {
  const { email, password } = getCredentials(appConfig)
  if (!email || !password) {
    onLog('[Explore] No credentials configured — skipping login attempt\n')
    return false
  }
  onLog(`[Explore] Attempting login with ${email}\n`)
  try {
    const emailInputs = await page.locator(
      'input[type="email"], input[type="text"], input[name*="email"], input[name*="user"], input[placeholder*="email" i], input[placeholder*="user" i], input[placeholder*="username" i]'
    ).all()
    if (emailInputs.length > 0) await emailInputs[0].fill(email)

    const passInputs = await page.locator('input[type="password"]').all()
    if (passInputs.length > 0) await passInputs[0].fill(password)

    const submitBtn = page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue")'
    )
    const count = await submitBtn.count()
    if (count > 0) {
      await submitBtn.first().click()
      await page.waitForTimeout(2500)
    }
    onLog(`[Explore] Login done — now at: ${page.url()}\n`)
    return true
  } catch (e) {
    onLog(`[Explore] Login attempt failed: ${String(e)}\n`)
    return false
  }
}

// Use AI to decide which pages and interactions are relevant to the scenario
async function planExploration(scenario: string, baseUrl: string): Promise<{
  pagesToVisit: string[]
  actionsToTry: string[]
  keywords: string[]
}> {
  const prompt = `You are helping explore a web application to understand a specific scenario.

App base URL: ${baseUrl}
Scenario: "${scenario}"

Based on this scenario, determine:
1. Which pages/routes to visit (relative paths from the base URL, e.g. /login, /cart, /products)
2. What UI interactions to try (e.g. "fill login form", "click Add to Cart", "open wishlist")
3. Keywords to look for on the page to confirm we are in the right place

Respond ONLY with JSON:
{
  "pagesToVisit": ["/login", "/dashboard"],
  "actionsToTry": ["fill email and password fields", "click login button", "observe redirect"],
  "keywords": ["email", "password", "sign in", "login"]
}`

  try {
    const raw = await streamGemini(prompt, 'You are a QA test planner. Respond only with valid JSON.', () => {})
    const stripped = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON')
    return JSON.parse(jsonMatch[0])
  } catch {
    // Fallback: derive from scenario keywords
    const lower = scenario.toLowerCase()
    const pagesToVisit: string[] = []
    if (/login|sign in|auth/.test(lower)) pagesToVisit.push('/login')
    if (/register|sign up/.test(lower)) pagesToVisit.push('/register')
    if (/cart|checkout/.test(lower)) pagesToVisit.push('/cart', '/checkout')
    if (/wish|wishlist/.test(lower)) pagesToVisit.push('/wishlist', '/wish-list')
    if (/product/.test(lower)) pagesToVisit.push('/products')
    if (/profile|account/.test(lower)) pagesToVisit.push('/account', '/profile')
    if (/search/.test(lower)) pagesToVisit.push('/search')
    if (pagesToVisit.length === 0) pagesToVisit.push('/')
    return { pagesToVisit, actionsToTry: [], keywords: lower.split(/\s+/).filter((w) => w.length > 3) }
  }
}

export async function explorationAgent(
  appConfig: AppConfig,
  onLog: (line: string) => void,
  scenario = ''
): Promise<ExplorationResult> {
  const baseUrl = appConfig.baseUrl.replace(/\/$/, '')
  const snapshots: PageSnapshot[] = []
  const interactions: InteractionResult[] = []
  const notes: string[] = []
  let authRequired = false

  onLog(`[Explore] Scenario: "${scenario || 'General exploration'}"\n`)
  onLog(`[Explore] Planning exploration strategy...\n`)

  // AI-driven plan
  const plan = await planExploration(scenario || 'Explore the application', baseUrl)
  onLog(`[Explore] Will visit: ${plan.pagesToVisit.join(', ')}\n`)
  onLog(`[Explore] Will try: ${plan.actionsToTry.join('; ')}\n\n`)

  onLog(`[Explore] Launching browser → ${baseUrl}\n`)
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  try {
    // Step 1: Land on base URL
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(1200)
    const landingSnap = await snapshotPage(page)
    snapshots.push(landingSnap)
    onLog(`[Explore] Landing page: "${landingSnap.title}" (${landingSnap.url})\n`)
    onLog(`[Explore] Found ${landingSnap.inputs.length} inputs, ${landingSnap.buttons.length} buttons, ${landingSnap.links.length} links\n`)

    // Detect auth requirement
    const needsLogin = landingSnap.links.some((l) => /login|sign in/i.test(l.text)) ||
                       landingSnap.buttons.some((b) => /login|sign in/i.test(b))
    if (needsLogin) {
      authRequired = true
      notes.push('App requires authentication')
    }

    // Step 2: Visit scenario-relevant pages
    for (const relPath of plan.pagesToVisit) {
      const targetUrl = `${baseUrl}${relPath}`
      if (snapshots.some((s) => s.url === targetUrl)) continue
      try {
        onLog(`[Explore] Navigating to ${relPath}...\n`)
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 })
        await page.waitForTimeout(1000)

        // If redirected to login and not the intended page, note it
        const actualUrl = page.url()
        if (actualUrl !== targetUrl && /login|auth/i.test(actualUrl) && !/login|auth/i.test(relPath)) {
          authRequired = true
          onLog(`[Explore] ↳ Redirected to login — page requires authentication\n`)
        }

        const snap = await snapshotPage(page)
        if (!snapshots.some((s) => s.url === snap.url)) {
          snapshots.push(snap)
          onLog(`[Explore] Page "${snap.title}":\n`)
          if (snap.inputs.length) {
            onLog(`  Inputs: ${snap.inputs.map((i) => `${i.label || i.placeholder || i.name} (${i.type})`).join(' | ')}\n`)
          }
          if (snap.buttons.length) {
            onLog(`  Buttons: ${snap.buttons.slice(0, 10).join(' | ')}\n`)
          }
          if (snap.headings.length) {
            onLog(`  Headings: ${snap.headings.join(' | ')}\n`)
          }
        }

        // Step 3: Try login if the scenario involves auth or we need it
        if ((relPath === '/login' || /login|sign in|auth/i.test(scenario)) && snap.inputs.some((i) => i.type === 'password')) {
          onLog(`[Explore] Login form detected — attempting login to see authenticated state...\n`)
          const loggedIn = await tryLogin(page, appConfig, onLog)
          if (loggedIn) {
            await page.waitForTimeout(1500)
            const postSnap = await snapshotPage(page)
            if (!snapshots.some((s) => s.url === postSnap.url)) {
              snapshots.push(postSnap)
              onLog(`[Explore] After login: "${postSnap.title}" (${postSnap.url})\n`)
              if (postSnap.errorMessages.length) {
                onLog(`  Errors/messages: ${postSnap.errorMessages.join(' | ')}\n`)
              }
            }
            interactions.push({
              action: 'Login with test credentials',
              outcome: `Redirected to ${postSnap.url} — Title: "${postSnap.title}"`,
              url: postSnap.url,
            })
          }
        }

        // Step 4: For cart/wishlist scenarios, try adding a product first
        if (/cart|wishlist|wish list/i.test(scenario) && /product/i.test(relPath)) {
          const addBtn = page.locator('button:has-text("Add to Cart"), button:has-text("Add to Wishlist"), button:has-text("Add to Bag")').first()
          const addBtnCount = await addBtn.count()
          if (addBtnCount > 0) {
            const btnText = await addBtn.textContent()
            onLog(`[Explore] Found "${btnText}" button — clicking to test flow...\n`)
            await addBtn.click()
            await page.waitForTimeout(1200)
            const afterSnap = await snapshotPage(page)
            interactions.push({
              action: `Clicked "${btnText}"`,
              outcome: afterSnap.errorMessages.length
                ? `Messages: ${afterSnap.errorMessages.join('; ')}`
                : `Page: "${afterSnap.title}" — buttons now: ${afterSnap.buttons.slice(0, 5).join(', ')}`,
              url: afterSnap.url,
            })
            onLog(`[Explore] After click: ${interactions[interactions.length - 1].outcome}\n`)
          }
        }

      } catch (e) {
        onLog(`[Explore] Could not visit ${relPath}: ${String(e).split('\n')[0]}\n`)
      }
    }

    // Step 5: Also crawl links from landing page that match scenario keywords
    if (plan.keywords.length > 0) {
      const relevantLinks = landingSnap.links
        .filter((l) => plan.keywords.some((kw) => l.text.toLowerCase().includes(kw)))
        .filter((l) => l.href.startsWith(baseUrl))
        .filter((l) => !snapshots.some((s) => s.url === l.href))
        .slice(0, 3)

      for (const link of relevantLinks) {
        try {
          onLog(`[Explore] Following relevant link: "${link.text}" → ${link.href}\n`)
          await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 8000 })
          await page.waitForTimeout(800)
          const snap = await snapshotPage(page)
          if (!snapshots.some((s) => s.url === snap.url)) {
            snapshots.push(snap)
            onLog(`[Explore] Captured: "${snap.title}" — ${snap.inputs.length} inputs, ${snap.buttons.length} buttons\n`)
          }
        } catch {
          // ignore
        }
      }
    }

  } catch (e) {
    notes.push(`Exploration error: ${String(e).split('\n')[0]}`)
    onLog(`[Explore] Error: ${String(e).split('\n')[0]}\n`)
  } finally {
    await browser.close()
  }

  onLog(`\n[Explore] Complete — ${snapshots.length} pages captured, ${interactions.length} interactions performed\n`)
  return { baseUrl, scenario, snapshots, interactions, authRequired, notes }
}

export function formatExplorationContext(result: ExplorationResult): string {
  const lines: string[] = [
    `=== APP EXPLORATION RESULTS ===`,
    `Scenario: ${result.scenario}`,
    `Base URL: ${result.baseUrl}`,
    `Auth Required: ${result.authRequired}`,
    `Pages explored: ${result.snapshots.length}`,
    '',
  ]

  for (const snap of result.snapshots) {
    lines.push(`--- Page: "${snap.title}" (${snap.url}) ---`)
    if (snap.headings.length) lines.push(`Headings: ${snap.headings.join(' | ')}`)
    if (snap.inputs.length) {
      lines.push('Form inputs:')
      snap.inputs.forEach((i) =>
        lines.push(`  • [${i.type}] label="${i.label || i.placeholder}" name="${i.name}" id="${i.id}"`)
      )
    }
    if (snap.buttons.length) lines.push(`Buttons: ${snap.buttons.join(' | ')}`)
    if (snap.links.length) {
      const navLinks = snap.links.slice(0, 12).map((l) => l.text).join(' | ')
      lines.push(`Links: ${navLinks}`)
    }
    if (snap.errorMessages.length) lines.push(`Messages/Errors: ${snap.errorMessages.join(' | ')}`)
    lines.push('')
  }

  if (result.interactions.length) {
    lines.push('--- Interactions Performed ---')
    result.interactions.forEach((i) => {
      lines.push(`Action: ${i.action}`)
      lines.push(`Outcome: ${i.outcome}`)
      lines.push('')
    })
  }

  if (result.notes.length) {
    lines.push('Notes:')
    result.notes.forEach((n) => lines.push(`  • ${n}`))
  }

  return lines.join('\n')
}
