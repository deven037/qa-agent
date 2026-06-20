import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { AppConfig } from '@/lib/config/store'
import { PageKnowledge, AppForm, FormField, UIElement } from '@/lib/db/models/AppKnowledge'

const MAX_PAGES = 60
const PARALLEL = 3

function inferModule(path: string): PageKnowledge['module'] {
  if (/login|signin|sign-in|auth|password/.test(path)) return 'auth'
  if (/cart|checkout|payment|order/.test(path)) return 'checkout'
  if (/account|profile|dashboard|settings/.test(path)) return 'account'
  if (/product|item|catalog|shop|collection|category/.test(path)) return 'catalog'
  return 'other'
}

function isDangerousForm(action: string | null): boolean {
  return !!(action && /checkout|payment|order|purchase|pay/.test(action))
}

function skipUrl(url: string): boolean {
  return /\.(pdf|jpg|jpeg|png|gif|svg|css|js|woff|woff2|ico|webp|mp4|zip)(\?|$)/i.test(url)
    || /[?&](page|offset|p|sort|filter)=/.test(url)
    || /#/.test(url)
}

function buildLocators(role: string | null, name: string | null, label: string | null, placeholder: string | null, htmlName?: string | null): UIElement['locators'] {
  return {
    getByRole: role && name ? `page.getByRole('${role}', { name: '${name.replace(/'/g, "\\'")}' })` : null,
    getByLabel: label ? `page.getByLabel('${label.replace(/'/g, "\\'")}')` : null,
    getByPlaceholder: placeholder ? `page.getByPlaceholder('${placeholder.replace(/'/g, "\\'")}')` : null,
    getByText: null,
    byName: htmlName ? `page.locator('input[name="${htmlName}"]')` : null,
  }
}

