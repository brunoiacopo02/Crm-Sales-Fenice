import { db } from "../src/db"
import { users } from "../src/db/schema"
import bcrypt from "bcryptjs"

async function run() {
    console.log("Hashing the new password...")
    const hashedPassword = await bcrypt.hash("1234", 10)

    console.log("Updating all users in the database...")
    const result = await db.update(users).set({ password: hashedPassword })

    console.log(`Successfully updated passwords for ${result.rowCount} users.`)
}

run().catch(console.error)
