// This file runs before the test environment is set up to ensure mocks are registered early.
// It prevents real Redis clients from being initialized during module imports.

import { vi } from "vitest";
import type * as IORedisMock from "ioredis-mock";
import "./setupDirectories";

vi.mock("ioredis", async () => {
  const mod = await vi.importActual<typeof IORedisMock>("ioredis-mock");
  return mod;
});

vi.mock("@server/utils/MutexLock");

vi.mock("@aws-sdk/signature-v4-crt", () => ({}));

// Auto-mock these modules using the corresponding files under server/__mocks__/.
// Vitest requires an explicit vi.mock() call to wire them up.
vi.mock("bull", () => import("../__mocks__/bull"));
vi.mock("dd-trace", async () => {
  const mod = await import("../__mocks__/dd-trace");
  return { default: mod.mockTracer, ...mod };
});
vi.mock("franc", () => import("../__mocks__/franc"));
vi.mock(
  "request-filtering-agent",
  () => import("../__mocks__/request-filtering-agent")
);
