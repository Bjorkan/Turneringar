# Changelog

## 2026-06-15

- Lade till instansnivåbaserade Live TV-länkar med 10-teckenskoder, `/tv/{CODE}`-URL:er och adminhantering under `/admin/tv`.
- Lade till live-bindning av TV-länkar till turnering eller specifik resurs samt väntläge för obundna skärmar.
- Uppdaterade Live TV-klienten till kodbaserat API/SSE och rensade publikvyn från interna regler, notiser och platsvägledning.
- Utökade testerna för TV-länkar i både store-logik och API-flöde.

## 2026-06-14

- Dokumenterade UI-riktningen från inspirationsbilderna i `inspiration/`.
- Omarbetade adminappen mot ljus dashboardlayout med sidomeny, toppbar, kort, statusmärken och tätare tabeller.
- Omarbetade Live TV mot mörk roterande skärmvy med matchfokus, schema, tabeller, slutspel och resultat.
- Bytte frontendens interaktioner till lokalt vendrad Vue 3 för komponentstyrda klick, formulär och SSE-uppdateringar.
- Lade till Dockerfile, `.dockerignore`, Compose-exempel och GitHub Actions-workflow som testar, bygger och publicerar image till GHCR.
- Uppdaterade Docker-publicering till `ghcr.io/bjorkan/turneringar` och Docker Hub `bjorkan/turneringar` med `main` som `edge` och releases som `latest`.
- Flyttade Vue-frontenden till TypeScript-källor under `frontend/src/` med typecheck och byggsteg i workflowen.
- Byggde ut testsviten med serverbaserade API-integrationstester för admin-, moderator- och TV-flöden, statiska assetkontroller och Docker-smoke i CI.
- Lade till Playwright-tester i Chromium som klickar igenom adminflöde, moderator-PIN och Live TV.

## 2026-06-13

- Initierade Turneringar som Python/FastAPI-projekt.
- Lade till SQLite-migrationer för turneringar, deltagare, resurser, stages, grupper, matcher, moderatorlänkar och eventlogg.
- Implementerade gruppspelsgenerering, slutspelsbracket, tabeller och resultatpropagering.
- Implementerade autoschemaläggning med manuell override och konfliktvalidering.
- Implementerade adminvy, moderatorvy och Live TV-vy med SSE-baserade uppdateringar.
- Lade till projektfilerna `readme.md`, `todo.md`, `agent.md` och `changelogs.md`.
- Lade till unittest-baserad testsvit för kärnflöden.
- Separerade backend och frontend i `backend/` och `frontend/`.
- Ersatte serverrenderade vyer med JSON API, statisk frontend och SSE-klienter.
- Lade till `.env.example`, `.editorconfig` och GitHub Actions CI.
