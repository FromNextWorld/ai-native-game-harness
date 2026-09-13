import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { DshProductRuntime } from '../../apps/desktop/src/dsh-product-runtime.mjs'

class SilentCloseSocket extends EventEmitter {
  static instances: SilentCloseSocket[] = []
  terminated = false
  constructor() { super(); SilentCloseSocket.instances.push(this); queueMicrotask(() => this.emit('open')) }
  close() {} // Peer never acknowledges a graceful close.
  terminate() { this.terminated = true; this.emit('close') }
}
function runtime(Socket = SilentCloseSocket) {
  return new DshProductRuntime({ baseUrl: 'http://127.0.0.1:1', cwd: 'test', WebSocketImpl: Socket,
    fetchImpl: async (_url: unknown, init: { body: string }) => {
      const { rpcId, method } = JSON.parse(init.body)
      const value = method === 'session.list' ? { items: [{ blank: true, running: false, cwd: 'test', sessionId: 'test' }] }
        : method === 'session.history' ? { events: [] } : {}
      return { ok: true, json: async () => ({ rpcId, result: { ok: true, value } }) }
    },
  })
}
describe('product bridge shutdown', () => {
  it('finishes even when the WebSocket peer never acknowledges close', async () => {
    SilentCloseSocket.instances = []
    const bridge = runtime()
    await bridge.start()
    let closed = false
    const closing = bridge.close().then(() => { closed = true })
    await new Promise(resolve => setTimeout(resolve, 600))
    try { expect(closed).toBe(true); expect(SilentCloseSocket.instances.every(s => s.terminated)).toBe(true) }
    finally { SilentCloseSocket.instances.forEach(s => s.terminate()); await closing }
  })
  it('is idempotent and tolerates a socket throwing during close', async () => {
    class ThrowCloseSocket extends SilentCloseSocket { close() { throw new Error('already closing') } }
    const bridge = runtime(ThrowCloseSocket)
    await bridge.start()
    const closing = bridge.close()
    expect(bridge.close()).toBe(closing)
    await closing
    await bridge.close()
  })
  it('stops while the initial connections have not opened without waiting for the open timeout', async () => {
    class NeverOpenSocket extends EventEmitter {
      constructor() { super() }
      close() {}
      terminate() { this.emit('close') }
    }
    const bridge = runtime(NeverOpenSocket as typeof SilentCloseSocket)
    const starting = bridge.start().then(() => 'started', () => 'stopped')
    await bridge.close()
    expect(await starting).toBe('stopped')
  })
  it('does not reconnect after shutdown', async () => {
    SilentCloseSocket.instances = []
    const bridge = runtime()
    await bridge.start()
    SilentCloseSocket.instances.forEach(socket => socket.emit('close'))
    await Promise.resolve()
    await bridge.close()
    const count = SilentCloseSocket.instances.length
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(SilentCloseSocket.instances.length).toBe(count)
  })
})
