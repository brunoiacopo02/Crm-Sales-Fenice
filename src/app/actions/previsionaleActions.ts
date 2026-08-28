'use server';

import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';

/**
 * Gate a doppia serratura della pagina /previsionale.
 *
 * 1) ruolo ADMIN (come ogni altra pagina di Direzione);
 * 2) una password condivisa fuori dal CRM: l'account admin è usato da più
 *    persone e il previsionale contiene budget e marginalità che non tutte
 *    devono vedere.
 *
 * La password NON deve mai finire nel bundle client: viene confrontata solo
 * qui dentro, e al client torna un semplice booleano. Il "sì" viene poi
 * conservato in un cookie httpOnly firmato (HMAC) e legato all'id utente, così
 * che non sia falsificabile da devtools né trasportabile su un altro account.
 */

const COOKIE_NAME = 'previsionale_ok';
const TTL_SECONDS = 8 * 60 * 60; // 8 ore: copre una giornata di lavoro, non di più

function password(): string {
    return process.env.PREVISIONALE_PASSWORD ?? '4321';
}

/**
 * Chiave di firma. Se non è configurata si deriva dalla password: il cookie
 * resta non falsificabile senza conoscerla, e cambiare la password invalida
 * automaticamente tutte le sessioni già sbloccate.
 */
function signingKey(): string {
    return process.env.PREVISIONALE_SECRET ?? `previsionale::${password()}`;
}

function sign(userId: string, expiresAt: number): string {
    return crypto
        .createHmac('sha256', signingKey())
        .update(`${userId}.${expiresAt}`)
        .digest('hex');
}

function makeToken(userId: string): string {
    const expiresAt = Date.now() + TTL_SECONDS * 1000;
    return `${expiresAt}.${sign(userId, expiresAt)}`;
}

function verifyToken(token: string | undefined, userId: string): boolean {
    if (!token) return false;
    const [rawExp, mac] = token.split('.');
    const expiresAt = Number(rawExp);
    if (!Number.isFinite(expiresAt) || !mac) return false;
    if (expiresAt <= Date.now()) return false;
    const expected = sign(userId, expiresAt);
    // Lunghezze diverse fanno lanciare timingSafeEqual: filtrale prima.
    if (mac.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

async function requireAdmin(): Promise<{ id: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    if (user.user_metadata?.role !== 'ADMIN') return null;
    return { id: user.id };
}

/** Lo usa il Server Component per decidere se renderizzare il modello o il lucchetto. */
export async function isPrevisionaleUnlocked(): Promise<boolean> {
    const admin = await requireAdmin();
    if (!admin) return false;
    const store = await cookies();
    return verifyToken(store.get(COOKIE_NAME)?.value, admin.id);
}

export async function unlockPrevisionale(
    input: string,
): Promise<{ ok: boolean; error?: string }> {
    const admin = await requireAdmin();
    if (!admin) return { ok: false, error: 'Non autorizzato.' };

    const provided = (input ?? '').trim();
    const expected = password();
    const ok =
        provided.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) return { ok: false, error: 'Password errata.' };

    const store = await cookies();
    store.set(COOKIE_NAME, makeToken(admin.id), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: TTL_SECONDS,
    });
    return { ok: true };
}

/** Richiude la pagina senza dover aspettare la scadenza delle 8 ore. */
export async function lockPrevisionale(): Promise<{ ok: boolean }> {
    const store = await cookies();
    store.set(COOKIE_NAME, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 0,
    });
    return { ok: true };
}
