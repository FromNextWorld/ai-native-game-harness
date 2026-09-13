# V 键打断导致 Runtime 退出：补充修复

> 最新交付：用户再次确认“已退出，可以更新”后，已增量安装；16:56:41 实际 Runtime 验证通过。下文 16:53 “尚未安装”为阶段记录，最终状态见文末。

## 真实失败，而非“连通即验收”

用户在上一次热更新后给出的截图显示“与 Harness 的连接已关闭”。SMAPI 当日 16:39:20 记录第二次 V 开始录音和连接关闭；同段 Runtime 日志出现：

```text
dsh: fatal load failure: Error: 玩家打断了语音回复
    at SpeechController.handleMediaEvent (...)
    at SpeechController.onMediaEvent (...)
    at WindowsMediaHost.onLine (...)
[process] exit name=AI Native Game Harness Runtime code=1
[desktop] Runtime recovery attempt=1 delayMs=1000
```

后台随后自动拉起 PID 20092 并重新监听 33145。截图中的断连有明确进程退出原因，不是这次新确认的欠费/外网问题；也未进入剑阵视觉验收。游戏仍在运行，本任务没有退出、操作或修改游戏。

## 根因和漏验原因

- 流式合成的 `output.chain` 和字幕位置等待的 `output.captionChain` 在模型回复完成前就已运行；此前直到 `finishSpeechReply` 才 await。期间 V 打断/服务关闭/TTS 故障会让后台 Promise 提前拒绝，Node 将未接住的拒绝当作致命错误。
- 之前合成测试立即调用 finish，给 Promise 太早接上了 await；启动 HTTP 200 和文件哈希检查也不覆盖“模型尚未完成、玩家再次按 V”的窗口。这是先前测试没有覆盖的行为，不是玩家操作不对。
- 同时发现旧回复 finally 不检查当前身份，可能删除更新的回复；以及部分流式播放失败返回 true，把“已收到一些音频”错误当作“播放完成”，可放行剑阵判定。旧测试的 true 预期与回复完成约定冲突，本次明确修正，不把旧测试当规格。

## 有界源码修复

只改 `plugins/xiaotangyuan-game/src/runtime/speech/speech-controller.ts` 的队列处理：

1. 每条合成/字幕 Promise 建立时立即接上局部错误观察，原 Promise 仍保持失败，供所属回复最终处理。没有添加全局吞异常。
2. 取消是取消，不是播放成功；真实服务失败立即记录脱敏诊断并取消同一输出。中途已播放的回复失败向调用方传播，既不重播整篇，也不执行游戏动作；尚未收到音频仍保留原兼容路径。
3. 迟到合成片段、字幕和结束阶段检查本轮取消信号。
4. 旧回复清理只删除自身，不删除同进程的新回复。

配置/Key、模型/供应商、Desktop 共享入口、依赖/锁、Work 代码、游戏 Mod/存档、正式云服务均未修改。没有提交 Git。

## 反证与候选验证

- 新 `speech-process-cancellation.test.ts` 在独立真实 Node 子进程使用 `--unhandled-rejections=strict`，编译真实 SpeechController、WindowsMediaHost、CapabilityRegistry、诊断代码；通过真实 MediaHost JSON 分发及播放计时器触发取消。只模拟外部语音提供商及媒体可执行程序，不装全局 rejection 监听器。
- 旧实现：合成中打断、字幕等待中打断、关闭、首音前提供商错误、部分音频后错误 **5/5 进程退出码 1**。栈与实机相同。候选：**5/5 退出码 0**；除关闭场景外，随后一轮识别/回复也成功。
- 新身份清理用例旧实现得到 undefined 而非 new；候选通过。
- 真实 DSH Agent/模型请求/流式回调 → SpeechController → Gateway 后置动作测试中，旧实现发生 `classify`，候选中部分播放失败产生错误通知且不判定/执行。外部模型、媒体、游戏原子使用替身，未验证真实扬声器或游戏操作。
- 相关扩大回归 **114/114（11 文件）**；TypeScript 编译通过。没有重跑全项目，也没有消除此前饥荒安装器临时目录 EPERM。未新增 CI/发布硬阻断。

