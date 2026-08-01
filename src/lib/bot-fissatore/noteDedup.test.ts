import test from 'node:test';
import assert from 'node:assert/strict';
import { botNoteIntentKey, isSameBotNoteIntent, BOT_NOTE_DEDUP_WINDOW_MS } from './noteDedup';

// Le tre note su Ramona Lazăr, arrivate in 3 minuti il 2026-08-01: stesso
// incipit, motivo riscritto ogni volta. Sono lo stesso fatto.
const RAMONA_1 = "Il lead vuole annullare l'appuntamento (fissato per sabato 1 agosto alle 15:00). Motivo: non ha disponibilità economica al momento, ha chiesto di annullare la call.";
const RAMONA_2 = "Il lead vuole annullare l'appuntamento (fissato per sabato 1 agosto alle 15:00). Motivo: non ha disponibilità economica al momento, neanche a rate.";
const RAMONA_3 = "Il lead vuole annullare l'appuntamento (fissato per sabato 1 agosto alle 15:00). Motivo: non ha budget al momento, situazione economica non permette l'acquisto né le rate.";

test('la finestra di dedup è di 15 minuti', () => {
    assert.equal(BOT_NOTE_DEDUP_WINDOW_MS, 15 * 60 * 1000);
});

test('i tre re-invii su Ramona sono la stessa intenzione', () => {
    assert.ok(isSameBotNoteIntent(RAMONA_1, RAMONA_2));
    assert.ok(isSameBotNoteIntent(RAMONA_2, RAMONA_3));
    assert.ok(isSameBotNoteIntent(RAMONA_1, RAMONA_3));
});

test('la chiave si ferma prima di "Motivo:"', () => {
    assert.equal(
        botNoteIntentKey(RAMONA_1),
        "il lead vuole annullare l'appuntamento (fissato per sabato 1 agosto alle 15:00)",
    );
});

test('i due re-invii su Micol sono la stessa intenzione', () => {
    const a = "Il lead vuole annullare l'appuntamento. Motivo: lead interessata ma dichiara di non avere disponibilità economica al momento per il corso, disdice l'appuntamento volontariamente.";
    const b = "Il lead vuole annullare l'appuntamento. Motivo: lead interessata ma dichiara di non avere disponibilità economica sufficiente al momento, disdice l'appuntamento.";
    assert.ok(isSameBotNoteIntent(a, b));
});

test('una nota senza "Motivo:" cade sulla prima frase', () => {
    const a = "Il lead ha riconfermato l'appuntamento.";
    assert.equal(botNoteIntentKey(a), "il lead ha riconfermato l'appuntamento");
    assert.ok(isSameBotNoteIntent(a, "Il lead ha riconfermato l'appuntamento."));
});

test('intenzioni diverse restano distinte', () => {
    const annulla = "Il lead vuole annullare l'appuntamento. Motivo: non ha budget.";
    const riconferma = "Il lead ha riconfermato l'appuntamento.";
    assert.equal(isSameBotNoteIntent(annulla, riconferma), false);
});

test('due spostamenti a date diverse sono fatti diversi', () => {
    const a = "Il lead ha chiesto di spostare l'appuntamento alla data indicata (lunedì 10 agosto alle 09:00). Appuntamento mantenuto.";
    const b = "Il lead ha chiesto di spostare l'appuntamento alla data indicata (martedì 4 agosto alle 09:00). Appuntamento mantenuto.";
    assert.equal(isSameBotNoteIntent(a, b), false);
});

test('spaziatura e maiuscole non contano', () => {
    assert.ok(isSameBotNoteIntent(
        "Il lead  ha   RICONFERMATO l'appuntamento.",
        "il lead ha riconfermato l'appuntamento",
    ));
});

test('un testo vuoto non è mai uguale a niente', () => {
    assert.equal(botNoteIntentKey('   '), '');
    assert.equal(isSameBotNoteIntent('   ', '   '), false);
});
