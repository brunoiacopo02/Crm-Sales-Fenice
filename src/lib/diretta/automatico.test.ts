import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    SOGLIA_ACCANTONAMENTO, accantonabile, carico, daSerbatoio, eAssente, eOraSerale, eRicevente, intoccabile,
    ordinaFila, pianoAccantonamento, pianoRiequilibrio, pianoSerale, serveScortaGenerale,
    type GdoGiro, type LeadGiro, type LeadSerbatoio,
} from './automatico'
import { rangoOndata, type LeadScorta } from './scorta'

const ORA = new Date('2026-11-07T20:45:00+01:00')
const oreFa = (h: number) => new Date(ORA.getTime() - h * 3600_000)
const giorniFa = (g: number) => oreFa(g * 24)

let n = 0
function lead(p: Partial<LeadGiro> = {}): LeadGiro {
    n++
    return {
        id: p.id ?? `l${String(n).padStart(5, '0')}`,
        status: 'NEW', callCount: 0, source: 'activecampaign', launchBucket: null, funnel: 'JOB SIMULATOR',
        createdAt: giorniFa(10), updatedAt: giorniFa(2), scortaStato: 'scorta', scortaDal: giorniFa(2),
        cercato: false, ultimoMotivo: 'mai_risposto', ultimoInstradato: 'letto', passatoDalBot: true,
        arrivedAt: giorniFa(3), assignedToId: 'g105', recallDate: null, appointmentDate: null, presentedAt: null,
        lastCallDate: null, inConferme: false, lancio: false, ridatoDalBot: true, version: 1,
        ...p,
    }
}
const vergine = (p: Partial<LeadGiro> = {}) => lead({
    source: 'activecampaign', ultimoMotivo: null, ultimoInstradato: null, passatoDalBot: false, ridatoDalBot: false,
    createdAt: oreFa(5), arrivedAt: oreFa(5), scortaStato: 'visibile', scortaDal: null, ...p,
})
function gdo(codice: number, p: Partial<GdoGiro> = {}): GdoGiro {
    return { id: `g${codice}`, codice, inGiro: true, ultimaChiamata: oreFa(3), creatoIl: giorniFa(200), ...p }
}
const tanti = (k: number, p: Partial<LeadGiro> = {}) => Array.from({ length: k }, () => lead(p))

test('assenza: niente chiamate da 3 giorni; un account nuovo non è assente', () => {
    assert.equal(eAssente(gdo(109, { ultimaChiamata: giorniFa(4) }), ORA), true)
    assert.equal(eAssente(gdo(109, { ultimaChiamata: null }), ORA), true)
    assert.equal(eAssente(gdo(120, { ultimaChiamata: null, creatoIl: giorniFa(1) }), ORA), false)
    assert.equal(eAssente(gdo(106, { ultimaChiamata: giorniFa(2) }), ORA), false)
    assert.equal(eRicevente(gdo(106, { inGiro: false }), ORA), false)
    assert.equal(eRicevente(gdo(109, { ultimaChiamata: giorniFa(5) }), ORA), false)
})

test('intoccabili: toccati negli ultimi 30 minuti, appuntamento, Conferme, lancio', () => {
    assert.equal(intoccabile(lead(), ORA), false)
    assert.equal(intoccabile(lead({ updatedAt: new Date(ORA.getTime() - 29 * 60_000) }), ORA), true)
    assert.equal(intoccabile(lead({ updatedAt: new Date(ORA.getTime() - 31 * 60_000) }), ORA), false)
    assert.equal(intoccabile(lead({ lastCallDate: new Date(ORA.getTime() - 10 * 60_000) }), ORA), true)
    assert.equal(intoccabile(lead({ appointmentDate: giorniFa(-1) }), ORA), true)
    assert.equal(intoccabile(lead({ presentedAt: giorniFa(1) }), ORA), true)
    assert.equal(intoccabile(lead({ inConferme: true }), ORA), true)
    assert.equal(intoccabile(lead({ lancio: true }), ORA), true)
    assert.equal(intoccabile(lead({ status: 'REJECTED' }), ORA), true)
})

test('accantonamento: soglia 60 contando la scorta, mai sotto 60', () => {
    const g = [gdo(105), gdo(106)]
    // 105: 60 in prima chiamata (scorta compresa) → nulla.
    const a = [...tanti(40, { assignedToId: 'g105' }), ...tanti(20, { assignedToId: 'g105', scortaStato: 'visibile' })]
    assert.equal(carico(a, 'g105'), 60)
    assert.equal(pianoAccantonamento(g, a, ORA).length, 0, 'a 60 non si accantona nulla')
    // 106: 75 → se ne accantonano 15, prima quelli in scorta.
    const b = [...tanti(65, { assignedToId: 'g106' }), ...tanti(10, { assignedToId: 'g106', scortaStato: 'visibile' })]
    const p = pianoAccantonamento(g, b, ORA)
    assert.equal(p.length, 75 - SOGLIA_ACCANTONAMENTO)
    const perId = new Map(b.map(l => [l.id, l]))
    assert.ok(p.every(x => perId.get(x.leadId)!.scortaStato === 'scorta'))
})

