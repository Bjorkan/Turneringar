import { expect, type Locator, type Page } from "@playwright/test";

export const adminPin = "test-pin";

export function iso(hours: number = 0): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString().slice(0, 16);
}

export async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Logga in" })).toBeVisible();
  await page.locator('input[name="pin"]').fill(adminPin);
  await page.getByRole("button", { name: "Logga in" }).click();
  await expect(page.getByRole("heading", { name: "Turneringar" })).toBeVisible();
  await expect(page.getByPlaceholder("Sök turneringar, matcher, deltagare...")).toHaveCount(0);
  await expect(page.getByLabel("Aktuell vy")).toContainText("Turneringar");
}

export async function createTournament(page: Page) {
  const tournamentName = `Playwright Cup ${Date.now()}`;
  const form = page.locator("#create-tournament");

  await form.locator('input[name="name"]').fill(tournamentName);
  await form.locator('input[name="starts_at"]').fill(iso(24));
  await form.locator('input[name="group_count"]').fill("2");
  await form.locator('input[name="qualifiers_per_group"]').fill("1");
  await form.getByRole("button", { name: "Skapa" }).click();

  await page.waitForURL(/\/tournaments\/\d+$/);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();

  const tournamentId = page.url().split("/").pop();
  if (!tournamentId) throw new Error("Tournament id saknas i URL.");

  return { tournamentId, tournamentName };
}

export async function addParticipant(page: Page, name: string, seed: number) {
  const form = page.locator("#deltagare form");

  await form.locator('input[name="name"]').fill(name);
  await form.locator('select[name="kind"]').selectOption("team");
  await form.locator('input[name="seed"]').fill(String(seed));
  await form.getByRole("button", { name: "Lägg till" }).click();
  await expect(page.locator("#deltagare table")).toContainText(name);
}

export async function addResource(page: Page, name: string) {
  const form = page.locator("#schema form");

  await form.locator('input[name="name"]').fill(name);
  await form.locator('select[name="kind"]').selectOption("court");
  await form.getByRole("button", { name: "Lägg till" }).click();
  await expect(page.locator("#schema")).toContainText(name);
}

export async function expectNoHorizontalOverflow(page: Page, selector = ".tournament-title") {
  const metrics = await page.evaluate((rootSelector) => {
    const title = document.querySelector<HTMLElement>(rootSelector);
    const heading = title?.querySelector<HTMLElement>("h1");
    const titleBox = title?.getBoundingClientRect();
    const headingBox = heading?.getBoundingClientRect();

    return {
      found: Boolean(title && heading),
      viewportWidth: window.innerWidth,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      titleRight: titleBox ? Math.ceil(titleBox.right) : 0,
      headingRight: headingBox ? Math.ceil(headingBox.right) : 0,
      headingScrollWidth: heading?.scrollWidth ?? 0,
      headingClientWidth: heading?.clientWidth ?? 0,
    };
  }, selector);

  expect(metrics.found).toBeTruthy();
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.titleRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.headingRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.headingScrollWidth).toBeLessThanOrEqual(metrics.headingClientWidth + 1);
}

export async function prepareScheduledTournament(page: Page) {
  await loginAsAdmin(page);
  const tournament = await createTournament(page);

  await page.locator(".tournament-tabs").getByRole("link", { name: "Deltagare" }).click();
  for (const [index, name] of ["Lag A", "Lag B", "Lag C", "Lag D"].entries()) {
    await addParticipant(page, name, index + 1);
  }
  await page.locator(".tournament-tabs").getByRole("link", { name: "Schema" }).click();
  await addResource(page, "Plan 1");

  await page.getByRole("button", { name: "Generera gruppspel och slutspel" }).click();
  await expect(page.getByRole("status")).toContainText("Bracket skapad.");
  await expect(page.locator("#alla-matcher")).toContainText("Lag A");

  await page.getByRole("button", { name: "Autoschemalägg matcher" }).click();
  await expect(page.getByRole("status")).toContainText("Schema uppdaterat.");
  await expect(page.locator("#alla-matcher")).toContainText("Plan 1");

  return tournament;
}

export async function firstMatchRow(page: Page): Promise<Locator> {
  const row = page.locator("#alla-matcher tbody tr").filter({ hasText: "Lag A" }).first();
  await expect(row).toBeVisible();
  return row;
}
