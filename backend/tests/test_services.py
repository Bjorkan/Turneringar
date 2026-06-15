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
        group_count: int = 2,
        qualifiers_per_group: int = 2,
    ) -> int:
        with self.conn:
            tournament_id = store.create_tournament(
                self.conn,
                "Testcupen",
                starts_at="2026-06-13T09:00",
                match_minutes=20,
                break_minutes=5,
                group_count=group_count,
                qualifiers_per_group=qualifiers_per_group,
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
        playable = [match for match in matches if services.match_is_playable(match)]
        scheduled = [match for match in matches if match["scheduled_at"]]
        self.assertEqual(len(playable), len(scheduled))
        self.assertFalse(
            any(match["scheduled_at"] for match in matches if not services.match_is_playable(match))
        )

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

    def test_first_knockout_round_avoids_same_group_pairings_when_possible(self) -> None:
        tournament_id = self.create_seeded_tournament(
            participant_count=6,
            resource_count=1,
            group_count=3,
            qualifiers_per_group=2,
        )

        services.generate_structure(self.conn, tournament_id)

        first_round = [
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "knockout" and match["round"] == 1
        ]
        same_group_pairings = [
            match
            for match in first_round
            if match["source_a_group_id"]
            and match["source_a_group_id"] == match["source_b_group_id"]
        ]
        self.assertEqual([], same_group_pairings)

    def test_generate_rejects_more_qualifiers_than_group_members(self) -> None:
        tournament_id = self.create_seeded_tournament(
            participant_count=3,
            resource_count=1,
            group_count=3,
            qualifiers_per_group=2,
        )

        with self.assertRaisesRegex(ValueError, "Vidare/grupp"):
            services.generate_structure(self.conn, tournament_id)

        self.assertEqual([], store.list_stages(self.conn, tournament_id))
        self.assertEqual([], store.list_matches(self.conn, tournament_id))

    def test_live_score_does_not_complete_or_seed(self) -> None:
        tournament_id = self.create_seeded_tournament()
        services.generate_structure(self.conn, tournament_id)
        group_match = next(
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "group"
        )

        services.update_match_score(self.conn, tournament_id, group_match["id"], 1, 0)

        updated = store.get_match(self.conn, group_match["id"])
        self.assertEqual("in_progress", updated["status"])
        self.assertEqual("1 - 0", updated["score_label"])
        standings = services.group_standings(self.conn, tournament_id)
        self.assertTrue(all(row["played"] == 0 for table in standings for row in table["rows"]))
        knockout_round = [
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "knockout" and match["round"] == 1
        ]
        self.assertTrue(all(match["participant_a_id"] is None for match in knockout_round))
        self.assertTrue(all(match["participant_b_id"] is None for match in knockout_round))

    def test_live_score_rejects_unresolved_matches(self) -> None:
        tournament_id = self.create_seeded_tournament()
        services.generate_structure(self.conn, tournament_id)
        knockout_match = next(
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "knockout"
        )

        with self.assertRaisesRegex(ValueError, "saknar deltagare"):
            services.update_match_score(self.conn, tournament_id, knockout_match["id"], 1, 0)

    def test_knockout_result_propagates_winner_to_next_round(self) -> None:
        tournament_id = self.create_seeded_tournament()
        services.generate_structure(self.conn, tournament_id)
        for match in [
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "group"
        ]:
            services.update_match_result(self.conn, tournament_id, match["id"], 2, 0)

        semifinal = next(
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "knockout" and match["round"] == 1
        )
        services.update_match_result(self.conn, tournament_id, semifinal["id"], 3, 1)

        final = next(
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["source_a_match_id"] == semifinal["id"]
            or match["source_b_match_id"] == semifinal["id"]
        )
        self.assertIn(semifinal["participant_a_id"], {final["participant_a_id"], final["participant_b_id"]})

    def test_knockout_result_rejects_draws(self) -> None:
        tournament_id = self.create_seeded_tournament()
        services.generate_structure(self.conn, tournament_id)
        for match in [
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "group"
        ]:
            services.update_match_result(self.conn, tournament_id, match["id"], 2, 0)
        semifinal = next(
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "knockout" and match["round"] == 1
        )

        with self.assertRaisesRegex(ValueError, "vinnare"):
            services.update_match_result(self.conn, tournament_id, semifinal["id"], 1, 1)

        updated = store.get_match(self.conn, semifinal["id"])
        self.assertNotEqual("completed", updated["status"])

    def test_completed_match_result_cannot_be_changed(self) -> None:
        tournament_id = self.create_seeded_tournament()
        services.generate_structure(self.conn, tournament_id)
        match = next(
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "group"
        )
        services.update_match_result(self.conn, tournament_id, match["id"], 2, 1)

        with self.assertRaisesRegex(ValueError, "redan avslutad"):
            services.update_match_result(self.conn, tournament_id, match["id"], 9, 0)

        updated = store.get_match(self.conn, match["id"])
        self.assertEqual("2 - 1", updated["score_label"])

    def test_single_member_groups_seed_and_advance_byes_after_generate(self) -> None:
        tournament_id = self.create_seeded_tournament(
            participant_count=3,
            resource_count=1,
            group_count=3,
            qualifiers_per_group=1,
        )

        services.generate_structure(self.conn, tournament_id)

        knockout_matches = [
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "knockout"
        ]
        bye_match = next(match for match in knockout_matches if match["placeholder_b"] == "BYE")
        self.assertEqual("completed", bye_match["status"])
        self.assertEqual(bye_match["participant_a_id"], bye_match["winner_participant_id"])
        final = next(match for match in knockout_matches if match["round"] == 2)
        self.assertEqual(bye_match["participant_a_id"], final["participant_a_id"])

    def test_rescheduling_preserves_in_progress_matches(self) -> None:
        tournament_id = self.create_seeded_tournament(participant_count=6, resource_count=2)
        services.generate_structure(self.conn, tournament_id)
        services.schedule_matches(self.conn, tournament_id)
        match = next(
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "group"
        )
        services.update_match_score(self.conn, tournament_id, match["id"], 1, 1)

        services.schedule_matches(self.conn, tournament_id)

        updated = store.get_match(self.conn, match["id"])
        self.assertEqual("in_progress", updated["status"])
        self.assertEqual(match["scheduled_at"], updated["scheduled_at"])
        self.assertEqual(match["resource_id"], updated["resource_id"])

    def test_rescheduling_reserves_fixed_match_duration(self) -> None:
        tournament_id = self.create_seeded_tournament(
            participant_count=4,
            resource_count=1,
            group_count=2,
            qualifiers_per_group=1,
        )
        services.generate_structure(self.conn, tournament_id)
        resource = store.list_resources(self.conn, tournament_id)[0]
        group_matches = [
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "group"
        ]
        fixed_match, next_match = group_matches[0], group_matches[1]

        errors = services.apply_manual_slot(
            self.conn,
            tournament_id,
            fixed_match["id"],
            resource["id"],
            "2026-06-13T09:00",
            90,
        )
        self.assertEqual([], errors)
        services.update_match_score(self.conn, tournament_id, fixed_match["id"], 1, 1)

        services.schedule_matches(self.conn, tournament_id)

        updated_next = store.get_match(self.conn, next_match["id"])
        self.assertGreaterEqual(
            services.parse_local_datetime(updated_next["scheduled_at"]),
            services.parse_local_datetime("2026-06-13T10:35"),
        )

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
            tournament_id,
            second["id"],
            first["resource_id"],
            first["scheduled_at"],
            first["duration_minutes"],
        )

        self.assertTrue(any("Resurskrock" in error for error in errors))

    def test_manual_override_rejects_foreign_resource(self) -> None:
        tournament_id = self.create_seeded_tournament(participant_count=4, resource_count=1)
        foreign_tournament_id = self.create_seeded_tournament(participant_count=4, resource_count=1)
        services.generate_structure(self.conn, tournament_id)
        match = next(
            match
            for match in store.list_matches(self.conn, tournament_id)
            if match["stage_kind"] == "group"
        )
        foreign_resource = store.list_resources(self.conn, foreign_tournament_id)[0]

        errors = services.apply_manual_slot(
            self.conn,
            tournament_id,
            match["id"],
            foreign_resource["id"],
            "2026-06-13T10:00",
            20,
        )

        self.assertEqual(["Resursen hör inte till turneringen."], errors)
        updated = store.get_match(self.conn, match["id"])
        self.assertIsNone(updated["resource_id"])

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

    def test_tv_links_can_wait_and_bind_to_resources(self) -> None:
        tournament_id = self.create_seeded_tournament(participant_count=4, resource_count=2)
        resources = store.list_resources(self.conn, tournament_id)

        with self.conn:
            tv_link = store.create_tv_link(self.conn, "Hallskärm", "custom1234")

        self.assertEqual("CUSTOM1234", tv_link["code"])
        self.assertIsNone(tv_link["tournament_id"])
        self.assertIsNone(tv_link["resource_id"])

        with self.conn:
            updated = store.update_tv_link(
                self.conn,
                tv_link["id"],
                "Plan 1-skärm",
                tournament_id,
                resources[0]["id"],
            )

        self.assertEqual(tournament_id, updated["tournament_id"])
        self.assertEqual(resources[0]["id"], updated["resource_id"])
        self.assertEqual("Plan 1-skärm", updated["label"])

        with self.conn:
            generated = store.create_tv_link(self.conn, "Automatisk kod")

        self.assertEqual(10, len(generated["code"]))
        self.assertRegex(generated["code"], r"^[A-Z0-9]{10}$")

        with self.assertRaisesRegex(ValueError, "exakt 10"):
            with self.conn:
                store.create_tv_link(self.conn, "Fel kod", "kort")


if __name__ == "__main__":
    unittest.main()
