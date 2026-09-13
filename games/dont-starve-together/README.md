# 小汤圆 · 饥荒联机版 AI Mod

让《饥荒联机版》的切斯特接入 AI Native Game Harness。按住 `V` 说话、松开发送，按 `Shift+V` 重新生成上一条回答。

本项目统一维护在 `ai-native-game-harness/games/dont-starve-together`。请从主仓库根目录运行 `pnpm check:dst`；构建发行包使用 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-dont-starve-release.ps1`。不要再向旧 `dsh-xiaotangyuan-game` 或 `dont-starve-ai-mod` 仓库提交功能代码。

## 架构

```text
《饥荒联机版》Lua Mod
  ├─ 游戏状态、玩法、存档、角色归游戏所有
  └─ JSON 文件桥接
          ↓
轻量 DST Adapter（TypeScript + 内置 Node）
  ├─ 安装/启动游戏
  ├─ 转发 Lua 事件和结构化状态
  └─ 把 Harness 回复写回切斯特气泡
          ↓ 本机 WebSocket
AI Native Game Harness
  ├─ 按已注册的游戏进程截取客户区
  ├─ 麦克风、ASR、模型、会话记忆与 TTS
  ├─ 通用工具和玩家反馈
  └─ 模型/语音凭据统一由 Harness 管理
```

TS Adapter 不调用模型、语音或截图 API，也不保存独立的 API Key、对话历史或模型配置。它只接受本机 `ws://` Harness Gateway，游戏专属状态仍保留在当前 DST 会话里。旧 Python 源码保留用于兼容恢复和 Lua 测试，不进入新玩家包。

**2026-09-07 状态：默认打包和安装源码已切到 TS，临时游戏目录验证通过；尚未更新玩家已安装的 Desktop/Mod，也未完成真实 Steam 启动验收。不能用旧安装版验证这些新功能。**

## 功能

- 按住 `V` 与切斯特语音对话；Harness 只在已注册的 DST 进程位于前台时录音。
- 截取 DST 窗口客户区，而不是整个桌面。
- Lua 导出玩家、世界、物品栏、附近实体和切斯特状态。
- `Shift+V` 由 Harness 重新生成上一条回复，不重复提交玩家反馈。
- 可选 AI 游戏提醒使用一次性会话，不污染正常对话记忆；Harness 不可用时仍使用固定提醒。
- 回复包含 `recipient_userid`，只显示在请求玩家对应的切斯特身上。
- 保留切斯特的跟随、容器与存档逻辑，只把显示层替换为小汤圆 `Jingling` 动画。
- 小汤圆支持待机、移动、投掷和攻击动画；动画包损坏或旧安装缺失时安全回退为原版切斯特，不阻止游戏启动。

## 使用要求

- Windows 与《饥荒联机版》
- AI Native Game Harness
- 包含本轮 TS 安装器的配套小汤圆插件和 Desktop（不能只按旧版本号判断）
- 玩家无需安装 Node/Python；开发打包需要 Node、pnpm 和 Windows PowerShell

模型、视觉、ASR、TTS 和玩家反馈凭据全部在 AI Native Game Harness 中配置。本项目的 `.env` 只允许保存本机 Gateway 地址和游戏路径，不应放任何 API Key。

## 玩家安装包

使用配套的新 Desktop 与小汤圆插件后，玩家可以在 Harness 中发送：

```text
检测并安装《饥荒联机版》的小汤圆 AI Mod
```

Harness 会自动检测 Steam、验证官方安装包、备份旧版本并安装。安装完成后只需把它返回的一行内容复制到 Steam 启动选项。

自动安装会同时完成以下工作：

1. 定位 Steam 中的《饥荒联机版》。
2. 校验安装包大小和 SHA-256，拒绝未知来源或被修改的压缩包。
3. 把旧 Mod 备份到游戏根目录的 `.xiaotangyuan-backups`。
4. 安装 Lua Mod、`Jingling` 动画、TS 桥接和内置 Node，在游戏目录中启用本地 Mod；不自动修改其他多人/专服存档。
5. 安装或验证失败时恢复旧目录。

开发者生成不含凭据的安装包：

```powershell
.\scripts\build-player-package.ps1
```

