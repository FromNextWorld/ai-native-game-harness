import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Sessions from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { GameAgentSession } from '../src/runtime/agent/game-agent-session.js'
import { SkillService } from '../src/runtime/skills/skill-service.js'
import { SkillStore } from '../src/runtime/skills/skill-store.js'

const pnpmRoot = fileURLToPath(new URL('../../../node_modules/.pnpm/', import.meta.url))
const loopFolder = readdirSync(pnpmRoot).find(name => name.startsWith('@deepseek-ai+dsh-agent-loop_'))!
const { default: AgentLoop } = await import(pathToFileURL(join(pnpmRoot, loopFolder, 'node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js')).href)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

// External model is scripted; Agent loop, scoped tools, gate, turn budget,
// service and public reply selection are the production implementations.
describe('registered Agent public learning result (not reply-first timing acceptance)', () => {
  it.each(['no-tool', 'denied', 'bad-code'] as const)('reports %s from actual Agent events without inventing a failed game trial', async scenario => {
    const home = mkdtempSync(join(tmpdir(), 'xty-outcome-agent-'))
    vi.stubEnv('DSH_HOME', home); vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const ctx = new Context(), fibers: any[] = [], providers: Array<() => any> = []
    let game: GameAgentSession | undefined, unmodel: (() => void) | undefined
    try {
      for (const [plugin, config] of [[Sessions, {}], [Agents, {}], [LlmRuntime, {}],
        [SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }],
        [ToolRuntime, { mode: 'native' }], [AgentLoop, { agents: [] }]] as any[]) fibers.push(await ctx.plugin(plugin, config))
      providers.push(ctx.provide('sessionPersistence' as never, { prepare: async (id: string) => { throw new Error(`session "${id}" not found`) } } as never))
      providers.push(ctx.provide('sessionTitle', { rename: () => undefined } as never))
      const requests: any[] = [], events: any[] = []
      ctx.on('session/event', (_session, event) => { events.push(event) })
      const selection = { provider: 'test', model: 'test', reasoningEffort: 'off' as never }
      let attempted = false
      class Model extends LlmAdapter {
        async resolveModel(provider: string, id: string): Promise<any> { return { provider, id, name: id, reasoning: { efforts: [{ id: 'off', name: 'off' }] } } }
        async *stream(options: any): AsyncGenerator<any> {
          requests.push(options)
          if (options.purpose === 'compaction') {
            yield { type: 'text-delta', index: 0, text: JSON.stringify({ kind: scenario === 'denied' ? 'clarify' : 'learn' }) }
          } else if (scenario !== 'no-tool' && !attempted) {
            attempted = true
            expect(options.tools.some((tool: any) => tool.name === 'xiaotangyuan_skill_learn')).toBe(true)
            yield { type: 'tool-call-delta', index: 0, id: 'attempt', name: 'xiaotangyuan_skill_learn', argumentsDelta: JSON.stringify({
              skillId: 'dst.regression', name: '练习', description: '测试编译边界', triggers: '练习', sourceCode: 'let found = params;',
            }) }
            yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
          } else yield { type: 'text-delta', index: 0, text: '我看看这项练习需要哪些动作。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
      unmodel = ctx.llm.registerAdapter(['test'], new Model())
      const executor = vi.fn(async () => ({}))
      const store = new SkillStore({ enabled: true, directory: join(home, 'skills'), activeLimit: 5 })
      const adapter = { adapterId: 'regression', gameId: 'dont-starve-together', saveId: home,
        atoms: [{ name: 'dst.find_nearest_entity', description: '查找实体', parameters: '{}', returns: '{}' }] }
      const multimodal = { selectModel: async () => selection, prepareProcess: async () => ({ selection, timing: { modelSelectionMs: 1, captureMs: 1, attachmentMs: 1 } }) }
      const work = { contextForCompanion: () => undefined, scheduleTurn: vi.fn() }
      game = new GameAgentSession(ctx, adapter, multimodal as never, undefined, new SkillService(store), work as never, executor, 'test')
      const result = await game.ask({ text: '学习怎么打蝴蝶。', context: { saveId: home } }, 'voice')
      expect(requests.some(request => request.purpose !== 'compaction')).toBe(true)
      expect(executor).not.toHaveBeenCalled()
      expect(store.list(adapter.gameId)).toEqual([])
      if (scenario === 'bad-code') {
        expect(result.reply).toContain('代码检查没有通过')
        expect(store.listLearningAttempts(adapter.gameId)).toHaveLength(1)
        expect(store.listLearningAttempts(adapter.gameId)[0]).toMatchObject({ failureStage: 'compile', trace: [] })
        expect(events.filter(event => event.type === 'tool/result').some(event => JSON.stringify(event).includes('compile'))).toBe(true)
      } else {
        expect(result.reply).toContain('没有确认到学习结果')
        expect(result.reply).not.toContain('没有通过完整试跑')
        expect(store.listLearningAttempts(adapter.gameId)).toHaveLength(0)
        expect(events.filter(event => event.type === 'tool/call')).toHaveLength(scenario === 'denied' ? 1 : 0)
      }
    } finally {
      await game?.dispose(); unmodel?.()
      for (const remove of providers.reverse()) await remove()
      for (const fiber of fibers.reverse()) await fiber.dispose()
      rmSync(home, { recursive: true, force: true })
    }
  }, 15000)
})
