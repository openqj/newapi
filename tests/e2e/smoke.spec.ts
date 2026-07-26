import { expect, test } from "@playwright/test";

test("loads the application shell and opens desktop update settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText("RelayHub").first()).toBeVisible();
  await page.locator(".nav-item").last().click();
  await expect(page.getByText("Desktop updates")).toBeVisible();
});
