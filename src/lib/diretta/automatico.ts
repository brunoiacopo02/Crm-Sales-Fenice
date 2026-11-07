// Distribuzione automatica dei lead ai GDO (PO 07/11/2026). Funzioni pure:
// le usano automaticoDb.ts (giro serale e scorta generale), il cron
// /api/cron/diretta-serale e lo script di prova; si testano senza DB
// (automatico.test.ts).
//
// Obiettivo di Bruno: "salvo offerte o cambiamenti organizzativi non devo più
// assegnare io i lead". Quattro pezzi.
//
// ── 1. GIRO SERALE (cron, fuori turno) ───────────────────────────────────────
// Gira dopo le 20:30 di Roma (turno GDO lun-sab fino alle 20:00), una volta a
// sera, dietro l'env DIRETTA_SERALE_ENABLED (spenta = non scrive niente; la
// prova a vuoto ?dryRun=1 funziona sempre). In ordine:
//   a) accantonamento dei ridati vecchi (regola 2),
//   b) riequilibrio fra GDO (regola 1), sui numeri DOPO l'accantonamento.
// Mai toccato da nessuna delle due (intoccabile):
//   - lead con appuntamento, presenza, in mano a Conferme o a un venditore;
//   - lead del lancio (eLeadDelLancio);
//   - lead toccati negli ultimi 30 minuti (updatedAt o ultima chiamata): il
//     19:49 del 06/11 un accantonamento ha tolto a Zora un lead che stava
//     lavorando. Il bot (201) e l'account di prova non sono mai GDO del giro.
//
// Carico di un GDO = lead in PRIMA CHIAMATA contando anche la scorta: aperti
// (NEW/IN_PROGRESS), callCount 0, senza richiamo, senza appuntamento.
//
// ── 2. ACCANTONAMENTO SERALE ─────────────────────────────────────────────────
// Solo per i GDO con carico OLTRE 60 (SOGLIA_ACCANTONAMENTO). Con 60 o meno, a
// quel GDO non si accantona nulla. Si accantona solo l'eccedenza: il GDO non
// scende mai sotto 60. Candidati (come lo script del 06/11):
//   - ridati dal bot (REASSIGNED_FROM_BOT), mai chiamati, entrati nel CRM da
//     più di 8 giorni (createdAt), nessun "Ti ha cercato" aperto;
//   - NON le stelle (chat interrotta: sono i migliori, restano visibili);
//   - NON i "WhatsApp mai consegnato" né i "senza chat col bot": il bot non ci
//     ha mai parlato, il telefono del GDO è l'unico canale (lo script del 06/11
//     lo verificava sul DB del bot; qui si legge dall'evento di restituzione).
// Escono prima quelli in scorta (nascosti), poi i visibili; dentro, i più
// vecchi. Vanno nel pool "Lead accantonati" (RIDATO_PARCHEGGIATO, motivo
// MOTIVO_ACCANTONAMENTO), da cui li riprende la scorta generale.
//
// ── 3. RIEQUILIBRIO SERALE ───────────────────────────────────────────────────
// Chi riceve (RICEVENTE): GDO della squadra "in giro" (acAutoIntake o
// botReturnIntake accesi in /gestione) e non assente.
// ASSENTE: nessuna chiamata registrata negli ultimi 3 giorni (callLogs) e
// account più vecchio di 3 giorni (un nuovo non è un assente). Esempio: Giusy.
//  - Un ASSENTE cede TUTTI i lead aperti non intoccabili: le prime chiamate
//    entrano nella fila del pareggio, i lavorati e i richiami (che scadrebbero)
//    vanno a turno: uno ad Antony, uno al ricevente con meno lead aperti.
//  - Un ricevente PRESENTE cede solo se ha "molti più lead degli altri":
//    carico > quota + margine, dove quota è la sua parte del totale dei
//    riceventi (Antony vale PESO_ANTONY = 1,5 parti, gli altri 1) e margine è
//    max(20, 25% della quota). Cede fino a tornare alla quota. Cede solo lead
//    nascosti in scorta o ancora da classificare: mai i visibili, mai vergini,
//    stelle o "Ti ha cercato". Escono per primi i migliori (ordinaScorta), così
//    chi li riceve li chiama subito.
//  - Chi riceve: il ricevente più scarico in proporzione alla sua quota
//    (carico / quota più basso; a pari, Antony). Antony con 1,5 parti ha
//    priorità: a parità di carico riceve prima, e si riempie fino a 1,5 volte
//    gli altri. Dall'eccesso di un presente si riempie solo fino alla quota;
//    i lead di un assente si danno comunque (non possono restare a lui).
//  - Nessun GDO PRESENTE "fuori giro" (intake spento ma lavora, es. un GDO a
//    cui Bruno ha chiuso i freschi) cede o riceve: è una scelta di Bruno.
// La fila si dà in ordine di qualità: vergini, stelle e "Ti ha cercato", poi
// l'ordine di uscita della scorta.
//
// ── 4. SCORTA GENERALE (in turno, al bisogno) ────────────────────────────────
// Un serbatoio comune oltre alla scorta personale. Quando un GDO in giro ha
// FINITO la scorta personale e in prima chiamata gli restano SOGLIA_SBLOCCO (5)
// lead da chiamare o meno, il sistema gli assegna SBLOCCO (30) lead dal
// serbatoio, i migliori e i più freschi, già visibili. Scatta dentro lo
// sblocco della scorta (sbloccaSeVuota: stesso lock per GDO, rilettura sotto
// lock), dietro l'env SCORTA_GENERALE_ENABLED. Togliere lead dal serbatoio a
// turno in corso è sicuro: non sono di nessuno.
// Da dove arriva il serbatoio: i lead accantonati recuperabili (di nessuno,
// aperti, mai chiamati, senza richiamo, non del lancio, numero non sospetto,
// nessun "Ti ha cercato" aperto), cioè i ridati dal bot parcheggiati e quelli
// dell'accantonamento serale. I freschi di ActiveCampaign non ci passano: il
// webhook li dà sempre a un GDO o al bot appena arrivano (leadRouting), e i
// pochi senza padrone sono numeri sospetti in quarantena. I lead "database
// punteggio alto" (coda marketing) restano a mano su /import: Bruno ha deciso
// che "niente parte da solo".
// Ordine del serbatoio (ordinaSerbatoio): stelle (chat interrotta), poi i mai
// contattati su WhatsApp, poi i ridati, poi i "WhatsApp mai consegnato";
// dentro ogni gruppo il più fresco (nato più di recente).

