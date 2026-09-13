import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { GameAtomExecutor, SkillValue } from '../skills/contracts.js'
import { reportRuntimeError } from '../error-diagnostics.js'

export const PROJECTILE_ATOMS = ['create', 'formation', 'launch', 'status', 'cancel'].map(action => `stardew.projectiles_${action}`)
/** Optional protocol extension; old Mods must not receive unknown parameters. */
export function supportsPreviewHandoff(atoms: readonly { name: string; parameters?: string }[] = []): boolean {
  return atoms.some(atom => atom.name === 'stardew.projectiles_create' && /\breplacePreviewOpId\??\s*:/.test(atom.parameters ?? ''))
    && atoms.some(atom => atom.name === 'stardew.projectiles_status' && /\bopId\?\s*:/.test(atom.parameters ?? ''))
}
export function supportsChopSweep(atoms: readonly { name: string; parameters?: string }[] = []): boolean {
  return atoms.some(atom => atom.name === 'stardew.projectiles_create'
    && /\bimpactsPerProjectile\??\s*:/.test(atom.parameters ?? '') && /\btargetLimit\??\s*:/.test(atom.parameters ?? ''))
}
/** Negotiate the entire bounded power profile; parameter names alone do not imply higher limits. */
export function supportsSwordPower(atoms: readonly { name: string; parameters?: string }[] = []): boolean {
  const parameters = atoms.find(atom => atom.name === 'stardew.projectiles_create')?.parameters ?? ''
  return /\bimpactsPerProjectile\??\s*:\s*integer\(1\.\.24\)/.test(parameters)
    && /\btargetLimit\??\s*:\s*integer\(1\.\.8\)/.test(parameters)
    && /\bfishRollLimit\??\s*:\s*integer\(1\.\.8\)/.test(parameters)
}
export interface FormationResult { success: boolean; preview: boolean; hits: number; damage: number; kills: number; message: string }
interface Receipt { opId: string; state: string; preview: boolean; count: number; remaining: number; hits: number; damage: number; kills: number; reason: string; resource?: string; resources?: number; impactsPerProjectile?: number; targetLimit?: number; targetsSelected?: number; targetsCompleted?: number; fishRollLimit?: number }
const terminal = new Set(['completed', 'canceled', 'failed', 'expired'])
function receipt(raw: unknown, id: string, preview: boolean, count: number): Receipt {
  const r = raw as Receipt | undefined
  if (!r || r.opId !== id || r.preview !== preview || r.count !== count
    || !['orbit', 'fan', 'launched', ...terminal].includes(r.state) || typeof r.reason !== 'string'
    || [r.remaining, r.hits, r.damage, r.kills].some(n => !Number.isSafeInteger(n) || n < 0)
    || r.remaining > count || r.hits > count || (terminal.has(r.state) && r.remaining !== 0)
    || (preview && (r.hits !== 0 || r.damage !== 0 || r.kills !== 0))) throw new Error('游戏返回的剑阵证据不完整或不匹配，不能判定成功。')
  return r
}

/** Choreography lives in TS. Mod atoms are short, bounded and task-independent.
 * An ACK only means started; success needs terminal + real health deltas.
 * Cleanup is the ONLY operation allowed a fresh signal after caller cancellation.
 */
