"use client"
import { useEffect, useState } from "react"
import { AlertCircle, X } from "lucide-react"
import { readTimerState, writeTimerState, type TimerState } from "@/lib/confermeCallTimer"

function fmtMMSS(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

interface Props {
    /** Lista lead correntemente visibili: usata per mostrare il nome se il
     *  timer punta a un lead ancora in vista. */
    visibleLeads?: Array<{ id: string; name?: string | null }>;
}

/** Banner sticky che mostra un timer Conferme attivo quando il lead non e' piu'
 *  raggiungibile dalla board (esitato, snoozato fuori vista, filtro cambiato).
 *  Permette di annullarlo senza loggare la durata, evitando che gonfi le
 *  metriche di tempo medio chiamata. */
export function ConfermeActiveTimerBanner({ visibleLeads }: Props) {
    const [state, setState] = useState<TimerState>({ status: "idle" });
    const [, setTick] = useState(0);

    useEffect(() => {
        setState(readTimerState());
        const onChange = () => setState(readTimerState());
        window.addEventListener("conferme-timer-changed", onChange);
        // Re-leggi lo stato al focus della tab (cleanup stale eventualmente scattato)
        window.addEventListener("focus", onChange);
        return () => {
            window.removeEventListener("conferme-timer-changed", onChange);
            window.removeEventListener("focus", onChange);
        };
    }, []);

    useEffect(() => {
        if (state.status !== "running") return;
        const id = setInterval(() => {
            // Forza re-render per il counter live e ri-legge per beccare il cleanup stale.
            setTick(t => t + 1);
            const fresh = readTimerState();
            if (fresh.status !== state.status || (fresh.status === "running" && fresh.leadId !== state.leadId)) {
                setState(fresh);
            }
        }, 1000);
        return () => clearInterval(id);
    }, [state]);

    if (state.status !== "running") return null;

    const elapsed = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
    const matchingLead = visibleLeads?.find(l => l.id === state.leadId);
    const isOrphan = !matchingLead;

    const handleCancel = () => {
        // IMPORTANTE: pulisce senza loggare. La durata non finisce nelle metriche
        // di analytics (logConfermeCallDuration non viene chiamato), quindi il
        // lead "abbandonato" non gonfia il conteggio generale.
        writeTimerState({ status: "idle" });
    };

    return (
        <div className={`sticky top-0 z-30 mb-2 rounded-xl border px-3 py-2 flex items-center justify-between shadow-soft animate-fade-in ${isOrphan ? "bg-gradient-to-r from-ember-50 to-rose-50 border-ember-300" : "bg-gradient-to-r from-sky-50 to-cyan-50 border-sky-200"}`}>
            <div className="flex items-center gap-2 text-[13px]">
                <AlertCircle className={`w-4 h-4 ${isOrphan ? "text-ember-600" : "text-sky-600"}`} />
                <span className={`font-bold ${isOrphan ? "text-ember-700" : "text-sky-700"}`}>
                    Timer chiamata attivo · {fmtMMSS(elapsed)}
                </span>
                <span className="text-ash-500">
                    {matchingLead
                        ? <>su <span className="font-semibold text-ash-700">{matchingLead.name || "lead in board"}</span></>
                        : <>il lead non e' piu' in vista — fermalo per sbloccare gli altri</>}
                </span>
            </div>
            <button
                onClick={handleCancel}
                title="Pulisce il timer senza loggare la durata (non conta nelle statistiche)"
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all shadow-soft hover:shadow-card ${isOrphan ? "bg-white hover:bg-ember-100 border-ember-300 text-ember-700" : "bg-white hover:bg-sky-100 border-sky-300 text-sky-700"}`}
            >
                <X className="w-3 h-3" /> Annulla timer
            </button>
        </div>
    );
}
