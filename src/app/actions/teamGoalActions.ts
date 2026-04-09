"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { teamGoals, leads, users, coinTransactions, notifications } from "@/db/schema"
import { eq, and, gte, lt, sql } from "drizzle-orm"
import crypto from "crypto"
import { differenceInDays } from "date-fns"
import { revalidatePath } from "next/cache"

export async function createTeamGoal(data: {
    title: string,
    targetCount: number,
    deadline: Date,
    rewardCoins: number,
    goalType: 'database' | 'generico'
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== 'MANAGER' && session.user.role !== 'ADMIN')) {
        throw new Error("Unauthorized")
    }

    await db.insert(teamGoals).values({
            id: crypto.randomUUID(),
            title: data.title,
            targetCount: data.targetCount,
            deadline: data.deadline,
            rewardCoins: data.rewardCoins,
            goalType: data.goalType,
            status: 'active',
            createdAt: new Date()
        })

    revalidatePath("/team")
}

export async function getActiveTeamGoals() {
    return await db.select().from(teamGoals).where(eq(teamGoals.status, 'active'))
}

export async function getAllTeamGoals() {
    return await db.select().from(teamGoals)
}

export async function deleteTeamGoal(goalId: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== 'MANAGER' && session.user.role !== 'ADMIN')) {
        throw new Error("Unauthorized")
    }

    await db.delete(teamGoals).where(eq(teamGoals.id, goalId))
    revalidatePath("/team")
}

export async function evaluateTeamGoals(leadId: string) {
    const activeGoals = await getActiveTeamGoals()

    if (activeGoals.length === 0) return

    const lead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
    if (!lead) return

    const now = new Date()
    const funnelLower = lead.funnel?.trim().toLowerCase() || ''

    // Avvia la valutazione per ogni obiettivo attivo
    for (const goal of activeGoals) {
        let qualifies = false

        if (goal.goalType === 'database') {
            // Conta solo se la provenienza è ESATTAMENTE "Database" (case-insensitive)
            qualifies = funnelLower === 'database'
        } else if (goal.goalType === 'generico') {
            // Generico: tutti i lead vengono contati
            qualifies = true
        }

        if (!qualifies) continue

        goal.currentCount += 1

        const isCompleted = goal.currentCount >= goal.targetCount

        await db.update(teamGoals)
                    .set({
                        currentCount: goal.currentCount,
                        status: isCompleted ? 'completed' : 'active'
                    })
                    .where(eq(teamGoals.id, goal.id))
            

        if (isCompleted) {
            // Premiazione Corale!
            // Trova tutti i GDO attivi
            // Trova tutti i GDO attivi (risolve grattacapi con i boolean di SQLite)
            const allGdos = await db.select().from(users).where(eq(users.role, 'GDO'))
            const activeGdos = allGdos.filter(g => g.isActive === true || (g.isActive as any) === 1)

            for (const gdo of activeGdos) {
                // Accredita Coin
                await db.update(users)
                                    .set({ walletCoins: sql`${users.walletCoins} + ${goal.rewardCoins}` })
                                    .where(eq(users.id, gdo.id))
                    

                await db.insert(coinTransactions).values({
                                    id: crypto.randomUUID(),
                                    userId: gdo.id,
                                    amount: goal.rewardCoins,
                                    reason: 'TEAM_GOAL_WON',
                                    createdAt: now
                                })

                // Notifica
                await db.insert(notifications).values({
                                    id: crypto.randomUUID(),
                                    recipientUserId: gdo.id,
                                    type: 'team_goal_won',
                                    title: 'Obiettivo di Squadra Completato! 🚀',
                                    body: `Il team ha completato l'obiettivo "${goal.title}" e hai ricevuto ${goal.rewardCoins} Fenice Coin nel tuo wallet!`,
                                    metadata: { goalId: goal.id },
                                    status: 'unread',
                                    createdAt: now
                                })
            }
        }
    }
}
