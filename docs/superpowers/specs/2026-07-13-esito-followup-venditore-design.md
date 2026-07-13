# Esito Follow-up Venditore — Design

**Data**: 2026-07-13
**Problema**: i venditori che fanno le chiamate di follow-up non trovano dove registrare l'esito. Il drawer aperto dalla tab Follow-up è la stessa "Scheda Appuntamento" con banner "già esitato" e campi precompilati dal tentativo precedente: sembra un riepilogo read-only. In più il campo "Prossimo follow-up" è precompilato con la data del follow-up appena lavorato (passata): risalvando "Non chiuso" il lead resta per sempre nel bucket "Scaduti" e brucia uno dei 3 follow-up.

**Backend**: già pronto, nessuna modifica. `salesAttempts` modella i tentativi 0..3, `saveVenditoreOutcome` accetta esiti ripetuti (guardie: check-in, sondaggio, tetto 3, motivazione).

## Soluzione (approccio approvato: modalità dedicata nel drawer)

### 1. VenditoreDashboardClient.tsx
- Nuovo stato che traccia l'origine dell'apertura: i lead aperti dalla tab `FOLLOWUP` aprono il drawer con `followUpMode`.
- Sulla card del follow-up, bottone esplicito **"Registra esito"** accanto a "Tentativi: N". Card e bottone aprono entrambi il drawer in modalità follow-up.

### 2. VenditoreDrawer.tsx — prop `followUpMode?: boolean`
In modalità follow-up:
- Header: **"Esito Follow-up"**, sottotitolo "Follow-up N di 3" (N = `priorNonClosedCount`, tetto `MAX_FOLLOW_UPS`).
- **Form pulito**: `outcome`, `notClosedReason`, `notes`, `nextFollowUpDate` partono vuoti (nessuna precompilazione dal tentativo precedente). `closeDate` (data effettiva esito) default = adesso.
- Al posto del banner blu "già esitato… puoi sovrascrivere": **recap read-only del tentativo precedente** (esito, motivazione, data esito, data follow-up pianificata). Dati già nella riga del lead, nessuna fetch extra.
- Bottone footer: "Salva esito follow-up".
- Sondaggio: comportamento invariato (prefill da survey esistente, aggiornabile).

### 3. Fix prefill data passata (entrambe le modalità)
`nextFollowUpDate` non viene mai precompilato con una data già passata:
- modalità follow-up → sempre vuoto;
- modalità normale → prefill solo se `lead.nextFollowUpDate` è nel futuro.

### 4. Post-salvataggio (invariato)
- "Non chiuso" + nuova data → il lead ricompare nel bucket corretto.
- "Non chiuso" senza data / "Chiuso" / "Sparito" → esce dalla tab Follow-up.
- Tetto 3: messaggio esistente ("puoi salvare l'esito ma non pianificarne un altro").

## Fuori scope
Schema DB, server actions, guardie, OutcomeGate, sondaggi, KPI, /monitor-vendite (fast-follow noto pre-esistente).

## Verifica
- `npm run build` pulita.
- Flusso manuale: tab Follow-up → "Registra esito" → form vuoto con recap → salva "Non chiuso" senza data → lead esce dalla lista; salva con data futura → lead ricompare nel bucket giusto.
