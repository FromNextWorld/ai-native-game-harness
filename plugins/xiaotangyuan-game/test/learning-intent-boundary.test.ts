import { describe, expect, it, vi } from 'vitest'
import { LearningIntentBoundary, parseLearningDecision, classifyLearningIntent } from '../src/runtime/agent/learning-intent-boundary.js'
import { registerSwordFormationTools } from '../src/tools/sword-formation-tools.js'

function fixture(decision: any = { kind: 'execute', tool: 'xiaotangyuan_sword_formation' }) {
  const handlers: Record<string, any> = {}, registered: any[] = []
  const atom = vi.fn(async (_name, args) => ({ opId: args.opId, state: 'orbit', preview: true, count: args.count, remaining: args.count, hits: 0, damage: 0, kills: 0, reason: '' }))
  const ctx = { on: (name: string, f: any) => { handlers[name] = f }, logger: { warn: vi.fn() },
    tools: { register: (t: any) => registered.push(t), schemas: () => [] },
  }
  registerSwordFormationTools(ctx as never, 'stardew-valley', new Set(['create', 'formation', 'launch', 'status', 'cancel'].map(n => `stardew.projectiles_${n}`)), atom)
  registered.push({ name: 'xiaotangyuan_skill_learn' }, { name: 'game_learning_skill_learn' })
  const classify = vi.fn(async () => decision)
  const gate = new LearningIntentBoundary(classify)
  gate.install(ctx as never, { provider: 'test', model: 'test' })
  const trial = vi.fn(async () => ({ kind: 'allow' }))
  const signal = new AbortController()
  const pre = async (name = 'xiaotangyuan_skill_learn', id = 'save-a') => {
    await request(id)
    return handlers['tools/pre-execute']({ name, agent: { session: { id } }, signal: signal.signal }, trial)
  }
  const request = async (id = 'save-a') => {
    const tools = registered.map(({ name, description, parameters }) => ({ name, description, parameters }))
    const assembly = await handlers['system-prompt/assemble']({}, { agent: { session: { id } } }, async () => ({ tools, sections: [{ name: 'old', text: 'old failed learning conversation' }] }))
    return { ...assembly, system: assembly.sections.map((s: any) => s.text).join('\n') }
  }
  return { ctx, gate, classify, trial, pre, request, atom, registered, signal }
}

