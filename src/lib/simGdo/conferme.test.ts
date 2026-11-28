import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contaEventiConferme, contaGruppiConferme, valutaEventoConferme, type EventoConferme } from './conferme'

const e = (eventType: string, outcome: string | null = null, discardReason: string | null = null, hhmm = '10:00'): EventoConferme =>
    ({ eventType, outcome, discardReason, createdAt: new Date(`2026-11-27T${hhmm}:00+01:00`) })

test('conferme: NR e 3° NR sono chiamate senza risposta, NR annullato la toglie', () => {
    const c = contaEventiConferme([e('conferme_no_answer'), e('conferme_no_answer'), e('conferme_auto_discarded_3nr'), e('conferme_nr_undone')])
    assert.deepEqual(c, { chiamate: 2, risposte: 0 })
})

test('conferme: confermato e scarto con motivo sono risposte; "non risponde" no; "numero inesistente" fuori', () => {
    assert.deepEqual(valutaEventoConferme(e('conferme_outcome_set', 'confermato')), { chiamate: 1, risposte: 1 })
    assert.deepEqual(valutaEventoConferme(e('conferme_outcome_set', 'scartato', 'non interessato')), { chiamate: 1, risposte: 1 })
    assert.deepEqual(valutaEventoConferme(e('conferme_outcome_set', 'scartato', null)), { chiamate: 1, risposte: 1 })
    assert.deepEqual(valutaEventoConferme(e('conferme_outcome_set', 'scartato', 'Non risponde')), { chiamate: 1, risposte: 0 })
    assert.deepEqual(valutaEventoConferme(e('conferme_outcome_set', 'scartato', 'numero inesistente')), { chiamate: 0, risposte: 0 })
})

test('conferme: richiami fissati sono risposte; eventi estranei non contano', () => {
    assert.deepEqual(valutaEventoConferme(e('conferme_snooze_set')), { chiamate: 1, risposte: 1 })
    assert.deepEqual(valutaEventoConferme(e('conferme_recall_scheduled')), { chiamate: 1, risposte: 1 })
    assert.deepEqual(valutaEventoConferme(e('conferme_edited_lead')), { chiamate: 0, risposte: 0 })
    assert.deepEqual(valutaEventoConferme(e('BOT_CALL_ATTEMPT')), { chiamate: 0, risposte: 0 })
})

test('conferme: dal (cambio SIM) include l\'istante esatto, un solo annullo non va sotto zero', () => {
    const dal = new Date('2026-11-27T12:00:00+01:00')
    const c = contaEventiConferme([e('conferme_no_answer', null, null, '11:59'), e('conferme_no_answer', null, null, '12:00'), e('conferme_outcome_set', 'confermato', null, '13:00')], dal)
    assert.deepEqual(c, { chiamate: 2, risposte: 1 })
    assert.deepEqual(contaEventiConferme([e('conferme_nr_undone')]), { chiamate: 0, risposte: 0 })
})

test('conferme: il conteggio a gruppi dà lo stesso risultato di quello a eventi', () => {
    const eventi = [e('conferme_no_answer'), e('conferme_no_answer'), e('conferme_nr_undone'), e('conferme_outcome_set', 'scartato', 'non ha soldi'), e('conferme_snooze_set'), e('conferme_outcome_set', 'scartato', 'numero inesistente')]
    const gruppi = [
        { eventType: 'conferme_no_answer', outcome: null, discardReason: null, n: 2 },
        { eventType: 'conferme_nr_undone', outcome: null, discardReason: null, n: 1 },
        { eventType: 'conferme_outcome_set', outcome: 'scartato', discardReason: 'non ha soldi', n: 1 },
        { eventType: 'conferme_snooze_set', outcome: null, discardReason: null, n: 1 },
        { eventType: 'conferme_outcome_set', outcome: 'scartato', discardReason: 'numero inesistente', n: 1 },
    ]
    assert.deepEqual(contaGruppiConferme(gruppi), contaEventiConferme(eventi))
    assert.deepEqual(contaGruppiConferme(gruppi), { chiamate: 3, risposte: 2 })
})
