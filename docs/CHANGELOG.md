# 变更日志

## 维护约定

- `announcements.json` 只保留当前版本的更新公告（`releaseVersion` + 新 `id`），发布新版本时旧版本更新说明可直接移除对应项，避免历史版本在弹窗中继续出现。
- 历史版本正文统一写在本文件，按版本追加条目，不做删除。
- 详情可按 `releaseVersion` 反查本次发布公告对应的 `id` 与变更内容。

## 0.1.18（2026-08-24）

### 变更内容

- 兼容 Codex 合并到新版 ChatGPT 桌面应用后的自动重启：识别 `/Applications/ChatGPT.app`，并按选中 bundle 的真实可执行路径精确匹配主进程，保留旧版 `Codex.app` 兼容。
- 修复 Free 账户刷新时被历史 Plus / Pro 订阅信息覆盖的问题；当前配额确认是 Free 时会清理旧订阅到期时间，过期付费订阅不会继续作为当前套餐返回。
- Free 或 28 天以上配额窗口统一显示为“每月”/`Monthly`，覆盖 Dashboard、状态栏、详情、切号选择和配额预警；付费 7 天窗口继续显示为“每周”/`Weekly`。
- 更新 ChatGPT/Codex 桌面联动与 Free 配额窗口文档，并补充桌面检测、订阅清理、套餐刷新和月度标签回归测试。
- 生产依赖升级到 `undici@6.28.0`，并通过生产依赖安全审计。

### 说明

- 本版本公告使用新 `id`：`ann-2026-08-codex-tools-0-1-18-chatgpt-free-quota`。
- 本次发布包含 ChatGPT 桌面迁移兼容和套餐/配额刷新一致性修复。

## 0.1.17（2026-07-17）

### 变更内容

- 扩展启动时从进程环境或 `CODEX_HOME/.env` 读取 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 与 `NO_PROXY`，并让配额、OAuth、订阅、profile、usage 和公告请求统一使用代理 dispatcher。
- 进程环境变量优先于 `.env`，保留空值覆盖语义；无效代理 URL 或不支持的协议会明确提示并阻止扩展请求，不再静默回退直连。
- 生产依赖升级到 `undici@6.27.0`，消除 6.21.3 的已知安全公告并通过生产依赖审计。
- 接口缺失 5 小时窗口时，兼容百分比规范化为 `100%`，同时继续保持 `hourlyWindowPresent=false`，避免展示误判且不影响自动化窗口校验。
- 状态栏中的 5 小时额度受 `5 小时配额控制` 设置控制：关闭时紧凑文本与 tooltip 只显示每周额度，设置变化会立即刷新。
- 状态栏 tooltip 统一复用套餐格式化规则，将 `chatgptteamplan`、`chatgptplusplan` 等原始标识显示为 `Team`、`Plus`。
- 补充代理解析、空值优先级、fail-closed、真实 dispatcher 路由、缺失窗口规范化和状态栏双态回归测试。

### 说明

- 本版本公告使用新 `id`：`ann-2026-07-codex-tools-0-1-17-proxy-statusbar`。
- 本次发版包含 PR #35、PR #36，以及合并后的状态栏联动和代理安全复核修复。

## 0.1.16（2026-07-13）

### 变更内容

- 新增默认关闭的 `5 小时配额控制`，关闭时仍展示配额，但不参与自动切号或低配额提醒。
- 自动化判断增加配额窗口存在性校验，避免接口缺失窗口被缺省值误判为 `0%`。
- 每周配额保持独立，可在关闭 5 小时自动化时继续触发切号与提醒。
- profile 与订阅刷新结合已保存的 workspace 名称和结构选择正确记录，并可回写修复历史错误的 `accountId`。
- 账号信息同步等待订阅刷新完成后再发布 Dashboard 状态，确保套餐与到期时间及时更新。
- 补充配额窗口、自动化开关、workspace 选择、`accountId` 自修复和订阅解析的回归测试。

### 说明

- 本版本公告使用新 `id`：`ann-2026-07-codex-tools-0-1-16`。
- 本次发版同时修复 5 小时配额误报与同邮箱 Personal / Team workspace 历史身份数据问题。

## 0.1.15（2026-07-08）

### 变更内容