async function capturePage(page: Page): Promise<PageKnowledge> {
  const url = page.url()
  const title = await page.title()
  const path = new URL(url).pathname

  // Scroll to bottom to trigger lazy-loaded content, then back to top
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(300)
    await page.evaluate(() => window.scrollTo(0, 0))
  } catch { /* ignore */ }

  const data = await page.evaluate(() => {
    const trim = (s: string | null | undefined) => s?.trim().slice(0, 200) || null

    // Buttons
    const buttons: UIElement[] = Array.from(
      document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')
    ).slice(0, 30).map((el) => {
      const text = trim((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label'))
      return {
        role: 'button',
        name: text,
        label: null,
        placeholder: null,
        inputType: null,
        htmlName: (el as HTMLInputElement).name || null,
        htmlId: el.id || null,
        locators: {
          getByRole: text ? `page.getByRole('button', { name: '${text?.replace(/'/g, "\\'")}' })` : null,
          getByLabel: null,
          getByPlaceholder: null,
          getByText: text ? `page.getByText('${text?.replace(/'/g, "\\'")}')` : null,
          byName: null,
        },
      }
    }).filter((b) => b.name)

    // Links
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 60).map((el) => {
      const anchor = el as HTMLAnchorElement
      return { text: trim((el as HTMLElement).innerText || el.getAttribute('aria-label')) || '', href: anchor.href, path: new URL(anchor.href, location.href).pathname }
    }).filter((l) => l.text && l.href && !l.href.startsWith('javascript:'))

    // Forms — also capture aria-label and aria-describedby for React/MUI/Chakra apps
    const forms: AppForm[] = Array.from(document.querySelectorAll('form')).slice(0, 5).map((form, fi) => {
      const nearbyHeading = form.closest('section,div')?.querySelector('h1,h2,h3,h4')
      const formName = trim((nearbyHeading as HTMLElement)?.innerText) || `Form #${fi + 1}`
      const action = form.action || null
      const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]), textarea, select'))
      const fields: FormField[] = inputs.slice(0, 20).map((el) => {
        const input = el as HTMLInputElement
        const id = input.id || ''
        const labelEl = id ? document.querySelector(`label[for="${id}"]`) : el.closest('label') || el.previousElementSibling
        // aria-label is the standard in React component libraries (MUI, shadcn, Chakra)
        const ariaLabel = trim(input.getAttribute('aria-label'))
        const labelText = trim((labelEl as HTMLElement)?.innerText) || ariaLabel
        // aria-describedby often points to helper/error text — capture as validation hint
        const describedById = input.getAttribute('aria-describedby')
        const describedByText = describedById
          ? trim(document.getElementById(describedById.split(' ')[0])?.textContent)
          : null
        const role = el.tagName === 'SELECT' ? 'combobox' : 'textbox'
        const name = labelText || trim(input.placeholder) || trim(input.name)
        return {
          role,
          name,
          label: labelText,
          placeholder: trim(input.placeholder),
          inputType: input.type || el.tagName.toLowerCase(),
          htmlName: trim(input.name),
          htmlId: id || null,
          required: input.required || input.getAttribute('aria-required') === 'true',
          // Pre-populate validationMessages with describedByText if it looks like an error hint
          validationMessages: describedByText ? [describedByText] : [],
          locators: {
            getByRole: role && name ? `page.getByRole('${role}', { name: '${name?.replace(/'/g, "\\'")}' })` : null,
            // Prefer the explicit aria-label from React components; fall back to visible <label> text
            getByLabel: labelText ? `page.getByLabel('${labelText.replace(/'/g, "\\'")}')` : null,
            getByPlaceholder: input.placeholder ? `page.getByPlaceholder('${input.placeholder.replace(/'/g, "\\'")}')` : null,
            getByText: null,
            byName: input.name ? `page.locator('input[name="${input.name}"]')` : null,
          },
        }
      })
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]')
      const submitText = trim((submitBtn as HTMLElement)?.innerText || (submitBtn as HTMLInputElement)?.value || submitBtn?.getAttribute('aria-label'))
      return {
        formName,
        action,
        fields,
        submitButtonLocator: submitText ? `page.getByRole('button', { name: '${submitText.replace(/'/g, "\\'")}' })` : null,
      }
    })

    // Headings
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 10)
      .map((el) => trim((el as HTMLElement).innerText)).filter(Boolean) as string[]

    // Visible text sample
    const visibleTextSample = Array.from(document.querySelectorAll('p, label, span, td, th, li'))
      .map((el) => trim((el as HTMLElement).innerText))
      .filter((t): t is string => !!(t && t.length > 3 && t.length < 120))
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 30)

    return { buttons, links, forms, headings, visibleTextSample }
  })

  // Expand <details> elements only — safe because they cannot trigger navigation
  try {
    const closedDetails = await page.locator('details:not([open]) summary').all()
    let expanded = false
    for (const summary of closedDetails.slice(0, 5)) {
      try {
        await summary.click({ timeout: 1000 })
        await page.waitForTimeout(200)
        expanded = true
      } catch { /* ignore */ }
    }

    if (expanded) {
      // Check if new form fields appeared
      const newFieldCount = await page.evaluate(() =>
        Array.from(document.querySelectorAll('form input:not([type="hidden"]), form textarea, form select')).length
      )
      const originalFieldCount = data.forms.reduce((s, f) => s + f.fields.length, 0)

      if (newFieldCount > originalFieldCount) {
        // Re-capture forms now that hidden fields are visible
        const refreshed = await page.evaluate(() => {
          const trim = (s: string | null | undefined) => s?.trim().slice(0, 200) || null
          return Array.from(document.querySelectorAll('form')).slice(0, 8).map((form, fi) => {
            const nearbyHeading = form.closest('section,div')?.querySelector('h1,h2,h3,h4')
            const formName = trim((nearbyHeading as HTMLElement)?.innerText) || `Form #${fi + 1}`
            const action = form.action || null
            const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]), textarea, select'))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fields: any[] = inputs.slice(0, 20).map((el) => {
              const input = el as HTMLInputElement
              const id = input.id || ''
              const labelEl = id ? document.querySelector(`label[for="${id}"]`) : el.closest('label') || el.previousElementSibling
              const ariaLabel = trim(input.getAttribute('aria-label'))
              const labelText = trim((labelEl as HTMLElement)?.innerText) || ariaLabel
              const name = labelText || trim(input.placeholder) || trim(input.name)
              return {
                role: el.tagName === 'SELECT' ? 'combobox' : 'textbox',
                name, label: labelText,
                placeholder: trim(input.placeholder),
                inputType: input.type || el.tagName.toLowerCase(),
                htmlName: trim(input.name), htmlId: id || null,
                required: input.required,
                validationMessages: [],
                locators: {
                  getByRole: name ? `page.getByRole('textbox', { name: '${name?.replace(/'/g, "\\'")}' })` : null,
                  getByLabel: labelText ? `page.getByLabel('${labelText.replace(/'/g, "\\'")}')` : null,
                  getByPlaceholder: input.placeholder ? `page.getByPlaceholder('${input.placeholder.replace(/'/g, "\\'")}')` : null,
                  getByText: null,
                  byName: input.name ? `page.locator('input[name="${input.name}"]')` : null,
                },
              }
            })
            const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]')
            const submitText = trim((submitBtn as HTMLElement)?.innerText || (submitBtn as HTMLInputElement)?.value || submitBtn?.getAttribute('aria-label'))
            return { formName, action, fields, submitButtonLocator: submitText ? `page.getByRole('button', { name: '${submitText.replace(/'/g, "\\'")}' })` : null }
          })
        })
        data.forms = refreshed as AppForm[]
      }
    }
  } catch { /* expansion is best-effort */ }

  return {
    url,
    path,
    title,
    module: inferModule(path),
    headings: data.headings,
    buttons: data.buttons,
    links: data.links,
    forms: data.forms,
    visibleTextSample: data.visibleTextSample,
    screenshotId: null,
    crawledAt: new Date(),
  }
}

