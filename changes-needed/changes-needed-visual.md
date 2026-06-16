# Visuella fel som måste fixas

Den här filen är en separat visuell passning. Jag har inte flyttat över innehåll från `changes-needed.md`; fynden nedan kommer från nya stressdata och nya Docker/Chromium-skärmdumpar.

Testmiljö:

- Server: `127.0.0.1:8030`
- Testturnering: id `9`, med långa obrutna turneringsnamn, lag, resurser, TV-länkar och moderatorlänkar.
- Skärmdumpar: `.tmp/visual-review-screens/`
- Playwright kördes i Docker Chromium, inte lokalt.
- Mätdata: `.tmp/visual-review-screens/metrics.json`

## 1. Turneringsrubriken spräcker hela adminlayouten

Skärmdumpar:

- `.tmp/visual-review-screens/participants-320.png`
- `.tmp/visual-review-screens/schedule-1366.png`
- `.tmp/visual-review-screens/bracket-1366.png`
- `.tmp/visual-review-screens/settings-390.png`

På turneringssidorna får ett långt obrutet turneringsnamn `h1` att bli bredare än viewporten. På 320 px mobil blir sidan 1926 px bred. På 1366 px desktop blir flera turneringssidor 2338 px breda. Det skapar enorm tom yta åt höger, flyttar sidans actionknappar långt bort från innehållet och gör flikarna/korten visuellt separerade från rubriken.

Kod:

- `frontend/src/admin/AdminApp.tsx:775-779` renderar `tournament.name` direkt i sidhuvudet.
- `frontend/public/app.css:108-112` sätter stor `h1`, men ingen brytning för långa tokens.
- `frontend/public/app.css:2242-2245` gör mobil `.page` smal, men rubrikens innehåll får ändå växa utanför.

Det här ska inte lösas med horisontell scroll. Rubriker måste ha `min-width: 0` i sina flex/grid-föräldrar och `overflow-wrap: anywhere` eller en medveten ellipsis/maxbredd.

Status: Löst
Jag gav `page-head` och turneringsrubrikens textkolumn `min-width: 0`, så flexlayouten får krympa rubriken i stället för att låta den styra dokumentbredden. Rubrik och underrad bryter nu långa obrutna tokens med `overflow-wrap: anywhere`, vilket gör att samma namn ryms på både mobil och desktop. Actionknapparna i titelraden får fortfarande sin plats, men rubrikblocket kan radbrytas utan horisontell scroll. Regressionstestet `frontend/tests/admin-flow.spec.ts::lång turneringsrubrik spräcker inte adminlayouten` skapar ett extremt långt namn i mobil- och desktopviewport och verifierar att dokument, rubrik och h1 håller sig inom viewporten.

## 2. Moderatorns sidhuvud spricker redan före inloggning

Skärmdumpar:

- `.tmp/visual-review-screens/moderator-login-390.png`
- `.tmp/visual-review-screens/moderator-authorized-390.png`

Moderatorvyn har ingen admin-sidebar som förklarar detta. Ändå blir mobilvyn 969 px bred på 390 px viewport bara av sidhuvudets turneringsnamn. Före inloggning rinner turneringsnamnet rakt ut åt höger. Efter inloggning fortsätter samma problem och drar med sig resten av moderatorlayouten.

Kod:

- `frontend/src/admin/AdminApp.tsx:1280-1285` renderar moderatorlabel och turneringsnamn direkt.
- `frontend/public/app.css:1188-1190` begränsar `.moderator-page`, men texten får fortfarande växa utanför.

Det här gör moderatorlänkar opålitliga på telefoner. Sidhuvudet måste bryta långa namn konsekvent.

Status: Löst
Jag lät moderatorvyn använda samma robusta `page-head`-regler som adminrubrikerna: flexbarnen får `min-width: 0` och rubrik/metadata bryter långa tokens med `overflow-wrap: anywhere`. Det gör att moderatorlabeln, det långa turneringsnamnet och resursraden stannar inom `.moderator-page` i mobilbredd både före och efter PIN-login. Jag gjorde overflow-testhjälparen i Playwright generell så den kan mäta valfritt sidhuvud i stället för bara turneringssidan. Regressionstestet `frontend/tests/admin-flow.spec.ts::moderatorns sidhuvud bryter långa turneringsnamn före och efter inloggning` skapar en moderatorlänk för en turnering med långt obrutet namn, öppnar den på 390 px, verifierar layouten före PIN och upprepar samma kontroll efter inloggning.

