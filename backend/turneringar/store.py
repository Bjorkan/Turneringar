from __future__ import annotations

import json
import re
import secrets
import sqlite3
from datetime import datetime, timedelta

from .db import row_to_dict, rows_to_dicts


TV_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
TV_CODE_RE = re.compile(r"^[A-Z0-9]{10}$")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "turnering"


def unique_slug(conn: sqlite3.Connection, name: str) -> str:
    base = slugify(name)
    slug = base
    counter = 2
    while conn.execute("SELECT 1 FROM tournaments WHERE slug = ?", (slug,)).fetchone():
        slug = f"{base}-{counter}"
        counter += 1
    return slug


def default_start_time() -> str:
    start = datetime.now().replace(second=0, microsecond=0) + timedelta(minutes=15)
    return start.isoformat(timespec="minutes")


def create_tournament(
    conn: sqlite3.Connection,
    name: str,
    starts_at: str | None = None,
    match_minutes: int = 20,
    break_minutes: int = 5,
    group_count: int = 2,
    qualifiers_per_group: int = 2,
) -> int:
    slug = unique_slug(conn, name)
    cursor = conn.execute(
        """
        INSERT INTO tournaments (
            name, slug, starts_at, match_minutes, break_minutes,
            group_count, qualifiers_per_group
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name.strip(),
            slug,
            starts_at or default_start_time(),
            match_minutes,
            break_minutes,
            group_count,
            qualifiers_per_group,
        ),
    )
    return int(cursor.lastrowid)


def list_tournaments(conn: sqlite3.Connection) -> list[dict]:
    return rows_to_dicts(
        conn.execute(
            """
            SELECT
                t.*,
                COUNT(DISTINCT p.id) AS participant_count,
                COUNT(DISTINCT r.id) AS resource_count,
                COUNT(DISTINCT m.id) AS match_count
            FROM tournaments t
            LEFT JOIN participants p ON p.tournament_id = t.id
            LEFT JOIN resources r ON r.tournament_id = t.id
            LEFT JOIN matches m ON m.tournament_id = t.id
            GROUP BY t.id
            ORDER BY t.created_at DESC, t.id DESC
            """
        )
    )


def get_tournament(conn: sqlite3.Connection, tournament_id: int) -> dict | None:
    return row_to_dict(
        conn.execute(
            "SELECT * FROM tournaments WHERE id = ?",
            (tournament_id,),
        ).fetchone()
    )


def update_tournament_settings(
    conn: sqlite3.Connection,
    tournament_id: int,
    starts_at: str,
    match_minutes: int,
    break_minutes: int,
    group_count: int,
    qualifiers_per_group: int,
) -> None:
    conn.execute(
        """
        UPDATE tournaments
        SET starts_at = ?, match_minutes = ?, break_minutes = ?,
            group_count = ?, qualifiers_per_group = ?
        WHERE id = ?
        """,
        (
            starts_at,
            max(1, match_minutes),
            max(0, break_minutes),
            max(1, group_count),
            max(1, qualifiers_per_group),
            tournament_id,
        ),
    )


def add_participant(
    conn: sqlite3.Connection,
    tournament_id: int,
    name: str,
    kind: str,
    seed: int | None,
) -> int:
    cursor = conn.execute(
        """
        INSERT INTO participants (tournament_id, name, kind, seed)
        VALUES (?, ?, ?, ?)
        """,
        (tournament_id, name.strip(), kind, seed),
    )
    return int(cursor.lastrowid)


def list_participants(conn: sqlite3.Connection, tournament_id: int) -> list[dict]:
    return rows_to_dicts(
        conn.execute(
            """
            SELECT *
            FROM participants
            WHERE tournament_id = ?
            ORDER BY CASE WHEN seed IS NULL THEN 1 ELSE 0 END, seed, id
            """,
            (tournament_id,),
        )
    )


def add_resource(
    conn: sqlite3.Connection,
    tournament_id: int,
    name: str,
    kind: str,
) -> int:
    cursor = conn.execute(
        """
        INSERT INTO resources (tournament_id, name, kind)
        VALUES (?, ?, ?)
        """,
        (tournament_id, name.strip(), kind),
    )
    return int(cursor.lastrowid)


def list_resources(
    conn: sqlite3.Connection,
    tournament_id: int,
    active_only: bool = False,
) -> list[dict]:
    sql = "SELECT * FROM resources WHERE tournament_id = ?"
    if active_only:
        sql += " AND active = 1"
    sql += " ORDER BY active DESC, kind, name, id"
    return rows_to_dicts(conn.execute(sql, (tournament_id,)))


def list_all_resources(conn: sqlite3.Connection) -> list[dict]:
    return rows_to_dicts(
        conn.execute(
            """
            SELECT r.*, t.name AS tournament_name
            FROM resources r
            JOIN tournaments t ON t.id = r.tournament_id
            ORDER BY t.created_at DESC, t.id DESC, r.active DESC, r.kind, r.name, r.id
            """
        )
    )


def normalize_tv_code(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def generate_tv_code(conn: sqlite3.Connection) -> str:
    for _ in range(100):
        code = "".join(secrets.choice(TV_CODE_ALPHABET) for _ in range(10))
        if not conn.execute("SELECT 1 FROM tv_links WHERE code = ?", (code,)).fetchone():
            return code
    raise RuntimeError("Kunde inte skapa en unik TV-kod.")


def get_tv_link_by_id(conn: sqlite3.Connection, link_id: int) -> dict | None:
    return row_to_dict(
        conn.execute(
            """
            SELECT
                tl.*,
                t.name AS tournament_name,
                r.name AS resource_name,
                r.kind AS resource_kind
            FROM tv_links tl
            LEFT JOIN tournaments t ON t.id = tl.tournament_id
            LEFT JOIN resources r ON r.id = tl.resource_id
            WHERE tl.id = ?
            """,
            (link_id,),
        ).fetchone()
    )


def get_tv_link_by_code(conn: sqlite3.Connection, code: str) -> dict | None:
    normalized = normalize_tv_code(code)
    return row_to_dict(
        conn.execute(
            """
            SELECT
                tl.*,
                t.name AS tournament_name,
                r.name AS resource_name,
                r.kind AS resource_kind
            FROM tv_links tl
            LEFT JOIN tournaments t ON t.id = tl.tournament_id
            LEFT JOIN resources r ON r.id = tl.resource_id
            WHERE tl.code = ?
            """,
            (normalized,),
        ).fetchone()
    )


def list_tv_links(conn: sqlite3.Connection) -> list[dict]:
    return rows_to_dicts(
        conn.execute(
            """
            SELECT
                tl.*,
                t.name AS tournament_name,
                r.name AS resource_name,
                r.kind AS resource_kind
            FROM tv_links tl
            LEFT JOIN tournaments t ON t.id = tl.tournament_id
            LEFT JOIN resources r ON r.id = tl.resource_id
            ORDER BY tl.created_at DESC, tl.id DESC
            """
        )
    )


def list_tv_links_for_tournament(conn: sqlite3.Connection, tournament_id: int) -> list[dict]:
    return rows_to_dicts(
        conn.execute(
            "SELECT * FROM tv_links WHERE tournament_id = ? ORDER BY id",
            (tournament_id,),
        )
    )


def create_tv_link(
    conn: sqlite3.Connection,
    label: str,
    code: str | None = None,
) -> dict:
    normalized = normalize_tv_code(code or "") if code else generate_tv_code(conn)
    if not TV_CODE_RE.fullmatch(normalized):
        raise ValueError("TV-koden måste vara exakt 10 tecken och bara innehålla A-Z eller 0-9.")
    cursor = conn.execute(
        """
        INSERT INTO tv_links (code, label)
        VALUES (?, ?)
        """,
        (normalized, label.strip() or "Live TV"),
    )
    return get_tv_link_by_id(conn, int(cursor.lastrowid))


def update_tv_link(
    conn: sqlite3.Connection,
    link_id: int,
    label: str | None = None,
    tournament_id: int | None = None,
    resource_id: int | None = None,
) -> dict:
    existing = get_tv_link_by_id(conn, link_id)
    if not existing:
        raise ValueError("TV-länken finns inte.")

    if resource_id is not None:
        resource = row_to_dict(
            conn.execute(
                "SELECT * FROM resources WHERE id = ?",
                (resource_id,),
            ).fetchone()
        )
        if not resource:
            raise ValueError("Resursen finns inte.")
        if tournament_id is None:
            tournament_id = int(resource["tournament_id"])
        elif int(resource["tournament_id"]) != tournament_id:
            raise ValueError("Resursen hör inte till vald turnering.")

    if tournament_id is not None and not get_tournament(conn, tournament_id):
        raise ValueError("Turneringen finns inte.")

    conn.execute(
        """
        UPDATE tv_links
        SET label = ?, tournament_id = ?, resource_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (
            (label.strip() if label is not None and label.strip() else existing["label"]),
            tournament_id,
            resource_id if tournament_id is not None else None,
            link_id,
        ),
    )
    updated = get_tv_link_by_id(conn, link_id)
    if not updated:
        raise ValueError("TV-länken finns inte.")
    return updated


