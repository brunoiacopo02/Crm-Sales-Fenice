"use client";

import { useEffect, useState } from "react";
import { getGdoSurveyByLead, getConfermeSurveyByLead, getSalesSurveyByLead } from "@/app/actions/surveyActions";
import {
    GDO_FIELD_OPTIONS,
    GDO_FIELD_LABELS,
    GDO_FIELD_MULTI,
    GDO_SURVEY_FIELDS,
    GDO_EARLY_EXIT_REASONS,
    CONFERME_WHY_NOT_OPTIONS,
    SALES_PROBLEM_SIGNAL_OPTIONS,
    SALES_URGENCY_SIGNAL_OPTIONS,
    SALES_PRICE_REACTION_OPTIONS,
    type GdoSurveyField,
} from "@/lib/surveys/questions";
import { ClipboardList, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface Props {
    leadId: string;
}

export function SurveysReadOnlyPanel({ leadId }: Props) {
    const [gdo, setGdo] = useState<Record<string, unknown> | null | undefined>(undefined);
    const [conf, setConf] = useState<Record<string, unknown> | null | undefined>(undefined);
    const [sales, setSales] = useState<Record<string, unknown> | null | undefined>(undefined);

    useEffect(() => {
        void (async () => {
            const [g, c, s] = await Promise.all([
                getGdoSurveyByLead(leadId),
                getConfermeSurveyByLead(leadId),
                getSalesSurveyByLead(leadId),
            ]);
            setGdo((g as unknown as Record<string, unknown>) ?? null);
            setConf((c as unknown as Record<string, unknown>) ?? null);
            setSales((s as unknown as Record<string, unknown>) ?? null);
        })();
    }, [leadId]);

    const loading = gdo === undefined || conf === undefined || sales === undefined;

    if (loading) {
        return <div className="p-6 text-sm text-ash-500">Caricamento sondaggi…</div>;
    }

    const allEmpty = !gdo && !conf && !sales;
    if (allEmpty) {
        return (
            <div className="p-6 text-center">
                <ClipboardList className="mx-auto mb-2 h-10 w-10 text-ash-300" />
                <div className="text-sm font-semibold text-ash-600">Nessun sondaggio raccolto per questo lead</div>
                <div className="mt-1 text-xs text-ash-400">I sondaggi vengono compilati da GDO, Conferme e Venditori durante le loro lavorazioni.</div>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-4 sm:p-6">
            {/* GDO */}
            {gdo && (
                <SurveyCard title="📊 Sondaggio GDO" color="orange" invalidated={!!gdo.invalidatedBy}>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {GDO_SURVEY_FIELDS.map((f) => (
                            <GdoValueLine key={f} field={f} value={(gdo as Record<string, unknown>)[f] as string | string[] | null} />
                        ))}
                    </div>
                    {gdo.earlyExitReason ? (
                        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span>Early-exit: <strong>{labelFor(GDO_EARLY_EXIT_REASONS, gdo.earlyExitReason as string)}</strong></span>
                        </div>
                    ) : gdo.completed ? (
                        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Completo
                        </div>
                    ) : null}
                </SurveyCard>
            )}
            {/* Conferme */}
            {conf && (
                <SurveyCard title="📊 Sondaggio Conferme" color="indigo" invalidated={!!conf.invalidatedBy}>
                    <BoolRow label="Si ricorda appuntamento" v={conf.remembersAppt as boolean | null} />
                    <BoolRow label="Ha visto il video" v={conf.watchedVideo as boolean | null} />
                    <BoolRow label="Confermato" v={conf.confirmed as boolean | null} />
                    {conf.whyNot ? (
                        <div className="text-xs text-ash-600">Perché no: <strong>{labelFor(CONFERME_WHY_NOT_OPTIONS, conf.whyNot as string)}</strong></div>
                    ) : null}
                </SurveyCard>
            )}
            {/* Sales */}
            {sales && (
                <SurveyCard title="📊 Sondaggio Venditore (lead non chiuso)" color="rose" invalidated={!!sales.invalidatedBy}>
                    <ArrayRow label="Segnali di problema" values={sales.problemSignals as string[]} opts={SALES_PROBLEM_SIGNAL_OPTIONS} />
                    <ArrayRow label="Segnali di urgenza" values={sales.urgencySignals as string[]} opts={SALES_URGENCY_SIGNAL_OPTIONS} />
                    <div className="text-xs text-ash-600">
                        Reazione al prezzo: <strong>{sales.priceReaction ? labelFor(SALES_PRICE_REACTION_OPTIONS, sales.priceReaction as string) : "—"}</strong>
                    </div>
                </SurveyCard>
            )}
        </div>
    );
}

function SurveyCard({ title, color, invalidated, children }: { title: string; color: "orange" | "indigo" | "rose"; invalidated: boolean; children: React.ReactNode }) {
    const bg = color === "orange" ? "border-orange-200 bg-orange-50/50" : color === "indigo" ? "border-indigo-200 bg-indigo-50/50" : "border-rose-200 bg-rose-50/50";
    return (
        <div className={`rounded-xl border ${bg} p-3`}>
            <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-bold text-ash-900">{title}</div>
                {invalidated && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-200 px-2 py-0.5 text-[10px] font-bold text-rose-900">
                        <XCircle className="h-3 w-3" /> INVALIDATA
                    </span>
                )}
            </div>
            <div className="space-y-1">{children}</div>
        </div>
    );
}

function GdoValueLine({ field, value }: { field: GdoSurveyField; value: string | string[] | null }) {
    const label = GDO_FIELD_LABELS[field];
    const opts = GDO_FIELD_OPTIONS[field];
    let display = "—";
    if (value != null) {
        if (GDO_FIELD_MULTI[field]) {
            const arr = Array.isArray(value) ? value : [];
            display = arr.map((v) => labelFor(opts, v)).filter(Boolean).join(", ") || "—";
        } else if (typeof value === "string") {
            display = labelFor(opts, value) || "—";
        }
    }
    return (
        <div className="rounded-md bg-white px-2 py-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ash-500">{label}</div>
            <div className="text-xs font-medium text-ash-800">{display}</div>
        </div>
    );
}

function BoolRow({ label, v }: { label: string; v: boolean | null }) {
    return (
        <div className="flex items-center justify-between text-xs">
            <span className="text-ash-600">{label}</span>
            <span className={`font-semibold ${v === true ? "text-emerald-700" : v === false ? "text-rose-700" : "text-ash-400"}`}>
                {v === true ? "Sì" : v === false ? "No" : "—"}
            </span>
        </div>
    );
}

function ArrayRow({ label, values, opts }: { label: string; values: string[] | null; opts: readonly { value: string; label: string }[] }) {
    if (!values || values.length === 0) {
        return <div className="text-xs text-ash-500">{label}: —</div>;
    }
    return (
        <div className="text-xs text-ash-600">
            {label}: <strong>{values.map((v) => labelFor(opts, v)).filter(Boolean).join(", ")}</strong>
        </div>
    );
}

function labelFor(opts: readonly { value: string; label: string }[], v: string): string {
    return opts.find((o) => o.value === v)?.label ?? v;
}
