import { describe, expect, it } from 'vitest'
import { voiceReadinessText } from '../../apps/desktop/src/voice-readiness.mjs'
import { DshProductRuntime, normalizeProductDiagnostic } from '../../apps/desktop/src/dsh-product-runtime.mjs'

describe('voice readiness is not gateway liveness', () => {
  it('does not assume an online gateway means voice is ready', () => {
    expect(voiceReadinessText(undefined)).toContain('不代表语音可用')
    expect(voiceReadinessText({ enabled: true, asr: 'configured', tts: 'configured', media: 'ready' })).toContain('仍需实际说话测试')
    expect(voiceReadinessText({ enabled: true, asr: 'unavailable' })).toContain('不可用')
    expect(voiceReadinessText({ enabled: true }, false)).toContain('已断开')
  })
  it('retains readiness independently from the trace history and filters unknown fields', () => {
    const runtime = new DshProductRuntime({ baseUrl: 'http://127.0.0.1', cwd: '.', adapterUrl: '' })
    const record = { schemaVersion: 1, kind: 'voice.readiness', detail: { enabled: true, asr: 'configured', tts: 'unavailable', media: 'ready', secret: 'do-not-copy' } }
    expect(normalizeProductDiagnostic(record)?.detail).not.toHaveProperty('secret')
    expect(runtime.attachDiagnosticRecord(record)).toBe(true)
    expect(runtime.snapshot().runtime.voiceReadiness).toEqual({ enabled: true, asr: 'configured', tts: 'unavailable', media: 'ready' })
  })
})
