import { db } from "./index"
import { leads, users, callLogs } from "./schema"
import { eq, or } from "drizzle-orm"
import crypto from "crypto"
import { subDays } from "date-fns"

async function setupFourthCallTest() {
    console.log("Inizio preparazione test Quarta Chiamata per GDO 113...")

    // 1. Trova l'utente GDO 113
    const user = (await db.select().from(users).where(eq(users.email, "gdo113@fenice.local")))[0]
    if (!user) {
        console.error("Errore: Utente gdo113@fenice.local non trovato!")
        return
    }

    console.log(`Trovato utente ${user.name} (${user.id}). Pulisco i vecchi logs...`)

    // 2. Elimina i vecchi log e lead di test se presenti
    await db.delete(callLogs).where(eq(callLogs.userId, user.id))
    await db.delete(leads).where(or(eq(leads.funnel, 'TestFourthCall'), eq(leads.funnel, 'TestTarget')))

    const now = new Date()
    const fiveDaysAgo = subDays(now, 5)

    console.log("Generazione di 10 lead passati per abbassare il tasso di fissaggio al 10% (< 14%)...")

    // 3. Crea 10 lead chiamati negli ultimi 7 giorni (1 Appuntamento, 9 Non Risposto)
    for (let i = 1; i <= 10; i++) {
        const leadId = crypto.randomUUID()
        const outcome = i === 1 ? 'APPUNTAMENTO' : 'NON_RISPOSTO'
        await db.insert(leads).values({
                    id: leadId,
                    name: `Contatto Base ${i}`,
                    phone: `33300000${i.toString().padStart(2, '0')}`,
                    funnel: 'TestTarget',
                    status: outcome === 'APPUNTAMENTO' ? 'APPOINTMENT' : 'IN_PROGRESS',
                    callCount: 1,
                    assignedToId: user.id,
                    createdAt: fiveDaysAgo,
                    updatedAt: fiveDaysAgo
                })

        await db.insert(callLogs).values({
                    id: crypto.randomUUID(),
                    leadId: leadId,
                    userId: user.id,
                    outcome: outcome,
                    note: 'Chiamata di test statistica',
                    createdAt: fiveDaysAgo
                })
    }

    console.log("Generazione di 3 Lead 'Recuperabili' (Scartati al 3° tentativo per irreperibilità)...")

    // 4. Crea 3 Lead Scartati idonei per la Quarta Chiamata
    for (let i = 1; i <= 3; i++) {
        const leadId = crypto.randomUUID()
        await db.insert(leads).values({
                    id: leadId,
                    name: `Recupero ${i}`,
                    phone: `33399900${i.toString().padStart(2, '0')}`,
                    email: `recupero${i}@test.com`,
                    funnel: 'TestFourthCall',
                    status: 'REJECTED',
                    callCount: 3,
                    discardReason: "irriperebile (3 tentativi vuoti)",
                    assignedToId: user.id,
                    createdAt: fiveDaysAgo,
                    updatedAt: now // Appena aggiornati
                })
    }

    console.log(`\n✅ SET-UP COMPLETATO!`)
    console.log(`L'account gdo113 ha ora un tasso di fissaggio del 10% (1 appuntamento su 10 contattati).`)
    console.log(`Sono stati creati 3 lead "irriperebile (3 tentativi vuoti)" pronti per il recupero.`)
    console.log(`\nISTRUZIONI TEST:`)
    console.log(`1. Fai logout e accedi come: gdo113@fenice.local / Fenice2026!`)
    console.log(`2. Vai in "Pipeline Chiamate".`)
    console.log(`3. Controlla se compare in basso la sezione "Quarta Chiamata (Recupero)".`)
    console.log(`4. Verifica che i 3 lead "Recupero" siano al suo interno e provane uno.`)
}

setupFourthCallTest()
