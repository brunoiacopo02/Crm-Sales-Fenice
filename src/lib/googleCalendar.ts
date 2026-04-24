import { google } from 'googleapis';
import { db } from "@/db"
import { calendarConnections, calendarEvents } from "@/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"

// Factory: crea un nuovo OAuth2 client per ogni operazione.
// Evita race condition su Vercel dove warm instances condividono stato modulo singleton.
function createOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

export function getAuthUrl(state: string) {
    const scopes = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
    ];

    const client = createOAuth2Client();
    return client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes,
        state: state // Passiamo l'id dell'utente come state
    });
}

export async function getTokensFromCode(code: string) {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);
    return tokens;
}

export async function refreshAccessToken(userId: string) {
    const connection = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.userId, userId)
    });

    if (!connection) throw new Error("Connection not found");
    if (!connection.refreshToken) throw new Error("No refresh token");

    const client = createOAuth2Client();
    client.setCredentials({
        refresh_token: connection.refreshToken
    });

    let credentials;
    try {
        const res = await client.refreshAccessToken();
        credentials = res.credentials;
    } catch (e: any) {
        // invalid_grant = refresh token revoked/expired (common in Google OAuth "Testing" mode:
        // refresh tokens expire after 7 days). Delete the broken connection so the user can reconnect.
        const errorMsg = e?.message || e?.response?.data?.error || '';
        if (errorMsg.includes('invalid_grant') || e?.response?.data?.error === 'invalid_grant') {
            console.warn(`[googleCalendar] invalid_grant for user ${userId} — deleting connection so user can reconnect`);
            await db.delete(calendarConnections).where(eq(calendarConnections.id, connection.id));
        }
        throw e;
    }

    if (!credentials.access_token) {
        throw new Error("Failed to refresh: no access_token returned by Google");
    }

    // Salva access_token, expiry, E il nuovo refresh_token se Google lo ruota.
    // Google ruota periodicamente i refresh_token: se non salviamo il nuovo,
    // il vecchio diventa invalido e il calendario smette di funzionare (invalid_grant).
    const updateData: Record<string, unknown> = {
        accessToken: credentials.access_token,
        tokenExpiry: new Date(credentials.expiry_date || Date.now() + 3600000),
        updatedAt: new Date()
    };

    if (credentials.refresh_token) {
        updateData.refreshToken = credentials.refresh_token;
    }

    await db.update(calendarConnections).set(updateData).where(eq(calendarConnections.id, connection.id));

    return credentials.access_token;
}

export async function checkFreeBusy(userId: string, startTime: Date, endTime: Date): Promise<boolean> {
    const connection = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.userId, userId)
    });

    if (!connection) return true; // Se non è connesso al calendario passiamo oltre

    let accessToken = connection.accessToken;

    if (connection.tokenExpiry && connection.tokenExpiry < new Date()) {
        try {
            accessToken = await refreshAccessToken(userId) as string;
        } catch (e) {
            console.error("Unable to refresh token for FreeBusy check", e);
            return true;
        }
    }

    const client = createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const calendar = google.calendar({ version: 'v3', auth: client });

    try {
        const res = await calendar.freebusy.query({
            requestBody: {
                timeMin: startTime.toISOString(),
                timeMax: endTime.toISOString(),
                items: [{ id: 'primary' }]
            }
        });

        const busySlots = res.data.calendars?.['primary']?.busy;
        return busySlots && busySlots.length > 0 ? false : true; // false = occupato, true = libero
    } catch (e: any) {
        console.error("Error checking freebusy", e.message);
        return true; // Fallback to true su errori API
    }
}

/**
 * Ritorna gli slot occupati del calendario Google primario di un utente
 * nell'intervallo indicato. Se l'utente non ha connesso Google Calendar,
 * ritorna array vuoto (non è un errore). Usato per visualizzare la
 * disponibilità reale dei venditori oltre ai soli appuntamenti CRM.
 */
export async function getBusySlotsForUser(
    userId: string,
    startTime: Date,
    endTime: Date,
): Promise<Array<{ start: Date; end: Date }>> {
    const connection = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.userId, userId),
    });
    if (!connection) return [];

    let accessToken = connection.accessToken;
    if (connection.tokenExpiry && connection.tokenExpiry < new Date()) {
        try {
            accessToken = await refreshAccessToken(userId) as string;
        } catch {
            return [];
        }
    }

    const client = createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const calendar = google.calendar({ version: 'v3', auth: client });

    try {
        const res = await calendar.freebusy.query({
            requestBody: {
                timeMin: startTime.toISOString(),
                timeMax: endTime.toISOString(),
                items: [{ id: 'primary' }],
            },
        });
        const busy = res.data.calendars?.['primary']?.busy || [];
        return busy
            .filter((b) => b.start && b.end)
            .map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
    } catch (e: any) {
        console.error(`[googleCalendar] getBusySlotsForUser error (${userId}):`, e.message);
        return [];
    }
}

