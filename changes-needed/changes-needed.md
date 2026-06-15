# Changes Needed

Granskning gjord 2026-06-15. Jag har behandlat projektet som om det ska tåla riktiga arrangörer, publikskärmar och felinmatning, inte bara happy path.

## Verifiering som kördes

- `npm run typecheck` passerar.
- `npm run build:frontend` passerar.
- `.venv/bin/python -m pytest -q` passerar: 19 tester.
- `python -m pytest -q` i system-Python faller direkt eftersom `pytest` saknas i den miljön.
- `npm run test:frontend` passerar när Chromium körs i Docker med `mcr.microsoft.com/playwright:v1.48.2-noble`.
- Lokal Playwright/Chromium ska inte användas här. Den saknade först browser-binär och användaren har bekräftat att den fryser vid 100%.
- Screenshots/prober skapades under `.tmp/review-screens/` mot en temporär databas på port 8020.

## Blocker

1. Publik Live TV läcker moderator-PIN och token. `dashboard_payload()` lägger alltid in `moderators` från `store.list_moderator_tokens()` och både `/api/tv/{code}` och `/api/tournaments/{id}/tv` återanvänder payloaden. Reproben `GET /api/tv/VISUAL0001` returnerade `moderators[0]` med `pin` och `token`. Detta bryter direkt mot kravet att publik TV inte ska visa eller exponera moderatorinformation. Se `backend/turneringar/main.py:76-92`, `backend/turneringar/main.py:116-130`, `backend/turneringar/main.py:230-232`, `backend/turneringar/store.py:356-368`.

Status: Löst
Jag lade till en separat publik TV-payload i `backend/turneringar/main.py` som återanvänder turneringsdatan men tömmer `moderators` och `events` innan den skickas till `/api/tv/{code}`. På så sätt kan publikskärmen fortfarande visa matcher, tabeller och resurser utan att få PIN, token eller intern aktivitetslogg. Regressionstestet i `backend/tests/test_api.py::test_full_admin_tv_and_moderator_flow` skapar en moderator innan TV-payloaden hämtas och kontrollerar att publiksvaret har tomma `moderators` och `events`. Samma test bekräftar samtidigt att adminpayloaden fortfarande innehåller moderatorn, så fixen tar inte bort adminfunktionalitet av misstag.

2. Den gamla turnerings-ID-baserade TV-API-rutten är publik och går att enumera. `/api/tournaments/{tournament_id}/tv` kräver ingen adminsession och returnerar samma adminnära dashboardpayload, inklusive moderatorer och eventlogg. En användare behöver bara gissa ett heltals-ID. Se `backend/turneringar/main.py:230-232`.

Status: Löst
Jag skyddade `/api/tournaments/{tournament_id}/tv` med `require_admin(request)` i `backend/turneringar/main.py`. Det gör att den äldre ID-baserade rutten inte längre kan anropas anonymt genom att gissa turnerings-ID. Den kodbaserade publikskärmen fortsätter att gå via `/api/tv/{code}`, som nu får den sanerade publikpayloaden. Regressionstestet i `backend/tests/test_api.py::test_full_admin_tv_and_moderator_flow` använder en ny klient utan admincookie och verifierar att den gamla rutten svarar `401`.

3. Manuell matchflytt kan koppla en match till en resurs från en annan turnering. Repro: skapa turnering B med resurs `Foreign Plan`, PATCH:a en match i turnering A med `resource_id` från B; API svarar 200 och matchen visar `resource_name: "Foreign Plan"`. Valideringen kontrollerar krockar men aldrig att resursen finns i samma turnering. Se `backend/turneringar/services.py:432-492`, `backend/turneringar/services.py:501-522`, `backend/turneringar/main.py:365-381`.

Status: Löst
Jag ändrade `validate_manual_slot()` i `backend/turneringar/services.py` så den får turnerings-ID och först kontrollerar att matchen tillhör turneringen. Samma validering hämtar nu resursen explicit och avvisar både saknade resurser och resurser som hör till en annan turnering. `apply_manual_slot()` använder den skärpta valideringen innan någon uppdatering skrivs, så en främmande resurs kan inte längre hamna på matchen. Regressionstestet `backend/tests/test_services.py::TournamentServiceTests::test_manual_override_rejects_foreign_resource` försöker schemalägga med en resurs från en annan turnering och verifierar både felmeddelandet och att matchens `resource_id` är oförändrat.

