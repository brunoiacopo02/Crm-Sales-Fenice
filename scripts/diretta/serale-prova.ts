/**
 * Prova a vuoto del giro serale automatico (PO 07/11/2026): stesso piano del
 * cron /api/cron/diretta-serale, letto dal DB di produzione, NESSUNA scrittura.
 * Regole in src/lib/diretta/automatico.ts.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/serale-prova.ts [--elenco] [--ora=2026-11-07T20:45:00+01:00]
 *
 * Senza --ora usa adesso: le esclusioni "toccato negli ultimi 30 minuti"
 * dipendono dall'istante, a turno in corso il piano esclude più lead di stasera.
 */

import { daSerbatoio, pianoSerale, riepilogoPerGdo } from '../../src/lib/diretta/automatico'
import { leggiGiro, leggiSerbatoio, FENICE } from '../../src/lib/diretta/automaticoDb'

async function main() {
    const arg = process.argv.find(a => a.startsWith('--ora='))?.slice(6)
    const ora = arg ? new Date(arg) : new Date()
    const { gdos, lista } = await leggiGiro(ora)
    const piano = pianoSerale(gdos, lista, ora)
    const righe = riepilogoPerGdo(gdos, piano, ora)
    const nome = new Map(gdos.map(g => [g.codice, g.nome]))
    console.log(`Prova a vuoto del giro serale, ora ${ora.toISOString()}. Lead aperti letti: ${lista.length}.`)
    console.log('GDO              | stato     | carico | accant. | ceduti | ricevuti (prime) | quota | carico dopo')
    for (const r of righe.sort((a, b) => a.codice - b.codice)) {
        const stato = r.assente ? 'ASSENTE' : r.ricevente ? 'riceve' : 'fuori giro'
        console.log(`${`${r.codice} ${nome.get(r.codice)}`.padEnd(16)} | ${stato.padEnd(9)} | ${String(r.caricoPrima).padStart(6)} | ${String(r.accantonati).padStart(7)} | ${String(r.ceduti).padStart(6)} | ${String(r.ricevuti).padStart(8)} (${String(r.primeRicevute).padStart(3)}) | ${String(r.quota ?? '-').padStart(5)} | ${String(r.caricoDopo).padStart(6)}`)
    }
    console.log(`Totale: ${piano.accantonati.length} accantonati, ${piano.riequilibrio.spostamenti.length} spostati.`)
    const flussi = new Map<string, number>()
    for (const s of piano.riequilibrio.spostamenti) {
        const k = `${gdos.find(g => g.id === s.da)?.codice} → ${gdos.find(g => g.id === s.a)?.codice} (${s.motivo}, ${s.tipo})`
        flussi.set(k, (flussi.get(k) ?? 0) + 1)
    }
    for (const [k, v] of flussi) console.log(`  ${k}: ${v}`)
    const serbatoio = await leggiSerbatoio(FENICE)
    const primi = daSerbatoio(serbatoio, 30)
    console.log(`\nScorta generale: ${serbatoio.length} lead nel serbatoio (più i ${piano.accantonati.length} di stasera).`)
    console.log(`Primi 30: ${primi.filter(l => l.ultimoMotivo === 'chat_interrotta' || l.motivoAccantonamento === 'stella_fuori_selezione').length} stelle, nati fra il ${primi.map(l => l.createdAt.toISOString().slice(0, 10)).sort()[0]} e il ${primi.map(l => l.createdAt.toISOString().slice(0, 10)).sort().at(-1)}.`)
    const gruppi = new Map<string, number>()
    for (const l of serbatoio) { const k = l.motivoAccantonamento ?? 'altro'; gruppi.set(k, (gruppi.get(k) ?? 0) + 1) }
    console.log('Serbatoio per motivo: ' + [...gruppi].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '))
    if (process.argv.includes('--elenco')) {
        for (const a of piano.accantonati) console.log(`  accantona ${a.leadId} da ${gdos.find(g => g.id === a.da)?.codice}`)
        for (const s of piano.riequilibrio.spostamenti) console.log(`  sposta ${s.leadId} ${gdos.find(g => g.id === s.da)?.codice} → ${gdos.find(g => g.id === s.a)?.codice} ${s.tipo} ${s.motivo}`)
    }
    console.log('\nNessuna scrittura.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
