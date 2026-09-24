/**
 * Un `RICHIAMO` che arriva dal bot non diventa mai un richiamo.
 *
 * Il bot non telefona: una `recallDate` scritta da lui è una riga che nessuno onora.
 * Finché il lead resta sull'account bot marcisce lì (93 lead fermi così al 22/09/2026);
 * appena passa a un umano — la coda /richieste-contatto lo fa di continuo — il GDO se lo
 * ritrova nei "Richiami" a un'ora scelta dalla macchina, per una persona mai sentita.
 *
 * Dal 22/09/2026 il bot non manda più `RICHIAMO` su una trattativa aperta (vedi
 * `lib/richiamo-fasce.ts` nel repo del bot). Questa guardia è la rete: il bot è un altro
 * repo con un altro deploy, e un rollback rimetterebbe in circolo i richiami senza che
 * nessuno se ne accorga.
 *
 * Il contratto non si rompe (`docs/bot-fissatore-contract.md`, "il contratto cresce, non
 * cambia"): `RICHIAMO` resta un esito valido e la risposta resta `200`. Cambia solo cosa
 * ne facciamo — una nota in timeline invece di una data in pipeline.
 */
export function richiamoDalBotDiventaNota(outcome: string): boolean {
    return outcome === 'RICHIAMO';
}

function formattaData(iso: string): string | null {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return new Intl.DateTimeFormat('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome',
    }).format(new Date(t));
}

export function buildRichiamoDegradatoNote(input: {
    date?: string;
    periodo?: string;
    note?: string;
}): string {
    const quando = input.date ? formattaData(input.date) : null;
    const testa = quando
        ? `Voleva essere risentito il ${quando}.`
        : input.periodo?.trim()
            ? `Voleva essere risentito ${input.periodo.trim()}.`
            : 'Voleva essere risentito più avanti ma non ha detto quando.';
    const coda = input.note?.trim() ? ` ${input.note.trim()}` : '';
    return (
        `VOLEVA ESSERE RISENTITO — il bot ha registrato questa richiesta. ${testa}` +
        ' Non è un richiamo in pipeline: decidi tu se e quando chiamarlo.' + coda
    );
}
