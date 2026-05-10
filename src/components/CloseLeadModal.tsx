'use client';

/**
 * Modal "Registra Chiusura" per le quick-action delle Conferme.
 *
 * Quando il Conferme clicca "✅ Chiuso" su un lead nello storico, NON
 * imposta direttamente outcome='Chiuso' — apre questo modal e deve fornire
 * sia l'importo (€) sia la data della chiusura. Senza i due campi
 * lo storico delle chiusure perde precisione (giorno errato o
 * fatturato mancante), motivo per cui il backend rifiuta l'update.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, X, Euro, CalendarDays } from 'lucide-react';

interface Props {
    open: boolean;
    leadName?: string;
    /** Pre-fill importo (es. ricaricamento dopo errore concorrenza). */
    defaultAmount?: number | null;
    onCancel: () => void;
    /** Submit: importo > 0 e dateStr 'YYYY-MM-DD' (Europe/Rome). */
    onSubmit: (input: { closeAmountEur: number; closedAtDateStr: string }) => Promise<void> | void;
}

function todayRomeDateStr(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

export function CloseLeadModal({ open, leadName, defaultAmount, onCancel, onSubmit }: Props) {
    const [amount, setAmount] = useState<string>('');
    const [closedAt, setClosedAt] = useState<string>(todayRomeDateStr());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const amountInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setAmount(defaultAmount != null ? String(defaultAmount) : '');
            setClosedAt(todayRomeDateStr());
            setError(null);
            setSubmitting(false);
            // autofocus on amount
            setTimeout(() => amountInputRef.current?.focus(), 50);
        }
    }, [open, defaultAmount]);

    if (!open) return null;

    const handleSubmit = async () => {
        setError(null);
        const parsed = parseFloat(amount.replace(',', '.'));
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setError('Importo obbligatorio (> 0)');
            return;
        }
        if (!closedAt || !/^\d{4}-\d{2}-\d{2}$/.test(closedAt)) {
            setError('Data chiusura obbligatoria');
            return;
        }
        setSubmitting(true);
        try {
            await onSubmit({ closeAmountEur: parsed, closedAtDateStr: closedAt });
        } catch (e: any) {
            setError(e?.message || 'Errore imprevisto');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center animate-fade-in p-4"
            onClick={onCancel}
        >
            <div
                className="w-full max-w-md bg-white rounded-2xl shadow-elevated border border-ash-200/60 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5" />
                        <h2 className="font-bold text-lg">Registra Chiusura</h2>
                    </div>
                    <button
                        onClick={onCancel}
                        className="rounded-lg p-1 hover:bg-white/10 transition-colors"
                        aria-label="Chiudi"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {leadName && (
                        <div className="text-xs text-ash-500">
                            Lead: <span className="font-semibold text-ash-800">{leadName}</span>
                        </div>
                    )}

                    <div className="text-xs text-ash-600 bg-emerald-50 border border-emerald-200 rounded-lg p-3 leading-relaxed">
                        Il lead verrà contato come <strong>chiuso nel giorno qui indicato</strong>. Importo
                        e data sono entrambi obbligatori per garantire l'accuratezza dello storico.
                    </div>

                    <div>
                        <label className="text-xs font-bold text-ash-600 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                            <Euro className="h-3.5 w-3.5" /> Importo (€)
                        </label>
                        <input
                            ref={amountInputRef}
                            type="number"
                            min="0"
                            step="50"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleSubmit();
                            }}
                            placeholder="es. 1500"
                            className="w-full h-11 rounded-lg border border-ash-200 bg-white px-3 py-2 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-ash-600 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                            <CalendarDays className="h-3.5 w-3.5" /> Data chiusura
                        </label>
                        <input
                            type="date"
                            value={closedAt}
                            onChange={e => setClosedAt(e.target.value)}
                            max={todayRomeDateStr()}
                            className="w-full h-11 rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                        />
                        <p className="mt-1 text-[11px] text-ash-500">
                            Default: oggi. Modifica solo se la chiusura è avvenuta in un giorno precedente.
                        </p>
                    </div>

                    {error && (
                        <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2.5 font-medium">
                            {error}
                        </div>
                    )}
                </div>

                <div className="bg-ash-50/60 border-t border-ash-200/60 px-5 py-3 flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        disabled={submitting}
                        className="px-4 h-9 text-sm font-semibold text-ash-600 hover:bg-ash-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                        Annulla
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="px-4 h-9 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                        <CheckCircle2 className="h-4 w-4" />
                        {submitting ? 'Salvataggio…' : 'Conferma Chiusura'}
                    </button>
                </div>
            </div>
        </div>
    );
}
