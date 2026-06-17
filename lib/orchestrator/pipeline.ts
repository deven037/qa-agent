import { fetchJiraIssue, findExistingScenarios, postJiraComment } from '@/lib/jira/client'
import { requirementAgent } from '@/lib/agents/requirement-agent'
import { testCaseAgent } from '@/lib/agents/testcase-agent'
import { automationAgent } from '@/lib/agents/automation-agent'
import { reviewAgent } from '@/lib/agents/review-agent'
import { executionAgent } from '@/lib/agents/execution-agent'
import { explorationAgent, formatExplorationContext } from '@/lib/agents/exploration-agent'
import { AppConfig } from '@/lib/config/store'
import { streamGemini } from '@/lib/ai/gemini'

export type AgentName = 'requirement' | 'scenario' | 'testcase' | 'exploration' | 'automation' | 'review' | 'execution'

export interface SSEEvent {
  agent: AgentName | 'system'
  type: 'start' | 'chunk' | 'done' | 'error' | 'info'
  data: string
}

// Wraps an agent step: emits start, runs it, emits done or error
async function step<T>(
  agent: AgentName,
  emit: (e: SSEEvent) => void,
  fn: () => Promise<T>
): Promise<T> {
  emit({ agent, type: 'start', data: '' })
  try {
    const result = await fn()
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emit({ agent, type: 'error', data: msg })
    throw e
  }
}

export async function runPipeline(
  issueKey: string,
  appConfig: AppConfig,
  emit: (event: SSEEvent) => void,
  issueType?: string
): Promise<void> {
  // 1. Requirement Analysis
  const issue = await fetchJiraIssue(issueKey)
  const requirements = await step('requirement', emit, () =>
    requirementAgent(issue, (chunk) => emit({ agent: 'requirement', type: 'chunk', data: chunk }))
  )
  emit({ agent: 'requirement', type: 'done', data: JSON.stringify(requirements) })

  // 1b. Scenario Check
  let scenarios: string
  emit({ agent: 'scenario', type: 'start', data: '' })
  try {
    const existing = findExistingScenarios(issue.comments)
    if (existing) {
      emit({ agent: 'scenario', type: 'info', data: 'Found existing scenarios in Jira — reusing them.' })
      scenarios = existing
    } else {
      emit({ agent: 'scenario', type: 'info', data: 'No existing scenarios found — generating new ones.' })
      scenarios = await generateScenarios(requirements, (chunk) =>
        emit({ agent: 'scenario', type: 'chunk', data: chunk })
      )
      await postJiraComment(issueKey, `[QA-SCENARIOS]\n${scenarios}`)
    }
    emit({ agent: 'scenario', type: 'done', data: scenarios })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emit({ agent: 'scenario', type: 'error', data: msg })
    throw e
  }

  // 2. Test Case Generation — single test if work item is already a Test Case
  const isSingleTestCase = issueType === 'Test Case' || issueType === 'Task' && issue.summary?.toLowerCase().includes('test')
  const testCases = await step('testcase', emit, () =>
    testCaseAgent(requirements, scenarios, isSingleTestCase, (chunk) =>
      emit({ agent: 'testcase', type: 'chunk', data: chunk })
    )
  )
  const testCasesMarkdown = testCasesToMarkdown(testCases)
  await postJiraComment(issueKey, `[QA-TESTCASES]\n${testCasesMarkdown}`)
  emit({ agent: 'testcase', type: 'done', data: JSON.stringify(testCases) })

  // 3. App Exploration — visit the app and collect real locators
  let explorationContext: string | undefined
  try {
    const exploration = await step('exploration', emit, () =>
      explorationAgent(testCases, appConfig, (line) =>
        emit({ agent: 'exploration', type: 'chunk', data: line })
      )
    )
    explorationContext = formatExplorationContext(exploration)
    emit({ agent: 'exploration', type: 'done', data: explorationContext })
  } catch {
    // Exploration failure is non-fatal — automation proceeds without context
    explorationContext = undefined
  }

  // 4. Automation Generation
  const script = await step('automation', emit, () =>
    automationAgent(issueKey, testCases, appConfig, (chunk) =>
      emit({ agent: 'automation', type: 'chunk', data: chunk }), explorationContext
    )
  )
  const scriptFilename = `${issueKey}.spec.ts`
  const { attachFileToJiraIssue } = await import('@/lib/jira/client')
  await attachFileToJiraIssue(issueKey, scriptFilename, script)
  emit({ agent: 'automation', type: 'done', data: script })

  // 5. Code Review
  const reviewResult = await step('review', emit, () =>
    reviewAgent(issueKey, script, appConfig, (chunk) =>
      emit({ agent: 'review', type: 'chunk', data: chunk })
    )
  )
  await postJiraComment(
    issueKey,
    `[QA-REVIEW]\nCode Review: ${reviewResult.approved ? '✅ Approved' : '⚠️ Issues Found'}\n\nIssues:\n${reviewResult.issues.map((i) => `- ${i}`).join('\n') || 'None'}\n\nSuggestions:\n${reviewResult.suggestions.map((s) => `- ${s}`).join('\n') || 'None'}${reviewResult.revised ? '\n\n_Script was automatically revised._' : ''}`
  )
  emit({ agent: 'review', type: 'done', data: JSON.stringify(reviewResult) })

  // 6. Execution
  const execResult = await step('execution', emit, () =>
    executionAgent(issueKey, appConfig, (chunk) =>
      emit({ agent: 'execution', type: 'chunk', data: chunk })
    )
  )
  emit({ agent: 'execution', type: 'done', data: JSON.stringify(execResult) })
}

async function generateScenarios(
  requirements: ReturnType<typeof requirementAgent> extends Promise<infer T> ? T : never,
  onChunk: (text: string) => void
): Promise<string> {
  const prompt = `Based on these requirements, generate test scenarios:

${JSON.stringify(requirements, null, 2)}

Write clear, concise test scenarios in this format:
Scenario 1: [Title]
- Given: [precondition]
- When: [action]
- Then: [expected outcome]

Generate scenarios for happy path, error cases, and edge cases.`

  return streamGemini(prompt, 'You are a QA engineer writing BDD-style test scenarios.', onChunk)
}

function testCasesToMarkdown(testCases: Awaited<ReturnType<typeof testCaseAgent>>): string {
  return testCases
    .map(
      (tc) =>
        `**${tc.id}: ${tc.title}** (${tc.type} | ${tc.priority} priority)\n\nSteps:\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nExpected: ${tc.expectedResult}`
    )
    .join('\n\n---\n\n')
}
