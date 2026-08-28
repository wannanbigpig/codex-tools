/**
 * Codex 认证文件操作模块
 *
 * 优化内容:
 * - ChatGPT OAuth accounts use the explicit auth_mode="chatgpt" format emitted by Codex
 * - 原子写入 auth.json（临时文件 + rename），避免中断/磁盘满损坏
 * - macOS 下同步 Codex Keychain（service="Codex Auth"），避免 codex 扩展读旧凭证
 */

import * as crypto from "crypto";
import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { CodexAuthFile, CodexTokens } from "../core/types";

/** macOS 下 Codex 读取凭证的 Keychain service */
const CODEX_KEYCHAIN_SERVICE = "Codex Auth";

/**
 * 获取 Codex 主目录
 *
 * @returns CODEX_HOME 路径
 */
export function getCodexHome(): string {
  const envHome = process.env["CODEX_HOME"]?.trim();
  if (envHome) {
    return envHome.replace(/^['"]|['"]$/g, "");
  }
  return path.join(os.homedir(), ".codex");
}

/**
 * 获取 auth.json 文件路径
 */
export function getAuthJsonPath(): string {
  return path.join(getCodexHome(), "auth.json");
}

/**
 * 读取 auth.json 文件
 *
 * @returns 认证文件内容，如果不存在则返回 undefined
 */
export async function readAuthFile(): Promise<CodexAuthFile | undefined> {
  try {
    const raw = await fs.readFile(getAuthJsonPath(), "utf8");
    return JSON.parse(raw) as CodexAuthFile;
  } catch (error) {
    // 文件不存在是正常情况（首次启动或未登录）
    if (isFileNotFound(error)) {
      return undefined;
    }
    // 文件损坏 / 权限错误 / JSON 解析错误 → 打日志方便排查
    console.warn("[codexAccounts] unable to read auth.json:", error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * 写入 auth.json 文件
 *
 * ChatGPT sign-in uses Codex's explicit chatgpt auth mode, matching Codex's
 * current auth.json format.
 * 写入采用原子替换，并在 macOS 下同步 Keychain。
 *
 * @param tokens - 认证令牌
 */
export async function writeAuthFile(tokens: CodexTokens): Promise<void> {
  const authFile = buildCodexAuthFile(tokens);
  const content = JSON.stringify(authFile, null, 2);

  await writeAuthJsonAtomic(getAuthJsonPath(), content);
  await syncCodexKeychain(content);
}

/**
 * Upgrade a legacy token-based auth.json that omitted auth_mode. Existing
 * credentials and last_refresh are preserved byte-for-value in the new JSON.
 */
export async function ensureCodexAuthFileFormat(): Promise<boolean> {
  const filePath = getAuthJsonPath();
  let parsed: CodexAuthFile;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as CodexAuthFile;
  } catch (error) {
    if (isFileNotFound(error)) {
      return false;
    }
    throw error;
  }

  if (parsed.auth_mode === "chatgpt") {
    return false;
  }
  if (
    parsed.OPENAI_API_KEY !== null ||
    typeof parsed.tokens?.id_token !== "string" ||
    !parsed.tokens.id_token ||
    typeof parsed.tokens.access_token !== "string" ||
    !parsed.tokens.access_token
  ) {
    // Never relabel API-key or unrecognized credential formats.
    return false;
  }

  const normalized: CodexAuthFile = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: parsed.tokens.id_token,
      access_token: parsed.tokens.access_token,
      refresh_token: parsed.tokens.refresh_token ?? "",
      account_id: parsed.tokens.account_id ?? ""
    },
    last_refresh: parsed.last_refresh ?? ""
  };
  const content = JSON.stringify(normalized, null, 2);
  await writeAuthJsonAtomic(filePath, content);
  await syncCodexKeychain(content);
  return true;
}

/**
 * 构建 auth.json 内容。
 */
export function buildCodexAuthFile(tokens: CodexTokens, refreshedAt = new Date()): CodexAuthFile {
  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: tokens.idToken,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken ?? "",
      account_id: tokens.accountId ?? ""
    },
    last_refresh: refreshedAt.toISOString()
  };
}

/**
 * 原子写入文件：先写临时文件，再 rename 替换，避免半写入。
 */
async function writeAuthJsonAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.tmp.${process.pid}.${crypto.randomBytes(4).toString("hex")}`
  );
  // Tokens are credentials: keep the staging file private even before rename.
  await fs.writeFile(tmpPath, content, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(tmpPath, 0o600).catch(() => undefined);
  try {
    await replaceAuthFileWithRetry(tmpPath, filePath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

async function replaceAuthFileWithRetry(tmpPath: string, filePath: string): Promise<void> {
  const delays = [20, 50, 100, 200, 400];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await fs.rename(tmpPath, filePath);
      await fs.chmod(filePath, 0o600).catch(() => undefined);
      return;
    } catch (error) {
      lastError = error;
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (!(code === "EACCES" || code === "EBUSY" || code === "EPERM") || attempt === delays.length) {
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]!));
    }
  }

  const code =
    typeof lastError === "object" && lastError !== null && "code" in lastError
      ? String((lastError as { code?: unknown }).code)
      : "";
  if (code === "EACCES" || code === "EBUSY" || code === "EPERM") {
    await fs.copyFile(tmpPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => undefined);
    await fs.unlink(tmpPath).catch(() => undefined);
    return;
  }
  throw lastError;
}

/**
 * macOS 下同步 Codex Keychain。
 *
 * codex 在 macOS 优先从 Keychain（service="Codex Auth"，account="cli|<sha256(codex_home)[:16]>"）
 * 读取凭证。仅写 auth.json 会导致 codex 扩展仍使用旧账号凭证，表现为登出/账号串台。
 * 失败仅记录，不阻断主流程。
 */
async function syncCodexKeychain(authJsonContent: string): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    const account = await buildCodexKeychainAccount();
    await new Promise<void>((resolve, reject) => {
      execFile(
        "security",
        ["add-generic-password", "-U", "-s", CODEX_KEYCHAIN_SERVICE, "-a", account, "-w", authJsonContent],
        (error) => {
          if (error) {
            reject(error instanceof Error ? error : new Error("Failed to update the Codex keychain", { cause: error }));
          } else {
            resolve();
          }
        }
      );
    });
  } catch {
    // Keychain 同步为 best-effort，失败不阻断 auth.json 写入。
  }
}

/**
 * 计算 Codex Keychain account 标识：cli|<sha256(canonicalize(codex_home))[:16]>。
 * 与 cockpit-tools / codex 官方读取逻辑保持一致。
 */
async function buildCodexKeychainAccount(): Promise<string> {
  const home = getCodexHome();
  let resolved = home;
  try {
    resolved = await fs.realpath(home);
  } catch {
    resolved = home;
  }
  const digest = crypto.createHash("sha256").update(resolved).digest("hex");
  return `cli|${digest.slice(0, 16)}`;
}
