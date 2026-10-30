import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    GRAZIA_MS, SBLOCCO, VISIBILI_INIZIALI,
    applicaScritti, classificaArrivi, conStella, daSbloccare, datiDaEventi, eVergine, haDaChiamare, ordinaScorta,
    primaAssegnazione, prioritaScorta, rangoScorta, sempreVisibile, stimaGiorni, visibileInPrimaChiamata,
    type LeadScorta,
} from './scorta'

const ORA = new Date('2026-10-30T15:00:00+01:00')
const oreFa = (h: number) => new Date(ORA.getTime() - h * 3600_000)

let n = 0
function lead(p: Partial<LeadScorta> = {}): LeadScorta {
    n++
    return {
        id: p.id ?? `l${String(n).padStart(4, '0')}`,
        status: 'NEW',
        callCount: 0,
        source: 'database',
        launchBucket: null,
        funnel: 'JOB SIMULATOR',
        createdAt: oreFa(200),
        updatedAt: oreFa(100),
        scortaStato: null,
        scortaDal: null,
        cercato: false,
        ultimoMotivo: null,
        ultimoInstradato: null,
        passatoDalBot: false,
        arrivedAt: oreFa(50),
        ...p,
    }
}
const vergine = (p: Partial<LeadScorta> = {}) => lead({ source: 'activecampaign', createdAt: oreFa(2), arrivedAt: oreFa(2), ...p })
const stella = (p: Partial<LeadScorta> = {}) => lead({ ultimoMotivo: 'chat_interrotta', passatoDalBot: true, ...p })
const lettoJs = (p: Partial<LeadScorta> = {}) => lead({ ultimoMotivo: 'mai_risposto', ultimoInstradato: 'letto', passatoDalBot: true, funnel: 'TELEGRAM', ...p })
const lettoC10 = (p: Partial<LeadScorta> = {}) => lead({ ultimoMotivo: 'ridistribuzione_29_10_letti', passatoDalBot: true, funnel: 'Corso 10 ore AI', ...p })

test('scorta: vergini, stelle e "Ti ha cercato" sempre visibili', () => {
    assert.equal(eVergine(vergine(), ORA), true)
    assert.equal(eVergine(vergine({ passatoDalBot: true }), ORA), false)
    assert.equal(eVergine(vergine({ launchBucket: 'lancio' }), ORA), false)
    assert.equal(eVergine(vergine({ createdAt: oreFa(24 * 8) }), ORA), false, 'oltre i 7 giorni non è più vergine')
    assert.equal(eVergine(vergine({ source: 'csv' }), ORA), false)
    assert.equal(conStella(stella()), true)
    assert.equal(conStella(stella({ launchBucket: 'x' })), false)
    assert.equal(sempreVisibile(stella(), ORA), true)
    assert.equal(sempreVisibile(lead({ cercato: true }), ORA), true)
    assert.equal(sempreVisibile(lettoJs(), ORA), false)
})

test('scorta: rango stella > letti JS/TG > letti Corso 10 ore > resto', () => {
    assert.equal(rangoScorta(stella()), 3)
    assert.equal(rangoScorta(lettoJs()), 2)
    assert.equal(rangoScorta(lettoJs({ funnel: 'job simulator ' })), 2)
    assert.equal(rangoScorta(lettoC10()), 1)
    assert.equal(rangoScorta(lettoC10({ funnel: 'CORSO10ORE' })), 1)
    assert.equal(rangoScorta(lead({ funnel: 'TELEGRAM' })), 0, 'non letto: resto')
    assert.equal(rangoScorta(lead({ ultimoInstradato: 'mai_consegnato', funnel: 'TELEGRAM' })), 0)
})

