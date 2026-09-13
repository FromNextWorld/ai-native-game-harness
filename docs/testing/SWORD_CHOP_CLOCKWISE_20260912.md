# 召唤后砍树、顺时针剑阵与动作结果反馈

## 当前边界

2026-09-12：源码、候选编译和相关自动测试通过，34个目标文件已增量安装并核对哈希。首次安装因仍有5个进程在写入前拒绝；用户随后允许结束残留，再核验时这些进程已自行退出，无须强制结束。安装记录见 `stage-HJOClL/installed.json`。已启动更新后的 Harness，17:27核验运行进程43636属于安装目录，33145监听、Web57742返回200，新归档已进入活动Profile恢复依赖，34/34目标哈希与保护文件均一致，启动段无fatal load failure；真实游戏待验收。

不提交、不推送；不改变供应商、账户、存档、其他游戏、原始素材。没有真实麦克风/真实星露谷斧击验收，不能说实机全通过。

## 查明的旧错误

1. 实际 Runtime 日志 `2026-09-12T08:41:35.742Z`（北京时间16:41:35），`game.sword-formation.execute`，requestId `56699d98-0e73-4607-af4c-c1f6be47cf15`：**已有投射物组，请先停止。** 随后 `adapter.action.rejected` 的 atom 是 `sword:chop`。语义判断确实选中了砍树，不是仅根据气泡猜测。
2. `runSwordFormation` 每个请求生成新 UUID 并 create；原生 `ProjectileGroup.Create` 禁止任何已有组，所以“召唤→砍树”必然被原环绕组拦住。失败清理只取消新的 UUID，原环绕继续。这是本次不出击的已证实原因。
3. Gateway 发送 `assistant.action.result`，但原 `GameAgentClient` 未处理这个通知。玩家只看到事前回复，看不到真实失败结果。
4. 原 Geometry 的 orbit 忽略 seconds。这是旧固定队形规格，本次用户明确要求顺时针旋转，不能继续把旧测试当作当前规格。

## 修复与不变量

- status 可省略 opId 只读当前组；create 新增可选 `replacePreviewOpId`。在主线程内核对 UUID、原组必须是未发射的无伤 preview、同一场景和玩家；工作组/过期组/取消组/已更换组不能被覆盖。
- 先验证目标、能力、素材、体力，再原子交接；失败仍保留原环绕。重复请求不重复扣体力或产生资源，取消墓碑不复活。继承原组剩余时限，不重置成新的60秒。
- TS 从实际 Adapter 的参数声明检测这项可选扩展；旧 Mod 保持旧调用格式，不盲发未知参数。Gateway 后置动作和已注册 Skill 工具均已接入。爷爷 water 入口仍维持已有独立作业规则。
- 普通动作仍在真实回复/播放完成后才判断和执行；未修改 ASR、TTS 或前轮取消修复。取消后不把过期动作结果覆盖新一轮。
- orbit 以正角速度在屏幕坐标中顺时针运动，正常游戏帧率下约10秒一圈；等距椭圆、身体直立、单剑向外、默认四正四背。经过水平轴时用左右侧作为朝向平局规则，避免短暂5正3背。出击轨迹仍追实际目标，保留墙体碰撞，不用视觉假飞行代替游戏效果。
- 游戏客户端接收实际动作结果并通过既有主线程气泡入口显示；失败不是成功，斧击次数不是整棵树砍倒，也不是木材已拾取。此结果反馈是文本气泡，未新增一轮付费语音播报。

## 测试反证与漏验修复

旧测试的执行器只给单次调用返回成功回执，没有“先召唤留在场上，再调用砍树”的真实状态连续性；仅渲染或单次编排测试无法抓住该错误。

新增 `test/sword-handoff-native.test.ts` 通过 JSON-lines 驱动真实 C# ProjectileGroup；只模拟外部游戏实体/时间/资源回调，不把 create、launch、完成状态 mock 为成功。`sword-reply-production.test.ts` 使用实际 DSH Agent 注册、模型请求目录、Gateway、播放门控，再连接真实 C# 控制器。原生 WebSocket 测试也接到实际主线程控制器，并验证动作通知到 Presentation 事件。

