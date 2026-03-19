import * as crypto from "crypto";
import { readAuthFile } from "../codex";
import { extractClaims } from "./jwt";

export function buildAccountStorageId(email: string, accountId?: string, organizationId?: string): string {
  const seed = [email.trim(), accountId?.trim(), organizationId?.trim()].filter(Boolean).join("|");
  return `codex_${crypto.createHash("md5").update(seed).digest("hex")}`;
}

export async function readCurrentAuthAccountStorageId(): Promise<string | undefined> {
  const auth = await readAuthFile();
  if (!auth?.tokens?.id_token || !auth.tokens.access_token) {
    return undefined;
  }

  const claims = extractClaims(auth.tokens.id_token, auth.tokens.access_token);
  if (!claims.email) {
    return undefined;
  }

  return buildAccountStorageId(claims.email, claims.accountId, claims.organizationId);
}
