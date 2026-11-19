/**
 * Giovedì 19/11/2026 (titolare): rettifiche una tantum del salvadanaio dei GDO, come
 * eccezioni che NON cambiano la regola dei premi.
 *  - Cristian (115) e Lavinia (116): +7,50 € a testa nella settimana 9-14/11/2026. Terzi a
 *    pari merito, trattati come secondi a pari merito (12,50 a testa invece di 5).
 *  - Alessandro (110) e Zora (106): malus di 12 € a testa. IN SOSPESO: vedi il TODO sotto.
 *
 * Scrive righe in "salvadanaioRettifiche" (migrazione 0063, da applicare PRIMA). Il
 * salvadanaio (src/lib/economy/premiMese.ts) le somma sopra alla settimana, registrata o
 * ricalcolata; "weeklyPrizeRuns" non si tocca. Il GDO le vede entro 2 minuti (cache).
 *
 * Senza opzioni è una prova a vuoto: legge e dice cosa farebbe.
 * Idempotente: la chiave è persona + settimana + motivo. Una voce già presente con lo
 * stesso importo si salta; con un importo diverso lo script si ferma senza scrivere.
 * Prima di scrivere salva un file di ripristino con le righe che sta per inserire;
 * `--ripristina` toglie solo quelle (per id, e solo se sono ancora uguali).
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/rettifiche-salvadanaio-19-11.ts
 *        [--esegui | --ripristina [--file=...] [--esegui]]
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../src/db'
import { salvadanaioRettifiche, users } from '../../src/db/schema'
import { settimanaLunSab } from '../../src/lib/economy/premiSettimana'

interface Rettifica {
    gdoCode: number
    /** Nome vero atteso (users.firstName): se il codice è di un'altra persona lo script si ferma. */
    nome: string
    /** Lunedì della settimana a cui appartiene, 'YYYY-MM-DD'. Conta nel mese del suo sabato. */
    lunedi: string
    /** Con il segno: positivo premio, negativo malus. */
    euro: number
    /** Lo legge il GDO nel salvadanaio. */
    motivo: string
    /** Interna. */
    nota: string | null
}

// ── Le rettifiche da scrivere ──────────────────────────────────────────────
const NOTA_PARI_MERITO = 'Eccezione del titolare 19/11/2026: terzi a pari merito trattati come secondi a pari merito (12,50 a testa)'
const RETTIFICHE: Rettifica[] = [
    { gdoCode: 115, nome: 'Cristian', lunedi: '2026-11-09', euro: 7.5, motivo: 'Premio extra', nota: NOTA_PARI_MERITO },
    { gdoCode: 116, nome: 'Lavinia', lunedi: '2026-11-09', euro: 7.5, motivo: 'Premio extra', nota: NOTA_PARI_MERITO },
    // TODO (titolare): dire a quale settimana/mese attribuire i due malus, poi mettere il
    // lunedì giusto al posto di 'AAAA-MM-GG', togliere il commento e rilanciare.
    // { gdoCode: 110, nome: 'Alessandro', lunedi: 'AAAA-MM-GG', euro: -12, motivo: 'Malus presenze', nota: 'Malus deciso dal titolare il 19/11/2026' },
    // { gdoCode: 106, nome: 'Zora', lunedi: 'AAAA-MM-GG', euro: -12, motivo: 'Malus presenze', nota: 'Malus deciso dal titolare il 19/11/2026' },
]

const FENICE = 'fenice'
const ORIGINE = 'rettifiche_salvadanaio_19_11'
const CARTELLA = 'C:/Users/bruno/Desktop/CRM GDO/scripts/diretta/ripristino'
const PREFISSO = 'rettifiche-salvadanaio-19-11-'
const ADMIN = 'a9572fa1-1824-49b2-b523-ed68ec262702'

interface Riga { id: string; userId: string; gdoCode: number; nome: string; weekStart: string; euro: string; motivo: string; nota: string | null }
interface FileRipristino { creato: string; origine: string; righe: Riga[] }

