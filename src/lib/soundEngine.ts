/**
 * Sound Engine for CRM Fenice — Web Audio API synthesized sounds.
 * All sounds are generated procedurally (no external audio files).
 * Respects user toggle via localStorage.
 */

const SOUND_STORAGE_KEY = 'crm-fenice-sounds';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        } catch {
            return null;
        }
    }
    // Resume if suspended (browsers require user gesture)
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    return audioCtx;
}

export function getSoundsEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(SOUND_STORAGE_KEY);
    // Sounds are OFF by default — user must opt in
    return stored === 'on';
}

export function setSoundsEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'on' : 'off');
}

export type SoundType =
    | 'coin_earned'
    | 'xp_gained'
    | 'level_up'
    | 'achievement'
    | 'quest_complete'
    | 'streak_maintained';

/**
 * Play a synthesized sound effect. No-op if sounds are disabled or AudioContext unavailable.
 */
export function playSound(type: SoundType): void {
    if (!getSoundsEnabled()) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    switch (type) {
        case 'coin_earned':
            playCoinDing(ctx);
            break;
        case 'xp_gained':
            playXpWhoosh(ctx);
            break;
        case 'level_up':
            playLevelUpFanfare(ctx);
            break;
        case 'achievement':
            playAchievementTriumph(ctx);
            break;
        case 'quest_complete':
            playQuestChime(ctx);
            break;
        case 'streak_maintained':
            playStreakBurst(ctx);
            break;
    }
}

// ─── Sound Definitions ───────────────────────────────────────────────

/** Short bright "ding" — coin pickup */
function playCoinDing(ctx: AudioContext) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(1800, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(1400, t + 0.15);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
}

/** Quick ascending sweep — XP gained */
function playXpWhoosh(ctx: AudioContext) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.15);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
}

/** Ascending 4-note fanfare — level up */
function playLevelUpFanfare(ctx: AudioContext) {
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const dur = 0.15;
    notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const start = t + i * dur;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
        gain.gain.setValueAtTime(0.2, start + dur * 0.6);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.2);
    });
}

/** Triumphant major chord — achievement unlocked */
function playAchievementTriumph(ctx: AudioContext) {
    const t = ctx.currentTime;
    const chord = [523.25, 659.25, 783.99]; // C5 major triad
    chord.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.05);
        gain.gain.setValueAtTime(0.15, t + 0.3);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.8);
    });
}

/** Pleasant ascending 3-note chime — quest complete */
function playQuestChime(ctx: AudioContext) {
    const t = ctx.currentTime;
    const notes = [659.25, 783.99, 1046.5]; // E5, G5, C6
    const dur = 0.12;
    notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const start = t + i * dur;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.25);
    });
}

/** Quick burst whoosh + shimmer — streak maintained */
function playStreakBurst(ctx: AudioContext) {
    const t = ctx.currentTime;
    // Low whoosh
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(200, t);
    osc1.frequency.exponentialRampToValueAtTime(600, t + 0.1);
    gain1.gain.setValueAtTime(0.08, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.2);
    // High shimmer
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1000, t + 0.05);
    osc2.frequency.exponentialRampToValueAtTime(1500, t + 0.15);
    gain2.gain.setValueAtTime(0.1, t + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(t + 0.05);
    osc2.stop(t + 0.3);
}
