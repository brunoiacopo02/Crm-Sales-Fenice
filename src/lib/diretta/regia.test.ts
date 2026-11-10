import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    MINUTI_PROTEZIONE, annullaRinfrescaUpdatedAt, annullabile, fotografa, motivoEsclusione, normalizzaFiltri, ripartisci, ripristino,
    tettoValido, type LeadControllo,
} from './regia'

const ORA = new Date('2026-11-09T16:30:00+01:00')
const minutiFa = (m: number) => new Date(ORA.getTime() - m * 60_000)

function lead(p: Partial<LeadControllo> = {}): LeadControllo {
    return {
        id: 'l1', assignedToId: 'g105', status: 'NEW', callCount: 0,
        appointmentDate: null, presentedAt: null, confirmationsUserId: null, confirmationsOutcome: null, confCall1At: null,
        isTest: false, lastCallDate: null, updatedAt: minutiFa(600), ultimoEventoDelTitolare: null,
        launchBucket: null, funnel: 'JOB SIMULATOR', lancioPool: null, humanTestCohort: null,
        ...p,
    }
}
const daGdo = { mittenteId: 'g105', titolareUmano: true, ora: ORA }

test('filtri: valori sconosciuti tornano ai predefiniti, età e funnel ripuliti', () => {
    const f = normalizzaFiltri({ tentativi: 'x', bf: 'si', provenienza: 'ridati', richiamo: 'scaduti', etaMin: '3', etaMax: -2, funnel: '  BLACK FRIDAY ' })
    assert.equal(f.tentativi, 'tutti')
    assert.equal(f.bf, 'si')
    assert.equal(f.provenienza, 'ridati')
    assert.equal(f.richiamo, 'scaduti')
    assert.equal(f.etaMin, 3)
    assert.equal(f.etaMax, null)
    assert.equal(f.funnel, 'BLACK FRIDAY')
    assert.deepEqual(normalizzaFiltri(null), { funnel: null, tentativi: 'tutti', bf: 'tutti', provenienza: 'tutti', richiamo: 'tutti', etaMin: null, etaMax: null })
})

test('esclusioni: lead aperto e fermo si sposta', () => {
    assert.equal(motivoEsclusione(lead(), daGdo), null)
})

test('esclusioni: appuntamento, Conferme, presentato, chiuso, prova, lancio', () => {
    assert.match(motivoEsclusione(lead({ appointmentDate: minutiFa(-600) }), daGdo)!, /appuntamento/)
    assert.match(motivoEsclusione(lead({ status: 'APPOINTMENT' }), daGdo)!, /appuntamento/)
    assert.match(motivoEsclusione(lead({ confirmationsUserId: 'c1' }), daGdo)!, /Conferme/)
    assert.match(motivoEsclusione(lead({ presentedAt: minutiFa(100) }), daGdo)!, /presentat/)
    assert.match(motivoEsclusione(lead({ status: 'REJECTED' }), daGdo)!, /chiuso o scartato/)
    assert.match(motivoEsclusione(lead({ isTest: true }), daGdo)!, /prova/)
    assert.match(motivoEsclusione(lead({ launchBucket: 'LANCIO_WEBDEV_2026' }), daGdo)!, /lancio/)
})

test('esclusioni: protezione durante il turno, 30 minuti dal GDO che lo ha', () => {
    assert.equal(MINUTI_PROTEZIONE, 30)
    assert.match(motivoEsclusione(lead({ lastCallDate: minutiFa(29) }), daGdo)!, /chiamato/)
    assert.match(motivoEsclusione(lead({ ultimoEventoDelTitolare: minutiFa(10) }), daGdo)!, /lavorato/)
    assert.match(motivoEsclusione(lead({ updatedAt: minutiFa(5) }), daGdo)!, /lavorato/)
    assert.equal(motivoEsclusione(lead({ lastCallDate: minutiFa(31), updatedAt: minutiFa(31) }), daGdo), null)
    // sul bot e fra i senza assegnatario la protezione del turno non serve
    assert.equal(motivoEsclusione(lead({ assignedToId: 'bot', updatedAt: minutiFa(1) }), { mittenteId: 'bot', titolareUmano: false, ora: ORA }), null)
})

test('esclusioni: lead passato ad altri dopo l\'anteprima', () => {
    assert.match(motivoEsclusione(lead({ assignedToId: 'g106' }), daGdo)!, /non è più/)
    assert.match(motivoEsclusione(lead({ assignedToId: null }), daGdo)!, /non è più/)
    assert.equal(motivoEsclusione(lead({ assignedToId: null }), { mittenteId: null, titolareUmano: false, ora: ORA }), null)
})

