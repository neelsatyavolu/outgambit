import { expect, test } from "@playwright/test";
import { enter, move, square } from "./helpers";

test("a move queued on the opponent's turn is played as soon as the turn comes round", async ({ page }) => {
  await enter(page, "Create account", `premover-${Date.now()}@example.com`);
  await page.goto("/");
  await page.getByRole("button", { name: "Start game" }).click();
  await page.waitForURL(/\/game\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Your move")).toBeVisible();

  // Hold the player's first move in flight, so the board stays on the opponent's turn.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/games/*/moves", async (route) => {
    await held;
    await route.continue();
  });

  await move(page, "f2", "f3");
  await move(page, "g2", "g4");
  const cancel = page.getByRole("button", { name: "Cancel premove" });
  await expect(cancel).toBeVisible();
  // The queued pawn is drawn where it is going.
  await expect(square(page, "g4").locator("[data-piece]")).toHaveCount(1);
  await expect(square(page, "g2").locator("[data-piece]")).toHaveCount(0);

  // A click on a square the queue has no use for calls it off.
  await square(page, "e5").click();
  await expect(cancel).toBeHidden();
  await expect(square(page, "g2").locator("[data-piece]")).toHaveCount(1);

  await move(page, "g2", "g4");
  await expect(cancel).toBeVisible();
  await expect(page.getByTestId("moves")).not.toContainText("f3");

  // Fool's mate: the opponent answers f3 with e5, the queued g4 goes out unprompted, and Qh4# ends it.
  release();
  await expect(page.getByTestId("result")).toContainText("You lost");
  await expect(page.getByTestId("moves")).toContainText("g4");
  await expect(page.getByTestId("moves")).toContainText("Qh4#");
  await expect(cancel).toBeHidden();
});