## 3. Deltagarlistan klipper namn utan någon visuell signal

Skärmdump:

- `.tmp/visual-review-screens/participants-320.png`

På mobil kapas deltagarnamn hårt i tabellen. Det finns ingen ellipsis, fade, tooltip eller annan signal om att namnet fortsätter. Samtidigt orsakar resten av sidan horisontell scroll, så användaren kan inte avgöra om tabellen är medvetet scrollbar eller bara trasig.

Kod:

- `frontend/src/admin/AdminApp.tsx:908-916` lägger namn direkt i tabellcell.
- `frontend/public/app.css:1282-1303` ger tabellen normal tabellayout utan textstrategi.
- `frontend/public/app.css:2300-2303` gör tabellen `overflow-x: auto` på mobil, men det hjälper inte när hela sidan redan är bredare än viewporten.

Tabellceller med användargenererade namn behöver explicit wrapping/ellipsis och en förutsägbar scroll-container.

Status: Löst
Jag gav deltagartabellen en fast kolumnstrategi så seed, typ och status inte låter ett långt namn trycka ut hela raden. Namncellen renderas nu som ett eget flexblock med avatar och text, där namnet har ellipsis, `overflow: hidden` och `title` med hela deltagarnamnet. På mobil ligger deltagartabellen i en egen scrollbar-wrapper, men själva namnet hålls inom deltagarpanelen och signalerar tydligt att texten fortsätter. Regressionstestet `frontend/tests/admin-flow.spec.ts::deltagarlistan visar ellipsis och titel för långa namn` skapar ett långt obrutet deltagarnamn på 320 px och verifierar ellipsis, tooltip och att texten stannar inom panelen.

## 4. Deltagardetaljkortet låter långa namn gå utanför kortet

Skärmdump:

- `.tmp/visual-review-screens/participants-320.png`

Detaljkortet under deltagarlistan visar första deltagaren, men namnet sticker ut långt utanför kortets högra kant. Kortet ser trasigt ut även om resten av sidan ignoreras.

Kod:

- `frontend/src/admin/AdminApp.tsx:924-929` renderar namn i `.detail-hero h2`.
- `frontend/public/app.css:875-885` sätter flexrad för `.detail-hero`, men saknar `min-width: 0` och brytning på textblocket.

Det här är ett rent kortlayoutfel. Flexbarnet med rubriken måste få krympa och bryta text.

Status: Löst
Jag gjorde `.detail-hero` till en säkrare flexrad genom att ge både raden och textblocket `min-width: 0`. Symbolen i kortet får nu fast flexbredd, så den inte konkurrerar med namntexten när kortet blir smalt. Deltagarnamnet i detaljkortets `h2` bryter långa obrutna tokens med `overflow-wrap: anywhere` och har `title` med hela namnet. Regressionstestet `frontend/tests/admin-flow.spec.ts::deltagardetaljkortet bryter långa namn inom kortet` skapar ett långt deltagarnamn på 320 px och verifierar att rubriken stannar i kortet utan dokumentoverflow.

## 5. Kvalificerade-listan i slutspel läcker långa namn utanför panelen

Skärmdumpar:

- `.tmp/visual-review-screens/bracket-390.png`
- `.tmp/visual-review-screens/bracket-1366.png`

I "Kvalificerade till slutspel" sticker långa namn ut genom panelens högra kant. Poäng-pillret ligger kvar längst ut, men namnet går bakom/under layouten och gör raden oläslig.

Kod:

- `frontend/src/admin/AdminApp.tsx:867-875` renderar kvalificerade rader.
- `frontend/public/app.css:1408-1416` använder flex med `justify-content: space-between`, men textdelen får ingen `min-width: 0` eller brytstrategi.

Flexrader med namn och badge måste begränsa textdelen. Just nu får texten vinna över kortet.

