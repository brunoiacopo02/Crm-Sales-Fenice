import Database from 'better-sqlite3';
const sqliteDb = new Database('dev.db', { readonly: true });
const rows = sqliteDb.prepare(`SELECT * FROM appointmentPresence`).all();
console.log(rows.slice(0, 2));
