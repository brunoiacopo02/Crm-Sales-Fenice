/**
 * Logica pura di selezione della griglia calendario: nessun DOM, nessuna
 * regola di dominio. Chi chiama decide cosa è "bloccato" (ora già iniziata,
 * appuntamento, blocco per imprevisto): qui si ragiona solo su chiavi.
 */

/**
 * Scorciatoia "tutta la riga / tutta la colonna": se ogni chiave libera è già
 * selezionata le toglie tutte, altrimenti le aggiunge tutte. Le chiavi
 * `locked` non vengono né lette né toccate.
 */
export function toggleGroup(
    selected: ReadonlySet<string>,
    keys: readonly string[],
    locked: (key: string) => boolean,
): Set<string> {
    const next = new Set(selected)
    const free = keys.filter(k => !locked(k))
    if (free.length === 0) return next
    const allOn = free.every(k => next.has(k))
    for (const k of free) {
        if (allOn) next.delete(k)
        else next.add(k)
    }
    return next
}

/** La pennellata prende il verso dalla cella d'origine: se non era selezionata, seleziona. */
export function paintDirection(selected: ReadonlySet<string>, originKey: string): boolean {
    return !selected.has(originKey)
}

export function applyPaint(selected: ReadonlySet<string>, key: string, on: boolean): Set<string> {
    const next = new Set(selected)
    if (on) next.add(key)
    else next.delete(key)
    return next
}
