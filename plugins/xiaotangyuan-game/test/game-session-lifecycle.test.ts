import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GameAgentSession } from '../src/runtime/agent/game-agent-session.js'

beforeEach(() => {
  vi.stubEnv('DSH_HOME', mkdtempSync(join(tmpdir(), 'xty-session-lifecycle-')))
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

function fixture() {
  const agents = new Map<string, any>()
  const attached = new Map<string, any>()
  const selection = { provider: 'test', model: 'test-model', reasoningEffort: 'off' }
  const ctx = {
    root: {}, logger: { warn: vi.fn(), debug: vi.fn() },
    agents: { get: (id: string) => agents.get(id), create: vi.fn(), resume: vi.fn() },
    sessions: { get: (id: string) => attached.get(id), flush: vi.fn(async () => undefined) },
    sessionTitle: { rename: vi.fn() },
  }
  function handle(id: string) {
    const agent = { id, session: { id, header: {} }, ctx: new Context(), whenIdle: vi.fn(async () => undefined), cancel: vi.fn() }
    agents.set(id, agent); attached.set(id, agent.session)
    return { agent, dispose: vi.fn(async () => { if (agents.get(id) === agent) { agents.delete(id); attached.delete(id) } }) }
  }
  ctx.agents.resume.mockImplementation(async ({ resumeSessionId }) => { throw new Error(`session "${resumeSessionId}" not found`) })
  ctx.agents.create.mockImplementation(async ({ sessionId }) => handle(sessionId))
  let bindings = 0
  function game() {
    const instance = new GameAgentSession(ctx as never, { gameId: 'stardew-valley', saveId: 'test' } as never,
      {} as never, undefined, undefined, {} as never, undefined, 'memory-test')
    vi.spyOn(instance as any, 'setupAgent').mockImplementation(() => (bindingCtx: Context) => {
      bindings++
      bindingCtx.effect(() => () => { bindings-- })
    })
    return instance
  }
  const ensure = (instance: GameAgentSession, configured = selection) => (instance as any).ensureAgent(configured, 'test')
  return { ctx, agents, attached, selection, handle, game, ensure, bindings: () => bindings }
}

describe('game Session lifecycle integration', () => {
  it('reuses a Desktop-restored agent and only removes its own scoped game binding on disconnect', async () => {
    const f = fixture(); const g = f.game()
    const first = await f.ensure(g); const id = first.agent.id
    await g.dispose()
    const desktopOwned = f.handle(id)
    const reconnect = f.game()
    const borrowed = await f.ensure(reconnect)
    expect(borrowed.agent).toBe(desktopOwned.agent)
    expect(f.bindings()).toBe(1)
    await reconnect.dispose()
    expect(f.bindings()).toBe(0)
    expect(desktopOwned.dispose).not.toHaveBeenCalled()
    expect(f.agents.get(id)).toBe(desktopOwned.agent)
    await desktopOwned.agent.ctx.fiber.dispose()
  })

  it('single-flights warmup and voice initialization without duplicate create', async () => {
    const f = fixture(); const g = f.game()
    const results = await Promise.all([f.ensure(g), f.ensure(g), f.ensure(g)])
    expect(results[0]).toBe(results[1]); expect(results[1]).toBe(results[2])
    expect(f.ctx.agents.create).toHaveBeenCalledOnce()
    await g.dispose()
    expect(f.agents.size).toBe(0)
    await expect(f.ensure(g)).rejects.toThrow('游戏连接已关闭')
  })

  it('hands off between connections; a late old disconnect cannot dispose the new handle', async () => {
    const f = fixture(); const old = f.game(); const next = f.game()
    const before = await f.ensure(old)
    const after = await f.ensure(next)
    expect(before.dispose).toHaveBeenCalledOnce()
    expect(after.agent).not.toBe(before.agent)
    await old.dispose()
    expect(f.agents.get(after.agent.id)).toBe(after.agent)
    await expect(f.ensure(old)).rejects.toThrow('新连接接管')
    await next.dispose()
  })

  it('does not create a new session on a corrupted or unauthorized resume', async () => {
    const f = fixture(); const g = f.game()
    f.ctx.agents.resume.mockRejectedValue(new Error('persistence authentication failed'))
    await expect(f.ensure(g)).rejects.toThrow('persistence authentication failed')
    expect(f.ctx.agents.create).not.toHaveBeenCalled()
    await g.dispose()
  })

  it('cleans up a published handle if initial flush fails, allowing a later retry', async () => {
    const f = fixture(); const g = f.game()
    f.ctx.sessions.flush.mockRejectedValueOnce(new Error('flush failed'))
    await expect(f.ensure(g)).rejects.toThrow('flush failed')
    expect(f.agents.size).toBe(0)
    await f.ensure(g)
    expect(f.agents.size).toBe(1)
    await g.dispose()
  })

  it('rolls back initialization that finishes after the connection was closed', async () => {
    const f = fixture(); const g = f.game()
    let complete!: () => void
    f.ctx.agents.create.mockImplementation(async ({ sessionId }) => {
      await new Promise<void>(resolve => { complete = resolve })
      return f.handle(sessionId)
    })
    const initializing = f.ensure(g)
    const rejected = expect(initializing).rejects.toThrow('游戏连接已关闭')
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    const closing = g.dispose()
    complete()
    await rejected; await closing
    expect(f.agents.size).toBe(0)
  })

  it('borrows an agent that wins a concurrent desktop resume instead of creating a duplicate', async () => {
    const f = fixture(); const g = f.game()
    f.ctx.agents.resume.mockImplementation(async ({ resumeSessionId }) => {
      f.handle(resumeSessionId)
      throw new Error('already exists')
    })
    const result = await f.ensure(g)
    expect(f.agents.get(result.agent.id)).toBe(result.agent)
    expect(f.ctx.agents.create).not.toHaveBeenCalled()
    await g.dispose()
    await result.agent.ctx.fiber.dispose()
  })

  it('aborts waiting on an externally busy agent without cancelling or deleting it', async () => {
    const f = fixture(); const original = f.game()
    const seed = await f.ensure(original)
    await original.dispose()
    const external = f.handle(seed.agent.id)
    external.agent.whenIdle.mockImplementation(() => new Promise(() => {}))
    const g = f.game()
    const initializing = f.ensure(g)
    const rejected = expect(initializing).rejects.toThrow('游戏连接已关闭')
    await vi.waitFor(() => expect(external.agent.whenIdle).toHaveBeenCalled())
    await g.dispose(); await rejected
    expect(external.agent.cancel).not.toHaveBeenCalled()
    expect(f.agents.get(seed.agent.id)).toBe(external.agent)
    await external.agent.ctx.fiber.dispose()
  })
})