describe('current-turn learning boundary', () => {
  it('blocks the real regression before any trial and permits the dedicated summon afterwards', async () => {
    const f = fixture(); f.gate.begin('save-a', '释放万剑归宗。')
    expect((await f.request()).tools.map((t: any) => t.name)).not.toContain('game_learning_skill_learn')
    const result = await f.pre()
    expect(result).toMatchObject({ kind: 'deny' })
    expect(result.reason).toContain('xiaotangyuan_sword_formation')
    expect(f.trial).not.toHaveBeenCalled()
    expect(f.atom).not.toHaveBeenCalled()
    const after = await f.request()
    expect(after.tools.some((t: any) => t.name.endsWith('skill_learn'))).toBe(false)
    expect(after.system).toContain('不是“没学会”')
    expect(await f.pre('xiaotangyuan_sword_formation')).toEqual({ kind: 'allow' })
    const summoned = await f.registered.find(t => t.name === 'xiaotangyuan_sword_formation').execute({ mode: 'summon' }, { signal: f.signal.signal })
    expect(summoned.success).toBe(true)
    expect(f.atom).toHaveBeenCalledTimes(1)
    expect(f.atom.mock.calls[0]?.[0]).toBe('stardew.projectiles_create')
    expect(f.classify).toHaveBeenCalledTimes(1)
  })
  it('covers the alternate global learning entry and caches the verdict across repeated calls', async () => {
    const f = fixture(); f.gate.begin('save-a', '召唤崽崽')
    for (const n of ['game_learning_skill_learn', 'xiaotangyuan_skill_learn', 'game_learning_skill_learn']) expect((await f.pre(n)).kind).toBe('deny')
    expect(f.trial).not.toHaveBeenCalled(); expect(f.classify).toHaveBeenCalledTimes(1)
  })
  it('adds no classifier call for ordinary dialogue, summon, recall, watering or Work', async () => {
    const f = fixture(); f.gate.begin('save-a', '帮我浇水')
    await f.request()
    for (const tool of ['xiaotangyuan_sword_formation', 'xiaotangyuan_sword_formation_stop', 'xiaotangyuan_grandpa_water', 'work_status']) await f.pre(tool)
    expect(f.classify).not.toHaveBeenCalled()
  })
  it('allows explicitly requested new learning and its bounded revisions without reclassifying', async () => {
    const f = fixture({ kind: 'learn' }); f.gate.begin('save-a', '学习一个新的组合技能')
    for (let i = 0; i < 3; i++) expect((await f.pre()).kind).toBe('allow')
    expect(f.classify).toHaveBeenCalledTimes(1); expect(f.trial).toHaveBeenCalledTimes(3)
  })
  it('keeps old attempts and unrelated saves out of the classifier, resets after each player request', async () => {
    const f = fixture({ kind: 'clarify' }); f.gate.begin('save-a', '规中。')
    expect((await f.pre()).reason).toContain('语音不完整')
    expect(f.classify.mock.calls[0]?.[2]).toBe('规中。')
    expect(JSON.stringify(f.classify.mock.calls[0]?.[3])).not.toContain('old failed')
    f.gate.end('save-a'); f.gate.begin('save-b', '不需要学，解释一下')
    expect((await f.pre('xiaotangyuan_skill_learn', 'save-a')).kind).toBe('deny')
    expect((await f.pre('xiaotangyuan_skill_learn', 'save-b')).kind).toBe('deny')
    expect(f.classify).toHaveBeenCalledTimes(2)
  })
  it('does not permit composition or a missing active player request to start learning', async () => {
    const f = fixture({ kind: 'learn' })
    expect((await f.pre()).kind).toBe('deny')
    f.gate.begin('save-a', '角色开场台词', true)
    expect((await f.pre()).kind).toBe('deny')
    expect(f.classify).not.toHaveBeenCalled()
  })
  it('fails closed on provider errors instead of trialling source', async () => {
    const f = fixture(); f.classify.mockRejectedValue(new Error('provider unavailable'))
    f.gate.begin('save-a', '万剑归宗'); expect((await f.pre()).kind).toBe('deny')
    expect(f.trial).not.toHaveBeenCalled(); expect(f.ctx.logger.warn).toHaveBeenCalledOnce()
  })
  it('rejects late classifier results after turn ownership changed', async () => {
    const f = fixture(); let done!: (v: any) => void
    f.classify.mockImplementation(() => new Promise(resolve => { done = resolve }))
    f.gate.begin('save-a', '学技能'); const pending = f.pre()
    await vi.waitFor(() => expect(done).toBeTypeOf('function'))
    f.gate.end('save-a'); f.gate.begin('save-a', '不要学')
    done({ kind: 'learn' }); expect((await pending).kind).toBe('deny'); expect(f.trial).not.toHaveBeenCalled()
  })
  it('rejects canceled requests even if the classifier returned learn', async () => {
    const f = fixture({ kind: 'learn' }); f.gate.begin('save-a', '学技能'); f.signal.abort()
    await expect(f.pre()).rejects.toThrow(); expect(f.trial).not.toHaveBeenCalled()
  })
  it('validates decisions against actual exposed tools and never accepts learning as execute', () => {
    const catalog = [{ name: 'xiaotangyuan_sword_formation' }] as never
    expect(parseLearningDecision('{"kind":"execute","tool":"xiaotangyuan_sword_formation"}', catalog).kind).toBe('execute')
    for (const s of ['{}', 'not json', '{"kind":"execute","tool":"invented"}', '{"kind":"execute","tool":"xiaotangyuan_skill_learn"}']) expect(() => parseLearningDecision(s, catalog)).toThrow()
  })
  it('uses current text and catalog only, with bounded non-thinking classification', async () => {
    const stream = vi.fn(async function* () { yield { type: 'text-delta', text: '{"kind":"clarify"}' } })
    await classifyLearningIntent({ llm: { stream } } as never, { provider: 'test', model: 'test', reasoningEffort: 'off' as never }, '为什么没学会', [], new AbortController().signal)
    const input = stream.mock.calls[0]?.[0] as any
    expect(input.reasoningEffort).toBe('off'); expect(input.maxTokens).toBe(160)
    expect(input.messages).toHaveLength(1)
    expect(JSON.parse(input.messages[0].content[0].text)).toEqual({ playerText: '为什么没学会', tools: [] })
  })
  it('propagates terminal provider failures instead of replacing the cause with a JSON parse error', async () => {
    const stream = async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'provider quota exhausted' } } } }
    await expect(classifyLearningIntent({ llm: { stream } } as never, { provider: 'test', model: 'test' }, '学一下', [], new AbortController().signal)).rejects.toMatchObject({ code: 'RATE_LIMIT', message: 'provider quota exhausted' })
  })
})
