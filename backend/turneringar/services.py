from __future__ import annotations

import math
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta
from itertools import combinations

from . import store


GROUP_NAMES = [
    "Grupp A",
    "Grupp B",
    "Grupp C",
    "Grupp D",
    "Grupp E",
    "Grupp F",
    "Grupp G",
    "Grupp H",
]


def parse_local_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value)


def format_local_datetime(value: datetime) -> str:
    return value.replace(second=0, microsecond=0).isoformat(timespec="minutes")


def next_power_of_two(value: int) -> int:
    if value <= 1:
        return 2
    return 2 ** math.ceil(math.log2(value))


def round_robin_pairs(participant_ids: list[int]) -> list[tuple[int, int, int]]:
    if len(participant_ids) < 2:
        return []
    players: list[int | None] = list(participant_ids)
    if len(players) % 2:
        players.append(None)

    rounds: list[tuple[int, int, int]] = []
    player_count = len(players)
    for round_number in range(1, player_count):
        left = players[: player_count // 2]
        right = list(reversed(players[player_count // 2 :]))
        for a_id, b_id in zip(left, right):
            if a_id is not None and b_id is not None:
                rounds.append((round_number, a_id, b_id))
        players = [players[0], players[-1], *players[1:-1]]
    return rounds


def distribute_participants(participants: list[dict], group_count: int) -> list[list[dict]]:
    group_count = max(1, min(group_count, len(participants) or 1))
    groups: list[list[dict]] = [[] for _ in range(group_count)]
    for index, participant in enumerate(participants):
        row = index // group_count
        offset = index % group_count
        group_index = offset if row % 2 == 0 else group_count - 1 - offset
        groups[group_index].append(participant)
    return groups


def generate_structure(
    conn: sqlite3.Connection,
    tournament_id: int,
    confirm_reset: bool = False,
) -> None:
    tournament = store.get_tournament(conn, tournament_id)
    if not tournament:
        raise ValueError("Turneringen finns inte.")

    participants = store.list_participants(conn, tournament_id)
    if len(participants) < 2:
        raise ValueError("Lägg till minst två deltagare innan bracket skapas.")

    if store.list_matches(conn, tournament_id) and not confirm_reset:
        raise ValueError("Bekräfta att befintliga matcher, resultat och schema ska ersättas.")

    grouped = distribute_participants(participants, tournament["group_count"])
    validate_qualifier_depth(grouped, tournament["qualifiers_per_group"])

    with conn:
        conn.execute("DELETE FROM stages WHERE tournament_id = ?", (tournament_id,))

        group_stage_id = conn.execute(
            """
            INSERT INTO stages (tournament_id, name, kind, status, sort_order)
            VALUES (?, 'Gruppspel', 'group', 'ready', 1)
            """,
            (tournament_id,),
        ).lastrowid

        created_groups: list[dict] = []
        for index, members in enumerate(grouped):
            name = GROUP_NAMES[index] if index < len(GROUP_NAMES) else f"Grupp {index + 1}"
            group_id = conn.execute(
                """
                INSERT INTO groups (stage_id, name, sort_order)
                VALUES (?, ?, ?)
                """,
                (group_stage_id, name, index + 1),
            ).lastrowid
            created_groups.append({"id": int(group_id), "name": name, "members": members})

            for participant in members:
                conn.execute(
                    """
                    INSERT INTO group_participants (group_id, participant_id)
                    VALUES (?, ?)
                    """,
                    (group_id, participant["id"]),
                )

            for position, (round_number, a_id, b_id) in enumerate(
                round_robin_pairs([member["id"] for member in members]), start=1
            ):
                conn.execute(
                    """
                    INSERT INTO matches (
                        tournament_id, stage_id, group_id, round, bracket_position,
                        name, participant_a_id, participant_b_id, duration_minutes
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        tournament_id,
                        group_stage_id,
                        group_id,
                        round_number,
                        position,
                        f"{name} R{round_number}.{position}",
                        a_id,
                        b_id,
                        tournament["match_minutes"],
                    ),
                )

        qualifier_slots = build_qualifier_slots(
            created_groups,
            tournament["qualifiers_per_group"],
        )
        if len(qualifier_slots) >= 2:
            build_knockout_stage(
                conn,
                tournament_id,
                tournament["match_minutes"],
                qualifier_slots,
            )

        conn.execute(
            "UPDATE tournaments SET status = 'ready' WHERE id = ?",
            (tournament_id,),
        )
        store.add_event(conn, tournament_id, "structure_generated", {"tournament_id": tournament_id})
        seed_knockout_from_groups(conn, tournament_id)


def validate_qualifier_depth(grouped: list[list[dict]], qualifiers_per_group: int) -> None:
    smallest_group_size = min((len(group) for group in grouped), default=0)
    if qualifiers_per_group > smallest_group_size:
        raise ValueError("Vidare/grupp kan inte vara högre än antalet deltagare i minsta gruppen.")


def build_qualifier_slots(groups: list[dict], qualifiers_per_group: int) -> list[dict]:
    slots: list[dict] = []
    for rank in range(1, qualifiers_per_group + 1):
        for group in groups:
            slots.append(
                {
                    "group_id": group["id"],
                    "rank": rank,
                    "label": f"{group['name']} #{rank}",
                }
            )
    return slots


def build_knockout_stage(
    conn: sqlite3.Connection,
    tournament_id: int,
    match_minutes: int,
    qualifier_slots: list[dict],
) -> None:
    bracket_size = next_power_of_two(len(qualifier_slots))
    while len(qualifier_slots) < bracket_size:
        qualifier_slots.append({"group_id": None, "rank": None, "label": "BYE"})

    knockout_stage_id = conn.execute(
        """
        INSERT INTO stages (tournament_id, name, kind, status, sort_order)
        VALUES (?, 'Slutspel', 'knockout', 'draft', 2)
        """,
        (tournament_id,),
    ).lastrowid

    first_round_pairs = balance_first_round_pairs(qualifier_slots, bracket_size)
    previous_round: list[int] = []
    for index, (slot_a, slot_b) in enumerate(first_round_pairs, start=1):
        match_id = conn.execute(
            """
            INSERT INTO matches (
                tournament_id, stage_id, round, bracket_position, name,
                placeholder_a, placeholder_b,
                source_a_group_id, source_b_group_id, source_a_rank, source_b_rank,
                duration_minutes
            )
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tournament_id,
                knockout_stage_id,
                index,
                knockout_round_name(bracket_size // 2, index),
                slot_a["label"],
                slot_b["label"],
                slot_a["group_id"],
                slot_b["group_id"],
                slot_a["rank"],
                slot_b["rank"],
                match_minutes,
            ),
        ).lastrowid
        previous_round.append(int(match_id))

    round_number = 2
    while len(previous_round) > 1:
        next_round: list[int] = []
        match_count = len(previous_round) // 2
        for index, (source_a, source_b) in enumerate(
            zip(previous_round[0::2], previous_round[1::2]), start=1
        ):
            match_id = conn.execute(
                """
                INSERT INTO matches (
                    tournament_id, stage_id, round, bracket_position, name,
                    placeholder_a, placeholder_b, source_a_match_id,
                    source_b_match_id, duration_minutes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tournament_id,
                    knockout_stage_id,
                    round_number,
                    index,
                    knockout_round_name(match_count, index),
                    f"Vinnare match {source_a}",
                    f"Vinnare match {source_b}",
                    source_a,
                    source_b,
                    match_minutes,
                ),
            ).lastrowid
            next_round.append(int(match_id))
        previous_round = next_round
        round_number += 1


def balance_first_round_pairs(
    qualifier_slots: list[dict],
    bracket_size: int,
) -> list[tuple[dict, dict]]:
    first_half = qualifier_slots[: bracket_size // 2]
    second_half = list(reversed(qualifier_slots[bracket_size // 2 :]))
    pairs = [[slot_a, slot_b] for slot_a, slot_b in zip(first_half, second_half)]

    for index, pair in enumerate(pairs):
        if not same_group_pair(pair[0], pair[1]):
            continue
        for other_index, other_pair in enumerate(pairs):
            if other_index == index:
                continue
            for own_side, other_side in ((0, 0), (0, 1), (1, 0), (1, 1)):
                candidate_pair = pair.copy()
                candidate_other = other_pair.copy()
                candidate_pair[own_side], candidate_other[other_side] = (
                    candidate_other[other_side],
                    candidate_pair[own_side],
                )
                if same_group_pair(candidate_pair[0], candidate_pair[1]):
                    continue
                if same_group_pair(candidate_other[0], candidate_other[1]):
                    continue
                pairs[index] = candidate_pair
                pairs[other_index] = candidate_other
                break
            if not same_group_pair(pairs[index][0], pairs[index][1]):
                break

    return [(pair[0], pair[1]) for pair in pairs]


def same_group_pair(slot_a: dict, slot_b: dict) -> bool:
    return (
        slot_a.get("group_id") is not None
        and slot_a.get("group_id") == slot_b.get("group_id")
    )


def knockout_round_name(match_count: int, index: int) -> str:
    if match_count == 1:
        return "Final"
    if match_count == 2:
        return f"Semifinal {index}"
    if match_count == 4:
        return f"Kvartsfinal {index}"
    return f"Slutspel {index}"


def group_standings(conn: sqlite3.Connection, tournament_id: int) -> list[dict]:
    groups = store.list_groups(conn, tournament_id)
    standings: list[dict] = []
    for group in groups:
        participants = store.rows_to_dicts(
            conn.execute(
                """
                SELECT p.*
                FROM group_participants gp
                JOIN participants p ON p.id = gp.participant_id
                WHERE gp.group_id = ?
                ORDER BY CASE WHEN p.seed IS NULL THEN 1 ELSE 0 END, p.seed, p.id
                """,
                (group["id"],),
            )
        )
        stats = {
            participant["id"]: {
                "participant_id": participant["id"],
                "name": participant["name"],
                "played": 0,
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "points": 0,
                "scored": 0,
                "conceded": 0,
                "diff": 0,
                "seed": participant["seed"] if participant["seed"] is not None else 999999,
            }
            for participant in participants
        }
        matches = store.rows_to_dicts(
            conn.execute(
                """
                SELECT *
                FROM matches
                WHERE group_id = ? AND status = 'completed'
                  AND score_a IS NOT NULL AND score_b IS NOT NULL
                """,
                (group["id"],),
            )
        )
        for match in matches:
            a_id = match["participant_a_id"]
            b_id = match["participant_b_id"]
            if a_id not in stats or b_id not in stats:
                continue
            apply_result(stats[a_id], match["score_a"], match["score_b"])
            apply_result(stats[b_id], match["score_b"], match["score_a"])

        table = sorted(
            stats.values(),
            key=lambda row: (-row["points"], -row["diff"], -row["scored"], row["seed"], row["name"]),
        )
        for rank, row in enumerate(table, start=1):
            row["rank"] = rank
        standings.append({"group": group, "rows": table})
    return standings


def apply_result(row: dict, scored: int, conceded: int) -> None:
    row["played"] += 1
    row["scored"] += scored
    row["conceded"] += conceded
    row["diff"] = row["scored"] - row["conceded"]
    if scored > conceded:
        row["wins"] += 1
        row["points"] += 3
    elif scored == conceded:
        row["draws"] += 1
        row["points"] += 1
    else:
        row["losses"] += 1


def match_is_playable(match: dict) -> bool:
    return bool(match["participant_a_id"] and match["participant_b_id"])


def schedule_matches(conn: sqlite3.Connection, tournament_id: int) -> None:
    tournament = store.get_tournament(conn, tournament_id)
    if not tournament:
        raise ValueError("Turneringen finns inte.")
    resources = store.list_resources(conn, tournament_id, active_only=True)
    if not resources:
        raise ValueError("Lägg till minst en aktiv spelplan/server innan schemat skapas.")

    start_at = parse_local_datetime(tournament["starts_at"])
    duration = timedelta(minutes=tournament["match_minutes"])
    break_time = timedelta(minutes=tournament["break_minutes"])
    resource_available = {resource["id"]: start_at for resource in resources}
    participant_available: dict[int, datetime] = defaultdict(lambda: start_at)

    matches = store.list_matches(conn, tournament_id)
    with conn:
        for match in matches:
            is_fixed = (
                match["status"] in {"completed", "in_progress"}
                and match["scheduled_at"]
                and match["resource_id"]
            )
            if is_fixed:
                fixed_duration = timedelta(minutes=match["duration_minutes"] or tournament["match_minutes"])
                end_at = parse_local_datetime(match["scheduled_at"]) + fixed_duration + break_time
                resource_available[match["resource_id"]] = max(
                    resource_available[match["resource_id"]],
                    end_at,
                )
                for participant_id in (match["participant_a_id"], match["participant_b_id"]):
                    if participant_id:
                        participant_available[participant_id] = max(
                            participant_available[participant_id],
                            end_at,
                        )

        for match in matches:
            is_fixed = (
                match["status"] in {"completed", "in_progress"}
                and match["scheduled_at"]
                and match["resource_id"]
            )
            if is_fixed:
                continue
            if not match_is_playable(match):
                if match["scheduled_at"] or match["resource_id"]:
                    conn.execute(
                        """
                        UPDATE matches
                        SET resource_id = NULL, scheduled_at = NULL,
                            status = CASE WHEN status = 'scheduled' THEN 'pending' ELSE status END,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        (match["id"],),
                    )
                continue
            earliest = start_at
            for participant_id in (match["participant_a_id"], match["participant_b_id"]):
                if participant_id:
                    earliest = max(earliest, participant_available[participant_id])

            resource_id, chosen_start = min(
                (
                    (resource["id"], max(resource_available[resource["id"]], earliest))
                    for resource in resources
                ),
                key=lambda item: (item[1], item[0]),
            )
            end_at = chosen_start + duration + break_time
            conn.execute(
                """
                UPDATE matches
                SET resource_id = ?, scheduled_at = ?, duration_minutes = ?,
                    status = CASE WHEN status = 'pending' THEN 'scheduled' ELSE status END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    resource_id,
                    format_local_datetime(chosen_start),
                    tournament["match_minutes"],
                    match["id"],
                ),
            )
            resource_available[resource_id] = end_at
            for participant_id in (match["participant_a_id"], match["participant_b_id"]):
                if participant_id:
                    participant_available[participant_id] = end_at

        store.add_event(conn, tournament_id, "schedule_updated", {"tournament_id": tournament_id})


def validate_manual_slot(
    conn: sqlite3.Connection,
    tournament_id: int,
    match_id: int,
    resource_id: int,
    scheduled_at: str,
    duration_minutes: int,
) -> list[str]:
    match = store.get_match(conn, match_id)
    if not match or match["tournament_id"] != tournament_id:
        return ["Matchen finns inte."]
    resource = store.row_to_dict(
        conn.execute(
            "SELECT id, tournament_id FROM resources WHERE id = ?",
            (resource_id,),
        ).fetchone()
    )
    if not resource:
        return ["Resursen finns inte."]
    if resource["tournament_id"] != tournament_id:
        return ["Resursen hör inte till turneringen."]
    if not match_is_playable(match):
        return ["Matchen saknar deltagare och kan inte schemaläggas."]
    try:
        start = parse_local_datetime(scheduled_at)
    except ValueError:
        return ["Tid måste vara ett giltigt datum."]
    end = start + timedelta(minutes=duration_minutes)
    errors: list[str] = []

    resource_matches = store.rows_to_dicts(
        conn.execute(
            """
            SELECT id, name, scheduled_at, duration_minutes
            FROM matches
            WHERE tournament_id = ? AND resource_id = ? AND id != ?
              AND scheduled_at IS NOT NULL
            """,
            (match["tournament_id"], resource_id, match_id),
        )
    )
    for other in resource_matches:
        if overlaps(start, end, other["scheduled_at"], other["duration_minutes"]):
            errors.append(f"Resurskrock med {other['name']}.")

    participant_ids = [
        participant_id
        for participant_id in (match["participant_a_id"], match["participant_b_id"])
        if participant_id
    ]
    if participant_ids:
        participant_matches = store.rows_to_dicts(
            conn.execute(
                """
                SELECT id, name, scheduled_at, duration_minutes,
                       participant_a_id, participant_b_id
                FROM matches
                WHERE tournament_id = ? AND id != ? AND scheduled_at IS NOT NULL
                  AND (
                    participant_a_id IN ({placeholders})
                    OR participant_b_id IN ({placeholders})
                  )
                """.format(placeholders=", ".join("?" for _ in participant_ids)),
                (
                    match["tournament_id"],
                    match_id,
                    *participant_ids,
                    *participant_ids,
                ),
            )
        )
        for other in participant_matches:
            if overlaps(start, end, other["scheduled_at"], other["duration_minutes"]):
                errors.append(f"Deltagarkrock med {other['name']}.")

    return errors


def overlaps(start: datetime, end: datetime, other_start_value: str, other_duration: int) -> bool:
    other_start = parse_local_datetime(other_start_value)
    other_end = other_start + timedelta(minutes=other_duration)
    return start < other_end and other_start < end


def apply_manual_slot(
    conn: sqlite3.Connection,
    tournament_id: int,
    match_id: int,
    resource_id: int,
    scheduled_at: str,
    duration_minutes: int,
) -> list[str]:
    errors = validate_manual_slot(conn, tournament_id, match_id, resource_id, scheduled_at, duration_minutes)
    if errors:
        return errors
    with conn:
        conn.execute(
            """
            UPDATE matches
            SET resource_id = ?, scheduled_at = ?, duration_minutes = ?,
                status = CASE WHEN status = 'pending' THEN 'scheduled' ELSE status END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND tournament_id = ?
            """,
            (resource_id, scheduled_at, duration_minutes, match_id, tournament_id),
        )
        store.add_event(
            conn,
            tournament_id,
            "schedule_updated",
            {"tournament_id": tournament_id, "match_id": match_id},
        )
    return []


def update_match_result(
    conn: sqlite3.Connection,
    tournament_id: int,
    match_id: int,
    score_a: int,
    score_b: int,
) -> None:
    match = store.get_match(conn, match_id)
    if not match or match["tournament_id"] != tournament_id:
        raise ValueError("Matchen finns inte.")
    if match["status"] == "completed":
        raise ValueError("Matchen är redan avslutad.")
    if score_a < 0 or score_b < 0:
        raise ValueError("Poäng kan inte vara negativa.")
    if not match["participant_a_id"] or not match["participant_b_id"]:
        raise ValueError("Matchen saknar deltagare och kan inte avslutas.")
    if match["stage_kind"] == "knockout" and score_a == score_b:
        raise ValueError("Slutspelsmatcher måste ha en vinnare.")

    winner_id = None
    if score_a > score_b:
        winner_id = match["participant_a_id"]
    elif score_b > score_a:
        winner_id = match["participant_b_id"]

    with conn:
        conn.execute(
            """
            UPDATE matches
            SET score_a = ?, score_b = ?, winner_participant_id = ?,
                status = 'completed', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND tournament_id = ?
            """,
            (score_a, score_b, winner_id, match_id, tournament_id),
        )
        if winner_id:
            propagate_winner(conn, tournament_id, match_id, winner_id)
        seed_knockout_from_groups(conn, tournament_id)
        store.add_event(
            conn,
            tournament_id,
            "result_updated",
            {"tournament_id": tournament_id, "match_id": match_id},
        )


def update_match_score(
    conn: sqlite3.Connection,
    tournament_id: int,
    match_id: int,
    score_a: int,
    score_b: int,
) -> None:
    match = store.get_match(conn, match_id)
    if not match or match["tournament_id"] != tournament_id:
        raise ValueError("Matchen finns inte.")
    if match["status"] == "completed":
        raise ValueError("Matchen är redan avslutad.")
    if not match["participant_a_id"] or not match["participant_b_id"]:
        raise ValueError("Matchen saknar deltagare och kan inte poängrapporteras.")
    if score_a < 0 or score_b < 0:
        raise ValueError("Poäng kan inte vara negativa.")

    with conn:
        conn.execute(
            """
            UPDATE matches
            SET score_a = ?, score_b = ?, winner_participant_id = NULL,
                status = 'in_progress',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND tournament_id = ?
            """,
            (score_a, score_b, match_id, tournament_id),
        )
        store.add_event(
            conn,
            tournament_id,
            "score_updated",
            {"tournament_id": tournament_id, "match_id": match_id},
        )


def propagate_winner(
    conn: sqlite3.Connection,
    tournament_id: int,
    source_match_id: int,
    winner_id: int,
) -> None:
    conn.execute(
        """
        UPDATE matches
        SET participant_a_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tournament_id = ? AND source_a_match_id = ? AND status != 'completed'
        """,
        (winner_id, tournament_id, source_match_id),
    )
    conn.execute(
        """
        UPDATE matches
        SET participant_b_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tournament_id = ? AND source_b_match_id = ? AND status != 'completed'
        """,
        (winner_id, tournament_id, source_match_id),
    )


def group_stage_complete(conn: sqlite3.Connection, tournament_id: int) -> bool:
    row = conn.execute(
        """
        SELECT COUNT(*) AS remaining
        FROM matches m
        JOIN stages s ON s.id = m.stage_id
        WHERE m.tournament_id = ? AND s.kind = 'group' AND m.status != 'completed'
        """,
        (tournament_id,),
    ).fetchone()
    return bool(row and row["remaining"] == 0)


def seed_knockout_from_groups(conn: sqlite3.Connection, tournament_id: int) -> bool:
    if not group_stage_complete(conn, tournament_id):
        return False
    standings = {
        group_table["group"]["id"]: group_table["rows"]
        for group_table in group_standings(conn, tournament_id)
    }
    first_round = store.rows_to_dicts(
        conn.execute(
            """
            SELECT m.*
            FROM matches m
            JOIN stages s ON s.id = m.stage_id
            WHERE m.tournament_id = ? AND s.kind = 'knockout'
              AND m.round = 1 AND m.status != 'completed'
            """,
            (tournament_id,),
        )
    )
    changed = False
    for match in first_round:
        a_id = participant_for_rank(standings, match["source_a_group_id"], match["source_a_rank"])
        b_id = participant_for_rank(standings, match["source_b_group_id"], match["source_b_rank"])
        if a_id and a_id != match["participant_a_id"]:
            conn.execute(
                "UPDATE matches SET participant_a_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (a_id, match["id"]),
            )
            changed = True
        if b_id and b_id != match["participant_b_id"]:
            conn.execute(
                "UPDATE matches SET participant_b_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (b_id, match["id"]),
            )
            changed = True
    byes_advanced = auto_advance_byes(conn, tournament_id)
    if changed or byes_advanced:
        store.add_event(
            conn,
            tournament_id,
            "bracket_seeded",
            {"tournament_id": tournament_id, "byes_advanced": byes_advanced},
        )
    return changed or byes_advanced


def auto_advance_byes(conn: sqlite3.Connection, tournament_id: int) -> bool:
    changed = False
    while True:
        bye_matches = store.rows_to_dicts(
            conn.execute(
                """
                SELECT m.*
                FROM matches m
                JOIN stages s ON s.id = m.stage_id
                WHERE m.tournament_id = ? AND s.kind = 'knockout'
                  AND m.status != 'completed'
                  AND (
                    (
                      m.participant_a_id IS NOT NULL
                      AND m.participant_b_id IS NULL
                      AND m.placeholder_b = 'BYE'
                    )
                    OR (
                      m.participant_b_id IS NOT NULL
                      AND m.participant_a_id IS NULL
                      AND m.placeholder_a = 'BYE'
                    )
                  )
                ORDER BY m.round, m.bracket_position, m.id
                """,
                (tournament_id,),
            )
        )
        if not bye_matches:
            break
        for match in bye_matches:
            winner_id = match["participant_a_id"] or match["participant_b_id"]
            if not winner_id:
                continue
            conn.execute(
                """
                UPDATE matches
                SET winner_participant_id = ?, status = 'completed',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND tournament_id = ?
                """,
                (winner_id, match["id"], tournament_id),
            )
            propagate_winner(conn, tournament_id, match["id"], winner_id)
            changed = True
    return changed


def participant_for_rank(
    standings: dict[int, list[dict]],
    group_id: int | None,
    rank: int | None,
) -> int | None:
    if not group_id or not rank:
        return None
    rows = standings.get(group_id, [])
    if len(rows) < rank:
        return None
    return rows[rank - 1]["participant_id"]


def moderator_can_update_match(
    conn: sqlite3.Connection,
    moderator_token: dict,
    match_id: int,
) -> bool:
    match = store.get_match(conn, match_id)
    if not match or match["tournament_id"] != moderator_token["tournament_id"]:
        return False
    resource_id = moderator_token.get("resource_id")
    return resource_id is None or match["resource_id"] == resource_id


def current_and_upcoming(matches: list[dict]) -> dict:
    now = datetime.now()
    current: list[dict] = []
    upcoming: list[dict] = []
    recent: list[dict] = []
    for match in matches:
        if match["status"] == "completed":
            recent.append(match)
            continue
        if not match_is_playable(match):
            continue
        if match["status"] == "in_progress":
            current.append(match)
            continue
        if not match["scheduled_at"]:
            upcoming.append(match)
            continue
        start = parse_local_datetime(match["scheduled_at"])
        end = start + timedelta(minutes=match["duration_minutes"])
        if start <= now <= end:
            current.append(match)
        elif start > now:
            upcoming.append(match)

    upcoming.sort(key=lambda row: row["scheduled_at"] or "9999")
    recent.sort(key=lambda row: row["updated_at"], reverse=True)
    return {"current": current, "upcoming": upcoming[:12], "recent": recent[:10]}
