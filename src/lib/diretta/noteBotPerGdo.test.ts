import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leadPerGdo, notaDaSalvareDalGdo, notaDiMacchina, notaPerGdo } from './noteBotPerGdo'

// Note vere del bot viste in prod il 29/10/2026 sulle card dei GDO: nessuna
// nomina il bot o la chat, e il filtro a parole le lasciava passare.
const RICHIAMO_BOT = '"a dicembre, una volta sistemate le spese" — Richiamo indicativo: a dicembre'
const RICHIAMO_BOT_2 = 'luglio 2026, sue parole: "sarebbe meglio aspettare quando rientro al lavoro a luglio" — Richiamo indicativo: a luglio'
const noteBot = new Set([RICHIAMO_BOT, RICHIAMO_BOT_2, 'Nessun messaggio consegnato in 14 giorni. Numero morto'])

test('nota del bot senza parole chiave: si riconosce dalla fonte e sparisce', () => {
    assert.equal(notaDiMacchina(RICHIAMO_BOT, noteBot), true)
    assert.equal(notaPerGdo(RICHIAMO_BOT, noteBot), null)
    assert.equal(notaPerGdo(`  ${RICHIAMO_BOT_2}\n`, noteBot), null)
})

test('riassunto dell\'IA vocale: sparisce per il suo marcatore', () => {
    const mario = '[Mario vocale] Lavora: sì (baby sitter part-time) · Figli a carico: n.d.'
    assert.equal(notaPerGdo(mario, new Set()), null)
})

test('nota di un GDO o delle Conferme: resta, anche se nomina il bot', () => {
    const umana = 'metalmeccanica, no figli, int al graph perchè fa un lavoro monotono'
    assert.equal(notaPerGdo(umana, noteBot), umana)
    // La regola guarda chi l'ha scritta, non le parole.
    const umanaColBot = 'si è spaventata parlando con il bot, richiamare dopo le 18'
    assert.equal(notaPerGdo(umanaColBot, noteBot), umanaColBot)
    assert.equal(notaPerGdo(null, noteBot), null)
    assert.equal(notaPerGdo('', noteBot), '')
})

test('una nota del bot su un altro lead non conta: il set è per lead', () => {
    assert.equal(notaPerGdo('Richiamare lunedì', new Set(['Richiamare martedì'])), 'Richiamare lunedì')
})

test('lead per il GDO: via note, report e info del bot; date e stato restano', () => {
    const appuntamento = new Date('2026-10-30T16:00:00Z')
    const richiamo = new Date('2026-12-01T15:00:00Z')
    const lead = {
        id: 'l1',
        status: 'IN_PROGRESS',
        lastCallNote: '',
        recallNote: RICHIAMO_BOT,
        recallDate: richiamo,
        appointmentDate: appuntamento,
        appointmentNote: 'lavora come OSS, chiamare dopo le 19',
        discardReason: 'Nessun messaggio consegnato in 14 giorni. Numero morto',
        botReport: { summary: 'riassunto della conversazione' },
        lancioBotInfo: { scelta: 'app_mattina' },
        confNeedsReschedule: true,
        confRecallNotes: 'Richiamare giovedì',
        version: 7,
    }
    const v = leadPerGdo(lead, noteBot)
    assert.equal(v.recallNote, null)
    assert.equal(v.discardReason, null)
    assert.equal(v.botReport, null)
    assert.equal(v.lancioBotInfo, null)
    assert.equal(v.lastCallNote, '')
    assert.equal(v.appointmentNote, 'lavora come OSS, chiamare dopo le 19')
    // Le informazioni operative non si toccano.
    assert.equal(v.recallDate, richiamo)
    assert.equal(v.appointmentDate, appuntamento)
    assert.equal(v.confNeedsReschedule, true)
    assert.equal(v.confRecallNotes, 'Richiamare giovedì')
    assert.equal(v.status, 'IN_PROGRESS')
    assert.equal(v.version, 7)
    // L'originale (quello che vedono Conferme e admin) resta intatto.
    assert.equal(lead.recallNote, RICHIAMO_BOT)
})

test('lead per il GDO: i campi che la query non porta restano assenti', () => {
    const v = leadPerGdo({ id: 'l2', lastCallNote: RICHIAMO_BOT }, noteBot)
    assert.deepEqual(Object.keys(v).sort(), ['id', 'lastCallNote'])
    assert.equal(v.lastCallNote, null)
})

test('salvataggio del GDO: a nota vuota la nota del bot resta, se scrive vale la sua', () => {
    assert.equal(notaDaSalvareDalGdo('', RICHIAMO_BOT, noteBot), RICHIAMO_BOT)
    assert.equal(notaDaSalvareDalGdo(null, RICHIAMO_BOT, noteBot), RICHIAMO_BOT)
    assert.equal(notaDaSalvareDalGdo('  ', RICHIAMO_BOT, noteBot), RICHIAMO_BOT)
    assert.equal(notaDaSalvareDalGdo('Richiamare lunedì', RICHIAMO_BOT, noteBot), 'Richiamare lunedì')
    // Una nota umana che il GDO svuota si svuota davvero.
    assert.equal(notaDaSalvareDalGdo('', 'nota di un collega', noteBot), '')
    assert.equal(notaDaSalvareDalGdo(null, 'nota di un collega', noteBot), null)
})
