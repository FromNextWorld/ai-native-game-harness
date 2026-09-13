import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpeechController } from '../src/runtime/speech/speech-controller.js'
import { playerFacingVoiceFailure } from '../src/gateway/game-gateway.js'

beforeEach(() => {
  vi.stubEnv('DSH_HOME', mkdtempSync(join(tmpdir(), 'agh-asr-regression-')))
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
function fixture(error: Error, atStart = false) {
  const session = { push: vi.fn(), finish: vi.fn(async () => { throw error }), cancel: vi.fn() }
  const provider = { startStreaming: vi.fn(async () => { if (atStart) throw error; return session }), transcribe: vi.fn(async () => '万剑归宗') }
  const handler = { recordingStarted: vi.fn(), failed: vi.fn(), respond: vi.fn(async () => ({ reply: '让我试试', speechPlayed: true, sessionId: 'test', interactionId: 'test', gameId: 'stardew-valley' })) }
  const controller = new SpeechController({ logger: { warn: vi.fn(), info: vi.fn() } } as never, {} as never,
    { cancelPlayback: vi.fn() } as never, handler as never, { resolve: async () => provider } as never)
  const event = (event: unknown) => (controller as any).onMediaEvent(event)
  const run = async () => {
    await event({ type: 'recording.started', processId: 42, recordingId: 'r', sampleRate: 16000, bitsPerSample: 16, channels: 1 })
    await Promise.resolve()
    await event({ type: 'recording.chunk', processId: 42, recordingId: 'r', audioBase64: 'AAAA' })
    await event({ type: 'recording.completed', processId: 42, recordingId: 'r', audioBase64: 'AAAA', mediaType: 'audio/wav' })
  }
  return { provider, handler, session, run }
}
describe('ASR production event retry boundary', () => {
  it('waits for provider discovery and preserves ordered chunks when a short recording finishes during startup', async () => {
    const discovery = Promise.withResolvers<any>()
    const chunks: number[] = []
    const session = { push: (bytes: Uint8Array) => chunks.push(...bytes), finish: vi.fn(async () => '万剑归宗'), cancel: vi.fn() }
    const provider = { startStreaming: vi.fn(async () => session), transcribe: vi.fn(async () => '不该走降级') }
    const handler = { recordingStarted: vi.fn(), failed: vi.fn(), respond: vi.fn(async () => ({ reply: '我来试试', speechPlayed: true, sessionId: 's', interactionId: 'i', gameId: 'stardew-valley' })) }
    let selects = 0
    const controller = new SpeechController({ logger: { warn: vi.fn(), info: vi.fn() } } as never, {} as never, { cancelPlayback: vi.fn() } as never, handler as never,
      { resolve: async () => ++selects === 1 ? discovery.promise : provider } as never)
    const event = (e: unknown) => (controller as any).onMediaEvent(e)
    const starting = event({ type: 'recording.started', processId: 42, recordingId: 'slow', sampleRate: 16000, bitsPerSample: 16, channels: 1 })
    await event({ type: 'recording.chunk', processId: 42, recordingId: 'slow', audioBase64: 'AQI=' })
    await event({ type: 'recording.chunk', processId: 42, recordingId: 'slow', audioBase64: 'AwQ=' })
    const complete = event({ type: 'recording.completed', processId: 42, recordingId: 'slow', audioBase64: 'AQIDBA==', mediaType: 'audio/wav' })
    await Promise.resolve(); await Promise.resolve()
    discovery.resolve(provider)
    await starting; await complete
    expect(provider.transcribe).not.toHaveBeenCalled()
    expect(chunks).toEqual([1, 2, 3, 4])
    expect(session.finish).toHaveBeenCalledOnce()
    expect(handler.respond).toHaveBeenCalledWith(42, '万剑归宗', expect.anything())
  })
  it.each([false, true])('does not retry quota/config errors at start=%s or send a guessed command to the agent', async atStart => {
    const f = fixture(Object.assign(new Error('ASR_QUOTA providerCode=35002'), { code: 'ASR_QUOTA', retryable: false }), atStart)
    await f.run()
    expect(f.provider.transcribe).not.toHaveBeenCalled()
    expect(f.handler.respond).not.toHaveBeenCalled()
    expect(f.handler.failed).toHaveBeenCalledWith(42, expect.stringContaining('ASR_QUOTA'), expect.any(String))
  })
  it('does not retry an unclassified HTTP 500', async () => {
    const f = fixture(new Error('语音识别失败 HTTP 500'))
    await f.run()
    expect(f.provider.transcribe).not.toHaveBeenCalled()
  })
  it('requires a new recording even for a transient disconnect, without silently replaying audio', async () => {
    const f = fixture(Object.assign(new Error('ASR_NETWORK'), { code: 'ASR_NETWORK', retryable: true }))
    await f.run()
    expect(f.provider.transcribe).not.toHaveBeenCalled()
    expect(f.handler.respond).not.toHaveBeenCalled()
    expect(f.handler.failed).toHaveBeenCalledWith(42, expect.stringContaining('ASR_NETWORK'), expect.any(String))
    expect(f.session.cancel).toHaveBeenCalled()
  })
  it.each([['ASR_QUOTA providerCode=35002', '额度'], ['ASR_AUTH', '凭据'], ['ASR_CLOCK', '时间'], ['ASR_PROTOCOL', '完整'], ['ASR_EMPTY', '听清']])('explains %s in plain Chinese', (code, word) => {
    expect(playerFacingVoiceFailure(code)).toContain(word)
  })
})
