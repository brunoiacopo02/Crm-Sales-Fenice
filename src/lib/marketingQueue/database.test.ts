import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BATCH_DATABASE_BOT, SCAGLIONE_DATABASE_DEFAULT, GIORNI_CODA_DATABASE_DEFAULT,
    MAX_TENTATIVI_FALLITI, GIORNI_FERMO_DEFAULT, ingressoAllargato, scartoCheChiude, scartoChiusoPersona, segnoDatabaseSql, CAMPI_PROVENIENZA_CODA, type PersonaDatabase, azioneDaPush, eLeadDatabase, leggiConfigDatabaseAlBot, motivoNonIdoneo, type CandidatoDatabase,
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

test('segno del marketing: database === true (booleano) oppure provenienza "database" (PO 12/11/2026)', () => {
    assert.equal(eLeadDatabase({ database: true }), true)
    assert.equal(eLeadDatabase({ database: 'true' }), false)
    assert.equal(eLeadDatabase({ database: 1 }), false)
    // La provenienza: oggi arriva in `funnel_origine` (payload.ts); coperti anche gli altri nomi.
    for (const campo of ['funnel_origine', 'provenienza', 'funnel', 'source']) {
        assert.equal(eLeadDatabase({ [campo]: 'database' }), true, campo)
        assert.equal(eLeadDatabase({ [campo]: ' DataBase ' }), true, `${campo} maiuscole e spazi`)
        assert.equal(eLeadDatabase({ [campo]: 'corso10ore' }), false, campo)
        assert.equal(eLeadDatabase({ [campo]: 'database luglio' }), false, `${campo}: solo l'uguaglianza`)
    }
    assert.equal(eLeadDatabase({ funnel_origine: 'org', database: true }), true)
    assert.equal(eLeadDatabase({ motivo_chiamata: 'database' }), false)
    // La stessa regola in SQL, sugli stessi campi.
    const q = segnoDatabaseSql('mq.payload')
    assert.ok(q.includes(`mq.payload->'database' = 'true'::jsonb`))
    for (const campo of CAMPI_PROVENIENZA_CODA) assert.ok(q.includes(`lower(btrim(coalesce(mq.payload->>'${campo}', '')))`), campo)
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

// ── Ingresso allargato: la regola del PO del 12/11/2026 ("dobbiamo scrivere a tutti") ──
const ORA = Date.parse('2026-11-12T19:00:00+01:00')
const G = 24 * 3600_000
function persona(p: Partial<PersonaDatabase> = {}): PersonaDatabase {
    return {
        ultimoContattoMs: ORA - 30 * G, chiamateScheda: 0, callCount: 0, recallDate: null, appuntamentoFuturo: false,
        richiamoFissato: false, scartoChiuso: false, assegnatoAPersona: false, blackFridayAperto: false, ...p,
    }
}
const ent = (l: Partial<CandidatoDatabase>, p: Partial<PersonaDatabase> = {}) =>
    ingressoAllargato(c(l), persona(p), { nowMs: ORA, giorniFermo: 7 })

test('allargato: config spenta di default, giorni_fermo 14 di default e modificabile', () => {
    assert.equal(leggiConfigDatabaseAlBot({}).allargato, false)
    assert.equal(leggiConfigDatabaseAlBot({ MKT_DATABASE_ALLARGATO: 'on' }).allargato, true)
    assert.equal(leggiConfigDatabaseAlBot({}).giorniFermo, GIORNI_FERMO_DEFAULT)
    assert.equal(GIORNI_FERMO_DEFAULT, 14)
    assert.equal(leggiConfigDatabaseAlBot({ MKT_DATABASE_GIORNI_FERMO: '7' }).giorniFermo, 7)
})

test('allargato: lead di un GDO aperto con 0 chiamate va al bot SUBITO e la scheda si sposta', () => {
    assert.deepEqual(ent({ assignedToId: 'gdo-105' }, { assegnatoAPersona: true, ultimoContattoMs: ORA - G }), { regola: 'gdo_mai_chiamato', sposta: true })
    assert.deepEqual(ent({ assignedToId: 'gdo-105', status: 'IN_PROGRESS' }, { assegnatoAPersona: true, ultimoContattoMs: null }), { regola: 'gdo_mai_chiamato', sposta: true })
})

test('allargato: un GDO che lo sta lavorando lo tiene (si riporta, non si forza); fermo entra', () => {
    const lavorato = { assignedToId: 'gdo-105', status: 'IN_PROGRESS' }
    assert.deepEqual(ent(lavorato, { assegnatoAPersona: true, chiamateScheda: 2, callCount: 2, ultimoContattoMs: ORA - 3 * G }), { motivo: 'gdo_al_lavoro' })
    assert.deepEqual(ent(lavorato, { assegnatoAPersona: true, chiamateScheda: 2, callCount: 2, ultimoContattoMs: ORA - 20 * G }), { regola: 'fermo', sposta: true })
})

test('allargato: entrano TUTTI gli scartati (non interessato, non in target, irreperibili), i clienti, il lancio', () => {
    // `scartoChiuso` e' falso per questi motivi (vedi il test di scartoCheChiude): entrano.
    assert.deepEqual(ent({ status: 'REJECTED' }, {}), { regola: 'fermo', sposta: true })
    assert.deepEqual(ent({ status: 'REJECTED', toccatoDalBot: true, intakeBatch: 'DB_LISTA133_20260915' }, {}), { regola: 'fermo', sposta: true })
    // Lancio archiviato, libero, gia' scritto dal bot.
    assert.deepEqual(ent({ status: 'IN_PROGRESS', toccatoDalBot: true }, { callCount: 1, chiamateScheda: 1 }), { regola: 'fermo', sposta: true })
    // Libero, NEW, mai scritto dal bot: entra come prima, senza attendere.
    assert.deepEqual(ent({}, { ultimoContattoMs: ORA - G }), { regola: 'libero_nuovo', sposta: true })
})

test('allargato: la scheda NON si sposta se toglierebbe numeri a un GDO (appuntamento, presenza, suo scarto): si apre solo la chat', () => {
    // Scarto di un GDO: resta suo.
    assert.deepEqual(ent({ status: 'REJECTED', assignedToId: 'gdo-112' }, { assegnatoAPersona: true, chiamateScheda: 4 }), { regola: 'fermo', sposta: false })
    // Appuntamento passato di un GDO, senza presenza.
    assert.deepEqual(ent({ status: 'APPOINTMENT', appointmentDate: new Date(ORA - 40 * G), assignedToId: 'gdo-106' }, { assegnatoAPersona: true, chiamateScheda: 1 }), { regola: 'fermo', sposta: false })
    // Presenza storica (anche cliente "Chiuso"): dentro, scheda ferma.
    assert.deepEqual(ent({ status: 'APPOINTMENT', appointmentDate: new Date(ORA - 60 * G), presentedAt: new Date(ORA - 60 * G), assignedToId: 'gdo-112' }, { assegnatoAPersona: true, ultimoContattoMs: ORA - 60 * G }), { regola: 'fermo', sposta: false })
    // Presenza senza data di appuntamento: comunque ferma.
    assert.deepEqual(ent({ status: 'APPOINTMENT', presentedAt: new Date(ORA - 60 * G), assignedToId: 'gdo-112' }, { assegnatoAPersona: true }), { regola: 'fermo', sposta: false })
    // Appuntamento vecchio gia' dell'account bot: non c'e' niente da spostare.
    assert.deepEqual(ent({ status: 'APPOINTMENT', appointmentDate: new Date(ORA - 35 * G), assignedToId: 'bot' }, {}), { regola: 'fermo', sposta: false })
})

test('allargato: restano fuori SOLO Marchioretto, test, telefono sospetto, numero sbagliato o non contattare, appuntamento futuro, vivi, BF aperto, gia gestiti', () => {
    assert.deepEqual(ent({ id: '306abd1c-qualcosa' }), { motivo: 'mai_toccare' })
    assert.deepEqual(ent({ isTest: true }), { motivo: 'test' })
    assert.deepEqual(ent({ phoneSuspicious: true }), { motivo: 'telefono_sospetto' })
    assert.deepEqual(ent({ status: 'REJECTED' }, { scartoChiuso: true }), { motivo: 'scarto_chiuso' })
    assert.deepEqual(ent({ status: 'REJECTED' }, { appuntamentoFuturo: true }), { motivo: 'appuntamento_futuro' })
    assert.deepEqual(ent({ assignedToId: 'gdo-1' }, { assegnatoAPersona: true, richiamoFissato: true }), { motivo: 'richiamo' })
    assert.deepEqual(ent({}, { blackFridayAperto: true }), { motivo: 'black_friday' })
    assert.deepEqual(ent({ giaGestito: true }), { motivo: 'gia_gestito' })
    // "Vivo": un contatto negli ultimi giorni (chat col bot, chiamata, esito).
    assert.deepEqual(ent({ status: 'REJECTED', toccatoDalBot: true }, { ultimoContattoMs: ORA - 2 * G }), { motivo: 'non_fermo' })
    assert.deepEqual(ent({ status: 'REJECTED', toccatoDalBot: true }, { ultimoContattoMs: ORA - 8 * G }), { regola: 'fermo', sposta: true })
    // Un richiamo vecchio su un appuntamento chiuso non blocca.
    assert.deepEqual(ent({ status: 'APPOINTMENT', appointmentDate: new Date(ORA - 100 * G) }, { recallDate: new Date(ORA - 100 * G), ultimoContattoMs: ORA - 90 * G }), { regola: 'fermo', sposta: false })
})

test('scarti che tengono fuori: solo numero sbagliato/inesistente e richiesta di non essere contattato', () => {
    for (const m of ['numero inesistente', 'numero sbagliato', 'Numero errato', 'non contattare', 'non vuole essere ricontattato', 'opt-out']) {
        assert.equal(scartoCheChiude(m), true, m)
    }
    for (const m of ['non interessato', 'Non interessata', 'non in target', 'doppione - persona già cliente', 'irreperibile (4 tentativi vuoti)', 'solo informazioni', 'non ha potere decisionale', null]) {
        assert.equal(scartoCheChiude(m), false, String(m))
    }
})

test('scarto della persona: "numero inesistente" su un doppione non chiude se il numero e\' provato buono', () => {
    const altra = ['numero inesistente', 'non interessato']
    // Scarto della scheda in coda: fuori comunque.
    assert.equal(scartoChiusoPersona({ scartoScheda: 'numero inesistente', scartiPersona: ['numero inesistente'], numeroProvato: true }), true)
    // Solo su un'altra scheda, e il bot ci ha parlato o c'e' un appuntamento: entra.
    assert.equal(scartoChiusoPersona({ scartoScheda: 'non interessato', scartiPersona: altra, numeroProvato: true }), false)
    assert.equal(scartoChiusoPersona({ scartoScheda: null, scartiPersona: altra, numeroProvato: true }), false)
    // Solo su un'altra scheda e nessuna prova: fuori.
    assert.equal(scartoChiusoPersona({ scartoScheda: null, scartiPersona: altra, numeroProvato: false }), true)
    // "Non contattare" vale su qualunque scheda, sempre.
    assert.equal(scartoChiusoPersona({ scartoScheda: null, scartiPersona: ['non contattare'], numeroProvato: true }), true)
    assert.equal(scartoChiusoPersona({ scartoScheda: 'non interessato', scartiPersona: ['non interessato', 'doppione - persona già cliente'], numeroProvato: false }), false)
})

test('risposta del bot: chat ancora viva o quota riaperture = si salta il lead, il giro continua', () => {
    assert.deepEqual(azioneDaPush({ result: 'not_accepted', motivo: 'database_chat_attiva' }), { tipo: 'riprova', esito: 'chat_attiva', globale: false })
})

test('risposta del bot: numero della chat da riaprire non disponibile = salta SOLO quel lead, senza bruciarlo', () => {
    // Revisione 11/11/2026: il bot risponde `database_chat_attiva` (dettaglio
    // numero_chat_non_disponibile) invece di `database_non_aperto`, che fermava tutta la coda.
    const a = azioneDaPush({ result: 'not_accepted', motivo: 'database_chat_attiva' })
    assert.equal(a.tipo, 'riprova')
    assert.equal(a.tipo === 'riprova' && a.globale, false)
    // Non e' un rifiuto definitivo: nessun evento DATABASE_BOT, il lead resta candidato.
    assert.notEqual(a.tipo, 'definitivo')
    // `database_non_aperto` resta "fermi tutti".
    assert.deepEqual(azioneDaPush({ result: 'not_accepted', motivo: 'database_non_aperto' }), { tipo: 'riprova', esito: 'database_non_aperto', globale: true })
})
