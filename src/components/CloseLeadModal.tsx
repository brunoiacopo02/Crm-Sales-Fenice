'use client';

/**
 * Modal "Registra Chiusura" per le quick-action delle Conferme.
 *
 * Quando il Conferme clicca "✅ Chiuso" su un lead nello storico, NON
 * imposta direttamente outcome='Chiuso' — apre questo modal e deve fornire
 * l'importo (€), la data della chiusura e il prodotto venduto. Senza i tre
 * campi lo storico delle chiusure perde precisione (giorno errato,
 * fatturato mancante o mix prodotto sconosciuto), motivo per cui il backend
 * rifiuta l'update. Il prodotto in particolare finiva scritto a mano nelle
 * note libere (es. "pm exc"): ora e' un campo strutturato.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, X, Euro, CalendarDays, Package } from 'lucide-react';

interface Props {
    open: boolean;
    leadName?: string;
    /** Pre-fill importo (es. ricaricamento dopo errore concorrenza). */
    defaultAmount?: number | null;
    onCancel: () => void;
    /** Submit: importo > 0, dateStr 'YYYY-MM-DD' (Europe/Rome) e prodotto. */
    onSubmit: (input: { closeAmountEur: number; closedAtDateStr: string; closeProduct: string }) => Promise<void> | void;
    /**
     * 'diretta' = veste scura delle Conferme (collaudo del 25/10/2026): nella
     * Diretta il testo chiaro ereditato finiva sui campi bianchi e l'importo
     * digitato non si vedeva. Stessi campi, stessi controlli.
     */
    variant?: 'classic' | 'diretta';
}

function todayRomeDateStr(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

export function CloseLeadModal({ open, leadName, defaultAmount, onCancel, onSubmit, variant = 'classic' }: Props) {
    const [amount, setAmount] = useState<string>('');
    const [closedAt, setClosedAt] = useState<string>(todayRomeDateStr());
    const [product, setProduct] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const amountInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setAmount(defaultAmount != null ? String(defaultAmount) : '');
            setClosedAt(todayRomeDateStr());
            setProduct('');
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
        if (!product) {
            setError('Prodotto obbligatorio');
            return;
        }
        setSubmitting(true);
        try {
            await onSubmit({ closeAmountEur: parsed, closedAtDateStr: closedAt, closeProduct: product });
        } catch (e: any) {
            setError(e?.message || 'Errore imprevisto');
        } finally {
            setSubmitting(false);
        }
    };

    if (variant === 'diretta') {
        const campo = "h-11 w-full rounded-lg border-2 border-[#3D3D3D] bg-[#171717] px-3 text-[15px] text-[#F2F2F2] [color-scheme:dark] placeholder:text-[#8C8C8C] focus:border-[#FF9330] focus:outline-none"
        const etichetta = "mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[#BFBFBF]"
        return (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="registra-chiusura-titolo"
                    className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-[#3D3D3D] bg-[#262626] text-[#F2F2F2]"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between gap-3 px-5 pt-5">
                        <h2 id="registra-chiusura-titolo" className="text-[18px] font-semibold leading-tight">
                            Registra la <span className="text-[#FF9330]">chiusura</span>
                        </h2>
                        <button type="button" onClick={onCancel} className="rounded-lg p-1.5 text-[#BFBFBF] transition-colors hover:text-[#F2F2F2]" aria-label="Chiudi">
                            <X className="h-5 w-5" strokeWidth={1.5} />
                        </button>
                    </div>

                    <div className="space-y-4 p-5">
                        {leadName && (
                            <div className="text-[14px] text-[#BFBFBF]">
                                Lead: <span className="font-semibold text-[#F2F2F2]">{leadName}</span>
                            </div>
                        )}
                        <div className="text-[13px] leading-relaxed text-[#BFBFBF]">
                            Il lead conta come chiuso nel giorno indicato. Importo, data e prodotto sono obbligatori.
                        </div>

                        <div>
                            <label htmlFor="chiusura-importo" className={etichetta}>
                                <Euro className="h-3.5 w-3.5" strokeWidth={1.5} /> Importo in euro
                            </label>
                            <input
                                id="chiusura-importo"
                                ref={amountInputRef}
                                type="number"
                                min="0"
                                step="50"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                                placeholder="es. 1500"
                                className={`${campo} font-semibold tabular-nums`}
                            />
                        </div>

                        <div>
                            <label htmlFor="chiusura-data" className={etichetta}>
                                <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.5} /> Data della chiusura
                            </label>
                            <input
                                id="chiusura-data"
                                type="date"
                                value={closedAt}
                                onChange={e => setClosedAt(e.target.value)}
                                max={todayRomeDateStr()}
                                className={`${campo} tabular-nums`}
                            />
                            <div className="mt-1 text-[12px] text-[#8C8C8C]">Oggi, se non è avvenuta in un giorno precedente.</div>
                        </div>

                        <div>
                            <label htmlFor="chiusura-prodotto" className={etichetta}>
                                <Package className="h-3.5 w-3.5" strokeWidth={1.5} /> Prodotto venduto
                            </label>
                            <select
                                id="chiusura-prodotto"
                                value={product}
                                onChange={e => setProduct(e.target.value)}
                                className={`${campo} font-medium`}
                            >
                                <option value="">Scegli il prodotto</option>
                                <option value="advance">Advance</option>
                                <option value="gold">Gold</option>
                                <option value="exclusive">Exclusive</option>
                            </select>
                        </div>

                        {error && (
                            <div role="alert" className="rounded-lg border-2 border-[#FF9330] px-3 py-2 text-[13px] font-medium text-[#F2F2F2]">
                                {error}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 px-5 pb-5">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={submitting}
                            className="h-10 rounded-lg px-4 text-[14px] font-medium text-[#BFBFBF] transition-colors hover:text-[#F2F2F2] disabled:opacity-50"
                        >
                            Annulla
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#FF9330] px-4 text-[14px] font-semibold text-[#171717] transition-colors hover:bg-[#FFA552] disabled:opacity-50"
                        >
                            <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
                            {submitting ? 'Salvataggio' : 'Conferma la chiusura'}
                        </button>
                    </div>
                </div>
            </div>
        )
    }

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
                        Il lead verrà contato come <strong>chiuso nel giorno qui indicato</strong>. Importo,
                        data e prodotto sono tutti obbligatori per garantire l'accuratezza dello storico.
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

                    <div>
                        <label className="text-xs font-bold text-ash-600 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                            <Package className="h-3.5 w-3.5" /> Prodotto venduto
                        </label>
                        <select
                            value={product}
                            onChange={e => setProduct(e.target.value)}
                            className="w-full h-11 rounded-lg border border-ash-200 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                        >
                            <option value="">Seleziona prodotto…</option>
                            <option value="advance">Advance</option>
                            <option value="gold">Gold</option>
                            <option value="exclusive">Exclusive</option>
                        </select>
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