async function captureValidationMessages(page: Page, form: AppForm, pageUrl: string): Promise<void> {
  if (isDangerousForm(form.action)) return
  try {
    if (form.submitButtonLocator) {
      await page.evaluate((loc) => {
        const match = loc.match(/name: '([^']+)'/)
        if (match) {
          const btn = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"]'))
            .find((el) => (el as HTMLElement).innerText?.includes(match[1]) || (el as HTMLInputElement).value?.includes(match[1]))
          if (btn) (btn as HTMLElement).click()
        }
      }, form.submitButtonLocator)

      // Wait for async SPA validation (networkidle is more reliable than a fixed timeout)
      await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(500)
    }

    // Strategy 1: class-name patterns (traditional HTML apps)
    const classErrors = await page.evaluate(() =>
      Array.from(document.querySelectorAll(
        '[class*="error"], [class*="invalid"], [role="alert"], .field-error, .form-error'
      )).map((el) => (el as HTMLElement).innerText?.trim().slice(0, 150)).filter(Boolean)
    )

    // Strategy 2: aria-invalid + aria-describedby (React Hook Form, Formik, MUI, shadcn)
    const ariaErrors = await page.evaluate(() => {
      const msgs: string[] = []
      for (const input of Array.from(document.querySelectorAll('[aria-invalid="true"]'))) {
        const describedBy = input.getAttribute('aria-describedby')
        if (describedBy) {
          for (const id of describedBy.split(' ')) {
            const errEl = document.getElementById(id)
            const txt = errEl?.textContent?.trim().slice(0, 150)
            if (txt) msgs.push(txt)
          }
        }
      }
      return msgs
    })

    // Strategy 3: native HTML5 validation messages
    const nativeErrors = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input:invalid, textarea:invalid'))
        .map((el) => (el as HTMLInputElement).validationMessage?.trim().slice(0, 150))
        .filter(Boolean) as string[]
    )

    const allErrors = [...new Set([...classErrors, ...ariaErrors, ...nativeErrors])]

    if (allErrors.length > 0) {
      form.fields.forEach((field, i) => {
        const existing = field.validationMessages
        const relevant = allErrors.filter((e) =>
          field.label && e.toLowerCase().includes(field.label.toLowerCase().split(' ')[0])
        )
        // Merge: keep any describedByText captured during crawl, add newly found errors
        form.fields[i].validationMessages = [...new Set([...existing, ...(relevant.length ? relevant : [])])]
      })
    }

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 10000 })
    await page.waitForTimeout(500)
  } catch {
    // Non-fatal
  }
}