def delete_tv_link(conn: sqlite3.Connection, link_id: int) -> None:
    existing = get_tv_link_by_id(conn, link_id)
    if not existing:
        raise ValueError("TV-länken finns inte.")
    conn.execute("DELETE FROM tv_links WHERE id = ?", (link_id,))


def create_moderator_token(
    conn: sqlite3.Connection,
    tournament_id: int,
    label: str,
    resource_id: int | None,
) -> dict:
    if not get_tournament(conn, tournament_id):
        raise ValueError("Turneringen finns inte.")
    if resource_id is not None:
        resource = row_to_dict(
            conn.execute(
                "SELECT id, tournament_id FROM resources WHERE id = ?",
                (resource_id,),
            ).fetchone()
        )
        if not resource:
            raise ValueError("Resursen finns inte.")
        if resource["tournament_id"] != tournament_id:
            raise ValueError("Resursen hör inte till turneringen.")

    pin = f"{secrets.randbelow(900000) + 100000}"
    token = secrets.token_urlsafe(24)
    cursor = conn.execute(
        """
        INSERT INTO moderator_tokens (tournament_id, resource_id, label, pin, token)
        VALUES (?, ?, ?, ?, ?)
        """,
        (tournament_id, resource_id, label.strip(), pin, token),
    )
    return get_moderator_token_by_id(conn, int(cursor.lastrowid))


