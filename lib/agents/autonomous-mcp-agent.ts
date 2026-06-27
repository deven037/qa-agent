/**
 * Autonomous MCP Browser Agent
 *
 * Receives the FULL test case in ONE conversation and drives the browser
 * autonomously — the same way VS Code AI chat with @playwright/mcp works.
 * The model plans, explores, recovers from failures, and reports step results
 * itself via synthetic tools (mark_step, mark_tc_done).
 *
 * Uses a single OpenAI-compatible code path for all providers:
 * Gemini 2.5 Flash (via Google's OpenAI-compat endpoint) → Groq → Together → OpenRouter → Cerebras
 */

import path from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import OpenAI from 'openai'
import { AppConfig, formatCredentialsForLLM } from '@/lib/config/store'
import { TestCase } from '@/lib/agents/testcase-agent'
import { AgentEvent, ExecutionResult } from '@/lib/agents/playwright-mcp-agent'

// ─── Provider pool (all via OpenAI-compat) ────────────────────────────────────

interface Provider { client: OpenAI; model: string; label: string }

function readKeys(prefix: string): string[] {
  const keys: string[] = []
  for (let i = 1; i <= 20; i++) {
    const v = process.env[`${prefix}_${i}`]
    if (v?.trim()) keys.push(v.trim())
  }
  return keys
}

function buildProviderPool(): Provider[] {
  const pool: Provider[] = []

  // Gemini 2.5 Flash via Google's OpenAI-compatible endpoint — best reasoning
  for (const key of readKeys('GEMINI_API_KEY')) {
    pool.push({
      client: new OpenAI({ apiKey: key, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' }),
      model: 'gemini-2.5-flash-preview-04-17',
      label: 'Gemini 2.5 Flash',
    })
  }
  // Gemini 2.0 Flash — fast fallback
  for (const key of readKeys('GEMINI_API_KEY')) {
    pool.push({
      client: new OpenAI({ apiKey: key, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' }),
      model: 'gemini-2.0-flash',
      label: 'Gemini 2.0 Flash',
    })
  }
  // Groq
  for (const key of readKeys('GROQ_API_KEY')) {
    pool.push({
      client: new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' }),
      model: 'llama-3.3-70b-versatile',
      label: 'Groq Llama-3.3-70B',
    })
  }
  // Together
  for (const key of readKeys('TOGETHER_API_KEY')) {
    pool.push({
      client: new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' }),
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      label: 'Together Llama-3.3-70B',
    })
  }
  // OpenRouter
  for (const key of readKeys('OPENROUTER_API_KEY')) {
    pool.push({
      client: new OpenAI({ apiKey: key, baseURL: 'https://openrouter.ai/api/v1' }),
      model: 'meta-llama/llama-3.3-70b-instruct',
      label: 'OpenRouter Llama-3.3-70B',
    })
  }
  // Cerebras
  for (const key of readKeys('CEREBRAS_API_KEY')) {
    pool.push({
      client: new OpenAI({ apiKey: key, baseURL: 'https://api.cerebras.ai/v1' }),
      model: 'llama-3.3-70b',
      label: 'Cerebras Llama-3.3-70B',
    })
  }
  // Sambanova — fast inference, free tier
  for (const key of readKeys('SAMBANOVA_API_KEY')) {
    pool.push({
      client: new OpenAI({ apiKey: key, baseURL: 'https://api.sambanova.ai/v1' }),
      model: 'Meta-Llama-3.3-70B-Instruct',
      label: 'Sambanova Llama-3.3-70B',
    })
  }

  if (pool.length === 0) throw new Error('No API keys found. Add GEMINI_API_KEY_1 or GROQ_API_KEY_1.')
  return pool
}

function isRateLimit(e: unknown): boolean {
  const s = String(e)
  return s.includes('429') || s.includes('rate_limit') || s.includes('quota') || s.includes('RESOURCE_EXHAUSTED') || s.includes('TPD') || s.includes('RPM')
}

function isFunctionCallingError(e: unknown): boolean {
  const s = String(e)
  // Groq/Llama: too many tools or schema too complex → rotate provider
  return s.includes('failed_generation') || s.includes('Failed to call a function') || s.includes('tool_use_failed')
}

// Llama models struggle with 23+ complex MCP tool schemas — whitelist essentials only
const LLAMA_ALLOWED_TOOLS = new Set([
  'browser_snapshot',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_select_option',
  'browser_press_key',
  'browser_wait_for',
  'browser_take_screenshot',
])

function isLlamaProvider(label: string): boolean {
  return label.toLowerCase().includes('llama') || label.toLowerCase().includes('groq') || label.toLowerCase().includes('together') || label.toLowerCase().includes('cerebras')
}

// ─── Tool schema cleaning ─────────────────────────────────────────────────────
// MCP tools use full JSON Schema; most LLM APIs don't accept $schema, $ref, etc.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema
  const { $schema, $ref, additionalProperties, ...rest } = schema
  void $schema; void $ref; void additionalProperties
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rest)) {
    if (Array.isArray(v)) {
      result[k] = v.map(cleanSchema)
    } else if (typeof v === 'object' && v !== null) {
      result[k] = cleanSchema(v)
    } else {
      result[k] = v
    }
  }
  return result
}

// ─── Synthetic tool definitions ───────────────────────────────────────────────

const SYNTHETIC_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'mark_step',
      description: 'Report the status of a numbered test step. ONLY call this AFTER you have called browser_snapshot and confirmed the page state matches the expected result. Never call mark_step without first verifying via snapshot.',
      parameters: {
        type: 'object',
        properties: {
          stepIndex: { type: 'number', description: '0-based index of the step in the test case list' },
          status: { type: 'string', enum: ['passed', 'failed'] },
          message: { type: 'string', description: 'Brief description of what happened' },
        },
        required: ['stepIndex', 'status', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_tc_done',
      description: 'Signal that the entire test case is complete. Must be the LAST call you make.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['passed', 'failed'] },
          reason: { type: 'string', description: 'Summary of the overall outcome' },
        },
        required: ['status', 'reason'],
      },
    },
  },
]

