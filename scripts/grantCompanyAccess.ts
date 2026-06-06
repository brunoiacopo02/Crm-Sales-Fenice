// scripts/grantCompanyAccess.ts
// Uso: npx tsx scripts/grantCompanyAccess.ts <companyId> <email1> <email2> ...
// Aggiunge <companyId> ad allowedCompanies (user_metadata + colonna users) per gli utenti dati.
import "dotenv/config"
import { createClient } from "@supabase/supabase-js"
import { db } from "../src/db"
import { users } from "../src/db/schema"
import { eq } from "drizzle-orm"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(supabaseUrl, supabaseServiceRole)

async function listAuthUserByEmail(email: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  return data.users.find((u) => u.email === email) ?? null
}

async function main() {
  const [companyId, ...emails] = process.argv.slice(2)
  if (!companyId || emails.length === 0) {
    console.error("Uso: npx tsx scripts/grantCompanyAccess.ts <companyId> <email...>")
    process.exit(1)
  }
  for (const email of emails) {
    const authUser = await listAuthUserByEmail(email)
    if (!authUser) { console.log(`[SKIP] ${email}: non trovato in Auth`); continue }

    const meta = authUser.user_metadata ?? {}
    const baseCompany = (meta.companyId as string) ?? "fenice"
    const current: string[] = Array.isArray(meta.allowedCompanies) && meta.allowedCompanies.length
      ? meta.allowedCompanies
      : [baseCompany]
    const next = Array.from(new Set([...current, companyId]))

    await admin.auth.admin.updateUserById(authUser.id, {
      user_metadata: { ...meta, allowedCompanies: next },
    })
    await db.update(users).set({ allowedCompanies: next }).where(eq(users.id, authUser.id))
    console.log(`[OK] ${email}: allowedCompanies = [${next.join(", ")}]`)
  }
  console.log("Fatto.")
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
