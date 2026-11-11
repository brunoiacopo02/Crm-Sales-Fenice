import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BATCH_DATABASE_BOT, SCAGLIONE_DATABASE_DEFAULT, GIORNI_CODA_DATABASE_DEFAULT,
    MAX_TENTATIVI_FALLITI, GIORNI_FERMO_DEFAULT, ingressoAllargato, scartoCheChiude, type PersonaDatabase, azioneDaPush, eLeadDatabase, leggiConfigDatabaseAlBot, motivoNonIdoneo, type CandidatoDatabase,
} from './database'
import { scegliLeadEsistente } from './payload'
import { ripresaVaAlGdo } from '@/lib/bot-fissatore/ripresaChat'
import { BATCH_SENSO_UNICO, BATCH_ESCLUSI_DAI_KPI, BATCH_FREDDI } from '@/lib/intakeBatch'

function c(p: Partial<CandidatoDatabase> = {}): CandidatoDatabase {
    return {
        id: 'l1', status: 'NEW', assignedToId: null, appointmentDate: null, presentedAt: null,
        phoneSuspicious: false, isTest: false, intakeBatch: null, toccatoDalBot: false, giaGestito: false,
        doppioneOccupato: false, tentativiFalliti: 0, ...p,
    }
}

test('segno del marketing: solo database === true (booleano) sul singolo lead', () => {
    assert.equal(eLeadDatabase({ database: true }), true)
    assert.equal(eLeadDatabase({ database: 'true' }), false)
    assert.equal(eLeadDatabase({ database: 1 }), false)
    assert.equal(eLeadDatabase({ funnel_origine: 'database' }), false, 'il funnel di origine NON basta: e\' gia\' usato per i lead ordinari')
    assert.equal(eLeadDatabase({}), false)
    assert.equal(eLeadDatabase(null), false)
    assert.equal(eLeadDatabase([true]), false)
})

test('config: SPENTO di default, acceso solo con MKT_DATABASE_BOT=on esplicito', () => {
    assert.equal(leggiConfigDatabaseAlBot({}).attivo, false)
    assert.equal(leggiConfigDatabaseAlBot({ MKT_DATABASE_BOT: 'off' }).attivo, false)
    assert.equal(leggiConfigDatabaseAlBot({ MKT_DATABASE_BOT: 'boh' }).attivo, false)
    assert.equal(leggiConfigDatabaseAlBot({ MKT_DATABASE_BOT: ' ON ' }).attivo, true)
    assert.equal(leggiConfigDatabaseAlBot({}).scaglione, SCAGLIONE_DATABASE_DEFAULT)
    assert.equal(leggiConfigDatabaseAlBot({}).giorniCoda, GIORNI_CODA_DATABASE_DEFAULT)
    assert.equal(leggiConfigDatabaseAlBot({ MKT_DATABASE_BOT_BATCH: '999' }).scaglione, SCAGLIONE_DATABASE_DEFAULT)
    assert.equal(leggiConfigDatabaseAlBot({ MKT_DATABASE_BOT_BATCH: '5' }).scaglione, 5)
})

test('idoneita: solo lead liberi, mai di un GDO, mai con appuntamento, mai gia\' del bot', () => {
    assert.equal(motivoNonIdoneo(c()), null)
    assert.equal(motivoNonIdoneo(c({ callCount: 3 } as never)), null, 'gia\' chiamato da un GDO ma libero: va bene')
    assert.equal(motivoNonIdoneo(c({ isTest: true })), 'test')
    assert.equal(motivoNonIdoneo(c({ giaGestito: true })), 'gia_gestito')
    assert.equal(motivoNonIdoneo(c({ phoneSuspicious: true })), 'telefono_sospetto')
    assert.equal(motivoNonIdoneo(c({ assignedToId: 'gdo-105' })), 'di_qualcuno')
    assert.equal(motivoNonIdoneo(c({ appointmentDate: new Date() })), 'appuntamento')
    assert.equal(motivoNonIdoneo(c({ presentedAt: new Date() })), 'appuntamento')
    assert.equal(motivoNonIdoneo(c({ status: 'REJECTED' })), 'stato')
    assert.equal(motivoNonIdoneo(c({ status: 'APPOINTMENT' })), 'stato')
    assert.equal(motivoNonIdoneo(c({ toccatoDalBot: true })), 'toccato_dal_bot')
    assert.equal(motivoNonIdoneo(c({ intakeBatch: 'DB_LISTA133_20260915' })), null)
    assert.equal(motivoNonIdoneo(c({ intakeBatch: BATCH_DATABASE_BOT })), null)
    assert.equal(motivoNonIdoneo(c({ intakeBatch: 'ALTRA_INFORNATA' })), 'batch_diverso')
})

