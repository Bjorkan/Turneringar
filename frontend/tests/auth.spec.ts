import { expect, test } from "@playwright/test";
import { adminPin, loginAsAdmin } from "./helpers";

test("admin ser varning om standard-PIN används", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByRole("alert")).toContainText("standard-PIN");
  await expect(page.getByRole("alert")).toContainText(adminPin);
  await expect(page.getByRole("alert")).toBeVisible();
});

test("två samtidiga adminsessioner kan ladda turneringar parallellt", async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  await loginAsAdmin(page1);
  await loginAsAdmin(page2);

  await expect(page1.getByRole("heading", { name: "Turneringar" })).toBeVisible();
  await expect(page2.getByRole("heading", { name: "Turneringar" })).toBeVisible();

  await ctx1.close();
  await ctx2.close();
});
