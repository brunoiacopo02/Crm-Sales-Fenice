"use client";

import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {
    CONFERME_DISCARD_REASONS,
    CONFERME_PAIN_POINT_OPTIONS,
    CONFERME_URGENCY_OPTIONS,
    CONFERME_BUDGET_OPTIONS,
} from "@/lib/surveys/questions";
import { getConfermeSurveyByLead } from "@/app/actions/surveyActions";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchedaEsitoHandle {
    validate(): boolean;
    getPayload(): {
        remembersAppt: boolean;
        watchedVideo: boolean;
        works: boolean;
        whyNot: string | null;
        summary: string | null;
        painPoints: string[];
        urgency: string | null;
        budgetSignal: string | null;
        objections: string[];
        levaConsigliata: string | null;
    };
    getFillDurationMs(): number;
}

interface Props {
    outcome: "" | "scartato" | "confermato";
    leadId: string;
}

// ─── YesNoRow helper ─────────────────────────────────────────────────────────

function YesNoRow({
    label,
    value,
    onChange,
}: {
    label: string;
    value: boolean | null;
    onChange: (v: boolean) => void;
}) {
    return (
        <div>
            <div className="mb-1.5 text-sm font-semibold text-ash-800">{label}</div>
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => onChange(true)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${value === true ? "border-emerald-500 bg-emerald-500 text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-emerald-400"}`}
                >
                    Sì
                </button>
                <button
                    type="button"
                    onClick={() => onChange(false)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${value === false ? "border-rose-500 bg-rose-500 text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-rose-400"}`}
                >
                    No
                </button>
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const SchedaEsitoInline = forwardRef<SchedaEsitoHandle, Props>(
    function SchedaEsitoInline({ outcome, leadId }, ref) {
        // Parte A
        const [remembersAppt, setRemembersAppt] = useState<boolean | null>(null);
        const [watchedVideo, setWatchedVideo] = useState<boolean | null>(null);
        const [works, setWorks] = useState<boolean | null>(null);

        // Scartato
        const [whyNot, setWhyNot] = useState<string | null>(null);

        // Confermato — briefing
        const [summary, setSummary] = useState("");
        const [painPoints, setPainPoints] = useState<string[]>([]);
        const [urgency, setUrgency] = useState<string | null>(null);
        const [budgetSignal, setBudgetSignal] = useState<string | null>(null);
        const [objections, setObjections] = useState("");
        const [levaConsigliata, setLevaConsigliata] = useState("");

        // Timer — starts on mount, reset when outcome changes
        const startedAtRef = useRef<number>(Date.now());

        // Reset timer whenever the outcome changes (user switches radio)
        useEffect(() => {
            startedAtRef.current = Date.now();
        }, [outcome]);

        // Prefill from existing survey on leadId change
        useEffect(() => {
            if (!leadId) return;
            void (async () => {
                const existing = await getConfermeSurveyByLead(leadId);
                if (existing) {
                    setRemembersAppt(existing.remembersAppt);
                    setWatchedVideo(existing.watchedVideo);
                    setWorks(existing.works ?? null);
                    setWhyNot(existing.whyNot ?? null);
                    setSummary(existing.summary ?? "");
                    setPainPoints(existing.painPoints ?? []);
                    setUrgency(existing.urgency ?? null);
                    setBudgetSignal(existing.budgetSignal ?? null);
                    setObjections(existing.objections?.join("\n") ?? "");
                    setLevaConsigliata(existing.levaConsigliata ?? "");
                } else {
                    // Reset all to empty
                    setRemembersAppt(null);
                    setWatchedVideo(null);
                    setWorks(null);
                    setWhyNot(null);
                    setSummary("");
                    setPainPoints([]);
                    setUrgency(null);
                    setBudgetSignal(null);
                    setObjections("");
                    setLevaConsigliata("");
                }
            })();
        }, [leadId]);

        // Expose handle
        useImperativeHandle(
            ref,
            () => ({
                validate() {
                    // Parte A: tutti i tre campi devono essere non-null
                    if (remembersAppt === null || watchedVideo === null || works === null) {
                        return false;
                    }
                    if (outcome === "confermato") {
                        return (
                            summary.trim().length > 0 &&
                            painPoints.length > 0 &&
                            urgency !== null
                        );
                    }
                    if (outcome === "scartato") {
                        return whyNot !== null;
                    }
                    return false;
                },

                getPayload() {
                    const isConfermato = outcome === "confermato";
                    return {
                        remembersAppt: remembersAppt!,
                        watchedVideo: watchedVideo!,
                        works: works!,
                        whyNot: isConfermato ? null : whyNot,
                        summary: isConfermato ? (summary.trim() || null) : null,
                        painPoints: isConfermato ? painPoints : [],
                        urgency: isConfermato ? urgency : null,
                        budgetSignal: isConfermato ? budgetSignal : null,
                        objections: isConfermato
                            ? objections
                                  .split("\n")
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                            : [],
                        levaConsigliata: isConfermato
                            ? (levaConsigliata.trim() || null)
                            : null,
                    };
                },

                getFillDurationMs() {
                    return Date.now() - startedAtRef.current;
                },
            }),
            [
                outcome,
                remembersAppt,
                watchedVideo,
                works,
                whyNot,
                summary,
                painPoints,
                urgency,
                budgetSignal,
                objections,
                levaConsigliata,
            ],
        );

        const togglePainPoint = (value: string) => {
            setPainPoints((prev) =>
                prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
            );
        };

        // Render nothing when no outcome is selected
        if (!outcome) return null;

        return (
            <div className="mt-4 rounded-xl border border-ash-200 bg-ash-50/60 p-4 space-y-4 animate-in slide-in-from-top-2">
                <div className="text-xs font-bold uppercase tracking-wider text-brand-orange">
                    📋 Scheda Trattativa
                </div>

                {/* ── Parte A ── */}
                <YesNoRow
                    label="Si ricorda dell'appuntamento?"
                    value={remembersAppt}
                    onChange={setRemembersAppt}
                />
                <YesNoRow
                    label="Ha visto il video?"
                    value={watchedVideo}
                    onChange={setWatchedVideo}
                />
                <YesNoRow
                    label="Lavora?"
                    value={works}
                    onChange={setWorks}
                />

                {/* ── Parte B — Scartato ── */}
                {outcome === "scartato" && (
                    <div>
                        <div className="mb-2 text-sm font-semibold text-ash-800">
                            Perché no? <span className="text-brand-orange">*</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {CONFERME_DISCARD_REASONS.map((o) => {
                                const on = whyNot === o.value;
                                return (
                                    <button
                                        key={o.value}
                                        type="button"
                                        onClick={() => setWhyNot(o.value)}
                                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-brand-orange bg-brand-orange text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-brand-orange/60 hover:bg-brand-orange/5"}`}
                                    >
                                        {o.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── Parte B — Confermato → briefing venditore ── */}
                {outcome === "confermato" && (
                    <div className="space-y-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                        <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                            Briefing venditore
                        </div>

                        {/* Riassunto */}
                        <div>
                            <div className="mb-1.5 text-sm font-semibold text-ash-800">
                                Riassunto situazione <span className="text-brand-orange">*</span>
                            </div>
                            <textarea
                                value={summary}
                                onChange={(e) => setSummary(e.target.value)}
                                rows={3}
                                placeholder="Descrivi brevemente la situazione del lead…"
                                className="w-full rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm text-ash-800 placeholder-ash-400 focus:border-brand-orange/60 focus:outline-none focus:ring-1 focus:ring-brand-orange/30"
                            />
                        </div>

                        {/* Pain points (multi) */}
                        <div>
                            <div className="mb-1.5 text-sm font-semibold text-ash-800">
                                Pain point <span className="text-brand-orange">*</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {CONFERME_PAIN_POINT_OPTIONS.map((o) => {
                                    const on = painPoints.includes(o.value);
                                    return (
                                        <button
                                            key={o.value}
                                            type="button"
                                            onClick={() => togglePainPoint(o.value)}
                                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-brand-orange bg-brand-orange text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-brand-orange/60 hover:bg-brand-orange/5"}`}
                                        >
                                            {o.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Urgenza (single) */}
                        <div>
                            <div className="mb-1.5 text-sm font-semibold text-ash-800">
                                Urgenza <span className="text-brand-orange">*</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {CONFERME_URGENCY_OPTIONS.map((o) => {
                                    const on = urgency === o.value;
                                    return (
                                        <button
                                            key={o.value}
                                            type="button"
                                            onClick={() => setUrgency(o.value)}
                                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-brand-orange bg-brand-orange text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-brand-orange/60 hover:bg-brand-orange/5"}`}
                                        >
                                            {o.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Budget (single, optional) */}
                        <div>
                            <div className="mb-1.5 text-sm font-semibold text-ash-800">
                                Segnale budget{" "}
                                <span className="text-ash-400 text-xs font-normal">(opzionale)</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {CONFERME_BUDGET_OPTIONS.map((o) => {
                                    const on = budgetSignal === o.value;
                                    return (
                                        <button
                                            key={o.value}
                                            type="button"
                                            onClick={() => setBudgetSignal(on ? null : o.value)}
                                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-brand-orange bg-brand-orange text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-brand-orange/60 hover:bg-brand-orange/5"}`}
                                        >
                                            {o.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Obiezioni */}
                        <div>
                            <div className="mb-1.5 text-sm font-semibold text-ash-800">
                                Obiezioni{" "}
                                <span className="text-ash-400 text-xs font-normal">(una per riga)</span>
                            </div>
                            <textarea
                                value={objections}
                                onChange={(e) => setObjections(e.target.value)}
                                rows={3}
                                placeholder={"Es: Non ha tempo adesso\nAspetta lo stipendio"}
                                className="w-full rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm text-ash-800 placeholder-ash-400 focus:border-brand-orange/60 focus:outline-none focus:ring-1 focus:ring-brand-orange/30"
                            />
                        </div>

                        {/* Leva consigliata */}
                        <div>
                            <div className="mb-1.5 text-sm font-semibold text-ash-800">
                                Leva consigliata al venditore{" "}
                                <span className="text-ash-400 text-xs font-normal">(opzionale)</span>
                            </div>
                            <input
                                type="text"
                                value={levaConsigliata}
                                onChange={(e) => setLevaConsigliata(e.target.value)}
                                placeholder="Es: punta sulla velocità di rientro economico"
                                className="w-full rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm text-ash-800 placeholder-ash-400 focus:border-brand-orange/60 focus:outline-none focus:ring-1 focus:ring-brand-orange/30"
                            />
                        </div>
                    </div>
                )}
            </div>
        );
    },
);
