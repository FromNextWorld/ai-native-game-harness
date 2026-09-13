import type { Context } from '@deepseek-ai/cordis'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { resolveConfig } from '../src/config.js'
import {
  VolcengineSpeechProvider,
  VolcengineStreamingRecognitionSession,
} from '../src/runtime/speech/volcengine-speech-provider.js'

function context(): Context {
  return {
    credentials: {
      describe: async () => ({ configured: true }),
      resolve: async () => ({ value: 'test-key' }),
    },
    logger: { warn: vi.fn(), info: vi.fn() },
  } as unknown as Context
}

afterEach(() => vi.unstubAllGlobals())

describe('Volcengine speech low-latency paths', () => {
  it('starts audio packets at sequence 2 after the implicit initial request sequence', () => {
    class FakeSocket extends EventEmitter {
      readyState = WebSocket.OPEN
      sent: Buffer[] = []
      send(value: Buffer): void { this.sent.push(value) }
      close(): void { this.readyState = WebSocket.CLOSED }
    }
    const socket = new FakeSocket()
    const session = new VolcengineStreamingRecognitionSession(socket as unknown as WebSocket, {
      format: { sampleRate: 16000, bitsPerSample: 16, channels: 1 },
    }, new AbortController().signal)
    session.push(new Uint8Array([1, 2]))
    expect(socket.sent).toHaveLength(1)
    expect(socket.sent[0]?.readInt32BE(4)).toBe(2)
    session.cancel()
  })

  it('yields HTTP chunked TTS audio before the complete response is buffered', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"data":"AQI='))
        controller.enqueue(encoder.encode('"}\n{"data":"AwQ="}\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
    const provider = new VolcengineSpeechProvider(context(), resolveConfig().speech)
    const chunks: number[][] = []
    for await (const chunk of provider.synthesizeStream({ text: '你好。' }, new AbortController().signal)) {
      chunks.push([...chunk])
    }
    expect(chunks).toEqual([[1, 2], [3, 4]])
  })

  it('uses the one-request flash recognizer instead of polling when available', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { text: '你好小汤圆' } }), {
      status: 200,
      headers: { 'X-Api-Status-Code': '20000000' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new VolcengineSpeechProvider(context(), resolveConfig().speech)
    const text = await provider.transcribe({ bytes: new Uint8Array(48), mediaType: 'audio/wav' }, new AbortController().signal)
    expect(text).toBe('你好小汤圆')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/recognize/flash')
  })

  it('uses and records the shared voice for each game without leaking text or credentials', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"data":"AQI="}\n', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = context()
    const voice = 'ICL_uranus_zh_female_yuanqitianmei_tob'
    const provider = new VolcengineSpeechProvider(ctx, resolveConfig({ speech: { ttsResourceId: 'seed-tts-2.0', ttsVoice: voice } }).speech)
    for (const processId of [100, 200, 300]) {
      await provider.synthesize({ text: '私密测试话语', trace: { processId, interactionId: `turn-${processId}`, playbackId: `play-${processId}` } }, new AbortController().signal)
    }
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init.body as string).req_params.speaker).toBe(voice)
      expect(new Headers(init.headers).get('X-Api-Resource-Id')).toBe('seed-tts-2.0')
    }
    const log = vi.mocked(ctx.logger.info).mock.calls.flat().join('\n')
    expect(log).toContain('synthesis.complete')
    expect(log).toContain('"processId":300')
    expect(log).toContain(voice)
    expect(log).not.toContain('test-key')
    expect(log).not.toContain('私密测试话语')
  })

  it('reports synthesis failure without silently switching voice or provider', async () => {
    const fetchMock = vi.fn(async () => new Response('unavailable', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = context()
    const provider = new VolcengineSpeechProvider(ctx, resolveConfig().speech)
    await expect(provider.synthesize({ text: '你好' }, new AbortController().signal)).rejects.toThrow('HTTP 503')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(vi.mocked(ctx.logger.info).mock.calls.flat().join('\n')).toContain('synthesis.failed')
  })
})
