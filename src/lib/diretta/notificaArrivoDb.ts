// Scrittura della notifica "appena arrivato" (vedi notificaArrivo.ts).
// Idempotente sull'id (lead, GDO) e mai bloccante: se non riesce lo dice nei
// log, il lead è comunque già in cima alla prima chiamata del GDO.

import { db } from '@/db'
import { notifications } from '@/db/schema'
import { notificaAppenaArrivato, type ArrivoDaNotificare } from './notificaArrivo'

export async function inviaNotificaAppenaArrivato(a: ArrivoDaNotificare): Promise<void> {
    try {
        await db.insert(notifications)
            .values(notificaAppenaArrivato(a))
            .onConflictDoNothing({ target: notifications.id })
    } catch (e) {
        console.error(`[notifica appena arrivato] lead ${a.leadId} al GDO ${a.gdoId} non notificato`, e)
    }
}
