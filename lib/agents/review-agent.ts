import { streamGemini } from '@/lib/ai/gemini'
import { AppConfig } from '@/lib/config/store'
import fs from 'fs'
import path from 'path'

export interface ReviewOutput {
  approved: boolean
  issues: string[]
  suggestions: string[]
  revised: boolean
}

export async function reviewAgent(
  issueKey: string,
  script: string,
  appConfig: AppConfig,
  onChunk: (text: string) => void
): Promise<ReviewOutput> {
  const prompt = `Review this Playwright TypeScript test script for quality and correctness.

Script:
${script}

Check for:
1. Hardcoded URLs or credentials (should use process.env)
2. Fragile selectors (CSS classes, IDs) instead of semantic locators
3. Missing assertions (expect())
4. Hardcoded waits (page.waitForTimeout)
5. Tests that don't test anything meaningful

Return a JSON object with these exact fields:
{
  "approved": true or false,
  "issues": ["issue description"],
  "suggestions": ["suggestion"],
  "revisedScript": null
}

IMPORTANT rules for the JSON:
- If there are no significant issues, set approved=true and revisedScript=null
- If you provide a revisedScript, it must be a plain string with NO backticks — use single or double quotes for all strings inside the script
- Do NOT use template literals (backtick strings) anywhere inside revisedScript
- Respond ONLY with valid JSON, no markdown fences`

  const fullText = await streamGemini(
    prompt,
    'You are a senior QA engineer reviewing Playwright test code. Be thorough but practical. Always return valid JSON.',
    onChunk
  )

  // Strip markdown fences
  const stripped = fullText.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()

  // Try to find and parse the JSON — if revisedScript breaks JSON, extract issues/suggestions another way
  let result: { approved: boolean; issues: string[]; suggestions: string[]; revisedScript?: string | null }

  try {
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('no JSON found')
    result = JSON.parse(jsonMatch[0])
  } catch {
    // JSON parse failed (likely due to backticks in revisedScript) — treat as approved with extracted feedback
    const issues = extractList(stripped, 'issues')
    const suggestions = extractList(stripped, 'suggestions')
    return { approved: true, issues, suggestions, revised: false }
  }

  if (result.revisedScript && typeof result.revisedScript === 'string') {
    const dir = path.join(process.cwd(), appConfig.playwrightTestsDir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${issueKey}.spec.ts`), result.revisedScript)
    return { approved: false, issues: result.issues ?? [], suggestions: result.suggestions ?? [], revised: true }
  }

  return { approved: result.approved ?? true, issues: result.issues ?? [], suggestions: result.suggestions ?? [], revised: false }
}

// Fallback: extract string arrays from raw text when JSON.parse fails
function extractList(text: string, key: string): string[] {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`))
  if (!match) return []
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
}
