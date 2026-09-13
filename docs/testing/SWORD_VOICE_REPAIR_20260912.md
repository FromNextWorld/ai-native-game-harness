# 万剑归宗语音链路修复与增量更新 — 2026-09-12

## 当前交付状态

- 已修源码、编译并增量更新本机安装；未提交或推送 Git，未制作新的完整安装包。
- 2026-09-12 16:15:57 北京时间核验：44/44 安装文件哈希匹配；实际 Profile 引用的内容寻址恢复包与安装目录插件包一致；Web 返回 HTTP 200；33145 由安装目录下的 Runtime 子进程 73424 监听，父进程 76832。
- 新启动日志包含 `DSH Web Runtime ready`、`game Gateway ready`、`DSH product bridge ready`。这证明启动与版本加载，不等于真实语音/游戏验收通过。
- 星露谷未启动、未修改存档；Mod DLL 保持 `EF0CE12A6A3418824C9847A2C57AAAA376BF376B5B3C064170C1AC400D1AEFEE`，四正四背、每只单剑的视觉实现未改动。
- 没有更换模型/供应商、修改密钥/额度或部署正式云服务。历史识别失败没有保留原音频/上游错误，仍不能认定为欠费、接口改版或已证实的丢词原因。

## 本次修复

1. **语音数据完整性**：录音开始时即建立初始化等待；短录音不会在提供商尚未就绪时绕过流式会话。串行等待音频片段推送，再结束识别。最终识别分段按合法序号合并，不让空片段覆盖已有文本；缺序号、冲突分段、无效协议不再拼出猜测指令。
2. **不再只剩 HTTP 500**：讯飞传输、本地 HTTP 桥和注册的 ASR 扩展保留允许列表中的错误类别与数字错误码，游戏里对应显示额度、凭据、时间、繁忙、识别不完整等提示。不会保留签名 URL、上游自由描述、密钥或原始音频。
3. **有条件的重试**：仅明确标为可重试的连接故障允许一次整段识别；额度、认证、协议、未知 HTTP 500 不再盲目重试。失败的流式会话会清理。
4. **召唤时序与模型工具目录**：在新建/借用会话的真实 Agent 接线中，首轮模型目录不直接暴露剑阵/爷爷执行工具，避免它在回复前误调用收回。语音播放真正完成后再走动作判定及现有原子能力；整段 TTS 降级也采用播放成功回调，播放失败/被取消不会启动召唤。明确的紧急收回仍保留快速路径。
5. **不补口令猜词**：没有把“归中”硬映射成召唤；判定使用当前用户文本，要求片段、否定、引用和含糊输入不执行。动作结果使用真实执行回执。提示约束不等于已证明真实模型从不误判/编造冷却。

## 回归：旧实现失败，再验证候选通过

以下外部模型、音频输出、游戏和上游 WebSocket 可以使用替身；桥接、注册、Agent、工具目录与 Gateway/SpeechController 生产代码没有替换成预设成功。

| 用例 | 旧实现反证 | 候选结果 |
| --- | --- | --- |
| `apps/cloud-gateway/test/asr-session-regression.test.ts` | 15 项中 14 项行为断言失败 | 15/15 |
| `test/asr-extension-regression.test.mjs` | 3 项错误字段/响应协议断言失败 | 3/3 |
| `test/asr-bridge-roundtrip.test.mjs` | 冻结旧桥接文件：HTTP 往返后 code/providerCode/retryable 丢失 | 1/1 |
| `test/asr-retry-regression.test.ts` | 首批 9 项失败；额外启动竞态用例抓到重复整段调用 | 10/10 |
| `test/sword-reply-production.test.ts` | 实际模型目录暴露 stop 导致播放前停止；新增整段播放用例也在旧实现上失败 | 5/5 |

关键执行命令（各自仓库/包目录）：

```powershell
# core/plugins/xiaotangyuan-game
pnpm exec vitest run test/asr-retry-regression.test.ts test/sword-reply-production.test.ts
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run
pnpm exec vitest run test/dst-ts-installer.test.ts

# private/apps/cloud-gateway
pnpm exec vitest run test/asr-session-regression.test.ts test/provider-transport.test.ts

# private repo root
node --test test/asr-extension-regression.test.mjs
node --test test/asr-bridge-roundtrip.test.mjs
# 冻结旧桥接回归：设置 AGH_ASR_BASELINE 指向下述 baseline/private 后运行同一文件。
```

