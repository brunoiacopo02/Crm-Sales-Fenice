import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    destinatarioAssegnazione, oraArrivo, eVergineDelGiorno, eVergineMaiContattato, ordinaPrimaChiamata, tempoDaArrivo,
    tipoPrimaChiamata,
    type EventoLead,
} from './arrivo'

const GDO = 'gdo-105'
const ALTRO = 'gdo-119'
const ADMIN = 'admin-1'

const ev = (p: Partial<EventoLead> & { eventType: string; timestamp: string }): EventoLead =>
    ({ userId: null, toAssigneeId: null, assignedToUser: null, ...p })

// --------------------------------------------------------- destinatario

test('destinatario: il ritorno dal bot va al GDO scritto in userId', () => {
    assert.equal(destinatarioAssegnazione(ev({ eventType: 'REASSIGNED_FROM_BOT', userId: GDO, timestamp: '2026-10-26T12:00:00Z' })), GDO)
})

test('destinatario: la redistribuzione admin va a metadata.toAssigneeId, non all admin che la fa', () => {
    const e = ev({ eventType: 'REASSIGNED_ADMIN', userId: ADMIN, toAssigneeId: GDO, timestamp: '2026-10-26T12:00:00Z' })
    assert.equal(destinatarioAssegnazione(e), GDO)
})

test('destinatario: ASSIGNED preferisce metadata.assignedToUser a userId (import e coda contatti li scrive l admin)', () => {
    const conMeta = ev({ eventType: 'ASSIGNED', userId: ADMIN, assignedToUser: GDO, timestamp: '2026-10-26T12:00:00Z' })
    const senzaMeta = ev({ eventType: 'ASSIGNED', userId: GDO, timestamp: '2026-10-26T12:00:00Z' })
    assert.equal(destinatarioAssegnazione(conMeta), GDO)
    assert.equal(destinatarioAssegnazione(senzaMeta), GDO)
})

test('destinatario: gli altri eventi non assegnano a nessuno', () => {
    assert.equal(destinatarioAssegnazione(ev({ eventType: 'BOT_PUSHED', userId: GDO, timestamp: '2026-10-26T12:00:00Z' })), null)
    assert.equal(destinatarioAssegnazione(ev({ eventType: 'CALL_LOGGED', userId: GDO, timestamp: '2026-10-26T12:00:00Z' })), null)
})

// --------------------------------------------------------- ora di arrivo

test('arrivo: vince l ultima assegnazione al proprietario attuale, non la prima', () => {
    const eventi = [
        ev({ eventType: 'ASSIGNED', assignedToUser: GDO, timestamp: '2026-10-01T09:00:00Z' }),
        ev({ eventType: 'ASSIGNED', assignedToUser: 'bot-201', timestamp: '2026-10-02T09:00:00Z' }),
        ev({ eventType: 'REASSIGNED_FROM_BOT', userId: GDO, timestamp: '2026-10-26T13:45:00Z' }),
    ]
    const t = oraArrivo({ eventi, proprietario: GDO, assignedAt: '2026-10-01T09:00:00Z', createdAt: '2026-10-01T09:00:00Z' })
    assert.equal(t.toISOString(), '2026-10-26T13:45:00.000Z')
})

test('arrivo: le assegnazioni a un altro GDO non contano', () => {
    const eventi = [
        ev({ eventType: 'ASSIGNED', assignedToUser: GDO, timestamp: '2026-10-20T09:00:00Z' }),
        ev({ eventType: 'REASSIGNED_ADMIN', userId: ADMIN, toAssigneeId: ALTRO, timestamp: '2026-10-25T09:00:00Z' }),
    ]
    const t = oraArrivo({ eventi, proprietario: GDO, assignedAt: null, createdAt: '2026-10-19T09:00:00Z' })
    assert.equal(t.toISOString(), '2026-10-20T09:00:00.000Z')
})

test('arrivo: senza eventi per il proprietario si ripiega su assignedAt, poi su createdAt', () => {
    const eventi = [ev({ eventType: 'ASSIGNED', assignedToUser: ALTRO, timestamp: '2026-10-25T09:00:00Z' })]
    const conAssignedAt = oraArrivo({ eventi, proprietario: GDO, assignedAt: '2026-10-10T08:00:00Z', createdAt: '2026-10-09T08:00:00Z' })
    const soloCreatedAt = oraArrivo({ eventi: [], proprietario: GDO, assignedAt: null, createdAt: '2026-10-09T08:00:00Z' })
    assert.equal(conAssignedAt.toISOString(), '2026-10-10T08:00:00.000Z')
    assert.equal(soloCreatedAt.toISOString(), '2026-10-09T08:00:00.000Z')
})

test('arrivo: un lead senza proprietario usa i ripieghi', () => {
    const eventi = [ev({ eventType: 'ASSIGNED', assignedToUser: GDO, timestamp: '2026-10-25T09:00:00Z' })]
    const t = oraArrivo({ eventi, proprietario: null, assignedAt: null, createdAt: '2026-10-09T08:00:00Z' })
    assert.equal(t.toISOString(), '2026-10-09T08:00:00.000Z')
})

