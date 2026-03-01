import { Database } from "better-sqlite3"
import DatabaseConstructor from "better-sqlite3"
import bcrypt from "bcryptjs"

async function resetPasswords() {
    const db = new DatabaseConstructor("./dev.db")

    // admin123 hash
    const adminHash = await bcrypt.hash("admin123", 10)
    db.prepare("UPDATE users SET password = ? WHERE email = 'admin@fenice.com'").run(adminHash)

    // gdo123 hash
    const gdoHash = await bcrypt.hash("gdo123", 10)
    db.prepare("UPDATE users SET password = ? WHERE email = 'gdo@fenice.com'").run(gdoHash)
    db.prepare("UPDATE users SET password = ? WHERE email = 'gdo105@fenice.local'").run(gdoHash)

    console.log("Passwords reset successfully.")
}

resetPasswords().catch(console.error)
