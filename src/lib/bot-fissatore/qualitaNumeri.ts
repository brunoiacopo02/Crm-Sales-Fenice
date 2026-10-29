/**
 * Interruttore della regola "fasce solo GDO" (PO 29/10/2026).
 *
 * La regola si accende DA SOLA quando i numeri del giro delle aperture a freddo
 * non sono tutti a posto (almeno uno fra 8061, 8718, 0047 non HIGH oppure in
 * pausa dal cron qualita-numeri del bot) e si spegne da sola quando tornano
 * tutti HIGH. Il 3199 non conta: è già fuori dal giro.
 *
 * Interruttore manuale, env `FASCIA_SOLO_GDO` (+ redeploy):
 *   'on'           forza accesa
 *   'off'          forza spenta (vale la regola di prima)
 *   assente/'auto' automatica, dallo stato dei numeri
 *
 * Lo stato si chiede al bot (`/api/bot/qualita-numeri`, firma HMAC come il push)
 * e si tiene in cache 5 minuti per istanza: il webhook AC non deve rallentare.
 * Se il bot non risponde o lo stato non si capisce, la regola vale ACCESA (per
 * non sovraccaricare i numeri), e il ripiego si ritenta dopo un minuto.
 */
import { signPayload } from '@/lib/marketing-webhooks/signing';

/** I numeri del giro delle aperture a freddo, senza `whatsapp:`. */
export const GIRO_APERTURE: readonly string[] = ['+393520158061', '+393522018718', '+393522070047'];

export type ModoSoloGdo = 'on' | 'off' | 'auto';

export function modoSoloGdo(env: Record<string, string | undefined> = process.env): ModoSoloGdo {
    const raw = env.FASCIA_SOLO_GDO?.trim().toLowerCase();
    if (raw === 'on' || raw === 'true' || raw === '1') return 'on';
    if (raw === 'off' || raw === 'false' || raw === '0') return 'off';
    return 'auto';
}

type StatoQualita = {
    storico?: Record<string, Record<string, string>>;
    pause?: Record<string, unknown>;
};

const soloNumero = (n: string) => n.trim().replace(/^whatsapp:/i, '');

function giornoPrima(giorno: string): string {
    const d = new Date(`${giorno}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

/**
 * true solo se TUTTI i numeri del giro sono a posto: nessuno in pausa e
 * l'ultima lettura (la peggiore del giorno, di oggi o al massimo di ieri) è
 * HIGH. Un numero senza letture recenti conta come "non a posto".
 */
export function numeriTuttiHigh(stato: unknown, oggi: string, numeri: readonly string[] = GIRO_APERTURE): boolean {
    if (!stato || typeof stato !== 'object') return false;
    const s = stato as StatoQualita;
    const pause = new Set(Object.keys(s.pause ?? {}).map(soloNumero));
    const storico: Record<string, Record<string, string>> = {};
    for (const [k, v] of Object.entries(s.storico ?? {})) storico[soloNumero(k)] = v ?? {};
    const ieri = giornoPrima(oggi);
    for (const n of numeri.map(soloNumero)) {
        if (pause.has(n)) return false;
        const giorni = Object.keys(storico[n] ?? {}).filter((g) => g <= oggi).sort();
        const ultimo = giorni[giorni.length - 1];
        if (!ultimo || ultimo < ieri) return false;
        if (String(storico[n][ultimo]).toUpperCase() !== 'HIGH') return false;
    }
    return true;
}

const CACHE_OK_MS = 5 * 60 * 1000;
const CACHE_ERRORE_MS = 60 * 1000;
const TIMEOUT_MS = 1500;

let cache: { attiva: boolean; fino: number; motivo: string } | null = null;

/** Lo stato dei numeri dal bot: true = tutti HIGH; null = non leggibile. */
async function chiediAlBot(): Promise<boolean | null> {
    const intake = process.env.BOT_INTAKE_URL;
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!intake || !secret) return null;
    let url: string;
    try { url = new URL('/api/bot/qualita-numeri', intake).toString(); } catch { return null; }
    const body = JSON.stringify({ ts: new Date().toISOString() });
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-bot-signature': signPayload(body, secret) },
            body,
            cache: 'no-store',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const j = (await res.json()) as { ok?: boolean; oggi?: string; stato?: unknown };
        if (!j.ok || typeof j.oggi !== 'string') return null;
        return numeriTuttiHigh(j.stato, j.oggi);
    } catch {
        return null;
    }
}

/**
 * La regola "fasce solo GDO" è in vigore? Mai un'eccezione: nel dubbio true.
 * `motivo` serve ai log e alla striscia di /lead-automatici.
 */
export async function fasciaSoloGdoAttiva(): Promise<{ attiva: boolean; motivo: string }> {
    const modo = modoSoloGdo();
    if (modo === 'on') return { attiva: true, motivo: 'forzata_on' };
    if (modo === 'off') return { attiva: false, motivo: 'forzata_off' };
    const adesso = Date.now();
    if (cache && cache.fino > adesso) return { attiva: cache.attiva, motivo: cache.motivo };
    const tuttiHigh = await chiediAlBot();
    if (tuttiHigh === null) {
        cache = { attiva: true, fino: adesso + CACHE_ERRORE_MS, motivo: 'stato_non_leggibile' };
        console.error('[solo-gdo] stato dei numeri non leggibile dal bot: regola accesa');
    } else {
        cache = { attiva: !tuttiHigh, fino: adesso + CACHE_OK_MS, motivo: tuttiHigh ? 'numeri_tutti_high' : 'numeri_non_ok' };
        console.log(`[solo-gdo] stato dei numeri letto dal bot: ${cache.motivo}, regola ${cache.attiva ? 'accesa' : 'spenta'}`);
    }
    return { attiva: cache.attiva, motivo: cache.motivo };
}
