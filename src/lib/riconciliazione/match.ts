import type { SheetContract } from './sheetRows';

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
    const byPhone = new Map<string, CrmClosure>();
    const byEmail = new Map<string, CrmClosure>();
    for (const c of crm) {
        if (c.phone) byPhone.set(c.phone, c);
        if (c.email) byEmail.set(c.email, c);
    }
    return { byPhone, byEmail };
}

export function reconcile(sheet: SheetContract[], crm: CrmClosure[]): DiffEntry[] {
    const { byPhone, byEmail } = indexCrm(crm);
    const matched = new Set<string>();
    const out: DiffEntry[] = [];

    for (const s of sheet) {
        // Telefono prima, mail come rete di sicurezza: nel CRM capita il numero
        // storpiato di una cifra, e senza la mail risulterebbe un contratto mancante.
        const c = (s.phone && byPhone.get(s.phone)) || (s.email && byEmail.get(s.email)) || null;
        if (c) matched.add(c.leadId);

        const blockedReason = !s.salesCode
            ? `Venditore non mappato nel foglio: "${s.tutor}". Aggiungilo alla mappatura prima di applicare.`
            : (c && c.outcome === 'Chiuso' && Math.abs(c.attemptsAmountEur - (c.amountEur ?? 0)) > 0.01
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
