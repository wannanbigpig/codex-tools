# Codex Accounts Manager [English](README.en.md) · 简体中文

VS Code 扩展，用于管理多个 Codex 账号、查看配额总览，并快速切换当前生效的全局 `auth.json`。

![Version](https://img.shields.io/visual-studio-marketplace/v/wannanbigpig.codex-accounts-manager)
![Downloads](https://img.shields.io/visual-studio-marketplace/d/wannanbigpig.codex-accounts-manager)
![License](https://img.shields.io/github/license/wannanbigpig/codex-tools)

---

## 功能概览

### 配额总览面板

![Codex Tools quota dashboard](https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/media/image.png)

提供一个 Webview 仪表盘，用来集中查看和管理所有 Codex 账号：

- 当前账号摘要：显示当前账号、当前团队与快捷操作
- 配额仪表：展示 5 小时、每周、代码审查配额
- 已保存账号列表：集中查看所有已保存账号
- 快捷操作：添加账号、导入当前账号、刷新全部配额

### 多账号管理

- 通过 OAuth 添加新账号
- 导入当前本机正在使用的 Codex `auth.json`
- 本地保存多个账号
- 一键切换当前生效账号
- 删除不再使用的账号

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

### 详情面板

支持打开单个账号详情页，查看更多原始信息，包括：

- 账号邮箱
- 团队 / 组织信息
- 用户 ID / 账号 ID
- 配额原始返回数据

---

## 使用方式

1. 安装扩展
2. 运行 `Codex Accounts: Add Account via OAuth` 添加账号
3. 或运行 `Codex Accounts: Import Current auth.json` 导入当前账号
4. 运行 `Codex Accounts: Show Quota Summary` 打开总览面板
5. 在面板中刷新配额、切换账号、查看详情和管理状态栏展示

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

### VS Code 插件市场

1. 打开扩展面板
2. 搜索 `Codex Accounts Manager`
3. 点击安装

### VSIX 安装

```bash
code --install-extension codex-accounts-manager-x.y.z.vsix
```

---

## 从源码构建

```bash
git clone https://github.com/wannanbigpig/codex-tools.git
cd codex-tools
npm install
npm run compile
```

在 VS Code 中按 `F5` 启动 Extension Development Host。

打包命令：

```bash
npx @vscode/vsce package
```

---

## 说明

- 账号数据保存在本地
- 切换账号会更新当前机器全局生效的 Codex `auth.json`
- 配额显示依赖当前账号会话返回的数据

---

## 支持

- [GitHub](https://github.com/wannanbigpig/codex-tools)
- [Issues](https://github.com/wannanbigpig/codex-tools/issues)

---

## 许可证

如需发布到公开市场，建议补充 [LICENSE](LICENSE) 文件。