async function tryLogin(page: Page, appConfig: AppConfig, onLog: (s: string) => void): Promise<boolean> {
  const creds = appConfig.credentials ?? {}
  const email = creds.email || null
  const password = creds.password || null
  if (!email || !password) return false

  onLog(`[DeepCrawl] Attempting login with ${email}\n`)
  try {
    // Scope to the form that contains a password field — avoids filling search boxes
    const loginForm = page.locator('form').filter({ has: page.locator('input[type="password"]') }).first()
    if (await loginForm.count() === 0) {
      onLog(`[DeepCrawl] No login form found on this page\n`)
      return false
    }

    // Fill email — prefer type="email", then aria-label/placeholder hints, then type="text" within the form
    const emailInput = loginForm.locator(
      'input[type="email"], input[name*="email" i], input[placeholder*="email" i], input[aria-label*="email" i], input[type="text"]'
    ).first()
    if (await emailInput.count() > 0) await emailInput.fill(email)

    // Fill password within the same form
    const passInput = loginForm.locator('input[type="password"]').first()
    if (await passInput.count() > 0) await passInput.fill(password)

    // Click the submit button scoped to the login form
    const submit = loginForm.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in")'
    ).first()
    if (await submit.count() > 0) {
      await submit.click()
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(500)
    }

    // Detect login success — still on login page with visible password field means failed
    const currentUrl = page.url()
    const stillOnLogin = currentUrl.includes('login') || currentUrl.includes('signin')
    const hasPasswordField = await page.locator('input[type="password"]').isVisible().catch(() => false)
    const loginFailed = stillOnLogin && hasPasswordField

    if (loginFailed) {
      const errorText = await page.locator('[class*="error"],[role="alert"]').first().textContent().catch(() => '')
      onLog(`[DeepCrawl] ⚠️ Login may have failed — still on login page. Error: "${errorText?.trim() || 'none detected'}"\n`)
      onLog(`[DeepCrawl] Continuing as unauthenticated user — auth-gated pages will be missing.\n`)
      return false
    }

    onLog(`[DeepCrawl] ✅ Login succeeded — now at: ${currentUrl}\n`)
    return true
  } catch {
    return false
  }
}

async function navigateToLoginAndLogin(
  page: Page,
  appConfig: AppConfig,
  baseUrl: string,
  onLog: (s: string) => void,
): Promise<void> {
  const creds = appConfig.credentials ?? {}
  if (!creds.email || !creds.password) return

  // Step 1: If a login form is already visible on this page, use it directly
  const hasPasswordInput = await page.locator('input[type="password"]').count()
  if (hasPasswordInput > 0) {
    await tryLogin(page, appConfig, onLog)
    return
  }

  // Step 2: Act like a user — look for a "Log in" / "Sign in" / "Account" clickable element
  // Try clicking by visible text first (most reliable), then by href pattern
  const loginTriggers = [
    page.getByRole('link', { name: /log\s*in/i }),
    page.getByRole('link', { name: /sign\s*in/i }),
    page.getByRole('button', { name: /log\s*in/i }),
    page.getByRole('button', { name: /sign\s*in/i }),
    page.getByRole('link', { name: /account/i }),
    page.locator('a[href*="login"], a[href*="signin"], a[href*="account"]'),
  ]

  for (const trigger of loginTriggers) {
    try {
      if (await trigger.first().isVisible({ timeout: 1500 })) {
        const label = await trigger.first().textContent().catch(() => '?')
        onLog(`[DeepCrawl] 🖱️ Clicking "${label?.trim()}" to reach login page\n`)
        await trigger.first().click()
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 })
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(400)

        // Check if we landed on a page with a login form
        const formVisible = await page.locator('input[type="password"]').count()
        if (formVisible > 0) {
          onLog(`[DeepCrawl] 📄 Login form found at ${page.url()}\n`)
          await tryLogin(page, appConfig, onLog)
          return
        }

        // We clicked something but no login form appeared — navigate back and try next trigger
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 })
        await page.waitForTimeout(400)
      }
    } catch { /* element not visible or click failed — try next */ }
  }

  // Step 3: Fall back to direct URL navigation as last resort
  const candidateUrls = [`${baseUrl}/account/login`, `${baseUrl}/login`, `${baseUrl}/signin`, `${baseUrl}/sign-in`]
  for (const url of candidateUrls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
      await page.waitForTimeout(400)
      const formVisible = await page.locator('input[type="password"]').count()
      if (formVisible > 0) {
        onLog(`[DeepCrawl] 📄 Login form found via direct URL: ${url}\n`)
        await tryLogin(page, appConfig, onLog)
        return
      }
    } catch { /* try next */ }
  }

  onLog(`[DeepCrawl] ⚠️ Could not find a login form — crawling as unauthenticated\n`)
}

