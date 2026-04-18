"use server"

import { db } from "@/db"
import { callLogs, leads, users } from "@/db/schema"
import { and, eq, gte, lte } from "drizzle-orm"

export type OperativaDataRow = {
    userId: string
    userName: string
    oreLavorate: number
    chiamate: number
    risposte: number
    tassoRisposta: number
    appuntamenti: number
    leadAssegnati: number
    leadGestiti: number
    leadDB: number
    leadNuovi: number
    appuntamentiOrari: number
    leadGestitiOrari: number
    fissaggioNuovi: number
    fissaggioDB: number
    fissaggioTotale: number
    contrattiChiusi: number
}

export async function getManagerOperativaData(period: 'OGGI' | 'MESE' | 'TRIMESTRE'): Promise<OperativaDataRow[]> {
    const now = new Date()
    let startDate = new Date()
    let endDate = new Date()

    if (period === 'OGGI') {
        startDate.setHours(0, 0, 0, 0)
        endDate.setHours(23, 59, 59, 999)
    } else if (period === 'MESE') {
        startDate.setDate(1)
        startDate.setHours(0, 0, 0, 0)
        // L'ultimo giorno del mese solare attuale può essere saltato calcolando il 1° giorno del mese successivo meno una frazione,
        // ma è più sicuro fino a NOW per avere una base realistica, oppure calcoliamo semplicemente Mese intero.
        endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0, 23, 59, 59, 999)
    } else if (period === 'TRIMESTRE') {
        startDate.setDate(now.getDate() - 90)
        startDate.setHours(0, 0, 0, 0)
        endDate.setHours(23, 59, 59, 999)
    }

    // Usiamo Promise.all() per queries pesanti simultanee
    const [gdos, logsRaw, appointments, assignedLeadsRaw] = await Promise.all([
        db.select({ id: users.id, name: users.name, displayName: users.displayName }).from(users).where(eq(users.role, 'GDO')),
        db.select({
            id: callLogs.id,
            userId: callLogs.userId,
            leadId: callLogs.leadId,
            outcome: callLogs.outcome,
            createdAt: callLogs.createdAt,
            leadFunnel: leads.funnel,
        }).from(callLogs)
            .leftJoin(leads, eq(callLogs.leadId, leads.id))
            .where(and(gte(callLogs.createdAt, startDate), lte(callLogs.createdAt, endDate))),

        db.select({
            id: leads.id,
            assignedToId: leads.assignedToId,
            funnel: leads.funnel,
            salespersonOutcome: leads.salespersonOutcome,
            confirmationsOutcome: leads.confirmationsOutcome,
        }).from(leads)
            .where(and(gte(leads.appointmentCreatedAt, startDate), lte(leads.appointmentCreatedAt, endDate))),

        // leadAssegnati = lead assegnati al GDO nel periodo, indipendentemente
        // dallo status. Prima filtrava solo status='NEW', perdendo tutti i
        // lead già lavorati (IN_PROGRESS/APPOINTMENT/REJECTED) — circa il 96%
        // del totale mensile, il numero risultava enormemente sottostimato.
        db.select({
            assignedToId: leads.assignedToId,
        }).from(leads)
            .where(and(gte(leads.createdAt, startDate), lte(leads.createdAt, endDate)))
    ])

    const gdoDataMap = new Map<string, any>()

    for (const gdo of gdos) {
        gdoDataMap.set(gdo.id, {
            userId: gdo.id,
            userName: gdo.displayName || gdo.name || 'GDO',
            oreLavorate: 0,
            chiamate: 0,
            risposte: 0,
            tassoRisposta: 0,
            appuntamenti: 0,
            leadAssegnati: 0,
            leadGestiti: 0,
            leadDB: 0,
            leadNuovi: 0,
            appuntamentiOrari: 0,
            leadGestitiOrari: 0,
            fissaggioNuovi: 0,
            fissaggioDB: 0,
            fissaggioTotale: 0,
            contrattiChiusi: 0,
            _uniqueLeadsDB: new Set<string>(),
            _uniqueLeadsNuovi: new Set<string>(),
            _uniqueLeadsTotal: new Set<string>(),
            _apptNuovi: 0,
            _apptDB: 0,
        })
    }

    const gdoLogsByDay = new Map<string, Map<string, Date[]>>()

    for (const log of logsRaw) {
        if (!log.userId || !gdoDataMap.has(log.userId)) continue

        const row = gdoDataMap.get(log.userId)!
        row.chiamate++
        // Outcome DIVERSO da 'NON_RISPOSTO' e 'Non_risponde'
        const oc = log.outcome?.toUpperCase() || ''
        if (oc !== 'NON_RISPOSTO' && oc !== 'NON_RISPONDE') {
            row.risposte++
        }

        if (log.leadId) {
            row._uniqueLeadsTotal.add(log.leadId)
            const fnl = log.leadFunnel?.toUpperCase() || ''
            if (fnl === 'DATABASE') {
                row._uniqueLeadsDB.add(log.leadId)
            } else {
                row._uniqueLeadsNuovi.add(log.leadId)
            }
        }

        const dStr = log.createdAt.toISOString().split('T')[0]
        if (!gdoLogsByDay.has(log.userId)) gdoLogsByDay.set(log.userId, new Map())
        const dayMap = gdoLogsByDay.get(log.userId)!
        if (!dayMap.has(dStr)) dayMap.set(dStr, [])
        dayMap.get(dStr)!.push(log.createdAt)
    }

    // Calcolo automagico delle Ore Lavorate (Start - End per Giorno + 5m offset)
    for (const [userId, dayMap] of Array.from(gdoLogsByDay.entries())) {
        const row = gdoDataMap.get(userId)
        if (!row) continue

        let totalMs = 0
        for (const [day, times] of Array.from(dayMap.entries())) {
            if (times.length === 0) continue
            times.sort((a, b) => a.getTime() - b.getTime())
            const first = times[0]
            const last = times[times.length - 1]

            let ms = last.getTime() - first.getTime()
            ms += 5 * 60 * 1000 // Aggiunta 5 min
            totalMs += ms
        }
        row.oreLavorate = totalMs / (1000 * 60 * 60)
    }

    // Match degli Appuntamenti
    for (const appt of appointments) {
        if (!appt.assignedToId || !gdoDataMap.has(appt.assignedToId)) continue
        const row = gdoDataMap.get(appt.assignedToId)!

        row.appuntamenti++
        const fnl = appt.funnel?.toUpperCase() || ''
        if (fnl === 'DATABASE') {
            row._apptDB++
        } else {
            row._apptNuovi++
        }

        const isSalesClosed = appt.salespersonOutcome?.toLowerCase() === 'chiuso'
        const isConfirmed = appt.confirmationsOutcome?.toLowerCase() === 'confermato'
        if (isSalesClosed && isConfirmed) {
            row.contrattiChiusi++
        }
    }

    // Lead Nuovi assegnati nel periodo
    for (const lead of assignedLeadsRaw) {
        if (!lead.assignedToId || !gdoDataMap.has(lead.assignedToId)) continue
        gdoDataMap.get(lead.assignedToId)!.leadAssegnati++
    }

    // Compute Math e Protezione NaN
    const result: OperativaDataRow[] = Array.from(gdoDataMap.values()).map(row => {
        row.leadGestiti = row._uniqueLeadsTotal.size
        row.leadDB = row._uniqueLeadsDB.size
        row.leadNuovi = row._uniqueLeadsNuovi.size

        row.tassoRisposta = row.chiamate > 0 ? (row.risposte / row.chiamate) * 100 : 0
        row.appuntamentiOrari = row.oreLavorate > 0 ? row.appuntamenti / row.oreLavorate : 0
        row.leadGestitiOrari = row.oreLavorate > 0 ? row.leadGestiti / row.oreLavorate : 0
        row.fissaggioTotale = row.leadGestiti > 0 ? (row.appuntamenti / row.leadGestiti) * 100 : 0
        row.fissaggioNuovi = row.leadNuovi > 0 ? (row._apptNuovi / row.leadNuovi) * 100 : 0
        row.fissaggioDB = row.leadDB > 0 ? (row._apptDB / row.leadDB) * 100 : 0

        const cleanNumber = (val: number) => {
            if (isNaN(val) || !isFinite(val)) return 0
            return Number(val.toFixed(2)) // Arrotonda decimali
        }

        row.tassoRisposta = cleanNumber(row.tassoRisposta)
        row.appuntamentiOrari = cleanNumber(row.appuntamentiOrari)
        row.leadGestitiOrari = cleanNumber(row.leadGestitiOrari)
        row.fissaggioTotale = cleanNumber(row.fissaggioTotale)
        row.fissaggioNuovi = cleanNumber(row.fissaggioNuovi)
        row.fissaggioDB = cleanNumber(row.fissaggioDB)
        row.oreLavorate = cleanNumber(row.oreLavorate)

        delete row._uniqueLeadsTotal
        delete row._uniqueLeadsDB
        delete row._uniqueLeadsNuovi
        delete row._apptNuovi
        delete row._apptDB

        return row as OperativaDataRow
    })

    // Ordino per Appuntamenti Fissati (Ranking primario)
    result.sort((a, b) => b.appuntamenti - a.appuntamenti)

    return result
}
