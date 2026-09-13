import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { MultimodalRouter } from '../src/runtime/multimodal/multimodal-router.js'

describe('product model binding', () => {
  it('selects the fixed non-reasoning MiniMax-M3 route before the saved Harness default', async () => {
    const resolveModelInfo = vi.fn(async (provider: string, model: string) => ({
      provider,
      id: model,
      reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'max', name: 'Max' }] },
      inputModalities: provider === 'minimax' && model === 'MiniMax-M3' ? ['text', 'image'] : ['text'],
    }))
    const router = new MultimodalRouter({
      agentDefaultModel: { currentSelection: () => ({ provider: 'zhipu', model: 'glm-4.6v-flashx' }) },
      llm: { resolveModelInfo, listProviders: () => [] },
    } as never, resolveConfig().vision, {} as never)

    await expect(router.selectModel(new AbortController().signal)).resolves.toEqual({
      provider: 'minimax',
      model: 'MiniMax-M3',
      reasoningEffort: 'off',
    })
    expect(resolveModelInfo).toHaveBeenCalledWith('minimax', 'MiniMax-M3', expect.any(AbortSignal))
  })

  it('falls back to a developer-selected image model when the product route is unavailable', async () => {
    const resolveModelInfo = vi.fn(async (provider: string, model: string) => {
      if (provider === 'minimax') throw new Error('product route unavailable')
      return { provider, id: model, inputModalities: ['text', 'image'] }
    })
    const router = new MultimodalRouter({
      agentDefaultModel: { currentSelection: () => ({ provider: 'developer', model: 'vision-local' }) },
      llm: { resolveModelInfo, listProviders: () => [] },
    } as never, resolveConfig({ vision: { strictModel: false } }).vision, {} as never)

    await expect(router.selectModel(new AbortController().signal)).resolves.toEqual({
      provider: 'developer',
      model: 'vision-local',
    })
  })
})
