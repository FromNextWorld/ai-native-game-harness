import { unlinkSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { ReconnectingAdapterClient, WebSocketAdapterHost, type RemoteGameAdapter } from '@ai-native-game-harness/adapter-websocket'
import { resolveConfig } from '../src/config.js'
import { OniAdapter } from '../src/index.js'

async function until<T>(read: () => Promise<T | undefined>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('timed out')
}

describe('ONI Adapter file bridge', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

  it('resolves the default Windows bridge directory with path separators', () => {
    const resolved = resolveConfig()
    expect(resolved.bridgeRoot).toBe(join(process.env.LOCALAPPDATA ?? process.cwd(), 'XiaoTangYuan', 'oni-bridge'))
    expect(resolved.adapterProtocolUrl).toBeUndefined()
  })

  it('accepts only a loopback Harness Adapter Protocol WebSocket URL', () => {
    expect(resolveConfig({ adapterProtocolUrl: 'ws://127.0.0.1:33245/adapter' }).adapterProtocolUrl)
      .toBe('ws://127.0.0.1:33245/adapter')
    expect(() => resolveConfig({ adapterProtocolUrl: 'https://127.0.0.1/adapter' }))
      .toThrow('must use WebSocket')
    expect(() => resolveConfig({ adapterProtocolUrl: 'ws://192.168.1.20:33245/adapter' }))
      .toThrow('loopback host')
  })

  it('grounds tool actions to the latest cursor and returns the C# result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oni-adapter-'))
    const processId = process.pid
    const sessionDir = join(root, String(processId))
    await mkdir(sessionDir)
    await writeFile(join(sessionDir, 'session.json'), JSON.stringify({ processId }))
    const staleDir = join(root, '99999999')
    await mkdir(staleDir)
    await writeFile(join(staleDir, 'session.json'), JSON.stringify({ processId: 99999999 }))
    const state = { id: 'state-1', method: 'state.update', params: { observation: { cursor: { cell: 123 }, duplicants: [] } } }
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state] }))

    const server = new WebSocketServer({ port: 0 })
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address()
    if (typeof address === 'string' || address === null) throw new Error('missing test port')
    const adapter = new OniAdapter(root, `ws://127.0.0.1:${address.port}`)
    adapter.start()
    cleanups.push(async () => { await adapter.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) })

    await until(async () => {
      try {
        const inbox = JSON.parse(await readFile(join(sessionDir, 'inbox.json'), 'utf8')) as { events: Array<{ method: string, params: { callId?: string, args?: { targetCell?: number } } }> }
        return inbox.events.find(event => event.method === 'tool.execute')
      } catch { return undefined }
    }, 50).catch(() => undefined)

    await until(async () => server.clients.size > 0 ? true : undefined)
    const execution = adapter.executeTool('oni_dig', { actorScope: 'colony' }, AbortSignal.timeout(3_000))
    const request = await until(async () => {
      try {
        const inbox = JSON.parse(await readFile(join(sessionDir, 'inbox.json'), 'utf8')) as { events: Array<{ method: string, params: { callId?: string, args?: { targetCell?: number } } }> }
        return inbox.events.find(event => event.method === 'tool.execute')
      } catch { return undefined }
    })
    expect(request.params.args?.targetCell).toBe(123)
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state, { id: 'result-1', method: 'tool.result', params: { callId: request.params.callId, success: true, reply: '已创建挖掘任务' } }] }))
    await expect(execution).resolves.toEqual({ success: true, reply: '已创建挖掘任务' })
  })

  it('announces post-reply water commands and executes a Gateway atom request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oni-post-reply-'))
    const processId = process.pid
    const sessionDir = join(root, String(processId))
    await mkdir(sessionDir)
    await writeFile(join(sessionDir, 'session.json'), JSON.stringify({ processId, saveId: 'post-reply-colony' }))
    const state = { id: 'state-1', method: 'state.update', params: { observation: { cursor: { cell: 321 }, duplicants: [] } } }
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state] }))

    const server = new WebSocketServer({ port: 0 })
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address()
    if (typeof address === 'string' || address === null) throw new Error('missing test port')
    const messages: Array<Record<string, unknown>> = []
    server.on('connection', socket => socket.on('message', raw => {
      messages.push(JSON.parse(raw.toString()) as Record<string, unknown>)
    }))
    const adapter = new OniAdapter(root, `ws://127.0.0.1:${address.port}`)
    adapter.start()
    cleanups.push(async () => { await adapter.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) })

    const hello = await until(async () => messages.find(message => message.method === 'adapter.hello'))
    const helloParams = hello.params as { atoms?: Array<{ name: string; description?: string }>; voiceCommands?: Array<{ atom: string; phrases: string[] }> }
    expect(helloParams.atoms?.map(atom => atom.name)).toContain('oni_companion_absorb_water')
    const sprayDescription = helloParams.atoms?.find(atom => atom.name === 'oni_companion_spray_water')?.description
    expect(sprayDescription).toContain('空气、真空、液面均可')
    expect(sprayDescription).toContain('正上方非实心格')
    expect(helloParams.voiceCommands).toContainEqual({ atom: 'oni_companion_absorb_water', phrases: ['吸水', '收水', '吸走水'] })

    const socket = [...server.clients][0]
    if (socket === undefined) throw new Error('missing adapter socket')
    socket.send(JSON.stringify({
      jsonrpc: '2.0', id: 'post-reply-action-1', method: 'game.atom.execute',
      params: { atom: 'oni_companion_absorb_water', arguments: {} },
    }))
    const request = await until(async () => {
      try {
        const inbox = JSON.parse(await readFile(join(sessionDir, 'inbox.json'), 'utf8')) as { events: Array<{ method: string; params: { callId?: string; name?: string; args?: { targetCell?: number } } }> }
        return inbox.events.find(event => event.method === 'tool.execute' && event.params.name === 'oni_companion_absorb_water')
      } catch { return undefined }
    })
    expect(request.params.args?.targetCell).toBe(321)
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state, {
      id: 'result-1', method: 'tool.result',
      params: { callId: request.params.callId, success: true, reply: '吸水成功' },
    }] }))
    const response = await until(async () => messages.find(message => message.id === 'post-reply-action-1'))
    expect(response.result).toEqual({ success: true, reply: '吸水成功' })
  })

  it('ignores a stale bridge directory even when Windows has reused its process id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oni-stale-adapter-'))
    const sessionDir = join(root, String(process.pid))
    await mkdir(sessionDir)
    await writeFile(join(sessionDir, 'session.json'), JSON.stringify({ processId: process.pid, saveId: 'old-colony' }))
    const outbox = join(sessionDir, 'outbox.json')
    await writeFile(outbox, JSON.stringify({ events: [] }))
    const old = new Date(Date.now() - 60_000)
    await utimes(outbox, old, old)

    const adapter = new OniAdapter(root, undefined)
    adapter.start()
    cleanups.push(async () => { await adapter.close(); await rm(root, { recursive: true, force: true }) })
    await new Promise(resolve => setTimeout(resolve, 150))

    expect(adapter.connectionState()).toBe('disconnected')
    await expect(adapter.observe()).rejects.toThrow('尚未连接')
  })

  it('treats an outbox deleted during polling as a normal disconnect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oni-outbox-race-'))
    const sessionDir = join(root, String(process.pid))
    await mkdir(sessionDir)
    await writeFile(join(sessionDir, 'session.json'), JSON.stringify({ processId: process.pid, saveId: 'closing-colony' }))
    const outboxPath = join(sessionDir, 'outbox.json')
    await writeFile(outboxPath, JSON.stringify({ events: [] }))
    const reported = vi.fn()
    let removed = false
    const adapter = new OniAdapter(root, undefined, () => {
      if (!removed) {
        removed = true
        unlinkSync(outboxPath)
      }
      return true
    }, 1_000, reported)
    adapter.start()
    cleanups.push(async () => { await adapter.close(); await rm(root, { recursive: true, force: true }) })
    await new Promise(resolve => setTimeout(resolve, 250))

    expect(adapter.connectionState()).toBe('disconnected')
    expect(reported).not.toHaveBeenCalled()
    await writeFile(outboxPath, JSON.stringify({ events: [] }))
    await until(async () => adapter.connectionState() === 'connected' ? true : undefined)
  })

  it('contains unexpected polling errors and keeps the Runtime alive', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'oni-poll-error-'))
    const root = join(temporaryDirectory, 'not-a-directory')
    await writeFile(root, 'file')
    const reported = vi.fn()
    const adapter = new OniAdapter(root, undefined, () => true, 1_000, reported)
    adapter.start()
    cleanups.push(async () => { await adapter.close(); await rm(temporaryDirectory, { recursive: true, force: true }) })
    await until(async () => reported.mock.calls.length > 0 ? true : undefined)

    expect(adapter.connectionState()).toBe('disconnected')
    expect(reported).toHaveBeenCalledTimes(1)
    await rm(root)
    await mkdir(join(root, '4242'), { recursive: true })
    await writeFile(join(root, '4242', 'session.json'), JSON.stringify({ processId: 4242, saveId: 'recovered' }))
    await writeFile(join(root, '4242', 'outbox.json'), JSON.stringify({ events: [] }))
    await until(async () => adapter.connectionState() === 'connected' ? true : undefined)
  })
})

