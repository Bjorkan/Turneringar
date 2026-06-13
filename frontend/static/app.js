const app = document.querySelector("#app");
const nav = document.querySelector("#main-nav");

let currentSession = { is_admin: false, admin_pin_default: false };
let activeEventSource = null;

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) {
    throw new Error(payload.detail || "Något gick fel.");
  }
  return payload;
};

const formPayload = (form) => {
  const payload = {};
  for (const [key, value] of new FormData(form).entries()) {
    payload[key] = value;
  }
  return payload;
};

const showError = (error) => {
  const target = document.querySelector("#notice-slot");
  const message = esc(error.message || error);
  if (target) {
    target.innerHTML = `<p class="notice danger">${message}</p>`;
  } else {
    app.insertAdjacentHTML("afterbegin", `<p class="notice danger">${message}</p>`);
  }
};

const showMessage = (message) => {
  const target = document.querySelector("#notice-slot");
  if (target) target.innerHTML = `<p class="notice success">${esc(message)}</p>`;
};

const setNav = () => {
  if (currentSession.is_admin) {
    nav.innerHTML = `
      <a href="/admin" data-link>Admin</a>
      <button class="link-button" id="logout-button" type="button">Logga ut</button>
    `;
    document.querySelector("#logout-button").addEventListener("click", async () => {
      await api("/api/admin/logout", { method: "POST" });
      history.pushState({}, "", "/");
      await render();
    });
  } else {
    nav.innerHTML = "";
  }
};

const withShell = (content) => {
  const warning = currentSession.admin_pin_default
    ? `<p class="notice">Standard-PIN är aktiv: <strong>admin123</strong>. Sätt miljövariabeln <code>ADMIN_PIN</code> inför skarp körning.</p>`
    : "";
  app.innerHTML = `${warning}<div id="notice-slot"></div>${content}`;
};

const navigate = async (path) => {
  history.pushState({}, "", path);
  await render();
};

const requireAdmin = async () => {
  if (!currentSession.is_admin) {
    renderLogin();
    return false;
  }
  return true;
};

const renderLogin = () => {
  setNav();
  withShell(`
    <section class="panel narrow">
      <h1>Admin</h1>
      <form id="login-form" class="stack">
        <label>PIN <input name="pin" type="password" autofocus required></label>
        <button type="submit">Logga in</button>
      </form>
    </section>
  `);
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/login", { method: "POST", body: formPayload(event.currentTarget) });
      currentSession = await api("/api/session");
      await navigate("/admin");
    } catch (error) {
      showError(error);
    }
  });
};

const renderAdmin = async () => {
  if (!(await requireAdmin())) return;
  setNav();
  const { tournaments } = await api("/api/tournaments");
  withShell(`
    <section class="page-head">
      <div>
        <h1>Turneringar</h1>
        <p>Skapa och fortsätt arbeta med lokala event.</p>
      </div>
    </section>

    <section class="panel">
      <h2>Ny turnering</h2>
      <form id="create-tournament" class="grid-form">
        <label>Namn <input name="name" required placeholder="Sommarcupen"></label>
        <label>Start <input name="starts_at" type="datetime-local"></label>
        <label>Grupper <input name="group_count" type="number" min="1" value="2"></label>
        <label>Vidare/grupp <input name="qualifiers_per_group" type="number" min="1" value="2"></label>
        <button type="submit">Skapa</button>
      </form>
    </section>

    <section class="list">
      ${tournaments
        .map(
          (tournament) => `
            <article class="item">
              <div>
                <h2><a href="/tournaments/${tournament.id}" data-link>${esc(tournament.name)}</a></h2>
                <p>${tournament.participant_count} deltagare, ${tournament.resource_count} resurser, ${tournament.match_count} matcher</p>
              </div>
              <a class="button ghost" href="/tv/${tournament.id}">Live TV</a>
            </article>
          `,
        )
        .join("") || `<p class="empty">Inga turneringar ännu.</p>`}
    </section>
  `);
  document.querySelector("#create-tournament").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/tournaments", { method: "POST", body: formPayload(event.currentTarget) });
      await navigate(`/tournaments/${result.id}`);
    } catch (error) {
      showError(error);
    }
  });
};

