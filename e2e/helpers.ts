import type { Page } from "@playwright/test";

export const PASSWORD = "correct horse battery";

export const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

export async function move(page: Page, from: string, to: string) {
  await square(page, from).click();
  await square(page, to).click();
}

/** Fills in the account form. Creating an account also needs a level; this picks Intermediate (1300). */
export async function submit(page: Page, mode: "Sign in" | "Create account", email: string, password = PASSWORD) {
  await page.getByRole("radio", { name: mode }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  if (mode === "Create account") await page.getByRole("radio", { name: /^Intermediate starts/ }).click();
  await page.getByRole("button", { name: mode }).click();
}

/** Opens the account page and signs in or registers, ending on the signed-in account page. */
export async function enter(page: Page, mode: "Sign in" | "Create account", email: string) {
  await page.goto("/account");
  await submit(page, mode, email);
  await page.getByText(`Signed in as ${email}`).waitFor();
}
