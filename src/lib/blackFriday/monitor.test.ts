import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    calcolaMonitorBf, canaleDi, giorniDal, pct,
    type InputMonitorBf, type LeadBf,
} from './monitor'

const BOT = 'bot'
const ZORA = 'zora'
const ANTONY = 'antony'
const ADESSO = new Date('2026-11-09T14:00:00Z') // 15:00 Roma
const INIZIO = new Date('2026-11-06T23:00:00Z') // 07/11 00:00 Roma

function lead(p: Partial<LeadBf> & { id: string }): LeadBf {
    return {
        createdAt: new Date('2026-11-07T10:00:00Z'), utmSource: 'Meta', status: 'NEW', assignedToId: BOT,
        appointmentDate: null, confirmationsOutcome: null, confirmationsDiscardReason: null, presentedAt: null,
        salespersonOutcome: null, closeAmountEur: null, closeProduct: null,
        ...p,
    }
}

function base(over: Partial<InputMonitorBf> = {}): InputMonitorBf {
    return {
        adesso: ADESSO, inizio: INIZIO,
        leads: [], eventi: [], chiamate: [],
        gdo: [
            { id: ZORA, codice: 106, nome: 'Zora', attivo: true, bot: false },
            { id: ANTONY, codice: 105, nome: 'Antony', attivo: true, bot: false },
            { id: BOT, codice: 201, nome: 'Bot', attivo: true, bot: true },
        ],
        carichi: [], attivita: [], funnelBot: [],
        ...over,
    }
}

test('pct: un decimale, sempre sul totale, null senza denominatore', () => {
    assert.equal(pct(15, 70), 21.4)
    assert.equal(pct(1, 3), 33.3)
    assert.equal(pct(0, 0), null)
})

test('giorniDal: dal 7/11 a oggi in ora di Roma', () => {
    assert.deepEqual(giorniDal(INIZIO, ADESSO), ['2026-11-07', '2026-11-08', '2026-11-09'])
    // 23:30 UTC del 9/11 è già il 10/11 a Roma
    assert.deepEqual(giorniDal(INIZIO, new Date('2026-11-09T23:30:00Z')).slice(-1), ['2026-11-10'])
})

test('canaleDi: utmSource in parole', () => {
    assert.equal(canaleDi('Meta'), 'meta')
    assert.equal(canaleDi('bioorg'), 'instagram')
    assert.equal(canaleDi('Email'), 'email')
    assert.equal(canaleDi('Telegram'), 'telegram')
    assert.equal(canaleDi('Facebook'), 'altro')
    assert.equal(canaleDi(null), 'altro')
})

test('imbuto: giorno di ingresso in ora di Roma, somme dei giorni = totale', () => {
    const r = calcolaMonitorBf(base({
        leads: [
            // 23:30 UTC del 7/11 = 8/11 a Roma
            lead({ id: 'a', createdAt: new Date('2026-11-07T23:30:00Z'), status: 'APPOINTMENT', appointmentDate: new Date('2026-11-09T09:00:00Z'), confirmationsOutcome: 'confermato', presentedAt: new Date('2026-11-09T09:05:00Z'), salespersonOutcome: 'Chiuso', closeAmountEur: 2890, closeProduct: 'exclusive' }),
            lead({ id: 'b', status: 'APPOINTMENT', appointmentDate: new Date('2026-11-09T10:00:00Z'), confirmationsOutcome: 'scartato', confirmationsDiscardReason: 'disoccupato' }),
            lead({ id: 'c', status: 'APPOINTMENT', appointmentDate: new Date('2026-11-10T18:00:00Z') }),
            lead({ id: 'd' }),
            lead({ id: 'e', createdAt: new Date('2026-11-09T08:00:00Z') }),
        ],
    }))
    const t = r.imbuto.totale
    assert.equal(t.entrati, 5)
    assert.equal(t.appuntamenti, 3)
    assert.equal(t.pctAppuntamenti, 60)
    assert.equal(t.confermati, 1)
    assert.equal(t.scartati, 1)
    assert.deepEqual(t.motiviScarto, { disoccupato: 1 })
    assert.equal(t.inAttesa, 1)
    assert.equal(t.presenti, 1)
    assert.equal(t.chiusi, 1)
    assert.equal(t.euroChiusi, 2890)
    assert.equal(t.futuri, 1)
    assert.deepEqual(r.imbuto.giorni.map(g => g.giorno), ['2026-11-07', '2026-11-08', '2026-11-09'])
    assert.deepEqual(r.imbuto.giorni.map(g => g.dati.entrati), [3, 1, 1])
    assert.equal(r.imbuto.giorni[1].dati.chiusi, 1)
    assert.equal(r.controlli.ok, true)
})

