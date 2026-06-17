import { AppConfig } from '@/lib/config/store'
import { runPlaywrightTests, ExecutionResult } from '@/lib/playwright/runner'
import { postJiraComment } from '@/lib/jira/client'

export async function executionAgent(
  issueKey: string,
  appConfig: AppConfig,
  onChunk: (text: string) => void
): Promise<ExecutionResult> {
  const result = await runPlaywrightTests(issueKey, appConfig, onChunk)

  const summary = `[QA-RESULTS]
Playwright Execution Results for ${issueKey}

✅ Passed: ${result.passed}
❌ Failed: ${result.failed}
⏭️ Skipped: ${result.skipped}
⏱️ Duration: ${(result.duration / 1000).toFixed(1)}s

${result.testResults.map((t) => `- [${t.status.toUpperCase()}] ${t.title}${t.error ? `\n  Error: ${t.error}` : ''}`).join('\n')}
${result.error ? `\nExecution Error: ${result.error}` : ''}`

  await postJiraComment(issueKey, summary)

  return result
}
