import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ids = new WeakMap<object, string>()
const SECRET_FIELD = /((?:api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token|authorization|password|signature|pollSecret|secret|token)\s*["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi

/** Error metadata only: never serialize request/response objects or conversation content. */
export function redactDiagnostic(value: string): string {
  let result = value.replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(SECRET_FIELD, '$1[REDACTED]')
    .replace(/(https?:\/\/|wss?:\/\/)([^\s/@]+:[^\s/@]+)@/gi, '$1[REDACTED]@')
  for (const [key, secret] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) && secret !== undefined && secret.length >= 8) {
      result = result.replaceAll(secret, '[REDACTED]')
    }
  }
  return result
}

export function serializeDiagnosticError(error: unknown, seen = new Set<object>(), depth = 0): unknown {
  if (error === null || typeof error !== 'object') return { message: redactDiagnostic(String(error)) }
  if (seen.has(error)) return { omitted: 'circular-reference' }
  if (depth >= 32) return { omitted: 'cause-depth-limit', limit: 32 }
  seen.add(error)
  const result: Record<string, unknown> = {}
  for (const key of ['name', 'message', 'stack', 'code', 'status', 'statusCode', 'provider', 'providerCode', 'closeCode', 'retryable', 'errno', 'syscall', 'requestId', 'request_id', 'traceId']) {
    try {
      const value: unknown = Reflect.get(error, key)
      if (typeof value === 'string') result[key] = redactDiagnostic(value)
      else if (typeof value === 'number' || typeof value === 'boolean') result[key] = value
    } catch { result[key] = '[unreadable-property]' }
  }
  for (const key of ['cause', 'errors']) {
    try {
      const value: unknown = Reflect.get(error, key)
      if (value !== undefined) result[key] = key === 'errors' && Array.isArray(value)
        ? value.map(item => serializeDiagnosticError(item, seen, depth + 1))
        : serializeDiagnosticError(value, seen, depth + 1)
    } catch { result[key] = '[unreadable-property]' }
  }
  seen.delete(error)
  return result
}

export interface ErrorDiagnosticContext {
  stage: string
  source?: string
  processId?: number
  recordingId?: string
  requestId?: string
  interactionId?: string
  sessionId?: string
  gameId?: string
  provider?: string
  model?: string
  atom?: string
  elapsedMs?: number
  recovered?: boolean
}

export function diagnosticDirectory(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'diagnostics')
}

/** Append before returning; broken log sinks must not turn a recoverable error into a crash. */
export function reportRuntimeError(error: unknown, context: ErrorDiagnosticContext, directory = diagnosticDirectory()) {
  const object = error !== null && typeof error === 'object' ? error : undefined
  const errorId = (object === undefined ? undefined : ids.get(object)) ?? randomUUID()
  if (object !== undefined) ids.set(object, errorId)
  const record = {
    schemaVersion: 1, kind: 'runtime.error', errorId, createdAt: new Date().toISOString(),
    context: Object.fromEntries(Object.entries(context).map(([key, value]) =>
      [key, typeof value === 'string' ? redactDiagnostic(value) : value])),
    error: serializeDiagnosticError(error),
  }
  const line = `${JSON.stringify(record)}\n`
  const path = join(directory, `errors-${record.createdAt.slice(0, 10)}.jsonl`)
  let persisted = false
  try {
    mkdirSync(directory, { recursive: true })
    appendFileSync(path, line, { encoding: 'utf8', mode: 0o600, flush: true })
    persisted = true
  } catch (storageError) {
    try { process.stderr.write(`AI_GAME_HARNESS_LOG_WRITE_FAILED ${JSON.stringify({ errorId, path, error: serializeDiagnosticError(storageError) })}\n`) } catch { /* The independent stdout sink is still attempted below. */ }
  }
  try { process.stdout.write(`AI_GAME_HARNESS_ERROR ${line}`) } catch { /* Durable sink was attempted independently. */ }
  return { errorId, persisted, path, record }
}
