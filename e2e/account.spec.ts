import { expect, test } from "@playwright/test";
import { PASSWORD, enter, move, submit } from "./helpers";

test("a visitor must create an account and say their level, then plays a rated game that follows them", async ({ page, browser }) => {
  const email = `ada-${Date.now()}@example.com`;

  // Without an account the setup screen sends them to make one.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Create an account to play" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in to play" })).toBeDisabled();
  await page.getByRole("link", { name: "Create an account or sign in" }).click();
  await page.waitForURL(/\/account$/);

  // An account cannot be created without saying how strong the player is.
  await page.getByRole("radio", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  await page.getByRole("radio", { name: /^Intermediate starts/ }).click();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByTestId("rating-regular")).toHaveText("1300");
  await expect(page.getByTestId("rating-bullet")).toHaveText("1200");

  // Lose a slow game: the scripted opponent answers 1. f3 with e5 and 2. g4 with Qh4#.
  await page.goto("/");
  await page.getByRole("button", { name: "Start game" }).click();
  await page.waitForURL(/\/game\/[0-9a-f-]{36}$/);
  await move(page, "f2", "f3");
  await expect(page.getByTestId("moves")).toContainText("e5");
  await move(page, "g2", "g4");
  await expect(page.getByTestId("result")).toContainText("You lost");
  await expect(page.getByTestId("rating-change")).toContainText("Your regular rating: 1300 →");

  // The loss cost rating in the regular pool only, and the game is in the record.
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page.getByTestId("stat-played")).toHaveText("1");
  await expect(page.getByTestId("stat-lost")).toHaveText("1");
  await expect(page.getByTestId("rating-regular")).not.toHaveText("1300");
  await expect(page.getByTestId("rating-bullet")).toHaveText("1200");
  await expect(page.getByRole("link", { name: /Scripted/ })).toContainText("lost · checkmate");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // A different browser has none of this until it signs in.
  const elsewhere = await (await browser.newContext()).newPage();
  await elsewhere.goto("/account");
  await submit(elsewhere, "Sign in", email, "not the password");
  await expect(elsewhere.getByText("Wrong email or password.")).toBeVisible();
  await submit(elsewhere, "Sign in", email);
  await expect(elsewhere.getByTestId("stat-played")).toHaveText("1");

  // The finished game opens from the history and can be stepped through.
  await elsewhere.getByRole("link", { name: /Scripted/ }).click();
  await expect(elsewhere.getByTestId("result")).toContainText("You lost");
  await expect(elsewhere.getByTestId("moves")).toContainText("Qh4#");
});

test("the models' ratings are public, and move after a game", async ({ page }) => {
  await page.goto("/ratings");
  await expect(page.getByRole("heading", { name: "Ratings" })).toBeVisible();
  // The scripted opponent has now won a rated regular game, so that rating is earned, not an estimate.
  const regular = page.locator("section", { hasText: "Regular" }).getByRole("row", { name: /Scripted/ });
  await expect(regular).toContainText("1");
  await expect(regular).not.toContainText("~");
});

test("an email cannot be registered twice", async ({ page, browser }) => {
  const email = `grace-${Date.now()}@example.com`;
  await enter(page, "Create account", email);

  const second = await (await browser.newContext()).newPage();
  await second.goto("/account");
  await submit(second, "Create account", email);
  await expect(second.getByText("That email already has an account. Sign in instead.")).toBeVisible();
});
