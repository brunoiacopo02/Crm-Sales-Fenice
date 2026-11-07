/**
 * Lettura della coorte "App da verificare" di oggi (src/lib/conferme/verificaBot.ts).
 * Fuori dal file "use server" apposta: prende le aziende come argomento, e una server
 * action esportata con quella firma sarebbe chiamabile dal browser con aziende qualsiasi.
 */
import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm"
import { leadDelMondoDiAccount } from "@/lib/prova/sql"
import { dayBoundsRome } from "@/lib/dateUtils"
import { inCoorteVerifica, VERIFICA_FINE_DOPO_CALL_MS } from "@/lib/conferme/verificaBot"

/** Le righe candidate (coorte di oggi) per la sezione e per l'avviso bloccante. */
export async function caricaCoorteVerifica(allowedCompanies: string[], userId: string, now: Date) {
    const { end } = dayBoundsRome(now)
    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        companyId: leads.companyId,
        appointmentDate: leads.appointmentDate,
        confirmationsOutcome: leads.confirmationsOutcome,
        confirmationsTimestamp: leads.confirmationsTimestamp,
        botVerificaApptAt: leads.botVerificaApptAt,
        botVerificaSentAt: leads.botVerificaSentAt,
        botVerificaEsito: leads.botVerificaEsito,
        botVerificaEsitoAt: leads.botVerificaEsitoAt,
        botVerificaRisposta: leads.botVerificaRisposta,
        botVerificaGestitaAt: leads.botVerificaGestitaAt,
        botVerificaSparitoAt: leads.botVerificaSparitoAt,
        salespersonName: users.displayName,
        salespersonRealName: users.name,
        // Avviso bloccante (colonne della 0032, riusate: un lead confermato non ha
        // richiami Conferme aperti, quindi non si pestano i piedi).
        alertSnoozedUntil: leads.confAlertSnoozedUntil,
        claimedById: leads.confAlertClaimedById,
        claimedAt: leads.confAlertClaimedAt,
    })
        .from(leads)
        .leftJoin(users, eq(users.id, leads.salespersonUserId))
        .where(and(
            inArray(leads.companyId, allowedCompanies),
            leadDelMondoDiAccount(userId),
            eq(leads.confirmationsOutcome, "confermato"),
            gte(leads.appointmentDate, new Date(now.getTime() - VERIFICA_FINE_DOPO_CALL_MS)),
            lt(leads.appointmentDate, end),
            isNull(leads.salespersonOutcome),
        ))
        .orderBy(asc(leads.appointmentDate))
        .limit(200)
    return rows.filter(r => inCoorteVerifica(r))
}

