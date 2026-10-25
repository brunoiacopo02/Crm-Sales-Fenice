import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    generateSchedule, auditSchedule, CITAZIONE_RULES, VENDITA_RULES,
    type ScheduleQuote, type ScheduledDay, type ScheduleRules,
} from './schedule'

// ── fixture ──

function q(id: string, author: string, theme: string | null, extra: Partial<ScheduleQuote> = {}): ScheduleQuote {
    return { id, author, theme, text: `alfa${id} beta${id} gamma${id}`, occasions: [], ...extra }
}

/** n citazioni "normali" con autori e temi a rotazione, testi tutti diversi. */
function pool(n: number, authors: number, themes: number, prefix = 'n'): ScheduleQuote[] {
    return Array.from({ length: n }, (_, i) =>
        q(`${prefix}${String(i).padStart(3, '0')}`, `Autore ${i % authors}`, `tema${i % themes}`))
}

/** k citazioni a tema per un'occasione, con autori e temi propri (nessun conflitto tra loro). */
function tagged(prefix: string, k: number, occasions: string[]): ScheduleQuote[] {
    return Array.from({ length: k }, (_, i) =>
        q(`${prefix}${i}`, `Autore ${prefix} ${i}`, `tema_${prefix}_${i}`, { occasions }))
}

// Controllo indipendente dei vincoli (non usa il modulo sotto test).
function violations(res: ScheduledDay[], quotes: ScheduleQuote[], minAuthor: number, minTheme: number): string[] {
    const byId = new Map(quotes.map(x => [x.id, x]))
    const out: string[] = []
    res.forEach((r, i) => {
        if (!r.quoteId) { out.push(`${r.day} vuoto`); return }
        const cur = byId.get(r.quoteId)!
        for (let d = 1; d < Math.max(minAuthor, minTheme) && i - d >= 0; d++) {
            const prev = byId.get(res[i - d].quoteId!)!
            if (d < minTheme && cur.theme && prev.theme === cur.theme) out.push(`${r.day} tema ${cur.theme} a ${d}`)
            if (d < minAuthor && prev.author === cur.author) out.push(`${r.day} autore ${cur.author} a ${d}`)
        }
    })
    return out
}

const idsOn = (res: ScheduledDay[], from: string, to: string) =>
    res.filter(r => r.day >= from && r.day <= to).map(r => r.quoteId)
const dayOf = (res: ScheduledDay[], id: string) => res.filter(r => r.quoteId === id).map(r => r.day)
const base = { seed: 'test', rules: CITAZIONE_RULES }

// ── giorni ──

test('solo giorni lavorativi: feste e chiusure saltate', () => {
    const res = generateSchedule({ ...base, quotes: pool(40, 12, 6), from: '2026-12-21', to: '2027-01-09', closedDays: ['2026-12-24'] })
    assert.deepEqual(res.map(r => r.day), [
        '2026-12-21', '2026-12-22', '2026-12-23',
        '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
        '2027-01-02', '2027-01-04', '2027-01-05', '2027-01-07', '2027-01-08', '2027-01-09',
    ])
})

test('pool vuoto: i giorni ci sono ma senza citazione', () => {
    const res = generateSchedule({ ...base, quotes: [], from: '2026-10-26', to: '2026-10-28' })
    assert.deepEqual(res.map(r => [r.day, r.quoteId]), [['2026-10-26', null], ['2026-10-27', null], ['2026-10-28', null]])
})

// ── vincoli ──

test('cinque mesi: niente tema ripetuto il giorno dopo, autore mai prima di 7 giorni, nessuna ripetizione', () => {
    const quotes = pool(300, 20, 10)
    const res = generateSchedule({ ...base, quotes, from: '2026-10-26', to: '2027-03-31' })
    assert.equal(res.length, 129)
    assert.deepEqual(violations(res, quotes, 7, 2), [])
    assert.equal(new Set(res.map(r => r.quoteId)).size, res.length)
    assert.deepEqual(res.filter(r => r.relaxed.length > 0), [])
})

test('frasi troppo simili: mai entro 10 giorni lavorativi', () => {
    const twinText = 'La felicità della tua vita dipende dalla qualità dei tuoi pensieri.'
    const quotes = [
        ...pool(40, 10, 8),
        q('s1', 'Marco Aurelio', 'gioia', { text: twinText }),
        q('s2', 'Seneca', 'calma', { text: 'La felicità della vita dipende dalla qualità dei pensieri.' }),
    ]
    let bothUsed = 0
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
        const res = generateSchedule({ ...base, seed, quotes, from: '2026-10-26', to: '2026-11-30' })
        const i1 = res.findIndex(r => r.quoteId === 's1')
        const i2 = res.findIndex(r => r.quoteId === 's2')
        if (i1 >= 0 && i2 >= 0) {
            bothUsed++
            assert.ok(Math.abs(i1 - i2) > 10, `seme ${seed}: distanza ${Math.abs(i1 - i2)}`)
        }
    }
    assert.ok(bothUsed > 0, 'il test deve vedere almeno un calendario con entrambe')
})

