import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    paroleDelLead, notaPerGdo, eventoTimelinePerGdo, assegnatarioPerGdo, notificaTiHaCercato,
    PAROLE_VIETATE,
} from './vistaGdo'

const io = 'gdo-105'
const bot = { userId: 'bot-201', userIsBot: true }
const umano = { userId: 'gdo-110', userIsBot: false }

/** Nessun testo per il GDO deve nominare il bot, la chat o il Fissatore. */
function pulito(s: string | null | undefined): boolean {
    return !s || !PAROLE_VIETATE.test(s)
}

// ------------------------------------------------------------- parole del lead

test('parole del lead: estrae solo quello che ha scritto la persona', () => {
    const r = 'RICHIESTA DI PARLARE CON UNA PERSONA — il bot si è fatto da parte. Parole del lead: "Mi chiami".'
    assert.equal(paroleDelLead(r), 'Mi chiami')
})

test('parole del lead: regge anche "sue parole:" e le virgolette tipografiche', () => {
    assert.equal(paroleDelLead('Secondo recapito del lead: 3534267170, sue parole: "Il numero nuovo"'), 'Il numero nuovo')
    assert.equal(paroleDelLead('DISDETTA — Parole del lead: “non posso più”.'), 'non posso più')
})

test('parole del lead: niente parole, niente testo', () => {
    assert.equal(paroleDelLead('IL BOT HA RIPRESO LA CHAT — il lead ha riscritto.'), null)
    assert.equal(paroleDelLead(null), null)
    assert.equal(paroleDelLead('Parole del lead: ""'), null)
})

// ------------------------------------------------------------- note

test('nota: tiene l etichetta del motivo e le parole del lead', () => {
    const n = notaPerGdo('SPOSTAMENTO CHIESTO — il lead ha chiesto di spostare. Parole del lead: "Per le 16?".')
    assert.equal(n, 'Spostamento chiesto: "Per le 16?"')
})

test('nota: un motivo che nomina la chat non passa, restano solo le parole', () => {
    const n = notaPerGdo('CHAT INTERROTTA — si è fermato. Parole del lead: "ci penso".')
    assert.equal(n, '"ci penso"')
})

test('nota: la ripresa della conversazione diventa un avviso neutro', () => {
    const n = notaPerGdo('IL BOT HA RIPRESO LA CHAT — il lead ha riscritto dopo che ve lo avevamo restituito come INTERROTTO. Non chiamatelo a mano finché non vi arriva un nuovo esito dal bot.')
    assert.ok(n)
    assert.ok(pulito(n), n!)
})

test('nota: senza parole del lead e senza un avviso noto non si mostra', () => {
    assert.equal(notaPerGdo('Lancio Web Dev AI: congedo del bot per errore'), null)
    assert.equal(notaPerGdo(''), null)
})

// ------------------------------------------------------------- timeline

const base = { timestamp: '2026-10-26T13:00:00Z', fromSection: null, toSection: null }

test('timeline: un assegnamento a me diventa "Lead assegnato a te", da qualunque parte arrivi', () => {
    for (const e of [
        { ...base, eventType: 'REASSIGNED_FROM_BOT', userId: io, userIsBot: false, metadata: { reason: 'chat_interrotta', botNote: 'si è fermato in chat' } },
        { ...base, eventType: 'ASSIGNED', userId: null, userIsBot: null, metadata: { assignedToUser: io, source: 'activecampaign' } },
        { ...base, eventType: 'REASSIGNED_ADMIN', userId: 'admin', userIsBot: false, metadata: { toAssigneeId: io } },
    ]) {
        const v = eventoTimelinePerGdo(e, io)
        assert.ok(v, e.eventType)
        assert.equal(v!.etichetta, 'Lead assegnato a te')
        assert.equal(v!.testo, null)
        assert.equal(v!.operatore, null)
    }
})

test('timeline: gli assegnamenti ad altri, bot compreso, spariscono', () => {
    const alBot = { ...base, eventType: 'ASSIGNED', userId: null, userIsBot: null, metadata: { assignedToUser: 'bot-201' } }
    const aUnCollega = { ...base, eventType: 'REASSIGNED_ADMIN', userId: 'admin', userIsBot: false, metadata: { toAssigneeId: 'gdo-119' } }
    assert.equal(eventoTimelinePerGdo(alBot, io), null)
    assert.equal(eventoTimelinePerGdo(aUnCollega, io), null)
})

test('timeline: gli eventi interni del bot non si vedono', () => {
    for (const t of ['BOT_PUSHED', 'BOT_REPORT', 'BOT_CALL_ATTEMPT', 'REASSIGNED_TO_BOT', 'RIDATO_PARCHEGGIATO', 'IA_VOCALE_IN_CODA', 'LANCIO_INTAKE', 'LANCIO_RETURNED_TO_POOL', 'MARIO_VOCALE_APPUNTAMENTO']) {
        assert.equal(eventoTimelinePerGdo({ ...base, eventType: t, ...bot, metadata: { note: 'qualcosa' } }, io), null, t)
    }
})

