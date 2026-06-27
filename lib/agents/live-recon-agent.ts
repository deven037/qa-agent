import { chromium, Browser, BrowserContext } from 'playwright'
import { AppConfig } from '@/lib/config/store'
import { extractDomFields, extractElementMap, ElementDef } from '@/lib/agents/playwright-mcp-agent'

export interface ReconPage {
  path: string
  url: string
  title: string
  fields: string
  interactive: string
  ariaSnapshot: string
  elementMap: ElementDef[]
}

export interface LiveReconResult {
  pages: ReconPage[]
  appContext: string
  pageInventory: string
  elementMapContext: string
}

// ── Module inference ──────────────────────────────────────────────────────────

function inferModule(path: string): string {
  const p = path.toLowerCase()
  if (/login|signin|sign-in|register|signup|sign-up|auth/.test(p)) return 'AUTH'
  if (/checkout|cart|payment|order\/place|buy/.test(p)) return 'CHECKOUT'
  if (/account|profile|orders|dashboard|my-/.test(p)) return 'ACCOUNT'
  if (/product|catalog|search|category|collection|shop/.test(p)) return 'CATALOG'
  return 'OTHER'
}

// ── Output formatting — mirrors getPageInventory() and getPageContext() ───────

function parseFieldLabels(fields: string): string[] {
  const re = /label="([^"]*)"/g
  const labels: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(fields)) !== null) {
    const lbl = m[1].trim()
    if (lbl) labels.push(lbl)
  }
  // Also try placeholder when label is empty
  const placeholderRe = /label=""\s+name="[^"]*"\s+id="[^"]*"\s+type="[^"]*"\s+placeholder="([^"]*)"/g
  while ((m = placeholderRe.exec(fields)) !== null) {
    const ph = m[1].trim()
    if (ph && !labels.includes(ph)) labels.push(ph)
  }
  return labels
}

function parseFieldDefs(fields: string): { label: string; type: string }[] {
  const re = /label="([^"]*)"\s+name="([^"]*)"\s+id="([^"]*)"\s+type="([^"]*)"\s+placeholder="([^"]*)"/g
  const defs: { label: string; type: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(fields)) !== null) {
    const label = m[1].trim() || m[5].trim() || m[2].trim() || '(field)'
    const type = m[4].trim() || 'text'
    if (label !== '(field)' || type !== 'text') defs.push({ label, type })
  }
  return defs
}

function findSubmitButton(interactive: string): string | null {
  const re = /\[button\] text="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(interactive)) !== null) {
    if (/submit|login|sign.?in|register|continue|place.?order|next|proceed|checkout/i.test(m[1])) return m[1]
  }
  return null
}

function findActionButtons(interactive: string, excludeSubmit: string | null): string[] {
  const re = /\[(button|link)\] text="([^"]*)"/g
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(interactive)) !== null) {
    const text = m[2].trim()
    if (!text || text === excludeSubmit) continue
    if (/back to top|scroll|share|print|close|dismiss|cookie/i.test(text)) continue
    results.push(text)
  }
  return results.slice(0, 5)
}

function buildPageInventory(pages: ReconPage[]): string {
  if (pages.length === 0) return '(no pages captured)'
  return pages.map(page => {
    const lines: string[] = [`[${inferModule(page.path)}] "${page.title}" → path: ${page.path}`]
    const fieldLabels = parseFieldLabels(page.fields)
    if (fieldLabels.length) lines.push(`  Fields: ${fieldLabels.map(l => `"${l}"`).join(', ')}`)
    const submit = findSubmitButton(page.interactive)
    if (submit) lines.push(`  Submit: "${submit}"`)
    const buttons = findActionButtons(page.interactive, submit)
    if (buttons.length) lines.push(`  Buttons/Links: ${buttons.map(b => `"${b}"`).join(', ')}`)
    return lines.join('\n')
  }).join('\n\n')
}