- 修复同邮箱下个人 `Plus` 与团队 `Team` workspace 共享 `accountId` 时，profile/workspace 识别可能串到同一账号上下文的问题。
- 远端 `accounts/check` / profile 解析优先使用选中的 workspace 记录，并把 `organizationId` 纳入 profile 缓存键。
- 收紧 Aideck mirror token 吸收条件，仅在 `email`、`userId`、`accountId`、`organizationId` 以及 token claims 一致时才覆盖本地 SecretStorage。
- mirror 文件若出现“顶层 identity 与嵌入 token claims 不一致”，现在会在读取阶段直接丢弃。
- mirror 回写增加 identity 校验，并默认保留已有 workspace/profile/quota 字段，避免跨项目继续放大脏数据。
- 补充多 workspace、mirror identity 冲突和 token 回写安全的回归测试。

### 说明

- 本版本公告使用新 `id`：`ann-2026-07-codex-tools-0-1-15`。
- 本次发版同时包含 `codex-tools` 与 Aideck 串号问题对应的 VS Code 侧止血修复。

## 0.1.9（2026-04-28）

### 变更内容

- 打包体积优化：VSIX 不再包含 `node_modules` 中的构建期依赖。
- 排除 `lightningcss.darwin-arm64.node` 等构建阶段原生二进制，避免安装包被撑到约 4 MB。
- 0.1.9 VSIX 体积恢复到约 636 KB。
- `.vscodeignore` 新增 `node_modules/**`，后续打包默认只保留扩展运行需要的文件。
- 更新公告 `id` 与 `releaseVersion` 同步为 `0.1.9`。

### 说明

- 本版本公告使用新 `id`：`ann-2026-04-codex-tools-0-1-9-package-size-optimization`。
- 本次不改变运行时功能，主要修复发布包内容与体积。

## 0.1.8（2026-04-28）

### 变更内容

- 详情页主题跟随修复：`auto` 模式优先识别 VS Code 注入的 `vscode-light` / `vscode-dark` / `vscode-high-contrast`，不再只依赖系统深浅色。
- 详情页主题实时同步：监听 VS Code 主题 class 与系统浅色媒体变化，已打开详情页切换深浅色更稳定。
- Dashboard 主面板精简：移除配额卡片上方的“Codex Accounts Manager · 配额总览”说明栏。
- 更新公告规则优化：存在多个 `releaseVersion` 更新说明时，只保留最新版本公告展示。
- 发布记录归档：新增 `docs/CHANGELOG.md` 作为长期版本记录，`announcements.json` 只保留当前版本弹窗说明。
- README 同步：补齐当前功能、命令、设置项以及更新公告维护约定。

### 说明

- 本版本公告使用新 `id`：`ann-2026-04-codex-tools-0-1-8-theme-announcement-polish`。
- 0.1.7 的历史内容保留在本文件下方，不再放入当前版本弹窗公告。

## 0.1.7（2026-04-28）

### 变更内容

- 详情页主题策略优化：新增 `auto` 自动跟随主题，优化浅色/深色下的变量切换与样式细节。
- 详情页使用量 tip、状态标签、隐私入口按钮在浅色主题下对比度优化。
- Dashboard 打开详情页时同步当前隐私模式，支持首次直接隐藏敏感信息（邮箱、名称、ID）。
- 详情页新增订阅到期展示并修复个人 Pro 空间显示。
- Dashboard 更新弹窗新增 `announcement` 通知规则：未读提示可标记已读。
- 状态栏 tooltip 去除固定深色代码高亮背景，提升主题一致性。
- 账号卡片翻面增强：新增工作区、订阅有效期、添加方式、账号状态、user id 与标签查看。
- 额外模型额度展示覆盖更全，配额卡片排版更稳。
- 自动切号、后台刷新相关交互行为与性能路径改进。

### 说明

- 未来每次发版都在本文件追加新版本记录，不会删除历史说明。
- `announcements.json` 中仅保留最新版本说明用于弹窗提示，历史说明请从本文件追溯。

## 0.1.6（2026-04-27）

### 变更内容

- 增强配额刷新与账户状态同步链路。
- 改进卡片状态指示与错误提示。
- 补齐多个语言的细化提示文案。

## 0.1.5（2026-04-26）

### 变更内容

- 新增自动切号策略与告警。
- 新增共享 JSON 导入导出与账号恢复流程。
- 增加更多可读性与交互优化。
