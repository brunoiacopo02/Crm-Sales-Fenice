/**
 * Ricostruisce l'attribuzione interno → persona dei tabulati del centralino.
 *
 *   node --import tsx --env-file=.env scripts/rebuild-cdr-attribution.ts [--applica]
 *
 * PERCHE' ESISTE (2026-09-09)
 * `pbxExtensions` e' una mappatura interno → utente SENZA date di validita', e in
 * ufficio le postazioni si scambiano. `import-cdr.ts` scriveva `pbxCalls.userId`
 * leggendo quella tabella al momento dell'import, quindi ogni rotazione di
 * scrivania sporcava retroattivamente tutte le metriche per persona di
 * /monitor-pause. Verificato: la mappatura era sbagliata a tratti da aprile e
 * per tre postazioni ruotate dal 27/08.
 *
 * COME
 * La verita' non e' la tabella, sono i dati: vedi `src/lib/cdr/attribuzione.ts`.
 * Senza `--applica` e' un'anteprima: mostra copertura e cosa cambierebbe.
 *
 * Dal 14/09/2026 `import-cdr.ts` rilancia la stessa riattribuzione da solo alla
 * fine di ogni import: questo script serve per l'anteprima e per il primo
 * allineamento dello storico.
 */
import { db } from '../src/db'
import { riattribuisciChiamate, stampaRiattribuzione } from '../src/lib/cdr/attribuzione'

const APPLICA = process.argv.includes('--applica')

async function main() {
    console.log(APPLICA ? '>>> MODALITA\' SCRITTURA\n' : '>>> anteprima (usa --applica per scrivere)\n')
    const esito = await riattribuisciChiamate({ applica: APPLICA })
    stampaRiattribuzione(esito)
    if (!APPLICA) console.log('\nNiente scritto. Rilancia con --applica.')
    await close()
}

async function close() { await (db as any).$client?.end?.() }

main().catch(async (e) => { console.error(e); await close(); process.exit(1) })
