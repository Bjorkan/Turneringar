# Design- och polishproblem

Den här granskningen letar efter saker som ser billiga, ofärdiga, prototypiga eller felkonventionella ut jämfört med hur liknande admin-, turnerings- och publikskärmsprojekt brukar se ut. Detta är inte samma sak som `changes-needed.md` eller `changes-needed-visual.md`: här handlar det mer om produktkänsla, hierarki och förtroende.

Underlag:

- `.tmp/review-screens/admin-home-desktop.png`
- `.tmp/review-screens/overview-desktop.png`
- `.tmp/review-screens/participants-desktop.png`
- `.tmp/review-screens/schedule-desktop.png`
- `.tmp/review-screens/matches-desktop.png`
- `.tmp/review-screens/tv-admin-desktop.png`
- `.tmp/review-screens/tv-public-1920.png`
- `.tmp/review-screens/participants-mobile.png`
- `.tmp/visual-review-screens/*.png`

## 1. Appen ser fortfarande ut som en prototyp på grund av bokstavsloggan

Överallt används en blå ruta med bokstaven `T`: brand, nav, TV och login. Det är inte en ikon, inte en logotyp och inte kopplat till sport/tävling/turnering. I andra projekt skulle detta normalt ersättas av en tydlig produktmarkering eller åtminstone en riktig ikon.

Kod:

- `frontend/src/admin/AdminApp.tsx:205-207`
- `frontend/src/tv/TvApp.tsx:148-150`
- `frontend/public/app.css:182-192`
- `frontend/public/app.css:1534-1541`

Det här får hela produkten att kännas scaffoldad.

## 2. Sidomenyns bokstavsglyphs ser amatörmässiga ut

Navigeringen använder `T`, `TV`, `Ö`, `M`, `D`, `S`, `SL`, `MO`, `IN`. I en kollapsad meny blir det i praktiken en rad slumpmässiga initialer. Det här är inte hur moderna adminverktyg brukar göra. De använder riktiga ikoner med tooltips och tydlig aktiv state.

Kod:

- `frontend/src/admin/AdminApp.tsx:37-59`
- `frontend/src/admin/AdminApp.tsx:209-218`
- `frontend/public/app.css:216-227`

Extra fult: CSS har `.nav-icon`-regler som antyder att riktiga ikoner var tänkta, men komponenten använder dem inte. Se `frontend/public/app.css:254-282`.

## 3. Mobilvyn öppnar med en ikonmatris som känns trasig även innan man hittar innehållet

På `.tmp/review-screens/participants-mobile.png` börjar sidan med en stor vit yta och små bokstavsknappar innan toppbaren. Även om detta delvis är ett layoutfel ser det också ut som en ofärdig mobilnavigation. Andra projekt visar normalt en topbar, drawer eller bottom nav, inte en lös ikonmatris.

Kod:

- `frontend/src/admin/AdminApp.tsx:202-237`
- `frontend/public/app.css:137-170`
- `frontend/public/app.css:2200-2232`

Det första intrycket på mobil är “debugläge”, inte “produkt”.

## 4. Paletten är för generisk och för enformigt blå

Adminytan domineras av samma blå accent, ljusblå aktiva states, ljusblå badges, ljusblå ikoner och ljusa kort. Det saknas ett tydligt turneringsspråk: tävling, banor, status, live, varning och avslut borde ha tydligare semantik.

Kod:

- `frontend/public/app.css:1-17`
- `frontend/public/app.css:459-468`
- `frontend/public/app.css:573-596`
- `frontend/public/app.css:704-721`
- `frontend/public/app.css:778-781`

Resultatet är rent, men också platt och anonymt. Det ser mer ut som en generisk SaaS-template än ett tävlingsverktyg.

## 5. Nästan allt är kort-i-kort med samma radius, border och skugga

Sidorna består av paneler, cards, metric cards, side cards, inner cards, mini-list rows och schedule cards. Allt har ungefär samma 8px radius, tunna gränser och mjuk skugga. Det gör att ingenting känns primärt.

