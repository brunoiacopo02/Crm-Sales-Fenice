/**
 * Carico di lavoro delle Conferme nei prossimi due giorni lavorativi (PO 09/11/2026).
 *
 * Stesse regole della board Conferme (boardWindow.ts), applicate a un giorno
 * futuro invece che a oggi. Nel giorno lavorativo G le Conferme sentono:
 *
 * 1. le call di G (dalle 9 alle 21) ancora senza esito: la colonna "Oggi" di G,
 *    con le loro chiamate del giorno stesso;
 * 2. le call del giorno lavorativo dopo G che ricevono la 1ª chiamata il giorno
 *    prima (primaChiamataIlGiornoPrima): la colonna "Domani · 1ª chiamata" di G;
 * 3. i richiami delle Conferme che cadono in G: i parcheggiati (data da
 *    definire, `recallDate`) e i richiami a orario (`confSnoozeAt`) di lead che
 *    non sono già fra i punti 1 e 2.
 *
 * Giorni lavorativi: lunedì-sabato, la domenica no (nextWorkDayRome /
 * previousWorkDayRome): le call del lunedì prendono la 1ª chiamata il sabato.
 * Mattina = prima delle 15, pomeriggio = dalle 15 (POMERIGGIO_DALLE), sull'ora
 * della call; per i richiami sull'ora del richiamo.
 *
 * Pura: niente DB, `now` arriva da fuori. Tutto in ora di Roma.
 */
import { toRomeDateStr } from '../dateUtils';
import { DOMANI_ORE, OGGI_ORE, POMERIGGIO_DALLE, nextWorkDayRome, primaChiamataIlGiornoPrima } from './boardWindow';

export type EsitoConferme = 'confermato' | 'scartato' | 'da_fare';

export type LeadCarico = {
    id: string;
    funnel: string | null;
    appointmentDate: Date | null;
    appointmentCreatedAt: Date | null;
    appointmentMovedAt: Date | null;
    confirmationsOutcome: string | null;
    confNeedsReschedule: boolean;
    recallDate: Date | null;
    confSnoozeAt: Date | null;
    /** Nome del venditore assegnato, se c'è. */
    venditore: string | null;
    /** Chi delle Conferme ha messo l'esito (confirmationsUserId), se c'è. */
    conferme: string | null;
};

export type Fascia = 'mattina' | 'pomeriggio';

export type Conteggio = {
    totale: number;
    mattina: number;
    pomeriggio: number;
    confermati: number;
    scartati: number;
    daFare: number;
    /** Da fare, divisi per fascia. */
    daFareMattina: number;
    daFarePomeriggio: number;
};

export type RigaGruppo = Conteggio & { nome: string; bf: boolean };

export type GruppoLavoro = 'giorno_stesso' | 'prima_chiamata' | 'richiamo';

export type GiornoCarico = {
    /** 'YYYY-MM-DD' di Roma. */
    giorno: string;
    /** Il giorno lavorativo dopo, di cui oggi si fa la 1ª chiamata. */
    giornoDopo: string;
    /** (a) Le call del giorno, tutte le ore e tutti gli esiti. */
    call: Conteggio;
    /** Call del giorno prima delle 9 o dopo le 21: la board non le mostra. */
    callFuoriBoard: number;
    /** (b) Il lavoro delle Conferme in quella giornata. */
    lavoro: Record<GruppoLavoro, Conteggio>;
    /** Somma dei tre gruppi. */
    totaleLavoro: Conteggio;
    perFunnel: RigaGruppo[];
    perVenditore: RigaGruppo[];
    perConferme: RigaGruppo[];
    /** Le call del giorno ora per ora, dalle 9 alle 21 (PO 09/11/2026). */
    perOra: GrigliaOre;
};

/** Le call di un'ora: quante, con che esito, quante BF. */
export type ContaOra = { totale: number; confermati: number; scartati: number; daFare: number; bf: number };
export type RigaOra = ContaOra & { /** Ora di Roma, 9…21: la fascia 10:00 vuol dire dalle 10:00 alle 10:59. */ ora: number };
export type GrigliaOre = {
    /** Una riga per ogni ora piena dalle 9 alle 21, anche vuota. */
    ore: RigaOra[];
    /** Call prima delle 9 e dopo le 21: la board non le mostra, ma sono call del giorno. */
    primaDelle9: ContaOra;
    dopoLe21: ContaOra;
    /** Prima delle 15 (comprese quelle prima delle 9) e dalle 15 (comprese quelle dopo le 21). */
    mattina: ContaOra;
    pomeriggio: ContaOra;
    totale: ContaOra;
};

export type CaricoConferme = {
    calcolatoAlle: string;
    giorni: GiornoCarico[];
    /** Call di domenica nella finestra: nessuna giornata delle Conferme le copre. */
    callDomenica: number;
};

export const BF_FUNNEL = 'BLACK FRIDAY';
export const SENZA_FUNNEL = 'Senza funnel';
export const SENZA_VENDITORE = 'Nessun venditore';
export const NESSUNA_CONFERME = 'Nessuna (board comune)';

