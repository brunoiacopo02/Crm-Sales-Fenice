# Riconciliazione CRM ↔ Database Clienti — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un pulsante admin che confronta il fatturato del CRM con il foglio "Database Clienti", mostra le differenze divise per famiglia, e applica solo quelle che l'admin spunta — con storico annullabile.

**Architecture:** Due funzioni pure (normalizzazione delle righe del foglio, motore di matching) senza db né rete, testabili sui casi storici reali; sopra di esse un client Google Sheets, tre server action (confronta / applica / annulla) e una pagina admin. Le scritture passano da `resolveAttemptWrite` per non reintrodurre il doppio conteggio del fatturato.

**Tech Stack:** Next.js App Router, Drizzle ORM su Supabase Postgres, `googleapis` (già dipendenza), test con `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-08-29-riconciliazione-database-clienti-design.md`

## Global Constraints

- **Foglio:** `1viEdIATN2bcJg9JW4OTzcM51d45j4ROCrtF7wgdEg5k`, range `Database Clienti!A:K`. Colonne: A=cf, B=MAIL, C=NUM, D=NOME, E=COGNOME, F=FIRMA CONTRATTO, G=Stato di Pagamento, H=Valori contratti, I=Entrate, J=ancora da saldare, K=TUTOR.
- **Il tab è un `IMPORTRANGE`**: su `#REF!` o zero righe il motore alza `SheetUnavailableError` e non propone NULLA. Mai interpretare un foglio vuoto come "il CRM ha contratti di troppo".
- **Unico stato escluso: `Stand-by`.** `Pagato`, `Pagamento programmato`, `Recupero`, `Avvocato`, `Sollecito` contano tutti.
- **Solo `companyId = 'fenice'`.** Il foglio non contiene Serenamente.
- **Mappatura TUTOR → codice venditore** (confermata dal PO il 2026-08-29), la colonna K contiene nomi: `Bruno B.`→`Sales 001`, `Marco L.`→`Sales 002`, `Mattia G.`→`Sales 003`, `Paolo S.`→`Sales 004`, `Giacomo O.`→`Sales 008`, `Stefania C.`→`Sales 010`. Ogni altro valore (`Matteo D.`, `Matteo Q.`, `Amministrazione`, `Altro`, `Alberto C.`) è **non mappato**: la riga si mostra ma non si applica.
- **Formati del foglio:** date `dd/mm/yyyy`; importi `€ 1.390` / `€ 2.079,50` (punto = migliaia, virgola = decimali).
- **Le scritture su `salesAttempts` passano sempre da `resolveAttemptWrite`** (`src/lib/venditorePerformance/guard.ts`).
- **Nessuna presenza inventata:** sui lead scartati e sui lead creati si scrive solo la chiusura. `presentedAt` non viene mai valorizzato dalla riconciliazione.
- **Migrazioni a mano**: `drizzle-kit generate` non è utilizzabile su questo progetto. Il file `.sql` si scrive a mano e si applica con `mcp__supabase__apply_migration`; le tabelle si aggiungono a mano anche in `src/db/schema.ts`.
- **Ogni nuovo file di test va aggiunto allo script `test` in `package.json`**, altrimenti non viene eseguito da nessuno.
- **Scostamento dalla spec:** la riserva manuale è un **CSV** (esportazione del singolo tab da Google), non un XLSX: evita di aggiungere una dipendenza di parsing e riusa lo stesso normalizzatore.

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `src/lib/riconciliazione/sheetRows.ts` | Puro. Righe grezze del foglio → contratti normalizzati e aggregati. Nessun I/O. |
| `src/lib/riconciliazione/sheetRows.test.ts` | Test del normalizzatore. |
| `src/lib/riconciliazione/match.ts` | Puro. Contratti del foglio + chiusure del CRM → differenze divise in famiglie. Nessun I/O. |
| `src/lib/riconciliazione/match.test.ts` | Test del motore, sui casi storici reali. |
| `src/lib/riconciliazione/sheetsClient.ts` | I/O Google Sheets: autenticazione service account e lettura del range. |
| `src/app/actions/riconciliazioneActions.ts` | Server action: confronta, applica, annulla, confronta-da-CSV. |
| `src/app/(dashboard)/riconciliazione/page.tsx` | Gate ADMIN + montaggio. |
| `src/app/(dashboard)/riconciliazione/RiconciliazioneClient.tsx` | UI: mese, anteprima per famiglia, spunte, applica, storico. |
| `drizzle/migrations/0032_riconciliazione_runs.sql` | Tabelle di storico. |
| `src/db/schema.ts` | Definizioni Drizzle delle due tabelle nuove. |

---

### Task 1: Normalizzatore delle righe del foglio

**Files:**
- Create: `src/lib/riconciliazione/sheetRows.ts`
- Test: `src/lib/riconciliazione/sheetRows.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `normalizePhoneStrict` da `src/lib/phoneNormalize.ts`.
- Produces:
  ```ts
  export class SheetUnavailableError extends Error {}
  export type SheetContract = {
      key: string;              // `${phone ?? email ?? 'riga:'+rowNumbers[0]}|${monthKey}`
      phone: string | null;     // normalizzato, es. '+393663515565'
      email: string | null;     // lowercase, trim
      fullName: string;         // 'NOME COGNOME'
      signedAt: Date;
      monthKey: string;         // 'YYYY-MM'
      amountEur: number;
      paymentStatuses: string[];
      tutor: string;            // grezzo dal foglio
      salesCode: string | null; // 'Sales 004' oppure null se non mappato
      sourceRows: number[];     // numeri di riga del foglio (1-based, header incluso)
  };
  export function parseAmount(raw: string | undefined | null): number;
  export function parseSheetDate(raw: string | undefined | null): Date | null;
  export function tutorToSalesCode(tutor: string | undefined | null): string | null;
  export function parseSheetRows(values: string[][], monthKey: string): SheetContract[];
  ```

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `src/lib/riconciliazione/sheetRows.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseAmount,
    parseSheetDate,
    tutorToSalesCode,
    parseSheetRows,
    SheetUnavailableError,
} from './sheetRows';

const HEADER = ['cf', 'MAIL', 'NUM', 'NOME', 'COGNOME', 'FIRMA CONTRATTO', 'Stato di Pagamento', 'Valori contratti', 'Entrate', 'ANCORA DA SALDARE', 'TUTOR'];

function row(over: Partial<Record<'mail' | 'num' | 'nome' | 'cognome' | 'data' | 'stato' | 'importo' | 'tutor', string>> = {}): string[] {
    return [
        '',
        over.mail ?? 'mario.rossi@example.com',
        over.num ?? '3663515565',
        over.nome ?? 'Mario',
        over.cognome ?? 'Rossi',
        over.data ?? '01/08/2026',
        over.stato ?? 'Pagamento programmato',
        over.importo ?? '€ 1.390',
        '', '',
        over.tutor ?? 'Paolo S.',
    ];
}

test('parseAmount legge il formato italiano del foglio', () => {
    assert.equal(parseAmount('€ 1.390'), 1390);
    assert.equal(parseAmount('€ 2.079,50'), 2079.5);
    assert.equal(parseAmount('€ 300'), 300);
    assert.equal(parseAmount(''), 0);
    assert.equal(parseAmount(null), 0);
});

test('parseSheetDate legge dd/mm/yyyy e rifiuta il resto', () => {
    const d = parseSheetDate('01/08/2026');
    assert.ok(d);
    assert.equal(d!.getUTCFullYear(), 2026);
    assert.equal(d!.getUTCMonth(), 7);
    assert.equal(d!.getUTCDate(), 1);
    assert.equal(parseSheetDate('2026-08-01'), null);
    assert.equal(parseSheetDate(''), null);
});