function buildAppContext(pages: ReconPage[]): string {
  if (pages.length === 0) return ''
  const lines: string[] = [
    '=== APP UI KNOWLEDGE ===',
    'Use these field names, button labels, and paths verbatim in your steps.',
    'DO NOT generate steps for elements listed here unless the scenario explicitly requires them.',
    '',
  ]
  for (const page of pages) {
    const mod = inferModule(page.path)
    lines.push(`Page: "${page.title}" — path: ${page.path} (${mod.toLowerCase()})`)
    const fieldDefs = parseFieldDefs(page.fields)
    if (fieldDefs.length) {
      const formName = `${page.title} Form`
      lines.push(`  Form: "${formName}"`)
      for (const f of fieldDefs) {
        const req = f.type === 'email' || f.type === 'password' ? ' [required]' : ''
        lines.push(`    • Field: "${f.label}" (${f.type})${req}`)
      }
      const submit = findSubmitButton(page.interactive)
      if (submit) lines.push(`    • Submit button: "${submit}"`)
    }
    const actionBtns = findActionButtons(page.interactive, findSubmitButton(page.interactive))
    if (actionBtns.length) {
      lines.push(`  Action buttons: ${actionBtns.map(b => `"${b}"`).join(', ')}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function buildElementMapContext(pages: ReconPage[]): string {
  if (pages.every(p => p.elementMap.length === 0)) return ''
  const lines: string[] = [
    '=== ELEMENT MAP (use these locators verbatim in test steps) ===',
    'For any element listed here, embed its locator. Do NOT use [inferred] for these elements.',
    '',
  ]
  for (const page of pages) {
    if (page.elementMap.length === 0) continue
    lines.push(`Page: ${page.path}`)
    for (const el of page.elementMap) {
      const locDisplay = el.locator.startsWith('getByRole:')
        ? `page.getByRole('${el.locator.split(':')[1]}', { name: '${el.locator.split(':').slice(2).join(':')}' })`
        : el.locator.startsWith('getByLabel:')
        ? `page.getByLabel('${el.locator.slice('getByLabel:'.length)}')`
        : el.locator.startsWith('getByText:')
        ? `page.getByText('${el.locator.slice('getByText:'.length)}')`
        : `page.locator('${el.locator}')`
      lines.push(`  [${el.type}] "${el.label}" → ${locDisplay}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

// ── Authentication ────────────────────────────────────────────────────────────

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
    // Find the login page
    let loginUrl: string | null = null
    for (const candidate of loginCandidates) {
      try {
        await page.goto(`${base}${candidate}`, { waitUntil: 'domcontentloaded', timeout: 6000 })
        const hasPassword = await page.$('input[type="password"]')
        if (hasPassword) { loginUrl = `${base}${candidate}`; break }
      } catch { /* try next */ }
    }
    if (!loginUrl) return false

    // Fill credentials
    const emailSelector = 'input[type="email"], input[name*="email" i], input[name*="user" i], input[name*="login" i]'
    const emailInput = page.locator(emailSelector).first()
    await emailInput.fill(emailVal, { timeout: 4000 })

    await page.locator('input[type="password"]').first().fill(passVal, { timeout: 4000 })
    await page.locator('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click({ timeout: 4000 })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})

    const afterUrl = page.url()
    const loginPart = new URL(loginUrl).pathname + new URL(loginUrl).search
    return !afterUrl.includes(loginPart.split('?')[0].replace(/^\//, '').substring(0, 10))
  } catch {
    return false
  } finally {
    await page.close().catch(() => {})
  }
}

// ── Page capture ──────────────────────────────────────────────────────────────

async function capturePage(context: BrowserContext, url: string, path: string): Promise<ReconPage> {
  const page = await context.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(800)
    const title = await page.title().catch(() => path)
    const [{ fields, interactive }, ariaSnapshotRaw, elementMap] = await Promise.all([
      extractDomFields(page),
      page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => ''),
      extractElementMap(page),
    ])
    const ariaSnapshot = ariaSnapshotRaw.slice(0, 8000)
    return { path, url, title, fields, interactive, ariaSnapshot, elementMap }
  } catch {
    return { path, url, title: path, fields: '(capture failed)', interactive: '(capture failed)', ariaSnapshot: '', elementMap: [] }
  } finally {
    await page.close().catch(() => {})
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function liveReconAgent(
  appConfig: AppConfig,
  pagesToCapture: string[],
  send: (text: string) => void,
  signal?: AbortSignal,
): Promise<LiveReconResult> {
  const empty: LiveReconResult = { pages: [], appContext: '', pageInventory: '', elementMapContext: '' }
  if (pagesToCapture.length === 0) return empty

  let browser: Browser | null = null
  try {
    send(`⚡ Starting live recon — capturing ${pagesToCapture.length} page(s)...\n`)
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })

    send(`🔐 Authenticating...\n`)
    const loggedIn = await Promise.race([
      performLogin(context, appConfig),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 15000)),
    ])
    if (!loggedIn && appConfig.authStrategy !== 'no-auth') {
      send(`⚠️ Login skipped — capturing public pages only\n`)
    }

    if (signal?.aborted) return empty

    const base = appConfig.baseUrl.replace(/\/$/, '')
    send(`📸 Capturing: ${pagesToCapture.join(', ')}\n`)

    const reconPages = await Promise.all(
      pagesToCapture.map(path => capturePage(context, `${base}${path}`, path))
    )

    send(`✅ Recon complete — ${reconPages.length} page(s) captured\n`)

    return {
      pages: reconPages,
      appContext: buildAppContext(reconPages),
      pageInventory: buildPageInventory(reconPages),
      elementMapContext: buildElementMapContext(reconPages),
    }
  } catch (err) {
    send(`⚠️ Live recon failed (${String(err)}) — generating with minimal context\n`)
    return empty
  } finally {
    await browser?.close().catch(() => {})
  }
}
