import { expect, test } from "@playwright/test";
import { enter } from "./helpers";

test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.78" } });

test("millisecond clocks keep elapsed time when the device wall clock changes", async ({ page }) => {
  await enter(page, "Create account", `clock-${Date.now()}@example.com`);
  await page.goto("/");
  await page.getByRole("button", { name: "Start game" }).click();
  await page.waitForURL(/\/game\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Your move", { exact: true })).toBeVisible();
  const running = page.locator(".seat.bottom [role=timer]");
  const waiting = page.locator(".seat.top [role=timer]");
  await expect(running).toHaveText(/^\d+:\d{2}\.\d{3}$/);
  await expect(waiting).toHaveText(/^\d+:\d{2}\.000$/);
  const waitingValue = await waiting.innerText();

  // No new server reading can mask a jump in the local wall clock.
  const polls = /\/api\/games\/[0-9a-f-]{36}$/;
  await page.route(polls, (route) => route.abort());
  const read = async () => {
    const [minutes, seconds] = (await running.innerText()).split(":");
    return Number(minutes) * 60_000 + Number(seconds) * 1_000;
  };
  const before = await read();
  await page.evaluate(() => {
    const wallNow = Date.now;
    Date.now = () => wallNow() + 3_600_000;
  });
  await expect.poll(read).toBeLessThan(before - 200);
  expect(await read()).toBeGreaterThan(before - 2_000);
  await expect(waiting).toHaveText(waitingValue);

  await page.unroute(polls);
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByTestId("result")).toContainText("You resigned.");
  const frozen = await running.innerText();
  // Advance a few animation frames: a finished clock must not keep running.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
  expect(await running.innerText()).toBe(frozen);
});
