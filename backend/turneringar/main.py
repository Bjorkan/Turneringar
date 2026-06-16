from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import services, store
from .db import initialize_database, session
from .realtime import hub, tv_hub


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
ADMIN_COOKIE = "turneringar_admin_session"
LEGACY_ADMIN_COOKIE = "turneringar_admin_pin"
MODERATOR_COOKIE_PREFIX = "turneringar_moderator_session_"
LEGACY_MODERATOR_COOKIE_PREFIX = "moderator_"
ADMIN_PIN = os.environ.get("ADMIN_PIN", "admin123")
SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_urlsafe(32)
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
PARTICIPANT_KINDS = {"team", "player"}
RESOURCE_KINDS = {"court", "server", "table"}
MAX_GROUP_COUNT = 64
MAX_QUALIFIERS_PER_GROUP = 64

app = FastAPI(title="Turneringar API")
app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "static")), name="assets")


@app.on_event("startup")
def startup() -> None:
    initialize_database()


def base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def signed_session_value(kind: str, subject: str) -> str:
    payload = {
        "kind": kind,
        "subject": subject,
        "iat": int(time.time()),
        "nonce": secrets.token_urlsafe(16),
    }
    body = base64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = base64url_encode(
        hmac.new(SESSION_SECRET.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    )
    return f"{body}.{signature}"


def valid_signed_session(value: str | None, kind: str, subject: str) -> bool:
    if not value or "." not in value:
        return False
    body, signature = value.split(".", 1)
    expected_signature = base64url_encode(
        hmac.new(SESSION_SECRET.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(signature, expected_signature):
        return False
    try:
        payload = json.loads(base64url_decode(body).decode("utf-8"))
        issued_at = int(payload.get("iat", 0))
    except (binascii.Error, TypeError, ValueError, UnicodeDecodeError):
        return False
    now = int(time.time())
    return (
        payload.get("kind") == kind
        and payload.get("subject") == subject
        and now - SESSION_MAX_AGE_SECONDS <= issued_at <= now + 60
    )


def moderator_cookie_name(token: str) -> str:
    return f"{MODERATOR_COOKIE_PREFIX}{token}"


def legacy_moderator_cookie_name(token: str) -> str:
    return f"{LEGACY_MODERATOR_COOKIE_PREFIX}{token}"


def set_session_cookie(response: JSONResponse, name: str, value: str) -> None:
    response.set_cookie(name, value, httponly=True, samesite="lax", max_age=SESSION_MAX_AGE_SECONDS)


def is_admin(request: Request) -> bool:
    return valid_signed_session(request.cookies.get(ADMIN_COOKIE), "admin", "admin")


def is_moderator_authorized(request: Request, token: str) -> bool:
    return valid_signed_session(request.cookies.get(moderator_cookie_name(token)), "moderator", token)


def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="Admin-PIN krävs.")


async def json_body(request: Request) -> dict[str, Any]:
    if not request.headers.get("content-type", "").startswith("application/json"):
        return {}
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Ogiltig JSON.") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON-objekt krävs.")
    return body


def parse_int(value: Any, default: int | None = None) -> int | None:
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Värdet måste vara ett heltal.") from exc


def parse_limited_int(
    payload: dict[str, Any],
    key: str,
    label: str,
    default: int,
    maximum: int,
) -> int:
    value = parse_int(payload.get(key), default) or default
    if value < 1:
        raise HTTPException(status_code=400, detail=f"{label} måste vara minst 1.")
    if value > maximum:
        raise HTTPException(status_code=400, detail=f"{label} får vara högst {maximum}.")
    return value


def parse_local_datetime_value(value: Any, label: str, default: str | None = None) -> str | None:
    if value is None or value == "":
        return default
    text = str(value)
    try:
        services.parse_local_datetime(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{label} måste vara ett giltigt datum.") from exc
    return text


def require_text(payload: dict[str, Any], key: str, label: str) -> str:
    value = str(payload.get(key, "")).strip()
    if not value:
        raise HTTPException(status_code=400, detail=f"{label} saknas.")
    return value


def parse_score(payload: dict[str, Any], key: str, label: str) -> int:
    value = payload.get(key)
    if value is None or value == "":
        raise HTTPException(status_code=400, detail=f"{label} saknas.")
    try:
        score = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"{label} måste vara ett heltal.") from exc
    if score < 0:
        raise HTTPException(status_code=400, detail=f"{label} kan inte vara negativt.")
    return score


def dashboard_payload(tournament_id: int) -> dict[str, Any]:
    with session() as conn:
        tournament = store.get_tournament(conn, tournament_id)
        if not tournament:
            raise HTTPException(status_code=404, detail="Turneringen finns inte.")
        matches = store.list_matches(conn, tournament_id)
        live = services.current_and_upcoming(matches)
        return {
            "tournament": tournament,
            "participants": store.list_participants(conn, tournament_id),
            "resources": store.list_resources(conn, tournament_id),
            "stages": store.list_stages(conn, tournament_id),
            "groups": store.list_groups(conn, tournament_id),
            "matches": matches,
            "standings": services.group_standings(conn, tournament_id),
            "moderators": store.list_moderator_tokens(conn, tournament_id),
            "events": store.list_recent_events(conn, tournament_id),
            "current_matches": live["current"],
            "upcoming_matches": live["upcoming"],
            "recent_matches": live["recent"],
        }


def public_tv_dashboard_payload(tournament_id: int) -> dict[str, Any]:
    payload = dashboard_payload(tournament_id)
    payload["moderators"] = []
    payload["events"] = []
    return payload


def filter_tv_payload_by_resource(payload: dict[str, Any], resource_id: int | None) -> dict[str, Any]:
    if resource_id is None:
        return payload
    for key in ("matches", "current_matches", "upcoming_matches", "recent_matches"):
        payload[key] = [
            match
            for match in payload.get(key, [])
            if match.get("resource_id") == resource_id
        ]
    payload["resources"] = [
        resource
        for resource in payload.get("resources", [])
        if resource.get("id") == resource_id
    ]
    return payload


def tv_payload(code: str) -> dict[str, Any]:
    with session() as conn:
        tv_link = store.get_tv_link_by_code(conn, code)
    if not tv_link:
        raise HTTPException(status_code=404, detail="TV-länken finns inte.")
    if not tv_link.get("tournament_id"):
        return {
            "tv_link": tv_link,
            "bound": False,
            "message": "Ansluten, väntar på information",
        }
    payload = public_tv_dashboard_payload(int(tv_link["tournament_id"]))
    payload = filter_tv_payload_by_resource(payload, tv_link.get("resource_id"))
    payload["tv_link"] = tv_link
    payload["bound"] = True
    return payload


def publish(tournament_id: int, kind: str, payload: dict[str, Any] | None = None) -> None:
    event_payload = payload or {"tournament_id": tournament_id}
    hub.publish(tournament_id, kind, event_payload)
    with session() as conn:
        for tv_link in store.list_tv_links_for_tournament(conn, tournament_id):
            tv_hub.publish(tv_link["code"], kind, event_payload)


@app.get("/", include_in_schema=False)
def root() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/admin", include_in_schema=False)
def admin_frontend() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/admin/tv", include_in_schema=False)
def live_tv_admin_frontend() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/login", include_in_schema=False)
def login_redirect() -> RedirectResponse:
    return RedirectResponse("/", status_code=303)


@app.get("/tournaments/{tournament_id}", include_in_schema=False)
def tournament_frontend(tournament_id: int) -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/m/{token}", include_in_schema=False)
def moderator_frontend(token: str) -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/tv/{code}", include_in_schema=False)
def tv_frontend(code: str) -> FileResponse:
    return FileResponse(FRONTEND_DIR / "tv.html")


@app.get("/api/session")
def session_status(request: Request) -> dict[str, Any]:
    return {"is_admin": is_admin(request), "admin_pin_default": ADMIN_PIN == "admin123"}


@app.post("/api/admin/login")
async def admin_login(request: Request) -> JSONResponse:
    payload = await json_body(request)
    if payload.get("pin") != ADMIN_PIN:
        raise HTTPException(status_code=401, detail="Fel admin-PIN.")
    response = JSONResponse({"ok": True})
    set_session_cookie(response, ADMIN_COOKIE, signed_session_value("admin", "admin"))
    response.delete_cookie(LEGACY_ADMIN_COOKIE)
    return response


@app.post("/api/admin/logout")
def admin_logout() -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie(ADMIN_COOKIE)
    response.delete_cookie(LEGACY_ADMIN_COOKIE)
    return response


@app.get("/api/tournaments")
def list_tournaments(request: Request) -> dict[str, Any]:
    require_admin(request)
    with session() as conn:
        tournaments = store.list_tournaments(conn)
    return {"tournaments": tournaments}


@app.post("/api/tournaments")
async def create_tournament(request: Request) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    name = require_text(payload, "name", "Namn")
    with session() as conn:
        with conn:
            tournament_id = store.create_tournament(
                conn,
                name,
                starts_at=parse_local_datetime_value(payload.get("starts_at"), "Start"),
                group_count=parse_limited_int(payload, "group_count", "Grupper", 2, MAX_GROUP_COUNT),
                qualifiers_per_group=parse_limited_int(
                    payload,
                    "qualifiers_per_group",
                    "Vidare/grupp",
                    2,
                    MAX_QUALIFIERS_PER_GROUP,
                ),
            )
    return {"id": tournament_id}


@app.get("/api/tournaments/{tournament_id}")
def tournament_dashboard(request: Request, tournament_id: int) -> dict[str, Any]:
    require_admin(request)
    return dashboard_payload(tournament_id)


@app.get("/api/tournaments/{tournament_id}/tv")
def tournament_tv(request: Request, tournament_id: int) -> dict[str, Any]:
    require_admin(request)
    return dashboard_payload(tournament_id)


@app.get("/api/tv-links")
def tv_links(request: Request) -> dict[str, Any]:
    require_admin(request)
    with session() as conn:
        return {
            "tv_links": store.list_tv_links(conn),
            "tournaments": store.list_tournaments(conn),
            "resources": store.list_all_resources(conn),
        }


@app.post("/api/tv-links")
async def create_tv_link(request: Request) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    label = str(payload.get("label") or "Live TV").strip() or "Live TV"
    code = str(payload.get("code") or "").strip() or None
    try:
        with session() as conn:
            with conn:
                tv_link = store.create_tv_link(conn, label, code)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=400, detail="TV-koden används redan.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    tv_hub.publish(tv_link["code"], "tv_link_updated", {"code": tv_link["code"]})
    return {"tv_link": tv_link}


@app.patch("/api/tv-links/{link_id}")
async def update_tv_link(request: Request, link_id: int) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    try:
        with session() as conn:
            with conn:
                tv_link = store.update_tv_link(
                    conn,
                    link_id,
                    label=str(payload.get("label") or "").strip() or None,
                    tournament_id=parse_int(payload.get("tournament_id")),
                    resource_id=parse_int(payload.get("resource_id")),
                )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    tv_hub.publish(tv_link["code"], "tv_link_updated", {"code": tv_link["code"]})
    return {"tv_link": tv_link}


@app.delete("/api/tv-links/{link_id}")
async def delete_tv_link(request: Request, link_id: int) -> dict[str, Any]:
    require_admin(request)
    try:
        with session() as conn:
            with conn:
                tv_link = store.get_tv_link_by_id(conn, link_id)
                if not tv_link:
                    raise HTTPException(status_code=404, detail="TV-länken finns inte.")
                code = tv_link["code"]
                store.delete_tv_link(conn, link_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    tv_hub.publish(code, "tv_link_updated", {"code": code})
    return {"ok": True}


@app.get("/api/tv/{code}")
def tv_link_payload(code: str) -> dict[str, Any]:
    return tv_payload(code)


@app.patch("/api/tournaments/{tournament_id}/settings")
async def update_settings(request: Request, tournament_id: int) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    with session() as conn:
        with conn:
            store.update_tournament_settings(
                conn,
                tournament_id,
                parse_local_datetime_value(payload.get("starts_at"), "Start", store.default_start_time()),
                parse_int(payload.get("match_minutes"), 20) or 20,
                parse_int(payload.get("break_minutes"), 5) or 5,
                parse_limited_int(payload, "group_count", "Grupper", 2, MAX_GROUP_COUNT),
                parse_limited_int(
                    payload,
                    "qualifiers_per_group",
                    "Vidare/grupp",
                    2,
                    MAX_QUALIFIERS_PER_GROUP,
                ),
            )
            store.add_event(conn, tournament_id, "settings_updated", {"tournament_id": tournament_id})
    publish(tournament_id, "settings_updated")
    return {"ok": True}


@app.post("/api/tournaments/{tournament_id}/participants")
async def add_participant(request: Request, tournament_id: int) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    name = require_text(payload, "name", "Deltagarnamn")
    kind = str(payload.get("kind") or "team")
    if kind not in PARTICIPANT_KINDS:
        raise HTTPException(status_code=400, detail="Deltagartypen är ogiltig.")
    with session() as conn:
        with conn:
            participant_id = store.add_participant(
                conn,
                tournament_id,
                name,
                kind,
                parse_int(payload.get("seed")),
            )
            store.add_event(conn, tournament_id, "participant_added", {"participant_id": participant_id})
    publish(tournament_id, "participant_added", {"participant_id": participant_id})
    return {"id": participant_id}


@app.post("/api/tournaments/{tournament_id}/resources")
async def add_resource(request: Request, tournament_id: int) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    name = require_text(payload, "name", "Resursnamn")
    kind = str(payload.get("kind") or "court")
    if kind not in RESOURCE_KINDS:
        raise HTTPException(status_code=400, detail="Resurstypen är ogiltig.")
    with session() as conn:
        with conn:
            resource_id = store.add_resource(conn, tournament_id, name, kind)
            store.add_event(conn, tournament_id, "resource_added", {"resource_id": resource_id})
    publish(tournament_id, "resource_added", {"resource_id": resource_id})
    return {"id": resource_id}


@app.post("/api/tournaments/{tournament_id}/generate")
async def generate_structure(request: Request, tournament_id: int) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    try:
        with session() as conn:
            services.generate_structure(
                conn,
                tournament_id,
                confirm_reset=bool(payload.get("confirm_reset")),
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish(tournament_id, "structure_generated")
    return {"ok": True}


@app.post("/api/tournaments/{tournament_id}/schedule")
def schedule_matches(request: Request, tournament_id: int) -> dict[str, Any]:
    require_admin(request)
    try:
        with session() as conn:
            services.schedule_matches(conn, tournament_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish(tournament_id, "schedule_updated")
    return {"ok": True}


@app.patch("/api/tournaments/{tournament_id}/matches/{match_id}/slot")
async def override_match(request: Request, tournament_id: int, match_id: int) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    with session() as conn:
        errors = services.apply_manual_slot(
            conn,
            tournament_id,
            match_id,
            parse_int(payload.get("resource_id"), 0) or 0,
            str(payload.get("scheduled_at") or ""),
            parse_int(payload.get("duration_minutes"), 20) or 20,
        )
    if errors:
        raise HTTPException(status_code=400, detail=" ".join(errors))
    publish(tournament_id, "schedule_updated", {"match_id": match_id})
    return {"ok": True}


@app.post("/api/tournaments/{tournament_id}/matches/{match_id}/result")
async def admin_result(request: Request, tournament_id: int, match_id: int) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    try:
        with session() as conn:
            services.update_match_result(
                conn,
                tournament_id,
                match_id,
                parse_score(payload, "score_a", "Poäng A"),
                parse_score(payload, "score_b", "Poäng B"),
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish(tournament_id, "result_updated", {"match_id": match_id})
    return {"ok": True}


@app.post("/api/tournaments/{tournament_id}/matches/{match_id}/score")
async def admin_score(request: Request, tournament_id: int, match_id: int) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    try:
        with session() as conn:
            services.update_match_score(
                conn,
                tournament_id,
                match_id,
                parse_score(payload, "score_a", "Poäng A"),
                parse_score(payload, "score_b", "Poäng B"),
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish(tournament_id, "score_updated", {"match_id": match_id})
    return {"ok": True}


@app.post("/api/tournaments/{tournament_id}/moderators")
async def add_moderator(request: Request, tournament_id: int) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    label = require_text(payload, "label", "Etikett")
    try:
        with session() as conn:
            with conn:
                moderator = store.create_moderator_token(
                    conn,
                    tournament_id,
                    label,
                    parse_int(payload.get("resource_id")),
                )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"moderator": moderator}


@app.delete("/api/tournaments/{tournament_id}/moderators/{moderator_id}")
async def delete_moderator(request: Request, tournament_id: int, moderator_id: int) -> dict[str, Any]:
    require_admin(request)
    try:
        with session() as conn:
            with conn:
                mod = store.get_moderator_token_by_id(conn, moderator_id)
                if not mod:
                    raise HTTPException(status_code=404, detail="Moderatorlänken finns inte.")
                if int(mod["tournament_id"]) != tournament_id:
                    raise HTTPException(status_code=404, detail="Moderatorlänken finns inte i denna turnering.")
                store.delete_moderator_token(conn, moderator_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/moderators/{token}")
def moderator_session(request: Request, token: str) -> dict[str, Any]:
    with session() as conn:
        moderator = store.get_moderator_token(conn, token)
        if not moderator:
            raise HTTPException(status_code=404, detail="Moderatorlänken finns inte.")
        authorized = is_moderator_authorized(request, token)
        matches = []
        if authorized:
            matches = [
                match
                for match in store.list_matches(conn, moderator["tournament_id"])
                if services.moderator_can_update_match(conn, moderator, match["id"])
                and services.match_is_playable(match)
                and match["status"] != "completed"
            ]
    safe_moderator = dict(moderator)
    safe_moderator.pop("pin", None)
    return {"authorized": authorized, "moderator": safe_moderator, "matches": matches}


@app.post("/api/moderators/{token}/login")
async def moderator_login(request: Request, token: str) -> JSONResponse:
    payload = await json_body(request)
    with session() as conn:
        moderator = store.get_moderator_token(conn, token)
    if not moderator or payload.get("pin") != moderator["pin"]:
        raise HTTPException(status_code=401, detail="Fel PIN.")
    response = JSONResponse({"ok": True})
    set_session_cookie(response, moderator_cookie_name(token), signed_session_value("moderator", token))
    response.delete_cookie(legacy_moderator_cookie_name(token))
    return response


@app.post("/api/moderators/{token}/matches/{match_id}/result")
async def moderator_result(request: Request, token: str, match_id: int) -> dict[str, Any]:
    payload = await json_body(request)
    with session() as conn:
        moderator = store.get_moderator_token(conn, token)
        if not moderator or not is_moderator_authorized(request, token):
            raise HTTPException(status_code=401, detail="Logga in med PIN först.")
        if not services.moderator_can_update_match(conn, moderator, match_id):
            raise HTTPException(status_code=403, detail="Matchen ingår inte i din behörighet.")
        try:
            services.update_match_result(
                conn,
                moderator["tournament_id"],
                match_id,
                parse_score(payload, "score_a", "Poäng A"),
                parse_score(payload, "score_b", "Poäng B"),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish(moderator["tournament_id"], "result_updated", {"match_id": match_id})
    return {"ok": True}


@app.post("/api/moderators/{token}/matches/{match_id}/score")
async def moderator_score(request: Request, token: str, match_id: int) -> dict[str, Any]:
    payload = await json_body(request)
    with session() as conn:
        moderator = store.get_moderator_token(conn, token)
        if not moderator or not is_moderator_authorized(request, token):
            raise HTTPException(status_code=401, detail="Logga in med PIN först.")
        if not services.moderator_can_update_match(conn, moderator, match_id):
            raise HTTPException(status_code=403, detail="Matchen ingår inte i din behörighet.")
        try:
            services.update_match_score(
                conn,
                moderator["tournament_id"],
                match_id,
                parse_score(payload, "score_a", "Poäng A"),
                parse_score(payload, "score_b", "Poäng B"),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    publish(moderator["tournament_id"], "score_updated", {"match_id": match_id})
    return {"ok": True}


@app.get("/api/events/{tournament_id}")
async def events(tournament_id: int):
    async def stream():
        async for queue in hub.subscribe(tournament_id):
            yield "event: connected\ndata: {\"ok\": true}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                    yield event.to_sse()
                except asyncio.TimeoutError:
                    yield "event: ping\ndata: {}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/api/tv/{code}/events")
async def tv_events(code: str):
    channel = store.normalize_tv_code(code)

    async def stream():
        async for queue in tv_hub.subscribe(channel):
            yield "event: connected\ndata: {\"ok\": true}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                    yield event.to_sse()
                except asyncio.TimeoutError:
                    yield "event: ping\ndata: {}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