const opz = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const flag = (n: string) => process.argv.includes(`--${n}`)
const uguale = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const conSegno = (euro: number) => `${euro < 0 ? '-' : '+'}${Math.abs(euro).toFixed(2).replace('.', ',')} €`

/** Controlli sull'elenco in cima, prima di toccare il database. */
function controlla(r: Rettifica) {
    const chi = `${r.gdoCode} ${r.nome}`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.lunedi)) throw new Error(`${chi}: "${r.lunedi}" non è una data AAAA-MM-GG`)
    const s = settimanaLunSab(new Date(`${r.lunedi}T12:00:00Z`))
    if (s.lunedi !== r.lunedi) throw new Error(`${chi}: ${r.lunedi} non è un lunedì (la sua settimana parte il ${s.lunedi})`)
    if (!Number.isFinite(r.euro) || r.euro === 0) throw new Error(`${chi}: importo non valido`)
    if (Math.abs(r.euro * 100 - Math.round(r.euro * 100)) > 1e-6) throw new Error(`${chi}: l'importo ha più di due decimali`)
    const motivo = r.motivo.trim()
    if (motivo.length < 1 || motivo.length > 60) throw new Error(`${chi}: il motivo deve avere da 1 a 60 caratteri`)
    return { ...r, motivo, sabato: s.sabato }
}

async function main() {
    const esegui = flag('esegui')
    if (flag('ripristina')) return ripristina(esegui)

    const voci = RETTIFICHE.map(controlla)
    const chiavi = new Set<string>()
    for (const v of voci) {
        const k = `${v.gdoCode}|${v.lunedi}|${v.motivo}`
        if (chiavi.has(k)) throw new Error(`Voce doppia nell'elenco: ${k}`)
        chiavi.add(k)
    }
    if (voci.length === 0) { console.log('Nessuna rettifica in elenco.'); return }

    const [admin] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, ADMIN))
    if (!admin || admin.role !== 'ADMIN') throw new Error(`L'utente ${ADMIN} non è un ADMIN: mi fermo`)

    const gdo = await db.select({
        id: users.id, gdoCode: users.gdoCode, firstName: users.firstName, role: users.role,
        isActive: users.isActive, isBot: users.isBot, isTest: users.isTest,
    }).from(users).where(eq(users.companyId, FENICE))
    const unico = (c: number, nome: string) => {
        const g = gdo.filter((x) => x.gdoCode === c && x.role === 'GDO' && x.isActive && !x.isBot && !x.isTest)
        if (g.length !== 1) throw new Error(`GDO ${c}: ${g.length} account attivi, mi fermo`)
        if (!uguale(g[0].firstName ?? '', nome)) throw new Error(`GDO ${c}: nel CRM si chiama "${g[0].firstName}", in elenco "${nome}". Mi fermo`)
        return g[0]
    }
    const piano = voci.map((v) => ({ ...v, userId: unico(v.gdoCode, v.nome).id }))

    const presenti = await db.select().from(salvadanaioRettifiche).where(and(
        eq(salvadanaioRettifiche.companyId, FENICE),
        inArray(salvadanaioRettifiche.userId, piano.map((p) => p.userId)),
        inArray(salvadanaioRettifiche.weekStart, piano.map((p) => p.lunedi)),
    ))

    const nuove: Riga[] = []
    for (const p of piano) {
        const riga = `${p.gdoCode} ${p.nome}, settimana ${p.lunedi} → ${p.sabato}, ${p.motivo}: ${conSegno(p.euro)}`
        const gia = presenti.find((x) => x.userId === p.userId && x.weekStart === p.lunedi && x.motivo === p.motivo)
        if (gia) {
            if (Math.round(Number(gia.euro) * 100) !== Math.round(p.euro * 100)) {
                throw new Error(`${riga}: c'è già una voce con lo stesso motivo ma di ${conSegno(Number(gia.euro))} (id ${gia.id}). Non la sovrascrivo: mi fermo`)
            }
            console.log(`  già presente, salto   ${riga}`)
            continue
        }
        console.log(`  da inserire           ${riga}`)
        nuove.push({ id: crypto.randomUUID(), userId: p.userId, gdoCode: p.gdoCode, nome: p.nome, weekStart: p.lunedi, euro: p.euro.toFixed(2), motivo: p.motivo, nota: p.nota })
    }
    console.log(`\nIn elenco ${piano.length}, da inserire ${nuove.length}, già presenti ${piano.length - nuove.length}.`)
    if (nuove.length === 0) return
    if (!esegui) { console.log('Prova a vuoto: nessuna scrittura. Aggiungi --esegui per scrivere.'); return }

    // ── File di ripristino (prima di scrivere) ─────────────────────────────
    const ora = new Date()
    fs.mkdirSync(CARTELLA, { recursive: true })
    const file = path.join(CARTELLA, `${PREFISSO}${ora.toISOString().replace(/[:.]/g, '-')}.json`)
    const dati: FileRipristino = { creato: ora.toISOString(), origine: ORIGINE, righe: nuove }
    fs.writeFileSync(file, JSON.stringify(dati, null, 1))
    console.log(`File di ripristino: ${file}`)

    // L'indice unico (persona, settimana, motivo) ferma un doppio lancio in contemporanea.
    const scritte = await db.transaction(async (tx) => tx.insert(salvadanaioRettifiche).values(nuove.map((n) => ({
        id: n.id, companyId: FENICE, userId: n.userId, weekStart: n.weekStart, euro: n.euro,
        motivo: n.motivo, nota: n.nota, createdById: ADMIN, createdAt: ora,
    }))).onConflictDoNothing().returning({ id: salvadanaioRettifiche.id }))
    console.log(`Scritte: ${scritte.length} su ${nuove.length}. Nel salvadanaio entro 2 minuti (cache).`)
    console.log(`Per annullare: --ripristina --file=${file} --esegui`)
}