async function crawlPage(
  page: Page,
  url: string,
  baseUrl: string,
  visited: Set<string>,
  queue: string[],
  appConfig: AppConfig,
  onLog: (s: string) => void
): Promise<PageKnowledge | null> {
  if (visited.has(url)) return null
  visited.add(url)

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    // Wait for JS/SPA rendering to settle — networkidle signals data fetching is done
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(400)

    const snap = await capturePage(page)
    onLog(`[DeepCrawl] ${snap.path} — "${snap.title}" (${snap.forms.length} forms, ${snap.buttons.length} buttons)\n`)

    // Capture validation messages per form
    for (const form of snap.forms) {
      if (!isDangerousForm(form.action) && form.fields.length > 0 && form.submitButtonLocator) {
        await captureValidationMessages(page, form, url)
      }
    }

    // Enqueue new same-origin links
    for (const link of snap.links) {
      if (
        link.href.startsWith(baseUrl) &&
        !visited.has(link.href) &&
        !skipUrl(link.href) &&
        !queue.includes(link.href)
      ) {
        queue.push(link.href)
      }
    }

    return snap
  } catch (e) {
    onLog(`[DeepCrawl] Failed: ${url} — ${String(e).split('\n')[0]}\n`)
    return null
  }
}

export async function deepExplorationAgent(
  appConfig: AppConfig,
  onLog: (line: string) => void,
  maxPages = MAX_PAGES
): Promise<PageKnowledge[]> {
  const baseUrl = appConfig.baseUrl.replace(/\/$/, '')
  const visited = new Set<string>()
  const queue: string[] = [baseUrl]
  const pages: PageKnowledge[] = []

  onLog(`[DeepCrawl] Starting deep crawl of ${baseUrl} (max ${maxPages} pages)\n`)

  const browser: Browser = await chromium.launch({ headless: true })
  const ctx: BrowserContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  })

  try {
    // Try login on first page if credentials exist
    const loginPage = await ctx.newPage()
    await loginPage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await loginPage.waitForTimeout(800)

    // Handle storefront / app-level password gate (e.g. Shopify preview stores)
    // Detected when: single password field with no email field on the landing page
    if (appConfig.storePassword) {
      const hasStorePasswordForm = await loginPage.locator('input[type="password"]').count() > 0
      const hasEmailField = await loginPage.locator('input[type="email"], input[name*="email"], input[name*="user"]').count() > 0
      if (hasStorePasswordForm && !hasEmailField) {
        onLog(`[DeepCrawl] 🔑 Store password gate detected — entering store password\n`)
        try {
          await loginPage.locator('input[type="password"]').first().fill(appConfig.storePassword)
          const submitBtn = loginPage.locator('button[type="submit"], input[type="submit"]').first()
          if (await submitBtn.count() > 0) await submitBtn.click()
          await loginPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
          await loginPage.waitForTimeout(500)
          onLog(`[DeepCrawl] ✅ Store password entered — now at: ${loginPage.url()}\n`)
        } catch {
          onLog(`[DeepCrawl] ⚠️ Could not enter store password — store may still be locked\n`)
        }
      }
    }

    await navigateToLoginAndLogin(loginPage, appConfig, baseUrl, onLog)

    // Capture landing page
    const landingSnap = await capturePage(loginPage)
    pages.push(landingSnap)
    visited.add(loginPage.url())
    visited.add(baseUrl)
    onLog(`[DeepCrawl] Landing: "${landingSnap.title}"\n`)

    for (const link of landingSnap.links) {
      if (link.href.startsWith(baseUrl) && !visited.has(link.href) && !skipUrl(link.href)) {
        queue.push(link.href)
      }
    }

    // Crawl Fix 6: verify session cookies exist before BFS (detects silent login failure)
    if (appConfig.credentials?.email) {
      const cookieCount = (await ctx.cookies()).length
      if (cookieCount === 0) {
        onLog(`[DeepCrawl] ⚠️ No session cookies after login — crawling as unauthenticated.\n`)
      } else {
        onLog(`[DeepCrawl] 🍪 Session active (${cookieCount} cookie${cookieCount !== 1 ? 's' : ''})\n`)
      }
    }

    await loginPage.close()

    // BFS with parallel pages
    while (queue.length > 0 && pages.length < maxPages) {
      const batch = queue.splice(0, PARALLEL).filter((u) => !visited.has(u))
      if (batch.length === 0) continue

      const batchPages = await Promise.all(
        batch.map(async (url) => {
          const p = await ctx.newPage()
          try {
            return await crawlPage(p, url, baseUrl, visited, queue, appConfig, onLog)
          } finally {
            await p.close()
          }
        })
      )

      for (const snap of batchPages) {
        if (snap) pages.push(snap)
      }

      onLog(`[DeepCrawl] Progress: ${pages.length} pages captured, ${queue.length} in queue\n`)
    }

  } finally {
    await browser.close()
  }

  onLog(`[DeepCrawl] Complete — ${pages.length} pages captured\n`)
  return pages
}
