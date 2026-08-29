import * as crypto from "crypto";

export const WEB_DASHBOARD_PASSWORD_MIN_LENGTH = 6;

const SCRYPT_OPTIONS: crypto.ScryptOptions = {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};

export async function hashWebDashboardPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await deriveKey(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyWebDashboardPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  try {
    const saltPart = parts[1];
    const hashPart = parts[2];
    if (!saltPart || !hashPart) {
      return false;
    }
    const salt = Buffer.from(saltPart, "base64");
    const expected = Buffer.from(hashPart, "base64");
    if (salt.length !== 16 || expected.length !== 32) {
      return false;
    }
    const actual = await deriveKey(password, salt, expected.length);
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function deriveKey(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, length, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}
