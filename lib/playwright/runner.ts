import path from 'path'
import fs from 'fs'
import { AppConfig } from '@/lib/config/store'
import { spawn } from 'child_process'

export interface ExecutionResult {
  passed: number
  failed: number
  skipped: number
  duration: number
  testResults: TestResult[]
  error?: string
}

export interface TestResult {
  title: string
  status: 'passed' | 'failed' | 'skipped'
  duration: number
  error?: string
  errorStack?: string
  retries: number
}

// Install Playwright browsers if not already installed
async function ensureBrowsers(onOutput: (line: string) => void): Promise<void> {
  return new Promise((resolve) => {
    onOutput('[Setup] Checking Playwright browser installation...\n')
    const child = spawn('npx', ['playwright', 'install', 'chromium', '--with-deps'], {
      cwd: process.cwd(),
      shell: true,
      env: process.env,
    })
    child.stdout?.on('data', (d: Buffer) => onOutput(d.toString()))
    child.stderr?.on('data', (d: Buffer) => onOutput(d.toString()))
    child.on('close', () => {
      onOutput('[Setup] Browsers ready.\n')
      resolve()
    })
    child.on('error', () => resolve()) // non-fatal — try to run anyway
  })
}

export async function runPlaywrightTests(
  issueKey: string,
  appConfig: AppConfig,
  onOutput: (line: string) => void,
  timeoutMs = 300000,
  headed = false
): Promise<ExecutionResult> {
  const specPath = path.join(process.cwd(), appConfig.playwrightTestsDir, `${issueKey}.spec.ts`)

  // Check spec file exists
  if (!fs.existsSync(specPath)) {
    return { passed: 0, failed: 0, skipped: 0, duration: 0, testResults: [], error: `Spec file not found: ${specPath}` }
  }

  // Ensure browsers are installed
  await ensureBrowsers(onOutput)

  const reportPath = path.join(process.cwd(), `.playwright-report-${issueKey}.json`)

  const creds = appConfig.credentials ?? {}
  const envVars: NodeJS.ProcessEnv = {
    ...process.env,
    BASE_URL: appConfig.baseUrl,
    // Inject per-app credentials so every spec gets the right creds regardless of .env.local
    ...(creds.email    ? { APP_EMAIL: creds.email }       : {}),
    ...(creds.password ? { APP_PASSWORD: creds.password } : {}),
    ...(creds.apiKey   ? { APP_API_KEY: creds.apiKey }    : {}),
  }

  return new Promise((resolve) => {
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
      resolve({ passed: 0, failed: 0, skipped: 0, duration: 0, testResults: [], error: 'Playwright execution timed out after 5 minutes' })
    }, timeoutMs)

    const playwrightArgs = ['playwright', 'test', specPath,
      '--reporter', `json:${reportPath}`,
      '--reporter', 'line',
    ]
    if (headed) playwrightArgs.push('--headed')

    const child = spawn('npx', playwrightArgs, { env: envVars, cwd: process.cwd(), shell: true })

    // stdout = line reporter (human readable), stderr = errors
    child.stdout?.on('data', (d: Buffer) => onOutput(d.toString()))
    child.stderr?.on('data', (d: Buffer) => onOutput(d.toString()))

    child.on('close', (code) => {
      if (timedOut) return
      clearTimeout(timeout)

      if (fs.existsSync(reportPath)) {
        try {
          const reportJson = fs.readFileSync(reportPath, 'utf-8')
          fs.unlinkSync(reportPath)
          const report = JSON.parse(reportJson)
          resolve(parseReport(report))
          return
        } catch (e) {
          resolve({ passed: 0, failed: 0, skipped: 0, duration: 0, testResults: [], error: `Failed to parse Playwright report: ${String(e)}` })
          return
        }
      }

      resolve({ passed: 0, failed: 0, skipped: 0, duration: 0, testResults: [], error: `Playwright exited with code ${code} — no report generated` })
    })

    child.on('error', (err: Error) => {
      if (timedOut) return
      clearTimeout(timeout)
      resolve({ passed: 0, failed: 0, skipped: 0, duration: 0, testResults: [], error: err.message })
    })
  })
}

function parseReport(report: Record<string, unknown>): ExecutionResult {
  const testResults: TestResult[] = []
  let passed = 0, failed = 0, skipped = 0

  type RawSuite = { title?: string; specs?: RawSpec[]; suites?: RawSuite[] }
  type RawSpec = { title: string; tests?: { results?: { status?: string; duration?: number; error?: { message?: string; stack?: string } }[] }[] }

  function walkSuites(suites: RawSuite[]) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        const allResults = spec.tests?.[0]?.results ?? []
        // Use the last result — retries produce multiple results, final one is authoritative
        const result = allResults[allResults.length - 1]
        const status = (result?.status ?? 'skipped') as 'passed' | 'failed' | 'skipped'
        testResults.push({
          title: spec.title,
          status,
          duration: result?.duration ?? 0,
          error: result?.error?.message ?? undefined,
          errorStack: result?.error?.stack ?? undefined,
          retries: Math.max(0, allResults.length - 1),
        })
        if (status === 'passed') passed++
        else if (status === 'failed') failed++
        else skipped++
      }
      if (suite.suites) walkSuites(suite.suites)
    }
  }

  walkSuites((report.suites as RawSuite[]) ?? [])

  return { passed, failed, skipped, duration: (report.stats as { duration?: number })?.duration ?? 0, testResults }
}
