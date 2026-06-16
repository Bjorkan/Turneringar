from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_frontend_static_outputs_exist() -> None:
    static = ROOT / "frontend/static"
    assert (static / "app.css").is_file(), "app.css ska finnas efter bygge"
    assert (static / "app.js").is_file(), "app.js ska finnas efter bygge"
    assert (static / "tv.js").is_file(), "tv.js ska finnas efter bygge"
    assert (static / "chunks").is_dir(), "chunks-katalog ska finnas efter bygge"


def test_built_javascript_is_valid_and_contains_react() -> None:
    app_js = read("frontend/static/app.js")
    tv_js = read("frontend/static/tv.js")

    assert "StrictMode" in app_js, "app.js ska använda React.StrictMode"
    assert "useState" in app_js + tv_js, "app.js eller tv.js ska använda React hooks"
    assert "jsx" in app_js + tv_js, "app.js eller tv.js ska vara byggd med React/jsx"




def test_frontend_html_references_built_assets() -> None:
    index = read("frontend/index.html")
    tv = read("frontend/tv.html")

    assert 'type="module" src="/assets/app.js"' in index
    assert 'type="module" src="/assets/tv.js"' in tv
    assert "admin-shell" in read("frontend/public/app.css")


def test_container_contract_is_documented_in_dockerfile() -> None:
    dockerfile = read("Dockerfile")

    assert "EXPOSE 8000" in dockerfile
    assert "TURNERINGAR_DB=/data/turneringar/turneringar.sqlite3" in dockerfile
    assert "mkdir -p /data/turneringar" in dockerfile
    assert "SESSION_SECRET" in dockerfile, "Dockerfile ska dokumentera SESSION_SECRET"


def test_ci_has_required_jobs_and_no_unexpected_renders() -> None:
    workflow = read(".github/workflows/ci.yml")

    assert "name: Testa, bygg och publicera" in workflow

    # Each expected job name should appear
    required_jobs = [
        "Kvalitet och tester",
        "Bygg och smoke-testa Docker-image",
        "Publicera Docker-image",
    ]
    for job in required_jobs:
        assert f"name: {job}" in workflow, f"Job '{job}' should exist in CI"

    # Essential build and test commands should be present
    essential_commands = [
        "npm run typecheck",
        "npm run build:frontend",
        "npx playwright install --with-deps chromium",
        "npm run test:frontend",
        "python -m pytest -q",
        "docker build",
    ]
    for cmd in essential_commands:
        assert cmd in workflow, f"Essential command '{cmd}' should be in CI"

    # Docker registries should be referenced
    for registry in ("ghcr.io/bjorkan/turneringar", "bjorkan/turneringar"):
        assert registry in workflow, f"Docker registry '{registry}' should be in CI"
