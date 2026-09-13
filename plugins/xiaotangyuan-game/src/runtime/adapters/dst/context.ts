import { createHash } from 'node:crypto'

export type Data = Record<string, any>
export const object = (value: unknown): Data => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
const array = (value: unknown): Data[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : []
const compact = (value: any): any => Array.isArray(value) ? value.map(compact) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null).map(([key, item]) => [key, compact(item)])) : value
const ratio = (value: unknown): Data | undefined => typeof value === 'number' && Number.isFinite(value) ? { ratio: Math.max(0, Math.min(1, value)) } : undefined
export const DST_GAME_ID = 'dont-starve-together'
export const DST_ADAPTER_ID = 'qimidandapigu.dont-starve-ai-mod'

/** Same save namespace and observation schema as the old bridge. No new sessions on migration. */
export function buildChatContext(state?: Data): Data {
  const context: Data = { roleInstructions: '你是饥荒玩家的小汤圆同伴。用简短自然中文回答；只有技能工具真实返回成功才可声称动作成功。无法确认的攻略请查询资料，不要编造。' }
  if (!state) return context
  const player = object(state.player), world = object(state.world), companion = object(state.chester), inventory = object(player.inventory)
  const saveHash = typeof state.save_id === 'string' && state.save_id.trim()
    ? createHash('sha256').update('dst:' + state.save_id.trim()).digest('hex') : undefined
  const items = [...array(inventory.items).slice(0, 30).map(raw => ({ id: raw.prefab, name: raw.name, count: raw.stack })),
    ...array(inventory.equipped).slice(0, 10).map(raw => ({ id: raw.prefab, name: raw.name, count: raw.stack, equipped: true, slot: raw.slot }))]
  if (inventory.active && typeof inventory.active === 'object') items.unshift({ id: inventory.active.prefab, name: inventory.active.name, count: inventory.active.stack, equipped: true, slot: 'active' } as any)
  const nearby = array(state.nearby).map(raw => ({ id: raw.prefab, kind: 'entity', name: raw.name ?? raw.prefab, distance: raw.distance }))
    .sort((a, b) => (typeof a.distance === 'number' ? a.distance : Infinity) - (typeof b.distance === 'number' ? b.distance : Infinity)).slice(0, 30)
  context.observation = compact({
    schema: 'ai-native.game-context.v1',
    meta: { gameId: DST_GAME_ID, adapterId: DST_ADAPTER_ID, capturedAt: new Date(typeof state.captured_at_unix === 'number' ? state.captured_at_unix * 1000 : Date.now()).toISOString(), saveScope: saveHash ? `sha256:${saveHash}` : undefined, locale: 'zh-CN' },
    scene: { clock: { day: typeof world.cycles === 'number' ? Math.trunc(world.cycles) + 1 : undefined, phase: world.phase, season: world.season },
      weather: { raining: world.is_raining, snowing: world.is_snowing, temperature: world.temperature, temperatureUnit: 'game' } },
    player: { id: player.prefab ?? 'local-player', name: player.name, position: { space: 'world', ...object(player.position) },
      vitals: { health: ratio(player.health_percent), hunger: ratio(player.hunger_percent), sanity: ratio(player.sanity_percent), moisture: ratio(player.moisture_percent), temperature: { current: player.temperature, unit: 'game' } }, inventory: { items: items.slice(0, 40) } },
    companion: { id: 'xiaotangyuan', present: companion.present === true, distance: companion.distance,
      position: { space: 'world', ...object(companion.position) }, vitals: { health: ratio(companion.health_percent) }, state: [companion.is_dead ? 'dead' : 'following'] },
    entities: nearby, objectives: [], ui: {}, extensions: { dst: { gameTimeSeconds: state.game_time_seconds,
      remainingDaysInSeason: world.remaining_days_in_season, moonPhase: world.moon_phase, fullMoon: world.is_full_moon,
      companionVariant: companion.variant, companionContainerSlots: companion.container_slots, companionContainerOccupied: companion.container_occupied } },
  })
  if (saveHash) context.saveId = saveHash
  if (typeof player.name === 'string' && player.name.trim()) context.playerName = player.name.trim()
  context.date = [typeof world.cycles === 'number' ? `Day ${Math.trunc(world.cycles) + 1}` : undefined, world.season].filter(Boolean).join(', ')
  if (world.phase) context.time = world.phase
  context.nearbyNpc = array(state.nearby).slice(0, 5).map(raw => raw.name ?? raw.prefab).filter(Boolean).join(', ')
  return context
}

export const DST_ATOMS = [
  { name: 'dst.inspect_player', description: '只读查询玩家生命饥饿、随身物品、季节、指定配方材料及本次登录最近死亡事件；鬼魂也可查询', parameters: '{recipe?:string}', returns: '{items:object[],health:number,hunger:number,season:string,remainingDays:number,phase:string,ingredients:object[],recipeAvailable:boolean,lastDeath?:object}' },
  { name: 'dst.inspect_companion', description: '读取同伴实际位置、容器内按物品单位计数和当前攻击玩家或同伴的附近实体；不代表所有潜在危险', parameters: '{}', returns: '{x:number,z:number,items:Record<string,number>,health:number,threats:number[],capturedAt:number}' },
  { name: 'dst.move_to', description: '有限时长移动到玩家附近坐标；默认遇攻击者停止；stopOnThreat=false 仅用于明确的撤回移动；成功仅代表实际到达，可取消', parameters: '{x:number,z:number,stopOnThreat?:boolean}', returns: '{x:number,z:number,items:Record<string,number>,health:number,threats:number[]}' },
  { name: 'dst.pick_target', description: '使用原生采摘接口采摘近处可采植物；产物仍在地上，必须另行拾取并核对容器数量', parameters: '{targetId:number}', returns: '{targetId:number,picked:boolean,x:number,z:number}' },
  { name: 'dst.find_nearest_entity', description: '在玩家附近按类型寻找实体，排除死亡实体；pickable=true 时只找可采植物；不移动不攻击', parameters: '{prefab:string 或 prefabs:string[], radius?:2到25,pickable?:boolean}', returns: '{targetId:number,prefab:string,x:number,z:number}' },
  { name: 'dst.attack_target', description: '有限追击后攻击一次，返回实际死亡状态；不攻击玩家或同伴', parameters: '{targetId:number}', returns: '{targetId:number,defeated:boolean,x:number,z:number}' },
  { name: 'dst.collect_items', description: '拾取指定地面物品放入小汤圆容器；可排除实体', parameters: '{prefab:string 或 prefabs:string[],x:number,z:number,radius?:1到8,excludeIds?:number[]}', returns: '{count:number,items:string[]}' },
]
