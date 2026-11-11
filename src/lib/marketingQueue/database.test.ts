import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BATCH_DATABASE_BOT, SCAGLIONE_DATABASE_DEFAULT, GIORNI_CODA_DATABASE_DEFAULT,
    azioneDaPush, eLeadDatabase, leggiConfigDatabaseAlBot, motivoNonIdoneo, type CandidatoDatabase,
} from './database'
import { BATCH_SENSO_UNICO, BATCH_ESCLUSI_DAI_KPI, BATCH_FREDDI } from '@/lib/intakeBatch'

function c(p: Partial<CandidatoDatabase> = {}): CandidatoDatabase {
    return {
        id: 'l1', status: 'NEW', assignedToId: null, appointmentDate: null, presentedAt: null,
        phoneSuspicious: false, isTest: false, intakeBatch: null, toccatoDalBot: false, giaGestito: false, ...p,
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
    assert.deepEqual(azioneDaPush({ result: 'network_error' }), { tipo: 'assegna', esito: 'esito_incerto' })
    assert.deepEqual(azioneDaPush({ result: 'not_accepted', motivo: 'apertura_non_partita' }), { tipo: 'assegna', esito: 'apertura_non_partita' })
})

test('risposta del bot: chat esistente o numero non valido = definitivo, il lead resta dov\'e\'', () => {
    assert.equal(azioneDaPush({ result: 'not_accepted', motivo: 'database_chat_esistente' }).tipo, 'definitivo')
    assert.equal(azioneDaPush({ result: 'not_accepted', motivo: 'telefono_non_valido' }).tipo, 'definitivo')
})

test('risposta del bot: "non adesso" e ogni errore = riprova al giro dopo, senza toccare il lead', () => {
    for (const r of [
        { result: 'not_accepted', motivo: 'database_non_aperto' },
        { result: 'not_accepted', motivo: 'arruolamento_fallito' },
        { result: 'http_error' }, { result: 'rate_limited' }, { result: 'missing_env' },
        { result: 'skipped_disabled' }, { result: 'skipped_prova' },
    ]) assert.equal(azioneDaPush(r).tipo, 'riprova', JSON.stringify(r))
})

test('infornata database: a senso unico, ma NON tolta dai KPI ne\' trattata da coda fredda', () => {
    assert.ok(BATCH_SENSO_UNICO.includes(BATCH_DATABASE_BOT))
    assert.ok(!BATCH_ESCLUSI_DAI_KPI.includes(BATCH_DATABASE_BOT))
    assert.ok(!BATCH_FREDDI.includes(BATCH_DATABASE_BOT))
})
