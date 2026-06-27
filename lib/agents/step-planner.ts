import { callSmartLLM } from '@/lib/ai/gemini'
import { fillPrompt, loadGlobalInstructions } from '@/lib/prompts/loader'
import { formatCredentialsForLLM } from '@/lib/config/store'
import type { AgentEvent } from './playwright-mcp-agent'
import type { AppConfig } from '@/lib/config/store'

export interface PlannedStep {
  step: string
  expected: string
}

export async function planStepsFromInstruction(
  instruction: string,
  appConfig: AppConfig,
  onEvent: (e: AgentEvent) => void,
): Promise<PlannedStep[]> {
  onEvent({ type: 'plan_start', text: `Planning steps for: ${instruction}` })
  onEvent({ type: 'agent_thinking', text: 'Analyzing instruction…' })

  const globalInstructions = loadGlobalInstructions()
  const perApp = appConfig.automationInstructions?.trim()
  const instructions = perApp ? `${globalInstructions}\n\n## App-Specific Overrides\n${perApp}` : globalInstructions

  const prompt = fillPrompt('step-planner', {
    instruction,
    base_url: appConfig.baseUrl,
    known_paths: '(live DOM — paths resolved at execution time)',
    known_fields: '(live DOM — fields resolved at execution time)',
    app_credentials: formatCredentialsForLLM(appConfig),
    custom_instructions: instructions,
  })

  try {
    const raw = await callSmartLLM(
      prompt,
      `You are an expert QA automation engineer.\n${instructions}\nReturn a JSON array of test steps only. No markdown fences.`,
    )
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('No JSON array in response')

    const steps = JSON.parse(match[0]) as PlannedStep[]
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('Empty step array')

    onEvent({ type: 'llm_response', text: `Planned ${steps.length} step(s)`, rationale: `${steps.length} steps generated` })

    for (let i = 0; i < steps.length; i++) {
      onEvent({ type: 'plan_step', stepIndex: i, plannedStep: steps[i], text: steps[i].step })
    }

    onEvent({ type: 'plan_done', text: `Plan ready — ${steps.length} steps` })
    return steps
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onEvent({ type: 'log', text: `Step planning failed: ${msg} — using instruction as single step` })
    const fallback = [{ step: instruction, expected: '' }]
    onEvent({ type: 'plan_step', stepIndex: 0, plannedStep: fallback[0], text: instruction })
    onEvent({ type: 'plan_done', text: 'Plan ready — 1 step (fallback)' })
    return fallback
  }
}
