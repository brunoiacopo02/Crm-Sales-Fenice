import type { SheetContract } from './sheetRows';
import { monthKeyOf } from './sheetRows';

export type Family = 'esito-mancante' | 'lead-scartato' | 'lead-assente' | 'importo' | 'solo-crm';

export type CrmClosure = {
    leadId: string;
    phone: string | null;
    email: string | null;
    fullName: string;
    funnel: string | null;
    outcome: string | null;
    outcomeAt: Date | null;
    amountEur: number | null;
    attemptsAmountEur: number;
    /** Quante righe di `salesAttempts` esistono per questo lead nel mese.
     *  Serve a distinguere "nessun tentativo registrato" (normale per ogni
     *  chiusura precedente al 02/07/2026, quando la tabella non esisteva) da
     *  "tentativi registrati che non tornano" (l'unico caso da sanare). */
    attemptsCount: number;
    isRejected: boolean;
    salespersonAssigned: string | null;
};

export type DiffEntry = {
    key: string;
    family: Family;
    sheet: SheetContract | null;
    crm: CrmClosure | null;
    appliable: boolean;
    blockedReason: string | null;
    note: string | null;
    deltaEur: number;
};

export const ROUNDING_TOLERANCE_EUR = 2;

function indexCrm(crm: CrmClosure[]) {
    // Indice per phone+month e email+month: stessa persona in mesi diversi
    // è una vera re-firma, non deve essere collassata.
    // Le liste sono per forza: lo stesso numero può avere più lead nello stesso
    // mese (doppioni). Tenere solo l'ultimo letto rendeva l'esito dipendente
    // dall'ordine della query — a luglio agganciava un doppione "Sparito" e
    // lasciava la chiusura vera in solo-crm.
    const byPhoneMonth = new Map<string, CrmClosure[]>();
    const byEmailMonth = new Map<string, CrmClosure[]>();
    const push = (m: Map<string, CrmClosure[]>, k: string, c: CrmClosure) => {
        const list = m.get(k);
        if (list) list.push(c); else m.set(k, [c]);
    };
    for (const c of crm) {
        // outcomeAt nullo = niente mese = niente indice. Cadrà in solo-crm.
        if (!c.outcomeAt) continue;
        const month = monthKeyOf(c.outcomeAt);
        if (c.phone) push(byPhoneMonth, `${c.phone}|${month}`, c);
        if (c.email) push(byEmailMonth, `${c.email}|${month}`, c);
    }
    return { byPhoneMonth, byEmailMonth };
}

/**
 * Indice dei candidati: i lead che ESISTONO nel CRM ma non hanno un esito
 * venditore nel mese, quindi non compaiono fra le chiusure. Sono i lead
 * scartati dai GDO e quelli in appuntamento mai esitati — cioè esattamente i
 * contratti che il foglio ha e il CRM ha perso. Senza questo indice finivano in
 * `lead-assente` e l'applicazione avrebbe creato un doppione del lead esistente
 * (26 contratti per 54.498 EUR fra aprile e maggio, misurati il 31/08).
 * Qui NON si spacchetta per mese: un lead scartato non ha una data di esito con
 * cui confrontarsi, quindi vale per il mese del contratto.
 */
function indexCandidates(candidates: CrmClosure[]) {
    const byPhone = new Map<string, CrmClosure[]>();
    const byEmail = new Map<string, CrmClosure[]>();
    for (const c of candidates) {
        if (c.phone) byPhone.set(c.phone, [...(byPhone.get(c.phone) ?? []), c]);
        if (c.email) byEmail.set(c.email, [...(byEmail.get(c.email) ?? []), c]);
    }
    return { byPhone, byEmail };
}

/**
 * Fra più lead che combaciano, quello giusto è — in quest'ordine — la chiusura
 * con l'importo del foglio (è una quadratura, non una correzione), una chiusura
 * qualsiasi, poi il primo che capita. Mai un lead senza esito quando ne esiste
 * uno chiuso: sarebbe una seconda chiusura sullo stesso contratto.
 */
