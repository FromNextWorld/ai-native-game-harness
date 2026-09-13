import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { buildChatContext, DST_ATOMS, object, type Data } from './context.js'
import { DstGatewayClient } from './gateway-client.js'

export function bridgeFiles(directory: string): Record<'state' | 'reply' | 'request' | 'bridgeStatus' | 'skillCommand' | 'skillResult', string> {
  return { state: join(directory, 'dont_starve_ai_mod_state.json'), reply: join(directory, 'dont_starve_ai_mod_reply.json'),
    request: join(directory, 'dont_starve_ai_mod_requests.json'), bridgeStatus: join(directory, 'dont_starve_ai_mod_bridge_status.json'),
    skillCommand: join(directory, 'dont_starve_ai_mod_skill_command.json'), skillResult: join(directory, 'dont_starve_ai_mod_skill_result.json') }
}
async function readJson(path: string): Promise<Data | undefined> {
  try {
    if ((await stat(path)).size > 2_000_000) return undefined
    return object(JSON.parse(await readFile(path, 'utf8')))
  } catch { return undefined } // Mod writes may be temporarily incomplete
}
export async function atomicJson(path: string, value: Data): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), 'utf8')
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, path); return }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= 9) throw error
        await delay(10)
      }
    }
  } finally { await unlink(temporary).catch(() => {}) }
}

export class DstTsBridge {
  readonly files: ReturnType<typeof bridgeFiles>
  readonly client: DstGatewayClient
  private stopped = true
  private loop?: Promise<void>
  private active?: AbortController
  private activeDone?: Promise<void>
  private cancelled = new Set<string>()
  private seen = new Set<string>()
  private recipient?: string
  private recording = false
  private thinking = false
  private busy = false
  private lastError?: string
  private lastRequestAt?: number
  private lastRequestAction?: string
  private lastPresent = 0
  private lastStatus = 0
  private lastState = 0
  private lastPublish = 0
  private fingerprint = ''
  private writes = Promise.resolve()
  private voiceQueue = Promise.resolve()
  private lockOwned = false

