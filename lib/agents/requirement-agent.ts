import { streamGemini } from '@/lib/ai/gemini'
import { JiraIssue } from '@/lib/jira/client'
import { fillPrompt } from '@/lib/prompts/loader'

export interface RequirementOutput {
  summary: string
  testScope: string
  preconditions: string[]
  edgeCases: string[]
  riskAreas: string[]
}

export async function requirementAgent(
  issue: JiraIssue,
  onChunk: (text: string) => void
): Promise<RequirementOutput> {
  const prompt = fillPrompt('requirement-extractor', {
    issue_key: issue.key,
    summary: issue.summary,
    description: issue.description || '(not provided)',
    acceptance_criteria: issue.acceptanceCriteria || 'Not specified',
  })

  const fullText = await streamGemini(
    prompt,
    'You are a senior QA engineer analyzing requirements. Extract testable requirements in structured JSON. Return JSON only.',
    onChunk
  )

  const jsonMatch = fullText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Requirement agent returned invalid JSON')
  return JSON.parse(jsonMatch[0]) as RequirementOutput
}
