import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizzaLeadEntrante,
    pianificaAdozione,
    chatApertaAlBot,
    intakeSicuro,
    NOME_FALLBACK,
    FUNNEL_FALLBACK,
    type LeadEsistente,
    type LeadEntranteRaw,
} from './leadEntranti';

/** La riga tipo della lista: link wa.me del canale Telegram, nome assente. */
const RIGA_BASE: LeadEntranteRaw = {
    telefono: '+393200431888',
    nome: null,
    provenienza: 'TELEGRAM',
    primoMessaggio: 'Buongiorno, sono nel canale Telegram e mi hanno indicato questo contatto',
    scrittoIl: '2026-08-26T21:51:52+02:00',
    conversationId: 7246,
    statoBot: 'active',
    esito: null,
    appuntamento: null,
};

function esistente(over: Partial<LeadEsistente> = {}): LeadEsistente {
    return {
        id: 'lead-1',
        status: 'NEW',
        presentedAt: null,
        createdAt: new Date('2026-08-01T10:00:00Z'),
        assignedToId: 'gdo-1',
        companyId: 'fenice',
        ...over,
    };
}

test('normalizza la riga tipo: nome e funnel prendono il fallback, il resto passa', () => {
    const res = normalizzaLeadEntrante(RIGA_BASE);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.lead.phone, '+393200431888');
    assert.equal(res.lead.personKey, '3200431888');
    assert.equal(res.lead.name, NOME_FALLBACK);
    assert.equal(res.lead.funnel, 'TELEGRAM');
    assert.equal(res.lead.conversationId, 7246);
    assert.equal(res.lead.scrittoIl?.toISOString(), '2026-08-26T19:51:52.000Z');
});

test('provenienza vuota ricade su SCONOSCIUTO, nome presente vince sul fallback', () => {
    const res = normalizzaLeadEntrante({ ...RIGA_BASE, nome: '  Monia  ', provenienza: '' });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.lead.name, 'Monia');
    assert.equal(res.lead.funnel, FUNNEL_FALLBACK);
});

test('provenienza resta grezza anche quando e un funnel del CRM', () => {
    const res = normalizzaLeadEntrante({ ...RIGA_BASE, provenienza: 'corso 10 ore' });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    // Uppercase come tutti i funnel del CRM, ma nessuna traduzione: sulle
    // statistiche di funnel deve restare vero da dove e arrivata la persona.
    assert.equal(res.lead.funnel, 'CORSO 10 ORE');
});

test('telefono mancante o impresentabile viene scartato, non inventato', () => {
    for (const [telefono, motivo] of [
        [null, 'telefono_mancante'],
        ['   ', 'telefono_mancante'],
        ['123', 'telefono_non_normalizzabile'],
    ] as const) {
        const res = normalizzaLeadEntrante({ ...RIGA_BASE, telefono });
        assert.equal(res.ok, false);
        if (res.ok) return;
        assert.equal(res.motivo, motivo);
    }
});

test('una chat passata a una persona non viene mai adottata', () => {
    // Il fornitore le esclude gia dalla lista; se ne comparisse una, un intake
    // sopra scavalcherebbe chi ci sta parlando.
    const res = normalizzaLeadEntrante({ ...RIGA_BASE, statoBot: 'handed_off' });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.motivo, 'chat_passata_a_una_persona');
});

