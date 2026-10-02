export const SYNC_FROM = '2026-09-01'
const TIMEOUT_MS = 30_000
const ATTEMPTS = 2

export class GestionaleNotConfiguredError extends Error {
    constructor() { super('GESTIONALE_API_URL o GESTIONALE_API_KEY non impostate'); this.name = 'GestionaleNotConfiguredError' }
}
export class GestionaleHttpError extends Error {
    constructor(public status: number, message: string) { super(message); this.name = 'GestionaleHttpError' }
}

export function gestionaleConfigured(): boolean {
    return Boolean(process.env.GESTIONALE_API_URL && process.env.GESTIONALE_API_KEY)
}

/** Snapshot completo. Ritenta una volta su rete/5xx; 4xx (chiave sbagliata) non si ritenta. */
export async function fetchSnapshot(): Promise<unknown> {
    if (!gestionaleConfigured()) throw new GestionaleNotConfiguredError()
    const base = process.env.GESTIONALE_API_URL!.replace(/\/+$/, '')
    const url = `${base}/api/v1/contratti?dal=${SYNC_FROM}&incassi_dal=${SYNC_FROM}`
    let lastErr: unknown
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${process.env.GESTIONALE_API_KEY}`, Accept: 'application/json' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
                cache: 'no-store',
            })
            if (res.ok) return await res.json()
            const body = (await res.text()).slice(0, 300)
            const err = new GestionaleHttpError(res.status, `HTTP ${res.status} dal gestionale: ${body}`)
            if (res.status < 500) throw err
            lastErr = err
        } catch (e) {
            if (e instanceof GestionaleHttpError && e.status < 500) throw e
            lastErr = e
        }
        if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, 2000))
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
