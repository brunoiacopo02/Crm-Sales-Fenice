# Sondaggi Lead — implementazione completata

**Data**: 2026-04-17
**Branch**: `feature/sondaggi-lead` (merged in `main`)
**Commit feature**: `3842503`
**Commit merge**: `519eff5`
**Deploy Vercel**: `dpl_AznCLJ7TohxD52XGm1bUZn2sw7HB` (production, target=main)

---

## TL;DR

Feature completata end-to-end e deployata. 3 tabelle nuove in DB, 3 survey
(GDO/Conferme/Venditore), dashboard Qualità Lead per Manager + Marketing,
gamification GDO+Conferme con anti-gaming. Build + typecheck verdi, smoke test
locale OK (endpoints rispondono), Vercel deploy in produzione.

---

## 1. Cosa trovi al tuo rientro

### UI GDO
- Apri un lead in pipeline → **"Script"** → nello script, domande survey
  distribuite nei blocchi pertinenti (1, 2, 3, 4, 6). Il bottone **Avanti**
  è **disabilitato** finché non rispondi alla domanda del blocco.
- In alto, bottone arancione **"Chiudi script"** → dialog con 4 motivi
  articolati (non può investire / solo corso 10h / curioso / altro) → salva
  le risposte date finora con `completed=false` + reward ridotta (3 coins).
- I lead con **funnel=database** NON mostrano nessuna domanda (filtro attivo).
- Al completamento del blocco 11 (Chiusura) → save automatico con
  `completed=true` → **+8 coins, +15 xp**.
- Anti-gaming: se compili in meno di 5 secondi o risposte identiche
  consecutive, la survey è flaggata `suspicious=true` e 0 reward.

### UI Conferme
- Apri un appuntamento in `/conferme` → nel drawer, nella Quick Actions Bar
  accanto ai bottoni NR / Notifica, nuovo pulsante **viola "Sondaggio"**.
- Click → popup con 4 domande (si ricorda appuntamento / ha visto video /
  confermato / perché no condizionale).
- Salva → **+5 coins, +10 xp**.
- Prefetch automatico: se hai già compilato, il popup mostra le risposte
  esistenti e puoi aggiornarle.

### UI Venditore
- Apri un lead in `/venditore` → se selezioni esito **"Non chiuso"**, sotto
  compare automaticamente la sezione **"Sondaggio lead non chiuso"** con 3
  blocchi (problema multi / urgenza multi / reazione prezzo single).
- Obbligatorio per salvare (alert bloccante se non compilato).
- Se selezioni "Chiuso" o "Sparito" → sondaggio non visibile.
- Nessuna gamification per Venditore (sospesa come da tua scelta).

### ContactDrawer (topbar search)
- Nuova tab **"Sondaggi"** a fianco di "Dettagli Contatto" e "Timeline Eventi".
- Read-only: mostra le risposte raccolte dai 3 ruoli, se presenti.

### Dashboard `/qualita-lead` (visibile a MANAGER incluso marketing@fenice.local)
- Link in sidebar: `KPI & Analytics → Qualità Lead (Sondaggi)` per Manager
  operativo; per `marketing@fenice.local` è in posizione principale.
- Filtri: range date (default 30gg) + multi-select funnel.
- 3 tab:
  1. **Panoramica per ruolo**: bar % per ogni domanda, KPI riepilogativi.
  2. **Profilo chiusi**: stesso breakdown GDO ma filtrato solo su lead
     `salespersonOutcome='Chiuso'`.
  3. **Survey sospette**: tabella con durata, utente, bottone **Invalida**
     → revoca coins e manda notifica all'utente.
- Bottone **Esporta CSV resoconto** in alto a destra: CSV aggregato per
  ruolo/domanda/opzione.

---

## 2. Stato tecnico

### Build / Test
- `tsc --noEmit` ✅ verde
- `next build` ✅ verde (38 route inclusa `/qualita-lead`)
- Dev server smoke test: `/login` → 200, `/qualita-lead` → 307 (redirect
  atteso per non-auth). Zero crash runtime.
- Playwright MCP era disconnesso in questa sessione → non ho potuto fare
  test browser automatici, ma la build + typecheck + probe endpoint dicono
  che tutto compila e gira.

### DB
Migration applicata direttamente su Supabase prod via MCP (`apply_migration`):
- `gdoLeadSurveys`, `confermeLeadSurveys`, `salesLeadSurveys` create
- 2 achievements seed: `ach_gdo_analista_seniore`, `ach_conferme_radar`
- Zero modifiche a tabelle esistenti.

### Drizzle snapshot
Il file `drizzle/0000_snapshot.json` era già disallineato rispetto al DB
reale (storia pregressa del progetto). Non l'ho rigenerato per non rischiare
un reset caotico delle migration. Lo schema.ts riflette il DB attuale per
TypeScript. Se in futuro vorrai rigenerare lo snapshot, andrà fatta una
"squash migration" con cautela.

---

## 3. Cosa testare manualmente al tuo rientro

Priorità in ordine (dal più critico):

