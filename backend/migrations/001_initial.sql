CREATE TABLE tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft',
    starts_at TEXT NOT NULL,
    match_minutes INTEGER NOT NULL DEFAULT 20,
    break_minutes INTEGER NOT NULL DEFAULT 5,
    group_count INTEGER NOT NULL DEFAULT 2,
    qualifiers_per_group INTEGER NOT NULL DEFAULT 2,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('team', 'player')),
    seed INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('court', 'server', 'table')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('group', 'knockout')),
    status TEXT NOT NULL DEFAULT 'draft',
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE group_participants (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, participant_id)
);

CREATE TABLE matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    round INTEGER NOT NULL DEFAULT 1,
    bracket_position INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    participant_a_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
    participant_b_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
    placeholder_a TEXT,
    placeholder_b TEXT,
    source_a_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
    source_b_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
    source_a_group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    source_b_group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    source_a_rank INTEGER,
    source_b_rank INTEGER,
    resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
    scheduled_at TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 20,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'in_progress', 'completed')),
    score_a INTEGER,
    score_b INTEGER,
    winner_participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE moderator_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    pin TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_participants_tournament ON participants(tournament_id);
CREATE INDEX idx_resources_tournament ON resources(tournament_id);
CREATE INDEX idx_stages_tournament ON stages(tournament_id);
CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_schedule ON matches(tournament_id, scheduled_at, resource_id);
CREATE INDEX idx_tokens_token ON moderator_tokens(token);

