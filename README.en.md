# Codex Accounts Manager English · [简体中文](README.md)

VS Code extension for managing multiple Codex accounts, viewing quota usage, and switching the active global `auth.json`.

![Version](https://img.shields.io/visual-studio-marketplace/v/wannanbigpig.codex-accounts-manager)
![Downloads](https://img.shields.io/visual-studio-marketplace/d/wannanbigpig.codex-accounts-manager)
![License](https://img.shields.io/github/license/wannanbigpig/codex-tools)

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

### VS Code Marketplace

1. Open the Extensions view
2. Search for `Codex Accounts Manager`
3. Click Install

### Install from VSIX

```bash
code --install-extension codex-accounts-manager-x.y.z.vsix
```

---

## Build from Source

```bash
git clone https://github.com/wannanbigpig/codex-tools.git
cd codex-tools
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.

Package command:

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

- [GitHub](https://github.com/wannanbigpig/codex-tools)
- [Issues](https://github.com/wannanbigpig/codex-tools/issues)

---

## License

If you plan to publish publicly, add a proper [LICENSE](LICENSE) file.
