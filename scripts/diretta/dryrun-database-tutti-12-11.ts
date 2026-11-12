/**
 * Giovedi' 12/11/2026 (PO: "dobbiamo scrivere a tutti... prova l'apertura quella del bf").
 * PROVA A SECCO, SOLA LETTURA: nessuna scrittura, nessun push al bot, nessun WhatsApp.
 *
 * Passa le righe della coda marketing degli ultimi giorni (anche quelle SENZA il segno
 * `"database": true`: oggi non ce l'ha nessuna) per la regola vera del giro
 * (`leggiCodaDatabase` + `ingressoAllargato`, la stessa funzione che usa il cron) e dice
 * per ciascuna: entra o no, perche', e se la scheda passerebbe all'account bot.
 *
 * Questa e' la meta' CRM. La meta' bot (chat viva, opt-out, apertura BF gia' ricevuta,
 * numero da cui partirebbe) la fa, sul file scritto da qui, lo script del repo del bot:
 *   scripts/dryrun-database-tutti-12-11.ts
 *
 *   node --import tsx --env-file=.env.production.local scripts/diretta/dryrun-database-tutti-12-11.ts
 *        [--giorni-fermo=7] [--giorni-coda=1] [--out=percorso.json]
 */
import { writeFileSync } from 'node:fs'
import { accountBotFenice, leggiCodaDatabase } from '@/lib/marketingQueue/databaseAlBot'
import { GIORNI_FERMO_DEFAULT, type ConfigDatabaseAlBot } from '@/lib/marketingQueue/database'

/** Fuori per decisione del PO (12/11/2026): il contatto "Josh" del 2024. Non va segnato `database: true`. */
const RIGHE_ESCLUSE_DAL_PO: Record<string, string> = { '50499a08': 'escluso_dal_po_josh_2024' }

function arg(nome: string): string | undefined {
    return process.argv.find((a) => a.startsWith(`--${nome}=`))?.split('=').slice(1).join('=')
}

async function main() {
    const config: ConfigDatabaseAlBot = {
        attivo: true, // solo per leggere: qui non si spinge niente
        scaglione: 50,
        giorniCoda: Number(arg('giorni-coda') ?? 1),
        allargato: true,
        giorniFermo: Number(arg('giorni-fermo') ?? process.env.MKT_DATABASE_GIORNI_FERMO ?? GIORNI_FERMO_DEFAULT),
    }
    const bot = await accountBotFenice()
    if (!bot) throw new Error('account bot non trovato')

    const lista = await leggiCodaDatabase(config, bot, { ancheSenzaSegno: true })
    const righe = lista.map((r) => {
        const escluso = Object.entries(RIGHE_ESCLUSE_DAL_PO).find(([k]) => r.rigaCodaId.startsWith(k))?.[1]
        const entra = !escluso && 'regola' in r.esito
        return {
            rigaCodaId: r.rigaCodaId,
            leadId: r.id,
            nome: r.name,
            telefono: r.phone,
            email: r.email,
            funnel: r.funnel,
            coda: String(r.queueDate),
            stato: r.status,
            scarto: r.discardReason,
            diUnaPersona: Boolean(r.assegnatoAPersona),
            ultimoContatto: r.ultimoContatto ? String(r.ultimoContatto).slice(0, 10) : null,
            entra,
            regola: 'regola' in r.esito ? r.esito.regola : null,
            sposta: 'regola' in r.esito ? r.esito.sposta : null,
            motivo: escluso ?? ('motivo' in r.esito ? r.esito.motivo : null),
        }
    })

    const conta = (chiavi: string[]) => chiavi.reduce<Record<string, number>>((m, k) => { m[k] = (m[k] ?? 0) + 1; return m }, {})
    console.log(`Coda marketing ultimi ${config.giorniCoda + 1} giorni: ${righe.length} persone (giorni_fermo=${config.giorniFermo})`)
    console.log('ENTRANO per il CRM:', righe.filter((r) => r.entra).length, conta(righe.filter((r) => r.entra).map((r) => `${r.regola}${r.sposta ? '' : ' (scheda non spostata)'}`)))
    console.log('FUORI per il CRM:', righe.filter((r) => !r.entra).length, conta(righe.filter((r) => !r.entra).map((r) => String(r.motivo))))
    console.log('')
    for (const r of righe) {
        console.log([
            r.rigaCodaId.slice(0, 8), r.leadId.slice(0, 8), (r.nome ?? '').slice(0, 26).padEnd(26), r.stato.padEnd(11),
            r.entra ? `ENTRA ${r.regola}${r.sposta ? '' : ' (scheda NON spostata)'}` : `FUORI ${r.motivo}`,
            r.scarto ? `· scarto: ${r.scarto.slice(0, 40)}` : '', r.ultimoContatto ? `· ultimo contatto ${r.ultimoContatto}` : '',
        ].join('  '))
    }

    const out = arg('out')
    if (out) {
        writeFileSync(out, JSON.stringify({ creato: new Date().toISOString(), giorniFermo: config.giorniFermo, righe }, null, 2), 'utf8')
        console.log(`\nScritto ${out}`)
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
