// Bonus sugli incassi dello stesso mese (PO 02/11/2026). Funzioni pure.
//
// Per venditore, sull'insieme dei contratti FIRMATI nel mese: se una quota
// sufficiente e' stata PAGATA per intero entro la fine dello stesso mese, la
// commissione sale di mezzo punto / un punto / un punto e mezzo.
// Qui si calcola solo A CHE PUNTO e' il venditore: la commissione mostrata
// altrove (src/lib/venditore/obiettivi.ts) NON cambia.
//
// Spec: docs/superpowers/specs/2026-11-12-bonus-incassi-venditori-design.md

export type BonusScaglione = { minPct: number; bonusPct: number }

/** Soglie per mese di decorrenza (`dal` compreso), in ordine di data. Prima del primo `dal` il bonus non c'era. */
export const BONUS_INCASSI_REGOLE: { dal: string; scaglioni: BonusScaglione[] }[] = [
    { dal: '2026-10', scaglioni: [{ minPct: 85, bonusPct: 0.5 }, { minPct: 90, bonusPct: 1 }] },
    { dal: '2026-11', scaglioni: [{ minPct: 80, bonusPct: 0.5 }, { minPct: 85, bonusPct: 1 }, { minPct: 90, bonusPct: 1.5 }] },
]

/** Scaglioni validi nel mese `YYYY-MM`, dal piu' basso al piu' alto. Vuoto se il bonus non era ancora partito. */
export function scaglioniBonusIncassi(mese: string): BonusScaglione[] {
    let out: BonusScaglione[] = []
    for (const r of BONUS_INCASSI_REGOLE) if (r.dal <= mese) out = r.scaglioni
    return out
}

/** Lo stato del gestionale che vale "firmato ma non chiuso": non entra nei firmati (regola PO). */
export const STATO_STAND_BY = 'Stand-by'
const STATO_PAGATO = 'Pagato'

export type ContrattoBonus = {
    id: string
    dataFirma: string | null
    importoTotaleCents: number
    statoPagamento: string | null
    clienteNome: string | null
    clienteCognome: string | null
}

/** `contaCommissione` distingue i pagamenti del contratto (acconto, rata, saldo) da primo accesso, costi della finanziaria, extra e storni. */
export type IncassoBonus = { contrattoId: string; data: string | null; importoCents: number; contaCommissione: boolean }

export type ContrattoDaSaldare = {
    id: string
    cliente: string
    dataFirma: string | null
    importoCents: number
    /** Pagamenti registrati finora, anche dopo la fine del mese. */
    incassatoCents: number
    residuoCents: number
    statoPagamento: string | null
    /** Data dell'ultimo pagamento se il contratto e' stato saldato DOPO la fine del mese; altrimenti null. */
    saldatoIl: string | null
}

export type BonusIncassi = {
    mese: string
    firmati: number
    pagati: number
    /** Contratti pagati / firmati × 100: e' la percentuale che decide lo scaglione. Null senza firmati. */
    pct: number | null
    firmatoCents: number
    pagatoCents: number
    /** Dato secondario: importo dei contratti pagati / importo dei firmati × 100. */
    pctEuro: number | null
    scaglioni: BonusScaglione[]
    raggiunto: BonusScaglione | null
    /** Lo scaglione dopo e quanti contratti pagati in piu' servono, a firmati fermi. */
    prossimo: { scaglione: BonusScaglione; mancano: number } | null
    /** Firmati nel mese non pagati per intero entro il mese. */
    daSaldare: ContrattoDaSaldare[]
    /** Contratti in stand-by con firma nel mese: non contano finche' restano tali. */
    standBy: number
}

/**
 * Stato del bonus incassi di UN venditore nel mese `YYYY-MM`.
 * `contratti` e `incassi` possono contenere anche righe di altri mesi o di
 * contratti in stand-by: vengono scartate qui.
 *
 * Pagato nel mese = i pagamenti datati entro la fine del mese coprono l'importo,
 * oppure il gestionale dice "Pagato" e nessun pagamento e' datato dopo il mese
 * (i finanziati incassano meno dell'importo ma sono saldati).
 */
