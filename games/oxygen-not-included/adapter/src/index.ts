import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ADAPTER_PROTOCOL_VERSION,
  assertActionRequest,
  type ActionRequest,
  type ActionResult,
  type AdapterCapability,
  type AdapterConnectionState,
  type AdapterHello,
  type GameAdapter,
  type GameEvent,
  type GameObservation,
  type JsonValue,
} from '@ai-native-game-harness/adapter-protocol'
import { ReconnectingAdapterClient } from '@ai-native-game-harness/adapter-websocket'
import WebSocket from 'ws'
import { resolveConfig, type Config, type OniInstallerConfig } from './config.js'
import { detectOni, installOniMod } from './installation.js'
import { explainSelectedEvidence } from './diagnostics.js'
import { ColonyTrends } from './colony-trends.js'

type ObjectValue = Record<string, unknown>
type BridgeEvent = { id: string, method: string, params: ObjectValue }
type ToolResult = { success: boolean, reply: string }
type BridgeToolResult = ToolResult & { bridgeRoundTripMs: number; gameExecutionMs?: number }

const GAME_ID = 'oxygen-not-included'
const ADAPTER_ID = 'qimidandapigu.oxygen-not-included-fairy'
const ADAPTER_VERSION = '0.1.6'
const BRIDGE_HEARTBEAT_MAX_AGE_MS = 10_000
const POLL_ERROR_LOG_INTERVAL_MS = 5_000
const objectSchema = (properties: Record<string, JsonValue>, required: string[] = []): Record<string, JsonValue> => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length === 0 ? {} : { required }),
})
const actorProperties = {
  actorScope: { type: 'string', description: 'specific or colony' },
  actorId: { type: 'number', description: 'Duplicant id from the current observation.' },
  urgent: { type: 'boolean' },
} satisfies Record<string, JsonValue>
const ONI_CAPABILITIES: AdapterCapability[] = [
  { name: 'game.state', kind: 'observation', description: 'Current Oxygen Not Included observation.' },
  { name: 'oni_inspect_colony', kind: 'action', description: 'Read-only active-world oxygen and food inventory trend check; repeat after game time advances to estimate depletion, no exact reachability guarantee.', inputSchema: objectSchema({}) },
  { name: 'oni_inspect_selected', kind: 'action', description: 'Read-only selected building/crop inspection: statuses, operating conditions, associated circuit loads and bounded pipe-network endpoints. No colony changes or worker-permission diagnosis.', inputSchema: objectSchema({}) },
  { name: 'oni_move', kind: 'action', description: 'Move one duplicant to the current cursor cell.', inputSchema: objectSchema(actorProperties) },
  { name: 'oni_dig', kind: 'action', description: 'Create a single-cell dig chore at the current cursor cell.', inputSchema: objectSchema(actorProperties) },
  { name: 'oni_dig_path', kind: 'action', description: 'Create a staged dig path toward the current cursor cell.', inputSchema: objectSchema(actorProperties) },
  { name: 'oni_build', kind: 'action', description: 'Build an allowlisted building at the current cursor cell.', inputSchema: objectSchema({ ...actorProperties, buildingKey: { type: 'string' } }, ['buildingKey']) },
  { name: 'oni_companion_follow', kind: 'action', description: 'Change which living duplicant XiaoTangYuan follows.', inputSchema: objectSchema({ actorId: { type: 'number' } }, ['actorId']) },
  { name: 'oni_companion_absorb_water', kind: 'action', description: 'Absorb water from the exact current cursor cell; the cursor must be over supported liquid.', inputSchema: objectSchema({}) },
  { name: 'oni_companion_spray_water', kind: 'action', description: 'Spray stored water as physical falling droplets at the current cursor. Air, vacuum and liquid targets are allowed; a solid floor uses the non-solid cell directly above. The game validates range and reports the result.', inputSchema: objectSchema({}) },
]
const ONI_ACTIONS = new Set(ONI_CAPABILITIES.filter(item => item.kind === 'action').map(item => item.name))