test('ripartizione: a turno fra i destinatari, nell\'ordine dei lead', () => {
    const r = ripartisci(['a', 'b', 'c', 'd', 'e'], ['x', 'y'])
    assert.deepEqual(r, [{ id: 'a', a: 'x' }, { id: 'b', a: 'y' }, { id: 'c', a: 'x' }, { id: 'd', a: 'y' }, { id: 'e', a: 'x' }])
    assert.deepEqual(ripartisci(['a'], []), [])
    // destinatari doppi contano una volta
    assert.deepEqual(ripartisci(['a', 'b'], ['x', 'x']), [{ id: 'a', a: 'x' }, { id: 'b', a: 'x' }])
})

test('fotografia: date in ISO, campi mancanti a null', () => {
    const f = fotografa({ assignedToId: 'g1', recallDate: new Date('2026-11-09T10:00:00Z'), callCount: 2 }, ['assignedToId', 'recallDate', 'callCount', 'scortaStato'])
    assert.deepEqual(f, { assignedToId: 'g1', recallDate: '2026-11-09T10:00:00.000Z', callCount: 2, scortaStato: null })
})

test('annulla: solo se il lead è ancora come l\'abbiamo lasciato', () => {
    const dopo = { assignedToId: 'g106', status: 'NEW', callCount: 0, scortaStato: 'visibile' }
    assert.equal(annullabile({ ...dopo, scortaStato: 'scorta' }, dopo), null) // la scorta cambia da sola: non blocca
    assert.match(annullabile({ ...dopo, callCount: 1 }, dopo)!, /chiamato/)
    assert.match(annullabile({ ...dopo, assignedToId: 'g107' }, dopo)!, /assegnatario/)
    assert.match(annullabile({ ...dopo, status: 'APPOINTMENT' }, dopo)!, /stato/)
    assert.match(annullabile({ ...dopo, appointmentDate: '2026-11-10T10:00:00.000Z' }, { ...dopo, appointmentDate: null })!, /appuntamento/)
})

test('ripristino: rimette i valori di prima solo sui campi toccati', () => {
    const prima = { assignedToId: 'g105', status: 'IN_PROGRESS', callCount: 1, scortaStato: null, recallNote: 'x' }
    const dopo = { assignedToId: 'g106', scortaStato: 'visibile' }
    assert.deepEqual(ripristino(prima, dopo), { assignedToId: 'g105', scortaStato: null })
})

test('tetto freschi: intero fra 0 e 1000 oppure vuoto', () => {
    assert.equal(tettoValido(null), true)
    assert.equal(tettoValido(30), true)
    assert.equal(tettoValido(0), true)
    assert.equal(tettoValido(1001), false)
    assert.equal(tettoValido(2.5), false)
    assert.equal(tettoValido(-1), false)
})

test('annulla: updatedAt si rinfresca solo se entra/esce dal bot o lo stato cambia davvero', () => {
    // Prova in produzione del 10/11: sposta da senza assegnatario a un GDO, annulla → updatedAt era diventato "adesso".
    const prima = { assignedToId: null, status: 'NEW', callCount: 0, scortaStato: null }
    const dopo = { assignedToId: 'g107', status: 'NEW', callCount: 0, scortaStato: 'scorta' }
    assert.equal(annullaRinfrescaUpdatedAt(prima, dopo, 'bot'), false)
    // in cima: stesso titolare, stesso stato
    assert.equal(annullaRinfrescaUpdatedAt({ assignedToId: 'g105', status: 'IN_PROGRESS', scortaStato: 'scorta' }, { assignedToId: 'g105', status: 'IN_PROGRESS', scortaStato: 'visibile' }, 'bot'), false)
    // scarta: lo stato cambia
    assert.equal(annullaRinfrescaUpdatedAt({ assignedToId: 'g105', status: 'NEW' }, { assignedToId: 'g105', status: 'REJECTED' }, 'bot'), true)
    // dai al bot / tolto al bot
    assert.equal(annullaRinfrescaUpdatedAt({ assignedToId: 'g105', status: 'NEW' }, { assignedToId: 'bot', status: 'NEW' }, 'bot'), true)
    assert.equal(annullaRinfrescaUpdatedAt({ assignedToId: 'bot', status: 'NEW' }, { assignedToId: 'g105', status: 'NEW' }, 'bot'), true)
})
