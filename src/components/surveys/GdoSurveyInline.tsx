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
}

export function GdoSurveyInline({ field, value, onChange, disabled }: Props) {
    const label = GDO_FIELD_LABELS[field];
    const opts = GDO_FIELD_OPTIONS[field];
    const multi = GDO_FIELD_MULTI[field];

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
