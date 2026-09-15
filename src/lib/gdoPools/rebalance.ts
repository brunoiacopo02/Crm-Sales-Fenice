/**
 * Ribilanciamento serale dei pool GDO (PO 2026-09-15).
 *
 * Dal 15/09 i GDO sono divisi in due pool: chi lavora i lead FRESCHI dal
 * webhook AC (`users.acAutoIntake`) e chi lavora i RIDATI dal bot
 * (`users.botReturnIntake`). La separazione però vale solo nel momento in cui
 * il lead viene assegnato: un lead ridato dal bot può finire in mano al pool
 * freschi per mille strade successive (uno spostamento manuale da /gestione,
 * un account spento e svuotato addosso a un collega, un lead entrato prima che
 * i due pool esistessero). Da lì nessuno lo riporta indietro, e il GDO dei
 * freschi si ritrova esattamente la pipeline di scarti che la divisione doveva
 * evitargli.
 *
 * Questo modulo decide COSA spostare e A CHI. È puro — niente DB, niente rete —
 * perché è la parte che si può sbagliare in silenzio: una distribuzione storta
 * non fa rumore, si vede un mese dopo nella pipeline di qualcuno. Chi legge il
 * database e scrive è il cron in src/app/api/cron/rebalance-gdo/route.ts.
 */

/** Un GDO come lo vede il ribilanciamento. I due pool sono indipendenti: si può stare in entrambi. */
export interface GdoPoolState {
    id: string;
    /** `users.isActive`. Un account spento non riceve mai nulla. */
    isActive: boolean;
    /** pool FRESCHI (`users.acAutoIntake`). */
    freschi: boolean;
    /** pool RIDATI (`users.botReturnIntake`). */
    ridati: boolean;
    /**
     * Lead mai chiamati già in carico. È la coda di prima chiamata, cioè la
     * mole di lavoro vera: due GDO con lo stesso numero di lead aperti possono
     * avere carichi opposti se uno li ha già chiamati tutti una volta.
     */
    maiChiamati: number;
}

/** Un lead candidato allo spostamento, con addosso tutto ciò che serve per dirgli di no. */
export interface LeadRibilanciabile {
    id: string;
    assignedToId: string | null;
    /** Ha un evento REASSIGNED_FROM_BOT, oppure un `intakeBatch` valorizzato. */
    ridatoDalBot: boolean;
    status: string;
    appointmentDate: Date | string | null;
    presentedAt: Date | string | null;
}

export interface Spostamento {
    leadId: string;
    /** id del GDO che lo aveva in carico. */
    da: string;
    /** id del GDO del pool ridati che lo prende. */
    a: string;
}

/** Perché il piano è vuoto: "zero spostati", da solo, non dice se è andata bene o male. */
export type MotivoFermo = 'nessun_gdo_ridati_attivo' | 'niente_da_spostare';

export interface PianoRibilanciamento {
    spostamenti: Spostamento[];
    /** null quando qualcosa si è mosso. */
    motivo: MotivoFermo | null;
    /** Quanti lead riceve ciascun destinatario, per il riepilogo del cron. */
    perDestinatario: Record<string, number>;
    /** Carico di mai-chiamati previsto a fine giro, destinatario per destinatario. */
    caricoFinale: Record<string, number>;
}

/** Gli unici stati che si spostano: un lead chiuso o scartato non torna in circolo. */
const STATI_APERTI: ReadonlySet<string> = new Set(['NEW', 'IN_PROGRESS']);

/**
 * Un lead con appuntamento fissato o con una presenza registrata non si tocca
 * MAI, nemmeno se è ridato dal bot e nemmeno se il suo stato è ancora aperto.
 * Spostarlo riscriverebbe a chi è attribuito quell'appuntamento — cioè i KPI e
 * i bonus di una persona — a posteriori e di notte.
 *
 * La stessa guardia sta anche nella query SQL del cron: qui è ripetuta di
 * proposito, perché è il punto testabile. Una `where` si può sbagliare
 * riscrivendola e non se ne accorge nessuno; un test che fallisce si vede.
 */
function bloccato(lead: LeadRibilanciabile): boolean {
    return lead.status === 'APPOINTMENT'
        || lead.appointmentDate != null
        || lead.presentedAt != null;
}

/**
 * Chi può ricevere: pool ridati, acceso.
 *
 * Chi sta in ENTRAMBI i pool non è un errore da correggere — è un GDO che per
 * scelta del manager lavora sia freschi sia ridati — quindi riceve come gli
 * altri, e (vedi `sorgenti`) non gli si porta via nulla.
 */