// ─── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(tc: TestCase, appConfig: AppConfig): string {
  const base = appConfig.baseUrl.replace(/\/$/, '')
  const creds = formatCredentialsForLLM(appConfig)
  const steps = tc.steps.map((s, i) =>
    `  ${i}. ${s.replace(/\s*\[inferred\]/gi, '')}${tc.stepExpected?.[i] ? ` → expected: ${tc.stepExpected[i]}` : ''}`
  ).join('\n')

  return `You are an expert QA automation engineer controlling a real browser via Playwright tools.
You have been given a COMPLETE test case. Drive the browser autonomously from start to finish.

## App
Base URL: ${base}
${creds}

## Test Case
Title: ${tc.title}
Steps (0-indexed):
${steps}
Overall expected: ${tc.expectedResult}

## Your Mission
Execute every step using browser tools. After EACH step, call mark_step(stepIndex, status, message).
When ALL steps are done (or you are truly stuck), call mark_tc_done(status, reason).

## MANDATORY step execution flow (follow this EXACTLY for every step)
1. Perform the action (navigate / fill / click / etc.)
2. Call browser_snapshot — read what is on the page RIGHT NOW
3. Verify the snapshot contains evidence the action worked (expected text, element, URL change)
4. ONLY THEN call mark_step — pass if evidence found, fail if not

You MUST call browser_snapshot after every action before calling mark_step.
DO NOT call mark_step without first reading the current page state via browser_snapshot.
Ignoring errors and marking passed without evidence is a critical failure.

## Evidence rules
- After navigate: snapshot must show the expected page title/heading or URL
- After fill/type: snapshot must show the field has a value
- After click (button/link): snapshot must show a page change, success message, or new content
- After login: snapshot must show account dashboard or username in nav — NOT the login form
- If snapshot shows the same page or an error: the action FAILED, retry or mark failed

## CRITICAL Navigation Rules
1. If browser_navigate returns any error: call browser_snapshot to check what loaded — sites redirect.
2. If direct path fails: navigate to ${base}, snapshot, find the correct link in the nav, click it.
3. NEVER mark passed after only 1 tool call. Minimum: action → snapshot → verify → mark.
4. Steps marked [inferred] mean the path was unknown — explore via snapshot and find the feature yourself.
5. For login forms: use browser_fill_form with BOTH username AND password fields, then click login.

## Retry pattern
If snapshot doesn't show expected state:
  1. Try the action again with a different locator (read refs from the snapshot)
  2. Wait with browser_wait_for if content is loading
  3. After 3 failed attempts: mark_step failed with exact reason

## Tool budget: ~80 browser tool calls. Every step needs: action + snapshot + verify.`
}