Kod:

- `frontend/public/app.css:424-430`
- `frontend/public/app.css:504-513`
- `frontend/public/app.css:675-686`
- `frontend/public/app.css:922-952`
- `frontend/public/app.css:1063-1070`

I bättre adminprodukter är page sections ofta plattare, medan bara verkliga objekt eller modaler får kortbehandling.

## 6. Startsidan har för mycket död yta

På `.tmp/review-screens/admin-home-desktop.png` finns en enda turneringsrad, en högerkolumn och sedan enorm tom yta. Det känns inte som en genomarbetad dashboard. En etablerad produkt skulle använda ytan till kommande matcher, live-status, snabbstart, import eller en bättre empty/list state.

Kod:

- `frontend/public/app.css:470-499`
- `frontend/src/admin/AdminApp.tsx` i admin home-flödet runt turneringslista och sidopaneler.

Det ser inte lyxigt minimalistiskt ut, det ser oklart och halvfyllt ut.

## 7. Topbarens sökfält ser ut som Command Palette men beter sig inte så

Fältet har sökikon, `⌘ K` och placeholder för global sökning. Det signalerar en kraftfull kommandopalett. Men Enter visar bara en notice. Den visuella konventionen är alltså lånad från andra produkter, men funktionen finns inte.

Kod:

- `frontend/src/admin/AdminApp.tsx:238-250`
- `frontend/public/app.css:319-339`

Det här sänker förtroendet eftersom UI:t låtsas vara mer färdigt än det är.

## 8. Filterchips ser klickbara ut men är bara dekor

Chips som `Alla`, `Lag`, `Seedade`, `Pågår`, `Kommande` och `Avslutade` ser ut som interaktiva filter. I andra projekt är chips i den stilen knappar. Här är de statiska spans.

Kod:

- `frontend/src/admin/AdminApp.tsx:896-900`
- `frontend/src/admin/AdminApp.tsx:999-1005`
- `frontend/src/admin/AdminApp.tsx:1301-1306`
- `frontend/public/app.css:828-852`

Visuellt är detta en lögn. Antingen ska de vara riktiga filter eller visas som passiva sammanfattningar med annat utseende.

## 9. Primära knappar används för för många olika saker

Blå primärknapp används för att skapa, hantera Live TV, lägga till deltagare, lägga till resurs, spara livepoäng och avsluta match. Alla får nästan samma vikt. Det gör att en destruktiv eller viktig åtgärd inte särskiljs från normal navigation.

Kod:

- `frontend/public/app.css:60-84`
- `frontend/src/admin/AdminApp.tsx:781-783`
- `frontend/src/admin/AdminApp.tsx:902-906`
- `frontend/src/admin/AdminApp.tsx:974-977`
- `frontend/src/admin/AdminApp.tsx:1181-1184`

Andra projekt brukar reservera primärknappen för en tydlig huvudhandling per vy.

## 10. Destruktiva actions ser ofarliga ut

`Generera gruppspel och slutspel`, `Bygg om bracket`, `Autoschemalägg matcher` och `Avsluta match` presenteras som vanliga knappar. Det ser inte riskabelt ut, trots att det kan förändra mycket data.

Kod:

- `frontend/src/admin/AdminApp.tsx:837`
- `frontend/src/admin/AdminApp.tsx:880-883`
- `frontend/src/admin/AdminApp.tsx:987-990`
- `frontend/src/admin/AdminApp.tsx:1181-1184`

I bättre verktyg har sådana actions annan färg, iconografi, confirm state och förklarande text.

## 11. Turneringens flikar duplicerar sidomenyn och gör navigationen rörig

Det finns både vänsternav och horisontella turneringsflikar för samma sektioner. På desktop känns det redundant, på mobil blir flikarna horisontellt avklippta. Andra adminprojekt väljer oftast en primär navigationsmodell och håller den konsekvent.

Kod:

