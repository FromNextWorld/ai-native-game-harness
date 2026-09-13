import { afterEach, expect, it } from 'vitest'
import { nativeProjectileBridge } from './fixtures/native-projectile-bridge.js'

const nativeIt = process.env.AGH_PROJECTILE_BRIDGE ? it : it.skip
const children: ReturnType<typeof nativeProjectileBridge>[] = []
afterEach(() => { children.splice(0).forEach(c => c.close()) })
function native(resources = true) { const n = nativeProjectileBridge(process.env.AGH_PROJECTILE_BRIDGE!, resources); children.push(n); return n }

nativeIt('one summoned volley fells eight trees with the boosted budget', async () => {
  const n = native(); await n.request('world', { trees: 8, health: 12 }); await n.run('summon')
  const result = await n.run('chop')
  const evidence = await n.request('world-evidence')
  expect(evidence.felled, JSON.stringify({ result, evidence })).toBe(8)
  expect(evidence).toMatchObject({ touched: 8, hits: 96, stamina: 14, axePower: 1, axeUserRestored: true })
  expect(result.success).toBe(true); expect(result.message).toContain('8 棵')
  const create = n.calls.findLast(c => c.atom.endsWith('_create'))!
  await n.executor(create.atom, create.args, new AbortController().signal)
  await n.request('tick', { frames: 180 })
  expect(await n.request('world-evidence')).toEqual(evidence)
})
nativeIt('protected trees remain untouched and a single available tree is not counted repeatedly', async () => {
  const n = native(); await n.request('world', { trees: 2, protected: true }); await n.run('summon')
  const result = await n.run('chop')
  expect(await n.request('world-evidence')).toMatchObject({ felled: 1, touched: 1, protectedHits: 0, hits: 12 })
  expect(result.message).toContain('1 棵')
})
nativeIt('fishing continues from a summon with eight native rolls, not the chopping burst multiplier', async () => {
  const n = native(); await n.request('world', { trees: 0 }); await n.run('summon')
  const result = await n.run('fish')
  expect(result.success, result.message).toBe(true)
  expect(await n.request('world-evidence')).toMatchObject({ fishRolls: 8, fishDrops: 8, stamina: 14, hits: 0 })
})
nativeIt('combat continues from a summon with forty damage per sword and an eight-hit budget', async () => {
  const n = native(); await n.request('world', { trees: 0 }); await n.run('summon')
  expect(await n.run('cast')).toMatchObject({ success: true, hits: 8, damage: 320, kills: 0 })
  expect(await n.request('world-evidence')).toMatchObject({ stamina: 14, fishRolls: 0, hits: 0 })
})
nativeIt('a high-health modded tree cannot create an unbounded burst or false completed-tree claim', async () => {
  const n = native(); await n.request('world', { trees: 8, health: 1000 }); await n.run('summon')
  const result = await n.run('chop')
  expect(result.success).toBe(false); expect(result.message).toContain('没有树被砍倒')
  expect(await n.request('world-evidence')).toMatchObject({ felled: 0, hits: 192, touched: 8, stamina: 14 })
})
nativeIt('voice recall during the burst immediately prevents all further native impacts', async () => {
  const n = native(); await n.request('world', { trees: 8, health: 1000 })
  const id = crypto.randomUUID()
  await n.request('stardew.projectiles_create', { arguments: { opId: id, count: 8, preview: false, resource: 'chop', impactsPerProjectile: 24, targetLimit: 8 } })
  await n.request('stardew.projectiles_launch', { arguments: { opId: id, spacingMs: 120 } })
  let evidence: any
  for (let frame = 0; frame < 120; frame++) {
    await n.request('tick', { frames: 1 }); evidence = await n.request('world-evidence')
    if (evidence.hits > 0) break
  }
  expect(evidence.hits).toBeGreaterThan(0); expect(evidence.hits).toBeLessThan(192)
  expect(await n.request('stardew.projectiles_cancel', { arguments: {} })).toMatchObject({ state: 'canceled', remaining: 0 })
  await n.request('tick', { frames: 600 })
  expect(await n.request('world-evidence')).toEqual(evidence)
})
nativeIt('no axe preserves the harmless ring and does not spend stamina', async () => {
  const n = native(); await n.request('world', { axe: false }); await n.run('summon')
  const result = await n.run('chop')
  expect(result.success).toBe(false); expect(result.message).toContain('斧头')
  expect(await n.request('stardew.projectiles_status', { arguments: {} })).toMatchObject({ state: 'orbit', preview: true })
  expect(await n.request('world-evidence')).toMatchObject({ hits: 0, felled: 0, stamina: 15 })
})
nativeIt.each([
  { resource: 'fish', impactsPerProjectile: 12, targetLimit: 4 },
  { resource: 'water', impactsPerProjectile: 12, targetLimit: 4 },
  { resource: 'chop', impactsPerProjectile: 25, targetLimit: 8 },
  { resource: 'chop', impactsPerProjectile: 24, targetLimit: 9 },
  { resource: 'fish', fishRollLimit: 9 },
  { resource: 'fish', fishRollLimit: 0 },
  { resource: 'fish', fishRollLimit: 1.5 },
  { resource: 'chop', fishRollLimit: 8 },
  { resource: 'water', fishRollLimit: 8 },
  { resource: 'fish', fishRollLimit: 8, preview: true },
])('native protocol rejects unauthorized or excessive budgets: %j', async budget => {
  const n = native(); await n.request('world')
  await expect(n.request('stardew.projectiles_create', { arguments: { opId: crypto.randomUUID(), count: 8, preview: false, ...budget } })).rejects.toThrow()
  expect(await n.request('world-evidence')).toMatchObject({ hits: 0, felled: 0, fishRolls: 0, stamina: 15 })
})

nativeIt('new native protocol retains three fish rolls when an older caller omits the optional budget', async () => {
  const n = native(); await n.request('world', { trees: 0 })
  const opId = crypto.randomUUID()
  await n.request('stardew.projectiles_create', { arguments: { opId, count: 8, preview: false, resource: 'fish' } })
  await n.request('stardew.projectiles_launch', { arguments: { opId, spacingMs: 120 } })
  await n.request('tick', { frames: 600 })
  expect(await n.request('world-evidence')).toMatchObject({ fishRolls: 3, fishDrops: 3, stamina: 14 })
})

it.runIf(Boolean(process.env.AGH_PROJECTILE_LEGACY_BRIDGE)).each(['chop', 'fish'] as const)('new TS negotiates safe %s budgets with frozen old native implementation', async mode => {
  const n = nativeProjectileBridge(process.env.AGH_PROJECTILE_LEGACY_BRIDGE!, true); children.push(n)
  await n.request('world', { trees: 8, health: 12 }); await n.run('summon')
  expect((await n.run(mode)).success).toBe(true)
  const create = n.calls.findLast(c => c.atom.endsWith('_create'))!
  expect(create.args).not.toHaveProperty('fishRollLimit')
  if (mode === 'chop') {
    expect(create.args).toMatchObject({ impactsPerProjectile: 12, targetLimit: 4 })
    expect(await n.request('world-evidence')).toMatchObject({ felled: 4, hits: 48 })
  } else expect(await n.request('world-evidence')).toMatchObject({ fishRolls: 3, fishDrops: 3 })
})
