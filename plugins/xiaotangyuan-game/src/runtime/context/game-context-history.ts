import type { WorkGameContext, WorkImageRef } from '@qimidandapigu/dsh-work-orchestrator'
import type { AdapterHello, GameChatRequest } from '../../protocol/game.js'
/** Bounded history of actually captured game windows, isolated by game and save. */
export class GameContextHistory {
  private readonly entries = new Map<string, WorkGameContext>()
  record(key: string, adapter: AdapterHello | undefined, request: GameChatRequest, image?: WorkImageRef): WorkGameContext | undefined {
    if (!adapter) return undefined
    const saveId = request.context?.saveId ?? adapter.saveId ?? 'default'
    const previous = this.entries.get(key)
    const same = previous?.gameId === adapter.gameId && previous.saveId === saveId
    const at = new Date().toISOString()
    const screenshots = same ? [...previous.screenshots] : []
    if (image) screenshots.push({ at, image })
    const recentEvents = same ? [...previous.recentEvents] : []
    if (request.text) recentEvents.push({ at, text: request.text.slice(0, 1000) })
    const ctx = request.context
    const observation = ctx?.observation && JSON.stringify(ctx.observation).length <= 64000 ? structuredClone(ctx.observation) : undefined
    const value: WorkGameContext = { gameId: adapter.gameId, saveId, capturedAt: at, location: ctx?.location, date: ctx?.date, time: ctx?.time, observation,
      recentEvents: recentEvents.slice(-20), screenshots: screenshots.filter(f => Date.now() - Date.parse(f.at) < 3600_000).slice(-10) }
    this.entries.delete(key); this.entries.set(key, value)
    while (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!)
    return structuredClone(value)
  }
  get(key: string): WorkGameContext | undefined { const v = this.entries.get(key); return v ? structuredClone(v) : undefined }
}
export const gameContextHistory = new GameContextHistory()