test('tutorToSalesCode mappa i sei venditori noti e solo quelli', () => {
    assert.equal(tutorToSalesCode('Paolo S.'), 'Sales 004');
    assert.equal(tutorToSalesCode('Giacomo O.'), 'Sales 008');
    assert.equal(tutorToSalesCode('Bruno B.'), 'Sales 001');
    assert.equal(tutorToSalesCode('Matteo D.'), null);
    assert.equal(tutorToSalesCode('Amministrazione'), null);
    assert.equal(tutorToSalesCode(''), null);
});

test('tiene solo il mese richiesto', () => {
    const out = parseSheetRows([HEADER, row({ data: '01/08/2026' }), row({ data: '15/07/2026', num: '3331112222' })], '2026-08');
    assert.equal(out.length, 1);
    assert.equal(out[0].monthKey, '2026-08');
});

test('esclude Stand-by e tiene tutti gli altri stati', () => {
    const rows = [
        HEADER,
        row({ stato: 'Stand-by', num: '3331110001' }),
        row({ stato: 'Recupero', num: '3331110002' }),
        row({ stato: 'Avvocato', num: '3331110003' }),
        row({ stato: 'Sollecito', num: '3331110004' }),
        row({ stato: 'Pagato', num: '3331110005' }),
    ];
    const out = parseSheetRows(rows, '2026-08');
    assert.equal(out.length, 4);
    assert.ok(!out.some(c => c.paymentStatuses.includes('Stand-by')));
});

test('somma due righe dello stesso cliente nello stesso mese (caso Dell Aglio)', () => {
    const rows = [
        HEADER,
        row({ importo: '€ 800', num: '3401234567' }),
        row({ importo: '€ 729', num: '3401234567', data: '20/08/2026' }),
    ];
    const out = parseSheetRows(rows, '2026-08');
    assert.equal(out.length, 1);
    assert.equal(out[0].amountEur, 1529);
    assert.deepEqual(out[0].sourceRows, [2, 3]);
});

test('due contratti dello stesso cliente in mesi diversi NON si sommano (rifirme)', () => {
    const rows = [HEADER, row({ importo: '€ 800' }), row({ importo: '€ 729', data: '10/07/2026' })];
    assert.equal(parseSheetRows(rows, '2026-08')[0].amountEur, 800);
    assert.equal(parseSheetRows(rows, '2026-07')[0].amountEur, 729);
});

test('normalizza telefono e mail', () => {
    const out = parseSheetRows([HEADER, row({ num: '+39 366 3515565', mail: '  Mario.Rossi@Example.com ' })], '2026-08');
    assert.equal(out[0].phone, '+393663515565');
    assert.equal(out[0].email, 'mario.rossi@example.com');
});

test('un tutor non mappato non fa fallire la lettura, lascia salesCode null', () => {
    const out = parseSheetRows([HEADER, row({ tutor: 'Matteo D.' })], '2026-08');
    assert.equal(out[0].salesCode, null);
    assert.equal(out[0].tutor, 'Matteo D.');
});

test('un foglio con #REF! alza SheetUnavailableError', () => {
    assert.throws(() => parseSheetRows([['#REF!']], '2026-08'), SheetUnavailableError);
});

test('un foglio vuoto o senza righe dati alza SheetUnavailableError', () => {
    assert.throws(() => parseSheetRows([], '2026-08'), SheetUnavailableError);
    assert.throws(() => parseSheetRows([HEADER], '2026-08'), SheetUnavailableError);
});

test('un mese senza contratti restituisce lista vuota, non un errore', () => {
    const out = parseSheetRows([HEADER, row({ data: '01/08/2026' })], '2026-01');
    assert.deepEqual(out, []);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npx tsx --test src/lib/riconciliazione/sheetRows.test.ts`
Expected: FAIL — `Cannot find module './sheetRows'`

- [ ] **Step 3: Scrivi l'implementazione minima**

Crea `src/lib/riconciliazione/sheetRows.ts`:

```ts
import { normalizePhoneStrict } from '@/lib/phoneNormalize';

/**
 * Il tab "Database Clienti" è un IMPORTRANGE: se il collegamento si rompe le
 * celle diventano #REF! e il foglio SEMBRA VUOTO. Interpretare quel vuoto come
 * "il CRM ha contratti di troppo" porterebbe a proporre la cancellazione di un
 * mese intero di fatturato. Da qui in poi, vuoto = errore, mai dato.
 */
export class SheetUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SheetUnavailableError';
    }
}

export type SheetContract = {
    key: string;
    phone: string | null;
    email: string | null;
    fullName: string;
    signedAt: Date;
    monthKey: string;
    amountEur: number;
    paymentStatuses: string[];
    tutor: string;
    salesCode: string | null;
    sourceRows: number[];
};

const EXCLUDED_STATUS = 'stand-by';

// La colonna TUTOR contiene NOMI, non codici. Mappatura confermata dal PO il 2026-08-29.
const TUTOR_TO_SALES: Record<string, string> = {
    'bruno b.': 'Sales 001',
    'marco l.': 'Sales 002',
    'mattia g.': 'Sales 003',
    'paolo s.': 'Sales 004',
    'giacomo o.': 'Sales 008',
    'stefania c.': 'Sales 010',
};

export function parseAmount(raw: string | undefined | null): number {
    if (!raw) return 0;
    const cleaned = String(raw)
        .replace(/[^\d,.-]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
}

export function parseSheetDate(raw: string | undefined | null): Date | null {
    if (!raw) return null;
    const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const [, d, mo, y] = m;
    // Mezzogiorno UTC: la data del contratto è un giorno di calendario, non un
    // istante. Mezzanotte scivolerebbe di giorno con il fuso italiano.
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0));
    if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
    return date;
}

export function tutorToSalesCode(tutor: string | undefined | null): string | null {
    if (!tutor) return null;
    return TUTOR_TO_SALES[tutor.trim().toLowerCase()] ?? null;
}

