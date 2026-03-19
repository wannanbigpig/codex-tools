# Codex Accounts Manager 

English · [简体中文](README.md)

VS Code extension for managing multiple Codex accounts, viewing quota usage, and switching the active global `auth.json`.

![Version](https://img.shields.io/badge/version-0.0.8-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.96.0-007acc)
![License](https://img.shields.io/github/license/wannanbigpig/codex-tools)
![Stars](https://img.shields.io/github/stars/wannanbigpig/codex-tools?style=flat)
![Last Commit](https://img.shields.io/github/last-commit/wannanbigpig/codex-tools)

---

Manage multiple Codex accounts inside VS Code, inspect quota usage, switch the active global account, and monitor key quota data from the status bar.

**Features:** quota dashboard, multi-account management, OAuth sign-in, first-run local account detection and binding, immediate quota refresh after import, cross-window account sync, Codex App auto-restart, status bar monitoring, details panel, multilingual UI, and extension-level language override.

**Language:** follows the current VS Code display language. Primary support is for Simplified Chinese and English, with additional localization for other languages.

---

## Preview

| Quota Dashboard | Details Panel |
| --- | --- |
| <img src="https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/media/dashboard.png" alt="Codex Tools quota dashboard" width="420" /> | <img src="https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/media/detail.png" alt="Codex Tools details panel" width="420" /> |
| Settings Panel | Status Bar |
| <img src="https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/media/setting.png" alt="Codex Tools settings panel" width="260" /> | <img src="https://raw.githubusercontent.com/wannanbigpig/codex-tools/master/media/status_bar.png" alt="Codex Tools status bar" width="220" /> |

---

## Overview

### Quota Dashboard

The extension provides a Webview dashboard for managing and monitoring all saved Codex accounts in one place:

- Current account summary with team info and quick actions
- Quota gauges for 5-hour, weekly, and code review usage
- Saved accounts list for multi-account management
- Quick actions for add, import, and refresh-all

### Multi-Account Management

- Add a new account through OAuth
- Detect an existing local Codex `auth.json` when no account has been saved yet
- Bind the detected local account into the extension with one click
- Import the currently active local Codex `auth.json`
- Refresh quota immediately after local bind or import
- Store multiple accounts locally
- Switch the active account with one click
- Remove accounts you no longer use

### Cross-Window Sync

- Watch global `auth.json` changes
- Automatically sync the active account when another VS Code window switches accounts
- Prompt the current window to reload when an external account switch is detected

### Codex App Integration

- Detect whether Codex App is installed when switching accounts
- Automatically restart Codex App if it is already running
- Skip restart if the desktop app is installed but not currently running
- Currently supports common macOS, Windows, and Linux install/process patterns

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

### Multilingual UI

- Automatically follows the current VS Code display language
- Primary support for Simplified Chinese and English, with additional localization for other languages
- Dashboard copy, prompts, and interaction text switch with the editor language
- You can also force this extension to use Simplified Chinese, English, or another supported language without changing the rest of VS Code

### Details Panel

Open a per-account details panel to inspect:

- Account email
- Team / organization information
- User ID / account ID
- Raw quota payload

---

## Settings

You can change these directly from the settings button in the top-right corner of the dashboard, or from VS Code Settings by searching for `codexAccounts`.

- `Language`
  - `Auto (follow VS Code)`, `Simplified Chinese`, `English`, and other supported languages
  - Only affects codex-tools dashboard copy and prompt text
- `Codex App Restart Policy`
  - Disabled by default
  - When enabled, choose:
  - `Restart automatically`: restart Codex App on account switch if it is already running
  - `Ask every time`: let you confirm each restart manually
- `Automatic Quota Refresh`
  - Can be disabled, or set to `5 / 10 / 15 / 30 / 60` minutes
  - Disabled by default
  - When disabled, no timed refresh runs
- `Automatic Account Switching`
  - Disabled by default
  - When enabled, set separate thresholds for `5-hour` and `weekly` quota
  - After refresh, the extension can switch to another saved account when the active one hits a threshold
- `Codex App Launch Path`
  - Optional custom desktop app path
  - Leave empty to use auto-detection
- `Dashboard Display`
  - Choose whether to show the `Code Review` quota
- `Quota Warning`
  - Enable or disable low-quota alerts
  - Disabled by default
  - When enabled, choose a threshold from `5%` to `90%`
  - After refresh, the extension shows a localized warning when the active account drops below the configured threshold

---

## Usage

1. Install the extension
2. On first launch, if a local Codex `auth.json` already exists, the extension can bind it and refresh quota immediately
3. Run `Codex Accounts: Add Account via OAuth`
4. Or run `Codex Accounts: Import Current auth.json`
5. Run `Codex Accounts: Show Quota Summary`
6. Refresh quotas, switch accounts, inspect details, and manage status bar visibility from the dashboard

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

The extension is now available on the VS Code Marketplace, and you can still install it from a `.vsix` package or run it from source.

### Option 1: Install from the Marketplace

1. Open the Extensions view in VS Code
2. Search for `Codex Accounts Manager`
3. Find the extension published by `wannanbigpig` and click Install

You can also open the Marketplace page directly:

[Codex Accounts Manager - Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=wannanbigpig.codex-accounts-manager)

### Option 2: Install from VSIX

1. Download the released `.vsix` file
2. Open the Command Palette in VS Code
3. Run `Extensions: Install from VSIX...`
4. Select the downloaded `.vsix` file

Or install from the command line:

```bash
code --install-extension codex-accounts-manager-x.y.z.vsix
```

### Option 3: Run from Source

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
- Quota is refreshed immediately after local account bind/import
- External account changes from another window are detected automatically
- Codex App restart only happens when the desktop app is already running
- Quota visibility depends on the data returned by the current Codex session

---

## Support

- ⭐ [GitHub Star](https://github.com/wannanbigpig/codex-tools)
- 💬 [Report Issues](https://github.com/wannanbigpig/codex-tools/issues)

---

## 💝 Support The Project

Thanks for using `codex-tools`.

If this project helps you, you can support its ongoing development and maintenance.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-orange?style=for-the-badge&logo=buy-me-a-coffee)](https://github.com/wannanbigpig/codex-tools/blob/master/docs/DONATE.en.md)

---

## License

This project is open-sourced under the [MIT License](LICENSE).
