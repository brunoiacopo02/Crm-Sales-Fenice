// A chi vanno i lead freschi ("vergini") e i ridati dal bot (PO 25/10/2026).
// Funzioni pure: le regole stanno anche nelle query del webhook AC e di
// reassign.ts, qui sono ripetute di proposito perché sono il punto testabile.
//
// Le scelte per persona restano i flag che /gestione già governa, così le
// spunte di quella pagina dicono il vero e le assenze si gestiscono da lì:
//   Freschi  (`acAutoIntake`)    riceve i vergini, fino a `dailyFreshCap` al giorno
//   Ridati   (`botReturnIntake`) riceve i ridati dal bot con chat interrotta,
//                                fino a `dailyReturnCap` al giorno se c'è
// In più vale sempre la squadra (`isTeamMember`): nome vero, GDO umano, attivo.
// 108 e il bot non hanno nome, quindi non ricevono nemmeno con un flag acceso;
// l'account di prova (isTest) non riceve mai lead veri.

import { isTeamMember } from './config'
import { LANCIO_BUCKET, LANCIO_FUNNEL } from '@/lib/lancio/intake'

export interface GdoInstradabile {
    id: string
    gdoCode: number | null
    role: string
    isActive: boolean
    isBot: boolean
    isTest: boolean
    firstName: string | null
    acAutoIntake: boolean
    botReturnIntake: boolean
    dailyFreshCap: number | null
}

export function riceveRidati(u: GdoInstradabile): boolean {
    return isTeamMember(u) && u.botReturnIntake
}

export function riceveVergini(u: GdoInstradabile): boolean {
    return isTeamMember(u) && u.acAutoIntake
}

/**
 * Sotto il tetto del giorno: `tetto` null = nessun tetto. Vale per i freschi
 * (`dailyFreshCap`, webhook AC) e per i ridati (`dailyReturnCap`, reassign.ts):
 * a tetto pieno il GDO esce dal giro fino a domani.
 */
export function sottoTetto(ricevutiOggi: number, tetto: number | null | undefined): boolean {
    return tetto == null || ricevutiOggi < tetto
}

/**
 * Dove va un lead fresco quando i GDO della squadra hanno tutti il tetto pieno:
 * al bot, come prima del 25/10 (PO: "i successivi seguono la regola di oggi").
 * Le scorte, se qualcuno le accende da /gestione, passano prima del bot. I GDO
 * senza tetto sono l'ultima rete, solo per il caso del bot spento: un lead non
 * deve mai restare senza padrone.
 */
export const ORDINE_RIPIEGO_FRESCHI = ['umani_sotto_tetto', 'scorte', 'bot', 'umani_senza_tetto'] as const
export type LivelloFreschi = (typeof ORDINE_RIPIEGO_FRESCHI)[number]

/**
 * L'ordine per la fascia in vigore. Nel rientro 'gdo_only' (nessun lead fresco
 * al bot, per proteggere il numero WhatsApp) il bot resta fuori: ci arriva solo
 * come ultima rete del webhook, se non c'è nessun GDO.
 */
export function ordineRipiegoFreschi(routing: string): readonly LivelloFreschi[] {
    return routing === 'gdo_only' ? ORDINE_RIPIEGO_FRESCHI.filter((l) => l !== 'bot') : ORDINE_RIPIEGO_FRESCHI
}

/**
 * Fascia mista ('bot_first', lun-ven 13-20 e sabato 9-16:30): chi passa per primo.
 *
 * Fino al 29/10/2026 il bot aveva la precedenza finché era sotto la soglia
 * giornaliera (`BOT_DAILY_LEADS`). Ma la soglia è stata alzata sopra il volume
 * che il bot riceve da solo la notte e la mattina (oltre 300 lead al giorno
 * dal 26/10), quindi il bot restava sempre "sotto soglia" e i GDO non hanno
 * mai ricevuto un vergine, nemmeno con `acAutoIntake` acceso: dal 19/09 zero.
 *
 * PO 25/10 e 29/10: ogni GDO della squadra riceve i suoi 10 vergini al giorno,
 * "i successivi seguono la regola di oggi". Quindi in fascia mista vengono
 * prima i GDO sotto il loro tetto, poi il bot con la sua soglia, poi la catena
 * dei freschi di sempre (scorte, bot, umani senza tetto). Il tetto dei GDO è
 * piccolo (10 a testa), quindi il bot perde pochi lead al giorno.
 *
 * PO 29/10/2026 sera: quando il bot ha raggiunto la soglia del giorno
 * (`BOT_DAILY_LEADS`, la sua capacità di aperture a freddo) i lead in più della
 * fascia mista vanno ai GDO dei vergini anche oltre il loro tetto
 * ('umani_oltre_tetto', a giro), invece di finire comunque al bot. Prima la
 * catena dei freschi li riportava al bot e la soglia non contava niente.
 * La catena dei freschi resta l'ultima rete (bot compreso): se non c'è nessun
 * GDO abilitato il lead va al bot, mai senza padrone.
 */
export const ORDINE_FASCIA_MISTA = ['umani_sotto_tetto', 'bot_sotto_soglia', 'umani_oltre_tetto', 'catena_freschi'] as const
export type LivelloFasciaMista = (typeof ORDINE_FASCIA_MISTA)[number]

