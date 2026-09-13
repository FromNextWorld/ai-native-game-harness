import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportRuntimeError, serializeDiagnosticError } from '../src/runtime/error-diagnostics.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('durable error diagnostics', () => {
  it('retains stacks, nested causes and status, without arbitrary request payloads or keys', () => {
    vi.stubEnv('TEST_API_KEY', 'dummy-private-credential')
    const cause = Object.assign(new Error('Authorization: Bearer dummy-bearer-value APIKey=dummy-query-value dummy-private-credential'), { code: 'ECONNRESET', status: 429 })
    const error = Object.assign(new Error('session init failed', { cause }), { request: { prompt: 'DO NOT STORE', audio: 'PRIVATE AUDIO' } })
    const serialized = serializeDiagnosticError(error)
    expect(serialized).toMatchObject({ message: 'session init failed', stack: expect.stringContaining('session init failed'), cause: { code: 'ECONNRESET', status: 429, stack: expect.any(String) } })
    const text = JSON.stringify(serialized)
    for (const secret of ['dummy-bearer-value', 'dummy-query-value', 'dummy-private-credential', 'DO NOT STORE', 'PRIVATE AUDIO']) expect(text).not.toContain(secret)
  })

  it('keeps every AggregateError child and marks cycles explicitly', () => {
    const error = new AggregateError([new Error('a'), new Error('b')], 'multiple failures')
    error.cause = error
    expect(serializeDiagnosticError(error)).toMatchObject({ errors: [{ message: 'a' }, { message: 'b' }], cause: { omitted: 'circular-reference' } })
  })

  it('appends and flushes complete JSONL records with one error ID across boundaries', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const directory = mkdtempSync(join(tmpdir(), 'xty-error-test-'))
    const error = new Error('session still registered')
    const first = reportRuntimeError(error, { stage: 'agent.session.initialize', sessionId: 'test-session' }, directory)
    const second = reportRuntimeError(error, { stage: 'agent.respond', recordingId: 'recording-test' }, directory)
    expect(first.persisted).toBe(true)
    expect(second.errorId).toBe(first.errorId)
    const lines = readFileSync(first.path, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(lines).toHaveLength(2)
    expect(lines[0].error.stack).toContain('session still registered')
    expect(lines[1].context.recordingId).toBe('recording-test')
  })

  it('reports a failed durable sink through independent stderr and stdout without throwing', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const directory = mkdtempSync(join(tmpdir(), 'xty-error-failed-sink-'))
    const file = join(directory, 'not-a-directory')
    writeFileSync(file, 'test')
    const result = reportRuntimeError(new Error('original error'), { stage: 'test' }, file)
    expect(result.persisted).toBe(false)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('AI_GAME_HARNESS_LOG_WRITE_FAILED'))
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('original error'))
  })

  it('persists even when the stdout pipe is broken', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => { throw new Error('EPIPE') })
    const directory = mkdtempSync(join(tmpdir(), 'xty-error-pipe-'))
    const result = reportRuntimeError(new Error('root cause'), { stage: 'test' }, directory)
    expect(result.persisted).toBe(true)
    expect(readFileSync(result.path, 'utf8')).toContain('root cause')
  })
})