test('risposta del bot: aperto o forse aperto = all\'account bot; mai riproporre un timeout', () => {
    assert.deepEqual(azioneDaPush({ result: 'sent' }), { tipo: 'assegna', esito: 'aperto' })
    assert.deepEqual(azioneDaPush({ result: 'duplicate' }), { tipo: 'assegna', esito: 'aperto_duplicato' })
    assert.deepEqual(azioneDaPush({ result: 'not_accepted', motivo: 'apertura_non_partita' }), { tipo: 'assegna', esito: 'apertura_non_partita' })
})

test('risposta del bot: chat esistente o numero non valido = definitivo, il lead resta dov\'e\'', () => {
    assert.equal(azioneDaPush({ result: 'not_accepted', motivo: 'database_chat_esistente' }).tipo, 'definitivo')
    assert.equal(azioneDaPush({ result: 'not_accepted', motivo: 'telefono_non_valido' }).tipo, 'definitivo')
})

test('risposta del bot: "non adesso" e timeout = riprova e il giro si ferma, senza toccare il lead', () => {
    for (const r of [
        { result: 'not_accepted', motivo: 'database_non_aperto' },
        { result: 'network_error' }, { result: 'rate_limited' }, { result: 'missing_env' },
        { result: 'skipped_disabled' }, { result: 'skipped_prova' },
    ]) assert.deepEqual([azioneDaPush(r).tipo, (azioneDaPush(r) as { globale?: boolean }).globale], ['riprova', true], JSON.stringify(r))
})

test('risposta del bot: errore del solo lead = si salta lui, la coda non si blocca; dopo 3 esce dai candidati', () => {
    for (const r of [{ result: 'not_accepted', motivo: 'arruolamento_fallito' }, { result: 'http_error' }]) {
        assert.deepEqual([azioneDaPush(r).tipo, (azioneDaPush(r) as { globale?: boolean }).globale], ['riprova', false], JSON.stringify(r))
    }
    assert.equal(motivoNonIdoneo(c({ tentativiFalliti: 2 })), null)
    assert.equal(motivoNonIdoneo(c({ tentativiFalliti: MAX_TENTATIVI_FALLITI })), 'troppi_errori')
})

test('doppione con lo stesso numero in mano a una persona o con appuntamento: fuori', () => {
    assert.equal(motivoNonIdoneo(c({ doppioneOccupato: true })), 'doppione_occupato')
})

test('lead della coda vecchia archiviato (MKT_CODA_VECCHI_ARCH + TOLTO_AL_BOT) rimandato con database:true: si riprende', () => {
    // Com'e' oggi nel CRM (letto l'11/11): NEW, di nessuno, nessuna infornata, mai passato dal bot.
    // Il bucket e l'evento TOLTO_AL_BOT non lo bloccano; applica.ts lo ritrova per contatto
    // marketing o telefono, quindi niente scheda doppia.
    assert.equal(motivoNonIdoneo(c({ id: 'archiviato', status: 'NEW', assignedToId: null, intakeBatch: null })), null)
    const cerca = { marketingContactId: 'mk-9', phone: '+393331234567', email: null, perChiave: true }
    const archiviato = { id: 'archiviato', marketingContactId: 'mk-9', phone: '+393331234567', email: null, createdAt: new Date('2026-10-20') }
    assert.equal(scegliLeadEsistente(cerca, [archiviato])?.id, 'archiviato')
})

