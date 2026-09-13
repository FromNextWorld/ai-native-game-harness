import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerPlayerAdviceTools } from '../src/tools/player-advice-tools.js'
function setup(game: string, atoms: string[], evidence: unknown) {
  const tools: ToolDefinition[] = []
  const executor = vi.fn(async () => evidence)
  registerPlayerAdviceTools({ tools: { register: (t: ToolDefinition) => tools.push(t) } } as unknown as Context, game, new Set(atoms), executor)
  return { tools, executor }
}
describe('player advice tool integration', () => {
  it('does not advertise a tool before its Mod atom is declared', () => {
    expect(setup('stardew-valley', [], {}).tools).toHaveLength(0)
    expect(setup('dont-starve-together', [], {}).tools).toHaveLength(0)
  })
  it('routes route questions to the read-only Stardew atom', async () => {
    const s = setup('stardew-valley', ['stardew.inspect_planning'], { facts: { location: 'Town', matches: [{ name: '海莉', location: 'Town', x: 1, y: 2 }] } })
    const signal = new AbortController().signal
    const result = await s.tools[0]!.execute({ kind: 'route', item: '海莉' }, { signal } as never) as { message: string }
    expect(s.executor).toHaveBeenCalledWith('stardew.inspect_planning', { kind: 'route', npc: '海莉' }, signal)
    expect(result.message).toContain('同一地图')
  })
  it('routes recipe checking to the server recipe rather than an invented ingredient list', async () => {
    const s = setup('dont-starve-together', ['dst.inspect_player'], { items: [], recipeAvailable: true, ingredients: [{ prefab: 'cutgrass', count: 2 }] })
    const signal = new AbortController().signal
    const result = await s.tools[0]!.execute({ kind: 'recipe', recipe: 'torch' }, { signal } as never) as { message: string }
    expect(s.executor).toHaveBeenCalledWith('dst.inspect_player', { recipe: 'torch' }, signal)
    expect(result.message).toContain('还缺 2')
  })
})