test('appuntamento accettato solo con esito APPUNTAMENTO e fuso esplicito', () => {
    const ok = normalizzaLeadEntrante({
        ...RIGA_BASE, statoBot: 'booked', esito: 'APPUNTAMENTO', appuntamento: '2026-09-10T15:00:00+02:00',
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.lead.appuntamento?.toISOString(), '2026-09-10T13:00:00.000Z');
    assert.equal(ok.lead.appuntamentoScartato, undefined);
});

test('una data senza fuso non diventa mai un appuntamento', () => {
    // Senza offset l'appuntamento arriverebbe alle Conferme sfalsato di due ore.
    const res = normalizzaLeadEntrante({
        ...RIGA_BASE, esito: 'APPUNTAMENTO', appuntamento: '2026-09-10T15:00:00',
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.lead.appuntamento, null);
    assert.match(res.lead.appuntamentoScartato ?? '', /fuso/);
});

test('una data su esito diverso da APPUNTAMENTO viene ignorata', () => {
    // Contratto: la data di un RICHIAMO non passa di li, o arriverebbe alle
    // Conferme come una call che non esiste. Ricontrollato comunque da questo lato.
    const res = normalizzaLeadEntrante({
        ...RIGA_BASE, esito: 'RICHIAMO', appuntamento: '2026-09-10T15:00:00+02:00',
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.lead.appuntamento, null);
    assert.match(res.lead.appuntamentoScartato ?? '', /RICHIAMO/);
});

test('esito APPUNTAMENTO senza data viene segnalato, non silenziato', () => {
    const res = normalizzaLeadEntrante({ ...RIGA_BASE, esito: 'APPUNTAMENTO', appuntamento: null });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.lead.appuntamento, null);
    assert.match(res.lead.appuntamentoScartato ?? '', /senza data/);
});

test('chatApertaAlBot: solo active e replying, con ramo di default chiuso', () => {
    assert.equal(chatApertaAlBot('active'), true);
    assert.equal(chatApertaAlBot('replying'), true);
    assert.equal(chatApertaAlBot('closed'), false);
    assert.equal(chatApertaAlBot('booked'), false);
    // Uno stato nuovo lato fornitore non deve mai passare per "chat aperta":
    // farebbe partire un'apertura a una persona vera.
    assert.equal(chatApertaAlBot('stato_che_non_esiste_ancora'), false);
    assert.equal(chatApertaAlBot(null), false);
});

test('senza lead esistenti si crea', () => {
    const azioni = pianificaAdozione([RIGA_BASE], new Map());
    assert.equal(azioni.length, 1);
    assert.equal(azioni[0].azione, 'crea');
});

test('numero gia nostro: si collega, non si duplica', () => {
    const azioni = pianificaAdozione([RIGA_BASE], new Map([['3200431888', [esistente()]]]));
    assert.equal(azioni[0].azione, 'collega');
    if (azioni[0].azione !== 'collega') return;
    assert.equal(azioni[0].esistente.id, 'lead-1');
    assert.equal(azioni[0].bloccato, false);
});

test('fra piu lead sullo stesso numero si prende il piu recente', () => {
    const vecchio = esistente({ id: 'vecchio', createdAt: new Date('2026-05-01T00:00:00Z') });
    const nuovo = esistente({ id: 'nuovo', createdAt: new Date('2026-08-30T00:00:00Z') });
    const azioni = pianificaAdozione([RIGA_BASE], new Map([['3200431888', [vecchio, nuovo]]]));
    assert.equal(azioni[0].azione, 'collega');
    if (azioni[0].azione !== 'collega') return;
    assert.equal(azioni[0].esistente.id, 'nuovo');
});

test('lead con appuntamento o presenza latchata risulta bloccato', () => {
    const conAppuntamento = pianificaAdozione([RIGA_BASE], new Map([['3200431888', [esistente({ status: 'APPOINTMENT' })]]]));
    assert.equal(conAppuntamento[0].azione === 'collega' && conAppuntamento[0].bloccato, true);

    const presentato = pianificaAdozione([RIGA_BASE], new Map([[
        '3200431888', [esistente({ status: 'IN_PROGRESS', presentedAt: new Date('2026-07-20T00:00:00Z') })],
    ]]));
    assert.equal(presentato[0].azione === 'collega' && presentato[0].bloccato, true);
});

test('un contatto di un altra azienda non genera un doppione Fenice', () => {
    const azioni = pianificaAdozione([RIGA_BASE], new Map([['3200431888', [esistente({ companyId: 'serenamente' })]]]));
    assert.equal(azioni[0].azione, 'scarta');
    if (azioni[0].azione !== 'scarta') return;
    assert.equal(azioni[0].motivo, 'altra_azienda');
});

test('due righe sullo stesso numero nello stesso batch producono un lead solo', () => {
    const azioni = pianificaAdozione(
        [RIGA_BASE, { ...RIGA_BASE, conversationId: 9999 }],
        new Map(),
    );
    assert.equal(azioni[0].azione, 'crea');
    assert.equal(azioni[1].azione, 'scarta');
    if (azioni[1].azione !== 'scarta') return;
    assert.equal(azioni[1].motivo, 'duplicato_nel_batch');
});

test('formati diversi dello stesso numero contano come la stessa persona', () => {
    // 3200431888 / +39 320 043 1888: la dedup e sulle ultime 10 cifre, come il push.
    const azioni = pianificaAdozione(
        [RIGA_BASE, { ...RIGA_BASE, telefono: '320 043 1888' }],
        new Map(),
    );
    assert.equal(azioni[1].azione, 'scarta');
});

test('intakeSicuro: solo con botHaRisposto esplicitamente true', () => {
    // La finestra "adottato e non ancora risposto" e' l'unico caso in cui la
    // guardia dell'altro lato non scatta e l'apertura parte davvero. Di norma
    // dura qualche decina di secondi, ma se il loro drain si pianta (credito a
    // zero: gia' successo) non ha limite superiore.
    const base = normalizzaLeadEntrante({ ...RIGA_BASE, botHaRisposto: true });
    assert.equal(base.ok && intakeSicuro(base.lead), true);

    const muto = normalizzaLeadEntrante({ ...RIGA_BASE, botHaRisposto: false });
    assert.equal(muto.ok && muto.lead.botHaRisposto, false);
    assert.equal(muto.ok && intakeSicuro(muto.lead), false);
});

test('botHaRisposto assente resta null e blocca come false', () => {
    // Campo non dichiarato (deploy vecchio o rollback dall'altro lato): non e'
    // un "no" ma nemmeno un "si". Blocca, e resta distinguibile nel riepilogo
    // perche' e' un guasto da guardare, non un lead da aspettare.
    const res = normalizzaLeadEntrante(RIGA_BASE);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.lead.botHaRisposto, null);
    assert.equal(intakeSicuro(res.lead), false);
});

test('lo stato della chat non protegge dalla finestra senza outbound', () => {
    // In quella finestra statoBot e' 'active': guardare lo stato non basta, ed
    // e' il motivo per cui intakeSicuro non guarda lo stato.
    const res = normalizzaLeadEntrante({ ...RIGA_BASE, statoBot: 'active', botHaRisposto: false });
    assert.equal(res.ok && chatApertaAlBot(res.lead.statoBot), true);
    assert.equal(res.ok && intakeSicuro(res.lead), false);
});
