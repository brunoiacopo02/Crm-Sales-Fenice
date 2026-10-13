import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isIsoDay, parseMarketingQueue, scegliLeadEsistente, MAX_LEADS_PER_CODA } from './payload'

function lead(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        marketing_contact_id: '0b6f2c1e-1111-4222-8333-944444444444',
        posizione: 1,
        nome: 'Giulia',
        cognome: 'Rossi',
        telefono_e164: '+393331234567',
        email: 'Giulia.Rossi@Example.it',
        motivo_chiamata: 'Ha riaperto 3 email questa settimana',
        punteggio: 42.5,
        funnel_origine: 'videoeditor',
        data_ingresso: '2026-09-01',
        ...over,
    }
}

function corpo(leads: unknown[] = [lead()], over: Record<string, unknown> = {}) {
    return { company: 'fenice', data: '2026-10-14', leads, ...over }
}

test('isIsoDay: solo giorni veri nel formato YYYY-MM-DD', () => {
    assert.equal(isIsoDay('2026-10-14'), true)
    assert.equal(isIsoDay('2026-02-30'), false)
    assert.equal(isIsoDay('14/10/2026'), false)
    assert.equal(isIsoDay('2026-10-14T06:30:00Z'), false)
    assert.equal(isIsoDay(20261014), false)
})

test('body valido: lead normalizzato', () => {
    const r = parseMarketingQueue(corpo())
    assert.ok(r.ok)
    assert.equal(r.company, 'fenice')
    assert.equal(r.queueDate, '2026-10-14')
    assert.deepEqual(r.scartati, [])
    assert.equal(r.leads.length, 1)
    const l = r.leads[0]
    assert.equal(l.name, 'Giulia Rossi')
    assert.equal(l.phone, '+393331234567')
    assert.equal(l.email, 'giulia.rossi@example.it')
    assert.equal(l.punteggio, 42.5)
    assert.equal(l.dataIngresso, '2026-09-01')
    assert.equal(l.motivoChiamata, 'Ha riaperto 3 email questa settimana')
})

test('body malformato → errore (400)', () => {
    assert.equal(parseMarketingQueue(null).ok, false)
    assert.equal(parseMarketingQueue([]).ok, false)
    assert.equal(parseMarketingQueue(corpo([lead()], { company: '' })).ok, false)
    assert.equal(parseMarketingQueue(corpo([lead()], { data: '2026-13-01' })).ok, false)
    assert.equal(parseMarketingQueue(corpo([lead()], { leads: 'x' })).ok, false)
    const tanti = Array.from({ length: MAX_LEADS_PER_CODA + 1 }, () => lead())
    assert.equal(parseMarketingQueue(corpo(tanti)).ok, false)
})

test('coda vuota è valida', () => {
    const r = parseMarketingQueue(corpo([]))
    assert.ok(r.ok)
    assert.equal(r.leads.length, 0)
})

test('lead non validi finiscono negli scartati, gli altri passano', () => {
    const r = parseMarketingQueue(corpo([
        lead({ marketing_contact_id: 'a' }),
        lead({ marketing_contact_id: '' }),
        lead({ marketing_contact_id: 'b', posizione: 0 }),
        lead({ marketing_contact_id: 'c', telefono_e164: '' }),
        lead({ marketing_contact_id: 'd', telefono_e164: '123' }),
        lead({ marketing_contact_id: 'a', posizione: 2 }),
        'stringa',
    ]))
    assert.ok(r.ok)
    assert.deepEqual(r.leads.map(l => l.marketingContactId), ['a'])
    assert.deepEqual(r.scartati, [
        { marketing_contact_id: '', motivo: 'marketing_contact_id mancante' },
        { marketing_contact_id: 'b', motivo: 'posizione mancante o non intera ≥ 1' },
        { marketing_contact_id: 'c', motivo: 'telefono_e164 mancante' },
        { marketing_contact_id: 'd', motivo: 'telefono_e164 non valido' },
        { marketing_contact_id: 'a', motivo: 'duplicato nella stessa coda' },
        { marketing_contact_id: '', motivo: 'lead non è un oggetto' },
    ])
})

test('campi facoltativi assenti o sporchi diventano null', () => {
    const r = parseMarketingQueue(corpo([lead({
        nome: undefined, cognome: undefined, email: 'non-una-mail',
        punteggio: 'alto', data_ingresso: 'ieri', motivo_chiamata: '  ', funnel_origine: undefined,
    })]))
    assert.ok(r.ok)
    const l = r.leads[0]
    assert.equal(l.name, 'Lead senza nome')
    assert.equal(l.email, null)
    assert.equal(l.punteggio, null)
    assert.equal(l.dataIngresso, null)
    assert.equal(l.motivoChiamata, null)
    assert.equal(l.funnelOrigine, null)
})

test('scegliLeadEsistente: vince lo stesso contatto marketing, poi il telefono, poi l\'email; a parità il più recente', () => {
    const d = (s: string) => new Date(s)
    const cerca = { marketingContactId: 'mk-1', phone: '+393331234567', email: 'g@x.it' }
    const perEmail = { id: 'e', marketingContactId: null, phone: '+390000000000', email: 'g@x.it', createdAt: d('2026-10-01') }
    const telVecchio = { id: 't1', marketingContactId: null, phone: '+393331234567', email: null, createdAt: d('2026-08-01') }
    const telNuovo = { id: 't2', marketingContactId: null, phone: '+393331234567', email: null, createdAt: d('2026-09-01') }
    const stessoMk = { id: 'm', marketingContactId: 'mk-1', phone: '+391111111111', email: null, createdAt: d('2026-01-01') }

    assert.equal(scegliLeadEsistente(cerca, [perEmail, telVecchio, telNuovo, stessoMk])?.id, 'm')
    assert.equal(scegliLeadEsistente(cerca, [perEmail, telVecchio, telNuovo])?.id, 't2')
    assert.equal(scegliLeadEsistente(cerca, [perEmail])?.id, 'e')
    assert.equal(scegliLeadEsistente(cerca, []), null)
    // Stesso telefono ma gia' legato a un altro contatto marketing: e' comunque
    // la stessa persona nel CRM, niente doppione (il collegamento non si sovrascrive).
    const altroMk = { ...telNuovo, marketingContactId: 'mk-2' }
    assert.equal(scegliLeadEsistente(cerca, [altroMk])?.id, 't2')
})
