import { expect, type Locator, type Page, test } from "@playwright/test";

const adminPin = "test-pin";

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Logga in" })).toBeVisible();
  await page.locator('input[name="pin"]').fill(adminPin);
  await page.getByRole("button", { name: "Logga in" }).click();
  await expect(page.getByRole("heading", { name: "Turneringar" })).toBeVisible();
}

async function createTournament(page: Page) {
  const tournamentName = `Playwright Cup ${Date.now()}`;
  const form = page.locator("#create-tournament");

  await form.locator('input[name="name"]').fill(tournamentName);
  await form.locator('input[name="starts_at"]').fill("2026-06-14T10:00");
  await form.locator('input[name="group_count"]').fill("2");
  await form.locator('input[name="qualifiers_per_group"]').fill("1");
  await form.getByRole("button", { name: "Skapa" }).click();

  await page.waitForURL(/\/tournaments\/\d+$/);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();

  const tournamentId = page.url().split("/").pop();
  if (!tournamentId) throw new Error("Tournament id saknas i URL.");

  return { tournamentId, tournamentName };
}

async function addParticipant(page: Page, name: string, seed: number) {
  const form = page.locator("#deltagare form");

  await form.locator('input[name="name"]').fill(name);
  await form.locator('select[name="kind"]').selectOption("team");
  await form.locator('input[name="seed"]').fill(String(seed));
  await form.getByRole("button", { name: "Lägg till" }).click();
  await expect(page.locator("#deltagare table")).toContainText(name);
}

async function addResource(page: Page, name: string) {
  const form = page.locator("#schema form");

  await form.locator('input[name="name"]').fill(name);
  await form.locator('select[name="kind"]').selectOption("court");
  await form.getByRole("button", { name: "Lägg till" }).click();
  await expect(page.locator("#schema table")).toContainText(name);
}

async function prepareScheduledTournament(page: Page) {
  await loginAsAdmin(page);
  const tournament = await createTournament(page);

  for (const [index, name] of ["Lag A", "Lag B", "Lag C", "Lag D"].entries()) {
    await addParticipant(page, name, index + 1);
  }
  await addResource(page, "Plan 1");

  await page.getByRole("button", { name: "Generera gruppspel och slutspel" }).click();
  await expect(page.getByRole("status")).toContainText("Bracket skapad.");
  await expect(page.locator("#alla-matcher")).toContainText("Lag A");

  await page.getByRole("button", { name: "Autoschemalägg matcher" }).click();
  await expect(page.getByRole("status")).toContainText("Schema uppdaterat.");
  await expect(page.locator("#alla-matcher")).toContainText("Plan 1");

  return tournament;
}

async function firstMatchRow(page: Page): Promise<Locator> {
  const row = page.locator("#alla-matcher tbody tr").filter({ hasText: "Lag A" }).first();
  await expect(row).toBeVisible();
  return row;
}

test("admin kan klicka igenom huvudflödet och spara resultat", async ({ page }) => {
  await prepareScheduledTournament(page);

  const row = await firstMatchRow(page);
  await row.locator("summary").click();
  await row.getByLabel("Poäng A").fill("2");
  await row.getByLabel("Poäng B").fill("1");
  await row.getByRole("button", { name: "Spara resultat" }).click();

  await expect(page.getByRole("status")).toContainText("Resultat sparat.");
  await expect(row).toContainText("2 - 1");
});

test("moderatorvy och Live TV laddar från samma frontendbygge", async ({ page }) => {
  const { tournamentId, tournamentName } = await prepareScheduledTournament(page);

  const moderatorForm = page.locator("#moderatorer form");
  await moderatorForm.locator('input[name="label"]').fill("Domare Plan 1");
  await moderatorForm.locator('select[name="resource_id"]').selectOption({ label: "Plan 1" });
  await moderatorForm.getByRole("button", { name: "Skapa länk" }).click();
  await expect(page.getByRole("status")).toContainText("Moderatorlänk skapad.");

  const moderatorCard = page.locator("#moderatorer .mini-list article").filter({ hasText: "Domare Plan 1" }).first();
  await expect(moderatorCard).toBeVisible();

  const pinText = await moderatorCard.locator("small").innerText();
  const pin = /PIN\s+(\d+)/.exec(pinText)?.[1];
  if (!pin) throw new Error("Moderator-PIN saknas i UI:t.");

  const href = await moderatorCard.getByRole("link", { name: "Öppna" }).getAttribute("href");
  if (!href) throw new Error("Moderatorlänk saknas i UI:t.");

  await page.goto(href);
  await expect(page.getByRole("heading", { name: "Moderator-PIN" })).toBeVisible();
  await page.locator('input[name="pin"]').fill(pin);
  await page.getByRole("button", { name: "Öppna" }).click();
  await expect(page.getByRole("heading", { name: "Rapportera resultat" })).toBeVisible();

  const resultForm = page.locator(".moderator-result-form").first();
  await resultForm.locator('input[name="score_a"]').fill("3");
  await resultForm.locator('input[name="score_b"]').fill("0");
  await resultForm.getByRole("button", { name: "Spara" }).click();
  await expect(page.getByRole("status")).toContainText("Resultat sparat.");

  await page.goto(`/tv/${tournamentId}`);
  await expect(page.getByText(tournamentName)).toBeVisible();
  await expect(page.locator(".tv-stage")).toContainText("Lag");
  await expect(page.locator(".tv-stage")).toContainText("Plan 1");
});
