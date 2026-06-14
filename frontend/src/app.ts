{
const { createApp } = Vue;

type ApiBody = BodyInit | Record<string, unknown> | null;
type ApiOptions = Omit<RequestInit, "body"> & { body?: ApiBody };
type DateValue = string | number | Date | null | undefined;

const navItems = [
  ["Översikt", "home"],
  ["Turneringar", "cup"],
  ["Matcher", "calendar"],
  ["Deltagare", "users"],
  ["Schema", "schedule"],
  ["Slutspel", "bracket"],
  ["Live TV", "tv"],
  ["Moderatorer", "shield"],
  ["Inställningar", "settings"],
];

const statusText = {
  pending: "Planerad",
  scheduled: "Planerad",
  in_progress: "Pågår",
  paused: "Paus",
  completed: "Avslutad",
  ready: "Redo",
  draft: "Utkast",
};

const eventText = {
  participant_added: "Deltagare tillagd",
  resource_added: "Resurs tillagd",
  settings_updated: "Inställningar uppdaterade",
  structure_generated: "Slutspel publicerat",
  bracket_seeded: "Slutspel seedat",
  schedule_updated: "Schema uppdaterat",
  result_updated: "Resultat rapporterat",
};

const api = async (path: string, options: ApiOptions = {}) => {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) throw new Error(payload.detail || "Något gick fel.");
  return payload;
};

const formPayload = (form: HTMLFormElement) => {
  const payload: Record<string, FormDataEntryValue> = {};
  for (const [key, value] of new FormData(form).entries()) payload[key] = value;
  return payload;
};

const parseDate = (value: DateValue) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const defaultDateFormat: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

const formatDate = (value: DateValue, options: Intl.DateTimeFormatOptions = defaultDateFormat) => {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("sv-SE", options).format(date) : value || "-";
};

const formatTime = (value) => {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(date) : "-";
};

const sortBySchedule = (matches) =>
  [...matches].sort((a, b) => {
    if (!a.scheduled_at && !b.scheduled_at) return a.id - b.id;
    if (!a.scheduled_at) return 1;
    if (!b.scheduled_at) return -1;
    return a.scheduled_at.localeCompare(b.scheduled_at) || a.id - b.id;
  });

const statusTone = (status) => {
  if (status === "completed") return "done";
  if (status === "in_progress") return "success";
  if (status === "paused") return "warning";
  if (status === "pending" || status === "scheduled") return "info";
  return "neutral";
};

const initials = (name) =>
  String(name || "T")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => (part[0] || "").toUpperCase())
    .join("") || "T";

const NoticeBox = {
  props: ["notice"],
  emits: ["clear"],
  template: `
    <p v-if="notice" :class="['notice', notice.type || 'success']" :role="notice.type === 'danger' ? 'alert' : 'status'">
      {{ notice.message }}
      <button class="notice-close" type="button" aria-label="Stäng meddelande" @click="$emit('clear')">Stäng</button>
    </p>
  `,
};

const StatusBadge = {
  props: ["status"],
  computed: {
    tone() {
      return statusTone(this.status);
    },
    label() {
      return statusText[this.status] || this.status || "Okänd";
    },
  },
  template: `<span :class="['status-badge', tone]">{{ label }}</span>`,
};

const LoginView = {
  components: { NoticeBox },
  props: ["notice"],
  emits: ["login", "clear"],
  template: `
    <main class="page guest-page">
      <notice-box :notice="notice" @clear="$emit('clear')" />
      <section class="login-panel panel narrow">
        <div class="login-mark">T</div>
        <p class="eyebrow">Lokal eventserver</p>
        <h1>Logga in</h1>
        <form class="stack" @submit.prevent="$emit('login', $event)">
          <label>PIN <input name="pin" type="password" autofocus required></label>
          <button type="submit">Logga in</button>
        </form>
      </section>
    </main>
  `,
};

