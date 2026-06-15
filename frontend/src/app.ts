{
const { createApp } = Vue;

type ApiBody = BodyInit | Record<string, unknown> | null;
type ApiOptions = Omit<RequestInit, "body"> & { body?: ApiBody };
type DateValue = string | number | Date | null | undefined;

type NavItem = {
  label: string;
  glyph: string;
  tournamentOnly?: boolean;
  external?: boolean;
};

const navItems: NavItem[] = [
  { label: "Turneringar", glyph: "T" },
  { label: "Live TV", glyph: "TV" },
  { label: "Översikt", glyph: "Ö", tournamentOnly: true },
  { label: "Matcher", glyph: "M", tournamentOnly: true },
  { label: "Deltagare", glyph: "D", tournamentOnly: true },
  { label: "Schema", glyph: "S", tournamentOnly: true },
  { label: "Slutspel", glyph: "SL", tournamentOnly: true },
  { label: "Moderatorer", glyph: "MO", tournamentOnly: true },
  { label: "Inställningar", glyph: "IN", tournamentOnly: true },
];

const sectionTargets: Record<string, string> = {
  Matcher: "#matcher",
  Deltagare: "#deltagare",
  Schema: "#schema",
  Slutspel: "#slutspel",
  Moderatorer: "#moderatorer",
  Inställningar: "#inställningar",
};

const sectionLabels: Record<string, string> = {
  "#översikt": "Översikt",
  "#matcher": "Matcher",
  "#alla-matcher": "Matcher",
  "#deltagare": "Deltagare",
  "#schema": "Schema",
  "#slutspel": "Slutspel",
  "#moderatorer": "Moderatorer",
  "#inställningar": "Inställningar",
};

const normalizedHash = () => {
  try {
    return decodeURIComponent(window.location.hash || "");
  } catch {
    return window.location.hash || "";
  }
};

const tournamentSectionFromHash = () => {
  const hash = normalizedHash() || "#översikt";
  if (hash === "#alla-matcher") return "matcher";
  return hash.replace("#", "") || "översikt";
};

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
  score_updated: "Livepoäng uppdaterad",
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

const participantKindText = (kind) => (kind === "player" ? "Spelare" : "Lag");

const resourceKindText = (kind) => {
  if (kind === "server") return "Server";
  if (kind === "table") return "Bord";
  return "Spelplan";
};

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
    return { navItems, compact: window.matchMedia("(max-width: 900px)").matches };
  },
  computed: {
    visibleNavItems() {
      return this.tournamentId ? navItems : navItems.filter((item) => !item.tournamentOnly);
    },
  },
  methods: {
    hrefFor(item) {
      const label = item.label;
      if (label === "Turneringar") return "/admin";
      if (label === "Live TV") return "/admin/tv";
      if (!this.tournamentId) return "/admin";
      if (label === "Översikt") return "#översikt";
      return sectionTargets[label] || `/tournaments/${this.tournamentId}`;
    },
    isActive(item) {
      return item.label === this.active;
    },
    follow(event, item) {
      const href = this.hrefFor(item);
      if (href.startsWith("/") && !item.external) {
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
          <a v-for="item in visibleNavItems" :key="item.label" :href="hrefFor(item)" :class="{ active: isActive(item) }" @click="follow($event, item)">
            <span class="nav-glyph" aria-hidden="true">{{ item.glyph }}</span>
            <span>{{ item.label }}</span>
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
                <div class="tournament-card-main">
                  <h2><a :href="'/tournaments/' + tournament.id" @click.prevent="$emit('navigate', '/tournaments/' + tournament.id)">{{ tournament.name }}</a></h2>
                  <p>{{ formatDate(tournament.starts_at) }}</p>
                  <div class="tournament-stats">
                    <span><strong>{{ tournament.participant_count }}</strong><small>Deltagare</small></span>
                    <span><strong>{{ tournament.resource_count }}</strong><small>Platser</small></span>
                    <span><strong>{{ tournament.match_count }}</strong><small>Matcher</small></span>
                  </div>
                </div>
                <div class="tournament-actions">
                  <status-badge :status="tournament.status" />
                  <a class="button subtle" :href="'/tournaments/' + tournament.id" @click.prevent="$emit('navigate', '/tournaments/' + tournament.id)">Öppna</a>
                  <a class="icon-link" href="/admin/tv" aria-label="Hantera Live TV" @click.prevent="$emit('navigate', '/admin/tv')">TV</a>
                </div>
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
              <div><span>{{ visibleTournaments.length }}</span><small>Visade</small></div>
            </div>
          </section>
        </aside>
      </section>
  `,
};

const LiveTvAdmin = {
  components: { StatusBadge },
  emits: ["notice", "error"],
  data() {
    return { loading: true, tvLinks: [], tournaments: [], resources: [], drafts: {} };
  },
  computed: {
    boundCount() {
      return this.tvLinks.filter((link) => link.tournament_id).length;
    },
    waitingCount() {
      return this.tvLinks.length - this.boundCount;
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    formatDate,
    resourceKindText,
    tvUrl(link) {
      return `${location.origin}/tv/${link.code}`;
    },
    bindingLabel(link) {
      if (!link.tournament_id) return "Ansluten, väntar på information";
      return link.resource_name ? `${link.tournament_name} · ${link.resource_name}` : `${link.tournament_name} · alla resurser`;
    },
    resourcesForTournament(tournamentId) {
      const id = Number(tournamentId);
      if (!id) return [];
      return this.resources.filter((resource) => Number(resource.tournament_id) === id);
    },
    resetDrafts() {
      const drafts = {};
      for (const link of this.tvLinks) {
        drafts[link.id] = {
          label: link.label || "Live TV",
          tournament_id: link.tournament_id || "",
          resource_id: link.resource_id || "",
        };
      }
      this.drafts = drafts;
    },
    async load() {
      this.loading = true;
      try {
        const payload = await api("/api/tv-links");
        this.tvLinks = payload.tv_links || [];
        this.tournaments = payload.tournaments || [];
        this.resources = payload.resources || [];
        this.resetDrafts();
      } catch (error) {
        this.$emit("error", error);
      } finally {
        this.loading = false;
      }
    },
    async createTvLink(event) {
      try {
        const form = event.currentTarget;
        await api("/api/tv-links", { method: "POST", body: formPayload(form) });
        form.reset();
        this.$emit("notice", "Live TV-länk skapad.");
        await this.load();
      } catch (error) {
        this.$emit("error", error);
      }
    },
    async saveLink(link) {
      const draft = this.drafts[link.id];
      if (!draft) return;
      try {
        await api(`/api/tv-links/${link.id}`, { method: "PATCH", body: draft });
        this.$emit("notice", "Live TV-bindning uppdaterad.");
        await this.load();
      } catch (error) {
        this.$emit("error", error);
      }
    },
  },
  template: `
    <section class="page-head">
      <div>
        <p class="eyebrow">Instans</p>
        <h1>Live TV</h1>
        <p>{{ tvLinks.length }} länkar · {{ boundCount }} bundna · {{ waitingCount }} väntar</p>
      </div>
      <a class="button primary" href="#new-tv-link">Lägg till ny Live TV</a>
    </section>

    <section class="tv-admin-page">
      <div class="tv-admin-main">
        <section class="panel" id="new-tv-link">
          <div class="panel-head">
            <div><h2>Ny Live TV-länk</h2><p>Skapa en publik skärmlänk med automatisk eller egen kod.</p></div>
          </div>
          <form class="inline-form tv-create-form" @submit.prevent="createTvLink">
            <label>Etikett <input name="label" placeholder="Entré, hallskärm eller stream"></label>
            <label>Egen kod <input name="code" maxlength="10" pattern="[A-Za-z0-9]{10}" placeholder="10 tecken, valfritt"></label>
            <button type="submit">Skapa länk</button>
          </form>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div><h2>TV-länkar</h2><p>Uppdateringar slår igenom direkt på anslutna skärmar.</p></div>
            <span class="count-pill">{{ tvLinks.length }}</span>
          </div>
          <p v-if="loading" class="empty">Laddar Live TV-länkar...</p>
          <p v-else-if="!tvLinks.length" class="empty">Inga TV-länkar ännu.</p>
          <div v-else class="tv-link-grid">
            <article v-for="link in tvLinks" :key="link.id" class="tv-link-card">
              <header>
                <div>
                  <span class="code-chip">{{ link.code }}</span>
                  <h3>{{ link.label }}</h3>
                  <p>{{ bindingLabel(link) }}</p>
                </div>
                <span :class="['status-badge', link.tournament_id ? 'success' : 'neutral']">{{ link.tournament_id ? 'Aktiv' : 'Väntar' }}</span>
              </header>
              <div class="tv-link-url">
                <input :value="tvUrl(link)" readonly aria-label="TV-länk">
                <a class="button subtle" :href="'/tv/' + link.code" target="_blank" rel="noreferrer">Öppna</a>
              </div>
              <form v-if="drafts[link.id]" class="binding-form" @submit.prevent="saveLink(link)">
                <label>Etikett <input v-model="drafts[link.id].label"></label>
                <label>Turnering
                  <select v-model="drafts[link.id].tournament_id" @change="drafts[link.id].resource_id = ''">
                    <option value="">Ingen bindning</option>
                    <option v-for="tournament in tournaments" :key="tournament.id" :value="tournament.id">{{ tournament.name }}</option>
                  </select>
                </label>
                <label>Resurs
                  <select v-model="drafts[link.id].resource_id" :disabled="!drafts[link.id].tournament_id">
                    <option value="">Alla arenor/servrar</option>
                    <option v-for="resource in resourcesForTournament(drafts[link.id].tournament_id)" :key="resource.id" :value="resource.id">{{ resource.name }} · {{ resourceKindText(resource.kind) }}</option>
                  </select>
                </label>
                <button type="submit">Uppdatera live</button>
              </form>
            </article>
          </div>
        </section>
      </div>

      <aside class="side-stack">
        <section class="panel">
          <h2>Överblick</h2>
          <div class="side-metrics">
            <div><span>{{ tvLinks.length }}</span><small>Länkar</small></div>
            <div><span>{{ boundCount }}</span><small>Aktiva</small></div>
            <div><span>{{ waitingCount }}</span><small>Väntar</small></div>
            <div><span>{{ tournaments.length }}</span><small>Turneringar</small></div>
          </div>
        </section>
        <section class="panel">
          <h2>Senaste länkar</h2>
          <div class="mini-list">
            <p v-if="!tvLinks.length" class="empty">Inga länkar skapade.</p>
            <template v-else>
              <article v-for="link in tvLinks.slice(0, 5)" :key="link.id"><div><strong>{{ link.label }}</strong><small>{{ link.code }} · {{ link.tournament_name || 'väntar' }}</small></div><span :class="['status-badge', link.tournament_id ? 'success' : 'neutral']">{{ link.tournament_id ? 'Aktiv' : 'Väntar' }}</span></article>
            </template>
          </div>
        </section>
      </aside>
    </section>
  `,
};

const TournamentView = {
  components: { StatusBadge },
  props: ["id"],
  emits: ["notice", "error", "navigate"],
  data() {
    return { data: null, loading: true, eventSource: null, eventText, sectionLabels, activeSection: tournamentSectionFromHash(), scoreDialog: null };
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
    statusCounts() {
      return {
        all: this.matches.length,
        live: this.currentMatches.length,
        upcoming: this.upcomingMatches.length,
        done: this.completedMatches.length,
        unplaced: this.matches.filter((match) => !match.resource_id || !match.scheduled_at).length,
      };
    },
    participantBreakdown() {
      const teams = this.participants.filter((participant) => participant.kind !== "player").length;
      const players = this.participants.length - teams;
      return { teams, players };
    },
    seededCount() {
      return this.participants.filter((participant) => participant.seed).length;
    },
    seededParticipants() {
      return [...this.participants].sort((a, b) => {
        const seedA = a.seed == null ? Number.MAX_SAFE_INTEGER : Number(a.seed);
        const seedB = b.seed == null ? Number.MAX_SAFE_INTEGER : Number(b.seed);
        return seedA - seedB || a.name.localeCompare(b.name);
      });
    },
    selectedParticipant() {
      return this.seededParticipants[0] || null;
    },
    resourcesWithMatches() {
      return this.resources.map((resource) => ({
        ...resource,
        matches: this.sortedMatches.filter((match) => match.resource_id === resource.id).slice(0, 5),
      }));
    },
    unplacedMatches() {
      return this.sortedMatches.filter((match) => !match.resource_id || !match.scheduled_at).slice(0, 6);
    },
    qualifiedRows() {
      const limit = Math.max(1, Number(this.tournament.qualifiers_per_group || 1));
      return this.standings.flatMap((standing) =>
        standing.rows.slice(0, limit).map((row) => ({ ...row, groupName: standing.group.name })),
      );
    },
    knockoutRounds() {
      const knockout = this.matches.filter((match) => match.stage_kind === "knockout");
      return [...new Set<number>(knockout.map((match) => Number(match.round)))]
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
    window.addEventListener("hashchange", this.syncSection);
  },
  beforeUnmount() {
    if (this.eventSource) this.eventSource.close();
    window.removeEventListener("hashchange", this.syncSection);
  },
  methods: {
    formatDate,
    formatTime,
    statusTone,
    initials,
    participantKindText,
    resourceKindText,
    canScoreMatch(match) {
      return Boolean(match.participant_a_id && match.participant_b_id);
    },
    sectionFromHash() {
      return tournamentSectionFromHash();
    },
    syncSection() {
      this.activeSection = this.sectionFromHash();
    },
    showSection(section) {
      return this.activeSection === section;
    },
    openScoreDialog(match) {
      if (!this.canScoreMatch(match)) {
        this.$emit("notice", "Matchen saknar lag och kan inte poängrapporteras.", "danger");
        return;
      }
      this.scoreDialog = { ...match };
    },
    closeScoreDialog() {
      this.scoreDialog = null;
    },
    roundTitle(round) {
      const first = round.matches[0];
      return first ? first.name.replace(/\s+\d+$/, "") : `Runda ${round.round}`;
    },
    groupNameForParticipant(participantId) {
      const standing = this.standings.find((groupTable) => groupTable.rows.some((row) => row.participant_id === participantId));
      return standing ? standing.group.name : "Ej lottad";
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
      ["participant_added", "resource_added", "score_updated", "result_updated", "schedule_updated", "structure_generated", "bracket_seeded", "settings_updated"].forEach((eventName) => {
        this.eventSource.addEventListener(eventName, () => this.load());
      });
    },
    async submitForm(path, method, form, message, reset = true) {
      this.$emit("notice", "Sparar...", "info");
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
      this.$emit("notice", "Jobbar...", "info");
      try {
        await api(path, { method: "POST", body: {} });
        this.$emit("notice", message);
        await this.load();
      } catch (error) {
        this.$emit("error", error);
      }
    },
    async saveMatchScore(event, matchId, complete = false) {
      const form = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : event.currentTarget.form;
      if (!form) return;
      if (!form.reportValidity()) return;
      this.$emit("notice", complete ? "Avslutar match..." : "Sparar livepoäng...", "info");
      try {
        const action = complete ? "result" : "score";
        await api(`/api/tournaments/${this.id}/matches/${matchId}/${action}`, { method: "POST", body: formPayload(form) });
        this.$emit("notice", complete ? "Match avslutad." : "Livepoäng sparad.");
        this.closeScoreDialog();
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
          <p class="eyebrow">{{ sectionLabels['#' + activeSection] || 'Översikt' }}</p>
          <h1>{{ tournament.name }}</h1>
          <p>{{ formatDate(tournament.starts_at) }} · {{ resources.length }} platser · {{ participants.length }} lag / deltagare</p>
        </div>
        <div class="actions">
          <a class="button subtle" href="#inställningar">Hantera turnering</a>
          <a class="button primary" href="/admin/tv" @click.prevent="$emit('navigate', '/admin/tv')">Hantera Live TV</a>
        </div>
      </section>

      <nav class="tournament-tabs" aria-label="Turneringsdelar">
        <a href="#översikt" :class="{ active: activeSection === 'översikt' }"><span>Översikt</span><small>Status</small></a>
        <a href="#matcher" :class="{ active: activeSection === 'matcher' }"><span>Matcher</span><small>Poäng</small></a>
        <a href="#deltagare" :class="{ active: activeSection === 'deltagare' }"><span>Deltagare</span><small>Lag</small></a>
        <a href="#schema" :class="{ active: activeSection === 'schema' }"><span>Schema</span><small>Planer</small></a>
        <a href="#slutspel" :class="{ active: activeSection === 'slutspel' }"><span>Slutspel</span><small>Bracket</small></a>
        <a href="#moderatorer" :class="{ active: activeSection === 'moderatorer' }"><span>Moderatorer</span><small>Länkar</small></a>
        <a href="#inställningar" :class="{ active: activeSection === 'inställningar' }"><span>Inställningar</span><small>Tider</small></a>
      </nav>

      <section v-if="showSection('översikt')" class="metric-grid">
        <article class="metric-card blue"><span aria-hidden="true"></span><div><small>Totalt deltagare</small><strong>{{ participants.length }}</strong><p>{{ Math.ceil(participants.length / Math.max(tournament.group_count, 1)) || 0 }} per grupp</p></div></article>
        <article class="metric-card green"><span aria-hidden="true"></span><div><small>Aktiva matcher</small><strong>{{ currentMatches.length }}</strong><p>Pågår nu</p></div></article>
        <article class="metric-card amber"><span aria-hidden="true"></span><div><small>Kommande matcher</small><strong>{{ upcomingMatches.length }}</strong><p>Schemalagda</p></div></article>
        <article class="metric-card purple"><span aria-hidden="true"></span><div><small>Avslutade</small><strong>{{ completedMatches.length }}</strong><p>{{ matches.length }} totalt</p></div></article>
      </section>

      <section :class="['dashboard-layout', activeSection !== 'översikt' && activeSection !== 'matcher' && 'single-pane']">
        <div class="dashboard-main">
          <section v-if="showSection('översikt') || showSection('matcher')" class="panel" id="matcher">
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

          <section v-if="showSection('översikt') || showSection('slutspel')" :class="[showSection('slutspel') ? 'section-grid bracket-page' : 'split-panels']">
            <section class="panel" id="slutspel">
              <div class="panel-head"><div><h2>Slutspel - översikt</h2><p>{{ knockoutRounds.length ? knockoutRounds.length + ' rundor' : 'Ingen bracket ännu' }}</p></div><button v-if="showSection('slutspel')" class="button subtle" type="button" @click="postAction('/api/tournaments/' + id + '/generate', 'Bracket skapad.')">Generera</button></div>
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

            <section v-if="showSection('slutspel')" class="panel">
              <div class="panel-head"><h2>Kvalificerade till slutspel</h2><span class="count-pill">{{ qualifiedRows.length }}</span></div>
              <div class="mini-list qualified-list">
                <p v-if="!qualifiedRows.length" class="empty">Spela klart gruppspelet eller generera grupper för att se kvalificerade lag.</p>
                <template v-else>
                  <article v-for="row in qualifiedRows" :key="row.groupName + '-' + row.participant_id"><div><strong>{{ row.name }}</strong><small>{{ row.groupName }} · plats {{ row.rank }}</small></div><span class="count-pill">{{ row.points }} p</span></article>
                </template>
              </div>
            </section>

            <section v-if="showSection('slutspel')" class="panel quick-panel">
              <h2>Slutspelsåtgärder</h2>
              <button class="button ghost" type="button" @click="postAction('/api/tournaments/' + id + '/generate', 'Bracket skapad.')">Bygg om bracket</button>
              <button class="button ghost" type="button" @click="postAction('/api/tournaments/' + id + '/schedule', 'Schema uppdaterat.')">Schemalägg slutspel</button>
            </section>
          </section>

          <section v-if="showSection('deltagare')" class="section-grid participant-page" id="deltagare">
            <section class="panel participant-list-panel">
              <div class="panel-head">
                <div><h2>Deltagare</h2><p>{{ participantBreakdown.teams }} lag · {{ participantBreakdown.players }} individuella</p></div>
                <span class="count-pill">{{ participants.length }}</span>
              </div>
              <div class="filter-row">
                <span class="filter-chip active">Alla <strong>{{ participants.length }}</strong></span>
                <span class="filter-chip">Lag <strong>{{ participantBreakdown.teams }}</strong></span>
                <span class="filter-chip">Spelare <strong>{{ participantBreakdown.players }}</strong></span>
                <span class="filter-chip">Seedade <strong>{{ seededCount }}</strong></span>
              </div>
              <form class="inline-form action-form" @submit.prevent="submitForm('/api/tournaments/' + id + '/participants', 'POST', $event.currentTarget, 'Deltagare tillagd.')">
                <input name="name" required placeholder="Lag eller spelare">
                <select name="kind"><option value="team">Lag</option><option value="player">Spelare</option></select>
                <input name="seed" type="number" min="1" placeholder="Seed">
                <button type="submit">Lägg till deltagare</button>
              </form>
              <table class="admin-table compact-table participant-table">
                <thead><tr><th>Seed</th><th>Namn</th><th>Typ</th><th>Status</th></tr></thead>
                <tbody>
                  <tr v-if="!seededParticipants.length"><td colspan="4">Inga deltagare.</td></tr>
                  <template v-else>
                    <tr v-for="participant in seededParticipants" :key="participant.id">
                      <td>{{ participant.seed || '-' }}</td>
                      <td><span class="avatar-chip">{{ initials(participant.name) }}</span><strong>{{ participant.name }}</strong></td>
                      <td>{{ participantKindText(participant.kind) }}</td>
                      <td><span class="status-badge success">Registrerad</span></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </section>

            <aside class="side-stack">
              <section class="panel detail-panel">
                <template v-if="selectedParticipant">
                  <div class="detail-hero"><span class="card-symbol tone-1">{{ initials(selectedParticipant.name) }}</span><div><h2>{{ selectedParticipant.name }}</h2><p>{{ participantKindText(selectedParticipant.kind) }}</p></div></div>
                  <dl class="detail-list">
                    <div><dt>Seed</dt><dd>{{ selectedParticipant.seed || '-' }}</dd></div>
                    <div><dt>Grupp</dt><dd>{{ groupNameForParticipant(selectedParticipant.id) }}</dd></div>
                    <div><dt>Status</dt><dd><span class="status-badge success">Registrerad</span></dd></div>
                  </dl>
                </template>
                <p v-else class="empty">Lägg till deltagare för att se detaljer.</p>
              </section>
              <section class="panel">
                <h2>Gruppfördelning</h2>
                <div class="mini-list">
                  <p v-if="!standings.length" class="empty">Generera gruppspel för att se grupper.</p>
                  <template v-else>
                    <article v-for="standing in standings" :key="standing.group.id"><div><strong>{{ standing.group.name }}</strong><small>{{ standing.rows.length }} deltagare</small></div><span class="count-pill">{{ standing.rows.length }}</span></article>
                  </template>
                </div>
              </section>
            </aside>
          </section>

          <section v-if="showSection('schema')" class="section-grid schedule-page" id="schema">
            <section class="panel">
              <div class="panel-head"><div><h2>Schema</h2><p>{{ resources.length }} resurser · {{ statusCounts.unplaced }} ej placerade matcher</p></div><span class="count-pill">{{ matches.length }}</span></div>
              <div class="schedule-board">
                <article v-for="resource in resourcesWithMatches" :key="resource.id" class="resource-column">
                  <header><strong>{{ resource.name }}</strong><small>{{ resourceKindText(resource.kind) }} · {{ resource.active ? 'Aktiv' : 'Pausad' }}</small></header>
                  <p v-if="!resource.matches.length" class="empty">Inga matcher placerade.</p>
                  <template v-else>
                    <div class="resource-match" v-for="match in resource.matches" :key="match.id">
                      <strong>{{ match.side_a }} <span>vs</span> {{ match.side_b }}</strong>
                      <small>{{ match.time_label }} · {{ match.group_name || match.stage_name || match.name }}</small>
                    </div>
                  </template>
                </article>
                <p v-if="!resources.length" class="empty">Lägg till en spelplan eller server för att bygga schema.</p>
              </div>
            </section>

            <aside class="side-stack">
              <section class="panel">
                <h2>Ny resurs</h2>
                <form class="stack" @submit.prevent="submitForm('/api/tournaments/' + id + '/resources', 'POST', $event.currentTarget, 'Resurs tillagd.')">
                  <label>Namn <input name="name" required placeholder="Plan 1"></label>
                  <label>Typ <select name="kind"><option value="court">Spelplan</option><option value="server">Server</option><option value="table">Bord</option></select></label>
                  <button type="submit">Lägg till resurs</button>
                </form>
              </section>
              <section class="panel">
                <div class="panel-head"><h2>Ej placerade</h2><span class="count-pill">{{ statusCounts.unplaced }}</span></div>
                <div class="mini-list">
                  <p v-if="!unplacedMatches.length" class="empty">Alla spelbara matcher har en plats.</p>
                  <template v-else>
                    <article v-for="match in unplacedMatches" :key="match.id"><div><strong>{{ match.side_a }} vs {{ match.side_b }}</strong><small>{{ match.group_name || match.stage_name || match.name }}</small></div></article>
                  </template>
                </div>
              </section>
            </aside>
          </section>

          <section v-if="showSection('matcher') || showSection('schema')" class="panel" id="alla-matcher">
            <div class="panel-head"><h2>Alla matcher</h2><span class="count-pill">{{ matches.length }}</span></div>
            <div class="filter-row match-status-row">
              <span class="filter-chip active">Alla <strong>{{ statusCounts.all }}</strong></span>
              <span class="filter-chip">Pågår <strong>{{ statusCounts.live }}</strong></span>
              <span class="filter-chip">Kommande <strong>{{ statusCounts.upcoming }}</strong></span>
              <span class="filter-chip">Avslutade <strong>{{ statusCounts.done }}</strong></span>
              <span class="filter-chip">Ej placerade <strong>{{ statusCounts.unplaced }}</strong></span>
            </div>
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
                      <div class="row-action-buttons">
                        <button v-if="canScoreMatch(match)" type="button" class="button subtle" @click="openScoreDialog(match)">{{ match.status === 'completed' ? 'Resultat' : 'Poäng' }}</button>
                        <span v-else class="form-hint compact">Inväntar lag</span>
                      </div>
                      <details class="row-actions">
                        <summary>Tid</summary>
                        <form class="tiny-form slot-form" @submit.prevent="submitForm('/api/tournaments/' + id + '/matches/' + match.id + '/slot', 'PATCH', $event.currentTarget, 'Match flyttad.')">
                          <input name="scheduled_at" type="datetime-local" :value="match.scheduled_at || tournament.starts_at" required>
                          <select name="resource_id" :value="match.resource_id || ''" required><option value="" disabled>Välj plats</option><option v-for="resource in resources" :key="resource.id" :value="resource.id">{{ resource.name }}</option></select>
                          <input name="duration_minutes" type="number" min="1" :value="match.duration_minutes">
                          <button type="submit">Spara tid</button>
                        </form>
                      </details>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </section>

          <section v-if="showSection('inställningar')" class="section-grid settings-page">
            <form class="settings-grid" id="inställningar" @submit.prevent="submitForm('/api/tournaments/' + id + '/settings', 'PATCH', $event.currentTarget, 'Inställningar sparade.', false)">
              <section class="panel">
                <div class="panel-head"><h2>Grundläggande information</h2></div>
                <label>Start <input name="starts_at" type="datetime-local" :value="tournament.starts_at"></label>
                <p class="form-hint">Starttiden används som bas när matcher schemaläggs automatiskt.</p>
              </section>
              <section class="panel">
                <div class="panel-head"><h2>Matchinställningar</h2></div>
                <div class="form-grid two"><label>Matchminuter <input name="match_minutes" type="number" min="1" :value="tournament.match_minutes"></label><label>Vila minuter <input name="break_minutes" type="number" min="0" :value="tournament.break_minutes"></label></div>
                <p class="form-hint">Längd och vila används både för nytt schema och manuell flytt av matcher.</p>
              </section>
              <section class="panel">
                <div class="panel-head"><h2>Turneringsstruktur</h2></div>
                <div class="form-grid two"><label>Grupper <input name="group_count" type="number" min="1" :value="tournament.group_count"></label><label>Vidare/grupp <input name="qualifiers_per_group" type="number" min="1" :value="tournament.qualifiers_per_group"></label></div>
                <p class="form-hint">Ändra detta innan du bygger om gruppspel och slutspel.</p>
              </section>
              <section class="panel settings-save">
                <h2>Spara ändringar</h2>
                <button type="submit">Spara inställningar</button>
              </section>
            </form>

            <aside class="side-stack">
              <section class="panel quick-panel">
                <h2>Turneringsåtgärder</h2>
                <button class="button ghost" type="button" @click="postAction('/api/tournaments/' + id + '/generate', 'Bracket skapad.')">Generera gruppspel och slutspel</button>
                <button class="button ghost" type="button" @click="postAction('/api/tournaments/' + id + '/schedule', 'Schema uppdaterat.')">Autoschemalägg matcher</button>
                <a class="button ghost" href="#moderatorer">Skapa moderatorlänk</a>
              </section>
              <section class="panel">
                <h2>Aktuell struktur</h2>
                <dl class="detail-list">
                  <div><dt>Grupper</dt><dd>{{ tournament.group_count }}</dd></div>
                  <div><dt>Vidare/grupp</dt><dd>{{ tournament.qualifiers_per_group }}</dd></div>
                  <div><dt>Matcher</dt><dd>{{ matches.length }}</dd></div>
                </dl>
              </section>
            </aside>
          </section>

          <section v-if="showSection('moderatorer')" class="section-grid moderator-admin-page">
            <section class="panel" id="moderatorer">
              <div class="panel-head"><div><h2>Skapa moderatorlänk</h2><p>{{ resources.length }} resurser kan begränsas</p></div><span class="count-pill">{{ moderators.length }} aktiva</span></div>
              <form class="inline-form moderator-create-form" @submit.prevent="submitForm('/api/tournaments/' + id + '/moderators', 'POST', $event.currentTarget, 'Moderatorlänk skapad.')">
                <label>Etikett <input name="label" required placeholder="Moderator plan 1"></label>
                <label>Scope <select name="resource_id"><option value="">Alla resurser</option><option v-for="resource in resources" :key="resource.id" :value="resource.id">{{ resource.name }}</option></select></label>
                <button type="submit">Skapa länk</button>
              </form>
            </section>

            <section class="panel moderator-links-panel">
              <div class="panel-head"><h2>Moderatorlänkar</h2><span class="count-pill">{{ moderators.length }}</span></div>
              <table class="admin-table compact-table">
                <thead><tr><th>Etikett</th><th>Scope</th><th>PIN</th><th>Status</th><th>Länk</th></tr></thead>
                <tbody>
                  <tr v-if="!moderators.length"><td colspan="5">Inga moderatorer ännu.</td></tr>
                  <template v-else>
                    <tr v-for="moderator in moderators" :key="moderator.id">
                      <td><strong>{{ moderator.label }}</strong></td>
                      <td>{{ moderator.resource_name || 'Alla resurser' }}</td>
                      <td><code>{{ moderator.pin }}</code></td>
                      <td><span class="status-badge success">Aktiv</span></td>
                      <td><a :href="'/m/' + moderator.token">Öppna</a></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </section>

            <aside class="side-stack">
              <section class="panel share-card">
                <h2>Dela med moderator</h2>
                <template v-if="moderators[0]">
                  <div class="share-link"><span>/m/{{ moderators[0].token }}</span><a :href="'/m/' + moderators[0].token">Öppna</a></div>
                  <div class="qr-placeholder" aria-hidden="true"><span>T</span></div>
                  <p>{{ moderators[0].label }}</p>
                </template>
                <p v-else class="empty">Skapa en länk för att visa delning.</p>
              </section>
              <section class="panel">
                <h2>Senaste aktivitet</h2>
                <div class="activity-list">
                  <article><span class="activity-icon green"></span><div><strong>{{ participants.length }} deltagare registrerade</strong><small>Aktuell deltagarlista</small></div></article>
                  <p v-if="!events.length" class="empty">Inga händelser ännu.</p>
                  <template v-else><article v-for="event in events.slice(0, 5)" :key="event.id"><span class="activity-icon blue"></span><div><strong>{{ eventText[event.kind] || event.kind }}</strong><small>{{ formatTime(event.created_at) }}</small></div></article></template>
                </div>
              </section>
            </aside>
          </section>
        </div>

        <aside v-if="showSection('översikt') || showSection('matcher')" class="dashboard-side">
          <section v-if="showSection('översikt') || showSection('matcher')" class="panel quick-panel">
            <h2>Snabbåtgärder</h2>
            <button class="button ghost" type="button" @click="postAction('/api/tournaments/' + id + '/generate', 'Bracket skapad.')">Generera gruppspel och slutspel</button>
            <button class="button ghost" type="button" @click="postAction('/api/tournaments/' + id + '/schedule', 'Schema uppdaterat.')">Autoschemalägg matcher</button>
            <a class="button ghost" href="/admin/tv" @click.prevent="$emit('navigate', '/admin/tv')">Hantera Live TV</a>
          </section>

          <section v-if="showSection('översikt')" class="panel">
            <h2>Senaste aktivitet</h2>
            <div class="activity-list">
              <article><span class="activity-icon green"></span><div><strong>{{ participants.length }} deltagare registrerade</strong><small>Aktuell deltagarlista</small></div></article>
              <p v-if="!events.length" class="empty">Inga händelser ännu.</p>
              <template v-else><article v-for="event in events.slice(0, 6)" :key="event.id"><span class="activity-icon blue"></span><div><strong>{{ eventText[event.kind] || event.kind }}</strong><small>{{ formatTime(event.created_at) }}</small></div></article></template>
            </div>
          </section>
        </aside>
      </section>

      <div v-if="scoreDialog" class="modal-backdrop" @click.self="closeScoreDialog">
        <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="score-dialog-title">
          <div class="modal-head">
            <div>
              <p class="eyebrow">{{ scoreDialog.group_name || scoreDialog.stage_name || scoreDialog.name }}</p>
              <h2 id="score-dialog-title">Rapportera poäng</h2>
            </div>
            <button type="button" class="icon-button" aria-label="Stäng" @click="closeScoreDialog">×</button>
          </div>
          <div class="score-matchup">
            <strong>{{ scoreDialog.side_a }}</strong>
            <span>vs</span>
            <strong>{{ scoreDialog.side_b }}</strong>
          </div>
          <form class="score-dialog-form" @submit.prevent="saveMatchScore($event, scoreDialog.id, false)">
            <label>{{ scoreDialog.side_a }} <input name="score_a" type="number" min="0" required placeholder="0" :value="scoreDialog.score_a == null ? '' : scoreDialog.score_a" aria-label="Poäng A"></label>
            <label>{{ scoreDialog.side_b }} <input name="score_b" type="number" min="0" required placeholder="0" :value="scoreDialog.score_b == null ? '' : scoreDialog.score_b" aria-label="Poäng B"></label>
            <div class="modal-actions">
              <button type="submit" :disabled="scoreDialog.status === 'completed'">Spara livepoäng</button>
              <button type="button" class="button primary" @click="saveMatchScore($event, scoreDialog.id, true)">Avsluta match</button>
              <button type="button" class="button subtle" @click="closeScoreDialog">Avbryt</button>
            </div>
          </form>
        </section>
      </div>
    </template>
  `,
};

const ModeratorView = {
  components: { NoticeBox, StatusBadge },
  props: ["token", "notice"],
  emits: ["notice", "error", "clear"],
  data() {
    return { data: null, eventSource: null };
  },
  computed: {
    moderatorMatches() {
      return this.data ? this.data.matches || [] : [];
    },
    moderatorCounts() {
      return {
        all: this.moderatorMatches.length,
        live: this.moderatorMatches.filter((match) => match.status === "in_progress").length,
        upcoming: this.moderatorMatches.filter((match) => match.status !== "in_progress").length,
      };
    },
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
      ["score_updated", "result_updated", "schedule_updated", "structure_generated", "bracket_seeded", "settings_updated"].forEach((eventName) => {
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
    async saveScore(event, matchId, complete = false) {
      const form = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : event.currentTarget.form;
      if (!form) return;
      if (!form.reportValidity()) return;
      this.$emit("notice", complete ? "Avslutar match..." : "Sparar livepoäng...", "info");
      try {
        const action = complete ? "result" : "score";
        await api(`/api/moderators/${this.token}/matches/${matchId}/${action}`, { method: "POST", body: formPayload(form) });
        this.$emit("notice", complete ? "Match avslutad." : "Livepoäng sparad.");
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
        <section class="page-head" :data-tournament-id="data.moderator.tournament_id"><div><p class="eyebrow">Moderator</p><h1>{{ data.moderator.label }}</h1><p>{{ data.moderator.tournament_name }} · {{ data.moderator.resource_name || 'Alla resurser' }}</p></div><button v-if="data.authorized" type="button" class="button subtle" @click="load">Uppdatera</button></section>
        <section v-if="data.authorized" class="moderator-shell">
          <aside class="panel moderator-side-card">
            <h2>Moderator-PIN</h2>
            <span class="status-badge success">Aktiv</span>
            <dl class="detail-list">
              <div><dt>Inloggad som</dt><dd>{{ data.moderator.label }}</dd></div>
              <div><dt>Scope</dt><dd>{{ data.moderator.resource_name || 'Alla resurser' }}</dd></div>
              <div><dt>Matcher</dt><dd>{{ moderatorCounts.all }}</dd></div>
            </dl>
          </aside>

          <section class="moderator-main">
            <div class="filter-row">
              <span class="filter-chip active">Alla matcher <strong>{{ moderatorCounts.all }}</strong></span>
              <span class="filter-chip">Pågår <strong>{{ moderatorCounts.live }}</strong></span>
              <span class="filter-chip">Kommande <strong>{{ moderatorCounts.upcoming }}</strong></span>
            </div>
            <p v-if="!moderatorMatches.length" class="panel empty">Inga öppna matcher i ditt scope.</p>
            <article v-for="(match, index) in moderatorMatches" :key="match.id" :class="['panel', 'moderator-match-card', index === 0 && 'expanded']">
              <header>
                <div><strong>{{ match.time_label }}</strong><small>{{ match.resource_name || '-' }}</small></div>
                <div class="moderator-match-title"><strong>{{ match.side_a }}</strong><span class="vs">vs</span><strong>{{ match.side_b }}</strong><small>{{ match.group_name || match.stage_name || match.name }}</small></div>
                <status-badge :status="match.status" />
              </header>
              <form class="moderator-score-card" @submit.prevent="saveScore($event, match.id, false)">
                <label>{{ match.side_a }} <input name="score_a" type="number" min="0" required placeholder="0" :value="match.score_a == null ? '' : match.score_a" aria-label="Poäng A"></label>
                <span class="score-separator">-</span>
                <label>{{ match.side_b }} <input name="score_b" type="number" min="0" required placeholder="0" :value="match.score_b == null ? '' : match.score_b" aria-label="Poäng B"></label>
                <div class="modal-actions">
                  <button type="submit">Spara livepoäng</button>
                  <button type="button" class="button subtle danger-action" @click="saveScore($event, match.id, true)">Avsluta match</button>
                </div>
              </form>
            </article>
          </section>
        </section>
        <section v-else class="panel narrow"><h2>Moderator-PIN</h2><form class="stack" @submit.prevent="login"><label>PIN <input name="pin" type="password" required autofocus></label><button type="submit">Öppna</button></form></section>
      </template>
    </main>
  `,
};

createApp({
  components: { AdminShell, AdminHome, LiveTvAdmin, LoginView, ModeratorView, NoticeBox, StatusBadge, TournamentView },
  data() {
    return { session: null, route: location.pathname, routeHash: normalizedHash(), notice: null };
  },
  computed: {
    tournamentId() {
      return this.route.startsWith("/tournaments/") ? this.route.split("/")[2] : null;
    },
    activeNav() {
      if (this.route === "/admin/tv") return "Live TV";
      if (!this.tournamentId) return "Turneringar";
      return sectionLabels[this.routeHash] || "Översikt";
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
    window.addEventListener("hashchange", this.onHashChange);
  },
  beforeUnmount() {
    window.removeEventListener("popstate", this.onPopState);
    window.removeEventListener("hashchange", this.onHashChange);
  },
  methods: {
    onPopState() {
      this.route = location.pathname;
      this.routeHash = normalizedHash();
    },
    onHashChange() {
      this.routeHash = normalizedHash();
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
      this.routeHash = normalizedHash();
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
      const target = this.route && !["/", "/login"].includes(this.route) ? this.route : "/admin";
      try {
        await api("/api/admin/login", { method: "POST", body: formPayload(event.currentTarget) });
        await this.refreshSession();
        this.navigate(target);
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
      <live-tv-admin v-if="route === '/admin/tv'" @notice="showNotice" @error="showError" />
      <tournament-view v-else-if="tournamentId" :id="tournamentId" @navigate="navigate" @notice="showNotice" @error="showError" />
      <admin-home v-else @navigate="navigate" @notice="showNotice" @error="showError" />
    </admin-shell>
  `,
}).mount("#app");
}
