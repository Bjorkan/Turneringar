# Agentinstruktioner

## Produktmål

Bygg en robust lokal eventserver för turneringar. Prioritera tydliga arbetsflöden för arrangörer och moderatorer framför avancerade format i första versionen.

## Tekniska regler

- Backend bor i `backend/turneringar` och frontend bor i `frontend`.
- Behåll kärnlogik i `backend/turneringar/services.py` så den kan testas utan webbramverket.
- Lägg databasåtkomst i `backend/turneringar/store.py`; använd parametriserade SQLite-frågor.
- Ändra schema via nya filer i `backend/migrations/`; modifiera inte redan tillämpade migrationer efter release.
- Frontend ska kommunicera med backend via `/api/...` och inte serverrenderas med templates.
- Realtidsuppdateringar ska gå genom `backend/turneringar/realtime.py` och Server-Sent Events.

## Testkrav

- Kör `python -m pytest -q` efter ändringar i bracket-, schema- eller resultatlogik.
- Lägg till tester när regler för schema, seedning, behörighet eller resultat ändras.
- Webbrutter kan testas med FastAPI TestClient när `httpx` läggs till som utvecklingsberoende.

## Kodstil

- Håll funktioner små och namnge dem efter turneringsbegrepp.
- Undvik globala skrivbara tillstånd utanför realtidshubben.
- Använd ISO-format `YYYY-MM-DDTHH:MM` för lokala tider i databasen.
- Skriv korta kommentarer bara där regelverket annars är svårt att följa.
