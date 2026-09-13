type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined

/** Native HUD snapshots are short-lived, never a second JS gameplay clock.
 * One-second observations allow a little transport jitter. Expired/old evidence
 * becomes unknown: elapsed time alone cannot prove ready, a recall or a new cast.
 */
export function currentProjectileState(value: unknown, now: number): ObjectValue | undefined {
  const state = object(value)
  if (!state) return undefined
  const at = typeof state.capturedAt === 'string' ? Date.parse(state.capturedAt) : NaN
  const until = typeof state.cooldownUntil === 'string' ? Date.parse(state.cooldownUntil) : NaN
  const ms = state.cooldownRemainingMs
  if (!Number.isFinite(at) || now - at > 1500 || at - now > 1000 || typeof state.active !== 'boolean'
    || typeof state.screenLabel !== 'string' || state.screenLabel.length > 160 || typeof ms !== 'number'
    || !Number.isInteger(ms) || ms < 0 || (ms > 0 && (!Number.isFinite(until) || until <= now))) return undefined
  return state
}

export function projectileStateForPrompt(value: unknown, now: number): ObjectValue {
  const state = currentProjectileState(value, now)
  return state ? { ...state, fresh: true, ageMs: Math.max(0, now - Date.parse(String(state.capturedAt))) }
    : { fresh: false, status: 'unknown', reason: '剑阵画面状态已过期或缺少时间戳；不能据旧回执判断仍在施放、冷却或已经可用。' }
}

/** Called only after the caller validated an actual terminal stop receipt. */
export function projectileStopMessage(receipt: unknown, legacyMessage: string, now = Date.now()): string {
  const live = object(receipt)?.live
  if (live === undefined) return legacyMessage // old Mod: no invented timer
  const state = currentProjectileState(live, now)
  if (!state) return '已停止作业，当前画面状态待刷新。'
  if (state.active !== false) return '停止回执与当前作业状态不一致，请查看画面；暂不能确认全部停止。'
  return `已停止作业。当前画面：${state.screenLabel}。`
}