const AdminShell = {
  components: { NoticeBox },
  props: ["active", "tournamentId", "notice"],
  emits: ["navigate", "logout", "notice", "clear"],
  data() {
    return { navItems, compact: false };
  },
  methods: {
    hrefFor(label) {
      if (!this.tournamentId) return "/admin";
      if (label === "Översikt") return `/tournaments/${this.tournamentId}`;
      if (label === "Live TV") return `/tv/${this.tournamentId}`;
      return `#${label.toLowerCase().replace(" ", "-")}`;
    },
    isActive(label) {
      return label === this.active || (!this.tournamentId && label === "Turneringar");
    },
    follow(event, label) {
      const href = this.hrefFor(label);
      if (href.startsWith("/") && label !== "Live TV") {
        event.preventDefault();
        this.$emit("navigate", href);
      }
    },
  },
  template: `
    <div :class="['admin-shell', compact && 'menu-collapsed']">
      <aside class="sidebar">
        <a class="brand" href="/admin" @click.prevent="$emit('navigate', '/admin')">
          <span class="brand-mark" aria-hidden="true">T</span>
          <span>Turneringar</span>
        </a>
        <nav class="side-nav">
          <a v-for="item in navItems" :key="item[0]" :href="hrefFor(item[0])" :class="{ active: isActive(item[0]) }" @click="follow($event, item[0])">
            <span :class="['nav-icon', item[1]]" aria-hidden="true"></span>
            <span>{{ item[0] }}</span>
          </a>
        </nav>
        <button class="link-button" type="button" @click="$emit('logout')">Logga ut</button>
        <button class="side-collapse" type="button" @click="compact = !compact">{{ compact ? 'Visa meny' : 'Minimera' }}</button>
      </aside>

      <div class="workspace">
        <header class="topbar">
          <button class="icon-button menu-button" type="button" :aria-label="compact ? 'Visa meny' : 'Minimera meny'" @click="compact = !compact">☰</button>
          <label class="global-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" placeholder="Sök turneringar, matcher, deltagare..." @keydown.enter.prevent="$emit('notice', 'Sökfältet filtrerar listor i respektive vy.')" />
            <kbd>⌘ K</kbd>
          </label>
          <div class="top-actions">
            <button class="icon-button" type="button" aria-label="Notiser" @click="$emit('notice', 'Inga nya systemnotiser.')">!</button>
            <div class="user-chip" aria-label="Inloggad användare">
              <span>AD</span>
              <strong>Admin</strong>
              <small>Lokal session</small>
            </div>
          </div>
        </header>
        <main class="page" aria-live="polite">
          <notice-box :notice="notice" @clear="$emit('clear')" />
          <slot></slot>
        </main>
      </div>
    </div>
  `,
};

