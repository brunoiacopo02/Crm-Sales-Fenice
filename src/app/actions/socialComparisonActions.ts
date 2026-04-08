"use server"

import { getLeaderboard, getConfermeLeaderboard, getVenditoriLeaderboard } from "./leaderboardActions"
import type { LeaderboardRole } from "./leaderboardActions"

export type SocialComparisonTier = 'gold' | 'silver' | 'bronze' | 'neutral'

export type SocialComparisonData = {
    rank: number
    totalActive: number
    percentile: number
    tier: SocialComparisonTier
    message: string
    aheadCount: number
}

export async function getSocialComparison(userId: string, role: LeaderboardRole): Promise<SocialComparisonData | null> {
    // Get today's leaderboard for the user's role
    let leaderboard: Array<{ userId: string; rank: number; appointmentCount?: number; metricValue?: number }>

    if (role === 'CONFERME') {
        leaderboard = await getConfermeLeaderboard('today')
    } else if (role === 'VENDITORE') {
        leaderboard = await getVenditoriLeaderboard('today')
    } else {
        leaderboard = await getLeaderboard('today')
    }

    if (leaderboard.length === 0) return null

    // Only count users with at least some activity OR all users if none have activity
    const activeUsers = leaderboard.filter(u => (u.appointmentCount ?? u.metricValue ?? 0) > 0)
    const totalActive = activeUsers.length > 0 ? activeUsers.length : leaderboard.length

    const userEntry = leaderboard.find(u => u.userId === userId)
    if (!userEntry) return null

    const rank = userEntry.rank
    const userScore = userEntry.appointmentCount ?? (userEntry as any).metricValue ?? 0

    // Percentile: "better than X% of colleagues"
    // If rank 1 out of 10 → better than 90%
    // If rank 5 out of 10 → better than 50%
    const percentile = leaderboard.length > 1
        ? Math.round(((leaderboard.length - rank) / (leaderboard.length - 1)) * 100)
        : 100

    // Tier based on position
    const positionPct = (rank / leaderboard.length) * 100
    let tier: SocialComparisonTier
    if (positionPct <= 10) tier = 'gold'
    else if (positionPct <= 25) tier = 'silver'
    else if (positionPct <= 50) tier = 'bronze'
    else tier = 'neutral'

    // If user has score and is rank 1, always gold
    if (rank === 1 && userScore > 0) tier = 'gold'

    // People ahead
    const aheadCount = rank - 1

    // Dynamic message
    const message = generateMessage(rank, percentile, aheadCount, leaderboard.length, userScore)

    return {
        rank,
        totalActive,
        percentile,
        tier,
        message,
        aheadCount,
    }
}

function generateMessage(rank: number, percentile: number, aheadCount: number, total: number, score: number): string {
    // Special cases first
    if (score === 0) {
        return 'Inizia la giornata per scalare la classifica!'
    }

    if (rank === 1) {
        return 'Sei il migliore oggi! 🔥'
    }

    if (aheadCount === 1) {
        return 'Solo 1 persona davanti a te!'
    }

    if (aheadCount <= 3) {
        return `Solo ${aheadCount} persone davanti a te!`
    }

    if (percentile >= 80) {
        return `Sei meglio del ${percentile}% dei tuoi colleghi!`
    }

    if (percentile >= 50) {
        return `Sei meglio del ${percentile}% dei tuoi colleghi!`
    }

    return `Stai salendo! Supera ${aheadCount} colleghi per il top!`
}
