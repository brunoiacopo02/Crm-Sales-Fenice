# Ralph Agent Instructions — CRM Fenice

Sei un agente di coding autonomo che lavora sul progetto CRM Fenice.

## Contesto Progetto

CRM Fenice e' un CRM proprietario di Fenice Academy costruito con Next.js (App Router), Tailwind CSS v4, Supabase (PostgreSQL), Drizzle ORM. Leggi il CLAUDE.md nella root del progetto per tutte le regole di codifica e l'architettura del database.

## Il Tuo Compito

1. Leggi il PRD in `scripts/ralph/prd.json`
2. Leggi il progress log in `scripts/ralph/progress.txt` (controlla la sezione Codebase Patterns prima)
3. Verifica di essere sul branch corretto dal campo `branchName` del PRD. Se no, crealo da main.
4. Scegli la **user story con priorita' piu' alta** dove `passes: false`
5. Implementa quella singola user story
6. Esegui i quality check: `npx next build` (deve compilare senza errori)
7. Se i check passano, committa TUTTI i cambiamenti con messaggio: `feat: [Story ID] - [Story Title]`
8. Aggiorna il PRD per settare `passes: true` per la story completata
9. Aggiungi il tuo progresso a `scripts/ralph/progress.txt`
10. Se TUTTE le stories sono `passes: true`, esegui il deploy finale (vedi sezione Deploy)

## PROTEZIONE DATI REALI — CRITICO

Il database contiene lead e appuntamenti REALI in produzione. Devi rispettare queste regole ASSOLUTE:

- **MAI** eseguire DELETE, TRUNCATE o UPDATE distruttivi sulla tabella `leads`
- **MAI** modificare lead esistenti del GDO 114 o di qualsiasi altro GDO
- **MAI** alterare appuntamenti reali gia' fissati nelle Conferme
- **MAI** sovrascrivere `assignedToId` di lead esistenti
- **MAI** droppare colonne o tabelle esistenti — usa solo ADD COLUMN per migrazioni
- Per testare nuove feature, usa dati di test separati o logica condizionale
- Le migrazioni schema devono essere ADDITIVE (aggiungere, mai rimuovere)
- Se devi seedare dati, crea NUOVI record, non modificare quelli esistenti

## MIGRAZIONI DATABASE — OBBLIGATORIO

Quando aggiungi colonne o tabelle al database, DEVI eseguire la migrazione IMMEDIATAMENTE sul DB di produzione. NON limitarti a creare API route di migrazione — le devi anche eseguire.

Procedura obbligatoria per ogni migrazione:
1. Aggiungi la colonna/tabella in `src/db/schema.ts`
2. Crea un API route in `src/app/api/migrate-<nome>/route.ts` con SQL `IF NOT EXISTS`
3. DOPO il commit e push, chiama la route per eseguirla: `curl -s https://crm-sales-fenice.vercel.app/api/migrate-<nome>`
4. Se la route e' protetta dal middleware (ritorna 307), aggiungi temporaneamente un bypass nel middleware per `/api/migrate-`, esegui la migrazione, poi rimuovi il bypass
5. Verifica che la colonna/tabella esista usando curl sulla REST API Supabase: `curl -s "https://ncutwzsifzundikwllxp.supabase.co/rest/v1/<tabella>?select=<colonna>&limit=1"` con header apikey/Authorization dal file .env

**Se salti questo step, il CRM va in WSOD (White Screen of Death) perche' Drizzle cerca colonne che non esistono nel DB.**

## Regole Critiche CRM Fenice

