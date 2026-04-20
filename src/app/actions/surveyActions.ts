"use server";

import { db } from "@/db";
import {
    gdoLeadSurveys,
    confermeLeadSurveys,
    salesLeadSurveys,
    leads,
    users,
    coinTransactions,
    notifications,
} from "@/db/schema";
import { createClient } from "@/utils/supabase/server";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import crypto from "crypto";
import { checkAchievements } from "@/app/actions/achievementActions";
import {
    GDO_SURVEY_COMPLETE_COINS,
    GDO_SURVEY_COMPLETE_XP,
    GDO_SURVEY_PARTIAL_COINS,
    GDO_SURVEY_PARTIAL_XP,
    CONFERME_SURVEY_COMPLETE_COINS,
    CONFERME_SURVEY_COMPLETE_XP,
    MIN_FILL_DURATION_MS,
    CLUSTER_WINDOW_MS,
    CLUSTER_COUNT_THRESHOLD,
    MONOTONOUS_CONSECUTIVE,
    INVALIDATION_PENALTY_COINS,
    COIN_REASON_GDO_SURVEY,
    COIN_REASON_GDO_SURVEY_PARTIAL,
    COIN_REASON_CONFERME_SURVEY,
    COIN_REASON_SURVEY_INVALIDATED,
} from "@/lib/surveys/rewards";
import {
    EXCLUDED_FUNNEL,
    GDO_FIELD_OPTIONS,
    GDO_FIELD_MULTI,
    GDO_SURVEY_FIELDS,
    CONFERME_WHY_NOT_OPTIONS,
    SALES_PROBLEM_SIGNAL_OPTIONS,
    SALES_URGENCY_SIGNAL_OPTIONS,
    SALES_PRICE_REACTION_OPTIONS,
    GDO_EARLY_EXIT_REASONS,
    type GdoSurveyField,
} from "@/lib/surveys/questions";

// ============ AUTH HELPERS ============
async function getSession() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    if (!supabaseUser) return null;
    return {
        id: supabaseUser.id,
        role: (supabaseUser.user_metadata?.role as string) || "GDO",
        email: supabaseUser.email,
    };
}

async function requireRole(allowed: string[]) {
    const session = await getSession();
    if (!session || !allowed.includes(session.role)) {
        throw new Error("Unauthorized");
    }
    return session;
}

async function isLeadEligible(leadId: string): Promise<{ eligible: boolean; funnel: string | null }> {
    const [row] = await db.select({ funnel: leads.funnel }).from(leads).where(eq(leads.id, leadId));
    if (!row) return { eligible: false, funnel: null };
    const funnelLower = (row.funnel || "").trim().toLowerCase();
    return { eligible: funnelLower !== EXCLUDED_FUNNEL, funnel: row.funnel };
}

// ============ GDO SURVEY ============

export interface GdoSurveyPayload {
    ageRange?: string | null;
    occupation?: string | null;
    requestReason?: string | null;    // single-choice dal 2026-04-17
    expectation?: string | null;      // single-choice dal 2026-04-17
    mainProblem?: string | null;
    digitalKnow?: string | null;
    changeWithin?: string | null;
    changeSince?: string | null;
    earlyExitReason?: string | null;
    fillDurationMs: number;
}

function isGdoPayloadComplete(p: GdoSurveyPayload): boolean {
    for (const f of GDO_SURVEY_FIELDS) {
        const v = (p as unknown as Record<string, unknown>)[f];
        if (GDO_FIELD_MULTI[f]) {
            if (!Array.isArray(v) || v.length === 0) return false;
        } else {
            if (!v || typeof v !== "string") return false;
        }
    }
    return true;
}

