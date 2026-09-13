import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileSkillSource } from '../src/runtime/skills/skill-source.js'
import { SkillService } from '../src/runtime/skills/skill-service.js'
import { SkillStore } from '../src/runtime/skills/skill-store.js'
import { huntTaskAcceptance } from '../src/runtime/tasks/game-task-acceptance.js'
import { LearningTurnBudget, continueLearningRevisions, learningOutcomeReply, registerSkillTools } from '../src/tools/skill-tools.js'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const signal = () => new AbortController().signal
const atoms = new Set(['dst.find_nearest_entity', 'dst.attack_target', 'dst.collect_items'])
// Actual failed generated syntax. The historical source used found.x/z; that
// independent evidence error is retained in a separate negative test below.
const source = `let found = await atom("dst.find_nearest_entity", { prefab: "butterfly" });
assert(found && found.targetId, "未找到蝴蝶");
let atk = await atom("dst.attack_target", { targetId: found.targetId });
assert(atk && atk.defeated === true, "蝴蝶未被击杀");
let pick = await atom("dst.collect_items", { prefabs: ["butterflywings", "butter"], x: atk.x, z: atk.z, radius: 8 });
return { targetId: found.targetId, defeated: atk.defeated, picked: pick };`
const input = { gameId: 'dont-starve-together', skillId: 'dst.hunt-and-collect-butterfly', name: '追踪并拾取', description: '有限追踪和验收', triggers: ['打蝴蝶'], sourceCode: source,
  acceptance: huntTaskAcceptance('butterfly', ['butterflywings', 'butter']) }
const happy = async (atom: string) => atom.includes('find') ? { targetId: 42, prefab: 'butterfly', x: 1, z: 2 }
  : atom.includes('attack') ? { targetId: 42, defeated: true, x: 8, z: 9 } : { count: 1, items: ['butterflywings'] }
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'xty-learning-regression-')); directories.push(directory)
  const config = { enabled: true, directory, activeLimit: 5 }
  const store = new SkillStore(config)
  return { config, directory, store, service: new SkillService(store) }
}

describe('strict equality compatibility without relaxing the skill sandbox', () => {
  it('accepts actual generated === syntax and keeps the canonical AST and original source', () => {
    expect(() => compileSkillSource(source, atoms)).not.toThrow()
    const program = compileSkillSource(source, atoms)
    expect(program.body).toEqual(compileSkillSource(source.replace('===', '=='), atoms).body)
    expect(program.source).toBe(source)
  })
  it('accepts !== without modifying string literals, comments or their source columns', () => {
    const text = 'let r = await atom("dst.find_nearest_entity", {note:"a === b !== c"}); /* === */\nassert(r.targetId !== "42"); // !==\nreturn "===";'
    expect(() => compileSkillSource(text, atoms)).not.toThrow()
    expect(compileSkillSource(text, atoms).source).toBe(text)
    expect(compileSkillSource(text, atoms).body[0]).toMatchObject({ args: { note: { kind: 'literal', value: 'a === b !== c' } } })
    expect(() => compileSkillSource('await atom("dst.find_nearest_entity", {});\nassert(1 === @);', atoms)).toThrow('第 2 行第 14 列')
  })
  it.each(['===', '=='])('keeps %s strict in the real child interpreter, never saves a type-mismatched trial', async op => {
    const { service, store } = setup()
    const candidate = `let r = await atom("dst.find_nearest_entity", {}); assert(r.targetId ${op} "42", "type mismatch");`
    expect(() => compileSkillSource(candidate, atoms)).not.toThrow()
    const result = await service.tryLearnSource({ ...input, sourceCode: candidate }, atoms, happy, signal())
    expect(result.result.error).toContain('type mismatch')
    expect(result.result.trace).toHaveLength(1)
    expect(store.list(input.gameId)).toEqual([])
  })
  it.each(['!==', '!='])('runs %s as strict inequality through persistence and restart', async op => {
    const { service, config } = setup()
    const candidate = `let r = await atom("dst.find_nearest_entity", {}); assert(r.targetId ${op} "42"); return "literal === !==";`
    const result = await service.tryLearnSource({ ...input, acceptance: undefined, sourceCode: candidate }, atoms, happy, signal())
    expect(result.result.success).toBe(true)
    expect(result.result.value).toBe('literal === !==')
    const restarted = new SkillService(new SkillStore(config))
    expect((await restarted.run(input.gameId, input.skillId, atoms, happy, signal())).success).toBe(true)
  })
  it('requires actual successful execution and acceptance before saving new syntax', async () => {
    const { service, store, config } = setup()
    const executor = vi.fn(happy)
    const result = await service.tryLearnSource(input, atoms, executor, signal())
    expect(result.result.success).toBe(true)
    expect(executor.mock.calls.map(call => call[0])).toEqual([...atoms])
    expect(result.result.trace[2]?.arguments).toMatchObject({ x: 8, z: 9 })
    expect(store.get(input.gameId, input.skillId)?.verified).toBe(true)
    expect((await new SkillService(new SkillStore(config)).run(input.gameId, input.skillId, atoms, happy, signal())).success).toBe(true)
  })
  it.each([
    'assert(1 ==== 1);', 'assert(1 !=== 1);', 'while (true) {}',
    'await atom("dst.erase_save", {});', 'assert(params.constructor === 1);',
    'repeat(11) { await atom("dst.find_nearest_entity", {}); }',
  ])('continues to reject unsafe/unsupported source: %s', fragment => {
    expect(() => compileSkillSource(`await atom("dst.find_nearest_entity", {}); ${fragment}`, atoms)).toThrow()
  })
})

