import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    calcolaBrochure, eLeadBrochure, ingressoBrochure, inizioRisposte, lunediDi, nomeProfessione, pct,
    professioneDaFrase, utmDaBrochure, PROFESSIONE_NON_INDICATA,
    type ChatBrochure, type LeadBrochure,
} from './brochure'

test('la campagna della brochure si riconosce da "pdf" o "brochure" negli utm', () => {
    assert.equal(utmDaBrochure(['meta', 'paid', 'Campagna di Ret - pdf', 'Video 1  smm', null]), true)
    assert.equal(utmDaBrochure([null, null, 'Brochure gratuita']), true)
    assert.equal(utmDaBrochure(['PDF']), true)
    // "pdf" dentro una parola non conta
    assert.equal(utmDaBrochure(['Facebook', 'Paid', 'pdfx test', 'apdf']), false)
    assert.equal(utmDaBrochure(['Facebook', 'Paid', '|CBO| - Telegram - Scaling']), false)
    assert.equal(utmDaBrochure([null, undefined]), false)
})

test('lead brochure: funnel PROFESSIONI, frase al bot o campagna', () => {
    assert.equal(eLeadBrochure({ funnel: 'PROFESSIONI', utm: [], haScrittoFrase: false }), true)
    assert.equal(eLeadBrochure({ funnel: 'professioni ', utm: [], haScrittoFrase: false }), true)
    assert.equal(eLeadBrochure({ funnel: 'TELEGRAM', utm: [], haScrittoFrase: true }), true)
    assert.equal(eLeadBrochure({ funnel: 'TELEGRAM', utm: ['Campagna di Ret - pdf'], haScrittoFrase: false }), true)
    assert.equal(eLeadBrochure({ funnel: 'TELEGRAM', utm: ['Cbo - Telegram - Scaling'], haScrittoFrase: false }), false)
})

test('professione dalla frase del link e dagli slug del bot', () => {
    assert.equal(professioneDaFrase('Ciao, sono interessato alla professione di Social Media Manager e vorrei ricevere la scheda del corso'), 'Social Media Manager')
    assert.equal(professioneDaFrase('Ciao, sono interessato alla professione di Video Editor e vorrei ricevere la scheda del corso.'), 'Video Editor')
    assert.equal(professioneDaFrase('Ciao, vorrei info'), null)
    assert.equal(professioneDaFrase(null), null)
    assert.equal(nomeProfessione('social_media_manager'), 'Social Media Manager')
    assert.equal(nomeProfessione('sviluppatore_web_ai'), 'Sviluppatore Web AI')
    assert.equal(nomeProfessione('Graphic Designer'), 'Graphic Designer')
    assert.equal(nomeProfessione('astronauta'), null)
})

test('ingresso: la creazione per chi viene dalla campagna, la frase per gli altri', () => {
    const creato = new Date('2026-09-01T10:00:00Z')
    const frase = new Date('2026-11-05T10:00:00Z')
    assert.equal(ingressoBrochure({ createdAt: creato, daCampagna: true, scrittoIl: frase }), creato)
    assert.equal(ingressoBrochure({ createdAt: creato, daCampagna: false, scrittoIl: frase }), frase)
    assert.equal(ingressoBrochure({ createdAt: creato, daCampagna: false, scrittoIl: null }), creato)
})

test('le risposte si contano dopo la frase, non dalla frase', () => {
    const ingresso = new Date('2026-11-05T10:00:00Z')
    assert.equal(inizioRisposte(ingresso, null).toISOString(), ingresso.toISOString())
    assert.equal(inizioRisposte(ingresso, ingresso).toISOString(), '2026-11-05T10:00:05.000Z')
    // frase molto prima dell'ingresso (lead da campagna che aveva scritto prima): vale l'ingresso
    assert.equal(inizioRisposte(ingresso, new Date('2026-11-01T10:00:00Z')).toISOString(), ingresso.toISOString())
})

test('settimane da lunedì', () => {
    assert.equal(lunediDi('2026-11-10'), '2026-11-09') // martedì
    assert.equal(lunediDi('2026-11-09'), '2026-11-09') // lunedì
    assert.equal(lunediDi('2026-11-08'), '2026-11-02') // domenica
})

test('percentuali sul totale, mai a cascata', () => {
    assert.equal(pct(1, 3), 33.3)
    assert.equal(pct(0, 0), null)
    assert.equal(pct(null, 10), null)
})

const base = (over: Partial<LeadBrochure> & { id: string; ingresso: string }): LeadBrochure => ({
    daCampagna: false, haScrittoFrase: true, professione: null, assignedToId: null,
    appuntamento: false, confermato: false, presente: false, chiuso: false, euro: 0, ...over,
})

const ADESSO = new Date('2026-11-10T12:00:00Z')
const INIZIO = new Date('2026-10-14T22:00:00Z')

const LEADS: LeadBrochure[] = [
    base({ id: 'a', ingresso: '2026-11-03T13:57:00Z', professione: 'Social Media Manager', assignedToId: 'bot', daCampagna: true }),
    base({ id: 'b', ingresso: '2026-11-04T19:45:00Z', professione: 'Social Media Manager', assignedToId: 'gdo1', appuntamento: true, confermato: true, presente: true, chiuso: true, euro: 2500 }),
    base({ id: 'c', ingresso: '2026-11-09T11:22:00Z', professione: null, assignedToId: 'gdo1', appuntamento: true, daCampagna: true, haScrittoFrase: false }),
    base({ id: 'd', ingresso: '2026-11-10T07:25:00Z', professione: 'Copywriter', assignedToId: null }),
]
const ASSEGNATARI = [
    { id: 'bot', nome: 'Mario', bot: true, ruolo: 'GDO' },
    { id: 'gdo1', nome: 'Antony (105)', bot: false, ruolo: 'GDO' },
]

