# 技能分层与 TS 迁移方案

## 当前结论

2026-09-07 更新：技能解析器、执行器、存储、工具入口、Gateway 与新饥荒桥接均为 TS。Windows 正式打包/安装源码现已默认接入 TS + 内置 Node，使用现有 Gateway 1.1 与 Mod 文件协议，不需要玩家安装 Python 或 Node。组合技能与独立解释进程已实现。**已验证独立玩家 ZIP 和临时目录安装；未生成完整 Desktop NSIS、未覆盖安装版、未进行真实 Steam/游戏验收。**旧 Python 源码与显式恢复入口保留，不能说仓库里已经没有 Python。

## Python 现在哪里使用

| 位置 | 现有职责 | 迁移目标 |
| --- | --- | --- |
| `games/dont-starve-together/.../app.py` | 状态文件、请求去重、语音事件转接、原子命令租约与回执 | TS Adapter，保留协议和取消语义 |
| `.../harness_client.py` | WebSocket 握手、重连、请求与通知 | 复用仓库现有适配器通信设施 |
| `.../game_state.py`、`config.py` | 状态映射、配置与 Steam 目录发现 | TS 状态转换与配置模块 |
| `.../cli.py`、`mod_installer.py` | Steam 启动、窗口/进程检测、安装与恢复 | Desktop/TS 启动安装逻辑；平台操作复用已有平台宿主 |
| `ChesterAI.spec`、Python 打包脚本 | PyInstaller 制作合体启动器 | 在新启动链路验证完成后移除旧 Python 打包链路 |
| `tests/*.py` | 旧桥接回归，Lupa 执行实际 Lua 函数的测试夹具 | 逐步迁到 TS 测试；Lua 运行器是测试依赖，不进玩家包 |

上表 Python 路径现为旧安装兼容/恢复及测试保留项，不是新正式包的运行依赖。新包依赖内置 Node 和 ws，Lua Mod 与 C# 游戏适配器仍需保留；Windows ZIP 解压由 TS 调用系统 PowerShell/.NET 完成，有超时、取消、路径及大小检查，不使用 Python。第三方办公技能不在本次去 Python 的范围内。

缺氧 `games/oxygen-not-included/adapter` 已有 TS 的配置、安装、重连和文件桥接结构。迁移应复用 `adapter-protocol`、`adapter-websocket` 等现有层；现存 companion 与标准 Adapter 通道需逐项对照，不另造第三套协议。

## 应有的技能层级

1. **任务层**：理解玩家目标、创建冻结验收契约、决定是否修订。持有业务规则，不直接操作游戏。
2. **组合技能层**：模型生成的技能可以调用指定版本的已验证低层技能，例如“收集食物”调用“猎取目标”和“拾取指定物品”。
3. **基础技能层**：已试跑保存的受限程序，组合查找、移动、攻击、拾取等原子。不是内置完整蝴蝶脚本。
4. **Adapter / Mod 原子层**：只执行有限且可观测的游戏操作，校验目标、距离、租约与安全边界。

“多层”是技能调用关系，不是给每一层更高权限。模型学习时只创建技能源码和数据，不修改 Mod。开发者补缺失通用原子属于适配器维护，不等于让模型每学一项就改 Mod。

## 技能组合现状

- 已新增显式 `skill(id, version, arguments)` AST 节点、`params` 输入及 `return`。安全 JSON 类型/大小检查已实现，业务级参数/返回值 schema 尚未实现；不允许任意 JS 函数或文件导入。
- 一次执行先冻结依赖图与版本。只能调用已验证的技能；拒绝循环依赖、递归、跨游戏调用和超深调用链。
- 父子技能共享总原子次数、总时限和取消信号，不能每进一层重置预算。
- 子技能能力集合必须包含在父任务授权范围内；子技能使用独立变量作用域，不能读写父程序内部状态。
- 轨迹记录父子调用 ID、依赖版本、输入输出和原子证据。子技能“运行成功”不自动等于父任务目标完成。
- 版本被归档或升级时，保留已固定版本或明确提示依赖失效，不能静默运行新版本。

上述依赖快照、环检测、4 层深度、共享 60 次原子/30 次技能预算、取消、独立作用域、子任务验收及版本失效报错已实现并测试。轨迹使用版本化 `callPath`，尚无单独的可视化调用树。

## 独立执行与安全边界

已保留受限 AST，并把 `SkillService` 的解释执行放到独立 Node 子进程，由父进程通过 IPC 代理原子调用。子进程不继承供应商 Key，不向技能源码提供文件、网络或启动程序的接口；父进程检查能力和调用预算，超时和取消时终止执行进程，等待进程关闭再返回。Node 进程堆上限 96MB，不等于总 RSS 上限。

独立进程用于故障隔离；仅启动一个 Node 子进程并不等于抵御恶意代码的完整操作系统沙盒。若未来允许第三方任意代码，必须再设计 Windows/macOS 的 OS 级限制及逃逸测试。当前不开放任意 TS/JS，不能用“换 TS”代替权限边界。

## 下一步与验收门槛

