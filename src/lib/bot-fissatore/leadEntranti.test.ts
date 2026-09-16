import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizzaLeadEntrante,
    pianificaAdozione,
    chatApertaAlBot,
    intakeSicuro,
    nomePlausibile,
    isProvenienzaLancioWebDev,
    candidatiPerAdozione,
    valoriNuovoLead,
    eventiNuovoLead,
    serveIngressoPulsante,
    eventoIngressoCollegato,
    NOME_FALLBACK,
    FUNNEL_FALLBACK,
    SOURCE_INBOUND,
    type LeadEsistente,
    type LeadEntranteRaw,
} from './leadEntranti';
import { LANCIO_BUCKET, LANCIO_FUNNEL, LANCIO_SLUG } from '@/lib/lancio/intake';

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

test('nomePlausibile: passa i nomi veri, ferma la spazzatura riconoscibile', () => {
    for (const buono of ['Monia', 'Maria Teresa Del Giudice', "Giuseppe D'Amico", 'Jean-Luc Picard']) {
        assert.equal(nomePlausibile(buono), true, buono);
    }
    for (const cattivo of [
        'A',                                  // troppo corto
        'Marco 3391234567',                   // cifre: e' un numero, non un nome
        'mario.rossi@example.com',            // email
        'https://esempio.it',                 // URL
        'C:' + String.fromCharCode(92) + 'Users',  // percorso, non una persona
        'sono la mamma di Luca',              // frase: 5 parole
        'x'.repeat(61),                       // lunghezza assurda
    ]) {
        assert.equal(nomePlausibile(cattivo), false, cattivo);
    }
});

test('un nome implausibile ricade sul fallback e NON scarta il lead', () => {
    // Quella persona esiste e va chiamata: perdere il lead per un nome sbagliato
    // sarebbe peggio del nome sbagliato.
    const res = normalizzaLeadEntrante({ ...RIGA_BASE, nome: 'sono la mamma di Luca' });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.lead.name, NOME_FALLBACK);
    assert.equal(res.lead.phone, '+393200431888');
});

// ---------------------------------------------------------------------------
// Lancio Web Dev AI: la terza provenienza (pulsante WhatsApp del webinar).
// I lead di Telegram che scrivono per primi sono "roba molto diversa" (PO,
// 14/09) e devono restare identici a oggi: i test qui sotto lo mettono per
// iscritto riga per riga, non solo campo per campo.
// ---------------------------------------------------------------------------

const ADESSO = new Date('2026-10-05T21:40:00+02:00');

function normalizzato(provenienza: string, over: Partial<LeadEntranteRaw> = {}) {
    const res = normalizzaLeadEntrante({ ...RIGA_BASE, provenienza, ...over });
    assert.equal(res.ok, true);
    if (!res.ok) throw new Error('unreachable');
    return res.lead;
}

test('isProvenienzaLancioWebDev: riconosce il valore del pulsante in ogni caso/spaziatura, e solo quello', () => {
    assert.equal(isProvenienzaLancioWebDev('Lancio Web Dev AI'), true);
    assert.equal(isProvenienzaLancioWebDev('LANCIO WEB DEV AI'), true);   // come esce da normalizzaLeadEntrante
    assert.equal(isProvenienzaLancioWebDev('  lancio   web dev ai '), true);
    assert.equal(isProvenienzaLancioWebDev('TELEGRAM'), false);
    assert.equal(isProvenienzaLancioWebDev('INBOUND'), false);
    assert.equal(isProvenienzaLancioWebDev('SCONOSCIUTO'), false);
    assert.equal(isProvenienzaLancioWebDev('Lancio Web Developer AI'), false); // il nome della lista AC non e' il funnel
    assert.equal(isProvenienzaLancioWebDev(''), false);
    assert.equal(isProvenienzaLancioWebDev(null), false);
    assert.equal(isProvenienzaLancioWebDev(undefined), false);
});

test('valoriNuovoLead: TELEGRAM resta il lead entrante di oggi (funnel grezzo, nessun bucket)', () => {
    const v = valoriNuovoLead(normalizzato('TELEGRAM'), 'bot-1', ADESSO, 'id-1');
    assert.equal(v.funnel, 'TELEGRAM');
    assert.equal(v.launchBucket, null);
    assert.equal(v.lancioIngresso, null);
    assert.equal(v.assignedToId, 'bot-1');
    assert.equal(v.source, SOURCE_INBOUND);
    assert.equal(v.status, 'NEW');
    assert.equal(v.createdAt.toISOString(), '2026-08-26T19:51:52.000Z'); // scrittoIl
    assert.equal(v.assignedAt, ADESSO);
});

