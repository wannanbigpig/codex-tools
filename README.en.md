# Codex Accounts Manager English · [简体中文](README.md)

VS Code extension for managing multiple Codex accounts, viewing quota usage, and switching the active global `auth.json`.

![Version](https://img.shields.io/badge/version-0.0.1-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.96.0-007acc)
![License](https://img.shields.io/github/license/wannanbigpig/codex-tools)
![Stars](https://img.shields.io/github/stars/wannanbigpig/codex-tools?style=flat)
![Last Commit](https://img.shields.io/github/last-commit/wannanbigpig/codex-tools)

---

Manage multiple Codex accounts inside VS Code, inspect quota usage, switch the active global account, and monitor key quota data from the status bar.

**Features:** quota dashboard, multi-account management, OAuth sign-in, current `auth.json` import, single/all quota refresh, status bar monitoring, details panel, bilingual UI.

**Language:** follows the current VS Code display language. Currently supports Simplified Chinese and English.

---

## Overview

### Quota Dashboard

![Codex Tools quota dashboard](https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/media/image.png)

The extension provides a Webview dashboard for managing and monitoring all saved Codex accounts in one place:

- Current account summary with team info and quick actions
- Quota gauges for 5-hour, weekly, and code review usage
- Saved accounts list for multi-account management
- Quick actions for add, import, and refresh-all

### Multi-Account Management

- Add a new account through OAuth
- Import the currently active local Codex `auth.json`
- Store multiple accounts locally
- Switch the active account with one click
- Remove accounts you no longer use

### Quota Visibility

Each account can show:

- 5-hour quota percentage
- Weekly quota percentage
- Code review quota percentage
- Reset countdown
- Last refresh time

### Status Bar Monitoring

- Show the current account quota summary in the VS Code status bar
- Pin selected accounts from the dashboard into status visibility
- Click the status bar entry to open the full quota dashboard

### Bilingual UI

- Automatically follows the current VS Code display language
- Supports Simplified Chinese and English
- Dashboard copy, prompts, and interaction text switch with the editor language

### Details Panel

Open a per-account details panel to inspect:

- Account email
- Team / organization information
- User ID / account ID
- Raw quota payload

---

## Usage

1. Install the extension
2. Run `Codex Accounts: Add Account via OAuth`
3. Or run `Codex Accounts: Import Current auth.json`
4. Run `Codex Accounts: Show Quota Summary`
5. Refresh quotas, switch accounts, inspect details, and manage status bar visibility from the dashboard

---

## Commands

Available commands in the VS Code Command Palette:

- `Codex Accounts: Add Account via OAuth`
- `Codex Accounts: Import Current auth.json`
- `Codex Accounts: Switch Account`
- `Codex Accounts: Refresh Quota`
- `Codex Accounts: Refresh All Quotas`
- `Codex Accounts: Remove Account`
- `Codex Accounts: Open Details`
- `Codex Accounts: Show Quota Summary`

---

## Installation

The extension is not yet available on the VS Code Marketplace. For now, install it manually from a `.vsix` package.

### Option 1: Install from VSIX

1. Download the released `.vsix` file
2. Open the Command Palette in VS Code
3. Run `Extensions: Install from VSIX...`
4. Select the downloaded `.vsix` file

Or install from the command line:

```bash
code --install-extension codex-accounts-manager-x.y.z.vsix
```

### Option 2: Run from Source

```bash
git clone https://github.com/wannanbigpig/codex-tools.git
cd codex-tools
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.

---

## Package VSIX

```bash
npx @vscode/vsce package
```

---

## Notes

- Account data is stored locally
- Switching accounts updates the machine-wide active Codex `auth.json`
- Quota visibility depends on the data returned by the current Codex session

---

## Support

- ⭐ [GitHub Star](https://github.com/wannanbigpig/codex-tools)
- 💬 [Report Issues](https://github.com/wannanbigpig/codex-tools/issues)

---

## License

This project is open-sourced under the [MIT License](LICENSE).
