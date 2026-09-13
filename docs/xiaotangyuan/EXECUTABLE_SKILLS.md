# 小汤圆可执行技能（轻量版）

## 边界

共享 Harness 负责技能程序、校验、版本、执行轨迹、成功/失败统计和每游戏最多 5 个活跃技能。游戏 Adapter 在握手时公布原子能力的名称、用途、参数和返回值，并负责执行；Lua/C# Mod 才能调用游戏原生 API。

同一套 `xiaotangyuan-skill-v2` 运行时可供《饥荒联机版》《星露谷物语》和《缺氧》使用，但技能源码不能跨游戏照搬：三个 Adapter 分别提供自己的原子能力。`xiaotangyuan-skill-v1` 顺序程序仍支持解析，但能否执行取决于当前 Adapter 是否仍声明该程序使用的原子。

目前是 **TS 实现的受限解释器**，不是任意 TypeScript 执行环境。源码已经支持调用固定版本的已验证子技能；`SkillService` 在独立 Node 子进程中执行解释器，原子操作通过父进程代理。这是故障隔离，不是可执行任意第三方代码的 OS 级安全沙盒。正式安装版尚未切换，详见 [SKILL_SANDBOX_ALIGNMENT.md](./SKILL_SANDBOX_ALIGNMENT.md)。

## 程序格式

模型生成并修改 TypeScript 风格的技能源码：

```typescript
let target = await atom("dst.find_nearest_entity", {
  prefab: "butterfly",
  radius: 20
});

let attack = await atom("dst.attack_target", {
  targetId: target.targetId
});

if (attack.defeated == true) {
  await atom("dst.collect_items", {
    prefabs: ["butterflywings", "butter"],
    x: attack.x,
    z: attack.z,
    radius: 4
  });
} else {
  fail("没有击败目标");
}
```

源码由 Harness 自己的解析器编译成受限 AST，不使用 `eval` 或 Node `vm`。允许变量、`if/else`、最多 10 次的 `repeat`、`try/catch` 回退、`assert`、`fail` 和循环内 `break`。单次运行最多调用 60 个原子；源码最多 12000 字符、控制结构最多嵌套 8 层。

源码不能访问文件、网络、进程、模块或任意 JavaScript，只能调用 Adapter 握手中声明的原子能力。每次原子调用的参数、返回值和错误都会形成 trace；`catch` 不能静默吞错，必须调用回退原子、执行断言或明确 `fail`。

## 组合技能（源码已实现，尚未发布）

```typescript
// 前提：target.find 的第 1 版已经试跑并保存，且接口接收 prefab、返回 targetId。
let target = await skill("target.find", 1, {prefab:"butterfly"});
let hit = await atom("dst.attack_target", {targetId:target.targetId});
assert(hit.defeated == true, "尚未击杀");
return hit;
```

子技能使用 `params.prefab` 读取参数，用 `return` 返回安全 JSON 数据。学习工具的 `trialArgumentsJson` 提供试跑输入，执行工具的 `argumentsJson` 提供运行输入；用 `xiaotangyuan_skill_inspect` 查询固定版本的源码与说明，再按真实接口组合。当前是统一 JSON 安全类型检查加程序断言，尚未实现独立业务输入/输出 schema。

- 最多 4 层调用；整次运行共用 60 次原子和 30 次技能调用预算（包含根技能）。不能通过嵌套重置预算。
- 第一项游戏动作执行前，检查完整依赖图，包括未进入的分支。拒绝循环、递归、缺失/未经验证的版本及未授权原子。
- 版本固定，运行开始后克隆依赖快照；升级子技能不会静默改变父技能。历史版本被清理时明确报缺失，不自动降级。
- 子技能变量隔离；原子轨迹携带父子 `callPath`。子技能必须通过自己的验收，失败不能被父技能 catch 伪装成成功。
- 子进程不继承供应商密钥或 Node 启动选项，父进程重新检查能力白名单和调用次数；超时/取消时终止子进程，取消当前原子，保留已观察到的回执。
- 老技能没有 `verified` 标记时仍可按旧入口运行，但不能直接作为子技能；需要重新试跑保存。没有删除或自动改写旧技能文件。
- 当前组合对象是“已保存的低层技能”；同一轮自动规划并创建整棵新技能树尚未实现。

