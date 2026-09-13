# 小汤圆单剑队形：四正面 / 四背面

## 交付状态

已修改统一工作区源码并编译 Mod；用户随后确认“更新把”，已于 2026-09-11 16:43 完成 Steam Mod 热更新和哈希校验。未重新制作 Harness 安装器、未实机/麦克风验收，也未提交或推送。重新使用 SMAPI 启动星露谷后可验收本轮效果。

本轮只处理星露谷剑阵的视觉实现，不是整个 Harness、语音时序或办公模块的全面修复。

## 实际变化

- 默认 8 只：固定、对称的椭圆槽位，上半圈取原素材背面 x=128，下半圈取双眼正面 x=0；不取左右独眼侧面。1..12 数量参数仍支持，其他偶数数量正反均分，奇数相差至多 1。
- 身体缩放由 0.6 改为 0.4，主小汤圆和原 PNG 不变。每只绘制一处短深色剑柄、一只握剑手、小金色护手及一条绿色剑刃；护手不再画成两侧绿色长翼。
- 待机槽位不随时间旋转，跟随同伴位置。旧协议 `fan` 名称保留，蓄力阶段显示等距双列；默认 8 只为每列 4 只。无伤演示飞行保持平行方向；实战/砍树/捕鱼继续追踪真实目标，不用错误的显示轨迹掩盖碰撞位置。
- 正常完成或语音原子收回后，游戏操作立即进入终态、remaining=0、清空活动投射物；另存最多 1 秒的纯绘制回队数据。0.75 秒内沿环外插值返回，随后短暂停在槽位再消失。正反朝向依槽位固定，剑刃依当前位置朝外，不穿过主角。
- 回队数据只保存位置、场景、玩家和起始时间，不保留怪物引用、资源回调或开放的操作回执。不会追加伤害、鱼/木材/浇水成果或退款。重复取消不重播；新组清掉旧回队。
- 地图、死亡、菜单、事件、未进存档、同伴缺失、玩家变化、阻塞、断连/本地紧急停止、Reset 清掉回队。爷爷的独立门/水流/告别分支不变。

## 原测试为何漏掉

生产 `ProjectileRenderer` 原来硬编码 `(0,0,64,64)` 正面。原 `tests/projectiles/GameStubs.cs` 的渲染器是空实现；原有控制器/RPC 检查能证明动作计数，却无法发现全正脸或剑形问题。

新增 `tests/projectile-visuals` 直接编译生产 Geometry、Group、Renderer，通过外部游戏和 GPU 替身记录真正调用的 SpriteBatch 参数。没有模拟成“已经画了四正四背”。旧控制器测试只做渲染函数可选参数兼容，保留其原有验证边界。

## 反证与验证

基线保存于 `.artifacts/sword-visual-20260911/baseline`，是修改前的三个生产源文件。相同新测试针对基线运行：**2 通过 / 23 失败**；针对候选运行：**25 通过 / 0 失败**。

直接反证包括：front=8/back=0、固定槽位失败、0.6 缩放、背面纹理缺失仍被接受、蓄力为 8 条分散轨迹而非双列、绿色护手过宽。回队用例在旧版因没有回队绘制而失败；这些不意味着旧版有 23 个独立缺陷，尤其不能把“没有新增回队功能”说成原版地图清理错误。

测试搭建时补齐过 GPU 替身缺少的 Vector2 除法运算，这次编译错误不算反证。预览飞行断言从 0.75 秒改在 0.33 秒取样，因为首个 294px 飞行约 0.57 秒已正常结束；没有改变生产飞行速度或延长生命周期来迎合测试。

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| 新生产绘制回归 | 25/25 | 游戏/GPU 替身，不是真实显卡渲染 |
| 原投射物控制器 + 本地回环 WebSocket | 226 checks | 原生产控制器，游戏实体替身 |
| 田块范围 | 21 assertions | 范围计算，不是实机农田 |
| TS 剑阵编排 / 语音收回规则 | 26 + 16 = 42 tests | 没有真实 ASR、模型或 TTS 调用 |
| Mod Release 编译 | 0 警告 / 0 错误 | `EnableModDeploy=false` |
| 爷爷图集/嵌入资源检查 | 通过 | 四格有效透明素材与编译资源一致 |
| 本轮三份生产文件空白检查 | 通过 | `git diff --no-index --check` 对照基线 |

没有修改语音、Agent、Work、学习、模型配置或工具注册；已沿现有工具 → TS 编排 → GameAgentClient/主线程调度 → ProjectileGroup → Draw/回执检查入口。没有新增真实模型注册/回复先后验收，不能据这轮绘制结果声称 `REPLY_FIRST_ACCEPTANCE.md` 的全链路已通过。

新绘制测试尚未接入 CI 或安装器强制门禁，**尚无自动阻断**。已有版本号仍为 0.8.2，必须使用哈希区分本轮候选，不能按版本号判断已经安装。

## 复现命令（统一工作区根目录）

