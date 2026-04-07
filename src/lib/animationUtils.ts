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
