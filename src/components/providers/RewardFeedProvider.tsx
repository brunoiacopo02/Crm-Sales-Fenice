'use client';

import { useEffect, useState, useCallback } from 'react';
import { RewardPopup, getRandomMotivationalMessage } from '@/components/RewardPopup';
import type { RewardPopupData } from '@/components/RewardPopup';
import type { RewardEarnedDetail } from '@/lib/animationUtils';
import { playSound } from '@/lib/soundEngine';

const MAX_VISIBLE = 3;

export function RewardFeedProvider({ children }: { children?: React.ReactNode }) {
    const [queue, setQueue] = useState<RewardPopupData[]>([]);

    const handleRewardEarned = useCallback((e: Event) => {
        const detail = (e as CustomEvent<RewardEarnedDetail>).detail;
        if (!detail) return;

        // Sound: coin ding when coins earned, XP whoosh when XP earned (staggered 80ms)
        if (detail.coinsGained > 0) {
            playSound('coin_earned');
        }
        if (detail.xpGained > 0) {
            setTimeout(() => playSound('xp_gained'), detail.coinsGained > 0 ? 80 : 0);
        }

        // Level-up celebration is handled by CelebrationOverlay directly listening to reward_earned events

        const popup: RewardPopupData = {
            id: `reward-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            xpGained: detail.xpGained,
            coinsGained: detail.coinsGained,
            actionType: detail.actionType,
            didLevelUp: detail.didLevelUp,
            newLevel: detail.newLevel,
            message: getRandomMotivationalMessage(),
        };

        setQueue(prev => {
            const next = [...prev, popup];
            // Keep only the last MAX_VISIBLE + a small buffer for exit animations
            if (next.length > MAX_VISIBLE + 2) {
                return next.slice(-MAX_VISIBLE);
            }
            return next;
        });
    }, []);

    useEffect(() => {
        window.addEventListener('reward_earned', handleRewardEarned);
        return () => window.removeEventListener('reward_earned', handleRewardEarned);
    }, [handleRewardEarned]);

    const handleDismiss = useCallback((id: string) => {
        setQueue(prev => prev.filter(p => p.id !== id));
    }, []);

    const visiblePopups = queue.slice(-MAX_VISIBLE);

    return (
        <>
            {children}
            {visiblePopups.map((popup, i) => (
                <RewardPopup
                    key={popup.id}
                    data={popup}
                    onDismiss={handleDismiss}
                    index={i}
                />
            ))}
        </>
    );
}
