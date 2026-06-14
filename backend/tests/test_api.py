from __future__ import annotations

from collections.abc import Iterator
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener

import pytest
from http.cookiejar import CookieJar


ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class ApiResponse:
    def __init__(self, status_code: int, body: str) -> None:
        self.status_code = status_code
        self.text = body

    def json(self) -> object:
        return json.loads(self.text)


class ApiClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def request(self, method: str, path: str, payload: dict[str, object] | None = None) -> ApiResponse:
        body = None
        headers = {}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(
            urljoin(self.base_url, path),
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with self.opener.open(request, timeout=5) as response:
                text = response.read().decode("utf-8")
                return ApiResponse(response.status, text)
        except HTTPError as exc:
            text = exc.read().decode("utf-8")
            return ApiResponse(exc.code, text)

    def get(self, path: str) -> ApiResponse:
        return self.request("GET", path)

    def post(self, path: str, json: dict[str, object]) -> ApiResponse:
        return self.request("POST", path, json)


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[ApiClient]:
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
    api_client = ApiClient(f"http://127.0.0.1:{port}")
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, stderr = process.communicate()
            pytest.fail(f"uvicorn exited early\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}")
        try:
            if api_client.get("/api/session").status_code == 200:
                break
        except URLError:
            time.sleep(0.1)
    else:
        process.terminate()
        stdout, stderr = process.communicate(timeout=5)
        pytest.fail(f"uvicorn did not start\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}")

    try:
        yield api_client
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=5)


def login(client: ApiClient) -> None:
    response = client.post("/api/admin/login", json={"pin": "test-pin"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def create_ready_tournament(client: ApiClient) -> int:
    response = client.post(
        "/api/tournaments",
        json={
            "name": "API Hårdkoll",
            "starts_at": "2026-06-13T09:00",
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
    assert all(match["scheduled_at"] for match in data["matches"])
    assert {stage["kind"] for stage in data["stages"]} == {"group", "knockout"}

    group_match = next(match for match in data["matches"] if match["stage_kind"] == "group")
    response = client.post(
        f"/api/tournaments/{tournament_id}/matches/{group_match['id']}/result",
        json={"score_a": 2, "score_b": 1},
    )
    assert response.status_code == 200

    tv_payload = client.get(f"/api/tournaments/{tournament_id}/tv")
    assert tv_payload.status_code == 200
    tv_data = tv_payload.json()
    assert tv_data["recent_matches"]
    assert tv_data["recent_matches"][0]["score_label"] == "2 - 1"

    response = client.post(
        f"/api/tournaments/{tournament_id}/moderators",
        json={"label": "Plan 1", "resource_id": data["resources"][0]["id"]},
    )
    assert response.status_code == 200
    moderator = response.json()["moderator"]
    assert moderator["pin"]
    assert moderator["token"]

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


def test_static_frontends_are_served(client: ApiClient) -> None:
    assert client.get("/").status_code == 200
    assert client.get("/admin").status_code == 200
    assert client.get("/tournaments/123").status_code == 200
    assert client.get("/tv/123").status_code == 200
    assert client.get("/assets/app.js").status_code == 200
    assert client.get("/assets/tv.js").status_code == 200
    assert client.get("/assets/vendor/vue.global.prod.js").status_code == 200
