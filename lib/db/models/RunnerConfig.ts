import { model, models, Schema } from 'mongoose'

const RunnerConfigSchema = new Schema({
  token: { type: String, required: true },
})

export const RunnerConfigModel = models.RunnerConfig ?? model('RunnerConfig', RunnerConfigSchema)
