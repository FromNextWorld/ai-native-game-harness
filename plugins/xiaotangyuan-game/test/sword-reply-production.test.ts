import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { readdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { GameAgentSession, persistentGameSessionId } from '../src/runtime/agent/game-agent-session.js'
import { GameGateway } from '../src/gateway/game-gateway.js'
import { PROJECTILE_ATOMS } from '../src/runtime/tasks/sword-formation.js'
import { SkillService } from '../src/runtime/skills/skill-service.js'
import { SkillStore } from '../src/runtime/skills/skill-store.js'
import { SpeechController } from '../src/runtime/speech/speech-controller.js'
import { nativeProjectileBridge } from './fixtures/native-projectile-bridge.js'

// Use the already-installed workspace dependency, not a replacement Agent loop.
const pnpmRoot = new URL('../../../node_modules/.pnpm/', import.meta.url)
const loopFolder = readdirSync(pnpmRoot).find(name => name.startsWith('@deepseek-ai+dsh-agent-loop_'))!
const { default: AgentLoop } = await import(pathToFileURL(join(pnpmRoot.pathname.replace(/^\/([A-Z]:)/i, '$1'), loopFolder, 'node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js')).href)
let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'agh-sword-real-agent-')); vi.stubEnv('DSH_HOME', home); vi.spyOn(process.stdout, 'write').mockImplementation(() => true) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

