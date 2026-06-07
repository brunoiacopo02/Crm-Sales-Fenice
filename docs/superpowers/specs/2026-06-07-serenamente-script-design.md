# Serenamente — Script GDO/Setter "Rinascere in Amore" — Design

**Data:** 2026-06-07 · **Stato:** Approvato (Bruno)

## Obiettivo
Per i lead **Serenamente**, il `ScriptWidget` mostra lo script di fissaggio "Rinascere in Amore" invece di quello Fenice. **Fenice invariato**. Differenze richieste: NIENTE sondaggio obbligatorio, MENO domande.

## Decisioni (confermate)
- Company-aware via `useSalesCompany()` (già esistente): se `serenamente` → `SERENAMENTE_BLOCKS` + sondaggio OFF.
- **Sondaggio OFF**: nessun `GdoSurveyInline`/`saveGdoSurvey`/early-exit-survey/banner funnel. Navigazione libera.
- **Timer OFF**: niente timer 4-min (è un fissaggio 7-8 min, nessun pitch con prezzo).
- **Domande = checklist opzionale** (min 0, non blocca "Avanti").
- **Tutela persona / handoff: esclusi** (operatori = psicologi laureati, sanno gestire).
- Tecniche di persuasione (alternativa, micro-impegno, specchio, scarsità, autorità Goleman) incluse apertamente nelle note "Come dirlo".
- AgendaButton già nel widget (già fa invio Twilio per Serenamente).

## Blocchi (7)
1. Apertura & identificazione (+ come stai / non ricordo / non ho tempo / già chiamato) — warning fisso "Regole d'oro" (no promesse, non siamo terapeuti).
2. Ascolto & scoperta (domanda apri-tutto, validazione, specchio) — checklist opzionale (5 domande approfondimento).
3. Obiettivi.
4. Ponte (intelligenza emotiva/Goleman + curiosità controintuitiva).
5. Fissaggio (alternativa di orario + conferma dettagli + micro-impegno presenza).
6. Gestione obiezioni (materiale/costo/pensarci/tempo/non sicuro/non interessato + uscita elegante).
7. Chiusura & conferma (WhatsApp + frase finale).

## File
- `src/components/ScriptWidget.tsx`: aggiungere `SERENAMENTE_BLOCKS`; usare `useSalesCompany()` per scegliere il block set; `surveyEnabled`/`surveyExcludedByFunnel`/timer gated su `!isSerenamente`; checklist render con `min===0` → label "facoltative" invece di "x / 0".

## QA
- `tsc --noEmit`; review spec-compliance.
- Visivo (dev, account Serenamente): script Serenamente, niente sondaggio, niente timer, AgendaButton presente; Fenice invariato (script + sondaggio + timer).
