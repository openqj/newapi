import { expect, test } from "@playwright/test";

test("loads the application shell and opens desktop update settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText("RelayHub").first()).toBeVisible();
  await page.locator(".nav-item").last().click();
  await expect(page.getByText("Desktop updates")).toBeVisible();
});

test("keeps the shared data-table shell across core data pages", async ({ page }) => {
  await page.goto("/");
  const navigation = page.locator(".nav-item");
  await expect(navigation).toHaveCount(10);

  await navigation.nth(3).click();
  await expect(page.locator(".data-table").first()).toBeVisible();

  await navigation.nth(4).click();
  await expect(page.locator(".data-table").first()).toBeVisible();

  await navigation.nth(5).click();
  await expect(page.locator(".data-table").first()).toBeVisible();
});
