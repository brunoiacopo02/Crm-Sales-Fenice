# Marketing Webhooks — Setup Env Vars

Per attivare l'invio dei webhook al CRM marketing esterno, settare in Vercel
(Project Settings → Environment Variables, scope: Production + Preview):

| Variabile | Valore | Scope | Note |
|---|---|---|---|
| `MARKETING_WEBHOOK_ENABLED` | `true` (kill-switch globale) | Production | Default off — settare a `true` solo dopo QA |
| `MARKETING_WEBHOOK_URL_PROD` | URL receiver del marketing (HTTPS) | Production + Preview | es. `https://dashboardmarketingvendita.vercel.app/api/webhooks/crm-fenice` |
| `MARKETING_WEBHOOK_SECRET` | 64 hex char | Production + Preview | Generato + condiviso col dev marketing via canale sicuro |
| `MARKETING_PULL_API_TOKEN` | base64url 32 byte | Production + Preview | Per il PULL endpoint, separato dal webhook secret |
| `CRON_SECRET` | base64url 32 byte | Production | Vercel Cron lo invia automaticamente in header Authorization |

## Test locale (dev server)

In `.env.local` (NON commitare):

```bash
MARKETING_WEBHOOK_ENABLED=true
MARKETING_WEBHOOK_URL_PROD=https://webhook.site/<your-uuid>
MARKETING_WEBHOOK_SECRET=<hex 64>
MARKETING_PULL_API_TOKEN=<base64url 32>
CRON_SECRET=<base64url 32>
```

Avvia `npm run dev`, poi triggera un evento dal CRM (es. fissa un appuntamento)
e verifica su https://webhook.site che il POST sia arrivato firmato.

### Generare i secret (one-shot)

```bash
node -e "console.log('MARKETING_WEBHOOK_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('MARKETING_PULL_API_TOKEN=' + require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('base64url'))"
```

## Triggerare manualmente un evento (debug)

```bash
# Da loggato come MANAGER nel CRM, dalla console browser
fetch('/api/marketing/debug/send-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType: 'appointment.set', leadId: '<lead-id-reale>' })
}).then(r => r.json()).then(console.log);
```

Eventi validi: `appointment.set`, `appointment.outcome`, `deal.assigned`, `deal.closed_won`, `deal.closed_lost`.

## PULL endpoint (backfill / recovery)

```bash
curl -H "Authorization: Bearer $MARKETING_PULL_API_TOKEN" \
     "https://<crm-domain>/api/marketing/leads?eventType=deal.closed_won&since=2026-05-01T00:00:00Z&limit=100"
```

Risposta:
```json
{
  "items": [ /* MarketingWebhookEnvelope[] - stesso formato dei webhook */ ],
  "nextCursor": "lead_xxx",
  "hasMore": true
}
```

Filtri supportati: `since` (ISO), `until` (ISO), `funnel`, `eventType`, `cursor`, `limit` (default 100, max 500).

## Disattivare temporaneamente (kill-switch)

Settare `MARKETING_WEBHOOK_ENABLED=false` su Vercel e fare redeploy (o redeploy automatico).
Gli eventi non vengono più enqueued. Le righe già in coda restano in stato `pending` ma il
cron skippa la consegna finché il flag torna `true`.

## Monitoraggio

Query SQL utile per verificare la salute del sistema:

```sql
SELECT status, COUNT(*) AS cnt
FROM "marketingWebhookDeliveries"
WHERE "createdAt" > now() - interval '24 hours'
GROUP BY status;
```

Risultato atteso a regime:
- `delivered`: 95%+
- `pending`: pochi (in fase di retry)
- `failed_permanent` / `dead`: 0 (se appaiono → contattare dev marketing)

## Architettura

- Server action emette evento → `enqueueMarketingWebhook()` → INSERT in `marketingWebhookDeliveries` (status=pending) + speculative delivery via `after()` di Next.js
- Vercel Cron `* * * * *` → `/api/cron/marketing-webhooks-drain` → drena i pending pronti, retry esponenziale (1m → 5m → 30m → 2h → 6h → DLQ)
- HMAC-SHA256 firma `${timestamp}.${rawBody}` con `MARKETING_WEBHOOK_SECRET`
- Idempotenza: `eventId` deterministico (SHA-256 di eventType+leadId+occurredAt-al-secondo) → ON CONFLICT DO NOTHING su INSERT

## Cosa serve dallo sviluppatore marketing

1. Creare endpoint `POST <loro-dominio>/api/webhooks/crm-fenice`:
   - Accetta JSON, risponde `2xx` su successo
   - Deduplica per header `X-CRM-Event-Id`
   - Verifica firma HMAC su `${X-CRM-Timestamp}.${rawBody}` usando `MARKETING_WEBHOOK_SECRET`
   - Timeout massimo gestione: 10 secondi
   - Codici risposta: `2xx` ok, `4xx` errore permanente (no retry), `5xx`/timeout = retry

2. Headers ricevuti:
   - `Content-Type: application/json`
   - `User-Agent: CrmFenice-Webhooks/1.0`
   - `X-CRM-Event-Id: <UUID>`
   - `X-CRM-Event-Type: appointment.set | appointment.outcome | deal.assigned | deal.closed_won | deal.closed_lost`
   - `X-CRM-Timestamp: <unix-seconds>`
   - `X-CRM-Signature: sha256=<hex>`

3. Schema payload completo: vedi `docs/superpowers/specs/2026-05-07-marketing-webhooks-design.md` § 5.
