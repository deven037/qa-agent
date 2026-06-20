import fs from 'fs'
import path from 'path'

const CONFIG_DIR = path.join(process.cwd(), 'config')

export interface JiraConfig {
  baseUrl: string
  email: string
  apiToken: string
  defaultProjectKey: string
}

export interface AppConfig {
  id: string
  name: string
  jiraProjectKey: string
  baseUrl: string
  authStrategy: 'no-auth' | 'email-password' | 'api-key' | 'custom'
  credentials: Record<string, string>      // actual values: { email, password, apiKey }
  credentialEnvVars: Record<string, string> // legacy — kept for compat, prefer credentials
  storePassword?: string                   // storefront/app-level password gate (e.g. Shopify preview stores)
  playwrightTestsDir: string
  createdAt: string
}

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
}

export function readJiraConfig(): JiraConfig | null {
  const file = path.join(CONFIG_DIR, 'jira-config.json')
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

export function writeJiraConfig(config: JiraConfig) {
  ensureConfigDir()
  fs.writeFileSync(path.join(CONFIG_DIR, 'jira-config.json'), JSON.stringify(config, null, 2))
}

export function readApps(): AppConfig[] {
  const file = path.join(CONFIG_DIR, 'apps.json')
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

export function writeApps(apps: AppConfig[]) {
  ensureConfigDir()
  fs.writeFileSync(path.join(CONFIG_DIR, 'apps.json'), JSON.stringify(apps, null, 2))
}

export function isConfigured(): boolean {
  return readJiraConfig() !== null && readApps().length > 0
}