- `frontend/src/admin/AdminApp.tsx:787-795`
- `frontend/public/app.css:755-791`
- `frontend/public/app.css:2269-2275`

Det är inte bara platsproblem, det är en svag informationsarkitektur.

## 12. Schemavyn ser inte ut som ett schema

På `.tmp/review-screens/schedule-desktop.png` är schemat bara kolumner med kort. Det finns ingen tidsaxel, ingen visuell konfliktindikator, ingen kompakt kalenderkänsla och ingen tydlig sortering. För en turneringsapp borde schema vara en av de mest visuellt mogna vyerna.

Kod:

- `frontend/src/admin/AdminApp.tsx:950-968`
- `frontend/public/app.css:918-960`

Det ser mer ut som en enkel Kanban-lista än som spelplanering.

## 13. Matchtabellerna är för svåra att skanna

På `.tmp/review-screens/matches-desktop.png` är raderna långa, texten bryts i flera kolumner, statusar ligger långt från matchnamn och åtgärderna blir repetitiva. Andra projekt hade sannolikt grupperat på tid/bana/status, gjort actions mer ikonbaserade och hållit matchens viktigaste information i en tydligare radlayout.

Kod:

- `frontend/src/admin/AdminApp.tsx:996-1039`
- `frontend/public/app.css:1282-1305`

Det är funktionellt, men det ser ut som en databastabell snarare än ett operationsverktyg.

## 14. Native `details` för "Tid" ser rått och felkonventionellt ut

`Tid` använder en browser-default disclosure marker. Det ser ut som ett HTML-test, inte som en polerad radåtgärd. I andra adminverktyg skulle detta vara en ikonknapp, en inline popover eller en tydlig edit row.

Kod:

- `frontend/src/admin/AdminApp.tsx:1023-1033`
- `frontend/public/app.css:1350-1366`

Det är en liten detalj, men den sticker ut eftersom resten försöker vara en custom design.

## 15. Bracketen ser inte ut som en bracket

Slutspel visas som kort i kolumner utan linjer, kopplingar, seedmarkeringar eller visuellt flöde. `BYE` och `Vinnare match 19` får samma visuella behandling som riktiga lag. I turneringsprojekt förväntar man sig bracketstruktur, inte bara staplade cards.

Kod:

- `frontend/src/admin/AdminApp.tsx:832-849`
- `frontend/public/app.css:1369-1399`

Det här är en av de tydligaste “hur det borde se ut i andra projekt”-missarna.

## 16. Översiktens bracket och tabell konkurrerar visuellt utan tydlig prioritet

På `.tmp/review-screens/overview-desktop.png` ligger matcher, snabbåtgärder, aktivitet, bracket och tabell på samma nivå. Det är svårt att förstå vad översikten egentligen vill att arrangören ska göra härnäst.

Kod:

- `frontend/src/admin/AdminApp.tsx:797-865`
- `frontend/public/app.css:740-812`

En bra översikt brukar ge en tydlig “nästa bästa action” och sedan sekundär information.

## 17. Count-pills används som små bubblor utan tillräcklig kontext

Små runda bubblor med `12`, `25`, `7`, `1` dyker upp i panelheaders och listor. De ser ut som notiser, men betyder ibland totalantal och ibland listantal. Det blir visuellt inkonsekvent.

Kod:

- `frontend/public/app.css:459-468`
- `frontend/src/admin/AdminApp.tsx:952-953`
- `frontend/src/admin/AdminApp.tsx:980-981`
- `frontend/src/admin/AdminApp.tsx:996-1005`

I andra projekt brukar sådana siffror antingen ha label, vara badges kopplade till filter, eller ligga i metric cards.

## 18. Status-badges är för bleka för en live-operativ vy

`Pågår`, `Planerad`, `Avslutad`, `Registrerad` och `Aktiv` använder mjuka pastellbadges. De är snygga var för sig men för svaga när man ska snabbt se vad som händer i en turnering.

Kod:

- `frontend/public/app.css:609-641`