4. "Generera gruppspel och slutspel" raderar befintliga matcher, resultat och schema utan spärr, bekräftelse eller varning. Reproben hade `before_scores: ["7 - 3"]`; efter ny generate var `after_scores: []` och `after_scheduled: 0`. Det här är en datatapp-knapp maskerad som normal snabbåtgärd. Se `backend/turneringar/services.py:77-79`, `frontend/src/admin/AdminApp.tsx:837`, `frontend/src/admin/AdminApp.tsx:882`, `frontend/src/admin/AdminApp.tsx:989-990`, `frontend/src/admin/AdminApp.tsx:1069-1071`.

Status: Löst
Jag gjorde `services.generate_structure()` bekräftelsemedveten och låter den stoppa om turneringen redan har matcher men anropet saknar `confirm_reset`. API-rutten `/api/tournaments/{tournament_id}/generate` läser nu JSON-body och skickar vidare `confirm_reset`, så även direkta API-anrop skyddas. I admin-UI:t går alla generera-/bygg-om-knappar via samma `regenerateStructure()`-funktion som visar en bekräftelseruta när det redan finns matcher och skickar flaggan bara efter aktiv bekräftelse. Regressionstestet `backend/tests/test_api.py::test_regenerate_requires_confirmation_when_structure_exists` visar att ett resultat på `7 - 3` och befintligt schema ligger kvar när omgenerering görs utan bekräftelse.

5. Vanlig felinmatning ger 500 Internal Server Error. Bekräftade repros: `group_count: "abc"`, participant `kind: "alien"`, resource `kind: "alien"` och manuell tid `scheduled_at: "not-a-date"` gav alla 500. `parse_int()` kastar rå `ValueError`, SQLite CHECK/FK-fel fångas inte, och `parse_local_datetime()` fångas inte i slotvalidering. Se `backend/turneringar/main.py:50-53`, `backend/turneringar/main.py:207-220`, `backend/turneringar/main.py:289-305`, `backend/turneringar/main.py:365-377`, `backend/turneringar/store.py:123-137`, `backend/turneringar/store.py:154-167`, `backend/turneringar/services.py:443`.

Status: Löst
Jag ändrade `parse_int()` i `backend/turneringar/main.py` så ogiltiga heltal blir ett kontrollerat `400`-svar i stället för en rå `ValueError`. Deltagar- och resurstyp valideras nu innan databasinsert, vilket gör att `kind: "alien"` stoppas med tydlig klientfelstatus i stället för att SQLite CHECK-felet läcker som 500. Manuell schemaläggning fångar ogiltiga datum i `validate_manual_slot()` och returnerar ett valideringsfel utan att uppdatera matchen. Regressionstestet `backend/tests/test_api.py::test_common_invalid_inputs_return_400` kör alla fyra reprofallen och verifierar att de svarar `400`.

## High

6. Mobil adminvy börjar med en trasig kollapsad sidomeny som äter första skärmen. På 390px visas en stor ikonmatris utan etiketter ovanför toppbaren och innehållet. Orsaken är att `compact` initieras till true på max 900px och `.admin-shell.menu-collapsed ... display:none` vinner över mobilreglerna. Screenshot: `.tmp/review-screens/participants-mobile.png`. Se `frontend/src/admin/AdminApp.tsx:183`, `frontend/src/admin/AdminApp.tsx:202-225`, `frontend/public/app.css:2200-2232`.

Status: Löst
Jag ändrade mobilreglerna i `frontend/public/app.css` så adminskalet blir en kolumnlayout där workspace/topbar ligger först. När `menu-collapsed` är aktiv på mobil döljs sidebaren helt i stället för att visa en ikonmatris före innehållet. När användaren trycker på menyknappen visas sidebaren igen under toppbaren med vanliga etiketter, så navigationen fungerar fortfarande på telefon. Regressionstestet `frontend/tests/admin-flow.spec.ts` har testet `mobil adminvy börjar med toppbar och dold sidomeny`, kört i Docker/Chromium, som verifierar att topbar visas först, sidebaren är dold initialt och öppnas under topbar.