async function fixture(borrowed = false, native?: ReturnType<typeof nativeProjectileBridge>) {
  const ctx = new Context()
  const fibers: any[] = []
  for (const [plugin, config] of [[Sessions, {}], [Agents, {}], [LlmRuntime, {}], [SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }], [ToolRuntime, { mode: 'native' }], [AgentLoop, { agents: [] }]] as any[]) fibers.push(await ctx.plugin(plugin, config))
  // Persistence is the external storage boundary. Agent creation/resume fallback remains real.
  const providers = [ctx.provide('sessionPersistence' as never, { prepare: async (id: string) => { throw new Error(`session "${id}" not found`) } } as never), ctx.provide('sessionTitle', { rename: () => undefined } as never)]
  const order: string[] = [], requests: any[] = []
  const actionDecision = { atom: 'sword:summon' as string | null }
  const selection = { provider: 'test', model: 'test', reasoningEffort: 'off' as never }
  class Model extends LlmAdapter {
    async resolveModel(provider: string, id: string): Promise<any> { return { provider, id, name: id, reasoning: { efforts: [{ id: 'off', name: 'off' }] } } }
    async *stream(options: any): AsyncGenerator<any> {
      requests.push(options)
      if (options.purpose === 'compaction') {
        order.push('classify')
        yield { type: 'text-delta', index: 0, text: JSON.stringify(actionDecision) }
      } else {
        order.push('reply-model')
        // The model attempts the old bad stop when that tool is actually visible.
        // A corrected real assembled catalog must remove this path.
        if (options.tools?.some((t: any) => t.name === 'xiaotangyuan_sword_formation_stop') && !order.includes('attempt-stop')) {
          order.push('attempt-stop')
          yield { type: 'tool-call-delta', index: 0, id: 'bad-stop', name: 'xiaotangyuan_sword_formation_stop', argumentsDelta: '{}' }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
        }
        yield { type: 'text-delta', index: 0, text: '我来叫崽崽们出来。' }
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const unmodel = ctx.llm.registerAdapter(['test'], new Model())
  const adapter = { adapterId: 'test', gameId: 'stardew-valley', processId: 42, saveId: 'test', atoms: native ? await native.request('hello') : PROJECTILE_ATOMS.map(name => ({ name, description: name, parameters: '{}', returns: '{}' })) }
  const executor = vi.fn(async (atom: string, args: any, signal = new AbortController().signal) => {
    order.push(atom)
    if (native) return native.executor(atom, args, signal)
    if (atom.endsWith('_cancel')) return { state: 'idle', remaining: 0 }
    return { opId: args.opId, state: 'orbit', preview: true, count: args.count, remaining: args.count, hits: 0, damage: 0, kills: 0, reason: '' }
  })
  const work = { contextForCompanion: () => undefined, scheduleTurn: vi.fn(() => order.push('work-scheduled')) }
  const multimodal = { selectModel: async () => selection, prepareProcess: async () => ({ selection, timing: { modelSelectionMs: 1, captureMs: 1, attachmentMs: 1 } }) }
  let external: any
  if (borrowed) external = await ctx.agents.create({ sessionId: SessionId(persistentGameSessionId(adapter, 'test')), agentOptions: selection, meta: { cwd: home } })
  let speechSink: ((interactionId: string, delta: string) => Promise<void>) | undefined
  const game = new GameAgentSession(ctx, adapter, multimodal as never, undefined, new SkillService(new SkillStore({ enabled: true, directory: join(home, 'skills'), activeLimit: 10 })), work as never, executor, 'test', false, update => {
    if (update.source === 'voice' && speechSink) connection.speechQueue = connection.speechQueue.then(() => speechSink!(update.interactionId, update.delta))
  })
  const playback = Promise.withResolvers<boolean>()
  const connection = { adapter, session: game, speechQueue: Promise.resolve(), latestSaveId: 'test', streamingInteractions: new Set(), postReplyAction: undefined }
  const gateway = Object.create(GameGateway.prototype) as any
  Object.assign(gateway, { ctx, multimodal, connectionForProcess: () => connection, markInteraction: () => undefined,
    notify: (_c: unknown, method: string, params: any) => order.push(`${method}:${params.atom ?? ''}`),
    finishTextStream: () => order.push('text-published'), finishSpeechReply: () => playback.promise.then(v => { order.push('playback-done'); return v }),
    speechFinished: () => undefined, callAdapterAtom: (_c: unknown, ...args: any[]) => executor(...args as [string, any]),
  })
  return { ctx, game, gateway, requests, executor, order, playback, actionDecision, work,
    setSpeechSink: (sink: typeof speechSink) => { speechSink = sink },
    close: async () => { playback.resolve(true); connection.postReplyAction && (connection.postReplyAction as AbortController).abort(); await game.dispose(); await external?.dispose(); unmodel(); for (const p of providers.reverse()) await p(); for (const f of fibers.reverse()) await f.dispose() } }
}
describe('registered Agent -> reply -> playback -> sword action', () => {
  it.skipIf(!process.env.AGH_PROJECTILE_STATE_FIXTURE).each([false, true])('real model requests use only the current native HUD state; borrowed=%s', async borrowed => {
    const native = JSON.parse(readFileSync(process.env.AGH_PROJECTILE_STATE_FIXTURE!, 'utf8'))
    const f = await fixture(borrowed)
    try {
      const at = Date.now()
      const live = { ...native.state, capturedAt: new Date(at).toISOString(), cooldownUntil: new Date(at+3000).toISOString() }
      const observation = { ...native.observation, meta: { ...native.observation.meta, capturedAt: live.capturedAt },
        companion: { ...native.observation.companion, projectiles: live } }
      await f.game.ask({ text: '现在还有剑吗？', context: { observation, saveId: 'test' } })
      expect(JSON.stringify(f.requests.find(r => r.purpose !== 'compaction').messages)).toContain(native.hud[0])
      const previous = f.requests.length
      const stale = { ...observation, companion: { ...observation.companion,
        projectiles: { ...live, capturedAt: new Date(at-8000).toISOString() } } }
      await f.game.ask({ text: '刚才的状态呢？', context: { observation: stale, saveId: 'test' } })
      const current = JSON.stringify(f.requests.slice(previous).find(r => r.purpose !== 'compaction').messages)
      expect(current).not.toContain(native.hud[0])
      expect(current).toContain('fresh')
      expect(current).toContain('unknown')
      expect(f.executor).not.toHaveBeenCalled()
      // The original persisted evidence remains available for auditing; only model surface is replaced.
      const session = f.ctx.sessions.get(persistentGameSessionId({ gameId: 'stardew-valley' } as any, 'test') as any)
      expect(JSON.stringify(session?.events)).toContain(native.hud[0])
    } finally { await f.close() }
  }, 15000)
  it.runIf(Boolean(process.env.AGH_PROJECTILE_BRIDGE)).each(['chop', 'fish', 'cast'] as const)('spoken %s after summon uses actual advertised native budgets only after playback', async mode => {
    const native = nativeProjectileBridge(process.env.AGH_PROJECTILE_BRIDGE!, true)
    await native.request('world', { trees: 8, health: 12 })
    const f = await fixture(false, native)
    let timer: ReturnType<typeof setInterval> | undefined
    try {
      await native.run('summon'); const oldId = native.calls[0].args.opId
      f.actionDecision.atom = `sword:${mode}`
      const replying = f.gateway.respond(42, { chop: '让剑阵去砍树', fish: '让飞剑入水捕鱼', cast: '让崽崽们攻击怪物' }[mode], new AbortController().signal)
      void replying.catch(() => undefined)
      await vi.waitFor(() => expect(f.order).toContain('reply-model'))
      await vi.waitFor(() => expect(f.work.scheduleTurn).toHaveBeenCalled())
      expect(f.executor).not.toHaveBeenCalled()
      expect(f.order).not.toContain('classify')
      f.playback.resolve(true); await replying
      timer = setInterval(() => { void native.request('tick', { frames: 3 }).catch(() => undefined) }, 50)
      await vi.waitFor(() => expect(f.order).toContain(`assistant.action.result:sword:${mode}`), { timeout: 8000 })
      expect(f.order.indexOf('classify')).toBeGreaterThan(f.order.indexOf('playback-done'))
      expect(f.executor).toHaveBeenCalledWith('stardew.projectiles_create', expect.objectContaining({ replacePreviewOpId: oldId,
        ...(mode === 'chop' ? { resource: 'chop', impactsPerProjectile: 24, targetLimit: 8 } : mode === 'fish' ? { resource: 'fish', fishRollLimit: 8 } : {}) }), expect.anything())
      if (mode === 'chop') expect(await native.request('world-evidence')).toMatchObject({ felled: 8, touched: 8, hits: 96, stamina: 14, axeUserRestored: true })
      else if (mode === 'fish') expect(await native.request('world-evidence')).toMatchObject({ fishRolls: 8, fishDrops: 8, stamina: 14 })
      else expect(await native.request('stardew.projectiles_status', { arguments: { opId: native.calls.findLast(c => c.atom.endsWith('_create'))!.args.opId } })).toMatchObject({ hits: 8, damage: 320, state: 'completed' })
    } finally { if (timer) clearInterval(timer); await f.close(); native.close() }
  }, 15000)
  it('does not classify or execute after actual streaming TTS fails mid-answer', async () => {
    const f = await fixture()
    const media = { startPcmPlayback: vi.fn(), appendPcmPlayback: vi.fn(), cancelPlayback: vi.fn(), waitForPcmPosition: async () => undefined, finishPcmPlayback: vi.fn(async () => undefined) }
    const tts = { id: 'test', async *synthesizeStream() { yield new Uint8Array(960); throw new Error('TEST_PARTIAL_TTS_FAILURE') } }
    const controller = new SpeechController(f.ctx, {} as never, media as never, f.gateway,
      { resolve: async (kind: string) => kind === 'speech.transcribe' ? { transcribe: async () => '万剑归宗' } : tts } as never)
    f.setSpeechSink((id, delta) => controller.appendSpeechDelta(42, id, delta))
    f.gateway.finishSpeechReply = (pid: number, id: string, text: string) => controller.finishSpeechReply(pid, id, text)
    try {
      await (controller as any).onMediaEvent({ type: 'recording.completed', processId: 42, recordingId: 'partial-stream', audioBase64: '', mediaType: 'audio/wav' })
      expect(media.appendPcmPlayback).toHaveBeenCalled()
      await vi.waitFor(() => expect(f.order.some(item => item === 'classify' || item === 'assistant.error:')).toBe(true))
      expect(f.order).not.toContain('classify')
      expect(f.executor).not.toHaveBeenCalled()
      expect(f.order).toContain('assistant.error:')
    } finally { await f.close() }
  }, 15000)
  it.each([false, true])('waits for full-answer fallback playback, playback fails=%s', async fails => {
    const f = await fixture()
    const played = Promise.withResolvers<void>()
    const media = { play: vi.fn(() => played.promise) }
    f.gateway.finishSpeechReply = async () => false
    const controller = new SpeechController(f.ctx, {} as never, media as never, f.gateway, { resolve: async (kind: string) => kind === 'speech.transcribe'
      ? { transcribe: async () => '万剑归宗' } : { synthesize: async () => ({ bytes: new Uint8Array(2), mediaType: 'audio/wav' }) } } as never)
    let running: Promise<void> | undefined
    try {
      running = (controller as any).onMediaEvent({ type: 'recording.completed', processId: 42, recordingId: 'fallback', audioBase64: '', mediaType: 'audio/wav' })
      await vi.waitFor(() => expect(media.play).toHaveBeenCalledOnce())
      expect(f.order).not.toContain('classify')
      expect(f.executor).not.toHaveBeenCalled()
      if (fails) played.reject(new Error('audio device failed')); else played.resolve()
      await running
      if (fails) expect(f.executor).not.toHaveBeenCalled()
      else await vi.waitFor(() => expect(f.executor).toHaveBeenCalledOnce())
    } finally { played.resolve(); await running; await f.close() }
  }, 15000)
  it.each([false, true])('summons only after actual playback; borrowed live agent=%s', async borrowed => {
    const f = await fixture(borrowed)
    try {
      const replying = f.gateway.respond(42, '万剑归宗', new AbortController().signal)
      void replying.catch(() => undefined)
      await vi.waitFor(() => expect(f.order).toContain('reply-model'))
      await vi.waitFor(() => expect(f.work.scheduleTurn).toHaveBeenCalled())
      expect(f.executor).not.toHaveBeenCalled()
      expect(f.order).not.toContain('classify')
      const first = f.requests.find(r => r.purpose !== 'compaction')
      expect(first.tools.map((t: any) => t.name)).not.toContain('xiaotangyuan_sword_formation_stop')
      f.playback.resolve(true)
      await replying
      await vi.waitFor(() => expect(f.executor).toHaveBeenCalledWith('stardew.projectiles_create', expect.objectContaining({ preview: true, count: 8 }), expect.anything()))
      expect(f.order.indexOf('classify')).toBeGreaterThan(f.order.indexOf('playback-done'))
      expect(f.order).toContain('assistant.action.result:sword:summon')
      expect(f.executor.mock.calls.map(c => c[0])).toEqual(['stardew.projectiles_create'])
    } finally { await f.close() }
  }, 15000)
  it('passes ambiguous current text unchanged and never turns it into stop or learning', async () => {
    const f = await fixture(); f.actionDecision.atom = null
    try {
      f.playback.resolve(true)
      await f.gateway.respond(42, '归中。', new AbortController().signal)
      await vi.waitFor(() => expect(f.order).toContain('classify'))
      expect(f.executor).not.toHaveBeenCalled()
      const decision = f.requests.find(r => r.purpose === 'compaction')
      expect(JSON.parse(decision.messages[0].content[0].text).playerText).toBe('归中。')
    } finally { await f.close() }
  }, 15000)
})
