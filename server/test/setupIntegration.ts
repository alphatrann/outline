// Setup for tests that run against real Postgres and Redis containers. Unlike
// setupMocks.ts it does not mock ioredis, bull or the mutex lock.

import { vi } from "vitest";
import "./setupDirectories";

vi.mock("@aws-sdk/signature-v4-crt", () => ({}));
vi.mock("dd-trace", async () => {
  const mod = await import("../__mocks__/dd-trace");
  return { default: mod.mockTracer, ...mod };
});
vi.mock("franc", () => import("../__mocks__/franc"));
vi.mock(
  "request-filtering-agent",
  () => import("../__mocks__/request-filtering-agent")
);
