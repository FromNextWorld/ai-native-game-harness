import { describe, expect, it } from 'vitest'
import { assertGameTurnSucceeded, gameTurnMaxTokens, deferPostTurnWork, emptyReplyFallback, formatGamePrompt, linkedWorkAcknowledgement, persistentGameSessionId } from '../src/runtime/agent/game-agent-session.js'

describe('persistent game sessions', () => {
  it('reserves a separate code generation budget while keeping conversation short', () => {
    expect(gameTurnMaxTokens(true)).toBe(4096)
    expect(gameTurnMaxTokens(false)).toBe(512)
  })
  it('does not turn a driver-contained model failure into a successful acknowledgement', () => {
    const event = { seq: 12, type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'UNSUPPORTED_REASONING_EFFORT', message: 'unsupported effort' } } } }
    expect(() => assertGameTurnSucceeded([event] as never, 10)).toThrow('unsupported effort')
    expect(() => assertGameTurnSucceeded([event] as never, 13)).toThrow('完成确认')
    expect(() => assertGameTurnSucceeded([{ ...event, data: { reason: { kind: 'completed' } } }] as never, 10)).not.toThrow()
  })
  it('reports an interrupted turn rather than claiming it has answered', () => {
    for (const kind of ['aborted', 'blocked', 'interrupted', 'max-tokens']) {
      expect(() => assertGameTurnSucceeded([{ seq: 12, type: 'turn/end', data: { reason: { kind } } }] as never, 10)).toThrow(kind)
    }
  })
  it('requires real dedicated game actions, without interpreting an empty learned list as missing capability', () => {
    const prompt = formatGamePrompt({ adapterId: 'test', gameId: 'stardew-valley', capabilities: [] }, { text: '释放万剑归宗。' }, undefined, false)
    expect(prompt).toContain('玩家要求执行游戏动作不是角色扮演')
    expect(prompt).toContain('列表为空也不必新建技能')
    expect(prompt).toContain('除明确声明交给回答后动作阶段的能力外')
  })
  it('reuses one session for the same game save across Adapter reconnects', () => {
    const adapter = {
      adapterId: 'test.oni', gameId: 'oxygen-not-included', version: '1.0.0', protocolVersion: '1.1', saveId: 'colony-a',
    }
    expect(persistentGameSessionId(adapter)).toBe(persistentGameSessionId({ ...adapter, processId: 999 }))
  })

  it('isolates different saves and does not expose the raw save id', () => {
    const adapter = { adapterId: 'test.dst', gameId: 'dont-starve-together', version: '1.0.0', protocolVersion: '1.1' }
    const first = persistentGameSessionId(adapter, 'secret-save-a')
    const second = persistentGameSessionId(adapter, 'secret-save-b')
    expect(first).not.toBe(second)
    expect(first).not.toContain('secret-save-a')
  })

  it('uses a natural one-sentence fallback instead of exposing a missing model reply', () => {
    expect(emptyReplyFallback('帮我做一个 HTML')).toBe('好的，我收到啦，先让我看看。')
    expect(emptyReplyFallback('Create an HTML page')).toBe('Got it. Let me take a look.')
    expect(emptyReplyFallback('帮我做一个 HTML')).not.toContain('model returned no text reply')
  })

  it('uses a deterministic acknowledgement before inspecting linked work', () => {
    expect(linkedWorkAcknowledgement('HTML 做得怎么样了？')).toBe('好的，我帮你看看进度。')
    expect(linkedWorkAcknowledgement('How is it going?')).toBe('Sure. I will check the progress.')
  })

  it('tells the model to inspect the attached screenshot without misusing read_image', () => {
    const prompt = formatGamePrompt(undefined, { text: '这是什么？' }, undefined, false)

    expect(prompt).toContain('Only an image attached to this turn is the current screenshot')
    expect(prompt).toContain('never claim to see the screen or substitute old images')
    expect(prompt).toContain('never pass its attachment id or hash to read_image')
  })

  it('defers work classification until the completed reply can be published', async () => {
    const events = ['reply-complete']
    deferPostTurnWork(() => events.push('work-classification'))
    events.push('reply-published')

    expect(events).toEqual(['reply-complete', 'reply-published'])
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(events).toEqual(['reply-complete', 'reply-published', 'work-classification'])
  })

  it('injects only the current linked work summary so progress questions keep context', () => {
    const prompt = formatGamePrompt(undefined, { text: 'HTML 做得怎么样了？' }, undefined, false, 'normal', {
      title: 'AI 影响游戏行业 HTML 汇报',
      status: '等待反馈',
    })

    expect(prompt).toContain('Current linked non-game work')
    expect(prompt).toContain('Title: AI 影响游戏行业 HTML 汇报')
    expect(prompt).toContain('Status: 等待反馈')
    expect(prompt).toContain('Do not invent progress')
  })

})
