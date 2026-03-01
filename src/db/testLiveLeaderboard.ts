import { db } from "./index"
import { leads, users, notifications } from "./schema"
import { eq, or } from "drizzle-orm"
import crypto from "crypto"
import { checkLeaderboardOvertake } from "@/app/actions/leaderboardActions"

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function runLiveTest() {
    console.log("🏁 Inizio Setup del Test Classifica Live...")

    // 1. Recupera gli utenti GDO 113 e GDO 114
    const gdo113 = (await db.select().from(users).where(eq(users.email, "gdo113@fenice.local")))[0]
    const gdo114 = (await db.select().from(users).where(eq(users.email, "gdo114@fenice.local")))[0]

    if (!gdo113 || !gdo114) {
        console.error("Utenti di test non trovati! Assicurati di aver generato i GDO.")
        return
    }

    // 2. Pulizia DB da test precedenti
    console.log("🧹 Pulisco vecchi dati di test dalla classifica...")
    await db.delete(leads).where(eq(leads.funnel, 'TestLeaderboard'))
    await db.delete(notifications).where(or(eq(notifications.recipientUserId, gdo113.id), eq(notifications.recipientUserId, gdo114.id)))

    const now = new Date()

    // 3. Iniezione Baseline (GDO 114 = 5 Appuntamenti, GDO 113 = 4 Appuntamenti)
    console.log(`\n🎯 Setto Baseline Appuntamenti:`)
    console.log(`   - GDO 114 (Leader): 5 Appuntamenti`)
    console.log(`   - GDO 113 (Secondo): 4 Appuntamenti`)

    for (let i = 0; i < 5; i++) {
        await db.insert(leads).values({
                    id: crypto.randomUUID(),
                    name: `Target 114 ${i}`,
                    phone: `33311400${i}`,
                    funnel: 'TestLeaderboard',
                    status: 'APPOINTMENT',
                    assignedToId: gdo114.id,
                    appointmentCreatedAt: new Date(now.getTime() - (1000 * 60 * 60 * (5 - i))), // Finiti ore fa
                    createdAt: now,
                    updatedAt: now
                })
    }

    for (let i = 0; i < 4; i++) {
        await db.insert(leads).values({
                    id: crypto.randomUUID(),
                    name: `Target 113 ${i}`,
                    phone: `33311300${i}`,
                    funnel: 'TestLeaderboard',
                    status: 'APPOINTMENT',
                    assignedToId: gdo113.id,
                    appointmentCreatedAt: new Date(now.getTime() - (1000 * 60 * 60 * (4 - i))),
                    createdAt: now,
                    updatedAt: now
                })
    }

    console.log(`\n✅ SETUP COMPLETATO!`)
    console.log(`ISTRUZIONI PER IL TESTER:`)
    console.log(`1. Fai Login come GDO 114 (gdo114@fenice.local / Fenice2026!)`)
    console.log(`2. Vai nella pagina "Classifica". (Vedrai che sei Primo con 5 appt)`)
    console.log(`3. NON toccare il menù e GUARDA LO SCHERMO!`)
    console.log(`\n⏳ Pausa di 20 secondi. Vai sulla schermata adesso...`)

    try {
        console.log(`\n⏳ Attesa di 20 secondi in corso (il browser deve loggarsi)...`)
        await delay(20000)

        console.log(`🚀 Azione in corso! GDO 113 ottiene 2 nuovi appuntamenti...`)

        for (let i = 4; i < 6; i++) {
            await db.insert(leads).values({
                            id: crypto.randomUUID(),
                            name: `Target 113 Sorpasso ${i}`,
                            phone: `33311300${i}`,
                            funnel: 'TestLeaderboard',
                            status: 'APPOINTMENT',
                            assignedToId: gdo113.id,
                            appointmentCreatedAt: new Date(), // Adesso!
                            createdAt: new Date(),
                            updatedAt: new Date()
                        })
        }

        console.log(`Trigger ricalcolo sorpasso...`)
        // Trigger esplicito del ricalcolo e notifica (come in updateLeadOutcome)
        await checkLeaderboardOvertake(gdo113.id)

        console.log(`\n🎉 BOOM! Sorpasso eseguito sotto al tuo naso!`)
        console.log(`Se l'utente è sulla leaderboard, vedrà il Toast a breve.`)
    } catch (error: any) {
        console.error("\n❌ ERRORE END-TO-END SCRIPT:", error.message)
    }

    process.exit(0)
}

runLiveTest()
