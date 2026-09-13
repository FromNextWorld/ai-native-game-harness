type Sample = { available: true; worldId: number; cycle: number; oxygenKg: number; foodKcal: number; population: number; visibleCells: number; capturedAt: string }
export class ColonyTrends {
  private samples = new Map<string, Sample[]>()
  inspect(raw: string, saveId: string, now = Date.now()): { success: boolean; reply: string } {
    let s: Sample
    try { s = JSON.parse(raw) } catch { return { success: false, reply: '基地检查数据格式错误。' } }
    if (!s || s.available !== true || !['worldId', 'cycle', 'oxygenKg', 'foodKcal', 'population', 'visibleCells'].every(k => typeof (s as any)[k] === 'number' && Number.isFinite((s as any)[k]) && (s as any)[k] >= 0)
      || !Number.isFinite(Date.parse(s.capturedAt)) || Math.abs(now - Date.parse(s.capturedAt)) > 15000)
      return { success: false, reply: '基地数据不完整或已过期，请重新检查。' }
    const key = `${saveId}:${s.worldId}`
    let history = this.samples.get(key) ?? []
    const last = history.at(-1)
    if (last && (s.cycle < last.cycle || s.visibleCells !== last.visibleCells || s.population !== last.population)) history = []
    if (!last || s.cycle !== last.cycle || !history.length) history.push(s)
    history = history.filter(v => s.cycle - v.cycle <= 2).slice(-60)
    this.samples.set(key, history)
    if (this.samples.size > 8) this.samples.delete(this.samples.keys().next().value!)
    const lines = [`当前世界 ${s.worldId}：${s.population} 名复制人，可见区域氧气 ${s.oxygenKg.toFixed(1)}kg，食物总量 ${s.foodKcal.toFixed(0)}kcal。`]
    const first = history[0]!
    const elapsed = s.cycle - first.cycle
    if (elapsed < 0.1) lines.push('样本跨度不足 0.1 周期，暂不预测耗尽时间；游戏推进后再次检查。')
    else for (const [field, title, unit] of [['oxygenKg', '氧气', 'kg'], ['foodKcal', '食物', 'kcal']] as const) {
      const rate = (s[field] - first[field]) / elapsed
      lines.push(`${title}最近净变化 ${rate.toFixed(1)}${unit}/周期。${rate < -0.01 ? `若趋势不变，约 ${(s[field] / -rate).toFixed(1)} 周期耗尽；优先检查${field === 'oxygenKg' ? '制氧设备、水源和供电' : '食物生产、存储和腐败'}。` : '当前未测到持续净减少，不代表未来一定足够。'}`)
    }
    lines.push('这是库存净变化估计，不是精确生产/消耗分账；氧气未校验可达性，食物未扣除饮食限制或即将腐败部分。不会自动修改基地。')
    return { success: true, reply: lines.join('\n') }
  }
}
