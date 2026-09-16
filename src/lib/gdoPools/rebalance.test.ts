import test from 'node:test';
import assert from 'node:assert/strict';
import {
    pianificaRibilanciamento, idSorgenti, eOraDelGiro,
    type GdoPoolState, type LeadRibilanciabile,
} from './rebalance';

/**
 * Il pool com'è il 15/09/2026: freschi 106/112/119, ridati 110/114/118,
 * con 114 anche scorta (che a questo giro non interessa: la scorta riguarda
 * solo i freschi in eccedenza, non i ridati).
 */
function gdo(id: string, p: Partial<GdoPoolState> = {}): GdoPoolState {
    return { id, isActive: true, freschi: false, ridati: false, maiChiamati: 0, ...p };
}

function lead(id: string, assignedToId: string, p: Partial<LeadRibilanciabile> = {}): LeadRibilanciabile {
    return {
        id, assignedToId, ridatoDalBot: true, status: 'NEW',
        appointmentDate: null, presentedAt: null, ...p,
    };
}

/** N lead ridati, tutti in mano allo stesso GDO dei freschi. */
function ridati(n: number, da: string): LeadRibilanciabile[] {
    // Padding a 3 cifre: gli id si ordinano come stringhe, e 'l10' < 'l9'
    // renderebbe illeggibile l'asserzione su chi prende cosa.
    return Array.from({ length: n }, (_, i) => lead(`l${String(i).padStart(3, '0')}`, da));
}

// ------------------------------------------------------------- distribuzione

test('la distribuzione pareggia i carichi: prima si riempie il più scarico', () => {
    const gdos = [
        gdo('g106', { freschi: true }),
        gdo('g110', { ridati: true, maiChiamati: 10 }),
        gdo('g114', { ridati: true, maiChiamati: 4 }),
    ];
    // 6 lead: i primi 6-4=... il pareggio si raggiunge a 10 e da lì si alterna.
    const piano = pianificaRibilanciamento({ gdos, lead: ridati(8, 'g106') });

    assert.equal(piano.motivo, null);
    assert.equal(piano.spostamenti.length, 8);
    // g114 parte da 4, g110 da 10: i primi sei vanno tutti a g114 (4→10),
    // poi si alterna. Totale: g114 +7, g110 +1.
    assert.deepEqual(piano.perDestinatario, { g110: 1, g114: 7 });
    // E i carichi finali distano al massimo un lead: è questo il punto.
    assert.deepEqual(piano.caricoFinale, { g110: 11, g114: 11 });
});

test('a carichi già pari la distribuzione è un giro tondo fra i destinatari', () => {
    const gdos = [
        gdo('g112', { freschi: true }),
        gdo('g110', { ridati: true, maiChiamati: 5 }),
        gdo('g114', { ridati: true, maiChiamati: 5 }),
        gdo('g118', { ridati: true, maiChiamati: 5 }),
    ];
    const piano = pianificaRibilanciamento({ gdos, lead: ridati(9, 'g112') });

    assert.deepEqual(piano.perDestinatario, { g110: 3, g114: 3, g118: 3 });
    assert.deepEqual(piano.caricoFinale, { g110: 8, g114: 8, g118: 8 });
});

test('a parità di carico decide l id, così il piano è riproducibile', () => {
    const gdos = [
        gdo('g106', { freschi: true }),
        gdo('g118', { ridati: true }),
        gdo('g110', { ridati: true }),
    ];
    const uno = pianificaRibilanciamento({ gdos, lead: ridati(1, 'g106') });
    // L'ordine in cui arrivano i GDO dal database non deve contare.
    const due = pianificaRibilanciamento({ gdos: [...gdos].reverse(), lead: ridati(1, 'g106') });

    assert.equal(uno.spostamenti[0].a, 'g110');
    assert.deepEqual(uno.spostamenti, due.spostamenti);
});

test('un solo destinatario si prende tutto', () => {
    const gdos = [gdo('g106', { freschi: true }), gdo('g114', { ridati: true, maiChiamati: 99 })];
    const piano = pianificaRibilanciamento({ gdos, lead: ridati(5, 'g106') });
    assert.deepEqual(piano.perDestinatario, { g114: 5 });
    assert.ok(piano.spostamenti.every((s) => s.a === 'g114' && s.da === 'g106'));
});

// ------------------------------------------------------- nessun destinatario

test('nessun GDO nel pool ridati: non si sposta niente, meglio fermi che orfani', () => {
    const gdos = [gdo('g106', { freschi: true }), gdo('g112', { freschi: true })];
    const piano = pianificaRibilanciamento({ gdos, lead: ridati(50, 'g106') });

    assert.deepEqual(piano.spostamenti, []);
    assert.equal(piano.motivo, 'nessun_gdo_ridati_attivo');
});

