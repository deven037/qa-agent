/**
 * One-time script: seed MongoDB with existing config/apps.json and config/jira-config.json
 * Usage: MONGODB_URI=... node scripts/migrate-config.mjs
 */
import mongoose from 'mongoose'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = path.join(__dirname, '..', 'config')

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('MONGODB_URI env var required')
  process.exit(1)
}

await mongoose.connect(MONGODB_URI)
console.log('Connected to MongoDB')

// ---- JiraConfig ----
const JiraConfigSchema = new mongoose.Schema({
  baseUrl: String, email: String, apiToken: String, defaultProjectKey: String,
})
const JiraConfigModel = mongoose.models.JiraConfig ?? mongoose.model('JiraConfig', JiraConfigSchema)

const jiraFile = path.join(CONFIG_DIR, 'jira-config.json')
if (fs.existsSync(jiraFile)) {
  const jira = JSON.parse(fs.readFileSync(jiraFile, 'utf-8'))
  await JiraConfigModel.findOneAndUpdate({}, jira, { upsert: true })
  console.log('✓ JiraConfig migrated')
} else {
  console.log('⚠ No jira-config.json found — skipping')
}

// ---- Apps ----
const AppSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: String, jiraProjectKey: String, baseUrl: String,
  authStrategy: String, credentials: { type: Map, of: String },
  credentialEnvVars: { type: Map, of: String }, storePassword: String,
  playwrightTestsDir: String, createdAt: String,
})
const AppModel = mongoose.models.App ?? mongoose.model('App', AppSchema)

const appsFile = path.join(CONFIG_DIR, 'apps.json')
if (fs.existsSync(appsFile)) {
  const apps = JSON.parse(fs.readFileSync(appsFile, 'utf-8'))
  for (const app of apps) {
    await AppModel.findOneAndUpdate({ id: app.id }, app, { upsert: true })
    console.log(`✓ App migrated: ${app.name} (${app.id})`)
  }
} else {
  console.log('⚠ No apps.json found — skipping')
}

await mongoose.disconnect()
console.log('Done.')
