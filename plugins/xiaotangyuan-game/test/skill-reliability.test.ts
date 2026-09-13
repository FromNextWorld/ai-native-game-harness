import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameGateway } from '../src/gateway/game-gateway.js'
import { SkillService } from '../src/runtime/skills/skill-service.js'
import { SkillStore } from '../src/runtime/skills/skill-store.js'
import { LearningTurnBudget, continueLearningRevisions, learningOutcomeReply } from '../src/tools/skill-tools.js'
import { skillFailureAdvice } from '../src/runtime/skills/skill-verification.js'
import { acceptanceForGameTask, huntTaskAcceptance } from '../src/runtime/tasks/game-task-acceptance.js'

const atoms = new Set(['dst.find_nearest_entity', 'dst.attack_target', 'dst.collect_items'])
const sourceCode = `let target = await atom("dst.find_nearest_entity", {prefab:"butterfly",radius:20});
let hit = await atom("dst.attack_target", {targetId:target.targetId});
assert(hit.defeated == true, "没有击杀");
await atom("dst.collect_items", {prefabs:["butterflywings","butter"],x:hit.x,z:hit.z,radius:4});`
const input = { gameId: 'dont-starve-together', skillId: 'dst.hunt', name: '打蝴蝶', description: '击杀并拾取', triggers: ['打蝴蝶'], sourceCode, acceptance: huntTaskAcceptance('butterfly', ['butterflywings', 'butter']) }
const happy = async (atom: string) => atom.includes('find') ? { targetId: 42, prefab: 'butterfly' }
  : atom.includes('attack') ? { targetId: 42, defeated: true, x: 1, z: 2 }
    : { count: 1, items: ['butterflywings'] }