```powershell
$dotnetPath = 'C:/Users/10354/.cache/dotnet-sdk/dotnet.exe'
# 应失败：23 项新规格断言
& $dotnetPath run --project games/stardew-valley/tests/projectile-visuals/ProjectileVisuals.Tests.csproj -c Release -p:CombatSource=C:/game/ai-native-game-harness-worktrees/source-unified-20260909/.artifacts/sword-visual-20260911/baseline
# 应通过：候选生产源；同时捕获实际 Draw 参数
& $dotnetPath run --project games/stardew-valley/tests/projectile-visuals/ProjectileVisuals.Tests.csproj -c Release -- --capture .artifacts/sword-visual-20260911/draw-capture.json
& ./games/stardew-valley/tests/projectile-visuals/render-capture.ps1 -CapturePath .artifacts/sword-visual-20260911/draw-capture.json -OutputPath .artifacts/sword-visual-20260911/native-draw-preview.png
& $dotnetPath run --project games/stardew-valley/tests/projectiles/Projectile.Tests.csproj -c Release
& $dotnetPath run --project games/stardew-valley/tests/FieldScope.Tests.csproj -c Release
pnpm --filter @qimidandapigu/dsh-xiaotangyuan-game exec vitest run test/sword-formation.test.ts test/sword-recall.test.ts
& $dotnetPath build games/stardew-valley/adapter/StardewAgentMod.csproj -c Release -p:EnableModDeploy=false
& ./games/stardew-valley/tests/check-grandpa-art.ps1
```

原版 PNG 和录制的绘制参数生成了 `native-draw-preview.png`，并已检查四正四背、单剑、间距。它是软件回放的两倍显示，不是生成式概念图，也不是游戏截图。没有新增运行时依赖或修改 PNG。

## 源码与产物

基线 SHA256：

- Geometry: `D56D8F862D7961F0D5F888E22077FFBA2B54D774947F9EC31E0C62F51A84D78F`
- Renderer: `F98705311A725D12BA20F0776ACF0E7F6FFFBE3F9F6EB3966EBEC20D0BD660DD`
- Group: `0F7445B7431F79005432AC72E94C1F6D21F85659051916E52786EE168B8BD0BC`

候选 SHA256：

- Geometry: `C52F8AFFA0EDA18445F6678AE1B0FE1BF8C8608AB585EA01F476CFD3F6A55509`
- Renderer: `B776D341DF355C5516D06B4CE5F7B9282387AB98B371B774D83BBB9DF54945BD`
- Group: `D6CC3B021CE85947579CEC8521E42CD08713751E1C81D2B3DDBBB3EE8BE4D9EA`
- DLL: `EF0CE12A6A3418824C9847A2C57AAAA376BF376B5B3C064170C1AC400D1AEFEE`
- Mod ZIP: `FF3E9184F96B4DCA9E61EF5DA5B58A09A478F033E08428777EB0D963ACB948D0`
- 原/安装素材 PNG 一致且未改：`95FFA08A89AA318BA23A42E1C250173C3B8F3554416AE135E2B35E08BA2DE136`
- Steam 更新前 DLL（已备份）：`298253F2AEF02B09C92ADDAD1A4D73F8DA0D94BACEB91D6E8302D7DB9888F43A`
- Steam 更新后 DLL：`EF0CE12A6A3418824C9847A2C57AAAA376BF376B5B3C064170C1AC400D1AEFEE`

候选 DLL 和 Mod ZIP 已单独保存在 `.artifacts/sword-visual-20260911/candidate/`；本次 Release 没有独立 PDB，不将缺少 PDB 当成编译失败。热更新时，旧外部 PDB 已移入备份，避免残留不匹配的调试符号；可恢复。

修改文件为三个 Projectile 生产源、旧控制器测试的渲染签名、新 `projectile-visuals` 测试/软件回放脚本、本报告和当前 claim。未修改 Desktop/插件清单、根包/锁文件、打包脚本、供应商、账号、存档、其他游戏或原有小汤圆素材。

## 热更新证据与真实验收

1. 已核对：已装 DLL 与 `stardew-water-animation-20260910` 的 Grandpa 构建哈希一致；逐项比较其 58 项源码/素材快照，除本轮三个 Projectile 文件和 SDK 取代的手工 AssemblyInfo 外全部一致，未降级爷爷浇水等既有补丁。
2. 安装前及写入前均确认游戏/Harness 退出，未发现并行安装/构建进程。活动 Mods 中只有一个对应 manifest。仅替换 DLL，将旧 PDB 移至备份；其余 10 个 Mod/同伴文件（含配置和 Mod 内存档）前后哈希一致。未重装 Harness、未动用户设置和游戏存档；未启动/结束游戏或应用。
3. 更新前复跑 25 项绘制回归、226 项控制器/RPC 检查、完整 Mod 编译和爷爷嵌入资源检查，全部通过；新构建、冻结候选、安装后 DLL 哈希一致。结果记录在 `.artifacts/sword-visual-20260911/hot-update-installed.json`；备份在同目录 `hot-update-backup-20260911/`。
4. 当前 Harness `resources/game-installers` 仅有饥荒包，没有额外星露谷恢复 DLL。实际安装版 Stardew 安装模块通过远程归档安装、对同版本及较新版本执行保留；没有改历史备份或旧朋友安装包。删除 Mod 后的重新下载安装不承诺包含本轮本地补丁，正式发行包仍需另行封存和发布。

剩余真实验收：

1. 用 SMAPI 进入单人存档，召唤剑阵检查四正四背、缩小的身体、单剑、遮挡和 60 秒驻留；无伤演示检查队列与飞行。
2. 语音收回先确认立即停止实际效果，再观察 1 秒内回队消失；切图/菜单/断线不应保留回队。
3. 真实砍树/打怪/捕鱼以原生结果为准；这轮没有真人语音或实机结果。

本轮测试和编译命令已退出，没有启动游戏、Harness 或常驻测试服务；未结束其他任务/未知进程。系统共享 .NET 编译服务器若仍在运行不属于实机测试通过证据。
