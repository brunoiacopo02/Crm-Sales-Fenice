/**
 * Quale tentativo di chiamata comunicare al bot, dato lo stato NR del lead
 * PRIMA di registrare il mancato contatto.
 *
 * Il fornitore accetta solo il 1° e il 3°: al primo il messaggio chiede se
 * l'orario va bene, al terzo dice che senza risposta l'appuntamento viene
 * annullato. Il secondo non ha un messaggio suo e non va notificato.
 *
 * Il caso "tre date già scritte" è lo stato di transizione dal vecchio sistema
 * a 4 tentativi (vedi recordConfermeNoAnswer): lì non stiamo registrando un
 * tentativo nuovo, stiamo sanando uno stato incoerente. Niente messaggio.
 */
export interface NrState {
    confCall1At: Date | null;
    confCall2At: Date | null;
    confCall3At: Date | null;
}

export function resolveCallAttempt(lead: NrState): 1 | 3 | null {
    if (!lead.confCall1At) return 1;
    if (!lead.confCall2At) return null;
    if (!lead.confCall3At) return 3;
    return null;
}
