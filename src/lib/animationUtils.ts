/**
 * Animation utilities for CRM Fenice celebration system.
 * Uses localStorage for persistence, respects OS prefers-reduced-motion.
 */

const STORAGE_KEY = 'crm-fenice-animations';

export function getAnimationsEnabled(): boolean {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'off') return false;
    try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch { /* SSR or unsupported */ }
    return true;
}

export function setAnimationsEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
}

export function triggerCelebration(type: 'fire' | 'confetti'): void {
    if (typeof window === 'undefined') return;
    if (!getAnimationsEnabled()) return;
    window.dispatchEvent(new CustomEvent('celebration', { detail: { type } }));
}

export interface RewardEarnedDetail {
    xpGained: number;
    coinsGained: number;
    actionType: string;
    didLevelUp: boolean;
    newLevel?: number;
}

export function emitRewardEarned(data: RewardEarnedDetail): void {
    if (typeof window === 'undefined') return;
    if (!getAnimationsEnabled()) return;
    window.dispatchEvent(new CustomEvent('reward_earned', { detail: data }));
}

// --- Social Notification System (SA-004) ---

export type SocialNotificationType =
    | 'rank_overtaken'
    | 'rare_achievement'
    | 'boss_battle_ending'
    | 'seasonal_event';

export interface SocialNotificationDetail {
    type: SocialNotificationType;
    title: string;
    message: string;
    ctaLabel?: string;
    ctaHref?: string;
    actorName?: string; // who triggered it (e.g., "Marco" unlocked a badge)
}

export function emitSocialNotification(data: SocialNotificationDetail): void {
    if (typeof window === 'undefined') return;
    if (!getAnimationsEnabled()) return;
    window.dispatchEvent(new CustomEvent('social_notification', { detail: data }));
}
