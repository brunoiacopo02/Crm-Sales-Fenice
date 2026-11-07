import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    GRAZIA_MS, PESO_ONDATA, SBLOCCO, SOGLIA_SBLOCCO, VISIBILI_INIZIALI,
    applicaScritti, classificaArrivi, conStella, daSbloccare, datiDaEventi, deveSbloccare, eVergine, gruppoUscita,
    haDaChiamare, ordinaScorta, primaAssegnazione, prioritaScorta, quantiDaChiamare, rangoOndata, rangoScorta,
    sempreVisibile, stimaGiorni, visibileInPrimaChiamata,
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
    assert.equal(eVergine(vergine({ createdAt: oreFa(24 * 30) }), ORA), true, 'PO 07/11: un vergine resta vergine a qualunque età')
    assert.equal(sempreVisibile(vergine({ createdAt: oreFa(24 * 30) }), ORA), true)
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

test('scorta: arrivi in cima o in fondo, mai visibili per un attimo (PO 30/10)', () => {
    const appena = new Date(ORA.getTime() - 1000)
    // Arrivo non caldo da classificare: non si vede né in grazia né dopo.
    const freddoInGrazia = lead({ updatedAt: appena })
    const freddoDopo = lead()
    assert.equal(visibileInPrimaChiamata(freddoInGrazia, ORA), false, 'in grazia non compare')
    assert.equal(visibileInPrimaChiamata(freddoDopo, ORA), false)
    assert.equal(haDaChiamare([freddoInGrazia], ORA), false, 'e non conta come da chiamare')
    // In grazia non si scrive (la stella può arrivare un attimo dopo), finita la grazia va in fondo.
    assert.deepEqual(classificaArrivi([freddoInGrazia], ORA), { visibili: [], scorta: [] })
    assert.deepEqual(classificaArrivi([freddoDopo], ORA).scorta, [freddoDopo.id])
    // Caldi e vergini: in cima subito, anche da classificare e in grazia.
    for (const caldo of [vergine({ updatedAt: appena }), stella({ updatedAt: appena }), lead({ cercato: true, updatedAt: appena })]) {
        assert.equal(visibileInPrimaChiamata(caldo, ORA), true)
        assert.equal(haDaChiamare([caldo], ORA), true)
        assert.deepEqual(classificaArrivi([caldo], ORA).visibili, [caldo.id])
    }
    // Diventa caldo durante la grazia (arriva l'evento della stella): alla lettura dopo compare.
    const diventaStella = { ...freddoInGrazia, ultimoMotivo: 'chat_interrotta', passatoDalBot: true }
    assert.equal(visibileInPrimaChiamata(diventaStella, ORA), true)
    assert.deepEqual(classificaArrivi([diventaStella], ORA).visibili, [diventaStella.id])
})

const visibili = (k: number, p: Partial<LeadScorta> = {}) => Array.from({ length: k }, () => lead({ scortaStato: 'visibile', ...p }))

test('scorta: soglia di sblocco (PO 06/11): 5 o meno da chiamare sblocca, 6 no', () => {
    assert.equal(SOGLIA_SBLOCCO, 5)
    const scorta = Array.from({ length: 50 }, (_, i) => lead({ scortaStato: 'scorta', scortaDal: oreFa(48), arrivedAt: oreFa(i) }))
    assert.equal(daSbloccare([...scorta, ...visibili(6)], ORA).length, 0, '6 visibili da chiamare: niente sblocco')
    assert.equal(daSbloccare([...scorta, ...visibili(5)], ORA).length, SBLOCCO, '5 visibili: sblocca 30')
    assert.equal(daSbloccare(scorta, ORA).length, SBLOCCO, '0 visibili: sblocca 30')
    assert.equal(deveSbloccare([...scorta, ...visibili(5)], ORA), true)
    assert.equal(deveSbloccare([...scorta, ...visibili(6)], ORA), false)
    assert.equal(deveSbloccare(visibili(0), ORA), false, 'scorta vuota: niente da fare')
    // I visibili già chiamati (callCount > 0) non contano.
    assert.equal(quantiDaChiamare(visibili(6, { callCount: 1 }), ORA), 0)
    // Vergini e stelle (anche da classificare) contano fra i 5.
    assert.equal(daSbloccare([...scorta, ...visibili(4), vergine(), stella()], ORA).length, 0, '4 + vergine + stella = 6')
    assert.equal(daSbloccare([...scorta, ...visibili(3), vergine(), stella()], ORA).length, SBLOCCO, '3 + vergine + stella = 5')
    // Arrivi non caldi in grazia non si vedono e non contano.
    const inGrazia = lead({ updatedAt: new Date(ORA.getTime() - 5000) })
    const conArrivo = daSbloccare([...scorta, ...visibili(5), inGrazia], ORA)
    assert.equal(conArrivo.length, SBLOCCO)
    assert.ok(!conArrivo.includes(inGrazia.id), "l'arrivo in grazia non esce con lo sblocco")
    assert.equal(daSbloccare([...scorta, ...visibili(5), lead({ cercato: true, callCount: 2 })], ORA).length, SBLOCCO,
        'un "Ti ha cercato" con tentativi alle spalle non conta')
    assert.equal(daSbloccare([...scorta, ...visibili(5), lead({ cercato: true, scortaStato: 'scorta' })], ORA).length, 0,
        'un "Ti ha cercato" mai chiamato conta, anche se era in scorta (5 + 1 = 6)')
    assert.deepEqual(daSbloccare([], ORA), [])
    assert.equal(daSbloccare(scorta.slice(0, 7), ORA).length, 7, 'fino a esaurimento')
    assert.deepEqual(daSbloccare([inGrazia], ORA), [], 'solo arrivi in grazia e scorta vuota: niente da sbloccare')
})

