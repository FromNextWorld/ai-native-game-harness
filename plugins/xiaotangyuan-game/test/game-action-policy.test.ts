import { describe, it, expect } from 'vitest'
import { actionReceipt, parseGameAction } from '../src/runtime/agent/game-action-policy.js'
describe('authoritative game action receipts', () => {
  it.each([undefined, null, {}, { accepted: true }, { success: 'true' }, { reply: '成功' }])('does not invent success for %j', value => {
    expect(actionReceipt(value)).toMatchObject({ success: false, state: 'unknown' })
  })
  it('rejects contradictory evidence', () => expect(actionReceipt({ success: true, ok: false }).success).toBe(false))
  it.each([{ ok: true }, { success: true }])('accepts explicit successful receipt %j', value => expect(actionReceipt(value).success).toBe(true))
  it('bounds semantic choices to declared zero-argument voice actions', () => {
    const adapter = { adapterId: 'test', gameId: 'test', atoms: [{ name: 'water', description: 'water', parameters: '{}', returns: '{}' }], voiceCommands: [{ atom: 'water', phrases: ['浇水'] }] }
    expect(parseGameAction('{"atom":"water"}', adapter)).toBe('water')
    expect(parseGameAction('{"atom":null}', adapter)).toBeUndefined()
    expect(() => parseGameAction('{"atom":"delete"}', adapter)).toThrow()
    expect(() => parseGameAction('{"atom":"water"}', { ...adapter, atoms: [] })).toThrow()
  })
})
