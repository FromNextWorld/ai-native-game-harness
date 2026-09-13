# 闲置状态条隐藏（含待装强力档）

- 用户要求：截图中的“剑阵未展开 · 可用”不应一直显示。
- 实现：ProjectileGroup.CaptureLiveState 的 hudVisible 要求正在执行、收回或仍有冷却；完全闲置时不绘制文字和底色。内部ready状态、回执和观察保留，语音气泡不变。
- 保持：此前强力档、实际动作/伤害/掉落、取消、真实回复和播放门控、冷却、爷爷、四正四背单剑顺时针、旧会话状态保护；共享热点/供应商/Key/存档未修改。

## 反证和验证

- 根目录：`C:/game/deepseekharness/output/sword-idle-hud-20260913`。
- `test-old-hud.ps1` + `old-hud.log`：冻结的强力档原生代码33通过、4项因“闲置文字或背景常驻”断言失败。首次旧用例等待60帧略少于原生返回动画的1秒，未到ready，记录为old-hud-initial.log；改为足够帧数后重跑，四例都因目标行为失败，而非编译/依赖错误。
- 候选：原生绘制37通过；控制器229、范围21通过；TS相关联合回归185通过、0失败、0跳过；TS和Mod构建成功，Mod0警告0错误。
- 四条新用例覆盖无剑取消的冷却结束、环绕/收回结束、战斗完成、爷爷浇水返回。断言真实Draw绘制调用中没有文字和背景，并检查实际GameObservationBuilder仍报告ready及hudVisible=false。
- 外部游戏世界/GPU、模型和部分语音为模拟；非真实存档/麦克风验收。原生集成需显式启用，尚无CI或正式打包硬门禁。

## 安装

- 最新候选为 `stage-yDShza/manifest.json`，取代此前未安装的power候选；安装前核实Harness和星露谷均已退出，没有强杀或自动关闭窗口。
- 34文件增量安装成功，179源文件锁定、457保护文件不变；备份installed-before-5LDhFI。app.asar/已有退出修复、供应商、其他Mod和源资源保持。
- 插件SHA256：`ecd8fedf39a0b8722cdca68daf19c17005eb04024925dc78fe33b037497508d9`。
- DLL SHA256：`614c929d00609d528980f1ee1530eabc32a2d8acf136f15ab4b15fce1881b7c7`。
- 安装后主动启动AG-harness主进程23236进行健康检查，未启动游戏。首次HTTP检查在Runtime尚未监听时返回ECONNREFUSED，不能算启动成功；后续检查见runtime-verification.json。
- 未提交/推送，未制作完整安装器，真实游戏视觉效果待玩家确认。

### 启动验收通过

- 2026-09-13 03:04（本地时间）复核：34/34文件匹配，457保护文件未改；活动Profile依赖与内容寻址恢复归档都匹配新插件哈希。
- Web49856 HTTP200，Gateway33145由新Runtime82208（父进程23236）监听；日志Web/Gateway/product bridge就绪，本次无fatal。证据runtime-verification.json。
- 应用有意保持运行，游戏未启动；不能把此时正常多进程数称为退出残留。
