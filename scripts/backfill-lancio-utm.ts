/**
 * Bonifica UTM dei lead del lancio "Web Developer AI" importati dal sync.
 *
 *   npx tsx --env-file=.env scripts/backfill-lancio-utm.ts            # prova a vuoto (default)
 *   npx tsx --env-file=.env scripts/backfill-lancio-utm.ts --apply    # scrive davvero
 *
 * PERCHE'
 * Fino al fix del 19/09/2026 `syncLancioPool` scaricava i contatti AC senza
 * `include=fieldValues` e chiamava `buildLancioLeadRow` senza il parametro
 * `utm`: i lead entrati da li' hanno tutti e cinque gli UTM a NULL, mentre i
 * pochi entrati dal webhook li hanno. Il fix vale per i lead futuri; questo
 * script rimette a posto quelli gia' dentro.
 *
 * COSA FA, ESATTAMENTE
 * - Prende i lead del bucket/funnel del lancio che hanno un `acContactId` e
 *   almeno una delle cinque colonne UTM a NULL.
 * - Rilegge i fieldValues da ActiveCampaign (sideload della lista, una
 *   chiamata ogni 100 contatti; fallback per-contatto solo per chi non e' piu'
 *   iscritto alla lista).
 * - Scrive SOLO le colonne UTM ancora NULL, e solo se AC ha un valore. Un UTM
 *   gia' presente nel CRM non viene mai toccato: potrebbe averlo messo il
 *   webhook o un edit a mano, e in ogni caso e' il dato piu' vecchio (=quello
 *   dell'ingresso). L'UPDATE ha `IS NULL` anche nella WHERE, quindi due
 *   esecuzioni sovrapposte non si sovrascrivono a vicenda.
 * - Non tocca `updatedAt`, `version`, lo stato, l'assegnazione ne' altro, e
 *   non scrive eventi: e' una riparazione di metadati, non un movimento del
 *   lead. Niente `version + 1` di proposito — farebbe fallire un update
 *   concorrente del webhook AC (optimistic concurrency) su un lead che questo
 *   script sta solo completando.
 *
 * IDEMPOTENTE: al secondo giro non trova piu' NULL da riempire e non fa nulla.
 */
import { db } from '../src/db'
import { leads } from '../src/db/schema'
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import {
    UTM_FIELD_IDS,
    readUtmFields,
    indexFieldValuesByContact,
    type AcFieldValue,
    type AcUtmValues,
} from '../src/lib/acIntake/utmFields'
import { LANCIO_BUCKET, LANCIO_COMPANY, LANCIO_FUNNEL, LANCIO_LIST_NAME_NORMALIZED } from '../src/lib/lancio/intake'

const APPLY = process.argv.includes('--apply')

// ---------------------------------------------------------------- AC client
// Stesso backoff di src/lib/launchPoolShared.ts (429 + 5xx, rispetta
// Retry-After). Non si importa da li' perche' quel modulo tira dentro Drizzle,
// next/cache e mezzo CRM: qui basta un fetch.
const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com'
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || leggiChiaveDalSorgente()

/**
 * La chiave di produzione ha un default hardcoded in
 * src/app/actions/activeCampaignActions.ts (scelta storica del progetto). Se
 * la env non c'e' — ed e' il caso in locale — si legge di li', cosi' lo script
 * funziona senza chiedere all'operatore di incollare un segreto a mano. Non
 * viene mai stampata.
 */
function leggiChiaveDalSorgente(): string {
    // Si lancia dalla radice del repo (come `npm run import:cdr`).
    const file = path.resolve('src/app/actions/activeCampaignActions.ts')
    try {
        const src = fs.readFileSync(file, 'utf8')
        return src.match(/ACTIVECAMPAIGN_API_KEY\s*\|\|\s*'([^']+)'/)?.[1] ?? ''
    } catch {
        return ''
    }
}

