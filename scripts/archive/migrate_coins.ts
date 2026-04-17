import { Database } from "better-sqlite3"
import DatabaseConstructor from "better-sqlite3"

const db = new DatabaseConstructor("./dev.db")

try {
    db.exec("ALTER TABLE users ADD COLUMN walletCoins INTEGER DEFAULT 0 NOT NULL")
    console.log("Added walletCoins column successfully.")
} catch (e: any) {
    console.log("Error adding walletCoins or it already exists:", e.message)
}

try {
    db.exec(`CREATE TABLE IF NOT EXISTS "sprints" (
        "id" text PRIMARY KEY NOT NULL,
        "startTime" integer NOT NULL,
        "endTime" integer NOT NULL,
        "actualEndTime" integer,
        "status" text DEFAULT 'active' NOT NULL,
        "startedByManagerId" text,
        "createdAt" integer NOT NULL,
        FOREIGN KEY ("startedByManagerId") REFERENCES "users"("id") ON UPDATE no action ON DELETE no action
    )`)
    console.log("Created sprints table successfully.")
} catch (e: any) {
    console.log("Error creating sprints table:", e.message)
}
