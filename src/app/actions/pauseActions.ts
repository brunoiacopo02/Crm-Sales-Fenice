"use server"

import { db } from "@/db"
import { breakSessions, users } from "@/db/schema"
import { eq, and, desc, sql, gte, lte } from "drizzle-orm"
import crypto from "crypto"
import { BREAK_RULES, getLocalDateRome } from "@/lib/pauseUtils"

// ─── Types ────────────────────────────────────────────────────────────

export type PauseSummary = {
    usedPauses: number
    totalSecondsToday: number
    remainingSeconds: number
    dailyExceeded: boolean
    dailyExceededSeconds: number
    currentPause: {
        id: string
        startTime: string
        durationSeconds: number
    } | null
}

export type PauseHistoryEntry = {
    id: string
    dateLocal: string
    startTime: string
    endTime: string | null
    durationSeconds: number
    status: string
    exceededSeconds: number
}

// ─── Helpers ──────────────────────────────────────────────────────────

const MAX_DAILY_SECONDS = BREAK_RULES.MAX_DAILY_MINUTES * 60

function computeDailyTotal(
    sessions: { durationSeconds: number | null; status: string; startTime: Date }[],
    now: Date,
): number {
    let total = 0
    for (const s of sessions) {
        if (s.status === 'in_corso') {
            total += Math.floor((now.getTime() - s.startTime.getTime()) / 1000)
        } else {
            total += s.durationSeconds || 0
        }
    }
    return total
}

// ─── GDO Status ───────────────────────────────────────────────────────

export async function getGdoPauseStatus(gdoId: string): Promise<PauseSummary> {
    const todayLocal = getLocalDateRome()

    const todaysPauses = await db.select()
        .from(breakSessions)
        .where(and(
            eq(breakSessions.gdoUserId, gdoId),
            eq(breakSessions.dateLocal, todayLocal)
        ))
        .orderBy(desc(breakSessions.createdAt))

    const now = new Date()
    let usedPauses = 0
    let currentPause: PauseSummary['currentPause'] = null

    for (const p of todaysPauses) {
        if (p.status === 'in_corso') {
            const diffSeconds = Math.floor((now.getTime() - p.startTime.getTime()) / 1000)
            currentPause = {
                id: p.id,
                startTime: p.startTime.toISOString(),
                durationSeconds: diffSeconds,
            }
        } else {
            usedPauses += 1
        }
    }

    const totalSecondsToday = computeDailyTotal(todaysPauses, now)
    const remainingSeconds = Math.max(0, MAX_DAILY_SECONDS - totalSecondsToday)
    const dailyExceeded = totalSecondsToday > MAX_DAILY_SECONDS
    const dailyExceededSeconds = dailyExceeded ? totalSecondsToday - MAX_DAILY_SECONDS : 0

    return {
        usedPauses,
        totalSecondsToday,
        remainingSeconds,
        dailyExceeded,
        dailyExceededSeconds,
        currentPause,
    }
}

// ─── Start / Stop ─────────────────────────────────────────────────────

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
    if (session.status !== 'in_corso') throw new Error("La pausa è già conclusa.")

    const now = new Date()
    const diffSeconds = Math.floor((now.getTime() - session.startTime.getTime()) / 1000)

    // Compute the daily total AFTER this session ends
    const allToday = await db.select()
        .from(breakSessions)
        .where(and(
            eq(breakSessions.gdoUserId, session.gdoUserId),
            eq(breakSessions.dateLocal, session.dateLocal),
        ))

    let otherCompletedSeconds = 0
    for (const s of allToday) {
        if (s.id === session.id) continue
        if (s.status === 'in_corso') continue
        otherCompletedSeconds += s.durationSeconds || 0
    }

    const newDailyTotal = otherCompletedSeconds + diffSeconds
    const dailyExceeded = newDailyTotal > MAX_DAILY_SECONDS
    const exceededSeconds = dailyExceeded ? newDailyTotal - MAX_DAILY_SECONDS : 0

    await db.update(breakSessions)
        .set({
            endTime: now,
            durationSeconds: diffSeconds,
            status: dailyExceeded ? 'sforata' : 'conclusa',
            exceededSeconds,
        })
        .where(eq(breakSessions.id, sessionId))

    return true
}

// ─── GDO History ──────────────────────────────────────────────────────

export async function getGdoPauseHistory(gdoId: string): Promise<PauseHistoryEntry[]> {
    const now = new Date()
    const yearMonth = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }).slice(0, 7)

    const sessions = await db.select()
        .from(breakSessions)
        .where(and(
            eq(breakSessions.gdoUserId, gdoId),
            sql`${breakSessions.dateLocal} LIKE ${yearMonth + '%'}`
        ))
        .orderBy(desc(breakSessions.startTime))

    return sessions.map(s => {
        let finalDuration = s.durationSeconds || 0
        if (s.status === 'in_corso') {
            finalDuration = Math.floor((now.getTime() - s.startTime.getTime()) / 1000)
        }

        return {
            id: s.id,
            dateLocal: s.dateLocal,
            startTime: s.startTime.toISOString(),
            endTime: s.endTime?.toISOString() ?? null,
            durationSeconds: finalDuration,
            status: s.status,
            exceededSeconds: s.exceededSeconds || 0,
        }
    })
}

// ─── Manager Reports ──────────────────────────────────────────────────

