type Data = Record<string, any>
const object = (value: unknown): Data => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}

export function keepItemAdvice(raw: unknown, itemName: string): string {
  const facts = object(object(raw).facts)
  const items = Array.isArray(facts.items) ? facts.items : []
  const matches = items.filter(i => i && (i.name === itemName || i.id === itemName || i.rawId === itemName))
  if (!matches.length) return '随身背包没有找到这个物品；请说明准确名称，暂不判断能否卖。'
  const ids = new Set(matches.map(i => i.id))
  if (ids.size !== 1) return '这个名称对应多个不同物品，请指定物品 ID 后再检查。'
  const reasons: string[] = []
  let reserve = 0, incomplete = false
  const progress = object(facts.bundleProgress), bundles = object(facts.bundleData)
  for (const [key, value] of Object.entries(bundles)) {
    if (typeof value !== 'string') { incomplete = true; continue }
    const id = key.split('/').at(-1)!, fields = value.split('/'), tokens = (fields[2] ?? '').trim().split(/\s+/)
    const submitted = progress[id]
    const required = fields[4] ? Number(fields[4]) : tokens.length / 3
    if (!Array.isArray(submitted) || tokens.length % 3 || !Number.isInteger(required) || required < 1
      || submitted.length < tokens.length / 3 || !submitted.every(v => typeof v === 'boolean')) { incomplete = true; continue }
    if (submitted.filter(Boolean).length >= required) continue
    for (let slot = 0; slot < tokens.length / 3; slot++) {
      if (submitted[slot]) continue
      const item = tokens[slot * 3]!, quantity = Number(tokens[slot * 3 + 1]), quality = Number(tokens[slot * 3 + 2])
      if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(quality) || quality < 0) { incomplete = true; continue }
      const usable = matches.some(i => (i.rawId === item || i.id === item || String(i.category) === item) && i.quality >= quality)
      if (usable) { reserve += quantity; reasons.push(`献祭「${fields[0]}」尚有可用项：${quantity} 个，最低品质 ${quality}`) }
    }
  }
  if (Array.isArray(facts.deliveryQuests)) for (const q of facts.deliveryQuests) {
    if (matches.some(i => i.rawId === q.itemId || i.id === q.itemId) && Number.isInteger(q.count) && q.count > 0) {
      reserve += q.count; reasons.push(`交给 ${q.target} 的任务需要 ${q.count} 个`)
    }
  }
  if (!facts.bundleData || !facts.bundleProgress || !Array.isArray(facts.deliveryQuests)) incomplete = true
  return `${itemName}：${reasons.length ? reasons.join('；') + `。保守按这些用途预留 ${reserve} 个（可选献祭可以另选材料）。` : '当前已读取的献祭和普通交物任务没有发现需保留项。'}${incomplete ? '部分数据缺失或格式无法识别，不能据此判定可卖。' : ''}未覆盖箱子、特别订单、未来配方和礼物需求；不会自动出售。`
}

export function dayAdvice(raw: unknown, mine = false): string {
  const f = object(object(raw).facts)
  if (typeof f.time !== 'number' || typeof f.stamina !== 'number') return '今日状态不完整，请重新读取游戏状态。'
  const lines = [`今天${f.season}季第 ${f.day} 天，时间 ${f.time}，体力 ${f.stamina}，生命 ${f.health}。`]
  if (f.upgradingTool) lines.push(`${f.upgradingTool}正在升级，还剩 ${f.upgradeDaysLeft} 天，出门前确认可用工具。`)
  if (f.stamina < 60 || (typeof f.health === 'number' && f.health < 50)) lines.push('当前身体状态偏低，先补充食物或休息，再考虑下矿。')
  if (f.time >= 1800) lines.push('今天剩余时间较少，优先短任务并预留回家时间。')
  if (mine) {
    if (f.hasPickaxe === false) lines.push('随身没有镐子，先取回再下矿。')
    if (f.hasWeapon === false) lines.push('随身没有读取到近战武器，不建议直接进入有怪物的矿层。')
    if (f.foodCount === 0) lines.push('随身没有读取到正向恢复体力的食物，先准备补给。')
    lines.push('这是基础下矿检查；未验证武器强度、目的矿层和箱内补给。')
    return lines.join('\n')
  }
  if (['Rain', 'Storm', 'rain', 'storm', 'GreenRain'].includes(f.tomorrowWeather)) lines.push('主地区明天有雨；今天浇完后可考虑升级水壶，但还要确认取回当天的浇水安排、铁匠营业及费用。')
  else lines.push('没有确认明天可免浇水，不建议只凭当前天气把水壶送去升级。')
  if (Array.isArray(f.quests)) lines.push(`当前任务：${f.quests.slice(0, 5).map(q => q.title).join('、') || '没有读取到任务'}。`)
  return lines.join('\n')
}

export function npcRouteAdvice(raw: unknown): string {
  const f = object(object(raw).facts)
  if (!Array.isArray(f.matches) || f.matches.length !== 1 || typeof f.location !== 'string') return '没有唯一确认这个 NPC 的当前位置，请核对名称后再找。'
  const npc = f.matches[0]
  if (typeof npc?.location !== 'string') return '角色位置不可用，暂时不能规划路线。'
  const end = `${npc.name}目前在 ${npc.location}，格子 (${npc.x}, ${npc.y})。`
  if (npc.location === f.location) return `${end}已经在同一地图，按这个位置寻找；不代表直线路径没有障碍。`
  const exits = Array.isArray(f.exits) ? f.exits.slice(0, 16000).filter(e => e && typeof e.from === 'string' && typeof e.to === 'string' && Number.isInteger(e.x) && Number.isInteger(e.y)) : []
  const queue: Array<{ location: string; path: Data[] }> = [{ location: f.location, path: [] }]
  const seen = new Set([f.location])
  for (let index = 0; index < queue.length && index < 500; index++) {
    const node = queue[index]!
    for (const edge of exits.filter(e => e.from === node.location)) {
      if (seen.has(edge.to)) continue
      const path = [...node.path, edge]
      if (edge.to === npc.location) return `${end}\n地图路线：${path.map(e => `${e.from} 的 (${e.x}, ${e.y}) ${e.door ? '门口' : '出口'} → ${e.to}`).join('；')}。\n这是出口连接指引，未验证门禁、营业时间和动态障碍；遇锁门应停下，不会自动传送。角色可能移动，到达后可重新查询。`
      seen.add(edge.to); queue.push({ location: edge.to, path })
    }
  }
  return `${end}当前地图数据里没有找到完整连接路线，不能编造带路步骤。`
}
