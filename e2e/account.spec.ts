import { expect, test, type Page } from "@playwright/test";

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

async function move(page: Page, from: string, to: string) {
  await square(page, from).click();
  await square(page, to).click();
}

const PASSWORD = "correct horse battery";

async function submit(page: Page, mode: "Sign in" | "Create account", email: string, password: string) {
  await page.getByRole("radio", { name: mode }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: mode }).click();
}

test("a guest's game follows them into a new account, and to another browser", async ({ page, browser }) => {
  const email = `ada-${Date.now()}@example.com`;

  // Lose a game as a guest: the scripted opponent answers 1. f3 with e5 and 2. g4 with Qh4#.
  await page.goto("/");
  await page.getByRole("button", { name: "Start game" }).click();
  await page.waitForURL(/\/game\/[0-9a-f-]{36}$/);
  await move(page, "f2", "f3");
  await expect(page.getByTestId("moves")).toContainText("e5");
  await move(page, "g2", "g4");
  await expect(page.getByTestId("result")).toContainText("You lost");

  await page.getByRole("link", { name: "Account" }).click();
  await page.waitForURL(/\/account$/);
  await submit(page, "Create account", email, PASSWORD);

  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByTestId("stat-played")).toHaveText("1");
  await expect(page.getByTestId("stat-lost")).toHaveText("1");
  await expect(page.getByTestId("stat-rate")).toHaveText("0%");
  await expect(page.getByRole("link", { name: /Scripted/ })).toContainText("lost · checkmate");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // A different browser has none of this until it signs in.
  const elsewhere = await (await browser.newContext()).newPage();
  await elsewhere.goto("/account");
  await submit(elsewhere, "Sign in", email, "not the password");
  await expect(elsewhere.getByText("Wrong email or password.")).toBeVisible();
  await submit(elsewhere, "Sign in", email, PASSWORD);
  await expect(elsewhere.getByTestId("stat-played")).toHaveText("1");

  // The finished game opens from the history and can be stepped through.
  await elsewhere.getByRole("link", { name: /Scripted/ }).click();
  await expect(elsewhere.getByTestId("result")).toContainText("You lost");
  await expect(elsewhere.getByTestId("moves")).toContainText("Qh4#");
});

test("an email cannot be registered twice", async ({ page, browser }) => {
  const email = `grace-${Date.now()}@example.com`;
  await page.goto("/account");
  await submit(page, "Create account", email, PASSWORD);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("No games yet.")).toBeVisible();

  const second = await (await browser.newContext()).newPage();
  await second.goto("/account");
  await submit(second, "Create account", email, PASSWORD);
  await expect(second.getByText("That email already has an account. Sign in instead.")).toBeVisible();
});
