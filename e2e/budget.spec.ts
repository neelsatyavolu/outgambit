import { expect, test, type Page } from "@playwright/test";

/** Saves or removes Jev's key as the signed-in owner. The key is never used: no game is started against Jev. */
const connectJev = (owner: Page, connect: boolean) =>
  owner.evaluate(async (on) => {
    const init = on
      ? { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "e2e-not-a-real-key" }) }
      : { method: "DELETE" };
    return (await fetch("/api/owner/connections/jev", init)).status;
  }, connect);

test("each opponent shows its own budget, and the owner sees what it has used", async ({ page, browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await owner.goto("/owner");
  await owner.getByLabel("Owner password").fill("e2e-owner-password");
  await owner.getByRole("button", { name: "Sign in" }).click();
  await expect(owner.getByText("Usage", { exact: true }).first()).toBeVisible();
  expect(await connectJev(owner, true)).toBe(200);

  try {
    // Budgets are shown to everyone, signed in or not, so this test needs no account.
    await page.goto("/");
    const cells = page.locator(".cells");

    // A paid model has ten cents a day, which is 39 games until it has played some.
    await page.getByRole("radio", { name: /Jev/ }).click();
    await expect(cells).toContainText(/Your games left today\s*\d+ \/ \d+/);
    await expect(cells).toContainText(/Games left for everyone\s*39/);

    // The scripted opponent costs nothing.
    await page.getByRole("radio", { name: /Scripted/ }).click();
    await expect(cells).toContainText(/Your games left today\s*No limit/);

    await owner.reload();
    const usage = owner.locator("#usage");
    await expect(usage.locator(".row", { hasText: "Jev" })).toContainText("0.00¢ of 10¢ today");
    await expect(usage.locator(".row", { hasText: "Jev" })).toContainText("about 39 games left");
  } finally {
    expect(await connectJev(owner, false)).toBe(200);
  }
});
