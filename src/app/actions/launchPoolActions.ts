"use server"

import { db } from "@/db"
import { leads } from "@/db/schema"
import { and, isNull, isNotNull, sql } from "drizzle-orm"

export type LaunchPoolStatus = {
    webinarAvailable: number
    noWebinarAvailable: number
}

export async function getLaunchPoolStatus(): Promise<LaunchPoolStatus> {
    const rows = await db
        .select({
            bucket: leads.launchBucket,
            count: sql<number>`count(*)::int`
        })
        .from(leads)
        .where(and(isNotNull(leads.launchBucket), isNull(leads.assignedToId)))
        .groupBy(leads.launchBucket)

    let webinar = 0
    let noWebinar = 0
    for (const r of rows) {
        if (r.bucket === 'WEBINAR') webinar = r.count
        else if (r.bucket === 'NO_WEBINAR') noWebinar = r.count
    }

    return { webinarAvailable: webinar, noWebinarAvailable: noWebinar }
}