// ─── MCP client setup ──────────────────────────────────────────────────────────

async function spawnMcpClient(browserType: string): Promise<Client> {
  const { chromium, firefox, webkit } = await import('playwright')
  const executablePath = browserType === 'firefox'
    ? firefox.executablePath()
    : browserType === 'webkit'
    ? webkit.executablePath()
    : chromium.executablePath()

  // Use locally installed @playwright/mcp binary — avoids npx download at runtime in Docker
  const mcpCli = path.join(process.cwd(), 'node_modules', '@playwright', 'mcp', 'cli.js')
  // Use /tmp for user data so it's always writable (avoids EACCES in Docker)
  const userDataDir = `/tmp/pw-mcp-${Date.now()}`

  const transport = new StdioClientTransport({
    command: 'node',
    args: [
      mcpCli,
      '--headless',
      '--viewport-size=1280,800',
      '--no-sandbox',
      `--executable-path=${executablePath}`,
      `--user-data-dir=${userDataDir}`,
      ...(browserType === 'firefox' ? ['--browser=firefox'] : browserType === 'webkit' ? ['--browser=webkit'] : []),
    ],
  })
  const client = new Client({ name: 'qa-agent-autonomous', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)
  return client
}

// ─── Step state ───────────────────────────────────────────────────────────────

interface StepState {
  confirmedSteps: Record<number, 'passed' | 'failed'>
  done: boolean
  tcStatus: 'passed' | 'failed'
  tcReason: string
  turnCount: number
  lastSig: string
  repeatCount: number
}

// ─── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
  client: Client,
  tc: TestCase,
  state: StepState,
  onEvent: (e: AgentEvent) => void,
): Promise<string> {
  // Synthetic tools — handled client-side
  if (name === 'mark_step') {
    const { stepIndex, status, message } = args as { stepIndex: number; status: 'passed' | 'failed'; message: string }
    if (!(stepIndex in state.confirmedSteps)) {
      onEvent({ type: 'step_start', tcId: tc.id, stepIndex, step: tc.steps[stepIndex] ?? `Step ${stepIndex + 1}` })
      // Capture screenshot as proof before confirming the step
      try {
        const ssResult = await client.callTool({ name: 'browser_take_screenshot', arguments: {} })
        const ssContent = ssResult.content as Array<{ type: string; data?: string; text?: string }>
        const imgPart = ssContent.find(c => c.type === 'image' && c.data)
        if (imgPart?.data) {
          onEvent({ type: 'step_screenshot', tcId: tc.id, stepIndex, screenshot: imgPart.data })
        }
      } catch { /* screenshot failure is non-fatal */ }
      onEvent({ type: 'step_done', tcId: tc.id, stepIndex, status, error: status === 'failed' ? message : undefined })
      state.confirmedSteps[stepIndex] = status
    }
    return JSON.stringify({ ok: true })
  }

  if (name === 'mark_tc_done') {
    const { status, reason } = args as { status: 'passed' | 'failed'; reason: string }
    // Emit any unconfirmed steps as skipped
    for (let i = 0; i < tc.steps.length; i++) {
      if (!(i in state.confirmedSteps)) {
        onEvent({ type: 'step_start', tcId: tc.id, stepIndex: i, step: tc.steps[i] })
        onEvent({ type: 'step_done', tcId: tc.id, stepIndex: i, status: 'failed', error: 'Not reached' })
      }
    }
    state.done = true
    state.tcStatus = status
    state.tcReason = reason
    return JSON.stringify({ ok: true })
  }

  // MCP browser tools
  try {
    const cleanArgs = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null && v !== undefined))
    const result = await client.callTool({ name, arguments: cleanArgs })
    const content = result.content as Array<{ type: string; text?: string }>
    const text = content.map(c => c.text ?? '').join('\n')
    const truncated = name === 'browser_snapshot' ? text.slice(0, 3000) : text.slice(0, 2000)
    if (result.isError) {
      const isHttpError = truncated.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') || truncated.includes('ERR_CONNECTION_REFUSED')
      if (isHttpError) {
        return truncated + '\n\nNOTE: HTTP error — page may have loaded via redirect. Call browser_snapshot to check current state before giving up.'
      }
      onEvent({ type: 'agent_thinking', text: `  ✗ ${truncated.slice(0, 150)}` })
    }
    return truncated
  } catch (err) {
    return `Error calling ${name}: ${String(err)}`
  }
}