7. Live TV klipper innehåll på riktig TV-storlek med långa namn. På 1920x1080 syns feature-facts/resultatdelen delvis kapad när lagnamn blir långa. `.tv-panel { overflow: hidden }`, fast deck-höjd och 66px lagnamn gör att innehåll försvinner. Screenshot: `.tmp/review-screens/tv-public-1920.png`. Se `frontend/src/tv/TvApp.tsx:156-196`, `frontend/public/app.css:1584-1595`, `frontend/public/app.css:1666-1703`, `frontend/public/app.css:1745-1803`.

Status: Löst
Jag gjorde featurepanelen i `frontend/public/app.css` till en intern grid med rubrik, matchyta och fakta som får dela på höjden utan att fakta trycks bort. De stora lagnamnen i TV-feature begränsas nu till tre rader med ellipsis och mindre fast typstorlek, vilket stoppar långa obrutna namn från att växa genom panelen. Live-slidens resultatdel fick mer radutrymme och kompaktare resultatlistor med tvåradig ellipsis, så även den nedre panelen ryms på 1920x1080. Regressionstestet `frontend/tests/admin-flow.spec.ts::Live TV rymmer långa lagnamn på 1920-skärm` bygger en TV-länk med långa namn och kontrollerar i Docker/Chromium att aktiva TV-paneler inte har dold overflow.

8. Live TV tappar data utan indikator. Den visar bara 5 kommande matcher, 8 schemarader, 2 grupper, 4 rader per tabell, 4 resurser och 5 senaste resultat/event. Det finns ingen "... och fler"-markering, pagination eller extra slide. I en turnering med tre grupper visades Grupp C inte i tabellsliden. Se `frontend/src/tv/TvApp.tsx:117-123`, `frontend/src/tv/TvApp.tsx:207-214`, `frontend/src/tv/TvApp.tsx:258-279`.

Status: Löst
Jag lade till beräkningar i `frontend/src/tv/TvApp.tsx` som jämför hela payloadens listor med de poster som faktiskt renderas på varje TV-slide. När något trunkeras visas nu en `tv-more`-rad för kommande matcher, schema, grupper, dolda tabellrader, resurser, senaste resultat och eventlistan. `frontend/public/app.css` har fått en diskret TV-statusstil för de raderna så de läses som fortsättningsindikatorer i stället för vanlig tabelltext. Regressionstestet `frontend/tests/admin-flow.spec.ts::Live TV visar när listor fortsätter utanför sliden` skapar många matcher, tre grupper, fem resurser och fem lag per grupp och verifierar i Docker/Chromium att indikatorerna visas.

9. Slutspelsseeding kan para ihop lag från samma grupp direkt i första slutspelsrundan trots att det går att undvika. Repro med 3 grupper och 2 vidare gav `Grupp C #1 vs Grupp C #2`. Se `backend/turneringar/services.py:134-144`, `backend/turneringar/services.py:185-213`.

Status: Löst
Jag lade till `balance_first_round_pairs()` i `backend/turneringar/services.py`, som utgår från den befintliga bracketparningen och byter slots när ett förstaomgångspar kommer från samma grupp. Funktionen accepterar BYE-platser men räknar bara riktiga gruppslots som konflikter, så den kan behålla enkla BYE-parningar och ändå reparera undvikbara gruppmöten. I samma knockoutbyggare flyttade jag uppdateringen av `previous_round` ut ur den inre loopen, eftersom senare rundor annars byggdes från ett ofullständigt mellanläge. Regressionstestet `backend/tests/test_services.py::TournamentServiceTests::test_first_knockout_round_avoids_same_group_pairings_when_possible` skapar exakt 3 grupper med 2 vidare och verifierar att första slutspelsrundan saknar samma-grupp-par.

10. Grupper med en deltagare seedas inte automatiskt till slutspel. Repro med 3 deltagare, 3 grupper, 1 vidare/grupp gav knockoutmatcher som fortfarande stod `Grupp A #1 vs BYE` och status `pending`. `seed_knockout_from_groups()` körs bara efter resultatuppdatering, men i enpersonersgrupper finns inga gruppmatcher att rapportera. Se `backend/turneringar/services.py:68-150`, `backend/turneringar/services.py:649-692`.

Status: Löst
Jag anropar nu `seed_knockout_from_groups()` direkt i slutet av `generate_structure()` efter att gruppspel och knockout har skapats. För vanliga grupper gör funktionen ingenting eftersom gruppmatcher fortfarande är ospelade, men för enpersonersgrupper är gruppspelet komplett direkt och kvalplatserna kan fyllas. BYE-matcher autoavanceras i samma befintliga seedningsflöde, så finalens källa fylls utan att arrangören behöver rapportera en icke-existerande gruppmatch. Regressionstestet `backend/tests/test_services.py::TournamentServiceTests::test_single_member_groups_seed_and_advance_byes_after_generate` verifierar att tre enpersonersgrupper seedas och att BYE-platsen avanceras direkt efter generering.