Live/status borde ha mer omedelbar läsbarhet: dot, icon, starkare kontrast eller tydligare placering.

## 19. Datumfältet ser amerikanskt och ofärdigt ut

I `Ny turnering` visas browserplaceholdern `mm/dd/yyyy, --:-- --`. Resten av appen är svensk. Det här ser direkt opolerat ut.

Skärmdump:

- `.tmp/review-screens/admin-home-desktop.png`

Kod:

- Turneringens create-form i admin home.
- Global input styling i `frontend/public/app.css:40-58`.

Använd en svensk datum/tid-komponent, en hjälprad eller en egen formatterad input.

## 20. Deltagardetaljkortet känns som en CRM-profil, inte som en turneringsvy

I deltagarvyn väljs första deltagaren automatiskt och visas i ett stort sidokort med Seed, Grupp och Status. Det tar mycket plats men ger lite operativ nytta. Andra turneringsverktyg hade troligen visat lagets matcher, gruppresultat, kontakt/seed eller actions.

Kod:

- `frontend/src/admin/AdminApp.tsx:924-944`
- `frontend/public/app.css:875-916`

Det ser välgjort ut på ytan, men fel för arbetsflödet.

## 21. Deltagarformuläret ligger som en tung ruta ovanför listan

På `.tmp/review-screens/participants-desktop.png` tar add-formuläret mycket horisontell plats och ser ut som en panel i panelen. I andra projekt brukar “lägg till rad” ligga kompakt i toolbar, som slide-over, eller som en tydligare import/add flow.

Kod:

- `frontend/src/admin/AdminApp.tsx:902-907`
- `frontend/public/app.css:855-860`
- `frontend/public/app.css:1240-1275`

Det här gör listvyn tyngre än den behöver vara.

## 22. TV-admin ser mer ut som en intern dev-konsol än en skärmhanterare

På `.tmp/review-screens/tv-admin-desktop.png` domineras vyn av URL-inputs, koder, selectfält och tekniska bindningar. En polerad skärmhanterare hade sannolikt visat skärmnamn, status, senaste ping, preview, QR/copy actions och tydlig “koppla till turnering/bana”.

Kod:

- `frontend/src/admin/AdminApp.tsx:497-607`
- `frontend/public/app.css:1053-1115`

Det fungerar som adminformulär, men ser inte ut som produktdesign.

## 23. Koder och URLs saknar rätt affordance

TV-länkens URL visas i ett read-only input och knappen heter bara `Öppna`. Andra projekt brukar använda copy-knapp, extern-länk-ikon, QR och en tydlig status om skärmen är ansluten.

Kod:

- `frontend/src/admin/AdminApp.tsx:542-545`
- `frontend/public/app.css:1008-1027`

Read-only input är en billig lösning visuellt.

## 24. Moderator-delningen ser halvfärdig ut

Delningskortet visar en länk, en QR-liknande placeholder och en label. Det saknar riktig QR, copy-knapp, instruktioner, giltighet, scope-sammanfattning och visuell säkerhetskänsla.

Kod:

- `frontend/src/admin/AdminApp.tsx:1116-1125`
- `frontend/public/app.css:1029-1051`

Det här är en central adminfunktion som just nu ser som en mockup.

## 25. Aktivitetstidslinjen använder tomma cirklar

På översikten och TV-admin ser aktivitet ut som rader med stora tomma/ljusblå cirklar. De kommunicerar ingen händelsetyp. I andra projekt används ikoner, färgkodning eller tydligare tidslinjemarkörer.

Kod:

- `frontend/src/admin/AdminApp.tsx:1127-1130`
- `frontend/src/tv/TvApp.tsx:239-245`
- `frontend/public/app.css:1424-1442`
- `frontend/public/app.css:2076-2097`

Det ser dekorativt ut, inte informativt.

## 26. TV-topbaren känns som adminmetadata, inte publik grafik

