import { expect, test } from "@playwright/test";

const EITHER = /^(Scripted|Rehearsed) vs (Scripted|Rehearsed)/;

test("the owner starts an arena game, and anyone can read the result", async ({ page, browser }) => {
  await page.goto("/owner");
  await page.getByLabel("Owner password").fill("e2e-owner-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Both scripted models are in the arena unless the owner takes one out.
  const arena = page.locator("#arena");
  await expect(arena.getByLabel("Scripted plays in the arena")).toBeChecked();
  await expect(arena.getByLabel("Rehearsed plays in the arena")).toBeChecked();
  await arena.getByLabel("Games a day").fill("2");
  await arena.getByRole("button", { name: "Save" }).click();
  await expect(arena.getByText("0 of 2 started today")).toBeVisible();

  await arena.getByRole("button", { name: "Start a game now" }).click();
  await expect(arena.getByText("1 of 2 started today")).toBeVisible();

  // A visitor who is not signed in to anything sees the game and can open it.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/arena");
  const game = visitor.getByRole("link", { name: EITHER }).first();
  await expect(async () => {
    await visitor.reload();
    await expect(game).toContainText(/won|draw/, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  // The arena picks the pool, so the test reads which one the game was played in.
  const pool = (await game.textContent())!.includes("3+0") ? "Bullet" : "Regular";
  await game.click();
  await expect(visitor.getByTestId("result")).toContainText(/(Scripted|Rehearsed) won|Draw/);
  await expect(visitor.getByTestId("rating-change")).toContainText("Rehearsed");
  await expect(visitor.getByRole("button", { name: "Resign" })).toHaveCount(0);

  // Both models' ratings in that pool are now earned, not estimates.
  await visitor.goto("/ratings");
  const table = visitor.locator("section", { hasText: pool });
  for (const name of ["Scripted", "Rehearsed"]) {
    await expect(table.getByRole("row", { name: new RegExp(name) })).not.toContainText("~");
  }
});
