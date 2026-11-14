// Giro SIM GDO (PO 14/11/2026): legge il foglio delle SIM, calcola il tasso di
// risposta di oggi per ogni riga e scrive valore e colore nella colonna
// "TASSO DI RSP.". La schermata /admin/sim-gdo usa lo stesso calcolo senza
// scrivere niente (anteprima).
//
// Sicurezza: se la lettura del foglio o dell'intestazione fallisce non si
// scrive nulla e non si tocca lo stato dei numeri; se il foglio cambia fra la
// lettura e la scrittura si rinuncia e si riprova al giro dopo. Ogni giro
// lascia traccia in appSettings (ULTIMO_GIRO_KEY) per la schermata.

import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, callLogs, users } from '@/db/schema'
import { isRealGdo } from '@/lib/kpi/canon'
import { dayBoundsRome, monthBoundsRome } from '@/lib/dateUtils'
import { impronta, leggiFoglio, lettereColonna } from './intestazioni'
import { aggiornaStatoSim, leggiStatoSim, type StatoSim } from './cambioSim'
import { calcolaRighe, type RigaCalcolata, type UtenteGdo } from './giro'
import { contaCelle, richiesteScrittura } from './celle'
import { contaGruppi, eGdoDellaMedia, ESITI_CHIAMATA, MEDIA_DAL_MESE, sogliaRossa, tasso, type Conteggio } from './tasso'
import { leggiFoglioSim, scriviFoglioSim } from './foglio'

const FENICE = 'fenice'
/** Ultimo numero visto per ogni interno e istante del cambio (vedi cambioSim.ts). */
export const STATO_SIM_KEY = 'sim_gdo_stato_sim'
/** Ora ed esito dell'ultimo giro orario. */
export const ULTIMO_GIRO_KEY = 'sim_gdo_ultimo_giro'
const AUTORE = 'cron:sim-gdo'
export const FOGLIO_MODIFICATO = 'Foglio modificato durante il giro, riprovo al prossimo.'

export interface UltimoGiro {
    alle: string
    esito: 'ok' | 'errore'
    messaggio: string
    /** Celle riempite con un tasso. */
    celleConValore: number
    /** Celle svuotate (riga senza GDO agganciato o senza chiamate oggi). */
    celleSvuotate: number
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
    /** Celle scritte con un valore / svuotate in questo giro (0 in anteprima). */
    celleConValore: number
    celleSvuotate: number
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
        const v = JSON.parse(raw) as Partial<UltimoGiro>
        if (typeof v?.alle !== 'string') return null
        return {
            alle: v.alle,
            esito: v.esito === 'ok' ? 'ok' : 'errore',
            messaggio: typeof v.messaggio === 'string' ? v.messaggio : '',
            celleConValore: Number(v.celleConValore) || 0,
            celleSvuotate: Number(v.celleSvuotate) || 0,
        }
    } catch {
        return null
    }
}

/**
 * GDO a cui si può agganciare una riga del foglio: attivi, non bot, non prova
 * (isRealGdo del canone). L'aggancio è per nome (giro.ts), non per interno:
 * `pbxExtensions` non si usa, è ferma all'ultimo import dei tabulati.
 */
async function leggiGdoAttivi(): Promise<UtenteGdo[]> {
    const righe = await db.select({
        id: users.id,
        firstName: users.firstName,
        gdoCode: users.gdoCode,
        role: users.role,
        isActive: users.isActive,
        isBot: users.isBot,
        isTest: users.isTest,
    }).from(users).where(and(eq(users.companyId, FENICE), eq(users.role, 'GDO'), eq(users.isActive, true)))
    return righe.filter(isRealGdo).map(r => ({ id: r.id, firstName: r.firstName, gdoCode: r.gdoCode }))
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
            // Stessa azienda dei GDO a cui si agganciano le righe (leggiGdoAttivi).
            eq(users.companyId, FENICE),
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
    mediaTasso: null, soglia: null, colonnaTasso: null, righe: [], cambiati: [], celleConValore: 0, celleSvuotate: 0,
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

    const [utenti, media, statoPrima] = await Promise.all([
        leggiGdoAttivi(),
        leggiMedia(),
        leggiSetting(STATO_SIM_KEY).then(leggiStatoSim),
    ])
    const { stato, cambiati } = aggiornaStatoSim(statoPrima, lettura.righe, adesso)

    const mediaTasso = tasso(media)
    const soglia = mediaTasso === null ? null : sogliaRossa(mediaTasso)
    // Le chiamate di oggi di tutti i GDO attivi: pochi e poche righe, e così l'aggancio resta tutto in giro.ts.
    const logs = await leggiLogsDiOggi(utenti.map(u => u.id), adesso)
    const righe = calcolaRighe({ righe: lettura.righe, statoSim: stato, utenti, logs, soglia, adesso })

    const esito: EsitoSimGdo = {
        ok: true, adesso: adesso.toISOString(), media, mediaTasso, soglia,
        colonnaTasso: lettereColonna(lettura.colonne.tasso), righe, cambiati, celleConValore: 0, celleSvuotate: 0,
    }
    if (!opts.scrivi) return esito

    // Subito prima di scrivere si rilegge il foglio: se nel frattempo qualcuno
    // ha cambiato intestazione o righe degli interni, le celle finirebbero
    // sulla riga sbagliata. Si rinuncia (stato compreso) e si riprova al giro dopo.
    const seconda = await leggiFoglioSim('scrittura')
    if (seconda.sheetId !== foglio.sheetId || impronta(seconda.valori) !== impronta(foglio.valori)) {
        return { ...vuoto(adesso, FOGLIO_MODIFICATO), media, mediaTasso, soglia, righe }
    }

    // Lo stato dei numeri si salva prima di scrivere: il cambio di SIM è un
    // fatto visto nel foglio, vale anche se la scrittura poi non riesce.
    if (JSON.stringify(stato) !== JSON.stringify(statoPrima)) await salvaStato(stato)
    await scriviFoglioSim(richiesteScrittura({ sheetId: foglio.sheetId, colonnaTasso: lettura.colonne.tasso, righe }))
    const celle = contaCelle(righe)
    esito.celleConValore = celle.conValore
    esito.celleSvuotate = celle.svuotate
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
        await scriviSetting(ULTIMO_GIRO_KEY, JSON.stringify({
            alle: adesso.toISOString(),
            esito: esito.ok ? 'ok' : 'errore',
            messaggio: esito.ok
                ? `Scritte ${esito.celleConValore} celle con il tasso, svuotate ${esito.celleSvuotate}${esito.cambiati.length ? `; cambio SIM su ${esito.cambiati.join(', ')}` : ''}.`
                : esito.errore ?? 'Errore ignoto.',
            celleConValore: esito.celleConValore,
            celleSvuotate: esito.celleSvuotate,
        } satisfies UltimoGiro))
    } catch (e) {
        console.error('[sim-gdo] traccia dell\'ultimo giro non salvata', e)
    }
    return esito
}