test('telefono normalizzato: +39 / spazi / senza prefisso sono la stessa scheda (solo per i lead di database)', () => {
    const vecchia = { id: 'v', marketingContactId: null, phone: '333 123 4567', email: null, createdAt: new Date('2025-03-01') }
    const conPrefisso = { id: 'p', marketingContactId: null, phone: '0039 3331234567', email: null, createdAt: new Date('2025-01-01') }
    const database = { marketingContactId: 'mk-1', phone: '+393331234567', email: null, perChiave: true }
    assert.equal(scegliLeadEsistente(database, [vecchia])?.id, 'v')
    assert.equal(scegliLeadEsistente(database, [conPrefisso])?.id, 'p')
    // Il flusso ordinario resta col confronto esatto di sempre.
    assert.equal(scegliLeadEsistente({ ...database, perChiave: false }, [vecchia]), null)
    // Numero diverso: nessun aggancio.
    assert.equal(scegliLeadEsistente(database, [{ ...vecchia, phone: '333 123 4568' }]), null)
})

test('nessun ritorno ai GDO: un lead di database che riscrive dopo lo scarto resta fuori', () => {
    const lead = {
        assignedToId: null, status: 'NEW', appointmentDate: null, presentedAt: null, launchBucket: null,
        funnel: 'Database', lancioPool: null, humanTestCohort: null, isTest: false, intakeBatch: BATCH_DATABASE_BOT,
    }
    assert.equal(ripresaVaAlGdo(lead), false)
    assert.equal(ripresaVaAlGdo({ ...lead, intakeBatch: null }), true)
})

test('infornata database: a senso unico, ma NON tolta dai KPI ne\' trattata da coda fredda', () => {
    assert.ok(BATCH_SENSO_UNICO.includes(BATCH_DATABASE_BOT))
    assert.ok(!BATCH_ESCLUSI_DAI_KPI.includes(BATCH_DATABASE_BOT))
    assert.ok(!BATCH_FREDDI.includes(BATCH_DATABASE_BOT))
})

// ── Ingresso allargato (proposta PO 11/11/2026: fermo da 14 giorni, GDO mai chiamati) ──
const ORA = Date.parse('2026-11-11T17:00:00+01:00')
const G = 24 * 3600_000
function persona(p: Partial<PersonaDatabase> = {}): PersonaDatabase {
    return {
        ultimoContattoMs: ORA - 30 * G, chiamateScheda: 0, callCount: 0, recallDate: null, appuntamentoVicino: false,
        cliente: false, richiamoFissato: false, scartoChiuso: false, assegnatoAPersona: false,
        blackFridayAperto: false, lancioInLavorazione: false, ...p,
    }
}
const ent = (l: Partial<CandidatoDatabase>, p: Partial<PersonaDatabase> = {}) =>
    ingressoAllargato(c(l), persona(p), { nowMs: ORA, giorniFermo: 14 })

test('allargato: config spenta di default, giorni_fermo 14 di default e modificabile', () => {
    assert.equal(leggiConfigDatabaseAlBot({}).allargato, false)
    assert.equal(leggiConfigDatabaseAlBot({ MKT_DATABASE_ALLARGATO: 'on' }).allargato, true)
    assert.equal(leggiConfigDatabaseAlBot({}).giorniFermo, GIORNI_FERMO_DEFAULT)
    assert.equal(GIORNI_FERMO_DEFAULT, 14)
    assert.equal(leggiConfigDatabaseAlBot({ MKT_DATABASE_GIORNI_FERMO: '21' }).giorniFermo, 21)
})

test('allargato: lead di un GDO con 0 chiamate e nessun richiamo va al bot SUBITO, anche se appena assegnato', () => {
    assert.deepEqual(ent({ assignedToId: 'gdo-105' }, { assegnatoAPersona: true, ultimoContattoMs: ORA - G }), { regola: 'gdo_mai_chiamato' })
    assert.deepEqual(ent({ assignedToId: 'gdo-105', status: 'IN_PROGRESS' }, { assegnatoAPersona: true, ultimoContattoMs: null }), { regola: 'gdo_mai_chiamato' })
})

test('allargato: un GDO che lo sta lavorando (chiamate, contatto recente) lo tiene; fermo da 14 giorni no', () => {
    const lavorato = { assignedToId: 'gdo-105', status: 'IN_PROGRESS' }
    assert.deepEqual(ent(lavorato, { assegnatoAPersona: true, chiamateScheda: 2, callCount: 2, ultimoContattoMs: ORA - 3 * G }), { motivo: 'gdo_al_lavoro' })
    assert.deepEqual(ent(lavorato, { assegnatoAPersona: true, chiamateScheda: 2, callCount: 2, ultimoContattoMs: ORA - 20 * G }), { regola: 'fermo' })
})