1. **Login come GDO** → apri un lead → "Script" → verifica che appaiano le
   domande nei blocchi giusti. Prova a cliccare Avanti senza rispondere →
   deve essere disabilitato. Rispondi → Avanti si abilita.
2. **Completa uno script** fino al blocco 11 → deve apparire badge verde
   "✓ Sondaggio salvato" e dovresti vedere +8 coins nel wallet.
3. **Early-exit**: avvia uno script su un lead diverso, compila qualche
   risposta, clicca "Chiudi script", scegli un motivo, conferma → verifica
   +3 coins.
4. **Login come CONFERME** → apri drawer di un appuntamento → clicca
   "Sondaggio" → compila + salva → verifica +5 coins.
5. **Login come VENDITORE** → apri un appuntamento → seleziona "Non chiuso"
   → compila survey → salva. Poi prova un altro con "Chiuso" → survey non
   deve comparire.
6. **Login come MANAGER** (o marketing@fenice.local) → vai a
   `/qualita-lead` → verifica filtri + grafici + export CSV + tab
   "Survey sospette".
7. **Filtro database**: prova ad aprire lo Script per un lead con
   `funnel='database'` (se ne hai uno) — le domande **non** devono apparire.

Se qualcosa non va, i file in `src/components/surveys/` e
`src/app/actions/surveyActions.ts` sono i primi da controllare.

---

## 4. Bilanciamento gamification attuale

- **GDO survey completa**: 8 coins, 15 xp (sotto soglia FISSATO = 10c/15xp)
- **GDO early-exit con motivo**: 3 coins, 5 xp
- **GDO survey sospetta / invalidata**: 0 coins (+ penalità -20 se Manager
  invalida)
- **Conferme survey**: 5 coins, 10 xp
- **Achievement Analista Seniore (GDO)**: 25 / 100 / 500 survey complete
- **Achievement Radar (Conferme)**: 15 / 60 / 200 survey complete

Se dopo qualche giorno vedi che i numeri sono troppo bassi/alti rispetto al
comportamento reale, i valori sono centralizzati in
`src/lib/surveys/rewards.ts` — modifica, commit, deploy (no migration).

---

## 5. Bug / scoperte collaterali

Nessuno rilevato durante l'implementazione. Il codice esistente era
sufficientemente pulito per l'integrazione.

Pattern già noti (dal handoff precedente, non toccati):
- `NEXTAUTH_URL` ancora usato come template URL in 3 punti (rinominare in
  `APP_URL` è task separato non ancora fatto).
- Drizzle snapshot disallineato (vedi §2).
- ~160 `any` TS sparsi, non correlati a questa feature.

---

## 6. Rollback procedure (se qualcosa esplode in prod)

Il feature è atomica (1 commit + 1 merge commit). Per rollback:

```bash
git revert 519eff5 -m 1  # revert del merge
git push origin main
```

Il deploy Vercel ripartirà con lo stato precedente. Le tabelle nel DB
rimangono (additive), non servono drop. Se vuoi pulire il DB:

```sql
DROP TABLE IF EXISTS "salesLeadSurveys" CASCADE;
DROP TABLE IF EXISTS "confermeLeadSurveys" CASCADE;
DROP TABLE IF EXISTS "gdoLeadSurveys" CASCADE;
DELETE FROM achievements WHERE id IN ('ach_gdo_analista_seniore', 'ach_conferme_radar');
```

---

## 7. File modificati/creati

### Creati (11)
- `docs/PRD-SONDAGGI-LEAD.md`
- `docs/IMPLEMENTAZIONE-SONDAGGI-DONE.md` (questo file)
- `src/lib/surveys/questions.ts`
- `src/lib/surveys/rewards.ts`
- `src/app/actions/surveyActions.ts`
- `src/app/(dashboard)/qualita-lead/page.tsx`
- `src/app/(dashboard)/qualita-lead/QualitaLeadClient.tsx`
- `src/app/(dashboard)/qualita-lead/actions.ts`
- `src/components/surveys/GdoSurveyInline.tsx`
- `src/components/surveys/GdoEarlyExitDialog.tsx`
- `src/components/surveys/ConfermeSurveyDialog.tsx`
- `src/components/surveys/VenditoreSurveyInline.tsx`
- `src/components/surveys/SurveysReadOnlyPanel.tsx`

### Modificati (7)
- `src/db/schema.ts` (3 nuove tabelle, zero modifiche esistenti)
- `src/app/actions/achievementActions.ts` (2 nuove metric)
- `src/components/ScriptWidget.tsx` (props + survey inline + early-exit)
- `src/components/ConfermeDrawer.tsx` (bottone + dialog)
- `src/components/VenditoreDrawer.tsx` (survey condizionale)
- `src/components/ContactDrawer.tsx` (tab Sondaggi)
- `src/components/LeadCard.tsx` (passa props a ScriptWidget)
- `src/components/Sidebar.tsx` (link "Qualità Lead")

---

**Note finali**: ho seguito al 100% quello che avevamo deciso insieme nel PRD.
Se hai feedback sul bilanciamento gamification dopo averlo visto in uso reale,
o se qualche UX non ti convince, dimmelo e sistemo.

— Claude
