import {
  mdiAccountGroupOutline,
  mdiCalendarClock,
  mdiChevronLeft,
  mdiChevronRight,
  mdiCogOutline,
  mdiLogout,
  mdiMenu,
  mdiScoreboardOutline,
  mdiShieldAccountOutline,
  mdiTelevisionPlay,
  mdiTournament,
  mdiTrophyVariant,
  mdiViewDashboardOutline,
} from "@mdi/js";
import {
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, formPayload } from "../shared/api";
import {
  eventText,
  formatDate,
  formatTime,
  initials,
  participantKindText,
  resourceKindText,
  sortBySchedule,
  statusText,
  statusTone,
} from "../shared/format";
import { MdiIcon } from "../shared/MdiIcon";
import type {
  DashboardData,
  Match,
  Moderator,
  Notice,
  Resource,
  StandingRow,
  TournamentSummary,
  TvLink,
} from "../shared/types";

type NoticeKind = NonNullable<Notice>["type"];
type NoticeHandler = (message: string, type?: NoticeKind) => void;
type ErrorHandler = (error: unknown) => void;

type NavItem = {
  label: string;
  icon: string;
  tournamentOnly?: boolean;
  external?: boolean;
};

type RoundGroup = {
  round: number;
  matches: Match[];
};

type ParticipantFilter = "all" | "team" | "player" | "seeded";
type MatchFilter = "all" | "live" | "upcoming" | "done" | "unplaced";
type ModeratorMatchFilter = "all" | "live" | "upcoming";

