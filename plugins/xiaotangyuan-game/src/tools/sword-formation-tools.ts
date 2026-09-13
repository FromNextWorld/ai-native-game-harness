import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GameAtomExecutor } from '../runtime/skills/contracts.js'
import { PROJECTILE_ATOMS, runSwordFormation } from '../runtime/tasks/sword-formation.js'
import { projectileStopMessage } from '../runtime/context/projectile-live-state.js'

export function registerSwordFormationTools(ctx: Context, gameId: string, atoms: ReadonlySet<string>, executor: GameAtomExecutor, reusePreview = false, chopSweep = false, powerBoost = false): void {
  if (gameId !== 'stardew-valley' || !PROJECTILE_ATOMS.every(atom => atoms.has(atom))) return
  ctx.tools.register(defineTool({
    name: 'xiaotangyuan_sword_formation',
    description: '玩家要求召唤剑阵或只说“小汤圆，万剑归宗”时用 summon：无伤环绕最多60秒，立即返回。收回剑阵/崽崽回来/停止剑阵调用停止工具。明确演示用preview，打怪用cast，砍附近普通成年树用chop，飞剑入水捕鱼用fish。只支持单人，一次作业；不得把有效斧击说成整树砍倒，不得把掉落说成已入包。'
      + (reusePreview ? '已召唤且尚未出击的环绕组可直接接续砍树、打怪、捕鱼或演示，不必先收回；正在作业的组仍须先停止。' : '旧适配器已有剑阵先收回，冷却结束后再换模式。')
      + (chopSweep ? `砍树一轮集中最多${powerBoost ? 8 : 4}棵普通成年树，每崽最多${powerBoost ? 24 : 12}次原生斧击，目标倒下即停；按实际倒树数汇报，保留树桩，不碰果树/树液器。` : '') + '不宣称学习保存技能。',
    parameters: { mode: { type: 'string', required: true, description: `summon 召唤环绕；preview 演示发射；cast 打怪；chop 附近普通成年树（背包需斧头，不碰挂树液器的树）；fish 飞剑入水，自定义捕鱼最多${powerBoost ? 8 : 3}次原生抽取，不保证每次有鱼` }, count: { type: 'number', description: '1-12，默认 8' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      success: { type: 'boolean', required: true }, preview: { type: 'boolean', required: true }, hits: { type: 'number', required: true },
      damage: { type: 'number', required: true }, kills: { type: 'number', required: true }, message: { type: 'string', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: value.message }] },
    execute: (args, exec) => runSwordFormation(args.mode as 'summon' | 'preview' | 'cast' | 'chop' | 'fish', args.count ?? 8, executor, exec.signal, undefined, { reusePreview, chopSweep, powerBoost }),
  }))
  ctx.tools.register(defineTool({
    name: 'xiaotangyuan_sword_formation_stop', description: '玩家说“收回剑阵”“崽崽回来”“停止剑阵”时立即调用，不再追问确认。取消当前本地投射物，不回滚已发生的伤害。必须收到确认才能说已收回。',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { message: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.message }] },
    execute: async (_args, exec) => {
      const result = await executor('stardew.projectiles_cancel', {}, exec.signal) as { state?: string; remaining?: number }
      if (!result || result.remaining !== 0 || !['idle', 'canceled', 'completed', 'expired', 'failed'].includes(result.state ?? '')) throw new Error('未收到停止确认，不能保证已经收回。请再次说“收回剑阵”。')
      return { message: projectileStopMessage(result, '已确认没有活动中的崽崽剑阵。') }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'xiaotangyuan_grandpa_water',
    description: '玩家明确说“爷爷，帮忙浇水”“爷爷浇地”“召唤爷爷浇水”时使用。幽灵爷爷端孟字碗从幽灵门出来，门内有奈何桥和汤圆孟婆，浇附近6格内最多12块干地后回门；单人、1点体力、8秒冷却。只改变耕地湿润状态，不影响记忆，不浇整张地图或室内花盆。说“爷爷回去吧”“爷爷歇会儿”可停止；已有剑阵先收回并等冷却。只按真实变湿计数汇报，少台词。',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { message: { type: 'string', required: true }, success: { type: 'boolean', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.message }] },
    execute: async (_args, exec) => {
      const result = await runSwordFormation('water', 12, executor, exec.signal)
      return { message: result.message, success: result.success }
    },
  }))
}
