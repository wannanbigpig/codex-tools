import { describe, expect, it, vi } from "vitest";
import type * as http from "http";
import {
  hashWebDashboardPassword,
  verifyWebDashboardPassword,
  WEB_DASHBOARD_PASSWORD_MIN_LENGTH
} from "../src/services/webDashboardPassword";
import {
  isAddressInUseError,
  isForwardedHttpsRequest,
  WebDashboardServer
} from "../src/services/webDashboardServer";

describe("Web Dashboard password", () => {
  it("hashes and verifies a six-character password with the configured scrypt memory budget", async () => {
    const password = "123456";
    const stored = await hashWebDashboardPassword(password);

    expect(WEB_DASHBOARD_PASSWORD_MIN_LENGTH).toBe(6);
    expect(stored).not.toContain(password);
    await expect(verifyWebDashboardPassword(password, stored)).resolves.toBe(true);
    await expect(verifyWebDashboardPassword("654321", stored)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    await expect(verifyWebDashboardPassword("123456", "invalid")).resolves.toBe(false);
    await expect(verifyWebDashboardPassword("123456", "scrypt$bad$bad")).resolves.toBe(false);
  });

  it("recognizes a shared dashboard port without hiding unrelated server errors", () => {
    expect(isAddressInUseError(Object.assign(new Error("busy"), { code: "EADDRINUSE" }))).toBe(true);
    expect(isAddressInUseError(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(false);
    expect(isAddressInUseError("EADDRINUSE")).toBe(false);
  });
});

describe("Web Dashboard forwarded protocol", () => {
  it("recognizes cloudflared HTTPS forwarding headers", () => {
    expect(isForwardedHttpsRequest({ headers: { "x-forwarded-proto": "https" } })).toBe(true);
    expect(isForwardedHttpsRequest({ headers: { "cf-visitor": '{"scheme":"https"}' } })).toBe(true);
    expect(isForwardedHttpsRequest({ headers: { "x-forwarded-proto": "http" } })).toBe(false);
  });

  it("returns 401 JSON for an expired tunneled API session", async () => {
    const server = new WebDashboardServer(
      {
        secrets: { get: vi.fn(async () => "configured") },
        globalStorageUri: { fsPath: "storage" },
        extensionUri: { fsPath: "extension" }
      } as never,
      {} as never
    );
    const headers = new Map<string, unknown>();
    let body = "";
    const response = {
      statusCode: 200,
      setHeader: vi.fn((key: string, value: unknown) => headers.set(key.toLowerCase(), value)),
      end: vi.fn((value?: string) => {
        body = value ?? "";
      })
    } as unknown as http.ServerResponse;
    const handle = (server as unknown as {
      handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>;
    }).handle.bind(server);

    await handle(
      {
        method: "POST",
        url: "/api/message",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" }
      } as http.IncomingMessage,
      response
    );

    expect(response.statusCode).toBe(401);
    expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(JSON.parse(body)).toEqual({ error: "Dashboard session expired" });
    server.dispose();
  });
});