test('valoriNuovoLead: la riga TELEGRAM e byte per byte quella che si scriveva prima del lancio', () => {
    // Prova esplicita della richiesta del PO: nessun campo nuovo che cambia il
    // significato, nessun campo cambiato sul percorso che esisteva gia'.
    const v = valoriNuovoLead(normalizzato('TELEGRAM'), 'bot-1', ADESSO, 'id-1');
    assert.deepEqual(v, {
        id: 'id-1',
        name: NOME_FALLBACK,
        phone: '+393200431888',
        email: null,
        funnel: 'TELEGRAM',
        source: SOURCE_INBOUND,
        status: 'NEW',
        callCount: 0,
        assignedToId: 'bot-1',
        createdAt: new Date('2026-08-26T21:51:52+02:00'),
        assignedAt: ADESSO,
        updatedAt: ADESSO,
        companyId: 'fenice',
        launchBucket: null,
        lancioIngresso: null,
    });
});

test('valoriNuovoLead: senza scrittoIl createdAt ricade su adesso, come prima', () => {
    const v = valoriNuovoLead(normalizzato('TELEGRAM', { scrittoIl: null }), 'bot-1', ADESSO, 'id-1');
    assert.equal(v.createdAt, ADESSO);
});

test('valoriNuovoLead: INBOUND identico a TELEGRAM salvo il funnel', () => {
    const v = valoriNuovoLead(normalizzato('INBOUND'), 'bot-1', ADESSO, 'id-2');
    assert.equal(v.funnel, 'INBOUND');
    assert.equal(v.launchBucket, null);
    assert.equal(v.lancioIngresso, null);
});

test('valoriNuovoLead: provenienza vuota resta SCONOSCIUTO e fuori dal lancio', () => {
    const v = valoriNuovoLead(normalizzato(''), 'bot-1', ADESSO, 'id-4');
    assert.equal(v.funnel, FUNNEL_FALLBACK);
    assert.equal(v.launchBucket, null);
});

test('valoriNuovoLead: Lancio Web Dev AI -> funnel canonico, bucket, ingresso pulsante, assegnato al bot', () => {
    const v = valoriNuovoLead(normalizzato('Lancio Web Dev AI'), 'bot-1', ADESSO, 'id-3');
    assert.equal(v.funnel, LANCIO_FUNNEL);          // NON 'LANCIO WEB DEV AI'
    assert.equal(v.launchBucket, LANCIO_BUCKET);
    assert.equal(v.lancioIngresso, 'pulsante_webinar');
    assert.equal(v.assignedToId, 'bot-1');
    assert.equal(v.source, SOURCE_INBOUND);
    assert.equal(v.status, 'NEW');
    assert.equal(v.assignedAt, ADESSO);
    assert.equal(v.companyId, 'fenice');
});

test('eventiNuovoLead: i lead entranti normali hanno IMPORTED + ASSIGNED, il lancio ha in piu LANCIO_INTAKE', () => {
    const t = normalizzato('TELEGRAM');
    const eventiT = eventiNuovoLead(t, valoriNuovoLead(t, 'bot-1', ADESSO, 'id-1'));
    assert.deepEqual(eventiT.map((e) => e.eventType), ['IMPORTED', 'ASSIGNED']);
    assert.equal(eventiT[0].metadata.provenienza, 'TELEGRAM');
    assert.equal(eventiT[1].metadata.routing, undefined);

    const l = normalizzato('Lancio Web Dev AI');
    const eventiL = eventiNuovoLead(l, valoriNuovoLead(l, 'bot-1', ADESSO, 'id-3'));
    assert.deepEqual(eventiL.map((e) => e.eventType), ['IMPORTED', 'ASSIGNED', 'LANCIO_INTAKE']);
    assert.equal(eventiL[1].metadata.routing, 'lancio');
    assert.equal(eventiL[2].metadata.ingresso, 'pulsante_webinar');
    assert.equal(eventiL[2].metadata.bucket, LANCIO_BUCKET);
    assert.equal(eventiL[2].metadata.slug, LANCIO_SLUG);
    assert.equal(eventiL[2].metadata.via, 'lead_entrante');
});

