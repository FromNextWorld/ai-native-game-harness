import type { GameAtomExecutor, SkillValue } from '../skills/contracts.js'

export interface GatherRequest { plantPrefab: string; itemPrefab: string; quantity: number }
export interface GatherResult { success: boolean; acquired: number; returned: boolean; message: string }
type Evidence = { x: number; z: number; health: number; threats: unknown[]; items: Record<string, number> }
function evidence(raw: unknown): Evidence {
  const value = raw as Evidence | undefined
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.z) || !Number.isFinite(value.health)
    || value.health < 0 || value.health > 1 || !Array.isArray(value.threats) || !value.items || typeof value.items !== 'object')
    throw new Error('游戏没有返回完整的同伴状态，已停止采集')
  for (const n of Object.values(value.items)) if (!Number.isSafeInteger(n) || n < 0) throw new Error('容器数量无效，已停止采集')
  return value
}

/** Task policy above generic Mod atoms. Never counts a pick or a promise as acquired inventory. */
export async function gatherResources(request: GatherRequest, executor: GameAtomExecutor, signal: AbortSignal): Promise<GatherResult> {
  if (![request.plantPrefab, request.itemPrefab].every(s => typeof s === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(s))
    || !Number.isInteger(request.quantity) || request.quantity < 1 || request.quantity > 50) throw new Error('采集类型或数量无效；一次支持 1 到 50 个')
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(240_000)])
  const call = async (name: string, args: Record<string, SkillValue> = {}) => { bounded.throwIfAborted(); return executor(name, args, bounded) }
  const start = evidence(await call('dst.inspect_companion'))
  const baseline = start.items[request.itemPrefab] ?? 0
  let acquired = 0, reason = '', returned = false
  try {
    for (let attempt = 0; attempt < 50 && acquired < request.quantity; attempt++) {
      const before = evidence(await call('dst.inspect_companion'))
      if (before.threats.length || before.health < Math.max(0.5, start.health - 0.05)) throw new Error('发现攻击者或同伴掉血，停止采集')
      const target = await call('dst.find_nearest_entity', { prefab: request.plantPrefab, radius: 25, pickable: true }) as Record<string, SkillValue>
      if (!target || typeof target.targetId !== 'number' || !Number.isSafeInteger(target.targetId) || target.targetId <= 0 || typeof target.x !== 'number' || !Number.isFinite(target.x)
        || typeof target.z !== 'number' || !Number.isFinite(target.z)) throw new Error('没有可验证的采集目标')
      const arrived = evidence(await call('dst.move_to', { x: target.x, z: target.z, stopOnThreat: true }))
      if (arrived.threats.length || arrived.health < Math.max(0.5, start.health - 0.05)) throw new Error('途中出现危险，停止采集')
      const picked = await call('dst.pick_target', { targetId: target.targetId }) as Record<string, SkillValue>
      if (!picked || picked.picked !== true || picked.targetId !== target.targetId) throw new Error('采摘没有成功')
      await call('dst.collect_items', { prefab: request.itemPrefab, x: target.x, z: target.z, radius: 2, stopOnThreat: true })
      const after = evidence(await call('dst.inspect_companion'))
      const count = Math.max(0, (after.items[request.itemPrefab] ?? 0) - baseline)
      if (count <= acquired) throw new Error('容器内数量没有增加，不会把采摘当作收集完成')
      acquired = count
    }
    if (acquired < request.quantity) reason = '达到本次采集次数上限'
  } catch (error) { reason = error instanceof Error ? error.message : String(error) }
  // Cancellation means stop immediately: never start a return action with a fresh, uncancelled signal.
  if (!bounded.aborted) {
    try {
      const home = evidence(await call('dst.move_to', { x: start.x, z: start.z, stopOnThreat: false }))
      returned = Math.hypot(home.x - start.x, home.z - start.z) <= 1.5
      acquired = Math.max(0, (home.items[request.itemPrefab] ?? 0) - baseline)
    } catch (error) { reason += `；返回失败：${error instanceof Error ? error.message : String(error)}` }
  }
  const success = acquired >= request.quantity && returned && !reason
  return { success, acquired, returned, message: `已核对新增 ${acquired} 个${request.itemPrefab}；${returned ? '已返回出发位置' : '尚未确认返回'}。${reason || (bounded.aborted ? '操作已停止。' : '')}危险检查仅覆盖附近正在攻击的实体和同伴掉血，不保证识别所有环境危险。` }
}