1. **本轮已做：原子通用化、任务规则移出共享层、修正错误文档。** 验证兔子/树的查找、非战斗物品拾取、实际击杀与假成功拒绝。
2. **正式源码已接线：** TS CLI 支持 PID 附着及 `--launch` 包装；新包包含完整 Mod/动画/Node/ws/许可证与逐文件校验清单。安装器支持同版本 Python→TS 迁移、同版本修复、备份、失败回滚和游戏目录内启用 Mod；不扫描修改其他存档。Desktop 打包准备生成内置 ZIP，运行时读取清单并向 DSH 传入本地包及校验信息。Steam 启动项仍需玩家粘贴，不会自动改 Steam。
3. **继续加固：** 技能调用与独立进程已实现；补业务 schema、完整新技能树学习规划、真正的 OS 沙盒，以及打包后 Windows/macOS 进程启动验证。
4. **完善任务验收。** 扩展任务契约生成；新增通用前后快照/物品实体来源证据，避免把旧掉落算成本次成果。不能让生成程序自行降低验收条件。
5. **最后才交真实游戏验收。** 学习 → 真正试跑 → 保存 → 重启 → 再次调用；暂停、断开、容器满、目标消失均不能假成功。单元测试不替代多人服务器、路径与物理行为验证。

## 当前交付边界

本轮最新验证：小汤圆 TS 插件构建及 174 项测试通过，包含 10 项组合技能/实际子进程测试、10 项 TS 桥接真实文件与 WebSocket 测试、9 项正式 TS 包安装测试；Desktop 接线/恢复/生命周期 9 项通过，7 个 PowerShell 入口语法检查通过。安装测试使用真实内置 Node、真实 ZIP 和临时假游戏目录，覆盖安装、同版本迁移/修复、备份回滚、校验拒绝、路径越界、取消、降级拒绝和启动退出。前轮旧饥荒 49 项 Python/Lua 测试通过，本轮未重新运行。TS 联调使用假 Gateway 和模拟 Mod 回执，不是完整真实 Lua/引擎链路；未启动真实游戏或调用真实模型。

只在功能 worktree 修改源码和测试，保留既有未提交改动；未提交、未推送、未合并、未更新已安装 Desktop 或 Steam Mod。现在启动旧安装版仍是旧行为。

## 实现位置与命令

- TS 桥接：`plugins/xiaotangyuan-game/src/runtime/adapters/dst/`。
- 组合依赖：`runtime/skills/skill-dependencies.ts`；独立进程：`skill-process.ts` 与 `skill-worker.ts`。
- 已有插件构建会包含这些文件，没有新增 npm 包，也没有修改根配置或锁文件。

先在工作树运行 `pnpm --filter @qimidandapigu/dsh-xiaotangyuan-game run check`。预览 CLI：

```powershell
node plugins/xiaotangyuan-game/dist/runtime/adapters/dst/cli.js --help
# 仅当 Mod 已配套更新、旧 ChesterAI 未运行时，才可执行预览：
node plugins/xiaotangyuan-game/dist/runtime/adapters/dst/cli.js --game-dir "绝对游戏目录" --check
node plugins/xiaotangyuan-game/dist/runtime/adapters/dst/cli.js --game-dir "绝对游戏目录" --pid 真实游戏进程ID
```

不要把上述示例直接写进现有 Steam 启动项。CLI 不下载或修改 Mod，不自动覆盖 Steam 配置。`--launch` 后接真实可执行文件及参数可作为开发启动包装器；尚未实际验收 Steam 启动兼容性。桥接检查已有心跳及 TS 锁，拒绝双实例；异常退出遗留的锁只应在确认旧进程已结束后处理。

## Windows 默认打包与安装（2026-09-07 续记）

```powershell
# 工作树根目录；产物只写 .artifacts，不碰已安装应用或 Steam。
powershell -NoProfile -File games/dont-starve-together/scripts/build-player-package.ps1 -OutputDirectory .artifacts/dst-package
```

`bundle.json` 给出 ZIP 名称、版本、SHA-256、平台和架构。`dst-runtime.json` 固定每个 Mod/运行时文件的大小与 SHA-256；同版本哈希变化会执行修复，拒绝自动降级。新包内不含 ChesterAI.exe 或 .py。默认 `check.ps1` 运行 TS 检查；`-LegacyPython` 额外运行原有 Python/Lua 夹具。`build-launcher.ps1` 仅作为显式旧版恢复入口。

原 extract-zip 在本机 Node 26.5.1 解压真实包时出现未完成 Promise/挂起；Windows 安装改用独立 PowerShell 的 .NET ZIP，60 秒上限和取消信号，先拒绝越界路径、链接、重复路径及过大解压内容，再解压验证。此处保留平台系统依赖，不是宣称完全不需要系统工具。

本轮交付必须包含更新的小汤圆插件、Desktop 源码接线及 TS ZIP，不能只把新 ZIP 塞进旧 Desktop。现有正式版本不会自动变化。尚待：真实 Steam 命令兼容性、专用服务器/多人世界启用、异常退出锁恢复体验、完整 Desktop 安装包和 macOS 原生运行时。
