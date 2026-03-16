/**
 * Codex 认证文件操作模块
 *
 * 优化内容:
 * - 添加 JSDoc 注释
 * - 修复 TypeScript 严格模式下的索引访问错误
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { CodexAuthFile, CodexTokens } from "../core/types";

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
  } catch {
    return undefined;
  }
}

/**
 * 写入 auth.json 文件
 *
 * @param tokens - 认证令牌
 */
export async function writeAuthFile(tokens: CodexTokens): Promise<void> {
  const authFile: CodexAuthFile = {
    OPENAI_API_KEY: null,
    tokens: {
      id_token: tokens.idToken,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      account_id: tokens.accountId
    },
    last_refresh: new Date().toISOString()
  };

  await fs.mkdir(getCodexHome(), { recursive: true });
  await fs.writeFile(getAuthJsonPath(), JSON.stringify(authFile, null, 2), "utf8");
}