def delete_moderator_token(conn: sqlite3.Connection, token_id: int) -> None:
    existing = get_moderator_token_by_id(conn, token_id)
    if not existing:
        raise ValueError("Moderatorlänken finns inte.")
    conn.execute("DELETE FROM moderator_tokens WHERE id = ?", (token_id,))


def list_moderator_tokens(conn: sqlite3.Connection, tournament_id: int) -> list[dict]:
    return rows_to_dicts(
        conn.execute(
            """
            SELECT mt.*, r.name AS resource_name
            FROM moderator_tokens mt
            LEFT JOIN resources r ON r.id = mt.resource_id
            WHERE mt.tournament_id = ?
            ORDER BY mt.created_at DESC, mt.id DESC
            """,
            (tournament_id,),
        )
    )


def get_moderator_token_by_id(
    conn: sqlite3.Connection,
    token_id: int,
) -> dict | None:
    return row_to_dict(
        conn.execute(
            """
            SELECT mt.*, r.name AS resource_name
            FROM moderator_tokens mt
            LEFT JOIN resources r ON r.id = mt.resource_id
            WHERE mt.id = ?
            """,
            (token_id,),
        ).fetchone()
    )


def get_moderator_token(conn: sqlite3.Connection, token: str) -> dict | None:
    return row_to_dict(
        conn.execute(
            """
            SELECT mt.*, r.name AS resource_name, t.name AS tournament_name
            FROM moderator_tokens mt
            LEFT JOIN resources r ON r.id = mt.resource_id
            JOIN tournaments t ON t.id = mt.tournament_id
            WHERE mt.token = ?
            """,
            (token,),
        ).fetchone()
    )