Status: Löst
Jag gav textblocket i `.mini-list article` `min-width: 0` och `overflow-wrap: anywhere`, så långa kvalificerade lagnamn bryts i stället för att trycka ut panelkanten. Poängpillret ligger kvar som flexbarn med sin naturliga bredd, medan namntexten nu får krympa och bryta långa tokens. Regressionstestet `frontend/tests/admin-flow.spec.ts::kvalificerade-listan bryter långa lagnamn i slutspelspanelen` skapar en turnering med ett extremt långt lagnamn på 390 px och verifierar att namnet stannar i panelen.

## 6. Slutspelstabellen på admin-sidan saknar textstrategi för långa lagnamn

Skärmdumpar:

- `.tmp/visual-review-screens/bracket-1366.png`
- `.tmp/visual-review-screens/bracket-390.png`

Grupp A-tabellen i slutspelsvyn visar långa lagnamn som trycker cellerna åt höger. På desktop blir sidan bredare än viewporten. På mobil klipps namnen ihop med den redan spräckta sidan.

Kod:

- `frontend/src/admin/AdminApp.tsx:852-860` renderar standings-tabellen.
- `frontend/public/app.css:1282-1303` saknar maxbredd/wrapping för tabellceller.

Standings-tabeller behöver samma robusta namnbehandling som deltagarlistan.

Status: Löst
Jag gav standings-tabellen `table-layout: fixed` så kolumnbredderna styrs av tabellen i stället för innehållet. Namnkolumnen (nth-child(2)) fick `overflow-wrap: anywhere` och `word-break: break-word` så långa lagnamn bryts i stället för att trycka ut cellen och sidan. Alla numeriska kolumner fick 32 px bredd med centrerad text, vilket ger tabellen en förutsägbar layout oavsett namnens längd. Regressionstestet `frontend/tests/admin-flow.spec.ts::slutspelstabellen bryter långa lagnamn i standings` skapar en turnering med ett extremt långt lagnamn på 390 px och verifierar att tabellen stannar inom viewporten.

## 7. Schemabrädan låter resursnamn och matchnamn rinna mellan kolumner

Skärmdumpar:

- `.tmp/visual-review-screens/schedule-1366.png`
- `.tmp/visual-review-screens/schedule-390.png`

Schema-korten läcker in i varandra när resursnamn eller lag är långa. På desktop syns namn som går över kolumngränser och bakom sidopanelen. På mobil blir layouten 1926 px bred på 390 px viewport.

Kod:

- `frontend/src/admin/AdminApp.tsx:954-963` renderar resurskolumner och matchkort.
- `frontend/public/app.css:918-960` skapar korten, men saknar `overflow-wrap`/begränsning i `header`, `strong` och `small`.

Varje resurskolumn måste vara en hård layoutgräns. Text ska brytas eller trunkeras inne i kortet, inte rita över nästa kolumn.

Status: Löst
Jag gav `.resource-match` containern `min-width: 0` så flex/grid-layouten kan krympa korten. Resursnamnet i kolumnheadern och matchnamnet i korten fick `overflow-wrap: anywhere` så långa obrutna tokens bryts inuti kortet i stället för att rinna över till nästa kolumn. Datum och gruppinfo i `small` fick samma brytning via headern. Regressionstestet `frontend/tests/admin-flow.spec.ts::schemabrädan bryter långa resurs- och matchnamn i kolumnerna` skapar en resurs och match med extremt långa namn på 390 px och verifierar att dokumentet stannar inom viewporten.

## 8. "Alla matcher"-tabellen exploderar sidbredden

Skärmdumpar:

- `.tmp/visual-review-screens/matches-1366.png`
- `.tmp/visual-review-screens/matches-390.png`
- `.tmp/visual-review-screens/schedule-1366.png`

Matchtabellen blir extremt bred med långa deltagar- och resursnamn. Mätningen visar 2338 px scrollbredd på 1366 px viewport och 1926 px på 390 px viewport. Det här är inte bara "tabellen scrollar"; hela sidan dras ut och andra element hamnar i ett visuellt ödeland åt höger.

Kod:

