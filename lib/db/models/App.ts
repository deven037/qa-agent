import mongoose, { Schema, model, models } from 'mongoose'

const AppSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  jiraProjectKey: { type: String, required: true },
  baseUrl: { type: String, required: true },
  authStrategy: { type: String, required: true, default: 'no-auth' },
  credentials: { type: Map, of: String, default: {} },
  credentialEnvVars: { type: Map, of: String, default: {} },
  storePassword: { type: String },
  playwrightTestsDir: { type: String, required: true },
  createdAt: { type: String, required: true },
})

export const AppModel = models.App ?? model('App', AppSchema)
