import { db } from "../src/db"
import { users } from "../src/db/schema"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"
import crypto from "crypto"

async function runSeed() {
    console.log("Seeding Venditori accounts...")

    const venditori = [
        { login: "sales001@fenice.com", name: "Sales 001", code: 1 },
        { login: "sales003@fenice.com", name: "Sales 003", code: 3 },
        { login: "sales004@fenice.com", name: "Sales 004", code: 4 },
        { login: "sales008@fenice.com", name: "Sales 008", code: 8 },
        { login: "sales010@fenice.com", name: "Sales 010", code: 10 },
    ]

    try {
        const hashedPassword = await bcrypt.hash("Venditore2026!", 10)

        for (const v of venditori) {
            const existing = (await db.select().from(users).where(eq(users.email, v.login)))[0]

            if (existing) {
                console.log(`Account già esistente! Email: ${v.login}`)
                continue
            }

            const newId = crypto.randomUUID()

            await db.insert(users).values({
                id: newId,
                name: v.name,
                email: v.login,
                password: hashedPassword,
                role: "VENDITORE",
                displayName: v.name,
                isActive: true,
                createdAt: new Date(),
            })

            console.log(`Account VENDITORE creato: ${v.login}`)
        }

        console.log("Seeding completato. Password per tutti: Venditore2026!")
    } catch (e) {
        console.error("Errore durante la creazione:", e)
    }
}

runSeed()
