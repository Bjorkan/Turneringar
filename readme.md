# Turneringar

Turneringar är ett lokalt webbprogram för att hantera event med lag/spelare, gruppspel, slutspel, spelplaner/servrar, moderatorrapportering och Live TV.

Projektet är separerat i:

- `backend/` - FastAPI, SQLite, migrations, API och Server-Sent Events.
- `frontend/` - statisk HTML/CSS/JavaScript som kommunicerar med backend via `/api/...`.

## Kör lokalt

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
ADMIN_PIN=byt-mig python -m uvicorn turneringar.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

Öppna `http://localhost:8000`. Om `ADMIN_PIN` inte sätts används `admin123` för lokal demo.

Databasen skapas automatiskt i `backend/data/turneringar.sqlite3`, eller på sökvägen som anges med `TURNERINGAR_DB`.

## Vyer

- `/` och `/admin` laddar frontendens adminapp.
- `/tournaments/{id}` visar en turnering i adminappen.
- `/m/{token}` visar moderatorvyn.
- `/tv/{id}` visar Live TV-vyn.
- `/docs` visar FastAPI:s API-dokumentation.

## Första arbetsflödet

1. Logga in i admin.
2. Skapa en turnering och justera matchtid, vila, antal grupper och antal vidare per grupp.
3. Lägg till lag/spelare och spelplaner/servrar.
4. Generera gruppspel och slutspel.
5. Autoschemalägg matcher och flytta manuellt vid behov.
6. Skapa moderatorlänkar med PIN och dela till resultatrapportörer.
7. Öppna `/tv/{turnerings-id}` på en TV-skärm.

## Tester

```bash
python -m pytest -q
```

Alternativt utan pytest-konfiguration:

```bash
PYTHONPATH=backend python -m unittest discover backend/tests
```

## Arkitektur

- `backend/turneringar/main.py` exponerar API-rutter och serverar frontendens statiska filer.
- `backend/turneringar/store.py` innehåller SQLite-frågor och repository-logik.
- `backend/turneringar/services.py` innehåller bracketgenerering, tabeller, schemaläggning och resultatpropagering.
- `backend/turneringar/realtime.py` hanterar Server-Sent Events.
- `frontend/static/app.js` driver admin- och moderatorvyerna via JSON API.
- `frontend/static/tv.js` driver Live TV-vyn via JSON API och SSE.

## GitHub

Repot innehåller `.gitignore`, `.editorconfig`, `.env.example` och en GitHub Actions-workflow i `.github/workflows/ci.yml` som installerar beroenden och kör tester.