test('calcolo: totali, percentuali sul totale, settimane, giorni, professioni e chi li ha in mano', () => {
    const chat: ChatBrochure[] = [
        { leadId: 'a', conChat: true, consegnato: true, risposto: false, schedaInviataAt: '2026-11-03T13:57:16Z', professione: 'copywriter' },
        { leadId: 'b', conChat: true, consegnato: true, risposto: true, schedaInviataAt: '2026-11-04T19:45:17Z' },
        { leadId: 'c', conChat: true, consegnato: false, risposto: false, schedaInviataAt: null },
        { leadId: 'd', conChat: false, consegnato: false, risposto: false, schedaInviataAt: null },
    ]
    const r = calcolaBrochure({ adesso: ADESSO, inizio: INIZIO, leads: LEADS, chat, assegnatari: ASSEGNATARI })
    const t = r.totale.stadi
    assert.equal(t.lead, 4)
    assert.equal(t.conChat, 3)
    assert.equal(t.consegnati, 2)
    assert.equal(t.brochure, 2)
    assert.equal(t.risposto, 1)
    assert.equal(t.appuntamenti, 2)
    assert.equal(t.confermati, 1)
    assert.equal(t.presenti, 1)
    assert.equal(t.chiusi, 1)
    assert.equal(t.euro, 2500)
    // sul totale (4), non su chi ha la chat o su chi ha fissato
    assert.equal(r.totale.perc.brochure, 50)
    assert.equal(r.totale.perc.risposto, 25)
    assert.equal(r.totale.perc.confermati, 25)
    assert.equal(r.schedaDisponibile, true)
    assert.equal(r.botDisponibile, true)

    // settimane: la più recente in alto, da lunedì 2/11
    assert.deepEqual(r.perSettimana.map(s => [s.chiave, s.stadi.lead]), [['2026-11-09', 2], ['2026-11-02', 2]])
    assert.equal(r.perSettimana[1].etichetta, '2/11 – 8/11')
    // giorni dal primo arrivo a oggi, anche quelli vuoti
    assert.equal(r.perGiorno.length, 8)
    assert.equal(r.perGiorno[0].chiave, '2026-11-10')
    assert.equal(r.perGiorno.at(-1)!.chiave, '2026-11-03')
    assert.equal(r.perGiorno.find(g => g.chiave === '2026-11-05')!.stadi.lead, 0)
    assert.equal(r.perGiorno.reduce((s, g) => s + g.stadi.lead, 0), 4)

    // professione: quella del bot vince sulla frase (a → Copywriter); "Non indicata" in fondo
    assert.deepEqual(r.perProfessione.map(p => [p.chiave, p.stadi.lead]), [
        ['Copywriter', 2], ['Social Media Manager', 1], [PROFESSIONE_NON_INDICATA, 1],
    ])

    // chi li ha in mano: bot, GDO, nessuno
    assert.deepEqual(r.inMano.map(m => [m.tipo, m.etichetta, m.lead, m.perc]), [
        ['bot', 'Bot (Mario)', 1, 25],
        ['gdo', 'Antony (105)', 2, 50],
        ['nessuno', 'Nessuno (da assegnare)', 1, 25],
    ])
    assert.deepEqual(r.riconosciuti, { soloCampagna: 1, soloFrase: 2, entrambi: 1 })
})

test('bot giù: le colonne della chat sono vuote, il resto c\'è', () => {
    const r = calcolaBrochure({ adesso: ADESSO, inizio: INIZIO, leads: LEADS, chat: null, assegnatari: ASSEGNATARI })
    assert.equal(r.botDisponibile, false)
    assert.equal(r.totale.stadi.conChat, null)
    assert.equal(r.totale.stadi.brochure, null)
    assert.equal(r.totale.perc.risposto, null)
    assert.equal(r.totale.stadi.appuntamenti, 2)
    assert.equal(r.totale.perc.appuntamenti, 50)
})

test('il bot non manda la scheda: brochure non disponibile, risposte sì', () => {
    const chat: ChatBrochure[] = LEADS.map(l => ({ leadId: l.id, conChat: true, consegnato: true, risposto: l.id === 'a' }))
    const r = calcolaBrochure({ adesso: ADESSO, inizio: INIZIO, leads: LEADS, chat, assegnatari: ASSEGNATARI })
    assert.equal(r.schedaDisponibile, false)
    assert.equal(r.totale.stadi.brochure, null)
    assert.equal(r.totale.stadi.risposto, 1)
})

test('nessun lead: niente giorni, niente divisioni per zero', () => {
    const r = calcolaBrochure({ adesso: ADESSO, inizio: INIZIO, leads: [], chat: [], assegnatari: [] })
    assert.equal(r.totale.stadi.lead, 0)
    assert.equal(r.totale.perc.appuntamenti, null)
    assert.deepEqual(r.perGiorno, [])
    assert.deepEqual(r.perSettimana, [])
    assert.deepEqual(r.inMano, [])
})
