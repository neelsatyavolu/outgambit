import { describe, expect, it } from "vitest";
import { clockMs, handClock, syncClock } from "./clock";

describe("syncClock", () => {
  it("subtracts server processing from the round trip before estimating transport", () => {
    // 400ms on the server and 40ms in each direction, on unrelated time origins.
    const sample = syncClock(null, { serverReceivedAt: 100_040, serverNow: 100_440 }, 1_000, 1_480);
    expect(sample.networkMs).toBe(80);
    expect(clockMs(20_000, true, 100_440 - sample.offsetMs, 1_480)).toBe(19_960);
  });

  it("keeps the most precise synchronization through a slower response", () => {
    const first = syncClock(null, { serverReceivedAt: 100_040, serverNow: 100_440 }, 1_000, 1_480);
    const next = syncClock(first, { serverReceivedAt: 101_040, serverNow: 101_440 }, 2_000, 2_800);
    // This response spent 360ms travelling back, not the 200ms half-round-trip estimate.
    expect(clockMs(20_000, true, 101_440 - next.offsetMs, 2_800)).toBe(19_640);
  });

  it("improves the estimate when a quicker network sample arrives", () => {
    const first = syncClock(null, { serverReceivedAt: 100_200, serverNow: 100_600 }, 1_000, 1_800);
    const next = syncClock(first, { serverReceivedAt: 101_010, serverNow: 101_410 }, 2_000, 2_420);
    expect(next.networkMs).toBe(20);
    expect(clockMs(20_000, true, 101_410 - next.offsetMs, 2_420)).toBe(19_990);
  });

  it("resynchronizes after the server advances during a suspended local timeline", () => {
    const first = syncClock(null, { serverReceivedAt: 100_040, serverNow: 100_440 }, 1_000, 1_480);
    // Sixty seconds passed on the server while this device's monotonic clock was suspended.
    // Equal round-trip latency must not preserve the old epoch-to-local mapping.
    const resumed = syncClock(first, { serverReceivedAt: 161_040, serverNow: 161_440 }, 2_000, 2_480);
    expect(clockMs(20_000, true, 161_440 - resumed.offsetMs, 2_480)).toBe(19_960);
  });
});

describe("handClock", () => {
  const view = { status: "active" as const, turn: "white" as const, whiteMs: 10_000, blackMs: 20_000 };

  it("freezes the mover and starts the opponent from now", () => {
    expect(handClock(view, 1_000, 1_500)).toEqual({ whiteMs: 9_500, blackMs: 20_000, at: 1_500, turn: "black" });
  });

  it("does not charge a clock that is not running", () => {
    expect(handClock({ ...view, status: "finished" }, 1_000, 5_000)).toMatchObject({ whiteMs: 10_000, blackMs: 20_000 });
    expect(handClock(view, 1_500, 1_200).whiteMs).toBe(10_000);
  });
});

describe("clockMs", () => {
  it("deducts elapsed milliseconds from timestamps even after a delayed repaint", () => {
    expect(clockMs(10_000, true, 1_000, 1_237)).toBe(9_763);
    expect(clockMs(10_000, true, 1_000, 10_999)).toBe(1);
    expect(clockMs(10_000, true, 1_000, 11_000)).toBe(0);
    expect(clockMs(10_000, true, 1_000, 21_000)).toBe(0);
  });

  it("keeps the waiting side and finished games frozen", () => {
    expect(clockMs(10_000, false, 1_000, 21_000)).toBe(10_000);
  });

  it("never gives extra time when a fresh sample is ahead of the last repaint", () => {
    expect(clockMs(10_000, true, 1_237, 1_200)).toBe(10_000);
  });
});