const directories: string[] = []
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'xty-skill-audit-'))
  directories.push(directory)
  const config = { enabled: true, directory, activeLimit: 5 }
  const store = new SkillStore(config)
  return { directory, config, store, service: new SkillService(store) }
}
afterEach(() => { vi.useRealTimers(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('skill learning acceptance and recovery', () => {
  it('persists actual successful trial and reuses it after service restart without compilation by a model', async () => {
    const { config, service } = setup()
    expect((await service.tryLearnSource(input, atoms, happy, new AbortController().signal)).learned?.version).toBe(1)
    const restarted = new SkillService(new SkillStore(config))
    const result = await restarted.run(input.gameId, input.skillId, atoms, happy, new AbortController().signal)
    expect(result.success).toBe(true)
    expect(result.trace).toHaveLength(3)
    expect(restarted.store.get(input.gameId, input.skillId)?.successCount).toBe(1)
    expect(restarted.store.get(input.gameId, input.skillId)?.acceptance).toEqual(input.acceptance)
    const missingLoot = await restarted.run(input.gameId, input.skillId, atoms,
      async atom => atom.includes('collect') ? { count: 0, items: [] } : happy(atom), new AbortController().signal)
    expect(missingLoot.success).toBe(false)
  })
  it.each([
    ['skipped body', 'if (1 == 2) { await atom("dst.attack_target", {targetId:42}); }'],
    ['find only', 'await atom("dst.find_nearest_entity", {});'],
  ])('does not save %s as a learned hunting skill', async (_label, sourceCode) => {
    const { service, store } = setup()
    const result = await service.tryLearnSource({ ...input, sourceCode }, atoms, happy, new AbortController().signal)
    expect(result.result.success).toBe(false)
    expect(store.list(input.gameId)).toEqual([])
  })
  it.each([
    ['empty loot', 'collect', { count: 0, items: [] }],
    ['wrong target', 'attack', { targetId: 99, defeated: true, x: 1, z: 2 }],
    ['still alive', 'attack', { targetId: 42, defeated: false, x: 1, z: 2 }],
    ['false loot evidence', 'collect', { count: 1, items: ['log'] }],
  ])('rejects %s and preserves previously working version', async (_label, match, badResult) => {
    const { service, store } = setup()
    await service.tryLearnSource(input, atoms, happy, new AbortController().signal)
    const result = await service.tryLearnSource(input, atoms, async atom => atom.includes(match as string) ? badResult : happy(atom), new AbortController().signal)
    expect(result.result.success).toBe(false)
    expect(store.get(input.gameId, input.skillId)?.version).toBe(1)
    expect(store.listLearningAttempts(input.gameId)).toHaveLength(2)
  })
  it('rejects concurrent execution, records cancellation and releases the game lock', async () => {
    const { service, store } = setup()
    const controller = new AbortController()
    const pending = service.tryLearnSource(input, atoms, async (_atom, _args, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })), controller.signal)
    const other = await service.tryLearnSource(input, atoms, happy, new AbortController().signal)
    expect(other.result.error).toContain('还在执行')
    controller.abort(new Error('已取消'))
    expect((await pending).result.success).toBe(false)
    expect(store.list(input.gameId)).toEqual([])
    expect((await service.tryLearnSource(input, atoms, happy, new AbortController().signal)).result.success).toBe(true)
  })
  it('preserves corrupted skill files rather than silently erasing them', () => {
    const { config, directory } = setup()
    const file = join(directory, 'skills-v2.json')
    writeFileSync(file, '{broken')
    expect(() => new SkillStore(config)).toThrow('原文件已保留')
    expect(readFileSync(file, 'utf8')).toBe('{broken')
  })
  it('enforces three revisions and stable IDs, resets only for a new turn', () => {
    const budget = new LearningTurnBudget()
    budget.reserve('turn', 'dst.hunt')
    expect(() => budget.reserve('turn', 'dst.hunt-v2')).toThrow('原技能 ID')
    budget.reserve('turn', 'dst.hunt'); budget.reserve('turn', 'dst.hunt')
    expect(() => budget.reserve('turn', 'dst.hunt')).toThrow('三次')
    budget.reset('turn'); budget.reserve('turn', 'dst.hunt'); budget.stop('turn')
    expect(() => budget.reserve('turn', 'dst.hunt')).toThrow('环境')
  })
  it('does not recommend rewriting code for environmental failures', () => {
    for (const message of ['附近没有蝴蝶', '容器已经满了', '目标已经离开', '游戏暂停', '连接断开', '指令已过期']) {
      expect(skillFailureAdvice(message).retryable).toBe(false)
    }
    expect(skillFailureAdvice('游戏未声明原子能力：dst.say').retryable).toBe(true)
  })

  it('does not impose hunting policy on an unrelated pickup skill', async () => {
    const { service } = setup()
    const contract = acceptanceForGameTask('dont-starve-together', '学习捡木头')
    expect(contract).toBeUndefined()
    const result = await service.tryLearnSource({ ...input, skillId: 'dst.pickup-log',
      acceptance: { version: 1, steps: [{ atom: 'dst.collect_items', positive: ['count'], allowedItems: { items: ['log'] } }] },
      sourceCode: 'await atom("dst.collect_items", {prefab:"log",x:1,z:2});',
    }, atoms, async () => ({ count: 1, items: ['log'] }), new AbortController().signal)
    expect(result.learned?.id).toBe('dst.pickup-log')
  })

  it('accepts repeated bounded attacks only after a real lethal hit', async () => {
    const { service } = setup()
    let hits = 0
    const repeated = sourceCode.replace('let hit = await atom', 'await atom("dst.attack_target", {targetId:target.targetId});\nlet hit = await atom')
    const result = await service.tryLearnSource({ ...input, sourceCode: repeated }, atoms, async atom => {
      if (atom.includes('attack')) return { targetId: 42, defeated: ++hits === 2, x: 1, z: 2 }
      return happy(atom)
    }, new AbortController().signal)
    expect(result.result.success).toBe(true)
    expect(result.result.trace).toHaveLength(4)
  })

  it('retains saved acceptance when a revision omits its contract', async () => {
    const { service, store } = setup()
    await service.tryLearnSource(input, atoms, happy, new AbortController().signal)
    const { acceptance: _acceptance, ...revision } = input
    const result = await service.tryLearnSource({ ...revision, sourceCode: 'await atom("dst.find_nearest_entity", {prefab:"butterfly"});' },
      atoms, happy, new AbortController().signal)
    expect(result.result.success).toBe(false)
    expect(store.get(input.gameId, input.skillId)?.version).toBe(1)
  })

  it('freezes task acceptance through repair turns and releases it on completion', () => {
    const budget = new LearningTurnBudget()
    const contract = huntTaskAcceptance('butterfly', ['butterflywings'])
    budget.begin('session', contract)
    contract.steps.length = 0
    budget.acceptance('session')!.steps.length = 0
    budget.reset('session')
    expect(budget.acceptance('session')?.steps).toHaveLength(3)
    budget.end('session')
    expect(budget.acceptance('session')).toBeUndefined()
  })
})

describe('gateway lease transport', () => {
  function gatewayFixture() {
    const messages: Array<{ method: string, params: Record<string, unknown> }> = []
    const gateway = Object.create(GameGateway.prototype)
    const state = { adapter: { capabilities: ['game.atom.lease-v1'], atoms: [{ name: 'dst.find_nearest_entity' }] }, socket: { readyState: 1, send: (message: string) => messages.push(JSON.parse(message)) }, pendingAdapterRequests: new Map() }
    return { gateway, state, messages }
  }
  it('does not expire at the obsolete 15 second boundary; deadline reaches adapter', async () => {
    vi.useFakeTimers()
    const { gateway, state, messages } = gatewayFixture()
    const controller = new AbortController()
    const pending = gateway.callAdapterAtom(state, 'dst.find_nearest_entity', {}, controller.signal)
    const assertion = expect(pending).rejects.toThrow('取消')
    expect(messages[0]?.params.expiresAtUnix).toBe((Date.now() + 30_000) / 1000)
    await vi.advanceTimersByTimeAsync(16_000)
    expect(state.pendingAdapterRequests.size).toBe(1)
    controller.abort(new Error('取消'))
    await assertion
    expect(messages.at(-1)?.method).toBe('game.atom.cancel')
    expect(state.pendingAdapterRequests.size).toBe(0)
  })
  it('sends cancellation on timeout and drops late replies', async () => {
    vi.useFakeTimers()
    const { gateway, state, messages } = gatewayFixture()
    const pending = gateway.callAdapterAtom(state, 'dst.find_nearest_entity', {}, new AbortController().signal)
    const assertion = expect(pending).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(35_000)
    await assertion
    expect(messages.at(-1)?.method).toBe('game.atom.cancel')
    expect(state.pendingAdapterRequests.size).toBe(0)
  })
})

describe('bounded learning continuation', () => {
  const failure = { success: false, learned: false, skillId: 'dst.hunt', error: '验收失败', traceJson: '[]' }
  it('repairs program errors across model turns without resetting the three-attempt budget', async () => {
    const budget = new LearningTurnBudget()
    budget.begin('session')
    budget.reserve('session', 'dst.hunt'); budget.record('session', failure)
    let revisions = 0
    await continueLearningRevisions(budget, 'session', async instruction => {
      expect(instruction).toContain('dst.hunt')
      budget.reset('session') // actual session turn/end and turn/start notifications
      budget.reserve('session', 'dst.hunt')
      revisions += 1
      budget.record('session', revisions === 2 ? { ...failure, success: true, learned: true } : failure)
    })
    expect(revisions).toBe(2)
    expect(budget.count('session')).toBe(3)
    expect(learningOutcomeReply(budget.outcome('session'))).toContain('已经保存')
    budget.end('session'); budget.begin('session')
    expect(budget.count('session')).toBe(0)
  })
  it('stops at three failed trials, not three trials per continuation', async () => {
    const budget = new LearningTurnBudget()
    budget.begin('session'); budget.reserve('session', 'dst.hunt'); budget.record('session', failure)
    await continueLearningRevisions(budget, 'session', async () => {
      budget.reserve('session', 'dst.hunt'); budget.record('session', failure)
    })
    expect(budget.count('session')).toBe(3)
    expect(learningOutcomeReply(budget.outcome('session'))).toContain('还没有学会')
  })
  it.each(['附近没有蝴蝶', '容器已满', '连接断开', '已取消'])('does not autonomously retry %s', async error => {
    const budget = new LearningTurnBudget()
    budget.begin('session'); budget.reserve('session', 'dst.hunt'); budget.record('session', { ...failure, error })
    const revise = vi.fn()
    await continueLearningRevisions(budget, 'session', revise)
    expect(revise).not.toHaveBeenCalled()
  })
  it('does not keep prompting a model that replies with promises but invokes no tool', async () => {
    const budget = new LearningTurnBudget()
    budget.begin('session'); budget.reserve('session', 'dst.hunt'); budget.record('session', failure)
    const revise = vi.fn(async () => {})
    await continueLearningRevisions(budget, 'session', revise)
    expect(revise).toHaveBeenCalledTimes(1)
    // No outcome is not evidence of an executed failed trial.
    expect(learningOutcomeReply()).toContain('没有确认到学习结果')
  })
})
