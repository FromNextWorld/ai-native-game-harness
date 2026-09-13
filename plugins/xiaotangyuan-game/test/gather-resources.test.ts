import { describe, expect, it } from 'vitest'
import { gatherResources } from '../src/runtime/tasks/gather-resources.js'
import type { GameAtomExecutor } from '../src/runtime/skills/contracts.js'

const request = { plantPrefab: 'grass', itemPrefab: 'cutgrass', quantity: 20 }
function fixture(options: { noGain?: boolean; danger?: boolean; returnFails?: boolean; cancelOnPick?: boolean; missing?: boolean } = {}) {
  let count = 7, picks = 0
  const controller = new AbortController()
  const calls: string[] = []
  const state = () => ({ x: 0, z: 0, health: 1, items: { cutgrass: count }, threats: options.danger ? [100] : [] })
  const executor: GameAtomExecutor = async (atom, args, signal) => {
    signal.throwIfAborted(); calls.push(atom)
    if (atom === 'dst.inspect_companion') return state()
    if (atom === 'dst.find_nearest_entity') { if (options.missing) throw new Error('附近没有符合条件的实体'); return { targetId: 3, x: 1, z: 1 } }
    if (atom === 'dst.move_to') { if (args.stopOnThreat === false && options.returnFails) throw new Error('路不通'); return state() }
    if (atom === 'dst.pick_target') { picks++; if (options.cancelOnPick) controller.abort(new Error('玩家取消')); return { targetId: 3, picked: true } }
    if (atom === 'dst.collect_items') { if (!options.noGain) count++; return { count: 1 } }
    throw new Error('unexpected atom')
  }
  return { executor, controller, calls, picks: () => picks }
}
describe('bounded resource gathering', () => {
  it('collects 20 NEW units, excluding inventory already carried', async () => {
    const f = fixture()
    expect(await gatherResources(request, f.executor, f.controller.signal)).toMatchObject({ success: true, acquired: 20, returned: true })
    expect(f.picks()).toBe(20)
  })
  it('stops when a successful-looking pickup did not change inventory', async () => {
    const f = fixture({ noGain: true })
    expect(await gatherResources(request, f.executor, f.controller.signal)).toMatchObject({ success: false, acquired: 0, returned: true })
    expect(f.picks()).toBe(1)
  })
  it('does not pick while under attack', async () => {
    const f = fixture({ danger: true })
    expect(await gatherResources(request, f.executor, f.controller.signal)).toMatchObject({ success: false, returned: true })
    expect(f.picks()).toBe(0)
  })
  it('never claims a failed return succeeded', async () => {
    const f = fixture({ returnFails: true })
    expect(await gatherResources({ ...request, quantity: 1 }, f.executor, f.controller.signal)).toMatchObject({ success: false, acquired: 1, returned: false })
  })
  it('does not start a return or pickup after cancellation', async () => {
    const f = fixture({ cancelOnPick: true })
    expect(await gatherResources(request, f.executor, f.controller.signal)).toMatchObject({ success: false, returned: false })
    expect(f.calls.at(-1)).toBe('dst.pick_target')
  })
  it('reports missing targets without an unbounded search', async () => {
    const f = fixture({ missing: true })
    expect((await gatherResources(request, f.executor, f.controller.signal)).success).toBe(false)
    expect(f.calls.filter(c => c === 'dst.find_nearest_entity')).toHaveLength(1)
  })
  it('rejects invalid requests before touching the game', async () => {
    const f = fixture()
    for (const quantity of [0, -1, 1.5, 51, NaN]) await expect(gatherResources({ ...request, quantity }, f.executor, f.controller.signal)).rejects.toThrow()
    expect(f.calls).toEqual([])
  })
})
