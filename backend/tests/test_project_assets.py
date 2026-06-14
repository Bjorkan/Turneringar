from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_frontend_uses_vue_and_typescript_sources() -> None:
    index = read("frontend/index.html")
    tv = read("frontend/tv.html")
    app_ts = read("frontend/src/app.ts")
    tv_ts = read("frontend/src/tv.ts")
    frontend_test = read("frontend/tests/admin-flow.spec.ts")

    assert "/assets/vendor/vue.global.prod.js" in index
    assert "/assets/vendor/vue.global.prod.js" in tv
    assert "createApp" in app_ts
    assert "createApp" in tv_ts
    assert "playwright/test" in frontend_test
    assert "React" not in index + tv + app_ts + tv_ts


def test_frontend_static_outputs_exist() -> None:
    assert (ROOT / "frontend/static/app.js").is_file()
    assert (ROOT / "frontend/static/tv.js").is_file()
    assert (ROOT / "frontend/static/vendor/vue.global.prod.js").is_file()


def test_container_contract_is_documented_in_dockerfile() -> None:
    dockerfile = read("Dockerfile")

    assert "EXPOSE 8000" in dockerfile
    assert "TURNERINGAR_DB=/data/turneringar/turneringar.sqlite3" in dockerfile
    assert "mkdir -p /data/turneringar" in dockerfile


def test_ci_runs_strict_build_test_and_publish_checks() -> None:
    workflow = read(".github/workflows/ci.yml")

    assert "npm run typecheck" in workflow
    assert "npm run build:frontend" in workflow
    assert "npx playwright install --with-deps chromium" in workflow
    assert "npm run test:frontend" in workflow
    assert "python -m pytest -q" in workflow
    assert "docker build -t turneringar:test ." in workflow
    assert "http://127.0.0.1:8000/api/session" in workflow
    assert "http://127.0.0.1:8000/assets/app.js" in workflow
    assert "http://127.0.0.1:8000/assets/tv.js" in workflow
    assert "ghcr.io/bjorkan/turneringar" in workflow
    assert "bjorkan/turneringar" in workflow
    assert "type=raw,value=edge" in workflow
    assert "type=raw,value=latest" in workflow
