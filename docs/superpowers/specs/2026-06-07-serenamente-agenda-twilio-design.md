# Serenamente — Invio Agenda via Twilio (no ActiveCampaign) — Design

**Data:** 2026-06-07
**Stato:** Approvato (Bruno)

## Obiettivo
Per i lead **Serenamente**, il pulsante "Agenda" non deve più chiedere nulla né passare da ActiveCampaign/Spoki: un click invia direttamente l'agenda tramite la webapp di messaggistica Twilio. **Fenice resta invariato** (modale + flusso AC).

## Endpoint esterno (fornito da Bruno)
```
POST https://web-app-messaggistica.vercel.app/api/send-agenda
Header: Content-Type: application/json
        x-agenda-secret: <SERENAMENTE_AGENDA_SECRET>   (da env, NON hardcoded)
Body:   { "phone": "+39...", "firstName": "...", "lastName": "...", "email": "..." }  // solo phone obbligatorio
Resp:   { "ok": true, "sid": "MM...", "conversationId": 123 }
```
La webapp invia subito il template agenda e dopo ~5 min il template video; il CRM non fa altro.

## Decisioni
- **Awareness azienda lato client:** nuovo `SalesCompanyProvider` (context) montato nel dashboard layout con `tctx.companyId` (server-side, no fetch/flash). Hook `useSalesCompany()`. Riusabile per il prossimo task (script diverso).
- **Telefono:** normalizzazione silenziosa best-effort a E.164 prima dell'invio (default IT +39). Corregge numeri tipo `333...`, `0039...`, con spazi/trattini.
- **Reinvio:** invio diretto la prima volta; se `agendaSentAt` già valorizzato → `confirm("Reinviare l'agenda?")` lato client prima di reinviare. Nessun altro modale.
- **Tracciamento:** aggiorna `agendaSentAt` + logga evento `AGENDA_SENT` con metadata `{ channel: 'twilio', sid, resend }`. Mantiene lo stato verde "già inviata".
- **Segreto:** `SERENAMENTE_AGENDA_SECRET` in env. URL override opzionale `SERENAMENTE_AGENDA_URL`. Bruno aggiunge la env su Vercel.

## Componenti / file
| File | Tipo | Responsabilità |
|------|------|----------------|
| `src/components/providers/SalesCompanyProvider.tsx` | new | Context client con azienda attiva + `useSalesCompany()` |
| `src/app/(dashboard)/layout.tsx` | mod | Monta il provider con `company={tctx.companyId}` |
| `src/app/actions/serenamenteAgendaActions.ts` | new | `sendAgendaSerenamente(leadId)`: tenant check, fetch lead, normalizza phone, POST endpoint con secret, update agendaSentAt, log evento |
| `src/components/AgendaButton.tsx` | mod | Se `useSalesCompany()==='serenamente'` → invio diretto (confirm solo se già inviata), niente modale; altrimenti flusso AC attuale |

## Sicurezza / robustezza
- Secret SOLO server-side (action), mai esposto al client.
- Action tenant-scoped: verifica `lead.companyId === ctx.companyId` (=serenamente).
- Errori dell'endpoint (non-2xx) → ritorna `{success:false, error}` mostrato sul pulsante.
- Niente invio se phone mancante/invalido dopo normalizzazione.

## QA (limitata, no spam reali)
- `tsc --noEmit` pulito; code review.
- Non si testa l'invio reale (manderebbe WhatsApp veri; nessun lead Serenamente esiste ancora). Bruno verificherà con un lead di test dopo aver aggiunto la env su Vercel.
- Verifica branch UI: con account Serenamente il pulsante non apre il modale (verifica logica/review).
- Fenice: pulsante Agenda invariato (modale + AC).