import {
    conStella, eVergine, gruppoUscita, ordinaScorta, sempreVisibile, SBLOCCO, SOGLIA_SBLOCCO,
    quantiDaChiamare, type LeadScorta,
} from './scorta'

/** Oltre questo carico (prima chiamata + scorta) si accantonano i ridati vecchi. */
export const SOGLIA_ACCANTONAMENTO = 60
/** Ridati entrati nel CRM da più di questi giorni sono "vecchi". */
export const GIORNI_RIDATO_VECCHIO = 8
/** Un lead toccato negli ultimi minuti non si sposta. */
export const MINUTI_INTOCCABILE = 30
/** Senza chiamate da questi giorni un GDO è assente. */
export const GIORNI_ASSENZA = 3
/** Il GDO con la priorità (Antony). */
export const CODICE_PRIORITARIO = 105
/** Quante parti del totale spettano ad Antony (gli altri 1). */
export const PESO_ANTONY = 1.5
/** Margine prima di considerare un GDO "con molti più lead". */
export const MARGINE_MIN = 20
export const MARGINE_PCT = 0.25
/** Motivo dell'accantonamento automatico (evento RIDATO_PARCHEGGIATO). */
export const MOTIVO_ACCANTONAMENTO = 'ridati_oltre_8gg_serale'
/** Motivo del riequilibrio (evento REASSIGNED_ADMIN). */
export const MOTIVO_RIEQUILIBRIO = 'riequilibrio_serale'

const GIORNO_MS = 24 * 3600 * 1000

export interface GdoGiro {
    id: string
    codice: number
    /** acAutoIntake o botReturnIntake accesi. */
    inGiro: boolean
    /** Ultima chiamata registrata (callLogs), null se mai. */
    ultimaChiamata: Date | null
    /** Nascita dell'account. */
    creatoIl: Date
}

export interface LeadGiro extends LeadScorta {
    assignedToId: string | null
    recallDate: Date | null
    appointmentDate: Date | null
    presentedAt: Date | null
    lastCallDate: Date | null
    /** In mano a Conferme o a un venditore (confirmationsUserId, esito conferme, confCall1At, reservedSalespersonId). */
    inConferme: boolean
    /** eLeadDelLancio. */
    lancio: boolean
    /** Ha almeno un REASSIGNED_FROM_BOT. */
    ridatoDalBot: boolean
    version: number
}

