import { isDeepStrictEqual } from 'node:util'
import type { SkillAcceptance, SkillRunResult, SkillStepTrace } from './contracts.js'

/** Generic contract interpreter: no game IDs, prefab names or task policy. */
export function verifySkillResult(run: SkillRunResult, acceptance?: SkillAcceptance): SkillRunResult {
  if (!run.success) return run
  const fail = (error: string): SkillRunResult => ({ ...run, success: false, failureStage: 'verification', error: '验收失败：' + error })
  const trace = run.trace.filter(step => step.success)
  if (trace.length === 0) return fail('没有实际执行任何游戏动作')
  if (acceptance === undefined) return run
  if (acceptance.version !== 1 || acceptance.steps.length === 0) return fail('任务验收契约无效')
  const matched: SkillStepTrace[] = []
  for (const expected of acceptance.steps) {
    const candidates = trace.filter(item => item.atom === expected.atom && item.index > (matched.at(-1)?.index ?? -1))
    const matches = (step: SkillStepTrace): boolean => {
      const result = step.result
      if (!result || typeof result !== 'object' || Array.isArray(result)) return false
      const fields = result as Record<string, unknown>
      for (const [name, value] of Object.entries(expected.arguments ?? {})) {
        if (!isDeepStrictEqual(step.arguments[name], value)) return false
      }
      for (const [name, value] of Object.entries(expected.equals ?? {})) {
        if (!isDeepStrictEqual(fields[name], value)) return false
      }
      for (const name of expected.positive ?? []) {
        if (typeof fields[name] !== 'number' || !Number.isFinite(fields[name]) || fields[name] <= 0) return false
      }
      for (const name of expected.nonEmpty ?? []) {
        if (!Array.isArray(fields[name]) || fields[name].length === 0) return false
      }
      for (const [name, reference] of Object.entries(expected.bindings ?? {})) {
        const prior = matched[reference.step]?.result as Record<string, unknown> | undefined
        if (prior?.[reference.field] === undefined || !isDeepStrictEqual(step.arguments[name], prior[reference.field])) return false
      }
      for (const [name, reference] of Object.entries(expected.resultBindings ?? {})) {
        const prior = matched[reference.step]?.result as Record<string, unknown> | undefined
        if (prior?.[reference.field] === undefined || !isDeepStrictEqual(fields[name], prior[reference.field])) return false
      }
      for (const [name, allowed] of Object.entries(expected.allowedItems ?? {})) {
        const items = fields[name]
        if (!Array.isArray(items) || items.length === 0 || !items.every(item => allowed.some(value => isDeepStrictEqual(item, value)))) return false
      }
      return true
    }
    // A single hit may succeed without killing. Accept a later verified hit in a bounded loop.
    const step = candidates.find(matches)
    if (!step) return fail('动作证据未满足任务契约：' + expected.atom)
    matched.push(step)
  }
  return run
}

export function skillFailureAdvice(error = ''): { category: string, retryable: boolean, nextAction: string } {
  if (/取消|abort/i.test(error)) return { category: 'cancelled', retryable: false, nextAction: '任务已停止；需要时重新发起。' }
  if (/暂停|连接|断开|超时|过期|繁忙|还在执行|容器|距离|附近没有|目标.*(离开|消失|死亡)|没有.*掉落/.test(error)) {
    return { category: 'environment', retryable: false, nextAction: '先恢复游戏连接或处理目标、距离、容器条件，不要反复重写代码。' }
  }
  return { category: 'program', retryable: true, nextAction: '根据错误和执行轨迹修订同一技能，最多三次；不要声称已经学会。' }
}