核心包目录执行：

```powershell
$env:AGH_SPEECH_BASELINE='C:/game/deepseekharness/output/sword-voice-repair-20260912/barge-in-followup/speech-controller.before.ts'
pnpm exec vitest run test/speech-process-cancellation.test.ts
# 上述环境变量仅用于隔离旧实现；候选测试在不设该变量的新进程执行。
pnpm exec vitest run test/speech-process-cancellation.test.ts test/speech-controller.test.ts test/sword-reply-production.test.ts test/asr-retry-regression.test.ts test/work-voice-timing.test.ts test/sword-recall.test.ts test/gateway-lifecycle.test.ts test/game-session-lifecycle.test.ts test/learning-intent-boundary.test.ts test/sword-formation.test.ts test/game-action-policy.test.ts
pnpm exec tsc -p tsconfig.json --outDir C:/game/deepseekharness/output/sword-voice-repair-20260912/barge-in-followup/candidate-dist
```

## 产物与部署边界

产物目录：`C:/game/deepseekharness/output/sword-voice-repair-20260912/barge-in-followup`。

- `speech-controller.before.ts` SHA256：`5A4535FB573AA0B6859AC4AA4124AB51C287243FBA2833E48C4D305986C7FF3F`。
- `regression-old.json` 保存真实旧进程失败；`regression-candidate.json` 保存 114 项候选通过。
- `prepare.mjs`、`stage-84dKZp/manifest.json`：候选对旧安装逐文件核对，只替换两个当前加载副本的 Controller 编译文件及恢复包（9 个目标）。包内其余文件哈希不变，App ASAR、ASR 扩展和传输、星露谷 DLL 作为保护文件验证。
- 新恢复包 SHA256：`09b07cc0bccc58eeb487d0fa15b02a918e1713ac2d10786503146edfb9f9d5b5`。
- **16:53 状态：候选已准备，尚未安装**。已请用户暂停语音并从托盘退出 AG-harness；星露谷可保持打开。不借上一次已用完的退出确认强行中断当前会话。待退出后执行有进程/哈希/路径校验的 `install.mjs` 并正常启动，核验实际恢复包和 Runtime。
- 最终真实验收：一句话没播完时再按 V，应用不退出，下一句能正常识别；正常“万剑归宗”在回复播放完成后执行，取消/播放失败不启动。当前尚无本次新补丁的真实游戏验收。

## 最终安装及运行核验 — 16:56:41 北京时间

- 用户明确退出授权后，安装脚本重新检查无 Harness 进程，替换 9 个目标，全部安装后哈希一致；保护的 Desktop ASAR、ASR 扩展/传输和星露谷 DLL 未变。备份在 `barge-in-followup/installed-before-Moa8QE`。
- 正常启动父进程 44328、Runtime 子进程 39040；33145 归属于该安装目录 Runtime；当前 Web `http://127.0.0.1:56698` 返回 200；新启动日志包含 Web/Gateway/产品桥 ready，采样时无新 fatal load failure。
- Runtime/Profile 9/9 文件一致；Profile 自动指向新的 `09b07cc0...` 内容寻址恢复包，非手改升级标记。机器可读证据：`stage-84dKZp/installed.json`、`stage-84dKZp/runtime-verification.json`。
- 把隔离 Node 测试的模块根直接指向**实际安装目录 dist**，五种场景再次全部进程存活，四种非关闭场景随后识别/回复成功；仍为模拟外部语音/设备，不是人的麦克风验收。
- 最终检查发现星露谷进程已不存在（本任务未关闭它），故没有游戏重连/真人 V 键新证据。需用户重新启动游戏验证。本任务留下正常运行的 AG-harness 供测试，无临时测试进程残留，未提交代码。
