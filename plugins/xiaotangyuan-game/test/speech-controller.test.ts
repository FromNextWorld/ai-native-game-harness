import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SpeechController } from '../src/runtime/speech/speech-controller.js'

let testHome: string
beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'xty-speech-diagnostics-'))
  vi.stubEnv('DSH_HOME', testHome)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

function controllerWith(stream: (signal: AbortSignal) => AsyncIterable<Uint8Array>) {
  const synthesizeStream = vi.fn((_request: { text: string }, signal: AbortSignal) => stream(signal))
  const provider = {
    id: 'test-tts',
    isAvailable: async () => true,
    synthesize: vi.fn(),
    synthesizeStream,
  }
  const media = {
    startPcmPlayback: vi.fn(), appendPcmPlayback: vi.fn(), finishPcmPlayback: vi.fn(async () => undefined),
    waitForPcmPosition: vi.fn(async () => undefined), cancelPlayback: vi.fn(),
  }
  const handler = {
    speechStarted: vi.fn(),
    speechPhraseStarted: vi.fn(),
    speechFinished: vi.fn(),
  }
  const capabilities = { resolve: async () => provider }
  const controller = new SpeechController(
    { logger: { warn: vi.fn(), info: vi.fn() } } as never,
    {} as never,
    media as never,
    handler as never,
    capabilities as never,
  )
  return { controller, media, handler, synthesizeStream }
}

