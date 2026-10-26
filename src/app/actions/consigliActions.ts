"use server"

// Consigli in chiamata (PO 26/10/2026). L'admin ascolta in cuffia un GDO o una
// persona delle Conferme e gli scrive un consiglio; chi lo riceve lo vede in
// un riquadro che non blocca niente, solo finché c'è qualcosa da leggere, e lo
// chiude con "Letto". Scrive solo l'admin (ruolo letto dalla tabella users).
// Le frasi pronte le crea e le modifica l'admin: partono vuote.

import { randomUUID } from "crypto"
import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import { appSettings, callTips, users } from "@/db/schema"
import { assertSalesArea, currentTenant } from "@/lib/tenancy"
import { conRuoloDb, ruoloDb } from "@/lib/auth/ruoloDb"
import { dayBoundsRome } from "@/lib/dateUtils"
import { personName } from "@/lib/diretta/config"

const FRASI_KEY = "consigli_frasi_pronte"
const MAX_MESSAGGIO = 500
const MAX_FRASE = 200
const MAX_FRASI = 12
/** Chi può ricevere un consiglio. */
const RUOLI_DESTINATARI = ["GDO", "CONFERME"] as const

export interface Consiglio {
    id: string
    message: string
    createdAt: string
    readAt: string | null
}

export interface Destinatario {
    id: string
    nome: string
    ruolo: "GDO" | "CONFERME"
}

type Esito = { ok: true } | { ok: false; error: string }

async function requireAdmin(): Promise<{ id: string }> {
    const admin = await conRuoloDb(["ADMIN"])
    if (!admin) throw new Error("Unauthorized")
    return admin
}

const riga = (r: { id: string; message: string; createdAt: Date; readAt: Date | null }): Consiglio => ({
    id: r.id, message: r.message, createdAt: r.createdAt.toISOString(), readAt: r.readAt?.toISOString() ?? null,
})

// ── Chi riceve ───────────────────────────────────────────────────────────

/** I consigli di oggi ancora da leggere, dal più vecchio. Vuoto per chi non è GDO o Conferme. */
export async function getMieiConsigli(): Promise<Consiglio[]> {
    const io = await ruoloDb()
    if (!io || !(RUOLI_DESTINATARI as readonly string[]).includes(io.role)) return []
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const rows = await db.select({ id: callTips.id, message: callTips.message, createdAt: callTips.createdAt, readAt: callTips.readAt })
        .from(callTips)
        .where(and(
            eq(callTips.receiverId, io.id),
            eq(callTips.companyId, ctx.companyId),
            isNull(callTips.readAt),
            gte(callTips.createdAt, dayBoundsRome(new Date()).start),
        ))
        .orderBy(asc(callTips.createdAt))
        .limit(20)
    return rows.map(riga)
}

/** "Letto": segna letti i consigli indicati, solo se sono di chi li legge. */
export async function segnaConsigliLetti(ids: string[]): Promise<Esito> {
    const io = await ruoloDb()
    if (!io) return { ok: false, error: "Sessione scaduta" }
    const validi = ids.filter(id => typeof id === "string" && id.length > 0).slice(0, 50)
    if (validi.length === 0) return { ok: true }
    await db.update(callTips)
        .set({ readAt: new Date() })
        .where(and(inArray(callTips.id, validi), eq(callTips.receiverId, io.id), isNull(callTips.readAt)))
    return { ok: true }
}

// ── Admin ────────────────────────────────────────────────────────────────

/** GDO e Conferme attivi (niente bot, niente account di prova), per nome. */
export async function getDestinatariConsigli(): Promise<Destinatario[]> {
    await requireAdmin()
    const ctx = await currentTenant()
    const rows = await db.select({
        id: users.id, role: users.role, firstName: users.firstName, displayName: users.displayName, name: users.name,
    })
        .from(users)
        .where(and(
            inArray(users.role, [...RUOLI_DESTINATARI]),
            eq(users.isActive, true),
            eq(users.isBot, false),
            eq(users.isTest, false),
            eq(users.companyId, ctx.isAllCompanies ? "fenice" : ctx.companyId),
        ))
    return rows
        .map(r => ({ id: r.id, nome: personName(r) || "Senza nome", ruolo: r.role as Destinatario["ruolo"] }))
        .sort((a, b) => (a.ruolo === b.ruolo ? 0 : a.ruolo === "GDO" ? -1 : 1) || a.nome.localeCompare(b.nome, "it"))
}

/** I consigli di oggi mandati a una persona, con l'ora di lettura. */
export async function getConsigliInviati(receiverId: string): Promise<Consiglio[]> {
    const admin = await requireAdmin()
    const rows = await db.select({ id: callTips.id, message: callTips.message, createdAt: callTips.createdAt, readAt: callTips.readAt })
        .from(callTips)
        .where(and(
            eq(callTips.senderId, admin.id),
            eq(callTips.receiverId, receiverId),
            gte(callTips.createdAt, dayBoundsRome(new Date()).start),
        ))
        .orderBy(asc(callTips.createdAt))
        .limit(50)
    return rows.map(riga)
}

export async function inviaConsiglio(receiverId: string, message: string): Promise<Esito> {
    const admin = await requireAdmin()
    const testo = (message ?? "").trim()
    if (!testo) return { ok: false, error: "Scrivi il consiglio" }
    if (testo.length > MAX_MESSAGGIO) return { ok: false, error: `Massimo ${MAX_MESSAGGIO} caratteri` }
    const [dest] = await db.select({ role: users.role, isActive: users.isActive, companyId: users.companyId })
        .from(users).where(eq(users.id, receiverId)).limit(1)
    if (!dest || !dest.isActive || !(RUOLI_DESTINATARI as readonly string[]).includes(dest.role)) {
        return { ok: false, error: "Si può scrivere solo a GDO e Conferme attivi" }
    }
    await db.insert(callTips).values({
        id: randomUUID(),
        companyId: dest.companyId ?? "fenice",
        senderId: admin.id,
        receiverId,
        message: testo,
    })
    return { ok: true }
}

// ── Frasi pronte (le crea e le modifica l'admin) ─────────────────────────

function pulisciFrasi(v: unknown): string[] {
    if (!Array.isArray(v)) return []
    return v
        .filter((x): x is string => typeof x === "string")
        .map(x => x.trim())
        .filter(x => x.length > 0 && x.length <= MAX_FRASE)
        .slice(0, MAX_FRASI)
}

export async function getFrasiPronte(): Promise<string[]> {
    await requireAdmin()
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, FRASI_KEY)).limit(1)
    try {
        return pulisciFrasi(row?.value ? JSON.parse(row.value) : [])
    } catch {
        return []
    }
}

export async function salvaFrasiPronte(frasi: string[]): Promise<{ ok: true; frasi: string[] } | { ok: false; error: string }> {
    const admin = await requireAdmin()
    const pulite = pulisciFrasi(frasi)
    const value = JSON.stringify(pulite)
    await db.insert(appSettings).values({ key: FRASI_KEY, value, updatedBy: admin.id, updatedAt: new Date() })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: admin.id, updatedAt: new Date() } })
    return { ok: true, frasi: pulite }
}
