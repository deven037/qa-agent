import { streamGemini } from '@/lib/ai/gemini'
import { RequirementOutput } from './requirement-agent'

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
  onChunk: (text: string) => void
): Promise<TestCase[]> {
  const prompt = singleTestCase
    ? `Generate exactly ONE test case for this specific requirement. The work item is already a single test case, so do not generate multiple.

Requirements:
${JSON.stringify(requirements, null, 2)}

Scenario:
${scenarios}

Generate exactly one test case with:
- id: "TC-001"
- title: clear descriptive title matching the requirement
- type: "positive"
- priority: "high" | "medium" | "low"
- steps: array of specific action steps
- expectedResult: what should happen

Respond ONLY with a JSON array containing exactly one test case object.`
    : `Generate detailed test cases based on these requirements and scenarios.

Requirements:
${JSON.stringify(requirements, null, 2)}

Scenarios:
${scenarios}

Generate test cases covering positive flows, negative flows, and edge cases.
For each test case provide:
- id: TC-001, TC-002, etc.
- title: clear descriptive title
- type: "positive" | "negative" | "edge"
- priority: "high" | "medium" | "low"
- steps: array of numbered action steps
- expectedResult: what should happen

Respond ONLY with a JSON array of test case objects.`

  const fullText = await streamGemini(
    prompt,
    'You are a QA engineer creating comprehensive test cases. Be specific and actionable.',
    onChunk
  )

  const stripped = fullText.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  const jsonMatch = stripped.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('Test case agent returned invalid JSON')
  return JSON.parse(jsonMatch[0]) as TestCase[]
}
