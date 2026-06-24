import { randomBytes } from 'crypto'
import dbConnect from '@/lib/db/mongoose'
import { AppModel } from '@/lib/db/models/App'
import { JiraConfigModel } from '@/lib/db/models/JiraConfig'
import { RunnerConfigModel } from '@/lib/db/models/RunnerConfig'

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
  credentials: Record<string, string>
  credentialEnvVars: Record<string, string>
  storePassword?: string
  playwrightTestsDir: string
  automationInstructions?: string
  createdAt: string
}

function docToJiraConfig(doc: any): JiraConfig {
  return {
    baseUrl: doc.baseUrl,
    email: doc.email,
    apiToken: doc.apiToken,
    defaultProjectKey: doc.defaultProjectKey,
  }
}

function docToAppConfig(doc: any): AppConfig {
  return {
    id: doc.id,
    name: doc.name,
    jiraProjectKey: doc.jiraProjectKey,
    baseUrl: doc.baseUrl,
    authStrategy: doc.authStrategy,
    credentials: doc.credentials instanceof Map
      ? Object.fromEntries(doc.credentials)
      : (doc.credentials ?? {}),
    credentialEnvVars: doc.credentialEnvVars instanceof Map
      ? Object.fromEntries(doc.credentialEnvVars)
      : (doc.credentialEnvVars ?? {}),
    storePassword: doc.storePassword,
    playwrightTestsDir: doc.playwrightTestsDir,
    automationInstructions: doc.automationInstructions ?? '',
    createdAt: doc.createdAt,
  }
}

export async function readJiraConfig(): Promise<JiraConfig | null> {
  await dbConnect
  const doc = await JiraConfigModel.findOne().lean()
  if (!doc) return null
  return docToJiraConfig(doc)
}

export async function writeJiraConfig(config: JiraConfig): Promise<void> {
  await dbConnect
  await JiraConfigModel.findOneAndUpdate({}, config, { upsert: true, new: true })
}

export async function readApps(): Promise<AppConfig[]> {
  await dbConnect
  const docs = await AppModel.find().lean()
  return docs.map(docToAppConfig)
}

export async function writeApps(apps: AppConfig[]): Promise<void> {
  await dbConnect
  await AppModel.deleteMany({})
  if (apps.length > 0) await AppModel.insertMany(apps)
}

export async function readApp(id: string): Promise<AppConfig | null> {
  await dbConnect
  const doc = await AppModel.findOne({ id }).lean()
  if (!doc) return null
  return docToAppConfig(doc)
}

export async function upsertApp(app: AppConfig): Promise<void> {
  await dbConnect
  await AppModel.findOneAndUpdate({ id: app.id }, app, { upsert: true, new: true })
}

export async function readRunnerToken(): Promise<string> {
  await dbConnect
  const doc = await RunnerConfigModel.findOne().lean() as { token: string } | null
  if (doc) return doc.token
  // Generate on first access
  const token = randomBytes(32).toString('hex')
  await RunnerConfigModel.create({ token })
  return token
}

export async function regenerateRunnerToken(): Promise<string> {
  await dbConnect
  const token = randomBytes(32).toString('hex')
  await RunnerConfigModel.findOneAndUpdate({}, { token }, { upsert: true, new: true })
  return token
}

// Returns a human-readable credential block for LLM prompts.
// Never returns empty — always describes what auth strategy is in use.
export function formatCredentialsForLLM(app: AppConfig): string {
  const creds = app.credentials ?? {}
  if (app.authStrategy === 'email-password') {
    const username = creds.email || creds.username || creds.loginname || ''
    const password = creds.password || ''
    if (!username && !password) return '(no credentials configured — add them in Settings)'
    const lines = ['Auth: email/password']
    if (username) lines.push(`Username / Email: ${username}`)
    if (password) lines.push(`Password: ${password}`)
    return lines.join('\n')
  }
  if (app.authStrategy === 'api-key') {
    return creds.apiKey ? `Auth: API key\nAPI Key: ${creds.apiKey}` : '(API key not set)'
  }
  if (app.authStrategy === 'no-auth') return 'Auth: none required'
  if (Object.keys(creds).length > 0) {
    return 'Auth credentials:\n' + Object.entries(creds).map(([k, v]) => `  ${k}: ${v}`).join('\n')
  }
  return '(no credentials configured)'
}

export async function isConfigured(): Promise<boolean> {
  await dbConnect
  const [jira, appCount] = await Promise.all([
    JiraConfigModel.findOne().lean(),
    AppModel.countDocuments(),
  ])
  return jira !== null && appCount > 0
}
