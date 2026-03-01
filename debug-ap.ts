import Database from 'better-sqlite3';

const sqliteDb = new Database('dev.db', { readonly: true });
const tableDef = { name: 'appointmentPresence' };
const rows = sqliteDb.prepare(`SELECT * FROM ${tableDef.name}`).all();
const mappedRows = rows.map((row: any) => {
    const newRow: any = { ...row };
    for (const key in newRow) {
        if (typeof newRow[key] === 'number' && (key === 'isActive' || key === 'overrideFlag')) {
            newRow[key] = newRow[key] === 1;
        }
        if (typeof newRow[key] === 'number' && (
            key.includes('At') || key.includes('Date') || key.includes('Time') || key.includes('timestamp') || key.includes('deadline') || key.includes('tokenExpiry')
        ) &&
            !key.includes('Count') && !key.includes('Target') && !key.includes('Amount') && !key.includes('Index') && !key.includes('Seconds')
        ) {
            const val = newRow[key] < 10000000000 ? newRow[key] * 1000 : newRow[key];
            newRow[key] = new Date(val);
        }
        if (typeof newRow[key] === 'string' && (key === 'metadata' || key === 'settings' || key === 'perGdoAssigned')) {
            try {
                newRow[key] = JSON.parse(newRow[key]);
            } catch (e) { }
        }
    }
    return newRow;
});

console.log(mappedRows[0]);
console.log(mappedRows[0].startedAt instanceof Date);
console.log(mappedRows[0].startedAt.toISOString());
