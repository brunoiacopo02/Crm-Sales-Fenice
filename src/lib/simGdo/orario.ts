// Orario del giro SIM GDO: ogni ora dal lunedì al sabato, dalle 9 alle 20 di
// Roma (mattina del sabato compresa). Vercel Cron è in UTC e non conosce l'ora
// legale: vercel.json lo lancia dalle 7 alle 19 UTC e questa guardia tiene
// solo le ore che a Roma cadono fra le 9 e le 20 (d'inverno salta le 8, d'estate
// le 21). Stesso schema di eOraDelGiro in src/lib/gdoPools/rebalance.ts.

export const PRIMA_ORA = 9
export const ULTIMA_ORA = 20

export function eOraDelGiroSim(adesso: Date): boolean {
    const p = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(adesso)
    const ora = Number(p.find(x => x.type === 'hour')?.value)
    const giorno = p.find(x => x.type === 'weekday')?.value
    if (giorno === 'Sun') return false
    return ora >= PRIMA_ORA && ora <= ULTIMA_ORA
}