11. `qualifiers_per_group` kan sättas högre än antalet deltagare i grupperna och skapar omöjliga placeholder-slots som aldrig fylls. Det finns ingen validering i create/settings/generate. Se `backend/turneringar/main.py:217-219`, `backend/turneringar/main.py:299-302`, `backend/turneringar/services.py:134-144`, `backend/turneringar/services.py:743-753`.

Status: Löst
Jag flyttade gruppfördelningen i `generate_structure()` så den sker före någon gammal struktur raderas. Därefter körs nya `validate_qualifier_depth()`, som stoppar generering om `qualifiers_per_group` är högre än minsta gruppens deltagarantal. Det gör att API:t kan fortsätta spara inställningar i förväg, men själva bracketbygget skapar aldrig omöjliga kvalplatser som inte kan fyllas. Regressionstestet `backend/tests/test_services.py::TournamentServiceTests::test_generate_rejects_more_qualifiers_than_group_members` verifierar felet och att inga stages eller matcher skapas när inställningen är ogiltig.

12. Skapande av turnering accepterar negativa eller absurda strukturvärden. `create_tournament()` skickar `group_count` och `qualifiers_per_group` rakt till databasen, till skillnad från `update_tournament_settings()` som klampar värden. UI har `min`, men API:t är öppet för skräp. Se `backend/turneringar/main.py:217-219`, `backend/turneringar/store.py:40-64`, `backend/turneringar/store.py:100-118`.

Status: Löst
Jag lade till `parse_limited_int()` i `backend/turneringar/main.py` för strukturvärden som måste vara minst 1 och högst en definierad maxgräns. Skapande av turnering använder nu den valideringen för både `group_count` och `qualifiers_per_group`, så negativa och extrema värden stoppas innan databasen skrivs. Inställningsuppdateringen använder samma validering, vilket gör att create- och settings-vägarna inte längre har olika tolerans för skräpvärden. Regressionstestet `backend/tests/test_api.py::test_tournament_structure_values_are_limited` verifierar negativa grupper, absurda vidarevärden och en settings-uppdatering över maxgränsen.

13. Ogiltiga datum kan lagras och krascha senare schemaläggning. `starts_at` tas emot som valfri sträng och `schedule_matches()` kör `datetime.fromisoformat()` utan felöversättning. Se `backend/turneringar/main.py:217`, `backend/turneringar/main.py:298`, `backend/turneringar/services.py:25`, `backend/turneringar/services.py:347`.

Status: Löst
Jag lade till `parse_local_datetime_value()` i `backend/turneringar/main.py`, som återanvänder service-lagrets ISO-parser och översätter ogiltiga datum till `400`. Skapande av turnering validerar nu `starts_at` innan värdet skickas till `store.create_tournament()`. Inställningsuppdateringen validerar också `starts_at`, inklusive den fallback som används när fältet saknas, så schemaläggaren får inte längre ett trasigt lagrat datum. Regressionstestet `backend/tests/test_api.py::test_invalid_tournament_dates_return_400` verifierar både create- och settings-vägen med `not-a-date`.

14. Moderator-scope valideras inte mot turneringen. `create_moderator_token()` accepterar vilket `resource_id` som helst som finns i databasen; en resurs från en annan turnering ger en moderator med dött eller felaktigt scope. Saknas resurs blir det FK/500 i stället för 400. Se `backend/turneringar/main.py:422-435`, `backend/turneringar/store.py:338-353`.

15. Resultat på avslutade matcher kan ändras via UI utan någon spärr eller konsekvenshantering. Knappen heter "Resultat", men dialogen har fortfarande "Avsluta match" aktiv även för completed. Backend tillåter `update_match_result()` på completed och försöker propagatera vidare, men hoppar över redan completed downstreammatcher. Det kan göra bracket och historik inkonsekventa. Se `frontend/src/admin/AdminApp.tsx:1018-1021`, `frontend/src/admin/AdminApp.tsx:1178-1184`, `backend/turneringar/services.py:532-573`, `backend/turneringar/services.py:612-633`.

