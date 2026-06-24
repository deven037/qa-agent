import { streamGemini } from '@/lib/ai/gemini'
import { fillPrompt } from '@/lib/prompts/loader'
import { AppConfig } from '@/lib/config/store'

export interface ReviewIssue {
  severity: 'critical' | 'warning' | 'suggestion'
  category: string
  line?: number
  message: string
  fix?: string
}

export interface CodeReviewOutput {
  score: number
  approved: boolean
  summary: string
  issues: ReviewIssue[]
  revisedCode?: string
}

export async function codeReviewerAgent(
  code: string,
  appConfig: AppConfig,
  onChunk: (text: string) => void,
): Promise<CodeReviewOutput> {
  const prompt = fillPrompt('code-reviewer', { code })

  const fullText = await streamGemini(
    prompt,
    'You are a principal QA automation engineer and architect. Review code like you will maintain it for 2 years. Be direct and specific. Return valid JSON only — no markdown fences.',
    onChunk,
  )

  const stripped = fullText.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()

  try {
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    const result = JSON.parse(jsonMatch[0]) as CodeReviewOutput

    return {
      score: Math.max(0, Math.min(100, Math.round(result.score ?? 50))),
      approved: (result.score ?? 50) >= 70,
      summary: result.summary ?? 'Review completed.',
      issues: (result.issues ?? []).map((issue) => ({
        severity: issue.severity ?? 'suggestion',
        category: issue.category ?? 'General',
        line: issue.line,
        message: issue.message ?? '',
        fix: issue.fix,
      })),
      revisedCode: result.revisedCode ?? undefined,
    }
  } catch {
    return {
      score: 50,
      approved: false,
      summary: 'Review could not be parsed. Manual inspection required.',
      issues: [{ severity: 'warning', category: 'General', message: 'Automated review failed to parse — review the code manually.' }],
    }
  }
}