export function eAssente(g: GdoGiro, ora: Date): boolean {
    const soglia = ora.getTime() - GIORNI_ASSENZA * GIORNO_MS
    if (g.creatoIl.getTime() > soglia) return false
    return !g.ultimaChiamata || g.ultimaChiamata.getTime() < soglia
}

export function eRicevente(g: GdoGiro, ora: Date): boolean {
    return g.inGiro && !eAssente(g, ora)
}

const aperto = (l: Pick<LeadGiro, 'status'>) => l.status === 'NEW' || l.status === 'IN_PROGRESS'

/** In prima chiamata, scorta compresa: aperto, mai chiamato, senza richiamo né appuntamento. */
export function inPrimaChiamata(l: LeadGiro): boolean {
    return aperto(l) && l.callCount === 0 && !l.recallDate && !l.appointmentDate && !l.presentedAt
}

/** Il giro serale non lo tocca mai. */
export function intoccabile(l: LeadGiro, ora: Date): boolean {
    if (!aperto(l) || l.appointmentDate || l.presentedAt || l.inConferme || l.lancio) return true
    const limite = ora.getTime() - MINUTI_INTOCCABILE * 60_000
    if (l.updatedAt.getTime() > limite) return true
    if (l.lastCallDate && l.lastCallDate.getTime() > limite) return true
    return false
}

export function carico(lista: readonly LeadGiro[], gdoId: string): number {
    return lista.filter(l => l.assignedToId === gdoId && inPrimaChiamata(l)).length
}

/** Ridato dal bot vecchio, accantonabile (regola 2). */
export function accantonabile(l: LeadGiro, ora: Date): boolean {
    return inPrimaChiamata(l)
        && !intoccabile(l, ora)
        && l.ridatoDalBot
        && !l.cercato
        && !conStella(l)
        && l.ultimoInstradato !== 'mai_consegnato'
        && !(l.ultimoMotivo ?? '').includes('senza_chat_bot')
        && ora.getTime() - l.createdAt.getTime() > GIORNI_RIDATO_VECCHIO * GIORNO_MS
}

export interface Accantonamento { leadId: string; da: string }

/**
 * Regola 2: per ogni GDO con carico oltre 60, i ridati vecchi fino a tornare
 * a 60. Prima quelli nascosti in scorta, poi i visibili; dentro, i più vecchi.
 */
export function pianoAccantonamento(gdos: readonly GdoGiro[], lista: readonly LeadGiro[], ora: Date): Accantonamento[] {
    const out: Accantonamento[] = []
    for (const g of gdos) {
        const c = carico(lista, g.id)
        if (c <= SOGLIA_ACCANTONAMENTO) continue
        const candidati = lista
            .filter(l => l.assignedToId === g.id && accantonabile(l, ora))
            .sort((a, b) => {
                const s = Number(b.scortaStato !== 'visibile') - Number(a.scortaStato !== 'visibile')
                if (s !== 0) return s
                const t = a.createdAt.getTime() - b.createdAt.getTime()
                if (t !== 0) return t
                return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
            })
        for (const l of candidati.slice(0, c - SOGLIA_ACCANTONAMENTO)) out.push({ leadId: l.id, da: g.id })
    }
    return out
}

/** Qualità per la fila del riequilibrio: vergini, poi stelle e "Ti ha cercato", poi l'ordine della scorta. */
export function ordinaFila<T extends LeadGiro>(lista: readonly T[], ora: Date): T[] {
    const rango = (l: T) => (eVergine(l, ora) ? 2 : sempreVisibile(l, ora) ? 1 : 0)
    const perScorta = new Map(ordinaScorta(lista).map((l, i) => [l.id, i]))
    return [...lista].sort((a, b) => (rango(b) - rango(a)) || (perScorta.get(a.id)! - perScorta.get(b.id)!))
}

export type TipoSpostamento = 'prima' | 'lavorato'
export interface Spostamento { leadId: string; da: string; a: string; tipo: TipoSpostamento; motivo: 'assente' | 'eccesso' }

export interface PianoRiequilibrio {
    spostamenti: Spostamento[]
    quota: Record<string, number>
    caricoPrima: Record<string, number>
    caricoDopo: Record<string, number>
}

const peso = (g: GdoGiro) => (g.codice === CODICE_PRIORITARIO ? PESO_ANTONY : 1)

export function margine(quota: number): number {
    return Math.max(MARGINE_MIN, Math.round(quota * MARGINE_PCT))
}

/**
 * Regola 1. `lista` sono i lead aperti dei GDO del giro DOPO l'accantonamento.
 */
