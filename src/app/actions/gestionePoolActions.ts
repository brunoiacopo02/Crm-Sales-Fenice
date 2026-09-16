"use server";

/**
 * Scheda /gestione — governo dei pool di assegnazione dei lead.
 *
 * Nasce il 15/09/2026 dopo il flood della lista AC 133: serviva poter spostare
 * un GDO da un pool all'altro senza un deploy, e poter spegnere un account
 * senza lasciare i suoi lead orfani.
 *
 * I tre pool, indipendenti fra loro (un GDO può stare in più di uno):
 *   FRESCHI  (`acAutoIntake`)        lead nuovi dal webhook ActiveCampaign
 *   RIDATI   (`botReturnIntake`)     lead che il bot restituisce
 *   SCORTA   (`freshOverflowScorta`) i freschi in eccedenza oltre il tetto
 *
 * NOTA SULLA PASSWORD: la pagina ha un blocco a password lato client, chiesto
 * dal PO. È un deterrente contro il collega curioso, NON una protezione: chi
 * apre gli strumenti sviluppatore la legge. La protezione vera sono queste
 * action, che richiedono ruolo ADMIN lato server — ed è quella che conta.
 */

import { db } from "@/db";
import { users, leads, leadEvents } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createClient } from "@/utils/supabase/server";
import { currentTenant, assertSalesArea, type TenantContext } from "@/lib/tenancy";
import { contaNeiKpiSql } from "@/lib/intakeBatch";
import { revalidatePath } from "next/cache";

/** Solo ADMIN: questa scheda sposta i lead di tutti, non è una pagina di reparto. */
async function requireAdmin(): Promise<{ id: string; ctx: TenantContext }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = user?.user_metadata?.role as string | undefined;
    if (!user || role !== "ADMIN") throw new Error("Unauthorized");
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    return { id: user.id, ctx };
}

export type PoolKind = "freschi" | "ridati" | "scorta";

export interface GdoPoolRow {
    id: string;
    gdoCode: number | null;
    name: string | null;
    displayName: string | null;
    isActive: boolean;
    isBot: boolean;
    freschi: boolean;
    ridati: boolean;
    scorta: boolean;
    dailyFreshCap: number | null;
    /** Lead mai chiamati in carico: è la coda di prima chiamata, la mole vera. */
    maiChiamati: number;
    /** Lead già toccati e ancora aperti. */
    inLavorazione: number;
    /** Lead freschi presi oggi: serve a vedere il tetto mentre si riempie. */
    freschiOggi: number;
}

export async function listGdoPools(): Promise<GdoPoolRow[]> {
    const { ctx } = await requireAdmin();

    // Un giro solo di query: i conteggi arrivano come sottoquery correlate,
    // così la pagina non fa una richiesta per GDO.
    // Due accortezze sulla forma, entrambe obbligate:
    //  - niente alias sulla tabella: `contaNeiKpiSql()` cita le colonne come
    //    "leads"."…", e con `FROM leads l` Postgres non le troverebbe più;
    //  - il WHERE passa da `and(...)`, cioè da un SQL annidato. In una select a
    //    tabella singola Drizzle toglie il nome tabella alle colonne di PRIMO
    //    livello del template, e `${users.id}` diventava un nudo `"id"` che
    //    dentro la sottoquery Postgres risolveva su leads.id: conteggi a zero.
    const contaLead = (cond: ReturnType<typeof sql>) => sql<number>`(
        SELECT count(*)::int FROM ${leads}
        WHERE ${and(
            eq(leads.assignedToId, users.id),
            eq(leads.companyId, ctx.companyId),
            cond,
        )}
    )`;

    const rows = await db.select({
        id: users.id,
        gdoCode: users.gdoCode,
        name: users.name,
        displayName: users.displayName,
        isActive: users.isActive,
        isBot: users.isBot,
        freschi: users.acAutoIntake,
        ridati: users.botReturnIntake,
        scorta: users.freshOverflowScorta,
        dailyFreshCap: users.dailyFreshCap,
        // Gli scarti mai chiamati di un'infornata anomala non sono coda di
        // prima chiamata: per decisione PO non li lavora nessun umano, e con
        // loro dentro la "mole vera" del bot diceva ~7.000.
        maiChiamati: contaLead(sql`${leads.status} = 'NEW' AND ${leads.callCount} = 0 AND ${contaNeiKpiSql()}`),
        inLavorazione: contaLead(sql`${leads.status} = 'IN_PROGRESS'`),
        freschiOggi: contaLead(
            sql`${leads.createdAt} >= (to_char(now() AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') || ' 00:00')::timestamp AT TIME ZONE 'Europe/Rome'`,
        ),
    }).from(users).where(and(eq(users.companyId, ctx.companyId), eq(users.role, "GDO")));

    return rows.sort((a, b) => (a.gdoCode ?? 9999) - (b.gdoCode ?? 9999));
}

const COLONNA_POOL = {
    freschi: "acAutoIntake",
    ridati: "botReturnIntake",
    scorta: "freshOverflowScorta",
} as const;

export async function setGdoPool(
    gdoUserId: string,
    pool: PoolKind,
    enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { ctx } = await requireAdmin();
        const colonna = COLONNA_POOL[pool];
        if (!colonna) return { success: false, error: "Pool sconosciuto." };

        const patch =
            pool === "freschi" ? { acAutoIntake: enabled }
            : pool === "ridati" ? { botReturnIntake: enabled }
            : { freshOverflowScorta: enabled };

        await db.update(users).set(patch).where(and(
            eq(users.companyId, ctx.companyId),
            eq(users.id, gdoUserId),
            eq(users.role, "GDO"),
        ));
        revalidatePath("/gestione");
        return { success: true };
    } catch (e) {
        console.error("[gestione] setGdoPool", e);
        return { success: false, error: "Non sono riuscito a salvare. Riprova." };
    }
}

