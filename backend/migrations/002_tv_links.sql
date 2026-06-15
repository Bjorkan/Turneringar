CREATE TABLE IF NOT EXISTS tv_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE CHECK(length(code) = 10),
    label TEXT NOT NULL,
    tournament_id INTEGER REFERENCES tournaments(id) ON DELETE SET NULL,
    resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tv_links_code ON tv_links(code);
CREATE INDEX IF NOT EXISTS idx_tv_links_tournament ON tv_links(tournament_id);
