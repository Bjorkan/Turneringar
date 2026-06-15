{
const { createApp } = Vue;
const tvCode = location.pathname.split("/").pop();
const slideSeconds = 10;

type DateValue = string | number | Date | null | undefined;

const eventText = {
  participant_added: "Deltagare tillagd",
  resource_added: "Resurs tillagd",
  settings_updated: "Inställningar uppdaterade",
  structure_generated: "Slutspel publicerat",
  bracket_seeded: "Slutspel seedat",
  schedule_updated: "Schema uppdaterat",
  score_updated: "Livepoäng uppdaterad",
  result_updated: "Resultat rapporterat",
};

const statusText = {
  pending: "Planerad",
  scheduled: "Planerad",
  in_progress: "Pågår",
  paused: "Paus",
  completed: "Avslutad",
};

const api = async (path) => {
  const response = await fetch(path, { credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || "Kunde inte läsa TV-data.");
  return payload;
};

const parseDate = (value: DateValue) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value: DateValue) => {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", year: "numeric" }).format(date) : value || "-";
};

const formatClock = (date) => new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(date);

const initials = (name) =>
  String(name || "T")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => (part[0] || "").toUpperCase())
    .join("") || "T";

const sortBySchedule = (matches) =>
  [...matches].sort((a, b) => {
    if (!a.scheduled_at && !b.scheduled_at) return a.id - b.id;
    if (!a.scheduled_at) return 1;
    if (!b.scheduled_at) return -1;
    return a.scheduled_at.localeCompare(b.scheduled_at) || a.id - b.id;
  });