const ROLE = '你是住在《缺氧》里的小汤圆，是玩家傲娇、调皮但可靠的伙伴。使用简洁自然中文，不用 Markdown。玩家明确要求你改为跟随某个复制人时，才调用 oni_companion_follow；不要因为普通选择或提到复制人就切换。玩家让你吸水、收水、喷水或放水时，先简短表示马上行动，不要在回答阶段调用工具，也不要提前声称动作已经完成；AI Native Game Harness 会在回答后执行对应的吸水或喷水动作。水技能是否学会、储水量和种类以当前观察及动作结果为准。'

export const name = 'oni-adapter'
export const inject = ['tools']

export class OniAdapter implements GameAdapter {
  private readonly colonyTrends = new ColonyTrends()
  private readonly seen = new Set<string>()
  private readonly forwarded = new Set<string>()
  private readonly inbox: BridgeEvent[] = []
  private readonly pending = new Map<string, { resolve: (value: BridgeToolResult) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>, startedAt: number }>()
  private readonly eventListeners = new Set<(event: GameEvent) => void>()
  private readonly connectionListeners = new Set<(state: AdapterConnectionState) => void>()
  private socket?: WebSocket
  private processId?: number
  private saveId?: string
  private directory?: string
  private observation?: ObjectValue
  private timer?: ReturnType<typeof setInterval>
  private inboxDirty = false
  private revision = 0
  private observedAt = new Date(0).toISOString()
  private bridgeState: AdapterConnectionState = 'disconnected'
  private lastPollErrorAt = 0

  constructor(
    private readonly root: string,
    private readonly gatewayUrl: string | undefined,
    private readonly processAlive: (processId: number) => boolean = OniAdapter.isProcessAlive,
    private readonly executionTimeoutMs = 15_000,
    private readonly reportPollError: (error: unknown) => void = error => console.warn('oni-adapter: bridge polling failed', error),
  ) {}