const renderTournament = async (id) => {
  if (!(await requireAdmin())) return;
  setNav();
  const data = await api(`/api/tournaments/${id}`);
  const { tournament, participants, resources, standings, matches, moderators } = data;

  withShell(`
    <section class="page-head" data-tournament-id="${tournament.id}">
      <div>
        <h1>${esc(tournament.name)}</h1>
        <p>Status: ${esc(tournament.status)} · Start ${esc(tournament.starts_at)}</p>
      </div>
      <a class="button" href="/tv/${tournament.id}">Öppna Live TV</a>
    </section>

    <section class="panel">
      <h2>Inställningar</h2>
      <form id="settings-form" class="grid-form">
        <label>Start <input name="starts_at" type="datetime-local" value="${esc(tournament.starts_at)}"></label>
        <label>Matchminuter <input name="match_minutes" type="number" min="1" value="${tournament.match_minutes}"></label>
        <label>Vila minuter <input name="break_minutes" type="number" min="0" value="${tournament.break_minutes}"></label>
        <label>Grupper <input name="group_count" type="number" min="1" value="${tournament.group_count}"></label>
        <label>Vidare/grupp <input name="qualifiers_per_group" type="number" min="1" value="${tournament.qualifiers_per_group}"></label>
        <button type="submit">Spara</button>
      </form>
    </section>

    <div class="columns">
      <section class="panel">
        <h2>Deltagare</h2>
        <form id="participant-form" class="inline-form">
          <input name="name" required placeholder="Lag eller spelare">
          <select name="kind"><option value="team">Lag</option><option value="player">Spelare</option></select>
          <input name="seed" type="number" min="1" placeholder="Seed">
          <button type="submit">Lägg till</button>
        </form>
        <table>
          <thead><tr><th>Seed</th><th>Namn</th><th>Typ</th></tr></thead>
          <tbody>
            ${participants.map((p) => `<tr><td>${p.seed || "-"}</td><td>${esc(p.name)}</td><td>${esc(p.kind)}</td></tr>`).join("") || `<tr><td colspan="3">Inga deltagare.</td></tr>`}
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>Spelplaner/servrar</h2>
        <form id="resource-form" class="inline-form">
          <input name="name" required placeholder="Plan 1">
          <select name="kind"><option value="court">Spelplan</option><option value="server">Server</option><option value="table">Bord</option></select>
          <button type="submit">Lägg till</button>
        </form>
        <table>
          <thead><tr><th>Namn</th><th>Typ</th><th>Status</th></tr></thead>
          <tbody>
            ${resources.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.kind)}</td><td>${r.active ? "Aktiv" : "Pausad"}</td></tr>`).join("") || `<tr><td colspan="3">Inga resurser.</td></tr>`}
          </tbody>
        </table>
      </section>
    </div>

    <section class="panel actions">
      <h2>Förbered bracket och schema</h2>
      <button id="generate-button" type="button">Generera gruppspel och slutspel</button>
      <button id="schedule-button" type="button">Autoschemalägg matcher</button>
    </section>

    <section class="panel">
      <h2>Tabeller</h2>
      <div class="columns">
        ${standings
          .map(
            (standing) => `
              <div>
                <h3>${esc(standing.group.name)}</h3>
                <table>
                  <thead><tr><th>#</th><th>Deltagare</th><th>P</th><th>+/-</th><th>Poäng</th></tr></thead>
                  <tbody>${standing.rows
                    .map((row) => `<tr><td>${row.rank}</td><td>${esc(row.name)}</td><td>${row.played}</td><td>${row.diff}</td><td>${row.points}</td></tr>`)
                    .join("")}</tbody>
                </table>
              </div>
            `,
          )
          .join("") || `<p class="empty">Generera bracket för att se grupper.</p>`}
      </div>
    </section>

    <section class="panel">
      <h2>Matcher</h2>
      <table class="matches">
        <thead><tr><th>Tid</th><th>Resurs</th><th>Match</th><th>Resultat</th><th>Flytta</th><th>Rapportera</th></tr></thead>
        <tbody>
          ${matches.map((match) => renderMatchRow(tournament, resources, match)).join("") || `<tr><td colspan="6">Inga matcher ännu.</td></tr>`}
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Moderatorlänkar</h2>
      <form id="moderator-form" class="inline-form">
        <input name="label" required placeholder="Moderator plan 1">
        <select name="resource_id">
          <option value="">Alla resurser</option>
          ${resources.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}
        </select>
        <button type="submit">Skapa länk</button>
      </form>
      <table>
        <thead><tr><th>Etikett</th><th>Scope</th><th>PIN</th><th>Länk</th></tr></thead>
        <tbody>
          ${moderators
            .map(
              (m) => `
                <tr>
                  <td>${esc(m.label)}</td>
                  <td>${esc(m.resource_name || "Alla resurser")}</td>
                  <td><code>${esc(m.pin)}</code></td>
                  <td><a href="/m/${m.token}" data-link>/m/${m.token}</a></td>
                </tr>
              `,
            )
            .join("") || `<tr><td colspan="4">Inga moderatorer ännu.</td></tr>`}
        </tbody>
      </table>
    </section>
  `);

  bindTournamentForms(tournament.id);
  subscribeToTournament(tournament.id, () => renderTournament(tournament.id));
};

const renderMatchRow = (tournament, resources, match) => `
  <tr>
    <td>${esc(match.time_label)}</td>
    <td>${esc(match.resource_name || "-")}</td>
    <td><strong>${esc(match.name)}</strong><br>${esc(match.side_a)} vs ${esc(match.side_b)}</td>
    <td>${esc(match.score_label)}</td>
    <td>
      <form class="tiny-form slot-form" data-match-id="${match.id}">
        <input name="scheduled_at" type="datetime-local" value="${esc(match.scheduled_at || tournament.starts_at)}" required>
        <select name="resource_id" required>
          ${resources.map((r) => `<option value="${r.id}" ${r.id === match.resource_id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
        </select>
        <input name="duration_minutes" type="number" min="1" value="${match.duration_minutes}">
        <button type="submit">Spara</button>
      </form>
    </td>
    <td>
      <form class="score-form result-form" data-match-id="${match.id}">
        <input name="score_a" type="number" value="${match.score_a ?? ""}" aria-label="Poäng A">
        <input name="score_b" type="number" value="${match.score_b ?? ""}" aria-label="Poäng B">
        <button type="submit">OK</button>
      </form>
    </td>
  </tr>
`;

const bindTournamentForms = (tournamentId) => {
  document.querySelector("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload(`/api/tournaments/${tournamentId}/settings`, "PATCH", event.currentTarget, "Inställningar sparade.");
  });
  document.querySelector("#participant-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload(`/api/tournaments/${tournamentId}/participants`, "POST", event.currentTarget, "Deltagare tillagd.");
  });
  document.querySelector("#resource-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload(`/api/tournaments/${tournamentId}/resources`, "POST", event.currentTarget, "Resurs tillagd.");
  });
  document.querySelector("#moderator-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAndReload(`/api/tournaments/${tournamentId}/moderators`, "POST", event.currentTarget, "Moderatorlänk skapad.");
  });
  document.querySelector("#generate-button").addEventListener("click", async () => {
    await postAndReload(`/api/tournaments/${tournamentId}/generate`, "Bracket skapad.");
  });
  document.querySelector("#schedule-button").addEventListener("click", async () => {
    await postAndReload(`/api/tournaments/${tournamentId}/schedule`, "Schema uppdaterat.");
  });
  document.querySelectorAll(".slot-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const matchId = event.currentTarget.dataset.matchId;
      await submitAndReload(`/api/tournaments/${tournamentId}/matches/${matchId}/slot`, "PATCH", event.currentTarget, "Match flyttad.");
    });
  });
  document.querySelectorAll(".result-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const matchId = event.currentTarget.dataset.matchId;
      await submitAndReload(`/api/tournaments/${tournamentId}/matches/${matchId}/result`, "POST", event.currentTarget, "Resultat sparat.");
    });
  });
};

