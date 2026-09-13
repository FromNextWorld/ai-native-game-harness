import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GameAtomExecutor } from '../runtime/skills/contracts.js'
import { keepItemAdvice, dayAdvice, npcRouteAdvice } from '../runtime/tasks/stardew-advice.js'
import { dstAdvice } from '../runtime/tasks/dst-advice.js'

export function registerPlayerAdviceTools(ctx: Context, gameId: string, atoms: ReadonlySet<string>, executor: GameAtomExecutor): void {
  if (gameId === 'dont-starve-together' && atoms.has('dst.inspect_player')) {
    ctx.tools.register(defineTool({
      name: 'xiaotangyuan_dst_advice', description: '只读检查：trip 出门/过冬准备，recipe 配方缺料，death 本次登录死亡事件复盘。依据实时游戏数据，不能把攻击记录当作确定死因；不执行行动。',
      parameters: { kind: { type: 'string', required: true }, recipe: { type: 'string' } },
      output: { schema: { type: 'object', additionalProperties: false, properties: { message: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.message }] },
      execute: async (args, exec) => {
        if (!['trip', 'recipe', 'death'].includes(args.kind)) throw new Error('不支持的检查类型')
        if (args.kind === 'recipe' && !/^[a-z][a-z0-9_]{0,79}$/.test(args.recipe ?? '')) throw new Error('请指定有效配方 ID')
        return { message: dstAdvice(await executor('dst.inspect_player', args.recipe ? { recipe: args.recipe } : {}, exec.signal), args.kind) }
      },
    }))
    return
  }
  if (gameId !== 'stardew-valley' || !atoms.has('stardew.inspect_planning')) return
  ctx.tools.register(defineTool({
    name: 'xiaotangyuan_stardew_advice', description: '只读检查当前存档：keep 检查献祭/交物留物；day 检查今日任务、身体状态和升级水壶时机；mine 检查下矿工具和食物；route 查 NPC 位置和跨地图出口指引。先查事实，不保证物品可卖或门禁已通，不自动操作。',
    parameters: { kind: { type: 'string', required: true }, item: { type: 'string', description: 'keep 时必填物品名；route 时必填 NPC 名称' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { message: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.message }] },
    execute: async (args, exec) => {
      if (!['keep', 'day', 'mine', 'route'].includes(args.kind)) throw new Error('检查类型只能是 keep、route、mine 或 day')
      if (['keep', 'route'].includes(args.kind) && (!args.item?.trim() || args.item.length > 80)) throw new Error('请指定物品或 NPC 名称')
      const evidence = await executor('stardew.inspect_planning', args.kind === 'route' ? { kind: 'route', npc: args.item! } : { kind: args.kind === 'keep' ? 'inventory' : 'day' }, exec.signal)
      return { message: args.kind === 'keep' ? keepItemAdvice(evidence, args.item!) : args.kind === 'route' ? npcRouteAdvice(evidence) : dayAdvice(evidence, args.kind === 'mine') }
    },
  }))
}
