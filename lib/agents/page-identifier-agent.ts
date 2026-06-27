import { callLLM } from '@/lib/ai/gemini'
import { AppConfig } from '@/lib/config/store'
import { RequirementOutput } from '@/lib/agents/requirement-agent'

export async function identifyRelevantPages(
  requirements: RequirementOutput,
  sitemapPaths: string[],
  appConfig: AppConfig,
  send: (text: string) => void,
): Promise<string[]> {
  const needsAuth = appConfig.authStrategy !== 'no-auth'

  // Infer login path from credentials or common patterns
  const loginCandidates = ['/login', '/signin', '/sign-in', '/account/login', '/user/login', '/index.php?rt=account/login', '/my-account']
  const loginPath = sitemapPaths.find(p => /login|signin|sign-in/i.test(p)) ?? (needsAuth ? '/login' : null)

  const inventoryBlock = sitemapPaths.length > 0
    ? `Available pages from sitemap:\n${sitemapPaths.slice(0, 150).join('\n')}`
    : 'No sitemap available — infer common paths from the requirements.'

  const prompt = `You are selecting which pages to visit to generate accurate QA test cases.

Requirements summary: ${requirements.summary}
Test scope: ${Array.isArray(requirements.testScope) ? requirements.testScope.join(', ') : requirements.testScope}
Risk areas: ${requirements.riskAreas?.join(', ') ?? ''}

${inventoryBlock}

Return a JSON array of 2-4 page paths most relevant to this test scenario.
${needsAuth ? `ALWAYS include the login/auth page as the first entry.` : ''}
Return ONLY the JSON array, no explanation. Example: ["/login", "/checkout", "/account"]`

  try {
    const raw = await callLLM(prompt, 'You are a QA engineer. Return only a JSON array of page paths.')
    const match = /\[[\s\S]*?\]/.exec(raw)
    if (!match) throw new Error('no array found')
    const parsed: unknown = JSON.parse(match[0])
    if (!Array.isArray(parsed)) throw new Error('not an array')
    const paths = parsed.filter((p): p is string => typeof p === 'string' && p.startsWith('/'))
    if (paths.length > 0) return paths.slice(0, 4)
    throw new Error('empty')
  } catch {
    send(`⚠️ Page identification fallback — using default paths\n`)
    const defaults: string[] = []
    if (needsAuth && loginPath) defaults.push(loginPath)
    defaults.push('/')
    return defaults
  }
}
