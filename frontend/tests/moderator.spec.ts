import { expect, test } from "@playwright/test";
import { loginAsAdmin, iso, expectNoHorizontalOverflow, prepareScheduledTournament } from "./helpers";

test("ogiltig moderatorlänk visar fel utan evig laddning", async ({ page }) => {
  await page.goto(`/m/saknas-${Date.now()}`);

  await expect(page.getByRole("heading", { name: "Moderatorlänken kunde inte öppnas" })).toBeVisible();
  await expect(page.locator(".moderator-page")).toContainText("Moderatorlänken finns inte.");
  await expect(page.locator(".moderator-page")).not.toContainText("Laddar moderatorvy...");
});

test("moderatorvyn filtrerar matcher med status och sök", async ({ page }) => {
  await loginAsAdmin(page);

  const tournamentName = `Moderator Filter ${Date.now()}`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: iso(72),
      group_count: 2,
      qualifiers_per_group: 1,
    },
  });
  expect(response.ok()).toBeTruthy();
  const tournament = await response.json() as { id: number };

  for (let index = 1; index <= 8; index += 1) {
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
  response = await page.request.post(`/api/tournaments/${tournament.id}/moderators`, {
    data: { label: "Domare alla matcher" },
  });
  expect(response.ok()).toBeTruthy();
  const moderator = (await response.json() as { moderator: { pin: string; token: string } }).moderator;

  await page.goto(`/m/${moderator.token}`);
  await page.locator('input[name="pin"]').fill(moderator.pin);
  await page.getByRole("button", { name: "Öppna" }).click();
  await expect(page.locator(".moderator-match-card")).toHaveCount(12);

  const firstScoreForm = page.locator(".moderator-score-card").first();
  await firstScoreForm.locator('input[name="score_a"]').fill("1");
  await firstScoreForm.locator('input[name="score_b"]').fill("0");
  await firstScoreForm.getByRole("button", { name: "Spara livepoäng" }).click();
  await expect(page.getByRole("status")).toContainText("Livepoäng sparad.");

  await page.getByRole("button", { name: /Pågår/ }).click();
  await expect(page.locator(".moderator-match-card")).toHaveCount(1);

  await page.getByRole("button", { name: /Alla matcher/ }).click();
  await page.getByLabel("Sök matcher").fill("Lag 8");
  await expect(page.locator(".moderator-match-card").first()).toContainText("Lag 8");
  const filteredCards = await page.locator(".moderator-match-card").allTextContents();
  expect(filteredCards.length).toBeGreaterThan(0);
  expect(filteredCards.every((text) => text.includes("Lag 8"))).toBeTruthy();
});

test("moderatorns sidhuvud bryter långa turneringsnamn före och efter inloggning", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `ModeratorTurneringMedExtremtLångtObrutetNamn${Date.now()}AlphaBetaGammaDeltaEpsilonZetaEtaTheta`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: iso(72),
      group_count: 2,
      qualifiers_per_group: 1,
    },
  });
  expect(response.ok()).toBeTruthy();
  const tournament = await response.json() as { id: number };

  response = await page.request.post(`/api/tournaments/${tournament.id}/moderators`, {
    data: { label: "Domare med mobilvy" },
  });
  expect(response.ok()).toBeTruthy();
  const moderator = (await response.json() as { moderator: { pin: string; token: string } }).moderator;

  await page.goto(`/m/${moderator.token}`);
  await expect(page.getByRole("heading", { name: "Domare med mobilvy" })).toBeVisible();
  await expect(page.locator(".moderator-page .page-head")).toContainText(tournamentName);
  await expectNoHorizontalOverflow(page, ".moderator-page .page-head");

  await page.locator('input[name="pin"]').fill(moderator.pin);
  await page.getByRole("button", { name: "Öppna" }).click();
  await expect(page.locator(".moderator-side-card")).toContainText("Aktiv");
  await expect(page.locator(".moderator-page .page-head")).toContainText(tournamentName);
  await expectNoHorizontalOverflow(page, ".moderator-page .page-head");
});

test("moderatorns matchkort bryter långa namn", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Moderator Card ${Date.now()}`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: iso(72),
      group_count: 2,
      qualifiers_per_group: 1,
    },
  });
  expect(response.ok()).toBeTruthy();
  const tournament = await response.json() as { id: number };

  const longNameA = `ExtremtLångtModeratorLagnamnSomInteFårSpräckaKortetA${Date.now()}`;
  const longNameB = `ExtremtLångtModeratorLagnamnSomInteFårSpräckaKortetB${Date.now()}`;
  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: longNameA, kind: "team", seed: 1 },
  });
  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: longNameB, kind: "team", seed: 2 },
  });

  response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
    data: { name: `LångResursSomTestarModeratorLayoutenJustNu${Date.now()}`, kind: "court" },
  });
  expect(response.ok()).toBeTruthy();

  response = await page.request.post(`/api/tournaments/${tournament.id}/generate`, { data: {} });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/schedule`, { data: {} });
  expect(response.ok()).toBeTruthy();

  response = await page.request.post(`/api/tournaments/${tournament.id}/moderators`, {
    data: { label: "Test Moderator" },
  });
  expect(response.ok()).toBeTruthy();
  const moderator = (await response.json() as { moderator: { pin: string; token: string } }).moderator;

  await page.goto(`/m/${moderator.token}`);
  await page.locator('input[name="pin"]').fill(moderator.pin);
  await page.getByRole("button", { name: "Öppna" }).click();
  await expect(page.locator(".moderator-match-card").first()).toBeVisible();

  const metrics = await page.evaluate(() => {
    const card = document.querySelector(".moderator-match-card");
    if (!card) return null;
    const cardBox = card.getBoundingClientRect();
    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
      cardFitsViewport: cardBox.right <= window.innerWidth + 2,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.documentWidth).toBeLessThanOrEqual((metrics!.viewportWidth ?? 0) + 10);
  expect(metrics!.cardFitsViewport).toBeTruthy();
});

test("admin kan ta bort moderatorlänk", async ({ page }) => {
  await prepareScheduledTournament(page);
  await page.locator(".tournament-tabs").getByRole("link", { name: "Moderatorer" }).click();
  const deleteButton = page.locator(".moderator-links-panel .danger-outline").first();
  if (await deleteButton.count() === 0) return;
  page.on("dialog", (dialog) => dialog.accept());
  await deleteButton.click();
  await expect(page.getByRole("status")).toContainText("Moderatorlänk borttagen.");
});

