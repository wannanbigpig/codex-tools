import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { setTimeout as delay } from "timers/promises";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

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
const CODEX_APP_PATH_CACHE_TTL_MS = 30_000;

let launchPathCache:
  | {
      key: string;
      value?: string;
      checkedAt: number;
    }
  | undefined;

export async function restartCodexAppIfInstalled(): Promise<boolean> {
  const state = await getCodexAppState();
  if (!state.installed || !state.running || !state.launcherPath) {
    return false;
  }

  await forceStopCodexProcesses(state.launcherPath);
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

  const running = await isCodexAppRunning(launcherPath);
  return { installed: true, running, launcherPath };
}

export async function resolveCodexAppLaunchPath(customPathInput?: string): Promise<string | undefined> {
  const customPath =
    customPathInput?.trim() ?? vscode.workspace.getConfiguration("codexAccounts").get<string>("codexAppPath")?.trim();
  const cacheKey = `${process.platform}:${customPath ?? ""}`;
  if (launchPathCache?.key === cacheKey && Date.now() - launchPathCache.checkedAt < CODEX_APP_PATH_CACHE_TTL_MS) {
    return launchPathCache.value;
  }

  const remember = (value: string | undefined): string | undefined => {
    launchPathCache = {
      key: cacheKey,
      value,
      checkedAt: Date.now()
    };
    return value;
  };

  if (customPath) {
    try {
      await fs.access(customPath);
      return remember(customPath);
    } catch {
      // Fall back to built-in detection when the custom path is invalid.
    }
  }

  const candidates = getCodexAppCandidates();
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return remember(candidate);
    } catch {
      // Keep checking remaining candidates.
    }
  }
  return remember(undefined);
}

export function getCodexAppCandidates(
  platform: NodeJS.Platform = process.platform,
  homeDirectory = os.homedir()
): string[] {
  switch (platform) {
    case "darwin":
      return [
        "/Applications/ChatGPT.app",
        path.posix.join(homeDirectory.replace(/\\/g, "/"), "Applications", "ChatGPT.app"),
        "/Applications/Codex.app",
        "/Applications/OpenAI Codex.app",
        path.posix.join(homeDirectory.replace(/\\/g, "/"), "Applications", "Codex.app"),
        path.posix.join(homeDirectory.replace(/\\/g, "/"), "Applications", "OpenAI Codex.app")
      ];
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
      await execFileAsync("open", [appPath]);
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

async function forceStopCodexProcesses(launcherPath: string): Promise<void> {
  if (process.platform === "darwin") {
    const executablePath = await resolveMacAppExecutablePath(launcherPath);
    const processIds = await listMacAppProcessIds(executablePath);
    if (processIds.length > 0) {
      await execFileAsync("kill", ["-TERM", ...processIds.map(String)]);
    }
    return;
  }

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

async function isCodexAppRunning(launcherPath: string): Promise<boolean> {
  if (process.platform === "darwin") {
    const executablePath = await resolveMacAppExecutablePath(launcherPath);
    return (await listMacAppProcessIds(executablePath)).length > 0;
  }

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

async function resolveMacAppExecutablePath(appPath: string): Promise<string> {
  const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
  try {
    const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleExecutable",
      infoPlistPath
    ]);
    const executableName = stdout.trim();
    if (executableName) {
      return path.join(appPath, "Contents", "MacOS", executableName);
    }
  } catch {
    // Fall back to the bundle name for custom or non-standard app bundles.
  }
  return path.join(appPath, "Contents", "MacOS", path.basename(appPath, ".app"));
}

async function listMacAppProcessIds(executablePath: string): Promise<number[]> {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="]);
  return findMacAppProcessIds(stdout, executablePath);
}

export function findMacAppProcessIds(processList: string, executablePath: string): number[] {
  const escapedExecutablePath = executablePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^\\s*(\\d+)\\s+${escapedExecutablePath}(?:\\s|$)`);
  return processList.split(/\r?\n/).flatMap((line) => {
    const match = matcher.exec(line);
    if (!match?.[1]) {
      return [];
    }
    const processId = Number(match[1]);
    return Number.isInteger(processId) && processId > 0 ? [processId] : [];
  });
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