16. Autoschemaläggaren reserverar fel tid för fixed matches. För completed/in_progress-matcher används turneringens nuvarande `match_minutes`, inte matchens faktiska `duration_minutes`. Om en match har manuell duration kan efterföljande autoschema skapa krockar. Se `backend/turneringar/services.py:347-363`, `backend/turneringar/services.py:407-420`.

17. Live TV hoppar tillbaka till slide 1 vid varje SSE-refresh. `load()` reset:ar `activeIndex` och `secondsLeft`; vid täta score/resultat/schedule-events kan publikskärmen fastna på första sliden. Se `frontend/src/tv/TvApp.tsx:53-60`, `frontend/src/tv/TvApp.tsx:84-99`.

18. Publik TV visar "Senaste aktivitet" från intern eventlogg. Kravet säger att Live TV inte ska visa interna notiser/arrangörsdelar. "Schema uppdaterat", "Livepoäng uppdaterad" osv. är arrangörshändelser, inte publik turneringsinformation. Se `frontend/src/tv/TvApp.tsx:239-245`, `backend/turneringar/main.py:91-92`.

19. Slutspelsplaceholdern använder databas-ID som publik matchreferens: `Vinnare match 23`. Det är inte en begriplig bracketposition och blir extra rörigt efter regenerering. Se `backend/turneringar/services.py:237-238`.

20. Live TV visar resource kind på engelska/rådatabasvärde (`COURT`, `SERVER`) i stället för svensk label (`Spelplan`, `Server`, `Bord`). Screenshot: `.tmp/review-screens/tv-public-slide3-1920.png`. Se `frontend/src/tv/TvApp.tsx:278-279`.

## Medium

21. Toppbarens globala sökfält är en låtsaskontroll. Placeholdern säger "Sök turneringar, matcher, deltagare..." men Enter visar bara en notice om att fältet filtrerar listor. Det filtrerar ingenting globalt. Se `frontend/src/admin/AdminApp.tsx:238-250`.

22. Filterchips ser klickbara ut men är statiska `<span>`. Det gäller deltagarfilter, matchstatusfilter och moderatorfilter. Användaren kan inte filtrera på "Lag", "Seedade", "Pågår", "Kommande" osv. Se `frontend/src/admin/AdminApp.tsx:896-900`, `frontend/src/admin/AdminApp.tsx:999-1005`, `frontend/src/admin/AdminApp.tsx:1301-1306`.

23. Admins översikts-/slutspelsvy visar bara första gruppens tabell. Vid flera grupper göms resten utan indikator. Se `frontend/src/admin/AdminApp.tsx:852-864`.

24. Schemavyn visar bara fem matcher per resurs och sex ej placerade matcher i sidopanelen. Resten försvinner från just den vyn utan "visa fler". Se `frontend/src/admin/AdminApp.tsx:687-691`, `frontend/src/admin/AdminApp.tsx:954-965`, `frontend/src/admin/AdminApp.tsx:980-985`.

25. Invalid moderatorlänk fastnar i "Laddar moderatorvy..." plus notice. `ModeratorView` har inget eget error state och renderar laddning för evigt när `/api/moderators/{token}` ger 404. Se `frontend/src/admin/AdminApp.tsx:1214-1221`, `frontend/src/admin/AdminApp.tsx:1274-1278`.

26. Moderatorvyns statusfilter är också statiska och matchlistan kan bli stor utan sök/filter. Se `frontend/src/admin/AdminApp.tsx:1301-1325`.

27. All-scope moderatorer kan se och rapportera spelbara men oschemalagda matcher. Backend filtrerar bara på `match_is_playable` och `status != completed`, inte på schemalagd/resurs/current. Det gör det lätt att rapportera fel match. Se `backend/turneringar/main.py:444-453`, `backend/turneringar/services.py:756-765`.

28. Admin-PIN och moderator-PIN lagras direkt i cookies. De är HttpOnly men råhemligheten blir sessionsbeviset. Byt till signerad session/token med rotation och lagra aldrig PIN som cookievärde. Se `backend/turneringar/main.py:20`, `backend/turneringar/main.py:33`, `backend/turneringar/main.py:188`, `backend/turneringar/main.py:467`.

29. Ingen bruteforce-skydd eller rate limit på admin- och moderator-PIN. En lokal app kan fortfarande ligga på ett LAN. Se `backend/turneringar/main.py:183-189`, `backend/turneringar/main.py:459-468`.