- `frontend/src/admin/AdminApp.tsx:996-1039` renderar hela matchtabellen.
- `frontend/public/app.css:1282-1303` ger tabellen full bredd utan kolumnstrategi.

Tabellen behöver en riktig responsiv modell: definierade kolumnbredder, textbrytning, sticky/scrollad container eller en mobil kortvy.

Status: Löst
Jag gav `.matches.admin-table` `table-layout: fixed` med explicita procentbredder för varje kolumn, så långa namn inte längre kan trycka ut tabellen. Texttunga celler (match, deltagare) fick en `.table-cell-text`-wrapper med `overflow-wrap: anywhere` och `word-break: break-word`. Hela tabellen ligger i en `.table-scroll`-container för säker horisontell scroll på smal skärm. Regressionstestet `frontend/tests/admin-flow.spec.ts::alla-matcher-tabellen exploderar inte sidbredden` skapar en match med extremt långa lagnamn på 390 px och verifierar att dokument och panel stannar inom viewporten.

## 9. Den öppnade "Tid"-editorn i matchtabellen trycker iväg åtgärdskolumnen

Skärmdumpar:

- `.tmp/visual-review-screens/matches-details-open-1366.png`
- `.tmp/visual-review-screens/matches-details-open-390.png`

När `Tid` öppnas i en rad blir editorn visuellt lösryckt från matchraden och skapar ännu mer horisontell bredd. På desktop syns formulär långt ute till höger, separerat från sitt sammanhang.

Kod:

- `frontend/src/admin/AdminApp.tsx:1023-1033` renderar details-formuläret inne i tabellcellen.
- `frontend/public/app.css:1350-1366` sätter `row-actions[open]` till upp till 520 px inne i en redan trång tabellcell.

Det här bör vara en rad-expansion under tabellen, en popover/modaldialog eller en kontrollerad cell-layout. Nu beter den sig som en breddbomb.

Status: Löst
Jag ändrade `.row-actions[open]` så den inte längre har en stor `min-width` på 520 px, utan i stället får `max-width: 420px` med viewport-begränsning. Formuläret inuti details fick `flex-wrap: wrap` med `gap: 8px` så inputar, select och knapp radbryts i stället för att trycka ut cellen. Varje formulärelement fick `min-width: 100px` så de inte blir osynligt smala. Regressionstestet `frontend/tests/admin-flow.spec.ts::tid-editorn trycker inte iväg åtgärdskolumnen` öppnar details på en match på 390 px och verifierar att panelen inte spricker.

## 10. Poängdialogens matchnamn överlappar varandra

Skärmdumpar:

- `.tmp/visual-review-screens/score-dialog-1366.png`
- `.tmp/visual-review-screens/score-dialog-390.png`
- `.tmp/visual-review-screens/viewport-score-dialog-390.png`

I poängdialogen överlappar långa lagtexter `vs`, motståndarlaget och input-labels. På desktop ligger text ovanpå text. På mobil sticker hela dialogen utanför viewporten och höger sida försvinner.

Kod:

- `frontend/src/admin/AdminApp.tsx:1173-1180` renderar både matchup och labeltext från lagnamn.
- `frontend/public/app.css:1148-1173` skapar matchup-grid och tvåkolumnsformulär.
- `frontend/public/app.css:2260-2266` byter till en kolumn på mobil, men de långa labeltexterna får fortfarande spräcka panelen.

Det räcker inte att ändra gridkolumner. Dialogens lagtexter måste brytas, begränsas eller separeras från input-labels.

Status: Löst
Jag gav `.score-matchup strong` och `.score-dialog-form label` `overflow-wrap: anywhere` och `word-break: break-word`, så långa lagnamn i matchup-raden och som inputlabels bryts i stället för att överlappa `vs`- Texten och motståndarlaget. Formuläret fick `max-width: 100%` så gridet inte kan växa utanför modalen. Regressionstestet `frontend/tests/admin-flow.spec.ts::poängdialogens matchnamn överlappar inte` öppnar poängdialogen för en match med extremt långa lagnamn på 390 px och verifierar att dialogen och dokumentet stannar inom viewporten.

## 11. Poängdialogens mobilknappar försvinner åt höger

Skärmdump:

- `.tmp/visual-review-screens/viewport-score-dialog-390.png`

