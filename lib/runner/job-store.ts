import { EventEmitter } from 'events'
import { randomBytes } from 'crypto'
import type { AgentEvent } from '@/lib/agents/playwright-mcp-agent'

export interface RunnerJob {
  id: string
  appId: string
  issueKey?: string
  instruction?: string
  freeform: boolean
  browser: string
  instructions: string
  status: 'pending' | 'running' | 'done'
  createdAt: number
}

const jobs = new Map<string, RunnerJob>()
const emitters = new Map<string, EventEmitter>()

export function createJob(config: Omit<RunnerJob, 'id' | 'status' | 'createdAt'>): string {
  const id = randomBytes(8).toString('hex')
  jobs.set(id, { ...config, id, status: 'pending', createdAt: Date.now() })
  emitters.set(id, new EventEmitter())
  // Auto-cleanup after 10 minutes
  setTimeout(() => { jobs.delete(id); emitters.delete(id) }, 10 * 60 * 1000)
  return id
}

export function getNextPendingJob(): RunnerJob | null {
  for (const job of jobs.values()) {
    if (job.status === 'pending') return job
  }
  return null
}

export function markRunning(jobId: string): void {
  const job = jobs.get(jobId)
  if (job) job.status = 'running'
}

export function markDone(jobId: string): void {
  const job = jobs.get(jobId)
  if (job) job.status = 'done'
}

export type JobSignal = AgentEvent | { type: '__DONE__' } | { type: '__ERROR__'; message: string }

export function emitJobEvent(jobId: string, signal: JobSignal): void {
  emitters.get(jobId)?.emit('event', signal)
}

export function subscribeToJob(
  jobId: string,
  handler: (signal: JobSignal) => void,
): () => void {
  const emitter = emitters.get(jobId)
  if (!emitter) return () => {}
  emitter.on('event', handler)
  return () => emitter.off('event', handler)
}

export function jobExists(jobId: string): boolean {
  return jobs.has(jobId)
}
