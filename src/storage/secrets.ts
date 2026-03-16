import * as vscode from "vscode";
import { CodexTokens } from "../core/types";

const SECRET_PREFIX = "codex.account.";

export class SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getTokens(accountId: string): Promise<CodexTokens | undefined> {
    const raw = await this.secrets.get(`${SECRET_PREFIX}${accountId}`);
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as CodexTokens;
  }

  async setTokens(accountId: string, tokens: CodexTokens): Promise<void> {
    await this.secrets.store(`${SECRET_PREFIX}${accountId}`, JSON.stringify(tokens));
  }

  async deleteTokens(accountId: string): Promise<void> {
    await this.secrets.delete(`${SECRET_PREFIX}${accountId}`);
  }
}
