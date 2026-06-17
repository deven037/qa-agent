import { chromium } from 'playwright'
import { TestCase } from './testcase-agent'
import { AppConfig } from '@/lib/config/store'

export interface PageSnapshot {
  url: string
  title: string
  buttons: string[]
  links: string[]
  inputs: { label: string; type: string; placeholder: string; name: string }[]
  headings: string[]
  roles: string[]           // aria roles with accessible names
  visibleText: string[]     // key visible text chunks
}

export interface ExplorationResult {
  baseUrl: string
  snapshots: PageSnapshot[]
  authRequired: boolean
  loginPageSnapshot?: PageSnapshot
  notes: string[]
}

// Extract all meaningful locators from the current page
async function snapshotPage(page: import('playwright').Page): Promise<PageSnapshot> {
  const url = page.url()
  const title = await page.title()

  const data = await page.evaluate(() => {
    const getText = (el: Element) => (el as HTMLElement).innerText?.trim().slice(0, 80) || ''

    // Buttons
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'))
      .map((el) => (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '')
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 30)

    // Links
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((el) => getText(el) || el.getAttribute('aria-label') || '')
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 30)

    // Inputs with labels
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map((el) => {
      const input = el as HTMLInputElement
      const id = input.id
      const label = id ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() || '' : ''
      const ariaLabel = input.getAttribute('aria-label') || ''
      const placeholder = input.placeholder || ''
      const name = input.name || ''
      const type = input.type || el.tagName.toLowerCase()
      return { label: label || ariaLabel, type, placeholder, name }
    }).filter((i) => i.label || i.placeholder || i.name).slice(0, 20)

    // Headings
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map((el) => getText(el))
      .filter(Boolean)
      .slice(0, 10)

    // ARIA roles
    const roles = Array.from(document.querySelectorAll('[role]')).map((el) => {
      const role = el.getAttribute('role') || ''
      const name = el.getAttribute('aria-label') || getText(el)
      return name ? `${role}("${name}")` : role
    }).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 20)

    // Key visible text (paragraphs, labels, etc.)
    const visibleText = Array.from(document.querySelectorAll('p, label, span, td, th, li'))
      .map((el) => getText(el))
      .filter((t) => t.length > 3 && t.length < 100)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 40)

    return { buttons, links, inputs, headings, roles, visibleText }
  })

  return { url, title, ...data }
}

// Try to perform login if credentials are available
async function tryLogin(page: import('playwright').Page, appConfig: AppConfig, onLog: (s: string) => void): Promise<boolean> {
  const emailVar = Object.entries(appConfig.credentialEnvVars).find(([k]) => k.toLowerCase().includes('email') || k.toLowerCase().includes('user'))?.[1]
  const passVar = Object.entries(appConfig.credentialEnvVars).find(([k]) => k.toLowerCase().includes('password') || k.toLowerCase().includes('pass'))?.[1]
  const email = emailVar ? process.env[emailVar] : null
  const password = passVar ? process.env[passVar] : null

  if (!email || !password) return false

  onLog(`[Explore] Attempting login with ${email}\n`)

  try {
    // Find email/username input
    const emailInput = page.getByRole('textbox').filter({ hasText: '' }).first()
    const inputs = await page.locator('input[type="email"], input[type="text"], input[name*="email"], input[name*="user"], input[placeholder*="email" i], input[placeholder*="user" i]').all()
    if (inputs.length > 0) {
      await inputs[0].fill(email)
    }

    // Find password input
    const passInputs = await page.locator('input[type="password"]').all()
    if (passInputs.length > 0) {
      await passInputs[0].fill(password)
    }

    // Submit
    const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in")')
    await submitBtn.first().click()
    await page.waitForTimeout(2000)
    onLog(`[Explore] Login attempted — current URL: ${page.url()}\n`)
    return true
  } catch (e) {
    onLog(`[Explore] Login attempt failed: ${String(e)}\n`)
    return false
  }
}

// Infer relevant URLs from test case steps
function inferUrls(baseUrl: string, testCases: TestCase[]): string[] {
  const base = baseUrl.replace(/\/$/, '')
  const urls = new Set<string>([base])

  const stepText = testCases.flatMap((tc) => tc.steps).join(' ').toLowerCase()

  // Common page patterns — add more if keywords are found in steps
  const patterns: [string, string][] = [
    ['login', '/login'],
    ['sign in', '/login'],
    ['register', '/register'],
    ['sign up', '/register'],
    ['dashboard', '/dashboard'],
    ['home', '/home'],
    ['profile', '/profile'],
    ['account', '/account'],
    ['cart', '/cart'],
    ['checkout', '/checkout'],
    ['product', '/products'],
    ['search', '/search'],
    ['setting', '/settings'],
  ]

  for (const [keyword, path] of patterns) {
    if (stepText.includes(keyword)) urls.add(`${base}${path}`)
  }

  return Array.from(urls).slice(0, 5)
}

