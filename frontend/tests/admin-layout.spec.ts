import { expect, test } from "@playwright/test";
import { loginAsAdmin, iso, createTournament, prepareScheduledTournament, expectNoHorizontalOverflow } from "./helpers";

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
        starts_at: iso(72),
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

test("deltagarlistan visar ellipsis och titel för långa namn", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await loginAsAdmin(page);

  const tournamentName = `Participant Table ${Date.now()}`;
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
      starts_at: iso(72),
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
      starts_at: iso(24),
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
      starts_at: iso(24),
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
      starts_at: iso(24),
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
      starts_at: iso(24),
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
      starts_at: iso(24),
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
      starts_at: iso(24),
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
      starts_at: iso(24),
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
      starts_at: iso(24),
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

