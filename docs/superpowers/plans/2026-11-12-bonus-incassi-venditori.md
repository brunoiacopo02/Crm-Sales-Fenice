# Bonus incassi del mese — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ogni venditore vede in `/miei-incassi` a che punto è col bonus sugli incassi dello stesso mese; manager e admin vedono la stessa lettura per tutti in `/performance-venditori`.

**Architecture:** Una funzione pura (`src/lib/gestionale/bonusIncassi.ts`) testata con `node:test`; una lettura Drizzle (`bonusIncassiDb.ts`) che carica contratti del mese e i loro incassi; una card server component e una tabella client che chiamano la stessa funzione.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, Tailwind, `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-12-bonus-incassi-venditori-design.md`

## Global Constraints

- Solo visualizzazione: `obiettivi.ts`, `obiettiviDb.ts`, `metrics.ts` e gli importi del guadagno NON si toccano.
- Solo Drizzle, nessuna scrittura sul database, nessuna migration.
- Date del gestionale = stringhe `YYYY-MM-DD`; il mese è il prefisso `YYYY-MM`. Il mese corrente è quello di Roma (`currentYearMonthRome`).
- Soglie in un'unica costante con decorrenza: `2026-10` → 85/90; `2026-11` → 80/85/90.
- Stand-by e cancellati fuori dai firmati.
- Testi: «Firmato», «Incassato», mai «fatturato». Mai `<button>` dentro `<span>`/`<p>`.
- Il nuovo `*.test.ts` va in coda allo script `"test"` di `package.json`.

## Review Focus

1. Contratto finanziato (incassi < importo, stato `Pagato`, saldo nel mese) → pagato nel mese.
2. Contratto `Pagato` col saldo datato il mese dopo → NON pagato nel mese, compare nell'elenco con «saldato il …».
3. Soglia esatta (8 su 10 a novembre) → scaglione preso; 0 firmati → nessuna percentuale, nessuna divisione per zero.
4. Ottobre usa 85/90, novembre 80/85/90, settembre nessuno scaglione.
5. Il venditore vede solo i suoi (utente dalla sessione); l'azione dei manager verifica il ruolo sul DB.

---

### Task 1: Funzione pura e test

**Files:** Create `src/lib/gestionale/bonusIncassi.ts`, `src/lib/gestionale/bonusIncassi.test.ts`; Modify `package.json`.

**Interfaces:** `regolaBonusIncassi(mese)`, `calcolaBonusIncassi(mese, contratti, incassi): BonusIncassi`.

- [ ] Scrivi i test (casi del Review Focus + storni, stand-by, percentuale in euro, mancano).
- [ ] Verifica che falliscano (`node --import tsx --test src/lib/gestionale/bonusIncassi.test.ts`).
- [ ] Implementa fino al verde; registra il file nello script `test`.

### Task 2: Lettura dal database

**Files:** Create `src/lib/gestionale/bonusIncassiDb.ts`.

**Interfaces:** `loadBonusIncassiMese(mese, { soloUserId?, companyFilter? }): Promise<BonusIncassiVenditore[]>`.

- [ ] Contratti con `dataFirma` nel mese, non cancellati, con `salesUserId`; incassi non cancellati di quei contratti (a blocchi di 500).
- [ ] Venditori da `users` (ruolo VENDITORE), nome con `personName`; una riga per venditore attivo o con contratti nel mese.

### Task 3: Card del venditore

**Files:** Create `src/components/gestionale/BonusIncassiCard.tsx`; Modify `src/app/(dashboard)/miei-incassi/page.tsx`.

- [ ] Card con percentuale, barra con soglie, frase, elenco dei contratti da saldare.
- [ ] Nella pagina: caricata con `soloUserId = user.id`, sotto la card del guadagno.

### Task 4: Tabella manager/admin

**Files:** Modify `src/app/actions/obiettiviVenditoriActions.ts` (`getBonusIncassiVenditori`), `src/components/venditore-performance/CommissioniVenditoriTab.tsx`; Create `src/components/venditore-performance/BonusIncassiVenditoriTable.tsx`.

- [ ] Azione protetta da `requireManager`, tabella sotto quella delle commissioni, stesso mese.

### Task 5: Testo `/bonus` e verifiche

- [ ] `/bonus`: una riga, soglie di novembre.
- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint <file toccati>`, `npm run build`.
- [ ] Numeri veri di ottobre e novembre dalla funzione, confrontati con una query SQL indipendente.
- [ ] Commit.
