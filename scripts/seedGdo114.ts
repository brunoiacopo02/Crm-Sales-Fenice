import { db } from "../src/db"
import { leads, users } from "../src/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"
import { subDays } from "date-fns"

async function seed() {
    console.log("--- Seeding Test Leads for GDO 114 ---")

    // Trova l'utente GDO 114. Assumiamo che gdoCode sia 114
    const gdo = await db.select().from(users).where(eq(users.gdoCode, 114)).limit(1).then(res => res[0])

    if (!gdo) {
        console.error("GDO 114 non trovato nel database!")
        process.exit(1)
    }

    console.log(`Trovato GDO: ${gdo.displayName || gdo.name} (${gdo.email})`)

    const recordsToInsert = []

    // 5 Leab Database (vecchi di 90 giorni)
    for (let i = 1; i <= 5; i++) {
        recordsToInsert.push({
            id: crypto.randomUUID(),
            name: `Test Database ${i}`,
            phone: `+39399DB0000${i}${Date.now()}`.slice(0, 15),
            funnel: 'Database',
            status: 'NEW',
            assignedToId: gdo.id,
            createdAt: subDays(new Date(), 90),
            updatedAt: subDays(new Date(), 90),
            callCount: 0
        })
    }

    // 5 Lead Generici (freschi, di oggi)
    for (let i = 1; i <= 5; i++) {
        recordsToInsert.push({
            id: crypto.randomUUID(),
            name: `Test Generico ${i}`,
            phone: `+39399GEN000${i}${Date.now()}`.slice(0, 15),
            funnel: 'Facebook Ads',
            status: 'NEW',
            assignedToId: gdo.id,
            createdAt: new Date(),
            updatedAt: new Date(),
            callCount: 0
        })
    }

    try {
        await db.insert(leads).values(recordsToInsert)
        console.log(`Caricati 10 lead (5 Database, 5 Facebook Ads) e assegnati a GDO 114.`)
    } catch (err) {
        console.error("Errore durante l'inserimento:", err)
    }

    console.log("--- Seed Completato ---")
    process.exit(0)
}

seed()
