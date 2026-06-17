import { GoogleGenerativeAI } from '@google/generative-ai'
import Groq from 'groq-sdk'
import { JiraIssueFields } from '@/lib/jira/client'

// ─── Key pools (read all numbered keys from env) ──────────────────────────────

function readKeys(prefix: string): string[] {
  const keys: string[] = []
  for (let i = 1; i <= 10; i++) {
    const val = process.env[`${prefix}_${i}`]
    if (val && val.trim()) keys.push(val.trim())
  }
  return keys
}

const GEMINI_KEYS = readKeys('GEMINI_API_KEY')
const GROQ_KEYS = readKeys('GROQ_API_KEY')

// ─── Attempt matrix: every key × every model for each provider ────────────────

interface Attempt {
  provider: 'gemini' | 'groq'
  key: string
  model: string
  label: string
}

const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro']
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it']

function buildAttempts(): Attempt[] {
  const attempts: Attempt[] = []

  // For each Gemini model, try all Gemini keys before moving to next model
  for (const model of GEMINI_MODELS) {
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
      attempts.push({ provider: 'gemini', key: GEMINI_KEYS[i], model, label: `Gemini key${i + 1}/${model}` })
    }
  }

  // Then Groq: for each model, try all Groq keys
  for (const model of GROQ_MODELS) {
    for (let i = 0; i < GROQ_KEYS.length; i++) {
      attempts.push({ provider: 'groq', key: GROQ_KEYS[i], model, label: `Groq key${i + 1}/${model}` })
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
      } else {
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
      } else {
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
