# 本机待安装改动收口与验收 — 2026-09-11

## 最终结果

用户明确要求检查已完成但尚未安装的改动，并在暂停桌面操作后确认“继续安装”。更新已落入当前使用的商业版，不是旧的同名安装目录。没有提交、推送、发布或修改云端。

- 安装根目录：`C:/Users/10354/AppData/Local/Programs/AI Native Game Harness`。
- 最终来源 ID：`a11f377bd02c58c612d9966adda3b9958be3b6194a86c614bae0d9ce46947700`。
- 主程序已启动并留在原 Harness 设置界面；当前主进程 43780、Runtime 40244、Media Host 67176。
- 两个游戏在本次恢复安装时已退出；本任务没有启动或结束游戏，没有改游戏配置或存档。

## 安装内容与保留内容

1. 原生设置 UI：移除三个互相遮挡的浮动入口。游戏入口与星露谷测试模式进入“设置 → 游戏”；自动测评进入“设置 → 开发者工具”。游戏产品页使用侧栏内折叠设置入口。
2. MiniMax 角色默认：实际生成的商业路由确认默认/游戏为 `MiniMax-M3 + off`，工作为 `MiniMax-M3 + max`，游戏视觉 `strictModel=true`。这是配置验证，没有付费模型请求或首响速度验收。
3. 缺氧水技能：安装包含原生水粒子投放、确认后结算及水流反馈的源码编译 DLL。保留整合树已有的物体/殖民地诊断工具。
4. 保留已有记忆库损坏保护：替换前发现已安装模块比整合树更新，遂导入 voice-diagnostics-20260909 的四个源码模块及七项测试。没有执行记忆数据库恢复、清理或覆盖。
5. 自学习意图边界与星露谷爷爷浇水视觉此前已经安装，本次不降级、不重复覆盖星露谷 DLL。

## 避免重现本次问题

- 安装前不仅比较版本号，还比较实际文件。第一份候选试图移除 memory-health 模块，已在应用前拦截并废弃；修正候选删除文件数为 0。
- 第一次真实启动发现 `ERR_MODULE_NOT_FOUND`：Cordis 从安装目录的 Runtime 解析宿主插件，而 DSH 客户端发现从 Profile 解析。仅放在 userData 的包无法同时满足两者。
- 已在 Runtime 安装同源 UI 包，保留 userData 的客户端发现副本；新增独立 Runtime/Profile 路径回归测试。正式准备脚本、安装修复脚本和源产物校验均覆盖 Runtime UI 包，防止下次打包遗漏。
- 最终启动日志中无该错误、无自动恢复失败。中途失败不能代表最终状态，以下为修复后的验收。

## 已执行验证

- 插件编译与测试：321 通过（含记忆损坏保护 7 项）。
- Core 集成 64、平台 22 通过。
- 原生 UI Node 测试 5 通过；品牌/源产物回归 8 通过；私有路由/组合测试 8 通过。
- ONI 原生边界模拟测试 53 项通过，包含保留的两个诊断工具；DLL Release 构建成功（2 项已有引用警告）。
- 完整 desktop:prepare 成功；后续仅因记忆保护源码导入，重新编译/打包小汤圆插件、更新生成 Runtime、重建 DST 随包归档并 seal。最终再补 UI Runtime 包，独立 verify 通过。未重新下载第三方 Runtime 依赖来代替增量编译。
- 重启后校验 45 个已变更文件、7 组活动插件目录、2 份 UI 包均与对应源码产物一致。
- 真实安装版：DSH Web、33145 网关、product bridge、语音媒体握手全部 ready；ASR/TTS configured，microphone untested。
- 真实窗口检查：原 Harness 页面无右下角浮动按钮；设置内可见游戏/开发者工具；游戏设置从真实 IPC 读取到已保存的测试模式开启值，未点击切换；开发者页显示手动进入自动测评。
- 当前记忆状态 available=true（启动时读取到 52 条）；没有输出记忆内容、Token 或密钥。

## 文件校验与备份

- app.asar SHA-256：`ab3579fcc0cd1dd8b966a88078c5d8d3fa9429724286985a0391cfef45e9a0af`。
- 已装 ONI DLL SHA-256：`1f3ee218ad9f390f840bd339576535fc2872c688e9ff35bbc4d96e885c1bae98`。
- 旧 app.asar、ONI DLL 及更新目标文件的手动备份在私有整合树 `.artifacts/local-update-backup-20260911-011824`。修复脚本报告 `noBackup=true` 指该脚本自身不执行备份，不代表没有上述外部备份。
- 私有整合树验收产物：`local-update-YXf8Fq`、`local-update-emRCcu`、`local-pending-startup-fixed.log`、`local-pending-final-verification.json`；均位于 `.artifacts/`，不提交。

## 边界与交接

- 本次确认了真实安装与界面；没有实测麦克风、模型响应速度或真实游戏里的水量/视觉效果。ONI DLL 已安装不等于游戏物理验收通过。
- 保留账号、模型凭据、用户设置与存档。替换时个人 JSON 设置哈希一致；运行时正常生成自己的路由、状态和记忆备份。
- 已修改的共享热点仅限获准的 main.mjs 原生 UI 接线与 prepare-desktop-runtime.ps1 的 UI 包准备；本任务未改根 package/lock、集成 manifest 或 electron-builder 配置中的既有改动。
- 没有通知其他任务，没有创建子代理。未发布新安装器、未更新商业发布 pin。正式发版仍需用户另行要求。
