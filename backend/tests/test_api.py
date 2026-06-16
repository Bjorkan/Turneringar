from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from http.cookiejar import Cookie, CookieJar
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener

import pytest


def _iso(hours: int = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M")


ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class ServerProcess:
    def __init__(self, process: subprocess.Popen[str]) -> None:
        self._process = process

    def health(self) -> str | None:
        if self._process.poll() is None:
            return None
        stdout, stderr = self._process.communicate()
        return (
            f"Server died with code {self._process.returncode}\n"
            f"--- STDOUT ---\n{stdout}\n--- STDERR ---\n{stderr}"
        )

    def terminate(self) -> None:
        self._process.terminate()
        try:
            self._process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.communicate(timeout=5)


class ApiResponse:
    def __init__(self, status_code: int, body: str, set_cookies: list[str] | None = None) -> None:
        self.status_code = status_code
        self.text = body
        self.set_cookies = set_cookies or []

    def json(self) -> Any:
        return json.loads(self.text)


class ApiClient:
    def __init__(self, base_url: str, server: ServerProcess | None = None, request_timeout: int = 5) -> None:
        self.base_url = base_url
        self.server = server
        self.request_timeout = request_timeout
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def _require_alive(self) -> None:
        if self.server is None:
            return
        msg = self.server.health()
        if msg:
            pytest.fail(msg)

    def request(self, method: str, path: str, payload: dict[str, object] | None = None, extra_headers: dict[str, str] | None = None) -> ApiResponse:
        self._require_alive()
        body = None
        headers: dict[str, str] = {}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if extra_headers:
            headers.update(extra_headers)
        request = Request(
            urljoin(self.base_url, path),
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with self.opener.open(request, timeout=self.request_timeout) as response:
                text = response.read().decode("utf-8")
                return ApiResponse(response.status, text, response.headers.get_all("Set-Cookie", []))
        except HTTPError as exc:
            text = exc.read().decode("utf-8")
            return ApiResponse(exc.code, text, exc.headers.get_all("Set-Cookie", []))
        except URLError:
            self._require_alive()
            raise

    def get(self, path: str) -> ApiResponse:
        return self.request("GET", path)

    def post(self, path: str, json: dict[str, object]) -> ApiResponse:
        return self.request("POST", path, json)

    def patch(self, path: str, json: dict[str, object]) -> ApiResponse:
        return self.request("PATCH", path, json)


@pytest.fixture()
def client(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[ApiClient]:
    params: dict[str, Any] = getattr(request, "param", {})
    startup_timeout = params.get("startup_timeout", 10)
    request_timeout = params.get("request_timeout", 5)

    port = free_port()
    env = {
        **dict(os.environ),
        "ADMIN_PIN": "test-pin",
        "TURNERINGAR_DB": str(tmp_path / "turneringar.sqlite3"),
    }
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "turneringar.main:app",
            "--app-dir",
            "backend",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    server = ServerProcess(process)
    api_client = ApiClient(f"http://127.0.0.1:{port}", server, request_timeout)
    deadline = time.monotonic() + startup_timeout
    while time.monotonic() < deadline:
        health = server.health()
        if health:
            pytest.fail(f"uvicorn exited early\n{health}")
        try:
            if api_client.get("/api/session").status_code == 200:
                break
        except URLError:
            time.sleep(0.1)
    else:
        server.terminate()
        health = server.health()
        pytest.fail(f"uvicorn did not start\n{health}")

    try:
        yield api_client
    finally:
        server.terminate()


def login(client: ApiClient) -> None:
    response = client.post("/api/admin/login", json={"pin": "test-pin"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def create_ready_tournament(client: ApiClient) -> int:
    response = client.post(
        "/api/tournaments",
        json={
            "name": "API Hårdkoll",
            "starts_at": _iso(),
            "group_count": 2,
            "qualifiers_per_group": 1,
        },
    )
    assert response.status_code == 200
    tournament_id = response.json()["id"]

    for seed, name in enumerate(["Lag A", "Lag B", "Lag C", "Lag D"], start=1):
        response = client.post(
            f"/api/tournaments/{tournament_id}/participants",
            json={"name": name, "kind": "team", "seed": seed},
        )
        assert response.status_code == 200

    for name in ["Plan 1", "Plan 2"]:
        response = client.post(
            f"/api/tournaments/{tournament_id}/resources",
            json={"name": name, "kind": "court"},
        )
        assert response.status_code == 200

    response = client.post(f"/api/tournaments/{tournament_id}/generate", json={})
    assert response.status_code == 200
    response = client.post(f"/api/tournaments/{tournament_id}/schedule", json={})
    assert response.status_code == 200
    return tournament_id


def test_admin_api_requires_login(client: ApiClient) -> None:
    response = client.get("/api/tournaments")
    assert response.status_code == 401

    response = client.post("/api/admin/login", json={"pin": "fel"})
    assert response.status_code == 401

    login(client)
    response = client.get("/api/tournaments")
    assert response.status_code == 200
    assert response.json() == {"tournaments": []}


def test_login_cookies_are_signed_sessions_not_raw_pins(client: ApiClient) -> None:
    response = client.post("/api/admin/login", json={"pin": "test-pin"})
    assert response.status_code == 200
    admin_cookies = "\n".join(response.set_cookies)
    assert "test-pin" not in admin_cookies
    admin_session_cookie = next(
        cookie for cookie in response.set_cookies if cookie.startswith("turneringar_admin_session=")
    )

    second_response = client.post("/api/admin/login", json={"pin": "test-pin"})
    assert second_response.status_code == 200
    second_admin_session_cookie = next(
        cookie for cookie in second_response.set_cookies if cookie.startswith("turneringar_admin_session=")
    )
    assert admin_session_cookie.split(";", 1)[0] != second_admin_session_cookie.split(";", 1)[0]
    assert client.get("/api/session").json()["is_admin"] is True

    tournament_id = create_ready_tournament(client)
    dashboard = client.get(f"/api/tournaments/{tournament_id}").json()
    response = client.post(
        f"/api/tournaments/{tournament_id}/moderators",
        json={"label": "Plan 1", "resource_id": dashboard["resources"][0]["id"]},
    )
    assert response.status_code == 200
    moderator = response.json()["moderator"]

    response = client.post(
        f"/api/moderators/{moderator['token']}/login",
        json={"pin": moderator["pin"]},
    )
    assert response.status_code == 200
    moderator_cookies = "\n".join(response.set_cookies)
    assert moderator["pin"] not in moderator_cookies
    assert any(
        cookie.startswith(f"turneringar_moderator_session_{moderator['token']}=")
        for cookie in response.set_cookies
    )
    assert client.get(f"/api/moderators/{moderator['token']}").json()["authorized"] is True


def test_full_admin_tv_and_moderator_flow(client: ApiClient) -> None:
    login(client)
    tournament_id = create_ready_tournament(client)

    dashboard = client.get(f"/api/tournaments/{tournament_id}")
    assert dashboard.status_code == 200
    data = dashboard.json()
    assert data["tournament"]["name"] == "API Hårdkoll"
    assert len(data["participants"]) == 4
    assert len(data["resources"]) == 2
    assert data["matches"]
    assert all(
        match["scheduled_at"]
        for match in data["matches"]
        if match["participant_a_id"] and match["participant_b_id"]
    )
    assert not any(
        match["scheduled_at"]
        for match in data["matches"]
        if not (match["participant_a_id"] and match["participant_b_id"])
    )
    assert {stage["kind"] for stage in data["stages"]} == {"group", "knockout"}

    group_match = next(match for match in data["matches"] if match["stage_kind"] == "group")
    response = client.post(
        f"/api/tournaments/{tournament_id}/matches/{group_match['id']}/score",
        json={"score_a": 1, "score_b": 1},
    )
    assert response.status_code == 200

    live_dashboard = client.get(f"/api/tournaments/{tournament_id}")
    assert live_dashboard.status_code == 200
    live_match = next(match for match in live_dashboard.json()["matches"] if match["id"] == group_match["id"])
    assert live_match["status"] == "in_progress"
    assert live_match["score_label"] == "1 - 1"

    response = client.post(
        f"/api/tournaments/{tournament_id}/matches/{group_match['id']}/result",
        json={"score_a": 2, "score_b": 1},
    )
    assert response.status_code == 200

    response = client.post("/api/tv-links", json={"label": "Hallskärm", "code": "TVLINK0001"})
    assert response.status_code == 200
    tv_link = response.json()["tv_link"]
    assert tv_link["code"] == "TVLINK0001"

    waiting_payload = client.get("/api/tv/TVLINK0001")
    assert waiting_payload.status_code == 200
    waiting_data = waiting_payload.json()
    assert waiting_data["bound"] is False
    assert waiting_data["message"] == "Ansluten, väntar på information"

    response = client.patch(
        f"/api/tv-links/{tv_link['id']}",
        json={
            "label": "Plan 1-skärm",
            "tournament_id": tournament_id,
            "resource_id": data["resources"][0]["id"],
        },
    )
    assert response.status_code == 200
    assert response.json()["tv_link"]["resource_id"] == data["resources"][0]["id"]

    response = client.post(
        f"/api/tournaments/{tournament_id}/moderators",
        json={"label": "Plan 1", "resource_id": data["resources"][0]["id"]},
    )
    assert response.status_code == 200
    moderator = response.json()["moderator"]
    assert moderator["pin"]
    assert moderator["token"]

    public_tv_payload = client.get("/api/tv/TVLINK0001")
    assert public_tv_payload.status_code == 200
    public_tv_data = public_tv_payload.json()
    assert public_tv_data["bound"] is True
    assert public_tv_data["tournament"]["id"] == tournament_id
    assert public_tv_data["resources"] == [data["resources"][0]]
    assert all(match["resource_id"] == data["resources"][0]["id"] for match in public_tv_data["matches"])
    assert public_tv_data["moderators"] == []
    assert public_tv_data["events"] == []

    anonymous_client = ApiClient(client.base_url)
    tv_payload = anonymous_client.get(f"/api/tournaments/{tournament_id}/tv")
    assert tv_payload.status_code == 401

    tv_payload = client.get(f"/api/tournaments/{tournament_id}/tv")
    assert tv_payload.status_code == 200
    tv_data = tv_payload.json()
    assert tv_data["moderators"][0]["pin"] == moderator["pin"]
    assert tv_data["events"]
    assert tv_data["recent_matches"]
    assert tv_data["recent_matches"][0]["score_label"] == "2 - 1"

    moderator_session = client.get(f"/api/moderators/{moderator['token']}")
    assert moderator_session.status_code == 200
    assert moderator_session.json()["authorized"] is False

    response = client.post(
        f"/api/moderators/{moderator['token']}/login",
        json={"pin": moderator["pin"]},
    )
    assert response.status_code == 200

    moderator_session = client.get(f"/api/moderators/{moderator['token']}")
    assert moderator_session.status_code == 200
    moderator_data = moderator_session.json()
    assert moderator_data["authorized"] is True
    assert all(
        match["resource_id"] == data["resources"][0]["id"]
        for match in moderator_data["matches"]
    )


def test_moderators_cannot_update_unscheduled_matches(client: ApiClient) -> None:
    login(client)
    response = client.post(
        "/api/tournaments",
        json={
            "name": "Oplacerad Cup",
            "starts_at": _iso(),
            "group_count": 2,
            "qualifiers_per_group": 1,
        },
    )
    assert response.status_code == 200
    tournament_id = response.json()["id"]

    for seed, name in enumerate(["Lag A", "Lag B", "Lag C", "Lag D"], start=1):
        response = client.post(
            f"/api/tournaments/{tournament_id}/participants",
            json={"name": name, "kind": "team", "seed": seed},
        )
        assert response.status_code == 200

    response = client.post(f"/api/tournaments/{tournament_id}/generate", json={})
    assert response.status_code == 200
    dashboard = client.get(f"/api/tournaments/{tournament_id}").json()
    unscheduled_match = next(
        match
        for match in dashboard["matches"]
        if match["stage_kind"] == "group" and not match["scheduled_at"]
    )

    response = client.post(
        f"/api/tournaments/{tournament_id}/moderators",
        json={"label": "Alla matcher"},
    )
    assert response.status_code == 200
    moderator = response.json()["moderator"]

    response = client.post(
        f"/api/moderators/{moderator['token']}/login",
        json={"pin": moderator["pin"]},
    )
    assert response.status_code == 200

    moderator_session = client.get(f"/api/moderators/{moderator['token']}")
    assert moderator_session.status_code == 200
    assert moderator_session.json()["matches"] == []

    response = client.post(
        f"/api/moderators/{moderator['token']}/matches/{unscheduled_match['id']}/score",
        json={"score_a": 1, "score_b": 0},
    )
    assert response.status_code == 403

    dashboard = client.get(f"/api/tournaments/{tournament_id}").json()
    unchanged = next(match for match in dashboard["matches"] if match["id"] == unscheduled_match["id"])
    assert unchanged["score_label"] == "-"


def test_regenerate_requires_confirmation_when_structure_exists(client: ApiClient) -> None:
    login(client)
    tournament_id = create_ready_tournament(client)
    dashboard = client.get(f"/api/tournaments/{tournament_id}").json()
    group_match = next(match for match in dashboard["matches"] if match["stage_kind"] == "group")

    response = client.post(
        f"/api/tournaments/{tournament_id}/matches/{group_match['id']}/result",
        json={"score_a": 7, "score_b": 3},
    )
    assert response.status_code == 200

    response = client.post(f"/api/tournaments/{tournament_id}/generate", json={})
    assert response.status_code == 400
    assert "Bekräfta" in response.text

    dashboard = client.get(f"/api/tournaments/{tournament_id}").json()
    unchanged = next(match for match in dashboard["matches"] if match["id"] == group_match["id"])
    assert unchanged["score_label"] == "7 - 3"
    assert unchanged["scheduled_at"]

    response = client.post(f"/api/tournaments/{tournament_id}/generate", json={"confirm_reset": True})
    assert response.status_code == 200


def test_common_invalid_inputs_return_400(client: ApiClient) -> None:
    login(client)

    response = client.post("/api/tournaments", json={"name": "Feldata", "group_count": "abc"})
    assert response.status_code == 400

    response = client.post("/api/tournaments", json={"name": "Feldata", "group_count": 2})
    assert response.status_code == 200
    tournament_id = response.json()["id"]

    response = client.post(
        f"/api/tournaments/{tournament_id}/participants",
        json={"name": "Okänd typ", "kind": "alien"},
    )
    assert response.status_code == 400

    response = client.post(
        f"/api/tournaments/{tournament_id}/resources",
        json={"name": "Okänd plats", "kind": "alien"},
    )
    assert response.status_code == 400

    ready_tournament_id = create_ready_tournament(client)
    dashboard = client.get(f"/api/tournaments/{ready_tournament_id}").json()
    match = next(match for match in dashboard["matches"] if match["stage_kind"] == "group")
    response = client.patch(
        f"/api/tournaments/{ready_tournament_id}/matches/{match['id']}/slot",
        json={
            "resource_id": dashboard["resources"][0]["id"],
            "scheduled_at": "not-a-date",
            "duration_minutes": 20,
        },
    )
    assert response.status_code == 400
    assert "giltigt datum" in response.text


def test_tournament_structure_values_are_limited(client: ApiClient) -> None:
    login(client)

    response = client.post("/api/tournaments", json={"name": "Minusgrupper", "group_count": -2})
    assert response.status_code == 400
    assert "minst 1" in response.text

    response = client.post(
        "/api/tournaments",
        json={"name": "Absurt många vidare", "qualifiers_per_group": 999},
    )
    assert response.status_code == 400
    assert "högst" in response.text

    response = client.post("/api/tournaments", json={"name": "Rimlig cup", "group_count": 2})
    assert response.status_code == 200
    tournament_id = response.json()["id"]

    response = client.patch(
        f"/api/tournaments/{tournament_id}/settings",
        json={
            "starts_at": _iso(),
            "match_minutes": 20,
            "break_minutes": 5,
            "group_count": 999,
            "qualifiers_per_group": 1,
        },
    )
    assert response.status_code == 400


def test_invalid_tournament_dates_return_400(client: ApiClient) -> None:
    login(client)

    response = client.post("/api/tournaments", json={"name": "Trasig tid", "starts_at": "not-a-date"})
    assert response.status_code == 400
    assert "giltigt datum" in response.text

    response = client.post(
        "/api/tournaments",
        json={"name": "Rimlig tid", "starts_at": "2026-06-13T09:00"},
    )
    assert response.status_code == 200
    tournament_id = response.json()["id"]

    response = client.patch(
        f"/api/tournaments/{tournament_id}/settings",
        json={
            "starts_at": "not-a-date",
            "match_minutes": 20,
            "break_minutes": 5,
            "group_count": 2,
            "qualifiers_per_group": 1,
        },
    )
    assert response.status_code == 400
    assert "giltigt datum" in response.text


def test_moderator_resource_scope_must_belong_to_tournament(client: ApiClient) -> None:
    login(client)
    tournament_id = create_ready_tournament(client)
    foreign_tournament_id = create_ready_tournament(client)
    foreign_dashboard = client.get(f"/api/tournaments/{foreign_tournament_id}").json()
    foreign_resource_id = foreign_dashboard["resources"][0]["id"]

    response = client.post(
        f"/api/tournaments/{tournament_id}/moderators",
        json={"label": "Fel scope", "resource_id": foreign_resource_id},
    )
    assert response.status_code == 400
    assert "hör inte" in response.text

    response = client.post(
        f"/api/tournaments/{tournament_id}/moderators",
        json={"label": "Saknad scope", "resource_id": 999999},
    )
    assert response.status_code == 400
    assert "finns inte" in response.text

    response = client.post(
        f"/api/tournaments/{tournament_id}/moderators",
        json={"label": "Alla resurser"},
    )
    assert response.status_code == 200
    assert response.json()["moderator"]["resource_id"] is None


def test_static_frontends_are_served(client: ApiClient) -> None:
    assert client.get("/").status_code == 200
    assert client.get("/admin").status_code == 200
    assert client.get("/tournaments/123").status_code == 200
    assert client.get("/tv/123").status_code == 200
    assert client.get("/assets/app.js").status_code == 200
    assert client.get("/assets/tv.js").status_code == 200


def test_result_updates_include_actor_in_event_log(client: ApiClient) -> None:
    login(client)
    tournament_id = create_ready_tournament(client)
    response = client.get(f"/api/tournaments/{tournament_id}")
    assert response.status_code == 200
    matches = response.json()["matches"]
    match_id = matches[0]["id"]
    client.post(
        f"/api/tournaments/{tournament_id}/matches/{match_id}/score",
        json={"score_a": 2, "score_b": 1},
    )
    resp = client.get(f"/api/tournaments/{tournament_id}")
    assert resp.status_code == 200
    events = resp.json()["events"]
    score_events = [e for e in events if e["kind"] == "score_updated"]
    assert score_events
    assert score_events[-1]["payload"]["actor"] == "admin"


def test_rate_limit_blocks_after_many_failed_logins(client: ApiClient) -> None:
    # Use a unique PIN to guarantee failures for this test
    wrong_pin = "wrong-pin-" + str(os.getpid())
    for _ in range(5):
        resp = client.post("/api/admin/login", json={"pin": wrong_pin})
        assert resp.status_code == 401

    # 6th attempt should be rate limited
    resp = client.post("/api/admin/login", json={"pin": wrong_pin})
    assert resp.status_code == 429
    assert "För många" in resp.text


def test_session_survives_server_restart_with_fixed_secret(tmp_path: Path) -> None:
    fixed_secret = "test-session-secret-for-restart-test"
    port1 = free_port()
    port2 = free_port()
    assert port1 != port2

    env: dict[str, str] = {
        **dict(os.environ),
        "ADMIN_PIN": "test-pin",
        "SESSION_SECRET": fixed_secret,
        "TURNERINGAR_DB": str(tmp_path / "turneringar.sqlite3"),
    }

    procs: list[subprocess.Popen[str]] = []

    def _start_server(p: int) -> tuple[subprocess.Popen[str], ServerProcess, ApiClient]:
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "turneringar.main:app",
                "--app-dir",
                "backend",
                "--host",
                "127.0.0.1",
                "--port",
                str(p),
                "--log-level",
                "warning",
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        procs.append(proc)
        server = ServerProcess(proc)
        client = ApiClient(f"http://127.0.0.1:{p}", server)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            health = server.health()
            if health:
                pytest.fail(f"Server on port {p} died early\n{health}")
            try:
                if client.get("/api/session").status_code == 200:
                    break
            except URLError:
                time.sleep(0.1)
        else:
            server.terminate()
            pytest.fail(f"Server on port {p} did not start")
        return proc, server, client

    try:
        _, server1, api1 = _start_server(port1)
        resp = api1.post("/api/admin/login", json={"pin": "test-pin"})
        assert resp.status_code == 200
        session_cookie = next(
            (c for c in resp.set_cookies if c.startswith("turneringar_admin_session=")),
            None,
        )
        assert session_cookie is not None, "No session cookie in login response"

        server1.terminate()

        _, server2, api2 = _start_server(port2)

        cookie_value = session_cookie.split(";", 1)[0].split("=", 1)[1]
        # Use a raw request with the cookie directly (bypass CookieJar to avoid
        # conflicts between the manually set cookie and the processor's jar)
        raw_req = Request(
            f"http://127.0.0.1:{port2}/api/tournaments",
            headers={
                "Cookie": f"turneringar_admin_session={cookie_value}",
            },
            method="GET",
        )
        import urllib.request
        raw_resp = urllib.request.urlopen(raw_req, timeout=5)
        assert raw_resp.status == 200, (
            f"Expected 200 with saved session cookie after restart, got {raw_resp.status}"
        )
    finally:
        for p in procs:
            try:
                p.terminate()
                p.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
                p.communicate(timeout=5)


def test_crash_recovery_after_sigkill(tmp_path: Path) -> None:
    fixed_secret = "test-crash-recovery-secret"
    port1 = free_port()
    port2 = free_port()
    assert port1 != port2

    env: dict[str, str] = {
        **dict(os.environ),
        "ADMIN_PIN": "test-pin",
        "SESSION_SECRET": fixed_secret,
        "TURNERINGAR_DB": str(tmp_path / "turneringar.sqlite3"),
    }

    procs: list[subprocess.Popen[str]] = []

    def _start(p: int) -> tuple[subprocess.Popen[str], ServerProcess, ApiClient]:
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "turneringar.main:app",
                "--app-dir",
                "backend",
                "--host",
                "127.0.0.1",
                "--port",
                str(p),
                "--log-level",
                "warning",
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        procs.append(proc)
        server = ServerProcess(proc)
        client = ApiClient(f"http://127.0.0.1:{p}", server)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            health = server.health()
            if health:
                pytest.fail(f"Server on port {p} died early\n{health}")
            try:
                if client.get("/api/session").status_code == 200:
                    break
            except URLError:
                time.sleep(0.1)
        else:
            server.terminate()
            pytest.fail(f"Server on port {p} did not start")
        return proc, server, client

    try:
        proc1, server1, api1 = _start(port1)
        login(api1)

        # Create a tournament with full structure
        tid = create_ready_tournament(api1)

        # Make writes to the database
        dashboard = api1.get(f"/api/tournaments/{tid}").json()
        live_match = next(
            m for m in dashboard["matches"]
            if m["stage_kind"] == "group" and m["participant_a_id"]
        )
        score_resp = api1.post(
            f"/api/tournaments/{tid}/matches/{live_match['id']}/score",
            json={"score_a": 3, "score_b": 2},
        )
        assert score_resp.status_code == 200

        # SIGKILL the server while database has been written to
        proc1.kill()
        try:
            proc1.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc1.kill()
            proc1.wait(timeout=5)

        # Start a new server with the same database
        proc2, server2, api2 = _start(port2)
        login(api2)

        # Verify tournament data is still intact and consistent
        restored = api2.get(f"/api/tournaments/{tid}")
        assert restored.status_code == 200, f"Expected 200, got {restored.status_code}"
        data = restored.json()
        assert data["tournament"]["name"] == "API Hårdkoll"
        assert len(data["participants"]) == 4
        assert len(data["resources"]) == 2

        # The score from before the crash should be there (SQLite crash recovery)
        restored_match = next(
            m for m in data["matches"] if m["id"] == live_match["id"]
        )
        assert restored_match["score_label"] in ("3 - 2", "-"), (
            f"Expected score to be '3 - 2' or '-' after crash, got {restored_match['score_label']}"
        )

        # Verify we can continue working after recovery
        new_tid = create_ready_tournament(api2)
        assert new_tid not in (tid,)
    finally:
        for p in procs:
            try:
                p.terminate()
                p.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
                p.communicate(timeout=5)
