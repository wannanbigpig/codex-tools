import { describe, expect, it } from "vitest";
import { redactDebugText } from "../src/utils/debug";

describe("debug-log redaction", () => {
  it("removes common credentials and account identifiers before backup export", () => {
    const raw = [
      "email=user@example.com",
      "authorization: Bearer secret-value",
      '"api_key":"sk-abcdefghijklmnopqrstuvwxyz"',
      '"access_token":"eyJhbGciOiJub25lIn0.eyJleHAiOjF9.signature"',
      "account_id=acct_private",
      "Authorization: Basic dXNlcjpwYXNz",
      "https://example.test/callback?access_token=url-secret&client_secret=client-secret",
      "Set-Cookie: session=private; HttpOnly"
    ].join("\n");
    const sanitized = redactDebugText(raw);

    expect(sanitized).not.toContain("user@example.com");
    expect(sanitized).not.toContain("secret-value");
    expect(sanitized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(sanitized).not.toContain("eyJhbGciOiJub25lIn0");
    expect(sanitized).not.toContain("acct_private");
    expect(sanitized).not.toContain("dXNlcjpwYXNz");
    expect(sanitized).not.toContain("url-secret");
    expect(sanitized).not.toContain("client-secret");
    expect(sanitized).not.toContain("session=private");
  });
});
