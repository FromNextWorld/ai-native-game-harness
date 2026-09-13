import { randomUUID } from 'node:crypto'
import { reportRuntimeError } from './error-diagnostics.js'

export const PRODUCT_DIAGNOSTIC_PREFIX = 'AI_GAME_HARNESS_DIAGNOSTIC '

export type ProductDiagnosticKind = 'game-agent.latency' | 'game-session.lifecycle' | 'voice.latency' | 'voice.failed' | 'voice.cancelled' | 'voice.readiness' | 'voice.asr.stage'

export interface ProductDiagnosticRecord {
  schemaVersion: 1
  id: string
  kind: ProductDiagnosticKind
  createdAt: string
  sessionId?: string
  gameId?: string
  interactionId?: string
  detail: Record<string, string | number | boolean>
}

/** Publish measurement facts only. Prompts, transcripts and model reasoning are forbidden here. */
export function publishProductDiagnostic(
  input: Omit<ProductDiagnosticRecord, 'schemaVersion' | 'id' | 'createdAt'>,
): ProductDiagnosticRecord {
  const record: ProductDiagnosticRecord = {
    schemaVersion: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  }
  try {
    process.stdout.write(`${PRODUCT_DIAGNOSTIC_PREFIX}${JSON.stringify(record)}\n`)
  } catch (error) {
    reportRuntimeError(error, { stage: 'diagnostic.stdout', interactionId: input.interactionId })
  }
  return record
}