På mobil syns bara delar av actionraden. "Avbryt" och ibland stäng-knappen hamnar helt eller delvis utanför den synliga ytan. Det beror på att dialogens innehåll redan har spräckt bredden och att knappar dessutom har nowrap.

Kod:

- `frontend/src/admin/AdminApp.tsx:1181-1184` renderar tre actionknappar.
- `frontend/public/app.css:60-71` sätter `white-space: nowrap` på alla knappar.
- `frontend/public/app.css:1176-1181` låter `.modal-actions` wrap:a, men den trasiga panelbredden gör det inte tillräckligt.

Modaler får inte bli bredare än viewporten. Knapparna behöver staplas eller få säkra min/max-bredder på små skärmar.

Status: Löst
Poängdialogens innehåll hindras nu från att göra modalen bredare än viewporten genom `overflow-wrap: anywhere` på matchup-strong och label-element. Modalknapparna radbryts och staplas redan via `.modal-actions` flex-wrap, men när dialogens innehåll inte längre spricker viewporten syns alla knappar. Regressionstestet `frontend/tests/admin-flow.spec.ts::poängdialogens mobilknappar syns på 390 px` öppnar poängdialogen på 390 px och verifierar att action-knapparna finns synliga i modalen.

## 12. Live TV-admins skapandeformulär blir absurt högt på mobil

Skärmdumpar:

- `.tmp/visual-review-screens/tv-admin-390.png`
- `.tmp/visual-review-screens/viewport-tv-admin-390.png`

Fälten "Etikett" och "Egen kod" i "Ny Live TV-länk" blir enorma tomma rektanglar på mobil. Inputen sitter längst ner i en flera hundra pixlar hög label. Det ser ut som en trasig textarea fast det är vanliga inputfält.

Kod:

- `frontend/src/admin/AdminApp.tsx:514-517` renderar formuläret.
- `frontend/public/app.css:998-1000` sätter `flex: 0 1 240px` på labels.
- `frontend/public/app.css:2247-2254` gör `.inline-form` till kolumn på mobil, vilket gör flex-basis till höjd.

Det här är en direkt CSS-bugg. Label-basis ska inte bli vertikal höjd i mobilkolumn.

Status: Löst
Jag lade till en mobil-mediaquery som åsidosätter `.moderator-create-form label` och `.tv-create-form label` så deras `flex-basis` blir `auto` i stället för `240px` när `.inline-form` byter till kolumnlayout. Labels får i stället `width: 100%` och `max-width: 100%` så de fyller hela bredden utan att bli onödigt höga. Regressionstestet `frontend/tests/admin-flow.spec.ts::tv- och moderatorformulär blir inte absurt höga på mobil` skapar en TV-länk och moderatorlänk på 390 px och mäter att label-elementen har proportionerlig höjd.

## 13. Moderator-admins skapandeformulär har samma trasiga mobilhöjd

Skärmdump:

- `.tmp/visual-review-screens/moderators-admin-390.png`

"Skapa moderatorlänk" får samma enorma tomma input/select-block som TV-admin. Det gör hela panelen onödigt hög och ser ofärdigt ut.

Kod:

- `frontend/src/admin/AdminApp.tsx:1088-1094` renderar moderatorformuläret.
- `frontend/public/app.css:998-1000` delar samma labelregel med TV-formuläret.
- `frontend/public/app.css:2247-2254` staplar formuläret på mobil.

Samma rotorsak som ovan, men i en annan användarväg.

Status: Löst
Samma mobilmediaquery fixar både TV- och moderator-create-formulären genom att sätta `flex: 0 1 auto` och `width: 100%` på labels när formuläret staplas vertikalt. Regressionstestet täcker båda formulären.

## 14. TV-länkskort på mobil är bredare än viewporten

Skärmdump:

- `.tmp/visual-review-screens/tv-admin-390.png`

TV-admin blir 1005 px bred på 390 px viewport. Själva TV-länkskortet, bindningsformuläret och URL-raden drar ut sidan. Flera statusrader och selectfält ligger långt utanför synlig yta.

Kod:

