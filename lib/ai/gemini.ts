import { GoogleGenerativeAI } from '@google/generative-ai'
import Groq from 'groq-sdk'
import OpenAI from 'openai'
import { JiraIssueFields } from '@/lib/jira/client'

// ─── Key pools (read all numbered keys from env) ──────────────────────────────

function readKeys(prefix: string): string[] {
  const keys: string[] = []
  for (let i = 1; i <= 20; i++) {
    const val = process.env[`${prefix}_${i}`]
    if (val && val.trim()) keys.push(val.trim())
  }
  return keys
}

const GEMINI_KEYS = readKeys('GEMINI_API_KEY')
const GROQ_KEYS = readKeys('GROQ_API_KEY')
const OPENROUTER_KEYS = readKeys('OPENROUTER_API_KEY')
const TOGETHER_KEYS = readKeys('TOGETHER_API_KEY')
const CEREBRAS_KEYS = readKeys('CEREBRAS_API_KEY')

// ─── Attempt matrix: every key × every model for each provider ────────────────

interface Attempt {
  provider: 'gemini' | 'groq' | 'openrouter' | 'together' | 'cerebras'
  key: string
  model: string
  label: string
}

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
  'gemini-2.5-flash-preview-04-17',
]
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
  'qwen-qwq-32b',
  'deepseek-r1-distill-llama-70b',
  'compound-beta',
]
const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct',
  'meta-llama/llama-3.1-70b-instruct',
  'mistralai/mistral-small-3.1-24b-instruct',
  'mistralai/mistral-nemo',
  'google/gemma-3-27b-it',
  'qwen/qwen-2.5-72b-instruct',
  'deepseek/deepseek-r1-distill-llama-70b',
  'nousresearch/hermes-3-llama-3.1-70b',
]
const TOGETHER_MODELS = [
  'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  'meta-llama/Llama-3.1-70B-Instruct-Turbo',
  'meta-llama/Llama-3.1-8B-Instruct-Turbo',
  'Qwen/Qwen2.5-72B-Instruct-Turbo',
  'mistralai/Mixtral-8x22B-Instruct-v0.1',
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
  'google/gemma-2-27b-it',
]
const CEREBRAS_MODELS = [
  'llama-3.3-70b',
  'llama-3.1-70b',
  'llama-3.1-8b',
  'llama3.1-70b',
  'llama3.1-8b',
]

function buildAttempts(): Attempt[] {
  const attempts: Attempt[] = []

  for (const model of GEMINI_MODELS) {
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
      attempts.push({ provider: 'gemini', key: GEMINI_KEYS[i], model, label: `Gemini key${i + 1}/${model}` })
    }
  }
  for (const model of GROQ_MODELS) {
    for (let i = 0; i < GROQ_KEYS.length; i++) {
      attempts.push({ provider: 'groq', key: GROQ_KEYS[i], model, label: `Groq key${i + 1}/${model}` })
    }
  }
  for (const model of OPENROUTER_MODELS) {
    for (let i = 0; i < OPENROUTER_KEYS.length; i++) {
      attempts.push({ provider: 'openrouter', key: OPENROUTER_KEYS[i], model, label: `OpenRouter key${i + 1}/${model}` })
    }
  }
  for (const model of TOGETHER_MODELS) {
    for (let i = 0; i < TOGETHER_KEYS.length; i++) {
      attempts.push({ provider: 'together', key: TOGETHER_KEYS[i], model, label: `Together key${i + 1}/${model}` })
    }
  }
  for (const model of CEREBRAS_MODELS) {
    for (let i = 0; i < CEREBRAS_KEYS.length; i++) {
      attempts.push({ provider: 'cerebras', key: CEREBRAS_KEYS[i], model, label: `Cerebras key${i + 1}/${model}` })
    }
  }

  return attempts
}

function isSkippableError(e: unknown): boolean {
  const msg = String(e)
  return (
    msg.includes('429') ||
    msg.includes('404') ||
    msg.includes('quota') ||
    msg.includes('not found') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('rate_limit') ||
    msg.includes('rate-limit') ||
    msg.includes('too_many_requests')
  )
}

