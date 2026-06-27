import { streamGemini } from '@/lib/ai/gemini'
import { RequirementOutput } from './requirement-agent'
import { fillPrompt } from '@/lib/prompts/loader'

export interface TestStep {
  description: string
  action: 'navigate' | 'fill' | 'click' | 'assert' | 'wait'
  target: string
  value?: string
  locator?: string | null   // pre-resolved Playwright locator; null = not yet resolved
  expected: string
  verified?: boolean        // set by step-verifier
}

export interface TestCase {
  id: string
  title: string
  type: 'positive' | 'negative' | 'edge'
  priority: 'high' | 'medium' | 'low'
  steps: string[]           // always populated (backward compat)
  stepExpected?: string[]
  expectedResult: string
  structuredSteps?: TestStep[]   // enriched steps with embedded locators
  verificationStatus?: {         // set by step-verifier
    verified: number
    total: number
    unresolvedIndices: number[]
  }
}

export async function testCaseAgent(
  requirements: RequirementOutput,
  scenarios: string,
  singleTestCase: boolean,
  onChunk: (text: string) => void,
  appContext?: string,
  credentials?: string,
  elementMapContext?: string,
): Promise<TestCase[]> {
  const prompt = fillPrompt('testcase-writer', {
    ui_knowledge: appContext || '(no UI knowledge available — use generic field names)',
    app_credentials: credentials || '(no credentials configured — use placeholder values)',
    requirements_json: JSON.stringify(requirements, null, 2),
    scenarios,
    mode: singleTestCase
      ? 'single — generate exactly ONE test case with id "TC-001". The work item is already a single test case.'
      : 'multi — generate test cases covering all scenario types listed (positive, negative, edge)',
    element_map: elementMapContext || '(no element map available — use [inferred] for unknown elements)',
  })

  const fullText = await streamGemini(
    prompt,
    'You are a QA engineer creating comprehensive test cases. Be specific and actionable. Return JSON array only.',
    onChunk
  )

  const stripped = fullText.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  const jsonMatch = stripped.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('Test case agent returned invalid JSON')
  const raw = JSON.parse(jsonMatch[0]) as Array<{
    id: string; title: string; type: string; priority: string
    steps?: string[]; stepExpected?: string[]; expectedResult: string
    structuredSteps?: TestStep[]
  }>

  return raw.map(tc => {
    // If LLM returned structuredSteps, derive flat steps from them
    if (tc.structuredSteps && tc.structuredSteps.length > 0) {
      const flatSteps = tc.structuredSteps.map(s => s.description)
      const flatExpected = tc.structuredSteps.map(s => s.expected)
      return {
        id: tc.id,
        title: tc.title,
        type: tc.type as TestCase['type'],
        priority: tc.priority as TestCase['priority'],
        steps: flatSteps,
        stepExpected: flatExpected,
        expectedResult: tc.expectedResult,
        structuredSteps: tc.structuredSteps,
      }
    }
    // Legacy format: flat steps only
    return {
      id: tc.id,
      title: tc.title,
      type: tc.type as TestCase['type'],
      priority: tc.priority as TestCase['priority'],
      steps: tc.steps ?? [],
      stepExpected: tc.stepExpected,
      expectedResult: tc.expectedResult,
    }
  })
}
