# 剑阵砍树增强与捕鱼/战斗接续核验（2026-09-12）

## 状态

后续状态（2026-09-13）：**增强已与较新的实时状态/停止反馈修复整合，并安装到本机。** 174项联合插件回归通过，Runtime/Web/Gateway就绪；真实麦克风、游戏倒树/鱼掉落/怪物伤害验收未做。完整证据见同目录 `SWORD_INTEGRATED_20260913.md`。下文候选哈希和“待安装”为9月12日历史，不应再用旧候选覆盖当前安装。不提交、不推送、不重制整包安装器。

当前分支：`integration/source-unified-20260909`，目录 `C:/game/ai-native-game-harness-worktrees/source-unified-20260909`。不覆盖其他已有修改。

## 原因与变化

1. 上轮已修的接续问题：召唤存在无伤环绕组，砍树再次创建新组被“已有投射物组”拒绝；游戏客户端没有显示行动失败回执，留下“这就去砍树”的承诺。现在通过可选协议字段接续同玩家、同地点的未发射无伤组，并继承原60秒时限；回执通过原气泡入口显示，未增加第二段TTS。
2. 本轮实际强度问题：旧版8崽各一次原生斧击，通常分散给8棵树。有效击中不能等同整棵倒下。旧测试没有把真实倒树当完成标准。
3. 新版TS策略：默认8崽，最多选择最近4棵可砍普通成年树，每崽最多12次原生斧击；命中间隔至少0.08游戏秒且每帧至多一次。已倒/成桩/原生移除的目标立即停止，不重复累计倒树。高血量树超过预算仍不倒时如实报未完成。

保留原生斧头能力、原生伤害/倒树/掉落、单次1点小精灵体力、冷却、6格范围、墙体检查、单人限制和停止语义。不是直接删树、改树血量或凭空发木材。保留树桩；不砍果树、树液器树、目标格有对象的树；不自动捡木材。不保证任何场景必定砍倒4棵。

捕鱼和战斗均覆盖“先召唤，再接续执行”，并没有把斧击倍数带过去：捕鱼最多3次原生抽取，不保证每次都抽到合格鱼；战斗仍保持既有解锁条件与伤害预算。真实游戏是否能命中目标，仍取决于范围、可达性及游戏条件。

## 测试证据

证据目录：`C:/game/deepseekharness/output/sword-chop-strength-20260912`。

|证据|结果|边界|
|---|---|---|
|old-strength.json|2通过、2因倒树断言失败|冻结本轮修改前实现；8次斧击伤8棵、倒0棵；捕鱼/战斗接续已通过|
|final-tests.json|132通过、0失败、0跳过|13个相关测试文件，不是全仓所有测试|
|真实资源包装器增强用例|4棵倒树、48有效斧击；单可用树只计1棵|外部树生命值设12、斧头威力设1，是测试世界参数，不宣称为原版数值|
|预算/保护/取消|高血量96击无倒树返回失败；已停不再命中；无斧头不接管；保护树无命中|真实原子控制器和SwordResourceTargets，外部世界模拟|
|捕鱼/打怪接续|3次鱼抽取；8次战斗命中、64伤害|鱼抽取结果、怪物为固定外部测试世界；不是玩家真实奖励或伤害承诺|
|原生控制器/范围/视觉|229 / 21 / 26 项通过|控制器、真实回环WebSocket；无真实游戏/视觉体验验收|
|TS和Mod编译|通过；Mod0警告0错误|构建不等于真实游戏验收|

测试没有把生产执行器模拟成成功：生产TS编排 → 真实ProjectileGroup → 真实SwordResourceTargets → 外部Tree模拟原生斧击健康变化。另一个集成用例使用真实已注册Agent、工具目录与Gateway，确认真实回复/播放完成之前不执行，再由实际Adapter能力元数据启用新预算。外部模型、语音播放回执和游戏对象可模拟；不能据此宣称真麦克风/渲染验收。

原生桥接显式启用方式（在仓库根目录，候选原生测试DLL已编译）：

```powershell
$env:AGH_PROJECTILE_BRIDGE='C:/game/deepseekharness/output/sword-chop-strength-20260912/native/ProjectileVisuals.Tests.dll'
pnpm --filter @qimidandapigu/dsh-xiaotangyuan-game exec vitest run test/sword-strength-native.test.ts test/sword-handoff-native.test.ts test/sword-reply-production.test.ts
```

全相关结果来源还包括 asr-retry-regression、game-action-policy、game-session-lifecycle、gateway-lifecycle、learning-intent-boundary、speech-controller、speech-process-cancellation、sword-formation、sword-recall、work-voice-timing。**本轮未给全仓CI或打包建立硬性门禁；不设置桥接环境变量时部分原生集成测试会跳过。**

## 部署候选与保护

- 计划34个文件：4模块的JS/声明/映射，在Runtime和活动Profile各一份（32），插件恢复归档（1），Steam Mod DLL（1）。
- 候选目录：`C:/game/deepseekharness/output/sword-chop-strength-20260912/stage-dchG2B`。
- 插件归档SHA256：`7b72169657559dc0cb2d4a155dbab420b43b1ee68816009485d31c48e4f1f20c`。
- Mod DLL SHA256：`db5cdec33f2276c0b34c8edfdacb603049bc3256a5329b8d7f030c95e3a617f3`。
- `native-source-verification.json`：53原生C#文件对照爷爷快照，差异仅此前4文件及本轮SwordResourceTargets；此前Client/Geometry/Renderer保留，图集与候选DLL内嵌一致。安装清单共锁定59个源码/资源。
- 已比较全部非本轮模块的已安装JS、归档其他文件。app.asar、供应商插件、SpeechController及其他Mod文件保持哈希。安装脚本在源码漂移、既有安装漂移或进程仍在时拒绝覆盖。
- 尚未执行安装；启动后需确认恢复归档、活动Profile依赖、全部目标哈希、实际33145所属进程和新日志。哈希一致仅证明版本一致。

## 更新后人工验收

1. 背包带斧头，附近6格内有多棵普通成年树；语音召唤万剑归宗，然后让剑阵砍树。
2. 确认先正常说话再执行，顺时针四正四背、单剑；能连续命中，树实际倒下；按真实倒树数量汇报，树桩与原版掉落保留。
3. 再次执行时喊停，后续斧击应停止；无斧头/无合格树时说清楚原因，不能只承诺成功。
4. 分别在水边、已解锁战斗且附近有怪物的安全测试位置测试“召唤→捕鱼”和“召唤→打怪”；确认实际鱼掉落/怪物血量，不只看气泡。