export async function setDailyFreshCap(
    gdoUserId: string,
    cap: number | null,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { ctx } = await requireAdmin();
        if (cap !== null && (!Number.isInteger(cap) || cap < 0 || cap > 1000)) {
            return { success: false, error: "Il tetto deve essere un numero fra 0 e 1000, oppure vuoto." };
        }
        await db.update(users).set({ dailyFreshCap: cap }).where(and(
            eq(users.companyId, ctx.companyId),
            eq(users.id, gdoUserId),
            eq(users.role, "GDO"),
        ));
        revalidatePath("/gestione");
        return { success: true };
    } catch (e) {
        console.error("[gestione] setDailyFreshCap", e);
        return { success: false, error: "Non sono riuscito a salvare. Riprova." };
    }
}

/**
 * Accende o spegne un account GDO.
 *
 * Spegnere un account NON sposta i suoi lead: se ne ha ancora di aperti
 * resterebbero appesi a un utente che non entra più, e non li lavorerebbe
 * nessuno. È già successo: GDO 108 e GDO 116 erano spenti con 95 lead aperti
 * addosso, scoperti solo il 15/09/2026. Perciò qui il conto dei lead aperti si
 * restituisce SEMPRE al chiamante, che deve mostrarlo e far scegliere dove
 * spostarli prima di procedere.
 */
export async function setGdoActive(
    gdoUserId: string,
    active: boolean,
): Promise<{ success: boolean; error?: string; leadAperti?: number }> {
    try {
        const { ctx } = await requireAdmin();

        if (!active) {
            const [conteggio] = await db.select({
                n: sql<number>`count(*)::int`,
            }).from(leads).where(and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.assignedToId, gdoUserId),
                sql`${leads.status} IN ('NEW', 'IN_PROGRESS')`,
                // Gli scarti di un'infornata anomala non bloccano lo
                // spegnimento: nessun umano deve lavorarli, quindi lasciarli
                // su un account spento non fa perdere niente a nessuno.
                contaNeiKpiSql(),
            ));
            const aperti = conteggio?.n ?? 0;
            if (aperti > 0) {
                return {
                    success: false,
                    leadAperti: aperti,
                    error: `Questo GDO ha ancora ${aperti} lead aperti. Spostali prima di spegnere l'account, altrimenti non li lavora più nessuno.`,
                };
            }
        }

        // Spegnendo l'account lo si toglie anche da tutti i pool: un account
        // spento che resta in un pool è un turno del round-robin che va a vuoto.
        const patch = active
            ? { isActive: true }
            : { isActive: false, acAutoIntake: false, botReturnIntake: false, freshOverflowScorta: false };

        await db.update(users).set(patch).where(and(
            eq(users.companyId, ctx.companyId),
            eq(users.id, gdoUserId),
            eq(users.role, "GDO"),
        ));
        revalidatePath("/gestione");
        return { success: true };
    } catch (e) {
        console.error("[gestione] setGdoActive", e);
        return { success: false, error: "Non sono riuscito a salvare. Riprova." };
    }
}

/**
 * Sposta i lead APERTI (mai chiamati + in lavorazione) da un GDO a un altro.
 * Gli appuntamenti NON si spostano: restano attribuiti a chi li ha fissati,
 * altrimenti storico e KPI di quella persona cambierebbero a posteriori.
 */
export async function spostaLeadAperti(
    daGdoId: string,
    aGdoId: string,
): Promise<{ success: boolean; error?: string; spostati?: number }> {
    try {
        const { id: adminId, ctx } = await requireAdmin();
        if (daGdoId === aGdoId) return { success: false, error: "Origine e destinazione coincidono." };

        const [dest] = await db.select({ id: users.id, isActive: users.isActive })
            .from(users).where(and(
                eq(users.companyId, ctx.companyId),
                eq(users.id, aGdoId),
                eq(users.role, "GDO"),
            )).limit(1);
        if (!dest) return { success: false, error: "GDO di destinazione non trovato." };
        if (!dest.isActive) return { success: false, error: "Il GDO di destinazione è spento: i lead resterebbero fermi." };

        const daSpostare = await db.select({ id: leads.id }).from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.assignedToId, daGdoId),
            sql`${leads.status} IN ('NEW', 'IN_PROGRESS')`,
            // Gli scarti di un'infornata anomala restano dove sono: spostarli
            // vorrebbe dire scaricare migliaia di numeri mai chiamati su un
            // collega, e per decisione PO non tornano ai GDO umani.
            contaNeiKpiSql(),
        ));
        if (daSpostare.length === 0) return { success: true, spostati: 0 };

        const now = new Date();
        const ids = daSpostare.map((l) => l.id);
        await db.transaction(async (tx) => {
            await tx.update(leads)
                .set({ assignedToId: aGdoId, updatedAt: now, version: sql`${leads.version} + 1` })
                .where(sql`${leads.id} = ANY(${ids})`);
            await tx.insert(leadEvents).values(ids.map((leadId) => ({
                id: crypto.randomUUID(),
                leadId,
                eventType: "ASSIGNED" as const,
                userId: aGdoId,
                timestamp: now,
                metadata: { via: "gestione_sposta", da: daGdoId, a: aGdoId, adminId },
                companyId: ctx.companyId,
            })));
        });

        revalidatePath("/gestione");
        return { success: true, spostati: ids.length };
    } catch (e) {
        console.error("[gestione] spostaLeadAperti", e);
        return { success: false, error: "Non sono riuscito a spostare i lead. Riprova." };
    }
}
