// Vecchia economia (walletCoins, XP e livelli) congelata dal restyle "Diretta"
// (PO 25/10/2026): walletCoins resta com'è, come storico.
//
// Le action storiche che accreditavano monete fuori dagli esiti (accesso
// giornaliero, forziere a tempo, loot, quest, badge, bauli a progressi)
// restano nel codice ma non accreditano più nulla: con l'interruttore della
// Diretta spento qualche schermata vecchia le chiama ancora, e così non
// toccano i saldi. Rimettere false riaccende tutto senza altre modifiche.
export const VECCHIA_ECONOMIA_CONGELATA: boolean = true
