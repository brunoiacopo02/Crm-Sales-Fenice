// src/lib/marketing/crm-funnel.ts
// Mappa di normalizzazione dei nomi funnel che arrivano dal CRM gestionale.
// Usata sia dall'ingest webhook che dal bulk import. Se cambia, ricordarsi di
// fare backfill su crmAppointments / crmDeals leggendo da crmEvents.payload.

const FUNNEL_MAP: Record<string, string> = {
    'telegram': 'telegram',
    'job simulator': 'jobsimulator',
    'jobsimulator': 'jobsimulator',
    'corso 10 ore': 'corso10ore',
    'corso10ore': 'corso10ore',
};

export function normalizeFunnel(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const key = raw.toLowerCase().trim();
    return FUNNEL_MAP[key] ?? key.replace(/\s+/g, '');
}
