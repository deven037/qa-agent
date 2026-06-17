import { streamGemini } from '@/lib/ai/gemini'
import { TestCase } from './testcase-agent'
import { AppConfig } from '@/lib/config/store'
import fs from 'fs'
import path from 'path'

export async function automationAgent(
  issueKey: string,
  testCases: TestCase[],
  appConfig: AppConfig,
  onChunk: (text: string) => void,
  explorationContext?: string
): Promise<string> {
  const prompt = `Generate a Playwright TypeScript test file for these test cases.

Application Config:
- Name: ${appConfig.name}
- Base URL: accessed via process.env.BASE_URL (do NOT hardcode the URL)
- Auth Strategy: ${appConfig.authStrategy}
- Credential env vars: ${JSON.stringify(appConfig.credentialEnvVars)}

${explorationContext ? `${explorationContext}

IMPORTANT: Use the exploration results above as ground truth for selectors.
- Match input fields by their exact label, placeholder, or name found above
- Match buttons by their exact text found above
- If a test step mentions an element not found during exploration, use your best judgment based on the page structure
- Prefer getByRole(), getByLabel(), getByPlaceholder() over CSS selectors
` : ''}
Test Cases:
${JSON.stringify(testCases, null, 2)}

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
7. Import only from @playwright/test

Generate ONLY the TypeScript code. No markdown fences, no explanation.`

  const fullText = await streamGemini(
    prompt,
    'You are a Playwright automation expert. Generate clean, maintainable TypeScript test code based on real UI elements.',
    onChunk
  )

  const script = fullText
    .replace(/^```typescript\n?/m, '')
    .replace(/^```ts\n?/m, '')
    .replace(/^```\n?/m, '')
    .replace(/```$/m, '')
    .trim()

  const dir = path.join(process.cwd(), appConfig.playwrightTestsDir)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${issueKey}.spec.ts`), script)

  return script
}
