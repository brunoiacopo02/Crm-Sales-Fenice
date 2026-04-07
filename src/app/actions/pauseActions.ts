"use server"

import { db } from "@/db"
import { breakSessions, users } from "@/db/schema"
import { eq, and, desc, sql } from "drizzle-orm"
import crypto from "crypto"
import { BREAK_RULES, getLocalDateRome } from "@/lib/pauseUtils"

export type PauseSummary = {
    usedPauses: number
    totalSecondsToday: number
    currentPause: {
        id: string
        startTime: string // ISO string per il client
        durationSeconds: number
        isExceeded: boolean
    } | null
}

export async function getManagerPauseReport(dateLocal?: string) {
    const targetDate = dateLocal || getLocalDateRome()

    const sessions = await db.select({
            id: breakSessions.id,
            gdoUserId: breakSessions.gdoUserId,
            userName: users.name,
            dateLocal: breakSessions.dateLocal,
            breakIndex: breakSessions.breakIndex,
            startTime: breakSessions.startTime,
            endTime: breakSessions.endTime,
            durationSeconds: breakSessions.durationSeconds,
            status: breakSessions.status,
            exceededSeconds: breakSessions.exceededSeconds,
            overrideReason: breakSessions.overrideReason,
        })
            .from(breakSessions)
            .leftJoin(users, eq(breakSessions.gdoUserId, users.id))
            .where(eq(breakSessions.dateLocal, targetDate))
            .orderBy(desc(breakSessions.startTime))
        

    // Aggregate KPI
    let totalPauses = sessions.length
    let totalSeconds = 0
    let totalExceededSeconds = 0
    let exceededCount = 0

    // Build GDO specific rows
    const gdoMap = new Map<string, any>()

    for (const s of sessions) {
        // Sync live status for accurate manager view
        let finalStatus = s.status
        let finalDuration = s.durationSeconds || 0
        let finalExceeded = s.exceededSeconds || 0

        if (s.status === 'in_corso') {
            const now = new Date()
            const diffSeconds = Math.floor((now.getTime() - s.startTime.getTime()) / 1000)
            finalDuration = diffSeconds

            if (diffSeconds > (BREAK_RULES.MAX_MINUTES_PER_PAUSE * 60)) {
                finalStatus = 'sforata'
                finalExceeded = diffSeconds - (BREAK_RULES.MAX_MINUTES_PER_PAUSE * 60)
            }
        }

        totalSeconds += finalDuration
        if (finalStatus === 'sforata') {
            exceededCount += 1
            totalExceededSeconds += finalExceeded
        }

        const gdoId = s.gdoUserId
        if (!gdoMap.has(gdoId)) {
            gdoMap.set(gdoId, {
                gdoId,
                userName: s.userName || "Utente Rimosso",
                pausesUsed: 0,
                totalSecondsDay: 0,
                exceededCount: 0,
                lastStatus: finalStatus,
                lastStart: s.startTime,
                lastEnd: s.endTime,
                sessions: []
            })
        }

        const gdoRecord = gdoMap.get(gdoId)
        gdoRecord.pausesUsed += 1
        gdoRecord.totalSecondsDay += finalDuration
        if (finalStatus === 'sforata') gdoRecord.exceededCount += 1

        // Update "last state" if this session is newer (already sorted by desc above)
        if (s.startTime > gdoRecord.lastStart) {
            gdoRecord.lastStatus = finalStatus
            gdoRecord.lastStart = s.startTime
            gdoRecord.lastEnd = s.endTime
        }

        gdoRecord.sessions.push({
            id: s.id,
            status: finalStatus,
            startTime: s.startTime,
            endTime: s.endTime,
            durationSeconds: finalDuration,
            exceededSeconds: finalExceeded,
            overrideReason: s.overrideReason
        })
    }

    return {
        kpi: {
            totalPauses,
            totalSeconds,
            exceededCount,
            totalExceededSeconds
        },
        gdoRows: Array.from(gdoMap.values())
    }
}

