export function dstAdvice(raw: unknown, kind: string): string {
  const s = raw as Record<string, any> | undefined
  if (!s || !Array.isArray(s.items)) return '没有收到完整的玩家状态，暂不判断。'
  if (kind === 'death') {
    const d = s.lastDeath
    if (!d || typeof d.time !== 'number') return '本次登录没有记录到死亡事件，不能从当前状态猜测上次死因。'
    const attacks = Array.isArray(d.attacks) ? d.attacks : []
    return `游戏记录的最近死因：${d.cause ?? '未知'}，致伤者：${d.afflicter ?? '未记录'}，当时阶段：${d.phase ?? '未知'}。此前两分钟记录 ${attacks.length} 次攻击${attacks.length ? `，最近攻击者 ${attacks.at(-1)?.attacker ?? '未记录'}` : ''}。攻击记录只是此前事件，不一定是最终死因；这是本次登录记录，不含重启前历史。`
  }
  const count = (prefab: string) => s.items.filter((i: any) => i?.prefab === prefab && Number.isFinite(i.count)).reduce((n: number, i: any) => n + i.count, 0)
  const lines: string[] = []
  if (kind === 'recipe') {
    if (s.recipeAvailable !== true || !Array.isArray(s.ingredients)) return '没有找到该配方，可能是名称错误或当前游戏没有加载它。'
    for (const i of s.ingredients) {
      if (typeof i?.prefab !== 'string' || !Number.isFinite(i.count)) continue
      lines.push(`${i.prefab}：需要 ${i.count}，随身 ${count(i.prefab)}，还缺 ${Math.max(0, i.count - count(i.prefab))}。`)
    }
    lines.push('这里只检查材料，不代表科技已解锁或特殊制作条件已满足。')
  } else {
    if (typeof s.health === 'number' && s.health < 0.5) lines.push('生命不足一半，建议先恢复再远行。')
    if (typeof s.hunger === 'number' && s.hunger < 0.3) lines.push('饥饿值较低，先补充食物。')
    const food = s.items.filter((i: any) => typeof i?.hungerValue === 'number' && i.hungerValue > 0)
    if (!food.length) lines.push('随身没有读取到能恢复饥饿的食物；请检查背包容器或补给。')
    if (!s.items.some((i: any) => ['torch', 'lantern', 'minerhat'].includes(i?.prefab) && (i.fuelPercent == null || i.fuelPercent > 0))) lines.push('没有确认可用的常见便携照明；不要在天黑后无准备远行。')
    if (s.season === 'winter' || (s.season === 'autumn' && s.remainingDays <= 3)) {
      lines.push('已入冬或临近冬季，准备取暖点、燃料和食物储备。')
      if (!['winterhat', 'beefalohat', 'trunkvest_winter'].some(p => count(p))) lines.push('随身未发现常见冬季保暖装备，请核对实际装备保暖效果。')
      if (!count('heatrock')) lines.push('未发现暖石，可考虑准备；暖石本身不等于已经加热。')
    }
    if (!lines.length) lines.push('当前基础检查未发现明显缺项；不代表一路安全。')
  }
  lines.push('未检查背包容器、基地箱子、Mod 特殊装备和全部环境危险；不会自动丢弃或消耗物品。')
  return lines.join('\n')
}
