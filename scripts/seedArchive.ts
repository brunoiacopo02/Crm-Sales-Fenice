import { db } from "../src/db";
import { leads, users } from "../src/db/schema";
import { subDays } from "date-fns";

const firstNames = ["Marco", "Luca", "Giulia", "Sofia", "Ale", "Andrea", "Marta", "Chiara", "Leo", "Giacomo"];
const lastNames = ["Rossi", "Bianchi", "Verdi", "Russo", "Ferrari", "Esposito", "Romano", "Gallo", "Costa"];

async function main() {
    console.log("Seeding Archive Data...");
    
    // Get users
    const allUsers = await db.select().from(users);
    const gdos = allUsers.filter(u => u.role === 'GDO');
    const sales = allUsers.filter(u => u.role === 'VENDITORE');
    const confs = allUsers.filter(u => u.role === 'CONFERME');

    if (gdos.length === 0 || sales.length === 0 || confs.length === 0) {
        console.log("Missing users of roles GDO, VENDITORE, or CONFERME. Ensure DB has these roles.");
        process.exit(1);
    }

    const newLeads = [];
    
    // Generate 40 leads over the last 90 days
    for (let i = 0; i < 40; i++) {
        const daysAgo = Math.floor(Math.random() * 90);
        const createdDate = subDays(new Date(), daysAgo);
        const apptDate = subDays(new Date(), daysAgo - Math.floor(Math.random() * 5));
        
        const gdo = gdos[Math.floor(Math.random() * gdos.length)];
        const salesperson = sales[Math.floor(Math.random() * sales.length)];
        const confUser = confs[Math.floor(Math.random() * confs.length)];
        
        const isConfirmed = Math.random() > 0.3;
        const isClosed = isConfirmed && Math.random() > 0.5;
        
        const name = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;

        newLeads.push({
            id: crypto.randomUUID(),
            name: name,
            email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
            phone: "+393" + Math.floor(100000000 + Math.random() * 900000000).toString(),
            funnel: 'Facebook Ads',
            status: isConfirmed ? 'CONFERMATO' : 'SCARTATO',
            assignedToId: gdo.id,
            salespersonUserId: salesperson.id,
            confirmationsUserId: confUser.id,
            createdAt: createdDate,
            updatedAt: createdDate,
            appointmentDate: isConfirmed ? apptDate : null,
            salespersonOutcome: isConfirmed ? (isClosed ? 'Chiuso' : 'Non chiuso') : null,
            closeProduct: isClosed ? 'gold' : null,
            closeAmountEur: isClosed ? Math.floor(Math.random() * 2000) + 500 : null,
            discardReason: !isConfirmed ? 'Non risponde' : null,
        });
    }

    await db.insert(leads).values(newLeads);
    
    console.log(`Seeded ${newLeads.length} archive leads successfully!`);
    process.exit(0);
}

main().catch(console.error);
