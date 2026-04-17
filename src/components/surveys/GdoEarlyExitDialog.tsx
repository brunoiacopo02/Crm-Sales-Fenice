"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { GDO_EARLY_EXIT_REASONS } from "@/lib/surveys/questions";

interface Props {
    open: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void | Promise<void>;
    saving?: boolean;
}

export function GdoEarlyExitDialog({ open, onClose, onConfirm, saving }: Props) {
    const [reason, setReason] = useState<string | null>(null);

    if (!open) return null;

    const handleConfirm = async () => {
        if (!reason) return;
        await onConfirm(reason);
    };

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