test('scorta: prima assegnazione = sempre visibili + i migliori 40, il resto in scorta', () => {
    const v = [vergine(), vergine()]
    const s = [stella(), lead({ cercato: true, callCount: 2 })]
    const migliori = Array.from({ length: 10 }, (_, i) => lettoJs({ arrivedAt: oreFa(i) }))
    const c10 = Array.from({ length: 10 }, () => lettoC10())
    const resto = Array.from({ length: 50 }, (_, i) => lead({ arrivedAt: oreFa(i + 1) }))
    const altri = [lead({ callCount: 1 })] // seconda chiamata: fuori
    const r = primaAssegnazione([...resto, ...c10, ...migliori, ...v, ...s, ...altri], ORA)
    assert.equal(r.sempre.length, 4)
    assert.equal(r.visibili.length, 4 + VISIBILI_INIZIALI)
    assert.equal(r.scorta.length, 70 - VISIBILI_INIZIALI)
    for (const l of [...migliori, ...c10]) assert.ok(r.visibili.includes(l.id), 'i letti passano davanti')
    // Dentro lo stesso rango, più recenti prima: dei 50 "resto" restano visibili i 20 più recenti.
    for (const l of resto.slice(0, 20)) assert.ok(r.visibili.includes(l.id))
    for (const l of resto.slice(20)) assert.ok(r.scorta.includes(l.id))
    assert.ok(!r.visibili.includes(altri[0].id) && !r.scorta.includes(altri[0].id))
})

test('scorta: classificazione arrivi (grazia, caldi visibili, resto in scorta, già decisi intatti)', () => {
    const nuovo = lead({ updatedAt: new Date(ORA.getTime() - GRAZIA_MS + 1000) })
    const freddo = lead()
    const v = vergine()
    const s = stella()
    const deciso = lead({ scortaStato: 'scorta', scortaDal: oreFa(5) })
    const visibile = lead({ scortaStato: 'visibile' })
    const r = classificaArrivi([nuovo, freddo, v, s, deciso, visibile], ORA)
    assert.deepEqual(r.visibili.sort(), [v.id, s.id].sort())
    assert.deepEqual(r.scorta, [freddo.id])
})

test('scorta: sblocco solo a zero da chiamare, i primi 30 per ingresso poi priorità', () => {
    const vecchi = Array.from({ length: 25 }, (_, i) => lead({ scortaStato: 'scorta', scortaDal: oreFa(48), arrivedAt: oreFa(i) }))
    const vecchiLetti = Array.from({ length: 5 }, () => lettoJs({ scortaStato: 'scorta', scortaDal: oreFa(48) }))
    const nuovi = Array.from({ length: 10 }, () => lettoJs({ scortaStato: 'scorta', scortaDal: oreFa(1) }))
    const tutti = [...nuovi, ...vecchi, ...vecchiLetti]
    const ids = daSbloccare(tutti)
    assert.equal(ids.length, SBLOCCO)
    // Prima gli ingressi più vecchi (anche se i nuovi sono letti): i 30 vecchi.
    assert.deepEqual(new Set(ids), new Set([...vecchi, ...vecchiLetti].map(l => l.id)))
    assert.deepEqual(ids.slice(0, 5).sort(), vecchiLetti.map(l => l.id).sort(), 'dentro lo stesso ingresso, i letti prima')

    assert.deepEqual(daSbloccare([...tutti, lead({ scortaStato: 'visibile' })]), [], 'un visibile da chiamare: niente sblocco')
    assert.deepEqual(daSbloccare([...tutti, lead()]), [], 'un arrivo da classificare conta come visibile')
    assert.equal(daSbloccare([...tutti, lead({ cercato: true, callCount: 2 })]).length, SBLOCCO,
        'un "Ti ha cercato" con tentativi alle spalle non tiene ferma la scorta')
    assert.deepEqual(daSbloccare([...tutti, lead({ cercato: true, scortaStato: 'scorta' })]), [],
        'un "Ti ha cercato" mai chiamato è da chiamare, anche se era in scorta')
    assert.deepEqual(daSbloccare([]), [])
    assert.equal(daSbloccare(vecchi.slice(0, 7)).length, 7, 'fino a esaurimento')
})

