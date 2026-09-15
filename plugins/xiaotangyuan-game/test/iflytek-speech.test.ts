import { createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { registerBuiltInSpeechCapabilities } from '../src/index.js'
import { CapabilityRegistry } from '../src/runtime/capabilities.js'
import { buildIflytekUrl, IflytekStreamingSession } from '../src/runtime/speech/iflytek-speech-provider.js'

function context(configured = true): any {
  return {
    credentials: {
      describe: async () => ({ configured }),
      resolve: async (ref: { key: string }) => ({ value: ref.key }),
    },
    logger: { info() {}, warn() {} },
  }
}

describe('public iFlytek speech provider', () => {
  it('is registered by the production plugin wiring beside Volcengine', async () => {
    const registry = new CapabilityRegistry()
    registerBuiltInSpeechCapabilities(context(), registry, resolveConfig().speech)
    expect(await registry.describe('speech.transcribe', 'iflytek')).toEqual({
      capability: 'speech.transcribe', ready: true, provider: 'iflytek',
    })
    expect(await registry.describe('speech.synthesize', 'volcengine')).toMatchObject({ ready: true, provider: 'volcengine' })
  })

  it('signs the canonical request without placing the secret in the URL', () => {
    const credentials = { appId: 'app-id', apiKey: 'api-key', apiSecret: 'top-secret' }
    const url = new URL(buildIflytekUrl(credentials, new Date('2026-09-15T10:00:00.000Z'), 'fixed-uuid'))
    const canonical = [...url.searchParams.entries()].filter(([key]) => key !== 'signature')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
    expect(url.searchParams.get('signature')).toBe(createHmac('sha1', credentials.apiSecret).update(canonical).digest('base64'))
    expect(url.href).not.toContain(credentials.apiSecret)
    expect(url.searchParams.get('appId')).toBe('app-id')
  })

  it('uses the production streaming contract for PCM frames, partial text and final text', async () => {
    class FakeSocket extends EventEmitter {
      sent: Array<Buffer | string> = []
      send(value: Buffer | string): void { this.sent.push(value) }
      close(): void { this.emit('close') }
    }
    const socket = new FakeSocket()
    const partial: string[] = []
    const session = new IflytekStreamingSession(socket as any, {
      format: { sampleRate: 16_000, bitsPerSample: 16, channels: 1 },
      onPartial: text => partial.push(text),
    }, new AbortController().signal)
    socket.emit('message', Buffer.from(JSON.stringify({ action: 'started', sid: 'session-1' })))
    session.push(new Uint8Array(1280))
    const final = session.finish()
    socket.emit('message', Buffer.from(JSON.stringify({ data: { seg_id: 0, cn: { st: { type: 0, rt: [{ ws: [{ cw: [{ w: '你好，小汤圆' }] }] }] } }, ls: true } })))
    await expect(final).resolves.toBe('你好，小汤圆')
    expect(partial).toContain('你好，小汤圆')
    expect(Buffer.isBuffer(socket.sent[0])).toBe(true)
    expect(socket.sent).toContain(JSON.stringify({ end: true, sessionId: 'session-1' }))
  })
})
