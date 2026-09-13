import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
const root = process.env.AGH_SPEECH_TEST_ROOT
const scenario = process.env.AGH_SPEECH_TEST_SCENARIO
const { SpeechController } = await import(pathToFileURL(join(root, 'runtime/speech/speech-controller.js')))
const { WindowsMediaHost } = await import(pathToFileURL(join(root, 'runtime/media/windows-media-host.js')))
const { CapabilityRegistry } = await import(pathToFileURL(join(root, 'runtime/capabilities.js')))
const logger = { warn() {}, info() {} }
const media = new WindowsMediaHost({ logger }, { enabled: false })
const requests = []
const replies = []
const captions = []
let calls = 0
const entered = Promise.withResolvers()
const waitForAbort = signal => new Promise((resolve, reject) => {
  const aborted = () => reject(signal.reason)
  signal.addEventListener('abort', aborted, { once: true })
  if (signal.aborted) aborted()
})
const tts = { id: 'test-tts', isAvailable: async () => true, synthesize: async () => { throw new Error('unexpected whole-answer replay') },
  async *synthesizeStream(_request, signal) {
    calls++
    if (scenario === 'caption' || scenario === 'partial-failure') {
      yield new Uint8Array(calls === 1 ? 48000 : 960)
      if (scenario === 'caption' && calls === 1) return
    }
    entered.resolve()
    if (scenario === 'provider-failure' || scenario === 'partial-failure') { await delay(5); throw new Error('TEST_PROVIDER_FAILURE') }
    await waitForAbort(signal)
  } }
const capabilities = new CapabilityRegistry()
capabilities.register('speech.synthesize', tts)
capabilities.register('speech.transcribe', { id: 'test-asr', isAvailable: async () => true, transcribe: async () => 'new input' })
const handler = { recordingStarted() {}, recordingStopped() {}, speechStarted() {}, speechFinished() {},
  speechPhraseStarted(_pid, _id, phrase) { captions.push(phrase) },
  failed(_pid, message) { throw new Error('Unexpected player failure: ' + message) },
  async respond(_pid, transcript) { replies.push(transcript); return { reply: 'ok', speechPlayed: true, sessionId: 'test', interactionId: 'new', gameId: 'test' } } }
const controller = new SpeechController({ logger }, { enabled: true }, media, handler, capabilities)
await controller.start()
// External media executable boundary only. Keep the real JSON dispatch,
// playback-position timers and abort handling, not fake playback completion.
media.child = { stdin: { writable: true, write(line) { requests.push(JSON.parse(line)) } } }
await controller.appendSpeechDelta(42, 'old', scenario === 'caption' ? '第一句。第二句。' : '第一句。')
await entered.promise
await delay(10)
if (scenario === 'close') {
  media.child = undefined
  await controller.close()
} else if (scenario !== 'provider-failure' && scenario !== 'partial-failure') {
  media.onLine(JSON.stringify({ type: 'recording.started', processId: 42, recordingId: 'new', sampleRate: 16000, bitsPerSample: 16, channels: 1 }))
}
// Stay alive across a real event-loop turn before model finalization and the
// late await in finishSpeechReply; do not register a global rejection handler.
await delay(30)
assert(!captions.includes('第二句。'), 'canceled caption was displayed')
if (scenario === 'partial-failure') await assert.rejects(controller.finishSpeechReply(42, 'old', '第一句。'), /TEST_PROVIDER_FAILURE/)
if (scenario === 'provider-failure') assert.equal(await controller.finishSpeechReply(42, 'old', '第一句。'), false)
if (scenario !== 'close') {
  media.onLine(JSON.stringify({ type: 'recording.completed', processId: 42, recordingId: 'new', mediaType: 'audio/wav', audioBase64: '' }))
  await delay(30)
  assert.deepEqual(replies, ['new input'], 'next recording must still work')
  media.child = undefined
  await controller.close()
}
await delay(10)
console.log(JSON.stringify({ scenario, survived: true, nextRecording: scenario === 'close' ? 'not_applicable' : replies.length }))
