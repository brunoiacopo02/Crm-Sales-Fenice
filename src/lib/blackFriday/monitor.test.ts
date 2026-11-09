import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_TARGETS } from '@/lib/diretta/config'
import {
    CAMBIO_FUNNEL_BF, calcolaMonitorBf, canaleDi, cascataSm, eConversioneBf, giorniDal, ingressoBf, oreDiTurno, pct, sigleNumero, stadiSm,
    type BotLeadBf, type DatiBotBf, type InputMonitorBf, type LeadBf,
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
        appointmentCreatedAt: null, confirmationsTimestamp: null, salespersonOutcomeAt: null,
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
        bot: null, turni: DEFAULT_TARGETS, altriSm: null,
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

test('confronto senza bot: ripiego sui lead del CRM passati dal bot, % sui lead, niente risposte', () => {
    const r = calcolaMonitorBf(base({
        funnelBot: [
            { funnel: 'BLACK FRIDAY', lead: 70, appuntamenti: 15, etaMediaOre: 20 },
            { funnel: 'CORSO 10 ORE', lead: 364, appuntamenti: 40, etaMediaOre: 30 },
            { funnel: 'JOB SIMULATOR', lead: 100, appuntamenti: 8, etaMediaOre: 28 },
            { funnel: 'TELEGRAM', lead: 82, appuntamenti: 9, etaMediaOre: 25 },
            { funnel: 'SOCIAL', lead: 4, appuntamenti: 1, etaMediaOre: 40 },
        ],
    }))
    assert.equal(r.confronto.fonte, 'crm')
    assert.equal(r.confronto.bfChatNuove, null)
    assert.equal(r.confronto.altri.risposto, null)
    assert.equal(r.bot, null)
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
            // sabato 15:00 Roma: 1,5 ore di turno sabato + 1,5 lunedì = 3 > 2
            { leadId: 'r-vecchio', eventType: 'REASSIGNED_FROM_BOT', reason: 'mai_risposto', manuale: false, at: new Date('2026-11-07T14:00:00Z') },
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

// ── Ore di turno (PO 09/11/2026) ──

test('oreDiTurno: solo le ore dentro il turno, sabato corto, domenica niente', () => {
    // venerdì 6/11 19:30 Roma → lunedì 9/11 14:00 Roma: 0,5 + 6,5 + 0 + 0,5
    assert.equal(oreDiTurno(new Date('2026-11-06T18:30:00Z'), new Date('2026-11-09T13:00:00Z'), DEFAULT_TARGETS), 7.5)
    // ridato sabato alle 18:00 e guardato domenica sera: zero ore di turno
    assert.equal(oreDiTurno(new Date('2026-11-07T17:00:00Z'), new Date('2026-11-08T20:00:00Z'), DEFAULT_TARGETS), 0)
    // lunedì mattina prima del turno: zero; dalle 13:30 alle 16:00: 2,5
    assert.equal(oreDiTurno(new Date('2026-11-09T07:00:00Z'), new Date('2026-11-09T12:00:00Z'), DEFAULT_TARGETS), 0)
    assert.equal(oreDiTurno(new Date('2026-11-09T07:00:00Z'), new Date('2026-11-09T15:00:00Z'), DEFAULT_TARGETS), 2.5)
    // turni dall'appSettings: feriale 09:00-18:00
    const turni = { ...DEFAULT_TARGETS, turnoFeriale: { start: '09:00', end: '18:00' } }
    assert.equal(oreDiTurno(new Date('2026-11-09T07:00:00Z'), new Date('2026-11-09T12:00:00Z'), turni), 4)
    assert.equal(oreDiTurno(new Date('2026-11-09T12:00:00Z'), new Date('2026-11-09T07:00:00Z'), DEFAULT_TARGETS), 0)
})

test('ridati non chiamati: la soglia è di 2 ore di turno, non di orologio', () => {
    const conRidato = (at: string, adesso: Date) => calcolaMonitorBf(base({
        adesso,
        leads: [lead({ id: 'r', assignedToId: ZORA })],
        eventi: [{ leadId: 'r', eventType: 'REASSIGNED_FROM_BOT', reason: 'mai_risposto', manuale: false, at: new Date(at) }],
    })).attenzioni.find(a => a.chiave === 'ridati_non_chiamati')
    // ridato lunedì alle 08:00 Roma, sono le 15:00: 7 ore di orologio ma 1,5 di turno → niente
    assert.equal(conRidato('2026-11-09T07:00:00Z', new Date('2026-11-09T14:00:00Z')), undefined)
    // alle 16:00 sono 2,5 ore di turno → segnalato
    assert.equal(conRidato('2026-11-09T07:00:00Z', new Date('2026-11-09T15:00:00Z'))?.numero, 1)
    // ridato sabato alle 17:00 Roma, domenica sera: zero ore di turno → niente
    assert.equal(conRidato('2026-11-07T16:00:00Z', new Date('2026-11-08T20:00:00Z')), undefined)
})

// ── Dati del bot ──

function chat(leadId: string, p: Partial<BotLeadBf> = {}): BotLeadBf {
    return { leadId, conversationId: 1, chatNuova: true, conChat: true, consegnato: true, risposto: false, waNumber: 'whatsapp:+393520158061', braccio: null, esitoBot: null, ...p }
}

test('sigleNumero: ultime quattro cifre', () => {
    assert.equal(sigleNumero('whatsapp:+393520413199'), '3199')
    assert.equal(sigleNumero(null), 'nessuno')
})

test('dati del bot: imbuto, rispondono, gruppi e confronto, tutte le % sul totale dei lead', () => {
    const app = { status: 'APPOINTMENT', appointmentDate: new Date('2026-11-10T10:00:00Z') }
    const bot: DatiBotBf = {
        lettoAlle: ADESSO.toISOString(),
        leads: [
            chat('a', { risposto: true, braccio: 'opus', waNumber: 'whatsapp:+393520413199' }),
            chat('b', { risposto: true, braccio: 'sonnet' }),
            chat('c', { risposto: true, braccio: 'sonnet', chatNuova: false }),
            chat('d', { chatNuova: false, consegnato: false }),
            { ...chat('e'), conversationId: null, chatNuova: null, conChat: false, consegnato: false, waNumber: null },
        ],
        funnel: [
            { funnel: 'BLACK FRIDAY', chat: 3, risposto: 2, appuntamenti: 1, etaMediaOre: 10 },
            { funnel: 'CORSO 10 ORE', chat: 100, risposto: 50, appuntamenti: 10, etaMediaOre: 30 },
            { funnel: 'TELEGRAM', chat: 50, risposto: 20, appuntamenti: 5, etaMediaOre: 24 },
        ],
    }
    const r = calcolaMonitorBf(base({
        bot,
        leads: [
            lead({ id: 'a', ...app }), lead({ id: 'b', ...app }), lead({ id: 'c' }), lead({ id: 'd' }),
            lead({ id: 'e', createdAt: new Date('2026-11-09T08:00:00Z') }),
        ],
    }))
    const t = r.imbuto.totale
    assert.equal(t.conChat, 4)
    assert.equal(t.consegnato, 3)
    assert.equal(t.risposto, 3)
    assert.equal(t.pctRisposto, 60) // 3 su 5 lead, non su 3 consegnati
    assert.deepEqual(r.imbuto.giorni.map(g => g.dati.risposto), [3, 0, 0])
    assert.equal(r.controlli.ok, true)
    // confronto
    assert.equal(r.confronto.fonte, 'bot')
    assert.deepEqual([r.confronto.bfTutti.lead, r.confronto.bfTutti.risposto, r.confronto.bfTutti.pctRisposto, r.confronto.bfTutti.pctAppuntamenti], [5, 3, 60, 40])
    assert.deepEqual([r.confronto.bfChatNuove!.lead, r.confronto.bfChatNuove!.pctRisposto], [3, 66.7])
    assert.deepEqual([r.confronto.altri.lead, r.confronto.altri.risposto, r.confronto.altri.appuntamenti, r.confronto.altri.pctRisposto], [150, 70, 15, 46.7])
    assert.equal(r.confronto.altri.etaMediaOre, 28)
    assert.deepEqual(r.confronto.dettaglio.map(x => x.funnel), ['CORSO 10 ORE', 'TELEGRAM'])
    // canali
    assert.equal(r.canali[0].risposto, 3)
    // nuovi / noti / senza chat
    const nn = Object.fromEntries(r.bot!.nuoviNoti.map(g => [g.chiave, g]))
    assert.deepEqual([nn.nuovi.lead, nn.nuovi.risposto, nn.nuovi.pctRisposto], [2, 2, 100])
    assert.deepEqual([nn.noti.lead, nn.noti.risposto, nn.noti.pctRisposto], [2, 1, 50])
    assert.equal(nn.senza.lead, 1)
    // numeri: 3199 prima, poi 8061, senza chat in fondo
    assert.deepEqual(r.bot!.numeri.map(g => g.chiave), ['3199', '8061', 'nessuno'])
    assert.deepEqual([r.bot!.numeri[1].lead, r.bot!.numeri[1].consegnato, r.bot!.numeri[1].pctConsegnato], [3, 2, 66.7])
    // Mario: % sui lead e, a parte, su chi ha risposto
    const mario = Object.fromEntries(r.bot!.mario.map(g => [g.chiave, g]))
    assert.deepEqual([mario.sonnet.lead, mario.sonnet.risposto, mario.sonnet.appuntamenti, mario.sonnet.pctAppuntamenti, mario.sonnet.pctAppuntamentiSuRisposto], [2, 2, 1, 50, 50])
    assert.equal(mario.nessuno.lead, 2)
    assert.equal(r.bot!.numeri[0].pctAppuntamentiSuRisposto, null)
})

test('da tenere d\'occhio: resa bassa per numero WhatsApp (consegna o risposte)', () => {
    const leads: LeadBf[] = []
    const chats: BotLeadBf[] = []
    for (let i = 0; i < 10; i++) {
        leads.push(lead({ id: `s${i}`, createdAt: new Date('2026-11-09T12:00:00Z') }))
        chats.push(chat(`s${i}`, { waNumber: 'whatsapp:+393520413199', risposto: i < 7 }))
    }
    for (let i = 0; i < 6; i++) {
        leads.push(lead({ id: `m${i}`, createdAt: new Date('2026-11-09T12:00:00Z') }))
        chats.push(chat(`m${i}`, { waNumber: 'whatsapp:+393522070047', risposto: i < 1 }))
    }
    // un numero con pochi lead non si segnala
    leads.push(lead({ id: 'x', createdAt: new Date('2026-11-09T12:00:00Z') }))
    chats.push(chat('x', { waNumber: 'whatsapp:+393522018718', consegnato: false }))
    const r = calcolaMonitorBf(base({ leads, bot: { lettoAlle: ADESSO.toISOString(), leads: chats, funnel: [] } }))
    const a = r.attenzioni.find(x => x.chiave === 'resa_bassa_numero')!
    assert.equal(a.numero, 1)
    assert.match(a.testo, /…0047: apertura consegnata al 100% e risposte dal 16.7% dei suoi 6 lead/)
    assert.doesNotMatch(a.testo, /3199|8718/)
})

// ── Percentuali come nel Sales Manager ──

test('stadiSm e cascataSm: stessi stadi e denominatori della tabella Numeri mensili', () => {
    const righe = [
        // fissato, confermato, presente, chiuso
        { appointmentDate: new Date('2026-11-09T10:00:00Z'), appointmentCreatedAt: new Date('2026-11-07T12:00:00Z'), confirmationsOutcome: 'confermato', confirmationsTimestamp: new Date('2026-11-08T12:00:00Z'), presentedAt: new Date('2026-11-09T10:00:00Z'), salespersonOutcome: 'Chiuso', salespersonOutcomeAt: new Date('2026-11-09T11:00:00Z'), closeAmountEur: 2890 },
        // fissato, presente senza Conferme, non chiuso
        { appointmentDate: new Date('2026-11-09T10:00:00Z'), appointmentCreatedAt: new Date('2026-11-07T12:00:00Z'), confirmationsOutcome: null, confirmationsTimestamp: null, presentedAt: new Date('2026-11-09T10:00:00Z'), salespersonOutcome: 'Non chiuso', salespersonOutcomeAt: new Date('2026-11-09T11:00:00Z'), closeAmountEur: null },
        // fissato prima del periodo: non conta come appuntamento del periodo
        { appointmentDate: new Date('2026-11-12T10:00:00Z'), appointmentCreatedAt: new Date('2026-11-05T12:00:00Z'), confirmationsOutcome: null, confirmationsTimestamp: null, presentedAt: null, salespersonOutcome: null, salespersonOutcomeAt: null, closeAmountEur: null },
    ]
    const s = stadiSm(righe, INIZIO)
    assert.deepEqual(s, { app: 2, conferme: 1, presenze: 2, presenzeConfermate: 1, chiusi: 1, euro: 2890 })
    const c = cascataSm(10, s)
    assert.equal(c.pctFissaggio, 20)   // app / lead
    assert.equal(c.pctConferme, 50)    // confermati / app
    assert.equal(c.pctPresenze, 100)   // presenze confermate / confermati
    assert.equal(c.pctChiusure, 50)    // chiusi / tutte le presenze
    assert.equal(cascataSm(0, { app: 0, conferme: 0, presenze: 0, presenzeConfermate: 0, chiusi: 0, euro: 0 }).pctFissaggio, null)
})

test('salesManager: BF totale e per giorno di ingresso, altri funnel accanto', () => {
    const r = calcolaMonitorBf(base({
        leads: [
            lead({ id: 'a', status: 'APPOINTMENT', appointmentDate: new Date('2026-11-09T10:00:00Z'), appointmentCreatedAt: new Date('2026-11-07T12:00:00Z'), confirmationsOutcome: 'confermato', confirmationsTimestamp: new Date('2026-11-08T12:00:00Z') }),
            lead({ id: 'b' }),
            lead({ id: 'c', createdAt: new Date('2026-11-08T10:00:00Z') }),
            lead({ id: 'd', createdAt: new Date('2026-11-08T10:00:00Z') }),
        ],
        altriSm: { lead: 200, stadi: { app: 20, conferme: 10, presenze: 6, presenzeConfermate: 5, chiusi: 2, euro: 5000 } },
    }))
    assert.equal(r.salesManager.bf.lead, 4)
    assert.equal(r.salesManager.bf.pctFissaggio, 25)
    assert.equal(r.salesManager.bf.pctConferme, 100)
    assert.deepEqual(r.salesManager.giorni.map(g => [g.giorno, g.dati.lead, g.dati.pctFissaggio]), [['2026-11-07', 2, 50], ['2026-11-08', 2, 0], ['2026-11-09', 0, null]])
    assert.equal(r.salesManager.altri!.pctFissaggio, 10)
    assert.equal(r.salesManager.altri!.pctPresenze, 50)
    assert.equal(r.salesManager.altri!.pctChiusure, 33.3)
})

test('eConversioneBf: BF_CONVERTITO e AC_UPDATED col cambio di funnel a BLACK FRIDAY', () => {
    assert.equal(CAMBIO_FUNNEL_BF, 'funnel → BLACK FRIDAY')
    assert.equal(eConversioneBf({ eventType: 'BF_CONVERTITO' }), true)
    assert.equal(eConversioneBf({ eventType: 'AC_UPDATED', changes: ['funnel → BLACK FRIDAY'] }), true)
    assert.equal(eConversioneBf({ eventType: 'AC_UPDATED', changes: ['utmSource', 'funnel → BLACK FRIDAY'] }), true)
    assert.equal(eConversioneBf({ eventType: 'AC_UPDATED', changes: ['funnel → CORSO 10 ORE'] }), false)
    assert.equal(eConversioneBf({ eventType: 'AC_UPDATED' }), false)
    assert.equal(eConversioneBf({ eventType: 'BF_RIPUSH' }), false)
})

test('ingressoBf: nato dal 7/11, convertito dopo, fuori perimetro', () => {
    const nato = new Date('2026-11-08T10:00:00Z')
    // Nato BF dal 7/11: entra alla creazione.
    assert.deepEqual(ingressoBf(nato, null, INIZIO), nato)
    // Lead di settembre convertito il 9/11 (Ferrero): entra alla conversione.
    const conv = new Date('2026-11-09T17:23:51Z')
    assert.deepEqual(ingressoBf(new Date('2026-09-21T09:08:49Z'), conv, INIZIO), conv)
    // Nato dopo il 7/11 con un altro funnel e convertito: vale la conversione.
    assert.deepEqual(ingressoBf(nato, conv, INIZIO), conv)
    // BF vecchio (provenienza Black Friday di maggio) senza conversione dal 7/11: fuori.
    assert.equal(ingressoBf(new Date('2026-05-08T09:53:33Z'), null, INIZIO), null)
    // Conversione prima del 7/11: non vale, fuori.
    assert.equal(ingressoBf(new Date('2026-10-01T09:00:00Z'), new Date('2026-11-01T09:00:00Z'), INIZIO), null)
})

test('convertito: giorno, età e fermi dalla conversione; chiamate e ridati di prima del 7/11 non contano', () => {
    const conv = new Date('2026-11-09T12:00:00Z') // 13:00 Roma del 9/11
    const r = calcolaMonitorBf(base({
        leads: [
            lead({ id: 'nato', createdAt: new Date('2026-11-07T08:00:00Z') }),
            lead({ id: 'ferrero', createdAt: conv }),
        ],
        eventi: [
            { leadId: 'ferrero', eventType: 'REASSIGNED_FROM_BOT', reason: 'mai_risposto', manuale: false, at: new Date('2026-09-23T10:00:00Z') },
        ],
        chiamate: [
            { leadId: 'ferrero', userId: BOT, outcome: 'DA_SCARTARE', at: new Date('2026-09-22T10:00:00Z') },
            { leadId: 'ferrero', userId: ZORA, outcome: 'NON_RISPONDE', at: new Date('2026-09-24T10:00:00Z') },
        ],
    }))
    assert.equal(r.imbuto.totale.entrati, 2)
    const g = Object.fromEntries(r.imbuto.giorni.map(x => [x.giorno, x.dati.entrati]))
    assert.equal(g['2026-11-07'], 1)
    assert.equal(g['2026-11-09'], 1)
    // Ferrero è col bot, senza esiti né ridati vecchi.
    const esiti = Object.fromEntries(r.esiti.voci.map(v => [v.chiave, v.lead]))
    assert.equal(esiti.col_bot, 2)
    assert.equal(esiti.scartato_bot, undefined)
    assert.equal(r.ridati.totale, 0)
    // Età media dall'ingresso: (54 + 2) / 2 = 28 ore.
    assert.equal(r.confronto.bfTutti.etaMediaOre, 28)
    // Fermo sul bot solo il lead nato il 7/11, non il convertito di oggi.
    assert.equal(r.attenzioni.find(a => a.chiave === 'fermi_sul_bot')?.numero, 1)
    assert.equal(r.controlli.ok, true)
})
