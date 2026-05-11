// Stato del timer Conferme persistito tra refresh tab.
// Singolo timer attivo per tab — chi è running, e da quando.

const SS_KEY = "conferme_call_timer_v1";

// Timer "running" piu vecchio di questa soglia viene considerato abbandonato
// (es. operatore ha scartato il lead senza fermarlo, poi e tornato il giorno dopo
// e si trovava il pulsante bloccato su tutti gli altri lead per isRunningElsewhere).
const STALE_RUNNING_MS = 60 * 60 * 1000; // 60 minuti

export type TimerState =
    | { status: "idle" }
    | { status: "running"; leadId: string; startedAt: number }
    | { status: "stopped"; leadId: string; durationSeconds: number };

export function readTimerState(): TimerState {
    if (typeof window === "undefined") return { status: "idle" };
    try {
        const raw = window.sessionStorage.getItem(SS_KEY);
        if (!raw) return { status: "idle" };
        const parsed = JSON.parse(raw) as TimerState;
        if (parsed.status === "running") {
            const age = Date.now() - (parsed.startedAt || 0);
            if (!Number.isFinite(parsed.startedAt) || age < 0 || age > STALE_RUNNING_MS) {
                // Timer abbandonato: ripuliamo lo stato e ritorniamo idle.
                window.sessionStorage.removeItem(SS_KEY);
                return { status: "idle" };
            }
            return parsed;
        }
        if (parsed.status === "stopped" || parsed.status === "idle") {
            return parsed;
        }
        return { status: "idle" };
    } catch {
        return { status: "idle" };
    }
}

export function writeTimerState(s: TimerState) {
    if (typeof window === "undefined") return;
    if (s.status === "idle") {
        window.sessionStorage.removeItem(SS_KEY);
    } else {
        window.sessionStorage.setItem(SS_KEY, JSON.stringify(s));
    }
    window.dispatchEvent(new CustomEvent("conferme-timer-changed"));
}

/** Chiamata da bottoni azione rapida (NR / outcome / snooze / recall): se per QUESTO lead
 * il timer è running o stopped non-loggato, ritorna la durata in secondi e azzera lo state.
 * Usato come "safety stop" prima di eseguire l'azione. */
export function consumeTimerForLead(leadId: string): { durationSeconds: number } | null {
    const s = readTimerState();
    let duration: number | null = null;
    if (s.status === "running" && s.leadId === leadId) {
        duration = Math.max(0, Math.floor((Date.now() - s.startedAt) / 1000));
    } else if (s.status === "stopped" && s.leadId === leadId) {
        duration = s.durationSeconds;
    }
    if (duration === null) return null;
    writeTimerState({ status: "idle" });
    return { durationSeconds: duration };
}

/** Helper condiviso fra ConfermeBoardRow e ConfermeDrawer: ferma il timer per
 *  il lead (se attivo) e logga la durata. Da chiamare PRIMA della server action
 *  (NR / outcome / snooze / recall). Silenzia errori di logging perche non
 *  devono mai bloccare l'azione utente. */
export async function stopTimerAndLogForLead(
    leadId: string,
    actionTaken: 'nr' | 'outcome' | null
): Promise<void> {
    const consumed = consumeTimerForLead(leadId);
    if (!consumed) return;
    try {
        const { logConfermeCallDuration } = await import("@/app/actions/confermeAnalyticsActions");
        await logConfermeCallDuration(leadId, consumed.durationSeconds, { actionTaken });
    } catch (err) {
        console.error("stopTimerAndLogForLead err:", err);
    }
}