  constructor(directory: string, processId: number, url = 'ws://127.0.0.1:33145') {
    this.files = bridgeFiles(directory)
    this.client = new DstGatewayClient(url, processId,
      (method, params) => { void this.notification(method, params).catch(error => this.report(error)) },
      async (method, params) => {
        if (method !== 'game.atom.execute') throw new Error('不支持的 Adapter 请求：' + method)
        return this.executeAtom(params)
      })
  }
  private report(error: unknown): void { this.lastError = error instanceof Error ? error.message : String(error) }
  private remember(set: Set<string>, id: string): void {
    set.add(id); if (set.size > 256) set.delete(set.values().next().value!)
  }
  private enqueueWrite(path: string, value: Data): Promise<void> {
    const write = this.writes.then(() => atomicJson(path, value))
    this.writes = write.catch(error => this.report(error))
    return write
  }
  private reply(text: string, recipient = this.recipient, seconds?: number): Promise<void> {
    return this.enqueueWrite(this.files.reply, { id: randomUUID(), text, created_at_unix: Date.now() / 1000,
      ...(recipient ? { recipient_userid: recipient } : {}), ...(seconds === undefined ? {} : { display_duration_seconds: seconds }) })
  }
  async start(): Promise<void> {
    if (!this.stopped) return
    const prior = await readJson(this.files.bridgeStatus)
    if (typeof prior?.heartbeat_at_unix === 'number' && Date.now() / 1000 - prior.heartbeat_at_unix < 3) {
      throw new Error('已有游戏桥接正在运行，请勿与旧 ChesterAI 同时启动')
    }
    await mkdir(dirname(this.files.state), { recursive: true })
    try { await writeFile(`${this.files.bridgeStatus}.ts.lock`, String(process.pid), { flag: 'wx' }); this.lockOwned = true }
    catch { throw new Error('TS 桥接锁已存在，请确认旧实例退出后再处理锁文件') }
    for (const event of await this.events()) this.remember(this.seen, this.eventId(event))
    this.stopped = false
    this.client.start()
    this.loop = (async () => {
      while (!this.stopped) {
        try { await this.tick() } catch (error) { this.report(error) }
        await delay(50)
      }
    })()
  }
  private async events(): Promise<Data[]> {
    const value = await readJson(this.files.request)
    return Array.isArray(value?.events) ? value.events.slice(-100).filter((item: unknown) => item && typeof item === 'object')
      : typeof value?.action === 'string' ? [value] : []
  }
  private eventId(event: Data): string { return typeof event.id === 'string' ? event.id : JSON.stringify(event) }
  private async tick(): Promise<void> {
    const now = Date.now()
    if (now - this.lastStatus >= 1000) {
      this.lastStatus = now
      const lastReply = await stat(this.files.reply).catch(() => undefined)
      await this.enqueueWrite(this.files.bridgeStatus, { schema_version: 2, implementation: 'typescript', heartbeat_at_unix: now / 1000,
        last_request_at_unix: this.lastRequestAt, last_request_action: this.lastRequestAction,
        last_reply_at_unix: lastReply ? lastReply.mtimeMs / 1000 : null,
        chat_model: 'AI Native Game Harness', gateway_connected: this.client.connected, busy: this.busy || this.thinking,
        recording: this.recording, last_error: this.lastError })
    }
    if (now - this.lastState >= 1000) {
      this.lastState = now
      const info = await stat(this.files.state).catch(() => undefined)
      // Never warm a previous save from a stale file while at the title screen.
      if (info && now - info.mtimeMs < 10_000) this.publish(await readJson(this.files.state), false)
    }
    for (const event of await this.events()) {
      const id = this.eventId(event)
      if (this.seen.has(id)) continue
      this.remember(this.seen, id)
      this.lastRequestAt = now / 1000; this.lastRequestAction = String(event.action)
      if (event.action === 'start_recording' || event.action === 'stop_recording') {
        this.voiceQueue = this.voiceQueue.then(async () => {
          if (this.stopped) return
          this.recipient = typeof event.recipient_userid === 'string' ? event.recipient_userid : undefined
          this.publish(event.state, true)
          await this.client.call(event.action === 'start_recording' ? 'voice.start' : 'voice.stop', {})
        }).catch(error => { this.recording = false; this.thinking = false; this.lastStatus = 0; this.report(error) })
      } else if (event.action === 'retry_last' || event.action === 'game_reminder') {
        if (this.busy || this.recording) continue
        this.busy = true
        const recipient = typeof event.recipient_userid === 'string' ? event.recipient_userid : undefined
        this.recipient = recipient
        const reminder = object(event.reminder)
        const work = event.action === 'retry_last'
          ? this.client.call('chat.retry', { context: buildChatContext(event.state) }, 120_000)
          : this.client.call('assistant.compose', { text: `将游戏提醒改成不超过30字的自然中文，不要执行任务：${String(reminder.message ?? '')}`, context: buildChatContext(event.state) }, 120_000)
        void work.then(async result => {
          if (!this.stopped && event.action === 'game_reminder') await this.reply(String(result.reply ?? reminder.message ?? ''), recipient)
        }).catch(error => this.report(error)).finally(() => { this.busy = false })
      }
    }
  }
  private publish(state: Data | undefined, force: boolean): void {
    if (!state || typeof state !== 'object') return
    const context = buildChatContext(state)
    const observation = context.observation
    const fingerprint = JSON.stringify({ ...observation, meta: { ...observation.meta, capturedAt: undefined } })
    if (!force && fingerprint === this.fingerprint && Date.now() - this.lastPublish < 5000) return
    if (this.client.notify('state.update', { observation, ...(context.saveId ? { saveId: context.saveId } : {}) })) {
      this.fingerprint = fingerprint; this.lastPublish = Date.now()
    }
  }
  private async notification(method: string, params: Data): Promise<void> {
    if (method === 'game.atom.cancel') {
      if (typeof params.commandId === 'string') this.remember(this.cancelled, params.commandId)
    } else if (method === 'game.atom.disconnected') {
      this.active?.abort(new Error('游戏连接断开')); this.recording = false; this.thinking = false; this.lastStatus = 0
    } else if (method === 'gateway.connected') { this.lastPublish = 0; this.lastState = 0 }
    else if (method === 'assistant.status') {
      this.recording = params.status === 'recording'; this.thinking = params.status === 'thinking'; this.lastStatus = 0
    } else if (['assistant.delta', 'assistant.text.delta', 'assistant.present'].includes(method)) {
      if (method === 'assistant.present') { this.recording = false; this.thinking = false; this.lastPresent = Date.now(); this.lastStatus = 0 }
      if (typeof params.text === 'string' && params.text.trim()) await this.reply(params.text.trim(), this.recipient, 30)
    } else if (method === 'assistant.error') {
      this.recording = false; this.thinking = false; this.lastStatus = 0
      this.report(new Error(String(params.message ?? '语音处理失败')))
      if (Date.now() - this.lastPresent > 2000) await this.reply('这次没有完成回答，请按住 V 再试一次。')
    }
  }
  async executeAtom(params: Data): Promise<unknown> {
    if (this.stopped) throw new Error('桥接未启动')
    if (this.active) throw new Error('小汤圆还在执行上一个动作')
    if (!DST_ATOMS.some(atom => atom.name === params.atom)) throw new Error('未声明的游戏原子')
    const id = typeof params.commandId === 'string' ? params.commandId : randomUUID()
    const expires = Math.min(Date.now() / 1000 + 30, typeof params.expiresAtUnix === 'number' ? params.expiresAtUnix : 0)
    if (!Number.isFinite(expires) || expires <= Date.now() / 1000) throw new Error('技能指令已过期')
    if (this.cancelled.has(id)) throw new Error('技能指令已取消')
    const controller = new AbortController(); this.active = controller
    let complete!: () => void
    this.activeDone = new Promise(resolve => { complete = resolve })
    const command: Data = { id, atom: params.atom, arguments: object(params.arguments), created_at_unix: Date.now() / 1000, expires_at_unix: expires }
    let published = false
    try {
      let renew = 0
      while (Date.now() / 1000 < expires) {
        controller.signal.throwIfAborted()
        if (this.cancelled.has(id)) throw new Error('技能指令已取消')
        if (Date.now() - renew >= 500) {
          command.lease_until_unix = Math.min(expires, Date.now() / 1000 + 3)
          await atomicJson(this.files.skillCommand, command); published = true; renew = Date.now()
        }
        const result = await readJson(this.files.skillResult)
        if (result?.id === id) {
          controller.signal.throwIfAborted()
          if (this.cancelled.has(id) || Date.now() / 1000 >= expires) throw new Error('技能指令已取消或过期')
          if (result.success !== true) throw new Error(String(result.error ?? '游戏动作失败'))
          return result.result
        }
        await delay(20, undefined, { signal: controller.signal })
      }
      throw new Error('游戏动作超时；请检查游戏是否暂停')
    } finally {
      try { if (published) await atomicJson(this.files.skillCommand, { ...command, cancelled: true, lease_until_unix: 0 }) }
      finally { this.active = undefined; complete() }
    }
  }
  async close(): Promise<void> {
    this.stopped = true; this.active?.abort(new Error('桥接已停止')); this.client.close()
    await this.activeDone; await this.loop; await this.voiceQueue; await this.writes
    if (this.lockOwned) { await unlink(`${this.files.bridgeStatus}.ts.lock`); this.lockOwned = false }
  }
}
