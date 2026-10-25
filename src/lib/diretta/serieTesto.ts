// Testi della serie nella home del GDO (SchedaPersonale). Funzione pura,
// testata: gli stessi numeri del registro, scritti in chiaro.

import { numeroIt } from './formato'

export interface SerieDaMostrare {
    giorni: number
    oggiFatto: boolean
    oggiLavorativo: boolean
    soglia: number
    prossima: { giorni: number; scintille: number; piume: number } | null
    scudiInTasca: number
}

export interface TestoSerie {
    titolo: string
    oggi: string
    prossima: string | null
    scudo: string | null
}

const giorniTesto = (n: number) => `${numeroIt(n)} ${n === 1 ? 'giorno' : 'giorni'}`

export function testoSerie(s: SerieDaMostrare): TestoSerie {
    const oggi = !s.oggiLavorativo
        ? 'Oggi non si conta: la serie riparte dal prossimo giorno di lavoro.'
        : s.oggiFatto
            ? 'Oggi è fatto.'
            : s.giorni > 0
                ? `Arriva a ${numeroIt(s.soglia)} fissati oggi per tenerla viva.`
                : `Arriva a ${numeroIt(s.soglia)} fissati oggi per farla partire.`
    let prossima: string | null = null
    if (s.prossima) {
        const premio = [
            s.prossima.scintille > 0 ? `${numeroIt(s.prossima.scintille)} Scintille` : null,
            s.prossima.piume > 0 ? `${numeroIt(s.prossima.piume)} Piume` : null,
        ].filter(Boolean).join(' e ')
        const mancano = s.prossima.giorni - s.giorni
        prossima = `Prossima tappa a ${giorniTesto(s.prossima.giorni)}${premio ? `: ${premio}` : ''}. ${mancano === 1 ? 'Manca 1 giorno' : `Mancano ${giorniTesto(mancano)}`}.`
    }
    return {
        titolo: `Serie: ${giorniTesto(s.giorni)}`,
        oggi,
        prossima,
        scudo: s.scudiInTasca > 0 ? 'Hai uno scudo da parte: salva il primo giorno mancato.' : null,
    }
}
