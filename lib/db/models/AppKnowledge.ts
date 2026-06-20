import mongoose, { Schema, Document } from 'mongoose'

export interface UIElement {
  role: string | null
  name: string | null
  label: string | null
  placeholder: string | null
  inputType: string | null
  htmlName: string | null
  htmlId: string | null
  locators: {
    getByRole: string | null
    getByLabel: string | null
    getByPlaceholder: string | null
    getByText: string | null
    byName: string | null
  }
}

export interface FormField extends UIElement {
  required: boolean
  validationMessages: string[]
}

export interface AppForm {
  formName: string
  action: string | null
  fields: FormField[]
  submitButtonLocator: string | null
}

export interface PageKnowledge {
  url: string
  path: string
  title: string
  module: 'auth' | 'checkout' | 'account' | 'catalog' | 'other'
  headings: string[]
  buttons: UIElement[]
  links: { text: string; href: string; path: string }[]
  forms: AppForm[]
  visibleTextSample: string[]
  screenshotId: string | null
  crawledAt: Date
}

export interface AppKnowledgeDoc extends Document {
  appId: string
  baseUrl: string
  status: 'crawling' | 'ready' | 'failed'
  pages: PageKnowledge[]
  totalPages: number
  authRequired: boolean
  crawlStartedAt: Date
  crawlCompletedAt: Date | null
  crawlError: string | null
  version: number
}

// Use a permissive schema — the real types are enforced by TypeScript interfaces above
const AppKnowledgeSchema = new Schema(
  {
    appId:            { type: String, required: true, unique: true, index: true },
    baseUrl:          { type: String, required: true },
    status:           { type: String, enum: ['crawling', 'ready', 'failed'], default: 'crawling' },
    pages:            { type: Schema.Types.Mixed, default: [] },
    totalPages:       { type: Number, default: 0 },
    authRequired:     { type: Boolean, default: false },
    crawlStartedAt:   { type: Date, default: Date.now },
    crawlCompletedAt: { type: Date, default: null },
    crawlError:       { type: String, default: null },
    version:          { type: Number, default: 1 },
  },
  { timestamps: true }
)

export const AppKnowledge =
  (mongoose.models.AppKnowledge as mongoose.Model<AppKnowledgeDoc>) ??
  mongoose.model<AppKnowledgeDoc>('AppKnowledge', AppKnowledgeSchema)
