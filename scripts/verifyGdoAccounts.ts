import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);

// GDO codes 105-120 = 16 accounts
const GDO_CODE_START = 105;
const GDO_CODE_END = 120;
const DEFAULT_PASSWORD = "Gdo2026!";

interface GdoAccountStatus {
    gdoCode: number;
    exists: boolean;
    isActive: boolean;
    email: string | null;
    displayName: string | null;
    hasAuthAccount: boolean;
    userId: string | null;
}

async function getAuthUsers(): Promise<Map<string, { id: string; email: string }>> {
    const map = new Map<string, { id: string; email: string }>();
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (error) {
        console.error("Errore listando utenti Auth:", error.message);
        return map;
    }
    for (const user of data.users) {
        if (user.email) {
            map.set(user.email, { id: user.id, email: user.email });
        }
    }
    return map;
}

async function verifyAccounts(): Promise<GdoAccountStatus[]> {
    console.log("=== VERIFICA ACCOUNT GDO ===\n");

    // Fetch all GDO users from public.users
    const allGdoUsers = await db.select().from(users).where(eq(users.role, "GDO"));
    const gdoByCode = new Map(allGdoUsers.filter(u => u.gdoCode != null).map(u => [u.gdoCode!, u]));

    // Fetch all Supabase Auth users
    const authUsers = await getAuthUsers();

    const results: GdoAccountStatus[] = [];

    // Check expected range 105-120
    for (let code = GDO_CODE_START; code <= GDO_CODE_END; code++) {
        const dbUser = gdoByCode.get(code);
        const expectedEmail = `gdo${code}@fenice.local`;
        const authUser = dbUser?.email ? authUsers.get(dbUser.email) : authUsers.get(expectedEmail);

        results.push({
            gdoCode: code,
            exists: !!dbUser,
            isActive: dbUser?.isActive ?? false,
            email: dbUser?.email ?? null,
            displayName: dbUser?.displayName ?? null,
            hasAuthAccount: !!authUser,
            userId: dbUser?.id ?? null,
        });
    }

    // Report GDO users with codes outside expected range
    const extraGdoUsers = allGdoUsers.filter(u => {
        if (u.gdoCode == null) return true;
        return u.gdoCode < GDO_CODE_START || u.gdoCode > GDO_CODE_END;
    });

    // Print report
    console.log(`Trovati ${allGdoUsers.length} utenti GDO totali nel database.`);
    console.log(`Range atteso: ${GDO_CODE_START}-${GDO_CODE_END} (${GDO_CODE_END - GDO_CODE_START + 1} account)\n`);

    console.log("--- STATO ACCOUNT GDO ---");
    console.log("Code | Esiste | Attivo | Auth | Email                    | Display Name");
    console.log("-----|--------|--------|------|--------------------------|-------------");

    for (const r of results) {
        const exists = r.exists ? "  SI " : "  NO ";
        const active = r.isActive ? "  SI " : "  NO ";
        const auth = r.hasAuthAccount ? " SI " : " NO ";
        const email = (r.email ?? "-").padEnd(24);
        const display = r.displayName ?? "-";
        console.log(` ${r.gdoCode} | ${exists} | ${active} | ${auth} | ${email} | ${display}`);
    }

    const missing = results.filter(r => !r.exists);
    const inactive = results.filter(r => r.exists && !r.isActive);
    const noAuth = results.filter(r => r.exists && !r.hasAuthAccount);

    console.log(`\n--- RIEPILOGO ---`);
    console.log(`Account esistenti e attivi: ${results.filter(r => r.exists && r.isActive).length}/${GDO_CODE_END - GDO_CODE_START + 1}`);
    console.log(`Account mancanti: ${missing.length} (codes: ${missing.map(r => r.gdoCode).join(", ") || "nessuno"})`);
    console.log(`Account inattivi: ${inactive.length} (codes: ${inactive.map(r => r.gdoCode).join(", ") || "nessuno"})`);
    console.log(`Account senza Auth: ${noAuth.length} (codes: ${noAuth.map(r => r.gdoCode).join(", ") || "nessuno"})`);

    if (extraGdoUsers.length > 0) {
        console.log(`\n--- ACCOUNT GDO FUORI RANGE ---`);
        for (const u of extraGdoUsers) {
            console.log(`  gdoCode=${u.gdoCode ?? "NULL"} | ${u.email} | ${u.displayName ?? u.name} | active=${u.isActive}`);
        }
    }

    return results;
}

async function createMissingAccounts(results: GdoAccountStatus[]) {
    const missing = results.filter(r => !r.exists);

    if (missing.length === 0) {
        console.log("\nTutti gli account GDO esistono gia'. Nessuna creazione necessaria.");
        return;
    }

    console.log(`\n=== CREAZIONE ${missing.length} ACCOUNT MANCANTI ===\n`);

    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    for (const account of missing) {
        const email = `gdo${account.gdoCode}@fenice.local`;
        const displayName = `GDO ${account.gdoCode}`;

        try {
            // 1. Create in Supabase Auth
            const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password: DEFAULT_PASSWORD,
                email_confirm: true,
                user_metadata: {
                    role: "GDO",
                    name: displayName,
                },
            });

            let userId: string;

            if (authError) {
                // If user already exists in Auth, retrieve their ID
                if (authError.message.includes("already been registered")) {
                    const authUsers = await getAuthUsers();
                    const existing = authUsers.get(email);
                    if (existing) {
                        userId = existing.id;
                        console.log(`  Auth: ${email} gia' esistente (ID: ${userId})`);
                    } else {
                        console.error(`  ERRORE: ${email} - Auth dice esistente ma non trovato. Skip.`);
                        continue;
                    }
                } else {
                    console.error(`  ERRORE Auth per ${email}: ${authError.message}. Skip.`);
                    continue;
                }
            } else {
                userId = authData.user.id;
                console.log(`  Auth: ${email} creato (ID: ${userId})`);
            }

            // 2. Insert into public.users
            await db.insert(users).values({
                id: userId,
                name: displayName,
                email,
                password: hashedPassword,
                role: "GDO",
                gdoCode: account.gdoCode,
                displayName,
                isActive: true,
                createdAt: new Date(),
            });

            console.log(`  DB:   ${email} inserito con gdoCode=${account.gdoCode}`);
            console.log(`  OK:   Account GDO ${account.gdoCode} creato. (Password: ${DEFAULT_PASSWORD})\n`);

        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`  ERRORE creazione GDO ${account.gdoCode}: ${msg}\n`);
        }
    }

    console.log("=== CREAZIONE COMPLETATA ===");
}

async function main() {
    const createFlag = process.argv.includes("--create");

    const results = await verifyAccounts();

    if (createFlag) {
        await createMissingAccounts(results);
        // Re-verify after creation
        console.log("\n--- VERIFICA POST-CREAZIONE ---");
        await verifyAccounts();
    } else {
        const missing = results.filter(r => !r.exists);
        if (missing.length > 0) {
            console.log(`\nPer creare gli account mancanti, esegui:`);
            console.log(`  npx tsx scripts/verifyGdoAccounts.ts --create`);
        }
    }

    process.exit(0);
}

main().catch((e) => {
    console.error("Errore fatale:", e);
    process.exit(1);
});
