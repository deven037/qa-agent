import { streamGemini } from '@/lib/ai/gemini'
import { TestCase } from './testcase-agent'
import { AppConfig } from '@/lib/config/store'
import fs from 'fs'
import path from 'path'

interface AutomationOptions {
  browser?: string
  instructions?: string
  includeNegative?: boolean
  includeScreenshots?: boolean
}

export async function automationAgent(
  issueKey: string,
  testCases: TestCase[],
  appConfig: AppConfig,
  onChunk: (text: string) => void,
  explorationContext?: string,
  options: AutomationOptions = {}
): Promise<string> {
  const { browser = 'chromium', instructions = '', includeNegative = true, includeScreenshots = false } = options

  const filteredCases = includeNegative ? testCases : testCases.filter((tc) => tc.type !== 'negative')

  const prompt = `Generate a Playwright TypeScript test file for these test cases.

Application Config:
- Name: ${appConfig.name}
- Base URL: accessed via process.env.BASE_URL (do NOT hardcode the URL)
- Auth Strategy: ${appConfig.authStrategy}
- Browser: ${browser}${instructions ? `\n\nSpecific instructions from the QA engineer:\n${instructions}` : ''}

${explorationContext ? `${explorationContext}

CRITICAL SELECTOR RULES:
- The locators listed above are REAL — they were captured from the live app DOM
- Use them EXACTLY as written — do not paraphrase, shorten, or invent alternatives
- If a field is listed with getByLabel('Email address'), use page.getByLabel('Email address') — not getByRole or a CSS selector
- If a step mentions something not in the list, use page.getByText() as a last resort
- Never use CSS selectors, IDs, or class names
` : ''}
Test Cases:
${JSON.stringify(filteredCases, null, 2)}

Rules:
1. Start every file with these exact env variable declarations (before the tests):
   const BASE_URL = process.env.BASE_URL ?? '';
   const APP_EMAIL = process.env.APP_EMAIL ?? '';
   const APP_PASSWORD = process.env.APP_PASSWORD ?? '';
   Then use these constants (BASE_URL, APP_EMAIL, APP_PASSWORD) throughout — never pass process.env.X directly to any Playwright API.
2. Use test.describe() to group tests
3. One test() per test case, named with the ID and title
4. Use page.getByRole(), page.getByLabel(), page.getByPlaceholder(), page.getByText() — no CSS selectors
5. Add explicit expect() assertions after every action
6. No page.waitForTimeout() — use await expect(locator).toBeVisible() or page.waitForURL() instead
7. Import only from @playwright/test${includeScreenshots ? '\n8. Add await page.screenshot({ path: `screenshots/${issueKey}-${Date.now()}.png` }) inside each test.fail() or on test failure' : ''}

Generate ONLY the TypeScript code. No markdown fences, no explanation.`

  const fullText = await streamGemini(
    prompt,
    `You are a Playwright automation expert. Generate clean, maintainable TypeScript test code based on real UI elements. Use ${browser} browser project configuration.`,
    onChunk
  )

  let script = fullText.trim()

  // Strip markdown fences
  script = script.replace(/^```(?:typescript|ts)?\s*\n?/im, '').replace(/\n?```\s*$/m, '').trim()

  // If LLM returned JSON with a "code" key, extract it
  if (script.startsWith('{') || script.startsWith('[')) {
    try {
      const parsed = JSON.parse(script)
      if (typeof parsed?.code === 'string') script = parsed.code.trim()
    } catch { /* not JSON, use as-is */ }
  }

  // Move any stray import statements to the top
  const importLines: string[] = []
  const otherLines: string[] = []
  for (const line of script.split('\n')) {
    if (/^import\s+/.test(line.trim())) importLines.push(line)
    else otherLines.push(line)
  }
  if (importLines.length > 0) {
    script = [...importLines, '', ...otherLines].join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  const dir = path.join(process.cwd(), appConfig.playwrightTestsDir)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${issueKey}.spec.ts`), script)

  return script
}
