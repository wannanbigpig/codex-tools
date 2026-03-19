# Codex Accounts Manager 

[English](README.en.md) · 简体中文

VS Code 扩展，用于管理多个 Codex 账号、查看配额总览，并快速切换当前生效的全局 `auth.json`。

![Version](https://img.shields.io/badge/version-0.0.8-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.96.0-007acc)
![License](https://img.shields.io/github/license/wannanbigpig/codex-tools)
![Stars](https://img.shields.io/github/stars/wannanbigpig/codex-tools?style=flat)
![Last Commit](https://img.shields.io/github/last-commit/wannanbigpig/codex-tools)

---

用于在 VS Code 中统一管理 Codex 多账号、查看配额、切换当前账号，并通过状态栏快速监控使用情况。

**功能：** 配额总览面板、多账号管理、OAuth 添加账号、首次本地账号自动检测与绑定、导入当前 `auth.json` 后立即刷新、跨窗口账号同步、Codex App 自动重启、状态栏监控、详情面板、多语言界面、本扩展语言覆盖设置。

**语言：** 默认跟随 VS Code 语言设置，当前主要支持简体中文、English，并提供其他语言的本地化支持。

---

## 界面预览

| 配额总览 | 详情面板 |
| --- | --- |
| <img src="https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/media/dashboard.png" alt="Codex Tools 配额总览" width="420" /> | <img src="https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/media/detail.png" alt="Codex Tools 详情面板" width="420" /> |
| 设置面板 | 状态栏 |
| <img src="https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/media/setting.png" alt="Codex Tools 设置面板" width="260" /> | <img src="https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/media/status_bar.png" alt="Codex Tools 状态栏" width="220" /> |

---

## 功能概览

### 配额总览面板

提供一个 Webview 仪表盘，用来集中查看和管理所有 Codex 账号：

- 当前账号摘要：显示当前账号、当前团队与快捷操作
- 配额仪表：展示 5 小时、每周、代码审查配额
- 已保存账号列表：集中查看所有已保存账号
- 快捷操作：添加账号、导入当前账号、刷新全部配额

### 多账号管理

- 通过 OAuth 添加新账号
- 无已绑定账号时自动检测本机已有的 Codex `auth.json`
- 检测到本地账号后可一键绑定到扩展
- 导入当前本机正在使用的 Codex `auth.json`
- 导入或绑定后立即刷新最新配额
- 本地保存多个账号
- 一键切换当前生效账号
- 删除不再使用的账号

### 跨窗口同步

- 监听全局 `auth.json` 变化
- 其他 VS Code 窗口切换账号后，当前窗口会自动同步激活账号状态
- 检测到外部账号切换时，会提示是否重载当前窗口以同步内置 Codex 会话

### Codex App 联动

- 切换账号后自动检测本机是否安装 Codex App
- 如果 Codex App 当前正在运行，则自动重启以应用最新账号状态
- 如果 Codex App 未运行，则跳过，不会强行拉起应用
- 当前已兼容 macOS、Windows、Linux 的常见安装路径与进程检测

### 配额查看

每个账号支持查看：

- 5 小时配额百分比
- 每周配额百分比
- 代码审查配额百分比
- 剩余重置时间
- 最近刷新时间

### 状态栏监控

- 在状态栏显示当前账号配额摘要
- 支持从总览面板将指定账号加入状态栏摘要
- 点击状态栏可直接打开完整配额面板

### 多语言界面

- 自动跟随 VS Code 当前语言环境
- 当前主要支持简体中文、English，并提供其他语言的本地化支持
- 配额总览面板、提示文案和交互文本会随语言切换
- 也可以在扩展设置中单独指定本扩展使用简体中文、English 或其他受支持语言，不影响 VS Code 其他界面

### 详情面板

支持打开单个账号详情页，查看更多原始信息，包括：

- 账号邮箱
- 团队 / 组织信息
- 用户 ID / 账号 ID
- 配额原始返回数据

---

## 设置项

可在总览面板右上角设置按钮中直接调整，也可以通过 VS Code Settings 搜索 `codexAccounts` 修改。

- `语言`
  - `自动（跟随 VS Code）`，或手动指定简体中文、English 及其他受支持语言
  - 仅影响本扩展的总览面板和提示文案
- `Codex App 重启策略`
  - 默认关闭
  - 开启后可选择：
  - `帮我自动重启`：切换账号时，如果 Codex App 正在运行，自动重启
  - `每次手动点击重启`：切换账号后每次手动确认是否立即重启
- `配额自动刷新`
  - 可关闭，或设置为 `5 / 10 / 15 / 30 / 60` 分钟
  - 默认关闭
  - 关闭后不再定时刷新
- `自动切号`
  - 默认关闭
  - 开启后可分别设置 `5 小时` / `每周` 配额阈值
  - 刷新后如果当前激活账号触达阈值，会尝试自动切换到其他可用账号
- `Codex App 启动路径`
  - 可选自定义桌面端路径
  - 留空时使用自动检测
- `仪表盘显示`
  - 可选择是否显示 `Code Review` 配额
- `超额预警`
  - 可开启或关闭低配额提醒
  - 默认关闭
  - 开启后可设置 `5% - 90%` 阈值
  - 刷新配额后，如果当前激活账号低于阈值，会弹出中英文预警提示

---

## 使用方式

1. 安装扩展
2. 首次启动时，如果本机已有本地 Codex `auth.json`，扩展会提示是否立即绑定并刷新配额
3. 也可以运行 `Codex Accounts: Add Account via OAuth` 添加账号
4. 或运行 `Codex Accounts: Import Current auth.json` 导入当前账号
5. 运行 `Codex Accounts: Show Quota Summary` 打开总览面板
6. 在面板中刷新配额、切换账号、查看详情和管理状态栏展示

---

## 命令列表

在 VS Code 命令面板中可使用以下命令：

- `Codex Accounts: Add Account via OAuth`
- `Codex Accounts: Import Current auth.json`
- `Codex Accounts: Switch Account`
- `Codex Accounts: Refresh Quota`
- `Codex Accounts: Refresh All Quotas`
- `Codex Accounts: Remove Account`
- `Codex Accounts: Open Details`
- `Codex Accounts: Show Quota Summary`

---

## 安装

现在可以直接通过 VS Code 扩展市场安装，也保留 `.vsix` 和源码运行方式。

### 方式一：从扩展市场安装

1. 打开 VS Code 扩展面板
2. 搜索 `Codex Accounts Manager`
3. 找到发布者 `wannanbigpig` 的扩展并点击安装

也可以直接打开市场页面：

[Codex Accounts Manager - Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=wannanbigpig.codex-accounts-manager)

### 方式二：从 VSIX 安装

1. 下载发布产物 `.vsix`
2. 在 VS Code 中打开命令面板
3. 执行 `Extensions: Install from VSIX...`
4. 选择下载好的 `.vsix` 文件完成安装

也可以使用命令行安装：

```bash
code --install-extension codex-accounts-manager-x.y.z.vsix
```

### 方式三：从源码运行

```bash
git clone https://github.com/wannanbigpig/codex-tools.git
cd codex-tools
npm install
npm run compile
```

在 VS Code 中按 `F5` 启动 Extension Development Host。

---

## 打包 VSIX

```bash
npx @vscode/vsce package
```

---

## 说明

- 账号数据保存在本地
- 切换账号会更新当前机器全局生效的 Codex `auth.json`
- 导入当前账号或首次绑定本地账号后，会立即刷新最新配额
- 如果其他窗口切换了账号，当前窗口会自动检测并提示同步
- 如果 Codex App 正在运行，切换账号后会尝试自动重启；未运行则跳过
- 配额显示依赖当前账号会话返回的数据

---

## 支持

- ⭐ [GitHub Star](https://github.com/wannanbigpig/codex-tools)
- 💬 [反馈问题](https://github.com/wannanbigpig/codex-tools/issues)

---

## 💝 赞助项目

感谢你使用 `codex-tools`。

如果这个项目对你有帮助，欢迎赞助项目的持续开发和维护。

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-支持作者-orange?style=for-the-badge&logo=buy-me-a-coffee)](https://github.com/wannanbigpig/codex-tools/blob/master/docs/DONATE.md)

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
