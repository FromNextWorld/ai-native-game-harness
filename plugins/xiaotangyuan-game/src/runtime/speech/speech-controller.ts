import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { ResolvedConfig } from '../../config.js'
import { CapabilityRegistry } from '../capabilities.js'
import type { MediaHostEvent } from '../media/windows-media-host.js'
import { WindowsMediaHost } from '../media/windows-media-host.js'
import type { SpeechRecognitionProvider, SpeechSynthesisProvider, StreamingRecognitionSession } from '../providers/contracts.js'
import { publishProductDiagnostic } from '../diagnostics.js'
import { reportRuntimeError } from '../error-diagnostics.js'
import { withProviderCheckDeadline } from './provider-check-deadline.js'

export interface VoiceInteractionHandler {
  recordingStarted(processId: number): void
  recordingStopped(processId: number): void
  recognitionPartial?(processId: number, text: string, stopped: boolean): void
  speechStarted(processId: number, interactionId: string): void
  speechPhraseStarted(processId: number, interactionId: string, phrase: string, text: string): void
  speechFinished(processId: number, interactionId: string): void
  respond(processId: number, transcript: string, signal: AbortSignal): Promise<{
    reply: string
    speechPlayed: boolean
    sessionId: string
    interactionId: string
    gameId: string
    afterPlayback?: () => void
  }>
  failed(processId: number, message: string, errorId?: string): void
}

interface LiveRecording {
  controller: AbortController
  processId: number
  startedAt: number
  stoppedAt?: number
  finalized?: boolean
  provider?: SpeechRecognitionProvider
  setup?: Promise<void>
  stream?: StreamingRecognitionSession
  buffered: Uint8Array[]
}

interface SpeechOutput {
  processId: number
  interactionId: string
  controller: AbortController
  buffer: string
  spokenText: string
  playbackId: string
  chain: Promise<void>
  provider: SpeechSynthesisProvider
  started: boolean
  audioAppended: boolean
  queuedAudioBytes: number
  captionText: string
  captionChain: Promise<void>
  speechAnnounced: boolean
  failure?: { error: unknown }
}

export function stripSpeechFormatting(text: string): string {
  return text.replace(/\*/g, '')
}

export class SpeechController {
  private readonly active = new Set<number>()
  private readonly recordings = new Map<string, LiveRecording>()
  private readonly latestRecording = new Map<number, string>()
  private readonly interactions = new Map<number, AbortController>()
  private readonly speechOutputs = new Map<number, SpeechOutput>()
  private targets: readonly number[] = []
  private disposeListener?: () => void
  private readiness = { enabled: false, asr: 'unchecked', tts: 'unchecked', media: 'unchecked', microphone: 'untested' }
  private closed = false
  private readonly lifecycle = new AbortController()
  private mediaReadyTimer?: ReturnType<typeof setTimeout>

