from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_frontend_uses_react_and_vite_sources() -> None:
    index = read("frontend/index.html")
    tv = read("frontend/tv.html")
    main_tsx = read("frontend/src/admin/main.tsx")
    admin_app = read("frontend/src/admin/AdminApp.tsx")
    tv_tsx = read("frontend/src/tv/main.tsx")
    tv_app = read("frontend/src/tv/TvApp.tsx")
    vite_config = read("frontend/vite.config.ts")
    app_css = read("frontend/public/app.css")
    frontend_test = read("frontend/tests/admin-flow.spec.ts")

    assert 'type="module" src="/assets/app.js"' in index
    assert 'type="module" src="/assets/tv.js"' in tv
    assert "createRoot" in main_tsx + tv_tsx
    assert "React" in main_tsx + tv_tsx
    assert "useState" in admin_app + tv_app
    assert "@vitejs/plugin-react" in vite_config
    assert "src/admin/main.tsx" in vite_config
    assert "src/tv/main.tsx" in vite_config
    assert "admin-shell" in app_css
    assert "playwright/test" in frontend_test
    assert "Vue" not in index + tv + main_tsx + admin_app + tv_tsx + tv_app


def test_frontend_static_outputs_exist() -> None:
    assert (ROOT / "frontend/static/app.css").is_file()
    assert (ROOT / "frontend/static/app.js").is_file()
    assert (ROOT / "frontend/static/tv.js").is_file()
    assert (ROOT / "frontend/static/chunks").is_dir()


def test_container_contract_is_documented_in_dockerfile() -> None:
    dockerfile = read("Dockerfile")

    assert "EXPOSE 8000" in dockerfile
    assert "TURNERINGAR_DB=/data/turneringar/turneringar.sqlite3" in dockerfile
    assert "mkdir -p /data/turneringar" in dockerfile


def test_ci_runs_strict_build_test_and_publish_checks() -> None:
    workflow = read(".github/workflows/ci.yml")

    assert "name: Testa, bygg och publicera" in workflow
    assert "name: Kvalitet och tester" in workflow
    assert "name: Bygg och smoke-testa Docker-image" in workflow
    assert "name: Publicera Docker-image" in workflow
    assert "Installera backend-beroenden" in workflow
    assert "Bygg React-frontenden" in workflow
    assert "Smoke-testa och verifiera persistens efter omstart" in workflow
    assert "Logga in i GitHub Packages" in workflow
    assert "Logga in i Docker Hub" in workflow
    assert "npm run typecheck" in workflow
    assert "npm run build:frontend" in workflow
    assert "npx playwright install --with-deps chromium" in workflow
    assert "npm run test:frontend" in workflow
    assert "python -m pytest -q" in workflow
    assert "docker build -t turneringar:test ." in workflow
    assert "http://127.0.0.1:8000/api/session" in workflow
    assert "http://127.0.0.1:8000/assets/app.js" in workflow
    assert "http://127.0.0.1:8000/assets/tv.js" in workflow
    assert "/assets/chunks/" in workflow
    assert "ghcr.io/bjorkan/turneringar" in workflow
    assert "bjorkan/turneringar" in workflow
    assert "if: github.event_name == 'push' || github.event_name == 'release'" in workflow
    assert "type=raw,value=edge" in workflow
    assert "github.ref == 'refs/heads/main'" in workflow
    assert "type=raw,value=latest" in workflow
