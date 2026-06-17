import { streamGemini } from '@/lib/ai/gemini'
import { JiraIssue } from '@/lib/jira/client'

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
  const prompt = `Analyze this Jira user story and extract what needs to be tested.

Issue Key: ${issue.key}
Summary: ${issue.summary}
Description: ${issue.description}
Acceptance Criteria: ${issue.acceptanceCriteria || 'Not specified'}

Return a JSON object with:
- summary: one-sentence description of what this feature does
- testScope: what areas need to be tested
- preconditions: array of things that must be true before testing
- edgeCases: array of edge cases and boundary conditions
- riskAreas: array of high-risk areas that need extra attention

Respond ONLY with valid JSON.`

  const fullText = await streamGemini(
    prompt,
    'You are a senior QA engineer analyzing requirements. Extract testable requirements in structured JSON.',
    onChunk
  )

  const jsonMatch = fullText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Requirement agent returned invalid JSON')
  return JSON.parse(jsonMatch[0]) as RequirementOutput
}
