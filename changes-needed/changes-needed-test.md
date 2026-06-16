# changes-needed-test.md

Det här är den kritiska listan för testsystemet. Det finns redan bra täckning för grundflödet, men det räcker inte för drift. CI bevisar att happy path fungerar. Det bevisar inte att systemet överlever verkliga fel.

## RELEASEBLOCKER: sessionsäkerheten är inte driftsäker som testad

`backend/turneringar/main.py` använder en slumpad `SESSION_SECRET` om miljövariabeln inte sätts. Samtidigt sätter varken `Dockerfile`, `.env.example`, `docker-compose.example.yml` eller CI någon stabil hemlighet.

Det betyder att admin- och moderatorcookies dör vid varje omstart om miljön inte konfigureras perfekt. Det finns ingen test som bevisar att sessioner överlever omstart, och det finns heller ingen test som tvingar fram att `SESSION_SECRET` måste vara satt i drift.

Det här måste åtgärdas. Antingen ska drift kräva en explicit, persistent hemlighet och testas så, eller så måste beteendet dokumenteras som avsiktligt. I nuvarande skick är det en driftfälla.

## RELEASEBLOCKER: uppgraderingsvägen mellan databasscheman är inte testad

`initialize_database()` i `backend/turneringar/db.py` verifieras bara mot en tom eller ny databas. Det finns ingen test som tar en äldre SQLite-databas, kör nya migrations och bevisar att data fortfarande går att läsa, skriva och schemavisera efter uppgradering.

Det här är inte kosmetik. Om nästa release ändrar schema och den gamla databasen inte migrerar rent, ligger hela tjänsten nere. Nuvarande tester säger inget om det.

## RELEASEBLOCKER: abrupt krasch och hård omstart testas inte

Docker-smoke-testet i `.github/workflows/ci.yml` kör en ren `docker stop` och startar sedan om containern. Det är inte samma sak som en verklig krasch.

Det finns ingen test för:

- `SIGKILL` mitt under skrivning
- processdöd under pågående resultatrapportering
- restart med halvskriven SQLite-transaktion
- databastillstånd efter oväntat avbrott

Att en kontrollerad stopp/start fungerar är för svagt. Det visar inte recovery. Det här måste täckas.

## RELEASEBLOCKER: samtidiga skrivningar och race conditions testas inte

Testsviten kör nästan allt sekventiellt. Det finns inga riktiga tester för samtidighet:

- två resultat skrivs samtidigt på samma match
- score och result rapporteras parallellt
- schemaläggning körs medan matcher uppdateras
- flera moderatorer skriver till samma turnering samtidigt

Det här är exakt den typ av fel som ger tyst datakorruption eller inkonsistent bracket-logik. En turneringsmotor utan race-test är inte driftbevisad.

## RELEASEBLOCKER: databaskorruption och readonly-fel testas inte

Det finns inga tester för:

- saknad SQLite-fil
- korrupt SQLite-fil
- låst databas
- read-only filesystem
- disk full
- rättighetsfel i datakatalogen

Systemet startar kanske fint när allt är rent. Det räcker inte. Det måste också faila tydligt och säkert när lagringen är trasig. Nuvarande testsvit täcker inte det alls.

## HÖG: `test_project_assets.py` är fortfarande en falsk trygghet

`backend/tests/test_project_assets.py` kontrollerar mest att vissa strängar finns i filer. Det är inte ett drifttest.

Exempel på vad det betyder i praktiken:

- ett bygge kan gå sönder trots att textkontrollen passerar
- en workflow kan ändras så att innehållet ser rätt ut men runtime är fel
- en Dockerfil kan innehålla rätt ord men ändå producera en trasig image

Den här filen måste sluta ge sken av att vara starkare än den är. Antingen ersätt den med riktiga artifact- och runtime-tester, eller kapa den hårt till bara det som faktiskt ger värde.

## HÖG: SSE-/realtime-kontraktet är för tunt testat

Det finns kod för Server-Sent Events i `backend/turneringar/main.py` och realtime-hantering i `backend/turneringar/realtime.py`, men det finns ingen tydlig backendtest som verifierar streamens faktiska kontrakt.

Det som saknas är minst:

- att första eventet verkligen är `connected`
- att `ping` skickas vid timeout
- att ett publicerat event når rätt kanal
- att reconnect inte tappar läget

Playwright-testen för TV-vyn visar att UI kan rendera och uppdatera, men inte att streamen är stabil under riktiga avbrott.

## HÖG: testsviten bevisar inte beteende vid större datamängder

De flesta tester använder små, snygga dataset. Det räcker inte för att avslöja gränsproblem i bracketgenerering, schemaläggning och resultatpropagering.

Det behövs regressioner för:

- många deltagare
- många resurser
- många matcher
- täta tidsluckor
- stora slutspelsträd

Just nu finns ingen stark signal om att algoritmerna håller när datamängden blir verklig.

## HÖG: driftkritiska livscykler saknas fortfarande i testplanen

Det finns bra tester för att skapa turneringar, schemalägga, rapportera resultat och visa TV-vyer. Men det finns inte motsvarande testplan för hela livscykeln:

- skapa
- köra
- omstarta
- migrera
- krascha
- återställa
- fortsätta arbeta

Det är där riktiga driftfel uppstår. Nuvarande testsvit täcker mest första halvan.

## Vad som måste göras först

1. Lägg till test för persistent `SESSION_SECRET` och sessionöverlevnad över omstart.
2. Lägg till migrations-test med en äldre databas som uppgraderas till nuvarande schema.
3. Lägg till krasch-/recovery-test med abrupt processdöd och restart.
4. Lägg till samtidighetstester för score/result/schedule.
5. Lägg till tester för korrupt eller otillgänglig SQLite-databas.
6. Byt ut eller rensa bort de textbaserade asset-testerna.
7. Lägg till riktiga tester för SSE-streamens kontrakt.
8. Lägg till större regressionsfall med större datamängder.

## Slutsats

Den här testsviten är bättre än en enkel happy-path-svit, men den är fortfarande inte tillräcklig för att garantera bra drift. De stora hålen ligger i recovery, migration, samtidighet och sessioners livslängd. Det är där fokuset måste ligga.
