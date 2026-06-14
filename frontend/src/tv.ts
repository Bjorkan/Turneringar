{
const { createApp } = Vue;
const tournamentId = location.pathname.split("/").pop();
const slideSeconds = 10;

const eventText = {
  participant_added: "Deltagare tillagd",
  resource_added: "Resurs tillagd",
  settings_updated: "Inställningar uppdaterade",
  structure_generated: "Slutspel publicerat",
  bracket_seeded: "Slutspel seedat",
  schedule_updated: "Schema uppdaterat",
  result_updated: "Resultat rapporterat",
};

const api = async (path) => {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) throw new Error("Kunde inte läsa TV-data.");
  return response.json();
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value) => {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", year: "numeric" }).format(date) : value || "-";
};

const formatClock = (date) => new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(date);

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
      return [...new Set(knockout.map((match) => match.round))]
        .sort((a, b) => a - b)
        .map((round) => ({ round, matches: knockout.filter((match) => match.round === round) }));
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
    eventLabel(kind) {
      return eventText[kind] || kind;
    },
    roundTitle(round) {
      const first = round.matches[0];
      return first ? first.name.replace(/\s+\d+$/, "") : `Runda ${round.round}`;
    },
    async load() {
      try {
        const payload = await api(`/api/tournaments/${tournamentId}/tv`);
        document.title = `Live TV - ${payload.tournament.name}`;
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
      this.eventSource = new EventSource(`/api/events/${tournamentId}`);
      const refresh = () => {
        if (this.reloadTimer) return;
        this.reloadTimer = setTimeout(() => {
          this.reloadTimer = null;
          this.load();
        }, 800);
      };
      ["participant_added", "resource_added", "result_updated", "schedule_updated", "structure_generated", "bracket_seeded", "settings_updated"].forEach((eventName) => {
        this.eventSource.addEventListener(eventName, refresh);
      });
    },
  },
  template: `
    <section v-if="error" class="tv-slide active"><h1>{{ error.message }}</h1></section>
    <section v-else-if="!data" class="tv-slide active"><h1>Laddar Live TV...</h1></section>
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
                <div class="feature-match"><strong>{{ featuredMatch.side_a }}</strong><span>vs</span><strong>{{ featuredMatch.side_b }}</strong></div>
                <dl class="feature-facts">
                  <div><dt>Start</dt><dd>{{ featuredMatch.time_label }}</dd></div>
                  <div><dt>Plats</dt><dd>{{ featuredMatch.resource_name || 'Ej placerad' }}</dd></div>
                  <div><dt>Grupp</dt><dd>{{ featuredMatch.group_name || featuredMatch.stage_name || '-' }}</dd></div>
                </dl>
                <div class="feature-score"><small>Resultat</small><strong>{{ featuredMatch.score_label }}</strong></div>
              </template>
              <h1 v-else>Inga matcher publicerade</h1>
            </section>

            <section class="tv-panel">
              <h2>Härnäst</h2>
              <div class="tv-table">
                <div class="tv-row tv-head"><span>Tid</span><span>Match</span><span>Plats</span></div>
                <div v-if="!visibleUpcoming.length" class="tv-row"><span></span><strong>Inga kommande matcher</strong><span></span></div>
                <template v-else><div v-for="match in visibleUpcoming" :key="match.id" class="tv-row"><strong>{{ match.time_label }}</strong><span>{{ match.side_a }} <em>vs</em> {{ match.side_b }}</span><span>{{ match.resource_name || '-' }}</span></div></template>
              </div>
            </section>

            <section class="tv-info-card award"><small>Prisutdelning</small><strong>Efter final</strong><span>{{ tournament.name }}</span></section>
            <section class="tv-info-card"><small>Information</small><strong>Håll koll på uppdateringar</strong><span>Schema och resultat uppdateras automatiskt.</span></section>
            <section class="tv-panel tv-map">
              <h2>Hitta rätt i arenan</h2>
              <div class="arena-guide">
                <div class="arena-legend"><span v-if="!visibleResources.length">Inga platser ännu</span><template v-else><span v-for="(resource, index) in visibleResources" :key="resource.id"><i :class="'arena-color c' + (index + 1)"></i>{{ resource.name }}</span></template></div>
                <div class="arena-map" aria-hidden="true"><div v-for="(resource, index) in visibleResources" :key="resource.id" :class="'arena-zone c' + (index + 1)">{{ index + 1 }}</div></div>
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

            <section class="tv-panel tv-rules"><h2>Regler och avgörande</h2><h3>Poängsystem</h3><p>Vinst: 3 poäng</p><p>Oavgjort: 1 poäng</p><p>Förlust: 0 poäng</p><h3>Vid lika poäng</h3><ol><li>Inbördes möte</li><li>Differens</li><li>Flest gjorda mål</li><li>Lottning</li></ol></section>
          </div>
        </section>

        <section :class="['tv-slide', activeIndex === 2 && 'active']">
          <div class="tv-layout schedule-layout">
            <section class="tv-panel tv-schedule">
              <h2>Dagens schema</h2>
              <div class="tv-table schedule-table">
                <div class="tv-row tv-head"><span>Tid</span><span>Match</span><span>Grupp / omgång</span><span>Plats</span></div>
                <div v-if="!scheduleMatches.length" class="tv-row"><span></span><strong>Inga matcher i schemat</strong><span></span><span></span></div>
                <template v-else><div v-for="match in scheduleMatches" :key="match.id" class="tv-row"><strong>{{ match.time_label }}</strong><span>{{ match.side_a }} <em>vs</em> {{ match.side_b }}</span><span>{{ match.group_name || match.stage_name || match.name }}</span><span>{{ match.resource_name || '-' }}</span></div></template>
              </div>
            </section>

            <section class="tv-panel"><h2>Senaste resultat</h2><div class="tv-table result-table"><div v-if="!recentMatches.length" class="tv-row"><strong>Inga resultat rapporterade ännu.</strong></div><template v-else><div v-for="match in recentMatches" :key="match.id" class="tv-row"><span>{{ match.time_label }}</span><strong>{{ match.side_a }} <em>vs</em> {{ match.side_b }}</strong><span>{{ match.score_label }}</span></div></template></div></section>
            <section class="tv-panel"><h2>Notiser</h2><div class="tv-notices"><article v-for="event in events.slice(0, 4)" :key="event.id"><span class="notice-dot"></span><div><strong>{{ eventLabel(event.kind) }}</strong><small>{{ formatClock(parseDate(event.created_at) || new Date()) }}</small></div></article><article><span class="notice-dot purple"></span><div><strong>Nästa publicering</strong><small>Automatisk uppdatering om ca {{ slideSeconds }} sekunder.</small></div></article></div></section>
          </div>
        </section>
      </div>
    </template>
  `,
}).mount("#tv-stage");
}
