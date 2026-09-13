import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GameAtomExecutor, SkillValue } from '../src/runtime/skills/contracts.js'
import { PROJECTILE_ATOMS, runSwordFormation } from '../src/runtime/tasks/sword-formation.js'
import { registerSwordFormationTools } from '../src/tools/sword-formation-tools.js'
import { registerSkillTools } from '../src/tools/skill-tools.js'
import type { SkillService } from '../src/runtime/skills/skill-service.js'
import { reportRuntimeError } from '../src/runtime/error-diagnostics.js'

vi.mock('../src/runtime/error-diagnostics.js', () => ({ reportRuntimeError: vi.fn(() => ({ errorId: 'test-error-id' })) }))

function mockGame(options: { noDamage?: boolean; stuck?: boolean; invalid?: boolean; lostCreate?: boolean; failCleanup?: boolean; endState?: string } = {}) {
  let id = '', preview = false, count = 0
  const executor = vi.fn<GameAtomExecutor>(async (atom, args) => {
    if (atom.endsWith('_cancel')) { if (options.failCleanup) throw new Error('断开'); return { state: 'canceled', remaining: 0 } }
    if (atom.endsWith('_create')) { id = args.opId as string; preview = args.preview as boolean; count = args.count as number; if (options.lostCreate) throw new Error('回复丢失') }
    const done = atom.endsWith('_status') && !options.stuck
    return { opId: options.invalid ? 'other-operation' : id, preview, count, state: done ? options.endState ?? 'completed' : atom.endsWith('_launch') || options.stuck ? 'launched' : atom.endsWith('_formation') ? 'fan' : 'orbit',
      remaining: done ? 0 : count, hits: done && !preview && !options.noDamage ? 2 : 0, damage: done && !preview && !options.noDamage ? 16 : 0,
      kills: 0, reason: options.endState ? '地图已变化' : '' }
  })
  return executor
}
const noWait = async (_ms: number, _signal: AbortSignal) => {}
const signal = () => new AbortController().signal
describe('sword formation choreography and evidence', () => {
  it('runs orbit -> fan -> launch -> terminal confirmation, not just an ACK', async () => {
    const game = mockGame(), wait = vi.fn(noWait)
    const result = await runSwordFormation('cast', 8, game, signal(), wait)
    expect(result).toMatchObject({ success: true, hits: 2, damage: 16, kills: 0 })
    expect(game.mock.calls.map(c => c[0])).toEqual(['stardew.projectiles_create', 'stardew.projectiles_formation', 'stardew.projectiles_launch', 'stardew.projectiles_status'])
    expect(new Set(game.mock.calls.map(c => c[1].opId)).size).toBe(1)
    expect(wait.mock.calls.map(c => c[0])).toEqual([900, 600, 200])
  })
  it('preview explicitly requests no damage and does not claim combat success', async () => {
    const game = mockGame()
    const result = await runSwordFormation('preview', 12, game, signal(), noWait)
    expect(game.mock.calls[0]?.[1]).toMatchObject({ preview: true, count: 12 })
    expect(result).toMatchObject({ success: true, preview: true, damage: 0 })
    expect(result.message).toContain('未造成游戏伤害')
  })
  it('rejects completed animation without verified health loss', async () => {
    const r = await runSwordFormation('cast', 8, mockGame({ noDamage: true }), signal(), noWait)
    expect(r.success).toBe(false); expect(r.message).toContain('没有核实到有效伤害')
  })
  it('cancels by preallocated operation ID after lost create response', async () => {
    const game = mockGame({ lostCreate: true })
    const r = await runSwordFormation('cast', 8, game, signal(), noWait)
    expect(r.success).toBe(false)
    expect(game.mock.calls[1]?.[0]).toBe('stardew.projectiles_cancel')
    expect(game.mock.calls[1]?.[1].opId).toBe(game.mock.calls[0]?.[1].opId)
  })
  it('wrong operation evidence fails closed and cleans up', async () => {
    const game = mockGame({ invalid: true })
    expect((await runSwordFormation('cast', 8, game, signal(), noWait)).success).toBe(false)
    expect(game.mock.calls.at(-1)?.[0]).toBe('stardew.projectiles_cancel')
  })
  it('treats warp cancellation as cancellation, never success', async () => {
    const result = await runSwordFormation('cast', 8, mockGame({ endState: 'canceled' }), signal(), noWait)
    expect(result.success).toBe(false); expect(result.message).toContain('地图已变化')
  })
  it('aborting during charge starts only a cleanup call, never launch', async () => {
    const controller = new AbortController(), game = mockGame()
    await runSwordFormation('cast', 8, game, controller.signal, async () => { controller.abort(new Error('玩家停止')) })
    expect(game.mock.calls.map(c => c[0])).toEqual(['stardew.projectiles_create', 'stardew.projectiles_cancel'])
    expect(game.mock.calls.at(-1)?.[2].aborted).toBe(false)
  })
  it('bounds stuck status polling and attempts cleanup', async () => {
    const game = mockGame()
    const base = game.getMockImplementation()!
    game.mockImplementation(async (...args) => {
      const result = await base(...args) as Record<string, SkillValue>
      if (args[0].endsWith('_status')) { result.state = 'launched'; result.remaining = 8 }
      return result
    })
    expect((await runSwordFormation('cast', 8, game, signal(), noWait)).success).toBe(false)
    expect(game.mock.calls.filter(c => c[0].endsWith('_status'))).toHaveLength(30)
    expect(game.mock.calls.at(-1)?.[0]).toBe('stardew.projectiles_cancel')
  })
  it('reports missing cleanup confirmation instead of claiming stopped', async () => {
    const r = await runSwordFormation('cast', 8, mockGame({ lostCreate: true, failCleanup: true }), signal(), noWait)
    expect(r.message).toContain('未收到收回确认')
    expect(r.message).toContain('60 秒')
  })
  it.each([0, 13, 1.5, NaN, Infinity])('rejects unsafe count %s before calling the game', async count => {
    const game = mockGame()
    await expect(runSwordFormation('cast', count, game, signal(), noWait)).rejects.toThrow()
    expect(game).not.toHaveBeenCalled()
  })
  it('does nothing with an already aborted signal', async () => {
    const game = mockGame()
    await expect(runSwordFormation('cast', 8, game, AbortSignal.abort(), noWait)).rejects.toThrow()
    expect(game).not.toHaveBeenCalled()
  })
  it('rejects preview evidence reporting damage', async () => {
    const game = mockGame(), base = game.getMockImplementation()!
    game.mockImplementation(async (...args) => ({ ...await base(...args) as object, damage: 8 }))
    expect((await runSwordFormation('preview', 8, game, signal(), noWait)).success).toBe(false)
  })
})
describe('voice summon handoff', () => {
  it.each(['chop', 'fish', 'water'] as const)('requires resource evidence for %s', async mode => {
    const game = mockGame(), base = game.getMockImplementation()!
    game.mockImplementation(async (...args) => ({ ...await base(...args) as object, resource: mode, resources: 2 }))
    const result = await runSwordFormation(mode, 8, game, signal(), noWait)
    expect(result.success).toBe(true)
    expect(game.mock.calls[0]![1]).toMatchObject({ resource: mode, preview: false })
    const missing = await runSwordFormation(mode, 8, mockGame(), signal(), noWait)
    expect(missing.success).toBe(false)
  })
  it('returns immediately after harmless creation without launch, polling or cleanup', async () => {
    const game = mockGame(), wait = vi.fn(noWait)
    const result = await runSwordFormation('summon', 8, game, signal(), wait)
    expect(result.success).toBe(true)
    expect(result.preview).toBe(true)
    expect(result.message).toContain('60 秒')
    expect(result.message).toContain('收回剑阵')
    expect(game.mock.calls.map(call => call[0])).toEqual(['stardew.projectiles_create'])
    expect(wait).not.toHaveBeenCalled()
  })
  it('still cancels a summon if its creation reply is lost', async () => {
    const game = mockGame({ lostCreate: true })
    expect((await runSwordFormation('summon', 8, game, signal(), noWait)).success).toBe(false)
    expect(game.mock.calls.at(-1)?.[0]).toBe('stardew.projectiles_cancel')
  })
})
describe('sword formation tool registration', () => {
  function setup(gameId: string, atoms: string[]) {
    const tools: ToolDefinition[] = [], executor = mockGame()
    registerSwordFormationTools({ tools: { register: (t: ToolDefinition) => tools.push(t) } } as unknown as Context, gameId, new Set(atoms), executor)
    return { tools, executor }
  }
  it('requires all native atoms on the correct game', () => {
    expect(setup('stardew-valley', PROJECTILE_ATOMS.slice(1)).tools).toHaveLength(0)
    expect(setup('dont-starve-together', PROJECTILE_ATOMS).tools).toHaveLength(0)
    expect(setup('stardew-valley', PROJECTILE_ATOMS).tools.map(t => t.name)).toEqual(['xiaotangyuan_sword_formation', 'xiaotangyuan_sword_formation_stop', 'xiaotangyuan_grandpa_water'])
  })
  it('stop checks that the game confirms no active projectiles', async () => {
    const s = setup('stardew-valley', PROJECTILE_ATOMS)
    const result = await s.tools[1]!.execute({}, { signal: signal() } as never) as { message: string }
    expect(result.message).toContain('已确认')
    s.executor.mockResolvedValueOnce({ state: 'launched', remaining: 2 })
    await expect(s.tools[1]!.execute({}, { signal: signal() } as never)).rejects.toThrow('未收到停止确认')
  })
})