describe('ONI Game Adapter protocol without a running game', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

  async function fixture(executionTimeoutMs = 1_000) {
    const root = await mkdtemp(join(tmpdir(), 'oni-protocol-'))
    const processId = 4242
    const sessionDir = join(root, String(processId))
    await mkdir(sessionDir)
    await writeFile(join(sessionDir, 'session.json'), JSON.stringify({ processId, saveId: 'fake-colony' }))
    const state = {
      id: 'state-1',
      method: 'state.update',
      params: {
        observation: {
          meta: { capturedAt: '2026-08-25T03:00:00.000Z' },
          cursor: { cell: 123 },
          duplicants: [],
        },
      },
    }
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state] }))
    const adapter = new OniAdapter(root, undefined, () => true, executionTimeoutMs)
    adapter.start()
    cleanups.push(async () => { await adapter.close(); await rm(root, { recursive: true, force: true }) })
    await until(async () => adapter.observe().catch(() => undefined))
    return { adapter, root, sessionDir, state }
  }

  it('announces capabilities, observes a stable revision, and emits a state event once', async () => {
    const { adapter, sessionDir, state } = await fixture()
    const listener = vi.fn()
    adapter.subscribe(listener)

    const hello = await adapter.hello()
    expect(hello).toMatchObject({ protocolVersion: '1.0', gameId: 'oxygen-not-included' })
    expect(hello.capabilities.find(item => item.name === 'oni_dig')).toMatchObject({
      kind: 'action',
      inputSchema: { type: 'object' },
    })
    const first = await adapter.observe()
    await new Promise(resolve => setTimeout(resolve, 220))
    const second = await adapter.observe()
    expect(first).toMatchObject({ saveId: 'fake-colony', revision: 1, observedAt: '2026-08-25T03:00:00.000Z' })
    expect(second.revision).toBe(first.revision)
    // Subscription happened after the initial state, so an unchanged outbox
    // must not replay the event or advance the revision.
    expect(listener).not.toHaveBeenCalled()
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state, {
      id: 'state-2',
      method: 'state.update',
      params: { observation: { meta: { capturedAt: '2026-08-25T03:00:01.000Z' }, cursor: { cell: 124 } } },
    }] }))
    await until(async () => listener.mock.calls.length === 1 ? true : undefined)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'state-2', revision: 2, type: 'state.updated' }))
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state, {
      id: 'state-2', method: 'state.update', params: { observation: { cursor: { cell: 124 } } },
    }, {
      id: 'chat-1', method: 'chat.send', params: { context: { observation: { cursor: { cell: 124 } } } },
    }] }))
    await new Promise(resolve => setTimeout(resolve, 150))
    expect((await adapter.observe()).revision).toBe(2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps requestId through the file bridge and reports measured timing segments', async () => {
    const { adapter, sessionDir, state } = await fixture()
    const execution = adapter.execute({
      requestId: 'dsh-call-123',
      gameId: 'oxygen-not-included',
      capability: 'oni_dig',
      arguments: { actorScope: 'colony' },
      expectedRevision: 1,
    })
    const request = await until(async () => {
      try {
        const inbox = JSON.parse(await readFile(join(sessionDir, 'inbox.json'), 'utf8')) as { events: Array<{ method: string, params: { callId?: string, args?: { targetCell?: number } } }> }
        return inbox.events.find(event => event.method === 'tool.execute')
      } catch { return undefined }
    })
    expect(request.params).toMatchObject({ callId: 'dsh-call-123', args: { targetCell: 123 } })
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({
      events: [state, {
        id: 'result-1',
        method: 'tool.result',
        params: { callId: 'dsh-call-123', success: true, reply: '已创建挖掘任务', gameExecutionMs: 7 },
      }],
    }))
    await expect(execution).resolves.toMatchObject({
      requestId: 'dsh-call-123',
      ok: true,
      revision: 1,
      result: { reply: '已创建挖掘任务' },
      timing: { bridgeRoundTripMs: expect.any(Number), gameExecutionMs: 7 },
    })
  })

  it('forwards absorb and spray to the C# Bridge with the exact current cursor cell', async () => {
    const { adapter, sessionDir, state } = await fixture()

    const executeWaterTool = async (requestId: string, capability: string, reply: string) => {
      const execution = adapter.execute({
        requestId,
        gameId: 'oxygen-not-included',
        capability,
        arguments: {},
        expectedRevision: 1,
      })
      const request = await until(async () => {
        try {
          const inbox = JSON.parse(await readFile(join(sessionDir, 'inbox.json'), 'utf8')) as {
            events: Array<{ method: string, params: { callId?: string, name?: string, args?: { targetCell?: number } } }>
          }
          return inbox.events.find(event => event.method === 'tool.execute' && event.params.callId === requestId)
        } catch { return undefined }
      })
      expect(request.params).toMatchObject({ callId: requestId, name: capability, args: { targetCell: 123 } })
      await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state, {
        id: `result-${requestId}`,
        method: 'tool.result',
        params: { callId: requestId, success: true, reply, gameExecutionMs: 4 },
      }] }))
      await expect(execution).resolves.toMatchObject({
        requestId,
        ok: true,
        result: { reply },
        timing: { bridgeRoundTripMs: expect.any(Number), gameExecutionMs: 4 },
      })
    }

    await executeWaterTool('water-absorb-1', 'oni_companion_absorb_water', '吸进了 200kg 水')
    await executeWaterTool('water-spray-1', 'oni_companion_spray_water', '喷出了 200kg 水')
  })

  it('exposes read-only inspection over the protocol and explains actual Bridge evidence', async () => {
    const { adapter, sessionDir, state } = await fixture()
    expect((await adapter.hello()).capabilities.some(c => c.name === 'oni_inspect_selected')).toBe(true)
    const execution = adapter.execute({ requestId: 'inspect-1', gameId: 'oxygen-not-included', capability: 'oni_inspect_selected', arguments: {} })
    const request = await until(async () => {
      try {
        const inbox = JSON.parse(await readFile(join(sessionDir, 'inbox.json'), 'utf8'))
        return inbox.events.find((e: any) => e.method === 'tool.execute' && e.params.callId === 'inspect-1')
      } catch { return undefined }
    })
    expect(request.params.name).toBe('oni_inspect_selected')
    const evidence = JSON.stringify({ available: true, capturedAt: new Date().toISOString(), name: '水泵', cell: 123, statuses: ['缺电'], operational: false })
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state, { id: 'inspection-result', method: 'tool.result', params: { callId: 'inspect-1', success: true, reply: evidence } }] }))
    const result = await execution
    expect(result.ok).toBe(true)
    expect(result.result?.reply).toContain('缺电')
    expect(result.result?.reply).toContain('不能仅凭停机判断整条线路过载')
  })

  it('routes colony inspection through the actual file request/result protocol', async () => {
    const { adapter, sessionDir, state } = await fixture()
    expect((await adapter.hello()).capabilities.some(c => c.name === 'oni_inspect_colony')).toBe(true)
    const execution = adapter.execute({ requestId: 'colony-1', gameId: 'oxygen-not-included', capability: 'oni_inspect_colony', arguments: {} })
    await until(async () => {
      try { const inbox = JSON.parse(await readFile(join(sessionDir, 'inbox.json'), 'utf8')); return inbox.events.find((e: any) => e.params.callId === 'colony-1') } catch { return undefined }
    })
    const reply = JSON.stringify({ available: true, capturedAt: new Date().toISOString(), worldId: 0, cycle: 1, oxygenKg: 100, foodKcal: 2000, population: 3, visibleCells: 100 })
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state, { id: 'colony-result', method: 'tool.result', params: { callId: 'colony-1', success: true, reply } }] }))
    const result = await execution
    expect(result.ok).toBe(true); expect(result.result?.reply).toContain('2000kcal')
  })

  it('runs the same fake Bridge through the real WebSocket handshake and action wire', async () => {
    const { adapter, sessionDir, state } = await fixture()
    let remote: RemoteGameAdapter | undefined
    const host = new WebSocketAdapterHost({
      host: '127.0.0.1',
      port: 0,
      requestTimeoutMs: 2_000,
      onAdapterReady: value => { remote = value },
    })
    const address = await host.ready()
    const client = new ReconnectingAdapterClient({
      url: address.url,
      adapter,
      reconnectMinMs: 30,
      reconnectMaxMs: 60,
      requestTimeoutMs: 2_000,
    })
    client.start()
    cleanups.push(async () => { await client.stop(); await host.close() })
    await client.waitUntilConnected(2_000)
    const connected = await until(async () => remote)
    await expect(connected.observe()).resolves.toMatchObject({ gameId: 'oxygen-not-included', revision: 1 })

    const execution = connected.execute({
      requestId: 'wire-call-1', gameId: 'oxygen-not-included', capability: 'oni_dig', arguments: {}, expectedRevision: 1,
    })
    await until(async () => {
      try {
        const inbox = JSON.parse(await readFile(join(sessionDir, 'inbox.json'), 'utf8')) as { events: Array<{ params: { callId?: string } }> }
        return inbox.events.some(event => event.params.callId === 'wire-call-1') ? true : undefined
      } catch { return undefined }
    })
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state, {
      id: 'wire-result-1', method: 'tool.result', params: { callId: 'wire-call-1', success: true, reply: 'wire ok', gameExecutionMs: 5 },
    }] }))
    await expect(execution).resolves.toMatchObject({
      requestId: 'wire-call-1', ok: true, timing: { bridgeRoundTripMs: expect.any(Number), gameExecutionMs: 5 },
    })
  })

  it('rejects stale revisions, unavailable actions, bridge rejection, and timeout deterministically', async () => {
    const { adapter, sessionDir, state } = await fixture(350)
    await expect(adapter.execute({
      requestId: 'stale-call', gameId: 'oxygen-not-included', capability: 'oni_dig', arguments: {}, expectedRevision: 0,
    })).resolves.toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } })
    await expect(adapter.execute({
      requestId: 'unknown-call', gameId: 'oxygen-not-included', capability: 'oni_delete_save', arguments: {}, expectedRevision: 1,
    })).resolves.toMatchObject({ ok: false, error: { code: 'CAPABILITY_UNAVAILABLE' } })

    const rejected = adapter.execute({
      requestId: 'rejected-call', gameId: 'oxygen-not-included', capability: 'oni_dig', arguments: {}, expectedRevision: 1,
    })
    await until(async () => {
      try {
        const inbox = JSON.parse(await readFile(join(sessionDir, 'inbox.json'), 'utf8')) as { events: Array<{ params: { callId?: string } }> }
        return inbox.events.some(event => event.params.callId === 'rejected-call') ? true : undefined
      } catch { return undefined }
    })
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [state, {
      id: 'result-rejected', method: 'tool.result', params: { callId: 'rejected-call', success: false, reply: '目标格不可挖掘', gameExecutionMs: 2 },
    }] }))
    await expect(rejected).resolves.toMatchObject({ ok: false, error: { code: 'ACTION_REJECTED', message: '目标格不可挖掘' } })

    await expect(adapter.execute({
      requestId: 'timeout-call', gameId: 'oxygen-not-included', capability: 'oni_dig', arguments: {}, expectedRevision: 1,
    })).resolves.toMatchObject({ ok: false, error: { code: 'REQUEST_TIMEOUT' } })
  })

  it('reports fake bridge disconnect and reconnect without launching ONI', async () => {
    const { adapter, sessionDir } = await fixture()
    const states: string[] = []
    adapter.subscribeConnection(state => states.push(state))
    await rm(sessionDir, { recursive: true, force: true })
    await until(async () => adapter.connectionState() === 'disconnected' ? true : undefined)
    await mkdir(sessionDir)
    await writeFile(join(sessionDir, 'session.json'), JSON.stringify({ processId: 4242, saveId: 'fake-colony-2' }))
    await writeFile(join(sessionDir, 'outbox.json'), JSON.stringify({ events: [{
      id: 'state-2', method: 'state.update', params: { observation: { meta: { capturedAt: '2026-08-25T03:01:00.000Z' }, cursor: { cell: 456 } } },
    }] }))
    await until(async () => adapter.connectionState() === 'connected' ? true : undefined)
    await until(async () => (await adapter.observe()).saveId === 'fake-colony-2' ? true : undefined)
    expect(states).toEqual(['disconnected', 'connected'])
    expect(await adapter.observe()).toMatchObject({ saveId: 'fake-colony-2', revision: 2 })
  })
})