def add_event(
    conn: sqlite3.Connection,
    tournament_id: int,
    kind: str,
    payload: dict,
) -> int:
    cursor = conn.execute(
        """
        INSERT INTO event_log (tournament_id, kind, payload_json)
        VALUES (?, ?, ?)
        """,
        (tournament_id, kind, json.dumps(payload, ensure_ascii=False)),
    )
    return int(cursor.lastrowid)


def list_recent_events(
    conn: sqlite3.Connection,
    tournament_id: int,
    limit: int = 10,
) -> list[dict]:
    rows = rows_to_dicts(
        conn.execute(
            """
            SELECT *
            FROM event_log
            WHERE tournament_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (tournament_id, limit),
        )
    )
    for row in rows:
        row["payload"] = json.loads(row.pop("payload_json"))
    return rows


def list_stages(conn: sqlite3.Connection, tournament_id: int) -> list[dict]:
    return rows_to_dicts(
        conn.execute(
            """
            SELECT *
            FROM stages
            WHERE tournament_id = ?
            ORDER BY sort_order, id
            """,
            (tournament_id,),
        )
    )


def list_groups(conn: sqlite3.Connection, tournament_id: int) -> list[dict]:
    return rows_to_dicts(
        conn.execute(
            """
            SELECT g.*, s.tournament_id, s.name AS stage_name
            FROM groups g
            JOIN stages s ON s.id = g.stage_id
            WHERE s.tournament_id = ?
            ORDER BY g.sort_order, g.id
            """,
            (tournament_id,),
        )
    )


def list_matches(conn: sqlite3.Connection, tournament_id: int) -> list[dict]:
    rows = rows_to_dicts(
        conn.execute(
            """
            SELECT
                m.*,
                s.name AS stage_name,
                s.kind AS stage_kind,
                s.sort_order AS stage_sort_order,
                g.name AS group_name,
                g.sort_order AS group_sort_order,
                pa.name AS participant_a_name,
                pb.name AS participant_b_name,
                w.name AS winner_name,
                r.name AS resource_name,
                r.kind AS resource_kind
            FROM matches m
            JOIN stages s ON s.id = m.stage_id
            LEFT JOIN groups g ON g.id = m.group_id
            LEFT JOIN participants pa ON pa.id = m.participant_a_id
            LEFT JOIN participants pb ON pb.id = m.participant_b_id
            LEFT JOIN participants w ON w.id = m.winner_participant_id
            LEFT JOIN resources r ON r.id = m.resource_id
            WHERE m.tournament_id = ?
            ORDER BY s.sort_order, m.round, COALESCE(g.sort_order, 0), m.bracket_position, m.id
            """,
            (tournament_id,),
        )
    )
    for row in rows:
        enrich_match_row(row)
    return rows


def get_match(conn: sqlite3.Connection, match_id: int) -> dict | None:
    row = row_to_dict(
        conn.execute(
            """
            SELECT
                m.*,
                s.name AS stage_name,
                s.kind AS stage_kind,
                pa.name AS participant_a_name,
                pb.name AS participant_b_name,
                r.name AS resource_name
            FROM matches m
            JOIN stages s ON s.id = m.stage_id
            LEFT JOIN participants pa ON pa.id = m.participant_a_id
            LEFT JOIN participants pb ON pb.id = m.participant_b_id
            LEFT JOIN resources r ON r.id = m.resource_id
            WHERE m.id = ?
            """,
            (match_id,),
        ).fetchone()
    )
    if row:
        enrich_match_row(row)
    return row


def enrich_match_row(row: dict) -> dict:
    row["side_a"] = row.get("participant_a_name") or row.get("placeholder_a") or "TBD"
    row["side_b"] = row.get("participant_b_name") or row.get("placeholder_b") or "TBD"
    row["score_label"] = "-"
    if row.get("score_a") is not None and row.get("score_b") is not None:
        row["score_label"] = f"{row['score_a']} - {row['score_b']}"
    row["time_label"] = "Ej schemalagd"
    if row.get("scheduled_at"):
        try:
            row["time_label"] = datetime.fromisoformat(row["scheduled_at"]).strftime("%H:%M")
        except ValueError:
            row["time_label"] = row["scheduled_at"]
    return row
