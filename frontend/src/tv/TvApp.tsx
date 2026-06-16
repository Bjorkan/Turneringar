import { mdiTelevisionPlay } from "@mdi/js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../shared/api";
import {
  formatClock,
  formatDate,
  initials,
  resourceKindText,
  sortBySchedule,
  statusText,
} from "../shared/format";
import { MdiIcon } from "../shared/MdiIcon";
import type { Match, TvPayload } from "../shared/types";

const tvCode = location.pathname.split("/").pop() || "";
const slideSeconds = 10;
const slides = ["live", "tables", "schedule"];
const tvEventNames = [
  "participant_added",
  "resource_added",
  "score_updated",
  "result_updated",
  "schedule_updated",
  "structure_generated",
  "bracket_seeded",
  "settings_updated",
  "tv_link_updated",
];

type RoundGroup = {
  round: number;
  matches: Match[];
};

function statusLabel(status?: string | null): string {
  return status ? statusText[status] || status : "Planerad";
}

function roundTitle(round: RoundGroup): string {
  const first = round.matches[0];
  return first ? first.name.replace(/\s+\d+$/, "") : `Runda ${round.round}`;
}

function moreText(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular} till` : `${count} ${plural} till`;
}

function TvBrand() {
  return <div className="tv-brand"><span aria-hidden="true"><MdiIcon path={mdiTelevisionPlay} /></span><strong>Live TV</strong></div>;
}

export function TvApp() {
  const [data, setData] = useState<TvPayload | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(slideSeconds);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const payload = await api<TvPayload>(`/api/tv/${tvCode}`);
      document.title = payload.bound ? `Live TV - ${payload.tournament.name}` : `Live TV - ${payload.tv_link.code}`;
      setData(payload);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
      setSecondsLeft((current) => {
        if (current <= 1) {
          setActiveIndex((index) => (index + 1) % slides.length);
          return slideSeconds;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const eventSource = new EventSource(`/api/tv/${tvCode}/events`);
    let reloadTimer: number | null = null;
    const refresh = () => {
      if (reloadTimer) return;
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        void load();
      }, 800);
    };
    for (const eventName of tvEventNames) eventSource.addEventListener(eventName, refresh);
    return () => {
      if (reloadTimer) window.clearTimeout(reloadTimer);
      eventSource.close();
    };
  }, [load]);

  const tournament = data?.tournament;
  const tvLink = data?.tv_link;
  const isBound = Boolean(data?.bound);
  const matches = data?.matches || [];
  const sortedMatches = useMemo(() => sortBySchedule(matches), [matches]);
  const currentMatches = data?.current_matches || [];
  const upcomingMatches = data?.upcoming_matches || [];
  const featuredMatch = currentMatches[0] || upcomingMatches[0] || sortedMatches[0];
  const featuredLabel = currentMatches.length ? "NU SPELAS" : "HÄRNÄST";
  const featuredPill = featuredMatch
    ? featuredLabel === "NU SPELAS"
      ? "Pågår"
      : featuredMatch.status === "completed"
        ? "Avslutad"
        : "Planerad"
    : "";
  const openScheduleMatches = sortedMatches.filter((match) => match.status !== "completed");
  const upcomingSource = upcomingMatches.length ? upcomingMatches : openScheduleMatches;
  const visibleUpcoming = upcomingSource.slice(0, 5);
  const scheduleMatches = upcomingSource.slice(0, 8);
  const hiddenUpcomingCount = Math.max(0, openScheduleMatches.length - visibleUpcoming.length);
  const hiddenScheduleCount = Math.max(0, openScheduleMatches.length - scheduleMatches.length);
  const standings = data?.standings || [];
  const visibleStandings = standings.slice(0, 2);
  const hiddenStandingCount = Math.max(0, standings.length - visibleStandings.length);
  const resources = data?.resources || [];
  const visibleResources = resources.slice(0, 4);
  const hiddenResourceCount = Math.max(0, resources.length - visibleResources.length);
  const recentSource = data?.recent_matches || [];
  const recentMatches = recentSource.slice(0, 5);
  const hiddenRecentCount = Math.max(0, recentSource.length - recentMatches.length);
  const knockoutRounds: RoundGroup[] = [...new Set(matches.filter((match) => match.stage_kind === "knockout").map((match) => Number(match.round)))]
    .sort((a, b) => a - b)
    .map((round) => ({
      round,
      matches: matches.filter((match) => match.stage_kind === "knockout" && Number(match.round) === round),
    }));

  if (error) return <section className="tv-slide active"><h1>{error.message}</h1></section>;
  if (!data) return <section className="tv-slide active"><h1>Laddar Live TV...</h1></section>;
  if (!isBound || !tournament || !tvLink) {
    return (
      <section className="tv-waiting">
        <div className="tv-waiting-card">
          <TvBrand />
          <h1>{data.message}</h1>
          <p>{tvLink?.label} · {tvLink?.code}</p>
          <div className="tv-pulse" aria-hidden="true"><span /><span /><span /></div>
        </div>
      </section>
    );
  }

  return (
    <>
      <header className="tv-topbar">
        <TvBrand />
        <div className="tv-meta-block"><small>Turnering</small><strong>{tournament.name}</strong><span>{formatDate(tournament.starts_at)}</span></div>
        <div className="tv-clock"><strong>{formatClock(now)}</strong><span>{formatDate(now.toISOString())}</span></div>
        <div className="tv-meta-block"><small>Sida {activeIndex + 1} av {slides.length}</small><strong>Nästa vy om {secondsLeft} s</strong></div>
        <div className="tv-dots">{slides.map((slide, index) => <span key={slide} className={index === activeIndex ? "active" : undefined} />)}</div>
      </header>

      <div className="tv-deck">
        <section className={`tv-slide ${activeIndex === 0 ? "active" : ""}`}>
          <div className="tv-layout live-layout">
            <section className="tv-panel tv-feature">
              {featuredMatch ? (
                <>
                  <div className="feature-head"><h2>{featuredLabel}</h2><span className="live-pill">{featuredPill}</span></div>
                  <div className="feature-match">
                    <div className="team-block team-a"><span>{initials(featuredMatch.side_a)}</span><strong>{featuredMatch.side_a}</strong></div>
                    <div className="score-stack"><small>{featuredMatch.time_label} · {featuredMatch.group_name || featuredMatch.stage_name || "-"}</small><strong>{featuredMatch.score_label}</strong><em>{statusLabel(featuredMatch.status)}</em></div>
                    <div className="team-block team-b"><span>{initials(featuredMatch.side_b)}</span><strong>{featuredMatch.side_b}</strong></div>
                  </div>
                  <dl className="feature-facts">
                    <div><dt>Start</dt><dd>{featuredMatch.time_label}</dd></div>
                    <div><dt>Grupp</dt><dd>{featuredMatch.group_name || featuredMatch.stage_name || "-"}</dd></div>
                    <div><dt>Status</dt><dd>{statusLabel(featuredMatch.status)}</dd></div>
                  </dl>
                </>
              ) : <h1>Inga matcher publicerade</h1>}
            </section>

            <section className="tv-panel tv-up-next">
              <h2>Härnäst</h2>
              <div className="tv-table">
                <div className="tv-row tv-head"><span>Tid</span><span>Match</span><span>Grupp</span></div>
                {!visibleUpcoming.length ? <div className="tv-row"><span /><strong>Inga kommande matcher</strong><span /></div> : null}
                {visibleUpcoming.map((match) => (
                  <div key={match.id} className="tv-row"><strong>{match.time_label}</strong><span>{match.side_a} <em>vs</em> {match.side_b}</span><span>{match.group_name || match.stage_name || "-"}</span></div>
                ))}
                {hiddenUpcomingCount ? <p className="tv-more">{moreText(hiddenUpcomingCount, "match", "matcher")} finns i schemat</p> : null}
              </div>
            </section>

            <section className="tv-panel tv-results">
              <h2>Senaste resultat</h2>
              <div className="tv-table result-table">
                {!recentMatches.length ? <div className="tv-row"><strong>Inga resultat rapporterade ännu.</strong></div> : null}
                {recentMatches.map((match) => (
                  <div key={match.id} className="tv-row"><span>{match.time_label}</span><strong>{match.side_a} <em>vs</em> {match.side_b}</strong><span>{match.score_label}</span></div>
                ))}
                {hiddenRecentCount ? <p className="tv-more">{moreText(hiddenRecentCount, "resultat", "resultat")}</p> : null}
              </div>
            </section>
          </div>
        </section>

        <section className={`tv-slide ${activeIndex === 1 ? "active" : ""}`}>
          <div className="tv-layout tables-layout">
            <section className="tv-panel tv-standings">
              <h1>Tabeller och slutspel</h1>
              {!standings.length ? <p className="tv-empty">Generera gruppspel för att visa tabeller.</p> : null}
              {standings.length ? (
                <div className="tv-standings-grid">
                  {visibleStandings.map((standing) => (
                    <article key={standing.group.id}>
                      <h2>{standing.group.name}</h2>
                      <table>
                        <thead><tr><th>#</th><th>Lag</th><th>S</th><th>V</th><th>F</th><th>P</th><th>Diff</th></tr></thead>
                        <tbody>
                          {standing.rows.slice(0, 4).map((row) => (
                            <tr key={row.participant_id}><td>{row.rank}</td><td>{row.name}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td><strong>{row.points}</strong></td><td>{row.diff > 0 ? "+" : ""}{row.diff}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      {standing.rows.length > 4 ? <p className="tv-more">{moreText(standing.rows.length - 4, "lag", "lag")} i gruppen</p> : null}
                    </article>
                  ))}
                </div>
              ) : null}
              {hiddenStandingCount ? <p className="tv-more">{moreText(hiddenStandingCount, "grupp", "grupper")}</p> : null}
            </section>

            <section className="tv-panel tv-bracket">
              <h2>Slutspel</h2>
              {!knockoutRounds.length ? <p className="tv-empty">Slutspel visas när bracket är genererad.</p> : null}
              {knockoutRounds.length ? (
                <div className="tv-bracket-grid">
                  {knockoutRounds.map((round) => (
                    <div key={round.round} className="tv-bracket-round">
                      <h3>{roundTitle(round)}</h3>
                      {round.matches.map((match) => <article key={match.id}><span>{match.side_a}</span><span>{match.side_b}</span></article>)}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </section>

        <section className={`tv-slide ${activeIndex === 2 ? "active" : ""}`}>
          <div className="tv-layout schedule-layout">
            <section className="tv-panel tv-schedule">
              <h2>Dagens schema</h2>
              <div className="tv-table schedule-table">
                <div className="tv-row tv-head"><span>Tid</span><span>Match</span><span>Grupp / omgång</span><span>Status</span></div>
                {!scheduleMatches.length ? <div className="tv-row"><span /><strong>Inga matcher i schemat</strong><span /><span /></div> : null}
                {scheduleMatches.map((match) => (
                  <div key={match.id} className="tv-row"><strong>{match.time_label}</strong><span>{match.side_a} <em>vs</em> {match.side_b}</span><span>{match.group_name || match.stage_name || match.name}</span><span>{statusLabel(match.status)}</span></div>
                ))}
                {hiddenScheduleCount ? <p className="tv-more">{moreText(hiddenScheduleCount, "match", "matcher")} i schemat</p> : null}
              </div>
            </section>

            <section className="tv-panel">
              <h2>Senaste resultat</h2>
              <div className="tv-table result-table">
                {!recentMatches.length ? <div className="tv-row"><strong>Inga resultat rapporterade ännu.</strong></div> : null}
                {recentMatches.map((match) => (
                  <div key={match.id} className="tv-row"><span>{match.time_label}</span><strong>{match.side_a} <em>vs</em> {match.side_b}</strong><span>{match.score_label}</span></div>
                ))}
                {hiddenRecentCount ? <p className="tv-more">{moreText(hiddenRecentCount, "resultat", "resultat")}</p> : null}
              </div>
            </section>

            <section className="tv-panel tv-resources">
              <h2>Aktiva platser</h2>
              <div className="tv-resource-grid">
                {!visibleResources.length ? <p className="tv-empty">Inga resurser publicerade.</p> : null}
                {visibleResources.map((resource) => (
                  <article key={resource.id}><strong>{resource.name}</strong><span>{resourceKindText(resource.kind)}</span></article>
                ))}
                {hiddenResourceCount ? <p className="tv-more">{moreText(hiddenResourceCount, "plats", "platser")}</p> : null}
              </div>
            </section>
          </div>
        </section>
      </div>
    </>
  );
}