test('accantonamento: solo ridati oltre 8 giorni, non stelle, non intoccabili, non mai consegnati', () => {
    assert.equal(accantonabile(lead(), ORA), true)
    assert.equal(accantonabile(lead({ createdAt: giorniFa(7) }), ORA), false, 'entrato da meno di 8 giorni')
    assert.equal(accantonabile(lead({ ridatoDalBot: false }), ORA), false)
    assert.equal(accantonabile(lead({ ultimoMotivo: 'chat_interrotta' }), ORA), false, 'le stelle restano')
    assert.equal(accantonabile(lead({ cercato: true }), ORA), false)
    assert.equal(accantonabile(lead({ ultimoInstradato: 'mai_consegnato' }), ORA), false)
    assert.equal(accantonabile(lead({ ultimoMotivo: 'mai_risposto_senza_chat_bot' }), ORA), false)
    assert.equal(accantonabile(lead({ updatedAt: new Date(ORA.getTime() - 5 * 60_000) }), ORA), false, 'toccato da 5 minuti')
    assert.equal(accantonabile(lead({ callCount: 1 }), ORA), false)
    assert.equal(accantonabile(lead({ recallDate: giorniFa(-1) }), ORA), false)
    // Un GDO a 70 con 5 soli accantonabili: se ne accantonano 5.
    const g = [gdo(110)]
    const l = [...tanti(5, { assignedToId: 'g110' }), ...tanti(65, { assignedToId: 'g110', createdAt: giorniFa(2) })]
    assert.equal(pianoAccantonamento(g, l, ORA).length, 5)
})

test('riequilibrio: un assente cede tutto, le prime vanno ai più scarichi, a pari Antony', () => {
    const g = [gdo(105), gdo(106), gdo(110), gdo(109, { ultimaChiamata: giorniFa(5), inGiro: false })]
    const lista = [
        ...tanti(40, { assignedToId: 'g105' }), ...tanti(40, { assignedToId: 'g106' }), ...tanti(40, { assignedToId: 'g110' }),
        ...tanti(35, { assignedToId: 'g109' }),
        ...tanti(4, { assignedToId: 'g109', callCount: 2, status: 'IN_PROGRESS' }),
        lead({ assignedToId: 'g109', appointmentDate: giorniFa(-1) }),
        lead({ assignedToId: 'g109', updatedAt: new Date(ORA.getTime() - 60_000) }),
    ]
    const p = pianoRiequilibrio(g, lista, ORA)
    const da109 = p.spostamenti.filter(s => s.da === 'g109')
    assert.equal(da109.filter(s => s.tipo === 'prima').length, 35)
    assert.equal(da109.filter(s => s.tipo === 'lavorato').length, 4)
    assert.equal(p.spostamenti.length, 39, "appuntamento e toccato da un minuto restano a Giusy")
    // Totale 155 su 3,5 parti: Antony ~66, gli altri ~44.
    const ricevuti = (id: string) => p.spostamenti.filter(s => s.a === id && s.tipo === 'prima').length
    assert.ok(ricevuti('g105') > ricevuti('g106'), 'Antony con priorità ne riceve di più')
    assert.equal(p.caricoDopo['g109'], 1, "resta solo il toccato da un minuto (l'appuntamento non è in prima chiamata)")
    // I lavorati: a turno, Antony per primo.
    const lav = p.spostamenti.filter(s => s.tipo === 'lavorato')
    assert.equal(lav[0].a, 'g105')
    assert.equal(lav.filter(s => s.a === 'g105').length, 2)
})

test('riequilibrio: un presente cede solo l\'eccesso oltre quota+margine, mai i visibili né vergini o stelle', () => {
    const g = [gdo(105), gdo(106), gdo(110), gdo(116)]
    const lista = [
        ...tanti(60, { assignedToId: 'g105' }),
        ...tanti(40, { assignedToId: 'g106' }),
        ...tanti(20, { assignedToId: 'g110' }),
        ...tanti(100, { assignedToId: 'g116' }),
        ...tanti(20, { assignedToId: 'g116', scortaStato: 'visibile' }),
        vergine({ assignedToId: 'g116', scortaStato: null }),
        lead({ assignedToId: 'g116', ultimoMotivo: 'chat_interrotta', scortaStato: null }),
    ]
    const p = pianoRiequilibrio(g, lista, ORA)
    const perId = new Map(lista.map(l => [l.id, l]))
    const da116 = p.spostamenti.filter(s => s.da === 'g116')
    assert.ok(da116.length > 0)
    assert.ok(da116.every(s => perId.get(s.leadId)!.scortaStato === 'scorta'), 'escono solo i nascosti')
    assert.ok(p.spostamenti.every(s => s.motivo === 'eccesso'))
    assert.ok(!p.spostamenti.some(s => s.da === 'g105' || s.da === 'g106' || s.da === 'g110'))
    assert.ok(p.caricoDopo['g116'] >= p.quota['g116'], 'non scende sotto la sua quota')
    assert.ok(Object.keys(p.quota).every(id => id === 'g116' || p.caricoDopo[id] <= p.quota[id]), 'nessuno riempito oltre la quota')
    // 110 era il più scarico: riceve più di tutti.
    const ric = (id: string) => p.spostamenti.filter(s => s.a === id).length
    assert.ok(ric('g110') >= ric('g106'))
})

