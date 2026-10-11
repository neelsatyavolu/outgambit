import { expect, test, type Page } from "@playwright/test";
import { enter, move } from "./helpers";

// Sign-ups are limited to five an hour from one network, and the other files use them up, so these come from another.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.77" } });

async function startGame(page: Page, email: string) {
  await enter(page, "Create account", email);
  await page.goto("/");
  await page.getByRole("button", { name: "Start game" }).click();
  await page.waitForURL(/\/game\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Your move", { exact: true })).toBeVisible();
}

test("the board comes with the page, the arrow keys step through the game, and resigning asks first", async ({ page }) => {
  await startGame(page, `screen-${Date.now()}@example.com`);
  // The server sends the game with the page, so the board does not wait for a first request.
  expect(await (await page.request.get(page.url())).text()).toContain('data-testid="board"');
  // A slow model can think for a minute; the tab says when the wait is over.
  await expect(page).toHaveTitle("Your move · Gambit");

  await move(page, "e2", "e4");
  await expect(page.getByTestId("moves")).toContainText("e5");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Viewing move 1 of 2")).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("Viewing move 0 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next move" }).click();
  await expect(page.getByText("Viewing move 1 of 2")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText(/Viewing move/)).toBeHidden();

  const board = page.getByTestId("board");
  const before = await board.boundingBox();
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("button", { name: "No" }).click();
  await expect(page.getByRole("button", { name: "Resign" })).toBeVisible();
  await expect(page.getByTestId("result")).toBeHidden();

  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  const result = page.getByTestId("result");
  await expect(result).toContainText("You lost");
  await expect(result).toContainText("You resigned.");
  // The result is beside the board, not above it, so the board is where it was.
  expect(await board.boundingBox()).toEqual(before);
  await expect(page).toHaveTitle("Gambit");
});

test("on a phone each side's clock sits against its own edge of the board, all on one screen", async ({ page }) => {
  const height = 844;
  await page.setViewportSize({ width: 390, height });
  await startGame(page, `phone-${Date.now()}@example.com`);
  const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
  const [opponent, board, player] = [await box(".seat.top"), await box('[data-testid="board"]'), await box(".seat.bottom")];
  expect(opponent.y + opponent.height).toBeLessThanOrEqual(board.y);
  expect(player.y).toBeGreaterThanOrEqual(board.y + board.height);
  expect(player.y + player.height).toBeLessThanOrEqual(height);

  // Finished, so the game is not left at the head of the owner's list for the tests that read it.
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByTestId("result")).toContainText("You resigned.");
});