describe('game session skill entrypoint integration', () => {
  function setup(atoms = PROJECTILE_ATOMS) {
    const tools: ToolDefinition[] = [], executor = mockGame()
    const skills = { store: { list: () => [] }, tryLearnSource: vi.fn() } as unknown as SkillService
    registerSkillTools({ on: vi.fn(), tools: { register: (t: ToolDefinition) => tools.push(t) } } as unknown as Context,
      { gameId: 'stardew-valley', adapterId: 'test', capabilities: atoms }, skills, executor)
    return { tools, executor, skills }
  }
  it('registers and executes existing summon even when no learned skills exist', async () => {
    const s = setup()
    const sword = s.tools.find(t => t.name === 'xiaotangyuan_sword_formation')!
    expect(sword).toBeDefined()
    expect(s.tools.find(t => t.name === 'xiaotangyuan_skill_run')!.description).not.toContain('必须先通过学习')
    const result = await sword.execute({ mode: 'summon' }, { signal: signal() } as never)
    expect(result).toMatchObject({ success: true, preview: true, damage: 0 })
    expect(s.executor.mock.calls.map(c => c[0])).toEqual(['stardew.projectiles_create'])
    expect(s.skills.tryLearnSource).not.toHaveBeenCalled()
  })
  it('does not advertise sword tools if native adapter is missing an atom', () => {
    expect(setup(PROJECTILE_ATOMS.slice(1)).tools.some(t => t.name === 'xiaotangyuan_sword_formation')).toBe(false)
  })
  it('logs underlying execution and missing cleanup receipt failures', async () => {
    const game = mockGame({ lostCreate: true })
    const base = game.getMockImplementation()!
    game.mockImplementation(async (...args) => args[0].endsWith('_cancel') ? { state: 'launched', remaining: 8 } : base(...args))
    const r = await runSwordFormation('summon', 8, game, signal(), noWait)
    expect(r.message).toContain('错误编号')
    expect(r.message).toContain('未收到收回确认')
    expect(reportRuntimeError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ stage: 'game.sword-formation.cleanup' }))
  })
})
