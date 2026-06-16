import { expect, test } from "@playwright/test";
import { loginAsAdmin, iso, prepareScheduledTournament } from "./helpers";

test("tv-länkskort ryms på mobil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  let response = await page.request.post("/api/tournaments", {
    data: {
      name: `TV Mobile ${Date.now()}`,
      starts_at: iso(24),
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

test("Live TV rymmer långa lagnamn på 1920-skärm", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsAdmin(page);

  const tournamentName = `TV Overflow Cup ${Date.now()}`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: iso(24),
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
      starts_at: iso(72),
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
      starts_at: iso(72),
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

test("admin kan ta bort TV-länk", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/tv");
  const deleteButton = page.locator(".tv-link-card .danger-outline").first();
  if (await deleteButton.count() === 0) return;
  page.on("dialog", (dialog) => dialog.accept());
  await deleteButton.click();
  await expect(page.getByRole("status")).toContainText("TV-länk borttagen.");
});

test("TV-slide-dots har title med slide-namn och topbar visar aktuell slide", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsAdmin(page);

  const tournamentName = `TV Dots ${Date.now()}`;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: iso(24),
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

test("TV-topbarens turneringsnamn har ellipsis och title för långa namn", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsAdmin(page);

  const longTournamentName = "EnExtremtLångTurneringsnamnSomMåsteFåEllipsisITVTopbarenFörAttInteSpräckaLayouten";
  const tournamentName = longTournamentName;
  let response = await page.request.post("/api/tournaments", {
    data: {
      name: tournamentName,
      starts_at: iso(24),
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
      starts_at: iso(24),
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
      starts_at: iso(24),
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
      starts_at: iso(24),
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

