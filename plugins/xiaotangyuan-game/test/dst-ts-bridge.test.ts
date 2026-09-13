import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, WebSocket } from 'ws'
import { DstTsBridge, atomicJson, bridgeFiles } from '../src/runtime/adapters/dst/bridge.js'
import { buildChatContext, DST_ATOMS } from '../src/runtime/adapters/dst/context.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture(before?: (files: ReturnType<typeof bridgeFiles>) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'xty-ts-bridge-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => server.once('listening', resolve))
  cleanup.push(() => new Promise<void>(resolve => { for (const socket of server.clients) socket.terminate(); server.close(() => resolve()) }))
  const messages: any[] = []
  let socket: WebSocket | undefined
  server.on('connection', connection => {
    socket = connection
    connection.on('message', raw => {
      const message = JSON.parse(raw.toString()); messages.push(message)
      if (message.method && message.id) connection.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { reply: '提醒好了' } }))
    })
  })
  const files = bridgeFiles(directory)
  await before?.(files)
  const bridge = new DstTsBridge(directory, process.pid, `ws://127.0.0.1:${(server.address() as any).port}`)
  cleanup.push(() => bridge.close())
  await bridge.start()
  await expect.poll(() => bridge.client.connected).toBe(true)
  return { directory, files, bridge, messages, send: (message: any) => socket!.send(JSON.stringify({ jsonrpc: '2.0', ...message })), disconnect: () => socket!.terminate() }
}
const read = async (path: string): Promise<any> => JSON.parse(await readFile(path, 'utf8'))
const state = { save_id: 'world-alpha', captured_at_unix: 1, player: { name: '玩家', health_percent: 0.5 }, world: { cycles: 2, phase: 'day' }, chester: { present: true } }

