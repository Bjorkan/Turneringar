# Todo

## Nuvarande MVP

- [x] Skapa FastAPI-projekt med SQLite-migrationer.
- [x] Hantera flera turneringar.
- [x] Registrera lag/spelare.
- [x] Registrera spelplaner, servrar och bord som resurser.
- [x] Generera gruppspel och single-elimination-slutspel.
- [x] Autoschemalägga matcher på resurser utan deltagar- eller resurskrockar.
- [x] Stödja manuell matchflytt med konfliktvalidering.
- [x] Skapa PIN-baserade moderatorlänkar.
- [x] Uppdatera resultat och propagera vinnare i slutspel.
- [x] Visa Live TV med roterande slides.
- [x] Skapa instansnivåbaserade Live TV-länkar med 10-teckenskod och live-bindning mot turnering/resurs.
- [x] Publicera schema- och resultatändringar via SSE.
- [x] Separera backend och frontend.
- [x] Låt frontend kommunicera med backend via JSON API och SSE.
- [x] Förbereda repo för GitHub med ignore-regler, env-exempel och CI.

## Nästa milstolpe

- [x] Anpassa admin- och TV-UI efter inspirationsbilderna i `inspiration/`.
- [x] Lägg till Dockerfile, compose-exempel och GHCR-publicerande GitHub Actions-workflow.
- [x] Flytta frontendkod till TypeScript med bygg- och typechecksteg.
- [ ] Lägg till redigering och borttagning av deltagare/resurser.
- [x] Lägg till API-integrationstester för admin-, moderator- och TV-flöden.
- [x] Lägg till frontendtester som kör riktiga klickflöden i browser.
- [x] Lägg till tydligare adminnavigation per flik.
- [x] Flytta Live TV-hantering till en egen global adminsida.
- [ ] Skapa import/export för deltagare via CSV.
- [ ] Hantera BYE automatiskt i slutspel.
- [ ] Gör Live TV-teman konfigurerbara.
- [ ] Lägg till publik turneringssida utan adminfunktioner.
- [ ] Spara auditlogg med moderatornamn per resultatuppdatering.
- [x] Lägg till Dockerfile för eventserver.

## Senare

- [ ] Swiss-format.
- [ ] Dubbel-eliminering.
- [ ] Mer avancerad optimeringsmotor för schemaläggning.
- [ ] Full användarinloggning med roller.
- [ ] Molndrift med HTTPS och backup.