export function pianoRiequilibrio(gdos: readonly GdoGiro[], lista: readonly LeadGiro[], ora: Date): PianoRiequilibrio {
    const riceventi = gdos.filter(g => eRicevente(g, ora))
    const assenti = gdos.filter(g => eAssente(g, ora))
    const caricoPrima: Record<string, number> = {}
    for (const g of gdos) caricoPrima[g.id] = carico(lista, g.id)
    const spostamenti: Spostamento[] = []
    if (riceventi.length === 0) return { spostamenti, quota: {}, caricoPrima, caricoDopo: { ...caricoPrima } }

    const idAssenti = new Set(assenti.map(g => g.id))
    const daAssenti = lista.filter(l => l.assignedToId && idAssenti.has(l.assignedToId) && !intoccabile(l, ora))
    const primeAssenti = ordinaFila(daAssenti.filter(inPrimaChiamata), ora)
    const lavoratiAssenti = daAssenti.filter(l => !inPrimaChiamata(l))
        .sort((a, b) => (b.arrivedAt.getTime() - a.arrivedAt.getTime()) || (a.id < b.id ? -1 : 1))

    const totale = riceventi.reduce((s, g) => s + caricoPrima[g.id], 0) + primeAssenti.length
    const parti = riceventi.reduce((s, g) => s + peso(g), 0)
    const quota: Record<string, number> = {}
    for (const g of riceventi) quota[g.id] = Math.round((totale / parti) * peso(g))

    const ora_ = { ...caricoPrima }
    const scegli = (escluso: string | null, soloSottoQuota: boolean): GdoGiro | null => {
        // carico / quota più basso; a pari Antony, poi il codice più basso.
        const chiave = (g: GdoGiro): [number, number, number] =>
            [quota[g.id] > 0 ? ora_[g.id] / quota[g.id] : Infinity, g.codice === CODICE_PRIORITARIO ? 0 : 1, g.codice]
        const candidati = riceventi.filter(g => g.id !== escluso && (!soloSottoQuota || ora_[g.id] < quota[g.id]))
        if (candidati.length === 0) return null
        return candidati.reduce((best, g) => {
            const [r1, p1, c1] = chiave(g)
            const [r2, p2, c2] = chiave(best)
            return (r1 - r2 || p1 - p2 || c1 - c2) < 0 ? g : best
        })
    }

    // a) Prime chiamate degli assenti: si danno comunque.
    for (const l of primeAssenti) {
        const a = scegli(null, false)
        if (!a) break
        spostamenti.push({ leadId: l.id, da: l.assignedToId!, a: a.id, tipo: 'prima', motivo: 'assente' })
        ora_[a.id]++
        ora_[l.assignedToId!]--
    }

    // b) Eccesso dei riceventi presenti: solo nascosti o da classificare, i migliori prima.
    const cedenti = riceventi
        .filter(g => ora_[g.id] > quota[g.id] + margine(quota[g.id]))
        .sort((x, y) => (ora_[y.id] - quota[y.id]) - (ora_[x.id] - quota[x.id]))
    for (const g of cedenti) {
        const cedibili = ordinaScorta(lista.filter(l =>
            l.assignedToId === g.id && inPrimaChiamata(l) && !intoccabile(l, ora)
            && l.scortaStato !== 'visibile' && !sempreVisibile(l, ora)))
        for (const l of cedibili) {
            if (ora_[g.id] <= quota[g.id]) break
            const a = scegli(g.id, true)
            if (!a) break
            spostamenti.push({ leadId: l.id, da: g.id, a: a.id, tipo: 'prima', motivo: 'eccesso' })
            ora_[a.id]++
            ora_[g.id]--
        }
    }

    // c) Lavorati e richiami degli assenti: a turno Antony e il ricevente con meno lead aperti.
    const antony = riceventi.find(g => g.codice === CODICE_PRIORITARIO) ?? null
    const apertiDi: Record<string, number> = {}
    for (const g of riceventi) apertiDi[g.id] = lista.filter(l => l.assignedToId === g.id && aperto(l)).length
    for (const s of spostamenti) apertiDi[s.a] = (apertiDi[s.a] ?? 0) + 1
    lavoratiAssenti.forEach((l, i) => {
        let a: GdoGiro | null = null
        if (antony && i % 2 === 0) a = antony
        else {
            const altri = riceventi.filter(g => g !== antony)
            const pool = altri.length ? altri : riceventi
            a = [...pool].sort((x, y) => (apertiDi[x.id] - apertiDi[y.id]) || (x.codice - y.codice))[0]
        }
        spostamenti.push({ leadId: l.id, da: l.assignedToId!, a: a.id, tipo: 'lavorato', motivo: 'assente' })
        apertiDi[a.id]++
    })

    return { spostamenti, quota, caricoPrima, caricoDopo: ora_ }
}