// --------------------------------------------------------- vergini del giorno

const inizioOggi = new Date('2026-10-26T00:00:00+01:00')
const vergine = {
    status: 'NEW', callCount: 0, source: 'activecampaign', launchBucket: null,
    createdAt: new Date('2026-10-26T14:05:00+01:00'),
    ridatoDalBot: false, passatoDalBot: false, tiHaCercato: false,
}

test('vergine: lead fresco di ActiveCampaign arrivato oggi e mai toccato', () => {
    assert.equal(eVergineDelGiorno(vergine, inizioOggi), true)
})

test('vergine: non lo è chi è già passato dal bot, anche se riparte da zero', () => {
    assert.equal(eVergineDelGiorno({ ...vergine, ridatoDalBot: true }, inizioOggi), false)
    assert.equal(eVergineDelGiorno({ ...vergine, passatoDalBot: true }, inizioOggi), false)
})

test('vergine: non lo è un lead di ieri, già chiamato, di un pool o non da ActiveCampaign', () => {
    assert.equal(eVergineDelGiorno({ ...vergine, createdAt: new Date('2026-10-25T19:58:00+01:00') }, inizioOggi), false)
    assert.equal(eVergineDelGiorno({ ...vergine, callCount: 1, status: 'IN_PROGRESS' }, inizioOggi), false)
    assert.equal(eVergineDelGiorno({ ...vergine, launchBucket: 'DB_2026_07' }, inizioOggi), false)
    assert.equal(eVergineDelGiorno({ ...vergine, source: 'csv' }, inizioOggi), false)
})

test('vergine: chi ci ha cercato ha già la sua corsia, non è un vergine', () => {
    assert.equal(eVergineDelGiorno({ ...vergine, tiHaCercato: true }, inizioOggi), false)
})

// --------------------------------------------------------- ordinamento 1ª chiamata

type Riga = { id: string; arrivedAt: Date; vergine: boolean; priorita: number }
const riga = (id: string, arrivo: string, p: Partial<Riga> = {}): Riga =>
    ({ id, arrivedAt: new Date(arrivo), vergine: false, priorita: 0, ...p })

test('ordine: i vergini del giorno stanno in cima a tutto, anche sopra le priorità', () => {
    const lista = [
        riga('a', '2026-10-26T13:00:00Z', { priorita: 16 }),
        riga('b', '2026-10-26T12:00:00Z', { vergine: true }),
    ]
    assert.deepEqual(ordinaPrimaChiamata(lista, (l) => l.priorita).map((l) => l.id), ['b', 'a'])
})

test('ordine: a pari gruppo vince la priorità, poi l ora di arrivo più recente', () => {
    const lista = [
        riga('vecchio', '2026-10-20T09:00:00Z'),
        riga('cercato', '2026-10-01T09:00:00Z', { priorita: 2 }),
        riga('recente', '2026-10-26T15:00:00Z'),
    ]
    assert.deepEqual(ordinaPrimaChiamata(lista, (l) => l.priorita).map((l) => l.id), ['cercato', 'recente', 'vecchio'])
})

test('ordine: a parità di ora di arrivo decide l id, così le card non saltano fra un caricamento e l altro', () => {
    const lista = [
        riga('c', '2026-10-26T15:00:00Z'),
        riga('a', '2026-10-26T15:00:00Z'),
        riga('b', '2026-10-26T15:00:00Z'),
    ]
    assert.deepEqual(ordinaPrimaChiamata(lista, () => 0).map((l) => l.id), ['a', 'b', 'c'])
    assert.deepEqual(ordinaPrimaChiamata([...lista].reverse(), () => 0).map((l) => l.id), ['a', 'b', 'c'])
})

test('ordine: non modifica l array ricevuto', () => {
    const lista = [riga('b', '2026-10-26T10:00:00Z'), riga('a', '2026-10-26T15:00:00Z')]
    ordinaPrimaChiamata(lista, () => 0)
    assert.deepEqual(lista.map((l) => l.id), ['b', 'a'])
})

// --------------------------------------------------------- "arrivato X fa"

const ora = Date.parse('2026-10-26T15:00:00Z')

test('tempo da arrivo: adesso, minuti, ore, giorni', () => {
    assert.equal(tempoDaArrivo(ora - 20_000, ora), 'adesso')
    assert.equal(tempoDaArrivo(ora - 12 * 60_000, ora), '12 min fa')
    assert.equal(tempoDaArrivo(ora - 60 * 60_000, ora), '1 ora fa')
    assert.equal(tempoDaArrivo(ora - 5 * 3_600_000, ora), '5 ore fa')
    assert.equal(tempoDaArrivo(ora - 26 * 3_600_000, ora), '1 giorno fa')
    assert.equal(tempoDaArrivo(ora - 4 * 86_400_000, ora), '4 giorni fa')
})

