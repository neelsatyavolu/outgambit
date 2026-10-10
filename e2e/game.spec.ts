import { expect, test, type Page } from "@playwright/test";

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

async function move(page: Page, from: string, to: string) {
  await square(page, from).click();
  await square(page, to).click();
}

test("a visitor plays a game to the end and the owner watches it", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.getByText("Your games left today")).toBeVisible();
  const icon = await page.locator('link[rel="icon"]').first().getAttribute("href");
  expect((await page.request.get(icon!)).headers()["content-type"]).toContain("image/svg+xml");
  await expect(page.getByRole("radio", { name: /Scripted/ })).toBeVisible();

  await page.getByRole("button", { name: "Start game" }).click();
  await page.waitForURL(/\/game\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Your move")).toBeVisible();

  // Fool's mate: the scripted opponent answers 1. f3 with e5 and 2. g4 with Qh4#.
  await move(page, "f2", "f3");
  await expect(page.getByTestId("moves")).toContainText("e5");
  await move(page, "g2", "g4");

  const result = page.getByTestId("result");
  await expect(result).toContainText("You lost");
  await expect(result).toContainText("Checkmate.");
  await expect(page.getByTestId("moves")).toContainText("Qh4#");

  // The finished game used one of the visitor's two daily games.
  await page.getByRole("link", { name: "New game" }).click();
  await expect(page.getByText("1 / 2")).toBeVisible();

  // The owner signs in from a separate browser and opens the same game.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto("/owner");
  await owner.getByLabel("Owner password").fill("e2e-owner-password");
  await owner.getByRole("button", { name: "Sign in" }).click();
  await owner.getByRole("link", { name: /Scripted/ }).first().click();
  await expect(owner.getByTestId("result")).toContainText("Scripted won");
  await expect(owner.getByTestId("moves")).toContainText("Qh4#");
  await ownerContext.close();
});

test("the owner can reach the login from the site and a wrong password is refused", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Owner" }).click();
  await page.waitForURL(/\/owner$/);
  await page.getByLabel("Owner password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong password.")).toBeVisible();
});

test("a visitor cannot open someone else's game", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start game" }).click();
  await page.waitForURL(/\/game\//);
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(page.url());
  await expect(stranger.getByText("Game not found")).toBeVisible();
});
