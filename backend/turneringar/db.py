from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = ROOT_DIR / "data" / "turneringar.sqlite3"
MIGRATIONS_DIR = ROOT_DIR / "migrations"


def database_path() -> Path:
    return Path(os.environ.get("TURNERINGAR_DB", DEFAULT_DB_PATH))


def connect(db_path: str | Path | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path is not None else database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def session(db_path: str | Path | None = None):
    conn = connect(db_path)
    try:
        yield conn
    finally:
        conn.close()


def initialize_database(db_path: str | Path | None = None) -> None:
    with session(db_path) as conn:
        with conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            applied = {
                row["version"]
                for row in conn.execute("SELECT version FROM schema_migrations")
            }

            for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
                version = migration.stem.split("_", 1)[0]
                if version in applied:
                    continue
                conn.executescript(migration.read_text(encoding="utf-8"))
                conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES (?)",
                    (version,),
                )


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return dict(row)


def rows_to_dicts(rows: list[sqlite3.Row] | sqlite3.Cursor) -> list[dict]:
    return [dict(row) for row in rows]
