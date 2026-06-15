import { expect, type Locator, type Page, test } from "@playwright/test";

const adminPin = "test-pin";

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Logga in" })).toBeVisible();
  await page.locator('input[name="pin"]').fill(adminPin);
  await page.getByRole("button", { name: "Logga in" }).click();
  await expect(page.getByRole("heading", { name: "Turneringar" })).toBeVisible();
  await expect(page.getByPlaceholder("Sök turneringar, matcher, deltagare...")).toHaveCount(0);
  await expect(page.getByLabel("Aktuell vy")).toContainText("Turneringar");
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
  await expect(page.locator("#schema")).toContainText(name);
}

async function prepareScheduledTournament(page: Page) {
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

async function firstMatchRow(page: Page): Promise<Locator> {
  const row = page.locator("#alla-matcher tbody tr").filter({ hasText: "Lag A" }).first();
  await expect(row).toBeVisible();
  return row;
}

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
      starts_at: "2026-12-14T10:00",
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

test("mobil adminvy börjar med toppbar och dold sidomeny", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();

  await page.getByRole("button", { name: "Visa meny" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".side-nav")).toContainText("Turneringar");

  const topbarBox = await page.locator(".topbar").boundingBox();
  const sidebarBox = await page.locator(".sidebar").boundingBox();
  if (!topbarBox || !sidebarBox) throw new Error("Mobilnavigationens layout kunde inte mätas.");
  expect(sidebarBox.y).toBeGreaterThanOrEqual(topbarBox.y + topbarBox.height - 1);
});

test("Live TV rymmer långa lagnamn på 1920-skärm", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsAdmin(page);

  const tournamentName = `TV Overflow Cup ${Date.now()}`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: "2026-06-14T10:00",
      group_count: 2,
      qualifiers_per_group: 1,
    },
  });
  expect(response.ok()).toBeTruthy();
  const tournament = await response.json() as { id: number };

  const participantNames = [
    "SuperlångtTävlingslagNorrköpingVästraBananAlpha",
    "ExtremtLångtMotståndarlagGöteborgÖstraSektionenBeta",
    "TurneringsfavoriternaMedVäldigtLångtNamnGamma",
    "PublikfavoritlagetMedObrutetNamnDelta",
  ];
  for (const [index, name] of participantNames.entries()) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
      data: { name, kind: "team", seed: index + 1 },
    });
    expect(response.ok()).toBeTruthy();
  }

  response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
    data: { name: "CentercourtenMedLångtNamn", kind: "court" },
  });
  expect(response.ok()).toBeTruthy();
  const resource = await response.json() as { id: number };

  response = await page.request.post(`/api/tournaments/${tournament.id}/generate`, { data: {} });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/schedule`, { data: {} });
  expect(response.ok()).toBeTruthy();

  const tvCode = `TV${Date.now().toString().slice(-8)}`;
  response = await page.request.post("/api/tv-links", { data: { label: "Overflow TV", code: tvCode } });
  expect(response.ok()).toBeTruthy();
  const tvLink = (await response.json() as { tv_link: { id: number } }).tv_link;
  response = await page.request.patch(`/api/tv-links/${tvLink.id}`, {
    data: {
      label: "Overflow TV",
      tournament_id: tournament.id,
      resource_id: resource.id,
    },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tv/${tvCode}`);
  await expect(page.getByText(tournamentName)).toBeVisible();

  const overflow = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll<HTMLElement>(".tv-slide.active .tv-panel"));
    return panels.flatMap((panel) => {
      const box = panel.getBoundingClientRect();
      const outsideViewport = box.left < -1 || box.top < -1 || box.right > window.innerWidth + 1 || box.bottom > window.innerHeight + 1;
      const clippedContent = panel.scrollHeight > panel.clientHeight + 1 || panel.scrollWidth > panel.clientWidth + 1;
      return outsideViewport || clippedContent
        ? [`${panel.className}: ${panel.scrollWidth}x${panel.scrollHeight} in ${panel.clientWidth}x${panel.clientHeight}`]
        : [];
    });
  });
  expect(overflow).toEqual([]);
});