// ─── Streaming (used by pipeline agents) ─────────────────────────────────────

export async function streamGemini(
  prompt: string,
  systemPrompt: string,
  onChunk: (text: string) => void
): Promise<string> {
  const attempts = buildAttempts()
  if (attempts.length === 0) throw new Error('No AI API keys configured. Add GEMINI_API_KEY_1 or GROQ_API_KEY_1 to .env.local')

  for (const attempt of attempts) {
    try {
      if (attempt.provider === 'gemini') {
        const client = new GoogleGenerativeAI(attempt.key)
        const m = client.getGenerativeModel({ model: attempt.model, systemInstruction: systemPrompt })
        const result = await m.generateContentStream(prompt)
        let fullText = ''
        for await (const chunk of result.stream) {
          const text = chunk.text()
          fullText += text
          onChunk(text)
        }
        console.log(`[AI] Streamed via ${attempt.label}`)
        return fullText
      } else if (attempt.provider === 'groq') {
        const groq = new Groq({ apiKey: attempt.key })
        const stream = await groq.chat.completions.create({
          model: attempt.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          stream: true,
        })
        let fullText = ''
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          fullText += text
          onChunk(text)
        }
        console.log(`[AI] Streamed via ${attempt.label}`)
        return fullText
      } else {
        // OpenAI-compatible: OpenRouter, Together AI, Cerebras
        const baseURL =
          attempt.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' :
          attempt.provider === 'together'    ? 'https://api.together.xyz/v1' :
                                               'https://api.cerebras.ai/v1'
        const client = new OpenAI({ apiKey: attempt.key, baseURL })
        const stream = await client.chat.completions.create({
          model: attempt.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          stream: true,
        })
        let fullText = ''
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          fullText += text
          onChunk(text)
        }
        console.log(`[AI] Streamed via ${attempt.label}`)
        return fullText
      }
    } catch (e) {
      if (isSkippableError(e)) {
        console.warn(`[AI] Quota/rate limit on ${attempt.label}, trying next...`)
        continue
      }
      throw e
    }
  }

  throw new Error('All AI keys and models exhausted. Add more API keys to .env.local')
}

// ─── LLM response cache (per-process, avoids redundant calls for identical prompts) ──

const llmCache = new Map<string, string>()
const LLM_CACHE_MAX = 500

function getCacheKey(prompt: string, systemPrompt: string): string {
  return `${systemPrompt.slice(0, 60)}||${prompt.slice(0, 200)}`
}

function cacheSet(key: string, value: string) {
  if (llmCache.size >= LLM_CACHE_MAX) {
    llmCache.delete(llmCache.keys().next().value!)
  }
  llmCache.set(key, value)
}

// ─── Non-streaming single call (step parsing, healing) ───────────────────────

export async function callLLM(prompt: string, systemPrompt: string): Promise<string> {
  const cacheKey = getCacheKey(prompt, systemPrompt)
  if (llmCache.has(cacheKey)) {
    console.log('[AI] callLLM cache hit')
    return llmCache.get(cacheKey)!
  }

  const attempts = buildAttempts()
  if (attempts.length === 0) throw new Error('No AI API keys configured. Add GEMINI_API_KEY_1 or GROQ_API_KEY_1 to .env.local')

  for (const attempt of attempts) {
    try {
      let text: string
      if (attempt.provider === 'gemini') {
        const client = new GoogleGenerativeAI(attempt.key)
        const m = client.getGenerativeModel({ model: attempt.model, systemInstruction: systemPrompt })
        const result = await m.generateContent(prompt)
        text = result.response.text()
      } else if (attempt.provider === 'groq') {
        const groq = new Groq({ apiKey: attempt.key })
        const result = await groq.chat.completions.create({
          model: attempt.model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
        })
        text = result.choices[0]?.message?.content ?? ''
      } else {
        const baseURL =
          attempt.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' :
          attempt.provider === 'together'    ? 'https://api.together.xyz/v1' :
                                               'https://api.cerebras.ai/v1'
        const client = new OpenAI({ apiKey: attempt.key, baseURL })
        const result = await client.chat.completions.create({
          model: attempt.model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
        })
        text = result.choices[0]?.message?.content ?? ''
      }
      console.log(`[AI] callLLM via ${attempt.label}`)
      cacheSet(cacheKey, text)
      return text
    } catch (e) {
      if (isSkippableError(e)) {
        console.warn(`[AI] Quota/rate limit on ${attempt.label}, trying next...`)
        continue
      }
      throw e
    }
  }
  throw new Error('All AI keys and models exhausted. Add more API keys to .env.local')
}