// ─── Single-provider conversation loop ───────────────────────────────────────

async function runConversation(
  provider: Provider,
  tc: TestCase,
  appConfig: AppConfig,
  client: Client,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mcpTools: any[],
  state: StepState,
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  // Llama-based models (Groq/Together/OpenRouter/Cerebras) fail with 23+ complex schemas
  // Gemini handles the full tool list fine via OpenAI-compat
  const toolFilter = isLlamaProvider(provider.label)
    ? (t: { name: string }) => LLAMA_ALLOWED_TOOLS.has(t.name)
    : () => true

  const allTools: OpenAI.ChatCompletionTool[] = [
    ...SYNTHETIC_TOOLS,
    ...mcpTools.filter(toolFilter).map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: (t.description ?? '').slice(0, 400),
        parameters: cleanSchema(t.inputSchema) ?? { type: 'object', properties: {} },
      },
    })),
  ]

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(tc, appConfig) },
    { role: 'user', content: 'Execute the test case now. Start by navigating to the app and work through each step in order.' },
  ]

  while (!state.done) {
    // Loop / budget guard
    if (state.turnCount > 80) {
      state.done = true; state.tcStatus = 'failed'; state.tcReason = 'Turn budget exceeded (>80 calls)'
      break
    }

    let response: OpenAI.ChatCompletion
    try {
      response = await provider.client.chat.completions.create({
        model: provider.model,
        tools: allTools,
        messages,
        tool_choice: 'auto',
        temperature: 0,
        max_tokens: 4096,
      })
    } catch (err) {
      if (isRateLimit(err)) throw err  // let caller rotate provider
      onEvent({ type: 'log', text: `[Auto] LLM error: ${String(err).slice(0, 200)}` })
      throw err
    }

    const msg = response.choices[0].message
    messages.push(msg)

    // Stream any narration text as agent thinking
    if (msg.content?.trim()) {
      onEvent({ type: 'agent_thinking', text: msg.content })
    }

    if (!msg.tool_calls?.length) {
      // Model stopped without calling mark_tc_done
      if (!state.done) {
        state.done = true; state.tcStatus = 'failed'; state.tcReason = 'Agent stopped without calling mark_tc_done'
      }
      break
    }

    const toolResults: OpenAI.ChatCompletionToolMessageParam[] = []

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue

      const argsStr = call.function.arguments.slice(0, 150)
      onEvent({ type: 'agent_thinking', text: `→ ${call.function.name}(${argsStr})` })
      state.turnCount++

      // Loop detection: same call 3× in a row
      const sig = `${call.function.name}::${call.function.arguments.slice(0, 80)}`
      if (sig === state.lastSig) {
        state.repeatCount++
        if (state.repeatCount >= 3) {
          state.done = true; state.tcStatus = 'failed'; state.tcReason = 'Loop detected — same tool called 3× in a row'
          break
        }
      } else {
        state.lastSig = sig; state.repeatCount = 0
      }

      let parsedArgs: Record<string, unknown> = {}
      try { parsedArgs = JSON.parse(call.function.arguments || '{}') } catch { /* use empty */ }

      const toolResult = await executeTool(call.function.name, parsedArgs as Record<string, unknown>, client, tc, state, onEvent)
      toolResults.push({ role: 'tool', tool_call_id: call.id, content: toolResult })

      if (state.done) break
    }

    messages.push(...toolResults)
  }
}