test('scorta: idempotenza logica, dopo lo sblocco un secondo calcolo non sblocca altro', () => {
    const lista = Array.from({ length: 80 }, (_, i) => lead({ scortaStato: 'scorta', scortaDal: oreFa(10), arrivedAt: oreFa(i) }))
    const primo = daSbloccare(lista)
    assert.equal(primo.length, SBLOCCO)
    const dopo = applicaScritti(lista, { visibili: primo, scorta: [] })
    assert.equal(haDaChiamare(dopo), true)
    assert.deepEqual(daSbloccare(dopo), [])
})

test('scorta: visibilità e ordine di uscita', () => {
    assert.equal(visibileInPrimaChiamata({ scortaStato: null, cercato: false }), true)
    assert.equal(visibileInPrimaChiamata({ scortaStato: 'visibile', cercato: false }), true)
    assert.equal(visibileInPrimaChiamata({ scortaStato: 'scorta', cercato: false }), false)
    assert.equal(visibileInPrimaChiamata({ scortaStato: 'scorta', cercato: true }), true)
    const a = lead({ id: 'a', scortaStato: 'scorta', scortaDal: oreFa(2) })
    const b = lead({ id: 'b', scortaStato: 'scorta', scortaDal: oreFa(3) })
    assert.deepEqual(ordinaScorta([a, b]).map(l => l.id), ['b', 'a'])
})

test('scorta: priorità in prima chiamata (vergini della settimana, poi rango)', () => {
    assert.ok(prioritaScorta(vergine({ createdAt: oreFa(30) }), ORA) > prioritaScorta(lettoJs(), ORA))
    assert.ok(prioritaScorta(lettoJs(), ORA) > prioritaScorta(lettoC10(), ORA))
    assert.ok(prioritaScorta(lettoC10(), ORA) > prioritaScorta(lead(), ORA))
    assert.ok(prioritaScorta(vergine(), ORA) < 8, 'resta sotto un gradino della board (×8)')
})

test('scorta: dati dagli eventi (ultima restituzione, passaggio dal bot, ora di arrivo)', () => {
    const gdo = 'g1'
    const d = datiDaEventi([
        { eventType: 'REASSIGNED_FROM_BOT', userId: gdo, timestamp: '2026-10-28T10:00:00Z', reason: 'mai_risposto', instradato: 'letto' },
        { eventType: 'BOT_PUSHED', userId: null, timestamp: '2026-10-27T10:00:00Z' },
        { eventType: 'REASSIGNED_FROM_BOT', userId: 'altro', timestamp: '2026-10-29T10:00:00Z', reason: 'chat_interrotta', instradato: null },
        { eventType: 'REASSIGNED_ADMIN', userId: null, timestamp: '2026-10-30T09:00:00Z', toAssigneeId: gdo },
    ], gdo, null, new Date('2026-10-01T00:00:00Z'))
    assert.equal(d.ultimoMotivo, 'chat_interrotta')
    assert.equal(d.ultimoInstradato, null)
    assert.equal(d.passatoDalBot, true)
    assert.equal(d.arrivedAt.toISOString(), '2026-10-30T09:00:00.000Z')
    const vuoto = datiDaEventi([], gdo, new Date('2026-10-02T00:00:00Z'), new Date('2026-10-01T00:00:00Z'))
    assert.deepEqual(vuoto, { ultimoMotivo: null, ultimoInstradato: null, passatoDalBot: false, arrivedAt: new Date('2026-10-02T00:00:00Z') })
})

test('scorta: giorni stimati', () => {
    assert.equal(stimaGiorni(0, []), 0)
    assert.equal(stimaGiorni(100, []), null)
    assert.equal(stimaGiorni(100, [{ consumati: 0, arrivi: 5 }]), null, 'giorni senza lavoro non contano')
    assert.equal(stimaGiorni(100, [{ consumati: 40, arrivi: 10 }, { consumati: 30, arrivi: 20 }]), 5)
    assert.equal(stimaGiorni(100, [{ consumati: 10, arrivi: 30 }]), null, 'arriva più di quanto consuma')
})