function validateGdoPayload(p: GdoSurveyPayload): string | null {
    for (const f of GDO_SURVEY_FIELDS) {
        const v = (p as unknown as Record<string, unknown>)[f];
        if (v == null) continue;
        const opts = GDO_FIELD_OPTIONS[f as GdoSurveyField].map((o) => o.value);
        if (GDO_FIELD_MULTI[f]) {
            if (!Array.isArray(v)) return `Invalid multi-value for ${f}`;
            for (const x of v) if (!opts.includes(x as string)) return `Invalid option "${x}" for ${f}`;
        } else {
            if (typeof v !== "string" || !opts.includes(v)) return `Invalid value "${v}" for ${f}`;
        }
    }
    if (p.earlyExitReason != null) {
        const validReasons = GDO_EARLY_EXIT_REASONS.map((o) => o.value);
        if (!validReasons.includes(p.earlyExitReason as (typeof validReasons)[number])) {
            return "Invalid earlyExitReason";
        }
    }
    return null;
}

async function detectSuspicious(gdoUserId: string, fillMs: number, payload: GdoSurveyPayload): Promise<boolean> {
    if (fillMs < MIN_FILL_DURATION_MS) return true;
    // Cluster: >=CLUSTER_COUNT_THRESHOLD surveys in last CLUSTER_WINDOW_MS
    const since = new Date(Date.now() - CLUSTER_WINDOW_MS);
    const recent = await db
        .select({
            ageRange: gdoLeadSurveys.ageRange,
            occupation: gdoLeadSurveys.occupation,
            mainProblem: gdoLeadSurveys.mainProblem,
            digitalKnow: gdoLeadSurveys.digitalKnow,
            changeWithin: gdoLeadSurveys.changeWithin,
            changeSince: gdoLeadSurveys.changeSince,
        })
        .from(gdoLeadSurveys)
        .where(and(eq(gdoLeadSurveys.gdoUserId, gdoUserId), sql`${gdoLeadSurveys.createdAt} > ${since}`))
        .orderBy(desc(gdoLeadSurveys.createdAt))
        .limit(CLUSTER_COUNT_THRESHOLD);
    if (recent.length >= CLUSTER_COUNT_THRESHOLD) return true;
    // Monotonous: last MONOTONOUS_CONSECUTIVE-1 identical to current single-choice fingerprint
    if (recent.length >= MONOTONOUS_CONSECUTIVE - 1) {
        const fp = (o: typeof recent[number]) =>
            `${o.ageRange}|${o.occupation}|${o.mainProblem}|${o.digitalKnow}|${o.changeWithin}|${o.changeSince}`;
        const currentFp = `${payload.ageRange}|${payload.occupation}|${payload.mainProblem}|${payload.digitalKnow}|${payload.changeWithin}|${payload.changeSince}`;
        const tail = recent.slice(0, MONOTONOUS_CONSECUTIVE - 1).map(fp);
        if (tail.every((x) => x === currentFp)) return true;
    }
    return false;
}

