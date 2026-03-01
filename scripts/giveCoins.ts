import { db } from "../src/db"
import { users, coinTransactions } from "../src/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"

async function run() {
    const userEmail = "gdo114@fenice.local"
    console.log(`Giving 10 coins to ${userEmail}...`)

    const user = (await db.select().from(users).where(eq(users.email, userEmail)))[0]

    if (!user) {
        console.error("User not found!")
        process.exit(1)
    }

    const amount = 10
    const newBalance = (user.walletCoins || 0) + amount

    // Update user balance
    await db.update(users)
            .set({ walletCoins: newBalance })
            .where(eq(users.id, user.id))
        

    // Log transaction
    await db.insert(coinTransactions).values({
            id: crypto.randomUUID(),
            userId: user.id,
            amount: amount,
            reason: 'MANUAL_ADJUSTMENT',
            createdAt: new Date(),
        })

    console.log(`Successfully added 10 coins. New balance is ${newBalance}.`)
}

run().catch(console.error)