createApp({
  data() {
    return {
      data: null,
      error: null,
      activeIndex: 0,
      secondsLeft: slideSeconds,
      now: new Date(),
      eventSource: null,
      timer: null,
      reloadTimer: null,
      slideSeconds,
    };
  },
  computed: {
    slides() {
      return ["live", "tables", "schedule"];
    },
    tournament() {
      return this.data && this.data.tournament;
    },
    tvLink() {
      return this.data && this.data.tv_link;
    },
    isBound() {
      return Boolean(this.data && this.data.bound);
    },
    matches() {
      return this.data ? this.data.matches || [] : [];
    },
    sortedMatches() {
      return sortBySchedule(this.matches);
    },
    currentMatches() {
      return this.data ? this.data.current_matches || [] : [];
    },
    upcomingMatches() {
      return this.data ? this.data.upcoming_matches || [] : [];
    },
    featuredMatch() {
      return this.currentMatches[0] || this.upcomingMatches[0] || this.sortedMatches[0];
    },
    featuredLabel() {
      return this.currentMatches.length ? "NU SPELAS" : "HÄRNÄST";
    },
    featuredPill() {
      if (!this.featuredMatch) return "";
      return this.featuredLabel === "NU SPELAS" ? "Pågår" : this.featuredMatch.status === "completed" ? "Avslutad" : "Planerad";
    },
    visibleUpcoming() {
      return (this.upcomingMatches.length ? this.upcomingMatches : this.sortedMatches.filter((match) => match.status !== "completed")).slice(0, 5);
    },
    scheduleMatches() {
      return (this.upcomingMatches.length ? this.upcomingMatches : this.sortedMatches.filter((match) => match.status !== "completed")).slice(0, 8);
    },
    standings() {
      return this.data ? this.data.standings || [] : [];
    },
    resources() {
      return this.data ? this.data.resources || [] : [];
    },
    visibleResources() {
      return this.resources.slice(0, 4);
    },
    recentMatches() {
      return (this.data ? this.data.recent_matches || [] : []).slice(0, 5);
    },
    events() {
      return this.data ? this.data.events || [] : [];
    },
    knockoutRounds() {
      const knockout = this.matches.filter((match) => match.stage_kind === "knockout");
      return [...new Set<number>(knockout.map((match) => Number(match.round)))]
        .sort((a, b) => a - b)
        .map((round) => ({ round, matches: knockout.filter((match) => Number(match.round) === round) }));
    },
  },
  mounted() {
    this.load();
    this.startTimer();
    this.subscribe();
  },
  beforeUnmount() {
    if (this.timer) clearInterval(this.timer);
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    if (this.eventSource) this.eventSource.close();
  },
  methods: {
    formatDate,
    formatClock,
    parseDate,
    initials,
    eventLabel(kind) {
      return eventText[kind] || kind;
    },
    statusLabel(status) {
      return statusText[status] || status || "Planerad";
    },
    roundTitle(round) {
      const first = round.matches[0];
      return first ? first.name.replace(/\s+\d+$/, "") : `Runda ${round.round}`;
    },
    async load() {
      try {
        const payload = await api(`/api/tv/${tvCode}`);
        document.title = payload.bound ? `Live TV - ${payload.tournament.name}` : `Live TV - ${payload.tv_link.code}`;
        this.data = payload;
        this.error = null;
        this.activeIndex = 0;
        this.secondsLeft = slideSeconds;
      } catch (error) {
        this.error = error;
      }
    },
    startTimer() {
      this.timer = setInterval(() => {
        this.now = new Date();
        if (this.secondsLeft <= 1) {
          this.activeIndex = (this.activeIndex + 1) % this.slides.length;
          this.secondsLeft = slideSeconds;
        } else {
          this.secondsLeft -= 1;
        }
      }, 1000);
    },
    subscribe() {
      this.eventSource = new EventSource(`/api/tv/${tvCode}/events`);
      const refresh = () => {
        if (this.reloadTimer) return;
        this.reloadTimer = setTimeout(() => {
          this.reloadTimer = null;
          this.load();
        }, 800);
      };
      ["participant_added", "resource_added", "score_updated", "result_updated", "schedule_updated", "structure_generated", "bracket_seeded", "settings_updated", "tv_link_updated"].forEach((eventName) => {
        this.eventSource.addEventListener(eventName, refresh);
      });
    },
  },
  template: `
    <section v-if="error" class="tv-slide active"><h1>{{ error.message }}</h1></section>
    <section v-else-if="!data" class="tv-slide active"><h1>Laddar Live TV...</h1></section>
    <section v-else-if="!isBound" class="tv-waiting">
      <div class="tv-waiting-card">
        <div class="tv-brand"><span aria-hidden="true">T</span><strong>Live TV</strong></div>
        <h1>{{ data.message }}</h1>
        <p>{{ tvLink.label }} · {{ tvLink.code }}</p>
        <div class="tv-pulse" aria-hidden="true"><span></span><span></span><span></span></div>
      </div>
    </section>
    <template v-else>
      <header class="tv-topbar">
        <div class="tv-brand"><span aria-hidden="true">T</span><strong>Live TV</strong></div>
        <div class="tv-meta-block"><small>Turnering</small><strong>{{ tournament.name }}</strong><span>{{ formatDate(tournament.starts_at) }}</span></div>
        <div class="tv-clock"><strong>{{ formatClock(now) }}</strong><span>{{ formatDate(now.toISOString()) }}</span></div>
        <div class="tv-meta-block"><small>Sida {{ activeIndex + 1 }} av {{ slides.length }}</small><strong>Nästa vy om {{ secondsLeft }} s</strong></div>
        <div class="tv-dots"><span v-for="(_, index) in slides" :key="index" :class="{ active: index === activeIndex }"></span></div>
      </header>

      <div class="tv-deck">
        <section :class="['tv-slide', activeIndex === 0 && 'active']">
          <div class="tv-layout live-layout">
            <section class="tv-panel tv-feature">
              <template v-if="featuredMatch">
                <div class="feature-head"><h2>{{ featuredLabel }}</h2><span class="live-pill">{{ featuredPill }}</span></div>
                <div class="feature-match">
                  <div class="team-block team-a"><span>{{ initials(featuredMatch.side_a) }}</span><strong>{{ featuredMatch.side_a }}</strong></div>
                  <div class="score-stack"><small>{{ featuredMatch.time_label }} · {{ featuredMatch.group_name || featuredMatch.stage_name || '-' }}</small><strong>{{ featuredMatch.score_label }}</strong><em>{{ statusLabel(featuredMatch.status) }}</em></div>
                  <div class="team-block team-b"><span>{{ initials(featuredMatch.side_b) }}</span><strong>{{ featuredMatch.side_b }}</strong></div>
                </div>
                <dl class="feature-facts">
                  <div><dt>Start</dt><dd>{{ featuredMatch.time_label }}</dd></div>
                  <div><dt>Grupp</dt><dd>{{ featuredMatch.group_name || featuredMatch.stage_name || '-' }}</dd></div>
                  <div><dt>Status</dt><dd>{{ statusLabel(featuredMatch.status) }}</dd></div>
                </dl>
              </template>
              <h1 v-else>Inga matcher publicerade</h1>
            </section>

            <section class="tv-panel tv-up-next">
              <h2>Härnäst</h2>
              <div class="tv-table">
                <div class="tv-row tv-head"><span>Tid</span><span>Match</span><span>Grupp</span></div>
                <div v-if="!visibleUpcoming.length" class="tv-row"><span></span><strong>Inga kommande matcher</strong><span></span></div>
                <template v-else><div v-for="match in visibleUpcoming" :key="match.id" class="tv-row"><strong>{{ match.time_label }}</strong><span>{{ match.side_a }} <em>vs</em> {{ match.side_b }}</span><span>{{ match.group_name || match.stage_name || '-' }}</span></div></template>
              </div>
            </section>

            <section class="tv-panel tv-results">
              <h2>Senaste resultat</h2>
              <div class="tv-table result-table">
                <div v-if="!recentMatches.length" class="tv-row"><strong>Inga resultat rapporterade ännu.</strong></div>
                <template v-else><div v-for="match in recentMatches" :key="match.id" class="tv-row"><span>{{ match.time_label }}</span><strong>{{ match.side_a }} <em>vs</em> {{ match.side_b }}</strong><span>{{ match.score_label }}</span></div></template>
              </div>
            </section>
          </div>
        </section>

        <section :class="['tv-slide', activeIndex === 1 && 'active']">
          <div class="tv-layout tables-layout">
            <section class="tv-panel tv-standings">
              <h1>Tabeller och slutspel</h1>
              <p v-if="!standings.length" class="tv-empty">Generera gruppspel för att visa tabeller.</p>
              <div v-else class="tv-standings-grid">
                <article v-for="standing in standings.slice(0, 2)" :key="standing.group.id">
                  <h2>{{ standing.group.name }}</h2>
                  <table>
                    <thead><tr><th>#</th><th>Lag</th><th>S</th><th>V</th><th>F</th><th>P</th><th>Diff</th></tr></thead>
                    <tbody><tr v-for="row in standing.rows.slice(0, 4)" :key="row.participant_id"><td>{{ row.rank }}</td><td>{{ row.name }}</td><td>{{ row.played }}</td><td>{{ row.wins }}</td><td>{{ row.losses }}</td><td><strong>{{ row.points }}</strong></td><td>{{ row.diff > 0 ? '+' : '' }}{{ row.diff }}</td></tr></tbody>
                  </table>
                </article>
              </div>
            </section>

            <section class="tv-panel tv-bracket">
              <h2>Slutspel</h2>
              <p v-if="!knockoutRounds.length" class="tv-empty">Slutspel visas när bracket är genererad.</p>
              <div v-else class="tv-bracket-grid">
                <div v-for="round in knockoutRounds" :key="round.round" class="tv-bracket-round"><h3>{{ roundTitle(round) }}</h3><article v-for="match in round.matches" :key="match.id"><span>{{ match.side_a }}</span><span>{{ match.side_b }}</span></article></div>
              </div>
            </section>
          </div>
        </section>

        <section :class="['tv-slide', activeIndex === 2 && 'active']">
          <div class="tv-layout schedule-layout">
            <section class="tv-panel tv-schedule">
              <h2>Dagens schema</h2>
              <div class="tv-table schedule-table">
                <div class="tv-row tv-head"><span>Tid</span><span>Match</span><span>Grupp / omgång</span><span>Status</span></div>
                <div v-if="!scheduleMatches.length" class="tv-row"><span></span><strong>Inga matcher i schemat</strong><span></span><span></span></div>
                <template v-else><div v-for="match in scheduleMatches" :key="match.id" class="tv-row"><strong>{{ match.time_label }}</strong><span>{{ match.side_a }} <em>vs</em> {{ match.side_b }}</span><span>{{ match.group_name || match.stage_name || match.name }}</span><span>{{ statusLabel(match.status) }}</span></div></template>
              </div>
            </section>

            <section class="tv-panel"><h2>Senaste resultat</h2><div class="tv-table result-table"><div v-if="!recentMatches.length" class="tv-row"><strong>Inga resultat rapporterade ännu.</strong></div><template v-else><div v-for="match in recentMatches" :key="match.id" class="tv-row"><span>{{ match.time_label }}</span><strong>{{ match.side_a }} <em>vs</em> {{ match.side_b }}</strong><span>{{ match.score_label }}</span></div></template></div></section>
          </div>
        </section>
      </div>
    </template>
  `,
}).mount("#tv-stage");
}
