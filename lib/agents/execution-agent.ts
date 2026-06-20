import { AppConfig } from '@/lib/config/store'
import { runPlaywrightTests, ExecutionResult } from '@/lib/playwright/runner'
import { postJiraComment } from '@/lib/jira/client'

export async function executionAgent(
  issueKey: string,
  appConfig: AppConfig,
  onChunk: (text: string) => void,
  headed = false
): Promise<ExecutionResult> {
  const result = await runPlaywrightTests(issueKey, appConfig, onChunk, 300000, headed)

  const summary = `[QA-RESULTS]
Playwright Execution Results for ${issueKey}

✅ Passed: ${result.passed}
❌ Failed: ${result.failed}
⏭️ Skipped: ${result.skipped}
⏱️ Duration: ${(result.duration / 1000).toFixed(1)}s

${result.testResults.map((t) => `- [${t.status.toUpperCase()}] ${t.title}${t.error ? `\n  Error: ${t.error}` : ''}`).join('\n')}
${result.error ? `\nExecution Error: ${result.error}` : ''}`

  try {
    await postJiraComment(issueKey, summary)
  } catch {
    // Non-fatal — return result even if Jira comment fails
  }

  return result
}
