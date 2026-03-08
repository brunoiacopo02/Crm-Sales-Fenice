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

async function runSeed() {
    console.log("Seeding Marketing/Manager account on Supabase Auth & Public DB...");

    try {
        const email = "marketing@fenice.local";
        const password = "Marketing2026!";

        // 1. Delete bad existing public user
        const existing = await db.select().from(users).where(eq(users.email, email));
        if (existing.length > 0) {
            console.log("Cancello utente errato preesistente da public.users...");
            await db.delete(users).where(eq(users.email, email));
        }

        // 2. Create User in Supabase Auth
        console.log("Creating user in Auth...");
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                role: "MANAGER",
                name: "Marketing"
            }
        });

        if (authError) {
            console.error("Errore da Supabase Auth:", authError.message);
            // If it already exists, maybe we should get it
        }

        const authUsersResponse = await supabaseAdmin.auth.admin.listUsers();
        const existingAuthUser = authUsersResponse.data.users.find(u => u.email === email);

        const userId = existingAuthUser?.id || authData?.user?.id || crypto.randomUUID();

        // 3. Insert into public.users
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.insert(users).values({
            id: userId,
            name: "Marketing Manager",
            email: email,
            password: hashedPassword,
            role: "MANAGER",
            displayName: "Marketing",
            isActive: true,
            createdAt: new Date(),
        });

        console.log(`Account MARKETING/MANAGER creato in public.users con ID: ${userId}`);
        console.log("Operazione Completata!");

    } catch (e) {
        console.error("Errore durante la creazione:", e);
    }
}

runSeed();
