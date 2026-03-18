import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { setTimeout as delay } from "timers/promises";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

const MAC_APP_CANDIDATES = [
  "/Applications/Codex.app",
  "/Applications/OpenAI Codex.app",
  path.join(os.homedir(), "Applications", "Codex.app"),
  path.join(os.homedir(), "Applications", "OpenAI Codex.app")
];

const LOCAL_APP_DATA = process.env["LOCALAPPDATA"] ?? "";
const PROGRAM_FILES = process.env["ProgramFiles"] ?? "";
const PROGRAM_FILES_X86 = process.env["ProgramFiles(x86)"] ?? "";

const WINDOWS_APP_CANDIDATES = [
  path.join(LOCAL_APP_DATA, "Programs", "Codex", "Codex.exe"),
  path.join(LOCAL_APP_DATA, "Programs", "OpenAI Codex", "Codex.exe"),
  path.join(PROGRAM_FILES, "Codex", "Codex.exe"),
  path.join(PROGRAM_FILES, "OpenAI Codex", "Codex.exe"),
  path.join(PROGRAM_FILES_X86, "Codex", "Codex.exe"),
  path.join(PROGRAM_FILES_X86, "OpenAI Codex", "Codex.exe")
].filter(Boolean);

const LINUX_APP_CANDIDATES = [
  "/usr/bin/codex",
  "/usr/local/bin/codex",
  "/opt/Codex/codex",
  "/opt/OpenAI Codex/codex",
  path.join(os.homedir(), ".local", "bin", "codex")
];

const MAC_PROCESS_CANDIDATES = ["Codex", "OpenAI Codex"];
const WINDOWS_PROCESS_CANDIDATES = ["Codex.exe"];
const LINUX_PROCESS_CANDIDATES = ["codex"];

export async function restartCodexAppIfInstalled(): Promise<boolean> {
  const state = await getCodexAppState();
  if (!state.installed || !state.running || !state.launcherPath) {
    return false;
  }

  await forceStopCodexProcesses();
  await delay(800);
  await launchCodexApp(state.launcherPath);
  return true;
}

export async function getCodexAppState(): Promise<{
  installed: boolean;
  running: boolean;
  launcherPath?: string;
}> {
  const launcherPath = await resolveCodexAppLaunchPath();
  if (!launcherPath) {
    return { installed: false, running: false };
  }

  const running = await isCodexAppRunning();
  return { installed: true, running, launcherPath };
}

export async function resolveCodexAppLaunchPath(customPathInput?: string): Promise<string | undefined> {
  const customPath =
    customPathInput?.trim() ?? vscode.workspace.getConfiguration("codexAccounts").get<string>("codexAppPath")?.trim();
  if (customPath) {
    try {
      await fs.access(customPath);
      return customPath;
    } catch {
      // Fall back to built-in detection when the custom path is invalid.
    }
  }

  const candidates = getAppCandidates();
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep checking remaining candidates.
    }
  }
  return undefined;
}

function getAppCandidates(): string[] {
  switch (process.platform) {
    case "darwin":
      return MAC_APP_CANDIDATES;
    case "win32":
      return WINDOWS_APP_CANDIDATES;
    case "linux":
      return LINUX_APP_CANDIDATES;
    default:
      return [];
  }
}

async function launchCodexApp(appPath: string): Promise<void> {
  switch (process.platform) {
    case "darwin":
      await execFileAsync("open", ["-a", appPath]);
      return;
    case "win32":
      await execFileAsync("cmd", ["/c", "start", "", appPath]);
      return;
    case "linux":
      await execFileAsync(appPath, [], { env: process.env });
      return;
    default:
      return;
  }
}

async function forceStopCodexProcesses(): Promise<void> {
  for (const processName of getProcessCandidates()) {
    try {
      await killProcess(processName);
    } catch {
      // Process may not be running. Try the next candidate.
    }
  }
}

async function killProcess(processName: string): Promise<void> {
  switch (process.platform) {
    case "darwin":
    case "linux":
      await execFileAsync("pkill", ["-x", processName]);
      return;
    case "win32":
      await execFileAsync("taskkill", ["/IM", normalizeWindowsProcessName(processName), "/F"]);
      return;
    default:
      return;
  }
}

async function isCodexAppRunning(): Promise<boolean> {
  for (const processName of getProcessCandidates()) {
    try {
      await probeProcess(processName);
      return true;
    } catch {
      // Keep checking remaining candidates.
    }
  }
  return false;
}

function getProcessCandidates(): string[] {
  switch (process.platform) {
    case "darwin":
      return MAC_PROCESS_CANDIDATES;
    case "win32":
      return WINDOWS_PROCESS_CANDIDATES;
    case "linux":
      return LINUX_PROCESS_CANDIDATES;
    default:
      return [];
  }
}

async function probeProcess(processName: string): Promise<void> {
  switch (process.platform) {
    case "darwin":
    case "linux":
      await execFileAsync("pgrep", ["-x", processName]);
      return;
    case "win32": {
      const normalized = normalizeWindowsProcessName(processName);
      const { stdout } = await execFileAsync("tasklist", ["/FI", `IMAGENAME eq ${normalized}`]);
      if (!stdout.toLowerCase().includes(normalized.toLowerCase())) {
        throw new Error(`Process not running: ${normalized}`);
      }
      return;
    }
    default:
      throw new Error("Unsupported platform");
  }
}

function normalizeWindowsProcessName(processName: string): string {
  return processName.toLowerCase().endsWith(".exe") ? processName : `${processName}.exe`;
}
