// Account e lead di prova (migr. 0050, PO 25/10/2026). Regole pure: le
// condizioni per le query sono in ./sql.ts, i dati da creare in ./piano.ts,
// gli script in scripts/diretta/prova-setup.ts e prova-pulizia.ts.
//
// Le preview di Vercel usano il database di produzione: per provare il CRM
// senza sporcare niente di vero, un account di prova (users.isTest) lavora
// come un GDO o una Conferma veri ma vede e tocca soltanto i lead di prova
// (leads.isTest), e nessun account vero tocca un lead di prova. Così i numeri
// veri (KPI, squadra, cronaca, forzieri, bonus) non vedono mai la prova, e la
// prova non manda niente fuori (bot, ActiveCampaign, webhook marketing,
// Google Calendar dei venditori, notifiche ad altri).

export interface ConMarcatore {
    isTest?: boolean | null
}

/** La riga (account o lead) è di prova. */
export function diProva(x: ConMarcatore | null | undefined): boolean {
    return x?.isTest === true
}

/**
 * Un account può lavorare un lead solo se stanno dalla stessa parte: prova con
 * prova, vero con vero. Vale per chiunque, admin compresi: un lead di prova
 * esitato da un account vero finirebbe nei suoi numeri.
 */
export function stessoMondo(lead: ConMarcatore, account: ConMarcatore): boolean {
    return diProva(lead) === diProva(account)
}

/** Risposta delle azioni quando un account prova a lavorare un lead dell'altra parte. */
export function erroreMondoDiverso(account: ConMarcatore): string {
    return diProva(account)
        ? 'Con un account di prova si lavorano solo i lead di prova.'
        : 'Questo è un lead di prova: lo lavorano solo gli account di prova.'
}

/** Le righe senza il marcatore di prova: la pulizia si rifiuta di partire se ce n'è anche una. */
export function senzaMarcatore<T extends ConMarcatore>(righe: readonly T[]): T[] {
    return righe.filter(r => !diProva(r))
}