技能保存在用户 profile 目录的 `skills-v2.json`，记录源码和编译后的 AST。首次启动 v2 时会读取 `skills-v1.json` 并生成新文件，旧文件保留作为备份。每次候选源码及其编译错误或执行 trace 会先记入 `learningAttempts`；只有真实试跑完整成功，源码才会进入 `skills`。每个游戏默认最多 5 个活跃技能；第 6 个进入时，低成功率、低使用频率且较旧的技能会被标记为 `archived`，不会删除。

## 饥荒首个学习目标

系统不会内置完整技能。玩家提出教学目标后，模型根据 Adapter 公布的通用原子生成候选源码，并立即执行：

1. 按一个或多个 prefab 寻找最近实体。
2. 对支持 health/combat 的目标执行一次有限追击与攻击。当前不提供 `CHOP` 原子，不能宣称已支持砍树。
3. 按条件判断结果，必要时有限重试或执行回退方案。
4. 在目标位置拾取指定地面物品并放入小汤圆容器。
5. 任一步找不到目标、目标消失、超时或容器已满，都会把真实错误传回 Harness 并记录失败。

如果任一步失败，候选程序不会保存；模型只能依据 trace 修订后再次试跑。完整成功后才产生第 1 版技能，后续成功修订形成新版本。后续游戏只需实现自己的 Adapter 原子能力，不需要复制技能存储与运行时。

## 当前饥荒原子契约（源码，尚未热部署）

| 原子 | 参数与语义 | 不承担的任务规则 |
| --- | --- | --- |
| `dst.find_nearest_entity` | `prefab` 或 `prefabs` 必填，半径限制在 2–25；返回 `targetId/prefab/x/z`。支持生物及非战斗实体。 | 不自动选择蝴蝶、不判断整个技能完成。 |
| `dst.attack_target` | 指定 `targetId`，有限追击后攻击一次；返回实际 `defeated` 和目标位置。当前伤害沿用 Mod 的固定 1 点，不等同于玩家武器攻击。 | 不自动重复直到击杀、不决定是否捡物。未击杀不等于原子执行失败。 |
| `dst.collect_items` | 显式指定物品 prefab、中心位置和半径；可用 `excludeIds` 排除实体。将实际收到的物品放入同伴容器，返回 `count/items`。 | 不要求先打蝴蝶，不在 Mod 里保存蝴蝶掉落上下文。 |

攻击拒绝玩家、同伴及无战斗能力的对象；攻击前目标已死亡不能计作本次击杀。拾取中心限制在玩家附近。取消、连接丢失或租约过期时停止动作。

旧的 `dst.find_nearest_butterfly / dst.attack_butterfly / dst.collect_butterfly_loot` 不再公布。旧技能文件不删除、不静默改写；含旧名称的程序需要迁移并重新试跑。部署必须配套更新 Adapter、Mod 和插件，不能只替换其中一项。

## 任务验收与保存边界

- 任务层 `runtime/tasks/game-task-acceptance.ts` 生成验收契约；共享 `runtime/skills/skill-verification.ts` 只解释数据，不包含游戏 ID 或蝴蝶规则。
- 本轮“学习打蝴蝶”的模板冻结查找目标、攻击目标关联、真实死亡、指定地点实际拾取指定物品等条件。契约由任务层传入，不接受模型工具参数自行删除；修订期间保持不变，成功后随技能保存，重启运行仍验收。
- 执行过零个动作不能保存为成功。任务契约存在时，缺步骤、目标不一致、未击杀、空拾取或错误物品均不得保存。
- **覆盖边界：目前只有狩猎模板接入了自然语言任务识别。** 其他任务如果没有契约，目前只有通用执行成功检查，不能据此宣称任意自然语言目标已被独立验收。
- `count/items` 能证明收到指定物品，尚不能独立证明物品来自刚才那次击杀。通用场景快照与实体来源证据尚待补齐；`excludeIds` 是基础能力，不是已完成的因果验收。
- 本轮学习最多 3 次候选试跑，保持同一技能 ID。程序错误可有限修订，暂停/断开/目标消失等环境问题不反复重写代码。