- `frontend/src/admin/AdminApp.tsx:529-575` renderar varje TV-länkskort.
- `frontend/public/app.css:1059-1061` använder `minmax(440px, 1fr)` för `.tv-link-grid`.
- `frontend/public/app.css:1103-1115` binder formuläret i flera gridkolumner.
- `frontend/public/app.css:2191-2197` minskar bara till två kolumner under 1180 px, inte en säker mobilkolumn.

En 440 px minsta kolumn är inte mobilkompatibel. Korten måste kunna bli smalare än 390 px inklusive padding.

Status: Löst
Jag ändrade `.tv-link-grid` från `minmax(440px, 1fr)` till `minmax(300px, 1fr)` så grid-kolumner blir smalare än 390 px på mobil. I mobilmediaqueryn fick `.binding-form` och `.tv-link-grid` båda `grid-template-columns: 1fr` så de aldrig kan bli bredare än viewporten. Regressionstestet `frontend/tests/admin-flow.spec.ts::tv-länkskort ryms på mobil` navigerar till TV-admin på 390 px och verifierar att dokumentet inte spricker.

## 15. TV-admins sidopanel "Senaste länkar" läcker långa etiketter på desktop

Skärmdump:

- `.tmp/visual-review-screens/tv-admin-1366.png`

Även på desktop spräcker långa TV-etiketter sidopanelen. Mätningen visar att sidopanelen på 320 px har innehåll som vill bli 867 px brett.

Kod:

- `frontend/src/admin/AdminApp.tsx:595-603` renderar senaste länkar.
- `frontend/public/app.css:1402-1422` använder generella `.mini-list`-rader utan brytning/minbredd.

Sidopaneler är extra känsliga. Här måste etiketter trunkeras eller brytas inom panelen.

Status: Löst redan av problem 5
Samma `.mini-list article > div` och `strong`-regler som lades till för kvalificerade-listan (problem 5) gäller även TV-adminens "Senaste länkar"-artiklar. Långa TV-etiketter bryts nu inne i sidopanelen i stället för att läcka ut.

## 16. QR-rutan är en falsk QR-kod

Skärmdump:

- `.tmp/visual-review-screens/moderators-admin-390.png`

"Dela med moderator" visar en QR-liknande ruta, men den är bara CSS-rutor med ett `T` i mitten. Den ser skanningsbar ut men är inte det. Visuellt lovar den en funktion som inte finns.

Kod:

- `frontend/src/admin/AdminApp.tsx:1119-1123` renderar `.qr-placeholder`.
- `frontend/public/app.css:1029-1045` ritar ett QR-liknande mönster.

Antingen ska det vara en riktig QR-kod, eller så ska den inte se ut som en QR-kod.

## 17. Moderatorns matchkort spricker av långa resurser och lag

Skärmdump:

- `.tmp/visual-review-screens/moderator-authorized-390.png`

Efter inloggning i moderatorvyn rinner resursnamn och lag utanför matchkorten. Första kortet mäter 589 px innehållsbredd inne i en 390 px viewport. Score-formulären ligger i långa smala block som inte följer kortets kant.

Kod:

- `frontend/src/admin/AdminApp.tsx:1308-1323` renderar matchkort och score-form.
- `frontend/public/app.css:1209-1229` använder grid för header och scorekort, men ingen robust textbrytning.
- `frontend/public/app.css:2260-2266` gör mobilgrid till en kolumn, men texten får ändå växa utanför.

Moderatorvyn måste vara den mest tåliga vyn, eftersom den används snabbt på plats. Just nu är den visuellt trasig med realistiskt långa resursnamn.

Status: Löst
Jag gav `.moderator-match-title strong`, `.moderator-match-card header div:first-child strong` och `.moderator-score-card label` `overflow-wrap: anywhere` och `word-break: break-word`. Långa lagnamn i matchtiteln och som score-inputlabels bryts nu inne i kortet i stället för att rinna utanför. Den befintliga gridlayouten i header och score-kort med `minmax(0, 1fr)` gör att innehållet kan krympa. Regressionstestet `frontend/tests/admin-flow.spec.ts::moderatorns matchkort bryter långa namn` navigerar till moderatorvyn med långa namn på 390 px och verifierar att dokumentet stannar inom viewporten.

