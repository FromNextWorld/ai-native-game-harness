# 剑阵修复与交付验收

## 已确认的故障链

2026-09-09 检查此前玩家真实 Session：`释放万剑归宗。` 被正确识别，但 Runtime 缺少 Profile 中的剑阵工具模块及注册。模型改走 `xiaotangyuan_skill_learn`，生成受限 DSL 不支持的 `+`，三次失败，没有调用游戏动作。

修复注册后，真实模型冒烟还发现只回复“已环绕”而不调用工具的情况。因此增加动作执行提示：现成专用工具不依赖学习列表，动作请求不是角色扮演，必须调用工具并依据回执汇报。保留已有回答后动作的例外，不改 Work 意图判定。

## 本任务修复范围

- 在本 worktree 接入经审阅的 sword-formation 任务、工具和注册，保留已有 Profile 的语音优先收回能力。
- 校验召唤、结束、伤害、资源和停止回执；底层异常及清理失败写入独立脱敏日志，结果带错误编号。
- 部署时保留安装版较新的 LearningTurnBudget、学习验收及会话修复。不拿 main 的旧版插件整包覆盖。
- 同时检查 Profile 与 resources/runtime 的全部 JavaScript 哈希；存在未审阅差异或准备后文件变化就拒绝安装。覆盖前备份，失败回滚。

## 可复现检查

在本 worktree 执行：

```powershell
pnpm --filter @qimidandapigu/dsh-xiaotangyuan-game run check
node scripts/repair-sword-deployment.mjs prepare
# 正常退出商业版后，传入 prepare 返回的确切目录：
node scripts/repair-sword-deployment.mjs install <prepared-directory>
node scripts/repair-sword-deployment.mjs verify
```

`verify` 不调用模型和真实游戏，检查两份 JS 一致，并实际导入各安装路径，通过 registerSkillTools 执行模拟召唤和停止。部署脚本不会修改登录、Key、存档、Steam Mod 或其他插件。新增脚本尚未接入共享安装器 CI；后续打包方必须纳入同类门禁，不能保证旧安装包不会重新覆盖。

真实 Harness/模型、模拟 Adapter 检查：

```powershell
$env:SWORD_SUMMON_ONLY='1'
node scripts/smoke-sword-model.mjs
```

每次使用隔离测试存档 ID，读取实际 Session 的工具调用记录，要求调用专用剑阵工具、禁止转入学习、检查无伤创建回执。测试不碰真实游戏、不发社交账号；会产生少量模型调用及独立测试 Session。每次结果保存到 `.artifacts/diagnostic-sword-*.json`。

默认不设置 `SWORD_SUMMON_ONLY` 会额外测试文字收回。该路径曾出现模型只回复“检查进度”，因此现在与语音共用优先停止判定，直接等待原生停止回执，不再依赖模型转述。新增两项测试覆盖成功和未确认；最终安装后的真实 Gateway 回归仍需执行，不能拿分支测试替代运行版验收。

## 真机验收仍须分开

源码测试、安装成功、模型选择正确、模拟游戏回执正确，都不能代替真实星露谷画面。

玩家进入单人存档说“释放万剑归宗”：应出现无伤环绕剑阵，最多 60 秒；再语音说“收回剑阵”：应消失。攻击模式只有实际命中和伤害回执才算成功，农场没有怪时不能算打怪成功。麦克风识别、窗口截图、游戏冷却/解锁仍各有前置条件，失败以本轮错误编号追踪。

## 2026-09-09 当前交付状态

- 180 项源码测试通过；`git diff --check` 无空白错误。
- 首轮修复已安装，备份 `.artifacts/sword-deployment-vqMjqF/backup`：两处安装目录各 49 个 JS 完全一致；重启后重复核验通过。
- 首次真实 MiniMax-M3 测试出现不调用工具的问题；使用候选动作提示的连续三次隔离测试均真实调用了 `stardew.projectiles_create`，但回执由模拟 Adapter 提供，不是真实星露谷效果。
- 最终提示与文字收回修复已准备在 `.artifacts/sword-deployment-kBv09b`，尚未安装：商业版仍在运行，已请用户正常退出。退出后 install 此目录，重启，再不加 `SWORD_POLICY_PROBE` 跑默认完整冒烟。
- 已启动商业版用于验证并保留运行，没有常驻测试脚本，没有提交、推送或修改共享打包入口。