- 旧 Geometry/Group/Renderer 跑新视觉断言：25通过、1失败，明确失败“没有顺时针转过四分之一圈”。
- 旧 TS 编排 + 旧原生控制器：首批4例1通过、3失败；核心用例因“已有投射物组”而 success=false、未产生斧击失败，不是编译错误。
- 旧 GameAgentClient：真实本地 WebSocket 发动作结果，Presentation 事件断言失败。
- 候选相关 TS 回归：**121通过、0失败、0跳过**，覆盖语音、取消、游戏会话、Gateway、学习意图、Work时序、剑阵及新增原生接续。
- 候选真实绘制调用：**26通过、0失败**；另有**229项**原生控制器/WebSocket检查、**21项**田块范围断言通过。
- 候选 Mod Release 构建：0警告/0错误；编译到独立输出目录，`EnableModDeploy=false`。候选 DLL 嵌入爷爷图集与原 PNG 哈希一致。
- 测试搭建中一次新联动断言漏写 executor 的第三个 signal 参数导致失败；补正断言后重跑通过。它不是产品回归或旧错反证。

这些是相关测试，不是全仓库 CI；原生游戏实体/显卡、ASR供应商/模型/TTS供应商仍属于测试替身。未改根 CI/打包硬门禁，尚无发行自动阻断。

## 产物与更新保护

证据目录：`C:/game/deepseekharness/output/sword-chop-clockwise-20260912`。

- `baseline/`：4个原生文件及旧 TS 编排；`regression-old-handoff.json` 为旧失败记录。
- `final-tests.json`：最终121项；`candidate-dist/`：独立 TS 输出。
- `mod-build/StardewAgentMod.dll`：`B17F523D78F43258AADBFA5446E4DD811F373BE9D6B734D0D5B74976B34022C1`。
- `stage-HJOClL/manifest.json`：8个本轮生产源哈希、34个计划更新文件的前后哈希、保护文件清单。
- 新插件归档 SHA256：`2d02b348b797b3921c3a535dfebf75a9c06689c4b2ea9f299c55e4f02516ba5e`。
- 准备时比较两个实际加载目录的**所有非本轮 JS 模块**，均与候选编译内容一致；归档仅改变4个模块对应文件。前轮 SpeechController、MiniMax/讯飞扩展和 app.asar 不变。
- Mod 源与已安装爷爷版本的完整58文件快照比较，仅本轮4个文件及历史生成的手写 AssemblyInfo 差异；原有其他补丁/图集保持。已装旧 DLL 同前次视觉更新记录的 `EF0CE12A...`。
- 安装范围：runtime/profile 两处4模块的 JS/声明/映射共32文件 +恢复tgz +Steam Mod DLL；不重装。首次安装尝试因仍有进程在写入前停止，未覆盖文件。
- 随后经用户授权，进程复查已全部退出，34文件安装成功；备份在 `installed-before-MrEjmg`，恢复依赖与新归档一致，证据为 `stage-HJOClL/runtime-verification.json`。未改其他10个Mod文件、app.asar、供应商扩展或已修复的SpeechController。
- 旧朋友安装器、历史备份及 dormant self-hosted profile 不属于本轮活动加载路径，不宣称全部更新。以后正式安装器或删除 Mod 后重新下载，仍需发行整合。

## 实机验收

1. 增量更新后，先启动 AG-harness，再用 SMAPI 进入单人存档。
2. 说“万剑归宗”：看8只单剑、四正四背、整圈顺时针旋转。
3. 背包有斧头，站在普通成年树附近6格内的空地，说“让剑阵去砍树”。不需要先收回。查看实际斧击/树木状态及结果气泡；挂树液器的树、树苗、果树不在当前普通砍树范围内。
4. 说“收回剑阵”应立即停止效果，回队动画最多1秒。重复召唤/新动作不额外扣费或重复掉落。
5. 缺斧头/无目标时显示原因并保留环绕；房屋/墙阻挡仍遵循原碰撞规则，不能把被挡住的动画说成砍树成功。
