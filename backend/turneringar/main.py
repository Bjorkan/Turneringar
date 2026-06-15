from __future__ import annotations

import asyncio
import os
import sqlite3
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
ADMIN_COOKIE = "turneringar_admin_pin"
ADMIN_PIN = os.environ.get("ADMIN_PIN", "admin123")

app = FastAPI(title="Turneringar API")
app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "static")), name="assets")


@app.on_event("startup")
def startup() -> None:
    initialize_database()


def is_admin(request: Request) -> bool:
    return request.cookies.get(ADMIN_COOKIE) == ADMIN_PIN


def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="Admin-PIN krävs.")


async def json_body(request: Request) -> dict[str, Any]:
    if not request.headers.get("content-type", "").startswith("application/json"):
        return {}
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON-objekt krävs.")
    return body


def parse_int(value: Any, default: int | None = None) -> int | None:
    if value is None or value == "":
        return default
    return int(value)


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
    response.set_cookie(ADMIN_COOKIE, ADMIN_PIN, httponly=True, samesite="lax")
    return response


@app.post("/api/admin/logout")
def admin_logout() -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie(ADMIN_COOKIE)
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
                starts_at=payload.get("starts_at") or None,
                group_count=parse_int(payload.get("group_count"), 2) or 2,
                qualifiers_per_group=parse_int(payload.get("qualifiers_per_group"), 2) or 2,
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
                str(payload.get("starts_at") or store.default_start_time()),
                parse_int(payload.get("match_minutes"), 20) or 20,
                parse_int(payload.get("break_minutes"), 5) or 5,
                parse_int(payload.get("group_count"), 2) or 2,
                parse_int(payload.get("qualifiers_per_group"), 2) or 2,
            )
            store.add_event(conn, tournament_id, "settings_updated", {"tournament_id": tournament_id})
    publish(tournament_id, "settings_updated")
    return {"ok": True}


@app.post("/api/tournaments/{tournament_id}/participants")
async def add_participant(request: Request, tournament_id: int) -> dict[str, Any]:
    require_admin(request)
    payload = await json_body(request)
    name = require_text(payload, "name", "Deltagarnamn")
    with session() as conn:
        with conn:
            participant_id = store.add_participant(
                conn,
                tournament_id,
                name,
                str(payload.get("kind") or "team"),
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
    with session() as conn:
        with conn:
            resource_id = store.add_resource(conn, tournament_id, name, str(payload.get("kind") or "court"))
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
    with session() as conn:
        with conn:
            moderator = store.create_moderator_token(
                conn,
                tournament_id,
                label,
                parse_int(payload.get("resource_id")),
            )
    return {"moderator": moderator}


@app.get("/api/moderators/{token}")
def moderator_session(request: Request, token: str) -> dict[str, Any]:
    with session() as conn:
        moderator = store.get_moderator_token(conn, token)
        if not moderator:
            raise HTTPException(status_code=404, detail="Moderatorlänken finns inte.")
        authorized = request.cookies.get(f"moderator_{token}") == moderator["pin"]
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
    response.set_cookie(f"moderator_{token}", moderator["pin"], httponly=True, samesite="lax")
    return response


@app.post("/api/moderators/{token}/matches/{match_id}/result")
async def moderator_result(request: Request, token: str, match_id: int) -> dict[str, Any]:
    payload = await json_body(request)
    with session() as conn:
        moderator = store.get_moderator_token(conn, token)
        if not moderator or request.cookies.get(f"moderator_{token}") != moderator["pin"]:
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
        if not moderator or request.cookies.get(f"moderator_{token}") != moderator["pin"]:
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