export async function runSwordFormation(
  mode: 'summon' | 'preview' | 'cast' | 'chop' | 'fish' | 'water', count: number, executor: GameAtomExecutor, signal: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, signal) => delay(ms, undefined, { signal }),
  options: { reusePreview?: boolean; chopSweep?: boolean; powerBoost?: boolean } = {},
): Promise<FormationResult> {
  if (!['summon', 'preview', 'cast', 'chop', 'fish', 'water'].includes(mode) || !Number.isInteger(count) || count < 1 || count > 12) throw new Error('无效作业模式或数量（1到12）。')
  signal.throwIfAborted()
  const preview = mode === 'summon' || mode === 'preview', opId = randomUUID()
  const resource = mode === 'chop' || mode === 'fish' || mode === 'water' ? mode : undefined
  // Strategy belongs to TS. Native only exposes bounded impact/target budgets.
  const sweep = mode === 'chop' && options.chopSweep === true
  const impactsPerProjectile = sweep ? (options.powerBoost ? 24 : 12) : 1
  const targetLimit = Math.min(options.powerBoost ? 8 : 4, count)
  const boostedFish = mode === 'fish' && options.powerBoost === true
  const fishRollLimit = Math.min(boostedFish ? 8 : 3, count)
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(11_000)])
  let attempted = false, handedOff = false, last: Receipt | undefined, cleanupError = ''
  const call = async (action: string, args: Record<string, SkillValue> = {}) => {
    bounded.throwIfAborted()
    const r = receipt(await executor(`stardew.projectiles_${action}`, { opId, ...args }, bounded), opId, preview, count)
    if (sweep && (r.impactsPerProjectile !== impactsPerProjectile || r.targetLimit !== targetLimit || r.resource !== 'chop'
      || !Number.isSafeInteger(r.targetsSelected) || r.targetsSelected! < 1 || r.targetsSelected! > targetLimit
      || !Number.isSafeInteger(r.targetsCompleted) || r.targetsCompleted! < 0 || r.targetsCompleted! > r.targetsSelected!
      || !Number.isSafeInteger(r.resources) || r.resources! < r.targetsCompleted! || r.resources! > count * impactsPerProjectile))
      throw new Error('未收到匹配的连续斧击与倒树证据，不能宣称砍树完成。')
    if (boostedFish && (r.resource !== 'fish' || r.fishRollLimit !== fishRollLimit))
      throw new Error('未收到匹配的捕鱼次数上限，不能宣称捕鱼完成。')
    return r
  }
  let failure = ''
  try {
    let replacePreviewOpId: string | undefined
    if (options.reusePreview && mode !== 'summon' && mode !== 'water') {
      bounded.throwIfAborted()
      const active = await executor('stardew.projectiles_status', {}, bounded) as Receipt
      if (active?.state !== 'idle' || active.remaining !== 0) {
        if (!active || typeof active.opId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(active.opId)
          || typeof active.preview !== 'boolean' || !Number.isInteger(active.count) || active.count < 1 || active.count > 12)
          throw new Error('没有读到可靠的当前剑阵状态，未替换任何作业。')
        receipt(active, active.opId, active.preview, active.count)
        if (!active.preview || active.resource !== '' || !['orbit', 'fan'].includes(active.state))
          throw new Error('剑阵正在执行其他作业，请先说“收回剑阵”，再切换任务。')
        replacePreviewOpId = active.opId
      }
    }
    attempted = true // cancel even if create reply is lost after the native group starts
    last = await call('create', { count, preview, ...(resource ? { resource } : {}), ...(replacePreviewOpId ? { replacePreviewOpId } : {}),
      ...(sweep ? { impactsPerProjectile, targetLimit } : {}), ...(boostedFish ? { fishRollLimit } : {}) })
    if (last.state !== 'orbit') throw new Error(last.reason || '剑阵没有进入环绕状态。')
    if (mode === 'summon') {
      bounded.throwIfAborted()
      handedOff = true // native lifetime owns the group; do not occupy the conversation for 60 seconds
      return { success: true, preview: true, hits: 0, damage: 0, kills: 0,
        message: '崽崽剑阵已召唤，只环绕不攻击，最多保留 60 秒。说“收回剑阵”即可收回。' }
    }
    await wait(900, bounded)
    last = await call('formation', { formation: 'fan' })
    if (last.state !== 'fan') throw new Error(last.reason || '剑阵没有进入蓄力状态。')
    await wait(600, bounded)
    last = await call('launch', { spacingMs: 120 })
    if (last.state !== 'launched') throw new Error(last.reason || '剑阵没有开始出击。')
    for (let poll = 0; poll < 30; poll++) {
      await wait(200, bounded)
      last = await call('status')
      if (terminal.has(last.state)) break
    }
    if (last.state !== 'completed') throw new Error(last.reason || '未收到完整结束确认。')
    if (resource && (last.resource !== resource || !Number.isSafeInteger(last.resources) || last.resources! < 1 || last.resources! > (resource === 'fish' ? fishRollLimit : count * impactsPerProjectile))) throw new Error('没有核实到资源作业成果，不能说成功。')
    if (sweep && last.targetsCompleted! < 1) throw new Error(`本轮有 ${last.resources} 次有效斧击，但没有树被砍倒；已达到本轮上限，不会冒充完成。`)
    if (mode === 'cast' && (last.hits < 1 || last.damage < 1)) throw new Error('剑阵已结束，但没有核实到有效伤害，不算实战成功。')
  } catch (error) {
    const diagnostic = reportRuntimeError(error, { stage: 'game.sword-formation.execute', gameId: 'stardew-valley', requestId: opId })
    failure = `${error instanceof Error ? error.message : String(error)}（错误编号：${diagnostic.errorId.slice(0, 8)}）`
  }
  finally {
    if (attempted && !handedOff && last?.state !== 'completed') {
      try {
        const stopped = await executor('stardew.projectiles_cancel', { opId }, AbortSignal.timeout(3_000)) as { state?: string; remaining?: number }
        if (!stopped || stopped.remaining !== 0 || !['idle', ...terminal].includes(stopped.state ?? '')) throw new Error('游戏未确认剑阵已停止')
      } catch (error) {
        reportRuntimeError(error, { stage: 'game.sword-formation.cleanup', gameId: 'stardew-valley', requestId: opId })
        cleanupError = '未收到收回确认，不能保证已经停止；请再次说“收回剑阵”。本地剑阵最晚在召唤后 60 秒失效。'
      }
    }
  }
  const success = !failure && last?.state === 'completed'
  const chopMessage = sweep
    ? `本轮砍倒 ${last?.targetsCompleted ?? 0} 棵普通成年树${(last?.targetsSelected ?? 0) > (last?.targetsCompleted ?? 0) ? `，还有 ${last!.targetsSelected! - last!.targetsCompleted!} 棵未倒` : ''}；树桩保留，木材由原版掉落，未自动拾取。`
    : `砍树结束，核实 ${last?.resources ?? 0} 次有效斧击；不代表整棵树已砍倒，请查看现场木材掉落。`
  return { success, preview, hits: last?.hits ?? 0, damage: last?.damage ?? 0, kills: last?.kills ?? 0,
    message: success ? (resource ? (resource === 'water' ? `爷爷浇好了 ${last!.resources} 块干地，已经回去了。` : resource === 'fish' ? `飞剑捕鱼结束，生成 ${last!.resources} 条鱼，掉落在玩家旁边。` : chopMessage) : preview ? '崽崽剑阵演示结束，未造成游戏伤害。' : `剑阵结束：核实 ${last!.hits} 次有效命中、${last!.damage} 点伤害、${last!.kills} 只击杀。`)
      : `剑阵未完成：${failure} ${cleanupError}`.trim() }
}
