import 'dotenv/config';
import pg from 'pg';
import { google } from 'googleapis';

const { Pool } = pg;
const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const SALES001_ID = '424fef5b-7035-4e5f-949e-863f850f8bcb';
const LEAD_EMAIL = 'info@feniceacademy.it';

function makeClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function getValidAccessToken() {
  const { rows } = await pool.query(
    `SELECT id, "accessToken", "refreshToken", "tokenExpiry" FROM "calendarConnections" WHERE "userId" = $1`,
    [SALES001_ID]
  );
  if (!rows.length) throw new Error('No connection for sales001');
  const conn = rows[0];

  // Refresh if expired
  if (conn.tokenExpiry < new Date()) {
    console.log('Token expired, refreshing...');
    const client = makeClient();
    client.setCredentials({ refresh_token: conn.refreshToken });
    const { credentials } = await client.refreshAccessToken();
    await pool.query(
      `UPDATE "calendarConnections" SET "accessToken"=$1, "tokenExpiry"=$2, "updatedAt"=NOW() WHERE id=$3`,
      [credentials.access_token, new Date(credentials.expiry_date), conn.id]
    );
    return credentials.access_token;
  }
  return conn.accessToken;
}

// Build a date "today at HH:00" in Europe/Rome as ISO string with correct offset
function romeTodayAt(hour) {
  // Current date in Rome
  const now = new Date();
  // Get Rome date string like 2026-04-14
  const romeDateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const dateStr = `${romeDateParts.year}-${romeDateParts.month}-${romeDateParts.day}`;

  // Rome in April is CEST (UTC+2). Check DST: mid-April is always DST in Rome.
  // 18:00 local = 16:00 UTC → ISO: `${dateStr}T18:00:00+02:00`
  return `${dateStr}T${String(hour).padStart(2, '0')}:00:00+02:00`;
}

async function checkSlot(cal, startIso, endIso, label) {
  const res = await cal.freebusy.query({
    requestBody: {
      timeMin: startIso,
      timeMax: endIso,
      items: [{ id: 'primary' }]
    }
  });
  const busy = res.data.calendars?.['primary']?.busy || [];
  console.log(`\n[freeBusy ${label}] busy slots:`, JSON.stringify(busy, null, 2));
  return busy.length === 0;
}

async function createEvent(cal, startIso, endIso, label) {
  const res = await cal.events.insert({
    calendarId: 'primary',
    sendUpdates: 'all',
    conferenceDataVersion: 1,
    requestBody: {
      summary: `TEST CRM Appuntamento ${label}`,
      description: `Test evento creato dallo script di diagnostica.\nLead: Test Lead\nEmail: ${LEAD_EMAIL}`,
      start: { dateTime: startIso, timeZone: 'Europe/Rome' },
      end: { dateTime: endIso, timeZone: 'Europe/Rome' },
      attendees: [{ email: LEAD_EMAIL }],
      conferenceData: {
        createRequest: {
          requestId: `test-${label}-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }
    }
  });
  return res.data;
}

try {
  const accessToken = await getValidAccessToken();
  const client = makeClient();
  client.setCredentials({ access_token: accessToken });
  const cal = google.calendar({ version: 'v3', auth: client });

  // ============= TEST 1: 18:00 slot (should be FREE, create event) =============
  console.log('\n========== TEST 1: Appuntamento oggi alle 18:00 ==========');
  const start18 = romeTodayAt(18);
  const end18   = romeTodayAt(19);
  console.log('Start:', start18, '| End:', end18);

  const free18 = await checkSlot(cal, start18, end18, '18:00-19:00');
  console.log('Is 18:00 free?', free18);

  if (free18) {
    const evt = await createEvent(cal, start18, end18, '18-00');
    console.log('\n✅ Event created at 18:00');
    console.log('   ID:', evt.id);
    console.log('   htmlLink:', evt.htmlLink);
    console.log('   hangoutLink (Meet):', evt.hangoutLink);
    console.log('   conferenceData status:', evt.conferenceData?.createRequest?.status?.statusCode);
    console.log('   Meet entry points:', JSON.stringify(evt.conferenceData?.entryPoints, null, 2));
    console.log('   attendees:', JSON.stringify(evt.attendees, null, 2));
  } else {
    console.log('⚠️ 18:00 slot is BUSY — not creating event.');
  }

  // ============= TEST 2: 16:00 slot (should be BUSY, should block) =============
  console.log('\n========== TEST 2: Appuntamento oggi alle 16:00 (atteso BUSY) ==========');
  const start16 = romeTodayAt(16);
  const end16   = romeTodayAt(17);
  console.log('Start:', start16, '| End:', end16);

  const free16 = await checkSlot(cal, start16, end16, '16:00-17:00');
  console.log('Is 16:00 free?', free16);

  if (!free16) {
    console.log('\n✅ Correttamente rilevato BUSY → il CRM bloccherebbe la creazione con:');
    console.log('   "Il venditore selezionato ha già un impegno in questa fascia oraria in Google Calendar."');
  } else {
    console.log('\n⚠️ ATTENZIONE: lo slot 16:00 risulta LIBERO secondo Google Calendar.');
    console.log('   Verifica che l\'evento esistente sul calendar di sales001 alle 16:00 sia:');
    console.log('   - sul calendar "primary" (non su un secondario)');
    console.log('   - con status "confirmed" (non declined)');
    console.log('   - davvero nell\'intervallo 16:00-17:00 Europe/Rome');
  }

} catch (e) {
  console.error('\n❌ Error:', e.message);
  if (e.response?.data) console.error('API response:', JSON.stringify(e.response.data, null, 2));
  process.exit(1);
} finally {
  await pool.end();
}
