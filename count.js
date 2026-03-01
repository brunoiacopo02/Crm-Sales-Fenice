const Database = require('better-sqlite3');
const db = new Database('dev.db', { readonly: true });

const tables = [
    'users', 'leads', 'callLogs', 'leadEvents', 'breakSessions', 'notifications',
    'importLogs', 'sprints', 'shopItems', 'userPurchases', 'coinTransactions',
    'confirmationsNotes', 'appointmentPresence', 'calendarConnections', 'calendarEvents', 'teamGoals'
];

for (const table of tables) {
    try {
        const row = db.prepare(`SELECT count(*) as c FROM ${table}`).get();
        console.log(`${table}: ${row.c}`);
    } catch (e) {
        console.log(`${table}: Error or not exists`);
    }
}
