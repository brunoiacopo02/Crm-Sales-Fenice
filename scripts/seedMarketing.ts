import "dotenv/config";
import { db } from "../src/db"
import { users } from "../src/db/schema"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"
import crypto from "crypto"

async function runSeed() {
    console.log("Seeding Marketing/Manager account...")

    try {
        const existing = (await db.select().from(users).where(eq(users.email, "marketing@fenice.local")))[0]

        if (existing) {
            console.log("Account già esistente! Email: marketing@fenice.local")
            return
        }

        const hashedPassword = await bcrypt.hash("Marketing2026!", 10)
        const newId = crypto.randomUUID()

        await db.insert(users).values({
            id: newId,
            name: "Marketing Manager",
            email: "marketing@fenice.local",
            password: hashedPassword,
            role: "MANAGER",
            displayName: "Marketing",
            isActive: true,
            createdAt: new Date(),
        })

        console.log("Account MARKETING/MANAGER creato con successo!")
        console.log("Email (username): marketing@fenice.local")
        console.log("Password: Marketing2026!")

    } catch (e) {
        console.error("Errore durante la creazione:", e)
    }
}

runSeed()
