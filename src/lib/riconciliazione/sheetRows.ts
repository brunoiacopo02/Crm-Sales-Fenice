import { normalizePhoneStrict } from '@/lib/phoneNormalize';

/**
 * Il tab "Database Clienti" è un IMPORTRANGE: se il collegamento si rompe le
 * celle diventano #REF! e il foglio SEMBRA VUOTO. Interpretare quel vuoto come
 * "il CRM ha contratti di troppo" porterebbe a proporre la cancellazione di un
 * mese intero di fatturato. Da qui in poi, vuoto = errore, mai dato.
 */
export class SheetUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SheetUnavailableError';
    }
}

export type SheetContract = {
    key: string;
    phone: string | null;
    email: string | null;
    fullName: string;
    signedAt: Date;
    monthKey: string;
    amountEur: number;
    paymentStatuses: string[];
    tutor: string;
    salesCode: string | null;
    sourceRows: number[];
};

const EXCLUDED_STATUS = 'stand-by';

// La colonna TUTOR contiene NOMI, non codici. Mappatura confermata dal PO il 2026-08-29.
const TUTOR_TO_SALES: Record<string, string> = {
    'bruno b.': 'Sales 001',
    'marco l.': 'Sales 002',
    'mattia g.': 'Sales 003',
    'paolo s.': 'Sales 004',
    'giacomo o.': 'Sales 008',
    'stefania c.': 'Sales 010',
};

export function parseAmount(raw: string | undefined | null): number {
    if (!raw) return 0;
    const cleaned = String(raw)
        .replace(/[^\d,.-]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
}

export function parseSheetDate(raw: string | undefined | null): Date | null {
    if (!raw) return null;
    const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const [, d, mo, y] = m;
    // Mezzogiorno UTC: la data del contratto è un giorno di calendario, non un
    // istante. Mezzanotte scivolerebbe di giorno con il fuso italiano.
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0));
    if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
    return date;
}

export function tutorToSalesCode(tutor: string | undefined | null): string | null {
    if (!tutor) return null;
    return TUTOR_TO_SALES[tutor.trim().toLowerCase()] ?? null;
}

export function monthKeyOf(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function parseSheetRows(values: string[][], monthKey: string): SheetContract[] {
    const dataRows = values.slice(1);
    if (dataRows.length === 0) {
        throw new SheetUnavailableError('Il foglio non contiene righe: collegamento IMPORTRANGE rotto o range sbagliato.');
    }
    if (values.some(r => r.some(cell => typeof cell === 'string' && cell.includes('#REF!')))) {
        throw new SheetUnavailableError('Il foglio contiene #REF!: il collegamento IMPORTRANGE è rotto.');
    }

    const byKey = new Map<string, SheetContract>();

    dataRows.forEach((r, i) => {
        const rowNumber = i + 2; // 1-based, header incluso
        const status = (r[6] ?? '').trim();
        if (status.toLowerCase() === EXCLUDED_STATUS) return;

        const signedAt = parseSheetDate(r[5]);
        if (!signedAt) return;
        if (monthKeyOf(signedAt) !== monthKey) return;

        const phone = normalizePhoneStrict(r[2] ?? null);
        const email = (r[1] ?? '').trim().toLowerCase() || null;
        const key = `${phone ?? email ?? `riga:${rowNumber}`}|${monthKey}`;

        const existing = byKey.get(key);
        if (existing) {
            // Un contratto spezzato su più righe dello stesso mese è UN contratto.
            existing.amountEur += parseAmount(r[7]);
            existing.sourceRows.push(rowNumber);
            if (status && !existing.paymentStatuses.includes(status)) existing.paymentStatuses.push(status);
            return;
        }

        const tutor = (r[10] ?? '').trim();
        byKey.set(key, {
            key,
            phone,
            email,
            fullName: `${(r[3] ?? '').trim()} ${(r[4] ?? '').trim()}`.trim(),
            signedAt,
            monthKey,
            amountEur: parseAmount(r[7]),
            paymentStatuses: status ? [status] : [],
            tutor,
            salesCode: tutorToSalesCode(tutor),
            sourceRows: [rowNumber],
        });
    });

    return [...byKey.values()];
}
