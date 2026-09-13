import { describe, expect, it, vi } from 'vitest'
import { GameGateway, isSwordRecall } from '../src/gateway/game-gateway.js'

describe('priority voice recall', () => {
  it.each([true, false])('text stop also bypasses the model and requires receipt (confirmed=%s)', async confirmed => {
    const state = { adapter: { gameId: 'stardew-valley' }, latestSaveId: 'test', session: { cancel: vi.fn(), ask: vi.fn() } }
    const gateway = { markInteraction: vi.fn(), callAdapterAtom: vi.fn(async () => ({ state: confirmed ? 'canceled' : 'launched', remaining: confirmed ? 0 : 8 })), finishTextStream: vi.fn() }
    const dispatch = (GameGateway.prototype as unknown as { dispatch: (state: unknown, request: unknown) => Promise<{ reply: string }> }).dispatch
    const result = await dispatch.call(gateway, state, { method: 'chat.send', params: { text: '收回剑阵。' } })
    expect(state.session.ask).not.toHaveBeenCalled()
    expect(gateway.callAdapterAtom).toHaveBeenCalledOnce()
    expect(result.reply).toContain(confirmed ? '已收回' : '还没有收到收回确认')
  })
  it.each(['收回剑阵', '小汤圆，收起剑阵！', '崽崽回来吧', '停止剑阵', '爷爷回去吧', '爷爷歇会儿', '停止浇地'])('recognizes %s', text => expect(isSwordRecall(text)).toBe(true))
  it.each(['不要收回剑阵', '怎么收回剑阵', '他说收回剑阵', '收回剑阵然后砍树', '不要让爷爷回去', '爷爷回去是什么意思'])('does not execute ambiguous or quoted command %s', text => expect(isSwordRecall(text)).toBe(false))
  it('cancels before model or old speech queues and confirms native receipt', async () => {
    const connection = { adapter: { gameId: 'stardew-valley', adapterId: 'test', capabilities: [] }, latestSaveId: 'save',
      session: { cancel: vi.fn(), ask: vi.fn(() => new Promise(() => {})) }, speechQueue: new Promise(() => {}) }
    const gateway = { connectionForProcess: () => connection, markInteraction: vi.fn(),
      callAdapterAtom: vi.fn(async () => ({ state: 'canceled', remaining: 0 })),
      notify: vi.fn(), finishSpeechReply: vi.fn(async () => false), speechFinished: vi.fn() }
    const result = await GameGateway.prototype.respond.call(gateway as never, 1, '收回剑阵', new AbortController().signal)
    expect(connection.session.ask).not.toHaveBeenCalled()
    expect(connection.session.cancel).toHaveBeenCalledOnce()
    expect(gateway.callAdapterAtom.mock.calls).toHaveLength(1)
    expect(result.reply).toBe('崽崽剑阵已收回。')
  })
})
