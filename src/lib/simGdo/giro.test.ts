import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcolaRighe, nomiCompatibili, type UtenteInterno } from './giro'

const ADESSO = new Date('2026-11-14T15:05:00+01:00')
const ora = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00+01:00`)

test('nomi: il NOME del foglio e il nome del CRM sono la stessa persona?', () => {
    assert.equal(nomiCompatibili('CHRISTIAN', 'Cristian'), true)
    assert.equal(nomiCompatibili('ANTHONY', 'Antony'), true)
    assert.equal(nomiCompatibili('RICCARDINO', 'Riccardo'), true)
    assert.equal(nomiCompatibili('ZORA', 'Zoretta'), true)
    assert.equal(nomiCompatibili('LAVINIA ', 'Lavinia'), true)
    assert.equal(nomiCompatibili('GIUSY', 'Giusy'), true)
    assert.equal(nomiCompatibili('LAVINIA', 'Cristian'), false)
    assert.equal(nomiCompatibili('BEATRICE', 'Christel'), false)
    assert.equal(nomiCompatibili('ZORA', null), false)
    // senza nome nel foglio non c'è niente da smentire
    assert.equal(nomiCompatibili('', 'Cristian'), true)
})

const utente = (id: string, firstName: string | null, gdoCode = 100): UtenteInterno => ({ id, firstName, gdoCode, nomeCrm: `GDO ${gdoCode}` })
const log = (userId: string, outcome: string, hhmm: string) => ({ userId, outcome, discardReason: null, createdAt: ora(hhmm) })

function chiamate(userId: string, risposte: number, nonRisposte: number, hhmm = '10:00') {
    return [
        ...Array.from({ length: risposte }, () => log(userId, 'RICHIAMO', hhmm)),
        ...Array.from({ length: nonRisposte }, () => log(userId, 'NON_RISPOSTO', hhmm)),
    ]
}

test('righe: aggancio, colori, cella vuota per chi non si aggancia o non ha chiamate', () => {
    const interni = new Map<string, UtenteInterno>([
        ['1016', utente('u105', 'Antony', 105)],
        ['1019', utente('u119', 'Riccardo', 119)],
        ['1009', utente('u110', 'Alessandro', 110)],
        ['1020', utente('u112', 'Beatrice', 112)],
        ['1008', utente('u109', 'Giusy', 109)],
    ])
    const logs = [
        ...chiamate('u105', 40, 60), // 40% verde
        ...chiamate('u119', 20, 80), // 20% rosso
        ...chiamate('u110', 5, 5), // 10 chiamate: grigio
        ...chiamate('u112', 50, 50), // Beatrice: non deve finire sulla riga di Christian
    ]
    const righe = calcolaRighe({
        righe: [
            { riga: 2, interno: '1016', nome: 'ANTHONY', numero: '3522643347', stato: 'SOSPETTO', dataCambio: '' },
            { riga: 3, interno: '1019', nome: 'RICCARDINO', numero: '3522496491', stato: 'SOSPETTO', dataCambio: '' },
            { riga: 4, interno: '1009', nome: 'ALESSANDRO', numero: '3522642675', stato: 'SOSPETTO', dataCambio: '' },
            { riga: 5, interno: '1020', nome: 'CHRISTIAN', numero: 'da ins', stato: 'OK', dataCambio: '' },
            { riga: 6, interno: '1005', nome: 'NOEMI', numero: '3522595107', stato: 'SOSPETTO', dataCambio: '' },
            { riga: 7, interno: '1008', nome: 'GIUSY', numero: '/', stato: 'VUOTO', dataCambio: '' },
        ],
        statoSim: {},
        interni,
        logs,
        soglia: 0.269,
        adesso: ADESSO,
    })
    const per = (interno: string) => righe.find(r => r.interno === interno)!
    assert.equal(per('1016').colore, 'verde')
    assert.equal(per('1016').tasso, 0.4)
    assert.equal(per('1016').esito, 'agganciato')
    assert.equal(per('1019').colore, 'rosso')
    assert.equal(per('1009').colore, 'grigio')
    assert.equal(per('1009').chiamate, 10)

    assert.equal(per('1020').esito, 'nome_diverso')
    assert.equal(per('1020').colore, null)
    assert.equal(per('1020').tasso, null)
    assert.equal(per('1020').chiamate, 0)

    assert.equal(per('1005').esito, 'non_agganciato')
    assert.equal(per('1005').colore, null)

    // agganciata ma senza chiamate oggi: vuota senza colore
    assert.equal(per('1008').esito, 'agganciato')
    assert.equal(per('1008').colore, null)
    assert.equal(per('1008').tasso, null)
})

test('righe: dopo un cambio SIM di oggi contano solo le chiamate dopo la ripartenza', () => {
    const interni = new Map([['1017', utente('u106', 'Zoretta', 106)]])
    const logs = [...chiamate('u106', 0, 100, '10:00'), ...chiamate('u106', 30, 30, '14:00')]
    const [r] = calcolaRighe({
        righe: [{ riga: 2, interno: '1017', nome: 'ZORA', numero: '3511111111', stato: 'OK', dataCambio: '' }],
        statoSim: { '1017': { numero: '3511111111', dal: ora('12:00').toISOString() } },
        interni, logs, soglia: 0.269, adesso: ADESSO,
    })
    assert.equal(r.chiamate, 60)
    assert.equal(r.tasso, 0.5)
    assert.equal(r.colore, 'verde')
    assert.equal(r.ripartitoDal, ora('12:00').toISOString())
})

test('righe: ripartenza di un altro giorno non si mostra e non taglia nulla', () => {
    const interni = new Map([['1017', utente('u106', 'Zoretta', 106)]])
    const [r] = calcolaRighe({
        righe: [{ riga: 2, interno: '1017', nome: 'ZORA', numero: '3511111111', stato: 'OK', dataCambio: '' }],
        statoSim: { '1017': { numero: '3511111111', dal: '2026-11-13T12:00:00.000Z' } },
        interni, logs: chiamate('u106', 1, 1, '09:00'), soglia: 0.269, adesso: ADESSO,
    })
    assert.equal(r.chiamate, 2)
    assert.equal(r.ripartitoDal, null)
})

test('righe: interno ripetuto nel foglio, la seconda riga resta vuota', () => {
    const interni = new Map([['1017', utente('u106', 'Zoretta', 106)]])
    const righe = calcolaRighe({
        righe: [
            { riga: 2, interno: '1017', nome: 'ZORA', numero: '1', stato: '', dataCambio: '' },
            { riga: 3, interno: '1017', nome: 'ZORA', numero: '2', stato: '', dataCambio: '' },
        ],
        statoSim: {}, interni, logs: chiamate('u106', 10, 10), soglia: 0.269, adesso: ADESSO,
    })
    assert.equal(righe[0].esito, 'agganciato')
    assert.equal(righe[1].esito, 'interno_ripetuto')
    assert.equal(righe[1].tasso, null)
})
