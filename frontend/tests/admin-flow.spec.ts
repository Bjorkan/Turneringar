import { expect, test } from "@playwright/test";
import { loginAsAdmin, iso, prepareScheduledTournament, firstMatchRow, createTournament } from "./helpers";

test("admin kan klicka igenom huvudflödet, liveuppdatera och avsluta match", async ({ page }) => {
  await prepareScheduledTournament(page);
  await page.locator(".tournament-tabs").getByRole("link", { name: "Matcher" }).click();

  const row = await firstMatchRow(page);
  await row.getByRole("button", { name: "Poäng" }).click();
  await page.getByRole("dialog").getByLabel("Poäng A").fill("2");
  await page.getByRole("dialog").getByLabel("Poäng B").fill("1");
  await page.getByRole("dialog").getByRole("button", { name: "Spara livepoäng" }).click();

  await expect(page.getByRole("status")).toContainText("Livepoäng sparad.");
  await expect(row).toContainText("Pågår");
  await expect(page.locator(".status-badge.live")).toHaveCount(1);
  await expect(row).toContainText("2 - 1");
  await page.getByRole("button", { name: /Pågår/ }).click();
  await expect(page.locator("#alla-matcher tbody")).toContainText("2 - 1");
  await page.getByRole("button", { name: /Alla/ }).click();

  await row.getByRole("button", { name: "Poäng" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Avsluta match" }).click();

  await expect(page.getByRole("status")).toContainText("Match avslutad.");
  await expect(row).toContainText("Avslutad");
  await expect(row).toContainText("2 - 1");
  await expect(row).toContainText("Låst");
  await expect(row.getByRole("button", { name: "Poäng" })).toHaveCount(0);
  await page.getByRole("button", { name: /Avslutade/ }).click();
  await expect(page.locator("#alla-matcher tbody")).toContainText("Låst");
});

test("moderatorvy och Live TV laddar från samma frontendbygge", async ({ page }) => {
  const { tournamentName } = await prepareScheduledTournament(page);

  await page.locator(".tournament-tabs").getByRole("link", { name: "Moderatorer" }).click();
  const moderatorForm = page.locator("#moderatorer form");
  await moderatorForm.locator('input[name="label"]').fill("Domare Plan 1");
  await moderatorForm.locator('select[name="resource_id"]').selectOption({ label: "Plan 1" });
  await moderatorForm.getByRole("button", { name: "Skapa länk" }).click();
  await expect(page.getByRole("status")).toContainText("Moderatorlänk skapad.");

  const moderatorCard = page.locator(".moderator-links-panel tbody tr").filter({ hasText: "Domare Plan 1" }).first();
  await expect(moderatorCard).toBeVisible();

  const pin = (await moderatorCard.locator("code").innerText()).trim();
  if (!pin) throw new Error("Moderator-PIN saknas i UI:t.");

  const href = await moderatorCard.getByRole("link", { name: "Öppna" }).getAttribute("href");
  if (!href) throw new Error("Moderatorlänk saknas i UI:t.");

  await page.goto(href);
  await expect(page.getByRole("heading", { name: "Moderator-PIN" })).toBeVisible();
  await page.locator('input[name="pin"]').fill(pin);
  await page.getByRole("button", { name: "Öppna" }).click();
  await expect(page.locator(".moderator-match-card").first()).toBeVisible();

  const resultForm = page.locator(".moderator-score-card").first();
  await resultForm.locator('input[name="score_a"]').fill("3");
  await resultForm.locator('input[name="score_b"]').fill("0");
  await resultForm.getByRole("button", { name: "Spara livepoäng" }).click();
  await expect(page.getByRole("status")).toContainText("Livepoäng sparad.");
  await page.getByRole("button", { name: /Pågår/ }).click();
  await expect(page.locator(".moderator-match-card")).toHaveCount(1);
  await expect(page.locator(".moderator-match-card").first()).toContainText("Pågår");

  const tvCode = `TV${Date.now().toString().slice(-8)}`;
  await page.goto("/admin/tv");
  await expect(page.getByRole("heading", { name: "Live TV", exact: true })).toBeVisible();

  const tvForm = page.locator("#new-tv-link form");
  await tvForm.locator('input[name="label"]').fill("Publik skärm");
  await tvForm.locator('input[name="code"]').fill(tvCode);
  await tvForm.getByRole("button", { name: "Skapa länk" }).click();
  await expect(page.getByRole("status")).toContainText("Live TV-länk skapad.");

  const tvCard = page.locator(".tv-link-card").filter({ hasText: tvCode }).first();
  await expect(tvCard).toBeVisible();
  await tvCard.getByLabel("Turnering").selectOption({ label: tournamentName });
  await tvCard.getByLabel("Resurs").selectOption({ label: "Plan 1 · Spelplan" });
  await tvCard.getByRole("button", { name: "Uppdatera live" }).click();
  await expect(page.getByRole("status")).toContainText("Live TV-bindning uppdaterad.");

  await page.goto(`/tv/${tvCode}`);
  await expect(page.getByText(tournamentName)).toBeVisible();
  await expect(page.locator(".tv-stage")).toContainText("Lag");
  await expect(page.locator(".tv-stage")).toContainText("3 - 0");
  await expect(page.locator(".tv-stage")).toContainText("Spelplan");
  await expect(page.locator(".tv-stage")).not.toContainText("court");
  await expect(page.locator(".tv-stage")).not.toContainText("Senaste aktivitet");
});

test("admin visar alla grupptabeller i slutspelsvyn", async ({ page }) => {
  await loginAsAdmin(page);

  const tournamentName = `Three Groups ${Date.now()}`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: iso(72),
      group_count: 3,
      qualifiers_per_group: 1,
    },
  });
  expect(response.ok()).toBeTruthy();
  const tournament = await response.json() as { id: number };

  for (let index = 1; index <= 6; index += 1) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
      data: { name: `Lag ${index}`, kind: "team", seed: index },
    });
    expect(response.ok()).toBeTruthy();
  }

  response = await page.request.post(`/api/tournaments/${tournament.id}/generate`, { data: {} });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tournaments/${tournament.id}#slutspel`);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
  await expect(page.locator("#tabeller")).toContainText("Grupp A");
  await expect(page.locator("#tabeller")).toContainText("Grupp B");
  await expect(page.locator("#tabeller")).toContainText("Grupp C");
});