function moreText(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular} till` : `${count} ${plural} till`;
}

const navItems: NavItem[] = [
  { label: "Turneringar", icon: mdiTrophyVariant },
  { label: "Live TV", icon: mdiTelevisionPlay },
  { label: "Översikt", icon: mdiViewDashboardOutline, tournamentOnly: true },
  { label: "Matcher", icon: mdiScoreboardOutline, tournamentOnly: true },
  { label: "Deltagare", icon: mdiAccountGroupOutline, tournamentOnly: true },
  { label: "Schema", icon: mdiCalendarClock, tournamentOnly: true },
  { label: "Slutspel", icon: mdiTournament, tournamentOnly: true },
  { label: "Moderatorer", icon: mdiShieldAccountOutline, tournamentOnly: true },
  { label: "Inställningar", icon: mdiCogOutline, tournamentOnly: true },
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

const liveEventNames = [
  "participant_added",
  "resource_added",
  "score_updated",
  "result_updated",
  "schedule_updated",
  "structure_generated",
  "bracket_seeded",
  "settings_updated",
];

function normalizedHash(value = window.location.hash || ""): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function tournamentSectionFromHash(hashValue = normalizedHash()): string {
  const hash = hashValue || "#översikt";
  if (hash === "#alla-matcher") return "matcher";
  return hash.replace("#", "") || "översikt";
}

function resetTournamentScroll(): void {
  if (!location.pathname.startsWith("/tournaments/")) return;
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
}

function roundTitle(round: RoundGroup): string {
  const first = round.matches[0];
  return first ? first.name.replace(/\s+\d+$/, "") : `Runda ${round.round}`;
}

function canScoreMatch(match: Match): boolean {
  return Boolean(match.participant_a_id && match.participant_b_id && match.status !== "completed");
}

function NoticeBox({ notice, onClear }: { notice: Notice; onClear: () => void }) {
  if (!notice) return null;
  return (
    <p className={`notice ${notice.type || "success"}`} role={notice.type === "danger" ? "alert" : "status"}>
      {notice.message}
      <button className="notice-close" type="button" aria-label="Stäng meddelande" onClick={onClear}>
        Stäng
      </button>
    </p>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  const label = status ? statusText[status] || status : "Okänd";
  return <span className={`status-badge ${statusTone(status)}`}>{label}</span>;
}

function LoginView({
  notice,
  onLogin,
  onClear,
}: {
  notice: Notice;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
}) {
  return (
    <main className="page guest-page">
      <NoticeBox notice={notice} onClear={onClear} />
      <section className="login-panel panel narrow">
        <div className="login-mark" aria-hidden="true"><MdiIcon path={mdiTrophyVariant} /></div>
        <p className="eyebrow">Lokal eventserver</p>
        <h1>Logga in</h1>
        <form className="stack" onSubmit={onLogin}>
          <label>
            PIN <input name="pin" type="password" autoFocus required />
          </label>
          <button type="submit">Logga in</button>
        </form>
      </section>
    </main>
  );
}

function AdminShell({
  active,
  tournamentId,
  notice,
  children,
  onNavigate,
  onLogout,
  onNotice,
  onClear,
}: {
  active: string;
  tournamentId: string | null;
  notice: Notice;
  children: ReactNode;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  onNotice: NoticeHandler;
  onClear: () => void;
}) {
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const visibleNavItems = tournamentId ? navItems : navItems.filter((item) => !item.tournamentOnly);

  const hrefFor = (item: NavItem) => {
    if (item.label === "Turneringar") return "/admin";
    if (item.label === "Live TV") return "/admin/tv";
    if (!tournamentId) return "/admin";
    if (item.label === "Översikt") return "#översikt";
    return sectionTargets[item.label] || `/tournaments/${tournamentId}`;
  };

  const follow = (event: MouseEvent<HTMLAnchorElement>, item: NavItem) => {
    const href = hrefFor(item);
    if (href.startsWith("/") && !item.external) {
      event.preventDefault();
      onNavigate(href);
    }
  };

  return (
    <div className={`admin-shell ${compact ? "menu-collapsed" : ""}`}>
      <aside className="sidebar">
        <a className="brand" href="/admin" onClick={(event) => { event.preventDefault(); onNavigate("/admin"); }}>
          <span className="brand-mark" aria-hidden="true"><MdiIcon path={mdiTrophyVariant} /></span>
          <span>Turneringar</span>
        </a>
        <nav className="side-nav">
          {visibleNavItems.map((item) => (
            <a
              key={item.label}
              href={hrefFor(item)}
              className={item.label === active ? "active" : undefined}
              onClick={(event) => follow(event, item)}
            >
              <span className="nav-glyph" aria-hidden="true"><MdiIcon path={item.icon} /></span>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <button className="link-button" type="button" onClick={onLogout}>
          <MdiIcon path={mdiLogout} />
          <span>Logga ut</span>
        </button>
        <button className="side-collapse" type="button" onClick={() => setCompact((value) => !value)}>
          <MdiIcon path={compact ? mdiChevronRight : mdiChevronLeft} />
          <span>{compact ? "Visa meny" : "Minimera"}</span>
        </button>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            type="button"
            aria-label={compact ? "Visa meny" : "Minimera meny"}
            onClick={() => setCompact((value) => !value)}
          >
            <MdiIcon path={mdiMenu} />
          </button>
          <div className="topbar-context" aria-label="Aktuell vy">
            <small>Vy</small>
            <strong>{active}</strong>
          </div>
          <div className="top-actions">
            <div className="user-chip" aria-label="Inloggad användare">
              <span>AD</span>
              <strong>Admin</strong>
              <small>Lokal session</small>
            </div>
          </div>
        </header>
        <main className="page" aria-live="polite">
          <NoticeBox notice={notice} onClear={onClear} />
          {children}
        </main>
      </div>
    </div>
  );
}

function AdminHome({
  onNavigate,
  onNotice,
  onError,
}: {
  onNavigate: (path: string) => void;
  onNotice: NoticeHandler;
  onError: ErrorHandler;
}) {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sortNewestFirst, setSortNewestFirst] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<{ tournaments: TournamentSummary[] }>("/api/tournaments");
      setTournaments(payload.tournaments || []);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const participantTotal = tournaments.reduce((sum, tournament) => sum + tournament.participant_count, 0);
  const matchTotal = tournaments.reduce((sum, tournament) => sum + tournament.match_count, 0);
  const visibleTournaments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? tournaments.filter((tournament) => tournament.name.toLowerCase().includes(normalized))
      : tournaments;
    return [...filtered].sort((a, b) => {
      const result = String(a.created_at || "").localeCompare(String(b.created_at || ""));
      return sortNewestFirst ? -result : result;
    });
  }, [query, sortNewestFirst, tournaments]);

  const createTournament = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = await api<{ id: number }>("/api/tournaments", {
        method: "POST",
        body: formPayload(event.currentTarget),
      });
      onNotice("Turnering skapad.");
      onNavigate(`/tournaments/${result.id}`);
    } catch (error) {
      onError(error);
    }
  };

  return (
    <>
      <section className="page-head">
        <div>
          <p className="eyebrow">Alla turneringar</p>
          <h1>Turneringar</h1>
          <p>{tournaments.length} turneringar · {participantTotal} deltagare · {matchTotal} matcher</p>
        </div>
        <a className="button primary" href="#create-tournament">Skapa turnering</a>
      </section>

      <section className="admin-overview">
        <div className="tournament-column">
          <div className="toolbar">
            <label className="search-field">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Sök i listan..." />
            </label>
            <button className="button subtle" type="button" onClick={() => setSortNewestFirst((value) => !value)}>
              {sortNewestFirst ? "Senaste först" : "Äldsta först"}
            </button>
            <button className="button subtle" type="button" onClick={() => setQuery("")}>Rensa filter</button>
          </div>
          <div className="tournament-list">
            {loading ? <p className="empty">Laddar turneringar...</p> : null}
            {!loading && !visibleTournaments.length ? <p className="empty">Inga turneringar matchar filtret.</p> : null}
            {!loading && visibleTournaments.map((tournament, index) => (
              <article key={tournament.id} className={`tournament-card ${index === 0 ? "selected" : ""}`}>
                <div className={`card-symbol tone-${(index % 5) + 1}`} aria-hidden="true">{initials(tournament.name)}</div>
                <div className="tournament-card-main">
                  <h2>
                    <a href={`/tournaments/${tournament.id}`} onClick={(event) => { event.preventDefault(); onNavigate(`/tournaments/${tournament.id}`); }}>
                      {tournament.name}
                    </a>
                  </h2>
                  <p>{formatDate(tournament.starts_at)}</p>
                  <div className="tournament-stats">
                    <span><strong>{tournament.participant_count}</strong><small>Deltagare</small></span>
                    <span><strong>{tournament.resource_count}</strong><small>Platser</small></span>
                    <span><strong>{tournament.match_count}</strong><small>Matcher</small></span>
                  </div>
                </div>
                <div className="tournament-actions">
                  <StatusBadge status={tournament.status} />
                  <a className="button subtle" href={`/tournaments/${tournament.id}`} onClick={(event) => { event.preventDefault(); onNavigate(`/tournaments/${tournament.id}`); }}>Öppna</a>
                  <a className="icon-link" href="/admin/tv" aria-label="Hantera Live TV" onClick={(event) => { event.preventDefault(); onNavigate("/admin/tv"); }}>TV</a>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="side-stack">
          <section className="panel">
            <h2>Ny turnering</h2>
            <form id="create-tournament" className="stack" onSubmit={createTournament}>
              <label>Namn <input name="name" required placeholder="Sommarcupen" /></label>
              <label>Start <input name="starts_at" type="datetime-local" /></label>
              <div className="form-grid two">
                <label>Grupper <input name="group_count" type="number" min="1" defaultValue="2" /></label>
                <label>Vidare/grupp <input name="qualifiers_per_group" type="number" min="1" defaultValue="2" /></label>
              </div>
              <button type="submit">Skapa</button>
            </form>
          </section>

          <section className="panel">
            <h2>Överblick</h2>
            <div className="side-metrics">
              <div><span>{tournaments.length}</span><small>Turneringar</small></div>
              <div><span>{participantTotal}</span><small>Deltagare</small></div>
              <div><span>{matchTotal}</span><small>Matcher</small></div>
              <div><span>{visibleTournaments.length}</span><small>Visade</small></div>
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}

type TvLinkDraft = {
  label: string;
  tournament_id: number | "";
  resource_id: number | "";
};

function LiveTvAdmin({ onNotice, onError }: { onNotice: NoticeHandler; onError: ErrorHandler }) {
  const [loading, setLoading] = useState(true);
  const [tvLinks, setTvLinks] = useState<TvLink[]>([]);
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [drafts, setDrafts] = useState<Record<number, TvLinkDraft>>({});

  const resetDrafts = (links: TvLink[]) => {
    const nextDrafts: Record<number, TvLinkDraft> = {};
    for (const link of links) {
      nextDrafts[link.id] = {
        label: link.label || "Live TV",
        tournament_id: link.tournament_id || "",
        resource_id: link.resource_id || "",
      };
    }
    setDrafts(nextDrafts);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<{ tv_links: TvLink[]; tournaments: TournamentSummary[]; resources: Resource[] }>("/api/tv-links");
      const links = payload.tv_links || [];
      setTvLinks(links);
      setTournaments(payload.tournaments || []);
      setResources(payload.resources || []);
      resetDrafts(links);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const boundCount = tvLinks.filter((link) => link.tournament_id).length;
  const waitingCount = tvLinks.length - boundCount;
  const resourcesForTournament = (tournamentId: number | "") => {
    const id = Number(tournamentId);
    if (!id) return [];
    return resources.filter((resource) => Number(resource.tournament_id) === id);
  };
  const bindingLabel = (link: TvLink) => {
    if (!link.tournament_id) return "Ansluten, väntar på information";
    return link.resource_name
      ? `${link.tournament_name} · ${link.resource_name}`
      : `${link.tournament_name} · alla resurser`;
  };
  const tvUrl = (link: TvLink) => `${location.origin}/tv/${link.code}`;

  const createTvLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      await api("/api/tv-links", { method: "POST", body: formPayload(form) });
      form.reset();
      onNotice("Live TV-länk skapad.");
      await load();
    } catch (error) {
      onError(error);
    }
  };

  const updateDraft = (linkId: number, patch: Partial<TvLinkDraft>) => {
    setDrafts((current) => ({ ...current, [linkId]: { ...current[linkId], ...patch } }));
  };

  const saveLink = async (event: FormEvent<HTMLFormElement>, link: TvLink) => {
    event.preventDefault();
    const draft = drafts[link.id];
    if (!draft) return;
    try {
      await api(`/api/tv-links/${link.id}`, { method: "PATCH", body: draft });
      onNotice("Live TV-bindning uppdaterad.");
      await load();
    } catch (error) {
      onError(error);
    }
  };

  return (
    <>
      <section className="page-head">
        <div>
          <p className="eyebrow">Instans</p>
          <h1>Live TV</h1>
          <p>{tvLinks.length} länkar · {boundCount} bundna · {waitingCount} väntar</p>
        </div>
        <a className="button primary" href="#new-tv-link">Lägg till ny Live TV</a>
      </section>

      <section className="tv-admin-page">
        <div className="tv-admin-main">
          <section className="panel" id="new-tv-link">
            <div className="panel-head">
              <div><h2>Ny Live TV-länk</h2><p>Skapa en publik skärmlänk med automatisk eller egen kod.</p></div>
            </div>
            <form className="inline-form tv-create-form" onSubmit={createTvLink}>
              <label>Etikett <input name="label" placeholder="Entré, hallskärm eller stream" /></label>
              <label>Egen kod <input name="code" maxLength={10} pattern="[A-Za-z0-9]{10}" placeholder="10 tecken, valfritt" /></label>
              <button type="submit">Skapa länk</button>
            </form>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div><h2>TV-länkar</h2><p>Uppdateringar slår igenom direkt på anslutna skärmar.</p></div>
              <span className="count-pill">{tvLinks.length}</span>
            </div>
            {loading ? <p className="empty">Laddar Live TV-länkar...</p> : null}
            {!loading && !tvLinks.length ? <p className="empty">Inga TV-länkar ännu.</p> : null}
            {!loading && tvLinks.length ? (
              <div className="tv-link-grid">
                {tvLinks.map((link) => {
                  const draft = drafts[link.id];
                  return (
                    <article key={link.id} className="tv-link-card">
                      <header>
                        <div>
                          <span className="code-chip">{link.code}</span>
                          <h3>{link.label}</h3>
                          <p>{bindingLabel(link)}</p>
                        </div>
                        <span className={`status-badge ${link.tournament_id ? "success" : "neutral"}`}>{link.tournament_id ? "Aktiv" : "Väntar"}</span>
                      </header>
                      <div className="tv-link-url">
                        <input value={tvUrl(link)} readOnly aria-label="TV-länk" />
                        <a className="button subtle" href={`/tv/${link.code}`} target="_blank" rel="noreferrer">Öppna</a>
                      </div>
                      {draft ? (
                        <form className="binding-form" onSubmit={(event) => saveLink(event, link)}>
                          <label>Etikett <input value={draft.label} onChange={(event) => updateDraft(link.id, { label: event.target.value })} /></label>
                          <label>
                            Turnering
                            <select
                              value={draft.tournament_id}
                              onChange={(event) => updateDraft(link.id, { tournament_id: Number(event.target.value) || "", resource_id: "" })}
                            >
                              <option value="">Ingen bindning</option>
                              {tournaments.map((tournament) => (
                                <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Resurs
                            <select
                              value={draft.resource_id}
                              disabled={!draft.tournament_id}
                              onChange={(event) => updateDraft(link.id, { resource_id: Number(event.target.value) || "" })}
                            >
                              <option value="">Alla arenor/servrar</option>
                              {resourcesForTournament(draft.tournament_id).map((resource) => (
                                <option key={resource.id} value={resource.id}>{resource.name} · {resourceKindText(resource.kind)}</option>
                              ))}
                            </select>
                          </label>
                          <button type="submit">Uppdatera live</button>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        </div>

        <aside className="side-stack">
          <section className="panel">
            <h2>Överblick</h2>
            <div className="side-metrics">
              <div><span>{tvLinks.length}</span><small>Länkar</small></div>
              <div><span>{boundCount}</span><small>Aktiva</small></div>
              <div><span>{waitingCount}</span><small>Väntar</small></div>
              <div><span>{tournaments.length}</span><small>Turneringar</small></div>
            </div>
          </section>
          <section className="panel">
            <h2>Senaste länkar</h2>
            <div className="mini-list">
              {!tvLinks.length ? <p className="empty">Inga länkar skapade.</p> : null}
              {tvLinks.slice(0, 5).map((link) => (
                <article key={link.id}>
                  <div><strong>{link.label}</strong><small>{link.code} · {link.tournament_name || "väntar"}</small></div>
                  <span className={`status-badge ${link.tournament_id ? "success" : "neutral"}`}>{link.tournament_id ? "Aktiv" : "Väntar"}</span>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}

function TournamentView({
  id,
  routeHash,
  onNotice,
  onError,
  onNavigate,
}: {
  id: string;
  routeHash: string;
  onNotice: NoticeHandler;
  onError: ErrorHandler;
  onNavigate: (path: string) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoreDialog, setScoreDialog] = useState<Match | null>(null);
  const [participantFilter, setParticipantFilter] = useState<ParticipantFilter>("all");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<DashboardData>(`/api/tournaments/${id}`));
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [id, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/events/${id}`);
    for (const eventName of liveEventNames) eventSource.addEventListener(eventName, () => void load());
    return () => eventSource.close();
  }, [id, load]);

  const activeSection = tournamentSectionFromHash(routeHash);
  const showSection = (section: string) => activeSection === section;

  const tournament = data?.tournament;
  const participants = data?.participants || [];
  const resources = data?.resources || [];
  const standings = data?.standings || [];
  const matches = data?.matches || [];
  const sortedMatches = useMemo(() => sortBySchedule(matches), [matches]);
  const completedMatches = matches.filter((match) => match.status === "completed");
  const openMatches = matches.filter((match) => match.status !== "completed");
  const currentMatches = data?.current_matches || [];
  const upcomingMatches = data?.upcoming_matches || [];
  const moderators = data?.moderators || [];
  const events = data?.events || [];
  const statusCounts = {
    all: matches.length,
    live: matches.filter((match) => match.status === "in_progress").length,
    upcoming: matches.filter((match) => match.status !== "completed" && match.status !== "in_progress").length,
    done: completedMatches.length,
    unplaced: matches.filter((match) => !match.resource_id || !match.scheduled_at).length,
  };
  const participantBreakdown = {
    teams: participants.filter((participant) => participant.kind !== "player").length,
    players: participants.filter((participant) => participant.kind === "player").length,
  };
  const seededParticipants = useMemo(
    () => [...participants].sort((a, b) => {
      const seedA = a.seed == null ? Number.MAX_SAFE_INTEGER : Number(a.seed);
      const seedB = b.seed == null ? Number.MAX_SAFE_INTEGER : Number(b.seed);
      return seedA - seedB || a.name.localeCompare(b.name);
    }),
    [participants],
  );
  const seededCount = participants.filter((participant) => participant.seed).length;
  const filteredParticipants = seededParticipants.filter((participant) => {
    if (participantFilter === "team") return participant.kind !== "player";
    if (participantFilter === "player") return participant.kind === "player";
    if (participantFilter === "seeded") return Boolean(participant.seed);
    return true;
  });
  const filteredMatches = sortedMatches.filter((match) => {
    if (matchFilter === "live") return match.status === "in_progress";
    if (matchFilter === "upcoming") return match.status !== "completed" && match.status !== "in_progress";
    if (matchFilter === "done") return match.status === "completed";
    if (matchFilter === "unplaced") return !match.resource_id || !match.scheduled_at;
    return true;
  });
  const selectedParticipant = filteredParticipants[0] || null;
  const resourcesWithMatches = resources.map((resource) => {
    const resourceMatches = sortedMatches.filter((match) => match.resource_id === resource.id);
    return {
      ...resource,
      matches: resourceMatches.slice(0, 5),
      hiddenMatchCount: Math.max(0, resourceMatches.length - 5),
    };
  });
  const allUnplacedMatches = sortedMatches.filter((match) => !match.resource_id || !match.scheduled_at);
  const unplacedMatches = allUnplacedMatches.slice(0, 6);
  const hiddenUnplacedCount = Math.max(0, allUnplacedMatches.length - unplacedMatches.length);
  const qualifiedRows: StandingRow[] = tournament
    ? standings.flatMap((standing) =>
        standing.rows.slice(0, Math.max(1, Number(tournament.qualifiers_per_group || 1))).map((row) => ({
          ...row,
          groupName: standing.group.name,
        })),
      )
    : [];
  const knockoutRounds: RoundGroup[] = [...new Set(matches.filter((match) => match.stage_kind === "knockout").map((match) => Number(match.round)))]
    .sort((a, b) => a - b)
    .map((round) => ({
      round,
      matches: matches.filter((match) => match.stage_kind === "knockout" && Number(match.round) === round),
    }));

  const groupNameForParticipant = (participantId: number) => {
    const standing = standings.find((groupTable) => groupTable.rows.some((row) => row.participant_id === participantId));
    return standing ? standing.group.name : "Ej lottad";
  };

  const submitForm = async (
    path: string,
    method: string,
    form: HTMLFormElement,
    message: string,
    reset = true,
  ) => {
    onNotice("Sparar...", "info");
    try {
      await api(path, { method, body: formPayload(form) });
      if (reset) form.reset();
      onNotice(message);
      await load();
    } catch (error) {
      onError(error);
    }
  };

  const postAction = async (path: string, message: string, body: Record<string, unknown> = {}) => {
    onNotice("Jobbar...", "info");
    try {
      await api(path, { method: "POST", body });
      onNotice(message);
      await load();
    } catch (error) {
      onError(error);
    }
  };

  const regenerateStructure = async () => {
    const confirmReset = matches.length > 0;
    if (
      confirmReset
      && !window.confirm("Det här bygger om gruppspel och slutspel. Befintliga matcher, resultat och schema ersätts.")
    ) {
      return;
    }
    await postAction(`/api/tournaments/${id}/generate`, "Bracket skapad.", { confirm_reset: confirmReset });
  };

  const openScoreDialog = (match: Match) => {
    if (match.status === "completed") {
      onNotice("Avslutade matcher är låsta för resultatändring.", "warning");
      return;
    }
    if (!canScoreMatch(match)) {
      onNotice("Matchen saknar lag och kan inte poängrapporteras.", "danger");
      return;
    }
    setScoreDialog({ ...match });
  };

  const saveMatchScore = async (
    event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>,
    matchId: number,
    complete = false,
  ) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = element instanceof HTMLFormElement ? element : element.form;
    if (!form || !form.reportValidity()) return;
    onNotice(complete ? "Avslutar match..." : "Sparar livepoäng...", "info");
    try {
      const action = complete ? "result" : "score";
      await api(`/api/tournaments/${id}/matches/${matchId}/${action}`, { method: "POST", body: formPayload(form) });
      onNotice(complete ? "Match avslutad." : "Livepoäng sparad.");
      setScoreDialog(null);
      await load();
    } catch (error) {
      onError(error);
    }
  };

  if (loading && !data) return <section className="panel">Laddar turnering...</section>;
  if (!data || !tournament) return <section className="panel">Kunde inte läsa turneringen.</section>;

  return (
    <>
      <section className="page-head tournament-title" data-tournament-id={tournament.id}>
        <div>
          <p className="eyebrow">{sectionLabels[`#${activeSection}`] || "Översikt"}</p>
          <h1>{tournament.name}</h1>
          <p>{formatDate(tournament.starts_at)} · {resources.length} platser · {participants.length} lag / deltagare</p>
        </div>
        <div className="actions">
          <a className="button subtle" href="#inställningar">Hantera turnering</a>
          <a className="button primary" href="/admin/tv" onClick={(event) => { event.preventDefault(); onNavigate("/admin/tv"); }}>Hantera Live TV</a>
        </div>
      </section>

      <nav className="tournament-tabs" aria-label="Turneringsdelar">
        <a href="#översikt" className={activeSection === "översikt" ? "active" : undefined}><span>Översikt</span><small>Status</small></a>
        <a href="#matcher" className={activeSection === "matcher" ? "active" : undefined}><span>Matcher</span><small>Poäng</small></a>
        <a href="#deltagare" className={activeSection === "deltagare" ? "active" : undefined}><span>Deltagare</span><small>Lag</small></a>
        <a href="#schema" className={activeSection === "schema" ? "active" : undefined}><span>Schema</span><small>Planer</small></a>
        <a href="#slutspel" className={activeSection === "slutspel" ? "active" : undefined}><span>Slutspel</span><small>Bracket</small></a>
        <a href="#moderatorer" className={activeSection === "moderatorer" ? "active" : undefined}><span>Moderatorer</span><small>Länkar</small></a>
        <a href="#inställningar" className={activeSection === "inställningar" ? "active" : undefined}><span>Inställningar</span><small>Tider</small></a>
      </nav>

      {showSection("översikt") ? (
        <section className="metric-grid">
          <article className="metric-card blue"><span aria-hidden="true" /><div><small>Totalt deltagare</small><strong>{participants.length}</strong><p>{Math.ceil(participants.length / Math.max(tournament.group_count, 1)) || 0} per grupp</p></div></article>
          <article className="metric-card green"><span aria-hidden="true" /><div><small>Aktiva matcher</small><strong>{currentMatches.length}</strong><p>Pågår nu</p></div></article>
          <article className="metric-card amber"><span aria-hidden="true" /><div><small>Kommande matcher</small><strong>{upcomingMatches.length}</strong><p>Schemalagda</p></div></article>
          <article className="metric-card purple"><span aria-hidden="true" /><div><small>Avslutade</small><strong>{completedMatches.length}</strong><p>{matches.length} totalt</p></div></article>
        </section>
      ) : null}

      <section className={`dashboard-layout ${activeSection !== "översikt" && activeSection !== "matcher" ? "single-pane" : ""}`}>
        <div className="dashboard-main">
          {showSection("översikt") || showSection("matcher") ? (
            <section className="panel" id="matcher">
              <div className="panel-head">
                <div><h2>Aktuella och kommande matcher</h2><p>{openMatches.length} öppna · {completedMatches.length} avslutade</p></div>
                <a href="#alla-matcher">Se alla matcher</a>
              </div>
              <table className="admin-table compact-table">
                <thead><tr><th>Match</th><th>Grupp / omgång</th><th>Tid</th><th>Status</th><th>Plats</th></tr></thead>
                <tbody>
                  {!sortedMatches.length ? <tr><td colSpan={5}>Inga matcher är schemalagda ännu.</td></tr> : null}
                  {sortedMatches.slice(0, 6).map((match) => (
                    <tr key={match.id}>
                      <td><span className={`row-dot ${statusTone(match.status)}`} /><strong>{match.side_a}</strong><span className="vs">vs</span><strong>{match.side_b}</strong></td>
                      <td>{match.group_name || match.stage_name || match.name}</td>
                      <td>{match.time_label}</td>
                      <td><StatusBadge status={match.status} /></td>
                      <td>{match.resource_name || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {showSection("översikt") || showSection("slutspel") ? (
            <section className={showSection("slutspel") ? "section-grid bracket-page" : "split-panels"}>
              <section className="panel" id="slutspel">
                <div className="panel-head">
                  <div><h2>Slutspel - översikt</h2><p>{knockoutRounds.length ? `${knockoutRounds.length} rundor` : "Ingen bracket ännu"}</p></div>
                  {showSection("slutspel") ? <button className="button subtle" type="button" onClick={() => void regenerateStructure()}>Generera</button> : null}
                </div>
                {!knockoutRounds.length ? <p className="empty">Generera slutspel för att se bracket.</p> : null}
                {knockoutRounds.length ? (
                  <div className="bracket-preview">
                    {knockoutRounds.map((round) => (
                      <div key={round.round} className="bracket-round">
                        <h3>{roundTitle(round)}</h3>
                        {round.matches.map((match) => <article key={match.id}><span>{match.side_a}</span><span>{match.side_b}</span></article>)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="panel standings-panel" id="tabeller">
                <div className="panel-head"><h2>Tabeller</h2><span className="count-pill">{standings.length}</span></div>
                {!standings.length ? <p className="empty">Generera gruppspel för att se tabeller.</p> : null}
                {standings.length ? (
                  <div className="standings-grid">
                    {standings.map((standing) => (
                      <article key={standing.group.id}>
                        <h3>{standing.group.name}</h3>
                        <table className="admin-table compact-table">
                          <thead><tr><th>#</th><th>Lag</th><th>S</th><th>V</th><th>O</th><th>F</th><th>GM</th><th>IM</th><th>P</th></tr></thead>
                          <tbody>
                            {standing.rows.map((row) => (
                              <tr key={row.participant_id}><td>{row.rank}</td><td><strong>{row.name}</strong></td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.scored}</td><td>{row.conceded}</td><td><strong>{row.points}</strong></td></tr>
                            ))}
                          </tbody>
                        </table>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              {showSection("slutspel") ? (
                <section className="panel">
                  <div className="panel-head"><h2>Kvalificerade till slutspel</h2><span className="count-pill">{qualifiedRows.length}</span></div>
                  <div className="mini-list qualified-list">
                    {!qualifiedRows.length ? <p className="empty">Spela klart gruppspelet eller generera grupper för att se kvalificerade lag.</p> : null}
                    {qualifiedRows.map((row) => (
                      <article key={`${row.groupName}-${row.participant_id}`}><div><strong>{row.name}</strong><small>{row.groupName} · plats {row.rank}</small></div><span className="count-pill">{row.points} p</span></article>
                    ))}
                  </div>
                </section>
              ) : null}

              {showSection("slutspel") ? (
                <section className="panel quick-panel">
                  <h2>Slutspelsåtgärder</h2>
                  <button className="button ghost" type="button" onClick={() => void regenerateStructure()}>Bygg om bracket</button>
                  <button className="button ghost" type="button" onClick={() => void postAction(`/api/tournaments/${id}/schedule`, "Schema uppdaterat.")}>Schemalägg slutspel</button>
                </section>
              ) : null}
            </section>
          ) : null}

          {showSection("deltagare") ? (
            <section className="section-grid participant-page" id="deltagare">
              <section className="panel participant-list-panel">
                <div className="panel-head">
                  <div><h2>Deltagare</h2><p>{participantBreakdown.teams} lag · {participantBreakdown.players} individuella</p></div>
                  <span className="count-pill">{participants.length}</span>
                </div>
                <div className="filter-row">
                  <button type="button" className={`filter-chip ${participantFilter === "all" ? "active" : ""}`} aria-pressed={participantFilter === "all"} onClick={() => setParticipantFilter("all")}>Alla <strong>{participants.length}</strong></button>
                  <button type="button" className={`filter-chip ${participantFilter === "team" ? "active" : ""}`} aria-pressed={participantFilter === "team"} onClick={() => setParticipantFilter("team")}>Lag <strong>{participantBreakdown.teams}</strong></button>
                  <button type="button" className={`filter-chip ${participantFilter === "player" ? "active" : ""}`} aria-pressed={participantFilter === "player"} onClick={() => setParticipantFilter("player")}>Spelare <strong>{participantBreakdown.players}</strong></button>
                  <button type="button" className={`filter-chip ${participantFilter === "seeded" ? "active" : ""}`} aria-pressed={participantFilter === "seeded"} onClick={() => setParticipantFilter("seeded")}>Seedade <strong>{seededCount}</strong></button>
                </div>
                <form className="inline-form action-form" onSubmit={(event) => { event.preventDefault(); void submitForm(`/api/tournaments/${id}/participants`, "POST", event.currentTarget, "Deltagare tillagd."); }}>
                  <input name="name" required placeholder="Lag eller spelare" />
                  <select name="kind" defaultValue="team"><option value="team">Lag</option><option value="player">Spelare</option></select>
                  <input name="seed" type="number" min="1" placeholder="Seed" />
                  <button type="submit">Lägg till deltagare</button>
                </form>
                <div className="table-scroll">
                  <table className="admin-table compact-table participant-table">
                    <thead><tr><th>Seed</th><th>Namn</th><th>Typ</th><th>Status</th></tr></thead>
                    <tbody>
                      {!filteredParticipants.length ? <tr><td colSpan={4}>Inga deltagare matchar filtret.</td></tr> : null}
                      {filteredParticipants.map((participant) => (
                        <tr key={participant.id}>
                          <td>{participant.seed || "-"}</td>
                          <td className="participant-name-cell">
                            <div className="table-name">
                              <span className="avatar-chip">{initials(participant.name)}</span>
                              <strong title={participant.name}>{participant.name}</strong>
                            </div>
                          </td>
                          <td>{participantKindText(participant.kind)}</td>
                          <td><span className="status-badge success">Registrerad</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="side-stack">
                <section className="panel detail-panel">
                  {selectedParticipant ? (
                    <>
                      <div className="detail-hero"><span className="card-symbol tone-1">{initials(selectedParticipant.name)}</span><div><h2>{selectedParticipant.name}</h2><p>{participantKindText(selectedParticipant.kind)}</p></div></div>
                      <dl className="detail-list">
                        <div><dt>Seed</dt><dd>{selectedParticipant.seed || "-"}</dd></div>
                        <div><dt>Grupp</dt><dd>{groupNameForParticipant(selectedParticipant.id)}</dd></div>
                        <div><dt>Status</dt><dd><span className="status-badge success">Registrerad</span></dd></div>
                      </dl>
                    </>
                  ) : <p className="empty">Lägg till deltagare för att se detaljer.</p>}
                </section>
                <section className="panel">
                  <h2>Gruppfördelning</h2>
                  <div className="mini-list">
                    {!standings.length ? <p className="empty">Generera gruppspel för att se grupper.</p> : null}
                    {standings.map((standing) => (
                      <article key={standing.group.id}><div><strong>{standing.group.name}</strong><small>{standing.rows.length} deltagare</small></div><span className="count-pill">{standing.rows.length}</span></article>
                    ))}
                  </div>
                </section>
              </aside>
            </section>
          ) : null}

          {showSection("schema") ? (
            <section className="section-grid schedule-page" id="schema">
              <section className="panel">
                <div className="panel-head"><div><h2>Schema</h2><p>{resources.length} resurser · {statusCounts.unplaced} ej placerade matcher</p></div><span className="count-pill">{matches.length}</span></div>
                <div className="schedule-board">
                  {resourcesWithMatches.map((resource) => (
                    <article key={resource.id} className="resource-column">
                      <header><strong>{resource.name}</strong><small>{resourceKindText(resource.kind)} · {resource.active ? "Aktiv" : "Pausad"}</small></header>
                      {!resource.matches.length ? <p className="empty">Inga matcher placerade.</p> : null}
                      {resource.matches.map((match) => (
                        <div className="resource-match" key={match.id}>
                          <strong>{match.side_a} <span>vs</span> {match.side_b}</strong>
                          <small>{match.time_label} · {match.group_name || match.stage_name || match.name}</small>
                        </div>
                      ))}
                      {resource.hiddenMatchCount ? <p className="list-more">{moreText(resource.hiddenMatchCount, "match", "matcher")} på {resource.name}</p> : null}
                    </article>
                  ))}
                  {!resources.length ? <p className="empty">Lägg till en spelplan eller server för att bygga schema.</p> : null}
                </div>
              </section>

              <aside className="side-stack">
                <section className="panel">
                  <h2>Ny resurs</h2>
                  <form className="stack" onSubmit={(event) => { event.preventDefault(); void submitForm(`/api/tournaments/${id}/resources`, "POST", event.currentTarget, "Resurs tillagd."); }}>
                    <label>Namn <input name="name" required placeholder="Plan 1" /></label>
                    <label>Typ <select name="kind" defaultValue="court"><option value="court">Spelplan</option><option value="server">Server</option><option value="table">Bord</option></select></label>
                    <button type="submit">Lägg till resurs</button>
                  </form>
                </section>
                <section className="panel">
                  <div className="panel-head"><h2>Ej placerade</h2><span className="count-pill">{statusCounts.unplaced}</span></div>
                  <div className="mini-list">
                    {!unplacedMatches.length ? <p className="empty">Alla spelbara matcher har en plats.</p> : null}
                    {unplacedMatches.map((match) => <article key={match.id}><div><strong>{match.side_a} vs {match.side_b}</strong><small>{match.group_name || match.stage_name || match.name}</small></div></article>)}
                    {hiddenUnplacedCount ? <p className="list-more">{moreText(hiddenUnplacedCount, "match", "matcher")} saknar plats</p> : null}
                  </div>
                </section>
                <section className="panel quick-panel">
                  <h2>Schemaåtgärder</h2>
                  <button className="button ghost" type="button" onClick={() => void regenerateStructure()}>Generera gruppspel och slutspel</button>
                  <button className="button ghost" type="button" onClick={() => void postAction(`/api/tournaments/${id}/schedule`, "Schema uppdaterat.")}>Autoschemalägg matcher</button>
                </section>
              </aside>
            </section>
          ) : null}

          {showSection("matcher") || showSection("schema") ? (
            <section className="panel" id="alla-matcher">
              <div className="panel-head"><h2>Alla matcher</h2><span className="count-pill">{matches.length}</span></div>
              <div className="filter-row match-status-row">
                <button type="button" className={`filter-chip ${matchFilter === "all" ? "active" : ""}`} aria-pressed={matchFilter === "all"} onClick={() => setMatchFilter("all")}>Alla <strong>{statusCounts.all}</strong></button>
                <button type="button" className={`filter-chip ${matchFilter === "live" ? "active" : ""}`} aria-pressed={matchFilter === "live"} onClick={() => setMatchFilter("live")}>Pågår <strong>{statusCounts.live}</strong></button>
                <button type="button" className={`filter-chip ${matchFilter === "upcoming" ? "active" : ""}`} aria-pressed={matchFilter === "upcoming"} onClick={() => setMatchFilter("upcoming")}>Kommande <strong>{statusCounts.upcoming}</strong></button>
                <button type="button" className={`filter-chip ${matchFilter === "done" ? "active" : ""}`} aria-pressed={matchFilter === "done"} onClick={() => setMatchFilter("done")}>Avslutade <strong>{statusCounts.done}</strong></button>
                <button type="button" className={`filter-chip ${matchFilter === "unplaced" ? "active" : ""}`} aria-pressed={matchFilter === "unplaced"} onClick={() => setMatchFilter("unplaced")}>Ej placerade <strong>{statusCounts.unplaced}</strong></button>
              </div>
              <table className="matches admin-table">
                <thead><tr><th>Match</th><th>Deltagare</th><th>Tid och plats</th><th>Status</th><th>Resultat</th><th>Åtgärder</th></tr></thead>
                <tbody>
                  {!filteredMatches.length ? <tr><td colSpan={6}>Inga matcher matchar filtret.</td></tr> : null}
                  {filteredMatches.map((match) => (
                    <tr key={match.id}>
                      <td><strong>{match.name}</strong><small>{match.stage_name}{match.group_name ? ` · ${match.group_name}` : ""}</small></td>
                      <td><strong>{match.side_a}</strong><span className="vs">vs</span><strong>{match.side_b}</strong></td>
                      <td><span>{match.time_label}</span><small>{match.resource_name || "Ej placerad"}</small></td>
                      <td><StatusBadge status={match.status} /></td>
                      <td><strong>{match.score_label}</strong></td>
                      <td>
                        <div className="row-action-buttons">
                          {canScoreMatch(match)
                            ? <button type="button" className="button subtle" onClick={() => openScoreDialog(match)}>Poäng</button>
                            : <span className="form-hint compact">{match.status === "completed" ? "Låst" : "Inväntar lag"}</span>}
                        </div>
                        <details className="row-actions">
                          <summary>Tid</summary>
                          <form className="tiny-form slot-form" onSubmit={(event) => { event.preventDefault(); void submitForm(`/api/tournaments/${id}/matches/${match.id}/slot`, "PATCH", event.currentTarget, "Match flyttad."); }}>
                            <input name="scheduled_at" type="datetime-local" defaultValue={match.scheduled_at || tournament.starts_at || ""} required />
                            <select name="resource_id" defaultValue={match.resource_id || ""} required>
                              <option value="" disabled>Välj plats</option>
                              {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                            </select>
                            <input name="duration_minutes" type="number" min="1" defaultValue={match.duration_minutes} />
                            <button type="submit">Spara tid</button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {showSection("inställningar") ? (
            <section className="section-grid settings-page">
              <form className="settings-grid" id="inställningar" onSubmit={(event) => { event.preventDefault(); void submitForm(`/api/tournaments/${id}/settings`, "PATCH", event.currentTarget, "Inställningar sparade.", false); }}>
                <section className="panel">
                  <div className="panel-head"><h2>Grundläggande information</h2></div>
                  <label>Start <input name="starts_at" type="datetime-local" defaultValue={tournament.starts_at || ""} /></label>
                  <p className="form-hint">Starttiden används som bas när matcher schemaläggs automatiskt.</p>
                </section>
                <section className="panel">
                  <div className="panel-head"><h2>Matchinställningar</h2></div>
                  <div className="form-grid two"><label>Matchminuter <input name="match_minutes" type="number" min="1" defaultValue={tournament.match_minutes} /></label><label>Vila minuter <input name="break_minutes" type="number" min="0" defaultValue={tournament.break_minutes} /></label></div>
                  <p className="form-hint">Längd och vila används både för nytt schema och manuell flytt av matcher.</p>
                </section>
                <section className="panel">
                  <div className="panel-head"><h2>Turneringsstruktur</h2></div>
                  <div className="form-grid two"><label>Grupper <input name="group_count" type="number" min="1" defaultValue={tournament.group_count} /></label><label>Vidare/grupp <input name="qualifiers_per_group" type="number" min="1" defaultValue={tournament.qualifiers_per_group} /></label></div>
                  <p className="form-hint">Ändra detta innan du bygger om gruppspel och slutspel.</p>
                </section>
                <section className="panel settings-save">
                  <h2>Spara ändringar</h2>
                  <button type="submit">Spara inställningar</button>
                </section>
              </form>

              <aside className="side-stack">
                <section className="panel quick-panel">
                  <h2>Turneringsåtgärder</h2>
                  <button className="button ghost" type="button" onClick={() => void regenerateStructure()}>Generera gruppspel och slutspel</button>
                  <button className="button ghost" type="button" onClick={() => void postAction(`/api/tournaments/${id}/schedule`, "Schema uppdaterat.")}>Autoschemalägg matcher</button>
                  <a className="button ghost" href="#moderatorer">Skapa moderatorlänk</a>
                </section>
                <section className="panel">
                  <h2>Aktuell struktur</h2>
                  <dl className="detail-list">
                    <div><dt>Grupper</dt><dd>{tournament.group_count}</dd></div>
                    <div><dt>Vidare/grupp</dt><dd>{tournament.qualifiers_per_group}</dd></div>
                    <div><dt>Matcher</dt><dd>{matches.length}</dd></div>
                  </dl>
                </section>
              </aside>
            </section>
          ) : null}

          {showSection("moderatorer") ? (
            <section className="section-grid moderator-admin-page">
              <section className="panel" id="moderatorer">
                <div className="panel-head"><div><h2>Skapa moderatorlänk</h2><p>{resources.length} resurser kan begränsas</p></div><span className="count-pill">{moderators.length} aktiva</span></div>
                <form className="inline-form moderator-create-form" onSubmit={(event) => { event.preventDefault(); void submitForm(`/api/tournaments/${id}/moderators`, "POST", event.currentTarget, "Moderatorlänk skapad."); }}>
                  <label>Etikett <input name="label" required placeholder="Moderator plan 1" /></label>
                  <label>Scope <select name="resource_id" defaultValue=""><option value="">Alla resurser</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
                  <button type="submit">Skapa länk</button>
                </form>
              </section>

              <section className="panel moderator-links-panel">
                <div className="panel-head"><h2>Moderatorlänkar</h2><span className="count-pill">{moderators.length}</span></div>
                <table className="admin-table compact-table">
                  <thead><tr><th>Etikett</th><th>Scope</th><th>PIN</th><th>Status</th><th>Länk</th></tr></thead>
                  <tbody>
                    {!moderators.length ? <tr><td colSpan={5}>Inga moderatorer ännu.</td></tr> : null}
                    {moderators.map((moderator) => (
                      <tr key={moderator.id}>
                        <td><strong>{moderator.label}</strong></td>
                        <td>{moderator.resource_name || "Alla resurser"}</td>
                        <td><code>{moderator.pin}</code></td>
                        <td><span className="status-badge success">Aktiv</span></td>
                        <td><a href={`/m/${moderator.token}`}>Öppna</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <aside className="side-stack">
                <section className="panel share-card">
                  <h2>Dela med moderator</h2>
                  {moderators[0] ? (
                    <>
                      <div className="share-link"><span>/m/{moderators[0].token}</span><a href={`/m/${moderators[0].token}`}>Öppna</a></div>
                      <div className="qr-placeholder" aria-hidden="true"><span>T</span></div>
                      <p>{moderators[0].label}</p>
                    </>
                  ) : <p className="empty">Skapa en länk för att visa delning.</p>}
                </section>
                <section className="panel">
                  <h2>Senaste aktivitet</h2>
                  <div className="activity-list">
                    <article><span className="activity-icon green" /><div><strong>{participants.length} deltagare registrerade</strong><small>Aktuell deltagarlista</small></div></article>
                    {!events.length ? <p className="empty">Inga händelser ännu.</p> : null}
                    {events.slice(0, 5).map((event) => <article key={event.id}><span className="activity-icon blue" /><div><strong>{eventText[event.kind] || event.kind}</strong><small>{formatTime(event.created_at)}</small></div></article>)}
                  </div>
                </section>
              </aside>
            </section>
          ) : null}
        </div>

        {showSection("översikt") || showSection("matcher") ? (
          <aside className="dashboard-side">
            <section className="panel quick-panel">
              <h2>Snabbåtgärder</h2>
              <button className="button ghost" type="button" onClick={() => void regenerateStructure()}>Generera gruppspel och slutspel</button>
              <button className="button ghost" type="button" onClick={() => void postAction(`/api/tournaments/${id}/schedule`, "Schema uppdaterat.")}>Autoschemalägg matcher</button>
              <a className="button ghost" href="/admin/tv" onClick={(event) => { event.preventDefault(); onNavigate("/admin/tv"); }}>Hantera Live TV</a>
            </section>

            {showSection("översikt") ? (
              <section className="panel">
                <h2>Senaste aktivitet</h2>
                <div className="activity-list">
                  <article><span className="activity-icon green" /><div><strong>{participants.length} deltagare registrerade</strong><small>Aktuell deltagarlista</small></div></article>
                  {!events.length ? <p className="empty">Inga händelser ännu.</p> : null}
                  {events.slice(0, 6).map((event) => <article key={event.id}><span className="activity-icon blue" /><div><strong>{eventText[event.kind] || event.kind}</strong><small>{formatTime(event.created_at)}</small></div></article>)}
                </div>
              </section>
            ) : null}
          </aside>
        ) : null}
      </section>

      {scoreDialog ? (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setScoreDialog(null); }}>
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="score-dialog-title">
            <div className="modal-head">
              <div>
                <p className="eyebrow">{scoreDialog.group_name || scoreDialog.stage_name || scoreDialog.name}</p>
                <h2 id="score-dialog-title">Rapportera poäng</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Stäng" onClick={() => setScoreDialog(null)}>×</button>
            </div>
            <div className="score-matchup">
              <strong>{scoreDialog.side_a}</strong>
              <span>vs</span>
              <strong>{scoreDialog.side_b}</strong>
            </div>
            <form className="score-dialog-form" onSubmit={(event) => void saveMatchScore(event, scoreDialog.id, false)}>
              <label>{scoreDialog.side_a} <input name="score_a" type="number" min="0" required placeholder="0" defaultValue={scoreDialog.score_a == null ? "" : scoreDialog.score_a} aria-label="Poäng A" /></label>
              <label>{scoreDialog.side_b} <input name="score_b" type="number" min="0" required placeholder="0" defaultValue={scoreDialog.score_b == null ? "" : scoreDialog.score_b} aria-label="Poäng B" /></label>
              <div className="modal-actions">
                <button type="submit" disabled={scoreDialog.status === "completed"}>Spara livepoäng</button>
                <button type="button" className="button primary" disabled={scoreDialog.status === "completed"} onClick={(event) => void saveMatchScore(event, scoreDialog.id, true)}>Avsluta match</button>
                <button type="button" className="button subtle" onClick={() => setScoreDialog(null)}>Avbryt</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

type ModeratorPayload = {
  authorized: boolean;
  moderator: Moderator;
  matches: Match[];
};

function ModeratorView({
  token,
  notice,
  onNotice,
  onError,
  onClear,
}: {
  token: string;
  notice: Notice;
  onNotice: NoticeHandler;
  onError: ErrorHandler;
  onClear: () => void;
}) {
  const [data, setData] = useState<ModeratorPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moderatorFilter, setModeratorFilter] = useState<ModeratorMatchFilter>("all");
  const [moderatorQuery, setModeratorQuery] = useState("");

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setData(await api<ModeratorPayload>(`/api/moderators/${token}`));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      onError(error);
    }
  }, [onError, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.authorized) return undefined;
    const eventSource = new EventSource(`/api/events/${data.moderator.tournament_id}`);
    for (const eventName of ["score_updated", "result_updated", "schedule_updated", "structure_generated", "bracket_seeded", "settings_updated"]) {
      eventSource.addEventListener(eventName, () => void load());
    }
    return () => eventSource.close();
  }, [data?.authorized, data?.moderator.tournament_id, load]);

  const moderatorMatches = data?.matches || [];
  const moderatorCounts = {
    all: moderatorMatches.length,
    live: moderatorMatches.filter((match) => match.status === "in_progress").length,
    upcoming: moderatorMatches.filter((match) => match.status !== "in_progress").length,
  };
  const normalizedModeratorQuery = moderatorQuery.trim().toLowerCase();
  const statusFilteredModeratorMatches = moderatorMatches.filter((match) => {
    if (moderatorFilter === "live") return match.status === "in_progress";
    if (moderatorFilter === "upcoming") return match.status !== "in_progress";
    return true;
  });
  const filteredModeratorMatches = statusFilteredModeratorMatches.filter((match) => {
    if (!normalizedModeratorQuery) return true;
    return [
      match.side_a,
      match.side_b,
      match.group_name,
      match.stage_name,
      match.name,
      match.resource_name,
      match.time_label,
    ].some((value) => String(value || "").toLowerCase().includes(normalizedModeratorQuery));
  });

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await api(`/api/moderators/${token}/login`, { method: "POST", body: formPayload(event.currentTarget) });
      onNotice("Moderator öppnad.");
      await load();
    } catch (error) {
      onError(error);
    }
  };

  const saveScore = async (
    event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>,
    matchId: number,
    complete = false,
  ) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = element instanceof HTMLFormElement ? element : element.form;
    if (!form || !form.reportValidity()) return;
    onNotice(complete ? "Avslutar match..." : "Sparar livepoäng...", "info");
    try {
      const action = complete ? "result" : "score";
      await api(`/api/moderators/${token}/matches/${matchId}/${action}`, { method: "POST", body: formPayload(form) });
      onNotice(complete ? "Match avslutad." : "Livepoäng sparad.");
      await load();
    } catch (error) {
      onError(error);
    }
  };

  return (
    <main className="page moderator-page">
      <NoticeBox notice={notice} onClear={onClear} />
      {!data && !loadError ? <section className="panel">Laddar moderatorvy...</section> : null}
      {!data && loadError ? (
        <section className="panel narrow">
          <p className="eyebrow">Moderator</p>
          <h1>Moderatorlänken kunde inte öppnas</h1>
          <p>{loadError}</p>
          <a className="button subtle" href="/">Till startsidan</a>
        </section>
      ) : null}
      {data ? (
        <>
          <section className="page-head" data-tournament-id={data.moderator.tournament_id}>
            <div>
              <p className="eyebrow">Moderator</p>
              <h1>{data.moderator.label}</h1>
              <p>{data.moderator.tournament_name} · {data.moderator.resource_name || "Alla resurser"}</p>
            </div>
            {data.authorized ? <button type="button" className="button subtle" onClick={() => void load()}>Uppdatera</button> : null}
          </section>

          {data.authorized ? (
            <section className="moderator-shell">
              <aside className="panel moderator-side-card">
                <h2>Moderator-PIN</h2>
                <span className="status-badge success">Aktiv</span>
                <dl className="detail-list">
                  <div><dt>Inloggad som</dt><dd>{data.moderator.label}</dd></div>
                  <div><dt>Scope</dt><dd>{data.moderator.resource_name || "Alla resurser"}</dd></div>
                  <div><dt>Matcher</dt><dd>{moderatorCounts.all}</dd></div>
                </dl>
              </aside>

              <section className="moderator-main">
                <div className="toolbar">
                  <label className="search-field">
                    <span>⌕</span>
                    <input value={moderatorQuery} onChange={(event) => setModeratorQuery(event.target.value)} type="search" placeholder="Sök matcher..." aria-label="Sök matcher" />
                  </label>
                  <button className="button subtle" type="button" onClick={() => { setModeratorQuery(""); setModeratorFilter("all"); }}>Rensa filter</button>
                </div>
                <div className="filter-row">
                  <button type="button" className={`filter-chip ${moderatorFilter === "all" ? "active" : ""}`} aria-pressed={moderatorFilter === "all"} onClick={() => setModeratorFilter("all")}>Alla matcher <strong>{moderatorCounts.all}</strong></button>
                  <button type="button" className={`filter-chip ${moderatorFilter === "live" ? "active" : ""}`} aria-pressed={moderatorFilter === "live"} onClick={() => setModeratorFilter("live")}>Pågår <strong>{moderatorCounts.live}</strong></button>
                  <button type="button" className={`filter-chip ${moderatorFilter === "upcoming" ? "active" : ""}`} aria-pressed={moderatorFilter === "upcoming"} onClick={() => setModeratorFilter("upcoming")}>Kommande <strong>{moderatorCounts.upcoming}</strong></button>
                </div>
                {!filteredModeratorMatches.length ? <p className="panel empty">Inga matcher matchar filtret.</p> : null}
                {filteredModeratorMatches.map((match, index) => (
                  <article key={match.id} className={`panel moderator-match-card ${index === 0 ? "expanded" : ""}`}>
                    <header>
                      <div><strong>{match.time_label}</strong><small>{match.resource_name || "-"}</small></div>
                      <div className="moderator-match-title"><strong>{match.side_a}</strong><span className="vs">vs</span><strong>{match.side_b}</strong><small>{match.group_name || match.stage_name || match.name}</small></div>
                      <StatusBadge status={match.status} />
                    </header>
                    <form className="moderator-score-card" onSubmit={(event) => void saveScore(event, match.id, false)}>
                      <label>{match.side_a} <input name="score_a" type="number" min="0" required placeholder="0" defaultValue={match.score_a == null ? "" : match.score_a} aria-label="Poäng A" /></label>
                      <span className="score-separator">-</span>
                      <label>{match.side_b} <input name="score_b" type="number" min="0" required placeholder="0" defaultValue={match.score_b == null ? "" : match.score_b} aria-label="Poäng B" /></label>
                      <div className="modal-actions">
                        <button type="submit">Spara livepoäng</button>
                        <button type="button" className="button subtle danger-action" onClick={(event) => void saveScore(event, match.id, true)}>Avsluta match</button>
                      </div>
                    </form>
                  </article>
                ))}
              </section>
            </section>
          ) : (
            <section className="panel narrow">
              <h2>Moderator-PIN</h2>
              <form className="stack" onSubmit={login}>
                <label>PIN <input name="pin" type="password" required autoFocus /></label>
                <button type="submit">Öppna</button>
              </form>
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}

type SessionPayload = {
  is_admin: boolean;
  admin_pin_default: boolean;
};

export function AdminApp() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [route, setRoute] = useState(location.pathname);
  const [routeHash, setRouteHash] = useState(normalizedHash());
  const [notice, setNotice] = useState<Notice>(null);

  const showNotice = useCallback<NoticeHandler>((message, type = "success") => {
    setNotice({ message, type });
  }, []);

  const showError = useCallback<ErrorHandler>((error) => {
    setNotice({ message: error instanceof Error ? error.message : String(error), type: "danger" });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const refreshSession = useCallback(async () => {
    try {
      setSession(await api<SessionPayload>("/api/session"));
    } catch (error) {
      showError(error);
    }
  }, [showError]);

  const navigate = useCallback((path: string) => {
    if (path === location.pathname) return;
    history.pushState({}, "", path);
    setRoute(path);
    setRouteHash(normalizedHash());
    setNotice(null);
    resetTournamentScroll();
  }, []);

  useEffect(() => {
    void refreshSession();
    const onPopState = () => {
      setRoute(location.pathname);
      setRouteHash(normalizedHash());
      resetTournamentScroll();
    };
    const onHashChange = () => {
      setRouteHash(normalizedHash());
      resetTournamentScroll();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    resetTournamentScroll();
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [refreshSession]);

  useEffect(() => {
    if (session?.is_admin) {
      document.body.className = "is-authenticated";
    } else if (route.startsWith("/m/")) {
      document.body.className = "is-moderator";
    } else {
      document.body.className = "is-guest";
    }
  }, [route, session]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = route && !["/", "/login"].includes(route) ? route : "/admin";
    try {
      await api("/api/admin/login", { method: "POST", body: formPayload(event.currentTarget) });
      await refreshSession();
      navigate(target);
    } catch (error) {
      showError(error);
    }
  };

  const logout = async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
      await refreshSession();
      navigate("/");
    } catch (error) {
      showError(error);
    }
  };

  const tournamentId = route.startsWith("/tournaments/") ? route.split("/")[2] || null : null;
  const activeNav = route === "/admin/tv" ? "Live TV" : tournamentId ? sectionLabels[routeHash] || "Översikt" : "Turneringar";

  if (!session) {
    return <section className="page guest-page"><section className="panel narrow">Laddar...</section></section>;
  }

  if (route.startsWith("/m/")) {
    return (
      <ModeratorView
        token={route.split("/")[2]}
        notice={notice}
        onNotice={showNotice}
        onError={showError}
        onClear={clearNotice}
      />
    );
  }

  if (!session.is_admin) {
    return <LoginView notice={notice} onLogin={login} onClear={clearNotice} />;
  }

  return (
    <AdminShell
      active={activeNav}
      tournamentId={tournamentId}
      notice={notice}
      onNavigate={navigate}
      onLogout={logout}
      onNotice={showNotice}
      onClear={clearNotice}
    >
      {route === "/admin/tv" ? <LiveTvAdmin onNotice={showNotice} onError={showError} /> : null}
      {route !== "/admin/tv" && tournamentId ? (
        <TournamentView id={tournamentId} routeHash={routeHash} onNavigate={navigate} onNotice={showNotice} onError={showError} />
      ) : null}
      {route !== "/admin/tv" && !tournamentId ? <AdminHome onNavigate={navigate} onNotice={showNotice} onError={showError} /> : null}
    </AdminShell>
  );
}