export interface PianoSerale {
    accantonati: Accantonamento[]
    riequilibrio: PianoRiequilibrio
}

/** Il giro serale intero: prima l'accantonamento, poi il riequilibrio sui numeri che restano. */
export function pianoSerale(gdos: readonly GdoGiro[], lista: readonly LeadGiro[], ora: Date): PianoSerale {
    const accantonati = pianoAccantonamento(gdos, lista, ora)
    const via = new Set(accantonati.map(a => a.leadId))
    const resto = lista.filter(l => !via.has(l.id))
    return { accantonati, riequilibrio: pianoRiequilibrio(gdos, resto, ora) }
}

/** Il giro serale lavora solo fra le 20:30 e le 21:30 di Roma (fuori turno). */
export function eOraSerale(ora: Date): boolean {
    const parti = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(ora)
    const h = Number(parti.find(p => p.type === 'hour')?.value)
    const m = Number(parti.find(p => p.type === 'minute')?.value)
    const minuti = h * 60 + m
    return minuti >= 20 * 60 + 30 && minuti < 21 * 60 + 30
}

// ── Scorta generale ──────────────────────────────────────────────────────────

/**
 * Serve la scorta generale? Sì se in prima chiamata restano SOGLIA_SBLOCCO lead
 * visibili da chiamare o meno e la scorta personale è finita.
 */
export function serveScortaGenerale(lista: readonly LeadScorta[], ora: Date, soglia = SOGLIA_SBLOCCO): boolean {
    if (quantiDaChiamare(lista, ora) > soglia) return false
    return !lista.some(l => l.scortaStato === 'scorta' && !l.cercato)
}

export interface LeadSerbatoio {
    id: string
    createdAt: Date
    /** metadata.reason dell'ultimo REASSIGNED_FROM_BOT. */
    ultimoMotivo: string | null
    ultimoInstradato: string | null
    passatoDalBot: boolean
    /** metadata.motivo dell'ultimo RIDATO_PARCHEGGIATO. */
    motivoAccantonamento: string | null
}

/** Gruppo nel serbatoio, più alto = esce prima (come gruppoUscita della scorta). */
export function gruppoSerbatoio(l: LeadSerbatoio): number {
    if (l.ultimoMotivo === 'chat_interrotta' || l.motivoAccantonamento === 'stella_fuori_selezione') return 3
    return gruppoUscita({ ultimoMotivo: l.ultimoMotivo, ultimoInstradato: l.ultimoInstradato, launchBucket: null, passatoDalBot: l.passatoDalBot })
}

/** I migliori e i più freschi prima: gruppo, poi il nato più di recente, poi id. */
export function ordinaSerbatoio<T extends LeadSerbatoio>(lista: readonly T[]): T[] {
    return [...lista].sort((a, b) =>
        (gruppoSerbatoio(b) - gruppoSerbatoio(a))
        || (b.createdAt.getTime() - a.createdAt.getTime())
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** I `quanti` da dare dal serbatoio. */
export function daSerbatoio<T extends LeadSerbatoio>(lista: readonly T[], quanti = SBLOCCO): T[] {
    return ordinaSerbatoio(lista).slice(0, quanti)
}

/** Riepilogo per GDO del piano serale (prova a vuoto e risposta del cron). */
export function riepilogoPerGdo(gdos: readonly GdoGiro[], piano: PianoSerale, ora: Date) {
    return gdos.map(g => {
        const s = piano.riequilibrio.spostamenti
        return {
            codice: g.codice,
            ricevente: eRicevente(g, ora),
            assente: eAssente(g, ora),
            caricoPrima: piano.riequilibrio.caricoPrima[g.id] + piano.accantonati.filter(a => a.da === g.id).length,
            accantonati: piano.accantonati.filter(a => a.da === g.id).length,
            ceduti: s.filter(x => x.da === g.id).length,
            ricevuti: s.filter(x => x.a === g.id).length,
            primeRicevute: s.filter(x => x.a === g.id && x.tipo === 'prima').length,
            quota: piano.riequilibrio.quota[g.id] ?? null,
            caricoDopo: piano.riequilibrio.caricoDopo[g.id],
        }
    })
}
