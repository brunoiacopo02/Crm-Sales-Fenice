/**
 * Parser CSV minimo ma corretto sui casi che il foglio produce davvero:
 * virgole dentro i nomi ("Rossi, Mario"), virgolette raddoppiate e CRLF.
 * Niente dipendenze: il formato è fisso e lo controlliamo noi.
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else quoted = false;
            } else field += ch;
            continue;
        }

        if (ch === '"') { quoted = true; continue; }
        if (ch === ',') { row.push(field); field = ''; continue; }
        if (ch === '\r') continue;
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        field += ch;
    }

    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    // Google chiude l'export con un a capo: l'ultima riga vuota non è un record.
    return rows.filter(r => r.some(c => c !== ''));
}
