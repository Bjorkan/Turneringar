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

async function expectNoHorizontalOverflow(page: Page, selector = ".tournament-title") {
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

test("lång turneringsrubrik spräcker inte adminlayouten", async ({ browser }) => {
  const longName = `ExtremtLångTurneringsrubrikUtanMellanslag${Date.now()}AlphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambda`;

  for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    await loginAsAdmin(page);
    const response = await page.request.post("/api/tournaments", {
      data: {
        name: longName,
        starts_at: "2026-12-14T10:00",
        group_count: 2,
        qualifiers_per_group: 1,
      },
    });
    expect(response.ok()).toBeTruthy();
    const tournament = await response.json() as { id: number };

    await page.goto(`/tournaments/${tournament.id}#deltagare`);
    await expect(page.getByRole("heading", { name: longName })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await context.close();
  }
});

test("moderatorns sidhuvud bryter långa turneringsnamn före och efter inloggning", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `ModeratorTurneringMedExtremtLångtObrutetNamn${Date.now()}AlphaBetaGammaDeltaEpsilonZetaEtaTheta`;
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

test("deltagarlistan visar ellipsis och titel för långa namn", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Participant Table ${Date.now()}`;
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

  const participantName = `SuperlångtObrutetDeltagarnamnSomAnnarsKlipperTabellen${Date.now()}AlphaBetaGammaDelta`;
  response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: participantName, kind: "team", seed: 1 },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tournaments/${tournament.id}#deltagare`);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
  const nameCellText = page.locator(".participant-table .table-name strong").first();
  await expect(nameCellText).toHaveAttribute("title", participantName);

  const metrics = await page.locator(".participant-list-panel").evaluate((panel) => {
    const name = panel.querySelector<HTMLElement>(".participant-table .table-name strong");
    if (!name) return null;
    const panelBox = panel.getBoundingClientRect();
    const nameBox = name.getBoundingClientRect();
    const style = getComputedStyle(name);

    return {
      clipped: name.scrollWidth > name.clientWidth + 1,
      insidePanel: nameBox.right <= panelBox.right + 1,
      overflowX: style.overflowX,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics?.clipped).toBeTruthy();
  expect(metrics?.insidePanel).toBeTruthy();
  expect(metrics?.overflowX).toBe("hidden");
  expect(metrics?.textOverflow).toBe("ellipsis");
  expect(metrics?.whiteSpace).toBe("nowrap");
});

test("deltagardetaljkortet bryter långa namn inom kortet", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Participant Detail ${Date.now()}`;
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

  const participantName = `DetaljkortetsObrutnaDeltagarnamnSomMåsteBrytasInneIKortet${Date.now()}AlphaBetaGammaDelta`;
  response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: participantName, kind: "team", seed: 1 },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tournaments/${tournament.id}#deltagare`);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
  const heading = page.locator(".detail-hero h2").first();
  await expect(heading).toHaveAttribute("title", participantName);

  const metrics = await page.locator(".detail-panel").evaluate((panel) => {
    const headingElement = panel.querySelector<HTMLElement>(".detail-hero h2");
    if (!headingElement) return null;
    const panelBox = panel.getBoundingClientRect();
    const headingBox = headingElement.getBoundingClientRect();
    const style = getComputedStyle(headingElement);

    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      headingInsidePanel: headingBox.right <= panelBox.right + 1,
      headingScrollFits: headingElement.scrollWidth <= headingElement.clientWidth + 1,
      overflowWrap: style.overflowWrap,
      viewportWidth: window.innerWidth,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics?.documentWidth).toBeLessThanOrEqual((metrics?.viewportWidth ?? 0) + 1);
  expect(metrics?.headingInsidePanel).toBeTruthy();
  expect(metrics?.headingScrollFits).toBeTruthy();
  expect(metrics?.overflowWrap).toBe("anywhere");
});

test("kvalificerade-listan bryter långa lagnamn i slutspelspanelen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Qualified List ${Date.now()}`;
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

  const longName = `ExtremtLångtObrutetKvalificeratLagnamnSomMåsteBrytaIListanFörSlutspel${Date.now()}`;
  response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: longName, kind: "team", seed: 1 },
  });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: "Lag 2", kind: "team", seed: 2 },
  });
  expect(response.ok()).toBeTruthy();

  await page.request.post(`/api/tournaments/${tournament.id}/generate`, {
    data: { confirm_reset: true },
  });

  await page.goto(`/tournaments/${tournament.id}#slutspel`);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
  await expect(page.getByText("Kvalificerade till slutspel")).toBeVisible();

  const metrics = await page.locator(".mini-list").first().evaluate((list) => {
    const panel = list.closest(".panel");
    if (!panel) return null;
    const panelBox = panel.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      listFitsPanel: listBox.right <= panelBox.right + 1,
      viewportWidth: window.innerWidth,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.documentWidth).toBeLessThanOrEqual((metrics!.viewportWidth ?? 0) + 10);
  expect(metrics!.listFitsPanel).toBeTruthy();
});

