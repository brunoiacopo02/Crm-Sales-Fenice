// Monitor del Black Friday (PO 09/11/2026): i conti della pagina
// /admin/diretta/black-friday, puri e testati. Le letture stanno in
// monitorDb.ts. Tutto è JSON (stringhe ISO e numeri): il risultato passa per
// la cache di Next.
//
// Regola del PO sulle percentuali: risposta e fissaggio si calcolano SEMPRE
// sul totale dei lead, come per i GDO, mai su "raggiunti" o "su chi risponde".
//
// Solo dati del CRM: chat, messaggi consegnati, risposte, numero WhatsApp e
// versione di Mario stanno nel database del bot, che il CRM non legge.

import { toRomeDateStr } from '@/lib/dateUtils'

export interface LeadBf {
    id: string
    createdAt: Date
    utmSource: string | null
    status: string
    assignedToId: string | null
    appointmentDate: Date | null
    confirmationsOutcome: string | null
    confirmationsDiscardReason: string | null
    presentedAt: Date | null
    salespersonOutcome: string | null
    closeAmountEur: number | null
    closeProduct: string | null
}

/** REASSIGNED_FROM_BOT del lead. `manuale` = passaggio fatto a mano (metadata.motivo), fuori dai ridati. */
export interface EventoBf { leadId: string; eventType: string; reason: string | null; manuale: boolean; at: Date }
export interface ChiamataBf { leadId: string; userId: string | null; outcome: string; at: Date }
export interface GdoBf { id: string; codice: number | null; nome: string; attivo: boolean; bot: boolean }
/** Lead aperti (NEW / IN_PROGRESS) del GDO, su tutti i funnel. */
export interface CaricoGdo { userId: string; aperti: number; maiChiamati: number; richiamiOggi: number; richiamiScaduti: number }
/** callLogs di oggi (giorno di Roma) del GDO. */
export interface AttivitaGdo { userId: string; chiamate: number; appuntamenti: number }
/** Lead entrati dal 7/11 e passati dal bot (BOT_PUSHED), per funnel. */
export interface FunnelBot { funnel: string; lead: number; appuntamenti: number; etaMediaOre: number }

export interface InputMonitorBf {
    adesso: Date
    inizio: Date
    leads: LeadBf[]
    eventi: EventoBf[]
    chiamate: ChiamataBf[]
    gdo: GdoBf[]
    carichi: CaricoGdo[]
    attivita: AttivitaGdo[]
    funnelBot: FunnelBot[]
}

export const BF_FUNNEL = 'BLACK FRIDAY'
/** Ore oltre le quali un ridato dal bot non ancora chiamato va segnalato. */
export const ORE_RIDATO_NON_CHIAMATO = 2
/** Ore dall'ingresso oltre le quali un lead ancora col bot, senza appuntamento, è fermo. */
export const ORE_FERMO_SUL_BOT = 48
/** Ore dopo l'orario della call oltre le quali un appuntamento senza esito va segnalato. */
export const ORE_APPUNTAMENTO_SENZA_ESITO = 3

const APERTI = new Set(['NEW', 'IN_PROGRESS'])
const ORA_MS = 3_600_000

export function pct(n: number, d: number): number | null {
    return d ? Math.round((1000 * n) / d) / 10 : null
}

/** Giorni di Roma (YYYY-MM-DD) da `inizio` a `adesso` compresi. */
export function giorniDal(inizio: Date, adesso: Date): string[] {
    const fine = toRomeDateStr(adesso)
    const out: string[] = []
    const d = new Date(`${toRomeDateStr(inizio)}T12:00:00Z`)
    for (let i = 0; i < 400; i++) {
        const g = d.toISOString().slice(0, 10)
        if (g > fine) break
        out.push(g)
        d.setUTCDate(d.getUTCDate() + 1)
    }
    return out
}

export type Canale = 'meta' | 'instagram' | 'email' | 'telegram' | 'altro'
export const NOMI_CANALE: Record<Canale, string> = {
    meta: 'Inserzioni Meta', instagram: 'Instagram', email: 'Email al database', telegram: 'Telegram', altro: 'Altro',
}

/** Canale dal utmSource dei lead BF (Meta, bioorg, Email, Telegram, ...). */
export function canaleDi(utmSource: string | null): Canale {
    const s = (utmSource ?? '').trim().toLowerCase()
    if (s === 'meta') return 'meta'
    if (s === 'bioorg' || s.includes('instagram')) return 'instagram'
    if (s.startsWith('email')) return 'email'
    if (s === 'telegram') return 'telegram'
    return 'altro'
}

