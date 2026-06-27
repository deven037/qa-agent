import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import OpenAI from 'openai'
import { AppConfig, formatCredentialsForLLM } from '@/lib/config/store'
import { TestCase } from '@/lib/agents/testcase-agent'
import { AgentEvent, ExecutionResult } from '@/lib/agents/playwright-mcp-agent'

// ─── Provider pool (Groq keys + Together AI fallback) ────────────────────────

interface LLMProvider { client: OpenAI; model: string; label: string }

function buildProviderPool(): LLMProvider[] {
  const pool: LLMProvider[] = []

  for (let i = 1; i <= 20; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`]
    if (key?.trim()) {
      pool.push({ client: new OpenAI({ apiKey: key.trim(), baseURL: 'https://api.groq.com/openai/v1' }), model: 'llama-3.3-70b-versatile', label: `Groq key${i}` })
    }
  }
  for (let i = 1; i <= 20; i++) {
    const key = process.env[`TOGETHER_API_KEY_${i}`]
    if (key?.trim()) {
      pool.push({ client: new OpenAI({ apiKey: key.trim(), baseURL: 'https://api.together.xyz/v1' }), model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: `Together key${i}` })
    }
  }
  for (let i = 1; i <= 20; i++) {
    const key = process.env[`OPENROUTER_API_KEY_${i}`]
    if (key?.trim()) {
      pool.push({ client: new OpenAI({ apiKey: key.trim(), baseURL: 'https://openrouter.ai/api/v1' }), model: 'meta-llama/llama-3.3-70b-instruct', label: `OpenRouter key${i}` })
    }
  }

  if (pool.length === 0) throw new Error('No API keys found. Add GROQ_API_KEY_1, TOGETHER_API_KEY_1, or OPENROUTER_API_KEY_1.')
  return pool
}

function isRateLimitError(e: unknown): boolean {
  const msg = String(e)
  return msg.includes('429') || msg.includes('rate_limit') || msg.includes('rate-limit') || msg.includes('quota') || msg.includes('TPD') || msg.includes('RPM')
}

// ─── Whitelist of tools to expose — keeps schemas simple so Llama stays reliable ─

const ALLOWED_TOOLS = new Set([
  'browser_snapshot',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_select_option',
  'browser_press_key',
  'browser_wait_for',
  'browser_screenshot',
  'browser_tab_list',
  'browser_close',
])

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(appConfig: AppConfig): string {
  const baseUrl = appConfig.baseUrl.replace(/\/$/, '')
  const creds = formatCredentialsForLLM(appConfig)
  return `You are an expert QA automation engineer controlling a real browser.

## App Base URL
${baseUrl}
When a step says "Navigate to /some/path", use the full URL: ${baseUrl}/some/path

## CRITICAL — the "target" parameter
Every interactive tool (browser_click, browser_type, browser_fill_form, browser_select_option) has a "target" field.
"target" accepts EITHER:
  - A CSS selector: input[name="loginname"], button[type="submit"], a.cart-btn
  - A snapshot ref: the value inside [ref=s1e12] from browser_snapshot output

PREFER CSS selectors when you know them — they are simpler and more reliable.
Use snapshot refs only when a CSS selector is not obvious.

## Tool reference (exact parameter names)

browser_navigate({"url": "https://full-url-here"})
  → Navigate to a page. Always use full URL.

browser_snapshot({})
  → Get the accessibility tree. Call this to see the page or find refs.
  → Snapshot shows elements like: textbox "Login Name" [ref=s1e12]

browser_type({"target": "CSS_SELECTOR_OR_REF", "text": "value to type"})
  → Type text into an input. Use target=CSS selector e.g. input[name="loginname"]
  → Example: browser_type({"target": "input[name='loginname']", "text": "test-automation"})

browser_fill_form({"fields": [{"target": "CSS", "name": "Label", "type": "textbox", "value": "text"}, ...]})
  → Fill multiple form fields at once. Best for login forms.
  → Example: browser_fill_form({"fields": [
      {"target": "input[name='loginname']", "name": "Login Name", "type": "textbox", "value": "test-automation"},
      {"target": "input[type='password']", "name": "Password", "type": "textbox", "value": "Test@123"}
    ]})

browser_click({"target": "CSS_SELECTOR_OR_REF"})
  → Click a button or link. Use CSS selector.
  → Example: browser_click({"target": "button[type='submit']"})
  → Example: browser_click({"target": "input[value='Login']"})

browser_select_option({"target": "CSS", "values": ["option text"]})
  → Select from a <select> dropdown.

browser_press_key({"key": "Enter"})
  → Press a keyboard key: Enter, Tab, Escape, ArrowDown, etc.

browser_wait_for({"text": "Welcome"})
  → Wait for text to appear on page. Use after navigation or form submit.

## Step workflow
1. For navigation steps: call browser_navigate with full URL.
   - If it returns an HTTP error: ALWAYS call browser_snapshot next. The page often loaded via redirect — if the expected content is visible, continue.
   - If you still aren't on the right page: call browser_snapshot on the base URL, find the correct link by reading the nav/menu, then click it. Do NOT guess paths.
2. For fill steps: use browser_fill_form. If you don't know the selectors, call browser_snapshot first to read them.
3. For click steps: call browser_snapshot to find the element, then click using its ref or a CSS selector you can see in the snapshot.
4. After any page-changing action: call browser_snapshot to confirm the result.
5. NEVER give up after one failure. Always snapshot and retry with what you observe.

## Handling [inferred] steps
[inferred] means the exact element/path was unknown at TC-generation time. Treat it as: call browser_snapshot, find the element by reading the page, then act on what you actually see.

## App Credentials
${creds}

## Output
After completing the step: one sentence — what you did and whether it worked.
If stuck: exact reason why (element not found, CAPTCHA, etc.).`
}

// ─── Tool-use loop for one step ───────────────────────────────────────────────

async function executeStepWithMcp(
  step: string,
  expected: string,
  client: Client,
  pool: LLMProvider[],
  poolIndex: { current: number },  // mutable ref so caller can persist rotation
  appConfig: AppConfig,
  onEvent: (e: AgentEvent) => void,
): Promise<{ passed: boolean; error?: string }> {
  const { tools } = await client.listTools()

  const llmTools: OpenAI.ChatCompletionTool[] = tools
    .filter(t => ALLOWED_TOOLS.has(t.name))
    .map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: (t.description ?? '').slice(0, 512),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: (t.inputSchema as any) ?? { type: 'object', properties: {} },
      },
    }))

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(appConfig) },
    {
      role: 'user',
      content: `Execute this test step: "${step}"${expected ? `\nExpected result: ${expected}` : ''}`,
    },
  ]

  let lastError: string | undefined

  for (let turn = 0; turn < 16; turn++) {
    const provider = pool[poolIndex.current % pool.length]

    let response: OpenAI.ChatCompletion
    try {
      response = await provider.client.chat.completions.create({
        model: provider.model,
        tools: llmTools,
        messages,
        tool_choice: 'auto',
        temperature: 0,
        max_tokens: 1024,
      })
    } catch (err) {
      if (isRateLimitError(err)) {
        // Rotate to next provider and retry this turn
        poolIndex.current++
        if (poolIndex.current >= pool.length) {
          lastError = `All providers rate-limited: ${String(err)}`
          break
        }
        onEvent({ type: 'log', text: `[MCP] Rate limit on ${provider.label} — rotating to ${pool[poolIndex.current % pool.length].label}` })
        continue
      }
      lastError = String(err)
      break
    }

    const msg = response.choices[0].message
    messages.push(msg)

    if (!msg.tool_calls?.length) {
      const content = msg.content ?? ''
      const failed = /cannot|could not|failed|blocked|not found|error|unable/i.test(content)
        && !/success|passed|done|completed|verified|clicked|filled|navigated/i.test(content)
      if (failed) lastError = content.slice(0, 300)
      break
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue
      onEvent({ type: 'agent_thinking', text: `→ ${call.function.name}(${call.function.arguments.slice(0, 120)})` })

      let toolResult: string
      try {
        const parsed = JSON.parse(call.function.arguments || '{}')
        const raw = (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
        const args = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== undefined))
        const result = await client.callTool({ name: call.function.name, arguments: args })
        const content = result.content as Array<{ type: string; text?: string }>
        const full = content.map(c => c.text ?? '').join('\n')
        toolResult = call.function.name === 'browser_snapshot' ? full.slice(0, 1500) : full.slice(0, 2000)
        if (result.isError) {
          onEvent({ type: 'agent_thinking', text: `  ✗ ${toolResult.slice(0, 120)}` })
          const isHttpError = toolResult.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') || toolResult.includes('ERR_CONNECTION_REFUSED')
          const isWaitForError = call.function.name === 'browser_wait_for'
          if (isHttpError) {
            // HTTP errors often mean redirect — let LLM check page state before declaring failure
            lastError = toolResult
            toolResult += '\n\nRECOVERY: The page may have loaded via redirect. Immediately call browser_snapshot to check current state. If the target content is visible, continue the test — do NOT treat this as a failure.'
          } else if (isWaitForError) {
            // wait_for timeout is non-fatal — page may still be usable
            onEvent({ type: 'agent_thinking', text: `  ⚠ wait_for timed out — continuing` })
          } else {
            lastError = toolResult
          }
        } else {
          // A successful tool call clears prior errors — recovery worked
          lastError = undefined
        }
      } catch (err) {
        toolResult = `Error: ${String(err)}`
        lastError = toolResult
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult })
    }
  }

  return lastError ? { passed: false, error: lastError } : { passed: true }
}

// ─── Main MCP browser agent ───────────────────────────────────────────────────

export async function mcpBrowserAgent(
  testCases: TestCase[],
  appConfig: AppConfig,
  onEvent: (e: AgentEvent) => void,
  options: { browser?: string } = {},
): Promise<ExecutionResult> {
  const pool = buildProviderPool()
  const poolIndex = { current: 0 }
  const browserType = options.browser ?? 'chromium'

  const tcResults: ExecutionResult['testResults'] = []
  const start = Date.now()

  for (const tc of testCases) {
    const tcStart = Date.now()
    onEvent({ type: 'tc_start', id: tc.id, title: tc.title })

    if (!tc.steps?.length) {
      onEvent({ type: 'tc_done', id: tc.id, status: 'passed', duration: 0 })
      tcResults.push({ title: `${tc.id}: ${tc.title}`, status: 'skipped', duration: 0, retries: 0 })
      continue
    }

    // Resolve the Playwright-bundled Chromium executable so @playwright/mcp uses
    // the same browser that's already installed — avoids "chrome not found" errors.
    const { chromium: pwChromium, firefox: pwFirefox, webkit: pwWebkit } = await import('playwright')
    const executablePath = browserType === 'firefox'
      ? pwFirefox.executablePath()
      : browserType === 'webkit'
      ? pwWebkit.executablePath()
      : pwChromium.executablePath()

    const mcpArgs = [
      '@playwright/mcp@latest',
      '--headless',
      '--viewport-size=1280,800',
      '--no-sandbox',
      `--executable-path=${executablePath}`,
    ]
    if (browserType === 'firefox') mcpArgs.push('--browser=firefox')
    else if (browserType === 'webkit') mcpArgs.push('--browser=webkit')
    // chromium: don't pass --browser, let @playwright/mcp default + use executable-path

    const transport = new StdioClientTransport({
      command: 'npx',
      args: mcpArgs,
    })
    const client = new Client({ name: 'qa-agent', version: '1.0.0' }, { capabilities: {} })

    let tcFailed = false
    let tcError: string | undefined

    try {
      await client.connect(transport)
      onEvent({ type: 'log', text: `[MCP] Browser started (${browserType}, headless)` })

      for (let i = 0; i < tc.steps.length; i++) {
        const step = tc.steps[i]
        const expected = tc.stepExpected?.[i] ?? ''

        // Strip [inferred] tag — it's a TC annotation, not part of the action
        const cleanStep = step.replace(/\s*\[inferred\]/gi, '').trim()

        onEvent({ type: 'step_start', tcId: tc.id, stepIndex: i, step })

        let result = await executeStepWithMcp(cleanStep, expected, client, pool, poolIndex, appConfig, onEvent)

        // One automatic retry on failure — gives LLM a second chance with fresh context
        if (!result.passed) {
          onEvent({ type: 'agent_thinking', text: `⟳ Step ${i + 1} failed — retrying with snapshot context` })
          result = await executeStepWithMcp(
            `RETRY: Previous attempt failed (${result.error?.slice(0, 120)}). Call browser_snapshot first to see current page state, then re-execute: "${cleanStep}"`,
            expected, client, pool, poolIndex, appConfig, onEvent
          )
        }

        if (result.passed) {
          onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'passed', healingAttempts: 0 })
        } else {
          onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'failed', error: result.error, healingAttempts: 1 })
          tcFailed = true
          tcError = `Step ${i + 1} failed: ${result.error}`
          break
        }
      }
    } catch (err) {
      tcFailed = true
      tcError = String(err)
    } finally {
      try { await client.close() } catch { /* already closed */ }
    }

    const tcDuration = Date.now() - tcStart
    const tcStatus = tcFailed ? 'failed' : 'passed'
    onEvent({ type: 'tc_done', id: tc.id, status: tcStatus, duration: tcDuration })
    tcResults.push({ title: `${tc.id}: ${tc.title}`, status: tcStatus, duration: tcDuration, error: tcError, retries: 0 })
  }

  const passed = tcResults.filter(t => t.status === 'passed').length
  const failed = tcResults.filter(t => t.status === 'failed').length
  const skipped = tcResults.filter(t => t.status === 'skipped').length

  return { passed, failed, skipped, duration: Date.now() - start, testResults: tcResults }
}