- Core 全量结果 **335/336**；单独重跑失败文件仍为 **8/9**。未通过的是饥荒 `migrates a same-version Python install`：Windows 临时目录重命名 `EPERM`。本次没有修改该安装器或用户实际饥荒安装，不能写成“全部回归通过”。
- 相关既有剑阵、收回、Work 时序、学习意图、技能组合/可靠性、会话生命周期等测试通过；私有传输相关组合 21/21，扩展/本地桥相关 Node 检查通过。
- 初期测试替身协议配置不正确造成的失败不计入旧行为反证；纠正模型事件协议后才记录上表生产行为失败。
- 真实模型对含糊语音的语义判断、实际麦克风/讯飞识别、真实扬声器排空及游戏召唤没有在本轮自动化中验证。

## 安装证据及可复现步骤

本任务产物根目录：`C:/game/deepseekharness/output/sword-voice-repair-20260912`。

- `baseline/`：改动前的核心和私有目标文件。判定策略旧编译文件保留在核心仓库原 `dist`；候选编译使用独立 outDir，没有覆盖它。
- `candidate/core-dist/`、`candidate/private-dist/`：两侧 TypeScript 编译输出。
- `prepare-update.mjs`：逐个验证当前安装的核心 JS 与旧源码转译/旧 dist 一致；验证旧 Desktop 入口；保留原构建 API URL，只替换目标入口。对新 ASAR 和插件 TGZ 检查其余文件字节/哈希不变。
- `install-update.mjs`：更新前再确认无 Harness/星露谷进程；校验安装和候选哈希、真实路径边界、私有提供商旧文件一致性；备份后仅替换明确的 44 个目标。
- `stage-HTEiFv/manifest.json`：目标及 before/after 哈希。
- `stage-HTEiFv/installed.json`：安装时间、备份路径、日志偏移、安装后哈希。
- `stage-HTEiFv/runtime-verification.json`：真实进程、Web 200、33145、新启动日志、恢复包引用与安装后 44 项校验。

```powershell
# C:/game/deepseekharness
node output/sword-voice-repair-20260912/prepare-update.mjs
node output/sword-voice-repair-20260912/install-update.mjs
node output/sword-voice-repair-20260912/verify-installed.mjs --live
```

前两个脚本是此次冻结候选的一次性流程，不应对已更新安装重复执行；验证脚本可只读重跑。复制备份位于 `installed-before-0GCFNG`。应用正常启动自行生成内容寻址恢复包并刷新 Profile 依赖/标记，本任务没有伪造“已更新”标记。

插件包 SHA256：`4338ca3b13ddbb08beb2caa642dcd0438fdff3f038b5ef2db49c8ccaa598247e`。

当前实际加载的 Runtime、`dsh-home/profiles/web` 和安装目录恢复包都已核验。发现 `dsh-home-self-hosted` 是旧分离配置，仍指向 9 月 7 日旧 distribution，当前启动没有使用它；本轮没有修改该休眠配置，也不声称它已升级。旧发行目录/旧完整安装器仍未重制，不能用它们覆盖本次安装后宣称补丁保留。

## 剩余边界和人工验收

- 本次门控的是内置剑阵/爷爷动作和同伴 Session 内直接调用相关 projectile 原子的路径；没有完成“所有游戏/所有自定义学习技能”的统一回复后执行队列。含 projectile 原子的自定义技能不会在首轮直接放行，完整学习/组合场景需另做验收，不宣称整个多层技能体系已通过。
- Work 时序与紧急停止保留原有独立语义。已有其他普通游戏工具/学习阶段的全局回复优先缺口不由本次局部回归消除。
- 未新增 CI 或发行自动阻断；本次是人工执行的候选、哈希和运行核验，不是永久硬门禁。
- 本机用户验证：进入存档后按住 V，说“**小汤圆，万剑归宗**”，说完松开；确认先听完正常回复才出现剑阵；“**收回剑阵**”应立即收回。再测否定、含糊指令和语音中断，不应误启动。
- 若再次失败，保留测试时间并检查此次新增的错误类别/关联日志，不再仅凭“网络有点不稳”或编译成功判断根因。

原始故障调查见 `SWORD_SUMMON_FAILURE_20260912.md`；该调查反映修复前状态，不应当作本次安装状态。
