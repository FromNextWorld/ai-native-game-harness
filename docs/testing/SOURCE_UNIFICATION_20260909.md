# 源码整合与发行一致性验收（2026-09-09）

## 当前结论

这是同一个产品的源码整合，不是新增产品分支。整合工作区：
`C:/game/ai-native-game-harness-worktrees/source-unified-20260909`。
后续本轮修复以此工作区为准；原 player-help、voice-diagnostics 和 main 保留，不覆盖、不提交、不推送。
私有账号/服务插件仍在私有仓库组合，未复制到公开核心。

## 已落实

- 将两个公共源码工作区的修改进行三方比对，逐个处理冲突；不从已安装的 dist 反推源码。
- 同版本插件按压缩包内容计算指纹，并使用带 SHA-256 的安装路径，避免安装工具复用同路径旧包。
- `pnpm desktop:prepare` 先记录源码身份，实际构建、启动测试后再封存；检查三个插件源码产物、压缩包内 dist 和 Runtime 内 dist 完全一致。
- 打包前再次验证源码、插件包和已封存载荷。构建期间修改源码会阻止封存；已验证该失败分支。
- 修复非推理模型被强行传入 reasoningEffort=off 导致请求在发出前失败的问题。
- 检查 DSH turn/end：whenIdle 只表示运行停止，不能当成任务成功；失败不再变成“收到啦”的假确认。
- 一次性整合脚本已加重复执行保护，避免覆盖人工处理过的整合结果。

## 验证记录

| 检查 | 结果 |
| --- | --- |
| Game 插件 | 291/291 |
| Work 插件 | 36/36 |
| Integration | 62/62 |
| Platform | 22/22 |
| Workspace TS build | 通过 |
| 真实 DSH + 本地模型端点 + Mock Game | 通过，实际收到模型请求；聊天、重连复用同一 Session |
| Desktop standalone-shell 启动冒烟 | preload 可用、DSH Web 就绪、33145 监听、单实例、隔离 Profile、退出残留 0 |
| desktop:prepare + seal + verify | 通过，3 个插件载荷逐文件一致 |

封存源码 ID：`15c95068d7ca6bb97bff3289b8647972669b0798bcaa3c62dfdeeaaeae1f2eb5`。
完整逐文件记录：`.artifacts/source-release.json`。
日志：`.artifacts/unified-desktop-build.log`、`unified-startup-smoke.log`、`unified-game-tests.log`、`unified-integration-tests.log`。

## 边界与后续

- 本轮未覆盖用户现用安装，没有启动真实游戏，没有验证真实麦克风、供应商云请求、登录支付或玩家游戏体验。
- Desktop 冒烟运行的是隔离 standalone-shell；不能据此声称完整托管服务模式及所有退出路径均已实机验收。
- 未产出新的正式 NSIS 安装包。私有发行仍须固定已确认的新 Git 版本；用户禁止提交，因此没有擅自创建提交或改用旧标签打包。
- 私有组合源码构建已通过，入口语法检查通过；正式发行前仍需安装载荷/插件模式/真实游戏验收。
- 依赖安装仍有上游 peer/deprecated 警告（包括部分 DSH peer 和 React）；本轮未盲目升级依赖，不把测试通过解读为全部兼容问题消失。
- 封存不是密码学签名，也不能替代发布审批。后续修改源码必须重新执行完整准备流程，不能手改 source-release.json 绕过验证。