test('vincoli impossibili: il giorno si riempie lo stesso e lo dichiara', () => {
    const quotes = [q('u1', 'Unico', 't'), q('u2', 'Unico', 't'), q('u3', 'Unico', 't')]
    const res = generateSchedule({ ...base, quotes, from: '2026-10-26', to: '2026-10-30' })
    assert.equal(res.every(r => r.quoteId !== null), true)
    assert.equal(res.slice(1).every(r => r.relaxed.length > 0), true)
    for (let i = 1; i < res.length; i++) assert.notEqual(res[i].quoteId, res[i - 1].quoteId)
})

// ── ripetibilità ──

test('deterministico: stesso seme stesso calendario (anche con input mescolato), seme diverso calendario diverso', () => {
    const quotes = pool(120, 20, 10)
    const args = { ...base, from: '2026-10-26', to: '2027-01-31' }
    const a = generateSchedule({ ...args, quotes })
    const b = generateSchedule({ ...args, quotes: [...quotes].reverse() })
    const c = generateSchedule({ ...args, quotes, seed: 'altro' })
    assert.deepEqual(a, b)
    assert.notDeepEqual(a.map(r => r.quoteId), c.map(r => r.quoteId))
})

// ── esaurimento ──

test('pool esaurito: si ricomincia rispettando i vincoli, prima tutte una volta', () => {
    const quotes = pool(12, 12, 6)
    const res = generateSchedule({ ...base, quotes, from: '2026-10-26', to: '2026-11-30' })
    assert.equal(res.length, 31)
    assert.equal(new Set(res.slice(0, 12).map(r => r.quoteId)).size, 12)
    assert.deepEqual(violations(res, quotes, 7, 2), [])
    assert.ok(res.some(r => r.cycle > 0))
})

// ── occasioni forti ──

test('natale: solo dall’1 al 24/12, più fitto verso la vigilia, la vigilia sempre', () => {
    const natale = tagged('x', 8, ['natale'])
    const quotes = [...pool(60, 15, 8), ...natale]
    const res = generateSchedule({ ...base, quotes, from: '2026-11-23', to: '2026-12-31' })
    const ids = new Set(natale.map(x => x.id))
    const days = res.filter(r => r.quoteId && ids.has(r.quoteId)).map(r => r.day)
    assert.equal(days.length, 8)
    assert.ok(days.every(d => d >= '2026-12-01' && d <= '2026-12-24'), days.join(','))
    const firstHalf = days.filter(d => d <= '2026-12-12').length
    const secondHalf = days.filter(d => d >= '2026-12-14').length
    assert.ok(firstHalf < secondHalf, `${firstHalf} vs ${secondHalf}`)
    assert.ok(days.includes('2026-12-24'))
    assert.equal(res.find(r => r.day === '2026-12-24')!.occasion, 'natale')
})

test('natale su due anni: le citazioni a tema si dividono tra i due dicembre', () => {
    const natale = tagged('x', 6, ['natale'])
    const quotes = [...pool(360, 40, 12), ...natale]
    const res = generateSchedule({ ...base, quotes, from: '2026-11-02', to: '2027-12-31' })
    const ids = new Set(natale.map(x => x.id))
    const days = res.filter(r => r.quoteId && ids.has(r.quoteId)).map(r => r.day)
    assert.ok(days.filter(d => d.startsWith('2026-12')).length >= 2, days.join(','))
    assert.ok(days.filter(d => d.startsWith('2027-12')).length >= 2, days.join(','))
})

test('inizio anno: primo giorno lavorativo di gennaio e quello dopo l’Epifania', () => {
    const inizio = tagged('ia', 3, ['inizio_anno'])
    const quotes = [...pool(30, 10, 6), ...inizio]
    const res = generateSchedule({ ...base, quotes, from: '2026-12-28', to: '2027-01-16' })
    const ids = new Set(inizio.map(x => x.id))
    assert.ok(ids.has(res.find(r => r.day === '2027-01-02')!.quoteId!))
    assert.ok(ids.has(res.find(r => r.day === '2027-01-07')!.quoteId!))
    const used = res.filter(r => r.quoteId && ids.has(r.quoteId)).map(r => r.day)
    assert.deepEqual(used, ['2027-01-02', '2027-01-07'])
})

