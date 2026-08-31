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
        attemptsCount: 1,
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

test('stesso telefono in mesi diversi: due chiusure indipendenti, niente collasso', () => {
    // Stesso numero di telefono ma chiuso in due mesi diversi nel CRM.
    // Ogni mese nel foglio deve matchare solo il suo corrispondente CRM.
    const d = reconcile(
        [
            sheet({ monthKey: '2026-08' }),
            sheet({ monthKey: '2026-09', key: '+393663515565|2026-09', signedAt: new Date(Date.UTC(2026, 8, 1, 12)) }),
        ],
        [
            crm({ leadId: 'lead-08', outcomeAt: new Date(Date.UTC(2026, 7, 15, 12)) }),
            crm({ leadId: 'lead-09', outcomeAt: new Date(Date.UTC(2026, 8, 15, 12)) }),
        ]
    );
    // Non ci sono differenze: agosto foglio ← agosto CRM, settembre foglio ← settembre CRM.
    assert.deepEqual(d, []);
});

test('tutor non mappato con match perfetto CRM: blocca l\'applicazione anche se importo ok', () => {
    const d = reconcile(
        [sheet({ tutor: 'Matteo D.', salesCode: null })],
        [crm()]
    );
    assert.equal(d.length, 1);
    assert.equal(d[0].family, 'importo');
    assert.equal(d[0].deltaEur, 0);
    assert.equal(d[0].appliable, false);
    assert.match(d[0].blockedReason!, /Matteo D\./);
});

test('chiusura al limite di mese (00:30 Roma primo agosto): matcha il contratto agosto, non torna lead-assente', () => {
    // 2026-07-31T22:30:00Z è esattamente 2026-08-01T00:30:00+02:00 (00:30 Roma primo agosto).
    // Deve matchare il contratto agosto, non essere trattato come lead-assente.
    const d = reconcile(
        [sheet({ monthKey: '2026-08' })],
        [crm({ outcomeAt: new Date('2026-07-31T22:30:00Z') })]
    );
    assert.deepEqual(d, []);
});

test('chiusura dopo limite di mese (00:30 Roma primo settembre): NON matcha agosto', () => {
    // 2026-08-31T22:30:00Z è esattamente 2026-09-01T00:30:00+02:00 (00:30 Roma primo settembre).
    // Il contratto agosto NON deve matchare questa chiusura, che è in settembre.
    const d = reconcile(
        [sheet({ monthKey: '2026-08' })],
        [crm({ outcomeAt: new Date('2026-08-31T22:30:00Z') })]
    );
    // Due differenze: contratto agosto è lead-assente (no CRM match agosto),
    // chiusura settembre è solo-crm (no sheet match settembre).
    assert.equal(d.length, 2);
    const leadAssente = d.find(e => e.family === 'lead-assente');
    assert.ok(leadAssente);
    assert.equal(leadAssente!.sheet?.monthKey, '2026-08');
    const soloCrm = d.find(e => e.family === 'solo-crm');
    assert.ok(soloCrm);
});

// --- Collaudo sui dati veri (31/08): tre difetti trovati su aprile-agosto ---

test('lead scartato senza esito venditore → lead-scartato, non lead-assente', () => {
    // Un lead REJECTED non ha `salespersonOutcomeAt`: non compare fra le chiusure
    // del mese e va cercato fra i candidati, altrimenti il contratto sembra
    // orfano e l'applicazione creerebbe un doppione del lead che esiste già.
    const candidato = crm({
        leadId: 'lead-scartato-1',
        outcome: null,
        outcomeAt: null,
        amountEur: null,
        attemptsAmountEur: 0,
        attemptsCount: 0,
        isRejected: true,
        salespersonAssigned: null,
    });

    const d = reconcile([sheet()], [], [candidato]);
    assert.equal(d.length, 1);
    assert.equal(d[0].family, 'lead-scartato');
    assert.equal(d[0].crm?.leadId, 'lead-scartato-1');
    assert.equal(d[0].appliable, true);
});