test('tempo da arrivo: un orologio del browser indietro non produce tempi negativi', () => {
    assert.equal(tempoDaArrivo(ora + 90_000, ora), 'adesso')
})

// --------------------------------------------------------- gruppi della 1ª chiamata (PO 10/11/2026)

type RigaTipo = Riga & { funnel?: string | null; maiContattato?: boolean; chiamaPerPrimo?: boolean; tiHaCercato?: boolean }
const rigaT = (id: string, arrivo: string, p: Partial<RigaTipo> = {}): RigaTipo =>
    ({ id, arrivedAt: new Date(arrivo), vergine: false, priorita: 0, ...p })

test('tipo: BF, vergine, chat interrotta, ti ha cercato, altro', () => {
    assert.equal(tipoPrimaChiamata({ vergine: false, funnel: ' black friday', chiamaPerPrimo: true }), 'black_friday')
    assert.equal(tipoPrimaChiamata({ vergine: false, maiContattato: true }), 'vergine')
    assert.equal(tipoPrimaChiamata({ vergine: true }), 'vergine', 'senza maiContattato vale il vergine del giorno')
    assert.equal(tipoPrimaChiamata({ vergine: false, chiamaPerPrimo: true, tiHaCercato: true }), 'chat_interrotta')
    assert.equal(tipoPrimaChiamata({ vergine: false, tiHaCercato: true }), 'ti_ha_cercato')
    assert.equal(tipoPrimaChiamata({ vergine: false }), 'altro')
})

test('ordine PO 10/11: BF, poi vergini, poi chat interrotte, poi il resto, qualunque priorità', () => {
    const lista = [
        rigaT('altro', '2026-11-10T13:00:00Z', { priorita: 9999 }),
        rigaT('stella', '2026-11-10T12:59:00Z', { chiamaPerPrimo: true, priorita: 5000 }),
        rigaT('vergine-ieri', '2026-11-09T19:00:00Z', { maiContattato: true }),
        rigaT('bf', '2026-11-01T09:00:00Z', { funnel: 'BLACK FRIDAY' }),
    ]
    assert.deepEqual(ordinaPrimaChiamata(lista, (l) => l.priorita).map((l) => l.id), ['bf', 'vergine-ieri', 'stella', 'altro'])
})

test('ordine PO 10/11: la stella non porta più una chat interrotta sopra un vergine di ieri (scorta spenta)', () => {
    // Prima la stella (16 punti di priorità) batteva il vergine non del giorno.
    const lista = [
        rigaT('stella', '2026-11-10T12:00:00Z', { chiamaPerPrimo: true, priorita: 16 }),
        rigaT('vergine', '2026-11-08T20:00:00Z', { maiContattato: true, priorita: 0 }),
    ]
    assert.deepEqual(ordinaPrimaChiamata(lista, (l) => l.priorita).map((l) => l.id), ['vergine', 'stella'])
})

test('ordine PO 10/11: "Ti ha cercato" sta con le chat interrotte, sotto i vergini e sopra il resto', () => {
    const lista = [
        rigaT('altro', '2026-11-10T13:00:00Z', { priorita: 100 }),
        rigaT('cercato', '2026-11-01T09:00:00Z', { tiHaCercato: true }),
        rigaT('vergine', '2026-11-05T09:00:00Z', { maiContattato: true }),
    ]
    assert.deepEqual(ordinaPrimaChiamata(lista, (l) => l.priorita).map((l) => l.id), ['vergine', 'cercato', 'altro'])
})

test('ordine PO 10/11: dentro i vergini quelli del giorno per primi, poi la priorità e l arrivo', () => {
    const lista = [
        rigaT('ieri', '2026-11-09T22:00:00Z', { maiContattato: true, priorita: 50 }),
        rigaT('oggi', '2026-11-10T09:00:00Z', { maiContattato: true, vergine: true }),
    ]
    assert.deepEqual(ordinaPrimaChiamata(lista, (l) => l.priorita).map((l) => l.id), ['oggi', 'ieri'])
})

test('ordine PO 10/11: dentro i BF restano vergini e stelle nell ordine di prima', () => {
    const lista = [
        rigaT('bf-ridato', '2026-11-10T13:00:00Z', { funnel: 'BLACK FRIDAY' }),
        rigaT('bf-vergine', '2026-11-10T08:00:00Z', { funnel: 'BLACK FRIDAY', maiContattato: true, vergine: true }),
    ]
    assert.deepEqual(ordinaPrimaChiamata(lista, (l) => l.priorita).map((l) => l.id), ['bf-vergine', 'bf-ridato'])
})

test('vergine mai contattato: come quello del giorno ma senza la data', () => {
    const ieri = { ...vergine, createdAt: new Date('2026-10-25T19:58:00+01:00') }
    assert.equal(eVergineMaiContattato(ieri), true)
    assert.equal(eVergineDelGiorno(ieri, inizioOggi), false)
    assert.equal(eVergineMaiContattato({ ...ieri, ridatoDalBot: true }), false)
    assert.equal(eVergineMaiContattato({ ...ieri, tiHaCercato: true }), false)
})
