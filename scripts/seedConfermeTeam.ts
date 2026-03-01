import { db } from "../src/db"
import { users } from "../src/db/schema"
import { eq, inArray } from "drizzle-orm"
import bcrypt from "bcryptjs"
import crypto from "crypto"

async function runSeed() {
    console.log("Seeding Conferme accounts: Andrea, Alberto, Lavinia...")

    const accountsToCreate = [
        { name: "Andrea", email: "andrea@fenice.local", displayName: "Andrea (Conferme)", pass: "Conferme2026!" },
        { name: "Alberto", email: "alberto@fenice.local", displayName: "Alberto (Conferme)", pass: "Conferme2026!" },
        { name: "Lavinia", email: "lavinia@fenice.local", displayName: "Lavinia (Conferme)", pass: "Conferme2026!" },
    ]

    try {
        const existingEmails = accountsToCreate.map(a => a.email)
        const existing = await db.select().from(users).where(inArray(users.email, existingEmails))

        const existingSet = new Set(existing.map(u => u.email))

        for (const account of accountsToCreate) {
            if (existingSet.has(account.email)) {
                console.log(`- L'account ${account.email} esiste già.`)
                continue
            }

            const hashedPassword = await bcrypt.hash(account.pass, 10)
            const newId = crypto.randomUUID()

            await db.insert(users).values({
                id: newId,
                name: account.name,
                email: account.email,
                password: hashedPassword,
                role: "CONFERME",
                displayName: account.displayName,
                isActive: true,
                createdAt: new Date(),
            })

            console.log(`- Creato account: ${account.email} (Password: ${account.pass})`)
        }

        console.log("Operazione completata.")

    } catch (e) {
        console.error("Errore durante la creazione:", e)
    }
}

runSeed()