30. Backend exponerar att default-PIN används men UI varnar inte arrangören. `admin_pin_default` finns i `/api/session`, men ingen tydlig varning visas i adminskalet. Se `backend/turneringar/main.py:179`, `frontend/src/admin/AdminApp.tsx:1344-1367`.

31. `json_body()` hanterar inte trasig JSON robust. `await request.json()` kan kasta innan den kontrollerade "JSON-objekt krävs"-vägen. Se `backend/turneringar/main.py:40-47`.

32. TV/admin-datum blandar lokala datetimes och `CURRENT_TIMESTAMP` utan tydlig tidszonmodell. `starts_at` lagras som lokal ISO, eventlogg från SQLite är UTC-lik sträng, frontend parse:ar med JS Date. Det kan ge fel klockslag runt tidszon/DST. Se `backend/migrations/001_initial.sql`, `backend/turneringar/store.py:34-38`, `backend/turneringar/store.py:403-418`, `frontend/src/shared/format.ts`.

33. Responsivt meny-state lyssnar inte på resize. `matchMedia("(max-width: 900px)")` används bara initialt; om fönstret ändrar storlek stannar layouten i gammalt compact-läge. Se `frontend/src/admin/AdminApp.tsx:183`.

34. `document.body.className = ...` skriver över alla andra body-klasser. Det råkar fungera nu, men är skört om framtida kod eller integrationer lägger till klass på body. Se `frontend/src/admin/AdminApp.tsx:1401-1408`.

35. Sidomenyn använder textglyphs (`T`, `TV`, `Ö`, `MO`) i stället för riktiga ikoner/tooltips. Det blir särskilt dåligt i kollapsat läge och bryter designkravet om symboler/ikoner för verktyg. Se `frontend/src/admin/AdminApp.tsx:31-41`, `frontend/src/admin/AdminApp.tsx:217-218`.

36. Playwright-testerna täcker inte mobil layout, TV-overflow, public payload-säkerhet, felinmatning eller korsade resurser. De två webbläsartesterna är fina smoke tests, men de missar nästan allt ovan. Se `frontend/tests/admin-flow.spec.ts`.

37. Python/API-testerna täcker inte 400-vägarna. Det finns inga tester för invalid JSON, invalid enum, invalid date, invalid tournament/resource ownership eller public TV payload-strippning. Se `backend/tests/test_api.py`, `backend/tests/test_services.py`.

38. CI-smoken för chunkreferens har en meningslös `test -n "$chunk_path"` eftersom `chunk_path` alltid minst är `/assets/chunks/`. Curlen fångar nog felet senare, men testet säger inte det det tror. Se `.github/workflows/ci.yml`.

## Low / Städ

39. CSS innehåller döda TV-regler för `.tv-rules`, `.tv-notices`, `.arena-guide`, `.arena-map` osv. Det är kvarlämnat från funktioner som enligt kraven inte ska visas i publik-TV. Ta bort eller håll det bakom riktig feature. Se `frontend/public/app.css:1911-1955`, `frontend/public/app.css:2035-2055`, `frontend/public/app.css:2370-2376`.

40. Root-kommandot `python -m pytest -q` fungerar inte i nuvarande shell utan venv, trots att README visar det som testkommando efter venv-setup. Dokumentera tydligare att `.venv` måste vara aktiv eller använd ett make/script som väljer rätt Python.

41. Projektets lokala Playwright-väg är opålitlig i den här miljön. Dokumentera Docker-kommandot för Chromium-testning så ingen fastnar på den lokala browserinstallationen igen.

42. TV-slides saknar visuell indikation när listor är trunkerade. Även om man väljer att visa max N rader måste publikskärmen visa "fler matcher finns" eller rotera resten.

43. Det finns ingen bekräftelse för destruktiva eller stora åtgärder: generera om bracket, autoschemalägg allt och avsluta match. Minst generate om behöver modal/confirm och tydlig text om att resultat/schema påverkas.

44. Det finns ingen borttagning/arkivering av TV-länkar eller moderatorlänkar. Det gör läckta eller gamla länkar permanenta tills databasen ändras manuellt.

45. Det finns ingen auditlogg som binder resultatändringar till admin/moderator-identitet, trots att `todo.md` redan pekar på det. Det gör felrapportering svår att spåra.
