import { db } from "../src/db"
import { teamGoals, leads, users } from "../src/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"
import { subDays } from "date-fns"
import { evaluateTeamGoals } from "../src/app/actions/teamGoalActions"

async function runTest() {
    console.log("--- Starting Team Goal Types Verification ---")

    // 1. Create a Database Goal
    const dbGoalId = crypto.randomUUID()
    await db.insert(teamGoals).values({
            id: dbGoalId,
            title: "Test Goal Database",
            targetCount: 1,
            currentCount: 0,
            deadline: new Date(Date.now() + 86400000), // Tomorrow
            rewardCoins: 5,
            goalType: 'database',
            status: 'active',
            createdAt: new Date()
        })

    // 2. Create a Generico Goal
    const genGoalId = crypto.randomUUID()
    await db.insert(teamGoals).values({
            id: genGoalId,
            title: "Test Goal Generico",
            targetCount: 2,
            currentCount: 0,
            deadline: new Date(Date.now() + 86400000), // Tomorrow
            rewardCoins: 10,
            goalType: 'generico',
            status: 'active',
            createdAt: new Date()
        })

    console.log("Created 1 Database Goal (Target: 1) and 1 Generico Goal (Target: 2)")

    // Get an active GDO to act as the user
    const gdo = (await db.select().from(users).where(eq(users.role, 'GDO')))[0]
    if (!gdo) throw new Error("No GDO found for testing")

    // Record initial coins
    const initialCoins = gdo.walletCoins

    // 3. Create a lead with non-database funnel (e.g. Facebook)
    const fbLeadId = crypto.randomUUID()
    await db.insert(leads).values({
            id: fbLeadId,
            name: "Facebook Lead",
            phone: "+3900" + Date.now().toString().slice(-8),
            funnel: "Facebook Ads",
            status: 'IN_PROGRESS',
            createdAt: new Date(),
            updatedAt: new Date()
        })

    console.log("Booking Facebook lead...")
    await evaluateTeamGoals(fbLeadId)

    let dbGoalState = (await db.select().from(teamGoals).where(eq(teamGoals.id, dbGoalId)))[0]
    let genGoalState = (await db.select().from(teamGoals).where(eq(teamGoals.id, genGoalId)))[0]

    console.log(`[After FB Lead] Database Goal Count: ${dbGoalState?.currentCount} (Expected: 0)`)
    console.log(`[After FB Lead] Generico Goal Count: ${genGoalState?.currentCount} (Expected: 1)`)

    // 4. Create a lead with "database" funnel
    const dbLeadId = crypto.randomUUID()
    await db.insert(leads).values({
            id: dbLeadId,
            name: "Database Lead Test",
            phone: "+3901" + Date.now().toString().slice(-8),
            funnel: " DATABASE ", // test trimming and case
            status: 'IN_PROGRESS',
            createdAt: new Date(),
            updatedAt: new Date()
        })

    console.log("Booking Database lead...")
    await evaluateTeamGoals(dbLeadId)

    dbGoalState = (await db.select().from(teamGoals).where(eq(teamGoals.id, dbGoalId)))[0]
    genGoalState = (await db.select().from(teamGoals).where(eq(teamGoals.id, genGoalId)))[0]

    console.log(`[After DB Lead] Database Goal Count/Status: ${dbGoalState?.currentCount}/${dbGoalState?.status} (Expected: 1/completed)`)
    console.log(`[After DB Lead] Generico Goal Count/Status: ${genGoalState?.currentCount}/${genGoalState?.status} (Expected: 2/completed)`)

    const gdoAfter = (await db.select().from(users).where(eq(users.id, gdo.id)))[0]
    console.log(`Coins before: ${initialCoins}, Coins after: ${gdoAfter?.walletCoins} (Expected: +15)`)

    // Cleanup
    await db.delete(teamGoals).where(eq(teamGoals.id, dbGoalId))
    await db.delete(teamGoals).where(eq(teamGoals.id, genGoalId))
    await db.delete(leads).where(eq(leads.id, fbLeadId))
    await db.delete(leads).where(eq(leads.id, dbLeadId))

    console.log("--- Cleanup Done ---")
}

runTest().catch(console.error)
