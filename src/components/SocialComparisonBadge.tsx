'use client'

import { useEffect, useState, useCallback } from 'react'
import { Trophy, TrendingUp, Medal, Target } from 'lucide-react'
import { getSocialComparison } from '@/app/actions/socialComparisonActions'
import type { SocialComparisonData, SocialComparisonTier } from '@/app/actions/socialComparisonActions'
import { getAnimationsEnabled } from '@/lib/animationUtils'

const TIER_CONFIG: Record<SocialComparisonTier, {
    icon: typeof Trophy
    label: string
    bg: string
    border: string
    text: string
    glow: string
    iconColor: string
}> = {
    gold: {
        icon: Trophy,
        label: 'Top 10%',
        bg: 'bg-gradient-to-r from-gold-100 to-amber-50',
        border: 'border-gold-300',
        text: 'text-gold-700',
        glow: 'shadow-[0_0_12px_rgba(201,161,60,0.3)]',
        iconColor: 'text-gold-500',
    },
    silver: {
        icon: Medal,
        label: 'Top 25%',
        bg: 'bg-gradient-to-r from-gray-100 to-slate-50',
        border: 'border-gray-300',
        text: 'text-gray-700',
        glow: 'shadow-[0_0_8px_rgba(148,163,184,0.3)]',
        iconColor: 'text-gray-500',
    },
    bronze: {
        icon: TrendingUp,
        label: 'Top 50%',
        bg: 'bg-gradient-to-r from-orange-50 to-amber-50',
        border: 'border-orange-300',
        text: 'text-orange-700',
        glow: 'shadow-[0_0_8px_rgba(234,88,12,0.2)]',
        iconColor: 'text-orange-500',
    },
    neutral: {
        icon: Target,
        label: 'In salita',
        bg: 'bg-gradient-to-r from-ash-50 to-gray-50',
        border: 'border-ash-200',
        text: 'text-ash-600',
        glow: '',
        iconColor: 'text-ash-400',
    },
}

export function SocialComparisonBadge({ userId, role }: { userId: string; role: 'GDO' | 'CONFERME' | 'VENDITORE' }) {
    const [data, setData] = useState<SocialComparisonData | null>(null)
    const [loading, setLoading] = useState(true)

    const fetchData = useCallback(async () => {
        try {
            const result = await getSocialComparison(userId, role)
            setData(result)
        } catch {
            // silently fail
        } finally {
            setLoading(false)
        }
    }, [userId, role])

    useEffect(() => {
        fetchData()

        // Refresh every 30 seconds (sync with leaderboard)
        const interval = setInterval(fetchData, 30000)

        // Refresh on reward_earned event (immediate update)
        const handleReward = () => {
            setTimeout(fetchData, 2000) // small delay to let server process
        }
        window.addEventListener('reward_earned', handleReward)

        return () => {
            clearInterval(interval)
            window.removeEventListener('reward_earned', handleReward)
        }
    }, [fetchData])

    if (loading) {
        return (
            <div className="rounded-xl border border-ash-200 bg-ash-50 p-3 animate-pulse">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-ash-200" />
                    <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-20 bg-ash-200 rounded" />
                        <div className="h-2.5 w-32 bg-ash-200 rounded" />
                    </div>
                </div>
            </div>
        )
    }

    if (!data) return null

    const config = TIER_CONFIG[data.tier]
    const Icon = config.icon
    const animEnabled = getAnimationsEnabled()

    return (
        <div className={`rounded-xl border ${config.border} ${config.bg} ${config.glow} p-3 transition-all duration-300`}>
            <div className="flex items-center gap-2.5">
                {/* Tier icon */}
                <div
                    className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                        data.tier === 'gold' ? 'bg-gold-200/60' :
                        data.tier === 'silver' ? 'bg-gray-200/60' :
                        data.tier === 'bronze' ? 'bg-orange-200/60' :
                        'bg-ash-200/60'
                    }`}
                    style={animEnabled && data.tier === 'gold' ? { animation: 'social-comparison-glow 2s ease-in-out infinite' } : undefined}
                >
                    <Icon className={`w-5 h-5 ${config.iconColor}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <div className={`text-xs font-bold uppercase tracking-wider ${config.text}`}>
                            {config.label}
                        </div>
                        {data.rank <= 3 && data.percentile >= 50 && (
                            <div className="text-[9px] font-bold bg-brand-charcoal text-white px-1.5 py-0.5 rounded">
                                #{data.rank}
                            </div>
                        )}
                    </div>
                    <div className="text-[11px] text-ash-600 font-medium mt-0.5 truncate">
                        {data.message}
                    </div>
                </div>

                {/* Percentile badge */}
                {data.percentile > 0 && (
                    <div className={`flex-shrink-0 text-center ${config.text}`}>
                        <div className="text-lg font-black leading-none">{data.percentile}%</div>
                        <div className="text-[8px] uppercase font-bold tracking-wider opacity-70">meglio</div>
                    </div>
                )}
            </div>
        </div>
    )
}