describe('streaming speech exactly-once fallback', () => {
  it('does not let late cleanup of an interrupted reply remove the newer reply', async () => {
    const old = Promise.withResolvers<void>()
    let generation = 0
    const { controller } = controllerWith(async function* () {
      if (++generation === 1) await old.promise
      yield new Uint8Array([1, 2])
    })
    await controller.appendSpeechDelta(42, 'old', '旧回复。')
    const finishing = controller.finishSpeechReply(42, 'old', '旧回复。')
    void finishing.catch(() => undefined)
    await controller.appendSpeechDelta(42, 'new', '新回复。')
    old.resolve()
    await finishing.catch(() => undefined)
    expect((controller as any).speechOutputs.get(42)?.interactionId).toBe('new')
    await expect(controller.finishSpeechReply(42, 'new', '新回复。')).resolves.toBe(true)
  })
  it('starts media after bounded discovery and ignores a late provider success', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<unknown>()
    const media = { onEvent: () => vi.fn(), start: vi.fn(async () => true), configure: vi.fn(), close: vi.fn(async () => undefined) }
    const controller = new SpeechController({} as never, { enabled: true } as never, media as never, {} as never,
      { resolve: (capability: string) => capability === 'speech.transcribe' ? pending.promise : Promise.resolve({}) } as never)
    try {
      const starting = controller.start()
      await vi.advanceTimersByTimeAsync(5_000)
      await starting
      expect(media.start).toHaveBeenCalledOnce()
      const last = String(vi.mocked(process.stdout.write).mock.calls.at(-1)?.[0])
      expect(last).toContain('"asr":"timeout"')
      expect(last).toContain('"tts":"configured"')
      pending.resolve({})
      await Promise.resolve()
      expect(String(vi.mocked(process.stdout.write).mock.calls.at(-1)?.[0])).toBe(last)
    } finally { await controller.close(); vi.useRealTimers() }
  })
  it('bounds a media host that never announces readiness', async () => {
    vi.useFakeTimers()
    const media = { onEvent: () => vi.fn(), start: async () => true, configure: vi.fn(), close: vi.fn(async () => undefined) }
    const controller = new SpeechController({} as never, { enabled: true } as never, media as never, {} as never,
      { resolve: async () => ({}) } as never)
    try {
      await controller.start()
      await vi.advanceTimersByTimeAsync(15_000)
      expect(media.close).toHaveBeenCalledOnce()
      expect(String(vi.mocked(process.stdout.write).mock.calls.at(-1)?.[0])).toContain('"media":"unavailable"')
    } finally {
      await controller.close()
      vi.useRealTimers()
    }
  })
  it('reports configuration separately and starts media even when one provider check fails', async () => {
    let listener: (event: unknown) => Promise<void> = async () => undefined
    const media = { onEvent: vi.fn(callback => { listener = callback; return vi.fn() }), start: vi.fn(async () => true), configure: vi.fn(), close: vi.fn() }
    const controller = new SpeechController(
      { logger: { warn: vi.fn() } } as never, { enabled: true } as never, media as never, {} as never,
      { resolve: async (capability: string) => { if (capability === 'speech.transcribe') throw new Error('missing ASR'); return {} } } as never,
    )
    await controller.start()
    expect(media.start).toHaveBeenCalledOnce()
    await listener({ type: 'ready' })
    const output = vi.mocked(process.stdout.write).mock.calls.map(call => String(call[0])).join('')
    expect(output).toContain('"asr":"unavailable"')
    expect(output).toContain('"tts":"configured"')
    expect(output).toContain('"media":"ready"')
    expect(output).toContain('"microphone":"untested"')
    await listener({ type: 'host.stopped' })
    expect(String(vi.mocked(process.stdout.write).mock.calls.at(-1)?.[0])).toContain('"media":"unavailable"')
    await controller.close()
  })
  it('does not start media after being closed during provider discovery', async () => {
    const pending = Promise.withResolvers<unknown>()
    const media = { start: vi.fn(), close: vi.fn() }
    const controller = new SpeechController({} as never, { enabled: true } as never, media as never, {} as never,
      { resolve: () => pending.promise } as never)
    const starting = controller.start()
    await controller.close()
    pending.resolve({})
    await starting
    expect(media.start).not.toHaveBeenCalled()
  })
  it('persists the original agent error and sends its ID to the player failure handler', async () => {
    const cause = Object.assign(new Error('session occupied'), { code: 'SESSION_BUSY' })
    const error = new Error('could not initialize', { cause })
    const handler = { failed: vi.fn(), respond: vi.fn(async () => { throw error }) }
    const controller = new SpeechController(
      { logger: { warn: vi.fn() } } as never, {} as never, {} as never,
      handler as never, { resolve: async () => ({ transcribe: async () => 'private player text' }) } as never,
    )
    await (controller as any).onMediaEvent({ type: 'recording.completed', processId: 42, recordingId: 'recording-42', mediaType: 'audio/wav', audioBase64: '' })
    const directory = join(testHome, 'diagnostics')
    const rows = readFileSync(join(directory, readdirSync(directory)[0]!), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ context: { stage: 'agent.respond', processId: 42, recordingId: 'recording-42' }, error: { message: 'could not initialize', cause: { code: 'SESSION_BUSY' } } })
    expect(handler.failed).toHaveBeenCalledWith(42, 'could not initialize', rows[0].errorId)
    expect(JSON.stringify(rows)).not.toContain('private player text')
  })

  it('does not silently lose provider selection errors before recording completes', async () => {
    const handler = { recordingStarted: vi.fn(), failed: vi.fn() }
    const controller = new SpeechController(
      { logger: { warn: vi.fn() } } as never, {} as never, { cancelPlayback: vi.fn() } as never,
      handler as never, { resolve: async () => { throw new Error('ASR provider unavailable') } } as never,
    )
    await (controller as any).onMediaEvent({ type: 'recording.started', processId: 42, recordingId: 'r', sampleRate: 16000, bitsPerSample: 16, channels: 1 })
    expect(handler.failed).toHaveBeenCalledWith(42, 'ASR provider unavailable', expect.any(String))
  })
  it('does not replay the whole answer after partial streaming audio was already played', async () => {
    const { controller, media } = controllerWith(async function* () {
      yield new Uint8Array([1, 2, 3])
      throw new Error('stream interrupted')
    })
    await controller.appendSpeechDelta(42, 'turn-1', '第一句。')
    // Old true meant "some bytes arrived", not "playback completed", and
    // incorrectly authorized post-reply game actions. Preserve no replay by
    // propagating the stream error instead.
    await expect(controller.finishSpeechReply(42, 'turn-1', '第一句。')).rejects.toThrow('stream interrupted')
    expect(media.appendPcmPlayback).toHaveBeenCalledTimes(1)
  })

  it('allows the full-answer fallback when streaming failed before any audio arrived', async () => {
    const { controller, media } = controllerWith(async function* () {
      await Promise.resolve()
      throw new Error('stream unavailable')
    })
    await controller.appendSpeechDelta(42, 'turn-2', '第一句。')
    await expect(controller.finishSpeechReply(42, 'turn-2', '第一句。')).resolves.toBe(false)
    expect(media.appendPcmPlayback).not.toHaveBeenCalled()
  })

  it('does not report streamed speech complete until buffered playback has drained', async () => {
    let finishPlayback!: () => void
    const { controller, media } = controllerWith(async function* () {
      yield new Uint8Array([1, 2, 3])
    })
    media.finishPcmPlayback.mockImplementation(() => new Promise<void>(resolve => { finishPlayback = resolve }))
    await controller.appendSpeechDelta(42, 'turn-3', '第一句。')
    let settled = false
    const result = controller.finishSpeechReply(42, 'turn-3', '第一句。').finally(() => { settled = true })
    await vi.waitFor(() => expect(media.finishPcmPlayback).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    finishPlayback()
    await expect(result).resolves.toBe(true)
  })

  it('publishes voice captions one completed phrase at that phrase playback position', async () => {
    const { controller, media, handler } = controllerWith(async function* () {
      yield new Uint8Array([1, 2, 3, 4])
    })
    await controller.appendSpeechDelta(42, 'turn-4', '第一句。第二句。')
    await expect(controller.finishSpeechReply(42, 'turn-4', '第一句。第二句。')).resolves.toBe(true)
    expect(media.waitForPcmPosition).toHaveBeenNthCalledWith(1, expect.any(String), 0, expect.any(AbortSignal))
    expect(media.waitForPcmPosition).toHaveBeenNthCalledWith(2, expect.any(String), 4, expect.any(AbortSignal))
    expect(handler.speechPhraseStarted).toHaveBeenNthCalledWith(1, 42, 'turn-4', '第一句。', '第一句。')
    expect(handler.speechPhraseStarted).toHaveBeenNthCalledWith(2, 42, 'turn-4', '第二句。', '第一句。第二句。')
  })

  it('removes asterisks before phrase synthesis and caption publication', async () => {
    const { controller, handler, synthesizeStream } = controllerWith(async function* () {
      yield new Uint8Array([1, 2, 3, 4])
    })
    await controller.appendSpeechDelta(42, 'turn-5', '**第一句。**第二句。')
    await expect(controller.finishSpeechReply(42, 'turn-5', '**第一句。**第二句。')).resolves.toBe(true)
    expect(synthesizeStream).toHaveBeenNthCalledWith(1, { text: '第一句。', trace: { processId: 42, interactionId: 'turn-5', playbackId: expect.any(String) } }, expect.any(AbortSignal))
    expect(synthesizeStream).toHaveBeenNthCalledWith(2, { text: '第二句。', trace: { processId: 42, interactionId: 'turn-5', playbackId: expect.any(String) } }, expect.any(AbortSignal))
    expect(handler.speechPhraseStarted).toHaveBeenLastCalledWith(42, 'turn-5', '第二句。', '第一句。第二句。')
  })
})