test("schemavyn visar när resurs- och sidolistor fortsätter", async ({ page }) => {
  await loginAsAdmin(page);

  const tournamentName = `Schedule More ${Date.now()}`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: iso(72),
      group_count: 4,
      qualifiers_per_group: 2,
    },
  });
  expect(response.ok()).toBeTruthy();
  const tournament = await response.json() as { id: number };

  for (let index = 1; index <= 16; index += 1) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
      data: { name: `Lag ${index}`, kind: "team", seed: index },
    });
    expect(response.ok()).toBeTruthy();
  }

  response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
    data: { name: "Plan 1", kind: "court" },
  });
  expect(response.ok()).toBeTruthy();

  response = await page.request.post(`/api/tournaments/${tournament.id}/generate`, { data: {} });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/schedule`, { data: {} });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tournaments/${tournament.id}#schema`);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();

  const resourceColumn = page.locator("#schema .resource-column").filter({ hasText: "Plan 1" });
  await expect(resourceColumn).toContainText(/matcher till på Plan 1/);

  const unplacedPanel = page.locator("#schema .side-stack > .panel").filter({ hasText: "Ej placerade" });
  await expect(unplacedPanel).toContainText(/match till saknar plats/);
});

test("tom-state-texter i admin är informativa med handlingsanvisning", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await loginAsAdmin(page);
  await createTournament(page);

  await page.locator(".tournament-tabs").getByRole("link", { name: "Moderatorer" }).click();
  await expect(page.locator("#moderatorer")).toContainText("Skapa en länk så kan moderatorer rapportera poäng");

  await page.goto("/admin/tv");
  await expect(page.getByText("Skapa en länk ovan för att komma igång")).toBeVisible();

  await page.locator(".tournament-tabs").getByRole("link", { name: "Inställningar" }).click();
  await expect(page.locator(".share-card")).toContainText("Skapa en länk för att visa delning");
});