function romeHour(at: Date): number {
    return parseInt(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false }).format(at), 10) % 24;
}

export function fasciaDi(at: Date): Fascia {
    return romeHour(at) >= POMERIGGIO_DALLE ? 'pomeriggio' : 'mattina';
}

export function esitoDi(outcome: string | null): EsitoConferme {
    if (outcome === 'confermato') return 'confermato';
    if (outcome === 'scartato') return 'scartato';
    return 'da_fare';
}

export function vuoto(): Conteggio {
    return { totale: 0, mattina: 0, pomeriggio: 0, confermati: 0, scartati: 0, daFare: 0, daFareMattina: 0, daFarePomeriggio: 0 };
}

function aggiungi(c: Conteggio, fascia: Fascia, esito: EsitoConferme): void {
    c.totale++;
    c[fascia]++;
    if (esito === 'confermato') c.confermati++;
    else if (esito === 'scartato') c.scartati++;
    else {
        c.daFare++;
        if (fascia === 'mattina') c.daFareMattina++;
        else c.daFarePomeriggio++;
    }
}

function somma(cs: Conteggio[]): Conteggio {
    const out = vuoto();
    for (const c of cs) for (const k of Object.keys(out) as (keyof Conteggio)[]) out[k] += c[k];
    return out;
}

/** Le ore piene della griglia: le stesse della board, dalle 9 alle 21. */
export const ORE_GRIGLIA: readonly number[] = OGGI_ORE;

export function vuotoOra(): ContaOra {
    return { totale: 0, confermati: 0, scartati: 0, daFare: 0, bf: 0 };
}

function aggiungiOra(c: ContaOra, esito: EsitoConferme, bf: boolean): void {
    c.totale++;
    if (esito === 'confermato') c.confermati++;
    else if (esito === 'scartato') c.scartati++;
    else c.daFare++;
    if (bf) c.bf++;
}

/**
 * Le call di `giorno` ora per ora: stesse call di `caricoDelGiorno().call`
 * (APPOINTMENT con la data della call quel giorno, parcheggiati esclusi), messe
 * nell'ora piena di Roma in cui cadono. Le ore vuote restano, con zero.
 */
export function grigliaOre(rows: LeadCarico[], giorno: string): GrigliaOre {
    const ore: RigaOra[] = ORE_GRIGLIA.map(ora => ({ ora, ...vuotoOra() }));
    const out: GrigliaOre = { ore, primaDelle9: vuotoOra(), dopoLe21: vuotoOra(), mattina: vuotoOra(), pomeriggio: vuotoOra(), totale: vuotoOra() };
    const prima = ORE_GRIGLIA[0];
    const ultima = ORE_GRIGLIA[ORE_GRIGLIA.length - 1];
    for (const l of rows) {
        if (!l.appointmentDate || l.confNeedsReschedule) continue;
        const appt = new Date(l.appointmentDate);
        if (toRomeDateStr(appt) !== giorno) continue;
        const ora = romeHour(appt);
        const esito = esitoDi(l.confirmationsOutcome);
        const bf = chiaveFunnel(l.funnel).bf;
        const riga = ora < prima ? out.primaDelle9 : ora > ultima ? out.dopoLe21 : ore[ora - prima];
        aggiungiOra(riga, esito, bf);
        aggiungiOra(ora >= POMERIGGIO_DALLE ? out.pomeriggio : out.mattina, esito, bf);
        aggiungiOra(out.totale, esito, bf);
    }
    return out;
}

const isDomenica = (giorno: string) => new Date(`${giorno}T12:00:00Z`).getUTCDay() === 0;

/** Una voce del lavoro di un giorno: quale lead, in che fascia, con che esito. */
type Voce = { lead: LeadCarico; gruppo: GruppoLavoro; fascia: Fascia; esito: EsitoConferme };

/**
 * Le voci del lavoro delle Conferme nel giorno lavorativo `giorno`. I gruppi 1 e
 * 2 tengono anche le call già confermate o scartate (per dire quante ne restano
 * da fare); i richiami sono per definizione senza esito.
 */
export function vociDelGiorno(rows: LeadCarico[], giorno: string): Voce[] {
    const giornoDopo = nextWorkDayRome(new Date(`${giorno}T12:00:00Z`));
    const voci: Voce[] = [];
    const presi = new Set<string>();
    for (const l of rows) {
        if (!l.appointmentDate || l.confNeedsReschedule) continue;
        const appt = new Date(l.appointmentDate);
        const g = toRomeDateStr(appt);
        const ora = romeHour(appt);
        if (g === giorno && OGGI_ORE.includes(ora)) {
            voci.push({ lead: l, gruppo: 'giorno_stesso', fascia: fasciaDi(appt), esito: esitoDi(l.confirmationsOutcome) });
            presi.add(l.id);
        } else if (g === giornoDopo && DOMANI_ORE.includes(ora)
            && primaChiamataIlGiornoPrima(appt, [l.appointmentCreatedAt, l.appointmentMovedAt])) {
            voci.push({ lead: l, gruppo: 'prima_chiamata', fascia: fasciaDi(appt), esito: esitoDi(l.confirmationsOutcome) });
            presi.add(l.id);
        }
    }
    for (const l of rows) {
        if (l.confirmationsOutcome !== null || presi.has(l.id)) continue;
        const quando = l.confNeedsReschedule ? l.recallDate : l.confSnoozeAt;
        if (!quando) continue;
        const at = new Date(quando);
        if (toRomeDateStr(at) !== giorno) continue;
        voci.push({ lead: l, gruppo: 'richiamo', fascia: fasciaDi(at), esito: 'da_fare' });
        presi.add(l.id);
    }
    return voci;
}