test('Pasqua, 25 aprile, 1 maggio, 2 giugno', () => {
    const rin = tagged('rin', 2, ['rinascita'])
    const quotes = [
        ...pool(120, 20, 10), ...rin,
        ...tagged('lib', 1, ['liberazione']), ...tagged('lav', 1, ['festa_lavoro']), ...tagged('rep', 1, ['repubblica']),
    ]
    const res = generateSchedule({ ...base, quotes, from: '2027-03-01', to: '2027-06-05' })
    const on = (d: string) => res.find(r => r.day === d)!.quoteId
    assert.ok(['rin0', 'rin1'].includes(on('2027-03-30')!))
    for (const id of ['rin0', 'rin1']) {
        const d = dayOf(res, id)
        assert.equal(d.length, 1)
        assert.ok(d[0] >= '2027-03-15' && d[0] <= '2027-03-30', `${id} il ${d[0]}`)
    }
    assert.equal(on('2027-04-24'), 'lib0')
    assert.equal(on('2027-04-30'), 'lav0')
    assert.equal(on('2027-06-01'), 'rep0')
})

test('ferie la settimana prima di Ferragosto, rientro il 16/8 e a inizio settembre', () => {
    const ferie = tagged('fer', 3, ['ferie'])
    const rientro = tagged('rie', 3, ['rientro'])
    const quotes = [...pool(80, 16, 8), ...ferie, ...rientro]
    const res = generateSchedule({ ...base, quotes, from: '2027-08-02', to: '2027-09-20' })
    const ferieDays = ferie.flatMap(x => dayOf(res, x.id))
    assert.equal(ferieDays.length, 3)
    assert.ok(ferieDays.every(d => d >= '2027-08-09' && d <= '2027-08-14'), ferieDays.join(','))
    assert.ok(rientro.map(x => x.id).includes(res.find(r => r.day === '2027-08-16')!.quoteId!))
    const rientroDays = rientro.flatMap(x => dayOf(res, x.id))
    assert.equal(rientroDays.length, 3)
    assert.ok(rientroDays.every(d => d === '2027-08-16' || (d >= '2027-09-01' && d <= '2027-09-14')), rientroDays.join(','))
})

// ── occasioni deboli ──

