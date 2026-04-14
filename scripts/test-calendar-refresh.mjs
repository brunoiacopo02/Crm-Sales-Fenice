import 'dotenv/config';
import pg from 'pg';
import { google } from 'googleapis';

const { Pool } = pg;
const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const SALES001_ID = '424fef5b-7035-4e5f-949e-863f850f8bcb';

try {
  const { rows } = await pool.query(
    `SELECT "accessToken", "refreshToken", "tokenExpiry" FROM "calendarConnections" WHERE "userId" = $1`,
    [SALES001_ID]
  );
  if (!rows.length) { console.log('No connection'); process.exit(1); }
  const conn = rows[0];
  console.log('Current token expiry:', conn.tokenExpiry, '— expired:', conn.tokenExpiry < new Date());

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: conn.refreshToken });

  console.log('Attempting refresh...');
  try {
    const { credentials } = await oauth2.refreshAccessToken();
    console.log('✅ Refresh OK. New expiry:', new Date(credentials.expiry_date));
    console.log('   New access_token len:', credentials.access_token?.length);
    console.log('   New refresh_token rotated:', !!credentials.refresh_token);

    // Save back
    await pool.query(
      `UPDATE "calendarConnections" SET "accessToken"=$1, "tokenExpiry"=$2, "updatedAt"=NOW()${credentials.refresh_token ? ', "refreshToken"=$4' : ''} WHERE "userId"=$3`,
      credentials.refresh_token
        ? [credentials.access_token, new Date(credentials.expiry_date), SALES001_ID, credentials.refresh_token]
        : [credentials.access_token, new Date(credentials.expiry_date), SALES001_ID]
    );
    console.log('✅ DB updated.');

    // Now try creating an event with Meet link
    oauth2.setCredentials({ access_token: credentials.access_token });
    const cal = google.calendar({ version: 'v3', auth: oauth2 });

    const start = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2h from now
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const res = await cal.events.insert({
      calendarId: 'primary',
      sendUpdates: 'all',
      conferenceDataVersion: 1,
      requestBody: {
        summary: 'TEST Appuntamento CRM — Fake Lead',
        description: 'Test evento creato da script diagnostico.\nLead: Finto Test\nTelefono: 0000000000\nEmail: info@feniceacademy.it',
        start: { dateTime: start.toISOString(), timeZone: 'Europe/Rome' },
        end: { dateTime: end.toISOString(), timeZone: 'Europe/Rome' },
        attendees: [{ email: 'info@feniceacademy.it' }],
        conferenceData: {
          createRequest: {
            requestId: 'test-meet-' + Date.now(),
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        },
        reminders: {
          useDefault: false,
          overrides: [{ method: 'popup', minutes: 30 }]
        }
      }
    });

    console.log('✅ Event created:', res.data.id);
    console.log('   htmlLink:', res.data.htmlLink);
    console.log('   hangoutLink:', res.data.hangoutLink);
    console.log('   conferenceData:', JSON.stringify(res.data.conferenceData, null, 2));
    console.log('   attendees:', JSON.stringify(res.data.attendees, null, 2));
  } catch (e) {
    console.error('❌ Error:', e.message);
    if (e.response?.data) console.error('   API response:', JSON.stringify(e.response.data, null, 2));
  }
} finally {
  await pool.end();
}
