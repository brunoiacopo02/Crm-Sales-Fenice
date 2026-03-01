import { db } from "../src/db"
import { leads, users } from "../src/db/schema"
import { eq } from "drizzle-orm"

// Import the action but simulate being inside context
// Note: We bypass `getServerSession` because we are running from CLI, 
// so we'll just test the DB logic directly with Drizzle to verify Optimistic Concurrency limit.

async function runConcurrencyTest() {
    console.log("---- Testing Optimistic Concurrency ----")

    // 1. Get an existing Lead
    const lead = (await db.select().from(leads).limit(1))[0]
    if (!lead) {
        console.log("No leads to test.")
        return
    }

    console.log(`Target Lead: ${lead.name} (Version: ${lead.version})`)

    const currentVersion = lead.version || 1;

    // 2. Simula Utente A che fa un salvataggio con la versione corretta
    console.log("-> Utente A invia Update con versione:", currentVersion)
    try {
        const updateA = await db.update(leads)
            .set({ name: lead.name + " (A)", version: currentVersion + 1 })
            .where(
                eq(leads.id, lead.id) // Normal ORM logic. But in our actions we do: get old, if oldLead.version !== currentVersion throw...
            )

        // We simulate what the action does exactly
        const oldLeadForA = (await db.select().from(leads).where(eq(leads.id, lead.id)))[0]
        if (oldLeadForA!.version !== currentVersion) throw new Error("CONCURRENCY_ERROR")

        await db.update(leads).set({ version: currentVersion + 1 }).where(eq(leads.id, lead.id))
        console.log("✅ Utente A ha salvato correttamente! (Nuova versione nel DB:", currentVersion + 1, ")")
    } catch (e) {
        console.error("Utente A fallito", e)
    }

    // 3. Simula Utente B che prova a fare un update con la STESSA versione inziale (pk non ha re-fetchato)
    console.log("-> Utente B invia Update con versione vecchia:", currentVersion)
    try {
        // Simulo l'azione del server:
        const oldLeadForB = (await db.select().from(leads).where(eq(leads.id, lead.id)))[0]
        if (oldLeadForB!.version !== currentVersion) {
            throw new Error("CONCURRENCY_ERROR")
        }

        // Questo non dovrebbe avvenire mai
        await db.update(leads).set({ version: currentVersion + 1 }).where(eq(leads.id, lead.id))
        console.log("❌ ERRORE: Utente B HA SALVATO CON SUCCESSO (Fallimento del test di concorrenza)")

    } catch (e: any) {
        if (e.message === "CONCURRENCY_ERROR") {
            console.log("✅ ECCEZIONE INTERCETTATA CON SUCCESSO! Utente B bloccato dal salvare una vecchia versione.")
        } else {
            console.error(e)
        }
    }
}

runConcurrencyTest()
