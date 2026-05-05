/**
 * Logger condiviso per Supabase Realtime channel.subscribe().
 *
 * Senza un callback, le subscription falliscono in silenzio (CHANNEL_ERROR /
 * TIMED_OUT / CLOSED) e l'UI rimane stale senza che l'utente lo sappia.
 * Questo helper logga in console quando la subscription va in stato anomalo,
 * cosi' eventuali problemi sono visibili in DevTools.
 *
 * Uso: `.subscribe(logRealtimeStatus('conferme_realtime_board'))`.
 *
 * NB: NON modifica i filtri postgres_changes ne' la semantica del channel —
 * aggiunge solo logging dello stato di sottoscrizione.
 */
export function logRealtimeStatus(channelName: string) {
    return (status: string, err?: Error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn(`[realtime] subscription "${channelName}" ${status}`, err);
        }
    };
}
