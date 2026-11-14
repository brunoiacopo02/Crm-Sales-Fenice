import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcolaRighe, candidatiPerNome, nomiCompatibili, type UtenteGdo } from './giro'

const ADESSO = new Date('2026-11-14T15:05:00+01:00')
const ora = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00+01:00`)

test('nomi: diminutivi e grafie del foglio, prefisso di almeno 4 lettere senza h', () => {
    assert.equal(nomiCompatibili('CHRISTIAN', 'Cristian'), true)
    assert.equal(nomiCompatibili('ANTHONY', 'Antony'), true)
    assert.equal(nomiCompatibili('RICCARDINO', 'Riccardo'), true)
    assert.equal(nomiCompatibili('LAVINIA ', 'Lavinia'), true)
    assert.equal(nomiCompatibili('GIUSY', 'Giusy'), true)
    assert.equal(nomiCompatibili('Ugo', 'UGO'), true) // nomi corti: basta che siano uguali
    // solo 3 lettere in comune: non basta
    assert.equal(nomiCompatibili('ZORA', 'Zoretta'), false)
    assert.equal(nomiCompatibili('LAVINIA', 'Cristian'), false)
    assert.equal(nomiCompatibili('ALESSANDRO', 'Alessia'), true) // "ales": i candidati multipli diventano ambigui
    assert.equal(nomiCompatibili('ZORA', null), false)
    assert.equal(nomiCompatibili('', 'Cristian'), false)
    // Christel e Christian, senza h: "cristel" / "cristian" hanno 5 lettere in comune
    assert.equal(nomiCompatibili('CHRISTIAN', 'Christel'), true)
})

const u = (id: string, firstName: string | null, gdoCode: number): UtenteGdo => ({ id, firstName, gdoCode })

test('candidati: Christel attiva insieme a Cristian rende CHRISTIAN ambiguo', () => {
    const attivi = [u('u115', 'Cristian', 115), u('u114', 'Christel', 114)]
    assert.deepEqual(candidatiPerNome('CHRISTIAN', attivi).map(x => x.gdoCode), [115, 114])
    assert.deepEqual(candidatiPerNome('CHRISTIAN', [attivi[0]]).map(x => x.gdoCode), [115])
})

const log = (userId: string, outcome: string, hhmm: string) => ({ userId, outcome, discardReason: null, createdAt: ora(hhmm) })

function chiamate(userId: string, risposte: number, nonRisposte: number, hhmm = '10:00') {
    return [
        ...Array.from({ length: risposte }, () => log(userId, 'RICHIAMO', hhmm)),
        ...Array.from({ length: nonRisposte }, () => log(userId, 'NON_RISPOSTO', hhmm)),
    ]
}

const riga = (r: number, interno: string, nome: string, numero = '3500000000') => ({ riga: r, interno, nome, numero, stato: '', dataCambio: '' })

test('righe: aggancio per nome, colori, celle vuote per nessuno / ambiguo / senza chiamate', () => {
    const utenti = [
        u('u105', 'Antony', 105), u('u119', 'Riccardo', 119), u('u110', 'Alessandro', 110),
        u('u115', 'Cristian', 115), u('u109', 'Giusy', 109),
        u('m1', 'Marco', 1), u('m2', 'Marcello', 2),
    ]
    const logs = [
        ...chiamate('u105', 40, 60), // 40% verde
        ...chiamate('u119', 20, 80), // 20% rosso
        ...chiamate('u110', 5, 5), // 10 chiamate: grigio
        ...chiamate('u115', 30, 70),
    ]
    const righe = calcolaRighe({
        righe: [
            riga(2, '1016', 'ANTHONY'),
            riga(3, '1019', 'RICCARDINO'),
            riga(4, '1009', 'ALESSANDRO'),
            // l'interno non conta: 1020 nel centralino era di un'altra persona
            riga(5, '1020', 'CHRISTIAN'),
            riga(6, '1005', 'NOEMI'),
            riga(7, '1008', 'GIUSY', '/'),
            riga(8, '1030', 'MARC'),
        ],
        statoSim: {}, utenti, logs, soglia: 0.269, adesso: ADESSO,
    })
    const per = (interno: string) => righe.find(r => r.interno === interno)!
    assert.equal(per('1016').utente?.gdoCode, 105)
    assert.equal(per('1016').colore, 'verde')
    assert.equal(per('1016').tasso, 0.4)
    assert.equal(per('1019').colore, 'rosso')
    assert.equal(per('1009').colore, 'grigio')
    assert.equal(per('1009').chiamate, 10)
    assert.equal(per('1020').utente?.gdoCode, 115)
    assert.equal(per('1020').tasso, 0.3)

    assert.equal(per('1005').esito, 'nessuno')
    assert.equal(per('1005').colore, null)
    assert.equal(per('1005').tasso, null)

    assert.equal(per('1030').esito, 'ambiguo')
    assert.deepEqual(per('1030').candidati.map(c => c.gdoCode), [1, 2])
    assert.equal(per('1030').tasso, null)

    // agganciata ma senza chiamate oggi: vuota senza colore
    assert.equal(per('1008').esito, 'agganciato')
    assert.equal(per('1008').colore, null)
    assert.equal(per('1008').tasso, null)
})

test('righe: dopo un cambio SIM di oggi contano solo le chiamate dopo la ripartenza', () => {
    const utenti = [u('u116', 'Lavinia', 116)]
    const logs = [...chiamate('u116', 0, 100, '10:00'), ...chiamate('u116', 30, 30, '14:00')]
    const [r] = calcolaRighe({
        righe: [riga(2, '1007', 'LAVINIA', '3511111111')],
        statoSim: { '1007': { numero: '3511111111', dal: ora('12:00').toISOString() } },
        utenti, logs, soglia: 0.269, adesso: ADESSO,
    })
    assert.equal(r.chiamate, 60)
    assert.equal(r.tasso, 0.5)
    assert.equal(r.colore, 'verde')
    assert.equal(r.ripartitoDal, ora('12:00').toISOString())
})

test('righe: ripartenza di un altro giorno non si mostra e non taglia nulla', () => {
    const [r] = calcolaRighe({
        righe: [riga(2, '1007', 'LAVINIA', '3511111111')],
        statoSim: { '1007': { numero: '3511111111', dal: '2026-11-13T12:00:00.000Z' } },
        utenti: [u('u116', 'Lavinia', 116)], logs: chiamate('u116', 1, 1, '09:00'), soglia: 0.269, adesso: ADESSO,
    })
    assert.equal(r.chiamate, 2)
    assert.equal(r.ripartitoDal, null)
})

test('righe: interno ripetuto nel foglio, la seconda riga resta vuota', () => {
    const righe = calcolaRighe({
        righe: [riga(2, '1007', 'LAVINIA', '1'), riga(3, '1007', 'LAVINIA', '2')],
        statoSim: {}, utenti: [u('u116', 'Lavinia', 116)], logs: chiamate('u116', 10, 10), soglia: 0.269, adesso: ADESSO,
    })
    assert.equal(righe[0].esito, 'agganciato')
    assert.equal(righe[1].esito, 'interno_ripetuto')
    assert.equal(righe[1].tasso, null)
})
