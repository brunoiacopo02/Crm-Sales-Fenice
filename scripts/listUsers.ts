import { db } from "../src/db";
import { users } from "../src/db/schema";
import { asc } from "drizzle-orm";

async function main() {
    const allUsers = (await db.select().from(users).orderBy(asc(users.role)))[0];
    const allUsersList = await db.select().from(users).orderBy(asc(users.role));

    console.log(`Trovati ${allUsersList.length} utenti:`);
    for (const u of allUsersList) {
        console.log(`- ${u.email} | Ruolo: ${u.role} | GDO Code: ${u.gdoCode} | GDO Name: ${u.displayName}`);
    }
}

main().catch(console.error);
