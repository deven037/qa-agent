import fs from 'fs'
import path from 'path'

function loadPrompt(name: string): string {
  const filePath = path.join(process.cwd(), 'lib', 'prompts', `${name}.md`)
  const raw = fs.readFileSync(filePath, 'utf-8')
  // Strip YAML frontmatter (--- ... ---)
  return raw.replace(/^---[\s\S]*?---\n/, '').trim()
}

export function loadGlobalInstructions(): string {
  return loadPrompt('global-instructions')
}

export function fillPrompt(name: string, vars: Record<string, string>): string {
  let content = loadPrompt(name)
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value)
  }
  return content
}
