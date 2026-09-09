<p align="center">
  <img src="docs/assets/ai-native-game-harness-logo.png" alt="AI Native Game Harness" width="112">
</p>

# AI Native Game Harness

面向游戏开发者、MOD 作者和 AI 应用开发者的开源游戏 AI 集成框架，基于 DeepSeek Harness 连接游戏状态、角色交互、语音、受控动作与生产力工具。

玩家可以在游戏中与 NPC 交流、交办工作并接收反馈；开发者通过统一的 Adapter 接入游戏，无需为每款游戏重复建设会话、模型调用与工具执行基础设施。

[项目介绍](https://fromnextworld.github.io/ai-native-game-harness/) · [开发者指南](https://fromnextworld.github.io/ai-native-game-harness/developers.html) · [架构说明](docs/AI_GAME_ENGINE_IDEOLOGY.html) · [版本发布](https://github.com/FromNextWorld/ai-native-game-harness/releases)

## 开发动态与社区

在小红书查看项目演示、开发视频和最新进展，或加入 QQ 群交流 AI 游戏、参与测试。

- **小红书：[@小红鼠煮大汤圆](https://www.xiaohongshu.com/user/profile/65f497a500000000050094cf)**
- **QQ 群：1043783217**

<p align="center">
  <img src="docs/assets/xiaotangyuan-qq-group.jpg" alt="小汤圆 QQ 群二维码，群号 1043783217" width="360">
</p>

## 项目状态

项目处于开发验证阶段。当前主线版本为 `1.2.0-dev.0`；`v1.1.0` 保留历史源码快照，不代表最新安装包或已完成全部玩家体验验收。

- 仓库包含三款游戏的适配代码、Mock Game、桌面应用及自动测试。
- Windows 是当前主要开发平台；macOS 的原生媒体能力、签名、公证和真机验收尚未完成。
- 自动测试、源码上传、本机安装与真实游戏验收是不同环节。具体可用范围以对应版本说明和验收记录为准。

项目现由 [FromNextWorld](https://github.com/FromNextWorld) 维护。已有包名中的 `@qimidandapigu` 暂时保留，以兼容插件配置；GitHub 账号迁移不改变包名或历史提交。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 游戏状态接入 | 通过 Adapter 提供位置、背包、附近目标和场景等结构化信息 |
| 受控动作执行 | 调用游戏声明的动作，以动作回执和新状态确认结果 |
| NPC 交互 | 结合游戏上下文进行语音或文字交流；具体输入方式取决于游戏适配 |
| 会话与记忆 | 按游戏和存档隔离上下文，支持持续交互 |
| 技能与成长 | 提供技能学习和游戏事件接线；可用动作及解锁规则由各游戏实现决定 |
| 工作编排 | NPC 先回复，随后在后台识别工作意图；进度与修改继续关联原工作记录 |
| 开发与验收 | 提供 Adapter Starter、Mock Game、协议测试和专项验收脚本 |

工作能力用于让 NPC 在玩家继续游玩的同时处理研究、写作或文件生成。外部生产力工具需要单独安装、配置与授权；未配置的工具不能视为已接入。

## 游戏适配

| 游戏 | 游戏侧实现 | 验证状态 |
| --- | --- | --- |
| 星露谷物语 | SMAPI / C# MOD、Adapter、小汤圆交互与动作 | 开发验证中 |
| 饥荒联机版 | Lua MOD、启动与 Adapter 接线 | 开发验证中 |
| 缺氧 | C# Bridge、Adapter、角色与动作接线 | 开发验证中 |
| Mock Game | 独立测试游戏与协议示例 | 用于自动化验证 |

三款真实游戏共享接入协议，但 MOD 加载方式、权限和动作范围不同。安装与升级前请阅读[游戏安装说明](docs/xiaotangyuan/INSTALLATION.md)。本项目不是相关游戏的官方产品，也不声明与其开发商存在合作关系。

## 真实游戏开发画面

以下截图来自项目开发验证记录，用于展示 AI 伙伴已经进入真实游戏场景后的交互方向；它们不是对应游戏的官方宣传或合作声明。游戏名称、画面与原始素材权利归各自权利方所有。

<table>
  <tr>
    <td width="33%"><img src="site/games/stardew-valley-giant-crop.jpg" alt="星露谷物语中小汤圆陪伴玩家观察巨大作物"><br><strong>一起见证农场成长</strong><br>AI 根据当前农场事件回应，而不是脱离存档编写结果。</td>
    <td width="33%"><img src="site/games/stardew-valley-sunflower-flight.jpg" alt="星露谷物语向日葵田中的小汤圆互动玩法"><br><strong>不只聊天，也能参与玩法</strong><br>角色表达、游戏事件和动作能力可以组成真实的 AI 游戏体验。</td>
    <td width="33%"><img src="site/games/stardew-valley-rainy-companion.jpg" alt="星露谷物语雨天场景中小汤圆回应环境"><br><strong>对当前环境作出回应</strong><br>天气、地点和附近事件都可以成为对话与动态剧情的事实上下文。</td>
  </tr>
  <tr>
    <td width="33%"><img src="site/games/oxygen-not-included-companion.png" alt="缺氧殖民地中小汤圆陪伴复制人"><br><strong>成为殖民地的一员</strong><br>小汤圆以游戏内角色存在，能围绕复制人与殖民地的真实状态继续陪伴。</td>
    <td width="33%"><img src="site/games/oxygen-not-included-water-skill.png" alt="缺氧中小汤圆根据水环境解锁吸水与喷水能力"><br><strong>从环境中获得新能力</strong><br>能力由真实游戏事件触发，并通过游戏规则确认是否已经学会和生效。</td>
    <td width="33%"><img src="site/games/dont-starve-together-skill-learning.png" alt="饥荒联机版中小汤圆回应玩家捕捉蝴蝶的行动目标"><br><strong>把玩家目标转成行动</strong><br>AI 结合当前世界与可用能力理解请求，形成可继续执行和验证的行动方向。</td>
  </tr>
</table>

## 架构

```text
游戏 / MOD
    │ 状态、动作与回执
    ▼
Game Adapter ── Harness / DeepSeek Harness ── 模型、语音与工具
                          │
                          ├─ NPC 交互与存档上下文
                          └─ Work Orchestrator → 工作 Session / Workspace
```

- **游戏层**：决定游戏事实、可执行动作和操作结果。
- **Harness 层**：连接 Adapter、插件与桌面宿主，保留请求和结果的可追踪关系。
- **DSH 层**：复用 Session、Workspace、Agent 与工具能力。
- **Work Orchestrator**：在 NPC 回答之后识别工作需求，创建或复用独立工作 Session，并将公开反馈送回角色。它不引入独立任务数据库。

动态剧情与技能能力受 Game Pack 及游戏规则约束；模型生成的描述不能替代游戏返回的成功证据。

## 可选官方服务

开源核心可以使用自行配置的模型和工具，不依赖官方账号、余额或支付服务。

预装官方服务的发行包通过可选 DSH 插件提供登录、额度与托管模型入口。用户可在「设置 → 插件」停用官方托管服务，再配置自己的模型。插件状态变化不应切换或删除会话与工作区；已被上游接收的请求不会因此自动撤销。

公共仓库不包含私有账号、计费、支付实现或服务端密钥。官方托管能力的存在不代表生产服务、支付或签名安装包已经正式开放。

## 开发环境

- Windows 为当前主要开发环境。
- Node.js `22.19+`。
- pnpm `10.28.2`，以根目录 `packageManager` 为准。
- 真实游戏验证需要合法安装的游戏及对应 MOD 环境。

### 获取源码与检查

```powershell
git clone https://github.com/FromNextWorld/ai-native-game-harness.git
cd ai-native-game-harness
pnpm install --frozen-lockfile
pnpm check
```

### 桌面开发

```powershell
pnpm desktop:dev:prepare
pnpm desktop:dev
```

首次使用需准备开发 Runtime。修改插件源码后，执行 `pnpm desktop:dev:sync` 并重新启动开发版。准备脚本可能下载和构建依赖；开发启动不等于生成正式安装包。

### 专项验证

```powershell
pnpm test:dual-session
pnpm test:office-work
pnpm smoke:desktop-startup
```

专项测试的环境要求与人工验收步骤见[游戏内办公验收](docs/testing/GAME_DEMO_ACCEPTANCE.md)和[办公成果验收](docs/testing/OFFICE_WORK_GOLDEN_ACCEPTANCE.md)。自动检查不能替代真实麦克风、游戏内气泡时序和长期存档测试。

## 目录结构

| 路径 | 职责 |
| --- | --- |
| `apps/desktop/` | 桌面宿主与开发入口 |
| `packages/` | 协议、运行时和共享能力 |
| `plugins/` | DSH 插件与工作编排 |
| `games/` | 游戏适配、MOD 和接入脚本 |
| `examples/adapter-starter/` | 第三方 Adapter 示例 |
| `docs/` | 架构、安装与验收文档 |
| `site/` | GitHub Pages 玩家版、开发者版与理念页面 |

## 文档

- [接入新游戏](docs/INDEPENDENT_PLATFORM.md)
- [安装与升级](docs/xiaotangyuan/INSTALLATION.md)
- [故障排查](docs/xiaotangyuan/TROUBLESHOOTING.md)
- [技术状态与决策](docs/INTERNAL_DEVELOPMENT.md)
- [真实游戏稳定性验收](docs/testing/LIGHTWEIGHT_GAME_STABILITY.md)

## 参与贡献

欢迎通过 [Issues](https://github.com/FromNextWorld/ai-native-game-harness/issues) 报告问题或讨论需求，通过 Pull Request 提交改进。

问题报告请附上系统、游戏与 MOD 版本、复现步骤、预期和实际结果，以及脱敏后的日志。提交代码前请阅读 [协作规则](AGENTS.md)，并运行与改动相关的检查；请勿提交密钥、个人凭据、游戏存档或构建产物。

如果项目对你有帮助，欢迎给一个 Star。这是自愿支持，不是使用或二次开发的附加条件。

## 许可证

本项目采用 [MIT License](LICENSE)。第三方游戏、素材和依赖的权利及许可证归各自权利方；本仓库许可证不替代其授权条件。
