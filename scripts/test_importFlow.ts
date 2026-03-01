import { processCsvImport, CsvRowPayload } from "../src/app/actions/importLeads";
import { db } from "../src/db";
import { leads } from "../src/db/schema";
import { desc } from "drizzle-orm";

async function main() {
    const payload: CsvRowPayload[] = [
        { rowIndex: 2, nome: "Mario Rossi", telefono: "+393331112233", email: "mario.rossi@example.com", cognome: "Marketing" },
        { rowIndex: 3, nome: "Luca Bianchi", telefono: "+393332223344", email: "luca.bianchi@example.com", cognome: "Webinar" },
        { rowIndex: 4, nome: "Giulia Verdi", telefono: "+393333334455", email: "giulia.verdi@example.com", cognome: "Meta Ads" },
        { rowIndex: 5, nome: "Elena Neri", telefono: "+393334445566", email: "elena.neri@example.com", cognome: "Organic" },
        { rowIndex: 6, nome: "Test Doppio", telefono: "+393331112233", email: "doppio@example.com", cognome: "Marketing" }, // Telefono duplicato rispetto alla riga 2
        { rowIndex: 7, nome: "Anna Gialli", telefono: "+393335556677", email: "anna.gialli@example.com", cognome: "Webinar" },
        { rowIndex: 8, nome: "Roberto Viola", telefono: "+393336667788", email: "roberto.viola@example.com", cognome: "Meta Ads" },
        { rowIndex: 9, nome: "Silvia Blu", telefono: "+393337778899", email: "silvia.blu@example.com", cognome: "Organic" },
        { rowIndex: 10, nome: "Test Errore", telefono: "123", email: "test@errore", cognome: "Organic" }, // Telefono troppo corto, email errata
    ];

    console.log("Payload preparato, chiamo processCsvImport...", payload.length, "righe");

    // Test 1: Importazione iniziale
    console.log("=== FIRST IMPORT ===");
    const report1 = await processCsvImport(payload);
    console.log("Risultato 1:", report1);

    // Test 2: Importazione duplicata per verificare deduplica
    console.log("\n=== SECOND IMPORT (DEDUPLICA EXPECTED) ===");
    const report2 = await processCsvImport(payload);
    console.log("Risultato 2:", report2);

    // Verifica DB: Controllo Assegnazioni
    const recentLeads = await db.select().from(leads).orderBy(desc(leads.createdAt)).limit(10);
    console.log("\nUltime " + recentLeads.length + " leads inserite:");
    for (const l of recentLeads) {
        console.log(`- ID: ${l.id} | Name: ${l.name} | GDO: ${l.assignedToId} | Status: ${l.status}`);
    }
}

main().catch(console.error);
