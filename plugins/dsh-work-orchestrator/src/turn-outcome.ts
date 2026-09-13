import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Agent.whenIdle() only means the driver stopped; partial text is not success. */
export function assertTurnSucceeded(events: readonly SessionEvent[], firstSeq: number): void {
  const ends = events.filter(event => event.seq >= firstSeq && event.type === 'turn/end')
  if (ends.length === 0) {
    throw Object.assign(new Error('本次任务未收到完成确认，请重试。'), { code: 'TURN_END_MISSING' })
  }
  for (const end of ends) {
    if (end.type !== 'turn/end') continue
    const reason = end.data.reason
    if (reason.kind === 'error') {
      throw Object.assign(new Error(reason.error.message), { code: reason.error.code })
    }
    if (reason.kind !== 'completed') {
      throw Object.assign(new Error(`本次任务未完成（${reason.kind}），不能作为成功成果。`), { code: 'TURN_INCOMPLETE' })
    }
  }
}