function monthKeyOf(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function parseSheetRows(values: string[][], monthKey: string): SheetContract[] {
    const dataRows = values.slice(1);
    if (dataRows.length === 0) {
        throw new SheetUnavailableError('Il foglio non contiene righe: collegamento IMPORTRANGE rotto o range sbagliato.');
    }
    if (values.some(r => r.some(cell => typeof cell === 'string' && cell.includes('#REF!')))) {
        throw new SheetUnavailableError('Il foglio contiene #REF!: il collegamento IMPORTRANGE è rotto.');
    }

    const byKey = new Map<string, SheetContract>();

    dataRows.forEach((r, i) => {
        const rowNumber = i + 2; // 1-based, header incluso
        const status = (r[6] ?? '').trim();
        if (status.toLowerCase() === EXCLUDED_STATUS) return;

        const signedAt = parseSheetDate(r[5]);
        if (!signedAt) return;
        if (monthKeyOf(signedAt) !== monthKey) return;

        const phone = normalizePhoneStrict(r[2] ?? null);
        const email = (r[1] ?? '').trim().toLowerCase() || null;
        const key = `${phone ?? email ?? `riga:${rowNumber}`}|${monthKey}`;

        const existing = byKey.get(key);
        if (existing) {
            // Un contratto spezzato su più righe dello stesso mese è UN contratto.
            existing.amountEur += parseAmount(r[7]);
            existing.sourceRows.push(rowNumber);
            if (status && !existing.paymentStatuses.includes(status)) existing.paymentStatuses.push(status);
            return;
        }

        const tutor = (r[10] ?? '').trim();
        byKey.set(key, {
            key,
            phone,
            email,
            fullName: `${(r[3] ?? '').trim()} ${(r[4] ?? '').trim()}`.trim(),
            signedAt,
            monthKey,
            amountEur: parseAmount(r[7]),
            paymentStatuses: status ? [status] : [],
            tutor,
            salesCode: tutorToSalesCode(tutor),
            sourceRows: [rowNumber],
        });
    });

    return [...byKey.values()];
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npx tsx --test src/lib/riconciliazione/sheetRows.test.ts`
Expected: PASS, 12 test

- [ ] **Step 5: Registra il test nello script `test`**

In `package.json`, aggiungi `src/lib/riconciliazione/sheetRows.test.ts` in coda alla lista di file dello script `test`.
Run: `npm test`
Expected: PASS, la suite completa gira senza regressioni.

- [ ] **Step 6: Commit**

```bash
git add src/lib/riconciliazione/sheetRows.ts src/lib/riconciliazione/sheetRows.test.ts package.json
git commit -m "feat(riconciliazione): normalizzatore delle righe del Database Clienti"
```

---

### Task 2: Motore di matching

**Files:**
- Create: `src/lib/riconciliazione/match.ts`
- Test: `src/lib/riconciliazione/match.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `SheetContract` da `./sheetRows`.
- Produces:
  ```ts
  export type Family = 'esito-mancante' | 'lead-scartato' | 'lead-assente' | 'importo' | 'solo-crm';
  export type CrmClosure = {
      leadId: string;
      phone: string | null;          // già normalizzato dal chiamante
      email: string | null;          // già lowercase dal chiamante
      fullName: string;
      funnel: string | null;
      outcome: string | null;        // leads.salespersonOutcome
      outcomeAt: Date | null;        // leads.salespersonOutcomeAt
      amountEur: number | null;      // leads.closeAmountEur
      attemptsAmountEur: number;     // somma dei salesAttempts 'Chiuso' del mese
      isRejected: boolean;
      salespersonAssigned: string | null;
  };
  export type DiffEntry = {
      key: string;                   // stabile: usato dalle spunte della UI
      family: Family;
      sheet: SheetContract | null;
      crm: CrmClosure | null;
      appliable: boolean;            // false se manca la mappatura del tutor
      blockedReason: string | null;
      note: string | null;           // es. 'arrotondamento del foglio'
      deltaEur: number;              // foglio - crm
  };
  export const ROUNDING_TOLERANCE_EUR = 2;
  export function reconcile(sheet: SheetContract[], crm: CrmClosure[]): DiffEntry[];
  ```

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `src/lib/riconciliazione/match.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, type CrmClosure } from './match';
import type { SheetContract } from './sheetRows';

function sheet(over: Partial<SheetContract> = {}): SheetContract {
    return {
        key: over.phone ? `${over.phone}|2026-08` : '+393663515565|2026-08',
        phone: '+393663515565',
        email: 'mario.rossi@example.com',
        fullName: 'Mario Rossi',
        signedAt: new Date(Date.UTC(2026, 7, 1, 12)),
        monthKey: '2026-08',
        amountEur: 1390,
        paymentStatuses: ['Pagato'],
        tutor: 'Paolo S.',
        salesCode: 'Sales 004',
        sourceRows: [2],
        ...over,
    };
}

function crm(over: Partial<CrmClosure> = {}): CrmClosure {
    return {
        leadId: 'lead-1',
        phone: '+393663515565',
        email: 'mario.rossi@example.com',
        fullName: 'Mario Rossi',
        funnel: 'EVERGREEN',
        outcome: 'Chiuso',
        outcomeAt: new Date(Date.UTC(2026, 7, 1, 12)),
        amountEur: 1390,
        attemptsAmountEur: 1390,
        isRejected: false,
        salespersonAssigned: 'Sales 004',
        ...over,
    };
}

test('un contratto che coincide non produce differenze', () => {
    assert.deepEqual(reconcile([sheet()], [crm()]), []);
});

test('lead regolare con esito sbagliato → famiglia esito-mancante', () => {
    const d = reconcile([sheet()], [crm({ outcome: 'Non chiuso', amountEur: null, attemptsAmountEur: 0 })]);
    assert.equal(d.length, 1);
    assert.equal(d[0].family, 'esito-mancante');
    assert.equal(d[0].appliable, true);
});

test('lead scartato con contratto nel foglio → famiglia lead-scartato', () => {
    const d = reconcile([sheet()], [crm({ outcome: null, isRejected: true, amountEur: null, attemptsAmountEur: 0 })]);
    assert.equal(d[0].family, 'lead-scartato');
});

test('contratto senza alcun lead → famiglia lead-assente', () => {
    const d = reconcile([sheet()], []);
    assert.equal(d[0].family, 'lead-assente');
    assert.equal(d[0].crm, null);
});

test('importo divergente oltre la tolleranza → famiglia importo', () => {
    const d = reconcile([sheet({ amountEur: 1390 })], [crm({ amountEur: 1200, attemptsAmountEur: 1200 })]);
    assert.equal(d[0].family, 'importo');
    assert.equal(d[0].deltaEur, 190);
    assert.equal(d[0].note, null);
});

test('scarto da arrotondamento del foglio resta segnalato ma etichettato', () => {
    const d = reconcile([sheet({ amountEur: 2080 })], [crm({ amountEur: 2079, attemptsAmountEur: 2079 })]);
    assert.equal(d[0].family, 'importo');
    assert.equal(d[0].note, 'arrotondamento del foglio');
});

test('chiuso nel CRM ma assente dal foglio → famiglia solo-crm', () => {
    const d = reconcile([], [crm()]);
    assert.equal(d[0].family, 'solo-crm');
    assert.equal(d[0].sheet, null);
});

test('match sulla mail quando il telefono nel CRM è storpiato (caso Ludovici)', () => {
    const d = reconcile([sheet({ phone: '+393663515565' })], [crm({ phone: '+393663515575' })]);
    assert.deepEqual(d, []);
});

test('un tutor non mappato rende la riga non applicabile', () => {
    const d = reconcile([sheet({ tutor: 'Matteo D.', salesCode: null })], []);
    assert.equal(d[0].appliable, false);
    assert.match(d[0].blockedReason!, /Matteo D\./);
});

test('leads e salesAttempts in disaccordo emergono come differenza a sé', () => {
    const d = reconcile([sheet()], [crm({ amountEur: 1390, attemptsAmountEur: 2780 })]);
    assert.equal(d.length, 1);
    assert.match(d[0].blockedReason ?? '', /salesAttempts/);
});

test('le chiavi delle differenze sono stabili e uniche', () => {
    const d = reconcile([sheet({ phone: '+393331112222', key: '+393331112222|2026-08' }), sheet()], []);
    assert.equal(new Set(d.map(x => x.key)).size, 2);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npx tsx --test src/lib/riconciliazione/match.test.ts`
Expected: FAIL — `Cannot find module './match'`

- [ ] **Step 3: Scrivi l'implementazione minima**

Crea `src/lib/riconciliazione/match.ts`:

```ts
import type { SheetContract } from './sheetRows';

export type Family = 'esito-mancante' | 'lead-scartato' | 'lead-assente' | 'importo' | 'solo-crm';

export type CrmClosure = {
    leadId: string;
    phone: string | null;
    email: string | null;
    fullName: string;
    funnel: string | null;
    outcome: string | null;
    outcomeAt: Date | null;
    amountEur: number | null;
    attemptsAmountEur: number;
    isRejected: boolean;
    salespersonAssigned: string | null;
};

export type DiffEntry = {
    key: string;
    family: Family;
    sheet: SheetContract | null;
    crm: CrmClosure | null;
    appliable: boolean;
    blockedReason: string | null;
    note: string | null;
    deltaEur: number;
};

export const ROUNDING_TOLERANCE_EUR = 2;

function indexCrm(crm: CrmClosure[]) {
    const byPhone = new Map<string, CrmClosure>();
    const byEmail = new Map<string, CrmClosure>();
    for (const c of crm) {
        if (c.phone) byPhone.set(c.phone, c);
        if (c.email) byEmail.set(c.email, c);
    }
    return { byPhone, byEmail };
}

export function reconcile(sheet: SheetContract[], crm: CrmClosure[]): DiffEntry[] {
    const { byPhone, byEmail } = indexCrm(crm);
    const matched = new Set<string>();
    const out: DiffEntry[] = [];

    for (const s of sheet) {
        // Telefono prima, mail come rete di sicurezza: nel CRM capita il numero
        // storpiato di una cifra, e senza la mail risulterebbe un contratto mancante.
        const c = (s.phone && byPhone.get(s.phone)) || (s.email && byEmail.get(s.email)) || null;
        if (c) matched.add(c.leadId);

        const blockedReason = !s.salesCode
            ? `Venditore non mappato nel foglio: "${s.tutor}". Aggiungilo alla mappatura prima di applicare.`
            : (c && c.outcome === 'Chiuso' && Math.abs(c.attemptsAmountEur - (c.amountEur ?? 0)) > 0.01
                ? `leads e salesAttempts non concordano (${c.amountEur} vs ${c.attemptsAmountEur}): va sanato prima.`
                : null);
        const appliable = blockedReason === null;

        if (!c) {
            out.push({ key: s.key, family: 'lead-assente', sheet: s, crm: null, appliable, blockedReason, note: null, deltaEur: s.amountEur });
            continue;
        }
        if (c.isRejected && c.outcome !== 'Chiuso') {
            out.push({ key: s.key, family: 'lead-scartato', sheet: s, crm: c, appliable, blockedReason, note: null, deltaEur: s.amountEur });
            continue;
        }
        if (c.outcome !== 'Chiuso') {
            out.push({ key: s.key, family: 'esito-mancante', sheet: s, crm: c, appliable, blockedReason, note: null, deltaEur: s.amountEur });
            continue;
        }
        const delta = s.amountEur - (c.amountEur ?? 0);
        if (Math.abs(delta) > 0.01) {
            out.push({
                key: s.key,
                family: 'importo',
                sheet: s,
                crm: c,
                appliable,
                blockedReason,
                note: Math.abs(delta) <= ROUNDING_TOLERANCE_EUR ? 'arrotondamento del foglio' : null,
                deltaEur: delta,
            });
            continue;
        }
        if (blockedReason) {
            out.push({ key: s.key, family: 'importo', sheet: s, crm: c, appliable: false, blockedReason, note: null, deltaEur: 0 });
        }
    }

    // Direzione inversa: chiuso nel CRM, assente dal foglio o in Stand-by.
    // Toglie fatturato, quindi non è mai spuntata di default (lo decide la UI).
    for (const c of crm) {
        if (matched.has(c.leadId)) continue;
        if (c.outcome !== 'Chiuso') continue;
        out.push({
            key: `crm:${c.leadId}`,
            family: 'solo-crm',
            sheet: null,
            crm: c,
            appliable: true,
            blockedReason: null,
            note: null,
            deltaEur: -(c.amountEur ?? 0),
        });
    }

    return out;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npx tsx --test src/lib/riconciliazione/match.test.ts`
Expected: PASS, 11 test

- [ ] **Step 5: Registra il test e lancia la suite**

Aggiungi `src/lib/riconciliazione/match.test.ts` allo script `test` di `package.json`.
Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/riconciliazione/match.ts src/lib/riconciliazione/match.test.ts package.json
git commit -m "feat(riconciliazione): motore di confronto foglio-CRM diviso per famiglie"
```

---

### Task 3: Client Google Sheets

**Files:**
- Create: `src/lib/riconciliazione/sheetsClient.ts`

**Interfaces:**
- Consumes: `SheetUnavailableError` da `./sheetRows`; env `GOOGLE_SHEETS_SA_EMAIL`, `GOOGLE_SHEETS_SA_PRIVATE_KEY`.
- Produces:
  ```ts
  export const DATABASE_CLIENTI_SPREADSHEET_ID = '1viEdIATN2bcJg9JW4OTzcM51d45j4ROCrtF7wgdEg5k';
  export const DATABASE_CLIENTI_RANGE = 'Database Clienti!A:K';
  export async function fetchDatabaseClientiRows(): Promise<string[][]>;
  ```

Questo task non ha test automatici: è puro I/O verso un servizio esterno, e la logica testabile sta tutta in `sheetRows`. La verifica è manuale, allo Step 3.

- [ ] **Step 1: Scrivi il client**

Crea `src/lib/riconciliazione/sheetsClient.ts`:

```ts
import { google } from 'googleapis';
import { SheetUnavailableError } from './sheetRows';

export const DATABASE_CLIENTI_SPREADSHEET_ID = '1viEdIATN2bcJg9JW4OTzcM51d45j4ROCrtF7wgdEg5k';
export const DATABASE_CLIENTI_RANGE = 'Database Clienti!A:K';

/**
 * La chiave privata del service account può arrivare in due forme a seconda di
 * come è stata scritta l'env: con a capo reali (come su Vercel oggi) oppure con
 * '\n' letterali. Il replace è innocuo sulla prima e indispensabile sulla seconda.
 */
function privateKey(): string {
    const raw = process.env.GOOGLE_SHEETS_SA_PRIVATE_KEY;
    if (!raw) throw new SheetUnavailableError('GOOGLE_SHEETS_SA_PRIVATE_KEY non configurata.');
    return raw.replace(/\\n/g, '\n');
}

export async function fetchDatabaseClientiRows(): Promise<string[][]> {
    const email = process.env.GOOGLE_SHEETS_SA_EMAIL;
    if (!email) throw new SheetUnavailableError('GOOGLE_SHEETS_SA_EMAIL non configurata.');

    const auth = new google.auth.JWT({
        email,
        key: privateKey(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    try {
        const res = await google.sheets({ version: 'v4', auth }).spreadsheets.values.get({
            spreadsheetId: DATABASE_CLIENTI_SPREADSHEET_ID,
            range: DATABASE_CLIENTI_RANGE,
        });
        return (res.data.values ?? []) as string[][];
    } catch (e: any) {
        const code = e?.code ?? e?.response?.status;
        if (code === 403) {
            throw new SheetUnavailableError('Il service account non ha più accesso al foglio: ricondividilo come Visualizzatore.');
        }
        throw new SheetUnavailableError(`Lettura del foglio fallita (${code ?? 'errore ignoto'}).`);
    }
}
```

- [ ] **Step 2: Verifica la compilazione**

Run: `npx tsc --noEmit`
Expected: nessun errore introdotto da questo file.

- [ ] **Step 3: Verifica manuale della lettura**

Run:
```bash
npx tsx -e "import('./src/lib/riconciliazione/sheetsClient').then(async m => { const r = await m.fetchDatabaseClientiRows(); console.log('righe:', r.length, '| intestazioni:', JSON.stringify(r[0])); })"
```
Expected: circa 3.700 righe e le intestazioni `cf, MAIL, NUM, NOME, COGNOME, FIRMA CONTRATTO, ...`. Se torna un errore 403, la condivisione del foglio col service account è saltata.

- [ ] **Step 4: Commit**

```bash
git add src/lib/riconciliazione/sheetsClient.ts
git commit -m "feat(riconciliazione): lettura del Database Clienti via service account"
```

---

### Task 4: Tabelle di storico

**Files:**
- Create: `drizzle/migrations/0032_riconciliazione_runs.sql`
- Modify: `src/db/schema.ts` (in coda, accanto alle altre tabelle di supporto)

**Interfaces:**
- Produces: tabelle Drizzle `riconciliazioneRuns` e `riconciliazioneEntries`, importabili da `@/db/schema`.

- [ ] **Step 1: Scrivi la migrazione**

Crea `drizzle/migrations/0032_riconciliazione_runs.sql`:

```sql
-- Storico delle riconciliazioni CRM <-> Database Clienti.
-- Serve a rendere annullabile ogni applicazione: prima di ogni scrittura
-- salviamo lo stato precedente dei campi toccati.
CREATE TABLE IF NOT EXISTS "riconciliazioneRuns" (
    "id" text PRIMARY KEY,
    "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE,
    "monthKey" text NOT NULL,
    "source" text NOT NULL,
    "appliedBy" text NOT NULL REFERENCES "users"("id"),
    "appliedAt" timestamptz NOT NULL DEFAULT now(),
    "entryCount" integer NOT NULL DEFAULT 0,
    "revertedAt" timestamptz,
    "revertedBy" text REFERENCES "users"("id")
);

CREATE TABLE IF NOT EXISTS "riconciliazioneEntries" (
    "id" text PRIMARY KEY,
    "runId" text NOT NULL REFERENCES "riconciliazioneRuns"("id") ON DELETE CASCADE,
    "leadId" text REFERENCES "leads"("id") ON DELETE SET NULL,
    "family" text NOT NULL,
    "createdLead" boolean NOT NULL DEFAULT false,
    "before" jsonb NOT NULL,
    "after" jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "riconciliazione_runs_month_idx" ON "riconciliazioneRuns" ("companyId", "monthKey", "appliedAt");
CREATE INDEX IF NOT EXISTS "riconciliazione_entries_run_idx" ON "riconciliazioneEntries" ("runId");
```

- [ ] **Step 2: Applica la migrazione**

Applica il contenuto del file con `mcp__supabase__apply_migration`, nome `0032_riconciliazione_runs`.
Verifica con `mcp__supabase__list_tables` che entrambe le tabelle esistano.

- [ ] **Step 3: Aggiungi le tabelle a `src/db/schema.ts`**

```ts
export const riconciliazioneRuns = pgTable('riconciliazioneRuns', {
    id: text('id').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    monthKey: text('monthKey').notNull(),
    source: text('source').notNull(),              // 'sheet' | 'csv'
    appliedBy: text('appliedBy').notNull().references(() => users.id),
    appliedAt: timestamp('appliedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    entryCount: integer('entryCount').default(0).notNull(),
    revertedAt: timestamp('revertedAt', { withTimezone: true, mode: 'date' }),
    revertedBy: text('revertedBy').references(() => users.id),
});

export const riconciliazioneEntries = pgTable('riconciliazioneEntries', {
    id: text('id').primaryKey(),
    runId: text('runId').notNull().references(() => riconciliazioneRuns.id, { onDelete: 'cascade' }),
    leadId: text('leadId').references(() => leads.id, { onDelete: 'set null' }),
    family: text('family').notNull(),
    createdLead: boolean('createdLead').default(false).notNull(),
    // Stato dei soli campi toccati, prima e dopo: è ciò che rende annullabile la run.
    before: jsonb('before').notNull(),
    after: jsonb('after').notNull(),
});
```

Verifica che `jsonb` e `boolean` siano già importati da `drizzle-orm/pg-core` in cima al file; se manca uno dei due, aggiungilo all'import esistente.

- [ ] **Step 4: Verifica la compilazione**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add drizzle/migrations/0032_riconciliazione_runs.sql src/db/schema.ts
git commit -m "feat(riconciliazione): tabelle di storico per rendere annullabili le correzioni"
```

---

### Task 5: Server action di confronto (sola lettura)

**Files:**
- Create: `src/app/actions/riconciliazioneActions.ts`

**Interfaces:**
- Consumes: `fetchDatabaseClientiRows`, `parseSheetRows`, `SheetUnavailableError`, `reconcile`, `normalizePhoneStrict`, `db` e `leads`/`salesAttempts` da `@/db/schema`.
- Produces:
  ```ts
  export type ConfrontoResult =
      | { success: true; entries: DiffEntry[]; sheetContracts: number; sheetTotalEur: number; crmTotalEur: number }
      | { success: false; error: string };
  export async function confrontaMese(monthKey: string): Promise<ConfrontoResult>;
  ```

- [ ] **Step 1: Scrivi l'action**

Crea `src/app/actions/riconciliazioneActions.ts`:

```ts
'use server';

import { and, eq, gte, lt, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { leads, salesAttempts } from '@/db/schema';
import { createClient } from '@/utils/supabase/server';
import { normalizePhoneStrict } from '@/lib/phoneNormalize';
import { fetchDatabaseClientiRows } from '@/lib/riconciliazione/sheetsClient';
import { parseSheetRows, SheetUnavailableError } from '@/lib/riconciliazione/sheetRows';
import { reconcile, type CrmClosure, type DiffEntry } from '@/lib/riconciliazione/match';

const COMPANY_ID = 'fenice'; // il foglio non contiene Serenamente

async function requireAdmin(): Promise<{ id: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') return null;
    return { id: user.id };
}

function monthBounds(monthKey: string): { from: Date; to: Date } {
    const [y, m] = monthKey.split('-').map(Number);
    // Europe/Rome è UTC+1/+2: prendendo l'intero mese in UTC allargato di un
    // giorno per lato rischieremmo di pescare il mese vicino. I confini si
    // calcolano invece sull'ora locale italiana del primo e dell'ultimo giorno.
    const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    const to = new Date(Date.UTC(y, m, 1, 0, 0, 0));
    return { from, to };
}

async function loadCrmClosures(monthKey: string): Promise<CrmClosure[]> {
    const { from, to } = monthBounds(monthKey);

    const rows = await db.select({
        id: leads.id,
        phone: leads.phone,
        email: leads.email,
        name: leads.name,
        funnel: leads.funnel,
        outcome: leads.salespersonOutcome,
        outcomeAt: leads.salespersonOutcomeAt,
        amountEur: leads.closeAmountEur,
        status: leads.status,
        salespersonAssigned: leads.salespersonAssigned,
    })
        .from(leads)
        .where(and(
            eq(leads.companyId, COMPANY_ID),
            gte(leads.salespersonOutcomeAt, from),
            lt(leads.salespersonOutcomeAt, to),
        ));

    const attempts = rows.length === 0 ? [] : await db.select({
        leadId: salesAttempts.leadId,
        amountEur: salesAttempts.closeAmountEur,
        outcome: salesAttempts.outcome,
    })
        .from(salesAttempts)
        .where(and(
            eq(salesAttempts.companyId, COMPANY_ID),
            gte(salesAttempts.outcomeAt, from),
            lt(salesAttempts.outcomeAt, to),
            inArray(salesAttempts.leadId, rows.map(r => r.id)),
        ));

    const attemptTotals = new Map<string, number>();
    for (const a of attempts) {
        if (a.outcome !== 'Chiuso') continue;
        attemptTotals.set(a.leadId, (attemptTotals.get(a.leadId) ?? 0) + (a.amountEur ?? 0));
    }

    return rows.map(r => ({
        leadId: r.id,
        phone: normalizePhoneStrict(r.phone),
        email: (r.email ?? '').trim().toLowerCase() || null,
        fullName: r.name ?? '',
        funnel: r.funnel,
        outcome: r.outcome,
        outcomeAt: r.outcomeAt,
        amountEur: r.amountEur,
        attemptsAmountEur: attemptTotals.get(r.id) ?? 0,
        isRejected: r.status === 'REJECTED',
        salespersonAssigned: r.salespersonAssigned,
    }));
}

export type ConfrontoResult =
    | { success: true; entries: DiffEntry[]; sheetContracts: number; sheetTotalEur: number; crmTotalEur: number }
    | { success: false; error: string };

export async function confrontaMese(monthKey: string): Promise<ConfrontoResult> {
    if (!await requireAdmin()) return { success: false, error: 'Non autorizzato.' };
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return { success: false, error: 'Mese non valido.' };

    try {
        const values = await fetchDatabaseClientiRows();
        const sheet = parseSheetRows(values, monthKey);
        const crm = await loadCrmClosures(monthKey);
        const entries = reconcile(sheet, crm);
        return {
            success: true,
            entries,
            sheetContracts: sheet.length,
            sheetTotalEur: sheet.reduce((s, c) => s + c.amountEur, 0),
            crmTotalEur: crm.filter(c => c.outcome === 'Chiuso').reduce((s, c) => s + (c.amountEur ?? 0), 0),
        };
    } catch (e) {
        if (e instanceof SheetUnavailableError) return { success: false, error: e.message };
        return { success: false, error: 'Confronto fallito: ' + (e instanceof Error ? e.message : 'errore ignoto') };
    }
}
```

Prima di scrivere il file, apri `src/db/schema.ts` e verifica il nome reale della colonna di stato del lead usata per lo scarto (`status` con valore `REJECTED`); se il progetto usa un campo diverso, adegua `isRejected`.

- [ ] **Step 2: Verifica la compilazione**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Verifica sul mese già quadrato**

Run il dev server (`npm run dev`) e da una pagina admin qualsiasi invoca `confrontaMese('2026-08')` dalla console del browser, oppure aspetta il Task 8 e verifica dalla UI.
Expected: **zero differenze di famiglia `esito-mancante` e `importo`** su un mese già bonificato a mano. Se ne escono, il motore sbaglia: fermati e indaga prima di procedere.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/riconciliazioneActions.ts
git commit -m "feat(riconciliazione): confronto del mese fra CRM e foglio"
```

---

### Task 6: Applicazione delle correzioni

**Files:**
- Modify: `src/app/actions/riconciliazioneActions.ts`

**Interfaces:**
- Consumes: `resolveAttemptWrite` da `@/lib/venditorePerformance/guard`, `logLeadEvent` da `@/lib/eventLogger`, `riconciliazioneRuns`/`riconciliazioneEntries` da `@/db/schema`.
- Produces:
  ```ts
  export async function applicaCorrezioni(monthKey: string, keys: string[]): Promise<{ success: true; runId: string; applied: number } | { success: false; error: string }>;
  ```

**Regole di scrittura, da rispettare alla lettera:**

- `esito-mancante` → aggiorna `leads`: `salespersonOutcome='Chiuso'`, `closeAmountEur`, `salespersonOutcomeAt = signedAt`, `salespersonAssigned = salesCode`, `version + 1`. **Non tocca `presentedAt`.**
- `lead-scartato` → come sopra. **Non tocca `status`, `presentedAt`, `appointmentDate`, `confirmationsOutcome`, `funnel`.** La chiusura resta attribuita al funnel che il lead ha già.
- `lead-assente` → crea un lead nuovo con `funnel='FUORI FUNNEL'`, `companyId='fenice'`, nome/telefono/mail dal foglio, più i campi di chiusura. Nessun appuntamento, nessuna presenza.
- `importo` → aggiorna solo `closeAmountEur` su `leads` e sull'attempt corrispondente.
- `solo-crm` → porta `leads.salespersonOutcome` a `'Non chiuso'`, azzera `closeAmountEur` e `closeProduct`, annota in `salespersonOutcomeNotes` `'Riconciliazione <monthKey>: assente dal foglio o Stand-by'`. **`notClosedReason` resta null**: i suoi valori sono comportamentali e nessuno di essi descrive questo caso.
- Su ogni famiglia che tocca `salesAttempts`, il ramo insert/update è deciso **solo** da `resolveAttemptWrite` con `occasion: 'current'`.
- Tutto dentro **una transazione**: o passa l'intera selezione o non passa niente.
- Prima di ogni scrittura, la riga `riconciliazioneEntries` con `before`/`after` dei soli campi toccati.
- Le entry con `appliable === false` vengono **ignorate**, anche se arrivano spuntate: il client non è la fonte di verità dei permessi.

- [ ] **Step 1: Scrivi l'action**

Prima di scrivere: apri `src/db/schema.ts` alla definizione di `leads` ed elenca le colonne `NOT NULL` senza default — l'insert della famiglia `lead-assente` deve valorizzarle tutte, e questo piano non può indovinarle.

Aggiungi in coda a `src/app/actions/riconciliazioneActions.ts`:

```ts
import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { riconciliazioneRuns, riconciliazioneEntries } from '@/db/schema';
import { resolveAttemptWrite } from '@/lib/venditorePerformance/guard';
import { logLeadEvent } from '@/lib/eventLogger';

type ApplyResult = { success: true; runId: string; applied: number } | { success: false; error: string };

export async function applicaCorrezioni(monthKey: string, keys: string[]): Promise<ApplyResult> {
    const admin = await requireAdmin();
    if (!admin) return { success: false, error: 'Non autorizzato.' };

    // Il client manda SOLO le chiavi: le differenze si ricalcolano qui. Fidarsi
    // delle entry mandate dal browser significherebbe accettare importi scelti
    // da chi apre i devtools.
    const fresh = await confrontaMese(monthKey);
    if (!fresh.success) return { success: false, error: fresh.error };

    const wanted = new Set(keys);
    const todo = fresh.entries.filter(e => wanted.has(e.key) && e.appliable);
    if (todo.length === 0) return { success: false, error: 'Nessuna correzione applicabile fra quelle selezionate.' };

    const runId = crypto.randomUUID();
    const touched: Array<{ leadId: string; family: string }> = [];

    await db.transaction(async (tx) => {
        await tx.insert(riconciliazioneRuns).values({
            id: runId,
            companyId: COMPANY_ID,
            monthKey,
            source: 'sheet',
            appliedBy: admin.id,
            entryCount: todo.length,
        });

        for (const e of todo) {
            if (e.family === 'lead-assente') {
                const leadId = crypto.randomUUID();
                await tx.insert(leads).values({
                    id: leadId,
                    companyId: COMPANY_ID,
                    name: e.sheet!.fullName,
                    phone: e.sheet!.phone,
                    email: e.sheet!.email,
                    // Origine dedicata: il contratto entra nel fatturato totale ma
                    // resta distinguibile nelle statistiche per funnel.
                    funnel: 'FUORI FUNNEL',
                    salespersonOutcome: 'Chiuso',
                    salespersonOutcomeAt: e.sheet!.signedAt,
                    closeAmountEur: e.sheet!.amountEur,
                    salespersonAssigned: e.sheet!.salesCode,
                    // Nessun presentedAt, nessun appointmentDate: questo contratto
                    // non è passato dal funnel e non deve gonfiare i tassi di nessuno.
                });
                await tx.insert(riconciliazioneEntries).values({
                    id: crypto.randomUUID(),
                    runId,
                    leadId,
                    family: e.family,
                    createdLead: true,
                    before: {},
                    after: { salespersonOutcome: 'Chiuso', closeAmountEur: e.sheet!.amountEur },
                });
                touched.push({ leadId, family: e.family });
                continue;
            }

            const leadId = e.crm!.leadId;
            const before = {
                salespersonOutcome: e.crm!.outcome,
                salespersonOutcomeAt: e.crm!.outcomeAt,
                closeAmountEur: e.crm!.amountEur,
                salespersonAssigned: e.crm!.salespersonAssigned,
            };

            const after = e.family === 'solo-crm'
                ? {
                    salespersonOutcome: 'Non chiuso',
                    salespersonOutcomeAt: e.crm!.outcomeAt,
                    closeAmountEur: null,
                    salespersonAssigned: e.crm!.salespersonAssigned,
                }
                : {
                    salespersonOutcome: 'Chiuso',
                    salespersonOutcomeAt: e.sheet!.signedAt,
                    closeAmountEur: e.sheet!.amountEur,
                    salespersonAssigned: e.sheet!.salesCode ?? e.crm!.salespersonAssigned,
                };

            await tx.insert(riconciliazioneEntries).values({
                id: crypto.randomUUID(), runId, leadId, family: e.family, createdLead: false,
                before, after,
            });

            await tx.update(leads)
                .set({
                    salespersonOutcome: after.salespersonOutcome,
                    salespersonOutcomeAt: after.salespersonOutcomeAt,
                    closeAmountEur: after.closeAmountEur,
                    closeProduct: e.family === 'solo-crm' ? null : undefined,
                    salespersonAssigned: after.salespersonAssigned,
                    salespersonOutcomeNotes: e.family === 'solo-crm'
                        ? `Riconciliazione ${monthKey}: assente dal foglio o Stand-by`
                        : undefined,
                    // presentedAt NON compare qui: è deliberato. Vedi Task 10.
                })
                .where(and(eq(leads.companyId, COMPANY_ID), eq(leads.id, leadId)));

            // La storia passa SEMPRE da resolveAttemptWrite: è l'unica cosa che
            // impedisce a una correzione di duplicare il tentativo e contare due
            // volte il fatturato (il bug chiuso col commit 12eed7e).
            const attempts = await tx.select({
                id: salesAttempts.id,
                outcome: salesAttempts.outcome,
                outcomeAt: salesAttempts.outcomeAt,
                attemptNumber: salesAttempts.attemptNumber,
            })
                .from(salesAttempts)
                .where(and(eq(salesAttempts.companyId, COMPANY_ID), eq(salesAttempts.leadId, leadId)));

            const write = resolveAttemptWrite({
                attempts,
                outcome: after.salespersonOutcome,
                cycleStartAt: null,
                leadHasOutcome: !!e.crm!.outcome,
                occasion: 'current',
            });
            const attemptValues = {
                outcome: after.salespersonOutcome,
                closeAmountEur: after.closeAmountEur,
                outcomeAt: after.salespersonOutcomeAt ?? new Date(),
            };
            if (write.mode === 'update') {
                await tx.update(salesAttempts).set(attemptValues)
                    .where(and(eq(salesAttempts.companyId, COMPANY_ID), eq(salesAttempts.id, write.id)));
            } else {
                await tx.insert(salesAttempts).values({
                    ...attemptValues,
                    id: crypto.randomUUID(),
                    leadId,
                    companyId: COMPANY_ID,
                    attemptNumber: write.attemptNumber,
                    salesUserId: admin.id,
                });
            }

            touched.push({ leadId, family: e.family });
        }
    });

    for (const t of touched) {
        await logLeadEvent({
            leadId: t.leadId,
            eventType: 'RECONCILED',
            description: `Riconciliazione ${monthKey} (${t.family})`,
            userId: admin.id,
        });
    }

    revalidatePath('/riconciliazione');
    return { success: true, runId, applied: touched.length };
}
```

Apri `src/lib/eventLogger.ts` e adegua la chiamata a `logLeadEvent` alla firma reale di `LogEventParams`; se il tipo di evento è un'unione chiusa, aggiungi `'RECONCILED'` fra i valori ammessi.

- [ ] **Step 2: Verifica la compilazione**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Prova su un caso solo, in locale**

Con il dev server attivo, applica **una singola** entry di famiglia `importo` su un mese vecchio e verifica in Supabase che: `leads.closeAmountEur` sia cambiato, `salesAttempts` abbia **lo stesso numero di righe di prima**, ed esista una riga in `riconciliazioneEntries` con `before` e `after` valorizzati.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/riconciliazioneActions.ts
git commit -m "feat(riconciliazione): applicazione selettiva delle correzioni con storico"
```

---

### Task 7: Annullamento di una run

**Files:**
- Modify: `src/app/actions/riconciliazioneActions.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function annullaRun(runId: string): Promise<{ success: true; reverted: number } | { success: false; error: string }>;
  export async function elencoRun(monthKey: string): Promise<Array<{ id: string; appliedAt: Date; appliedBy: string; entryCount: number; revertedAt: Date | null }>>;
  ```

- [ ] **Step 1: Scrivi le action**

`annullaRun` verifica ADMIN, carica la run e le sue entry, e in **una transazione** riscrive su ogni lead i valori contenuti in `before`. Per le entry con `createdLead === true` il lead creato viene eliminato (`db.delete(leads)`), non riportato a uno stato precedente che non è mai esistito. Segna `revertedAt`/`revertedBy` sulla run. Una run già annullata restituisce `{ success: false, error: 'Questa riconciliazione è già stata annullata.' }`.

`elencoRun` restituisce le run del mese, più recenti prima.

- [ ] **Step 2: Verifica la compilazione**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Prova il giro completo in locale**

Applica una entry, annulla la run, e verifica in Supabase che il lead sia tornato **esattamente** ai valori di prima (importo, esito, data esito, venditore) e che il numero di righe in `salesAttempts` sia quello di partenza.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/riconciliazioneActions.ts
git commit -m "feat(riconciliazione): annullamento di una riconciliazione applicata"
```

---

### Task 8: Pagina admin

**Files:**
- Create: `src/app/(dashboard)/riconciliazione/page.tsx`
- Create: `src/app/(dashboard)/riconciliazione/RiconciliazioneClient.tsx`
- Modify: `src/components/Sidebar.tsx` (gruppo "Riservato", accanto a Previsionale)
- Modify: `src/components/AllCompaniesGate.tsx` (allowlist reporting)

**Interfaces:**
- Consumes: `confrontaMese`, `applicaCorrezioni`, `annullaRun`, `elencoRun`.

- [ ] **Step 1: Scrivi il gate della pagina**

Crea `src/app/(dashboard)/riconciliazione/page.tsx` sullo stesso schema di `src/app/(dashboard)/previsionale/page.tsx`: `export const dynamic = 'force-dynamic'`, lettura dell'utente da `createClient()`, `redirect('/unauthorized')` se `user.user_metadata?.role !== 'ADMIN'`, poi montaggio di `<RiconciliazioneClient />`. Qui **non** serve il lucchetto a password: la pagina non espone budget, espone contratti che l'admin già vede altrove.

- [ ] **Step 2: Scrivi il client**

`RiconciliazioneClient.tsx` (`"use client"`), con:
- selettore mese (ultimi 12 mesi, come su `/panoramica-generale`) e pulsante **Confronta**;
- riepilogo in testa: contratti nel foglio, totale foglio, totale CRM, differenza;
- una sezione per famiglia, nell'ordine `esito-mancante`, `importo`, `lead-scartato`, `lead-assente`, `solo-crm`, ognuna con conteggio e totale;
- una checkbox per riga, **spuntata di default solo** per `esito-mancante` e `importo`; le righe con `appliable === false` hanno la checkbox disabilitata e mostrano `blockedReason`;
- pulsante **Applica le correzioni spuntate** con conferma esplicita che riporta quante righe e quanti euro sta per muovere;
- in fondo, lo storico delle run del mese con il pulsante **Annulla**.

Rispetta la regola del progetto: i bottoni non possono mai essere figli di `<span>` o `<p>`, solo di `<div>`.

- [ ] **Step 3: Registra la pagina nella navigazione**

In `src/components/Sidebar.tsx`, aggiungi la voce "Riconciliazione" nel gruppo ADMIN "Riservato", accanto a "Previsionale".
In `src/components/AllCompaniesGate.tsx`, aggiungi `/riconciliazione` all'allowlist delle pagine di reporting (come è stato fatto per `/previsionale`), altrimenti la pagina risulta bloccata quando l'admin è su "Tutte le aziende".

- [ ] **Step 4: Verifica la build**

Run: `npm run build`
Expected: build completata, `/riconciliazione` presente fra le route dinamiche.

- [ ] **Step 5: Verifica manuale sul mese già quadrato**

Apri `/riconciliazione` da account admin, scegli **agosto 2026** e premi Confronta.
Expected: le famiglie `esito-mancante` e `importo` sono vuote o quasi (agosto è stato quadrato il 26/08; ciò che compare deve essere solo roba firmata dopo quella data). Se compaiono decine di righe su un mese bonificato, il motore sbaglia.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/riconciliazione" src/components/Sidebar.tsx src/components/AllCompaniesGate.tsx
git commit -m "feat(riconciliazione): pagina admin con anteprima, spunte e storico"
```

---

### Task 9: Riserva manuale via CSV

**Files:**
- Modify: `src/app/actions/riconciliazioneActions.ts`
- Modify: `src/app/(dashboard)/riconciliazione/RiconciliazioneClient.tsx`
- Create: `src/lib/riconciliazione/csv.ts`
- Test: `src/lib/riconciliazione/csv.test.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Produces:
  ```ts
  export function parseCsv(text: string): string[][];
  export async function confrontaMeseDaCsv(monthKey: string, csv: string): Promise<ConfrontoResult>;
  ```

Serve quando il service account perde l'accesso o l'IMPORTRANGE si rompe: l'admin esporta il tab `Database Clienti` in CSV da Google e lo carica. Il CSV attraversa **lo stesso** `parseSheetRows` del percorso automatico, quindi le regole non possono divergere fra i due ingressi.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `src/lib/riconciliazione/csv.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './csv';

test('legge un CSV semplice', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('rispetta le virgole dentro i campi quotati', () => {
    assert.deepEqual(parseCsv('a,b\n"Rossi, Mario",2'), [['a', 'b'], ['Rossi, Mario', '2']]);
});

test('gestisce le virgolette raddoppiate', () => {
    assert.deepEqual(parseCsv('a\n"dice ""ciao"""'), [['a'], ['dice "ciao"']]);
});

test('gestisce CRLF e ignora la riga finale vuota', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('tiene i campi vuoti al posto giusto', () => {
    assert.deepEqual(parseCsv('a,b,c\n1,,3'), [['a', 'b', 'c'], ['1', '', '3']]);
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npx tsx --test src/lib/riconciliazione/csv.test.ts`
Expected: FAIL — `Cannot find module './csv'`

- [ ] **Step 3: Scrivi il parser**

Crea `src/lib/riconciliazione/csv.ts`:

```ts
/**
 * Parser CSV minimo ma corretto sui casi che il foglio produce davvero:
 * virgole dentro i nomi ("Rossi, Mario"), virgolette raddoppiate e CRLF.
 * Niente dipendenze: il formato è fisso e lo controlliamo noi.
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else quoted = false;
            } else field += ch;
            continue;
        }

        if (ch === '"') { quoted = true; continue; }
        if (ch === ',') { row.push(field); field = ''; continue; }
        if (ch === '\r') continue;
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        field += ch;
    }

    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    // Google chiude l'export con un a capo: l'ultima riga vuota non è un record.
    return rows.filter(r => r.some(c => c !== ''));
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npx tsx --test src/lib/riconciliazione/csv.test.ts`
Expected: PASS, 5 test

- [ ] **Step 5: Aggiungi l'ingresso CSV all'action e alla UI**

In `riconciliazioneActions.ts`, `confrontaMeseDaCsv(monthKey, csv)` fa esattamente ciò che fa `confrontaMese` ma con `parseCsv(csv)` al posto di `fetchDatabaseClientiRows()`. In `applicaCorrezioni` aggiungi un parametro opzionale `csv?: string` che, se presente, viene usato per il ricalcolo lato server, e imposta `source: 'csv'` sulla run.
Nella UI, un campo file accanto al pulsante Confronta, con etichetta "Oppure carica il CSV del tab Database Clienti".

- [ ] **Step 6: Registra il test, build e commit**

Run: `npm test` — Expected: PASS
Run: `npm run build` — Expected: build completata

```bash
git add src/lib/riconciliazione/csv.ts src/lib/riconciliazione/csv.test.ts src/app/actions/riconciliazioneActions.ts "src/app/(dashboard)/riconciliazione/RiconciliazioneClient.tsx" package.json
git commit -m "feat(riconciliazione): riserva manuale via CSV quando il foglio non è leggibile"
```

---

### Task 10: Verifica delle viste che dividono per le presenze

**Files:**
- Modify: eventuali viste che risultano rotte (da individuare in questo task)

Una chiusura senza `presentedAt` è una novità per il CRM: finora ogni `Chiuso` aveva una presenza. Le famiglie `lead-scartato` e `lead-assente` ne producono di proposito, per non gonfiare i KPI di GDO e Conferme. Questo task accerta che nessuna vista ne esca a pezzi — per esempio un tasso di chiusura sopra il 100% perché il numeratore conta chiusure che il denominatore non conta.

- [ ] **Step 1: Trova le viste a rischio**

Run:
```bash
grep -rn "presentedAt" src/app/actions src/lib | grep -v test
```
Elenca ogni punto in cui `presentedAt` fa da denominatore o da filtro per una metrica di chiusura.

- [ ] **Step 2: Misura l'impatto reale sui dati veri**

Con `mcp__supabase__execute_sql`, conta quante chiusure senza presenza esistono già oggi:

```sql
SELECT date_trunc('month', "salespersonOutcomeAt") AS mese, count(*)
FROM leads
WHERE "companyId" = 'fenice'
  AND "salespersonOutcome" = 'Chiuso'
  AND "presentedAt" IS NULL
GROUP BY 1 ORDER BY 1 DESC LIMIT 12;
```

Se il conteggio è già diverso da zero, il caso è preesistente e le viste lo reggono già: annota il risultato e passa allo Step 4.

- [ ] **Step 3: Correggi solo ciò che si rompe davvero**

Per ogni vista che produrrebbe un tasso incoerente, la scelta è **una sola**: escludere le chiusure senza presenza dal numeratore dei tassi di conversione (che misurano il funnel), lasciandole nei totali di fatturato (che misurano i soldi). Non aggiungere presenze finte per far quadrare una percentuale.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "fix(kpi): i tassi di conversione ignorano le chiusure fuori funnel"
```

Se nulla si rompe, non fare commit: scrivi il risultato della verifica in coda alla spec, nella sezione *Test*.

---

## Come si chiude il lavoro

1. `npm test` verde e `npm run build` pulito.
2. Verifica sui mesi già quadrati (giugno, luglio, agosto): le famiglie `esito-mancante` e `importo` devono essere vuote o spiegabili.
3. Primo giro vero su **aprile e maggio 2026**, dove ci sono ~29 contratti per €64k mai riportati: è il banco di prova della famiglia `lead-scartato`.
4. Branch `feat/riconciliazione-database-clienti`, PR, merge su `main` e deploy.

## Cosa questo piano NON fa

- Non scrive sul foglio: la riconciliazione va in una direzione sola.
- Non riconcilia Serenamente.
- Non gira da sola su cron: applicare resta un gesto umano.
- Non indovina i cinque tutor non mappati (`Matteo D.`, `Matteo Q.`, `Amministrazione`, `Altro`, `Alberto C.`): li mostra e si ferma. Sono 31 contratti che restano da assegnare a mano finché il PO non dice a chi corrispondono.