// ─── Non-streaming JSON generation (work item fields) ────────────────────────

export async function generateWorkItemFields(
  prompt: string,
  issueType: string
): Promise<JiraIssueFields> {
  const templates: Record<string, string> = {
    Story: `Generate a Jira User Story with:
- summary: concise title (max 80 chars)
- description: "As a [user], I want [goal], so that [benefit]" format with more detail
- acceptanceCriteria: bullet list of acceptance criteria (each on a new line starting with "- ")
- priority: High | Medium | Low`,

    Bug: `Generate a Jira Bug report with:
- summary: concise bug title (max 80 chars)
- description: brief overview of the bug
- stepsToReproduce: numbered steps to reproduce (each on new line "1. step")
- expectedResult: what should happen
- actualResult: what actually happens
- priority: Critical | High | Medium | Low`,

    Task: `Generate a Jira Task with:
- summary: concise task title (max 80 chars)
- description: detailed description of what needs to be done and why
- priority: High | Medium | Low`,

    'Test Case': `Generate a Jira Test Case with:
- summary: concise test case title (max 80 chars)
- description: overview of what is being tested
- preconditions: prerequisites before running the test (each on new line starting with "- ")
- testSteps: array of objects, each with "action" (string) and "expectedResult" (string)
- priority: High | Medium | Low`,

    Epic: `Generate a Jira Epic with:
- summary: concise epic title (max 80 chars)
- description: high-level description of the epic, its goal, and business value
- acceptanceCriteria: high-level success criteria (each on new line starting with "- ")
- priority: High | Medium | Low`,
  }

  const template = templates[issueType] ?? templates.Task
  const systemPrompt =
    'You are a QA/product expert creating well-structured Jira work items. Always respond with valid JSON only. No markdown, no explanation, just the JSON object.'
  const userPrompt = `Based on this requirement, ${template}

Requirement: "${prompt}"

Respond ONLY with a valid JSON object matching the fields described. Include "issueType": "${issueType}".`

  const attempts = buildAttempts()
  if (attempts.length === 0) throw new Error('No AI API keys configured. Add GEMINI_API_KEY_1 or GROQ_API_KEY_1 to .env.local')

  for (const attempt of attempts) {
    try {
      let text: string

      if (attempt.provider === 'gemini') {
        const client = new GoogleGenerativeAI(attempt.key)
        const m = client.getGenerativeModel({ model: attempt.model, systemInstruction: systemPrompt })
        const result = await m.generateContent(userPrompt)
        text = result.response.text()
      } else if (attempt.provider === 'groq') {
        const groq = new Groq({ apiKey: attempt.key })
        const result = await groq.chat.completions.create({
          model: attempt.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
        })
        text = result.choices[0]?.message?.content ?? ''
      } else {
        const baseURL =
          attempt.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' :
          attempt.provider === 'together'    ? 'https://api.together.xyz/v1' :
                                               'https://api.cerebras.ai/v1'
        const client = new OpenAI({ apiKey: attempt.key, baseURL })
        const result = await client.chat.completions.create({
          model: attempt.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        })
        text = result.choices[0]?.message?.content ?? ''
      }

      const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
      const jsonMatch = stripped.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        console.warn(`[AI] ${attempt.label} returned non-JSON, trying next...`)
        continue
      }

      console.log(`[AI] Generated fields via ${attempt.label}`)
      return JSON.parse(jsonMatch[0]) as JiraIssueFields
    } catch (e) {
      if (isSkippableError(e)) {
        console.warn(`[AI] Quota/rate limit on ${attempt.label}, trying next...`)
        continue
      }
      throw e
    }
  }

  throw new Error('All AI keys and models exhausted. Add more API keys to .env.local')
}
