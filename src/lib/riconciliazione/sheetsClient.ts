import { google } from 'googleapis';
import { SheetUnavailableError } from './sheetRows';

export const DATABASE_CLIENTI_SPREADSHEET_ID = '1viEdIATN2bcJg9JW4OTzcM51d45j4ROCrtF7wgdEg5k';
export const DATABASE_CLIENTI_RANGE = 'Database Clienti!A:K';

/**
 * La chiave privata del service account può arrivare in due forme a seconda di
 * come è stata scritta l'env: con a capo reali (come su Vercel oggi) oppure con
 * '\n' letterali. Il replace è innocuo sulla prima e indispensabile sulla seconda.
 */
function privateKey(): string {
    const raw = process.env.GOOGLE_SHEETS_SA_PRIVATE_KEY;
    if (!raw) throw new SheetUnavailableError('GOOGLE_SHEETS_SA_PRIVATE_KEY non configurata.');
    return raw.replace(/\\n/g, '\n');
}

export async function fetchDatabaseClientiRows(): Promise<string[][]> {
    const email = process.env.GOOGLE_SHEETS_SA_EMAIL;
    if (!email) throw new SheetUnavailableError('GOOGLE_SHEETS_SA_EMAIL non configurata.');

    const auth = new google.auth.JWT({
        email,
        key: privateKey(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    try {
        const res = await google.sheets({ version: 'v4', auth }).spreadsheets.values.get({
            spreadsheetId: DATABASE_CLIENTI_SPREADSHEET_ID,
            range: DATABASE_CLIENTI_RANGE,
        });
        return (res.data.values ?? []) as string[][];
    } catch (e: any) {
        const code = e?.code ?? e?.response?.status;
        if (code === 403) {
            throw new SheetUnavailableError('Il service account non ha più accesso al foglio: ricondividilo come Visualizzatore.');
        }
        throw new SheetUnavailableError(`Lettura del foglio fallita (${code ?? 'errore ignoto'}).`);
    }
}