test("slutspelstabellen bryter långa lagnamn i standings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Standings Table ${Date.now()}`;
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

  const longName = `ExtremtLångtObrutetStandingsLagnamnSomInteFårSpräckaTabellen${Date.now()}`;
  response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: longName, kind: "team", seed: 1 },
  });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: "Lag 2", kind: "team", seed: 2 },
  });
  expect(response.ok()).toBeTruthy();

  await page.request.post(`/api/tournaments/${tournament.id}/generate`, {
    data: { confirm_reset: true },
  });

  await page.goto(`/tournaments/${tournament.id}#slutspel`);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
  await expect(page.getByText("Tabeller")).toBeVisible();

  const metrics = await page.locator(".standings-grid .admin-table").first().evaluate((table) => {
    const panel = table.closest(".panel");
    const panelBox = panel?.getBoundingClientRect();
    const tableBox = table.getBoundingClientRect();
    const nameCell = table.querySelector<HTMLElement>("tbody td:nth-child(2)");
    const nameStyle = nameCell ? getComputedStyle(nameCell) : null;
    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
      tableWidth: tableBox.width,
      panelWidth: panelBox?.width ?? 0,
      overflowWrap: nameStyle?.overflowWrap ?? "",
      wordBreak: nameStyle?.wordBreak ?? "",
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.documentWidth).toBeLessThanOrEqual((metrics!.viewportWidth ?? 0) + 10);
  expect(metrics!.overflowWrap).toBe("anywhere");
  expect(metrics!.wordBreak).toBe("break-word");
});

test("schemabrädan bryter långa resurs- och matchnamn i kolumnerna", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Schedule Board ${Date.now()}`;
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

  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: "Lag 1", kind: "team", seed: 1 },
  });
  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: "Lag 2", kind: "team", seed: 2 },
  });

  await page.request.post(`/api/tournaments/${tournament.id}/generate`, {
    data: { confirm_reset: true },
  });

  const longName = `ObrutetExtremtLångtResursnamnSomMåsteBrytaIKolummenFörSchemaVyn${Date.now()}`;
  response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
    data: { name: longName, kind: "court" },
  });
  expect(response.ok()).toBeTruthy();

  await page.request.post(`/api/tournaments/${tournament.id}/schedule`);

  await page.goto(`/tournaments/${tournament.id}#schema`);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
  await expect(page.getByText("Schema")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const board = document.querySelector(".schedule-board");
    if (!board) return null;
    const firstHeader = board.querySelector<HTMLElement>(".resource-column header strong");
    const firstMatch = board.querySelector<HTMLElement>(".resource-match strong");
    const firstMatchStyle = firstMatch ? getComputedStyle(firstMatch) : null;
    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
      headerOverflowWrap: firstHeader ? getComputedStyle(firstHeader).overflowWrap : "",
      matchOverflowWrap: firstMatchStyle?.overflowWrap ?? "",
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.documentWidth).toBeLessThanOrEqual((metrics!.viewportWidth ?? 0) + 10);
  expect(metrics!.headerOverflowWrap).toBe("anywhere");
  expect(metrics!.matchOverflowWrap).toBe("anywhere");
});