export async function getManagerPauseReport(dateLocal?: string) {
    const targetDate = dateLocal || getLocalDateRome()

    const sessions = await db.select({
        id: breakSessions.id,
        gdoUserId: breakSessions.gdoUserId,
        userName: users.name,
        displayName: users.displayName,
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

    const now = new Date()
    let totalPauses = sessions.length
    let totalSeconds = 0
    let totalExceededSeconds = 0
    let exceededCount = 0

    const gdoMap = new Map<string, any>()

    for (const s of sessions) {
        let finalDuration = s.durationSeconds || 0
        let finalStatus = s.status

        if (s.status === 'in_corso') {
            finalDuration = Math.floor((now.getTime() - s.startTime.getTime()) / 1000)
        }

        totalSeconds += finalDuration

        const gdoId = s.gdoUserId
        if (!gdoMap.has(gdoId)) {
            gdoMap.set(gdoId, {
                gdoId,
                userName: s.displayName || s.userName || "GDO",
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
            exceededSeconds: s.exceededSeconds || 0,
            overrideReason: s.overrideReason,
        })
    }

    // Compute daily exceeded per GDO
    for (const [, gdoRecord] of gdoMap) {
        if (gdoRecord.totalSecondsDay > MAX_DAILY_SECONDS) {
            gdoRecord.exceededCount = 1
            gdoRecord.dailyExceededSeconds = gdoRecord.totalSecondsDay - MAX_DAILY_SECONDS
            exceededCount += 1
            totalExceededSeconds += gdoRecord.dailyExceededSeconds
        } else {
            gdoRecord.dailyExceededSeconds = 0
        }
        // Mark lastStatus based on daily total
        if (gdoRecord.totalSecondsDay > MAX_DAILY_SECONDS && gdoRecord.lastStatus !== 'in_corso') {
            gdoRecord.lastStatus = 'sforata'
        }
    }

    return {
        kpi: { totalPauses, totalSeconds, exceededCount, totalExceededSeconds },
        gdoRows: Array.from(gdoMap.values()),
    }
}

// ─── Weekly / Monthly aggregate reports ───────────────────────────────

export type PauseReportRow = {
    gdoId: string
    gdoName: string
    dateLocal: string
    pauseCount: number
    totalSeconds: number
    exceeded: boolean
    exceededSeconds: number
}

export type PauseAggregateReport = {
    rows: PauseReportRow[]
    summary: {
        totalDays: number
        totalExceededDays: number
        totalExceededSeconds: number
    }
}

async function getAggregateReport(dateFrom: string, dateTo: string): Promise<PauseAggregateReport> {
    const sessions = await db.select({
        gdoUserId: breakSessions.gdoUserId,
        displayName: users.displayName,
        userName: users.name,
        dateLocal: breakSessions.dateLocal,
        durationSeconds: breakSessions.durationSeconds,
        status: breakSessions.status,
        startTime: breakSessions.startTime,
    })
        .from(breakSessions)
        .leftJoin(users, eq(breakSessions.gdoUserId, users.id))
        .where(and(
            gte(breakSessions.dateLocal, dateFrom),
            lte(breakSessions.dateLocal, dateTo),
        ))
        .orderBy(breakSessions.dateLocal, breakSessions.gdoUserId)

    const now = new Date()
    // Group by (gdoId, dateLocal)
    const dayMap = new Map<string, PauseReportRow>()

    for (const s of sessions) {
        const key = `${s.gdoUserId}||${s.dateLocal}`
        if (!dayMap.has(key)) {
            dayMap.set(key, {
                gdoId: s.gdoUserId,
                gdoName: s.displayName || s.userName || 'GDO',
                dateLocal: s.dateLocal,
                pauseCount: 0,
                totalSeconds: 0,
                exceeded: false,
                exceededSeconds: 0,
            })
        }
        const row = dayMap.get(key)!
        row.pauseCount += 1

        let dur = s.durationSeconds || 0
        if (s.status === 'in_corso') {
            dur = Math.floor((now.getTime() - s.startTime.getTime()) / 1000)
        }
        row.totalSeconds += dur
    }

    // Compute exceeded per day
    const rows: PauseReportRow[] = []
    let totalExceededDays = 0
    let totalExceededSeconds = 0
    const daysSet = new Set<string>()

    for (const row of dayMap.values()) {
        daysSet.add(row.dateLocal)
        if (row.totalSeconds > MAX_DAILY_SECONDS) {
            row.exceeded = true
            row.exceededSeconds = row.totalSeconds - MAX_DAILY_SECONDS
            totalExceededDays += 1
            totalExceededSeconds += row.exceededSeconds
        }
        rows.push(row)
    }

    // Sort: exceeded first, then by date desc
    rows.sort((a, b) => {
        if (a.exceeded !== b.exceeded) return a.exceeded ? -1 : 1
        if (a.dateLocal !== b.dateLocal) return b.dateLocal.localeCompare(a.dateLocal)
        return a.gdoName.localeCompare(b.gdoName)
    })

    return {
        rows,
        summary: {
            totalDays: daysSet.size,
            totalExceededDays,
            totalExceededSeconds,
        },
    }
}

export async function getWeeklyPauseReport(): Promise<PauseAggregateReport> {
    const today = getLocalDateRome()
    const todayDate = new Date(today + 'T00:00:00')
    const dow = todayDate.getDay() // 0=Sun
    const mondayOffset = dow === 0 ? 6 : dow - 1
    const monday = new Date(todayDate.getTime() - mondayOffset * 86400000)
    const sunday = new Date(monday.getTime() + 6 * 86400000)

    const from = monday.toISOString().slice(0, 10)
    const to = sunday.toISOString().slice(0, 10)

    return getAggregateReport(from, to)
}

export async function getMonthlyPauseReport(yearMonth?: string): Promise<PauseAggregateReport> {
    const ym = yearMonth || getLocalDateRome().slice(0, 7)
    const from = `${ym}-01`
    const lastDay = new Date(parseInt(ym.slice(0, 4)), parseInt(ym.slice(5, 7)), 0).getDate()
    const to = `${ym}-${String(lastDay).padStart(2, '0')}`

    return getAggregateReport(from, to)
}
