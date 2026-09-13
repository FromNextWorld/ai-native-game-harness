# 剑阵砍树增强与实时状态整合交付

2026-09-13 02:29，源码整合、联合自动回归、本机增量更新、后台启动验证完成。**真实游戏和真人语音待验收。** 本轮未提交/推送、未重制正式安装器，未改其他任务或派发子代理。

## 整合内容

- 在 `C:/game/ai-native-game-harness-worktrees/source-unified-20260909` 保留砍树增强：默认8崽，每崽最多12次原生斧击、最多集中处理4棵合格普通成年树，以实际倒树数汇报。保留原生斧头能力/掉落、树桩及受保护树，不保证所有游戏条件下必倒4棵。
- 从 `C:/game/deepseekharness/.artifacts/sword-screen-merged-20260912` 的验证源码和原始基线三方合并：HUD冷却/可见状态、两路观察、当前与历史上下文状态隔离、注册工具与两路Gateway急停的真实回执文案。
- 保留原有顺时针4正4背单剑、preview条件接续及原60秒时限、首轮正常回复/播放完成后的动作判断、紧急停止、语音取消、Work和学习边界。捕鱼仍最多3次原生抽取，战斗伤害不变。
- 生产文件：ProjectileGroup、SwordResourceTargets、StardewGameAdapter、GameObservationBuilder、ModEntry；TS剑阵编排、Gateway、SkillTools/SwordTools、game-context、projectile-live-state、context-history和game-agent-session。另合并对应测试。app.asar、Desktop共享入口、依赖/锁文件、供应商配置、Key、账户和存档未改。
- 17文件三方合并计划和前态备份在证据根的merge-plan.json及before/。其中screen基线测试Program后来附加了RED断言：仅移除该明确段落即可精确恢复其记录的原SHA256，再进行合并；未把哈希不符视作可忽略。

## 自动化证据

证据根：`C:/game/deepseekharness/output/sword-integrated-20260913`。

|阶段|结果|边界|
|---|---|---|
|已安装screen原生版反证|倒树两例因目标断言失败；捕鱼/战斗两例通过|旧版8次斧击伤8棵、倒0棵；old-strength.json，另外7例未选中|
|合并插件联合回归|19文件174通过，0失败，0跳过|final-tests.json；真实Agent/模型请求/工具/Gateway、原生桥接、上下文/急停/Work等|
|原生画面|33通过|实际生产渲染调用、控制器和观察；外部GPU/游戏模拟|
|原生生命周期/RPC|229项通过|生产控制器、真实本地WebSocket；不是游戏中实测|
|作用范围|21项通过|原有范围与保护回归|
|TS、Mod编译|通过，Mod0警告0错误|candidate-dist/与mod-build/|

测试世界用生命值12、斧头威力1验证48次有效原生斧击砍倒4棵；这些是外部测试参数，不是对原版数值的声明。生产Tree包装器与ProjectileGroup实际执行；高血量96击无倒树时返回未完成，单树不重复计数，取消后不再施加效果。

首次联合跑有2例沿用旧隔离目录的native-state.json路径而失败（test-layout-failure.json），修为显式传入当前原生生成证据后全量重跑。它们是测试路径错误，不计作旧行为反证。

复测命令：在PowerShell执行证据根 `test-integrated.ps1`。它编译原生桥、生成native-state.json，显式设置AGH_PROJECTILE_BRIDGE和AGH_PROJECTILE_STATE_FIXTURE，跑19文件联合测试及构建。**本轮仍未将这些检查接入正式CI/打包硬门禁；未设变量时原生集成用例会跳过。** 未测真实供应商延迟，不宣称真实语音/游戏验收完成。

## 安装与启动

- 候选及安装记录：`stage-cm4muA/manifest.json`、`installed.json`、`runtime-verification.json`、`gateway-ping.json`。
- 安装前确认应用和游戏均退出；未强杀任何进程。34个目标全部按清单校验后替换：4个变更模块的JS/声明/映射在Runtime/Profile各一份，共32；内置恢复归档1；Steam Mod DLL1。
- 对比所有非变更编译JS与包内容，保留已安装实时状态代码及其他修复；原生源码对照screen已装版本，仅ProjectileGroup/SwordResourceTargets发生功能差异。爷爷素材与DLL内嵌哈希一致。
- 当前归档SHA256：`3fc28d0135e883333d9129eb03795d456ef04eb845865645095e5c2b3c134b17`。
- 当前DLL SHA256：`4ac7669b06460975a2f00a8adc2ff9a90259aff9f9f223fdb648fcfee24eb2b1`。
- 备份：证据根 `installed-before-8gFIqq`。旧候选/备份不代表现在应使用的版本。
- 正常启动主进程82628、Runtime66880；Web `http://127.0.0.1:55857` 返回200，33145归属于本安装Runtime，实际gateway.ping返回pong:true。
- 活动Profile依赖已自动切换至新SHA256内容寻址归档；启动后34目标、保护文件及恢复包再次一致，没有新增启动fatal。哈希和健康检查证明版本/服务加载，不替代游戏效果。
- AG-harness有意保持运行供用户测试，星露谷未启动。运行中的多个进程不是退出残留；本轮保留现有退出修复，但未新增一次真人正常退出验收。

## 现在怎么验收

背包带斧头，在附近6格内有多棵普通成年树的位置，语音“万剑归宗”→“帮我砍树”。应先说话再执行，连续命中后实际倒树，并按倒树数汇报；再说“收回剑阵”，检查动作立即停、回收动画/冷却显示一致。

在水边测“召唤→捕鱼”，在已解锁战斗、附近有怪物的安全位置测“召唤→打怪”；确认实际掉落和血量变化，不能只看气泡。木材仍由原版掉落，不自动拾取；不砍果树、挂树液器或受对象保护的树。