test('esiti: appuntamento del bot o di un GDO, scarto del bot, ridati per motivo, tolti a mano, col bot', () => {
    const r = calcolaMonitorBf(base({
        leads: [
            lead({ id: 'app-bot', status: 'APPOINTMENT', appointmentDate: new Date('2026-11-10T09:00:00Z') }),
            lead({ id: 'app-gdo', status: 'APPOINTMENT', appointmentDate: new Date('2026-11-10T09:00:00Z'), assignedToId: ZORA }),
            lead({ id: 'scart', status: 'REJECTED' }),
            lead({ id: 'mai', assignedToId: ZORA }),
            lead({ id: 'mai-scartato-gdo', assignedToId: ANTONY, status: 'REJECTED' }),
            lead({ id: 'interr', assignedToId: ZORA }),
            lead({ id: 'mano', assignedToId: ANTONY }),
            lead({ id: 'attiva' }),
            lead({ id: 'nessuno', assignedToId: null }),
        ],
        chiamate: [
            { leadId: 'app-bot', userId: BOT, outcome: 'APPUNTAMENTO', at: new Date('2026-11-08T10:00:00Z') },
            { leadId: 'app-gdo', userId: ZORA, outcome: 'APPUNTAMENTO', at: new Date('2026-11-08T10:00:00Z') },
            { leadId: 'scart', userId: BOT, outcome: 'DA_SCARTARE', at: new Date('2026-11-08T10:00:00Z') },
            { leadId: 'mai-scartato-gdo', userId: ANTONY, outcome: 'DA_SCARTARE', at: new Date('2026-11-09T13:00:00Z') },
        ],
        eventi: [
            { leadId: 'app-gdo', eventType: 'REASSIGNED_FROM_BOT', reason: 'chat_interrotta', manuale: false, at: new Date('2026-11-08T08:00:00Z') },
            { leadId: 'mai', eventType: 'REASSIGNED_FROM_BOT', reason: 'mai_risposto', manuale: false, at: new Date('2026-11-08T08:00:00Z') },
            { leadId: 'mai-scartato-gdo', eventType: 'REASSIGNED_FROM_BOT', reason: 'mai_risposto', manuale: false, at: new Date('2026-11-08T08:00:00Z') },
            { leadId: 'interr', eventType: 'REASSIGNED_FROM_BOT', reason: 'chat_interrotta', manuale: false, at: new Date('2026-11-08T08:00:00Z') },
            { leadId: 'mano', eventType: 'REASSIGNED_FROM_BOT', reason: 'mai_risposto', manuale: true, at: new Date('2026-11-09T13:52:00Z') },
        ],
    }))
    const c = Object.fromEntries(r.esiti.voci.map(v => [v.chiave, v.lead]))
    assert.deepEqual(c, {
        appuntamento_bot: 1, appuntamento_gdo: 1, scartato_bot: 1, ridato_mai_risposto: 2,
        ridato_chat_interrotta: 1, tolto_a_mano: 1, col_bot: 1, altro: 1,
    })
    assert.equal(r.esiti.totale, 9)
    // percentuale sul totale dei lead, non su chi risponde
    assert.equal(r.esiti.voci.find(v => v.chiave === 'col_bot')!.pct, 11.1)
    // ridati: i manuali fuori dal conteggio
    assert.equal(r.ridati.totale, 4)
    assert.deepEqual(r.ridati.perMotivo, { mai_risposto: 2, chat_interrotta: 2 })
    assert.equal(r.ridati.fissatiDaiGdo, 1)
    assert.equal(r.ridati.chiamatiDaGdo, 2) // app-gdo (Zora) e mai-scartato-gdo (Antony)
    assert.equal(r.ridati.daChiamare, 2) // mai e interr
})

