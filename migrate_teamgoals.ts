import DatabaseConstructor from "better-sqlite3"

const db = new DatabaseConstructor("./dev.db")

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS \`teamGoals\` (
            \`id\` text PRIMARY KEY,
            \`title\` text NOT NULL,
            \`targetCount\` integer NOT NULL,
            \`currentCount\` integer DEFAULT 0 NOT NULL,
            \`deadline\` integer NOT NULL,
            \`rewardCoins\` integer NOT NULL,
            \`goalType\` text DEFAULT 'database' NOT NULL,
            \`status\` text DEFAULT 'active' NOT NULL,
            \`createdAt\` integer NOT NULL
        )
    `)
    console.log("Migration successful: teamGoals table created.")
} catch (e) {
    console.error("Migration failed:", e)
} finally {
    db.close()
}