export async function explorationAgent(
  testCases: TestCase[],
  appConfig: AppConfig,
  onLog: (line: string) => void
): Promise<ExplorationResult> {
  const baseUrl = appConfig.baseUrl
  const snapshots: PageSnapshot[] = []
  const notes: string[] = []
  let authRequired = false
  let loginPageSnapshot: PageSnapshot | undefined

  onLog(`[Explore] Launching browser → ${baseUrl}\n`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()

  try {
    // Visit base URL
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(1500)

    const landingSnapshot = await snapshotPage(page)
    snapshots.push(landingSnapshot)
    onLog(`[Explore] Captured: ${landingSnapshot.title} (${landingSnapshot.url})\n`)

    // Detect if login is needed
    const pageText = landingSnapshot.visibleText.join(' ').toLowerCase()
    const hasLoginLink = landingSnapshot.links.some((l) => /login|sign in/i.test(l))
    const hasLoginButton = landingSnapshot.buttons.some((b) => /login|sign in/i.test(b))

    if (hasLoginLink || hasLoginButton) {
      authRequired = true
      notes.push('Login page detected — will attempt login before exploring')

      // Navigate to login
      const loginUrl = `${baseUrl.replace(/\/$/, '')}/login`
      try {
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 10000 })
        await page.waitForTimeout(1000)
        loginPageSnapshot = await snapshotPage(page)
        onLog(`[Explore] Login page captured: ${loginPageSnapshot.inputs.map((i) => i.label || i.placeholder).join(', ')}\n`)

        const loggedIn = await tryLogin(page, appConfig, onLog)
        if (loggedIn) {
          await page.waitForTimeout(2000)
          const postLoginSnapshot = await snapshotPage(page)
          snapshots.push(postLoginSnapshot)
          onLog(`[Explore] Post-login page: ${postLoginSnapshot.title}\n`)
        }
      } catch {
        onLog(`[Explore] Could not reach login page at ${loginUrl}\n`)
      }
    }

    // Explore inferred URLs from test case steps
    const urlsToVisit = inferUrls(baseUrl, testCases)
    for (const url of urlsToVisit) {
      if (snapshots.some((s) => s.url === url)) continue
      try {
        onLog(`[Explore] Visiting: ${url}\n`)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
        await page.waitForTimeout(1000)
        const snap = await snapshotPage(page)
        snapshots.push(snap)
        onLog(`[Explore] Captured: ${snap.title} — ${snap.inputs.length} inputs, ${snap.buttons.length} buttons\n`)
      } catch {
        onLog(`[Explore] Could not visit ${url}\n`)
      }
    }

    // Surface any mismatches between test steps and found elements
    for (const tc of testCases) {
      for (const step of tc.steps) {
        const allButtons = snapshots.flatMap((s) => s.buttons)
        const allInputs = snapshots.flatMap((s) => s.inputs.map((i) => i.label || i.placeholder))
        const stepLower = step.toLowerCase()

        // Check if test mentions a button/element that doesn't exist on any page
        const mentionedEl = step.match(/click(?:s|ed)?\s+(?:the\s+)?["']?([a-zA-Z\s]+?)["']?\s+(?:button|link|tab|menu)/i)?.[1]
        if (mentionedEl && !allButtons.some((b) => b.toLowerCase().includes(mentionedEl.toLowerCase()))) {
          notes.push(`Step "${step.slice(0, 60)}" mentions "${mentionedEl}" — not found on explored pages. AI will infer the correct selector.`)
        }
      }
    }

  } catch (e) {
    notes.push(`Exploration error: ${String(e)}`)
    onLog(`[Explore] Error: ${String(e)}\n`)
  } finally {
    await browser.close()
  }

  onLog(`[Explore] Done — ${snapshots.length} pages captured, ${notes.length} notes\n`)
  return { baseUrl, snapshots, authRequired, loginPageSnapshot, notes }
}

// Format exploration results as context for the automation agent
export function formatExplorationContext(result: ExplorationResult): string {
  const lines: string[] = [
    `=== APP EXPLORATION RESULTS ===`,
    `Base URL: ${result.baseUrl}`,
    `Auth Required: ${result.authRequired}`,
    '',
  ]

  for (const snap of result.snapshots) {
    lines.push(`--- Page: ${snap.title} (${snap.url}) ---`)
    if (snap.inputs.length) {
      lines.push('Inputs found:')
      snap.inputs.forEach((i) => lines.push(`  • ${i.type} — label="${i.label}" placeholder="${i.placeholder}" name="${i.name}"`))
    }
    if (snap.buttons.length) {
      lines.push(`Buttons: ${snap.buttons.join(' | ')}`)
    }
    if (snap.links.length) {
      lines.push(`Links: ${snap.links.slice(0, 15).join(' | ')}`)
    }
    if (snap.headings.length) {
      lines.push(`Headings: ${snap.headings.join(' | ')}`)
    }
    lines.push('')
  }

  if (result.loginPageSnapshot) {
    const l = result.loginPageSnapshot
    lines.push(`--- Login Page (${l.url}) ---`)
    l.inputs.forEach((i) => lines.push(`  • ${i.type} — label="${i.label}" placeholder="${i.placeholder}"`))
    lines.push('')
  }

  if (result.notes.length) {
    lines.push('Notes / Discrepancies:')
    result.notes.forEach((n) => lines.push(`  ⚠ ${n}`))
    lines.push('')
  }

  return lines.join('\n')
}
