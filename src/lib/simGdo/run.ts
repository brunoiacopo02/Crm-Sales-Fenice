// Giro SIM GDO (PO 14/11/2026): legge il foglio delle SIM, calcola il tasso di
// risposta di oggi per ogni riga e scrive valore e colore nella colonna
// "TASSO DI RSP.". La schermata /admin/sim-gdo usa lo stesso calcolo senza
// scrivere niente (anteprima).
//
// Sicurezza: se la lettura del foglio o dell'intestazione fallisce non si
// scrive nulla e non si tocca lo stato dei numeri. Ogni giro lascia traccia
// in appSettings (ULTIMO_GIRO_KEY) per la schermata.

import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, callLogs, pbxExtensions, users } from '@/db/schema'
import { dayBoundsRome, monthBoundsRome } from '@/lib/dateUtils'
import { leggiFoglio, lettereColonna } from './intestazioni'
import { aggiornaStatoSim, leggiStatoSim, type StatoSim } from './cambioSim'
import { calcolaRighe, type RigaCalcolata, type UtenteInterno } from './giro'
import { richiesteScrittura } from './celle'
import { contaGruppi, eGdoDellaMedia, ESITI_CHIAMATA, MEDIA_DAL_MESE, sogliaRossa, tasso, type Conteggio } from './tasso'
import { leggiFoglioSim, scriviFoglioSim } from './foglio'

const FENICE = 'fenice'
/** Ultimo numero visto per ogni interno e istante del cambio (vedi cambioSim.ts). */
export const STATO_SIM_KEY = 'sim_gdo_stato_sim'
/** Ora ed esito dell'ultimo giro orario. */
export const ULTIMO_GIRO_KEY = 'sim_gdo_ultimo_giro'
const AUTORE = 'cron:sim-gdo'

export interface UltimoGiro {
    alle: string
    esito: 'ok' | 'errore'
    messaggio: string
    celleScritte: number
}

export interface EsitoSimGdo {
    ok: boolean
    errore?: string
    adesso: string
    media: Conteggio
    mediaTasso: number | null
    soglia: number | null
    colonnaTasso: string | null
    righe: RigaCalcolata[]
    /** Interni con un cambio di SIM visto in questo giro. */
    cambiati: string[]
    celleScritte: number
}

async function leggiSetting(key: string): Promise<string | null> {
    const [r] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1)
    return r?.value ?? null
}

async function scriviSetting(key: string, value: string): Promise<void> {
    const now = new Date()
    await db.insert(appSettings)
        .values({ key, value, updatedAt: now, updatedBy: AUTORE, companyId: FENICE })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now, updatedBy: AUTORE } })
}

export async function leggiUltimoGiro(): Promise<UltimoGiro | null> {
    const raw = await leggiSetting(ULTIMO_GIRO_KEY)
    if (!raw) return null
    try {
        const v = JSON.parse(raw) as UltimoGiro
        return typeof v?.alle === 'string' ? v : null
    } catch {
        return null
    }
}

async function salvaUltimoGiro(g: UltimoGiro): Promise<void> {
    await scriviSetting(ULTIMO_GIRO_KEY, JSON.stringify(g))
}

/** Interno → utente, dalla mappa del centralino (pbxExtensions). */
async function leggiInterni(): Promise<Map<string, UtenteInterno>> {
    const righe = await db.select({
        extension: pbxExtensions.extension,
        id: users.id,
        firstName: users.firstName,
        gdoCode: users.gdoCode,
        name: users.name,
        displayName: users.displayName,
    }).from(pbxExtensions)
        .innerJoin(users, eq(users.id, pbxExtensions.userId))
        .where(eq(pbxExtensions.companyId, FENICE))
    return new Map(righe.map(r => [r.extension.trim(), {
        id: r.id, firstName: r.firstName, gdoCode: r.gdoCode, nomeCrm: r.displayName ?? r.name,
    }]))
}

/** Media di squadra dal 1 giugno 2026 a adesso: totale risposte ÷ totale chiamate. */
async function leggiMedia(): Promise<Conteggio> {
    const dal = monthBoundsRome(MEDIA_DAL_MESE).start
    const gruppi = await db.select({
        role: users.role,
        isBot: users.isBot,
        isTest: users.isTest,
        gdoCode: users.gdoCode,
        outcome: callLogs.outcome,
        discardReason: callLogs.discardReason,
        n: sql<number>`count(*)::int`,
    }).from(callLogs)
        .innerJoin(users, eq(users.id, callLogs.userId))
        .where(and(
            gte(callLogs.createdAt, dal),
            inArray(callLogs.outcome, [...ESITI_CHIAMATA]),
            eq(users.role, 'GDO'),
        ))
        .groupBy(users.id, users.role, users.isBot, users.isTest, users.gdoCode, callLogs.outcome, callLogs.discardReason)
    // Chi entra nella media lo decide eGdoDellaMedia, in un punto solo.
    return contaGruppi(gruppi.filter(eGdoDellaMedia).map(g => ({ ...g, n: Number(g.n) })))
}