  start(): void {
    if (this.timer !== undefined) return
    const pollSafely = (): void => {
      try {
        this.poll()
      } catch (error) {
        try { this.clearBridgeSelection() } catch { /* a subscriber must not crash the polling timer */ }
        const now = Date.now()
        if (now - this.lastPollErrorAt >= POLL_ERROR_LOG_INTERVAL_MS) {
          this.lastPollErrorAt = now
          try { this.reportPollError(error) } catch { /* diagnostics must not crash the Runtime */ }
        }
      }
    }
    this.timer = setInterval(pollSafely, 100)
    pollSafely()
  }
  async close(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.disconnect()
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('ONI Adapter 已关闭')) }
    this.pending.clear()
    this.setBridgeState('disconnected')
  }

  async hello(): Promise<AdapterHello> {
    return {
      protocolVersion: ADAPTER_PROTOCOL_VERSION,
      adapterId: ADAPTER_ID,
      gameId: GAME_ID,
      displayName: 'Oxygen Not Included / 缺氧',
      adapterVersion: ADAPTER_VERSION,
      capabilities: structuredClone(ONI_CAPABILITIES),
    }
  }

  async observe(): Promise<GameObservation> {
    if (this.observation === undefined || this.saveId === undefined) throw new Error('《缺氧》尚未连接到 AI Native Game Harness')
    return {
      gameId: GAME_ID,
      saveId: this.saveId,
      revision: this.revision,
      observedAt: this.observedAt,
      state: structuredClone(this.observation) as Record<string, JsonValue>,
    }
  }

  async execute(request: ActionRequest): Promise<ActionResult> {
    assertActionRequest(request, GAME_ID)
    if (!ONI_ACTIONS.has(request.capability)) return this.actionError(request, 'CAPABILITY_UNAVAILABLE', `Unsupported ONI capability: ${request.capability}`)
    if (request.expectedRevision !== undefined && request.expectedRevision !== this.revision) {
      return this.actionError(request, 'REVISION_CONFLICT', `Expected revision ${request.expectedRevision}, current revision is ${this.revision}`)
    }
    try {
      const raw = await this.executeBridgeTool(request.capability, request.arguments, AbortSignal.timeout(this.executionTimeoutMs), request.requestId)
      const result = request.capability === 'oni_inspect_selected' && raw.success
        ? { ...raw, ...explainSelectedEvidence(raw.reply) }
        : request.capability === 'oni_inspect_colony' && raw.success ? { ...raw, ...this.colonyTrends.inspect(raw.reply, this.saveId!) } : raw
      return {
        requestId: request.requestId,
        ok: result.success,
        revision: this.revision,
        result: { reply: result.reply },
        timing: {
          bridgeRoundTripMs: result.bridgeRoundTripMs,
          ...(result.gameExecutionMs === undefined ? {} : { gameExecutionMs: result.gameExecutionMs }),
        },
        ...(result.success ? {} : { error: { code: 'ACTION_REJECTED', message: result.reply } }),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.actionError(request, /超时|timeout/i.test(message) ? 'REQUEST_TIMEOUT' : 'ADAPTER_DISCONNECTED', message)
    }
  }

  subscribe(listener: (event: GameEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  connectionState(): AdapterConnectionState { return this.bridgeState }

  subscribeConnection(listener: (state: AdapterConnectionState) => void): () => void {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  async executeTool(name: string, args: ObjectValue, signal: AbortSignal): Promise<ToolResult> {
    const result = await this.executeBridgeTool(name, args, signal, randomUUID())
    if (name === 'oni_inspect_selected' && result.success) return explainSelectedEvidence(result.reply)
    if (name === 'oni_inspect_colony' && result.success) return this.colonyTrends.inspect(result.reply, this.saveId!)
    return { success: result.success, reply: result.reply }
  }

  private async executeBridgeTool(name: string, args: ObjectValue, signal: AbortSignal, callId: string): Promise<BridgeToolResult> {
    if (this.directory === undefined || this.processId === undefined) throw new Error('《缺氧》尚未连接到 AI Native Game Harness')
    const ui = typeof this.observation?.ui === 'object' && this.observation.ui !== null ? this.observation.ui as ObjectValue : undefined
    const cursor = (typeof ui?.cursor === 'object' && ui.cursor !== null ? ui.cursor : this.observation?.cursor)
    const targetCell = typeof cursor === 'object' && cursor !== null && Number.isInteger((cursor as ObjectValue).cell)
      ? (cursor as ObjectValue).cell
      : undefined
    if (name !== 'oni_companion_follow' && name !== 'oni_inspect_selected' && name !== 'oni_inspect_colony' && targetCell === undefined) throw new Error('缺氧 Adapter 尚未收到有效的鼠标格子')
    const promise = new Promise<BridgeToolResult>((resolve, reject) => {
      const startedAt = performance.now()
      const timer = setTimeout(() => { this.pending.delete(callId); reject(new Error(`缺氧工具执行超时：${name}`)) }, this.executionTimeoutMs)
      this.pending.set(callId, { resolve, reject, timer, startedAt })
    })
    this.enqueue('tool.execute', {
      callId,
      name,
      args: targetCell === undefined ? { ...args } : { ...args, targetCell },
    })
    const abort = (): void => {
      const pending = this.pending.get(callId)
      if (pending !== undefined) {
        clearTimeout(pending.timer)
        this.pending.delete(callId)
        const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
        pending.reject(new Error(timedOut ? `缺氧工具执行超时：${name}` : '缺氧工具调用已取消'))
      }
    }
    signal.addEventListener('abort', abort, { once: true })
    try { return await promise } finally { signal.removeEventListener('abort', abort) }
  }

  private poll(): void {
    const candidates: Array<{ directory: string, processId: number, saveId: string, modifiedAt: number }> = []
    for (const entry of this.readBridgeDirectories()) {
      if (!entry.isDirectory()) continue
      const directory = join(this.root, entry.name)
      const sessionPath = join(directory, 'session.json')
      const outboxPath = join(directory, 'outbox.json')
      const session = this.read(sessionPath)
      const pid = session?.processId
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) continue
      if (!this.processAlive(pid)) continue
      const bridgeHeartbeatAt = this.modifiedAt(outboxPath)
      if (bridgeHeartbeatAt === undefined) continue
      if (Date.now() - bridgeHeartbeatAt > BRIDGE_HEARTBEAT_MAX_AGE_MS) continue
      const saveId = typeof session?.saveId === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(session.saveId)
        ? session.saveId
        : 'default'
      candidates.push({ directory, processId: pid, saveId, modifiedAt: bridgeHeartbeatAt })
    }
    const selected = candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]
    if (selected === undefined) {
      this.clearBridgeSelection()
      return
    }
    this.directory = selected.directory
    const state = this.socket?.readyState
    if (this.processId !== selected.processId || this.saveId !== selected.saveId) {
      this.processId = selected.processId
      this.saveId = selected.saveId
      if (this.gatewayUrl !== undefined) this.connect(selected.processId, selected.saveId)
    } else if (this.gatewayUrl !== undefined && state !== WebSocket.OPEN && state !== WebSocket.CONNECTING) {
      this.connect(selected.processId, selected.saveId)
    }
    this.setBridgeState('connected')
    const events = this.read(join(selected.directory, 'outbox.json'))?.events
    if (Array.isArray(events)) for (const raw of events) this.consume(raw)
    this.flushInbox()
  }

  private consume(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return
    const event = raw as BridgeEvent
    if (typeof event.id !== 'string' || typeof event.method !== 'string') return
    if (typeof event.params !== 'object' || event.params === null || Array.isArray(event.params)) return
    if (event.method === 'tool.result') {
      if (this.seen.has(event.id)) return
      this.seen.add(event.id)
      const callId = event.params.callId
      const pending = typeof callId === 'string' ? this.pending.get(callId) : undefined
      if (pending !== undefined) {
        clearTimeout(pending.timer); this.pending.delete(callId as string)
        const gameExecutionMs = typeof event.params.gameExecutionMs === 'number' && Number.isFinite(event.params.gameExecutionMs) && event.params.gameExecutionMs >= 0
          ? event.params.gameExecutionMs
          : undefined
        pending.resolve({
          success: event.params.success === true,
          reply: String(event.params.reply ?? ''),
          bridgeRoundTripMs: Math.max(0, Math.round(performance.now() - pending.startedAt)),
          ...(gameExecutionMs === undefined ? {} : { gameExecutionMs }),
        })
      }
      return
    }
    if (!this.seen.has(event.id)) {
      this.seen.add(event.id)
      const context = event.params.context
      const observation = event.method === 'state.update' ? event.params.observation
        : typeof context === 'object' && context !== null ? (context as ObjectValue).observation : undefined
      if (typeof observation === 'object' && observation !== null) {
        this.observation = observation as ObjectValue
        const capturedAt = (observation as ObjectValue).meta
        const rawObservedAt = typeof capturedAt === 'object' && capturedAt !== null ? (capturedAt as ObjectValue).capturedAt : undefined
        this.observedAt = typeof rawObservedAt === 'string' && !Number.isNaN(Date.parse(rawObservedAt)) ? rawObservedAt : new Date().toISOString()
        // Chat/assistant events may carry a duplicate observation for grounding.
        // Only authoritative state.update events advance the concurrency token.
        if (event.method === 'state.update') {
          this.revision += 1
          const gameEvent: GameEvent = {
            eventId: event.id,
            gameId: GAME_ID,
            revision: this.revision,
            occurredAt: this.observedAt,
            type: 'state.updated',
            payload: { saveId: this.saveId ?? 'default' },
          }
          for (const listener of this.eventListeners) listener(gameEvent)
        }
      }
    }
    if (this.socket?.readyState !== WebSocket.OPEN) return
    if (this.forwarded.has(event.id)) return
    this.forwarded.add(event.id)
    this.forward(event)
  }

  private connect(processId: number, saveId: string): void {
    if (this.gatewayUrl === undefined) return
    this.disconnect(); this.processId = processId; this.saveId = saveId
    const socket = this.socket = new WebSocket(this.gatewayUrl)
    socket.on('open', () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: `oni-hello-${processId}`, method: 'adapter.hello', params: {
      adapterId: 'qimidandapigu.oxygen-not-included-fairy', gameId: 'oxygen-not-included', version: ADAPTER_VERSION,
      protocolVersion: '1.1', capabilities: ['assistant.text-stream'], processId, saveId,
      atoms: [
        { name: 'oni_companion_absorb_water', description: '吸收鼠标格的水', parameters: '{}', returns: '{"success":boolean,"reply":string}' },
        { name: 'oni_companion_spray_water', description: '向鼠标处喷出真实液滴：空气、真空、液面均可，指地板则使用正上方非实心格；由游戏校验距离并返回结果', parameters: '{}', returns: '{"success":boolean,"reply":string}' },
      ],
      voiceCommands: [
        { atom: 'oni_companion_absorb_water', phrases: ['吸水', '收水', '吸走水'] },
        { atom: 'oni_companion_spray_water', phrases: ['喷水', '放水', '喷出水'] },
      ],
    } })))
    socket.on('error', () => { if (this.socket === socket) this.socket = undefined })
    socket.on('close', () => { if (this.socket === socket) this.socket = undefined })
    socket.on('message', raw => {
      try {
        const value = JSON.parse(raw.toString()) as { id?: string, method?: string, params?: ObjectValue, result?: { reply?: string }, error?: { message?: string } }
        if (typeof value.id === 'string' && value.method === 'game.atom.execute' && value.params !== undefined) {
          const atom = typeof value.params.atom === 'string' ? value.params.atom : ''
          const args = typeof value.params.arguments === 'object' && value.params.arguments !== null && !Array.isArray(value.params.arguments)
            ? value.params.arguments as ObjectValue : {}
          void this.executeTool(atom, args, AbortSignal.timeout(15_000)).then(result => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ jsonrpc: '2.0', id: value.id, result }))
          }).catch(error => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
              jsonrpc: '2.0', id: value.id,
              error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
            }))
          })
        }
        else if (typeof value.method === 'string' && value.params !== undefined) this.enqueue(value.method, value.params)
        else if (typeof value.id === 'string' && typeof value.result?.reply === 'string') this.enqueue('assistant.present', { text: value.result.reply, source: 'chat' })
        else if (typeof value.id === 'string' && typeof value.error?.message === 'string') this.enqueue('assistant.error', { message: value.error.message })
      } catch { /* ignore malformed loopback messages */ }
    })
  }

  private forward(event: BridgeEvent): void {
    const params = structuredClone(event.params)
    if ((event.method === 'chat.send' || event.method === 'assistant.compose') && typeof params.context === 'object' && params.context !== null) (params.context as ObjectValue).roleInstructions = ROLE
    this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id: event.id, method: event.method, params }))
  }

  private enqueue(method: string, params: ObjectValue): void {
    this.inbox.push({ id: randomUUID(), method, params }); while (this.inbox.length > 200) this.inbox.shift(); this.inboxDirty = true
  }

  private flushInbox(): void {
    if (!this.inboxDirty || this.directory === undefined) return
    const target = join(this.directory, 'inbox.json'); const temporary = `${target}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify({ events: this.inbox }), 'utf8')
      renameSync(temporary, target)
      this.inboxDirty = false
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // Windows may briefly lock inbox.json while the game Bridge is reading it.
      // Keep the dirty flag so the next poll retries instead of crashing the timer.
      if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOENT') return
      throw error
    }
  }

  private read(path: string): ObjectValue | undefined { try { return JSON.parse(readFileSync(path, 'utf8')) as ObjectValue } catch { return undefined } }

  private readBridgeDirectories(): Dirent<string>[] {
    try {
      return readdirSync(this.root, { withFileTypes: true })
    } catch (error) {
      if (OniAdapter.isTransientFileError(error)) return []
      throw error
    }
  }

  private modifiedAt(path: string): number | undefined {
    try {
      return statSync(path).mtimeMs
    } catch (error) {
      // ONI removes its per-process bridge directory while exiting. Missing or
      // briefly locked files are a normal disconnect, not a Runtime failure.
      if (OniAdapter.isTransientFileError(error)) return undefined
      throw error
    }
  }

  private clearBridgeSelection(): void {
    this.directory = undefined
    this.observation = undefined
    this.processId = undefined
    this.saveId = undefined
    this.disconnect()
    this.setBridgeState('disconnected')
  }

  private disconnect(): void {
    const socket = this.socket
    if (socket === undefined) return
    this.socket = undefined
    socket.on('error', () => { /* closing a CONNECTING socket emits an error in ws */ })
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
    else if (socket.readyState === WebSocket.OPEN) socket.close()
  }

  private actionError(request: ActionRequest, code: string, message: string): ActionResult {
    return {
      requestId: request.requestId,
      ok: false,
      revision: this.revision,
      error: { code, message },
    }
  }

  private setBridgeState(state: AdapterConnectionState): void {
    if (this.bridgeState === state) return
    this.bridgeState = state
    for (const listener of this.connectionListeners) listener(state)
  }

  private static isProcessAlive(processId: number): boolean {
    try { process.kill(processId, 0); return true }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
  }

  private static isTransientFileError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
  }
}

const resultSchema = { type: 'object', additionalProperties: false, properties: { success: { type: 'boolean', required: true }, reply: { type: 'string', required: true } } } as const

export function registerOniTools(ctx: Context, adapter: OniAdapter): void {
  const actor = { actorScope: { type: 'string', description: 'specific or colony' }, actorId: { type: 'number', description: 'Duplicant id from the current ONI observation; omit for colony.' }, urgent: { type: 'boolean' } } as const
  const register = (name: string, description: string, parameters: ObjectValue): void => {
    ctx.tools.register(defineTool({ name, description, parameters: parameters as never, output: { schema: resultSchema, render: (_args, value) => [{ type: 'text', text: value.reply }] }, execute: async (args, exec) => adapter.executeTool(name, args, exec.signal) }))
  }
  register('oni_move', 'Move one named/selected Oxygen Not Included duplicant to the current cursor cell. Never use for a colony.', actor)
  register('oni_inspect_colony', '只读查询当前世界氧气、食物总量和库存净变化；游戏推进后多次检查才能估计耗尽时间，不保证资源可达或适合所有复制人。', {})
  register('oni_inspect_selected', '只读检查选中建筑或作物的实际状态、关联电路负载和管网端点；不臆测任务权限或整座基地。', {})
  register('oni_dig', 'Create a validated single-cell dig chore at the current ONI cursor cell.', actor)
  register('oni_dig_path', 'Create a validated staged dig path toward the current ONI cursor cell.', actor)
  register('oni_build', 'Build an allowlisted ONI building at the current cursor cell.', { ...actor, buildingKey: { type: 'string', required: true, description: 'One of ladder, tile, outhouse, flush_toilet, wash_basin, bed, research_center, storage_locker, manual_generator.' } })
  register('oni_companion_follow', 'Change which living duplicant XiaoTangYuan permanently follows. Call only when the player explicitly asks XiaoTangYuan to follow a different duplicant.', {
    actorId: { type: 'number', required: true, description: 'Exact duplicant id from the current ONI observation.' },
  })
  register('oni_companion_absorb_water', 'Use XiaoTangYuan\'s learned water skill to absorb water from the exact current ONI cursor cell. Call when the player explicitly asks to absorb, collect, or remove water here. The cursor must be directly over supported liquid, and only report success when the tool returns success=true.', {})
  register('oni_companion_spray_water', 'Use XiaoTangYuan\'s learned water skill to spray stored water as physical falling droplets at the current ONI cursor. Call when the player explicitly asks to spray, release, or place water here. Air, vacuum and other liquids are valid targets; do not refuse because air is present. A solid floor uses the non-solid cell directly above. Let the game validate range and only report success when the tool returns success=true.', {})
}

export function registerOniInstallTools(ctx: Context, installer: OniInstallerConfig): void {
  ctx.tools.register(defineTool({
    name: 'oxygen_not_included_mod_detect',
    description: '只读检测本机《缺氧》、本地 ONI C# Bridge 和版本。用户提到检测、安装、更新或修复缺氧 Mod 时，必须先调用本工具。',
    parameters: {
      gamePath: { type: 'string', description: '自动检测失败时，可提供《缺氧》安装目录的绝对路径。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          platform: { type: 'string', required: true },
          gamePath: { type: 'string' },
          modsPath: { type: 'string', required: true },
          modPath: { type: 'string', required: true },
          installedVersion: { type: 'string' },
          bridgeInstalled: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.found
          ? `已找到《缺氧》：${value.gamePath}。AI 精灵 Bridge：${value.bridgeInstalled ? value.installedVersion ?? '已安装（版本未知）' : '未安装'}。`
          : '没有自动找到《缺氧》。',
      }],
    },
    execute: async (args, exec) => detectOni(args.gamePath, exec.signal),
  }))

  ctx.tools.register(defineTool({
    name: 'oxygen_not_included_mod_install',
    description: '安装、更新或修复《缺氧》的 AI 精灵 C# Bridge。会下载并校验官方安装包、备份旧版本、事务安装并在失败时回滚。只有用户明确要求安装、更新、恢复或修复缺氧 Mod 后才能调用。',
    parameters: {
      confirmed: { type: 'boolean', required: true, description: '只有用户明确要求安装、更新、恢复或修复时才可设为 true。' },
      gamePath: { type: 'string', description: '自动检测失败时，可提供《缺氧》安装目录的绝对路径。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          installed: { type: 'boolean', required: true },
          gameId: { type: 'string', required: true },
          version: { type: 'string', required: true },
          gamePath: { type: 'string', required: true },
          modPath: { type: 'string', required: true },
          action: { type: 'string', required: true },
          backupPath: { type: 'string' },
          components: { type: 'string', required: true },
          nextStep: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `《缺氧》AI 精灵 ${value.version} 已${value.action === 'kept' ? '是最新版本' : '安装'}到 ${value.modPath}。${value.nextStep}${value.backupPath === undefined ? '' : ` 旧版本备份：${value.backupPath}`}`,
      }],
    },
    async execute(args, exec) {
      if (!args.confirmed) throw new Error('安装缺氧 Mod 需要用户明确确认')
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(120_000)])
      return installOniMod(args.gamePath, installer, signal)
    },
    presentCall: args => ({
      card: 'generic',
      title: '安装《缺氧》AI 精灵 Mod',
      kind: 'other',
      rawInput: args.gamePath ?? '自动检测 Steam 安装目录',
    }),
  }))
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const adapter = new OniAdapter(
    resolved.bridgeRoot,
    `ws://${resolved.host}:${resolved.port}`,
    undefined,
    undefined,
    error => ctx.logger.warn('oni-adapter: bridge polling failed', error),
  )
  const protocolClient = resolved.adapterProtocolUrl === undefined
    ? undefined
    : new ReconnectingAdapterClient({
        url: resolved.adapterProtocolUrl,
        adapter,
        requestTimeoutMs: 15_000,
      })
  // Standalone/legacy DSH profiles keep the original direct tools. The Desktop
  // product supplies adapterProtocolUrl, so game actions are registered once by
  // game-transport -> dsh-binding after the Harness handshake succeeds.
  if (protocolClient === undefined) registerOniTools(ctx, adapter)
  registerOniInstallTools(ctx, resolved.installer)
  ctx.effect(() => {
    adapter.start()
    protocolClient?.start()
    return async () => {
      await protocolClient?.stop()
      await adapter.close()
    }
  })
}

export type { Config } from './config.js'