På `.tmp/review-screens/tv-public-1920.png` finns brand, turnering, datum, klocka, sidnummer, countdown och dots i en rigid grid. Det är mycket systemmetadata för en publikskärm. Sportgrafik brukar prioritera match, bana, tid, poäng och kommande matcher, inte “Sida 1 av 3”.

Kod:

- `frontend/src/tv/TvApp.tsx:148-153`
- `frontend/public/app.css:1508-1582`

Det ser mer ut som en kiosk-dashboard än en publik turneringsdisplay.

## 27. TV-featurematchen har fel visuell prioritet

I TV-vyn är lagnamnen enorma medan poängen ligger relativt litet i mitten. En sport-/turneringsskärm brukar låta score, status, tid och bana vara extremt tydliga. Här blir lagetexten en typografisk vägg.

Kod:

- `frontend/src/tv/TvApp.tsx:162-171`
- `frontend/public/app.css:1719-1803`

Det är särskilt tydligt i `.tmp/review-screens/tv-public-1920.png`.

## 28. TV-layouten är för mycket “kortdashboard”

TV använder stora paneler med borders och radius. För publikskärmar brukar man antingen gå mer broadcast-overlay, scoreboard eller fullskärmslistor. Här ser det ut som adminappen i mörkt tema.

Kod:

- `frontend/public/app.css:1666-1703`

Det är inte katastrof, men det saknar publikskärmskänsla.

## 29. TV-tabellerna saknar sportgrafisk rytm

`Härnäst`, `Senaste resultat` och `Dagens schema` är generiska gridrader. Det finns ingen stark gruppering per tid, bana eller status. Raderna blir texttunga och monotona.

Kod:

- `frontend/src/tv/TvApp.tsx:177-195`
- `frontend/src/tv/TvApp.tsx:251-270`
- `frontend/public/app.css:1859-1889`

Andra projekt skulle ofta använda tydligare tidskolumn, matchnummer, court-chip, live-dot och mer kontrollerad typografi.

## 30. Carousel-dots på TV säger ingenting

Tre stora prickar visar slideposition men inte vad som kommer. På en publik skärm är det bättre med tydliga slide labels eller en diskret progressbar kopplad till “Matcher”, “Tabeller”, “Schema”.

Kod:

- `frontend/src/tv/TvApp.tsx:152-153`
- `frontend/public/app.css:1565-1582`

Det ser snyggt ut som web carousel, men är svagt som informationssystem.

## 31. Moderatorvyn är för administrativ för sitt jobb

Moderatorflödet borde vara snabbt: match, två scorefält, spara, avsluta. I stället får det ett vanligt adminsidhuvud, en sidopanel med PIN-info och filterchips. Det känns som en nedbantad adminvy, inte ett specialverktyg för en stressad moderator.

Kod:

- `frontend/src/admin/AdminApp.tsx:1274-1324`
- `frontend/public/app.css:1188-1229`

På plats vid en bana behöver detta vara mer touchoptimerat och mindre informationsbrusigt.

## 32. Score-dialogen använder fulla lagnamn som input-labels

Formuläret för poäng använder hela lagnamnet som label ovanför varje score input. Det är visuellt tungt och blir absurt med långa namn. I andra produkter separeras matchup-display från korta labels som `Hemmalag`, `Bortalag`, `Lag A`, `Lag B`.

Kod:

- `frontend/src/admin/AdminApp.tsx:1173-1180`
- `frontend/public/app.css:1148-1173`

Även när det inte overflowar ser det klumpigt ut.

## 33. Språket blandar svensk produkttext med engelska/raw termer

Exempel: `Live TV`, `Bracket`, `Scope`, `Server`, raw `COURT` i TV-resursvyn. Det får produkten att kännas oavslutad.

Kod:

- `frontend/src/admin/AdminApp.tsx:787-795`
- `frontend/src/admin/AdminApp.tsx:1088-1093`
- `frontend/src/tv/TvApp.tsx:274-280`

En polerad svensk produkt väljer en konsekvent terminologi.

## 34. Forms saknar bra hjälpmönster

