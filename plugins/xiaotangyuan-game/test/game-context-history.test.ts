import { describe, it, expect } from 'vitest'
import { GameContextHistory } from '../src/runtime/context/game-context-history.js'
import type { AdapterHello, GameChatRequest } from '../src/protocol/game.js'
describe('game evidence history', () => {
  const adapter = { gameId: 'stardew-valley', saveId: 'farm-a' } as AdapterHello
  const request = { text: '浇水', context: { saveId: 'farm-a', date: '春2日', location: 'Farm' } } as GameChatRequest
  it('keeps at most ten actually captured images, and clones snapshots', () => {
    const history = new GameContextHistory()
    for (let i = 0; i < 12; i++) history.record('a', adapter, request, { attachmentId: String(i), mediaType: 'image/png' } as any)
    const value = history.get('a')!
    expect(value.screenshots).toHaveLength(10)
    expect(value.screenshots[0].image.attachmentId).toBe('2')
    value.screenshots.length = 0
    expect(history.get('a')!.screenshots).toHaveLength(10)
    expect(history.record('a', adapter, request)!.screenshots).toHaveLength(10)
  })
  it('never mixes different games or saves', () => {
    const history = new GameContextHistory()
    history.record('a', adapter, request, { attachmentId: 'farm' } as any)
    expect(history.record('a', { ...adapter, gameId: 'dont-starve-together' }, request)!.screenshots).toEqual([])
    history.record('a', adapter, request, { attachmentId: 'farm' } as any)
    expect(history.record('a', adapter, { ...request, context: { ...request.context, saveId: 'farm-b' } })!.screenshots).toEqual([])
    expect(history.get('b')).toBeUndefined()
  })
})