/**
 * Regola temporanea "solo GDO" (PO 29/10/2026, si accende da sola quando i
 * numeri del giro non sono tutti HIGH: qualitaNumeri.ts). In fascia tutti i lead
 * vanno ai GDO dei vergini (`acAutoIntake`: 105, 106, 110, 115, 116, 119) a giro
 * PAREGGIATO (chi oggi ne ha di meno, poi il round-robin di sempre):
 *   1. ognuno fino al suo tetto del giorno: `SOLO_GDO_TETTO` (30) per tutti,
 *      tranne chi sta in `SOLO_GDO_TETTO_PROPRIO` (Lavinia 116), che si ferma al
 *      suo `dailyFreshCap` (10, modificabile da /gestione);
 *   2. tutti a tetto: round-robin normale fra tutti, senza tetti;
 *   3. nessun GDO disponibile: il bot, mai un lead orfano.
 */
export const SOLO_GDO_TETTO = 30
export const SOLO_GDO_TETTO_PROPRIO: readonly number[] = [116]
export const ORDINE_SOLO_GDO = ['sotto_tetto', 'tutti_senza_tetto', 'bot'] as const

/** Il tetto in fascia per un GDO. Puro: lo stesso calcolo sta nella query del webhook. */
export function tettoSoloGdo(gdoCode: number | null, dailyFreshCap: number | null): number {
    if (gdoCode != null && SOLO_GDO_TETTO_PROPRIO.includes(gdoCode)) return dailyFreshCap ?? SOLO_GDO_TETTO
    return SOLO_GDO_TETTO
}
export type LivelloSoloGdo = (typeof ORDINE_SOLO_GDO)[number]

export interface ScelteInstradamento {
    /** Codici GDO che non ricevono i ridati. */
    ridatiEsclusi: number[]
    /** Codici GDO che non ricevono i vergini. */
    verginiEsclusi: number[]
    /** Vergini al giorno per ciascun GDO abilitato. */
    verginiAlGiorno: number
}

/**
 * Decisioni del 25/10/2026: Christel (114) e Beatrice (112) in malattia.
 * Lorenzo (118) niente lead nuovi finché Bruno non lo accende da /gestione
 * (PO 25/10 mattina): né vergini né ridati. I suoi tetti a 30 al giorno li
 * prepara scripts/diretta/lead-lorenzo.ts, accenderlo è una spunta.
 */
export const SCELTE_PO_25_10: ScelteInstradamento = {
    ridatiEsclusi: [112, 114, 118],
    verginiEsclusi: [112, 114, 118],
    verginiAlGiorno: 10,
}

type Flag = Pick<GdoInstradabile, 'acAutoIntake' | 'botReturnIntake' | 'dailyFreshCap'>

export interface RigaPiano {
    id: string
    gdoCode: number | null
    nome: string | null
    /** Riceverà lead ma l'account è spento: va acceso prima (scripts/diretta/account-attiva.ts). */
    accountSpento: boolean
    prima: Flag
    dopo: Flag
}

/**
 * I flag da scrivere al go-live, solo per chi cambia. Guarda la squadra per
 * nome e non per `isActive`, così 107 e 116 sono pronti anche se lo script
 * gira prima della riattivazione. Bot, account senza nome e account di prova
 * restano come sono.
 */
export function pianoInstradamento(gdos: readonly GdoInstradabile[], scelte: ScelteInstradamento): RigaPiano[] {
    const righe: RigaPiano[] = []
    for (const g of gdos) {
        if (g.role !== 'GDO' || g.isBot || g.isTest || !g.firstName?.trim() || g.gdoCode == null) continue
        const vergini = !scelte.verginiEsclusi.includes(g.gdoCode)
        const dopo: Flag = {
            botReturnIntake: !scelte.ridatiEsclusi.includes(g.gdoCode),
            acAutoIntake: vergini,
            // Chi non riceve vergini tiene il tetto che ha: senza freschi non conta.
            dailyFreshCap: vergini ? scelte.verginiAlGiorno : g.dailyFreshCap,
        }
        const prima: Flag = { acAutoIntake: g.acAutoIntake, botReturnIntake: g.botReturnIntake, dailyFreshCap: g.dailyFreshCap }
        if (prima.acAutoIntake === dopo.acAutoIntake && prima.botReturnIntake === dopo.botReturnIntake && prima.dailyFreshCap === dopo.dailyFreshCap) continue
        righe.push({ id: g.id, gdoCode: g.gdoCode, nome: g.firstName, accountSpento: !g.isActive, prima, dopo })
    }
    return righe.sort((a, b) => (a.gdoCode ?? 0) - (b.gdoCode ?? 0))
}

/**
 * Ridistribuzione a parti uguali (al massimo uno di differenza), riproducibile:
 * lead e destinatari si ordinano per id, poi si va a turno.
 */
export function pianoRidistribuzione(leadIds: readonly string[], destinatari: readonly string[]): { leadId: string; a: string }[] {
    if (destinatari.length === 0) return []
    const dest = [...destinatari].sort()
    return [...leadIds].sort().map((leadId, i) => ({ leadId, a: dest[i % dest.length] }))
}

/** Un lead del lancio Web Dev AI, da qualunque parte lo si guardi. I pool database (DB_*) non lo sono. */
export function eLeadDelLancio(l: {
    launchBucket: string | null
    funnel: string | null
    lancioPool: string | null
    humanTestCohort: string | null
}): boolean {
    return l.launchBucket === LANCIO_BUCKET
        || l.funnel === LANCIO_FUNNEL
        || !!l.lancioPool
        || !!l.humanTestCohort
}
