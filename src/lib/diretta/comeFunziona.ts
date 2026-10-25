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

export function comeFunziona(ruolo: string, r: EconomyRules, t: GamificationTargets): BloccoSpiegazione[] {
    const compra: BloccoSpiegazione = {
        titolo: 'Come si compra',
        righe: [
            'Premi e permessi: premi Richiedi e conferma. Il prezzo si scala subito e la richiesta arriva all\'admin, che te la consegna. Se un permesso non si può approvare, il prezzo torna nel saldo.',
            'Immagini e personalizzazioni sono tue subito, e le scegli dal profilo.',
            ...(ruolo === 'GDO' ? ['I potenziamenti partono appena li attivi, solo durante il turno.'] : []),
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
        usi,
        compra,
    ]
}