export async function hasCalendarConnection(userId: string): Promise<boolean> {
    const connection = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.userId, userId),
    });
    return !!connection;
}

export async function createGoogleCalendarEvent(userId: string, eventDetails: any, associatedEntityId: string, eventType: string) {
    const connection = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.userId, userId)
    });

    if (!connection) {
        console.warn(`[googleCalendar] No calendar connection for user ${userId}, skipping event creation.`);
        return null;
    }

    let accessToken = connection.accessToken;

    // Check expiry
    if (connection.tokenExpiry && connection.tokenExpiry < new Date()) {
        try {
            accessToken = await refreshAccessToken(userId) as string;
        } catch (e: any) {
            console.error(`[googleCalendar] Refresh failed for user ${userId}:`, e.message);
            return null;
        }
    }

    const client = createOAuth2Client();
    client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({ version: 'v3', auth: client });

    try {
        const requestBody: any = {
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
            },
            // Google Meet conference — creates hangoutLink on the event
            conferenceData: {
                createRequest: {
                    requestId: `crm-${associatedEntityId}-${Date.now()}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            }
        };

        if (eventDetails.attendees && eventDetails.attendees.length > 0) {
            requestBody.attendees = eventDetails.attendees;
        }

        const res = await calendar.events.insert({
            calendarId: 'primary',
            sendUpdates: 'all', // Manda mail di invito agli attendees
            conferenceDataVersion: 1, // Required to create Meet link
            requestBody
        });

        let eventData = res.data;
        let meetLink: string | null | undefined = eventData.hangoutLink;

        // Se il Meet non è stato creato al primo colpo (Google a volte
        // ignora la createRequest in certi edge case), ritento via patch.
        if (!meetLink && eventData.id) {
            try {
                const patchRes = await calendar.events.patch({
                    calendarId: 'primary',
                    eventId: eventData.id,
                    conferenceDataVersion: 1,
                    sendUpdates: 'none',
                    requestBody: {
                        conferenceData: {
                            createRequest: {
                                requestId: `crm-retry-${associatedEntityId}-${Date.now()}`,
                                conferenceSolutionKey: { type: 'hangoutsMeet' }
                            }
                        }
                    }
                });
                eventData = patchRes.data;
                meetLink = eventData.hangoutLink;
            } catch (patchErr: any) {
                console.warn(`[googleCalendar] Meet patch retry failed for event ${eventData.id}:`, patchErr.message);
            }
        }

        // Se abbiamo il link, lo inietto nella description così appare
        // nell'email di invito al lead e nell'evento calendar in modo
        // esplicito (oltre al link "Partecipa con Google Meet" standard).
        if (meetLink && eventData.id) {
            try {
                const updatedDescription = `${eventDetails.description}\n\n🎥 Link Google Meet: ${meetLink}`;
                const patchRes = await calendar.events.patch({
                    calendarId: 'primary',
                    eventId: eventData.id,
                    sendUpdates: 'all', // (re)invia invito con description aggiornata
                    requestBody: { description: updatedDescription }
                });
                eventData = patchRes.data;
            } catch (descErr: any) {
                console.warn(`[googleCalendar] Could not inject Meet link into description:`, descErr.message);
            }
        }

        await db.insert(calendarEvents).values({
            id: crypto.randomUUID(),
            userId,
            leadId: associatedEntityId || "no_lead",
            eventType,
            googleEventId: eventData.id!,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        console.log(`[googleCalendar] Event created for user ${userId}: ${eventData.id} — Meet: ${meetLink || 'NOT CREATED (check user Workspace config)'}`);
        return eventData;
    } catch (e: any) {
        console.error(`[googleCalendar] Error creating event for user ${userId}:`, e.message, e?.response?.data || '');
        return null;
    }
}

export async function deleteGoogleCalendarEvent(userId: string, eventId: string) {
    const connection = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.userId, userId)
    });

    if (!connection) return false;

    let accessToken = connection.accessToken;
    if (connection.tokenExpiry && connection.tokenExpiry < new Date()) {
        try {
            accessToken = await refreshAccessToken(userId) as string;
        } catch (e) {
            console.error("Unable to refresh token for delete", e);
            return false;
        }
    }

    const client = createOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const calendar = google.calendar({ version: 'v3', auth: client });

    try {
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: eventId,
            sendUpdates: 'all'
        });
        return true;
    } catch (e: any) {
        console.error("Error deleting calendar event", e.message);
        return false;
    }
}
