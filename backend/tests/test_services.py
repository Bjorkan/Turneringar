from __future__ import annotations

import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from turneringar import services, store
from turneringar.db import connect, initialize_database


class TournamentServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "test.sqlite3"
        initialize_database(self.db_path)
        self.conn = connect(self.db_path)

    def tearDown(self) -> None:
        self.conn.close()
        self.tmpdir.cleanup()

    def create_seeded_tournament(
        self,
        participant_count: int = 4,
        resource_count: int = 2,
    ) -> int:
        with self.conn:
            tournament_id = store.create_tournament(
                self.conn,
                "Testcupen",
                starts_at="2026-06-13T09:00",
                match_minutes=20,
                break_minutes=5,
                group_count=2,
                qualifiers_per_group=2,
            )
            for index in range(1, participant_count + 1):
                store.add_participant(
                    self.conn,
                    tournament_id,
                    f"Lag {index}",
                    "team",
                    index,
                )
            for index in range(1, resource_count + 1):
                store.add_resource(self.conn, tournament_id, f"Plan {index}", "court")
        return tournament_id

    def test_generates_group_stage_and_knockout(self) -> None:
        tournament_id = self.create_seeded_tournament()

        services.generate_structure(self.conn, tournament_id)

        stages = store.list_stages(self.conn, tournament_id)
        groups = store.list_groups(self.conn, tournament_id)
        matches = store.list_matches(self.conn, tournament_id)

        self.assertEqual(["group", "knockout"], [stage["kind"] for stage in stages])
        self.assertEqual(2, len(groups))
        self.assertEqual(5, len(matches))
        self.assertEqual(2, len([match for match in matches if match["stage_kind"] == "group"]))
        self.assertEqual(3, len([match for match in matches if match["stage_kind"] == "knockout"]))

    def test_schedule_has_no_resource_or_participant_overlaps(self) -> None:
        tournament_id = self.create_seeded_tournament(participant_count=6, resource_count=2)
        services.generate_structure(self.conn, tournament_id)

        services.schedule_matches(self.conn, tournament_id)

        matches = store.list_matches(self.conn, tournament_id)
        scheduled = [match for match in matches if match["scheduled_at"]]
        self.assertEqual(len(matches), len(scheduled))

        for index, match in enumerate(scheduled):
            start = services.parse_local_datetime(match["scheduled_at"])
            end = start + timedelta(minutes=match["duration_minutes"])
            for other in scheduled[index + 1 :]:
                other_start = services.parse_local_datetime(other["scheduled_at"])
                other_end = other_start + timedelta(minutes=other["duration_minutes"])
                overlap = start < other_end and other_start < end
                if not overlap:
                    continue
                self.assertNotEqual(match["resource_id"], other["resource_id"])
                match_participants = {match["participant_a_id"], match["participant_b_id"]} - {None}
                other_participants = {other["participant_a_id"], other["participant_b_id"]} - {None}
                self.assertFalse(match_participants & other_participants)

    def test_group_results_seed_knockout_slots(self) -> None:
        tournament_id = self.create_seeded_tournament()
        services.generate_structure(self.conn, tournament_id)

        group_matches = [
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "group"
        ]
        for match in group_matches:
            services.update_match_result(self.conn, tournament_id, match["id"], 2, 0)

        knockout_round = [
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "knockout" and match["round"] == 1
        ]

        self.assertTrue(knockout_round)
        self.assertTrue(all(match["participant_a_id"] for match in knockout_round))
        self.assertTrue(all(match["participant_b_id"] for match in knockout_round))

    def test_manual_override_rejects_resource_conflict(self) -> None:
        tournament_id = self.create_seeded_tournament(participant_count=6, resource_count=2)
        services.generate_structure(self.conn, tournament_id)
        services.schedule_matches(self.conn, tournament_id)
        matches = [
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "group"
        ]
        first, second = matches[0], matches[1]

        errors = services.validate_manual_slot(
            self.conn,
            second["id"],
            first["resource_id"],
            first["scheduled_at"],
            first["duration_minutes"],
        )

        self.assertTrue(any("Resurskrock" in error for error in errors))

    def test_moderator_token_scope_limits_resource_updates(self) -> None:
        tournament_id = self.create_seeded_tournament(participant_count=6, resource_count=2)
        services.generate_structure(self.conn, tournament_id)
        services.schedule_matches(self.conn, tournament_id)
        resources = store.list_resources(self.conn, tournament_id)
        with self.conn:
            moderator = store.create_moderator_token(
                self.conn,
                tournament_id,
                "Planmoderator",
                resources[0]["id"],
            )

        in_scope = None
        out_of_scope = None
        for match in store.list_matches(self.conn, tournament_id):
            if match["resource_id"] == resources[0]["id"] and in_scope is None:
                in_scope = match
            if match["resource_id"] != resources[0]["id"] and out_of_scope is None:
                out_of_scope = match

        self.assertIsNotNone(in_scope)
        self.assertIsNotNone(out_of_scope)
        self.assertTrue(services.moderator_can_update_match(self.conn, moderator, in_scope["id"]))
        self.assertFalse(services.moderator_can_update_match(self.conn, moderator, out_of_scope["id"]))


if __name__ == "__main__":
    unittest.main()

