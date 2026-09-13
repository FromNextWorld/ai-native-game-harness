import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillStore } from '../src/runtime/skills/skill-store.js'
import { SkillService } from '../src/runtime/skills/skill-service.js'
import { compileSkillSource } from '../src/runtime/skills/skill-source.js'
import { snapshotDependencies } from '../src/runtime/skills/skill-dependencies.js'
import type { SkillRecord } from '../src/runtime/skills/contracts.js'

const dirs: string[] = []
const atoms = new Set(['test.echo', 'test.other'])
const signal = () => new AbortController().signal
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'xty-composition-')); dirs.push(directory)
  const config = { enabled: true, directory, activeLimit: 5 }
  const store = new SkillStore(config)
  const service = new SkillService(store)
  const learn = (skillId: string, sourceCode: string, trialArgs = {}) => service.tryLearnSource({
    gameId: 'test', skillId, name: skillId, description: skillId, triggers: [], sourceCode, trialArgs,
  }, atoms, async (_atom, args) => args, signal())
  return { store, service, learn, config }
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('versioned skill composition through a real child process', () => {
  it('passes arguments and return values with separate scopes and nested traces', async () => {
    const { learn } = setup()
    expect((await learn('child.echo', 'let r = await atom("test.echo", {value:params.value}); return r;', { value: 7 })).result.success).toBe(true)
    const parent = await learn('parent.echo', 'let r = await skill("child.echo", 1, {value:9}); assert(r.value == 9); return r;')
    expect(parent.result.value).toEqual({ value: 9 })
    expect(parent.result.trace[0]?.callPath).toEqual(['parent.echo@1', 'child.echo@1'])
    expect(parent.learned?.verified).toBe(true)
  })
  it('keeps the exact saved child version after upgrade and restart', async () => {
    const { learn, config } = setup()
    await learn('child.echo', 'let r = await atom("test.echo", {value:1}); return r;')
    await learn('parent.echo', 'let r = await skill("child.echo", 1, {}); assert(r.value == 1);')
    await learn('child.echo', 'await atom("test.echo", {value:2});')
    const restarted = new SkillService(new SkillStore(config))
    const result = await restarted.run('test', 'parent.echo', atoms, async (_atom, args) => args, signal())
    expect(result.success).toBe(true)
    expect(result.trace[0]?.arguments).toEqual({ value: 1 })
  })
  it('rejects missing versions and hidden-branch capability escalation before any action', async () => {
    const { learn, service } = setup()
    await learn('child.echo', 'await atom("test.other", {});')
    await learn('parent.echo', 'await atom("test.echo", {}); if (true) { await skill("child.echo", 1, {}); }')
    const executor = vi.fn(async () => ({}))
    const result = await service.run('test', 'parent.echo', new Set(['test.echo']), executor, signal())
    expect(result.success).toBe(false)
    expect(executor).not.toHaveBeenCalled()
    expect((await learn('bad.missing', 'await skill("child.echo", 99, {});')).result.success).toBe(false)
  })
  it('shares the 60 atom budget across child invocations', async () => {
    const { learn } = setup()
    await learn('child.echo', 'repeat(10) { await atom("test.echo", {}); }')
    const result = await learn('parent.echo', 'repeat(7) { await skill("child.echo", 1, {}); }')
    expect(result.result.success).toBe(false)
    expect(result.result.trace).toHaveLength(60)
    expect(result.result.error).toContain('共享')
    expect(result.learned).toBeUndefined()
  })
  it('shares the 30 skill invocation budget and rejects invalid child input', async () => {
    const { learn } = setup()
    await learn('child.echo', 'await atom("test.echo", {value:params.value});', { value: 1 })
    const missing = await learn('parent.invalid', 'await skill("child.echo", 1, {});')
    expect(missing.result.success).toBe(false)
    const limit = await learn('parent.limit', 'repeat(10) { repeat(4) { await skill("child.echo", 1, {value:1}); } }')
    expect(limit.result.success).toBe(false)
    expect(limit.result.error).toContain('30')
    expect(limit.result.trace).toHaveLength(29)
  })
  it('rechecks the child task contract even when parent source has no assertions', async () => {
    const { service, learn } = setup()
    await service.tryLearnSource({ gameId: 'test', skillId: 'child.checked', name: 'checked', description: 'checked', triggers: [],
      sourceCode: 'await atom("test.echo", {});', acceptance: { version: 1, steps: [{ atom: 'test.echo', positive: ['count'] }] },
    }, atoms, async () => ({ count: 1 }), signal())
    const result = await learn('parent.checked', 'await skill("child.checked", 1, {});')
    expect(result.result.success).toBe(false)
    expect(result.result.error).toContain('验收失败')
  })
  it('does not allow catch to turn a failed child into a learned parent', async () => {
    const { learn, service } = setup()
    await learn('child.echo', 'let r = await atom("test.echo", {ok:true}); assert(r.ok == true);')
    await learn('parent.echo', 'try { await skill("child.echo", 1, {}); } catch { await atom("test.other", {}); }')
    const result = await service.run('test', 'parent.echo', atoms, async () => ({ ok: false }), signal())
    expect(result.success).toBe(false)
    expect(result.trace).toHaveLength(1)
  })
  it('cancels a nested atom and reaps the interpreter before returning', async () => {
    const { learn, service } = setup()
    await learn('child.echo', 'await atom("test.echo", {});')
    await learn('parent.echo', 'await skill("child.echo", 1, {});')
    const controller = new AbortController()
    const executor = vi.fn(async (_atom, _args, abort: AbortSignal) => {
      controller.abort()
      expect(abort.aborted).toBe(true)
      throw new Error('已取消')
    })
    const result = await service.run('test', 'parent.echo', atoms, executor, controller.signal)
    expect(result.success).toBe(false)
    expect(result.error).toContain('取消')
    expect(result.trace).toHaveLength(1)
    expect(result.trace[0]?.success).toBe(false)
    expect(executor).toHaveBeenCalledTimes(1)
    expect((await service.run('test', 'parent.echo', atoms, async () => ({}), signal())).success).toBe(true)
  })
  it('rejects cycles, excessive depth and unverified code', () => {
    const record = (id: string, source: string): SkillRecord => ({ id, gameId: 'test', version: 1, verified: true,
      name: id, description: id, triggers: [], status: 'active', program: compileSkillSource(source),
      successCount: 0, failureCount: 0, createdAt: '', updatedAt: '' })
    expect(() => snapshotDependencies('root.skill', compileSkillSource('await skill("root.skill", 1, {});'), atoms,
      id => record(id, 'await atom("test.echo", {});'))).toThrow('循环')
    expect(() => snapshotDependencies('root.skill', compileSkillSource('await skill("child.skill", 1, {});'), atoms,
      id => ({ ...record(id, 'await atom("test.echo", {});'), verified: false }))).toThrow('已验证')
    const chain = ['one.skill', 'two.skill', 'three.skill', 'four.skill']
    expect(() => snapshotDependencies('root.skill', compileSkillSource('await skill("one.skill", 1, {});'), atoms,
      id => record(id, chain.indexOf(id) < 3 ? `await skill("${chain[chain.indexOf(id) + 1]}", 1, {});` : 'await atom("test.echo", {});'))).toThrow('4 层')
  })
  it('rejects arbitrary JS, dynamic versions and prototype access', () => {
    for (const source of ['await skill("child.echo", params.version, {});', 'await import("node:fs");',
      'await atom("test.echo", {x:params.constructor});', 'await atom("test.echo", {"__proto__":{}});']) {
      expect(() => compileSkillSource(source, atoms)).toThrow()
    }
  })
})