## 18. TV-vänteläget är bredare än mobilskärmen

Skärmdump:

- `.tmp/visual-review-screens/tv-waiting-390.png`

Väntelägets kort hamnar delvis utanför skärmen. På 390 px viewport blir sidan 647 px bred. Texten centreras, men höger halva av kortet och informationen kapas utanför viewporten.

Kod:

- `frontend/src/tv/TvApp.tsx:133-140` renderar vänteläget med label och kod.
- `frontend/public/app.css:1598-1629` sätter stor padding, 46 px rubrik och 22 px labeltext utan mobilanpassad brytning.

TV-vänteläget måste tåla långa labels/koder även på små kontrollskärmar eller mobil preview.

## 19. TV: "Nu spelas" gör långa lag till enorma textblock

Skärmdumpar:

- `.tmp/visual-review-screens/tv-bound-slide1-1366.png`
- `.tmp/visual-review-screens/tv-bound-slide1-390.png`

På TV-slide 1 bryts långa obrutna lag över många rader med jättestor typografi. På desktop trycks featurekortet sönder vertikalt. På mobil fyller ett enda lagnamn nästan hela skärmen och resten av matchinformationen hamnar utanför.

Kod:

- `frontend/src/tv/TvApp.tsx:162-166` renderar featurematchen.
- `frontend/public/app.css:1745-1758` sätter `font-size: 66px` och `overflow-wrap: anywhere`.
- `frontend/public/app.css:2360-2368` sänker bara till 40 px på mobil.

`anywhere` räddar bredden men förstör läsbarheten. TV-läget behöver maxrader, dynamisk typstorlek eller tydlig ellipsis beroende på yta.

## 20. TV: tabell/slutspel-slide klipper standingsnamn hårt

Skärmdump:

- `.tmp/visual-review-screens/tv-bound-slide2-1366.png`

På "Tabeller och slutspel" kapas långa lagnamn rakt vid panelkanten. Det finns ingen ellipsis eller fade, och tabellsiffrorna kan inte läsas ihop med raden när namnet är för långt.

Kod:

- `frontend/src/tv/TvApp.tsx:202-215` renderar standings på TV.
- `frontend/public/app.css:1694-1702` sätter `overflow: hidden` på `.tv-panel`.
- `frontend/public/app.css:1978-1989` definierar tabellen utan textstrategi.

TV-tabeller får inte bara gömma overflow. De behöver förutsägbar förkortning eller radbrytning.

## 21. TV: schema-slide klipper nederkant och gör senaste resultat oläsligt

Skärmdump:

- `.tmp/visual-review-screens/tv-bound-slide3-1366.png`

"Dagens schema" och "Senaste resultat" får så stora textrader att panelernas nederkant klipper innehållet. I senaste resultat-kortet syns tid och poäng delvis längst ner, men själva raden är avskuren. Det ser ut som ett renderingsfel på en publik skärm.

Kod:

- `frontend/src/tv/TvApp.tsx:251-270` renderar schema och senaste resultat.
- `frontend/public/app.css:1685-1692` låser schedule-layoutens rader.
- `frontend/public/app.css:1694-1702` döljer overflow på paneler.
- `frontend/public/app.css:1864-1883` ger TV-rader stora fasta minhöjder och 22/26 px typografi.

Publika TV-paneler måste antingen minska text, begränsa antal rader eller visa färre poster. Att klippa nederkanten är inte acceptabelt.

## 22. TV: "Härnäst" på live-slide kan inte hantera långa kommande matcher

Skärmdump:

- `.tmp/visual-review-screens/tv-bound-slide1-1366.png`

I högerpanelen "Härnäst" bryts långa matchnamn över många rader och trycker bort resten av innehållet. Tabellen har kolumnrubriker, men raderna blir så höga att panelen inte längre läser som en tabell.

Kod:

- `frontend/src/tv/TvApp.tsx:177-184` renderar "Härnäst".
- `frontend/public/app.css:1864-1883` låter text brytas `anywhere`, men saknar maxrader/ellipsis.

Det här är visuellt ett annat fel än att data bara "finns". Tabellen tappar sin tabellform.