const submitAndReload = async (path, method, form, message) => {
  try {
    await api(path, { method, body: formPayload(form) });
    await renderTournament(location.pathname.split("/").pop());
    showMessage(message);
  } catch (error) {
    showError(error);
  }
};

const postAndReload = async (path, message) => {
  try {
    await api(path, { method: "POST", body: {} });
    await renderTournament(location.pathname.split("/").pop());
    showMessage(message);
  } catch (error) {
    showError(error);
  }
};

const renderModerator = async (token) => {
  setNav();
  const data = await api(`/api/moderators/${token}`);
  const { moderator, authorized, matches } = data;
  withShell(`
    <section class="page-head" data-tournament-id="${moderator.tournament_id}">
      <div>
        <h1>${esc(moderator.label)}</h1>
        <p>${esc(moderator.tournament_name)} · ${esc(moderator.resource_name || "Alla resurser")}</p>
      </div>
    </section>
    ${
      authorized
        ? renderModeratorMatches(token, matches)
        : `<section class="panel narrow">
            <h2>Moderator-PIN</h2>
            <form id="moderator-login" class="stack">
              <label>PIN <input name="pin" type="password" required autofocus></label>
              <button type="submit">Öppna</button>
            </form>
          </section>`
    }
  `);
  if (authorized) {
    bindModeratorResultForms(token);
    subscribeToTournament(moderator.tournament_id, () => renderModerator(token));
  } else {
    document.querySelector("#moderator-login").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/moderators/${token}/login`, { method: "POST", body: formPayload(event.currentTarget) });
        await renderModerator(token);
      } catch (error) {
        showError(error);
      }
    });
  }
};

const renderModeratorMatches = (token, matches) => `
  <section class="panel">
    <h2>Rapportera resultat</h2>
    <table>
      <thead><tr><th>Tid</th><th>Resurs</th><th>Match</th><th>Resultat</th></tr></thead>
      <tbody>
        ${matches
          .map(
            (match) => `
              <tr>
                <td>${esc(match.time_label)}</td>
                <td>${esc(match.resource_name || "-")}</td>
                <td><strong>${esc(match.side_a)}</strong> vs <strong>${esc(match.side_b)}</strong></td>
                <td>
                  <form class="score-form moderator-result-form" data-match-id="${match.id}">
                    <input name="score_a" type="number" required aria-label="Poäng A">
                    <input name="score_b" type="number" required aria-label="Poäng B">
                    <button type="submit">Spara</button>
                  </form>
                </td>
              </tr>
            `,
          )
          .join("") || `<tr><td colspan="4">Inga öppna matcher i ditt scope.</td></tr>`}
      </tbody>
    </table>
  </section>
`;

const bindModeratorResultForms = (token) => {
  document.querySelectorAll(".moderator-result-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/moderators/${token}/matches/${event.currentTarget.dataset.matchId}/result`, {
          method: "POST",
          body: formPayload(event.currentTarget),
        });
        await renderModerator(token);
        showMessage("Resultat sparat.");
      } catch (error) {
        showError(error);
      }
    });
  });
};

const subscribeToTournament = (tournamentId, onChange) => {
  if (activeEventSource) activeEventSource.close();
  activeEventSource = new EventSource(`/api/events/${tournamentId}`);
  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 600);
  };
  ["result_updated", "schedule_updated", "structure_generated", "bracket_seeded", "settings_updated"].forEach((eventName) => {
    activeEventSource.addEventListener(eventName, schedule);
  });
};

const render = async () => {
  try {
    currentSession = await api("/api/session");
    const path = location.pathname;
    if (path.startsWith("/m/")) {
      await renderModerator(path.split("/")[2]);
    } else if (path.startsWith("/tournaments/")) {
      await renderTournament(path.split("/")[2]);
    } else if (currentSession.is_admin) {
      await renderAdmin();
    } else {
      renderLogin();
    }
  } catch (error) {
    showError(error);
  }
};

document.addEventListener("click", async (event) => {
  const link = event.target.closest("a[data-link]");
  if (!link) return;
  event.preventDefault();
  await navigate(link.getAttribute("href"));
});

window.addEventListener("popstate", render);
render();

