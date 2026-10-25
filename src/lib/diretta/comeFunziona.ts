// "Come funziona" del negozio (collaudo del 25/10/2026: senza spiegazione non
// si capiva). I numeri vengono dalle regole salvate dall'admin, così il testo
// resta giusto se cambiano. Funzione pura: la usano la pagina e i test.

import type { EconomyRules } from '@/lib/economy/rules'
import type { GamificationTargets } from './config'
import { numeroIt } from './formato'
import { articoloNumero } from './home'

export interface BloccoSpiegazione {
    titolo: string
    righe: string[]
}

/** "all'8°", "al 10°". */
const alNumero = (n: number) => `${articoloNumero(n) === "l'" ? "all'" : 'al '}${numeroIt(n)}°`
const piume = (n: number) => `${numeroIt(n)} ${n === 1 ? 'Piuma' : 'Piume'}`
const scintille = (n: number) => `${numeroIt(n)} ${n === 1 ? 'Scintilla' : 'Scintille'}`

/** "3 giorni 15 Scintille, 6 giorni 30 Scintille, ..., 60 giorni 250 Scintille e 20 Piume". */
function tappe(r: EconomyRules): string {
    return r.serie.tappe.map(tp => {
        const premio = [tp.scintille > 0 ? scintille(tp.scintille) : null, tp.piume > 0 ? piume(tp.piume) : null].filter(Boolean).join(' e ')
        return `${numeroIt(tp.giorni)} giorni ${premio}`
    }).join(', ')
}

export function comeFunziona(ruolo: string, r: EconomyRules, t: GamificationTargets): BloccoSpiegazione[] {
    const compra: BloccoSpiegazione = {
        titolo: 'Come si compra',
        righe: [
            'Premi e permessi: premi Richiedi e conferma. Il prezzo si scala subito e la richiesta arriva all\'admin, che te la consegna. Se un permesso non si può approvare, il prezzo torna nel saldo. La pausa quando vuoi la approva Bruno.',
            'Immagini e personalizzazioni sono tue subito, e le scegli dal profilo.',
            `La tua postazione: ${ruolo === 'CONFERME' ? 'auricolari, telefono' : 'cuffie'}, tastiera, mouse, monitor e un gadget per la scrivania. Ognuno si prende una volta sola, si chiede all'admin come i premi e costa parecchio, perché è un oggetto vero. Gli oggetti restano dell'azienda: sono per la tua postazione di lavoro.`,
            ...(ruolo === 'GDO' ? ['I potenziamenti partono appena li attivi: booster e moltiplicatore solo durante il turno, lo scudo quando vuoi.'] : []),
        ],
    }
    const usi: BloccoSpiegazione = {
        titolo: 'A cosa servono',
        righe: ['Le Piume servono solo per il corso Fenice Academy, anche da regalare. Le Scintille per tutto il resto.'],
    }

    if (ruolo === 'CONFERME') {
        const sc = r.conferme.scintille
        const o = r.conferme.obiettivi
        return [
            {
                titolo: 'Scintille: lead per lead',
                righe: [
                    `${scintille(sc.conferma)} quando confermi un lead prima del suo appuntamento.`,
                    `Se poi la persona si presenta, il lead vale ${scintille(sc.presenza)} in tutto; ${scintille(sc.presenza + sc.inTempo)} se avevi confermato almeno ${numeroIt(sc.inTempoMinuti)} minuti prima.`,
                    `Si pagano al massimo ${numeroIt(sc.tettoConfermeGiorno)} conferme al giorno.`,
                ],
            },
            {
                titolo: 'Piume: gli obiettivi della settimana',
                righe: [
                    `Presenze dei lead che hai confermato: a ${numeroIt(o.presenze.soglie[0])} prendi ${piume(o.presenze.piume[0])}, a ${numeroIt(o.presenze.soglie[1])} altre ${numeroIt(o.presenze.piume[1])}.`,
                    `Chiusure: a ${numeroIt(o.chiusure.soglie[0])} prendi ${piume(o.chiusure.piume[0])}, a ${numeroIt(o.chiusure.soglie[1])} altre ${numeroIt(o.chiusure.piume[1])}.`,
                    'La settimana va da lunedì a sabato.',
                ],
            },
            usi,
            compra,
        ]
    }

    return [
        {
            titolo: 'Scintille: fissando appuntamenti',
            righe: [
                `${scintille(r.fissato.scintille)} per ogni appuntamento fissato (un lead paga una volta ogni ${numeroIt(r.fissato.finestraGiorni)} giorni, al massimo ${numeroIt(r.fissato.tettoGiorno)} appuntamenti pagati al giorno).`,
                `In più ${scintille(r.scaliniPersonali[0])} ${alNumero(t.personale[0])} appuntamento del giorno e ${scintille(r.scaliniPersonali[1])} ${alNumero(t.personale[1])}.`,
                'Forzieri: quando la squadra arriva agli obiettivi del giorno o dell\'ora di punta, chi ha fissato almeno un appuntamento apre un forziere di Scintille, e a volte esce una Piuma.',
                'Se un appuntamento viene tolto, le sue Scintille tornano indietro.',
            ],
        },
        {
            titolo: 'Piume: quando i tuoi appuntamenti vanno avanti',
            righe: [
                `Per ogni tuo appuntamento: ${piume(r.piume.conferma)} se viene confermato, ${numeroIt(r.piume.presenza)} se la persona si presenta, ${numeroIt(r.piume.chiusura)} se si iscrive.`,
                'Vale il passo più alto raggiunto, non si sommano.',
            ],
        },
        {
            titolo: 'La serie',
            righe: [
                `Ogni giorno di lavoro in cui arrivi ${alNumero(t.personale[0])} appuntamento, la serie sale di uno. Domeniche e feste non contano; un giorno sotto, o di assenza, la fa ripartire da zero.`,
                `Tappe: ${tappe(r)}.`,
                // PO 25/10/2026: dopo l'ultima tappa (180) la serie conta ancora, ma senza premi.
                ...(r.serie.tappe.length > 0
                    ? [`Dopo i ${numeroIt(r.serie.tappe[r.serie.tappe.length - 1].giorni)} giorni la serie continua a contare, ma non dà altri premi.`]
                    : []),
                'Se oggi un appuntamento viene tolto e scendi sotto, la tappa di oggi torna indietro.',
            ],
        },
        {
            titolo: 'Potenziamenti',
            righe: [
                `Booster: per ${numeroIt(r.booster.minuti)} minuti ogni appuntamento fissato vale doppio, fino a ${numeroIt(r.booster.maxFissati)}.`,
                `Moltiplicatore presenza: da quando lo prendi a fine giornata, ogni appuntamento che fissi ti dà ${scintille(r.moltiplicatore.bonus)} in più se la persona si presenta davvero, fino a ${numeroIt(r.moltiplicatore.maxPresenze)} presenze.`,
                `Scudo della serie: salva la serie per un giorno mancato e si usa da solo. Uno da parte alla volta, al massimo ${numeroIt(r.serie.scudiAlMese)} al mese.`,
            ],
        },
        usi,
        compra,
    ]
}
