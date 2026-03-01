import { db } from "../src/db"
import { users } from "../src/db/schema"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"
import crypto from "crypto"

async function runSeed() {
    console.log("Seeding Conferme account...")

    try {
        const existing = (await db.select().from(users).where(eq(users.email, "conferme@fenice.local")))[0]

        if (existing) {
            console.log("Accout già esistente! Email: conferme@fenice.local")
            return
        }

        const hashedPassword = await bcrypt.hash("Conferme2026!", 10)
        const newId = crypto.randomUUID()

        await db.insert(users).values({
            id: newId,
            name: "Team Conferme",
            email: "conferme@fenice.local",
            password: hashedPassword,
            role: "CONFERME",
            displayName: "Team Conferme",
            isActive: true,
            createdAt: new Date(),
        })

        console.log("Account CONFERME creato con successo!")
        console.log("Email (username): conferme@fenice.local")
        console.log("Password: Conferme2026!")

    } catch (e) {
        console.error("Errore durante la creazione:", e)
    }
}

runSeed()