function pick(candidates: CrmClosure[] | undefined, amountEur: number): CrmClosure | null {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const chiusi = candidates.filter(c => c.outcome === 'Chiuso');
    if (chiusi.length > 0) {
        return chiusi.find(c => Math.abs((c.amountEur ?? 0) - amountEur) <= 0.01) ?? chiusi[0];
    }
    return candidates[0];
}

export function reconcile(sheet: SheetContract[], crm: CrmClosure[], candidates: CrmClosure[] = []): DiffEntry[] {
    const { byPhoneMonth, byEmailMonth } = indexCrm(crm);
    const { byPhone: candPhone, byEmail: candEmail } = indexCandidates(candidates);
    const matched = new Set<string>();
    const out: DiffEntry[] = [];

    for (const s of sheet) {
        // Telefono prima, mail come rete di sicurezza: nel CRM capita il numero
        // storpiato di una cifra, e senza la mail risulterebbe un contratto mancante.
        // Lookup con phone+month e email+month per rispettare l'aggregazione per mese.
        // Prima le chiusure del mese, poi i lead che esistono ma non hanno
        // esito: un contratto è orfano solo se non lo raccoglie nessuno dei due.
        const c = pick(s.phone ? byPhoneMonth.get(`${s.phone}|${s.monthKey}`) : undefined, s.amountEur)
            ?? pick(s.email ? byEmailMonth.get(`${s.email}|${s.monthKey}`) : undefined, s.amountEur)
            ?? pick(s.phone ? candPhone.get(s.phone) : undefined, s.amountEur)
            ?? pick(s.email ? candEmail.get(s.email) : undefined, s.amountEur);
        if (c) matched.add(c.leadId);

        const blockedReason = !s.salesCode
            ? `Venditore non mappato nel foglio: "${s.tutor}". Aggiungilo alla mappatura prima di applicare.`
            : (c && c.outcome === 'Chiuso' && c.attemptsCount > 0 && Math.abs(c.attemptsAmountEur - (c.amountEur ?? 0)) > 0.01
                ? `leads e salesAttempts non concordano (${c.amountEur} vs ${c.attemptsAmountEur}): va sanato prima.`
                : null);
        const appliable = blockedReason === null;

        if (!c) {
            out.push({ key: s.key, family: 'lead-assente', sheet: s, crm: null, appliable, blockedReason, note: null, deltaEur: s.amountEur });
            continue;
        }
        if (c.isRejected && c.outcome !== 'Chiuso') {
            out.push({ key: s.key, family: 'lead-scartato', sheet: s, crm: c, appliable, blockedReason, note: null, deltaEur: s.amountEur });
            continue;
        }
        if (c.outcome !== 'Chiuso') {
            out.push({ key: s.key, family: 'esito-mancante', sheet: s, crm: c, appliable, blockedReason, note: null, deltaEur: s.amountEur });
            continue;
        }
        const delta = s.amountEur - (c.amountEur ?? 0);
        if (Math.abs(delta) > 0.01) {
            out.push({
                key: s.key,
                family: 'importo',
                sheet: s,
                crm: c,
                appliable,
                blockedReason,
                note: Math.abs(delta) <= ROUNDING_TOLERANCE_EUR ? 'arrotondamento del foglio' : null,
                deltaEur: delta,
            });
            continue;
        }
        if (blockedReason) {
            out.push({ key: s.key, family: 'importo', sheet: s, crm: c, appliable: false, blockedReason, note: null, deltaEur: 0 });
        }
    }

    // Direzione inversa: chiuso nel CRM, assente dal foglio o in Stand-by.
    // Toglie fatturato, quindi non è mai spuntata di default (lo decide la UI).
    for (const c of crm) {
        if (matched.has(c.leadId)) continue;
        if (c.outcome !== 'Chiuso') continue;
        out.push({
            key: `crm:${c.leadId}`,
            family: 'solo-crm',
            sheet: null,
            crm: c,
            appliable: true,
            blockedReason: null,
            note: null,
            deltaEur: -(c.amountEur ?? 0),
        });
    }

    return out;
}