const AC_MAX_RETRIES = 4
async function acGet(pathApi: string, attempt = 0): Promise<any> {
    const res = await fetch(`${AC_URL}/api/3${pathApi}`, {
        headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
    })
    if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt < AC_MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 10000)
            : Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250)
        await new Promise((r) => setTimeout(r, backoffMs))
        return acGet(pathApi, attempt + 1)
    }
    if (!res.ok) throw new Error(`AC API ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return res.json()
}

/** Gli id delle liste AC con questo nome normalizzato (come findAcListIdsByName). */
async function trovaListe(nameNormalized: string): Promise<string[]> {
    const ids = new Set<string>()
    for (let offset = 0; offset < 500; offset += 100) {
        const res = await acGet(`/lists?limit=100&offset=${offset}`)
        const lists = Array.isArray(res.lists) ? res.lists : []
        if (lists.length === 0) break
        for (const l of lists) {
            if (String(l?.name ?? '').trim().toLowerCase() === nameNormalized && l?.id != null) ids.add(String(l.id))
        }
        if (lists.length < 100) break
    }
    return Array.from(ids).sort()
}

// ------------------------------------------------------------------ colonne
const COLONNE = ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'] as const
type Colonna = typeof COLONNE[number]

// ------------------------------------------------------------------- script
async function main() {
    console.log(APPLY ? '=== BONIFICA UTM LANCIO — SCRITTURA ===' : '=== BONIFICA UTM LANCIO — PROVA A VUOTO (usa --apply per scrivere) ===')
    if (!AC_KEY) {
        console.error('ACTIVECAMPAIGN_API_KEY non disponibile (ne env ne default nel sorgente): non posso leggere AC.')
        process.exit(1)
    }
    console.log(`Campi AC usati: ${Object.entries(UTM_FIELD_IDS).map(([k, v]) => `${k}=${v}`).join(' ')}`)

    // I candidati: lead del lancio con acContactId e almeno un UTM mancante.
    // Bucket OR funnel, come leggiEsistenti: un import manuale della stessa
    // lista creerebbe il funnel senza bucket.
    const candidati = await db.select({
        id: leads.id,
        acContactId: leads.acContactId,
        phone: leads.phone,
        utmSource: leads.utmSource,
        utmMedium: leads.utmMedium,
        utmCampaign: leads.utmCampaign,
        utmContent: leads.utmContent,
        utmTerm: leads.utmTerm,
    }).from(leads).where(and(
        eq(leads.companyId, LANCIO_COMPANY),
        or(eq(leads.launchBucket, LANCIO_BUCKET), eq(leads.funnel, LANCIO_FUNNEL)),
        isNotNull(leads.acContactId),
        or(
            isNull(leads.utmSource), isNull(leads.utmMedium), isNull(leads.utmCampaign),
            isNull(leads.utmContent), isNull(leads.utmTerm),
        ),
    ))
    console.log(`Lead del lancio con almeno un UTM mancante: ${candidati.length}`)
    if (candidati.length === 0) {
        console.log('Niente da fare.')
        return
    }

    const daCercare = new Set(candidati.map((c) => String(c.acContactId)))

    // --- Lettura AC: prima il sideload della lista (1 chiamata ogni 100
    // contatti), poi il fallback per-contatto SOLO per chi resta fuori (chi si
    // e' disiscritto e non compare piu' nella lista).
    const fvPerContatto = new Map<string, AcFieldValue[]>()
    const listIds = await trovaListe(LANCIO_LIST_NAME_NORMALIZED)
    console.log(`Liste AC del lancio: ${listIds.join(', ') || '(nessuna)'}`)
    for (const listId of listIds) {
        for (let offset = 0; offset < 20000; offset += 100) {
            const page = await acGet(`/contacts?listid=${listId}&status=-1&limit=100&offset=${offset}&include=fieldValues`)
            const contacts = Array.isArray(page.contacts) ? page.contacts : []
            if (contacts.length === 0) break
            for (const [contactId, fvs] of indexFieldValuesByContact(page.fieldValues)) {
                if (daCercare.has(contactId) && !fvPerContatto.has(contactId)) fvPerContatto.set(contactId, fvs)
            }
            if (contacts.length < 100) break
        }
    }
    const mancanti = Array.from(daCercare).filter((id) => !fvPerContatto.has(id))
    if (mancanti.length > 0) {
        console.log(`${mancanti.length} contatti non trovati nel sideload della lista: li leggo uno a uno.`)
        for (const contactId of mancanti) {
            try {
                const res = await acGet(`/contacts/${contactId}/fieldValues`)
                fvPerContatto.set(contactId, Array.isArray(res.fieldValues) ? res.fieldValues : [])
            } catch (e: any) {
                console.warn(`  contatto ${contactId} non leggibile su AC: ${e?.message || e}`)
            }
        }
    }

    // --- Cosa scriverei
    let daAggiornare = 0
    let nienteSuAc = 0
    let nonLetti = 0
    const perColonna: Record<Colonna, number> = { utmSource: 0, utmMedium: 0, utmCampaign: 0, utmContent: 0, utmTerm: 0 }
    const piano: Array<{ id: string; acContactId: string; set: Partial<Record<Colonna, string>> }> = []

    for (const lead of candidati) {
        const contactId = String(lead.acContactId)
        const fvs = fvPerContatto.get(contactId)
        if (!fvs) { nonLetti++; continue }
        const utm: AcUtmValues = readUtmFields(fvs)
        const set: Partial<Record<Colonna, string>> = {}
        for (const col of COLONNE) {
            const valoreAc = utm[col]
            // SOLO dove il CRM ha NULL e AC ha qualcosa.
            if (valoreAc && lead[col] === null) { set[col] = valoreAc; perColonna[col]++ }
        }
        if (Object.keys(set).length === 0) { nienteSuAc++; continue }
        daAggiornare++
        piano.push({ id: lead.id, acContactId: contactId, set })
    }

    console.log('')
    console.log(`Lead da aggiornare:                  ${daAggiornare}`)
    console.log(`Lead senza niente da prendere su AC: ${nienteSuAc}`)
    console.log(`Lead con contatto AC non leggibile:  ${nonLetti}`)
    console.log(`Colonne che verrebbero riempite:     ${COLONNE.map((c) => `${c}=${perColonna[c]}`).join(' ')}`)
    console.log('')
    for (const riga of piano.slice(0, 10)) {
        console.log(`  esempio lead ${riga.id} (AC ${riga.acContactId}): ${JSON.stringify(riga.set)}`)
    }
    if (piano.length > 10) console.log(`  ... e altri ${piano.length - 10}`)

    if (!APPLY) {
        console.log('')
        console.log('Prova a vuoto: NIENTE e\' stato scritto. Rilancia con --apply per applicare.')
        return
    }

    // --- Scrittura, un lead alla volta. `IS NULL` anche nella WHERE: se nel
    // frattempo il webhook AC ha riempito quella colonna, la sua versione vince
    // e questo update non la tocca.
    let scritti = 0
    let saltatiInCorsa = 0
    for (const riga of piano) {
        const condizioniNull = Object.keys(riga.set).map((col) => sql`${sql.identifier(col)} IS NULL`)
        const res = await db.update(leads)
            .set(riga.set)
            .where(and(
                eq(leads.id, riga.id),
                eq(leads.companyId, LANCIO_COMPANY),
                sql.join(condizioniNull, sql` AND `),
            ))
            .returning({ id: leads.id })
        if (res.length > 0) scritti++
        else saltatiInCorsa++
    }
    console.log('')
    console.log(`Aggiornati: ${scritti}`)
    if (saltatiInCorsa > 0) console.log(`Saltati perche' nel frattempo riempiti da altri: ${saltatiInCorsa}`)
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1) })
