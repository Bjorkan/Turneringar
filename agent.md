# Agentinstruktioner

## Produktmål

Bygg en robust lokal eventserver för turneringar. Prioritera tydliga arbetsflöden för arrangörer och moderatorer framför avancerade format i första versionen.

## UI-riktning

- Följ inspirationsbilderna i `inspiration/` som visuell målbild.
- Adminappen ska kännas som ett ljust, operativt verktyg med fast vänsternavigering, toppbar, filterrader, täta tabeller, sidopaneler och tydliga statusmärken.
- Live TV ska vara en mörk publikvy med hög kontrast, blå/gröna accentfärger, stora matchytor, tunna panelramar, slideindikator och snabb överblick över aktuellt schema, tabeller, slutspel och resultat.
- Live TV-länkar är instansnivåobjekt, inte turneringsobjekt. Admin skapar en 10 tecken lång kod under `/admin/tv`, publik länk är `/tv/{CODE}`, och länken kan bindas live till en turnering eller en specifik resurs. Obundna TV-länkar ska visa "Ansluten, väntar på information".
- Publik Live TV får inte visa interna arrangörsdelar som regler, notiser, moderatorinformation eller hitta-rätt-i-arenan-information.
- Prioritera scanbarhet och arbetsflöden framför dekorativa sektioner. Första skärmen ska alltid visa användbar turneringsinformation.
- Använd kort med små radier, återhållsamma skuggor, stabila gridmått och kompakta kontroller. Text ska rymmas i sina ytor på både desktop och mobil.

## Tekniska regler

- Backend bor i `backend/turneringar` och frontend bor i `frontend`.
- Behåll kärnlogik i `backend/turneringar/services.py` så den kan testas utan webbramverket.
- Lägg databasåtkomst i `backend/turneringar/store.py`; använd parametriserade SQLite-frågor.
- Ändra schema via nya filer i `backend/migrations/`; modifiera inte redan tillämpade migrationer efter release.
- Frontend ska kommunicera med backend via `/api/...` och inte serverrenderas med templates.
- Live TV-klienten ska läsa via `/api/tv/{CODE}` och prenumerera på `/api/tv/{CODE}/events`; gamla turnerings-ID-baserade TV-rutter får bara finnas för bakåtkompatibilitet.
- Frontend skrivs i TypeScript under `frontend/src/`, byggs med `npm run build:frontend` och levereras som statiska filer under `frontend/static/`.
- Använd lokalt vendrad Vue 3-runtime från `frontend/static/vendor/vue.global.prod.js`; hämta inte Vue från CDN i produktion.
- Realtidsuppdateringar ska gå genom `backend/turneringar/realtime.py` och Server-Sent Events.
- Dockercontainern ska köra hela appen i en container, exponera port `8000` och lägga persistent data under `/data/turneringar/`.
- Docker-images publiceras till `ghcr.io/bjorkan/turneringar` och `bjorkan/turneringar`; `main` blir `edge` och GitHub Releases blir `latest`.

## Testkrav

- Kör `npm run typecheck`, `npm run build:frontend`, `python -m pytest -q` och `npm run test:frontend` efter ändringar i frontend, API, bracket-, schema- eller resultatlogik.
- Lägg till tester när regler för schema, seedning, behörighet, statiska assets eller resultat ändras.
- API-integrationstester ska starta uvicorn mot temporär SQLite-databas och verifiera admin-, moderator- och TV-flöden via riktiga HTTP-anrop.
- Playwright-tester ska täcka klickbara huvudflöden i Chromium: admin, moderator-PIN och Live TV.
- GitHub Actions ska stoppa på TypeScript-fel, Python-testfel, Playwright-fel, Docker-buildfel eller misslyckad container-smoke.

## Kodstil

- Håll funktioner små och namnge dem efter turneringsbegrepp.
- Undvik globala skrivbara tillstånd utanför realtidshubben.
- Använd ISO-format `YYYY-MM-DDTHH:MM` för lokala tider i databasen.
- Skriv korta kommentarer bara där regelverket annars är svårt att följa.
