import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comeFunziona } from './comeFunziona'
import { DEFAULT_ECONOMY_RULES } from '@/lib/economy/rules'
import { DEFAULT_TARGETS } from './config'

const testo = (ruolo: string) => comeFunziona(ruolo, DEFAULT_ECONOMY_RULES, DEFAULT_TARGETS).flatMap(b => [b.titolo, ...b.righe]).join('\n')

test('come funziona, GDO: numeri delle regole e potenziamenti', () => {
    const t = testo('GDO')
    assert.match(t, /10 Scintille per ogni appuntamento fissato/)
    assert.match(t, /20 Scintille all'8° appuntamento del giorno e 60 Scintille al 10°/)
    assert.match(t, /1 Piuma se viene confermato, 2 se la persona si presenta, 4 se si iscrive/)
    assert.match(t, /potenziamenti/)
    assert.match(t, /solo per il corso/)
})

test('come funziona, GDO: serie con le tappe e i tre potenziamenti', () => {
    const t = testo('GDO')
    assert.match(t, /La serie/)
    assert.match(t, /arrivi all'8° appuntamento, la serie sale di uno/)
    assert.match(t, /3 giorni 15 Scintille, 6 giorni 30 Scintille/)
    assert.match(t, /60 giorni 250 Scintille e 20 Piume/)
    assert.match(t, /Booster: per 60 minuti/)
    assert.match(t, /25 Scintille in più se la persona si presenta davvero, fino a 4 presenze/)
    assert.match(t, /Scudo della serie: .*al massimo 2 al mese/)
})

test('come funziona: la postazione per tutti, la serie solo ai GDO', () => {
    assert.match(testo('GDO'), /La tua postazione/)
    assert.match(testo('CONFERME'), /La tua postazione/)
    assert.doesNotMatch(testo('CONFERME'), /La serie|Scudo|Moltiplicatore/)
})

test('come funziona, Conferme: lead per lead e obiettivi della settimana, niente potenziamenti', () => {
    const t = testo('CONFERME')
    assert.match(t, /4 Scintille quando confermi/)
    assert.match(t, /22 Scintille in tutto; 30 Scintille se avevi confermato almeno 60 minuti prima/)
    assert.match(t, /a 14 prendi 3 Piume, a 20 altre 4/)
    assert.match(t, /a 4 prendi 4 Piume, a 6 altre 5/)
    assert.doesNotMatch(t, /potenziamenti/)
})
