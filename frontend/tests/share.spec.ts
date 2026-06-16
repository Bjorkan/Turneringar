import { expect, test } from "@playwright/test";
import { prepareScheduledTournament } from "./helpers";

test("delningskortet visar kopiera-länk i stället för falsk QR-kod", async ({ page }) => {
  const { tournamentName } = await prepareScheduledTournament(page);

  await page.locator(".tournament-tabs").getByRole("link", { name: "Moderatorer" }).click();
  const moderatorForm = page.locator("#moderatorer form");
  await moderatorForm.locator('input[name="label"]').fill("Testdomare");
  await moderatorForm.locator('select[name="resource_id"]').selectOption({ label: "Plan 1" });
  await moderatorForm.getByRole("button", { name: "Skapa länk" }).click();
  await expect(page.getByRole("status")).toContainText("Moderatorlänk skapad.");

  await page.locator(".tournament-tabs").getByRole("link", { name: "Inställningar" }).click();
  await expect(page.locator(".share-card")).toBeVisible();

  await expect(page.locator(".qr-placeholder")).toHaveCount(0);
  await expect(page.locator(".share-card")).toContainText("Kopiera länk");
  await expect(page.locator(".share-copy")).toBeVisible();
});