const AdminHome = {
  components: { StatusBadge },
  emits: ["navigate", "notice", "error"],
  data() {
    return { tournaments: [], loading: true, query: "", sortNewestFirst: true };
  },
  computed: {
    participantTotal() {
      return this.tournaments.reduce((sum, tournament) => sum + tournament.participant_count, 0);
    },
    matchTotal() {
      return this.tournaments.reduce((sum, tournament) => sum + tournament.match_count, 0);
    },
    visibleTournaments() {
      const normalized = this.query.trim().toLowerCase();
      const filtered = normalized ? this.tournaments.filter((tournament) => tournament.name.toLowerCase().includes(normalized)) : this.tournaments;
      return [...filtered].sort((a, b) => {
        const result = String(a.created_at || "").localeCompare(String(b.created_at || ""));
        return this.sortNewestFirst ? -result : result;
      });
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    initials,
    formatDate,
    async load() {
      this.loading = true;
      try {
        const payload = await api("/api/tournaments");
        this.tournaments = payload.tournaments || [];
      } catch (error) {
        this.$emit("error", error);
      } finally {
        this.loading = false;
      }
    },
    async createTournament(event) {
      try {
        const result = await api("/api/tournaments", { method: "POST", body: formPayload(event.currentTarget) });
        this.$emit("notice", "Turnering skapad.");
        this.$emit("navigate", `/tournaments/${result.id}`);
      } catch (error) {
        this.$emit("error", error);
      }
    },
  },
  template: `
      <section class="page-head">
        <div>
          <p class="eyebrow">Alla turneringar</p>
          <h1>Turneringar</h1>
          <p>{{ tournaments.length }} turneringar · {{ participantTotal }} deltagare · {{ matchTotal }} matcher</p>
        </div>
        <a class="button primary" href="#create-tournament">Skapa turnering</a>
      </section>

      <section class="admin-overview">
        <div class="tournament-column">
          <div class="toolbar">
            <label class="search-field"><span>⌕</span><input v-model="query" type="search" placeholder="Sök i listan..."></label>
            <button class="button subtle" type="button" @click="sortNewestFirst = !sortNewestFirst">{{ sortNewestFirst ? 'Senaste först' : 'Äldsta först' }}</button>
            <button class="button subtle" type="button" @click="query = ''">Rensa filter</button>
          </div>
          <div class="tournament-list">
            <p v-if="loading" class="empty">Laddar turneringar...</p>
            <p v-else-if="!visibleTournaments.length" class="empty">Inga turneringar matchar filtret.</p>
            <template v-else>
              <article v-for="(tournament, index) in visibleTournaments" :key="tournament.id" :class="['tournament-card', index === 0 && 'selected']">
                <div :class="'card-symbol tone-' + ((index % 5) + 1)" aria-hidden="true">{{ initials(tournament.name) }}</div>
                <div>
                  <h2><a :href="'/tournaments/' + tournament.id" @click.prevent="$emit('navigate', '/tournaments/' + tournament.id)">{{ tournament.name }}</a></h2>
                  <p>{{ formatDate(tournament.starts_at) }}</p>
                  <p>{{ tournament.participant_count }} deltagare · {{ tournament.resource_count }} resurser · {{ tournament.match_count }} matcher</p>
                </div>
                <status-badge :status="tournament.status" />
                <a class="icon-link" :href="'/tv/' + tournament.id" aria-label="Öppna Live TV">TV</a>
              </article>
            </template>
          </div>
        </div>

        <aside class="side-stack">
          <section class="panel">
            <h2>Ny turnering</h2>
            <form id="create-tournament" class="stack" @submit.prevent="createTournament">
              <label>Namn <input name="name" required placeholder="Sommarcupen"></label>
              <label>Start <input name="starts_at" type="datetime-local"></label>
              <div class="form-grid two">
                <label>Grupper <input name="group_count" type="number" min="1" value="2"></label>
                <label>Vidare/grupp <input name="qualifiers_per_group" type="number" min="1" value="2"></label>
              </div>
              <button type="submit">Skapa</button>
            </form>
          </section>

          <section class="panel">
            <h2>Överblick</h2>
            <div class="side-metrics">
              <div><span>{{ tournaments.length }}</span><small>Turneringar</small></div>
              <div><span>{{ participantTotal }}</span><small>Deltagare</small></div>
              <div><span>{{ matchTotal }}</span><small>Matcher</small></div>
            </div>
          </section>
        </aside>
      </section>
  `,
};

const TournamentView = {
  components: { StatusBadge },
  props: ["id"],
  emits: ["notice", "error"],
  data() {
    return { data: null, loading: true, eventSource: null, eventText };
  },
  computed: {
    tournament() {
      return this.data && this.data.tournament;
    },
    participants() {
      return this.data ? this.data.participants || [] : [];
    },
    resources() {
      return this.data ? this.data.resources || [] : [];
    },
    standings() {
      return this.data ? this.data.standings || [] : [];
    },
    matches() {
      return this.data ? this.data.matches || [] : [];
    },
    sortedMatches() {
      return sortBySchedule(this.matches);
    },
    completedMatches() {
      return this.matches.filter((match) => match.status === "completed");
    },
    openMatches() {
      return this.matches.filter((match) => match.status !== "completed");
    },
    currentMatches() {
      return this.data ? this.data.current_matches || [] : [];
    },
    upcomingMatches() {
      return this.data ? this.data.upcoming_matches || [] : [];
    },
    moderators() {
      return this.data ? this.data.moderators || [] : [];
    },
    events() {
      return this.data ? this.data.events || [] : [];
    },
    knockoutRounds() {
      const knockout = this.matches.filter((match) => match.stage_kind === "knockout");
      return [...new Set(knockout.map((match) => Number(match.round)))]
        .sort((a, b) => a - b)
        .map((round) => ({ round, matches: knockout.filter((match) => Number(match.round) === round) }));
    },
  },
  watch: {
    id() {
      this.load();
      this.subscribe();
    },
  },
  mounted() {
    this.load();
    this.subscribe();
  },
  beforeUnmount() {
    if (this.eventSource) this.eventSource.close();
  },
  methods: {
    formatDate,
    formatTime,
    statusTone,
    roundTitle(round) {
      const first = round.matches[0];
      return first ? first.name.replace(/\s+\d+$/, "") : `Runda ${round.round}`;
    },
    async load() {
      this.loading = true;
      try {
        this.data = await api(`/api/tournaments/${this.id}`);
      } catch (error) {
        this.$emit("error", error);
      } finally {
        this.loading = false;
      }
    },
    subscribe() {
      if (this.eventSource) this.eventSource.close();
      this.eventSource = new EventSource(`/api/events/${this.id}`);
      ["participant_added", "resource_added", "result_updated", "schedule_updated", "structure_generated", "bracket_seeded", "settings_updated"].forEach((eventName) => {
        this.eventSource.addEventListener(eventName, () => this.load());
      });
    },
    async submitForm(path, method, form, message, reset = true) {
      try {
        await api(path, { method, body: formPayload(form) });
        if (reset) form.reset();
        this.$emit("notice", message);
        await this.load();
      } catch (error) {
        this.$emit("error", error);
      }
    },
    async postAction(path, message) {
      try {
        await api(path, { method: "POST", body: {} });
        this.$emit("notice", message);
        await this.load();
      } catch (error) {
        this.$emit("error", error);
      }
    },
  },
  template: `
    <section v-if="loading && !data" class="panel">Laddar turnering...</section>
    <section v-else-if="!data" class="panel">Kunde inte läsa turneringen.</section>
    <template v-else>
      <section class="page-head tournament-title" :data-tournament-id="tournament.id">
        <div>
          <p class="eyebrow">Översikt</p>
          <h1>{{ tournament.name }}</h1>
          <p>{{ formatDate(tournament.starts_at) }} · {{ resources.length }} platser · {{ participants.length }} lag / deltagare</p>
        </div>
        <div class="actions">
          <a class="button subtle" href="#inställningar">Hantera turnering</a>
          <a class="button primary" :href="'/tv/' + tournament.id">Öppna Live TV</a>
        </div>
      </section>

      <section class="metric-grid">
        <article class="metric-card blue"><span aria-hidden="true"></span><div><small>Totalt deltagare</small><strong>{{ participants.length }}</strong><p>{{ Math.ceil(participants.length / Math.max(tournament.group_count, 1)) || 0 }} per grupp</p></div></article>
        <article class="metric-card green"><span aria-hidden="true"></span><div><small>Aktiva matcher</small><strong>{{ currentMatches.length }}</strong><p>Pågår nu</p></div></article>
        <article class="metric-card amber"><span aria-hidden="true"></span><div><small>Kommande matcher</small><strong>{{ upcomingMatches.length }}</strong><p>Schemalagda</p></div></article>
        <article class="metric-card purple"><span aria-hidden="true"></span><div><small>Avslutade</small><strong>{{ completedMatches.length }}</strong><p>{{ matches.length }} totalt</p></div></article>
      </section>

      <section class="dashboard-layout">
        <div class="dashboard-main">
          <section class="panel" id="matcher">
            <div class="panel-head">
              <div><h2>Aktuella och kommande matcher</h2><p>{{ openMatches.length }} öppna · {{ completedMatches.length }} avslutade</p></div>
              <a href="#alla-matcher">Se alla matcher</a>
            </div>
            <table class="admin-table compact-table">
              <thead><tr><th>Match</th><th>Grupp / omgång</th><th>Tid</th><th>Status</th><th>Plats</th></tr></thead>
              <tbody>
                <tr v-if="!sortedMatches.length"><td colspan="5">Inga matcher är schemalagda ännu.</td></tr>
                <template v-else>
                  <tr v-for="match in sortedMatches.slice(0, 6)" :key="match.id">
                    <td><span :class="['row-dot', statusTone(match.status)]"></span><strong>{{ match.side_a }}</strong><span class="vs">vs</span><strong>{{ match.side_b }}</strong></td>
                    <td>{{ match.group_name || match.stage_name || match.name }}</td>
                    <td>{{ match.time_label }}</td>
                    <td><status-badge :status="match.status" /></td>
                    <td>{{ match.resource_name || '-' }}</td>
                  </tr>
                </template>
              </tbody>
            </table>
          </section>

          <section class="split-panels">
            <section class="panel" id="slutspel">
              <div class="panel-head"><h2>Slutspel - översikt</h2></div>
              <p v-if="!knockoutRounds.length" class="empty">Generera slutspel för att se bracket.</p>
              <div v-else class="bracket-preview">
                <div v-for="round in knockoutRounds" :key="round.round" class="bracket-round">
                  <h3>{{ roundTitle(round) }}</h3>
                  <article v-for="match in round.matches" :key="match.id"><span>{{ match.side_a }}</span><span>{{ match.side_b }}</span></article>
                </div>
              </div>
            </section>

            <section class="panel" id="tabeller">
              <div class="panel-head"><h2>{{ standings[0] ? standings[0].group.name : 'Tabell' }}</h2></div>
              <p v-if="!standings[0]" class="empty">Generera gruppspel för att se tabeller.</p>
              <table v-else class="admin-table compact-table">
                <thead><tr><th>#</th><th>Lag</th><th>S</th><th>V</th><th>O</th><th>F</th><th>GM</th><th>IM</th><th>P</th></tr></thead>
                <tbody>
                  <tr v-for="row in standings[0].rows" :key="row.participant_id"><td>{{ row.rank }}</td><td><strong>{{ row.name }}</strong></td><td>{{ row.played }}</td><td>{{ row.wins }}</td><td>{{ row.draws }}</td><td>{{ row.losses }}</td><td>{{ row.scored }}</td><td>{{ row.conceded }}</td><td><strong>{{ row.points }}</strong></td></tr>
                </tbody>
              </table>
            </section>
          </section>

          <section class="split-panels">
            <section class="panel" id="deltagare">
              <div class="panel-head"><h2>Deltagare</h2><span class="count-pill">{{ participants.length }}</span></div>
              <form class="inline-form" @submit.prevent="submitForm('/api/tournaments/' + id + '/participants', 'POST', $event.currentTarget, 'Deltagare tillagd.')">
                <input name="name" required placeholder="Lag eller spelare">
                <select name="kind"><option value="team">Lag</option><option value="player">Spelare</option></select>
                <input name="seed" type="number" min="1" placeholder="Seed">
                <button type="submit">Lägg till</button>
              </form>
              <table class="admin-table compact-table"><thead><tr><th>Seed</th><th>Namn</th><th>Typ</th></tr></thead><tbody><tr v-if="!participants.length"><td colspan="3">Inga deltagare.</td></tr><template v-else><tr v-for="participant in participants" :key="participant.id"><td>{{ participant.seed || '-' }}</td><td><strong>{{ participant.name }}</strong></td><td>{{ participant.kind }}</td></tr></template></tbody></table>
            </section>

            <section class="panel" id="schema">
              <div class="panel-head"><h2>Spelplaner / servrar</h2><span class="count-pill">{{ resources.length }}</span></div>
              <form class="inline-form" @submit.prevent="submitForm('/api/tournaments/' + id + '/resources', 'POST', $event.currentTarget, 'Resurs tillagd.')">
                <input name="name" required placeholder="Plan 1">
                <select name="kind"><option value="court">Spelplan</option><option value="server">Server</option><option value="table">Bord</option></select>
                <button type="submit">Lägg till</button>
              </form>
              <table class="admin-table compact-table"><thead><tr><th>Namn</th><th>Typ</th><th>Status</th></tr></thead><tbody><tr v-if="!resources.length"><td colspan="3">Inga resurser.</td></tr><template v-else><tr v-for="resource in resources" :key="resource.id"><td><strong>{{ resource.name }}</strong></td><td>{{ resource.kind }}</td><td>{{ resource.active ? 'Aktiv' : 'Pausad' }}</td></tr></template></tbody></table>
            </section>
          </section>

          <section class="panel" id="alla-matcher">
            <div class="panel-head"><h2>Alla matcher</h2><span class="count-pill">{{ matches.length }}</span></div>
            <table class="matches admin-table">
              <thead><tr><th>Match</th><th>Deltagare</th><th>Tid och plats</th><th>Status</th><th>Resultat</th><th>Åtgärder</th></tr></thead>
              <tbody>
                <tr v-if="!sortedMatches.length"><td colspan="6">Inga matcher ännu.</td></tr>
                <template v-else>
                  <tr v-for="match in sortedMatches" :key="match.id">
                    <td><strong>{{ match.name }}</strong><small>{{ match.stage_name }}{{ match.group_name ? ' · ' + match.group_name : '' }}</small></td>
                    <td><strong>{{ match.side_a }}</strong><span class="vs">vs</span><strong>{{ match.side_b }}</strong></td>
                    <td><span>{{ match.time_label }}</span><small>{{ match.resource_name || 'Ej placerad' }}</small></td>
                    <td><status-badge :status="match.status" /></td>
                    <td><strong>{{ match.score_label }}</strong></td>
                    <td>
                      <details class="row-actions">
                        <summary>Ändra</summary>
                        <form class="tiny-form slot-form" @submit.prevent="submitForm('/api/tournaments/' + id + '/matches/' + match.id + '/slot', 'PATCH', $event.currentTarget, 'Match flyttad.')">
                          <input name="scheduled_at" type="datetime-local" :value="match.scheduled_at || tournament.starts_at" required>
                          <select name="resource_id" :value="match.resource_id || ''" required><option value="" disabled>Välj plats</option><option v-for="resource in resources" :key="resource.id" :value="resource.id">{{ resource.name }}</option></select>
                          <input name="duration_minutes" type="number" min="1" :value="match.duration_minutes">
                          <button type="submit">Spara tid</button>
                        </form>
                        <form class="score-form result-form" @submit.prevent="submitForm('/api/tournaments/' + id + '/matches/' + match.id + '/result', 'POST', $event.currentTarget, 'Resultat sparat.')">
                          <input name="score_a" type="number" :value="match.score_a == null ? '' : match.score_a" aria-label="Poäng A">
                          <input name="score_b" type="number" :value="match.score_b == null ? '' : match.score_b" aria-label="Poäng B">
                          <button type="submit">Spara resultat</button>
                        </form>
                      </details>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </section>
        </div>

        <aside class="dashboard-side">
          <section class="panel quick-panel">
            <h2>Snabbåtgärder</h2>
            <button class="button ghost" type="button" @click="postAction('/api/tournaments/' + id + '/generate', 'Bracket skapad.')">Generera gruppspel och slutspel</button>
            <button class="button ghost" type="button" @click="postAction('/api/tournaments/' + id + '/schedule', 'Schema uppdaterat.')">Autoschemalägg matcher</button>
            <a class="button ghost" :href="'/tv/' + tournament.id">Öppna Live TV</a>
          </section>

          <section class="panel" id="inställningar">
            <h2>Inställningar</h2>
            <form class="stack" @submit.prevent="submitForm('/api/tournaments/' + id + '/settings', 'PATCH', $event.currentTarget, 'Inställningar sparade.', false)">
              <label>Start <input name="starts_at" type="datetime-local" :value="tournament.starts_at"></label>
              <div class="form-grid two"><label>Matchminuter <input name="match_minutes" type="number" min="1" :value="tournament.match_minutes"></label><label>Vila minuter <input name="break_minutes" type="number" min="0" :value="tournament.break_minutes"></label></div>
              <div class="form-grid two"><label>Grupper <input name="group_count" type="number" min="1" :value="tournament.group_count"></label><label>Vidare/grupp <input name="qualifiers_per_group" type="number" min="1" :value="tournament.qualifiers_per_group"></label></div>
              <button type="submit">Spara</button>
            </form>
          </section>

          <section class="panel" id="moderatorer">
            <h2>Moderatorer</h2>
            <form class="stack" @submit.prevent="submitForm('/api/tournaments/' + id + '/moderators', 'POST', $event.currentTarget, 'Moderatorlänk skapad.')">
              <label>Etikett <input name="label" required placeholder="Moderator plan 1"></label>
              <label>Scope <select name="resource_id"><option value="">Alla resurser</option><option v-for="resource in resources" :key="resource.id" :value="resource.id">{{ resource.name }}</option></select></label>
              <button type="submit">Skapa länk</button>
            </form>
            <div class="mini-list"><p v-if="!moderators.length" class="empty">Inga moderatorer ännu.</p><template v-else><article v-for="moderator in moderators" :key="moderator.id"><div><strong>{{ moderator.label }}</strong><small>{{ moderator.resource_name || 'Alla resurser' }} · PIN {{ moderator.pin }}</small></div><a :href="'/m/' + moderator.token">Öppna</a></article></template></div>
          </section>

          <section class="panel">
            <h2>Senaste aktivitet</h2>
            <div class="activity-list">
              <article><span class="activity-icon green"></span><div><strong>{{ participants.length }} deltagare registrerade</strong><small>Aktuell deltagarlista</small></div></article>
              <p v-if="!events.length" class="empty">Inga händelser ännu.</p>
              <template v-else><article v-for="event in events.slice(0, 6)" :key="event.id"><span class="activity-icon blue"></span><div><strong>{{ eventText[event.kind] || event.kind }}</strong><small>{{ formatTime(event.created_at) }}</small></div></article></template>
            </div>
          </section>
        </aside>
      </section>
    </template>
  `,
};

const ModeratorView = {
  components: { NoticeBox },
  props: ["token", "notice"],
  emits: ["notice", "error", "clear"],
  data() {
    return { data: null, eventSource: null };
  },
  mounted() {
    this.load();
  },
  beforeUnmount() {
    if (this.eventSource) this.eventSource.close();
  },
  methods: {
    async load() {
      try {
        this.data = await api(`/api/moderators/${this.token}`);
        this.subscribe();
      } catch (error) {
        this.$emit("error", error);
      }
    },
    subscribe() {
      if (!this.data || !this.data.authorized) return;
      if (this.eventSource) this.eventSource.close();
      this.eventSource = new EventSource(`/api/events/${this.data.moderator.tournament_id}`);
      ["result_updated", "schedule_updated", "structure_generated", "bracket_seeded", "settings_updated"].forEach((eventName) => {
        this.eventSource.addEventListener(eventName, () => this.load());
      });
    },
    async login(event) {
      try {
        await api(`/api/moderators/${this.token}/login`, { method: "POST", body: formPayload(event.currentTarget) });
        this.$emit("notice", "Moderator öppnad.");
        await this.load();
      } catch (error) {
        this.$emit("error", error);
      }
    },
    async saveResult(event, matchId) {
      try {
        await api(`/api/moderators/${this.token}/matches/${matchId}/result`, { method: "POST", body: formPayload(event.currentTarget) });
        this.$emit("notice", "Resultat sparat.");
        await this.load();
      } catch (error) {
        this.$emit("error", error);
      }
    },
  },
  template: `
    <main class="page moderator-page">
      <notice-box :notice="notice" @clear="$emit('clear')" />
      <section v-if="!data" class="panel">Laddar moderatorvy...</section>
      <template v-else>
        <section class="page-head" :data-tournament-id="data.moderator.tournament_id"><div><p class="eyebrow">Moderator</p><h1>{{ data.moderator.label }}</h1><p>{{ data.moderator.tournament_name }} · {{ data.moderator.resource_name || 'Alla resurser' }}</p></div></section>
        <section v-if="data.authorized" class="panel">
          <div class="panel-head"><h2>Rapportera resultat</h2><span class="count-pill">{{ data.matches.length }}</span></div>
          <table class="admin-table">
            <thead><tr><th>Tid</th><th>Resurs</th><th>Match</th><th>Resultat</th></tr></thead>
            <tbody>
              <tr v-if="!data.matches.length"><td colspan="4">Inga öppna matcher i ditt scope.</td></tr>
              <template v-else>
                <tr v-for="match in data.matches" :key="match.id">
                  <td>{{ match.time_label }}</td><td>{{ match.resource_name || '-' }}</td><td><strong>{{ match.side_a }}</strong><span class="vs">vs</span><strong>{{ match.side_b }}</strong></td>
                  <td><form class="score-form moderator-result-form" @submit.prevent="saveResult($event, match.id)"><input name="score_a" type="number" required aria-label="Poäng A"><input name="score_b" type="number" required aria-label="Poäng B"><button type="submit">Spara</button></form></td>
                </tr>
              </template>
            </tbody>
          </table>
        </section>
        <section v-else class="panel narrow"><h2>Moderator-PIN</h2><form class="stack" @submit.prevent="login"><label>PIN <input name="pin" type="password" required autofocus></label><button type="submit">Öppna</button></form></section>
      </template>
    </main>
  `,
};

createApp({
  components: { AdminShell, AdminHome, LoginView, ModeratorView, NoticeBox, StatusBadge, TournamentView },
  data() {
    return { session: null, route: location.pathname, notice: null };
  },
  computed: {
    tournamentId() {
      return this.route.startsWith("/tournaments/") ? this.route.split("/")[2] : null;
    },
    activeNav() {
      return this.tournamentId ? "Översikt" : "Turneringar";
    },
  },
  watch: {
    session: {
      immediate: true,
      handler() {
        document.body.className = this.session && this.session.is_admin ? "is-authenticated" : "is-guest";
      },
    },
  },
  mounted() {
    this.refreshSession();
    window.addEventListener("popstate", this.onPopState);
  },
  beforeUnmount() {
    window.removeEventListener("popstate", this.onPopState);
  },
  methods: {
    onPopState() {
      this.route = location.pathname;
    },
    async refreshSession() {
      try {
        this.session = await api("/api/session");
      } catch (error) {
        this.showError(error);
      }
    },
    navigate(path) {
      if (path === location.pathname) return;
      history.pushState({}, "", path);
      this.route = path;
      this.notice = null;
    },
    showNotice(message, type = "success") {
      this.notice = { message, type };
    },
    showError(error) {
      this.notice = { message: error.message || String(error), type: "danger" };
    },
    clearNotice() {
      this.notice = null;
    },
    async login(event) {
      try {
        await api("/api/admin/login", { method: "POST", body: formPayload(event.currentTarget) });
        await this.refreshSession();
        this.navigate("/admin");
      } catch (error) {
        this.showError(error);
      }
    },
    async logout() {
      try {
        await api("/api/admin/logout", { method: "POST" });
        await this.refreshSession();
        this.navigate("/");
      } catch (error) {
        this.showError(error);
      }
    },
  },
  template: `
    <section v-if="!session" class="page guest-page"><section class="panel narrow">Laddar...</section></section>
    <moderator-view v-else-if="route.startsWith('/m/')" :token="route.split('/')[2]" :notice="notice" @notice="showNotice" @error="showError" @clear="clearNotice" />
    <login-view v-else-if="!session.is_admin" :notice="notice" @login="login" @clear="clearNotice" />
    <admin-shell v-else :active="activeNav" :tournament-id="tournamentId" :notice="notice" @navigate="navigate" @logout="logout" @notice="showNotice" @clear="clearNotice">
      <tournament-view v-if="tournamentId" :id="tournamentId" @notice="showNotice" @error="showError" />
      <admin-home v-else @navigate="navigate" @notice="showNotice" @error="showError" />
    </admin-shell>
  `,
}).mount("#app");
}
