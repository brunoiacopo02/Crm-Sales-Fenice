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
    | 'evolution_fanfare'
    | 'achievement'
    | 'quest_complete'
    | 'streak_maintained'
    | 'hot_streak_activate'
    | 'chest_drum_roll'
    | 'chest_reveal_common'
    | 'chest_reveal_rare'
    | 'chest_reveal_epic'
    | 'chest_reveal_legendary';

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
        case 'evolution_fanfare':
            playEvolutionFanfare(ctx);
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
        case 'hot_streak_activate':
            playHotStreakActivate(ctx);
            break;
        case 'chest_drum_roll':
            playChestDrumRoll(ctx);
            break;
        case 'chest_reveal_common':
            playChestRevealCommon(ctx);
            break;
        case 'chest_reveal_rare':
            playChestRevealRare(ctx);
            break;
        case 'chest_reveal_epic':
            playChestRevealEpic(ctx);
            break;
        case 'chest_reveal_legendary':
            playChestRevealLegendary(ctx);
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

/** Epic evolution fanfare — dramatic ascending sweep + sustained power chord + shimmer tail */
function playEvolutionFanfare(ctx: AudioContext) {
    const t = ctx.currentTime;
    // Phase 1: Low rumble build-up (0-0.4s)
    const rumble = ctx.createOscillator();
    const rumbleGain = ctx.createGain();
    rumble.type = 'sawtooth';
    rumble.frequency.setValueAtTime(80, t);
    rumble.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    rumbleGain.gain.setValueAtTime(0.06, t);
    rumbleGain.gain.linearRampToValueAtTime(0.12, t + 0.3);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    rumble.connect(rumbleGain).connect(ctx.destination);
    rumble.start(t);
    rumble.stop(t + 0.5);

    // Phase 2: Ascending arpeggio C4→E4→G4→C5→E5→G5→C6 (0.3-1.2s)
    const arp = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
    arp.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const start = t + 0.3 + i * 0.1;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12 + i * 0.01, start + 0.03);
        gain.gain.setValueAtTime(0.12 + i * 0.01, start + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.3);
    });

    // Phase 3: Sustained power chord C5+E5+G5+C6 (1.0-2.5s)
    const chord = [523.25, 659.25, 783.99, 1046.50];
    chord.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + 1.0);
        gain.gain.setValueAtTime(0, t + 1.0);
        gain.gain.linearRampToValueAtTime(0.12, t + 1.1);
        gain.gain.setValueAtTime(0.12, t + 1.6);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + 1.0);
        osc.stop(t + 2.5);
    });

    // Phase 4: High shimmer tail (2.0-3.0s)
    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(2093, t + 2.0); // C7
    shimmer.frequency.exponentialRampToValueAtTime(1567.98, t + 3.0); // G6
    shimmerGain.gain.setValueAtTime(0.04, t + 2.0);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, t + 3.0);
    shimmer.connect(shimmerGain).connect(ctx.destination);
    shimmer.start(t + 2.0);
    shimmer.stop(t + 3.0);
}

/** Quick flame burst — hot streak activated (200ms) */
function playHotStreakActivate(ctx: AudioContext) {
    const t = ctx.currentTime;
    // Low fire burst
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(150, t);
    osc1.frequency.exponentialRampToValueAtTime(500, t + 0.08);
    osc1.frequency.exponentialRampToValueAtTime(300, t + 0.2);
    gain1.gain.setValueAtTime(0.1, t);
    gain1.gain.linearRampToValueAtTime(0.15, t + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.2);
    // High crackle shimmer
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(800, t + 0.02);
    osc2.frequency.exponentialRampToValueAtTime(1600, t + 0.1);
    osc2.frequency.exponentialRampToValueAtTime(1200, t + 0.2);
    gain2.gain.setValueAtTime(0.03, t + 0.02);
    gain2.gain.linearRampToValueAtTime(0.06, t + 0.06);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(t + 0.02);
    osc2.stop(t + 0.2);
}

