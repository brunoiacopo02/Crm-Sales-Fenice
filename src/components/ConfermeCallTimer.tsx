"use client"
import { useEffect, useRef, useState } from "react"
import { Play, Square } from "lucide-react"
import { readTimerState, writeTimerState, type TimerState } from "@/lib/confermeCallTimer"

interface Props {
    leadId: string;
    disabled?: boolean;
}

function fmtMMSS(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function ConfermeCallTimer({ leadId, disabled }: Props) {
    const [state, setState] = useState<TimerState>({ status: "idle" });
    const [tick, setTick] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Carica stato iniziale e abbonati ai cambi globali (altri tab/componenti).
    useEffect(() => {
        setState(readTimerState());
        const onChange = () => setState(readTimerState());
        window.addEventListener("conferme-timer-changed", onChange);
        return () => window.removeEventListener("conferme-timer-changed", onChange);
    }, []);

    // Tick ogni secondo solo se in running per QUESTO lead.
    useEffect(() => {
        if (state.status === "running" && state.leadId === leadId) {
            intervalRef.current = setInterval(() => setTick(t => t + 1), 1000);
            return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
        }
    }, [state, leadId]);

    const isRunningHere = state.status === "running" && state.leadId === leadId;
    const isStoppedHere = state.status === "stopped" && state.leadId === leadId;
    const isRunningElsewhere = state.status === "running" && state.leadId !== leadId;

    let label = "Avvia chiamata";
    let elapsed = 0;
    if (isRunningHere) {
        elapsed = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
        label = `${fmtMMSS(elapsed)} Ferma`;
    } else if (isStoppedHere) {
        elapsed = state.durationSeconds;
        label = `${fmtMMSS(elapsed)} Avvia`;
    }

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isRunningHere) {
            const seconds = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
            writeTimerState({ status: "stopped", leadId, durationSeconds: seconds });
        } else {
            // Avvia (anche se c'era running su altro lead: lo sovrascriviamo, tipico caso "ho cambiato lead senza fermare").
            writeTimerState({ status: "running", leadId, startedAt: Date.now() });
        }
    };

    const baseClasses = "border px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all duration-200 z-10 disabled:opacity-50 shadow-soft hover:shadow-card flex items-center gap-1";
    const colorClasses = isRunningHere
        ? "bg-rose-50 hover:bg-rose-100 border-rose-300 text-rose-700"
        : isStoppedHere
            ? "bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-700"
            : "bg-white hover:bg-sky-50 border-ash-200 hover:border-sky-300 text-ash-500 hover:text-sky-600";

    return (
        <button
            onClick={handleClick}
            disabled={disabled || isRunningElsewhere}
            title={isRunningElsewhere ? "Timer attivo su un altro lead — fermalo prima" : undefined}
            className={`${baseClasses} ${colorClasses}`}
        >
            {isRunningHere ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {label}
        </button>
    );
}
