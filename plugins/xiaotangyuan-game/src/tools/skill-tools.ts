import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AdapterHello } from '../protocol/game.js'
import type { GameAtomExecutor, SkillAcceptance, SkillFailureStage, SkillValue } from '../runtime/skills/contracts.js'
import type { SkillService } from '../runtime/skills/skill-service.js'
import { skillFailureAdvice } from '../runtime/skills/skill-verification.js'
import { gatherResources } from '../runtime/tasks/gather-resources.js'
import { registerPlayerAdviceTools } from './player-advice-tools.js'
import { registerSwordFormationTools } from './sword-formation-tools.js'
import { supportsPreviewHandoff, supportsChopSweep, supportsSwordPower } from '../runtime/tasks/sword-formation.js'

export interface LearningOutcome {
  success: boolean
  learned: boolean
  skillId: string
  error?: string
  traceJson: string
  failureStage?: SkillFailureStage
}

function parseSkillArguments(value = '{}'): Record<string, SkillValue> {
  if (value.length > 64_000) throw new Error('技能输入过大')
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('技能输入必须是 JSON 对象')
  return parsed
}

export class LearningTurnBudget {
  private readonly turns = new Map<string, { count: number, skillId: string, stopped: boolean }>()
  private readonly operations = new Set<string>()
  private readonly outcomes = new Map<string, LearningOutcome>()
  private readonly contracts = new Map<string, SkillAcceptance>()
  reset(sessionId: string): void {
    if (!this.operations.has(sessionId)) { this.turns.delete(sessionId); this.outcomes.delete(sessionId); this.contracts.delete(sessionId) }
  }
  begin(sessionId: string, acceptance?: SkillAcceptance): void {
    this.reset(sessionId); this.operations.add(sessionId)
    if (acceptance) this.contracts.set(sessionId, structuredClone(acceptance))
  }
  acceptance(sessionId: string): SkillAcceptance | undefined {
    const contract = this.contracts.get(sessionId)
    return contract === undefined ? undefined : structuredClone(contract)
  }
  end(sessionId: string): void { this.operations.delete(sessionId); this.reset(sessionId) }
  record(sessionId: string, outcome: LearningOutcome): void { this.outcomes.set(sessionId, outcome) }
  outcome(sessionId: string): LearningOutcome | undefined { return this.outcomes.get(sessionId) }
  count(sessionId: string): number { return this.turns.get(sessionId)?.count ?? 0 }
  reserve(sessionId: string, skillId: string): void {
    const state = this.turns.get(sessionId) ?? { count: 0, skillId, stopped: false }
    if (state.stopped) throw new Error('本轮学习已停止：请先处理环境条件，再重新发起')
    if (state.count >= 3) throw new Error('本轮已达到三次学习上限，没有学会；请查看失败原因')
    if (state.skillId !== skillId) throw new Error(`修订必须使用原技能 ID：${state.skillId}`)
    state.count += 1
    this.turns.set(sessionId, state)
  }
  stop(sessionId: string): void { const state = this.turns.get(sessionId); if (state) state.stopped = true }
}

/** Repair is a bounded continuation of the same player request, not a new task. */
export async function continueLearningRevisions(budget: LearningTurnBudget, sessionId: string,
  revise: (instruction: string) => Promise<void>): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    const result = budget.outcome(sessionId)
    const count = budget.count(sessionId)
    if (!result || result.success || count === 0 || count >= 3 || !skillFailureAdvice(result.error).retryable) return
    await revise(`技能流程未完成（失败阶段：${result.failureStage ?? '未记录'}），请修订 ${result.skillId} 后再次调用学习工具，不要仅解释或让玩家手动做。还允许 ${3 - count} 次。错误：${result.error}\n执行轨迹：${result.traceJson}`)
    if (budget.count(sessionId) === count) return // no tool action: never loop on promises
  }
}

