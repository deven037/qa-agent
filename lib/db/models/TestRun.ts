import mongoose, { Schema, Document } from 'mongoose'

export interface StepRecord {
  stepIndex: number
  description: string
  expected?: string
  status: 'passed' | 'failed'
  duration?: number
  action?: string
  resolvedLocator?: string
  pageUrl?: string
  domFieldCount?: number
  locatorAttempts: { locator: string; success: boolean }[]
  healingAttempts: number
  healingRationale?: string
  error?: string
}

export interface NavEvent {
  url: string
  stepIndex: number
}

export interface TestRunDoc extends Document {
  runId: string
  appId: string
  issueKey?: string
  title: string
  status: 'passed' | 'failed'
  passed: number
  failed: number
  skipped: number
  duration: number
  steps: StepRecord[]
  navEvents: NavEvent[]
  browser: string
  runner: 'server' | 'local'
  executedAt: Date
  createdAt: Date
}

const StepSchema = new Schema({
  stepIndex:        { type: Number },
  description:      { type: String },
  expected:         { type: String },
  status:           { type: String, enum: ['passed', 'failed'] },
  duration:         { type: Number },
  action:           { type: String },
  resolvedLocator:  { type: String },
  pageUrl:          { type: String },
  domFieldCount:    { type: Number },
  locatorAttempts:  [{ locator: String, success: Boolean }],
  healingAttempts:  { type: Number, default: 0 },
  healingRationale: { type: String },
  error:            { type: String },
}, { _id: false })

const NavEventSchema = new Schema({
  url:       { type: String },
  stepIndex: { type: Number },
}, { _id: false })

const TestRunSchema = new Schema({
  runId:      { type: String, required: true, unique: true, index: true },
  appId:      { type: String, required: true, index: true },
  issueKey:   { type: String, index: true, sparse: true },
  title:      { type: String, required: true },
  status:     { type: String, enum: ['passed', 'failed'], required: true },
  passed:     { type: Number, required: true },
  failed:     { type: Number, required: true },
  skipped:    { type: Number, default: 0 },
  duration:   { type: Number, required: true },
  steps:      [StepSchema],
  navEvents:  [NavEventSchema],
  browser:    { type: String, required: true },
  runner:     { type: String, enum: ['server', 'local'], required: true },
  executedAt: { type: Date, required: true },
  createdAt:  { type: Date, default: Date.now },
}, { timestamps: false })

// Auto-delete after 2 days
TestRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: 172800 })

export const TestRun =
  (mongoose.models.TestRun as mongoose.Model<TestRunDoc>) ??
  mongoose.model<TestRunDoc>('TestRun', TestRunSchema)
