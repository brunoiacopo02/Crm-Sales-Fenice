"use client";

import {
    SALES_PROBLEM_SIGNAL_OPTIONS,
    SALES_URGENCY_SIGNAL_OPTIONS,
    SALES_PRICE_REACTION_OPTIONS,
} from "@/lib/surveys/questions";

export interface VenditoreSurveyState {
    problemSignals: string[];
    urgencySignals: string[];
    priceReaction: string | null;
}

interface Props {
    value: VenditoreSurveyState;
    onChange: (next: VenditoreSurveyState) => void;
    disabled?: boolean;
}

export function VenditoreSurveyInline({ value, onChange, disabled }: Props) {
    const toggleArr = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

    return (
        <div className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
            <div className="mb-1 text-sm font-bold text-indigo-900">
                📊 Sondaggio lead non chiuso — aiutaci a capire perché
            </div>

            {/* Blocco 1 */}
            <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-indigo-700">
                    1) Segnali di problema (selezione multipla)
                </div>
                <div className="flex flex-wrap gap-2">
                    {SALES_PROBLEM_SIGNAL_OPTIONS.map((o) => {
                        const on = value.problemSignals.includes(o.value);
                        return (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => !disabled && onChange({ ...value, problemSignals: toggleArr(value.problemSignals, o.value) })}
                                disabled={disabled}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-indigo-500 bg-indigo-500 text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-indigo-400"} disabled:opacity-50`}
                            >
                                {o.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Blocco 2 */}
            <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-indigo-700">
                    2) Segnali di urgenza (selezione multipla)
                </div>
                <div className="flex flex-wrap gap-2">
                    {SALES_URGENCY_SIGNAL_OPTIONS.map((o) => {
                        const on = value.urgencySignals.includes(o.value);
                        return (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => !disabled && onChange({ ...value, urgencySignals: toggleArr(value.urgencySignals, o.value) })}
                                disabled={disabled}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-indigo-500 bg-indigo-500 text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-indigo-400"} disabled:opacity-50`}
                            >
                                {o.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Blocco 3 */}
            <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-indigo-700">
                    3) Come ha reagito al prezzo?
                </div>
                <div className="flex flex-wrap gap-2">
                    {SALES_PRICE_REACTION_OPTIONS.map((o) => {
                        const on = value.priceReaction === o.value;
                        return (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => !disabled && onChange({ ...value, priceReaction: o.value })}
                                disabled={disabled}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-indigo-500 bg-indigo-500 text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-indigo-400"} disabled:opacity-50`}
                            >
                                {o.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