test("Live TV visar när listor fortsätter utanför sliden", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsAdmin(page);

  const tournamentName = `TV More Cup ${Date.now()}`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: "2026-12-14T10:00",
      group_count: 3,
      qualifiers_per_group: 1,
    },
  });
  expect(response.ok()).toBeTruthy();
  const tournament = await response.json() as { id: number };

  for (let index = 1; index <= 15; index += 1) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
      data: { name: `Lag ${index}`, kind: "team", seed: index },
    });
    expect(response.ok()).toBeTruthy();
  }

  for (let index = 1; index <= 5; index += 1) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
      data: { name: `Plan ${index}`, kind: "court" },
    });
    expect(response.ok()).toBeTruthy();
  }

  response = await page.request.post(`/api/tournaments/${tournament.id}/generate`, { data: {} });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/schedule`, { data: {} });
  expect(response.ok()).toBeTruthy();

  const tvCode = `TM${Date.now().toString().slice(-8)}`;
  response = await page.request.post("/api/tv-links", { data: { label: "More TV", code: tvCode } });
  expect(response.ok()).toBeTruthy();
  const tvLink = (await response.json() as { tv_link: { id: number } }).tv_link;
  response = await page.request.patch(`/api/tv-links/${tvLink.id}`, {
    data: {
      label: "More TV",
      tournament_id: tournament.id,
    },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tv/${tvCode}`);
  await expect(page.getByText(tournamentName)).toBeVisible();
  await expect(page.locator(".tv-stage")).toContainText(/matcher till/);
  await expect(page.locator(".tv-stage")).toContainText("1 grupp till");
  await expect(page.locator(".tv-stage")).toContainText("1 lag till i gruppen");
  await expect(page.locator(".tv-stage")).toContainText("1 plats till");
});

test("Live TV behåller aktiv slide vid SSE-refresh", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await loginAsAdmin(page);

  const tournamentName = `TV Refresh Cup ${Date.now()}`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: "2026-12-14T10:00",
      group_count: 2,
      qualifiers_per_group: 1,
    },
  });
  expect(response.ok()).toBeTruthy();
  const tournament = await response.json() as { id: number };

  for (const [index, name] of ["Lag A", "Lag B", "Lag C", "Lag D"].entries()) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
      data: { name, kind: "team", seed: index + 1 },
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

  const tvCode = `TR${Date.now().toString().slice(-8)}`;
  response = await page.request.post("/api/tv-links", { data: { label: "Refresh TV", code: tvCode } });
  expect(response.ok()).toBeTruthy();
  const tvLink = (await response.json() as { tv_link: { id: number } }).tv_link;
  response = await page.request.patch(`/api/tv-links/${tvLink.id}`, {
    data: {
      label: "Refresh TV",
      tournament_id: tournament.id,
    },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tv/${tvCode}`);
  await expect(page.getByText(tournamentName)).toBeVisible();
  await expect(page.locator(".tv-meta-block").filter({ hasText: "Sida 1 av 3" })).toBeVisible();
  await expect(page.locator(".tv-meta-block").filter({ hasText: "Sida 2 av 3" })).toBeVisible({ timeout: 12_000 });

  response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: "Lag Extra", kind: "team", seed: 99 },
  });
  expect(response.ok()).toBeTruthy();

  await page.waitForTimeout(1_500);
  await expect(page.locator(".tv-meta-block").filter({ hasText: "Sida 2 av 3" })).toBeVisible();
});

test("admin visar alla grupptabeller i slutspelsvyn", async ({ page }) => {
  await loginAsAdmin(page);

  const tournamentName = `Three Groups ${Date.now()}`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: "2026-12-14T10:00",
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
      starts_at: "2026-12-14T10:00",
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
