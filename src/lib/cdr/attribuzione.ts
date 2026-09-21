/**
 * Chi stava a quale postazione, giorno per giorno.
 *
 * `pbxExtensions` e' una mappatura interno → utente senza date di validita', ma
 * in ufficio le scrivanie si scambiano: verificato che dal 27/08/2026 tre
 * postazioni sono ruotate, e che fra aprile e giugno se ne sono mosse quasi
 * tutte. Siccome `import-cdr.ts` timbra `pbxCalls.userId` leggendo quella
 * tabella al momento dell'import, ogni rotazione sporca retroattivamente le
 * metriche per persona.
 *
 * Qui l'attribuzione si ricava dai dati invece che dalla tabella: per ogni
 * chiamata in uscita si cerca in `callLogs` un esito sullo stesso numero entro
 * ±10 minuti — chi ha scritto l'esito e' chi stava a quella postazione.
 * Aggregando per (interno, giorno) si ottiene la disposizione reale.
 *
 * I giorni in cui la persona ha telefonato senza esitare nulla non hanno
 * agganci: ereditano dal giorno agganciato piu' vicino dello stesso interno
 * entro FINESTRA_GIORNI. Oltre quella distanza restano scoperti — meglio un
 * buco che un'attribuzione inventata.
 *
 * `riattribuisciChiamate` scrive il risultato su `pbxCalls.userId` e allinea
 * `pbxExtensions` alla disposizione piu' recente: la chiama `import-cdr.ts`
 * alla fine di ogni import, cosi' la tabella non puo' piu' sporcare lo storico.
 * Le regole pure (finestra, eredita', disposizione) stanno in
 * `attribuzioneRegole.ts`.
 */
import { db } from '../../db'
import { sql } from 'drizzle-orm'
import {
    estendiAncore, ultimaDisposizione, chiaveGiorno,
    AGGANCI_MINIMI, QUOTA_MINIMA, type ChiaveGiorno,
} from './attribuzioneRegole'

export { chiaveGiorno, estendiAncore, FINESTRA_GIORNI, type ChiaveGiorno } from './attribuzioneRegole'

/** Ancore dirette: (interno, giorno) → utente che ha scritto gli esiti. */
export async function ancoreAttribuzione(): Promise<Map<ChiaveGiorno, string>> {
    const res = await db.execute(sql`
        WITH m AS (
            SELECT p.src, p."dateLocal" d, c."userId" cu, COUNT(*) n
            FROM "pbxCalls" p
            JOIN leads l ON right(regexp_replace(l.phone,'\\D','','g'),10) = p."dstKey"
            JOIN "callLogs" c ON c."leadId" = l.id
                 AND c."createdAt" BETWEEN p.calldate - interval '10 min' AND p.calldate + interval '10 min'
            -- Solo i GDO possono essere proprietari di una postazione del
            -- centralino: gli interni sono loro. Senza il predicato sul ruolo un
            -- esito scritto da chiunque altro (un venditore che lavora una sua
            -- pipeline, un admin che sistema una riga) entro 10 minuti da una
            -- chiamata uscente lo rende candidato proprietario di quell interno,
            -- e riattribuisciChiamate con applica SCRIVE: riscriverebbe a
            -- posteriori lo storico telefonico di un GDO a ogni import.
            JOIN users u ON u.id = c."userId" AND NOT u."isBot" AND u.role = 'GDO'
            WHERE p.direction = 'out' AND p."dstKey" IS NOT NULL
            GROUP BY 1,2,3),
        tot AS (SELECT src, d, SUM(n) tot FROM m GROUP BY 1,2)
        SELECT DISTINCT ON (m.src, m.d) m.src, m.d, m.cu
        FROM m JOIN tot t USING (src, d)
        WHERE m.n >= ${AGGANCI_MINIMI} AND m.n::numeric / t.tot >= ${QUOTA_MINIMA}
        ORDER BY m.src, m.d, m.n DESC
    `)
    const out = new Map<ChiaveGiorno, string>()
    for (const r of res.rows as any[]) out.set(chiaveGiorno(r.src, r.d), r.cu)
    return out
}

type GiornoPostazione = { src: string; dateLocal: string }

async function giorniPostazione(): Promise<GiornoPostazione[]> {
    const res = await db.execute(sql`SELECT DISTINCT src, "dateLocal" FROM "pbxCalls" WHERE direction = 'out'`)
    return (res.rows as any[]).map(r => ({ src: r.src, dateLocal: r.dateLocal }))
}

/** Scorciatoia: mappa completa pronta all'uso. */
export async function mappaAttribuzione(): Promise<Map<ChiaveGiorno, string>> {
    const [ancore, giorni] = await Promise.all([ancoreAttribuzione(), giorniPostazione()])
    return estendiAncore(ancore, giorni)
}