test('scorta: ordine di uscita (PO 06/11): mai contattati su WhatsApp, poi ridati recenti, poi senza WhatsApp', () => {
    const ridatoVecchio = lettoC10({ id: 'ridato_vecchio', scortaStato: 'scorta', scortaDal: oreFa(24 * 8), arrivedAt: oreFa(24 * 8) })
    const ridatoRecente = lettoJs({ id: 'ridato_recente', scortaStato: 'scorta', scortaDal: oreFa(1), arrivedAt: oreFa(1) })
    const ridatoMedio = lead({ id: 'ridato_medio', ultimoMotivo: 'mai_risposto', ultimoInstradato: 'letto', passatoDalBot: true, scortaStato: 'scorta', scortaDal: oreFa(30), arrivedAt: oreFa(30) })
    const maiBot = lead({ id: 'mai_bot', scortaStato: 'scorta', scortaDal: oreFa(1), arrivedAt: oreFa(100) })
    const senzaChat = lead({ id: 'senza_chat', ultimoMotivo: 'ridistribuzione_29_10_senza_chat_bot', passatoDalBot: true, scortaStato: 'scorta', scortaDal: oreFa(2), arrivedAt: oreFa(90) })
    const senzaWa = lead({ id: 'senza_wa', ultimoMotivo: 'mai_risposto', ultimoInstradato: 'mai_consegnato', passatoDalBot: true, scortaStato: 'scorta', scortaDal: oreFa(200), arrivedAt: oreFa(0.5) })
    assert.equal(gruppoUscita(maiBot), 2)
    assert.equal(gruppoUscita(senzaChat), 2)
    assert.equal(gruppoUscita(ridatoRecente), 1)
    assert.equal(gruppoUscita(senzaWa), 0)
    assert.equal(gruppoUscita(stella()), 3)
    const ordine = ordinaScorta([senzaWa, ridatoVecchio, ridatoMedio, maiBot, ridatoRecente, senzaChat]).map(l => l.id)
    assert.deepEqual(ordine, ['senza_chat', 'mai_bot', 'ridato_recente', 'ridato_medio', 'ridato_vecchio', 'senza_wa'],
        'da quanto è in scorta non conta: un ridato vecchio entrato per primo non esce per primo')
    // Il caso del 06/11 (Alessandro 110): 30 ridati vecchi entrati per primi e 30 ridati recenti entrati dopo.
    const vecchi = Array.from({ length: 30 }, (_, i) => lettoC10({ scortaStato: 'scorta', scortaDal: oreFa(24 * 8), arrivedAt: oreFa(24 * 8 + i) }))
    const recenti = Array.from({ length: 30 }, (_, i) => lead({ ultimoMotivo: 'mai_risposto', ultimoInstradato: 'letto', passatoDalBot: true, scortaStato: 'scorta', scortaDal: oreFa(2), arrivedAt: oreFa(2 + i) }))
    assert.deepEqual(new Set(daSbloccare([...vecchi, ...recenti], ORA)), new Set(recenti.map(l => l.id)))
})