export interface Imbuto {
    entrati: number
    appuntamenti: number
    pctAppuntamenti: number | null
    confermati: number
    scartati: number
    motiviScarto: Record<string, number>
    inAttesa: number
    presenti: number
    chiusi: number
    euroChiusi: number
    nonChiusi: number
    futuri: number
}

export type ChiaveEsito =
    | 'appuntamento_bot' | 'appuntamento_gdo' | 'scartato_bot' | 'ridato_mai_risposto'
    | 'ridato_chat_interrotta' | 'tolto_a_mano' | 'col_bot' | 'altro'

export const NOMI_ESITO: Record<ChiaveEsito, string> = {
    appuntamento_bot: 'Appuntamento fissato dal bot',
    appuntamento_gdo: 'Appuntamento fissato da un GDO',
    scartato_bot: 'Scartato dal bot',
    ridato_mai_risposto: 'Ridato ai GDO: mai risposto',
    ridato_chat_interrotta: 'Ridato ai GDO: chat interrotta',
    tolto_a_mano: 'Tolto al bot a mano',
    col_bot: 'Ancora col bot',
    altro: 'Mai arrivato al bot o senza assegnatario',
}
const ORDINE_ESITI: ChiaveEsito[] = [
    'appuntamento_bot', 'appuntamento_gdo', 'scartato_bot', 'ridato_mai_risposto',
    'ridato_chat_interrotta', 'tolto_a_mano', 'col_bot', 'altro',
]

export interface RigaGdo {
    codice: number | null
    nome: string
    attivo: boolean
    aperti: number
    maiChiamati: number
    richiamiOggi: number
    richiamiScaduti: number
    chiamateOggi: number
    appuntamentiOggi: number
    bfInMano: number
    bfDaChiamare: number
}

export interface Attenzione { chiave: string; numero: number; titolo: string; testo: string }

export interface RigaConfronto { funnel: string; lead: number; appuntamenti: number; pctAppuntamenti: number | null; etaMediaOre: number | null }

export interface MonitorBf {
    calcolatoAlle: string
    inizio: string
    imbuto: { totale: Imbuto; giorni: { giorno: string; dati: Imbuto }[] }
    esiti: { totale: number; voci: { chiave: ChiaveEsito; nome: string; lead: number; pct: number | null }[] }
    ridati: {
        totale: number
        perMotivo: Record<string, number>
        tornatiConAppuntamentoDalBot: number
        chiamatiDaGdo: number
        fissatiDaiGdo: number
        daChiamare: number
    }
    canali: { chiave: Canale; nome: string; lead: number; appuntamenti: number; pctAppuntamenti: number | null; presenti: number; chiusi: number }[]
    confronto: { bf: RigaConfronto | null; altri: RigaConfronto; dettaglio: RigaConfronto[] }
    gdo: {
        righe: RigaGdo[]
        bot: { bfInMano: number; conAppuntamento: number; aperti: number; scartati: number }
        bfSenzaAssegnatario: number
    }
    attenzioni: Attenzione[]
    controlli: { ok: boolean; errori: string[] }
}

const haAppuntamento = (l: LeadBf) => l.appointmentDate !== null || l.status === 'APPOINTMENT'

function imbuto(a: LeadBf[], adesso: Date): Imbuto {
    const app = a.filter(haAppuntamento)
    const confermati = app.filter(l => l.confirmationsOutcome === 'confermato').length
    const scart = app.filter(l => l.confirmationsOutcome === 'scartato')
    const motiviScarto: Record<string, number> = {}
    for (const l of scart) {
        const m = l.confirmationsDiscardReason?.trim() || 'senza motivo'
        motiviScarto[m] = (motiviScarto[m] ?? 0) + 1
    }
    const chiusi = app.filter(l => l.salespersonOutcome === 'Chiuso')
    return {
        entrati: a.length,
        appuntamenti: app.length,
        pctAppuntamenti: pct(app.length, a.length),
        confermati,
        scartati: scart.length,
        motiviScarto,
        inAttesa: app.length - confermati - scart.length,
        presenti: app.filter(l => l.presentedAt !== null).length,
        chiusi: chiusi.length,
        euroChiusi: chiusi.reduce((s, l) => s + (l.closeAmountEur ?? 0), 0),
        nonChiusi: app.filter(l => l.salespersonOutcome === 'Non chiuso').length,
        futuri: app.filter(l => l.appointmentDate !== null && l.appointmentDate > adesso).length,
    }
}