test('lunedì: le citazioni del lunedì cadono di lunedì', () => {
    const mon = tagged('mon', 3, ['lunedi'])
    const quotes = [...pool(40, 12, 8), ...mon]
    const res = generateSchedule({ ...base, quotes, from: '2026-11-02', to: '2026-11-28' })
    const days = mon.flatMap(x => dayOf(res, x.id))
    assert.equal(days.length, 3)
    assert.ok(days.every(d => ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'].includes(d)), days.join(','))
})

test('stagioni: una citazione d’estate non esce a maggio', () => {
    const quotes = [...pool(100, 12, 8), ...tagged('est', 1, ['estate'])]
    const res = generateSchedule({ ...base, quotes, from: '2027-05-03', to: '2027-07-31' })
    const d = dayOf(res, 'est0')
    assert.equal(d.length, 1)
    assert.ok(d[0] >= '2027-06-21', d[0])
})

// ── giorni approvati e storico ──

test('giorni bloccati (approvati): restano, la citazione non si ripete e i vincoli valgono anche prima', () => {
    const quotes = pool(100, 20, 10)
    const res = generateSchedule({ ...base, quotes, from: '2026-10-26', to: '2026-11-30', locked: { '2026-11-10': 'n005' } })
    const i = res.findIndex(r => r.day === '2026-11-10')
    assert.equal(res[i].quoteId, 'n005')
    assert.equal(res[i].locked, true)
    assert.deepEqual(dayOf(res, 'n005'), ['2026-11-10'])
    res.forEach((r, j) => {
        const other = quotes.find(x => x.id === r.quoteId)!
        if (j !== i && Math.abs(j - i) < 7) assert.notEqual(other.author, 'Autore 5', `${r.day}`)
        if (Math.abs(j - i) === 1) assert.notEqual(other.theme, 'tema5', `${r.day}`)
    })
    assert.deepEqual(violations(res, quotes, 7, 2), [])
})

test('giorni bloccati: l’autore del giorno approvato non compare nei 6 giorni prima', () => {
    // metà del pool è dello stesso autore: senza guardare avanti finirebbe a ridosso del giorno bloccato
    const quotes = [
        ...Array.from({ length: 30 }, (_, i) => q(`x${String(i).padStart(2, '0')}`, 'Autore X', `tx${i % 6}`)),
        ...pool(30, 30, 6),
    ]
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
        const res = generateSchedule({ ...base, seed, quotes, from: '2026-10-26', to: '2026-11-14', locked: { '2026-11-03': 'x00' } })
        const i = res.findIndex(r => r.day === '2026-11-03')
        res.forEach((r, j) => {
            if (j === i || Math.abs(j - i) >= 7) return
            assert.notEqual(quotes.find(x => x.id === r.quoteId)!.author, 'Autore X', `seme ${seed}, ${r.day}`)
        })
    }
})

test('giro nuovo: una citazione non torna prima di metà pool di giorni', () => {
    const quotes = pool(40, 40, 8)
    for (const seed of ['a', 'b', 'c']) {
        const res = generateSchedule({ ...base, seed, quotes, from: '2026-10-26', to: '2027-01-16' })
        const last = new Map<string, number>()
        res.forEach((r, i) => {
            const prev = last.get(r.quoteId!)
            if (prev !== undefined) assert.ok(i - prev >= 20, `seme ${seed}: ${r.quoteId} dopo ${i - prev} giorni`)
            last.set(r.quoteId!, i)
        })
        assert.ok(res.some(r => r.cycle > 0))
    }
})

test('fine giro: le citazioni di Natale non escono a novembre, si ricomincia il giro', () => {
    // 12 generiche: la stessa frase non torna prima di 11 giorni, quindi il giro nuovo è possibile
    const general = pool(12, 12, 5)
    const quotes = [...general, ...tagged('x', 3, ['natale'])]
    const res = generateSchedule({ ...base, quotes, from: '2026-10-26', to: '2026-11-21' })
    assert.equal(res.some(r => r.quoteId!.startsWith('x')), false)
    assert.ok(res.some(r => r.cycle > 0))
    assert.deepEqual(violations(res, quotes, 7, 2), [])
})

test('storico: niente ripetizioni dei giorni passati e vincoli a cavallo', () => {
    const quotes = pool(100, 20, 10)
    const history = [
        { day: '2026-10-22', quoteId: 'n001' },
        { day: '2026-10-23', quoteId: 'n002' },
        { day: '2026-10-24', quoteId: 'n003' },
    ]
    const res = generateSchedule({ ...base, quotes, from: '2026-10-26', to: '2026-11-30', history })
    for (const id of ['n001', 'n002', 'n003']) assert.deepEqual(dayOf(res, id), [])
    const first6 = res.slice(0, 6).map(r => quotes.find(x => x.id === r.quoteId)!.author)
    assert.ok(!first6.includes('Autore 3'), first6.join(','))
    assert.notEqual(quotes.find(x => x.id === res[0].quoteId)!.theme, 'tema3')
})

// ── consiglio di vendita ──

test('vendita: niente tema o autore uguali il giorno dopo, e nessun ruolo resta a secco più di due giorni', () => {
    const quotes = [
        ...Array.from({ length: 10 }, (_, i) => q(`v${i}`, `Autore ${i % 5}`, `tema${i % 4}`, { roles: ['VENDITORE'] })),
        ...Array.from({ length: 10 }, (_, i) => q(`g${i}`, `Autore ${i % 5}`, `tema${(i + 1) % 4}`, { roles: ['GDO'] })),
    ]
    const res = generateSchedule({ seed: 'vendita', rules: VENDITA_RULES, quotes, from: '2026-10-26', to: '2026-11-17' })
    assert.equal(res.length, 20)
    assert.deepEqual(violations(res, quotes, 2, 2), [])
    for (const role of ['GDO', 'VENDITORE']) {
        let gap = 0, worst = 0
        for (const r of res) {
            const has = quotes.find(x => x.id === r.quoteId)!.roles!.includes(role)
            gap = has ? 0 : gap + 1
            worst = Math.max(worst, gap)
        }
        assert.ok(worst <= 2, `${role}: ${worst} giorni senza consiglio`)
    }
})

test('vendita: un ruolo con pochi consigli li riceve distribuiti, non tutti all’inizio', () => {
    const quotes = [
        ...Array.from({ length: 6 }, (_, i) => q(`c${i}`, `Autore C${i}`, `tc${i % 3}`, { roles: ['CONFERME'] })),
        ...Array.from({ length: 24 }, (_, i) => q(`g${String(i).padStart(2, '0')}`, `Autore G${i % 8}`, `tg${i % 4}`, { roles: ['GDO'] })),
    ]
    for (const seed of ['a', 'b', 'c']) {
        const res = generateSchedule({ seed, rules: VENDITA_RULES, quotes, from: '2026-10-26', to: '2027-01-09' })
        let gap = 0, worst = 0
        for (const r of res) {
            gap = r.quoteId!.startsWith('c') ? 0 : gap + 1
            worst = Math.max(worst, gap)
        }
        assert.ok(worst <= 7, `seme ${seed}: Conferme senza consiglio per ${worst} giorni`)
        assert.deepEqual(violations(res, quotes, 2, 2), [])
    }
})

test('vendita: il ruolo scarso non brucia i suoi consigli nei primi giorni del giro', () => {
    const quotes = [
        ...Array.from({ length: 6 }, (_, i) => q(`c${i}`, `Autore C${i}`, `tc${i % 3}`, { roles: ['CONFERME'] })),
        ...Array.from({ length: 24 }, (_, i) => q(`g${String(i).padStart(2, '0')}`, `Autore G${i % 8}`, `tg${i % 4}`, { roles: ['GDO'] })),
    ]
    for (const seed of ['a', 'b', 'c']) {
        const res = generateSchedule({ seed, rules: VENDITA_RULES, quotes, from: '2026-10-26', to: '2026-11-30' })
        const firstTen = res.slice(0, 10).filter(r => r.quoteId!.startsWith('c')).length
        assert.ok(firstTen <= 3, `seme ${seed}: ${firstTen} consigli Conferme nei primi 10 giorni`)
    }
})

test('vendita: consigli di un ruolo finiti nel giro, si riapre il giro invece di aspettarne la fine', () => {
    const quotes = [
        ...Array.from({ length: 6 }, (_, i) => q(`c${i}`, `Autore C${i}`, `tc${i % 3}`, { roles: ['CONFERME'] })),
        ...Array.from({ length: 24 }, (_, i) => q(`g${String(i).padStart(2, '0')}`, `Autore G${i % 8}`, `tg${i % 4}`, { roles: ['GDO'] })),
    ]
    // nello storico: i 6 consigli Conferme all'inizio, poi 10 GDO (16 usati su 30)
    const histDays = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-12', '2026-10-13', '2026-10-14',
        '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
        '2026-10-24', '2026-10-25']
    const histIds = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'g00', 'g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08', 'g09']
    const history = histDays.map((day, k) => ({ day, quoteId: histIds[k] }))
    const res = generateSchedule({ seed: 'r', rules: VENDITA_RULES, quotes, from: '2026-10-26', to: '2026-11-14', history })
    const firstConferme = res.findIndex(r => r.quoteId!.startsWith('c'))
    assert.ok(firstConferme >= 0 && firstConferme <= 3, `primo consiglio Conferme al giorno ${firstConferme}`)
})

