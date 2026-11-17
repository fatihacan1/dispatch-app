import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForResponsive } from "./boot";

describe("waitForResponsive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).window = globalThis;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for indexStarted, mainQuietMs, and quietMs before resolving", async () => {
    let indexStarted = false;
    let mainQuietMs = 0;
    const statuses: string[] = [];

    const { promise } = waitForResponsive({
      ready: async () => ({ ok: true, indexStarted, mainQuietMs }),
      onStatus: s => statuses.push(s),
      quietMs: 300,
      pollMs: 50,
      timeoutMs: 5000,
    });

    let settled = false;
    void promise.then(ok => { settled = ok; });

    await vi.advanceTimersByTimeAsync(150);
    expect(settled).toBe(false);
    expect(statuses).toContain("Starting code index");

    indexStarted = true;
    await vi.advanceTimersByTimeAsync(150);
    expect(settled).toBe(false);
    expect(statuses).toContain("Waiting for app to settle");

    mainQuietMs = 300;
    await vi.advanceTimersByTimeAsync(350);
    expect(settled).toBe(true);
  });

  it("resolves false on safety timeout", async () => {
    const { promise } = waitForResponsive({
      ready: async () => ({ ok: true, indexStarted: false, mainQuietMs: 0 }),
      quietMs: 1000,
      pollMs: 100,
      timeoutMs: 500,
    });

    let result: boolean | null = null;
    void promise.then(ok => { result = ok; });

    await vi.advanceTimersByTimeAsync(550);
    expect(result).toBe(false);
  });
});
