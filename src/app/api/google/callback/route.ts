import { NextRequest, NextResponse } from "next/server"
import { getTokensFromCode } from "@/lib/googleCalendar"
import { db } from "@/db"
import { calendarConnections } from "@/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams
    const code = searchParams.get('code')
    const userId = searchParams.get('state') // We passed user ID in state

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"

    if (!code || !userId) {
        return NextResponse.redirect(new URL('/?error=missing_code_or_state', baseUrl))
    }

    try {
        const tokens = await getTokensFromCode(code)

        // Verifica se esiste già
        const existing = await db.query.calendarConnections.findFirst({
            where: eq(calendarConnections.userId, userId)
        })

        if (existing) {
            await db.update(calendarConnections).set({
                accessToken: tokens.access_token!,
                refreshToken: tokens.refresh_token || existing.refreshToken, // keep old if not provided
                tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600000),
                updatedAt: new Date()
            }).where(eq(calendarConnections.id, existing.id))
        } else {
            await db.insert(calendarConnections).values({
                id: crypto.randomUUID(),
                userId,
                provider: 'google',
                accessToken: tokens.access_token!,
                refreshToken: tokens.refresh_token!,
                tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600000),
                primaryCalendarId: 'primary',
                createdAt: new Date(),
                updatedAt: new Date(),
            })
        }

        // Return to venditore dashboard or team dashboard config
        return NextResponse.redirect(new URL('/venditore?success=calendar_connected', baseUrl))

    } catch (e: any) {
        console.error("Error exchanging code for token", e)
        return NextResponse.redirect(new URL('/?error=oauth_failed', baseUrl))
    }
}
