// Catalogo del negozio nuovo (Diretta, PO 25/10/2026), ricalibrato con
// l'economia v2 del 25/10 sera: lo script scripts/diretta/negozio-catalogo.ts
// lo scrive in rewardItems solo con --apply.
//
// Regola (PO 25/10/2026): le Piume (risultati verificati) comprano SOLO il
// corso; tutti gli altri premi, concreti, permessi, immagini e
// personalizzazioni, si comprano con le Scintille, così conta anche il ritmo.
// Ogni premio concreto chiede almeno una settimana al massimo del patto col
// Sales Manager (7,4 appuntamenti per giornata, 12,7% di conferma); il corso
// circa tre mesi. Due immagini costano più (in settimane) di alcuni premi
// concreti, per dare valore al profilo.
// Calcoli e costi in docs/superpowers/specs/2026-10-25-economia-v2-margini.md.

import type { RewardKind } from './negozio'

export interface CatalogItem {
    id: string
    name: string
    description: string
    kind: RewardKind
    currency: 'S' | 'P'
    price: number
    imageUrl: string | null
    giftable: boolean
    sortOrder: number
    roles: string[]
}

/**
 * Guadagno di una settimana al massimo del patto (lun-sab), dalle regole di
 * default di src/lib/economy/rules.ts: 44,4 fissati, 5,6 conferme, 5,0
 * presenze, 1,3 chiusure, scalini e forzieri di squadra (stima).
 */
export const MASSIMO_PATTO_SETTIMANA = { S: 640, P: 13.5 } as const

/** Quante settimane al massimo del patto servono per un prezzo. */
export function settimaneAlMassimo(currency: string, price: number): number {
    return price / (currency === 'P' ? MASSIMO_PATTO_SETTIMANA.P : MASSIMO_PATTO_SETTIMANA.S)
}

const RUOLI = ['GDO', 'CONFERME']
// "Fissa Bruno per te" ha senso solo per chi fissa (collaudo del 25/10/2026):
// alle Conferme non si offre.
const SOLO_GDO = ['GDO']

export const CATALOGO_NEGOZIO: CatalogItem[] = [
    {
        id: 'corso-fenice-academy',
        name: 'Corso Fenice Academy a scelta',
        description: 'Un corso di Fenice Academy, per te o da regalare a chi vuoi. Il corso si sceglie insieme dopo la richiesta.',
        kind: 'corso', currency: 'P', price: 175, imageUrl: null, giftable: true, sortOrder: 10, roles: RUOLI,
    },
    {
        id: 'sabato-libero',
        name: 'Sabato libero',
        description: 'Un sabato intero a casa, pagato. La data si concorda e va approvata: se non si può, le Scintille tornano nel saldo.',
        kind: 'permesso', currency: 'S', price: 6400, imageUrl: null, giftable: false, sortOrder: 20, roles: RUOLI,
    },
    {
        id: 'cena-con-bruno-e-federico',
        name: 'Cena con Bruno e Federico',
        description: 'Una cena con Bruno e Federico, offerta. La sera si sceglie insieme.',
        kind: 'concreto', currency: 'S', price: 5200, imageUrl: null, giftable: false, sortOrder: 30, roles: RUOLI,
    },
    {
        id: 'pausa-30-bruno-fissa',
        name: "Mezz'ora di pausa: fissa Bruno per te",
        description: "Trenta minuti di pausa in più, quando vuoi durante il turno (non all'inizio né alla fine). In quella mezz'ora Bruno chiama i tuoi lead e fissa gli appuntamenti al posto tuo. Il momento si concorda.",
        kind: 'permesso', currency: 'S', price: 3800, imageUrl: null, giftable: false, sortOrder: 40, roles: SOLO_GDO,
    },
    {
        id: 'merenda-sala',
        name: 'Merenda per la sala',
        description: 'Offri tu la merenda a tutta la sala, un pomeriggio a tua scelta.',
        kind: 'concreto', currency: 'S', price: 1900, imageUrl: null, giftable: false, sortOrder: 50, roles: RUOLI,
    },
    {
        id: 'uscita-30-minuti',
        name: 'Uscita 30 minuti prima',
        description: 'Esci mezz\'ora prima a fine turno, in un giorno da concordare. Va approvata: se non si può, le Scintille tornano nel saldo.',
        kind: 'permesso', currency: 'S', price: 1350, imageUrl: null, giftable: false, sortOrder: 60, roles: RUOLI,
    },
    {
        id: 'pranzo-offerto',
        name: 'Pranzo offerto',
        description: 'Un ordine su Glovo che arriva in ufficio, il giorno che vuoi.',
        kind: 'concreto', currency: 'S', price: 1350, imageUrl: null, giftable: false, sortOrder: 70, roles: RUOLI,
    },
    {
        id: 'caffe-cornetto',
        name: 'Caffè e cornetto',
        description: 'Caffè e cornetto offerti, il giorno che vuoi.',
        kind: 'concreto', currency: 'S', price: 650, imageUrl: null, giftable: false, sortOrder: 80, roles: RUOLI,
    },
    {
        id: 'titolo-voce-della-sala',
        name: 'Titolo «Voce della sala»',
        description: 'Un titolo sotto il tuo nome, nella pagina della squadra e nel profilo.',
        kind: 'personalizzazione', currency: 'S', price: 1900, imageUrl: null, giftable: false, sortOrder: 90, roles: RUOLI,
    },
    {
        id: 'cornice-fenice',
        name: 'Cornice Fenice',
        description: 'Una cornice arancione attorno alla tua immagine profilo, nella squadra e nel profilo.',
        kind: 'personalizzazione', currency: 'S', price: 1300, imageUrl: null, giftable: false, sortOrder: 100, roles: RUOLI,
    },
    {
        id: 'fenice-d-oro',
        name: 'Fenice d\'oro',
        description: 'La fenice incisa in oro. L\'immagine profilo più rara del negozio.',
        kind: 'immagine', currency: 'S', price: 2600, imageUrl: '/diretta/premi/fenice-d-oro.webp', giftable: false, sortOrder: 110, roles: RUOLI,
    },
    {
        id: 'fiamma-viva',
        name: 'Fiamma viva',
        description: 'Una fiamma incisa a linee sottili, per chi non si spegne.',
        kind: 'immagine', currency: 'S', price: 1600, imageUrl: '/diretta/premi/fiamma-viva.webp', giftable: false, sortOrder: 120, roles: RUOLI,
    },
    {
        id: 'civetta',
        name: 'Civetta',
        description: 'Per chi ascolta prima di parlare.',
        kind: 'immagine', currency: 'S', price: 650, imageUrl: '/diretta/premi/civetta.webp', giftable: false, sortOrder: 130, roles: RUOLI,
    },
    {
        id: 'falco',
        name: 'Falco',
        description: 'Vede l\'occasione prima degli altri.',
        kind: 'immagine', currency: 'S', price: 480, imageUrl: '/diretta/premi/falco.webp', giftable: false, sortOrder: 140, roles: RUOLI,
    },
    {
        id: 'volpe',
        name: 'Volpe',
        description: 'Sveglia e rapida, trova sempre la strada.',
        kind: 'immagine', currency: 'S', price: 320, imageUrl: '/diretta/premi/volpe.webp', giftable: false, sortOrder: 150, roles: RUOLI,
    },
    {
        id: 'squalo',
        name: 'Squalo',
        description: 'Il simbolo degli squaletti: non molla la presa.',
        kind: 'immagine', currency: 'S', price: 300, imageUrl: '/diretta/premi/squalo.webp', giftable: false, sortOrder: 160, roles: RUOLI,
    },
]
