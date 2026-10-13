'use server';

import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';

/**
 * Gate a doppia serratura della pagina /bonus, stesso schema di /incassi:
 * ruolo ADMIN + password condivisa (l'account admin è usato da più persone).
 * La password si confronta solo qui; il "sì" resta in un cookie httpOnly
 * firmato (HMAC) e legato all'id utente.
 */

const COOKIE_NAME = 'bonus_ok';
const TTL_SECONDS = 8 * 60 * 60;

function password(): string {
    return process.env.BONUS_PASSWORD ?? process.env.INCASSI_PASSWORD ?? '1243';
}

/** Derivata dalla password: cambiarla invalida tutte le sessioni già sbloccate. */
function signingKey(): string {
    return process.env.BONUS_SECRET ?? `bonus::${password()}`;
}

function sign(userId: string, expiresAt: number): string {
    return crypto.createHmac('sha256', signingKey()).update(`${userId}.${expiresAt}`).digest('hex');
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
    if (mac.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

async function requireAdmin(): Promise<{ id: string } | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') return null;
    return { id: user.id };
}

/** Lo usa la pagina /bonus prima di leggere i dati. */
export async function isBonusUnlocked(): Promise<boolean> {
    const admin = await requireAdmin();
    if (!admin) return false;
    const store = await cookies();
    return verifyToken(store.get(COOKIE_NAME)?.value, admin.id);
}

export async function unlockBonus(input: string): Promise<{ ok: boolean; error?: string }> {
    const admin = await requireAdmin();
    if (!admin) return { ok: false, error: 'Non autorizzato.' };

    const provided = (input ?? '').trim();
    const expected = password();
    const ok = provided.length === expected.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) {
        // Rallenta i tentativi a raffica su un PIN di 4 cifre.
        await new Promise(r => setTimeout(r, 1500));
        return { ok: false, error: 'Password errata.' };
    }

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

export async function lockBonus(): Promise<{ ok: boolean }> {
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