test('riequilibrio: nessuno con molti più lead → nessuno spostamento; fuori giro né cede né riceve', () => {
    const g = [gdo(105), gdo(106), gdo(115, { inGiro: false })]
    const lista = [...tanti(50, { assignedToId: 'g105' }), ...tanti(45, { assignedToId: 'g106' }), ...tanti(300, { assignedToId: 'g115' })]
    const p = pianoRiequilibrio(g, lista, ORA)
    assert.equal(p.spostamenti.length, 0)
})

test('riequilibrio: priorità Antony a parità di carico', () => {
    const g = [gdo(106), gdo(105), gdo(109, { ultimaChiamata: null })]
    const lista = [...tanti(10, { assignedToId: 'g105' }), ...tanti(10, { assignedToId: 'g106' }), lead({ assignedToId: 'g109' })]
    const p = pianoRiequilibrio(g, lista, ORA)
    assert.equal(p.spostamenti[0].a, 'g105')
})

test('fila: vergini prima di tutto, poi stelle, poi il resto', () => {
    const r = lead({ id: 'resto' })
    const s = lead({ id: 'stella', ultimoMotivo: 'chat_interrotta' })
    const v = vergine({ id: 'vergine', createdAt: giorniFa(20) })
    assert.deepEqual(ordinaFila([r, s, v], ORA).map(l => l.id), ['vergine', 'stella', 'resto'])
})

test('giro serale: accantonati fuori dal riequilibrio, orario 20:30-21:30 di Roma', () => {
    const g = [gdo(105), gdo(106)]
    const lista = [...tanti(80, { assignedToId: 'g106' }), ...tanti(10, { assignedToId: 'g105', createdAt: giorniFa(1) })]
    const p = pianoSerale(g, lista, ORA)
    assert.equal(p.accantonati.length, 20)
    const via = new Set(p.accantonati.map(a => a.leadId))
    assert.ok(p.riequilibrio.spostamenti.every(s => !via.has(s.leadId)))
    assert.equal(eOraSerale(new Date('2026-11-07T20:45:00+01:00')), true)
    assert.equal(eOraSerale(new Date('2026-11-07T20:15:00+01:00')), false, 'turno appena finito: no')
    assert.equal(eOraSerale(new Date('2026-11-07T21:45:00+01:00')), false)
    assert.equal(eOraSerale(new Date('2026-07-07T20:45:00+02:00')), true, 'ora legale')
})

test('scorta generale: solo con la scorta personale finita e 5 o meno da chiamare', () => {
    const vis = (k: number) => Array.from({ length: k }, () => lead({ scortaStato: 'visibile' })) as LeadScorta[]
    assert.equal(serveScortaGenerale(vis(5), ORA), true)
    assert.equal(serveScortaGenerale(vis(6), ORA), false)
    assert.equal(serveScortaGenerale([...vis(2), lead({ scortaStato: 'scorta' })], ORA), false, 'prima la scorta personale')
    assert.equal(serveScortaGenerale([], ORA), true)
})

test('scorta generale: i migliori e i più freschi prima', () => {
    const s = (p: Partial<LeadSerbatoio>): LeadSerbatoio => ({
        id: p.id!, createdAt: giorniFa(5), ultimoMotivo: 'mai_risposto', ultimoInstradato: 'letto', passatoDalBot: true, motivoAccantonamento: 'mai_risposto_al_bot', ...p,
    })
    const lista = [
        s({ id: 'ridato_vecchio', createdAt: giorniFa(20) }),
        s({ id: 'ridato_fresco', createdAt: giorniFa(1) }),
        s({ id: 'senza_wa', ultimoInstradato: 'mai_consegnato', createdAt: oreFa(1) }),
        s({ id: 'stella', motivoAccantonamento: 'stella_fuori_selezione', createdAt: giorniFa(30) }),
        s({ id: 'mai_bot', passatoDalBot: false, ultimoMotivo: null }),
    ]
    assert.deepEqual(daSerbatoio(lista, 10).map(l => l.id), ['stella', 'mai_bot', 'ridato_fresco', 'ridato_vecchio', 'senza_wa'])
    assert.equal(daSerbatoio(lista, 2).length, 2)
})

test('ordine vergini (PO 07/11): sopra stelle e "Ti ha cercato", a qualunque età', () => {
    const v = vergine({ id: 'v', createdAt: giorniFa(15) })
    const s = lead({ id: 's', ultimoMotivo: 'chat_interrotta', scortaStato: 'visibile', scortaDal: null })
    const c = lead({ id: 'c', cercato: true, scortaStato: 'visibile', scortaDal: null })
    const r = rangoOndata([s, c, v], ORA)
    assert.ok(r.get('v')! > r.get('s')! && r.get('v')! > r.get('c')!)
})
