import { Schema, model, models, Document, Types } from 'mongoose'

export interface IProject extends Document {
  name: string
  ownerId: Types.ObjectId
  jiraProjectKey: string
  appConfigId: string
  createdAt: Date
}

const ProjectSchema = new Schema<IProject>({
  name: { type: String, required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  jiraProjectKey: { type: String, required: true },
  appConfigId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
})

export const Project = models.Project ?? model<IProject>('Project', ProjectSchema)
