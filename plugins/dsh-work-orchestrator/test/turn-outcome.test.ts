import { describe, expect, it } from 'vitest'
import { assertTurnSucceeded } from '../src/turn-outcome.js'

const end = (seq: number, kind: string) => ({ seq, type: 'turn/end', data: { reason: { kind } } })
describe('terminal outcome acceptance', () => {
  it('accepts a completed current turn, never an older completion', () => {
    expect(() => assertTurnSucceeded([end(4, 'completed')] as never, 4)).not.toThrow()
    expect(() => assertTurnSucceeded([end(4, 'completed')] as never, 5)).toThrow('完成确认')
  })
  it.each(['aborted', 'blocked', 'interrupted', 'max-tokens'])('rejects %s despite public text', kind => {
    expect(() => assertTurnSucceeded([
      { seq: 0, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已完成' }] } } },
      end(1, kind),
    ] as never, 0)).toThrow(kind)
  })
  it('preserves contained provider errors rather than reporting completion', () => {
    expect(() => assertTurnSucceeded([{ seq: 0, type: 'turn/end', data: { reason: {
      kind: 'error', error: { code: 'TRANSPORT', message: 'connection failed' },
    } } }] as never, 0)).toThrow('connection failed')
  })
  it('does not let a later completion hide an earlier failure in the same batch', () => {
    expect(() => assertTurnSucceeded([end(0, 'aborted'), end(1, 'completed')] as never, 0)).toThrow('aborted')
  })
})