export function learningOutcomeReply(outcome?: LearningOutcome): string {
  if (outcome === undefined) return '这轮没有确认到学习结果，暂时不能确认是否已试跑或学会。'
  if (outcome?.success) return outcome.learned
    ? '这次实际做成功了，已经保存为技能。下次可以直接让我做。'
    : '已经按保存的技能完成了。'
  if (outcome.failureStage === 'compile') return '代码检查没有通过，这次还没开始游戏试跑，也没有保存新技能。'
  if (outcome.failureStage === 'preflight') return '技能在准备阶段遇到问题，这次还没开始游戏试跑，也没有保存新技能。'
  if (outcome.failureStage === 'verification') return '这次没有满足完整的技能验收条件，还没有学会，也没有保存新技能。'
  if (outcome.failureStage === 'cancelled') return '已经停止，这次没有学会新技能。'
  const error = outcome.error ?? ''
  if (/取消|abort/i.test(error)) return '已经停止，这次没有学会新技能。'
  if (/附近没有|目标.*(离开|消失)/.test(error)) return '这次没有找到可用的目标，还没有学会。等附近有合适目标时再继续。'
  if (/容器/.test(error)) return '小汤圆的容器没有空位，这次还没有学会。先腾出位置再继续。'
  if (/暂停|断开|连接|超时|过期/.test(error)) return '这次游戏没有及时完成动作，我已停止等待，也没有保存新技能。请先确认游戏没有暂停、连接正常。'
  if (outcome.failureStage === 'execution') return '技能执行阶段没能完成，这次还没有学会，也没有保存新技能。'
  return '这次未能完成技能流程，还没有学会；不会把未确认的结果当成成功。'
}