Många formulär har bara label och placeholder. Det saknas exempel, inline-validering, enhetslabel för minuter, datumformat, eller förklaringar när val påverkar mycket.

Kodexempel:

- `frontend/src/admin/AdminApp.tsx:902-907`
- `frontend/src/admin/AdminApp.tsx:974-977`
- `frontend/src/admin/AdminApp.tsx:1025-1032`
- `frontend/src/admin/AdminApp.tsx:1088-1094`

Det ger en “rå HTML-form”-känsla.

## 35. Det finns ingen tydlig tom-state-design

Tomma lägen är ofta bara en kort text som “Inga matcher ännu” eller “Generera gruppspel för att se bracket”. Andra projekt brukar använda en tydlig empty state med huvudaction, kort förklaring och ibland illustration/ikon.

Kodexempel:

- `frontend/src/admin/AdminApp.tsx:839`
- `frontend/src/admin/AdminApp.tsx:967`
- `frontend/src/admin/AdminApp.tsx:1021`
- `frontend/src/tv/TvApp.tsx:174`
- `frontend/src/tv/TvApp.tsx:191`

Det är inte fult i sig, men det känns minimalt och ofärdigt.

## 36. Typografin saknar tydlig skala

Adminrubriker, panelrubriker, table text, badges och helper text ligger nära varandra i vikt och storlek. Det gör vyn jämn men svår att scanna. H1 är stor, men därefter blir mycket samma nivå.

Kod:

- `frontend/public/app.css:101-126`
- `frontend/public/app.css:724-737`
- `frontend/public/app.css:1295-1305`

En mognare UI skulle ha hårdare hierarki mellan page title, section title, object title, metadata och action.

## 37. Huvudactions ligger ibland långt från objektet de påverkar

`Hantera turnering` och `Hantera Live TV` ligger i page-head, medan den aktuella arbetsytan ligger under flikar/paneler. `Skapa turnering` ligger både som knapp uppe och formulär i högerkolumn. Det skapar osäkerhet om var man ska agera.

Kod:

- `frontend/src/admin/AdminApp.tsx:775-784`
- Admin home create-flow och `frontend/public/app.css:398-422`

Andra projekt brukar placera objektåtgärder närmare objektet eller i en tydlig sticky actionbar.

## 38. Det finns inga riktiga visuella affordances för “live”

Appen heter och visar Live TV, men livekänslan i admin är låg. `Pågår` är bara en blek badge. Inga pulser, ingen tydlig “nu”-rad, ingen markerad bana, ingen tidsprogress.

Kod:

- `frontend/src/admin/AdminApp.tsx:797-824`
- `frontend/src/admin/AdminApp.tsx:996-1021`
- `frontend/public/app.css:609-641`

Det borde kännas mer omedelbart när matcher faktiskt pågår.

## 39. Projektet saknar visuell “domain ownership”

Det finns inga idrotts-/turneringsspecifika visuella element förutom ord som match, grupp och slutspel. Ingen bracketgrafik, ingen court/timeline-känsla, inga matchnummer, ingen seedgrafik, ingen tydlig scoreboard-estetik i admin.

Kod och skärmdumpar visar samma sak överallt:

- `frontend/public/app.css`
- `.tmp/review-screens/*.png`

Det är ett snyggt generiskt adminskal, men det äger inte sin domän.

## 40. Prioriterad polishordning

Om detta ska se mer ut som ett färdigt projekt bör ordningen vara:

1. Byt bokstavsglyphs och brandmark till riktig ikonografi.
2. Gör bracket och schema till domänriktiga vyer, inte generiska kortlistor.
3. Städa knapphierarki och destruktiva actions.
4. Gör filterchips antingen riktiga eller visuellt passiva.
5. Gör TV-vyn mer scoreboard/broadcast och mindre dashboard.
6. Gör moderatorvyn touchfokuserad och mindre adminlik.
7. Strama upp typografi, statuskontrast och tom-state-design.
