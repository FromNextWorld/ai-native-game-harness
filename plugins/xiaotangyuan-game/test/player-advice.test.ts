import { describe, expect, it } from 'vitest'
import { keepItemAdvice, dayAdvice, npcRouteAdvice } from '../src/runtime/tasks/stardew-advice.js'
import { dstAdvice } from '../src/runtime/tasks/dst-advice.js'

const inventory = (extra = {}) => ({ facts: { items: [{ id: '(O)24', rawId: '24', name: '防风草', count: 6, quality: 2, category: -75 }],
  bundleData: { 'Pantry/0': '春季作物/O 465 20/24 1 0 188 1 0/0/2' }, bundleProgress: { '0': [false, false] }, deliveryQuests: [], ...extra } })
describe('game-grounded player advice', () => {
  it('reserves actual unmet bundle requirements', () => { expect(keepItemAdvice(inventory(), '防风草')).toContain('预留 1 个') })
  it('ignores completed optional bundles', () => {
    expect(keepItemAdvice(inventory({ bundleData: { 'Pantry/0': '可选献祭/reward/24 1 0 188 1 0/0/1' }, bundleProgress: { '0': [false, true] } }), '防风草')).toContain('没有发现需保留项')
  })
  it('does not confuse low quality with a gold-quality requirement', () => {
    expect(keepItemAdvice(inventory({ items: [{ id: '(O)24', rawId: '24', name: '防风草', count: 6, quality: 0, category: -75 }], bundleData: { 'Pantry/0': '优质/reward/24 5 2/0/1' }, bundleProgress: { '0': [false] } }), '防风草')).not.toContain('预留 5')
  })
  it('matches category ingredients and adds delivery quests', () => {
    expect(keepItemAdvice(inventory({ bundleData: { 'Pantry/0': '蔬菜/reward/-75 2 0/0/1' }, bundleProgress: { '0': [false] }, deliveryQuests: [{ itemId: '24', count: 3, target: 'Haley' }] }), '防风草')).toContain('预留 5 个')
  })
  it('fails closed on missing or malformed bundle progress', () => {
    expect(keepItemAdvice(inventory({ bundleProgress: {} }), '防风草')).toContain('不能据此判定可卖')
    expect(keepItemAdvice(null, '防风草')).toContain('没有找到')
  })
  it('uses tomorrow weather but does not guarantee a watering-can upgrade window', () => {
    expect(dayAdvice({ facts: { time: 1900, stamina: 20, health: 40, tomorrowWeather: 'Rain' } })).toContain('还要确认取回当天')
    expect(dayAdvice({ facts: { time: 900, stamina: 100, tomorrowWeather: 'Sun' } })).toContain('不建议')
  })
  it('returns a cross-map route with explicit unverified door conditions', () => {
    const result = npcRouteAdvice({ facts: { location: 'Farm', matches: [{ name: '海莉', location: 'House', x: 3, y: 4 }], exits: [
      { from: 'Farm', to: 'Town', x: 10, y: 5 }, { from: 'Town', to: 'House', x: 8, y: 6, door: true }, { from: 'Town', to: 'Farm', x: 0, y: 0 },
    ] } })
    expect(result).toContain('Farm 的 (10, 5)'); expect(result).toContain('门禁'); expect(result).toContain('Town 的 (8, 6) 门口')
  })
  it('checks mining equipment from actual inventory flags', () => {
    const r = dayAdvice({ facts: { time: 1200, stamina: 100, health: 100, hasPickaxe: false, hasWeapon: false, foodCount: 0 } }, true)
    expect(r).toContain('没有镐子'); expect(r).toContain('近战武器'); expect(r).toContain('食物')
  })
  it('does not invent disconnected routes', () => {
    expect(npcRouteAdvice({ facts: { location: 'Farm', matches: [{ location: 'House' }], exits: [] } })).toContain('没有找到完整连接路线')
  })
  it('calculates recipe shortages from actual recipe ingredients', () => {
    expect(dstAdvice({ items: [{ prefab: 'cutgrass', count: 1 }], recipeAvailable: true, ingredients: [{ prefab: 'cutgrass', count: 3 }] }, 'recipe')).toContain('还缺 2')
  })
  it('warns about winter and depleted lights without consuming anything', () => {
    const result = dstAdvice({ items: [{ prefab: 'torch', count: 1, fuelPercent: 0 }], season: 'winter', health: 0.2, hunger: 0.1 }, 'trip')
    expect(result).toContain('生命不足'); expect(result).toContain('没有确认可用'); expect(result).toContain('暖石')
  })
  it('distinguishes actual death cause from earlier attacks', () => {
    expect(dstAdvice({ items: [], lastDeath: { time: 200, cause: 'hunger', attacks: [{ attacker: 'spider' }] } }, 'death')).toContain('不一定是最终死因')
    expect(dstAdvice({ items: [] }, 'death')).toContain('不能从当前状态猜测')
  })
})
