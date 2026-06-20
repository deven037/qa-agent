import {
  fetchJiraIssue,
  findExistingScenarios,
  findExistingTestCases,
  fetchAutomationScript,
  postJiraComment,
  attachFileToJiraIssue,
  parseTestCasesFromMarkdown,
} from '@/lib/jira/client'
import { requirementAgent } from '@/lib/agents/requirement-agent'
import { testCaseAgent, TestCase } from '@/lib/agents/testcase-agent'
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

// Emit a skipped agent as instantly done with an info message
function skip(agent: AgentName, emit: (e: SSEEvent) => void, reason: string) {
  emit({ agent, type: 'start', data: '' })
  emit({ agent, type: 'info', data: reason })
  emit({ agent, type: 'done', data: '' })
}

export async function runPipeline(
  issueKey: string,
  appConfig: AppConfig,
  emit: (event: SSEEvent) => void,
  issueType?: string
): Promise<void> {
  // ── Fetch issue and detect what already exists ──────────────────────────────
  const issue = await fetchJiraIssue(issueKey)
  const existingTestCasesMarkdown = findExistingTestCases(issue.comments)
  const existingScenarios = findExistingScenarios(issue.comments)

  // Try to load existing automation script from Jira attachments
  let existingScript: string | null = null
  try {
    existingScript = await fetchAutomationScript(issueKey)
  } catch {
    existingScript = null
  }

  const hasTestCases = !!existingTestCasesMarkdown
  const hasAutomation = !!existingScript

  // ── Route: skip stages we already have ──────────────────────────────────────
  let testCases: TestCase[]

  if (hasTestCases && hasAutomation) {
    // ── Mode: automation exists → validate + fix + re-run ───────────────────
    skip('requirement', emit, 'Requirement analysis already done for this issue.')
    skip('scenario', emit, 'Scenarios already documented in Jira.')
    // Re-parse test cases from the markdown comment so downstream agents have them
    testCases = parseTestCasesFromMarkdown(existingTestCasesMarkdown!)
    skip('testcase', emit, `Found ${testCases.length} existing test case${testCases.length !== 1 ? 's' : ''} in Jira — skipping regeneration.`)
    skip('exploration', emit, 'Using existing automation script — skipping app exploration.')

    // Emit existing script so the UI can display it
    emit({ agent: 'automation', type: 'start', data: '' })
    emit({ agent: 'automation', type: 'info', data: 'Existing automation script loaded from Jira.' })
    emit({ agent: 'automation', type: 'chunk', data: existingScript! })
    emit({ agent: 'automation', type: 'done', data: existingScript! })

    // Review the existing script for issues and fix if needed
    const reviewResult = await step('review', emit, () =>
      reviewAgent(issueKey, existingScript!, appConfig, (chunk) =>
        emit({ agent: 'review', type: 'chunk', data: chunk })
      )
    )
    // If review produced a revised script, re-attach it to Jira
    if (reviewResult.revised) {
      await attachFileToJiraIssue(issueKey, `${issueKey}.spec.ts`, reviewResult.revisedScript ?? existingScript!)
    }
    await postJiraComment(
      issueKey,
      `[QA-REVIEW]\nCode Review: ${reviewResult.approved ? '✅ Approved' : '⚠️ Issues Found'}\n\nIssues:\n${reviewResult.issues.map((i) => `- ${i}`).join('\n') || 'None'}\n\nSuggestions:\n${reviewResult.suggestions.map((s) => `- ${s}`).join('\n') || 'None'}${reviewResult.revised ? '\n\n_Script was automatically revised._' : ''}`
    )
    emit({ agent: 'review', type: 'done', data: JSON.stringify(reviewResult) })

  } else if (hasTestCases && !hasAutomation) {
    // ── Mode: test cases exist, no automation yet → generate automation ──────
    skip('requirement', emit, 'Requirement analysis already done for this issue.')
    skip('scenario', emit, 'Scenarios already documented in Jira.')
    testCases = parseTestCasesFromMarkdown(existingTestCasesMarkdown!)
    skip('testcase', emit, `Found ${testCases.length} existing test case${testCases.length !== 1 ? 's' : ''} in Jira — skipping regeneration.`)

    // Explore the app to get real locators
    let explorationContext: string | undefined
    try {
      const exploration = await step('exploration', emit, () =>
        explorationAgent(appConfig, (line) =>
          emit({ agent: 'exploration', type: 'chunk', data: line })
        )
      )
      explorationContext = formatExplorationContext(exploration)
      emit({ agent: 'exploration', type: 'done', data: explorationContext })
    } catch {
      explorationContext = undefined
    }

    // Generate automation from existing test cases
    const script = await step('automation', emit, () =>
      automationAgent(issueKey, testCases, appConfig, (chunk) =>
        emit({ agent: 'automation', type: 'chunk', data: chunk }), explorationContext
      )
    )
    await attachFileToJiraIssue(issueKey, `${issueKey}.spec.ts`, script)
    emit({ agent: 'automation', type: 'done', data: script })

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

  } else {
    // ── Mode: nothing exists → full pipeline ─────────────────────────────────
    const requirements = await step('requirement', emit, () =>
      requirementAgent(issue, (chunk) => emit({ agent: 'requirement', type: 'chunk', data: chunk }))
    )
    emit({ agent: 'requirement', type: 'done', data: JSON.stringify(requirements) })

    let scenarios: string
    emit({ agent: 'scenario', type: 'start', data: '' })
    try {
      if (existingScenarios) {
        emit({ agent: 'scenario', type: 'info', data: 'Found existing scenarios in Jira — reusing them.' })
        scenarios = existingScenarios
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

    testCases = await step('testcase', emit, () =>
      testCaseAgent(requirements, scenarios, true, (chunk) =>
        emit({ agent: 'testcase', type: 'chunk', data: chunk })
      )
    )
    const testCasesMarkdown = testCasesToMarkdown(testCases)
    await postJiraComment(issueKey, `[QA-TESTCASES]\n${testCasesMarkdown}`)
    emit({ agent: 'testcase', type: 'done', data: JSON.stringify(testCases) })

    let explorationContext: string | undefined
    try {
      const exploration = await step('exploration', emit, () =>
        explorationAgent(appConfig, (line) =>
          emit({ agent: 'exploration', type: 'chunk', data: line })
        )
      )
      explorationContext = formatExplorationContext(exploration)
      emit({ agent: 'exploration', type: 'done', data: explorationContext })
    } catch {
      explorationContext = undefined
    }

    const script = await step('automation', emit, () =>
      automationAgent(issueKey, testCases, appConfig, (chunk) =>
        emit({ agent: 'automation', type: 'chunk', data: chunk }), explorationContext
      )
    )
    await attachFileToJiraIssue(issueKey, `${issueKey}.spec.ts`, script)
    emit({ agent: 'automation', type: 'done', data: script })

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
  }

  // ── Execution always runs ───────────────────────────────────────────────────
  const execResult = await step('execution', emit, () =>
    executionAgent(issueKey, appConfig, (chunk) =>
      emit({ agent: 'execution', type: 'chunk', data: chunk })
    )
  )
  emit({ agent: 'execution', type: 'done', data: JSON.stringify(execResult) })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function testCasesToMarkdown(testCases: TestCase[]): string {
  return testCases
    .map(
      (tc) =>
        `**${tc.id}: ${tc.title}** (${tc.type} | ${tc.priority} priority)\n\nSteps:\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nExpected: ${tc.expectedResult}`
    )
    .join('\n\n---\n\n')
}