describe('TS DST bridge using real files and WebSocket, no Python process', () => {
  it('preserves save identity and observation mapping', () => {
    const result = buildChatContext(state)
    expect(result.saveId).toBe(createHash('sha256').update('dst:world-alpha').digest('hex'))
    expect(result.observation.player.vitals.health.ratio).toBe(0.5)
    expect(result.observation.scene.clock.day).toBe(3)
    expect(buildChatContext({}).saveId).toBeUndefined()
    expect(DST_ATOMS.map(atom => atom.name)).toEqual(['dst.inspect_player', 'dst.inspect_companion', 'dst.move_to', 'dst.pick_target', 'dst.find_nearest_entity', 'dst.attack_target', 'dst.collect_items'])
  })
  it('ignores startup events, keeps voice order and suppresses duplicated events', async () => {
    const { files, messages } = await fixture(async files => {
      await atomicJson(files.request, { events: [{ id: 'old', action: 'start_recording' }] })
    })
    await atomicJson(files.request, { events: [{ id: 'new1', action: 'start_recording', state }, { id: 'new2', action: 'stop_recording', state }] })
    await expect.poll(() => messages.filter(item => item.method?.startsWith('voice.')).map(item => item.method)).toEqual(['voice.start', 'voice.stop'])
    expect(messages.filter(item => item.method === 'state.update').at(-1).params.saveId).toBe(buildChatContext(state).saveId)
    expect(files.request).toMatch(/dont_starve_ai_mod_requests.json$/)
  })
  it('routes a real RPC atom through command/result files and retires its lease', async () => {
    const { files, messages, send } = await fixture()
    send({ id: 'rpc1', method: 'game.atom.execute', params: { atom: 'dst.find_nearest_entity', arguments: { prefab: 'rabbit' }, commandId: 'find1', expiresAtUnix: Date.now() / 1000 + 20 } })
    await expect.poll(async () => (await read(files.skillCommand)).id).toBe('find1')
    expect((await read(files.skillCommand)).arguments.prefab).toBe('rabbit')
    await atomicJson(files.skillResult, { id: 'find1', success: true, result: { targetId: 42, prefab: 'rabbit' } })
    await expect.poll(() => messages.find(item => item.id === 'rpc1')?.result?.targetId).toBe(42)
    expect((await read(files.skillCommand)).cancelled).toBe(true)
  })
  it('renews leases while waiting and rejects a concurrent atom', async () => {
    const { files, bridge, send } = await fixture()
    const pending = bridge.executeAtom({ atom: 'dst.attack_target', arguments: { targetId: 42 }, commandId: 'renew', expiresAtUnix: Date.now() / 1000 + 20 })
    const assertion = expect(pending).rejects.toThrow('取消')
    await expect.poll(async () => (await read(files.skillCommand)).id).toBe('renew')
    const initial = (await read(files.skillCommand)).lease_until_unix
    await expect(bridge.executeAtom({ atom: 'dst.attack_target', commandId: 'other', expiresAtUnix: Date.now() / 1000 + 20 })).rejects.toThrow('上一个')
    await expect.poll(async () => (await read(files.skillCommand)).lease_until_unix).toBeGreaterThan(initial)
    send({ method: 'game.atom.cancel', params: { commandId: 'renew' } }); await assertion
  })
  it('expires uncompleted commands without accepting a late success', async () => {
    const { files, bridge } = await fixture()
    const pending = bridge.executeAtom({ atom: 'dst.attack_target', commandId: 'late', expiresAtUnix: Date.now() / 1000 + 0.15 })
    await expect(pending).rejects.toThrow('超时')
    await atomicJson(files.skillResult, { id: 'late', success: true, result: { defeated: true } })
    expect((await read(files.skillCommand)).cancelled).toBe(true)
  })
  it('ignores stale replies and rejects cancellation without retaining an action lock', async () => {
    const { files, messages, send, bridge } = await fixture()
    await atomicJson(files.skillResult, { id: 'old', success: true, result: {} })
    send({ id: 'rpc2', method: 'game.atom.execute', params: { atom: 'dst.attack_target', arguments: { targetId: 42 }, commandId: 'cancel2', expiresAtUnix: Date.now() / 1000 + 20 } })
    await expect.poll(async () => (await read(files.skillCommand)).id).toBe('cancel2')
    expect(messages.find(item => item.id === 'rpc2')).toBeUndefined()
    send({ method: 'game.atom.cancel', params: { commandId: 'cancel2' } })
    await expect.poll(() => messages.find(item => item.id === 'rpc2')?.error?.message).toContain('取消')
    expect((await read(files.skillCommand)).lease_until_unix).toBe(0)
    await expect(bridge.executeAtom({ atom: 'dst.attack_target', commandId: 'expired', expiresAtUnix: 1 })).rejects.toThrow('过期')
  })
  it('disconnect cancels commands before reconnect and never replays them', async () => {
    const { files, send, disconnect, bridge } = await fixture()
    send({ id: 'rpc3', method: 'game.atom.execute', params: { atom: 'dst.attack_target', arguments: { targetId: 42 }, commandId: 'disconnect3', expiresAtUnix: Date.now() / 1000 + 20 } })
    await expect.poll(async () => (await read(files.skillCommand)).id).toBe('disconnect3')
    disconnect()
    await expect.poll(async () => (await read(files.skillCommand)).cancelled).toBe(true)
    await expect.poll(() => bridge.client.connected, { timeout: 4000 }).toBe(true)
    expect((await read(files.skillCommand)).id).toBe('disconnect3')
    expect((await read(files.skillCommand)).cancelled).toBe(true)
  })
  it('preserves recipient for streaming text and publishes recording state', async () => {
    const { files, send, messages } = await fixture()
    await atomicJson(files.request, { events: [{ id: 'voice', action: 'start_recording', recipient_userid: 'KU_test', state }] })
    await expect.poll(() => messages.some(item => item.method === 'voice.start')).toBe(true)
    send({ method: 'assistant.status', params: { status: 'recording' } })
    await expect.poll(async () => (await read(files.bridgeStatus)).recording).toBe(true)
    send({ method: 'assistant.present', params: { text: '收到' } })
    await expect.poll(async () => (await read(files.reply)).text).toBe('收到')
    expect((await read(files.reply)).recipient_userid).toBe('KU_test')
  })
  it('does not warm an old save file and rejects a second bridge', async () => {
    const { directory, messages } = await fixture(async files => {
      await atomicJson(files.state, state); await utimes(files.state, new Date(0), new Date(0))
    })
    expect(messages.some(item => item.method === 'state.update')).toBe(false)
    const second = new DstTsBridge(directory, process.pid)
    await expect(second.start()).rejects.toThrow(/桥接|锁/)
    await second.close()
  })
  it('close retires the current command and releases only its own lock', async () => {
    const { files, bridge } = await fixture()
    const pending = bridge.executeAtom({ atom: 'dst.collect_items', arguments: { prefab: 'log' }, commandId: 'stop', expiresAtUnix: Date.now() / 1000 + 20 })
    const assertion = expect(pending).rejects.toThrow()
    await expect.poll(async () => (await read(files.skillCommand)).id).toBe('stop')
    await bridge.close(); await assertion
    expect((await read(files.skillCommand)).cancelled).toBe(true)
    await expect(stat(`${files.bridgeStatus}.ts.lock`)).rejects.toThrow()
  })
})
