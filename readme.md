# Turneringar

Turneringar är ett lokalt webbprogram för att hantera event med lag/spelare, gruppspel, slutspel, spelplaner/servrar, moderatorrapportering och Live TV.

Projektet är separerat i:

- `backend/` - FastAPI, SQLite, migrations, API och Server-Sent Events.
- `frontend/` - statisk HTML/CSS/Vue som kommunicerar med backend via `/api/...`. Vue-koden skrivs i TypeScript under `frontend/src/` och byggs till `frontend/static/`.

## Kör lokalt

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
ADMIN_PIN=byt-mig python -m uvicorn turneringar.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

Öppna `http://localhost:8000`. Om `ADMIN_PIN` inte sätts används `admin123` för lokal demo.

Databasen skapas automatiskt i `backend/data/turneringar.sqlite3`, eller på sökvägen som anges med `TURNERINGAR_DB`.

## Kör med Docker

Containern exponerar port `8000` och använder `/data/turneringar/turneringar.sqlite3` som standarddatabas.

```bash
docker build -t turneringar .
docker run --rm -p 8000:8000 \
  -e ADMIN_PIN=byt-mig \
  -v "$(pwd)/data/turneringar:/data/turneringar" \
  turneringar
```

Exempel för Compose finns i `docker-compose.example.yml`. Publicerade images finns som `ghcr.io/bjorkan/turneringar` och `bjorkan/turneringar`.

## Vyer

- `/` och `/admin` laddar frontendens adminapp.
- `/admin/tv` hanterar instansens Live TV-länkar.
- `/tournaments/{id}` visar en turnering i adminappen.
- `/m/{token}` visar moderatorvyn.
- `/tv/{CODE}` visar Live TV-vyn för en 10 tecken lång TV-kod.
- `/docs` visar FastAPI:s API-dokumentation.

## UI-riktning

Designen utgår från referenserna i `inspiration/`. Adminvyn är ett ljust dashboardverktyg med sidomeny, toppbar, tabeller, filter och sidopaneler. Live TV-vyn är en mörk, kontrastrik publik skärmvy med stora matchkort, tabeller, slutspel och resultat i roterande slides. Den visar inte interna regler, notiser eller arenavägledning.

## Första arbetsflödet

1. Logga in i admin.
2. Skapa en turnering och justera matchtid, vila, antal grupper och antal vidare per grupp.
3. Lägg till lag/spelare och spelplaner/servrar.
4. Generera gruppspel och slutspel.
5. Autoschemalägg matcher och flytta manuellt vid behov.
6. Skapa moderatorlänkar med PIN och dela till resultatrapportörer.
7. Skapa en Live TV-länk under `/admin/tv`, bind den till turnering eller resurs och öppna `/tv/{CODE}` på en TV-skärm.

## Tester

```bash
npm install --no-audit --no-fund
npx playwright install --with-deps chromium
npm run typecheck
npm run build:frontend
python -m pytest -q
npm run test:frontend
```

Pytest-sviten innehåller både kärnlogiktester och end-to-end API-tester som startar uvicorn mot en temporär SQLite-databas, verifierar admin-, moderator- och TV-flöden och kontrollerar att statiska frontendfiler serveras. Playwright-sviten öppnar appen i Chromium och klickar igenom adminflöde, moderator-PIN och Live TV.

## Arkitektur

- `backend/turneringar/main.py` exponerar API-rutter och serverar frontendens statiska filer.
- `backend/turneringar/store.py` innehåller SQLite-frågor och repository-logik.
- `backend/turneringar/services.py` innehåller bracketgenerering, tabeller, schemaläggning och resultatpropagering.
- `backend/turneringar/realtime.py` hanterar Server-Sent Events.
- `frontend/src/app.ts` driver admin- och moderatorvyerna via JSON API och kompileras till `frontend/static/app.js`.
- `frontend/src/tv.ts` driver Live TV-vyn via kodbaserat JSON API och SSE och kompileras till `frontend/static/tv.js`.
- `frontend/static/vendor/vue.global.prod.js` är en lokal Vue 3-runtime så klienten fungerar utan extern CDN.

## GitHub

Repot innehåller `.gitignore`, `.dockerignore`, `.editorconfig`, `.env.example`, `Dockerfile` och en GitHub Actions-workflow i `.github/workflows/ci.yml`.

Workflowen kör Python-tester, typecheckar och bygger TypeScript-frontenden, kör Playwright i Chromium, bygger Docker-imagen, smoke-testar containern och publicerar till både GitHub Container Registry och Docker Hub:

- Push till `main` publicerar `ghcr.io/bjorkan/turneringar:edge` och `bjorkan/turneringar:edge`.
- Publicerad GitHub Release publicerar `ghcr.io/bjorkan/turneringar:latest` och `bjorkan/turneringar:latest`.
- Pull requests bygger imagen med en PR-tagg men publicerar inte.

Docker Hub-publicering kräver en repository secret med namnet `DOCKERHUB_TOKEN` för användaren `bjorkan`.