test('il pool ridati esiste ma è tutto spento: vale come non esistesse', () => {
    const gdos = [
        gdo('g106', { freschi: true }),
        gdo('g110', { ridati: true, isActive: false }),
        gdo('g114', { ridati: true, isActive: false }),
    ];
    const piano = pianificaRibilanciamento({ gdos, lead: ridati(3, 'g106') });

    assert.deepEqual(piano.spostamenti, []);
    assert.equal(piano.motivo, 'nessun_gdo_ridati_attivo');
});

// ----------------------------------------------------------- GDO non attivi

test('un GDO del pool ridati ma spento non riceve mai nulla', () => {
    const gdos = [
        gdo('g106', { freschi: true }),
        gdo('g110', { ridati: true, isActive: false, maiChiamati: 0 }),
        gdo('g114', { ridati: true, maiChiamati: 40 }),
    ];
    // g110 sarebbe il più scarico di tutti: è proprio il caso in cui la
    // distribuzione a pareggio, da sola, gli darebbe tutto.
    const piano = pianificaRibilanciamento({ gdos, lead: ridati(4, 'g106') });

    assert.deepEqual(piano.perDestinatario, { g114: 4 });
    assert.ok(piano.spostamenti.every((s) => s.a === 'g114'));
});

// ---------------------------------------------------- chi cede e chi non cede

test('a chi sta in ENTRAMBI i pool non si porta via niente', () => {
    const gdos = [
        gdo('g114', { freschi: true, ridati: true, maiChiamati: 0 }),
        gdo('g110', { ridati: true, maiChiamati: 30 }),
    ];
    const piano = pianificaRibilanciamento({ gdos, lead: ridati(5, 'g114') });

    assert.deepEqual(piano.spostamenti, []);
    assert.equal(piano.motivo, 'niente_da_spostare');
    assert.deepEqual(idSorgenti(gdos), []);
});

test('i lead di chi non sta in nessun pool non si toccano', () => {
    const gdos = [
        gdo('g115'), // fuori da entrambi i pool: lavora solo quel che ha
        gdo('g110', { ridati: true }),
    ];
    const piano = pianificaRibilanciamento({ gdos, lead: ridati(7, 'g115') });

    assert.deepEqual(piano.spostamenti, []);
    assert.equal(piano.motivo, 'niente_da_spostare');
});

test('idSorgenti elenca solo il pool freschi puro, in ordine stabile', () => {
    const gdos = [
        gdo('g119', { freschi: true }),
        gdo('g106', { freschi: true }),
        gdo('g114', { freschi: true, ridati: true }),
        gdo('g110', { ridati: true }),
    ];
    assert.deepEqual(idSorgenti(gdos), ['g106', 'g119']);
});

test('un GDO dei freschi spento cede comunque: i suoi lead non li chiama nessuno', () => {
    const gdos = [
        gdo('g108', { freschi: true, isActive: false }),
        gdo('g110', { ridati: true }),
    ];
    const piano = pianificaRibilanciamento({ gdos, lead: ridati(2, 'g108') });

    assert.equal(piano.spostamenti.length, 2);
    assert.ok(piano.spostamenti.every((s) => s.da === 'g108' && s.a === 'g110'));
});

// ------------------------------------------------------------- lead esclusi

test('i lead con appuntamento non si spostano MAI, in nessuna delle tre forme', () => {
    const gdos = [gdo('g106', { freschi: true }), gdo('g110', { ridati: true })];
    const bloccati: LeadRibilanciabile[] = [
        lead('a1', 'g106', { status: 'APPOINTMENT' }),
        // Stato ancora aperto ma data già fissata: è il caso insidioso, perché
        // una query che guarda solo lo status se lo lascia passare.
        lead('a2', 'g106', { status: 'IN_PROGRESS', appointmentDate: new Date('2026-09-20T10:00:00Z') }),
        lead('a3', 'g106', { status: 'NEW', presentedAt: new Date('2026-09-12T10:00:00Z') }),
    ];
    const piano = pianificaRibilanciamento({ gdos, lead: bloccati });

    assert.deepEqual(piano.spostamenti, []);
    assert.equal(piano.motivo, 'niente_da_spostare');
});

test('fra lead bloccati e lead liberi si sposta solo la parte libera', () => {
    const gdos = [gdo('g106', { freschi: true }), gdo('g110', { ridati: true })];
    const misti: LeadRibilanciabile[] = [
        lead('l1', 'g106'),
        lead('l2', 'g106', { status: 'APPOINTMENT' }),
        lead('l3', 'g106', { status: 'IN_PROGRESS' }),
        lead('l4', 'g106', { appointmentDate: '2026-09-20T10:00:00Z' }),
    ];
    const piano = pianificaRibilanciamento({ gdos, lead: misti });

    assert.deepEqual(piano.spostamenti.map((s) => s.leadId), ['l1', 'l3']);
});

test('i lead chiusi o scartati non tornano in circolo', () => {
    const gdos = [gdo('g106', { freschi: true }), gdo('g110', { ridati: true })];
    const chiusi = ['REJECTED', 'CLOSED', 'CONFIRMED'].map((s, i) => lead(`c${i}`, 'g106', { status: s }));
    const piano = pianificaRibilanciamento({ gdos, lead: chiusi });

    assert.deepEqual(piano.spostamenti, []);
    assert.equal(piano.motivo, 'niente_da_spostare');
});

