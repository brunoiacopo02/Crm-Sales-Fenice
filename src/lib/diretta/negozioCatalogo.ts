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
// Le Conferme chiamano col telefono (PO 25/10/2026): al posto delle cuffie
// hanno gli auricolari, e il telefono come upgrade in più.
const SOLO_CONFERME = ['CONFERME']

/**
 * Articoli tolti dal catalogo: lo script li spegne (isActive false) senza
 * cancellarli, così le richieste già fatte restano leggibili in /admin/premi.
 */
export const RITIRATI_NEGOZIO: readonly string[] = ['cena-con-bruno-e-federico', 'mezza-giornata-venditore']

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
    // "Cena con Bruno e Federico" tolta (PO 25/10/2026): nessun premio che
    // metta i titolari sopra gli altri, in sala si è tutti alla pari.
    {
        id: 'pausa-30-bruno-fissa',
        name: "Mezz'ora di pausa: fissa Bruno per te",
        description: "Trenta minuti di pausa in più, quando vuoi durante il turno (non all'inizio né alla fine). In quella mezz'ora Bruno chiama i tuoi lead e fissa gli appuntamenti al posto tuo. Il momento si concorda.",
        kind: 'permesso', currency: 'S', price: 3800, imageUrl: null, giftable: false, sortOrder: 40, roles: SOLO_GDO,
    },
    {
        // Booster dei fissati (src/lib/economy/booster.ts): parte all'acquisto,
        // un'ora, al massimo 3 fissati raddoppiati, uno al giorno. A 15 rende
        // fra -5 e +15 Scintille nette: vale solo se in quell'ora si fissa.
        id: 'booster-fissati',
        name: 'Booster: fissati doppi per un\'ora',
        description: 'Per i prossimi 60 minuti ogni appuntamento fissato vale il doppio delle Scintille, fino a 3 appuntamenti. Parte appena lo compri, solo durante il turno, uno al giorno.',
        kind: 'booster', currency: 'S', price: 15, imageUrl: null, giftable: false, sortOrder: 45, roles: SOLO_GDO,
    },
    {
        // Moltiplicatore presenza (src/lib/economy/moltiplicatore.ts): paga
        // solo sulle presenze verificate dei fissati fatti dopo l'acquisto, lo
        // stesso giorno. Con i default rende da -20 a +80, in pari con una presenza.
        id: 'moltiplicatore-presenza',
        name: 'Moltiplicatore presenza',
        description: 'Da adesso a fine giornata, ogni appuntamento che fissi ti dà 25 Scintille in più se poi la persona si presenta davvero, fino a 4 presenze. Solo durante il turno, uno al giorno.',
        kind: 'moltiplicatore', currency: 'S', price: 20, imageUrl: null, giftable: false, sortOrder: 46, roles: SOLO_GDO,
    },
    {
        // Scudo della serie (src/lib/economy/serie.ts): salva un giorno mancato.
        id: 'scudo-serie',
        name: 'Scudo della serie',
        description: 'Salva la tua serie per un giorno lavorativo in cui non arrivi al primo scalino, o in cui manchi. Si usa da solo al primo giorno mancato. Uno da parte alla volta, al massimo due al mese.',
        kind: 'scudo', currency: 'S', price: 400, imageUrl: null, giftable: false, sortOrder: 47, roles: SOLO_GDO,
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
        // Mai nell'ora di punta (DEFAULT_TARGETS: 18-19, sabato 12:30-13:30).
        // La approva Bruno (APPROVA_BRUNO in ./negozio, PO 25/10/2026).
        id: 'pausa-quando-vuoi',
        name: 'Pausa quando vuoi per una settimana',
        description: "Per una settimana scegli tu quando fare le pause del turno, mai nell'ora di punta (18-19, il sabato 12:30-13:30). La settimana si concorda e la approva Bruno: se non si può, le Scintille tornano nel saldo.",
        kind: 'permesso', currency: 'S', price: 1200, imageUrl: null, giftable: false, sortOrder: 65, roles: RUOLI,
    },
    {
        id: 'pranzo-offerto',
        name: 'Pranzo offerto',
        description: 'Un ordine su Glovo che arriva in ufficio, il giorno che vuoi.',
        kind: 'concreto', currency: 'S', price: 1350, imageUrl: null, giftable: false, sortOrder: 70, roles: RUOLI,
    },
    {
        id: 'spotify-o-netflix',
        name: 'Un mese di Spotify o Netflix',
        description: 'Un mese di abbonamento, a scelta fra Spotify e Netflix. Si sceglie dopo la richiesta.',
        kind: 'concreto', currency: 'S', price: 1300, imageUrl: null, giftable: false, sortOrder: 72, roles: RUOLI,
    },
    {
        id: 'cinema-per-due',
        name: 'Cinema per due',
        description: 'Due biglietti del cinema, per il film e la sera che vuoi.',
        kind: 'concreto', currency: 'S', price: 1800, imageUrl: null, giftable: false, sortOrder: 74, roles: RUOLI,
    },
    {
        id: 'buono-amazon-10',
        name: 'Buono Amazon da 10',
        description: 'Un buono regalo Amazon da 10. Arriva dopo la richiesta.',
        kind: 'concreto', currency: 'S', price: 1200, imageUrl: null, giftable: false, sortOrder: 76, roles: RUOLI,
    },
    {
        id: 'buono-amazon-25',
        name: 'Buono Amazon da 25',
        description: 'Un buono regalo Amazon da 25. Arriva dopo la richiesta.',
        kind: 'concreto', currency: 'S', price: 3000, imageUrl: null, giftable: false, sortOrder: 78, roles: RUOLI,
    },
    {
        id: 'caffe-cornetto',
        name: 'Caffè e cornetto',
        description: 'Caffè e cornetto offerti, il giorno che vuoi.',
        kind: 'concreto', currency: 'S', price: 650, imageUrl: null, giftable: false, sortOrder: 80, roles: RUOLI,
    },
    {
        // Si compra solo come regalo (SOLO_REGALO in ./negozio): sotto la
        // settimana al massimo del patto apposta, è un gesto verso un collega.
        id: 'caffe-per-un-collega',
        name: 'Caffè per un collega',
        description: 'Offri un caffè a un collega, a tuo nome. Scrivi chi lo riceve.',
        kind: 'concreto', currency: 'S', price: 250, imageUrl: null, giftable: true, sortOrder: 85, roles: RUOLI,
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
    // La tua postazione (PO 25/10/2026): upgrade fisici, uno per tipo a persona,
    // richiesti all'admin. Costano parecchio apposta: sono oggetti veri.
    // Restano dell'azienda e servono alla postazione di lavoro (PO 25/10/2026).
    {
        id: 'postazione-cuffie',
        name: 'Cuffie nuove',
        description: 'Cuffie da call center con microfono che taglia il rumore della sala. Il modello si sceglie dopo la richiesta. Restano dell\'azienda: sono per la tua postazione di lavoro.',
        kind: 'postazione', currency: 'S', price: 5000, imageUrl: null, giftable: false, sortOrder: 200, roles: SOLO_GDO,
    },
    {
        id: 'postazione-auricolari',
        name: 'Auricolari nuovi',
        description: "Auricolari con microfono per chiamare col telefono, comodi per tutto il turno. Il modello si sceglie dopo la richiesta. Restano dell'azienda: sono per la tua postazione di lavoro.",
        kind: 'postazione', currency: 'S', price: 4000, imageUrl: null, giftable: false, sortOrder: 205, roles: SOLO_CONFERME,
    },
    {
        id: 'postazione-tastiera',
        name: 'Tastiera nuova',
        description: 'Una tastiera comoda per scrivere note ed esiti tutto il turno. Resta dell\'azienda: è per la tua postazione di lavoro.',
        kind: 'postazione', currency: 'S', price: 4000, imageUrl: null, giftable: false, sortOrder: 210, roles: RUOLI,
    },
    {
        id: 'postazione-mouse',
        name: 'Mouse nuovo',
        description: 'Un mouse preciso e comodo in mano. Resta dell\'azienda: è per la tua postazione di lavoro.',
        kind: 'postazione', currency: 'S', price: 2500, imageUrl: null, giftable: false, sortOrder: 220, roles: RUOLI,
    },
    {
        id: 'postazione-monitor',
        name: 'Monitor nuovo',
        description: 'Un monitor più grande per la tua postazione: CRM e agenda insieme, senza cambiare finestra. Resta dell\'azienda: è per la tua postazione di lavoro.',
        kind: 'postazione', currency: 'S', price: 12000, imageUrl: null, giftable: false, sortOrder: 230, roles: RUOLI,
    },
    {
        id: 'postazione-telefono',
        name: 'Telefono nuovo',
        description: "Un telefono migliore per le chiamate di conferma: si sente bene e regge tutto il turno. Il modello si sceglie dopo la richiesta. Resta dell'azienda: è per la tua postazione di lavoro.",
        kind: 'postazione', currency: 'S', price: 12000, imageUrl: null, giftable: false, sortOrder: 235, roles: SOLO_CONFERME,
    },
    {
        id: 'postazione-gadget',
        name: 'Gadget per la scrivania',
        description: 'Una lampada, una pianta o un oggetto per la tua scrivania, da scegliere insieme. Resta dell\'azienda: è per la tua postazione di lavoro.',
        kind: 'postazione', currency: 'S', price: 1500, imageUrl: null, giftable: false, sortOrder: 240, roles: RUOLI,
    },
]