// ─── Per-TC runner with provider fallback ─────────────────────────────────────

async function runTestCase(
  tc: TestCase,
  appConfig: AppConfig,
  pool: Provider[],
  browserType: string,
  onEvent: (e: AgentEvent) => void,
): Promise<{ status: 'passed' | 'failed'; duration: number; error?: string }> {
  const tcStart = Date.now()
  onEvent({ type: 'tc_start', id: tc.id, title: tc.title })

  let client: Client | null = null
  const state: StepState = {
    confirmedSteps: {},
    done: false,
    tcStatus: 'failed',
    tcReason: '',
    turnCount: 0,
    lastSig: '',
    repeatCount: 0,
  }

  try {
    client = await spawnMcpClient(browserType)
    onEvent({ type: 'log', text: `[Auto] Browser started (${browserType}, headless)` })

    const { tools: mcpTools } = await client.listTools()
    onEvent({ type: 'log', text: `[Auto] ${mcpTools.length} MCP tools available` })

    // Try providers in order, rotate on rate limit
    let lastErr: unknown
    for (const provider of pool) {
      try {
        onEvent({ type: 'log', text: `[Auto] Using ${provider.label}` })
        // Reset state for retry
        state.done = false; state.turnCount = 0; state.lastSig = ''; state.repeatCount = 0
        state.confirmedSteps = {}; state.tcStatus = 'failed'; state.tcReason = ''
        await runConversation(provider, tc, appConfig, client, mcpTools, state, onEvent)
        lastErr = undefined
        break
      } catch (err) {
        lastErr = err
        if (isRateLimit(err)) {
          onEvent({ type: 'log', text: `[Auto] Rate limit on ${provider.label} — rotating…` })
          continue
        }
        if (isFunctionCallingError(err)) {
          onEvent({ type: 'log', text: `[Auto] Tool schema rejected by ${provider.label} — rotating to next provider…` })
          continue
        }
        onEvent({ type: 'log', text: `[Auto] Error on ${provider.label}: ${String(err).slice(0, 200)} — trying next provider…` })
        continue
      }
    }
    if (lastErr && !state.done) {
      state.tcStatus = 'failed'
      state.tcReason = String(lastErr)
      onEvent({ type: 'log', text: `[Auto] All providers failed: ${state.tcReason.slice(0, 200)}` })
    }
  } catch (err) {
    state.tcStatus = 'failed'
    state.tcReason = String(err)
    onEvent({ type: 'log', text: `[Auto] Fatal error: ${state.tcReason.slice(0, 200)}` })
  } finally {
    try { await client?.close() } catch { /* already closed */ }
  }

  const duration = Date.now() - tcStart
  onEvent({ type: 'tc_done', id: tc.id, status: state.tcStatus, duration })

  return {
    status: state.tcStatus,
    duration,
    error: state.tcStatus === 'failed' ? state.tcReason : undefined,
  }
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function autonomousMcpAgent(
  testCases: TestCase[],
  appConfig: AppConfig,
  onEvent: (e: AgentEvent) => void,
  options: { browser?: string } = {},
): Promise<ExecutionResult> {
  const pool = buildProviderPool()
  const browserType = options.browser ?? 'chromium'
  const start = Date.now()
  const tcResults: ExecutionResult['testResults'] = []

  for (const tc of testCases) {
    const { status, duration, error } = await runTestCase(tc, appConfig, pool, browserType, onEvent)
    tcResults.push({ title: `${tc.id}: ${tc.title}`, status, duration, error, retries: 0 })
  }

  const passed = tcResults.filter(t => t.status === 'passed').length
  const failed = tcResults.filter(t => t.status === 'failed').length
  const skipped = tcResults.filter(t => t.status === 'skipped').length

  return { passed, failed, skipped, duration: Date.now() - start, testResults: tcResults }
}
