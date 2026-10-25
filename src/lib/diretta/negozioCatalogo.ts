// Catalogo proposto del negozio nuovo (Diretta, PO 25/10/2026). I prezzi sono
// una proposta da far approvare a Bruno: lo script
// scripts/diretta/negozio-catalogo.ts li scrive in rewardItems solo con --apply.
//
// Calibrazione: un GDO al massimo del patto guadagna circa 2.700 Scintille e
// 100 Piume al mese. Ogni premio concreto chiede almeno una settimana a quel
// ritmo; due immagini costano più dei premi concreti in Scintille, per dare
// valore al profilo; il corso chiede circa quattro mesi.

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

/** Guadagno mensile al massimo del patto, per valuta. */
export const MASSIMO_PATTO_MESE = { S: 2700, P: 100 } as const

const SETTIMANE_AL_MESE = 52 / 12

/** Quante settimane al massimo del patto servono per un prezzo. */
export function settimaneAlMassimo(currency: string, price: number): number {
    const mese = currency === 'P' ? MASSIMO_PATTO_MESE.P : MASSIMO_PATTO_MESE.S
    return price / (mese / SETTIMANE_AL_MESE)
}

const RUOLI = ['GDO', 'CONFERME']

export const CATALOGO_NEGOZIO: CatalogItem[] = [
    {
        id: 'corso-fenice-academy',
        name: 'Corso Fenice Academy a scelta',
        description: 'Un corso di Fenice Academy, per te o da regalare a chi vuoi. Il corso si sceglie insieme dopo la richiesta.',
        kind: 'corso', currency: 'P', price: 400, imageUrl: null, giftable: true, sortOrder: 10, roles: RUOLI,
    },
    {
        id: 'sabato-libero',
        name: 'Sabato libero',
        description: 'Un sabato intero a casa. La data si concorda e va approvata: se non si può, le Piume tornano nel saldo.',
        kind: 'permesso', currency: 'P', price: 180, imageUrl: null, giftable: false, sortOrder: 20, roles: RUOLI,
    },
    {
        id: 'cena-per-due',
        name: 'Cena per due',
        description: 'Una cena per due persone, fino a 70 euro.',
        kind: 'concreto', currency: 'P', price: 120, imageUrl: null, giftable: false, sortOrder: 30, roles: RUOLI,
    },
    {
        id: 'mezza-giornata-venditore',
        name: 'Mezza giornata con un venditore',
        description: 'Mezza giornata accanto a un venditore, ad ascoltare le trattative dal vivo. Va approvata e il giorno si concorda.',
        kind: 'permesso', currency: 'P', price: 60, imageUrl: null, giftable: false, sortOrder: 40, roles: RUOLI,
    },
    {
        id: 'titolo-voce-della-sala',
        name: 'Titolo «Voce della sala»',
        description: 'Un titolo sotto il tuo nome, nella pagina della squadra e nel profilo.',
        kind: 'personalizzazione', currency: 'P', price: 50, imageUrl: null, giftable: false, sortOrder: 50, roles: RUOLI,
    },
    {
        id: 'uscita-30-minuti',
        name: 'Uscita 30 minuti prima',
        description: 'Esci mezz\'ora prima a fine turno, in un giorno da concordare. Va approvata: se non si può, le Piume tornano nel saldo.',
        kind: 'permesso', currency: 'P', price: 30, imageUrl: null, giftable: false, sortOrder: 60, roles: RUOLI,
    },
    {
        id: 'merenda-sala',
        name: 'Merenda per la sala',
        description: 'Offri tu la merenda a tutta la sala, un pomeriggio a tua scelta.',
        kind: 'concreto', currency: 'S', price: 1500, imageUrl: null, giftable: false, sortOrder: 70, roles: RUOLI,
    },
    {
        id: 'pranzo-offerto',
        name: 'Pranzo offerto',
        description: 'Un pranzo offerto, fino a 15 euro.',
        kind: 'concreto', currency: 'S', price: 1300, imageUrl: null, giftable: false, sortOrder: 80, roles: RUOLI,
    },
    {
        id: 'caffe-cornetto',
        name: 'Caffè e cornetto',
        description: 'Caffè e cornetto offerti, il giorno che vuoi.',
        kind: 'concreto', currency: 'S', price: 700, imageUrl: null, giftable: false, sortOrder: 90, roles: RUOLI,
    },
    {
        id: 'cornice-fenice',
        name: 'Cornice Fenice',
        description: 'Una cornice arancione attorno alla tua immagine profilo, nella squadra e nel profilo.',
        kind: 'personalizzazione', currency: 'S', price: 900, imageUrl: null, giftable: false, sortOrder: 100, roles: RUOLI,
    },
    {
        id: 'fenice-d-oro',
        name: 'Fenice d\'oro',
        description: 'La fenice incisa in oro. L\'immagine profilo più rara del negozio.',
        kind: 'immagine', currency: 'S', price: 2800, imageUrl: '/diretta/premi/fenice-d-oro.webp', giftable: false, sortOrder: 110, roles: RUOLI,
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
        kind: 'immagine', currency: 'S', price: 600, imageUrl: '/diretta/premi/civetta.webp', giftable: false, sortOrder: 130, roles: RUOLI,
    },
    {
        id: 'falco',
        name: 'Falco',
        description: 'Vede l\'occasione prima degli altri.',
        kind: 'immagine', currency: 'S', price: 500, imageUrl: '/diretta/premi/falco.webp', giftable: false, sortOrder: 140, roles: RUOLI,
    },
    {
        id: 'volpe',
        name: 'Volpe',
        description: 'Sveglia e rapida, trova sempre la strada.',
        kind: 'immagine', currency: 'S', price: 400, imageUrl: '/diretta/premi/volpe.webp', giftable: false, sortOrder: 150, roles: RUOLI,
    },
    {
        id: 'squalo',
        name: 'Squalo',
        description: 'Il simbolo degli squaletti: non molla la presa.',
        kind: 'immagine', currency: 'S', price: 400, imageUrl: '/diretta/premi/squalo.webp', giftable: false, sortOrder: 160, roles: RUOLI,
    },
]