test('vendita: le occasioni non contano', () => {
    const quotes = [...pool(30, 10, 6), ...tagged('x', 2, ['natale'])]
    const res = generateSchedule({ seed: 's', rules: VENDITA_RULES, quotes, from: '2026-11-02', to: '2026-12-31' })
    assert.equal(res.every(r => r.occasion === null), true)
})

// ── controllo a posteriori ──

test('audit: segnala tema e autore troppo vicini e frasi simili', () => {
    const rules: ScheduleRules = CITAZIONE_RULES
    const quotes = [
        q('a', 'Seneca', 'tempo'), q('b', 'Epitteto', 'tempo'), q('c', 'Seneca', 'calma'),
        q('d', 'Orazio', 'gioia', { text: 'Il signore è calmo e sciolto; il volgo è sempre inquieto.' }),
        q('e', 'Laozi', 'senso', { text: 'Il signore cerca in se stesso. Il volgo cerca negli altri.' }),
    ]
    const v = auditSchedule([
        { day: '2026-10-26', quoteId: 'a' },
        { day: '2026-10-27', quoteId: 'b' },   // tema "tempo" il giorno dopo
        { day: '2026-10-28', quoteId: 'c' },   // Seneca a 2 giorni
        { day: '2026-10-29', quoteId: 'd' },
        { day: '2026-10-30', quoteId: 'e' },   // simile a d
    ], quotes, rules)
    assert.deepEqual(v.map(x => `${x.day} ${x.rule} ${x.other}`).sort(), [
        '2026-10-27 tema 2026-10-26',
        '2026-10-28 autore 2026-10-26',
        '2026-10-30 simile 2026-10-29',
    ])
    assert.deepEqual(auditSchedule([{ day: '2026-10-26', quoteId: 'a' }, { day: '2026-10-27', quoteId: 'c' }], quotes, VENDITA_RULES)
        .map(x => x.rule), ['autore'])
})
