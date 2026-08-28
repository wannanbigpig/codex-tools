import { EventEmitter } from "events";
import type * as http from "http";
import { describe, expect, it, vi } from "vitest";
import { readDashboardRequestBody } from "../src/services/webDashboardServer";

function createRequest(): http.IncomingMessage & EventEmitter {
  const request = new EventEmitter() as http.IncomingMessage & EventEmitter;
  request.setEncoding = vi.fn().mockReturnValue(request);
  return request;
}

describe("readDashboardRequestBody", () => {
  it("reads a request body within the configured limit", async () => {
    const request = createRequest();
    const pending = readDashboardRequestBody(request, 10);

    request.emit("data", "12345");
    request.emit("end");

    await expect(pending).resolves.toBe("12345");
  });

  it("rejects an oversized body without waiting for a close event", async () => {
    const request = createRequest();
    const pending = readDashboardRequestBody(request, 5);

    request.emit("data", "123456");

    await expect(pending).rejects.toThrow("Request body too large");
  });

  it("rejects an aborted request", async () => {
    const request = createRequest();
    const pending = readDashboardRequestBody(request, 10);

    request.emit("aborted");

    await expect(pending).rejects.toThrow("Request aborted");
  });
});
