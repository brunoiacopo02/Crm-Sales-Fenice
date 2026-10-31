// Il lead che riscrive al bot dopo essere stato restituito (PO 29/10/2026).
//
// Quando un lead risponde dopo il NON_RISPOSTO, il bot riapre la chat, gli risponde e
// manda al CRM una NOTA "IL BOT HA RIPRESO LA CHAT — ... Non chiamatelo a mano finché
// non vi arriva un nuovo esito dal bot". Ma il nuovo esito non arriva mai: il cron del
// bot (bot-followups, blocco 2b "mai riclassificare") richiude la chat che ha già un
// esito, senza mandare altro. Intanto il CRM aveva parcheggiato il lead (mai risposto,
// PO 19/10): nessuno lo chiama più. Dal 21 al 29/10 sono rimasti fermi così chat in cui
// la persona aveva scritto (Anjeza, Eufrasia, Azzato...).
//
// Correzione: quella nota, su un lead aperto che non è di nessuno, lo manda subito al
// giro dei ridati come chat interrotta (stella "Chiama per primo"). Sui lead che hanno
// un appuntamento, uno scarto, o sono del lancio, la nota resta solo una nota.
// Dal 31/10 sui lead che hanno già una persona come assegnatario la nota non si scrive
// proprio (vedi `ripresaSuLeadDiUnaPersona`).

import { BATCH_SENSO_UNICO } from '@/lib/intakeBatch'
import { LANCIO_BUCKET, LANCIO_FUNNEL } from '@/lib/lancio/intake'

const RIPRESO = /^\W*il bot ha ripreso la chat\b/i

/** La NOTA del bot che dice "il lead ha riscritto e ho riaperto la chat". */
export function isNotaBotRipreso(nota: string | null | undefined): boolean {
    return !!nota && RIPRESO.test(nota.trim())
}

export interface LeadPerRipresa {
    assignedToId: string | null
    status: string
    appointmentDate: Date | null
    presentedAt: Date | null
    launchBucket: string | null
    funnel: string | null
    lancioPool: string | null
    humanTestCohort: string | null
    isTest: boolean
    intakeBatch: string | null
}

/**
 * La nota "ripreso" su un lead che è già di una persona (PO 31/10/2026: «il bot non deve
 * lasciare note ai GDO, devono chiamarli e basta»). Il lead è del GDO: il CRM risponde ok
 * al bot e non scrive niente — né evento, né nota, né notifica, né il report.
 * Senza assegnatario o sull'account bot si va avanti come prima.
 */
export function ripresaSuLeadDiUnaPersona(
    nota: string | null | undefined,
    assignedToId: string | null,
    assigneeIsBot: boolean,
): boolean {
    return isNotaBotRipreso(nota) && !!assignedToId && !assigneeIsBot
}

/** Il lead che ha riscritto va dato a un GDO? Solo se è aperto e non è di nessuno. */
export function ripresaVaAlGdo(l: LeadPerRipresa): boolean {
    if (l.assignedToId) return false
    if (l.status !== 'NEW' && l.status !== 'IN_PROGRESS') return false
    if (l.appointmentDate || l.presentedAt) return false
    if (l.isTest) return false
    if (l.launchBucket === LANCIO_BUCKET || l.funnel === LANCIO_FUNNEL || l.lancioPool || l.humanTestCohort) return false
    if (l.intakeBatch && BATCH_SENSO_UNICO.includes(l.intakeBatch)) return false
    return true
}