test('eventiNuovoLead: gli eventi di un TELEGRAM sono quelli di oggi, metadata compreso', () => {
    const t = normalizzato('TELEGRAM');
    const eventi = eventiNuovoLead(t, valoriNuovoLead(t, 'bot-1', ADESSO, 'id-1'));
    assert.deepEqual(eventi, [
        {
            eventType: 'IMPORTED',
            toSection: 'Prima Chiamata',
            metadata: {
                source: SOURCE_INBOUND,
                provenienza: 'TELEGRAM',
                conversationId: 7246,
                statoBot: 'active',
                scrittoIl: '2026-08-26T19:51:52.000Z',
            },
        },
        {
            eventType: 'ASSIGNED',
            metadata: { assignedToUser: 'bot-1', source: SOURCE_INBOUND, adozioneChatEntrante: true },
        },
    ]);
});

test('candidatiPerAdozione: fuori dal lancio vale il piu recente di qualunque funnel; nel lancio solo chi e gia nel bucket', () => {
    const vecchioGdo = esistente({ id: 'gdo', createdAt: new Date('2026-05-01T00:00:00Z'), launchBucket: null });
    const nelBucket = esistente({ id: 'lancio', createdAt: new Date('2026-09-20T00:00:00Z'), launchBucket: LANCIO_BUCKET });
    assert.deepEqual(candidatiPerAdozione([vecchioGdo], false).map((c) => c.id), ['gdo']);
    assert.deepEqual(candidatiPerAdozione([vecchioGdo], true), []);            // duplicato cross-funnel voluto
    assert.deepEqual(candidatiPerAdozione([vecchioGdo, nelBucket], true).map((c) => c.id), ['lancio']);
    assert.deepEqual(candidatiPerAdozione([vecchioGdo, nelBucket], false).length, 2);
    // Un bucket di un altro lancio non e' questo lancio.
    assert.deepEqual(candidatiPerAdozione([esistente({ id: 'altro', launchBucket: 'ALTRO_2027' })], true), []);
    // `launchBucket` assente (lead letto da una query vecchia) non e' nel bucket.
    assert.deepEqual(candidatiPerAdozione([esistente({ id: 'senza' })], true), []);
});

test('serveIngressoPulsante: solo nel lancio, solo sui lead del bucket, e mai due volte', () => {
    const nelBucket = { launchBucket: LANCIO_BUCKET, lancioIngresso: 'lista' };
    // Chi era in lista ed e' stato distribuito a un GDO umano: il pulsante lo
    // rimette in mano al bot senza togliere il lead al GDO.
    assert.equal(serveIngressoPulsante(nelBucket, true), true);
    // Gia' a posto: il push si ripete, e un secondo giro non deve riscrivere
    // niente ne' duplicare l'evento.
    assert.equal(serveIngressoPulsante({ launchBucket: LANCIO_BUCKET, lancioIngresso: 'pulsante_webinar' }, true), false);
    // Provenienza non del lancio: non si tocca niente.
    assert.equal(serveIngressoPulsante(nelBucket, false), false);
    // Fuori dal bucket non esiste ingresso di lancio da scrivere.
    assert.equal(serveIngressoPulsante({ launchBucket: null, lancioIngresso: null }, true), false);
    assert.equal(serveIngressoPulsante({ launchBucket: 'ALTRO_2027', lancioIngresso: null }, true), false);
    // Lead del bucket senza ingresso (riga vecchia): si riempie.
    assert.equal(serveIngressoPulsante({ launchBucket: LANCIO_BUCKET, lancioIngresso: null }, true), true);
});

test('eventoIngressoCollegato: LANCIO_INTAKE tracciabile, con collegato=true', () => {
    const ev = eventoIngressoCollegato(normalizzato('Lancio Web Dev AI'));
    assert.equal(ev.eventType, 'LANCIO_INTAKE');
    assert.equal(ev.toSection, undefined);   // non e' un ingresso in pipeline: il lead c'era gia'
    assert.deepEqual(ev.metadata, {
        slug: LANCIO_SLUG,
        ingresso: 'pulsante_webinar',
        via: 'lead_entrante',
        collegato: true,
        bucket: LANCIO_BUCKET,
        funnel: LANCIO_FUNNEL,
        conversationId: 7246,
    });
});
