import { AppConfig } from '@/lib/config/store'
import { codeReviewerAgent } from '@/lib/agents/code-reviewer-agent'
import fs from 'fs'
import path from 'path'

export interface ReviewOutput {
  approved: boolean
  issues: string[]
  suggestions: string[]
  revised: boolean
  revisedScript?: string
}

export async function reviewAgent(
  issueKey: string,
  script: string,
  appConfig: AppConfig,
  onChunk: (text: string) => void
): Promise<ReviewOutput> {
  const result = await codeReviewerAgent(script, appConfig, onChunk)

  // Map new structured output → existing pipeline interface
  const issues = result.issues
    .filter((i) => i.severity === 'critical' || i.severity === 'warning')
    .map((i) => `[${i.severity.toUpperCase()}] ${i.category}: ${i.message}${i.fix ? ` → ${i.fix}` : ''}`)

  const suggestions = result.issues
    .filter((i) => i.severity === 'suggestion')
    .map((i) => `${i.category}: ${i.message}${i.fix ? ` → ${i.fix}` : ''}`)

  if (result.revisedCode) {
    const dir = path.join(process.cwd(), appConfig.playwrightTestsDir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${issueKey}.spec.ts`), result.revisedCode)
    return { approved: false, issues, suggestions, revised: true, revisedScript: result.revisedCode }
  }

  return { approved: result.approved, issues, suggestions, revised: false }
}