export async function getGdoPauseStatus(gdoId: string): Promise<PauseSummary> {
    const todayLocal = getLocalDateRome()

    const todaysPauses = await db.select()
            .from(breakSessions)
            .where(
                and(
                    eq(breakSessions.gdoUserId, gdoId),
                    eq(breakSessions.dateLocal, todayLocal)
                )
            )
            .orderBy(desc(breakSessions.createdAt))
        

    let usedPauses = 0
    let totalSecondsToday = 0
    let currentPause = null

    for (const p of todaysPauses) {
        if (p.status === 'conclusa' || p.status === 'sforata') {
            usedPauses += 1
            totalSecondsToday += p.durationSeconds || 0
        } else if (p.status === 'in_corso') {
            const now = new Date()
            const diffSeconds = Math.floor((now.getTime() - p.startTime.getTime()) / 1000)
            const isExceeded = diffSeconds > (BREAK_RULES.MAX_MINUTES_PER_PAUSE * 60)

            // Sync up DB se è scaduta nel mentre che il client fa polling
            if (isExceeded && p.exceededSeconds === 0) {
                await db.update(breakSessions)
                                    .set({ status: 'sforata', exceededSeconds: diffSeconds - (BREAK_RULES.MAX_MINUTES_PER_PAUSE * 60) })
                                    .where(eq(breakSessions.id, p.id))
                    
            }

            currentPause = {
                id: p.id,
                startTime: p.startTime.toISOString(),
                durationSeconds: diffSeconds,
                isExceeded
            }
        }
    }

    return {
        usedPauses,
        totalSecondsToday,
        currentPause,
    }
}

export type PauseHistoryEntry = {
    id: string
    dateLocal: string
    startTime: string // ISO string
    endTime: string | null
    durationSeconds: number
    status: string
    exceededSeconds: number
}

export async function getGdoPauseHistory(gdoId: string): Promise<PauseHistoryEntry[]> {
    const now = new Date()
    const yearMonth = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }).slice(0, 7) // "YYYY-MM"

    const sessions = await db.select()
        .from(breakSessions)
        .where(
            and(
                eq(breakSessions.gdoUserId, gdoId),
                sql`${breakSessions.dateLocal} LIKE ${yearMonth + '%'}`
            )
        )
        .orderBy(desc(breakSessions.startTime))

    return sessions.map(s => {
        let finalDuration = s.durationSeconds || 0
        let finalStatus = s.status
        let finalExceeded = s.exceededSeconds || 0

        // Sync live in_corso sessions
        if (s.status === 'in_corso') {
            const diffSeconds = Math.floor((now.getTime() - s.startTime.getTime()) / 1000)
            finalDuration = diffSeconds
            if (diffSeconds > BREAK_RULES.MAX_MINUTES_PER_PAUSE * 60) {
                finalStatus = 'sforata'
                finalExceeded = diffSeconds - BREAK_RULES.MAX_MINUTES_PER_PAUSE * 60
            }
        }

        return {
            id: s.id,
            dateLocal: s.dateLocal,
            startTime: s.startTime.toISOString(),
            endTime: s.endTime?.toISOString() ?? null,
            durationSeconds: finalDuration,
            status: finalStatus,
            exceededSeconds: finalExceeded,
        }
    })
}

export async function startPause(gdoId: string) {
    const status = await getGdoPauseStatus(gdoId)

    if (status.currentPause) {
        throw new Error("Hai già una pausa in corso.")
    }

    const todayLocal = getLocalDateRome()
    const now = new Date()

    await db.insert(breakSessions).values({
            id: crypto.randomUUID(),
            gdoUserId: gdoId,
            dateLocal: todayLocal,
            breakIndex: status.usedPauses + 1,
            startTime: now,
            status: 'in_corso',
            createdAt: now,
        })

    return true
}

export async function stopPause(sessionId: string) {
    const session = (await db.select().from(breakSessions).where(eq(breakSessions.id, sessionId)))[0]

    if (!session) throw new Error("Sessione pausa non trovata.")
    if (session.status !== 'in_corso' && session.status !== 'sforata') throw new Error("La pausa è già conclusa.")

    const now = new Date()
    const diffSeconds = Math.floor((now.getTime() - session.startTime.getTime()) / 1000)
    const allowedSeconds = BREAK_RULES.MAX_MINUTES_PER_PAUSE * 60

    let finalStatus = 'conclusa'
    let exceededSeconds = 0

    if (diffSeconds > allowedSeconds) {
        finalStatus = 'sforata'
        exceededSeconds = diffSeconds - allowedSeconds
    }

    await db.update(breakSessions)
            .set({
                endTime: now,
                durationSeconds: diffSeconds,
                status: finalStatus,
                exceededSeconds,
            })
            .where(eq(breakSessions.id, sessionId))
        

    return true
}
