import { describe, expect, it } from "vitest";
import { NOON } from "@/test/factory";
import { dayKey, nextResetAt } from "./limits";

const utc = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h, min);

describe("dayKey", () => {
  it("uses the Pacific date", () => {
    expect(dayKey(NOON)).toBe("2026-10-09");
  });

  it("keeps 23:59 Pacific in the day that is ending", () => {
    expect(dayKey(utc(2026, 10, 10, 6, 59))).toBe("2026-10-09");
  });

  it("starts the new day at midnight Pacific", () => {
    expect(dayKey(utc(2026, 10, 10, 7, 0))).toBe("2026-10-10");
  });
});

describe("nextResetAt", () => {
  it("is the next Pacific midnight", () => {
    expect(nextResetAt(NOON)).toBe(utc(2026, 10, 10, 7));
  });

  it("is a full day away just after midnight", () => {
    expect(nextResetAt(utc(2026, 10, 10, 7, 0))).toBe(utc(2026, 10, 11, 7));
  });

  it("handles the 25-hour day when clocks go back", () => {
    // 2026-11-01 00:30 PDT; the day ends at 00:00 PST on the 2nd, 24.5 hours later.
    expect(nextResetAt(utc(2026, 11, 1, 7, 30))).toBe(utc(2026, 11, 2, 8));
  });

  it("handles the 23-hour day when clocks go forward", () => {
    // 2026-03-08 00:30 PST; the day ends at 00:00 PDT on the 9th, 22.5 hours later.
    expect(nextResetAt(utc(2026, 3, 8, 8, 30))).toBe(utc(2026, 3, 9, 7));
  });
});
