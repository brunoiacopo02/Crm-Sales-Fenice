"use server";

import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { and, desc, eq, gte, lte, or, sql, getTableColumns } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm";

export type ArchiveFilters = {
    fromDate?: string;
    toDate?: string;
    dateFilterType: 'createdAt' | 'appointmentDate';
    gdoId?: string;
    salespersonId?: string;
    outcome?: string;
    page?: number;
    limit?: number;
    exportAll?: boolean;
};

/** Convert "YYYY-MM-DD" to UTC Date at start of that day in Europe/Rome */
function toRomeStartOfDay(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    const noon = new Date(Date.UTC(y, m - 1, d, 12));
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        timeZoneName: 'longOffset'
    });
    const parts = fmt.formatToParts(noon);
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+01:00';
    const offset = tzPart.replace('GMT', '') || '+00:00';
    return new Date(`${dateStr}T00:00:00${offset}`);
}

/** Convert "YYYY-MM-DD" to UTC Date at end of that day (23:59:59.999) in Europe/Rome */
function toRomeEndOfDay(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    const noon = new Date(Date.UTC(y, m - 1, d, 12));
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        timeZoneName: 'longOffset'
    });
    const parts = fmt.formatToParts(noon);
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+01:00';
    const offset = tzPart.replace('GMT', '') || '+00:00';
    return new Date(`${dateStr}T23:59:59.999${offset}`);
}

export async function getArchiveLeads({
    fromDate,
    toDate,
    dateFilterType,
    gdoId,
    salespersonId,
    outcome,
    page = 1,
    limit = 50,
    exportAll = false
}: {
    fromDate?: string;
    toDate?: string;
    dateFilterType: 'createdAt' | 'appointmentDate';
    gdoId?: string;
    salespersonId?: string;
    outcome?: string;
    page?: number;
    limit?: number;
    exportAll?: boolean;
}) {
    try {
        const conditions = [];

        // 1. Date Range Filter — convert user dates from Rome timezone to UTC
        if (fromDate) {
            conditions.push(gte(leads[dateFilterType], toRomeStartOfDay(fromDate)));
        }
        if (toDate) {
            conditions.push(lte(leads[dateFilterType], toRomeEndOfDay(toDate)));
        }

        // 2. GDO Filter
        if (gdoId && gdoId !== 'all') {
            conditions.push(eq(leads.assignedToId, gdoId));
        }

        // 3. Salesperson Filter
        if (salespersonId && salespersonId !== 'all') {
            conditions.push(eq(leads.salespersonUserId, salespersonId));
        }

        // 4. Outcome Filter — values match client dropdown options exactly
        if (outcome && outcome !== 'all') {
            if (outcome === 'Chiuso') {
                conditions.push(eq(leads.salespersonOutcome, 'Chiuso'));
            } else if (outcome === 'Non chiuso') {
                conditions.push(eq(leads.salespersonOutcome, 'Non chiuso'));
            } else {
                // CONFERMATO, SCARTATO, or any other DB status value
                conditions.push(eq(leads.status, outcome));
            }
        }

        const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

        const gdoUser = aliasedTable(users, 'gdoUser');
        const salesUser = aliasedTable(users, 'salesUser');
        const confUser = aliasedTable(users, 'confUser');

        // Query execution
        let baseQuery = db.select({
            ...getTableColumns(leads),
            gdoName: gdoUser.name,
            salespersonName: salesUser.name,
            confermeName: confUser.name
        })
        .from(leads)
        .leftJoin(gdoUser, eq(leads.assignedToId, gdoUser.id))
        .leftJoin(salesUser, eq(leads.salespersonUserId, salesUser.id))
        .leftJoin(confUser, eq(leads.confirmationsUserId, confUser.id))
        .where(whereCondition)
        .orderBy(desc(leads[dateFilterType]));

        if (exportAll) {
            const data = await baseQuery;
            return { data, totalCount: data.length, totalPages: 1 };
        } else {
            const offset = (page - 1) * limit;
            
            // Get total count
            const countResult = await db.select({ count: sql<number>`count(*)` })
                .from(leads)
                .where(whereCondition);
            
            const totalCount = Number(countResult[0]?.count || 0);
            const totalPages = Math.ceil(totalCount / limit);

            const data = await baseQuery.limit(limit).offset(offset);

            return {
                data,
                totalCount,
                totalPages,
                page
            };
        }
    } catch (error) {
        console.error("Error fetching archive leads:", error);
        throw new Error("Failed to fetch archive leads");
    }
}