// ─── Chest/Loot Opening Sounds ──────────────────────────────────────

/** Crescendo drum roll — building suspense over 2s */
function playChestDrumRoll(ctx: AudioContext) {
    const t = ctx.currentTime;
    const hits = 24;
    for (let i = 0; i < hits; i++) {
        const progress = i / hits;
        const start = t + progress * 2;
        // Accelerating hits — gap shrinks as we go
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        // Pitch rises from low to medium
        osc.frequency.setValueAtTime(120 + progress * 200, start);
        osc.frequency.exponentialRampToValueAtTime(100 + progress * 150, start + 0.06);
        // Volume crescendo
        const vol = 0.03 + progress * 0.12;
        gain.gain.setValueAtTime(vol, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.08);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.08);
    }
    // Final snare-like hit at the end
    const noise = ctx.createOscillator();
    const noiseGain = ctx.createGain();
    noise.type = 'sawtooth';
    noise.frequency.setValueAtTime(300, t + 2);
    noise.frequency.exponentialRampToValueAtTime(150, t + 2.15);
    noiseGain.gain.setValueAtTime(0.15, t + 2);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    noise.connect(noiseGain).connect(ctx.destination);
    noise.start(t + 2);
    noise.stop(t + 2.2);
}

/** Muted thud — common reveal */
function playChestRevealCommon(ctx: AudioContext) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.2);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
}

/** Bright two-note chime — rare reveal */
function playChestRevealRare(ctx: AudioContext) {
    const t = ctx.currentTime;
    const notes = [523.25, 783.99]; // C5, G5
    notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const start = t + i * 0.12;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.2, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
    });
}

/** Dramatic rising chord — epic reveal */
function playChestRevealEpic(ctx: AudioContext) {
    const t = ctx.currentTime;
    // Rising sweep
    const sweep = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    sweep.type = 'sawtooth';
    sweep.frequency.setValueAtTime(200, t);
    sweep.frequency.exponentialRampToValueAtTime(800, t + 0.2);
    sweepGain.gain.setValueAtTime(0.06, t);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    sweep.connect(sweepGain).connect(ctx.destination);
    sweep.start(t);
    sweep.stop(t + 0.3);
    // Chord stab
    const chord = [523.25, 659.25, 783.99]; // C5 major
    chord.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t + 0.15);
        gain.gain.setValueAtTime(0, t + 0.15);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.2);
        gain.gain.setValueAtTime(0.18, t + 0.45);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + 0.15);
        osc.stop(t + 0.8);
    });
}

/** Full fanfare — legendary reveal: ascending arpeggio + sustained chord */
function playChestRevealLegendary(ctx: AudioContext) {
    const t = ctx.currentTime;
    // Impact whoosh
    const whoosh = ctx.createOscillator();
    const whooshGain = ctx.createGain();
    whoosh.type = 'sawtooth';
    whoosh.frequency.setValueAtTime(100, t);
    whoosh.frequency.exponentialRampToValueAtTime(1200, t + 0.15);
    whooshGain.gain.setValueAtTime(0.08, t);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    whoosh.connect(whooshGain).connect(ctx.destination);
    whoosh.start(t);
    whoosh.stop(t + 0.25);
    // Ascending arpeggio: C5 → E5 → G5 → C6
    const arp = [523.25, 659.25, 783.99, 1046.5];
    arp.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const start = t + 0.1 + i * 0.1;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.15, start + 0.03);
        gain.gain.setValueAtTime(0.15, start + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.3);
    });
    // Sustained golden chord at the end
    const sustain = [523.25, 659.25, 783.99, 1046.5];
    sustain.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + 0.5);
        gain.gain.setValueAtTime(0, t + 0.5);
        gain.gain.linearRampToValueAtTime(0.1, t + 0.55);
        gain.gain.setValueAtTime(0.1, t + 0.9);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + 0.5);
        osc.stop(t + 1.5);
    });
}