test('timeline: un tipo sconosciuto non diventa "Evento Sconosciuto", sparisce', () => {
    assert.equal(eventoTimelinePerGdo({ ...base, eventType: 'RPG_AWARD_FISSATO', ...umano, metadata: null }, io), null)
    assert.equal(eventoTimelinePerGdo({ ...base, eventType: 'conferme_outcome_set', ...umano, metadata: null }, io), null)
})

test('timeline: la nota del bot diventa "Nota" con le sole parole del lead', () => {
    const v = eventoTimelinePerGdo({ ...base, eventType: 'BOT_NOTE', ...bot, metadata: { note: 'DISDETTA — Parole del lead: "non vengo".' } }, io)
    assert.deepEqual(v, { tipo: 'NOTE', etichetta: 'Nota', testo: 'Disdetta: "non vengo"', operatore: null, fromSection: null, toSection: null })
})

test('timeline: la richiesta di contatto diventa "Ti ha cercato" con le sole parole del lead', () => {
    const v = eventoTimelinePerGdo({ ...base, eventType: 'BOT_CONTACT_REQUEST', ...bot, metadata: { note: 'RICHIESTA DI PARLARE CON UNA PERSONA — il bot si è fatto da parte. Parole del lead: "Mi chiami".' } }, io)
    assert.equal(v!.etichetta, 'Ti ha cercato')
    assert.equal(v!.testo, '"Mi chiami"')
})

test('timeline: un evento fatto dal bot resta, ma senza operatore', () => {
    const v = eventoTimelinePerGdo({ ...base, eventType: 'APPOINTMENT_SET', ...bot, metadata: { source: 'lancio' } }, io)
    assert.equal(v!.etichetta, 'Appuntamento Fissato')
    assert.equal(v!.operatore, null)
})

test('timeline: una chiamata di un collega mostra il collega e la sua nota', () => {
    const v = eventoTimelinePerGdo({ ...base, eventType: 'CALL_LOGGED', ...umano, userName: 'GDO 110', metadata: { note: 'richiamare domani' } }, io)
    assert.equal(v!.etichetta, 'Chiamata Registrata')
    assert.equal(v!.operatore, 'GDO 110')
    assert.equal(v!.testo, '"richiamare domani"')
})

test('timeline: una nota scritta dal bot (evento NOTE) non passa', () => {
    assert.equal(eventoTimelinePerGdo({ ...base, eventType: 'NOTE', ...bot, metadata: { note: 'congedo del bot per errore' } }, io), null)
})

test('timeline: nessuna etichetta o testo mostrato al GDO cita il bot', () => {
    const tipi = ['IMPORTED', 'ASSIGNED', 'CALL_LOGGED', 'SECTION_MOVED', 'DISCARDED', 'RECALL_SET', 'APPOINTMENT_SET', 'AGENDA_SENT', 'AGENDA_DELIVERED', 'INBOUND_MESSAGE', 'BOT_APPOINTMENT_RESCHEDULED', 'BOT_NOTE', 'BOT_CONTACT_REQUEST']
    for (const t of tipi) {
        const v = eventoTimelinePerGdo({ ...base, eventType: t, ...bot, userName: 'GDO 201', metadata: { assignedToUser: io, note: 'IL BOT HA RIPRESO LA CHAT — dal bot. Parole del lead: "ok"' } }, io)
        if (!v) continue
        assert.ok(pulito(v.etichetta), `${t}: ${v.etichetta}`)
        assert.ok(pulito(v.testo), `${t}: ${v.testo}`)
        assert.ok(pulito(v.operatore), `${t}: ${v.operatore}`)
    }
})

// ------------------------------------------------------------- assegnatario e notifica

test('assegnatario: il bot diventa "In lavorazione", nessuno diventa "Nessuno"', () => {
    assert.equal(assegnatarioPerGdo('GDO 201', true), 'In lavorazione')
    assert.equal(assegnatarioPerGdo(null, null), 'Nessuno')
    assert.equal(assegnatarioPerGdo('GDO 110', false), 'GDO 110')
})

test('notifica "ti ha cercato": titolo neutro e solo le parole del lead', () => {
    const n = notificaTiHaCercato('Mario Rossi', 'RICHIESTA DI PARLARE CON UNA PERSONA — il bot si è fatto da parte. Parole del lead: "si passami un collega".')
    assert.ok(pulito(n.title), n.title)
    assert.ok(pulito(n.body), n.body)
    assert.equal(n.body, 'Mario Rossi: "si passami un collega"')
})

test('notifica "ti ha cercato": senza parole resta il solo nome', () => {
    const n = notificaTiHaCercato('Mario Rossi', 'AVEVA CONFERMATO — la chat si è fermata.')
    assert.equal(n.body, 'Mario Rossi')
})