test('tabella GDO: carichi, chiamate di oggi, BF in mano e da chiamare; bot a parte; somme', () => {
    const r = calcolaMonitorBf(base({
        leads: [
            lead({ id: 'z1', assignedToId: ZORA }),
            lead({ id: 'z2', assignedToId: ZORA, status: 'IN_PROGRESS' }),
            lead({ id: 'z3', assignedToId: ZORA, status: 'APPOINTMENT', appointmentDate: new Date('2026-11-10T10:00:00Z') }),
            lead({ id: 'b1' }),
            lead({ id: 'b2', status: 'APPOINTMENT', appointmentDate: new Date('2026-11-10T10:00:00Z') }),
            lead({ id: 'n1', assignedToId: null }),
        ],
        chiamate: [
            { leadId: 'z2', userId: ZORA, outcome: 'NON_RISPOSTO', at: new Date('2026-11-09T13:30:00Z') },
            { leadId: 'b2', userId: BOT, outcome: 'APPUNTAMENTO', at: new Date('2026-11-09T08:00:00Z') },
        ],
        carichi: [{ userId: ZORA, aperti: 98, maiChiamati: 90, richiamiOggi: 8, richiamiScaduti: 3 }],
        attivita: [{ userId: ZORA, chiamate: 47, appuntamenti: 1 }, { userId: BOT, chiamate: 5, appuntamenti: 2 }],
    }))
    const zora = r.gdo.righe.find(g => g.codice === 106)!
    assert.equal(zora.aperti, 98)
    assert.equal(zora.maiChiamati, 90)
    assert.equal(zora.richiamiOggi, 8)
    assert.equal(zora.richiamiScaduti, 3)
    assert.equal(zora.chiamateOggi, 47)
    assert.equal(zora.appuntamentiOggi, 1)
    assert.equal(zora.bfInMano, 3)
    assert.equal(zora.bfDaChiamare, 1) // z1: aperto, mai chiamato da un umano
    const antony = r.gdo.righe.find(g => g.codice === 105)!
    assert.equal(antony.bfInMano, 0)
    assert.equal(r.gdo.righe.some(g => g.codice === 201), false)
    assert.deepEqual(r.gdo.bot, { bfInMano: 2, conAppuntamento: 1, aperti: 1, scartati: 0 })
    assert.equal(r.gdo.bfSenzaAssegnatario, 1)
    assert.equal(r.controlli.ok, true)
})

test('tabella GDO: un GDO disattivato compare solo se ha BF in mano', () => {
    const r = calcolaMonitorBf(base({
        gdo: [
            { id: ZORA, codice: 106, nome: 'Zora', attivo: true, bot: false },
            { id: 'via', codice: 118, nome: 'Lorenzo', attivo: false, bot: false },
            { id: 'via2', codice: 108, nome: 'GDO 108', attivo: false, bot: false },
            { id: BOT, codice: 201, nome: 'Bot', attivo: true, bot: true },
        ],
        leads: [lead({ id: 'x', assignedToId: 'via' })],
    }))
    assert.deepEqual(r.gdo.righe.map(g => g.codice), [106, 118])
    assert.equal(r.gdo.righe[1].attivo, false)
})

test('per canale: lead, appuntamenti e % sul totale dei lead del canale', () => {
    const r = calcolaMonitorBf(base({
        leads: [
            lead({ id: '1', utmSource: 'Meta', status: 'APPOINTMENT', appointmentDate: new Date('2026-11-10T10:00:00Z') }),
            lead({ id: '2', utmSource: 'Meta' }),
            lead({ id: '3', utmSource: 'bioorg' }),
        ],
    }))
    const meta = r.canali.find(c => c.chiave === 'meta')!
    assert.equal(meta.lead, 2)
    assert.equal(meta.appuntamenti, 1)
    assert.equal(meta.pctAppuntamenti, 50)
    assert.equal(r.canali.find(c => c.chiave === 'instagram')!.lead, 1)
    assert.equal(r.canali.reduce((s, c) => s + c.lead, 0), 3)
})

