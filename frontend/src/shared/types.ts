export type Notice = {
  message: string;
  type?: "success" | "info" | "danger" | "warning";
} | null;

export type TournamentSummary = {
  id: number;
  name: string;
  starts_at?: string | null;
  created_at?: string | null;
  status?: string | null;
  participant_count: number;
  resource_count: number;
  match_count: number;
};

export type Tournament = {
  id: number;
  name: string;
  starts_at?: string | null;
  status?: string | null;
  group_count: number;
  qualifiers_per_group: number;
  match_minutes: number;
  break_minutes: number;
};

export type Participant = {
  id: number;
  name: string;
  kind: string;
  seed?: number | null;
};

export type Resource = {
  id: number;
  tournament_id?: number;
  name: string;
  kind: string;
  active?: boolean;
};

export type Match = {
  id: number;
  name: string;
  stage_name?: string | null;
  stage_kind?: string | null;
  group_name?: string | null;
  round?: number | null;
  participant_a_id?: number | null;
  participant_b_id?: number | null;
  side_a: string;
  side_b: string;
  scheduled_at?: string | null;
  duration_minutes?: number;
  resource_id?: number | null;
  resource_name?: string | null;
  time_label?: string;
  status?: string;
  score_a?: number | null;
  score_b?: number | null;
  score_label?: string;
};

export type StandingRow = {
  participant_id: number;
  name: string;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scored: number;
  conceded: number;
  points: number;
  diff: number;
  groupName?: string;
};

export type Standing = {
  group: { id: number; name: string };
  rows: StandingRow[];
};

export type Moderator = {
  id: number;
  label: string;
  pin: string;
  token: string;
  tournament_id: number;
  tournament_name?: string;
  resource_name?: string | null;
};

export type EventLog = {
  id: number;
  kind: string;
  created_at: string;
};

export type DashboardData = {
  tournament: Tournament;
  participants: Participant[];
  resources: Resource[];
  standings: Standing[];
  matches: Match[];
  moderators: Moderator[];
  events: EventLog[];
  current_matches: Match[];
  upcoming_matches: Match[];
  recent_matches: Match[];
};

export type TvLink = {
  id: number;
  code: string;
  label: string;
  tournament_id?: number | null;
  tournament_name?: string | null;
  resource_id?: number | null;
  resource_name?: string | null;
};

export type TvPayload = DashboardData & {
  tv_link: TvLink;
  bound: boolean;
  message?: string;
};
