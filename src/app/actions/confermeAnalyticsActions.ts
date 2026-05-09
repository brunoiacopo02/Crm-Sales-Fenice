"use server"
import { createClient } from "@/utils/supabase/server"
import { db } from "@/db"
import { leads, leadEvents } from "@/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"

/**
 * Persiste la durata di una chiamata Conferme.
 * - actionTaken='nr': la durata viene scritta sullo slot del NR appena registrato (callsMade dopo l'azione = N → scrive su confCallNDuration).
 * - actionTaken='outcome': la durata viene scritta sul "tentativo di risposta" = confCall(N+1)Duration dove N=NR esistenti, marcata answered=true nell'event log.
 * - actionTaken=null: durata "orfana" (timer fermato senza azione rapida). Solo event log.
 *
 * Non usa version-check stretto sul lead per evitare race con l'azione rapida che ha appena
 * incrementato la version: aggiorna i soli campi confCall*Duration in modo idempotente.
 */
export async function logConfermeCallDuration(
    leadId: string,
    durationSeconds: number,
    opts: { actionTaken: 'nr' | 'outcome' | null }
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            return { success: false, error: "Unauthorized" };
        }

        if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
            return { success: false, error: "Invalid duration" };
        }

        const lead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0];
        if (!lead) return { success: false, error: "Lead not found" };

        const callsMade =
            (lead.confCall3At ? 3 : lead.confCall2At ? 2 : lead.confCall1At ? 1 : 0);

        let slot: 1 | 2 | 3 | null = null;
        let answered: boolean | null = null;

        if (opts.actionTaken === 'nr') {
            // L'azione rapida NR ha appena incrementato il count → la durata va sullo slot corrispondente.
            // callsMade qui è già post-NR perché confermeActions ha già aggiornato il lead.
            if (callsMade >= 1 && callsMade <= 3) {
                slot = callsMade as 1 | 2 | 3;
                answered = false;
            }
        } else if (opts.actionTaken === 'outcome') {
            // Risposta: scriviamo sullo slot del "tentativo che ha portato all'outcome".
            // = primo slot null = callsMade + 1 (capped a 3).
            const target = Math.min(callsMade + 1, 3) as 1 | 2 | 3;
            slot = target;
            answered = true;
        }

        // Update field if slot determined
        if (slot !== null) {
            const colName =
                slot === 1 ? 'confCall1Duration'
                : slot === 2 ? 'confCall2Duration'
                : 'confCall3Duration';
            const patch: Record<string, number> = { [colName]: Math.round(durationSeconds) };
            await db.update(leads).set(patch).where(eq(leads.id, leadId));
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "conferme_call_logged",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: {
                durationSeconds: Math.round(durationSeconds),
                slot,
                answered,
                actionTaken: opts.actionTaken,
            },
        });

        return { success: true };
    } catch (e: any) {
        console.error("logConfermeCallDuration error:", e);
        return { success: false, error: e?.message || "INTERNAL_ERROR" };
    }
}