test('scorta: i rimasti stanno sopra i nuovi sbloccati, vergini/stelle/cercato sopra tutto', () => {
    const T1 = oreFa(5)
    const T2 = oreFa(1)
    const iniziale = lead({ id: 'iniziale', scortaStato: 'visibile', arrivedAt: oreFa(100) })
    const rimasto = lead({ id: 'rimasto', scortaStato: 'visibile', scortaDal: T1, arrivedAt: oreFa(90) })
    const nuovo = lettoJs({ id: 'nuovo', scortaStato: 'visibile', scortaDal: T2, arrivedAt: oreFa(1) })
    const v = vergine({ id: 'vergine', scortaStato: 'visibile' })
    const s = stella({ id: 'stella', scortaStato: 'visibile', scortaDal: T2 })
    const c = lead({ id: 'cercato', cercato: true, scortaStato: 'scorta', scortaDal: oreFa(3) })
    const nascosto = lead({ id: 'nascosto', scortaStato: 'scorta', scortaDal: oreFa(3) })
    const r = rangoOndata([nuovo, rimasto, iniziale, v, s, c, nascosto], ORA)
    assert.equal(r.has('nascosto'), false, 'solo i visibili')
    assert.ok(r.get('stella')! > r.get('iniziale')! && r.get('cercato') === r.get('stella'))
    assert.ok(r.get('vergine')! > r.get('stella')!, 'PO 07/11: i vergini sopra anche stelle e "Ti ha cercato"')
    assert.ok(r.get('iniziale')! > r.get('rimasto')!, 'visibili senza sblocco sopra le ondate')
    assert.ok(r.get('rimasto')! > r.get('nuovo')!, "l'ondata più vecchia sopra la più nuova")
    // Con il peso dell'ondata nessuna priorità della board (< 256) ribalta l'ordine.
    assert.ok((r.get('rimasto')! - r.get('nuovo')!) * PESO_ONDATA > 255)
    assert.ok(prioritaScorta(vergine(), ORA) + 31 * 8 < PESO_ONDATA)

    // Flusso completo: 5 rimasti da chiamare, sblocco, i 5 stanno sopra i 30 nuovi.
    const rimasti = visibili(5, { scortaDal: T1 })
    const scorta = Array.from({ length: 40 }, (_, i) => lead({ scortaStato: 'scorta', scortaDal: oreFa(48), arrivedAt: oreFa(i) }))
    const lista = [...rimasti, ...scorta]
    const ids = daSbloccare(lista, ORA)
    const dopo = applicaScritti(lista, { visibili: [], scorta: [], sbloccati: ids }, ORA)
    const rango = rangoOndata(dopo, ORA)
    const minRimasti = Math.min(...rimasti.map(l => rango.get(l.id)!))
    const maxNuovi = Math.max(...ids.map(id => rango.get(id)!))
    assert.ok(minRimasti > maxNuovi, 'i 5 rimasti sempre in cima ai 30 sbloccati')
    assert.ok(dopo.filter(l => ids.includes(l.id)).every(l => l.scortaStato === 'visibile' && l.scortaDal?.getTime() === ORA.getTime()))
})

test('scorta: doppio sblocco (due letture in coda al lock) ne sblocca 30, non 60', () => {
    const lista = [...visibili(5), ...Array.from({ length: 80 }, (_, i) => lead({ scortaStato: 'scorta', scortaDal: oreFa(10), arrivedAt: oreFa(i) }))]
    const primo = daSbloccare(lista, ORA)
    assert.equal(primo.length, SBLOCCO)
    // La seconda richiesta rilegge sotto lock e trova i 30 già visibili: 35 > 5.
    const dopo = applicaScritti(lista, { visibili: [], scorta: [], sbloccati: primo }, ORA)
    assert.equal(quantiDaChiamare(dopo, ORA), 35)
    assert.deepEqual(daSbloccare(dopo, ORA), [])
    // Scorta quasi finita: il primo ne sblocca 2 (restano 5 + 2 = 7), il secondo niente.
    const poca = [...visibili(5), lead({ scortaStato: 'scorta' }), lead({ scortaStato: 'scorta' })]
    const p1 = daSbloccare(poca, ORA)
    assert.equal(p1.length, 2)
    assert.deepEqual(daSbloccare(applicaScritti(poca, { visibili: [], scorta: [], sbloccati: p1 }, ORA), ORA), [])
    // A zero con 2 in scorta: sblocca 2, poi la scorta è vuota e il secondo non trova niente.
    const zero = [lead({ scortaStato: 'scorta' }), lead({ scortaStato: 'scorta' })]
    const z1 = daSbloccare(zero, ORA)
    assert.equal(z1.length, 2)
    assert.deepEqual(daSbloccare(applicaScritti(zero, { visibili: [], scorta: [], sbloccati: z1 }, ORA), ORA), [])
})

test('scorta: visibilità', () => {
    assert.equal(visibileInPrimaChiamata(lead({ scortaStato: 'visibile' }), ORA), true)
    assert.equal(visibileInPrimaChiamata(lead({ scortaStato: 'visibile', scortaDal: oreFa(1) }), ORA), true, 'sbloccato: visibile')
    assert.equal(visibileInPrimaChiamata(lead({ scortaStato: 'scorta' }), ORA), false)
    assert.equal(visibileInPrimaChiamata(lead({ scortaStato: 'scorta', cercato: true }), ORA), true)
    assert.equal(haDaChiamare(visibili(1), ORA), true)
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

test('Black Friday ridato dal bot: sempre visibile, mai in scorta, sopra vergini e stelle (PO 07/11/2026)', () => {
    const bf = lead({ funnel: 'BLACK FRIDAY', passatoDalBot: true, ultimoMotivo: 'mai_risposto', scortaStato: 'scorta', scortaDal: oreFa(1) })
    const v = vergine()
    const s = stella({ scortaStato: 'visibile' })
    assert.equal(sempreVisibile(bf, ORA), true)
    assert.equal(visibileInPrimaChiamata(bf, ORA), true)
    const r = rangoOndata([bf, v, s], ORA)
    assert.ok(r.get(bf.id)! > r.get(v.id)!)
    assert.ok(r.get(v.id)! > r.get(s.id)!)
    const altro = lead({ scortaStato: 'scorta', scortaDal: oreFa(3) })
    assert.deepEqual(daSbloccare([bf, altro], ORA, 30, 5), [altro.id])
})
