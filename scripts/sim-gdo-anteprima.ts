/**
 * Prova a secco del giro SIM GDO (PO 14/11/2026): legge il foglio delle SIM e
 * il DB e stampa, per ogni riga, cosa il giro scriverebbe (tasso, colore).
 * NON scrive niente: né sul foglio né in appSettings.
 *
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/sim-gdo-anteprima.ts
 */
import { calcolaSimGdo } from '../src/lib/simGdo/run'

const pc = (v: number | null) => (v === null ? '' : `${(v * 100).toFixed(1).replace('.', ',')}%`)

async function main() {
    const e = await calcolaSimGdo({ scrivi: false })
    if (!e.ok) {
        console.error(`Foglio non leggibile: ${e.errore}`)
        process.exit(1)
    }
    console.log(`Media di squadra dal 1/6: ${pc(e.mediaTasso)} (${e.media.risposte}/${e.media.chiamate}), soglia rossa ${pc(e.soglia)}, colonna ${e.colonnaTasso}`)
    console.log(`Media Conferme dal 1/6: ${pc(e.mediaTassoConferme)} (${e.mediaConferme.risposte}/${e.mediaConferme.chiamate}), soglia rossa ${pc(e.sogliaConferme)}`)
    console.table(e.righe.map(r => ({
        riga: r.riga,
        interno: r.interno,
        foglio: r.nome,
        crm: r.utente
            ? `${r.utente.firstName ?? ''} (${r.utente.ruolo === 'CONFERME' ? 'Conferme' : r.utente.gdoCode ?? '?'})`
            : r.candidati.map(c => `${c.firstName} (${c.gdoCode})`).join(' / '),
        numero: r.numero,
        dataCambio: r.dataCambio,
        esito: r.esito,
        chiamate: r.chiamate,
        risposte: r.risposte,
        scriverei: pc(r.tasso),
        colore: r.colore ?? 'vuota',
        ripartito: r.ripartitoDal ?? '',
    })))
    if (!e.cambiati.length) console.log('Nessun azzeramento: nessuna DATA ULTIMO CAMBIO nuova rispetto allo stato salvato.')
    if (e.cambiati.length) console.log(`Cambi SIM segnati nel foglio (DATA ULTIMO CAMBIO nuova) che il giro registrerebbe, con azzeramento: ${e.cambiati.join(', ')}`)
    process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
