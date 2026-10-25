"use client";

import {
    GDO_FIELD_LABELS,
    GDO_FIELD_OPTIONS,
    GDO_FIELD_MULTI,
    type GdoSurveyField,
} from "@/lib/surveys/questions";

interface Props {
    field: GdoSurveyField;
    value: string | string[] | null;
    onChange: (field: GdoSurveyField, next: string | string[]) => void;
    disabled?: boolean;
    /** 'diretta' = veste scura del GDO (collaudo del 25/10/2026): stesse domande, stesse risposte. */
    variant?: "diretta";
}

export function GdoSurveyInline({ field, value, onChange, disabled, variant }: Props) {
    const label = GDO_FIELD_LABELS[field];
    const opts = GDO_FIELD_OPTIONS[field];
    const multi = GDO_FIELD_MULTI[field];

    if (variant === "diretta") {
        const selected: string[] = multi
            ? (Array.isArray(value) ? value : [])
            : (typeof value === "string" ? [value] : []);
        const scegli = (v: string) => {
            if (disabled) return;
            if (multi) onChange(field, selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
            else onChange(field, v);
        };
        return (
            <div className="mt-3 rounded-lg bg-[#2E2E2E] p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <div className="text-[14px] font-semibold text-[#F2F2F2]">{label}</div>
                    {multi && <div className="text-[12px] text-[#BFBFBF]">Puoi selezionare più opzioni</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                    {opts.map((o) => {
                        const on = selected.includes(o.value);
                        return (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => scegli(o.value)}
                                disabled={disabled}
                                aria-pressed={on}
                                className={`rounded-lg border-2 px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50 ${on ? "border-[#FF9330] bg-[#FF9330] text-[#171717]" : "border-[#3D3D3D] text-[#F2F2F2] hover:border-[#8C8C8C]"}`}
                            >
                                {o.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (multi) {
        const selected: string[] = Array.isArray(value) ? value : [];
        const toggle = (v: string) => {
            if (disabled) return;
            const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
            onChange(field, next);
        };
        return (
            <div className="mt-3 rounded-xl border border-brand-orange/20 bg-brand-orange/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-brand-orange">📊 {label}</div>
                    <div className="text-[10px] text-ash-500">Puoi selezionare più opzioni</div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {opts.map((o) => {
                        const on = selected.includes(o.value);
                        return (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => toggle(o.value)}
                                disabled={disabled}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-brand-orange bg-brand-orange text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-brand-orange/60 hover:bg-brand-orange/5"} disabled:opacity-50`}
                            >
                                {o.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    const selected = typeof value === "string" ? value : null;
    const pick = (v: string) => {
        if (disabled) return;
        onChange(field, v);
    };
    return (
        <div className="mt-3 rounded-xl border border-brand-orange/20 bg-brand-orange/5 p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-brand-orange">📊 {label}</div>
            <div className="flex flex-wrap gap-2">
                {opts.map((o) => {
                    const on = selected === o.value;
                    return (
                        <button
                            key={o.value}
                            type="button"
                            onClick={() => pick(o.value)}
                            disabled={disabled}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${on ? "border-brand-orange bg-brand-orange text-white shadow-sm" : "border-ash-200 bg-white text-ash-700 hover:border-brand-orange/60 hover:bg-brand-orange/5"} disabled:opacity-50`}
                        >
                            {o.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