/** Toglie solo le righe inserite da questo script: quelle dei file di ripristino, per id e ancora uguali. */
async function ripristina(esegui: boolean) {
    const uno = opz('file')
    const files = uno ? [uno] : (fs.existsSync(CARTELLA) ? fs.readdirSync(CARTELLA) : [])
        .filter((f) => f.startsWith(PREFISSO) && f.endsWith('.json')).sort().map((f) => path.join(CARTELLA, f))
    if (!files.length) throw new Error(`Nessun file di ripristino in ${CARTELLA}`)
    const righe = files.flatMap((f) => {
        const d = JSON.parse(fs.readFileSync(f, 'utf8')) as FileRipristino
        if (d.origine !== ORIGINE) throw new Error(`${f}: non è un file di questo script`)
        return d.righe
    })
    console.log(`Ripristino da ${files.length} file: ${righe.length} righe.`)
    const cond = (r: Riga) => and(
        eq(salvadanaioRettifiche.id, r.id), eq(salvadanaioRettifiche.userId, r.userId), eq(salvadanaioRettifiche.weekStart, r.weekStart),
        eq(salvadanaioRettifiche.motivo, r.motivo), eq(salvadanaioRettifiche.euro, r.euro),
    )
    if (!esegui) {
        for (const r of righe) {
            const [c] = await db.select({ id: salvadanaioRettifiche.id }).from(salvadanaioRettifiche).where(cond(r))
            console.log(`  ${c ? 'da togliere      ' : 'non c\'è più, salto'} ${r.gdoCode} ${r.nome}, settimana ${r.weekStart}, ${r.motivo}: ${conSegno(Number(r.euro))}`)
        }
        console.log('Prova a vuoto. Aggiungi --esegui per togliere.')
        return
    }
    const n = await db.transaction(async (tx) => {
        let k = 0
        for (const r of righe) k += (await tx.delete(salvadanaioRettifiche).where(cond(r)).returning({ id: salvadanaioRettifiche.id })).length
        return k
    })
    console.log(`Tolte: ${n} su ${righe.length}.`)
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1) })
