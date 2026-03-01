import { google } from 'googleapis';
import { db } from "@/db"
import { calendarConnections, calendarEvents } from "@/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

export function getAuthUrl(state: string) {
    const scopes = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
    ];

    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes,
        state: state // Passiamo l'id dell'utente come state
    });
}

export async function getTokensFromCode(code: string) {
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
}

export async function refreshAccessToken(userId: string) {
    const connection = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.userId, userId)
    });

    if (!connection) throw new Error("Connection not found");
    if (!connection.refreshToken) throw new Error("No refresh token");

    oauth2Client.setCredentials({
        refresh_token: connection.refreshToken
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    // Update tokens in db
    await db.update(calendarConnections).set({
        accessToken: credentials.access_token!,
        tokenExpiry: new Date(credentials.expiry_date || Date.now() + 3600000)
    }).where(eq(calendarConnections.id, connection.id))

    return credentials.access_token;
}

export async function createGoogleCalendarEvent(userId: string, eventDetails: any, associatedEntityId: string, eventType: string) {
    let connection = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.userId, userId)
    });

    if (!connection) {
        console.warn(`No calendar connection for user ${userId}, skipping event creation.`);
        return null; // The user didn't connect their calendar
    }

    let accessToken = connection.accessToken;

    // Check expiry
    if (connection.tokenExpiry && connection.tokenExpiry < new Date()) {
        accessToken = await refreshAccessToken(userId) as string;
    }

    oauth2Client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    try {
        const res = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
                summary: eventDetails.summary,
                description: eventDetails.description,
                start: {
                    dateTime: eventDetails.startTime.toISOString(),
                    timeZone: 'Europe/Rome',
                },
                end: {
                    dateTime: eventDetails.endTime.toISOString(),
                    timeZone: 'Europe/Rome',
                },
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'popup', minutes: 30 },
                    ],
                }
            }
        });

        // Controlla se abbiamo il lead in db

        await db.insert(calendarEvents).values({
            id: crypto.randomUUID(),
            userId,
            leadId: associatedEntityId || "no_lead",
            eventType, // "appointment", "follow_up_1", "follow_up_2"
            googleEventId: res.data.id!,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        return res.data;
    } catch (e: any) {
        console.error("Error creating google calendar event", e.message);
        // Dipende dal tipo di errore potremmo voler rimuovere la token o notificare
        return null;
    }
}
