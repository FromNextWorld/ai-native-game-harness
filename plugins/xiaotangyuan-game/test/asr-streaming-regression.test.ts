import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SpeechController } from '../src/runtime/speech/speech-controller.js'
import { CapabilityRegistry } from '../src/runtime/capabilities.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
async function fixture(options: { fail?: boolean, slowDiscovery?: boolean } = {}) {
  vi.stubEnv('DSH_HOME', mkdtempSync(join(tmpdir(), 'asr-regression-')))
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const final = Promise.withResolvers<string>()
  const discovery = Promise.withResolvers<boolean>()
  let request: any, listener: any, asrSignal: AbortSignal
  const session = { push: vi.fn(), cancel: vi.fn(), finish: vi.fn(() => options.fail ? Promise.reject(new Error('stream failed')) : final.promise) }
  const provider = { id: 'test-asr', isAvailable: vi.fn(async () => true), transcribe: vi.fn(async () => 'replayed'), startStreaming: vi.fn(async (value: any, signal: AbortSignal) => { request = value; asrSignal = signal; return session }) }
  const registry = new CapabilityRegistry()
  registry.register('speech.transcribe', provider)
  const handler = { recordingStarted: vi.fn(), recordingStopped: vi.fn(), recognitionPartial: vi.fn(), failed: vi.fn(), respond: vi.fn(async () => ({ reply: '', speechPlayed: true, sessionId: 's', interactionId: 'i', gameId: 'mock' })) }
  const media = { onEvent: (value: any) => { listener = value; return () => {} }, start: async () => true, configure: () => {}, close: async () => {}, cancelPlayback: () => {} }
  const controller = new SpeechController({ logger: { info: vi.fn(), warn: vi.fn() } } as never, { enabled: true, recognitionProvider: 'test-asr' } as never, media as never, handler as never, registry)
  await controller.start()
  if (options.slowDiscovery) provider.isAvailable.mockImplementationOnce(() => discovery.promise)
  const send = (type: string, recordingId = 'r') => listener({ type: `recording.${type}`, processId: 42, recordingId, sampleRate: 16000, bitsPerSample: 16, channels: 1, audioBase64: 'AAA=', mediaType: 'audio/wav', message: 'cancel' })
  return { controller, send, handler, provider, session, final, discovery, get request() { return request }, get signal() { return asrSignal! } }
}

describe('real registry -> media events -> ASR -> final-only reply', () => {
  it('publishes partials while recording without submitting to the agent', async () => {
    const f = await fixture()
    try {
      await f.send('started'); await f.send('chunk')
      f.request.onPartial?.('浇水')
      expect(f.handler.recognitionPartial).toHaveBeenCalledWith(42, '浇水', false)
      expect(f.handler.respond).not.toHaveBeenCalled()
      await f.send('stopped')
      const completed = f.send('completed')
      f.final.resolve('不要浇水')
      await completed
      expect(f.handler.respond).toHaveBeenCalledOnce()
      expect(f.handler.respond).toHaveBeenCalledWith(42, '不要浇水', expect.any(AbortSignal))
    } finally { await f.controller.close() }
  })
  it('does not replay the whole recording after streaming finish fails', async () => {
    const f = await fixture({ fail: true })
    try {
      await f.send('started'); await f.send('chunk'); await f.send('completed')
      expect(f.provider.transcribe).not.toHaveBeenCalled()
      expect(f.handler.respond).not.toHaveBeenCalled()
      expect(f.handler.failed).toHaveBeenCalled()
    } finally { await f.controller.close() }
  })
  it('waits for the original startup promise, not a second provider lookup and file replay', async () => {
    const f = await fixture({ slowDiscovery: true })
    try {
      const started = f.send('started')
      await f.send('chunk')
      const completed = f.send('completed')
      await new Promise(resolve => setImmediate(resolve))
      expect(f.provider.transcribe).not.toHaveBeenCalled()
      f.discovery.resolve(true); await started
      f.final.resolve('测试'); await completed
      expect(f.provider.startStreaming).toHaveBeenCalledOnce()
      expect(f.session.push).toHaveBeenCalledOnce()
      expect(f.handler.respond).toHaveBeenCalledOnce()
    } finally { f.discovery.resolve(true); f.final.resolve('测试'); await f.controller.close() }
  })
  it('ignores a cancelled recording completion and stale partial callbacks', async () => {
    const f = await fixture()
    try {
      await f.send('started'); const stale = f.request
      await f.send('cancelled'); await f.send('started', 'new')
      stale.onPartial?.('旧任务')
      await f.send('completed', 'r')
      expect(f.handler.recognitionPartial).not.toHaveBeenCalled()
      expect(f.provider.transcribe).not.toHaveBeenCalled()
      expect(f.handler.respond).not.toHaveBeenCalled()
    } finally { await f.controller.close() }
  })
  it('does not let a provider ignoring abort submit an old final after barge-in', async () => {
    const f = await fixture()
    try {
      await f.send('started'); await f.send('chunk')
      const completed = f.send('completed')
      await new Promise(resolve => setImmediate(resolve))
      const previousSignal = f.signal
      await f.send('started', 'next')
      expect(previousSignal.aborted).toBe(true)
      f.final.resolve('旧操作'); await completed
      expect(f.handler.respond).not.toHaveBeenCalled()
      expect(f.handler.failed).not.toHaveBeenCalled()
    } finally { await f.controller.close() }
  })
  it('does not surface a late startup failure in a newer recording', async () => {
    const f = await fixture({ slowDiscovery: true })
    try {
      const previous = f.send('started')
      await f.send('started', 'next')
      f.discovery.resolve(true); await previous
      expect(f.handler.failed).not.toHaveBeenCalled()
    } finally { await f.controller.close() }
  })
})
