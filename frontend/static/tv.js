const stage = document.querySelector("#tv-stage");
const tournamentId = location.pathname.split("/").pop();

let activeIndex = 0;
let rotateTimer = null;
let eventSource = null;

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const api = async (path) => {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) throw new Error("Kunde inte läsa TV-data.");
  return response.json();
};

const render = async () => {
  const data = await api(`/api/tournaments/${tournamentId}/tv`);
  const { tournament, current_matches, upcoming_matches, recent_matches, standings } = data;
  document.title = `Live TV - ${tournament.name}`;
  stage.innerHTML = `
    <section class="tv-slide active">
      <p class="kicker">${esc(tournament.name)}</p>
      <h1>Pågående matcher</h1>
      <div class="tv-grid">
        ${current_matches
          .map(
            (match) => `
              <article>
                <p>${esc(match.resource_name || "Ej placerad")} · ${esc(match.time_label)}</p>
                <h2>${esc(match.side_a)} vs ${esc(match.side_b)}</h2>
                <strong>${esc(match.score_label)}</strong>
              </article>
            `,
          )
          .join("") || `<article><h2>Inga matcher pågår just nu</h2><p>Nästa match visas på kommande slide.</p></article>`}
      </div>
    </section>

    <section class="tv-slide">
      <p class="kicker">${esc(tournament.name)}</p>
      <h1>Kommande matcher</h1>
      <div class="tv-list">
        ${upcoming_matches
          .slice(0, 8)
          .map((match) => `<article><time>${esc(match.time_label)}</time><span>${esc(match.resource_name || "-")}</span><strong>${esc(match.side_a)} vs ${esc(match.side_b)}</strong></article>`)
          .join("") || `<article><strong>Inga kommande matcher är schemalagda.</strong></article>`}
      </div>
    </section>

    <section class="tv-slide">
      <p class="kicker">${esc(tournament.name)}</p>
      <h1>Senaste resultat</h1>
      <div class="tv-list">
        ${recent_matches
          .slice(0, 8)
          .map((match) => `<article><time>${esc(match.time_label)}</time><span>${esc(match.resource_name || "-")}</span><strong>${esc(match.side_a)} ${esc(match.score_label)} ${esc(match.side_b)}</strong></article>`)
          .join("") || `<article><strong>Inga resultat rapporterade ännu.</strong></article>`}
      </div>
    </section>

    <section class="tv-slide">
      <p class="kicker">${esc(tournament.name)}</p>
      <h1>Tabelläge</h1>
      <div class="tv-grid">
        ${standings
          .slice(0, 4)
          .map(
            (standing) => `
              <article>
                <h2>${esc(standing.group.name)}</h2>
                ${standing.rows.slice(0, 4).map((row) => `<p>${row.rank}. ${esc(row.name)} · ${row.points}p</p>`).join("")}
              </article>
            `,
          )
          .join("") || `<article><h2>Bracket är inte genererad ännu.</h2></article>`}
      </div>
    </section>
  `;
  activeIndex = 0;
  startRotation();
  subscribe();
};

const startRotation = () => {
  if (rotateTimer) clearInterval(rotateTimer);
  const slides = Array.from(document.querySelectorAll(".tv-slide"));
  rotateTimer = setInterval(() => {
    slides[activeIndex].classList.remove("active");
    activeIndex = (activeIndex + 1) % slides.length;
    slides[activeIndex].classList.add("active");
  }, 8000);
};

const subscribe = () => {
  if (eventSource) return;
  eventSource = new EventSource(`/api/events/${tournamentId}`);
  let reloadTimer = null;
  const refresh = () => {
    if (reloadTimer) return;
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      render();
    }, 1000);
  };
  ["result_updated", "schedule_updated", "structure_generated", "bracket_seeded", "settings_updated"].forEach((eventName) => {
    eventSource.addEventListener(eventName, refresh);
  });
};

render().catch((error) => {
  stage.innerHTML = `<section class="tv-slide active"><h1>${esc(error.message)}</h1></section>`;
});