describe('real registered tool -> compiler -> child -> verifier -> store -> player outcome', () => {
  async function fixture(executor = vi.fn(happy)) {
    const local = setup(), ctx = new Context(), budget = new LearningTurnBudget()
    const prompt = await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
    const fiber = await ctx.plugin(ToolRuntime, { mode: 'native' })
    registerSkillTools(ctx, { adapterId: 'regression', gameId: input.gameId, atoms: [...atoms].map(name => ({ name, description: name, parameters: '{}', returns: '{}' })) }, local.service, executor, budget)
    budget.begin('unscoped', input.acceptance)
    const call = (sourceCode: string) => ctx.tools.execute({ callId: 'regression-call' as never, name: 'xiaotangyuan_skill_learn',
      arguments: { skillId: input.skillId, name: input.name, description: input.description, triggers: '打蝴蝶', sourceCode }, signal: signal() })
    return { ...local, ctx, budget, executor, call, close: async () => { budget.end('unscoped'); await fiber.dispose(); await prompt.dispose() } }
  }
  const legacySyntax = source.replace('===', '==')
  it('does not label an absent learning outcome as a failed trial or invent its cause', () => {
    const reply = learningOutcomeReply()
    expect(reply).not.toMatch(/没有通过完整试跑|未授权|没有清楚授权|已停止|没有找到/)
    expect(reply).toContain('没有确认到学习结果')
  })
  it.each([
    ['compile', 'let found = params;', '代码检查没有通过', 0],
    ['preflight', 'await skill("missing.child", 1, {});', '准备阶段', 0],
    ['verification', legacySyntax.replace('x: atk.x, z: atk.z', 'x: found.x, z: found.z'), '验收', 3],
  ])('carries %s from actual failure through registered output, budget, persisted attempt and speech text', async (stage, candidate, publicText, calls) => {
    const f = await fixture()
    try {
      const result = await f.call(candidate as string)
      expect(result.isError).toBe(false) // tool transport succeeds; the trial can fail
      const outcome = f.budget.outcome('unscoped') as any
      expect(outcome?.success).toBe(false)
      expect(outcome?.failureStage).toBe(stage)
      expect(learningOutcomeReply(outcome)).toContain(publicText)
      expect(JSON.stringify(result)).toContain(stage)
      expect(f.executor).toHaveBeenCalledTimes(calls as number)
      expect(f.store.list(input.gameId)).toEqual([])
      const persisted = JSON.parse(readFileSync(join(f.directory, 'skills-v2.json'), 'utf8'))
      expect(persisted.learningAttempts.at(-1).failureStage).toBe(stage)
      expect(new SkillStore(f.config).listLearningAttempts(input.gameId).at(-1)).toMatchObject({ failureStage: stage })
    } finally { await f.close() }
  })
  it('reports execution failure separately and preserves environmental no-retry behavior', async () => {
    const executor = vi.fn(async () => { throw new Error('目标已经离开') })
    const f = await fixture(executor)
    try {
      const result = await f.call(legacySyntax)
      expect(result.isError).toBe(false)
      expect(f.budget.outcome('unscoped')).toMatchObject({ success: false, failureStage: 'execution' })
      expect(learningOutcomeReply(f.budget.outcome('unscoped'))).toContain('目标')
      const revise = vi.fn()
      await continueLearningRevisions(f.budget, 'unscoped', revise)
      expect(revise).not.toHaveBeenCalled()
      expect(f.executor).toHaveBeenCalledOnce()
    } finally { await f.close() }
  })
  it('labels cancellation before trial separately without touching the game', async () => {
    const { service, store } = setup(), controller = new AbortController(), executor = vi.fn(happy)
    controller.abort(new Error('player stopped'))
    const attempt = await service.tryLearnSource({ ...input, sourceCode: legacySyntax }, atoms, executor, controller.signal)
    expect(attempt.result).toMatchObject({ success: false, failureStage: 'cancelled', trace: [] })
    expect(executor).not.toHaveBeenCalled()
    expect(store.list(input.gameId)).toEqual([])
  })
  it('keeps old working versions when a new program uses stale pickup coordinates', async () => {
    const { service, store } = setup()
    expect((await service.tryLearnSource({ ...input, sourceCode: legacySyntax }, atoms, happy, signal())).result.success).toBe(true)
    const bad = await service.tryLearnSource({ ...input, sourceCode: legacySyntax.replace('x: atk.x, z: atk.z', 'x: found.x, z: found.z') }, atoms, happy, signal())
    expect(bad.result).toMatchObject({ success: false, failureStage: 'verification' })
    expect(store.get(input.gameId, input.skillId)?.version).toBe(1)
  })
})
