import dbConnect from '@/lib/db/mongoose'
import { AppKnowledge, AppKnowledgeDoc, PageKnowledge } from '@/lib/db/models/AppKnowledge'

export async function upsertKnowledge(doc: Partial<AppKnowledgeDoc> & { appId: string }): Promise<AppKnowledgeDoc> {
  await dbConnect
  return AppKnowledge.findOneAndUpdate(
    { appId: doc.appId },
    { $set: doc },
    { upsert: true, new: true }
  ) as unknown as AppKnowledgeDoc
}

export async function getKnowledge(appId: string): Promise<AppKnowledgeDoc | null> {
  await dbConnect
  return AppKnowledge.findOne({ appId }).lean() as unknown as AppKnowledgeDoc | null
}

export async function getKnowledgeStatus(appId: string): Promise<{
  status: string
  totalPages: number
  crawlCompletedAt: Date | null
  version: number
} | null> {
  await dbConnect
  const doc = await AppKnowledge.findOne({ appId }, 'status totalPages crawlCompletedAt version').lean()
  if (!doc) return null
  const d = doc as unknown as AppKnowledgeDoc
  return { status: d.status, totalPages: d.totalPages, crawlCompletedAt: d.crawlCompletedAt, version: d.version }
}

export async function getKnowledgePages(appId: string): Promise<PageKnowledge[]> {
  await dbConnect
  const doc = await AppKnowledge.findOne({ appId }, 'pages').lean()
  if (!doc) return []
  return (doc as unknown as AppKnowledgeDoc).pages ?? []
}
