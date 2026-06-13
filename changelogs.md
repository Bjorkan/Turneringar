# Changelog

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
