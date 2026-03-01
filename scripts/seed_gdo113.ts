import { db } from "../src/db";
import { leads, users } from "../src/db/schema";
import crypto from "crypto";
import { eq } from "drizzle-orm";

async function main() {
    const gdo113 = (await db.select().from(users).where(eq(users.email, "gdo113@fenice.local")))[0];
    if (!gdo113) throw new Error("GDO 113 non trovato");

    for (let i = 1; i <= 4; i++) {
        await db.insert(leads).values({
                    id: crypto.randomUUID(),
                    name: `Lead Test Pipeline ${i}`,
                    phone: `+39333999888${i}`,
                    email: `pipeline${i}@example.com`,
                    funnel: "Test",
                    status: "NEW", // Iniziamo da NEW (Prima chiamata)
                    assignedToId: gdo113.id,
                    callCount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
    }
    console.log("Inseriti 4 lead per GDO 113.");
}

main().catch(console.error);