test('confronto funnel del bot: BF in testa, altri funnel sommati, % sui lead', () => {
    const r = calcolaMonitorBf(base({
        funnelBot: [
            { funnel: 'BLACK FRIDAY', lead: 70, appuntamenti: 15, etaMediaOre: 20 },
            { funnel: 'CORSO 10 ORE', lead: 364, appuntamenti: 40, etaMediaOre: 30 },
            { funnel: 'JOB SIMULATOR', lead: 100, appuntamenti: 8, etaMediaOre: 28 },
            { funnel: 'TELEGRAM', lead: 82, appuntamenti: 9, etaMediaOre: 25 },
            { funnel: 'SOCIAL', lead: 4, appuntamenti: 1, etaMediaOre: 40 },
        ],
    }))
    assert.equal(r.confronto.bf!.pctAppuntamenti, 21.4)
    assert.equal(r.confronto.altri.lead, 550)
    assert.equal(r.confronto.altri.appuntamenti, 58)
    assert.equal(r.confronto.altri.pctAppuntamenti, 10.5)
    // età media pesata sui lead
    assert.equal(r.confronto.altri.etaMediaOre, Math.round(10 * (364 * 30 + 100 * 28 + 82 * 25 + 4 * 40) / 550) / 10)
    assert.deepEqual(r.confronto.dettaglio.map(f => f.funnel), ['CORSO 10 ORE', 'JOB SIMULATOR', 'TELEGRAM'])
})

test('da tenere d\'occhio: ridati non chiamati oltre le ore, senza assegnatario, fermi sul bot, appuntamenti passati senza esito', () => {
    const r = calcolaMonitorBf(base({
        leads: [
            lead({ id: 'r-vecchio', assignedToId: ZORA }),
            lead({ id: 'r-recente', assignedToId: ZORA }),
            lead({ id: 'r-chiamato', assignedToId: ANTONY, status: 'IN_PROGRESS' }),
            lead({ id: 'orfano', assignedToId: null }),
            lead({ id: 'fermo', createdAt: new Date('2026-11-07T08:00:00Z') }),
            lead({ id: 'giovane', createdAt: new Date('2026-11-09T08:00:00Z') }),
            lead({ id: 'passato', status: 'APPOINTMENT', appointmentDate: new Date('2026-11-09T08:00:00Z') }),
            lead({ id: 'passato-scartato', status: 'APPOINTMENT', appointmentDate: new Date('2026-11-09T08:00:00Z'), confirmationsOutcome: 'scartato' }),
        ],
        eventi: [
            { leadId: 'r-vecchio', eventType: 'REASSIGNED_FROM_BOT', reason: 'mai_risposto', manuale: false, at: new Date('2026-11-09T07:00:00Z') },
            { leadId: 'r-recente', eventType: 'REASSIGNED_FROM_BOT', reason: 'mai_risposto', manuale: false, at: new Date('2026-11-09T13:30:00Z') },
            { leadId: 'r-chiamato', eventType: 'REASSIGNED_FROM_BOT', reason: 'chat_interrotta', manuale: false, at: new Date('2026-11-09T07:00:00Z') },
        ],
        chiamate: [{ leadId: 'r-chiamato', userId: ANTONY, outcome: 'RICHIAMO', at: new Date('2026-11-09T13:00:00Z') }],
    }))
    const per = Object.fromEntries(r.attenzioni.map(a => [a.chiave, a]))
    assert.equal(per.ridati_non_chiamati.numero, 1)
    assert.match(per.ridati_non_chiamati.testo, /Zora 1/)
    assert.equal(per.senza_assegnatario.numero, 1)
    assert.equal(per.fermi_sul_bot.numero, 1)
    assert.equal(per.appuntamenti_senza_esito.numero, 1)
})

test('da tenere d\'occhio: niente voci quando va tutto bene', () => {
    const r = calcolaMonitorBf(base({ leads: [lead({ id: 'ok', createdAt: new Date('2026-11-09T12:00:00Z') })] }))
    assert.deepEqual(r.attenzioni, [])
})