function destinatari(gdos: readonly GdoPoolState[]): GdoPoolState[] {
    return gdos
        .filter((g) => g.ridati && g.isActive)
        .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Chi deve cedere: pool freschi e NON pool ridati.
 *
 * `isActive` non è tra le condizioni di proposito: un account spento che ha
 * ancora lead ridati addosso è il caso peggiore di tutti — non li chiama
 * nessuno — quindi se capita di trovarlo va svuotato, non protetto.
 */
function sorgenti(gdos: readonly GdoPoolState[]): Set<string> {
    return new Set(gdos.filter((g) => g.freschi && !g.ridati).map((g) => g.id));
}

/** Gli id dei GDO da cui il cron va a pescare i lead: stessa regola di `sorgenti`, esposta alla query. */
export function idSorgenti(gdos: readonly GdoPoolState[]): string[] {
    return [...sorgenti(gdos)].sort((a, b) => a.localeCompare(b));
}

/**
 * Decide quali lead spostare e a chi.
 *
 * La distribuzione è a pareggio: ogni lead va al destinatario col carico più
 * basso in quel momento, contando anche quelli che gli sono appena stati
 * assegnati in questo stesso giro. Non è un round-robin — dare a turno a chi ha
 * 10 e a chi ne ha 300 lascerebbe la differenza dov'era; qui prima si riempie
 * il più scarico, e solo quando ha raggiunto il secondo si riprende ad
 * alternare. A parità di carico decide l'id, così il piano è riproducibile e un
 * test può asserirlo invece di accontentarsi dei totali.
 */
export function pianificaRibilanciamento(args: {
    gdos: readonly GdoPoolState[];
    lead: readonly LeadRibilanciabile[];
}): PianoRibilanciamento {
    const dest = destinatari(args.gdos);
    const perDestinatario: Record<string, number> = {};
    const caricoFinale: Record<string, number> = {};

    // Nessun destinatario: meglio fermi in mano a qualcuno che orfani in mano a
    // nessuno. Si esce PRIMA di guardare i lead perché questo è un guasto di
    // configurazione (pool ridati vuoto, o tutto spento) e va detto anche nella
    // sera in cui per caso non c'era niente da spostare.
    if (dest.length === 0) {
        return { spostamenti: [], motivo: 'nessun_gdo_ridati_attivo', perDestinatario, caricoFinale };
    }

    for (const g of dest) {
        perDestinatario[g.id] = 0;
        caricoFinale[g.id] = g.maiChiamati;
    }

    const daCedere = sorgenti(args.gdos);
    const spostabili = args.lead
        .filter((l) =>
            l.ridatoDalBot
            && l.assignedToId !== null
            && daCedere.has(l.assignedToId)
            && STATI_APERTI.has(l.status)
            && !bloccato(l))
        .sort((a, b) => a.id.localeCompare(b.id));

    if (spostabili.length === 0) {
        return { spostamenti: [], motivo: 'niente_da_spostare', perDestinatario, caricoFinale };
    }

    const spostamenti: Spostamento[] = [];
    for (const lead of spostabili) {
        let scelto = dest[0];
        for (const g of dest) {
            if (caricoFinale[g.id] < caricoFinale[scelto.id]) scelto = g;
        }
        // `assignedToId` è già stato filtrato sopra: qui non può essere null.
        spostamenti.push({ leadId: lead.id, da: lead.assignedToId as string, a: scelto.id });
        perDestinatario[scelto.id] += 1;
        caricoFinale[scelto.id] += 1;
    }

    return { spostamenti, motivo: null, perDestinatario, caricoFinale };
}

// ------------------------------------------------------------------- orario

/**
 * Siamo nell'ora delle 20 di Roma?
 *
 * Vercel Cron ragiona in UTC e non sa nulla dell'ora legale: "20:30 ora di
 * Roma" a settembre è 18:30 UTC, ma dall'ultima domenica di ottobre diventa
 * 19:30 UTC, e una sola riga in vercel.json sarebbe giusta per metà anno.
 * Perciò il cron è schedulato a ENTRAMBE le ore e questa guardia lascia
 * lavorare solo l'invocazione che a Roma cade davvero alle 20:xx: un giro al
 * giorno, tutto l'anno, senza dover toccare niente a fine ottobre.
 *
 * Il confronto è sull'ORA e non sul minuto esatto perché Vercel non promette la
 * puntualità al minuto: un cron può partire in ritardo, e non deve perdere il
 * giro per questo.
 */
export function eOraDelGiro(now: Date): boolean {
    const ora = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23',
    }).format(now);
    return Number(ora) === 20;
}