test("alla-matcher-tabellen exploderar inte sidbredden", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Alla Matcher Table ${Date.now()}`;
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

  const longName = `ExtremtLångtObrutetLagnamnSomInteFårSpräckaMatchtabellen${Date.now()}`;
  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: longName, kind: "team", seed: 1 },
  });
  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: "Lag 2", kind: "team", seed: 2 },
  });

  await page.request.post(`/api/tournaments/${tournament.id}/generate`, {
    data: { confirm_reset: true },
  });

  const resourceName = `ResursMedEttExtremtLångtObrutetNamnSomTestarLayoutenJustNu${Date.now()}`;
  response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
    data: { name: resourceName, kind: "court" },
  });
  expect(response.ok()).toBeTruthy();

  await page.request.post(`/api/tournaments/${tournament.id}/schedule`);

  await page.goto(`/tournaments/${tournament.id}#alla-matcher`);
  await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();
  await expect(page.getByText("Alla matcher")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const panel = document.querySelector("#alla-matcher");
    if (!panel) return null;
    const panelBox = panel.getBoundingClientRect();
    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.documentWidth).toBeLessThanOrEqual((metrics!.viewportWidth ?? 0) + 10);
  expect(metrics!.panelScrollWidth).toBeLessThanOrEqual(metrics!.panelClientWidth + 50);
});

test("tid-editorn trycker inte iväg åtgärdskolumnen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Details Open ${Date.now()}`;
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

  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: "Lag 1", kind: "team", seed: 1 },
  });
  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: "Lag 2", kind: "team", seed: 2 },
  });

  await page.request.post(`/api/tournaments/${tournament.id}/generate`, {
    data: { confirm_reset: true },
  });

  await page.request.post(`/api/tournaments/${tournament.id}/schedule`);

  await page.goto(`/tournaments/${tournament.id}#alla-matcher`);
  await expect(page.getByText("Alla matcher")).toBeVisible();

  const details = page.locator(".row-actions").first();
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");

  const metrics = await page.evaluate(() => {
    const panel = document.querySelector("#alla-matcher");
    if (!panel) return null;
    const panelBox = panel.getBoundingClientRect();
    const detailsEl = document.querySelector(".row-actions[open]");
    if (!detailsEl) return null;
    const detailsBox = detailsEl.getBoundingClientRect();
    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      detailsFitsPanel: detailsBox.right <= panelBox.right + 2,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.documentWidth).toBeLessThanOrEqual((metrics!.viewportWidth ?? 0) + 10);
  expect(metrics!.detailsFitsPanel).toBeTruthy();
});

test("poängdialogens matchnamn överlappar inte", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Score Dialog ${Date.now()}`;
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

  const longNameA = `ExtremtLångtObrutetLagnamnSomFårPlatsIDialogenA${Date.now()}`;
  const longNameB = `ExtremtLångtObrutetLagnamnSomFårPlatsIDialogenB${Date.now()}`;
  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: longNameA, kind: "team", seed: 1 },
  });
  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: longNameB, kind: "team", seed: 2 },
  });

  await page.request.post(`/api/tournaments/${tournament.id}/generate`, {
    data: { confirm_reset: true },
  });

  await page.goto(`/tournaments/${tournament.id}#alla-matcher`);
  await expect(page.getByText("Alla matcher")).toBeVisible();

  const poangButton = page.locator("button").filter({ hasText: "Poäng" }).first();
  await poangButton.click();

  await expect(page.getByRole("dialog")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const dialog = document.querySelector(".modal-panel");
    if (!dialog) return null;
    const dialogBox = dialog.getBoundingClientRect();
    const matchup = dialog.querySelector(".score-matchup");
    if (!matchup) return null;
    const matchupBox = matchup.getBoundingClientRect();
    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
      dialogWidth: dialogBox.width,
      dialogRight: dialogBox.right,
      matchupFitsDialog: matchupBox.right <= dialogBox.right + 2,
      viewportRight: window.innerWidth,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.documentWidth).toBeLessThanOrEqual((metrics!.viewportWidth ?? 0) + 10);
  expect(metrics!.matchupFitsDialog).toBeTruthy();
});

