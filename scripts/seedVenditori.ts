import "dotenv/config"
import { createClient } from "@supabase/supabase-js"
import { db } from "../src/db"
import { users } from "../src/db/schema"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole)

const DEFAULT_PASSWORD = "Venditore2026!"

const VENDITORI = [
    { email: "sales001@fenice.local", name: "Venditore 001" },
    { email: "sales002@fenice.local", name: "Venditore 002" },
    { email: "sales003@fenice.local", name: "Venditore 003" },
    { email: "sales004@fenice.local", name: "Venditore 004" },
    { email: "sales005@fenice.local", name: "Venditore 005" },
]

interface AccountResult {
    email: string
    name: string
    status: "created" | "exists" | "error"
    userId: string | null
    error?: string
}

async function getAuthUserByEmail(email: string): Promise<{ id: string } | null> {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    if (error) return null
    const found = data.users.find(u => u.email === email)
    return found ? { id: found.id } : null
}

async function seedVenditori() {
    console.log("=== SEED ACCOUNT VENDITORI ===\n")
    console.log(`Password per tutti: ${DEFAULT_PASSWORD}\n`)

    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10)
    const results: AccountResult[] = []

    for (const v of VENDITORI) {
        try {
            // Check if already exists in public.users
            const dbUser = (await db.select().from(users).where(eq(users.email, v.email)))[0]

            if (dbUser) {
                console.log(`[ESISTE] ${v.email} — gia' presente (ID: ${dbUser.id}, active: ${dbUser.isActive})`)
                results.push({ email: v.email, name: v.name, status: "exists", userId: dbUser.id })
                continue
            }

            // 1. Create in Supabase Auth
            let userId: string

            const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email: v.email,
                password: DEFAULT_PASSWORD,
                email_confirm: true,
                user_metadata: {
                    role: "VENDITORE",
                    name: v.name,
                },
            })

            if (authError) {
                if (authError.message.includes("already been registered")) {
                    // Auth user exists but DB record missing — recover the ID
                    const existing = await getAuthUserByEmail(v.email)
                    if (existing) {
                        userId = existing.id
                        console.log(`  Auth: ${v.email} gia' esistente (ID: ${userId})`)
                    } else {
                        console.error(`  ERRORE: ${v.email} — Auth dice esistente ma non trovato. Skip.`)
                        results.push({ email: v.email, name: v.name, status: "error", userId: null, error: authError.message })
                        continue
                    }
                } else {
                    console.error(`  ERRORE Auth per ${v.email}: ${authError.message}. Skip.`)
                    results.push({ email: v.email, name: v.name, status: "error", userId: null, error: authError.message })
                    continue
                }
            } else {
                userId = authData.user.id
                console.log(`  Auth: ${v.email} creato (ID: ${userId})`)
            }

            // 2. Insert into public.users
            await db.insert(users).values({
                id: userId,
                name: v.name,
                email: v.email,
                password: hashedPassword,
                role: "VENDITORE",
                displayName: v.name,
                isActive: true,
                createdAt: new Date(),
            })

            console.log(`  DB:   ${v.email} inserito con ruolo VENDITORE`)
            console.log(`  OK:   Account ${v.name} creato.\n`)
            results.push({ email: v.email, name: v.name, status: "created", userId })

        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`  ERRORE creazione ${v.email}: ${msg}\n`)
            results.push({ email: v.email, name: v.name, status: "error", userId: null, error: msg })
        }
    }

    // Print final report
    console.log("\n=== REPORT FINALE ===")
    console.log("Email                     | Nome            | Stato   | User ID")
    console.log("--------------------------|-----------------|---------|--------------------------------------")

    for (const r of results) {
        const email = r.email.padEnd(25)
        const name = r.name.padEnd(15)
        const status = r.status.toUpperCase().padEnd(7)
        const id = r.userId ?? "-"
        console.log(`${email} | ${name} | ${status} | ${id}`)
    }

    const created = results.filter(r => r.status === "created").length
    const existing = results.filter(r => r.status === "exists").length
    const errors = results.filter(r => r.status === "error").length

    console.log(`\nRiepilogo: ${created} creati, ${existing} gia' esistenti, ${errors} errori`)
    console.log(`Password: ${DEFAULT_PASSWORD}`)
    console.log("\n=== SEED COMPLETATO ===")
}

seedVenditori()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("Errore fatale:", e)
        process.exit(1)
    })
