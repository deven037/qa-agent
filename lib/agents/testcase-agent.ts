import { streamGemini } from '@/lib/ai/gemini'
import { RequirementOutput } from './requirement-agent'
import { fillPrompt } from '@/lib/prompts/loader'

export interface TestCase {
  id: string
  title: string
  type: 'positive' | 'negative' | 'edge'
  priority: 'high' | 'medium' | 'low'
  steps: string[]
  expectedResult: string
}

export async function testCaseAgent(
  requirements: RequirementOutput,
  scenarios: string,
  singleTestCase: boolean,
  onChunk: (text: string) => void,
  appContext?: string
): Promise<TestCase[]> {
  const prompt = fillPrompt('testcase-writer', {
    ui_knowledge: appContext || '(no UI knowledge available — use generic field names)',
    requirements_json: JSON.stringify(requirements, null, 2),
    scenarios,
    mode: singleTestCase
      ? 'single — generate exactly ONE test case with id "TC-001". The work item is already a single test case.'
      : 'multi — generate test cases covering all scenario types listed (positive, negative, edge)',
  })

  const fullText = await streamGemini(
    prompt,
    'You are a QA engineer creating comprehensive test cases. Be specific and actionable. Return JSON array only.',
    onChunk
  )

  const stripped = fullText.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  const jsonMatch = stripped.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('Test case agent returned invalid JSON')
  return JSON.parse(jsonMatch[0]) as TestCase[]
}