- **Hydration**: I bottoni interattivi NON possono mai essere child di `<span>` o `<p>`. Usa sempre `<div>`.
- **Timezone**: Tutte le date in timezone `Europe/Rome`. Usare `toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })` per date stringa.
- **ORM**: Usa SOLO Drizzle ORM via `src/db/schema.ts`. Mai query SQL raw.
- **Realtime**: NON alterare i channel Supabase `postgres_changes`.
- **Server Actions**: Posizionati in `src/app/actions/`. Chiamare `router.refresh()` nei componenti client dopo le mutazioni.
- **Optimistic Locking**: Ogni UPDATE su leads DEVE includere `eq(leads.version, lead.version)` nel WHERE e incrementare version.
- **Styling**: Tailwind CSS v4 con custom theme in `src/app/globals.css`. Colori brand: `brand-orange` (#FFBE82), `brand-charcoal` (#272626).

## Tool MCP Disponibili — USALI

Hai accesso a server MCP potenti. Usali attivamente:

### Stitch (Google AI Design)
- Usa Stitch per generare design UI da prompt testuali prima di implementare componenti visivi
- Chiedi design in modalita' Pro (Gemini Pro) per massima qualita'
- Scarica il codice HTML/CSS generato e convertilo in Tailwind/React
- Utile per: redesign dashboard, componenti, layout, design system

### Playwright (Browser Testing)
- Per OGNI story che modifica UI, verifica nel browser che funzioni
- Naviga alla pagina, fai screenshot, verifica il rendering
- Verifica assenza errori console
- Utile per: test visivo, hydration check, responsive check

### Supabase
- Usa per verificare lo stato delle tabelle dopo migrazioni
- Controlla che i dati reali non siano stati alterati
- Utile per: query di verifica, check integrità dati

### Vercel
- Dopo il deploy, verifica che il build sia READY
- Controlla i build logs se fallisce
- Utile per: deploy verification

### Context7
- Consulta documentazione aggiornata di Next.js, Tailwind, React
- Utile per: API reference, pattern moderni, best practice

## Skill Disponibili — USALE

Hai accesso a skill specializzate. Invocale quando pertinenti:

- **gamification-loops**: Best practice per engagement, streak, badge, reward variabili. Usala per TUTTE le story di gamification.
- **ui-design-system**: Pattern componenti con TailwindCSS + Radix. Usala per redesign componenti.
- **tailwindcss**: Reference Tailwind per styling. Usala per classi e pattern Tailwind.
- **react-performance**: Ottimizzazione rendering React/Next.js. Usala per performance.
- **supabase-backend-platform**: Pattern Supabase. Usala per query e auth.

## Formato Progress Report

APPENDI a scripts/ralph/progress.txt (mai sovrascrivere, sempre appendere):
```
## [Data/Ora] - [Story ID]
- Cosa e' stato implementato
- File modificati
- **Learnings per iterazioni future:**
  - Pattern scoperti
  - Gotcha incontrati
  - Contesto utile
---
```

## Consolida Pattern

Se scopri un **pattern riusabile**, aggiungilo alla sezione `## Codebase Patterns` in CIMA a progress.txt.

## Quality Requirements

- TUTTI i commit devono passare `npx next build` senza errori
- NON committare codice rotto
- Cambiamenti focalizzati e minimali
- Segui i pattern di codice esistenti
- Rispetta le regole in CLAUDE.md (root del progetto)
- Per story UI: verifica con Playwright che il rendering sia corretto

## Deploy Finale

**IN QUESTA RUN NON FARE DEPLOY.** Lavora solo in locale sul branch. NON pushare, NON mergiare in main.

Quando TUTTE le stories hanno `passes: true`, rispondi semplicemente con:
<promise>COMPLETE</promise>

## Stop Condition

Dopo aver completato una user story, controlla se TUTTE le stories hanno `passes: true`.

Se ci sono ancora stories con `passes: false`, termina normalmente (un'altra iterazione prendera' la prossima story).

Se TUTTE sono complete, esegui il Deploy Finale e poi rispondi con COMPLETE.

## Importante

- Lavora su UNA story per iterazione
- Committa frequentemente
- Mantieni la build verde
- Leggi la sezione Codebase Patterns in progress.txt prima di iniziare
- USA i tool MCP e le skill quando pertinenti
- NON toccare i dati reali nel database
