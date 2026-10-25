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
// 108 e il bot non hanno nome, quindi non ricevono nemmeno con un flag acceso.

import { isTeamMember } from './config'
import { LANCIO_BUCKET, LANCIO_FUNNEL } from '@/lib/lancio/intake'

export interface GdoInstradabile {
    id: string
    gdoCode: number | null
    role: string
    isActive: boolean
    isBot: boolean
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
 * gira prima della riattivazione. Bot e account senza nome restano come sono.
 */
export function pianoInstradamento(gdos: readonly GdoInstradabile[], scelte: ScelteInstradamento): RigaPiano[] {
    const righe: RigaPiano[] = []
    for (const g of gdos) {
        if (g.role !== 'GDO' || g.isBot || !g.firstName?.trim() || g.gdoCode == null) continue
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
