import { afterEach, expect, it } from 'vitest'
import { nativeProjectileBridge } from './fixtures/native-projectile-bridge.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SkillService } from '../src/runtime/skills/skill-service.js'
import { registerSkillTools } from '../src/tools/skill-tools.js'

// Opt-in native integration suite: compile ProjectileVisuals.Tests first. This is
// intentionally not a mock executor returning made-up successful receipts.
const dll = process.env.AGH_PROJECTILE_BRIDGE
const nativeIt = dll ? it : it.skip
const children: ReturnType<typeof nativeProjectileBridge>[] = []
afterEach(() => { for (const child of children.splice(0)) child.close() })
function native() {
  const child = nativeProjectileBridge(dll!)
  children.push(child)
  return child
}

nativeIt('summon then chop reaches real native impacts without recall or double spending', async () => {
  const n = native()
  expect((await n.run('summon')).success).toBe(true)
  const oldId = n.calls.find(c => c.atom.endsWith('_create'))!.args.opId
  const chop = await n.run('chop')
  expect(chop.success, chop.message).toBe(true)
  expect(await n.request('evidence')).toEqual({ effects: 8, stamina: 14 })
  expect(await n.request('stardew.projectiles_status', { arguments: { opId: oldId } })).toMatchObject({ state: 'canceled', resources: 0, remaining: 0 })
  const create = n.calls.filter(c => c.atom.endsWith('_create')).at(-1)!
  await n.executor(create.atom, create.args, new AbortController().signal)
  await n.request('tick', { frames: 200 })
  expect(await n.request('evidence')).toEqual({ effects: 8, stamina: 14 })
})
nativeIt('failed target preflight leaves the harmless ring intact and spends nothing', async () => {
  const n = native(); await n.run('summon')
  const oldId = n.calls[0].args.opId
  await n.request('targets', { available: false })
  const chop = await n.run('chop')
  expect(chop.success).toBe(false)
  expect(chop.message).toContain('附近没有')
  expect(await n.request('stardew.projectiles_status', { arguments: { opId: oldId } })).toMatchObject({ state: 'orbit', remaining: 8 })
  expect(await n.request('evidence')).toEqual({ effects: 0, stamina: 15 })
})
nativeIt('stale handoff cannot resurrect a recalled preview or erase a newer group', async () => {
  const n = native(); await n.run('summon'); const oldId = n.calls[0].args.opId
  await n.request('stardew.projectiles_cancel', { arguments: {} })
  await n.request('tick', { frames: 600 }); await n.run('summon')
  const newId = n.calls.filter(c => c.atom.endsWith('_create')).at(-1)!.args.opId
  await expect(n.request('stardew.projectiles_create', { arguments: { opId: crypto.randomUUID(), count: 8, preview: false, resource: 'chop', replacePreviewOpId: oldId } })).rejects.toThrow()
  expect(await n.request('stardew.projectiles_status', { arguments: { opId: newId } })).toMatchObject({ state: 'orbit' })
  expect(await n.request('evidence')).toEqual({ effects: 0, stamina: 15 })
})
nativeIt('handoff preserves original sixty-second expiry', async () => {
  const n = native(); await n.run('summon'); await n.request('tick', { frames: 3540 })
  const chop = await n.run('chop')
  expect(chop.success).toBe(false)
  expect(await n.request('evidence')).toEqual({ effects: 0, stamina: 14 })
})
nativeIt('a real working group cannot be overwritten by another task', async () => {
  const n = native(); const id = crypto.randomUUID()
  await n.request('stardew.projectiles_create', { arguments: { opId: id, count: 8, preview: false, resource: 'chop' } })
  const result = await n.run('fish')
  expect(result.success).toBe(false)
  expect(result.message).toContain('正在执行其他作业')
  expect(n.calls.map(c => c.atom)).toEqual(['stardew.projectiles_status'])
  expect(await n.request('stardew.projectiles_status', { arguments: { opId: id } })).toMatchObject({ state: 'orbit', resource: 'chop' })
  expect(await n.request('evidence')).toEqual({ effects: 0, stamina: 14 })
})
nativeIt('registered skill-tool entry reads native capability metadata and hands off the real preview', async () => {
  const n = native(); const tools: ToolDefinition[] = []
  registerSkillTools({ on: () => undefined, tools: { register: (tool: ToolDefinition) => tools.push(tool) } } as unknown as Context,
    { adapterId: 'test', gameId: 'stardew-valley', atoms: await n.request('hello') },
    { store: { list: () => [] } } as unknown as SkillService, n.executor)
  const tool = tools.find(t => t.name === 'xiaotangyuan_sword_formation')!
  expect(await tool.execute({ mode: 'summon' }, { signal: new AbortController().signal } as never)).toMatchObject({ success: true })
  const timer = setInterval(() => { void n.request('tick', { frames: 3 }).catch(() => undefined) }, 50)
  try {
    expect(await tool.execute({ mode: 'chop' }, { signal: new AbortController().signal } as never)).toMatchObject({ success: true })
    expect(await n.request('evidence')).toEqual({ effects: 8, stamina: 14 })
  } finally { clearInterval(timer) }
}, 15000)