export async function saveGdoSurvey(
    leadId: string,
    payload: GdoSurveyPayload,
): Promise<{ success: boolean; error?: string; suspicious?: boolean; rewards?: { coins: number; xp: number } }> {
    try {
        const session = await requireRole(["GDO", "MANAGER", "ADMIN"]);

        const err = validateGdoPayload(payload);
        if (err) return { success: false, error: err };

        const { eligible } = await isLeadEligible(leadId);
        if (!eligible) return { success: false, error: "Lead non idoneo (funnel escluso o inesistente)" };

        const completed = payload.earlyExitReason ? false : isGdoPayloadComplete(payload);

        // Only do anti-gaming detection on full saves (not partial early-exits)
        const suspicious = completed ? await detectSuspicious(session.id, payload.fillDurationMs, payload) : false;

        // Upsert: unique(leadId) allows at most one GDO survey per lead.
        const existing = await db.select({ id: gdoLeadSurveys.id }).from(gdoLeadSurveys).where(eq(gdoLeadSurveys.leadId, leadId));

        if (existing.length === 0) {
            await db.insert(gdoLeadSurveys).values({
                id: crypto.randomUUID(),
                leadId,
                gdoUserId: session.id,
                ageRange: payload.ageRange ?? null,
                occupation: payload.occupation ?? null,
                requestReason: payload.requestReason ?? null,
                expectation: payload.expectation ?? null,
                mainProblem: payload.mainProblem ?? null,
                digitalKnow: payload.digitalKnow ?? null,
                changeWithin: payload.changeWithin ?? null,
                changeSince: payload.changeSince ?? null,
                completed,
                earlyExitReason: payload.earlyExitReason ?? null,
                fillDurationMs: payload.fillDurationMs,
                suspicious,
            });
        } else {
            await db.update(gdoLeadSurveys).set({
                ageRange: payload.ageRange ?? null,
                occupation: payload.occupation ?? null,
                requestReason: payload.requestReason ?? null,
                expectation: payload.expectation ?? null,
                mainProblem: payload.mainProblem ?? null,
                digitalKnow: payload.digitalKnow ?? null,
                changeWithin: payload.changeWithin ?? null,
                changeSince: payload.changeSince ?? null,
                completed,
                earlyExitReason: payload.earlyExitReason ?? null,
                fillDurationMs: payload.fillDurationMs,
                suspicious,
                updatedAt: new Date(),
            }).where(eq(gdoLeadSurveys.leadId, leadId));
        }

        // Grant rewards only on non-suspicious saves.
        let rewardCoins = 0;
        let rewardXp = 0;
        if (!suspicious) {
            if (completed) {
                rewardCoins = GDO_SURVEY_COMPLETE_COINS;
                rewardXp = GDO_SURVEY_COMPLETE_XP;
                await db.update(users)
                    .set({
                        walletCoins: sql`${users.walletCoins} + ${rewardCoins}`,
                        experience: sql`${users.experience} + ${rewardXp}`,
                    })
                    .where(eq(users.id, session.id));
                await db.insert(coinTransactions).values({
                    id: crypto.randomUUID(),
                    userId: session.id,
                    amount: rewardCoins,
                    reason: COIN_REASON_GDO_SURVEY,
                });
                // Fire-and-forget achievement check
                checkAchievements(session.id).catch(() => { /* best-effort */ });
            } else if (payload.earlyExitReason) {
                rewardCoins = GDO_SURVEY_PARTIAL_COINS;
                rewardXp = GDO_SURVEY_PARTIAL_XP;
                await db.update(users)
                    .set({
                        walletCoins: sql`${users.walletCoins} + ${rewardCoins}`,
                        experience: sql`${users.experience} + ${rewardXp}`,
                    })
                    .where(eq(users.id, session.id));
                await db.insert(coinTransactions).values({
                    id: crypto.randomUUID(),
                    userId: session.id,
                    amount: rewardCoins,
                    reason: COIN_REASON_GDO_SURVEY_PARTIAL,
                });
            }
        }

        return { success: true, suspicious, rewards: { coins: rewardCoins, xp: rewardXp } };
    } catch (e) {
        console.error("saveGdoSurvey error:", e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function getGdoSurveyByLead(leadId: string) {
    await requireRole(["GDO", "CONFERME", "VENDITORE", "MANAGER", "ADMIN"]);
    const [row] = await db.select().from(gdoLeadSurveys).where(eq(gdoLeadSurveys.leadId, leadId));
    return row || null;
}

// ============ CONFERME SURVEY ============

export interface ConfermeSurveyPayload {
    remembersAppt: boolean;
    watchedVideo: boolean;
    confirmed: boolean;
    whyNot: string | null;
    fillDurationMs: number;
}

export async function saveConfermeSurvey(
    leadId: string,
    payload: ConfermeSurveyPayload,
): Promise<{ success: boolean; error?: string; suspicious?: boolean; rewards?: { coins: number; xp: number } }> {
    try {
        const session = await requireRole(["CONFERME", "MANAGER", "ADMIN"]);

        if (payload.confirmed === false && payload.whyNot) {
            const valid = CONFERME_WHY_NOT_OPTIONS.map((o) => o.value);
            if (!valid.includes(payload.whyNot as (typeof valid)[number])) {
                return { success: false, error: "Invalid whyNot value" };
            }
        }

        // Le Conferme raccolgono il sondaggio SU TUTTI i lead, inclusi
        // quelli con funnel 'database'. Il contesto è post-appuntamento,
        // ha senso raccogliere feedback indipendentemente dal funnel.
        const [leadRow] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId));
        if (!leadRow) return { success: false, error: "Lead non trovato" };

        const suspicious = payload.fillDurationMs < MIN_FILL_DURATION_MS;

        const existing = await db.select({ id: confermeLeadSurveys.id }).from(confermeLeadSurveys).where(eq(confermeLeadSurveys.leadId, leadId));

        if (existing.length === 0) {
            await db.insert(confermeLeadSurveys).values({
                id: crypto.randomUUID(),
                leadId,
                confermeUserId: session.id,
                remembersAppt: payload.remembersAppt,
                watchedVideo: payload.watchedVideo,
                confirmed: payload.confirmed,
                whyNot: payload.confirmed ? null : (payload.whyNot ?? null),
                fillDurationMs: payload.fillDurationMs,
                suspicious,
            });
        } else {
            await db.update(confermeLeadSurveys).set({
                remembersAppt: payload.remembersAppt,
                watchedVideo: payload.watchedVideo,
                confirmed: payload.confirmed,
                whyNot: payload.confirmed ? null : (payload.whyNot ?? null),
                fillDurationMs: payload.fillDurationMs,
                suspicious,
                updatedAt: new Date(),
            }).where(eq(confermeLeadSurveys.leadId, leadId));
        }

        let rewardCoins = 0;
        let rewardXp = 0;
        if (!suspicious) {
            rewardCoins = CONFERME_SURVEY_COMPLETE_COINS;
            rewardXp = CONFERME_SURVEY_COMPLETE_XP;
            await db.update(users)
                .set({
                    walletCoins: sql`${users.walletCoins} + ${rewardCoins}`,
                    experience: sql`${users.experience} + ${rewardXp}`,
                })
                .where(eq(users.id, session.id));
            await db.insert(coinTransactions).values({
                id: crypto.randomUUID(),
                userId: session.id,
                amount: rewardCoins,
                reason: COIN_REASON_CONFERME_SURVEY,
            });
            checkAchievements(session.id).catch(() => { /* best-effort */ });
        }

        return { success: true, suspicious, rewards: { coins: rewardCoins, xp: rewardXp } };
    } catch (e) {
        console.error("saveConfermeSurvey error:", e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function getConfermeSurveyByLead(leadId: string) {
    await requireRole(["GDO", "CONFERME", "VENDITORE", "MANAGER", "ADMIN"]);
    const [row] = await db.select().from(confermeLeadSurveys).where(eq(confermeLeadSurveys.leadId, leadId));
    return row || null;
}

// ============ SALES SURVEY ============

export interface SalesSurveyPayload {
    problemSignals: string[];
    urgencySignals: string[];
    priceReaction: string;
    fillDurationMs: number;
}

export async function saveSalesSurvey(
    leadId: string,
    payload: SalesSurveyPayload,
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await requireRole(["VENDITORE", "MANAGER", "ADMIN"]);

        const validProblem = SALES_PROBLEM_SIGNAL_OPTIONS.map((o) => o.value);
        const validUrgency = SALES_URGENCY_SIGNAL_OPTIONS.map((o) => o.value);
        const validPrice = SALES_PRICE_REACTION_OPTIONS.map((o) => o.value);

        if (!Array.isArray(payload.problemSignals) || payload.problemSignals.length === 0) {
            return { success: false, error: "Seleziona almeno un'opzione nel blocco 1" };
        }
        for (const s of payload.problemSignals) if (!validProblem.includes(s as (typeof validProblem)[number])) return { success: false, error: `Invalid problemSignal: ${s}` };
        if (!Array.isArray(payload.urgencySignals) || payload.urgencySignals.length === 0) {
            return { success: false, error: "Seleziona almeno un'opzione nel blocco 2" };
        }
        for (const s of payload.urgencySignals) if (!validUrgency.includes(s as (typeof validUrgency)[number])) return { success: false, error: `Invalid urgencySignal: ${s}` };
        if (!validPrice.includes(payload.priceReaction as (typeof validPrice)[number])) {
            return { success: false, error: "Seleziona la reazione al prezzo" };
        }

        const { eligible } = await isLeadEligible(leadId);
        if (!eligible) return { success: false, error: "Lead non idoneo" };

        const suspicious = payload.fillDurationMs < MIN_FILL_DURATION_MS;

        const existing = await db.select({ id: salesLeadSurveys.id }).from(salesLeadSurveys).where(eq(salesLeadSurveys.leadId, leadId));

        if (existing.length === 0) {
            await db.insert(salesLeadSurveys).values({
                id: crypto.randomUUID(),
                leadId,
                salesUserId: session.id,
                problemSignals: payload.problemSignals,
                urgencySignals: payload.urgencySignals,
                priceReaction: payload.priceReaction,
                fillDurationMs: payload.fillDurationMs,
                suspicious,
            });
        } else {
            await db.update(salesLeadSurveys).set({
                problemSignals: payload.problemSignals,
                urgencySignals: payload.urgencySignals,
                priceReaction: payload.priceReaction,
                fillDurationMs: payload.fillDurationMs,
                suspicious,
                updatedAt: new Date(),
            }).where(eq(salesLeadSurveys.leadId, leadId));
        }

        return { success: true };
    } catch (e) {
        console.error("saveSalesSurvey error:", e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function getSalesSurveyByLead(leadId: string) {
    await requireRole(["GDO", "CONFERME", "VENDITORE", "MANAGER", "ADMIN"]);
    const [row] = await db.select().from(salesLeadSurveys).where(eq(salesLeadSurveys.leadId, leadId));
    return row || null;
}

// ============ MANAGER INVALIDATION ============

export async function invalidateGdoSurvey(surveyId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await requireRole(["MANAGER", "ADMIN"]);
        const [row] = await db.select().from(gdoLeadSurveys).where(eq(gdoLeadSurveys.id, surveyId));
        if (!row) return { success: false, error: "Survey not found" };
        if (row.invalidatedBy) return { success: false, error: "Già invalidata" };
        await db.update(gdoLeadSurveys).set({
            invalidatedBy: session.id,
            invalidatedAt: new Date(),
        }).where(eq(gdoLeadSurveys.id, surveyId));
        // Apply penalty
        await db.update(users)
            .set({ walletCoins: sql`${users.walletCoins} + ${INVALIDATION_PENALTY_COINS}` })
            .where(eq(users.id, row.gdoUserId));
        await db.insert(coinTransactions).values({
            id: crypto.randomUUID(),
            userId: row.gdoUserId,
            amount: INVALIDATION_PENALTY_COINS,
            reason: COIN_REASON_SURVEY_INVALIDATED,
        });
        await db.insert(notifications).values({
            id: crypto.randomUUID(),
            recipientUserId: row.gdoUserId,
            type: "survey_invalidated",
            title: "Sondaggio invalidato",
            body: `Un Manager ha invalidato un tuo sondaggio (ID: ${surveyId}). Penalità: ${INVALIDATION_PENALTY_COINS} coins.`,
        });
        return { success: true };
    } catch (e) {
        console.error("invalidateGdoSurvey error:", e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function invalidateConfermeSurvey(surveyId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await requireRole(["MANAGER", "ADMIN"]);
        const [row] = await db.select().from(confermeLeadSurveys).where(eq(confermeLeadSurveys.id, surveyId));
        if (!row) return { success: false, error: "Survey not found" };
        if (row.invalidatedBy) return { success: false, error: "Già invalidata" };
        await db.update(confermeLeadSurveys).set({
            invalidatedBy: session.id,
            invalidatedAt: new Date(),
        }).where(eq(confermeLeadSurveys.id, surveyId));
        await db.update(users)
            .set({ walletCoins: sql`${users.walletCoins} + ${INVALIDATION_PENALTY_COINS}` })
            .where(eq(users.id, row.confermeUserId));
        await db.insert(coinTransactions).values({
            id: crypto.randomUUID(),
            userId: row.confermeUserId,
            amount: INVALIDATION_PENALTY_COINS,
            reason: COIN_REASON_SURVEY_INVALIDATED,
        });
        await db.insert(notifications).values({
            id: crypto.randomUUID(),
            recipientUserId: row.confermeUserId,
            type: "survey_invalidated",
            title: "Sondaggio invalidato",
            body: `Un Manager ha invalidato un tuo sondaggio (ID: ${surveyId}). Penalità: ${INVALIDATION_PENALTY_COINS} coins.`,
        });
        return { success: true };
    } catch (e) {
        console.error("invalidateConfermeSurvey error:", e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function listSuspiciousSurveys(): Promise<{
    gdo: Array<{ id: string; leadId: string; gdoUserId: string; userName: string | null; createdAt: Date; fillDurationMs: number | null; invalidatedAt: Date | null }>;
    conferme: Array<{ id: string; leadId: string; confermeUserId: string; userName: string | null; createdAt: Date; fillDurationMs: number | null; invalidatedAt: Date | null }>;
}> {
    await requireRole(["MANAGER", "ADMIN"]);
    const gdo = await db.select({
        id: gdoLeadSurveys.id,
        leadId: gdoLeadSurveys.leadId,
        gdoUserId: gdoLeadSurveys.gdoUserId,
        userName: users.name,
        createdAt: gdoLeadSurveys.createdAt,
        fillDurationMs: gdoLeadSurveys.fillDurationMs,
        invalidatedAt: gdoLeadSurveys.invalidatedAt,
    })
        .from(gdoLeadSurveys)
        .leftJoin(users, eq(gdoLeadSurveys.gdoUserId, users.id))
        .where(eq(gdoLeadSurveys.suspicious, true))
        .orderBy(desc(gdoLeadSurveys.createdAt))
        .limit(100);

    const conferme = await db.select({
        id: confermeLeadSurveys.id,
        leadId: confermeLeadSurveys.leadId,
        confermeUserId: confermeLeadSurveys.confermeUserId,
        userName: users.name,
        createdAt: confermeLeadSurveys.createdAt,
        fillDurationMs: confermeLeadSurveys.fillDurationMs,
        invalidatedAt: confermeLeadSurveys.invalidatedAt,
    })
        .from(confermeLeadSurveys)
        .leftJoin(users, eq(confermeLeadSurveys.confermeUserId, users.id))
        .where(eq(confermeLeadSurveys.suspicious, true))
        .orderBy(desc(confermeLeadSurveys.createdAt))
        .limit(100);

    return { gdo, conferme };
}

// ============ CONTEXT HELPER for UI ============

export async function getLeadSurveyContext(leadId: string): Promise<{
    funnel: string | null;
    eligible: boolean;
    eligibilityReason: "ok" | "excluded_funnel" | "not_found";
}> {
    const [row] = await db.select({ funnel: leads.funnel }).from(leads).where(eq(leads.id, leadId));
    if (!row) return { funnel: null, eligible: false, eligibilityReason: "not_found" };
    const funnelLower = (row.funnel || "").trim().toLowerCase();
    if (funnelLower === EXCLUDED_FUNNEL) {
        return { funnel: row.funnel, eligible: false, eligibilityReason: "excluded_funnel" };
    }
    return { funnel: row.funnel, eligible: true, eligibilityReason: "ok" };
}

// Ensure isNotNull is considered used (keeps import valid for future use)
void isNotNull;
