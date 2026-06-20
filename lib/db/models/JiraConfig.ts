import mongoose, { Schema, model, models } from 'mongoose'

const JiraConfigSchema = new Schema({
  baseUrl: { type: String, required: true },
  email: { type: String, required: true },
  apiToken: { type: String, required: true },
  defaultProjectKey: { type: String, required: true },
})

export const JiraConfigModel = models.JiraConfig ?? model('JiraConfig', JiraConfigSchema)