export function calcolaBonusIncassi(mese: string, contratti: ContrattoBonus[], incassi: IncassoBonus[]): BonusIncassi {
    const pagamenti = new Map<string, IncassoBonus[]>()
    for (const i of incassi) {
        if (!i.contaCommissione) continue
        const lista = pagamenti.get(i.contrattoId)
        if (lista) lista.push(i); else pagamenti.set(i.contrattoId, [i])
    }

    let firmati = 0, pagati = 0, firmatoCents = 0, pagatoCents = 0, standBy = 0
    const daSaldare: ContrattoDaSaldare[] = []
    for (const c of contratti) {
        if (!c.dataFirma || c.dataFirma.slice(0, 7) !== mese) continue
        if (c.statoPagamento === STATO_STAND_BY) { standBy += 1; continue }
        firmati += 1
        firmatoCents += c.importoTotaleCents

        const suoi = pagamenti.get(c.id) ?? []
        let totale = 0, entroMese = 0, tuttiEntroMese = true, ultimo: string | null = null
        for (const p of suoi) {
            totale += p.importoCents
            if (p.data && p.data.slice(0, 7) <= mese) entroMese += p.importoCents
            else tuttiEntroMese = false
            if (p.data && (!ultimo || p.data > ultimo)) ultimo = p.data
        }
        const statoPagato = c.statoPagamento === STATO_PAGATO
        const copertoNelMese = c.importoTotaleCents > 0 && entroMese >= c.importoTotaleCents
        const saldatoNelMese = statoPagato && suoi.length > 0 && tuttiEntroMese && entroMese > 0
        if (copertoNelMese || saldatoNelMese) {
            pagati += 1
            pagatoCents += c.importoTotaleCents
            continue
        }
        const saldato = statoPagato || (c.importoTotaleCents > 0 && totale >= c.importoTotaleCents)
        daSaldare.push({
            id: c.id,
            cliente: [c.clienteNome, c.clienteCognome].filter(Boolean).join(' ') || '—',
            dataFirma: c.dataFirma,
            importoCents: c.importoTotaleCents,
            incassatoCents: totale,
            residuoCents: saldato ? 0 : Math.max(0, c.importoTotaleCents - totale),
            statoPagamento: c.statoPagamento,
            saldatoIl: saldato ? ultimo : null,
        })
    }
    daSaldare.sort((a, b) => Number(a.saldatoIl !== null) - Number(b.saldatoIl !== null) || b.residuoCents - a.residuoCents)

    const scaglioni = scaglioniBonusIncassi(mese)
    let raggiunto: BonusScaglione | null = null
    let prossimo: BonusIncassi['prossimo'] = null
    if (firmati > 0) {
        for (const s of scaglioni) {
            // Confronto a interi: 17 su 20 e' esattamente l'85%.
            if (pagati * 100 >= s.minPct * firmati) raggiunto = s
            else if (!prossimo) prossimo = { scaglione: s, mancano: Math.ceil((s.minPct * firmati) / 100) - pagati }
        }
    }
    return {
        mese, firmati, pagati,
        pct: firmati > 0 ? (pagati / firmati) * 100 : null,
        firmatoCents, pagatoCents,
        pctEuro: firmatoCents > 0 ? (pagatoCents / firmatoCents) * 100 : null,
        scaglioni, raggiunto, prossimo, daSaldare, standBy,
    }
}

/** "66,6%" · "80%": una cifra decimale solo se serve, troncata (79,96 non diventa mai "80%"). */
export function formatPct(pct: number | null): string {
    if (pct === null) return '—'
    const r = Math.floor(pct * 10 + 1e-6) / 10
    return `${String(r).replace('.', ',')}%`
}

/** "+0,5%" · "+1%". */
export function formatBonus(bonusPct: number): string {
    return `+${String(bonusPct).replace('.', ',')}%`
}

/** La frase che dice al venditore dove si trova. `meseChiuso`: il mese e' finito, non si puo' piu' recuperare. */
export function fraseBonusIncassi(b: BonusIncassi, meseChiuso: boolean): string {
    if (b.scaglioni.length === 0) return "Il bonus sugli incassi è partito a ottobre 2026: in questo mese non c'era."
    if (b.firmati === 0) return 'Nessun contratto firmato in questo mese.'
    const p = b.prossimo
    const quanti = p ? (p.mancano === 1 ? '1 contratto pagato' : `${p.mancano} contratti pagati`) : ''
    const verbo = (uno: string, tanti: string) => (p && p.mancano === 1 ? uno : tanti)
    if (meseChiuso) {
        if (b.raggiunto) return `Mese chiuso con il ${formatBonus(b.raggiunto.bonusPct)}.`
        return p ? `Mese chiuso senza bonus: ${verbo('mancava', 'mancavano')} ${quanti} per il ${formatBonus(p.scaglione.bonusPct)}.` : 'Mese chiuso senza bonus.'
    }
    const manca = p ? `Ti ${verbo('manca', 'mancano')} ${quanti} per il ${formatBonus(p.scaglione.bonusPct)}.` : ''
    if (b.raggiunto) return p ? `Hai raggiunto il ${formatBonus(b.raggiunto.bonusPct)}. ${manca}` : `Hai raggiunto il ${formatBonus(b.raggiunto.bonusPct)}, il massimo.`
    return manca
}