async function leggiLogsDiOggi(userIds: string[], adesso: Date) {
    if (userIds.length === 0) return []
    const { start } = dayBoundsRome(adesso)
    return db.select({
        userId: callLogs.userId,
        outcome: callLogs.outcome,
        discardReason: callLogs.discardReason,
        createdAt: callLogs.createdAt,
    }).from(callLogs).where(and(
        gte(callLogs.createdAt, start),
        inArray(callLogs.userId, userIds),
        inArray(callLogs.outcome, [...ESITI_CHIAMATA]),
    ))
}

const vuoto = (adesso: Date, errore: string): EsitoSimGdo => ({
    ok: false, errore, adesso: adesso.toISOString(), media: { chiamate: 0, risposte: 0 },
    mediaTasso: null, soglia: null, colonnaTasso: null, righe: [], cambiati: [], celleScritte: 0,
})

/**
 * `scrivi: false` = anteprima: stesso calcolo, nessuna scrittura né sul foglio
 * né nello stato (i cambi di SIM visti ora si registrano al prossimo giro).
 */
export async function calcolaSimGdo(opts: { scrivi: boolean; adesso?: Date }): Promise<EsitoSimGdo> {
    const adesso = opts.adesso ?? new Date()

    let foglio: Awaited<ReturnType<typeof leggiFoglioSim>>
    try {
        foglio = await leggiFoglioSim(opts.scrivi ? 'scrittura' : 'lettura')
    } catch (e) {
        return vuoto(adesso, e instanceof Error ? e.message : 'Lettura del foglio fallita.')
    }
    const lettura = leggiFoglio(foglio.valori)
    if (!lettura.ok) return vuoto(adesso, lettura.errore)

    const [interni, media, statoPrima] = await Promise.all([
        leggiInterni(),
        leggiMedia(),
        leggiSetting(STATO_SIM_KEY).then(leggiStatoSim),
    ])
    const { stato, cambiati } = aggiornaStatoSim(statoPrima, lettura.righe, adesso)

    const mediaTasso = tasso(media)
    const soglia = mediaTasso === null ? null : sogliaRossa(mediaTasso)
    const ids = [...new Set(lettura.righe.map(r => interni.get(r.interno)?.id).filter((x): x is string => !!x))]
    const logs = await leggiLogsDiOggi(ids, adesso)
    const righe = calcolaRighe({ righe: lettura.righe, statoSim: stato, interni, logs, soglia, adesso })

    const esito: EsitoSimGdo = {
        ok: true, adesso: adesso.toISOString(), media, mediaTasso, soglia,
        colonnaTasso: lettereColonna(lettura.colonne.tasso), righe, cambiati, celleScritte: 0,
    }
    if (!opts.scrivi) return esito

    // Lo stato dei numeri si salva prima di scrivere: il cambio di SIM è un
    // fatto visto nel foglio, vale anche se la scrittura poi non riesce.
    if (JSON.stringify(stato) !== JSON.stringify(statoPrima)) await salvaStato(stato)
    await scriviFoglioSim(richiesteScrittura({ sheetId: foglio.sheetId, colonnaTasso: lettura.colonne.tasso, righe }))
    esito.celleScritte = righe.length
    return esito
}

async function salvaStato(stato: StatoSim): Promise<void> {
    await scriviSetting(STATO_SIM_KEY, JSON.stringify(stato))
}

/** Giro orario: calcola, scrive, lascia traccia. Non lancia mai. */
export async function eseguiGiroSimGdo(): Promise<EsitoSimGdo> {
    const adesso = new Date()
    let esito: EsitoSimGdo
    try {
        esito = await calcolaSimGdo({ scrivi: true, adesso })
    } catch (e) {
        esito = vuoto(adesso, e instanceof Error ? e.message : 'Errore ignoto.')
    }
    try {
        await salvaUltimoGiro({
            alle: adesso.toISOString(),
            esito: esito.ok ? 'ok' : 'errore',
            messaggio: esito.ok
                ? `Scritte ${esito.celleScritte} celle${esito.cambiati.length ? `, cambio SIM su ${esito.cambiati.join(', ')}` : ''}.`
                : esito.errore ?? 'Errore ignoto.',
            celleScritte: esito.celleScritte,
        })
    } catch (e) {
        console.error('[sim-gdo] traccia dell\'ultimo giro non salvata', e)
    }
    return esito
}
