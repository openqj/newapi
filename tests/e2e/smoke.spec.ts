import { expect, test } from "@playwright/test";

test("loads the application shell and opens desktop update settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText("RelayHub").first()).toBeVisible();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByText("桌面更新")).toBeVisible();
  await expect(page.getByText("Web 演示")).toBeVisible();
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

test("opens key dialogs and displays web-mode feedback", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "API 密钥", exact: true }).click();

  await page.getByRole("button", { name: "新建密钥" }).click();
  await expect(page.getByRole("dialog", { name: "创建 API 密钥" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "创建 API 密钥" })).toHaveCount(0);

  await page.getByTitle("删除密钥").first().click();
  await expect(page.getByRole("dialog")).toContainText("删除 API 密钥");
  await page.getByRole("button", { name: "取消" }).click();

  await page.getByTitle("导入 CC Switch").first().click();
  await expect(page.locator(".toast-error")).toContainText("只能在 RelayHub 桌面应用中执行");
});