test("poängdialogens mobilknappar syns på 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Score Buttons ${Date.now()}`;
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

  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: "Lag 1", kind: "team", seed: 1 },
  });
  await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
    data: { name: "Lag 2", kind: "team", seed: 2 },
  });

  await page.request.post(`/api/tournaments/${tournament.id}/generate`, {
    data: { confirm_reset: true },
  });

  await page.goto(`/tournaments/${tournament.id}#alla-matcher`);
  await expect(page.getByText("Alla matcher")).toBeVisible();

  await page.locator("button").filter({ hasText: "Poäng" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const dialog = document.querySelector(".modal-panel");
    if (!dialog) return null;
    const dialogBox = dialog.getBoundingClientRect();
    const actions = dialog.querySelector(".modal-actions");
    if (!actions) return null;
    const actionButtons = actions.querySelectorAll("button");
    const buttonsVisible = Array.from(actionButtons).every((btn) => {
      const box = btn.getBoundingClientRect();
      return box.right <= dialogBox.right + 2 && box.left >= dialogBox.left - 2;
    });
    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
      dialogFitsViewport: dialogBox.right <= window.innerWidth + 2,
      buttonsVisible,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.documentWidth).toBeLessThanOrEqual((metrics!.viewportWidth ?? 0) + 10);
  expect(metrics!.dialogFitsViewport).toBeTruthy();
  expect(metrics!.buttonsVisible).toBeTruthy();
});

test("tv- och moderatorformulär blir inte absurt höga på mobil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Form Height ${Date.now()}`;
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

  await page.goto("/admin/tv");
  await expect(page.getByText("Live TV")).toBeVisible();

  const tvLabel = page.locator(".tv-create-form label").first();
  const tvLabelBox = await tvLabel.boundingBox();
  expect(tvLabelBox).not.toBeNull();
  expect(tvLabelBox!.height).toBeLessThan(120);

  await page.goto(`/tournaments/${tournament.id}#moderatorer`);
  await expect(page.getByText("Skapa moderatorlänk")).toBeVisible();

  const modLabel = page.locator(".moderator-create-form label").first();
  const modLabelBox = await modLabel.boundingBox();
  expect(modLabelBox).not.toBeNull();
  expect(modLabelBox!.height).toBeLessThan(120);
});

test("tv-länkskort ryms på mobil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  let response = await page.request.post("/api/tournaments", {
    data: {
      name: `TV Mobile ${Date.now()}`,
      starts_at: "2026-06-14T10:00",
      group_count: 2,
      qualifiers_per_group: 1,
    },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto("/admin/tv");
  await expect(page.getByText("Live TV")).toBeVisible();

  const metrics = await page.evaluate(() => {
    return {
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
    };
  });

  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 10);
});