## 23. TV-topbarens turneringsnamn mäter flera gånger sin tillgängliga bredd

Skärmdumpar:

- `.tmp/visual-review-screens/tv-bound-slide1-1366.png`
- `.tmp/visual-review-screens/tv-bound-slide2-1366.png`
- `.tmp/visual-review-screens/tv-bound-slide3-1366.png`

Topbaren visar turneringen med ellipsis, men mätningen visar att textnoden vill bli 1723 px bred i en 347 px yta. Det är för hårt beroende av `overflow: hidden`; om någon detalj i grid/padding ändras kommer topbaren spricka. Dessutom finns ingen möjlighet att se vilken turnering skärmen faktiskt visar.

Kod:

- `frontend/src/tv/TvApp.tsx:148-153` renderar topbaren.
- `frontend/public/app.css:1508-1559` använder fasta topbar-kolumner och nowrap/ellipsis.

Det här behöver en designad fallback: kortnamn, två rader med maxhöjd eller sekundär info som inte är beroende av ett 347 px fönster.

## 24. Admin-flikar blir en dold horisontell lista utan kant-/scrollsignal

Skärmdumpar:

- `.tmp/visual-review-screens/participants-320.png`
- `.tmp/visual-review-screens/bracket-390.png`
- `.tmp/visual-review-screens/schedule-390.png`

Turneringsflikarna är horisontellt scrollbara på mobil, men det syns inte. Aktiv flik kan hamna åt höger, delvis utanför den första vyn, och det finns ingen fade, pil eller tydlig scrollindikator.

Kod:

- `frontend/src/admin/AdminApp.tsx:787-795` renderar flikarna.
- `frontend/public/app.css:755-765` sätter `overflow-x: auto`.
- `frontend/public/app.css:2269-2275` minskar bara `min-width`, men behåller horisontell scroll.

Det här är ett visuellt navigationsproblem. En mobil användare ser inte att fler flikar finns eller varför sidan börjar med en halvt avklippt flikrad.

## 25. Flera inputs/selects visar avklippt innehåll utan affordance

Skärmdumpar:

- `.tmp/visual-review-screens/tv-admin-390.png`
- `.tmp/visual-review-screens/matches-details-open-390.png`
- `.tmp/visual-review-screens/score-dialog-390.png`

Långa värden i URL-inputs, selectfält och datetime/resource-editors kapas visuellt. I vissa fall är detta tekniskt standardbeteende, men här ligger fälten i redan trasiga layouts och saknar tooltip, title, expanderad valvy eller sammanfattning. Resultatet är att användaren ser ett halvt värde och ett fält som verkar felstorlekat.

Kod:

- `frontend/src/admin/AdminApp.tsx:542-575` för TV URL och bindningsformulär.
- `frontend/src/admin/AdminApp.tsx:1025-1032` för matchens tid/plats-editor.
- `frontend/src/admin/AdminApp.tsx:1178-1180` för poängdialogens inputs.
- `frontend/public/app.css:52-58` sätter alla inputs/selects till full bredd, men containrarna är inte säkra.

Formfält med långa systemvärden behöver en genomtänkt visuell strategi, inte bara default clipping.

## Snabb mätöversikt

Följande är inte separata fynd, utan bevis på att layouten faktiskt spricker:

- `tv-admin-390`: scrollbredd 1005 px på 390 px viewport.
- `participants-320`: scrollbredd 1926 px på 320 px viewport.
- `matches-1366`: scrollbredd 2338 px på 1366 px viewport.
- `schedule-1366`: scrollbredd 2338 px på 1366 px viewport.
- `score-dialog-390`: scrollbredd 1926 px på 390 px viewport.
- `moderator-login-390`: scrollbredd 969 px på 390 px viewport.
- `moderator-authorized-390`: scrollbredd 969 px på 390 px viewport.
- `tv-waiting-390`: scrollbredd 647 px på 390 px viewport.

Det återkommande temat är att användargenererad text saknar hårda layoutgränser. Fixen ska inte vara en global `overflow: hidden` som gömmer datan; varje vy behöver bestämma om text ska brytas, trunkeras, skalas ner eller visas i en dedikerad detaljyta.
