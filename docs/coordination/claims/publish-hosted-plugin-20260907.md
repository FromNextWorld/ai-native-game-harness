# 官方服务插件边界与双仓库上传

- Task ID: `publish-hosted-plugin-20260907`
- 状态：文档与网页已验证，准备上传草稿 PR
- 分支与 worktree：`task/publish-hosted-plugin-20260907` / `C:/game/ai-native-game-harness-worktrees/publish-hosted-plugin-20260907`
- 目标：根据用户请求更新公开文档、网页并上传；商业插件在独立私有仓库上传。
- 允许修改：本 claim、`docs/INTERNAL_DEVELOPMENT.md`、`site/index.html`、`site/developers.html`。
- 共享热点：不修改 README、主进程、构建配置、锁文件、版本清单及理念文档。
- 边界：不调度其他任务，不修改云资源、游戏安装或运行中 Desktop；不把商业源码复制到公共仓库。
- 验证：页面 57 项相对资源/链接/锚点通过；`git diff --check` 通过；公开页面不含私有仓库名。不宣称真实游戏或支付验收，没有启动后台服务或构建安装包。
- 发布：独立分支和草稿 PR，不自动合并 main。