脚本生成 `dist/dsh-xiaotangyuan-game-dont-starve-<版本>.zip` 和 `bundle.json`；Desktop 准备脚本把它作为内置安装资源。新 ZIP 由 Harness 安装器读取，不再包含供玩家双击的 Python EXE。安装位置：

```text
<DST 目录>\mods\dont-starve-ai-mod
```

然后把安装器返回的启动项（也保存于 `Steam-Launch-Option.txt`）整行复制到 Steam →《饥荒联机版》→ 属性 → 启动选项：

```text
"<Mod 目录>\runtime\node.exe" "<Mod 目录>\runtime\cli.js" --game-dir "<DST 目录>" --launch %command%
```

平时先启动 AI Native Game Harness，再从 Steam 启动游戏。启动器会获得真实 DST 进程 ID，连接 Harness，并在游戏退出时自动关闭 Adapter。

## 首次验证

1. 启动 Harness，确认 `http://127.0.0.1:3080` 可以打开。
2. 从 Steam 启动《饥荒联机版》，不要直接双击游戏 EXE。
3. 进入一个世界并找到切斯特；外观应替换为小汤圆，容器与跟随行为保持不变。
4. 保持游戏窗口在前台，按住 `V` 说话并松开；切斯特应显示回复并播放语音。
5. 按 `Shift+V` 可重新生成上一条回答。

标题界面只证明 Mod 能加载；`Jingling` 实体要进入世界、生成切斯特后才会创建。

## TS 本地开发

在仓库根目录构建 `plugins/xiaotangyuan-game` 后：

```powershell
node plugins/xiaotangyuan-game/dist/runtime/adapters/dst/cli.js --help
node plugins/xiaotangyuan-game/dist/runtime/adapters/dst/cli.js --game-dir "真实游戏绝对目录" --check
```

必须先配套安装 Mod；`--check` 不启动游戏或连接 Gateway。测试已运行游戏可用 `--pid`，不要同时运行旧 ChesterAI。默认 `pnpm check:dst` 执行 TS 构建和测试。

### 旧 Python 恢复入口（非默认玩家链路）

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
Copy-Item .env.example .env

# 检查游戏目录、Lua 文件路径和 Harness 端口
python -m dont_starve_ai_mod --check

# 安装 Lua Mod
.\scripts\install-mod.ps1

# 游戏已运行时发送文字测试
python -m dont_starve_ai_mod --text "我现在应该做什么？"
```

日志与桥接文件：

- `runtime/chester-adapter.log`：Adapter 日志，不包含凭据。
- `<DST>/data/unsafedata/dont_starve_ai_mod_requests.json`：Lua 事件队列。
- `<DST>/data/unsafedata/dont_starve_ai_mod_state.json`：当前游戏结构化状态。
- `<DST>/data/unsafedata/dont_starve_ai_mod_bridge_status.json`：Harness/Adapter 心跳。
- `<DST>/data/unsafedata/dont_starve_ai_mod_lua.txt`：Lua 诊断日志。

## 旧版 Python/Lua 回归（可选开发依赖）

```powershell
$env:PYTHONPATH='src'
python -m unittest discover -s tests -v
python -m compileall -q src tests
.\scripts\build-player-package.ps1
```

构建脚本会检查 `game-mod/anim/jingling.zip`，并确认其中至少包含 `anim.bin` 和 `build.bin`。修改小汤圆 PNG 或 SCML 后，必须先用 Klei Mod Tools 重新编译；详见[动画打包说明](docs/兔子动画打包说明.md)。

## 常见问题

- 报错 `Could not find an asset matching anim/jingling.zip`：安装不完整，重新运行当前安装包；不要只复制 `modmain.lua`。
- Mod 能加载但还是原版切斯特：确认进入了世界，并检查 `<DST>/mods/dont-starve-ai-mod/anim/jingling.zip` 是否存在。
- `V` 没反应：确认 Harness 正在运行、游戏窗口位于前台，并检查 `127.0.0.1:33145` 是否监听。
- Steam 启动后没有 Adapter：重新核对启动项，必须保留末尾的 `%command%`。
- 排错时请提供 `client_log.txt`、`runtime/chester-adapter.log` 和 `dont_starve_ai_mod_lua.txt` 的相关片段，并先遮盖 Token 或其他凭据。

## License

MIT