test('un lead fresco (non ridato dal bot) resta al GDO dei freschi', () => {
    const gdos = [gdo('g106', { freschi: true }), gdo('g110', { ridati: true })];
    const piano = pianificaRibilanciamento({
        gdos,
        lead: [lead('l1', 'g106', { ridatoDalBot: false }), lead('l2', 'g106')],
    });

    assert.deepEqual(piano.spostamenti.map((s) => s.leadId), ['l2']);
});

test('un lead senza assegnatario non viene spostato: non è di nessun pool', () => {
    const gdos = [gdo('g106', { freschi: true }), gdo('g110', { ridati: true })];
    const orfano = { ...lead('l1', 'g106'), assignedToId: null };
    const piano = pianificaRibilanciamento({ gdos, lead: [orfano] });

    assert.deepEqual(piano.spostamenti, []);
    assert.equal(piano.motivo, 'niente_da_spostare');
});

// ------------------------------------------------------------- casi a vuoto

test('nessun lead da spostare: non esplode e lo dice', () => {
    const gdos = [gdo('g106', { freschi: true }), gdo('g110', { ridati: true, maiChiamati: 3 })];
    const piano = pianificaRibilanciamento({ gdos, lead: [] });

    assert.deepEqual(piano.spostamenti, []);
    assert.equal(piano.motivo, 'niente_da_spostare');
    // Il riepilogo c'è comunque: "zero spostati" da solo non dice se il pool è sano.
    assert.deepEqual(piano.perDestinatario, { g110: 0 });
    assert.deepEqual(piano.caricoFinale, { g110: 3 });
});

test('nessun GDO del tutto: non esplode', () => {
    const piano = pianificaRibilanciamento({ gdos: [], lead: [] });
    assert.deepEqual(piano.spostamenti, []);
    assert.equal(piano.motivo, 'nessun_gdo_ridati_attivo');
    assert.deepEqual(idSorgenti([]), []);
});

test('il giro è idempotente: rilanciato sul risultato non muove più niente', () => {
    const gdos = [
        gdo('g106', { freschi: true }),
        gdo('g110', { ridati: true, maiChiamati: 2 }),
        gdo('g114', { ridati: true, maiChiamati: 8 }),
    ];
    const primo = pianificaRibilanciamento({ gdos, lead: ridati(6, 'g106') });
    assert.equal(primo.spostamenti.length, 6);

    // Stato dopo lo spostamento: i lead sono in mano ai destinatari.
    const dopo = primo.spostamenti.map((s) => lead(s.leadId, s.a));
    const gdosDopo = gdos.map((g) => ({ ...g, maiChiamati: primo.caricoFinale[g.id] ?? g.maiChiamati }));
    const secondo = pianificaRibilanciamento({ gdos: gdosDopo, lead: dopo });

    assert.deepEqual(secondo.spostamenti, []);
    assert.equal(secondo.motivo, 'niente_da_spostare');
});

// ------------------------------------------------------------------- orario

// Vercel invoca alle 18:30 e alle 19:30 UTC: solo una delle due è le 20:xx a Roma.
test('ora legale (settembre, UTC+2): lavora l invocazione delle 18:30 UTC', () => {
    assert.equal(eOraDelGiro(new Date('2026-09-15T18:30:00Z')), true);
    assert.equal(eOraDelGiro(new Date('2026-09-15T19:30:00Z')), false);
});

test('ora solare (novembre, UTC+1): lavora l invocazione delle 19:30 UTC', () => {
    assert.equal(eOraDelGiro(new Date('2026-11-15T19:30:00Z')), true);
    assert.equal(eOraDelGiro(new Date('2026-11-15T18:30:00Z')), false);
});

test('il cambio di fine ottobre non salta e non raddoppia il giro', () => {
    // Ultima domenica di ottobre 2026: il 25. Sabato 24 è ancora legale,
    // domenica 25 è già solare — e in nessuno dei due giorni il giro parte due volte.
    for (const giorno of ['2026-10-24', '2026-10-25', '2026-10-26']) {
        const legale = eOraDelGiro(new Date(`${giorno}T18:30:00Z`));
        const solare = eOraDelGiro(new Date(`${giorno}T19:30:00Z`));
        assert.equal(Number(legale) + Number(solare), 1, `giorno ${giorno}`);
    }
});

test('il ritardo di qualche minuto non fa perdere il giro, ma le 21 sì', () => {
    assert.equal(eOraDelGiro(new Date('2026-09-15T18:57:00Z')), true);  // 20:57 a Roma
    assert.equal(eOraDelGiro(new Date('2026-09-15T17:30:00Z')), false); // 19:30 a Roma
    assert.equal(eOraDelGiro(new Date('2026-09-15T19:00:00Z')), false); // 21:00 a Roma
});