function rigaConfronto(funnel: string, righe: FunnelBot[]): RigaConfronto {
    const lead = righe.reduce((s, r) => s + r.lead, 0)
    const appuntamenti = righe.reduce((s, r) => s + r.appuntamenti, 0)
    const eta = lead ? Math.round((10 * righe.reduce((s, r) => s + r.etaMediaOre * r.lead, 0)) / lead) / 10 : null
    return { funnel, lead, appuntamenti, pctAppuntamenti: pct(appuntamenti, lead), etaMediaOre: eta }
}

/** "Zora 5, Alessandro 3": conteggi per nome, dal più alto. */
function elencoNomi(conteggi: Map<string, number>): string {
    return [...conteggi.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => `${n} ${c}`).join(', ')
}

const piu = (n: number, una: string, tante: string) => (n === 1 ? `1 ${una}` : `${n} ${tante}`)

export function calcolaMonitorBf(input: InputMonitorBf): MonitorBf {
    const { adesso, inizio, leads } = input
    const botIds = new Set(input.gdo.filter(g => g.bot).map(g => g.id))
    const gdoPerId = new Map(input.gdo.map(g => [g.id, g]))
    const umano = (userId: string | null) => userId !== null && !botIds.has(userId)

    // Chiamate per lead, e del bot per esito.
    const chiamatePerLead = new Map<string, ChiamataBf[]>()
    for (const c of input.chiamate) {
        const arr = chiamatePerLead.get(c.leadId) ?? []
        arr.push(c)
        chiamatePerLead.set(c.leadId, arr)
    }
    const chiamateUmane = (leadId: string, dopo?: Date) =>
        (chiamatePerLead.get(leadId) ?? []).filter(c => umano(c.userId) && (!dopo || c.at >= dopo))
    const esitoDelBot = (leadId: string, outcome: string) =>
        (chiamatePerLead.get(leadId) ?? []).some(c => c.userId !== null && botIds.has(c.userId) && c.outcome === outcome)

    // Primo ridato (non manuale) e passaggi a mano, per lead.
    const ridato = new Map<string, EventoBf>()
    const aMano = new Set<string>()
    for (const e of [...input.eventi].sort((a, b) => a.at.getTime() - b.at.getTime())) {
        if (e.eventType !== 'REASSIGNED_FROM_BOT') continue
        if (e.manuale) { aMano.add(e.leadId); continue }
        if (!ridato.has(e.leadId)) ridato.set(e.leadId, e)
    }

    // ── Imbuto ──
    const giorni = giorniDal(inizio, adesso)
    const perGiorno = new Map<string, LeadBf[]>(giorni.map(g => [g, []]))
    for (const l of leads) {
        const g = toRomeDateStr(l.createdAt)
        if (!perGiorno.has(g)) perGiorno.set(g, [])
        perGiorno.get(g)!.push(l)
    }
    const totale = imbuto(leads, adesso)
    const giorniImbuto = [...perGiorno.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([giorno, a]) => ({ giorno, dati: imbuto(a, adesso) }))

    // ── Esiti ──
    const esitoDi = (l: LeadBf): ChiaveEsito => {
        if (haAppuntamento(l)) return esitoDelBot(l.id, 'APPUNTAMENTO') ? 'appuntamento_bot' : 'appuntamento_gdo'
        if (esitoDelBot(l.id, 'DA_SCARTARE')) return 'scartato_bot'
        const r = ridato.get(l.id)
        if (r) return r.reason === 'chat_interrotta' ? 'ridato_chat_interrotta' : 'ridato_mai_risposto'
        if (aMano.has(l.id)) return 'tolto_a_mano'
        if (l.assignedToId && botIds.has(l.assignedToId)) return 'col_bot'
        return 'altro'
    }
    const conteggiEsiti = new Map<ChiaveEsito, number>()
    for (const l of leads) conteggiEsiti.set(esitoDi(l), (conteggiEsiti.get(esitoDi(l)) ?? 0) + 1)
    const voci = ORDINE_ESITI.filter(k => conteggiEsiti.has(k)).map(k => ({
        chiave: k, nome: NOMI_ESITO[k], lead: conteggiEsiti.get(k)!, pct: pct(conteggiEsiti.get(k)!, leads.length),
    }))

    // ── Ridati ──
    const leadRidati = leads.filter(l => ridato.has(l.id))
    const perMotivo: Record<string, number> = {}
    for (const l of leadRidati) {
        const m = ridato.get(l.id)!.reason ?? 'sconosciuto'
        perMotivo[m] = (perMotivo[m] ?? 0) + 1
    }
    const chiamatoDopoRidato = (l: LeadBf) => chiamateUmane(l.id, ridato.get(l.id)!.at).length > 0
    const ridatiDaChiamare = leadRidati.filter(l => !haAppuntamento(l) && APERTI.has(l.status) && !chiamatoDopoRidato(l))

    // ── Canali ──
    const perCanale = new Map<Canale, LeadBf[]>()
    for (const l of leads) {
        const c = canaleDi(l.utmSource)
        perCanale.set(c, [...(perCanale.get(c) ?? []), l])
    }
    const canali = (Object.keys(NOMI_CANALE) as Canale[]).filter(c => perCanale.has(c)).map(c => {
        const a = perCanale.get(c)!
        const app = a.filter(haAppuntamento)
        return {
            chiave: c, nome: NOMI_CANALE[c], lead: a.length, appuntamenti: app.length, pctAppuntamenti: pct(app.length, a.length),
            presenti: app.filter(l => l.presentedAt !== null).length, chiusi: app.filter(l => l.salespersonOutcome === 'Chiuso').length,
        }
    })

    // ── Confronto coi funnel del bot ──
    const bfRiga = input.funnelBot.find(f => f.funnel === BF_FUNNEL)
    const altriFunnel = input.funnelBot.filter(f => f.funnel !== BF_FUNNEL)
    const confronto = {
        bf: bfRiga ? rigaConfronto('Black Friday', [bfRiga]) : null,
        altri: rigaConfronto('Tutti gli altri funnel', altriFunnel),
        dettaglio: ['CORSO 10 ORE', 'JOB SIMULATOR', 'TELEGRAM']
            .map(f => input.funnelBot.find(x => x.funnel === f))
            .filter((x): x is FunnelBot => !!x)
            .map(x => rigaConfronto(x.funnel, [x])),
    }

    // ── Tabella GDO ──
    const bfPerUtente = new Map<string, LeadBf[]>()
    for (const l of leads) {
        if (!l.assignedToId) continue
        bfPerUtente.set(l.assignedToId, [...(bfPerUtente.get(l.assignedToId) ?? []), l])
    }
    const carico = new Map(input.carichi.map(c => [c.userId, c]))
    const attivita = new Map(input.attivita.map(a => [a.userId, a]))
    const gdoInTabella = input.gdo
        .filter(g => !g.bot && (g.attivo || (bfPerUtente.get(g.id)?.length ?? 0) > 0))
        .sort((a, b) => (a.codice ?? 9999) - (b.codice ?? 9999))
    const idInTabella = new Set(gdoInTabella.map(g => g.id))
    const righeGdo: RigaGdo[] = gdoInTabella
        .map(g => {
            const bf = bfPerUtente.get(g.id) ?? []
            const c = carico.get(g.id)
            const at = attivita.get(g.id)
            return {
                codice: g.codice, nome: g.nome, attivo: g.attivo,
                aperti: c?.aperti ?? 0, maiChiamati: c?.maiChiamati ?? 0,
                richiamiOggi: c?.richiamiOggi ?? 0, richiamiScaduti: c?.richiamiScaduti ?? 0,
                chiamateOggi: at?.chiamate ?? 0, appuntamentiOggi: at?.appuntamenti ?? 0,
                bfInMano: bf.length,
                bfDaChiamare: bf.filter(l => APERTI.has(l.status) && !haAppuntamento(l) && chiamateUmane(l.id).length === 0).length,
            }
        })
    const bfBot = leads.filter(l => l.assignedToId && botIds.has(l.assignedToId))
    const bot = {
        bfInMano: bfBot.length,
        conAppuntamento: bfBot.filter(haAppuntamento).length,
        aperti: bfBot.filter(l => APERTI.has(l.status) && !haAppuntamento(l)).length,
        scartati: bfBot.filter(l => l.status === 'REJECTED').length,
    }
    const bfSenzaAssegnatario = leads.filter(l => !l.assignedToId).length
    // Lead BF assegnati a utenti che non sono GDO (es. un admin): contano nelle somme.
    const bfAltriUtenti = leads.filter(l => l.assignedToId && !botIds.has(l.assignedToId) && !idInTabella.has(l.assignedToId)).length

    // ── Da tenere d'occhio ──
    const attenzioni: Attenzione[] = []
    const ridatiVecchi = ridatiDaChiamare.filter(l => adesso.getTime() - ridato.get(l.id)!.at.getTime() > ORE_RIDATO_NON_CHIAMATO * ORA_MS)
    if (ridatiVecchi.length > 0) {
        const perNome = new Map<string, number>()
        for (const l of ridatiVecchi) {
            const nome = (l.assignedToId && gdoPerId.get(l.assignedToId)?.nome) || 'senza assegnatario'
            perNome.set(nome, (perNome.get(nome) ?? 0) + 1)
        }
        attenzioni.push({
            chiave: 'ridati_non_chiamati', numero: ridatiVecchi.length,
            titolo: `${piu(ridatiVecchi.length, 'lead BF ridato', 'lead BF ridati')} dal bot e non ancora chiamati da più di ${ORE_RIDATO_NON_CHIAMATO} ore.`,
            testo: `Da chiamare: ${elencoNomi(perNome)}.`,
        })
    }
    const orfani = leads.filter(l => !l.assignedToId && APERTI.has(l.status) && !haAppuntamento(l))
    if (orfani.length > 0) {
        attenzioni.push({
            chiave: 'senza_assegnatario', numero: orfani.length,
            titolo: `${piu(orfani.length, 'lead BF aperto', 'lead BF aperti')} senza assegnatario.`,
            testo: 'Nessuno li lavora: né il bot né un GDO.',
        })
    }
    const fermi = bfBot.filter(l => APERTI.has(l.status) && !haAppuntamento(l) && adesso.getTime() - l.createdAt.getTime() > ORE_FERMO_SUL_BOT * ORA_MS)
    if (fermi.length > 0) {
        attenzioni.push({
            chiave: 'fermi_sul_bot', numero: fermi.length,
            titolo: `${piu(fermi.length, 'lead BF fermo', 'lead BF fermi')} sul bot da più di ${ORE_FERMO_SUL_BOT} ore.`,
            testo: 'Entrati da oltre due giorni, ancora col bot e senza appuntamento: il bot di solito li ridà dopo circa 24 ore di silenzio.',
        })
    }
    const senzaEsito = leads.filter(l => l.appointmentDate !== null
        && adesso.getTime() - l.appointmentDate.getTime() > ORE_APPUNTAMENTO_SENZA_ESITO * ORA_MS
        && l.presentedAt === null && l.salespersonOutcome === null && l.confirmationsOutcome !== 'scartato')
    if (senzaEsito.length > 0) {
        attenzioni.push({
            chiave: 'appuntamenti_senza_esito', numero: senzaEsito.length,
            titolo: `${piu(senzaEsito.length, 'appuntamento BF passato', 'appuntamenti BF passati')} senza esito.`,
            testo: `La call era più di ${ORE_APPUNTAMENTO_SENZA_ESITO} ore fa e non risultano né presenza né esito del venditore.`,
        })
    }

    // ── Controlli: le somme devono tornare ──
    const errori: string[] = []
    const chiaviSomma: (keyof Imbuto)[] = ['entrati', 'appuntamenti', 'confermati', 'scartati', 'presenti', 'chiusi', 'nonChiusi', 'futuri']
    for (const k of chiaviSomma) {
        const s = giorniImbuto.reduce((acc, g) => acc + (g.dati[k] as number), 0)
        if (s !== totale[k]) errori.push(`giorni ${k}: ${s} contro ${totale[k] as number}`)
    }
    const sommaEsiti = voci.reduce((s, v) => s + v.lead, 0)
    if (sommaEsiti !== leads.length) errori.push(`esiti: ${sommaEsiti} contro ${leads.length}`)
    const inMano = righeGdo.reduce((s, r) => s + r.bfInMano, 0) + bot.bfInMano + bfSenzaAssegnatario + bfAltriUtenti
    if (inMano !== leads.length) errori.push(`BF in mano: ${inMano} contro ${leads.length}`)

    return {
        calcolatoAlle: adesso.toISOString(),
        inizio: inizio.toISOString(),
        imbuto: { totale, giorni: giorniImbuto },
        esiti: { totale: leads.length, voci },
        ridati: {
            totale: leadRidati.length,
            perMotivo,
            tornatiConAppuntamentoDalBot: leadRidati.filter(l => haAppuntamento(l) && esitoDelBot(l.id, 'APPUNTAMENTO')).length,
            chiamatiDaGdo: leadRidati.filter(chiamatoDopoRidato).length,
            fissatiDaiGdo: leadRidati.filter(l => haAppuntamento(l) && !esitoDelBot(l.id, 'APPUNTAMENTO')).length,
            daChiamare: ridatiDaChiamare.length,
        },
        canali,
        confronto,
        gdo: { righe: righeGdo, bot, bfSenzaAssegnatario },
        attenzioni,
        controlli: { ok: errori.length === 0, errori },
    }
}