function perChiave(voci: Voce[], chiave: (l: LeadCarico) => { id: string; nome: string; bf: boolean }): RigaGruppo[] {
    const mappa = new Map<string, RigaGruppo>();
    for (const v of voci) {
        const k = chiave(v.lead);
        let r = mappa.get(k.id);
        if (!r) {
            r = { ...vuoto(), nome: k.nome, bf: k.bf };
            mappa.set(k.id, r);
        }
        aggiungi(r, v.fascia, v.esito);
    }
    return [...mappa.values()].sort((a, b) => b.totale - a.totale || a.nome.localeCompare(b.nome, 'it'));
}

export function chiaveFunnel(funnel: string | null): { id: string; nome: string; bf: boolean } {
    const nome = funnel?.trim() || SENZA_FUNNEL;
    const id = nome.toUpperCase();
    return { id, nome, bf: id === BF_FUNNEL };
}

export function caricoDelGiorno(rows: LeadCarico[], giorno: string): GiornoCarico {
    const giornoDopo = nextWorkDayRome(new Date(`${giorno}T12:00:00Z`));
    const call = vuoto();
    let callFuoriBoard = 0;
    for (const l of rows) {
        if (!l.appointmentDate || l.confNeedsReschedule) continue;
        const appt = new Date(l.appointmentDate);
        if (toRomeDateStr(appt) !== giorno) continue;
        aggiungi(call, fasciaDi(appt), esitoDi(l.confirmationsOutcome));
        if (!OGGI_ORE.includes(romeHour(appt))) callFuoriBoard++;
    }
    const voci = vociDelGiorno(rows, giorno);
    const lavoro: Record<GruppoLavoro, Conteggio> = { giorno_stesso: vuoto(), prima_chiamata: vuoto(), richiamo: vuoto() };
    for (const v of voci) aggiungi(lavoro[v.gruppo], v.fascia, v.esito);
    return {
        giorno,
        giornoDopo,
        call,
        callFuoriBoard,
        lavoro,
        totaleLavoro: somma(Object.values(lavoro)),
        perFunnel: perChiave(voci, l => chiaveFunnel(l.funnel)),
        perVenditore: perChiave(voci, l => {
            const nome = l.venditore?.trim() || SENZA_VENDITORE;
            return { id: nome, nome, bf: false };
        }),
        perConferme: perChiave(voci, l => {
            const nome = l.conferme?.trim() || NESSUNA_CONFERME;
            return { id: nome, nome, bf: false };
        }),
        perOra: grigliaOre(rows, giorno),
    };
}

/** I due prossimi giorni lavorativi dopo `now`: domani e dopodomani, saltando la domenica. */
export function prossimiGiorniLavorativi(now: Date, quanti = 2): string[] {
    const out: string[] = [];
    let d = now;
    for (let i = 0; i < quanti; i++) {
        const g = nextWorkDayRome(d);
        out.push(g);
        d = new Date(`${g}T12:00:00Z`);
    }
    return out;
}

/** Dal giorno dopo `now` alla fine del giorno lavorativo dopo l'ultimo mostrato: l'intervallo da leggere. */
export function finestraDaLeggere(now: Date, quanti = 2): { dal: string; al: string } {
    const giorni = prossimiGiorniLavorativi(now, quanti + 1);
    const domaniDiCalendario = toRomeDateStr(new Date(new Date(`${toRomeDateStr(now)}T12:00:00Z`).getTime() + 86_400_000));
    return { dal: domaniDiCalendario, al: giorni[giorni.length - 1] };
}

export function calcolaCarico(rows: LeadCarico[], now: Date, quanti = 2): CaricoConferme {
    const giorni = prossimiGiorniLavorativi(now, quanti);
    const ultimo = giorni[giorni.length - 1];
    const oggi = toRomeDateStr(now);
    let callDomenica = 0;
    for (const l of rows) {
        if (!l.appointmentDate || l.confNeedsReschedule) continue;
        const g = toRomeDateStr(new Date(l.appointmentDate));
        if (g > oggi && g <= ultimo && isDomenica(g)) callDomenica++;
    }
    return {
        calcolatoAlle: now.toISOString(),
        giorni: giorni.map(g => caricoDelGiorno(rows, g)),
        callDomenica,
    };
}
