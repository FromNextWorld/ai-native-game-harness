import { createHmac, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import WebSocket, { type RawData } from 'ws'
import type { ResolvedConfig } from '../../config.js'
import type { BinaryAsset, SpeechRecognitionProvider, StreamingRecognitionRequest, StreamingRecognitionSession } from '../providers/contracts.js'

interface Credentials { appId: string; apiKey: string; apiSecret: string }
const ENDPOINT = 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1'
const encode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export function buildIflytekUrl(credentials: Credentials, now = new Date(), uuid = randomUUID()): string {
  const parameters: Record<string, string> = {
    accessKeyId: credentials.apiKey, appId: credentials.appId, uuid,
    utc: `${now.toISOString().slice(0, 19)}+0000`, audio_encode: 'pcm_s16le',
    lang: 'autodialect', samplerate: '16000', pd: 'game',
  }
  const canonical = Object.keys(parameters).sort().map(key => `${encode(key)}=${encode(parameters[key]!)}`).join('&')
  const signature = createHmac('sha1', credentials.apiSecret).update(canonical).digest('base64')
  return `${ENDPOINT}?${canonical}&signature=${encode(signature)}`
}

function transcript(data: any, pieces: Map<number, string>): { text: string; final: boolean } {
  const st = data?.cn?.st
  if (st !== undefined && Number(st.type) === 0) {
    const value = (st.rt ?? []).flatMap((rt: any) => (rt.ws ?? []).map((word: any) => word.cw?.[0]?.w ?? '')).join('')
    if (value !== '') {
      if (!Number.isSafeInteger(data.seg_id) || data.seg_id < 0) throw new Error('科大讯飞语音响应格式无效')
      pieces.set(data.seg_id, value)
    }
  }
  const partial = st !== undefined && Number(st.type) === 1
    ? (st.rt ?? []).flatMap((rt: any) => (rt.ws ?? []).map((word: any) => word.cw?.[0]?.w ?? '')).join('') : ''
  return { text: [...pieces].sort((a, b) => a[0] - b[0]).map(([, value]) => value).join('') + partial, final: data?.ls === true }
}

export class IflytekStreamingSession implements StreamingRecognitionSession {
  private queue = Buffer.alloc(0); private ending = false; private settled = false; private sent = 0
  private sessionId = ''; private nextSendAt = 0; private timer?: ReturnType<typeof setTimeout>
  private readonly pieces = new Map<number, string>(); private latest = ''
  private readonly result: Promise<string>; private resolve!: (value: string) => void; private reject!: (error: Error) => void

  constructor(private readonly socket: WebSocket, private readonly request: StreamingRecognitionRequest, signal: AbortSignal) {
    this.result = new Promise<string>((resolve, reject) => { this.resolve = resolve; this.reject = reject })
    void this.result.catch(() => undefined)
    socket.on('message', raw => this.onMessage(raw))
    socket.on('error', () => this.fail(new Error('科大讯飞语音网络连接失败')))
    socket.on('close', () => { if (!this.settled) this.fail(new Error('科大讯飞语音连接提前关闭')) })
    signal.addEventListener('abort', () => this.cancel(), { once: true })
  }

  private onMessage(raw: RawData): void {
    try {
      const event = JSON.parse(raw.toString())
      if (event.code !== undefined && String(event.code) !== '0') throw new Error(`科大讯飞语音服务失败（${String(event.code).slice(0, 8)}）`)
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      const kind = event.action ?? data?.action ?? event.msg_type
      if (kind === 'started') {
        this.sessionId = event.sid ?? data?.sessionId ?? data?.session_id ?? ''
        if (this.sessionId === '') throw new Error('科大讯飞语音握手无会话标识')
        this.nextSendAt = performance.now(); this.pump(); return
      }
      const current = transcript(data, this.pieces)
      if (current.text !== '' && current.text !== this.latest) { this.latest = current.text; this.request.onPartial?.(current.text) }
      if (current.final || kind === 'end') this.complete()
    } catch (error) { this.fail(error instanceof Error ? error : new Error('科大讯飞语音响应格式无效')) }
  }

  push(bytes: Uint8Array): void {
    if (this.settled || this.ending) throw new Error('语音识别会话已关闭')
    this.sent += bytes.byteLength
    if (this.sent > 1_920_000) { this.fail(new Error('语音识别最长支持 60 秒')); return }
    this.queue = Buffer.concat([this.queue, bytes]); this.pump()
  }

  private pump(): void {
    if (this.settled || this.sessionId === '' || this.timer !== undefined) return
    if (this.queue.length === 0) { if (this.ending) this.sendEnd(); return }
    if (this.queue.length < 1280 && !this.ending) return
    const now = performance.now(); const wait = this.nextSendAt - now
    if (wait > 0) { this.timer = setTimeout(() => { this.timer = undefined; this.pump() }, Math.ceil(wait)); return }
    const frame = this.queue.subarray(0, 1280); this.queue = this.queue.subarray(frame.length)
    this.socket.send(frame); this.nextSendAt = Math.max(this.nextSendAt, now - 40) + frame.length / 32; this.pump()
  }

  private sendEnd(): void { this.socket.send(JSON.stringify({ end: true, sessionId: this.sessionId })) }
  async finish(): Promise<string> { if (!this.ending && !this.settled) { this.ending = true; if (this.sent % 2 !== 0) this.fail(new Error('PCM16 音频长度无效')); else this.pump() } return await this.result }
  cancel(): void { this.fail(new Error('流式语音识别已取消')) }
  private complete(): void { if (this.settled) return; this.settled = true; clearTimeout(this.timer); this.socket.close(); this.latest === '' ? this.reject(new Error('科大讯飞语音识别没有返回文本')) : this.resolve(this.latest.trim()) }
  private fail(error: Error): void { if (this.settled) return; this.settled = true; clearTimeout(this.timer); this.socket.close(); this.reject(error) }
}

export class IflytekSpeechRecognitionProvider implements SpeechRecognitionProvider {
  readonly id = 'iflytek'
  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig['speech']) {}
  private refs(): string[] { return [this.config.iflytekAppIdCredentialRef, this.config.iflytekApiKeyCredentialRef, this.config.iflytekApiSecretCredentialRef] }
  async isAvailable(): Promise<boolean> { return (await Promise.all(this.refs().map(async ref => (await this.ctx.credentials.describe(credentialRef(ref))).configured))).every(Boolean) }
  private async credentials(): Promise<Credentials> {
    const values = await Promise.all(this.refs().map(async ref => (await this.ctx.credentials.resolve(credentialRef(ref)))?.value.trim()))
    if (values.some(value => !value)) throw new Error('科大讯飞语音凭据尚未完整配置')
    return { appId: values[0]!, apiKey: values[1]!, apiSecret: values[2]! }
  }
  async startStreaming(request: StreamingRecognitionRequest, signal: AbortSignal): Promise<StreamingRecognitionSession> {
    signal.throwIfAborted()
    if (request.format.sampleRate !== 16_000 || request.format.bitsPerSample !== 16 || request.format.channels !== 1) throw new Error('科大讯飞流式识别需要 16kHz PCM16 单声道音频')
    const socket = new WebSocket(buildIflytekUrl(await this.credentials()), { handshakeTimeout: 10_000, maxPayload: 1024 * 1024 })
    return new IflytekStreamingSession(socket, request, signal)
  }
  async transcribe(_audio: BinaryAsset, _signal: AbortSignal): Promise<string> { throw new Error('科大讯飞公共 Provider 仅支持实时流式识别') }
}
