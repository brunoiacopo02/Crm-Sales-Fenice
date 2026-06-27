"use client";

import { useEffect, useState } from "react";
import { X, CheckCircle2 } from "lucide-react";
import {
    CONFERME_DISCARD_REASONS,
    CONFERME_PAIN_POINT_OPTIONS,
    CONFERME_URGENCY_OPTIONS,
    CONFERME_BUDGET_OPTIONS,
} from "@/lib/surveys/questions";
import { saveConfermeSurvey, getConfermeSurveyByLead } from "@/app/actions/surveyActions";

interface Props {
    open: boolean;
    onClose: () => void;
    leadId: string;
    leadName?: string;
    onSaved?: () => void;
}

export function ConfermeSurveyDialog({ open, onClose, leadId, leadName, onSaved }: Props) {
    // --- Parte A ---
    const [remembersAppt, setRemembersAppt] = useState<boolean | null>(null);
    const [watchedVideo, setWatchedVideo] = useState<boolean | null>(null);
    const [works, setWorks] = useState<boolean | null>(null);
    const [confirmed, setConfirmed] = useState<boolean | null>(null);
    // --- Parte B (confirmed === false) ---
    const [whyNot, setWhyNot] = useState<string | null>(null);
    // --- Parte B (confirmed === true) ---
    const [summary, setSummary] = useState<string>("");
    const [painPoints, setPainPoints] = useState<string[]>([]);
    const [urgency, setUrgency] = useState<string | null>(null);
    const [budgetSignal, setBudgetSignal] = useState<string | null>(null);
    const [objections, setObjections] = useState<string>("");
    const [levaConsigliata, setLevaConsigliata] = useState<string>("");
    // --- Meta ---
    const [startedAt, setStartedAt] = useState<number>(0);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [alreadySaved, setAlreadySaved] = useState(false);

    useEffect(() => {
        if (!open) return;
        setStartedAt(Date.now());
        setError(null);
        // Prefill from existing if any
        void (async () => {
            const existing = await getConfermeSurveyByLead(leadId);
            if (existing) {
                setRemembersAppt(existing.remembersAppt);
                setWatchedVideo(existing.watchedVideo);
                setWorks(existing.works ?? null);
                setConfirmed(existing.confirmed);
                setWhyNot(existing.whyNot ?? null);
                setSummary(existing.summary ?? "");
                setPainPoints(existing.painPoints ?? []);
                setUrgency(existing.urgency ?? null);
                setBudgetSignal(existing.budgetSignal ?? null);
                setObjections(existing.objections?.join("\n") ?? "");
                setLevaConsigliata(existing.levaConsigliata ?? "");
                setAlreadySaved(true);
            } else {
                setRemembersAppt(null);
                setWatchedVideo(null);
                setWorks(null);
                setConfirmed(null);
                setWhyNot(null);
                setSummary("");
                setPainPoints([]);
                setUrgency(null);
                setBudgetSignal(null);
                setObjections("");
                setLevaConsigliata("");
                setAlreadySaved(false);
            }
        })();
    }, [open, leadId]);

    if (!open) return null;

    const canSave =
        remembersAppt !== null &&
        watchedVideo !== null &&
        works !== null &&
        confirmed !== null &&
        (confirmed === true
            ? (summary.trim().length > 0 && painPoints.length > 0 && urgency !== null)
            : whyNot !== null);

    const handleSave = async () => {
        if (!canSave) return;
        setSaving(true);
        setError(null);
        const res = await saveConfermeSurvey(leadId, {
            remembersAppt: remembersAppt!,
            watchedVideo: watchedVideo!,
            works: works!,
            confirmed: confirmed!,
            whyNot: confirmed ? null : whyNot,
            summary: confirmed ? summary.trim() : null,
            painPoints: confirmed ? painPoints : [],
            urgency: confirmed ? urgency : null,
            budgetSignal: confirmed ? budgetSignal : null,
            objections: confirmed ? objections.split("\n").map((s) => s.trim()).filter(Boolean) : [],
            levaConsigliata: confirmed ? (levaConsigliata.trim() || null) : null,
            fillDurationMs: Date.now() - startedAt,
        });
        setSaving(false);
        if (!res.success) {
            setError(res.error || "Errore salvataggio");
            return;
        }
        if (onSaved) onSaved();
        onClose();
    };

    const togglePainPoint = (value: string) => {
        setPainPoints((prev) =>
            prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
        );
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={onClose}>
            <div className="absolute inset-0 bg-black/60" />
            <div
                className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-ash-100 bg-gradient-to-r from-brand-orange/5 to-white px-5 py-3">
                    <div>
                        <div className="text-sm font-bold text-ash-900">📋 Scheda Trattativa</div>
                        <div className="text-xs text-ash-500">{leadName || "Lead"}{alreadySaved ? " · Già compilato, puoi aggiornare" : ""}</div>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-ash-100">
                        <X className="h-5 w-5 text-ash-500" />
                    </button>
                </div>

                {/* Body — scrollable for long Part B */}
                <div className="max-h-[70vh] overflow-y-auto">
                    <div className="space-y-4 p-5">
                        {/* ── Parte A ── */}
                        <YesNoRow label="Si ricorda dell'appuntamento?" value={remembersAppt} onChange={setRemembersAppt} />
                        <YesNoRow label="Ha visto il video?" value={watchedVideo} onChange={setWatchedVideo} />
                        <YesNoRow label="Lavora?" value={works} onChange={setWorks} />
                        <YesNoRow
                            label="Ha confermato?"
                            value={confirmed}
                            onChange={(v) => {
                                setConfirmed(v);
                                if (v) setWhyNot(null);
                            }}
                        />

                        {/* ── Parte B — NON confermato ── */}
                        {confirmed === false && (
                            <div>
                                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-brand-orange">Perché no?</div>
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

                        {/* ── Parte B — confermato → briefing venditore ── */}
                        {confirmed === true && (
                            <div className="space-y-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Briefing venditore</div>

                                {/* Riassunto situazione */}
                                <div>
                                    <div className="mb-1.5 text-sm font-semibold text-ash-800">Riassunto situazione <span className="text-brand-orange">*</span></div>
                                    <textarea
                                        value={summary}
                                        onChange={(e) => setSummary(e.target.value)}
                                        rows={3}
                                        placeholder="Descrivi brevemente la situazione del lead…"
                                        className="w-full rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm text-ash-800 placeholder-ash-400 focus:border-brand-orange/60 focus:outline-none focus:ring-1 focus:ring-brand-orange/30"
                                    />
                                </div>

                                {/* Pain points (multi-select) */}
                                <div>
                                    <div className="mb-1.5 text-sm font-semibold text-ash-800">Pain point <span className="text-brand-orange">*</span></div>
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

                                {/* Urgenza (single-select) */}
                                <div>
                                    <div className="mb-1.5 text-sm font-semibold text-ash-800">Urgenza <span className="text-brand-orange">*</span></div>
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

                                {/* Budget (single-select, optional) */}
                                <div>
                                    <div className="mb-1.5 text-sm font-semibold text-ash-800">Segnale budget</div>
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

                                {/* Obiezioni (textarea, una per riga) */}
                                <div>
                                    <div className="mb-1.5 text-sm font-semibold text-ash-800">Obiezioni <span className="text-ash-400 font-normal text-xs">(una per riga)</span></div>
                                    <textarea
                                        value={objections}
                                        onChange={(e) => setObjections(e.target.value)}
                                        rows={3}
                                        placeholder="Es: Non ha tempo adesso&#10;Aspetta lo stipendio"
                                        className="w-full rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm text-ash-800 placeholder-ash-400 focus:border-brand-orange/60 focus:outline-none focus:ring-1 focus:ring-brand-orange/30"
                                    />
                                </div>

                                {/* Leva consigliata (text input) */}
                                <div>
                                    <div className="mb-1.5 text-sm font-semibold text-ash-800">Leva consigliata al venditore</div>
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

                        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-ash-100 bg-ash-50/60 px-5 py-3">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-lg border border-ash-200 bg-white px-4 py-2 text-sm font-medium text-ash-700 hover:bg-ash-50 disabled:opacity-50"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!canSave || saving}
                        className="flex items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-orange-700 disabled:opacity-50"
                    >
                        {saving ? "Salvataggio…" : (<><CheckCircle2 className="h-4 w-4" /> Salva scheda</>)}
                    </button>
                </div>
            </div>
        </div>
    );
}

function YesNoRow({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
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
