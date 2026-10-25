"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { GDO_EARLY_EXIT_REASONS } from "@/lib/surveys/questions";

interface Props {
    open: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void | Promise<void>;
    saving?: boolean;
    /** 'diretta' = veste scura del GDO (collaudo del 25/10/2026): stessi motivi, stesso salvataggio. */
    variant?: "diretta";
}

export function GdoEarlyExitDialog({ open, onClose, onConfirm, saving, variant }: Props) {
    const [reason, setReason] = useState<string | null>(null);

    if (!open) return null;

    const handleConfirm = async () => {
        if (!reason) return;
        await onConfirm(reason);
    };

    if (variant === "diretta") {
        // Colori scritti per esteso: la classe .fixed nella Diretta rimette la palette chiara.
        return (
            <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose}>
                <div className="absolute inset-0 bg-black/70" />
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Chiudi script prima della fine"
                    className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border-2 border-[#262626] bg-[#171717] font-[family-name:var(--font-poppins)] text-[#F2F2F2] [color-scheme:dark]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
                        <div className="min-w-0">
                            <div className="text-[17px] font-semibold">Chiudi script prima della fine</div>
                            <div className="mt-0.5 text-[13px] text-[#BFBFBF]">Salviamo le risposte raccolte finora</div>
                        </div>
                        <button type="button" onClick={onClose} aria-label="Chiudi" className="rounded-lg p-1.5 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]">
                            <X className="h-5 w-5" strokeWidth={1.5} />
                        </button>
                    </div>
                    <div className="px-5 pb-5 pt-2">
                        <div className="mb-3 text-[14px] text-[#BFBFBF]">
                            Perché non hai potuto completare lo script con questo lead?
                        </div>
                        <div className="space-y-2">
                            {GDO_EARLY_EXIT_REASONS.map((r) => {
                                const on = reason === r.value;
                                return (
                                    <button
                                        key={r.value}
                                        type="button"
                                        onClick={() => setReason(r.value)}
                                        aria-pressed={on}
                                        className={`w-full rounded-lg border-2 px-4 py-2.5 text-left text-[14px] font-medium transition-colors ${on ? "border-[#FF9330] text-[#F2F2F2]" : "border-[#3D3D3D] text-[#F2F2F2] hover:border-[#8C8C8C]"}`}
                                    >
                                        {r.label}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-lg px-4 py-2 text-[14px] font-medium text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]"
                                disabled={saving}
                            >
                                Annulla
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirm}
                                disabled={!reason || saving}
                                className="rounded-lg bg-[#FF9330] px-4 py-2 text-[14px] font-semibold text-[#171717] transition-colors disabled:opacity-40"
                            >
                                {saving ? "Salvataggio…" : "Conferma e salva"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose}>
            <div className="absolute inset-0 bg-black/60" />
            <div
                className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-ash-100 bg-gradient-to-r from-amber-50 to-white px-5 py-3">
                    <div>
                        <div className="text-sm font-bold text-ash-900">Chiudi script prima della fine</div>
                        <div className="text-xs text-ash-500">Salviamo le risposte raccolte finora</div>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-ash-100">
                        <X className="h-5 w-5 text-ash-500" />
                    </button>
                </div>
                <div className="p-5">
                    <div className="mb-3 text-sm text-ash-700">
                        Perché non hai potuto completare lo script con questo lead?
                    </div>
                    <div className="space-y-2">
                        {GDO_EARLY_EXIT_REASONS.map((r) => {
                            const on = reason === r.value;
                            return (
                                <button
                                    key={r.value}
                                    type="button"
                                    onClick={() => setReason(r.value)}
                                    className={`w-full rounded-xl border px-4 py-2.5 text-left text-sm font-medium transition-colors ${on ? "border-brand-orange bg-brand-orange/10 text-brand-orange-700" : "border-ash-200 bg-white text-ash-700 hover:border-brand-orange/60 hover:bg-brand-orange/5"}`}
                                >
                                    {r.label}
                                </button>
                            );
                        })}
                    </div>
                    <div className="mt-5 flex items-center justify-end gap-2">
                        <button
                            onClick={onClose}
                            className="rounded-lg border border-ash-200 bg-white px-4 py-2 text-sm font-medium text-ash-700 hover:bg-ash-50"
                            disabled={saving}
                        >
                            Annulla
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={!reason || saving}
                            className="rounded-lg bg-brand-orange px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-orange-700 disabled:opacity-50"
                        >
                            {saving ? "Salvataggio…" : "Conferma e salva"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