export function registerSkillTools(
  ctx: Context,
  adapter: AdapterHello | undefined,
  skills: SkillService,
  executor: GameAtomExecutor,
  budget = new LearningTurnBudget(),
): void {
  const gameId = adapter?.gameId ?? 'unknown'
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start' || event.type === 'turn/end') budget.reset(String(session.id))
  })
  const available = skills.store.list(gameId)
  const declaredAtoms = adapter?.atoms ?? []
  const allowedAtoms = new Set(declaredAtoms.length > 0
    ? declaredAtoms.map(atom => atom.name)
    : (adapter?.capabilities ?? []).filter(capability =>
        !capability.startsWith('assistant.') && !capability.startsWith('speech.') && !capability.startsWith('game.atom.')))
  const atomCatalog = declaredAtoms.length === 0
    ? [...allowedAtoms].join('、')
    : declaredAtoms.map(atom => `${atom.name}：${atom.description}；参数 ${atom.parameters}；返回 ${atom.returns}`).join('\n')
  registerPlayerAdviceTools(ctx, gameId, allowedAtoms, executor)
  registerSwordFormationTools(ctx, gameId, allowedAtoms, executor, supportsPreviewHandoff(declaredAtoms), supportsChopSweep(declaredAtoms), supportsSwordPower(declaredAtoms))
  if (gameId === 'dont-starve-together' && ['dst.inspect_companion', 'dst.move_to', 'dst.pick_target', 'dst.find_nearest_entity', 'dst.collect_items'].every(atom => allowedAtoms.has(atom))) {
    ctx.tools.register(defineTool({
      name: 'xiaotangyuan_gather_resources',
      description: '玩家明确要求采集植物资源时使用。有限次寻找、移动、原生采摘、拾取后核对容器增量，并返回出发位置；遇到攻击者或掉血停止采集。草丛 grass 产物 cutgrass，树苗 sapling 产物 twigs。只支持附近植物，不保证识别全部环境危险；不是学习或保存技能。先简短告知再执行，禁止用于普通询问。',
      parameters: { plantPrefab: { type: 'string', required: true }, itemPrefab: { type: 'string', required: true }, quantity: { type: 'number', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {
        success: { type: 'boolean', required: true }, acquired: { type: 'number', required: true }, returned: { type: 'boolean', required: true }, message: { type: 'string', required: true },
      } }, render: (_args, value) => [{ type: 'text', text: value.message }] },
      execute: (args, exec) => gatherResources(args, executor, exec.signal),
    }))
  }
  ctx.tools.register(defineTool({
    name: 'xiaotangyuan_skill_inspect',
    description: '读取指定已验证技能版本的源码、参数使用方式及说明，供组合技能复用；不执行游戏动作。',
    parameters: { skillId: { type: 'string', required: true }, version: { type: 'number', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { definitionJson: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.definitionJson }],
    },
    execute: async args => {
      const record = skills.store.verifiedVersion(gameId, args.skillId, args.version)
      if (!record) throw new Error('没有找到已验证的技能版本；不能将未经试跑的源码作为子技能')
      return { definitionJson: JSON.stringify({ id: record.id, version: record.version, description: record.description,
        program: record.program, acceptance: record.acceptance }) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'xiaotangyuan_skill_run',
    description: `执行小汤圆已经通过试跑学会的游戏技能。已有专用工具的能力直接调用专用工具，不需要重新学习；成功与否只以工具结果为准。当前已学习技能：${available.length === 0 ? '暂无；这不影响已有专用工具的使用' : available.map(skill => `${skill.id}（${skill.triggers.join('、')}）`).join('；')}`,
    parameters: {
      skillId: { type: 'string', required: true, description: '要执行的技能 ID。' },
      argumentsJson: { type: 'string', description: '可选 JSON 对象，作为技能 params 输入，默认 {}。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          skillId: { type: 'string', required: true },
          skillVersion: { type: 'number', required: true },
          message: { type: 'string', required: true },
          traceJson: { type: 'string', required: true },
          error: { type: 'string' },
          failureStage: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.message}\n执行轨迹：${value.traceJson}` }],
    },
    execute: async (args, exec) => {
      const result = await skills.run(gameId, args.skillId, allowedAtoms, executor, exec.signal, parseSkillArguments(args.argumentsJson))
      budget.record(String(exec.agent?.id ?? 'unscoped'), { success: result.success, learned: false, skillId: result.skillId,
        ...(result.failureStage === undefined ? {} : { failureStage: result.failureStage }),
        traceJson: JSON.stringify(result.trace), ...(result.error === undefined ? {} : { error: result.error }) })
      return {
        success: result.success,
        skillId: result.skillId,
        skillVersion: result.skillVersion,
        message: result.success ? '技能执行成功。' : `技能执行失败：${result.error}`,
        traceJson: JSON.stringify(result.trace),
        ...(result.failureStage === undefined ? {} : { failureStage: result.failureStage }),
        ...(result.error === undefined ? {} : { error: result.error }),
      }
    },
  }))

  if (allowedAtoms.size === 0) return
  ctx.tools.register(defineTool({
    name: 'xiaotangyuan_skill_learn',
    description: `学习或修订技能：生成受限源码，安全编译、真实试跑、独立验收后才保存。失败根据 failureStage、traceJson 和 nextAction 处理；编译或准备失败不代表已经试跑。retryable=true 时必须修订原 skillId 后再试，每轮最多三次；环境、取消或连接错误停止，不得教玩家手动操作来冒充学会。已有技能优先用 run，不要重复新建。\n语法：let x = await atom("目录中的名字", { 参数 });、if/else、repeat(1到10)、try/catch、assert(条件,"原因")、fail("原因")、break；条件支持 exists、!、===、!==、==、!=、比较及 &&、||，两种相等写法都是严格比较，不做类型转换。禁止任意 JS、文件、网络、模块和无限循环。只有下面目录里的名字可以调用，不要臆造通用找物或 say 动作。按当前任务的成功条件组合通用原子：寻找实体后把 targetId 传给攻击；拾取时显式指定 prefab/prefabs，并使用攻击结束回执中的 x/z，不能沿用发现目标时的旧位置。遵守任务契约中各步的结果绑定，不要猜测坐标或目标 ID。一次攻击成功不等于击杀，必须检查 defeated；拾取必须检查 count。只有目录中声明的能力可用，缺少基础动作时明确报告，不得修改 Mod 或臆造能力。\n原子能力目录：\n${atomCatalog}`,
    parameters: {
      skillId: { type: 'string', required: true, description: '稳定技能 ID，例如 dst.hunt-and-collect-butterfly。' },
      name: { type: 'string', required: true, description: '简短技能名称。' },
      description: { type: 'string', required: true, description: '技能要完成的目标。' },
      triggers: { type: 'string', required: true, description: '逗号分隔的玩家触发说法。' },
      sourceCode: { type: 'string', required: true, description: '受限 TS 风格源码。可用 let r = await skill("已验证技能ID", 固定整数版本, {参数}); 组合技能，用 params.字段 读取输入，用 return 返回安全 JSON 值。只能调用已保存且 verified 的版本，不能递归；父子共享60次原子、30次技能调用、4层深度及取消信号。' },
      trialArgumentsJson: { type: 'string', description: '本次真实试跑的 params 输入，JSON 对象；默认 {}。程序用 assert 检查必需字段。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          learned: { type: 'boolean', required: true },
          category: { type: 'string', required: true },
          retryable: { type: 'boolean', required: true },
          nextAction: { type: 'string', required: true },
          skillId: { type: 'string', required: true },
          version: { type: 'number', required: true },
          message: { type: 'string', required: true },
          traceJson: { type: 'string', required: true },
          error: { type: 'string' },
          failureStage: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.message}\n失败阶段：${value.failureStage ?? '无'}\n分类：${value.category}；允许修订重试：${value.retryable}\n${value.nextAction}\n执行轨迹：${value.traceJson}` }],
    },
    execute: async (args, exec) => {
      const sessionId = String(exec.agent?.id ?? 'unscoped')
      budget.reserve(sessionId, args.skillId)
      const attempt = await skills.tryLearnSource({
        gameId, skillId: args.skillId, name: args.name, description: args.description,
        triggers: args.triggers.split(/[,，]/).map(item => item.trim()).filter(Boolean),
        sourceCode: args.sourceCode,
        trialArgs: parseSkillArguments(args.trialArgumentsJson),
        ...(budget.acceptance(sessionId) === undefined ? {} : { acceptance: budget.acceptance(sessionId)! }),
      }, allowedAtoms, executor, exec.signal)
      const version = attempt.learned?.version ?? attempt.result.skillVersion
      budget.record(sessionId, { success: attempt.result.success, learned: attempt.learned !== undefined,
        skillId: attempt.result.skillId, traceJson: JSON.stringify(attempt.result.trace),
        ...(attempt.result.failureStage === undefined ? {} : { failureStage: attempt.result.failureStage }),
        ...(attempt.result.error === undefined ? {} : { error: attempt.result.error }) })
      const advice = attempt.result.success
        ? { category: 'success', retryable: false, nextAction: '已保存；下次用技能执行工具复用，不要重新编写。' }
        : skillFailureAdvice(attempt.result.error)
      if (!advice.retryable) budget.stop(sessionId)
      return {
        ...advice,
        success: attempt.result.success,
        learned: attempt.learned !== undefined,
        skillId: attempt.result.skillId,
        version,
        message: attempt.learned === undefined
          ? `${learningOutcomeReply(budget.outcome(sessionId))}\n错误：${attempt.result.error ?? '未提供详细原因'}`
          : `我实际做成功了，已经把“${attempt.learned.name}”记成第 ${version} 版技能。`,
        traceJson: JSON.stringify(attempt.result.trace),
        ...(attempt.result.failureStage === undefined ? {} : { failureStage: attempt.result.failureStage }),
        ...(attempt.result.error === undefined ? {} : { error: attempt.result.error }),
      }
    },
  }))
}
