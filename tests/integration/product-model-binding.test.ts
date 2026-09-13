import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('product model binding', () => {
  it('ships the MiniMax-M3 route needed by the game edition', () => {
    const patch = readFileSync(resolve(root, 'integrations/xiaotangyuan/desktop.patch.yml'), 'utf8')

    expect(patch).toMatch(/id: llm-pi-ai[\s\S]*?minimax:[\s\S]*?apiKeyEnv: GAME_MINIMAX_API_KEY/)
    expect(patch).toMatch(/id: MiniMax-M3[\s\S]*?contextWindow: 1000000[\s\S]*?- image[\s\S]*?off: null[\s\S]*?max: max/)
  })

  it('keeps the default Session non-reasoning and enables max reasoning only for Work', () => {
    const patch = readFileSync(resolve(root, 'integrations/xiaotangyuan/desktop.patch.yml'), 'utf8')

    expect(patch).toMatch(/id: agent-default-model[\s\S]*?provider: minimax[\s\S]*?model: MiniMax-M3[\s\S]*?reasoningEffort: off/)
    expect(patch).toMatch(/id: work-orchestrator[\s\S]*?provider: minimax[\s\S]*?model: MiniMax-M3[\s\S]*?reasoningEffort: max/)
  })

  it('pins game text, voice, screenshot and skill turns to non-reasoning MiniMax-M3', () => {
    const patch = readFileSync(resolve(root, 'integrations/xiaotangyuan/desktop.patch.yml'), 'utf8')

    expect(patch).toMatch(/id: xiaotangyuan-game[\s\S]*?vision:[\s\S]*?provider: minimax[\s\S]*?model: MiniMax-M3[\s\S]*?reasoningEffort: off[\s\S]*?strictModel: true/)
  })
})
