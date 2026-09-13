import { describe, expect, it } from 'vitest'
import { ColonyTrends } from '../src/colony-trends.js'
const now = Date.now()
const sample = (extra = {}) => JSON.stringify({ available: true, capturedAt: new Date(now).toISOString(), worldId: 0, cycle: 1, oxygenKg: 100, foodKcal: 10000, population: 3, visibleCells: 100, ...extra })
describe('colony resource trends', () => {
  it('requires elapsed game time rather than duplicate polling', () => {
    const t = new ColonyTrends()
    t.inspect(sample(), 'a', now)
    expect(t.inspect(sample(), 'a', now).reply).toContain('样本跨度不足')
  })
  it('calculates net decrease and conditional exhaustion', () => {
    const t = new ColonyTrends(); t.inspect(sample(), 'a', now)
    const r = t.inspect(sample({ cycle: 1.5, oxygenKg: 90, foodKcal: 9000 }), 'a', now)
    expect(r.reply).toContain('-20.0kg/周期'); expect(r.reply).toContain('约 4.5 周期耗尽')
  })
  it('isolates saves/worlds and resets when coverage or population changes', () => {
    for (const extra of [{ worldId: 1 }, { visibleCells: 120 }, { population: 4 }, { cycle: 0.5 }]) {
      const t = new ColonyTrends(); t.inspect(sample(), 'a', now)
      expect(t.inspect(sample({ cycle: 2, ...extra }), 'a', now).reply).toContain('样本跨度不足')
    }
    const t = new ColonyTrends(); t.inspect(sample(), 'a', now)
    expect(t.inspect(sample({ cycle: 2 }), 'b', now).reply).toContain('样本跨度不足')
  })
  it('rejects malformed, negative and stale quantities', () => {
    const t = new ColonyTrends()
    expect(t.inspect('null', 'a', now).success).toBe(false)
    expect(t.inspect(sample({ oxygenKg: -1 }), 'a', now).success).toBe(false)
    expect(t.inspect(sample(), 'a', now + 20000).success).toBe(false)
  })
})
