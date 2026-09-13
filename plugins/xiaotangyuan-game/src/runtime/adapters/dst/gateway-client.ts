import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { DST_ADAPTER_ID, DST_ATOMS, DST_GAME_ID, type Data } from './context.js'

/** Uses the existing companion Gateway JSON-RPC protocol 1.1, not a third protocol. */
export class DstGatewayClient {
  private socket?: WebSocket
  private retry?: ReturnType<typeof setTimeout>
  private stopped = true
  private pending = new Map<string, { resolve: (value: Data) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly url: string, private readonly processId: number,
    private readonly notification: (method: string, params: Data) => void,
    private readonly request: (method: string, params: Data) => Promise<unknown>) {
    const address = new URL(url)
    if (address.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) throw new Error('游戏桥接只允许本机 Gateway')
    if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error('需要真实游戏进程 ID')
  }
  get connected(): boolean { return this.socket?.readyState === WebSocket.OPEN }
  start(): void { if (!this.stopped) return; this.stopped = false; this.connect() }
  private connect(): void {
    if (this.stopped) return
    const socket = new WebSocket(this.url, { handshakeTimeout: 3000, maxPayload: 2_000_000 })
    this.socket = socket
    socket.on('open', () => {
      this.notify('adapter.hello', { adapterId: DST_ADAPTER_ID, gameId: DST_GAME_ID, version: '0.2.23-ts-preview', protocolVersion: '1.1',
        processId: this.processId, capabilities: ['assistant.text-stream', 'game.atom.lease-v1', ...DST_ATOMS.map(atom => atom.name)], atoms: DST_ATOMS })
      this.notification('gateway.connected', {})
    })
    socket.on('error', () => {}) // close drives reconnect; no secrets/raw provider errors logged
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = undefined
      this.rejectPending()
      this.notification('game.atom.disconnected', {})
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), 2000)
    })
    socket.on('message', async raw => {
      let message: Data
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (!message || typeof message !== 'object' || this.socket !== socket) return
      if (typeof message.method === 'string') {
        const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params) ? message.params : {}
        if (message.id !== undefined) {
          let response: Data
          try { response = { jsonrpc: '2.0', id: message.id, result: await this.request(message.method, params) } }
          catch (error) { response = { jsonrpc: '2.0', id: message.id, error: { code: -32010, message: error instanceof Error ? error.message : String(error) } } }
          // Never publish the old connection's result onto a replacement socket.
          if (this.socket === socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response))
        } else this.notification(message.method, params)
      } else {
        const call = this.pending.get(String(message.id))
        if (!call) return
        this.pending.delete(String(message.id)); clearTimeout(call.timer)
        if (message.error) call.reject(new Error(String(message.error.message ?? '请求失败')))
        else call.resolve(message.result ?? {})
      }
    })
  }
  notify(method: string, params: Data): boolean {
    if (!this.connected) return false
    this.socket!.send(JSON.stringify({ jsonrpc: '2.0', method, params })); return true
  }
  call(method: string, params: Data, timeout = 3000): Promise<Data> {
    if (!this.connected) return Promise.reject(new Error('游戏连接未就绪'))
    if (this.pending.size >= 32) return Promise.reject(new Error('游戏请求队列已满'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('请求超时：' + method)) }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }
  private rejectPending(): void {
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error('游戏连接断开')) }
    this.pending.clear()
  }
  close(): void {
    this.stopped = true; clearTimeout(this.retry)
    const socket = this.socket; this.socket = undefined
    this.rejectPending(); this.notification('game.atom.disconnected', {})
    socket?.terminate()
  }
}
