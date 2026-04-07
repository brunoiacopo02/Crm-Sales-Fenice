/**
 * Calculate the streak multiplier based on streak count.
 * Day 1-2 = x1, Day 3-6 = x1.5, Day 7-13 = x2, Day 14+ = x3
 */
export function getStreakMultiplier(streakCount: number): number {
    if (streakCount >= 14) return 3;
    if (streakCount >= 7) return 2;
    if (streakCount >= 3) return 1.5;
    return 1;
}

/**
 * Get a display label for the current multiplier tier.
 */
export function getStreakTierLabel(streakCount: number): string {
    if (streakCount >= 14) return 'x3 Inferno';
    if (streakCount >= 7) return 'x2 Fuoco';
    if (streakCount >= 3) return 'x1.5 Fiamma';
    return 'x1';
}

/**
 * Get the next multiplier milestone (days until next tier).
 */
export function getNextStreakMilestone(streakCount: number): { daysToNext: number; nextMultiplier: number } | null {
    if (streakCount >= 14) return null; // Already max
    if (streakCount >= 7) return { daysToNext: 14 - streakCount, nextMultiplier: 3 };
    if (streakCount >= 3) return { daysToNext: 7 - streakCount, nextMultiplier: 2 };
    return { daysToNext: 3 - streakCount, nextMultiplier: 1.5 };
}