export type RiattribuzioneEsito = {
    /** Quanti giorni-postazione (e chiamate) hanno un'ancora diretta, ereditata o nessuna. */
    copertura: { origine: 'diretta' | 'ereditata' | 'nessuna'; giorni: number; chiamate: number }[]
    /** Cosa cambia rispetto a com'e' scritto adesso, per coppia (prima → dopo). */
    delta: { prima: string; dopo: string; chiamate: number }[]
    riattribuite: number
    /** Interni la cui riga in `pbxExtensions` e' stata riallineata (vuoto in anteprima). */
    postazioniAggiornate: string[]
    scritto: boolean
}

/**
 * Ricalcola l'attribuzione dai dati e, se `applica`, la scrive su
 * `pbxCalls.userId` e allinea `pbxExtensions`. In anteprima non tocca nulla.
 *
 * I giorni-postazione senza ancora entro la finestra vengono scritti a NULL
 * anche se oggi portano un utente: quell'utente veniva dalla tabella, non dai
 * dati, e non c'e' modo di sapere se e' giusto.
 *
 * Niente tabelle temporanee: il pool puo' servire query consecutive da
 * connessioni diverse, e una TEMP TABLE vive in una sola. La mappa viaggia
 * come VALUES dentro ogni statement.
 */
export async function riattribuisciChiamate(opts: { applica: boolean }): Promise<RiattribuzioneEsito> {
    const [ancore, giorni] = await Promise.all([ancoreAttribuzione(), giorniPostazione()])
    const mappa = estendiAncore(ancore, giorni)

    const righe = giorni.map(g => {
        const k = chiaveGiorno(g.src, g.dateLocal)
        const user = mappa.get(k) ?? null
        const origine = ancore.has(k) ? 'diretta' : user ? 'ereditata' : 'nessuna'
        return sql`(${g.src}::text, ${g.dateLocal}::text, ${user}::text, ${origine}::text)`
    })
    const valori = sql`(VALUES ${sql.join(righe, sql`, `)}) AS m(src, d, user_id, origine)`

    const copertura = await db.execute(sql`
        SELECT m.origine, COUNT(*)::int giorni, COALESCE(SUM(c.n), 0)::int chiamate
        FROM ${valori}
        LEFT JOIN (SELECT src, "dateLocal" d, COUNT(*) n FROM "pbxCalls" WHERE direction = 'out' GROUP BY 1,2) c
          ON c.src = m.src AND c.d = m.d
        GROUP BY 1 ORDER BY 3 DESC
    `)
    const delta = await db.execute(sql`
        SELECT COALESCE(uv.name,'(nessuno)') prima, COALESCE(un.name,'(nessuno)') dopo, COUNT(*)::int chiamate
        FROM "pbxCalls" p
        JOIN ${valori} ON m.src = p.src AND m.d = p."dateLocal"
        LEFT JOIN users uv ON uv.id = p."userId"
        LEFT JOIN users un ON un.id = m.user_id
        WHERE p.direction = 'out' AND p."userId" IS DISTINCT FROM m.user_id
        GROUP BY 1,2 ORDER BY 3 DESC
    `)
    const esito: RiattribuzioneEsito = {
        copertura: copertura.rows as any[],
        delta: delta.rows as any[],
        riattribuite: (delta.rows as any[]).reduce((s, r) => s + Number(r.chiamate), 0),
        postazioniAggiornate: [],
        scritto: false,
    }
    if (!opts.applica) return esito

    await db.execute(sql`
        UPDATE "pbxCalls" p SET "userId" = m.user_id
        FROM ${valori}
        WHERE m.src = p.src AND m.d = p."dateLocal"
          AND p.direction = 'out' AND p."userId" IS DISTINCT FROM m.user_id
    `)
    for (const [src, user] of ultimaDisposizione(ancore)) {
        const res = await db.execute(sql`
            UPDATE "pbxExtensions" SET "userId" = ${user}
            WHERE extension = ${src} AND "userId" IS DISTINCT FROM ${user}
            RETURNING extension
        `)
        if (res.rows.length) esito.postazioniAggiornate.push(src)
    }
    esito.scritto = true
    return esito
}

/** Stampa leggibile dell'esito, condivisa da script e import. */
export function stampaRiattribuzione(esito: RiattribuzioneEsito, log: (s: string) => void = console.log) {
    log("Copertura dell'attribuzione:")
    for (const r of esito.copertura) log(`  ${r.origine.padEnd(11)} ${String(r.giorni).padStart(5)} giorni-postazione  ${String(r.chiamate).padStart(7)} chiamate`)
    log(`\nChiamate riattribuite: ${esito.riattribuite}`)
    for (const r of esito.delta) log(`  ${r.prima.padEnd(12)} -> ${r.dopo.padEnd(12)} ${String(r.chiamate).padStart(6)}`)
    if (esito.scritto) {
        const p = esito.postazioniAggiornate
        log(`\nScritto. pbxExtensions riallineata su ${p.length} postazioni${p.length ? ` (${p.join(', ')})` : ''}.`)
    }
}