test('lead in appuntamento mai esitato → esito-mancante, non lead-assente', () => {
    const candidato = crm({
        leadId: 'lead-appuntamento-1',
        outcome: null, outcomeAt: null, amountEur: null,
        attemptsAmountEur: 0, attemptsCount: 0, isRejected: false,
    });

    const d = reconcile([sheet()], [], [candidato]);
    assert.equal(d.length, 1);
    assert.equal(d[0].family, 'esito-mancante');
    assert.equal(d[0].crm?.leadId, 'lead-appuntamento-1');
});

test('un candidato resta tale: senza contratto nel foglio non diventa solo-crm', () => {
    const candidato = crm({ leadId: 'candidato', phone: '+393334445566', email: null, outcome: null, outcomeAt: null, attemptsCount: 0 });
    assert.deepEqual(reconcile([], [], [candidato]), []);
});

test('la chiusura vera batte il doppione senza esito sullo stesso telefono', () => {
    // Caso reale di luglio: due lead con lo stesso numero, uno "Sparito" e uno
    // "Chiuso" da 3180. L'indice teneva l'ultimo letto: agganciava lo Sparito
    // (→ esito-mancante, seconda chiusura da 3180) e lasciava il vero chiuso in
    // solo-crm (→ cancellazione di una chiusura buona). Doppio danno.
    const doppione = crm({ leadId: 'doppione', outcome: 'Sparito', amountEur: null, attemptsAmountEur: 0, attemptsCount: 0 });
    const vero = crm({ leadId: 'vero', outcome: 'Chiuso', amountEur: 1390, attemptsAmountEur: 1390, attemptsCount: 1 });

    for (const ordine of [[doppione, vero], [vero, doppione]]) {
        assert.deepEqual(reconcile([sheet()], ordine), [], `ordine ${ordine.map(c => c.leadId).join(',')}`);
    }
});

test('a parità di esito Chiuso vince quello con l\'importo del foglio', () => {
    const altro = crm({ leadId: 'altro-importo', amountEur: 999, attemptsAmountEur: 999, attemptsCount: 1 });
    const giusto = crm({ leadId: 'giusto', amountEur: 1390, attemptsAmountEur: 1390, attemptsCount: 1 });

    for (const ordine of [[altro, giusto], [giusto, altro]]) {
        const d = reconcile([sheet()], ordine);
        // il contratto quadra col lead da 1390: su di lui nessuna differenza.
        assert.equal(d.filter(e => e.crm?.leadId === 'giusto').length, 0, `ordine ${ordine.map(c => c.leadId).join(',')}`);
        // l'altra chiusura resta scoperta: va segnalata, non abbinata a forza.
        const resto = d.filter(e => e.crm?.leadId === 'altro-importo');
        assert.equal(resto.length, 1);
        assert.equal(resto[0].family, 'solo-crm');
    }
});

test('nessun tentativo registrato non è una discordanza da sanare', () => {
    // `salesAttempts` esiste dal 02/07/2026: per ogni chiusura precedente la
    // somma dei tentativi è 0 per costruzione. Bloccarle tutte come "leads e
    // salesAttempts non concordano" fermava 15 righe di maggio già quadrate.
    const d = reconcile([sheet({ amountEur: 1500 })], [crm({ amountEur: 1390, attemptsAmountEur: 0, attemptsCount: 0 })]);
    assert.equal(d.length, 1);
    assert.equal(d[0].family, 'importo');
    assert.equal(d[0].blockedReason, null);
    assert.equal(d[0].appliable, true);
});

test('un tentativo registrato che non torna resta bloccato', () => {
    const d = reconcile([sheet({ amountEur: 1500 })], [crm({ amountEur: 1390, attemptsAmountEur: 900, attemptsCount: 1 })]);
    assert.equal(d.length, 1);
    assert.equal(d[0].appliable, false);
    assert.match(d[0].blockedReason ?? '', /non concordano/);
});
