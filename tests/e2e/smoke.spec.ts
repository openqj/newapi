import { expect, test } from "@playwright/test";

test("loads the application shell and opens desktop update settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText("RelayHub").first()).toBeVisible();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "更新", exact: true })).toBeVisible();
  await expect(page.getByText("桌面更新", { exact: true })).toBeVisible();
  await expect(page.getByText("Web 演示")).toBeVisible();
});

test("keeps the shared data-table shell across core data pages", async ({ page }) => {
  await page.goto("/");
  for (const label of ["站点账户", "API 密钥", "使用记录"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator(".data-table").first()).toBeVisible();
  }
});

test("opens key dialogs and displays web-mode routing feedback", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "API 密钥", exact: true }).click();

  await page.getByRole("button", { name: "新建密钥" }).click();
  await expect(page.getByRole("dialog", { name: "创建 API 密钥" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "创建 API 密钥" })).toHaveCount(0);

  await page.getByTitle("删除密钥").first().click();
  await expect(page.getByRole("dialog")).toContainText("删除 API 密钥");
  await page.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "本地路由", exact: true }).click();
  await expect(page.getByText("本地路由仅在 RelayHub 桌面应用中运行。")).toBeVisible();
  await expect(page.getByRole("button", { name: "直转", exact: true })).toBeDisabled();
});