test('allargato: scartati, esitati e gia scritti dal bot entrano solo se fermi', () => {
    const scartato = { status: 'REJECTED', assignedToId: 'gdo-112' }
    assert.deepEqual(ent(scartato, { assegnatoAPersona: true, chiamateScheda: 4, ultimoContattoMs: ORA - 15 * G }), { regola: 'fermo' })
    assert.deepEqual(ent(scartato, { assegnatoAPersona: true, chiamateScheda: 4, ultimoContattoMs: ORA - 13 * G }), { motivo: 'non_fermo' })
    assert.deepEqual(ent({ toccatoDalBot: true }, { ultimoContattoMs: ORA - 40 * G }), { regola: 'fermo' })
    assert.deepEqual(ent({ toccatoDalBot: true }, { ultimoContattoMs: ORA - 2 * G }), { motivo: 'non_fermo' })
    // Libero, NEW, mai scritto dal bot: entra come prima, senza attendere.
    assert.deepEqual(ent({}, { ultimoContattoMs: ORA - G }), { regola: 'libero_nuovo' })
    // Esitato dal venditore ("Sparito", senza presenza) e fermo: entra.
    assert.deepEqual(ent({ status: 'APPOINTMENT', appointmentDate: new Date(ORA - 40 * G) }, { ultimoContattoMs: ORA - 30 * G }), { regola: 'fermo' })
})

test('allargato: restano SEMPRE fuori clienti, appuntamenti vicini, richiami, scarti che chiudono, BF e lancio aperti, presenze', () => {
    assert.deepEqual(ent({}, { cliente: true }), { motivo: 'cliente' })
    assert.deepEqual(ent({}, { appuntamentoVicino: true }), { motivo: 'appuntamento_vicino' })
    assert.deepEqual(ent({ assignedToId: 'gdo-1' }, { assegnatoAPersona: true, richiamoFissato: true }), { motivo: 'richiamo' })
    // Un richiamo vecchio su un appuntamento chiuso non blocca (lo blocca solo una scheda aperta).
    assert.deepEqual(ent({ status: 'APPOINTMENT', appointmentDate: new Date(ORA - 100 * G) }, { recallDate: new Date(ORA - 100 * G), ultimoContattoMs: ORA - 90 * G }), { regola: 'fermo' })
    assert.deepEqual(ent({ status: 'APPOINTMENT', appointmentDate: new Date(ORA - 40 * G), assignedToId: 'gdo-106' }, { assegnatoAPersona: true, chiamateScheda: 1, ultimoContattoMs: ORA - 30 * G }), { motivo: 'appuntamento_storico_gdo' })
    assert.deepEqual(ent({ status: 'REJECTED' }, { scartoChiuso: true }), { motivo: 'scarto_chiuso' })
    assert.deepEqual(ent({}, { blackFridayAperto: true }), { motivo: 'black_friday' })
    assert.deepEqual(ent({}, { lancioInLavorazione: true }), { motivo: 'lancio' })
    assert.deepEqual(ent({ status: 'APPOINTMENT', presentedAt: new Date(ORA - 60 * G) }, { ultimoContattoMs: ORA - 60 * G }), { motivo: 'presenza_storica' })
    assert.deepEqual(ent({ id: '306abd1c-qualcosa' }), { motivo: 'mai_toccare' })
    assert.deepEqual(ent({ giaGestito: true }), { motivo: 'gia_gestito' })
})

test('scarti che chiudono per sempre: non interessato, non in target, numero sbagliato/inesistente, gia cliente', () => {
    for (const m of ['non interessato', 'Non interessata', 'non in target', 'numero inesistente', 'numero sbagliato', 'doppione - persona già cliente']) {
        assert.equal(scartoCheChiude(m), true, m)
    }
    for (const m of ['irreperibile (4 tentativi vuoti)', 'solo informazioni', 'non ha potere decisionale', null]) {
        assert.equal(scartoCheChiude(m), false, String(m))
    }
})

test('risposta del bot: chat ancora viva o quota riaperture = si salta il lead, il giro continua', () => {
    assert.deepEqual(azioneDaPush({ result: 'not_accepted', motivo: 'database_chat_attiva' }), { tipo: 'riprova', esito: 'chat_attiva', globale: false })
})