  private publishReadiness(): void {
    publishProductDiagnostic({ kind: 'voice.readiness', detail: { ...this.readiness } })
  }

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig['speech'],
    private readonly media: WindowsMediaHost,
    private readonly handler: VoiceInteractionHandler,
    private readonly capabilities: CapabilityRegistry,
  ) {}

  async start(): Promise<void> {
    this.readiness.enabled = this.config.enabled
    this.publishReadiness()
    if (!this.config.enabled) return
    const [recognition, synthesis] = await Promise.allSettled([
      this.selectRecognitionProvider(),
      this.selectSynthesisProvider(),
    ])
    if (this.closed) return
    const status = (result: PromiseSettledResult<unknown>): string => result.status === 'fulfilled'
      ? result.value !== undefined ? 'configured' : 'unavailable'
      : result.reason?.code === 'SPEECH_CONFIG_TIMEOUT' ? 'timeout' : 'unavailable'
    this.readiness.asr = status(recognition)
    this.readiness.tts = status(synthesis)
    for (const result of [recognition, synthesis]) {
      if (result.status === 'rejected') reportRuntimeError(result.reason, { stage: 'speech.provider.configuration' })
    }
    this.readiness.media = 'starting'
    this.publishReadiness()
    this.disposeListener = this.media.onEvent(event => this.onMediaEvent(event))
    this.mediaReadyTimer = setTimeout(() => {
      this.readiness.media = 'unavailable'
      this.publishReadiness()
      void this.media.close().catch(error => reportRuntimeError(error, { stage: 'media.startup-timeout.cleanup' }))
    }, 15_000)
    this.mediaReadyTimer.unref()
    try {
      if (await this.media.start()) {
        if (this.closed) { await this.media.close(); return }
        this.media.configure(this.targets)
      } else {
        clearTimeout(this.mediaReadyTimer)
        this.readiness.media = 'unavailable'
        this.publishReadiness()
      }
    } catch (error) {
      clearTimeout(this.mediaReadyTimer)
      this.readiness.media = 'unavailable'
      this.publishReadiness()
      this.disposeListener?.()
      this.disposeListener = undefined
      throw error
    }
  }

  private async selectRecognitionProvider(): Promise<SpeechRecognitionProvider | undefined> {
    return await withProviderCheckDeadline(() => this.capabilities.resolve<SpeechRecognitionProvider>(
      'speech.transcribe',
      this.config.recognitionProvider,
    ), this.lifecycle.signal)
  }

  private async selectSynthesisProvider(): Promise<SpeechSynthesisProvider | undefined> {
    return await withProviderCheckDeadline(() => this.capabilities.resolve<SpeechSynthesisProvider>(
      'speech.synthesize',
      this.config.synthesisProvider,
    ), this.lifecycle.signal)
  }

  updateTargets(processIds: readonly number[]): void {
    this.targets = [...processIds]
    this.media.configure(processIds)
  }

  async speak(text: string, signal: AbortSignal): Promise<void> {
    const plainText = stripSpeechFormatting(text)
    if (plainText.trim() === '') return
    const provider = await this.selectSynthesisProvider()
    if (provider === undefined) throw new Error('没有可用的语音合成 Provider，请先在 DSH 中绑定相应凭据')
    if (provider.synthesizeStream !== undefined) {
      const playbackId = randomUUID()
      this.media.startPcmPlayback(playbackId)
      const onAbort = (): void => this.media.cancelPlayback(playbackId)
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        for await (const chunk of provider.synthesizeStream({ text: plainText }, signal)) {
          this.media.appendPcmPlayback(playbackId, chunk)
        }
        await this.media.finishPcmPlayback(playbackId, signal)
        return
      } catch (error) {
        this.media.cancelPlayback(playbackId)
        throw error
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
    }
    const audio = await provider.synthesize({ text: plainText }, signal)
    await this.media.play(audio, signal)
  }

  async appendSpeechDelta(processId: number, interactionId: string, delta: string): Promise<void> {
    let output = this.speechOutputs.get(processId)
    if (output?.interactionId !== interactionId) {
      output?.controller.abort(new Error('新的语音回复已开始'))
      if (output !== undefined) this.media.cancelPlayback(output.playbackId)
      const provider = await this.selectSynthesisProvider()
      if (provider === undefined || provider.synthesizeStream === undefined) return
      output = {
        processId,
        interactionId,
        controller: new AbortController(),
        buffer: '',
        spokenText: '',
        playbackId: randomUUID(),
        chain: Promise.resolve(),
        provider,
        started: false,
        audioAppended: false,
        queuedAudioBytes: 0,
        captionText: '',
        captionChain: Promise.resolve(),
        speechAnnounced: false,
      }
      this.speechOutputs.set(processId, output)
    }
    output.buffer += stripSpeechFormatting(delta)
    this.queueReadyPhrases(output, false)
  }

  async finishSpeechReply(processId: number, interactionId: string, finalText: string): Promise<boolean> {
    const output = this.speechOutputs.get(processId)
    if (output?.interactionId !== interactionId) return false
    const plainFinalText = stripSpeechFormatting(finalText)
    if (output.spokenText === '' && output.buffer === '') output.buffer = plainFinalText
    else if (plainFinalText.startsWith(output.spokenText + output.buffer)) {
      output.buffer += plainFinalText.slice((output.spokenText + output.buffer).length)
    }
    this.queueReadyPhrases(output, true)
    try {
      await output.chain
      await output.captionChain
      output.controller.signal.throwIfAborted()
      if (output.started) await this.media.finishPcmPlayback(output.playbackId, output.controller.signal)
      output.controller.signal.throwIfAborted()
      this.ctx.logger.info(`xiaotangyuan tts playback.complete processId=${processId} interactionId=${interactionId} playbackId=${output.playbackId} provider=${output.provider.id}`)
      return output.started
    } catch (error) {
      this.media.cancelPlayback(output.playbackId)
      // Barge-in/close is not playback success and must propagate to the
      // current interaction's cancellation boundary, never authorize actions.
      if (output.controller.signal.aborted && output.failure === undefined) throw error
      if (output.failure === undefined) reportRuntimeError(error, { stage: 'tts.stream', processId, interactionId, provider: this.config.synthesisProvider })
      this.ctx.logger.warn(output.audioAppended
        ? 'xiaotangyuan-game: 增量 TTS 中途失败；为避免重复播放，不再整段重播'
        : 'xiaotangyuan-game: 增量 TTS 在播放前失败，将尝试完整回复兼容路径')
      this.ctx.logger.warn(error)
      if (output.audioAppended) throw error
      return false
    } finally {
      if (this.speechOutputs.get(processId) === output) this.speechOutputs.delete(processId)
    }
  }

  private observeSpeechTask(output: SpeechOutput, task: Promise<void>, stage: string): void {
    // These tasks start before the model's final reply, so its later await is
    // too late to own rejections. Keep the original promise rejected for that
    // consumer while observing it immediately. Do not install a global catch.
    void task.catch(error => {
      if (output.controller.signal.aborted || output.failure !== undefined) return
      output.failure = { error }
      reportRuntimeError(error, { stage, processId: output.processId, interactionId: output.interactionId, provider: output.provider.id })
      output.controller.abort(error)
      try { this.media.cancelPlayback(output.playbackId) }
      catch (cleanupError) { reportRuntimeError(cleanupError, { stage: 'tts.failure.cleanup', processId: output.processId, interactionId: output.interactionId }) }
    })
  }

  private queueReadyPhrases(output: SpeechOutput, flush: boolean): void {
    const phrases: string[] = []
    while (output.buffer !== '') {
      const boundary = output.buffer.search(/[。！？!?\n]/)
      if (boundary >= 0) {
        phrases.push(output.buffer.slice(0, boundary + 1))
        output.buffer = output.buffer.slice(boundary + 1)
        continue
      }
      if (!flush && output.buffer.length < 36) break
      if (flush) {
        phrases.push(output.buffer)
        output.buffer = ''
        break
      }
      const splitAt = Math.max(output.buffer.lastIndexOf('，', 36), output.buffer.lastIndexOf(',', 36), output.buffer.lastIndexOf(' ', 36))
      const length = splitAt >= 12 ? splitAt + 1 : 36
      phrases.push(output.buffer.slice(0, length))
      output.buffer = output.buffer.slice(length)
    }
    for (const phrase of phrases.map(value => value.trim()).filter(value => value !== '')) {
      output.spokenText += phrase
      output.chain = output.chain.then(async () => {
        output.controller.signal.throwIfAborted()
        let captionScheduled = false
        for await (const chunk of output.provider.synthesizeStream!({
          text: phrase,
          trace: { processId: output.processId, interactionId: output.interactionId, playbackId: output.playbackId },
        }, output.controller.signal)) {
          output.controller.signal.throwIfAborted()
          if (chunk.byteLength === 0) continue
          if (!output.started) {
            this.media.startPcmPlayback(output.playbackId)
            output.started = true
          }
          if (!captionScheduled) {
            captionScheduled = true
            const phraseStartByte = output.queuedAudioBytes
            output.captionChain = output.captionChain.then(async () => {
              await this.media.waitForPcmPosition(output.playbackId, phraseStartByte, output.controller.signal)
              output.controller.signal.throwIfAborted()
              if (!output.speechAnnounced) {
                output.speechAnnounced = true
                this.ctx.logger.info(`xiaotangyuan tts playback.start processId=${output.processId} interactionId=${output.interactionId} playbackId=${output.playbackId} provider=${output.provider.id}`)
                this.handler.speechStarted(output.processId, output.interactionId)
              }
              output.captionText += phrase
              this.handler.speechPhraseStarted(output.processId, output.interactionId, phrase, output.captionText)
            })
            this.observeSpeechTask(output, output.captionChain, 'tts.caption.queue')
          }
          if (chunk.byteLength > 0) output.audioAppended = true
          this.media.appendPcmPlayback(output.playbackId, chunk)
          output.queuedAudioBytes += chunk.byteLength
        }
      })
      this.observeSpeechTask(output, output.chain, 'tts.synthesis.queue')
    }
  }

  private async onMediaEvent(event: MediaHostEvent): Promise<void> {
    try {
      await this.handleMediaEvent(event)
    } catch (error) {
      const processId = 'processId' in event ? event.processId : undefined
      if (processId !== undefined && 'recordingId' in event && this.latestRecording.has(processId) && this.latestRecording.get(processId) !== event.recordingId) return
      const diagnostic = reportRuntimeError(error, { stage: `media.${event.type}`, processId })
      if (processId !== undefined) this.handler.failed(processId, error instanceof Error ? error.message : String(error), diagnostic.errorId)
    }
  }

  private async handleMediaEvent(event: MediaHostEvent): Promise<void> {
    if (event.type === 'ready') {
      clearTimeout(this.mediaReadyTimer)
      this.readiness.media = 'ready'
      this.publishReadiness()
      return
    }
    if (event.type === 'host.stopped') {
      clearTimeout(this.mediaReadyTimer)
      this.readiness.media = 'unavailable'
      this.publishReadiness()
      return
    }
    if (event.type === 'error') {
      reportRuntimeError(new Error(event.message), { stage: 'media.capture-or-playback' })
      this.ctx.logger.warn('xiaotangyuan-game media: %s', event.message)
      return
    }
    if (event.type === 'recording.started') {
      for (const [id, previous] of this.recordings) {
        if (previous.processId !== event.processId) continue
        previous.controller.abort(new Error('玩家开始了新的语音输入'))
        this.recordings.delete(id)
      }
      this.latestRecording.set(event.processId, event.recordingId)
      this.interactions.get(event.processId)?.abort(new Error('玩家开始了新的语音输入'))
      this.interactions.delete(event.processId)
      const output = this.speechOutputs.get(event.processId)
      output?.controller.abort(new Error('玩家打断了语音回复'))
      if (output !== undefined) this.speechOutputs.delete(event.processId)
      this.media.cancelPlayback()
      this.handler.recordingStarted(event.processId)
      const controller = new AbortController()
      const live: LiveRecording = { controller, buffered: [], processId: event.processId, startedAt: performance.now() }
      this.recordings.set(event.recordingId, live)
      this.asrStage(event.processId, event.recordingId, live, 'recording.started')
      // Store startup before awaiting discovery. A quick release must await this
      // exact attempt, not start a second recognition request with the WAV file.
      live.setup = (async () => {
        const provider = await this.selectRecognitionProvider()
        controller.signal.throwIfAborted()
        live.provider = provider
        if (provider?.startStreaming === undefined) return
        const session = await provider.startStreaming({
          format: { sampleRate: event.sampleRate, bitsPerSample: event.bitsPerSample, channels: event.channels },
          onPartial: text => {
            if (controller.signal.aborted || live.finalized || this.latestRecording.get(event.processId) !== event.recordingId) return
            this.handler.recognitionPartial?.(event.processId, text, live.stoppedAt !== undefined)
            this.asrStage(event.processId, event.recordingId, live, 'result.partial')
          },
          onDiagnostic: detail => {
            if (controller.signal.aborted) return
            const metrics: Record<string, string | number> = {}
            for (const key of ['elapsedMs', 'queuedAudioMs', 'sentAudioMs', 'drainMs', 'upstreamFinalMs']) {
              if (typeof detail[key] === 'number' && Number.isFinite(detail[key])) metrics[`transport.${key}`] = detail[key]
            }
            const stage = typeof detail.kind === 'string' ? detail.kind.replace(/[^a-z.]/gi, '').slice(0, 40) : 'unknown'
            this.asrStage(event.processId, event.recordingId, live, `transport.${stage}`, metrics)
          },
        }, controller.signal)
        if (controller.signal.aborted) { session.cancel(); controller.signal.throwIfAborted() }
        live.stream = session
        for (const chunk of live.buffered) session.push(chunk)
        live.buffered.length = 0
      })()
      void live.setup.catch(() => undefined)
      await live.setup
      return
    }
    if (event.type === 'recording.chunk') {
      const live = this.recordings.get(event.recordingId)
      if (live === undefined || live.controller.signal.aborted) return
      const chunk = new Uint8Array(Buffer.from(event.audioBase64, 'base64'))
      if (live.stream === undefined) live.buffered.push(chunk)
      else live.stream.push(chunk)
      return
    }
    if (event.type === 'recording.stopped') {
      if (this.latestRecording.get(event.processId) !== event.recordingId) return
      const live = this.recordings.get(event.recordingId)
      if (live !== undefined) {
        live.stoppedAt = performance.now()
        this.asrStage(event.processId, event.recordingId, live, 'recording.stopped')
      }
      this.handler.recordingStopped(event.processId)
      return
    }
    if (event.type === 'recording.cancelled') {
      const live = this.recordings.get(event.recordingId)
      this.recordings.delete(event.recordingId)
      live?.controller.abort(new Error(event.message))
      if (this.latestRecording.get(event.processId) !== event.recordingId) return
      this.handler.failed(event.processId, event.message)
      return
    }
    if (event.type !== 'recording.completed') return
    const latest = this.latestRecording.get(event.processId)
    if (latest !== undefined && (latest !== event.recordingId || !this.recordings.has(event.recordingId))) return

    this.active.add(event.processId)
    const interactionStarted = performance.now()
    const live = this.recordings.get(event.recordingId)
    this.recordings.delete(event.recordingId)
    const controller = live?.controller ?? new AbortController()
    this.interactions.set(event.processId, controller)
    const timeout = setTimeout(() => controller.abort(new Error('语音交互超时')), 120_000)
    let diagnosticIdentity: { sessionId: string, interactionId: string, gameId: string } | undefined
    let stage = 'asr.provider-selection'
    try {
      const asrStarted = live?.stoppedAt ?? interactionStarted
      await live?.setup
      controller.signal.throwIfAborted()
      const provider = live !== undefined ? live.provider : await this.selectRecognitionProvider()
      if (provider === undefined) throw new Error('没有可用的语音识别能力，请先在 DSH 中绑定相应凭据')
      stage = 'asr.transcribe'
      let transcript: string
      if (live?.stream !== undefined) {
        stage = 'asr.stream.finish'
        transcript = await live.stream.finish()
      } else {
        transcript = await provider.transcribe({
          bytes: new Uint8Array(Buffer.from(event.audioBase64, 'base64')),
          mediaType: event.mediaType,
        }, controller.signal)
      }
      controller.signal.throwIfAborted()
      if (typeof transcript !== 'string' || !transcript.trim()) throw Object.assign(new Error('ASR_EMPTY'), { code: 'ASR_EMPTY', retryable: false })
      const asrFinished = performance.now()
      controller.signal.throwIfAborted()
      if (live !== undefined) {
        live.finalized = true
        this.asrStage(event.processId, event.recordingId, live, 'result.final', { afterStopMs: Math.round(asrFinished - asrStarted) })
      }
      if (transcript.trim() === '') throw new Error('没有识别到文字，请重新按住说话。')
      stage = 'agent.respond'
      const response = await this.handler.respond(event.processId, transcript, controller.signal)
      diagnosticIdentity = response
      const agentFinished = performance.now()
      if (!response.speechPlayed) {
        stage = 'tts.synthesize-or-playback'
        this.handler.speechStarted(event.processId, response.interactionId)
        try {
          await this.speak(response.reply, controller.signal)
          controller.signal.throwIfAborted()
          response.afterPlayback?.()
        } finally {
          this.handler.speechFinished(event.processId, response.interactionId)
        }
      }
      const ttsFinished = performance.now()
      this.ctx.logger.info(
        `xiaotangyuan voice latency processId=${event.processId} asrMs=${Math.round(asrFinished - asrStarted)} agentMs=${Math.round(agentFinished - asrFinished)} ttsMs=${Math.round(ttsFinished - agentFinished)} totalMs=${Math.round(ttsFinished - interactionStarted)}`,
      )
      publishProductDiagnostic({
        kind: 'voice.latency',
        sessionId: response.sessionId,
        gameId: response.gameId,
        interactionId: response.interactionId,
        detail: {
          source: 'voice',
          processId: event.processId,
          asrMs: Math.round(asrFinished - asrStarted),
          agentMs: Math.round(agentFinished - asrFinished),
          ttsMs: Math.round(ttsFinished - agentFinished),
          totalMs: Math.round(ttsFinished - interactionStarted),
          speechStreamed: response.speechPlayed,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (controller.signal.aborted && controller.signal.reason instanceof Error
        && controller.signal.reason.message === '玩家开始了新的语音输入') {
        publishProductDiagnostic({
          kind: 'voice.cancelled',
          ...(diagnosticIdentity ?? {}),
          detail: {
            source: 'voice',
            processId: event.processId,
            reason: 'barge-in',
            elapsedMs: Math.round(performance.now() - interactionStarted),
          },
        })
        return
      }
      const diagnostic = reportRuntimeError(error, {
        ...(diagnosticIdentity ?? {}), source: 'voice', stage,
        processId: event.processId, recordingId: event.recordingId,
        elapsedMs: Math.round(performance.now() - interactionStarted),
      })
      publishProductDiagnostic({
        kind: 'voice.failed',
        ...(diagnosticIdentity ?? {}),
        detail: {
          source: 'voice',
          processId: event.processId,
          stage,
          errorId: diagnostic.errorId,
          errorName: error instanceof Error ? error.name : 'Error',
          timeout: /timeout|超时/i.test(message),
          elapsedMs: Math.round(performance.now() - interactionStarted),
        },
      })
      this.handler.failed(event.processId, message, diagnostic.errorId)
    } finally {
      live?.stream?.cancel()
      clearTimeout(timeout)
      this.active.delete(event.processId)
      if (this.interactions.get(event.processId) === controller) this.interactions.delete(event.processId)
    }
  }

  private asrStage(processId: number, recordingId: string, live: LiveRecording, stage: string, metrics: Record<string, string | number> = {}): void {
    publishProductDiagnostic({ kind: 'voice.asr.stage', detail: { processId, recordingId, stage, elapsedMs: Math.round(performance.now() - live.startedAt), ...metrics } })
  }

  async close(): Promise<void> {
    this.closed = true
    this.lifecycle.abort(new Error('语音服务正在关闭'))
    clearTimeout(this.mediaReadyTimer)
    this.disposeListener?.()
    this.disposeListener = undefined
    for (const live of this.recordings.values()) live.controller.abort(new Error('语音运行时正在关闭'))
    for (const interaction of this.interactions.values()) interaction.abort(new Error('语音运行时正在关闭'))
    for (const output of this.speechOutputs.values()) output.controller.abort(new Error('语音运行时正在关闭'))
    this.recordings.clear()
    this.latestRecording.clear()
    this.interactions.clear()
    this.speechOutputs.clear()
    await this.media.close()
  }
}