test("moderatorns matchkort bryter långa namn", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Moderator Card ${Date.now()}`;
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

test("admin ser varning om standard-PIN används", async ({ page }) => {
  await loginAsAdmin(page);
  const pinWarning = page.locator(".pin-warning");
  if (await pinWarning.count() > 0) {
    await expect(pinWarning).toContainText("Standard-PIN");
  }
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

test("TV-slide-dots har title med slide-namn och topbar visar aktuell slide", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsAdmin(page);

  const tournamentName = `TV Dots ${Date.now()}`;
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

  for (let i = 0; i < 4; i++) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
      data: { name: `Lag ${i}`, kind: "team", seed: i + 1 },
    });
    expect(response.ok()).toBeTruthy();
  }

  response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
    data: { name: "Plan 1", kind: "court" },
  });
  expect(response.ok()).toBeTruthy();
  const resource = await response.json() as { id: number };

  response = await page.request.post(`/api/tournaments/${tournament.id}/generate`, { data: {} });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/schedule`, { data: {} });
  expect(response.ok()).toBeTruthy();

  const tvCode = `TD${Date.now().toString().slice(-8)}`;
  response = await page.request.post("/api/tv-links", { data: { label: "Dots TV", code: tvCode } });
  expect(response.ok()).toBeTruthy();
  const tvLink = (await response.json() as { tv_link: { id: number } }).tv_link;
  response = await page.request.patch(`/api/tv-links/${tvLink.id}`, {
    data: { label: "Dots TV", tournament_id: tournament.id, resource_id: resource.id },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tv/${tvCode}`);
  await expect(page.getByText(tournamentName)).toBeVisible();

  const dotTitles = await page.evaluate(() => {
    const dots = document.querySelectorAll<HTMLElement>(".tv-dots span");
    return Array.from(dots).map((dot) => dot.getAttribute("title"));
  });
  expect(dotTitles.length).toBe(3);
  expect(dotTitles).toContain("Nu spelas");
  expect(dotTitles).toContain("Tabeller och slutspel");
  expect(dotTitles).toContain("Dagens schema");
});

test("Tid-redigerarens details-summary har anpassad stil utan native marker", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await prepareScheduledTournament(page);
  await page.locator(".tournament-tabs").getByRole("link", { name: "Matcher" }).click();

  const summary = page.locator(".row-actions summary").first();
  await expect(summary).toBeVisible();

  const styles = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>(".row-actions summary");
    if (!s) return null;
    const style = window.getComputedStyle(s);
    return {
      display: style.display,
      alignItems: style.alignItems,
    };
  });
  expect(styles).not.toBeNull();
  expect(styles!.display).toBe("inline-flex");
  expect(styles!.alignItems).toBe("center");

  const beforeContent = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>(".row-actions summary");
    if (!s) return null;
    return window.getComputedStyle(s, "::before").content;
  });
  expect(beforeContent).toContain("✎");
});

test("inputs och selects med långa värden har title-attribut", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await loginAsAdmin(page);

  const tvUrlTest = page.locator("#new-tv-link input[name=\"code\"]");
  await expect(tvUrlTest).toBeVisible();

  const tvCode = `TT${Date.now().toString().slice(-8)}`;
  const tvForm = page.locator("#new-tv-link form");
  await tvForm.locator('input[name="label"]').fill("Test TV");
  await tvForm.locator('input[name="code"]').fill(tvCode);
  await tvForm.getByRole("button", { name: "Skapa länk" }).click();
  await expect(page.getByRole("status")).toContainText("Live TV-länk skapad.");

  const tvUrlInput = page.locator(".tv-link-url input");
  await expect(tvUrlInput).toBeVisible();
  const titleAttr = await tvUrlInput.getAttribute("title");
  expect(titleAttr).toBeTruthy();
  expect(titleAttr).toContain("/tv/");
});

test("admin-flikarna har horisontell scrollindikator på mobil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);
  await createTournament(page);

  const tabs = page.locator(".tournament-tabs");
  await expect(tabs).toBeVisible();

  const css = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".tournament-tabs");
    if (!el) return null;
    const style = window.getComputedStyle(el);
    return {
      overflowX: style.overflowX,
      backgroundAttachment: style.backgroundAttachment,
    };
  });
  expect(css).not.toBeNull();
  expect(css!.overflowX).toBe("auto");
  expect(css!.backgroundAttachment).toContain("local");
});

test("TV-topbarens turneringsnamn har ellipsis och title för långa namn", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsAdmin(page);

  const longTournamentName = "EnExtremtLångTurneringsnamnSomMåsteFåEllipsisITVTopbarenFörAttInteSpräckaLayouten";
  const tournamentName = longTournamentName;
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

  for (let i = 0; i < 4; i++) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
      data: { name: `Lag ${i}`, kind: "team", seed: i + 1 },
    });
    expect(response.ok()).toBeTruthy();
  }

  response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
    data: { name: "Plan 1", kind: "court" },
  });
  expect(response.ok()).toBeTruthy();
  const resource = await response.json() as { id: number };

  response = await page.request.post(`/api/tournaments/${tournament.id}/generate`, { data: {} });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/schedule`, { data: {} });
  expect(response.ok()).toBeTruthy();

  const tvCode = `TB${Date.now().toString().slice(-8)}`;
  response = await page.request.post("/api/tv-links", { data: { label: "Topbar TV", code: tvCode } });
  expect(response.ok()).toBeTruthy();
  const tvLink = (await response.json() as { tv_link: { id: number } }).tv_link;
  response = await page.request.patch(`/api/tv-links/${tvLink.id}`, {
    data: { label: "Topbar TV", tournament_id: tournament.id, resource_id: resource.id },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tv/${tvCode}`);
  await expect(page.getByText(tournamentName)).toBeVisible();

  const topbarStyles = await page.evaluate(() => {
    const strong = document.querySelector<HTMLElement>(".tv-meta-block strong");
    if (!strong) return null;
    const style = window.getComputedStyle(strong);
    return {
      minWidth: style.minWidth,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      title: strong.getAttribute("title"),
    };
  });
  expect(topbarStyles).not.toBeNull();
  expect(topbarStyles!.minWidth).toBe("0px");
  expect(topbarStyles!.overflow).toBe("hidden");
  expect(topbarStyles!.textOverflow).toBe("ellipsis");
  expect(topbarStyles!.title).toBe(tournamentName);
});

test("TV Härnäst-panelen bryter inte tabellayouten med långa lagnamn", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsAdmin(page);

  const tournamentName = `TV UpNext ${Date.now()}`;
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

  const longName = "ExtremtLångtObrutetLagnamnFörHärnästPanelenSomMåsteFåEllipsis";
  for (let i = 0; i < 4; i++) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
      data: { name: `${longName}${i}`, kind: "team", seed: i + 1 },
    });
    expect(response.ok()).toBeTruthy();
  }

  response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
    data: { name: "Plan 1", kind: "court" },
  });
  expect(response.ok()).toBeTruthy();
  const resource = await response.json() as { id: number };

  response = await page.request.post(`/api/tournaments/${tournament.id}/generate`, { data: {} });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/schedule`, { data: {} });
  expect(response.ok()).toBeTruthy();

  const tvCode = `UN${Date.now().toString().slice(-8)}`;
  response = await page.request.post("/api/tv-links", { data: { label: "UpNext TV", code: tvCode } });
  expect(response.ok()).toBeTruthy();
  const tvLink = (await response.json() as { tv_link: { id: number } }).tv_link;
  response = await page.request.patch(`/api/tv-links/${tvLink.id}`, {
    data: { label: "UpNext TV", tournament_id: tournament.id, resource_id: resource.id },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tv/${tvCode}`);
  await expect(page.getByText(tournamentName)).toBeVisible();

  const spanStyles = await page.evaluate(() => {
    const spans = document.querySelectorAll<HTMLElement>(".tv-up-next .tv-row span");
    if (!spans.length) return null;
    const style = window.getComputedStyle(spans[0]);
    return {
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      overflow: style.overflow,
    };
  });
  expect(spanStyles).not.toBeNull();
  expect(spanStyles!.whiteSpace).toBe("nowrap");
  expect(spanStyles!.textOverflow).toBe("ellipsis");
});

test("TV-schemalayouten klipper inte nederkant med långa lagnamn", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsAdmin(page);

  const tournamentName = `TV Schedule ${Date.now()}`;
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

  const longName = "ExtremtLångtObrutetLagnamnFörSchemaSliden";
  for (let i = 0; i < 4; i++) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
      data: { name: `${longName}${i}`, kind: "team", seed: i + 1 },
    });
    expect(response.ok()).toBeTruthy();
  }

  response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
    data: { name: "Plan 1", kind: "court" },
  });
  expect(response.ok()).toBeTruthy();
  const resource = await response.json() as { id: number };

  response = await page.request.post(`/api/tournaments/${tournament.id}/generate`, { data: {} });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/schedule`, { data: {} });
  expect(response.ok()).toBeTruthy();

  const tvCode = `SC${Date.now().toString().slice(-8)}`;
  response = await page.request.post("/api/tv-links", { data: { label: "Schedule TV", code: tvCode } });
  expect(response.ok()).toBeTruthy();
  const tvLink = (await response.json() as { tv_link: { id: number } }).tv_link;
  response = await page.request.patch(`/api/tv-links/${tvLink.id}`, {
    data: { label: "Schedule TV", tournament_id: tournament.id, resource_id: resource.id },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tv/${tvCode}`);
  await expect(page.getByText(tournamentName)).toBeVisible();

  await expect(page.locator(".tv-slide:nth-child(3)")).toBeAttached();

  const layoutCss = await page.evaluate(() => {
    const deck = document.querySelector<HTMLElement>(".schedule-layout");
    if (!deck) return null;
    const style = window.getComputedStyle(deck);
    return {
      gridTemplateRows: style.gridTemplateRows,
    };
  });
  expect(layoutCss).not.toBeNull();
  expect(layoutCss!.gridTemplateRows).not.toContain("0.7fr");
});

test("TV-tabeller i slutspelsvyn bryter långa lagnamn i standings", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsAdmin(page);

  const tournamentName = `TV Standings ${Date.now()}`;
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

  const longName = "ExtremtLångtObrutetTävlingslagnamnSomMåsteBrytasITVTabellen";
  for (let i = 0; i < 4; i++) {
    response = await page.request.post(`/api/tournaments/${tournament.id}/participants`, {
      data: { name: `${longName}${i}`, kind: "team", seed: i + 1 },
    });
    expect(response.ok()).toBeTruthy();
  }

  response = await page.request.post(`/api/tournaments/${tournament.id}/resources`, {
    data: { name: "Plan 1", kind: "court" },
  });
  expect(response.ok()).toBeTruthy();
  const resource = await response.json() as { id: number };

  response = await page.request.post(`/api/tournaments/${tournament.id}/generate`, { data: {} });
  expect(response.ok()).toBeTruthy();
  response = await page.request.post(`/api/tournaments/${tournament.id}/schedule`, { data: {} });
  expect(response.ok()).toBeTruthy();

  const tvCode = `TS${Date.now().toString().slice(-8)}`;
  response = await page.request.post("/api/tv-links", { data: { label: "Standings TV", code: tvCode } });
  expect(response.ok()).toBeTruthy();
  const tvLink = (await response.json() as { tv_link: { id: number } }).tv_link;
  response = await page.request.patch(`/api/tv-links/${tvLink.id}`, {
    data: { label: "Standings TV", tournament_id: tournament.id, resource_id: resource.id },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tv/${tvCode}`);
  await expect(page.getByText(tournamentName)).toBeVisible();

  const styles = await page.evaluate(() => {
    const tds = document.querySelectorAll<HTMLElement>(".tv-standings table td:nth-child(2)");
    if (!tds.length) return null;
    const style = window.getComputedStyle(tds[0]);
    return {
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
    };
  });
  expect(styles).not.toBeNull();
  expect(styles!.overflowWrap).toBe("anywhere");
  expect(styles!.wordBreak).toBe("break-word");
});

test("TV-vänteläget ryms på mobil och bryter långa etiketter", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const tvCode = `TW${Date.now().toString().slice(-8)}`;
  const longLabel = "En extremt lång obruten TV-skärmetikett för att testa att vänteläget hanterar detta";

  let response = await page.request.post("/api/tv-links", {
    data: { label: longLabel, code: tvCode },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/tv/${tvCode}`);
  await expect(page.locator(".tv-waiting-card")).toBeVisible();
  await expect(page.locator(".tv-waiting-card")).toContainText(longLabel);

  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
});

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
