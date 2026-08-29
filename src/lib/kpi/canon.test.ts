import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isNeverAnsweredLog, isAnsweredLog, NEVER_ANSWERED_DISCARD_REASONS, isFunnelClosure } from './canon';

// Il bug che questi test bloccano: "risposta del GDO" era implementata due
// volte, in kpiAdvancedActions (con la regola "numero inesistente") e in
// managerAdvancedActions (senza). Stessa metrica, due numeri diversi sulla
// stessa schermata. Ora la definizione vive qui e i due chiamanti la importano.

describe('isNeverAnsweredLog', () => {
    test('DA_SCARTARE + "numero inesistente" = il lead non ha mai risposto', () => {
        assert.equal(isNeverAnsweredLog('DA_SCARTARE', 'numero inesistente'), true);
    });

    test('uno scarto qualitativo non e\' un mancato contatto', () => {
        assert.equal(isNeverAnsweredLog('DA_SCARTARE', 'non ha soldi'), false);
    });

    test('la causale conta solo su DA_SCARTARE', () => {
        // Difensivo: se un giorno un altro outcome portasse quella causale,
        // non deve silenziosamente diventare un mancato contatto.
        assert.equal(isNeverAnsweredLog('APPUNTAMENTO', 'numero inesistente'), false);
    });

    test('senza causale non si decide nulla', () => {
        assert.equal(isNeverAnsweredLog('DA_SCARTARE', null), false);
        assert.equal(isNeverAnsweredLog('DA_SCARTARE', ''), false);
    });

    test('la causale e\' normalizzata: maiuscole e spazi non devono sfuggire', () => {
        // A DB la causale arriva dalla tendina, ma il match esatto e
        // case-sensitive del codice originale si rompeva su qualunque
        // variazione di grafia. Meglio normalizzare che fidarsi.
        assert.equal(isNeverAnsweredLog('DA_SCARTARE', 'Numero Inesistente'), true);
        assert.equal(isNeverAnsweredLog('DA_SCARTARE', '  numero inesistente  '), true);
    });
});

describe('isAnsweredLog', () => {
    test('NON_RISPOSTO non e\' una risposta', () => {
        assert.equal(isAnsweredLog('NON_RISPOSTO', null), false);
    });

    test('la grafia legacy NON_RISPONDE vale come NON_RISPOSTO', () => {
        // Operativa filtrava anche 'NON_RISPONDE', KPI GDO no: la variante
        // sopravvive nel tracciato vecchio e va riconosciuta da entrambi.
        assert.equal(isAnsweredLog('NON_RISPONDE', null), false);
        assert.equal(isAnsweredLog('non_risponde', null), false);
    });

    test('"numero inesistente" NON e\' una risposta — il bug di Operativa', () => {
        // Questo e' esattamente il caso che gonfiava il tasso di risposta di
        // Operativa di 2-4 punti rispetto a KPI GDO sugli stessi dati.
        assert.equal(isAnsweredLog('DA_SCARTARE', 'numero inesistente'), false);
    });

    test('uno scarto qualitativo E\' una risposta: il lead ha parlato', () => {
        assert.equal(isAnsweredLog('DA_SCARTARE', 'non ha soldi'), true);
    });

    test('appuntamento e richiamo sono risposte', () => {
        assert.equal(isAnsweredLog('APPUNTAMENTO', null), true);
        assert.equal(isAnsweredLog('RICHIAMO', null), true);
    });

    test('outcome mancante non conta come risposta', () => {
        assert.equal(isAnsweredLog(null, null), false);
    });
});

describe('isFunnelClosure', () => {
    // Task 10 riconciliazione (2026-08-29): la riconciliazione fatturato puo'
    // scrivere Chiuso su un lead mai presentato (famiglie lead-scartato/
    // lead-assente). Questa e' la definizione unica da cui dipendono i
    // numeratori dei tassi di conversione in gdoPerformanceActions,
    // confermeKpiActions e productivityActions: se si rompe qui, si rompono
    // silenziosamente anche li'.
    const presente = new Date('2026-05-10T10:00:00Z');

    test('Chiuso con una presenza vera = chiusura di funnel', () => {
        assert.equal(isFunnelClosure({ salespersonOutcome: 'Chiuso', presentedAt: presente }), true);
    });

    test('Chiuso senza presenza (riconciliazione fuori funnel) = non e\' una chiusura di funnel', () => {
        assert.equal(isFunnelClosure({ salespersonOutcome: 'Chiuso', presentedAt: null }), false);
    });

    test('Non chiuso non e\' mai una chiusura, presenza o no', () => {
        assert.equal(isFunnelClosure({ salespersonOutcome: 'Non chiuso', presentedAt: presente }), false);
        assert.equal(isFunnelClosure({ salespersonOutcome: 'Non chiuso', presentedAt: null }), false);
    });

    test('esito nullo/assente non e\' una chiusura', () => {
        assert.equal(isFunnelClosure({ salespersonOutcome: null, presentedAt: presente }), false);
        assert.equal(isFunnelClosure({ salespersonOutcome: null, presentedAt: null }), false);
    });

    test('l\'esito e\' case-insensitive', () => {
        assert.equal(isFunnelClosure({ salespersonOutcome: 'CHIUSO', presentedAt: presente }), true);
        assert.equal(isFunnelClosure({ salespersonOutcome: 'chiuso', presentedAt: presente }), true);
    });
});

describe('NEVER_ANSWERED_DISCARD_REASONS', () => {
    test('le causali sono gia\' normalizzate, altrimenti il match fallisce', () => {
        for (const reason of NEVER_ANSWERED_DISCARD_REASONS) {
            assert.equal(reason, reason.trim().toLowerCase(), `"${reason}" non e' normalizzata`);
        }
    });
});
