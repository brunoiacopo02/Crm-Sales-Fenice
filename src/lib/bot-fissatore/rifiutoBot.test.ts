import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rifiutoDalCorpo, rifiutoDaRidare, numeroNonChiamabile, notaRifiuto } from './rifiutoBot'
import { instradamentoRidato } from './maiConsegnato'

// Corpi reali di /api/bot/intake (app/api/bot/intake/route.ts del bot).
test('rifiutoDalCorpo: telefono non valido, arruolamento fallito, apertura non partita', () => {
    assert.deepEqual(rifiutoDalCorpo('{"ok":true,"skipped":"invalid_phone","accettato":false,"motivo":"telefono_non_valido"}'), { motivo: 'telefono_non_valido' })
    assert.deepEqual(rifiutoDalCorpo('{"ok":true,"error":"enroll_failed","accettato":false,"motivo":"arruolamento_fallito"}'), { motivo: 'arruolamento_fallito' })
    assert.deepEqual(rifiutoDalCorpo('{"ok":true,"accettato":false,"motivo":"apertura_non_partita","conversationId":3}'), { motivo: 'apertura_non_partita' })
    assert.deepEqual(rifiutoDalCorpo('{"ok":true,"accettato":false}'), { motivo: 'sconosciuto' })
})

test('rifiutoDalCorpo: preso, doppione o corpo illeggibile → nessun rifiuto', () => {
    assert.equal(rifiutoDalCorpo('{"ok":true,"accettato":true,"conversationId":1}'), null)
    assert.equal(rifiutoDalCorpo('{"ok":true,"accettato":true,"duplicato":true}'), null)
    assert.equal(rifiutoDalCorpo('{"ok":true}'), null)
    assert.equal(rifiutoDalCorpo(''), null)
    assert.equal(rifiutoDalCorpo(null), null)
    assert.equal(rifiutoDalCorpo('non json'), null)
})

test('rifiutoDaRidare: solo i motivi in cui il bot non ha creato niente', () => {
    assert.equal(rifiutoDaRidare('telefono_non_valido'), true)
    assert.equal(rifiutoDaRidare('arruolamento_fallito'), true)
    assert.equal(rifiutoDaRidare('chat_con_appuntamento'), true)
    assert.equal(rifiutoDaRidare('apertura_non_partita'), false)
    assert.equal(rifiutoDaRidare('sconosciuto'), false)
})

test('numeroNonChiamabile: solo i numeri che non si chiamano nemmeno a voce', () => {
    // Casi veri del 29/10 (cifre cambiate dove non contano).
    assert.equal(numeroNonChiamabile('+000000000000000'), true)
    assert.equal(numeroNonChiamabile('000'), true)
    assert.equal(numeroNonChiamabile('87'), true)
    assert.equal(numeroNonChiamabile('3333333333'), true)
    assert.equal(numeroNonChiamabile(''), true)
    assert.equal(numeroNonChiamabile(null), true)
    // Fissi e numeri scritti male ma completi: li chiama il GDO.
    assert.equal(numeroNonChiamabile('085974692'), false)
    assert.equal(numeroNonChiamabile('+390456931234'), false)
    assert.equal(numeroNonChiamabile('+0393209530413'), false)
    assert.equal(numeroNonChiamabile('+393401234567'), false)
})

test('il rifiuto del bot va al giro dei GDO, mai parcheggiato', () => {
    assert.equal(instradamentoRidato('rifiutato_dal_bot', null), 'giro_gdo')
    assert.match(notaRifiuto('telefono_non_valido'), /Chiamare a voce/)
})

// Contratto v1.16 (PO 10/11/2026): chat del numero con l'APPUNTAMENTO di un altro lead.
test('chat_con_appuntamento: rifiuto letto con la data, nota chiara, al giro dei GDO', () => {
    const r = rifiutoDalCorpo('{"ok":true,"accettato":false,"motivo":"chat_con_appuntamento","conversationId":11221,"leadIdAppuntamento":"3d6c3213","appuntamento":"2026-09-12T14:00:00+00:00"}')
    assert.deepEqual(r, { motivo: 'chat_con_appuntamento', appuntamento: '2026-09-12T14:00:00+00:00', leadIdAppuntamento: '3d6c3213' })
    assert.equal(rifiutoDaRidare(r!.motivo), true)
    const n = notaRifiuto(r!.motivo, { appuntamento: r!.appuntamento })
    assert.match(n, /^Doppione: questo numero ha già un appuntamento fissato su un altro lead/)
    assert.match(n, /12 settembre/)
    assert.match(n, /16:00/)
    assert.match(n, /chiamare a voce/i)
    assert.match(notaRifiuto('chat_con_appuntamento'), /altro lead\. La richiesta nuova/)
    assert.equal(instradamentoRidato('rifiutato_dal_bot', n, null, 'BLACK FRIDAY'), 'giro_gdo')
})
