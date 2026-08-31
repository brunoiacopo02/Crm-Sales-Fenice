/**
 * Allineamento una tantum del solo mese di agosto 2026 col Database Clienti.
 *
 * Decisione del PO (31/08): i mesi precedenti NON si allineano, da settembre in
 * poi si usa il pulsante della pagina /riconciliazione. Questo script esiste per
 * fare il primo giro senza passare dal browser, e passa dallo STESSO corpo
 * dell'azione (`applicaCorrezioniCome`): nessuna regola di scrittura duplicata.
 * La run finisce in `riconciliazioneRuns` ed è annullabile dalla pagina.
 *
 *   node --import tsx --env-file=.env --env-file=.env.local scripts/allinea-agosto.ts [--applica]
 *
 * Senza `--applica` mostra soltanto cosa farebbe.
 */
import { confrontaMeseConValues, applicaCorrezioniCome } from '../src/lib/riconciliazione/engine';
import { fetchDatabaseClientiRows } from '../src/lib/riconciliazione/sheetsClient';

const MESE = '2026-08';
const ADMIN_ID = 'a9572fa1-1824-49b2-b523-ed68ec262702'; // admin@fenice.com

const eur = (n: number) => '€' + n.toLocaleString('it-IT', { maximumFractionDigits: 2 });

async function main() {
    const applica = process.argv.includes('--applica');

    const confronto = await confrontaMeseConValues(MESE, fetchDatabaseClientiRows);
    if (!confronto.success) {
        console.error('Confronto fallito:', confronto.error);
        process.exit(1);
    }

    console.log(`${MESE}: foglio ${confronto.sheetContracts} contratti ${eur(confronto.sheetTotalEur)} | CRM ${eur(confronto.crmTotalEur)}`);
    console.log(`Differenze trovate: ${confronto.entries.length}\n`);

    const daApplicare = confronto.entries.filter(e => e.appliable);
    const bloccate = confronto.entries.filter(e => !e.appliable);

    for (const e of confronto.entries) {
        const nome = e.sheet?.fullName ?? e.crm?.fullName ?? '?';
        console.log(`  [${e.family}] ${nome} — foglio ${e.sheet ? eur(e.sheet.amountEur) : '-'}, CRM ${e.crm ? eur(e.crm.amountEur ?? 0) : '-'}, delta ${eur(e.deltaEur)}`);
        if (!e.appliable) console.log(`      BLOCCATA: ${e.blockedReason}`);
    }

    const delta = daApplicare.reduce((s, e) => s + e.deltaEur, 0);
    console.log(`\nApplicabili: ${daApplicare.length} (effetto sul fatturato: ${eur(delta)})`);
    if (bloccate.length) console.log(`Bloccate: ${bloccate.length}`);

    if (!applica) {
        console.log('\nAnteprima soltanto. Rilancia con --applica per scrivere.');
        process.exit(0);
    }

    const esito = await applicaCorrezioniCome(ADMIN_ID, MESE, daApplicare.map(e => e.key));
    if (!esito.success) {
        console.error('\nApplicazione fallita:', esito.error);
        process.exit(1);
    }
    console.log(`\nApplicate ${esito.applied} correzioni. Run ${esito.runId} (annullabile da /riconciliazione).`);
    process.exit(0);
}

main().catch(e => { console.error('ERRORE:', e?.stack ?? e); process.exit(1); });
