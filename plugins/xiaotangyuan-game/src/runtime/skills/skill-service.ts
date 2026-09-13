import type { SkillProgram, SkillRecord, SkillRunResult, GameAtomExecutor, SkillAcceptance, SkillValue } from './contracts.js'
import { validateSkillProgram } from './skill-runtime.js'
import { compileSkillSource } from './skill-source.js'
import { SkillStore } from './skill-store.js'
import { verifySkillResult } from './skill-verification.js'
import { snapshotDependencies } from './skill-dependencies.js'
import { runSkillProcess } from './skill-process.js'

export class SkillService {
  readonly store: SkillStore
  private readonly runningGames = new Set<string>()

  private async execute(gameId: string, skillId: string, version: number, program: SkillProgram,
    atoms: ReadonlySet<string>, executor: GameAtomExecutor, signal: AbortSignal, acceptance?: SkillAcceptance,
    params: Record<string, SkillValue> = {}): Promise<SkillRunResult> {
    if (this.runningGames.has(gameId)) return { success: false, skillId, skillVersion: version, trace: [], failureStage: 'preflight', error: '小汤圆还在执行技能，请先等待或取消' }
    this.runningGames.add(gameId)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('技能执行总时限已到，已取消')), 100_000)
    const combined = AbortSignal.any([signal, controller.signal])
    let stage: 'preflight' | 'execution' = 'preflight'
    try {
      combined.throwIfAborted()
      const dependencies = snapshotDependencies(skillId, program, atoms,
        (id, dependencyVersion) => this.store.verifiedVersion(gameId, id, dependencyVersion))
      stage = 'execution'
      const result = await runSkillProcess(skillId, version, program, atoms, executor, combined, dependencies, params)
      if (combined.aborted) return { ...result, success: false, failureStage: 'cancelled', error: '技能执行已取消' }
      if (!result.success) return { ...result, failureStage: result.failureStage ?? 'execution' }
      return verifySkillResult(result, acceptance)
    } catch (error) {
      return { success: false, skillId, skillVersion: version, trace: [], failureStage: combined.aborted ? 'cancelled' : stage,
        error: combined.aborted ? '技能执行已取消' : error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
      this.runningGames.delete(gameId)
    }
  }

  constructor(store: SkillStore) {
    this.store = store
  }

  private saveGenerated(input: {
    gameId: string
    skillId: string
    name: string
    description: string
    triggers: string[]
    program: SkillProgram
    acceptance?: SkillAcceptance
  }, allowedAtoms: ReadonlySet<string>): SkillRecord {
    validateSkillProgram(input.program, allowedAtoms)
    const previous = this.store.find(input.gameId, input.skillId)
    const now = new Date().toISOString()
    return this.store.upsert({
      id: input.skillId,
      gameId: input.gameId,
      name: input.name.trim().slice(0, 80),
      description: input.description.trim().slice(0, 500),
      triggers: input.triggers.map(value => value.slice(0, 80)).slice(0, 20),
      version: (previous?.version ?? 0) + 1,
      status: 'active',
      program: input.program,
      verified: true,
      ...(input.acceptance === undefined ? {} : { acceptance: structuredClone(input.acceptance) }),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      successCount: previous?.successCount ?? 0,
      failureCount: previous?.failureCount ?? 0,
      ...(previous?.lastUsedAt === undefined ? {} : { lastUsedAt: previous.lastUsedAt }),
    })
  }

  async tryLearn(input: {
    gameId: string
    skillId: string
    name: string
    description: string
    triggers: string[]
    program: SkillProgram
    acceptance?: SkillAcceptance
    trialArgs?: Record<string, SkillValue>
  }, allowedAtoms: ReadonlySet<string>, executor: GameAtomExecutor, signal: AbortSignal): Promise<{
    result: SkillRunResult
    learned?: SkillRecord
  }> {
    validateSkillProgram(input.program, allowedAtoms)
    const proposedVersion = (this.store.find(input.gameId, input.skillId)?.version ?? 0) + 1
    const result = await this.execute(
      input.gameId,
      input.skillId,
      proposedVersion,
      input.program,
      allowedAtoms,
      executor,
      signal,
      input.acceptance ?? this.store.find(input.gameId, input.skillId)?.acceptance,
      input.trialArgs,
    )
    this.store.recordLearningAttempt({
      gameId: input.gameId,
      skillId: input.skillId,
      proposedVersion,
      program: input.program,
      success: result.success,
      trace: result.trace,
      ...(result.failureStage === undefined ? {} : { failureStage: result.failureStage }),
      ...(result.error === undefined ? {} : { error: result.error }),
      createdAt: new Date().toISOString(),
    })
    if (!result.success) return { result }
    const acceptance = input.acceptance ?? this.store.find(input.gameId, input.skillId)?.acceptance
    return { result, learned: this.saveGenerated({ ...input, ...(acceptance === undefined ? {} : { acceptance }) }, allowedAtoms) }
  }

  async tryLearnSource(input: {
    gameId: string
    skillId: string
    name: string
    description: string
    triggers: string[]
    sourceCode: string
    acceptance?: SkillAcceptance
    trialArgs?: Record<string, SkillValue>
  }, allowedAtoms: ReadonlySet<string>, executor: GameAtomExecutor, signal: AbortSignal): Promise<{
    result: SkillRunResult
    learned?: SkillRecord
  }> {
    let program: SkillProgram
    try {
      program = compileSkillSource(input.sourceCode, allowedAtoms)
    } catch (error) {
      const proposedVersion = (this.store.find(input.gameId, input.skillId)?.version ?? 0) + 1
      const message = error instanceof Error ? error.message : String(error)
      const result: SkillRunResult = {
        success: false,
        skillId: input.skillId,
        skillVersion: proposedVersion,
        trace: [],
        error: message,
        failureStage: 'compile',
      }
      this.store.recordLearningAttempt({
        gameId: input.gameId,
        skillId: input.skillId,
        proposedVersion,
        program: {
          language: 'xiaotangyuan-skill-v2',
          source: input.sourceCode.slice(0, 12_000),
          body: [],
        },
        success: false,
        trace: [],
        error: message,
        failureStage: 'compile',
        createdAt: new Date().toISOString(),
      })
      return { result }
    }
    return this.tryLearn({
      gameId: input.gameId,
      skillId: input.skillId,
      name: input.name,
      description: input.description,
      triggers: input.triggers,
      program,
      ...(input.trialArgs === undefined ? {} : { trialArgs: input.trialArgs }),
      ...(input.acceptance === undefined ? {} : { acceptance: input.acceptance }),
    }, allowedAtoms, executor, signal)
  }

  async run(
    gameId: string,
    skillId: string,
    allowedAtoms: ReadonlySet<string>,
    executor: GameAtomExecutor,
    signal: AbortSignal,
    params: Record<string, SkillValue> = {},
  ): Promise<SkillRunResult> {
    const skill = this.store.get(gameId, skillId)
    if (skill === undefined) throw new Error(`没有找到可用技能：${skillId}`)
    const result = await this.execute(gameId, skill.id, skill.version, skill.program, allowedAtoms, executor, signal, skill.acceptance, params)
    this.store.recordRun(gameId, skillId, result.success, result.error)
    return result
  }
}
