/**
 * Avviso bloccante sui richiami Conferme — regola di selezione.
 *
 * Spec: docs/superpowers/specs/2026-08-31-avviso-bloccante-richiami-conferme-design.md
 *
 * Il "chi vede cosa" è tutto qui dentro, puro e testabile: la server action si
 * limita a portare le righe candidate dal DB e a scrivere i timestamp. Ogni
 * operatore Conferme fa la sua valutazione sugli stessi dati, quindi la stessa
 * riga può essere invisibile a me (l'ha claimata un collega) e visibile a lui.
 *
 * I richiami delle Conferme sono di due tipi e l'avviso li tratta allo stesso
 * modo (2026-09-02: i "parcheggiati" non suonavano affatto):
 *  - `snooze`       → "risentire dopo" in giornata, su `leads.confSnoozeAt`;
 *  - `parcheggiato` → il badge blu, su `leads.recallDate` + `confNeedsReschedule`,
 *                     con l'appuntamento tolto in attesa di essere rifissato.
 */

export type AlertKind = 'snooze' | 'parcheggiato'

export type AlertCandidate = {
    id: string
    name: string
    phone: string | null
    companyId: string
    /** Che tipo di richiamo è: cambia solo l'etichetta a schermo. */
    kind: AlertKind
    /** Quando era previsto il richiamo (confSnoozeAt oppure recallDate). */
    dueAt: Date
    notes: string | null
    /** Silenzio globale da "Snooze 2 min". */
    alertSnoozedUntil: Date | null
    /** Chi ha premuto "Lo chiamo io". */
    claimedById: string | null
    claimedAt: Date | null
    /** Qualcuno ha aperto la scheda: spento per tutti. */
    handledAt: Date | null
}

/** Un claim non gestito decade dopo 10 minuti e il richiamo torna a tutti. */
export const CLAIM_TTL_MS = 10 * 60_000

/** "Snooze": silenzio per tutti, poi l'avviso si ripresenta. */
export const SNOOZE_MS = 2 * 60_000

/**
 * Oltre questa soglia il richiamo è archeologia: non deve bloccare lo schermo di
 * nessuno (in prod ne esistevano 3 fermi da aprile). Resta comunque nei board.
 */
export const STALE_CUTOFF_DAYS = 7

export type BlockingAlertResult = {
    /** Il richiamo da mostrare a schermo pieno, o null se non c'è niente da fare. */
    alert: AlertCandidate | null
    /** Quanti richiami questo utente ha in coda (l'avviso incluso). */
    queueTotal: number
    /**
     * Primo istante futuro in cui la risposta cambierebbe da sola (fine snooze o
     * scadenza claim): il client ci arma un timer e riaccende l'overlay al
     * secondo giusto, senza polling stretto. Null se un avviso è già visibile.
     */
    nextWakeAt: Date | null
}

export function selectBlockingAlert(
    rows: AlertCandidate[],
    opts: { now: Date; userId: string },
): BlockingAlertResult {
    const nowMs = opts.now.getTime()
    const staleFloorMs = nowMs - STALE_CUTOFF_DAYS * 86_400_000

    const visible: AlertCandidate[] = []
    const wakeUps: number[] = []

    const ordered = [...rows].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())

    for (const row of ordered) {
        const dueMs = row.dueAt.getTime()

        // Gestito: qualcuno ha aperto la scheda DOPO che il richiamo era
        // scaduto. Un "gestito" più vecchio della scadenza è di una tornata
        // precedente (tipico dei parcheggiati: scheda aperta ieri, richiamo
        // programmato per domani) e non deve spegnere il richiamo di adesso.
        if (row.handledAt && row.handledAt.getTime() >= dueMs) continue

        if (dueMs < staleFloorMs) continue
        if (dueMs > nowMs) {
            // Non ancora scaduto: sveglia all'orario del richiamo.
            wakeUps.push(dueMs)
            continue
        }

        const claimUntilMs = row.claimedById && row.claimedAt
            ? row.claimedAt.getTime() + CLAIM_TTL_MS
            : 0
        if (row.claimedById && row.claimedById !== opts.userId && claimUntilMs > nowMs) {
            // Se lo sta prendendo un collega, per me sparisce fino alla scadenza.
            wakeUps.push(claimUntilMs)
            continue
        }

        const snoozedUntilMs = row.alertSnoozedUntil ? row.alertSnoozedUntil.getTime() : 0
        if (snoozedUntilMs > nowMs) {
            wakeUps.push(snoozedUntilMs)
            continue
        }

        visible.push(row)
    }

    if (visible.length > 0) {
        return { alert: visible[0], queueTotal: visible.length, nextWakeAt: null }
    }

    return {
        alert: null,
        queueTotal: 0,
        nextWakeAt: wakeUps.length > 0 ? new Date(Math.min(...wakeUps)) : null,
    }
}
