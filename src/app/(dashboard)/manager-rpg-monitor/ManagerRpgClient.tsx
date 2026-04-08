'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateGdoBaseSalary, addGdoCoins } from '@/app/actions/managerRpgActions';
import { createBossBattle } from '@/app/actions/bossBattleActions';
import { createSeasonalEvent, deactivateSeasonalEvent } from '@/app/actions/seasonalEventActions';
import {
    Gamepad2, Coins, TrendingUp, Eye, CheckCircle, Flame,
    Swords, Sparkles, Users, Target, Trophy, Calendar,
    Shield, Zap, Crown, ChevronDown, ChevronUp, X
} from 'lucide-react';
import Link from 'next/link';

// Inline constants to avoid importing gamificationEngine (which imports db/server modules)
const BOSS_DEFAULTS = { HP: 500, COINS: 100, XP: 200 };
const EVENT_THEMES = ['spring', 'summer', 'halloween', 'christmas', 'custom'] as const;
const EVENT_DEFAULTS = { XP_MULT: 1.5, COINS_MULT: 2 };
const THEME_CONFIG: Record<string, { label: string }> = {
    spring: { label: 'Primavera' },
    summer: { label: 'Estate' },
    halloween: { label: 'Halloween' },
    christmas: { label: 'Natale' },
    custom: { label: 'Evento Speciale' },
};

interface TeamOverview {
    totalQuestsToday: number;
    avgStreak: number;
    mostActiveUser: { name: string; questsToday: number; role: string } | null;
    teamSize: number;
    userQuestsToday: Record<string, number>;
}

interface ActiveBossBattle {
    id: string;
    title: string;
    totalHp: number;
    currentHp: number;
    rewardCoins: number;
    rewardXp: number;
    endTime: Date;
    topContributors: { userId: string; name: string; totalDamage: number }[];
    totalContributors: number;
}

interface ActiveEvent {
    id: string;
    title: string;
    theme: string;
    xpMultiplier: number;
    coinsMultiplier: number;
    endDate: Date;
}

interface Props {
    initialProfiles: any[];
    teamOverview: TeamOverview;
    managerId: string;
    activeBoss: ActiveBossBattle | null;
    activeEvent: ActiveEvent | null;
}

type DialogAction = 'salary' | 'coins' | 'boss' | 'event';

export default function ManagerRpgClient({ initialProfiles, teamOverview, managerId, activeBoss, activeEvent }: Props) {
    const router = useRouter();
    const [isProcessing, setIsProcessing] = useState(false);
    const [activeDialog, setActiveDialog] = useState<DialogAction | null>(null);

    // Salary/coins dialog
    const [dialogTarget, setDialogTarget] = useState<{ userId: string; name: string; currentValue: number } | null>(null);
    const [inputValue, setInputValue] = useState(0);

    // Boss battle form
    const [bossForm, setBossForm] = useState({
        title: '',
        description: '',
        totalHp: BOSS_DEFAULTS.HP,
        rewardCoins: BOSS_DEFAULTS.COINS,
        rewardXp: BOSS_DEFAULTS.XP,
        endTime: '',
    });

    // Seasonal event form
    const [eventForm, setEventForm] = useState({
        title: '',
        description: '',
        theme: 'custom' as string,
        xpMultiplier: EVENT_DEFAULTS.XP_MULT,
        coinsMultiplier: EVENT_DEFAULTS.COINS_MULT,
        startDate: '',
        endDate: '',
    });

    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
    const [expandedSection, setExpandedSection] = useState<'boss' | 'event' | null>(null);

    const openSalaryCoins = (userId: string, name: string, action: 'salary' | 'coins', currentValue: number) => {
        setDialogTarget({ userId, name, currentValue });
        setInputValue(action === 'salary' ? currentValue : 0);
        setActiveDialog(action);
    };

    const handleSaveSalaryCoins = async () => {
        if (!dialogTarget || !activeDialog) return;
        setIsProcessing(true);
        try {
            if (activeDialog === 'salary') {
                await updateGdoBaseSalary(dialogTarget.userId, inputValue);
            } else if (activeDialog === 'coins') {
                await addGdoCoins(dialogTarget.userId, inputValue);
            }
            setActiveDialog(null);
            setDialogTarget(null);
            router.refresh();
        } catch (e) {
            console.error(e);
            setFeedback({ type: 'error', msg: 'Errore durante il salvataggio.' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCreateBoss = async () => {
        if (!bossForm.title || !bossForm.endTime) {
            setFeedback({ type: 'error', msg: 'Compila titolo e data fine.' });
            return;
        }
        setIsProcessing(true);
        try {
            const result = await createBossBattle({
                title: bossForm.title,
                description: bossForm.description || `Boss Battle: ${bossForm.title}`,
                totalHp: bossForm.totalHp,
                rewardCoins: bossForm.rewardCoins,
                rewardXp: bossForm.rewardXp,
                startTime: new Date(),
                endTime: new Date(bossForm.endTime),
                createdBy: managerId,
            });
            if (result.success) {
                setFeedback({ type: 'success', msg: 'Boss Battle creata!' });
                setBossForm({ title: '', description: '', totalHp: 500, rewardCoins: 100, rewardXp: 200, endTime: '' });
                setExpandedSection(null);
                router.refresh();
            } else {
                setFeedback({ type: 'error', msg: result.error || 'Errore creazione boss.' });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: 'Errore creazione boss battle.' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCreateEvent = async () => {
        if (!eventForm.title || !eventForm.startDate || !eventForm.endDate) {
            setFeedback({ type: 'error', msg: 'Compila titolo, data inizio e fine.' });
            return;
        }
        setIsProcessing(true);
        try {
            const result = await createSeasonalEvent({
                title: eventForm.title,
                description: eventForm.description || `Evento: ${eventForm.title}`,
                theme: eventForm.theme,
                startDate: eventForm.startDate,
                endDate: eventForm.endDate,
                xpMultiplier: eventForm.xpMultiplier,
                coinsMultiplier: eventForm.coinsMultiplier,
                createdBy: managerId,
            });
            if (result.success) {
                setFeedback({ type: 'success', msg: 'Evento Stagionale creato!' });
                setEventForm({ title: '', description: '', theme: 'custom', xpMultiplier: 1.5, coinsMultiplier: 2, startDate: '', endDate: '' });
                setExpandedSection(null);
                router.refresh();
            } else {
                setFeedback({ type: 'error', msg: result.error || 'Errore creazione evento.' });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: 'Errore creazione evento stagionale.' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDeactivateEvent = async (eventId: string) => {
        setIsProcessing(true);
        try {
            await deactivateSeasonalEvent(eventId);
            setFeedback({ type: 'success', msg: 'Evento disattivato.' });
            router.refresh();
        } catch {
            setFeedback({ type: 'error', msg: 'Errore disattivazione evento.' });
        } finally {
            setIsProcessing(false);
        }
    };

    const themeConfig = THEME_CONFIG;

    return (
        <div className="flex-1 space-y-6 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full animate-fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-ash-200/60 pb-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-ash-800 flex items-center gap-3">
                        <Gamepad2 className="h-8 w-8 text-brand-orange" />
                        Cruscotto Gamification Team
                    </h2>
                    <div className="text-ash-500 mt-1">
                        Supervisione completa: Livelli, XP, Coins, Streak, Quest, Boss Battle e Eventi Stagionali
                    </div>
                </div>
            </div>

            {/* Feedback toast */}
            {feedback && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold border animate-fade-in ${feedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-red-50 text-red-700 border-red-200'
                    }`}>
                    {feedback.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <X className="w-4 h-4" />}
                    {feedback.msg}
                    <button onClick={() => setFeedback(null)} className="ml-auto p-1 hover:opacity-70"><X className="w-3 h-3" /></button>
                </div>
            )}

            {/* ===== TEAM OVERVIEW CARDS ===== */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Team Size */}
                <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 p-4">
                    <div className="flex items-center gap-2 text-ash-500 text-xs font-semibold uppercase tracking-wide mb-2">
                        <Users className="w-4 h-4" /> Team Attivo
                    </div>
                    <div className="text-2xl font-bold text-ash-800">{teamOverview.teamSize}</div>
                    <div className="text-xs text-ash-400 mt-1">GDO + Conferme</div>
                </div>

                {/* Quests Today */}
                <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 p-4">
                    <div className="flex items-center gap-2 text-ash-500 text-xs font-semibold uppercase tracking-wide mb-2">
                        <Target className="w-4 h-4 text-brand-orange" /> Quest Completate Oggi
                    </div>
                    <div className="text-2xl font-bold text-brand-orange">{teamOverview.totalQuestsToday}</div>
                    <div className="text-xs text-ash-400 mt-1">totale team</div>
                </div>

                {/* Avg Streak */}
                <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 p-4">
                    <div className="flex items-center gap-2 text-ash-500 text-xs font-semibold uppercase tracking-wide mb-2">
                        <Flame className="w-4 h-4 text-fire-500" /> Media Streak
                    </div>
                    <div className="text-2xl font-bold text-fire-500">{teamOverview.avgStreak} gg</div>
                    <div className="text-xs text-ash-400 mt-1">giorni consecutivi</div>
                </div>

                {/* Most Active */}
                <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 p-4">
                    <div className="flex items-center gap-2 text-ash-500 text-xs font-semibold uppercase tracking-wide mb-2">
                        <Trophy className="w-4 h-4 text-gaming-gold" /> Piu' Attivo Oggi
                    </div>
                    {teamOverview.mostActiveUser ? (
                        <div>
                            <div className="text-lg font-bold text-ash-800 truncate">{teamOverview.mostActiveUser.name}</div>
                            <div className="text-xs text-ash-400 mt-1">{teamOverview.mostActiveUser.questsToday} quest &middot; {teamOverview.mostActiveUser.role}</div>
                        </div>
                    ) : (
                        <div className="text-sm text-ash-400">Nessuna attivita'</div>
                    )}
                </div>
            </div>

            {/* ===== BOSS BATTLE & SEASONAL EVENT CONTROLS ===== */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Boss Battle Section */}
                <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 overflow-hidden">
                    <div
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-ash-50 transition-colors"
                        onClick={() => setExpandedSection(expandedSection === 'boss' ? null : 'boss')}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-soft">
                                <Swords className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <div className="font-bold text-ash-800">Boss Battle</div>
                                <div className="text-xs text-ash-400">
                                    {activeBoss
                                        ? `Attiva: ${activeBoss.title} (HP ${activeBoss.currentHp}/${activeBoss.totalHp})`
                                        : 'Nessuna boss battle attiva'
                                    }
                                </div>
                            </div>
                        </div>
                        {expandedSection === 'boss' ? <ChevronUp className="w-5 h-5 text-ash-400" /> : <ChevronDown className="w-5 h-5 text-ash-400" />}
                    </div>

                    {expandedSection === 'boss' && (
                        <div className="border-t border-ash-200/60 p-4 space-y-4 animate-fade-in">
                            {activeBoss ? (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="font-bold text-ash-800">{activeBoss.title}</div>
                                        <div className="text-xs text-ash-400">
                                            Scade: {new Date(activeBoss.endTime).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
                                        </div>
                                    </div>
                                    {/* HP Bar */}
                                    <div>
                                        <div className="flex justify-between text-xs text-ash-500 mb-1">
                                            <span>HP</span>
                                            <span>{activeBoss.currentHp} / {activeBoss.totalHp}</span>
                                        </div>
                                        <div className="w-full h-3 bg-ash-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{
                                                    width: `${(activeBoss.currentHp / activeBoss.totalHp) * 100}%`,
                                                    background: activeBoss.currentHp / activeBoss.totalHp > 0.5
                                                        ? 'linear-gradient(to right, #ef4444, #f97316)'
                                                        : activeBoss.currentHp / activeBoss.totalHp > 0.25
                                                            ? 'linear-gradient(to right, #f97316, #eab308)'
                                                            : 'linear-gradient(to right, #22c55e, #10b981)',
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-4 text-xs text-ash-500">
                                        <span>Reward: {activeBoss.rewardCoins} coins + {activeBoss.rewardXp} XP</span>
                                        <span>{activeBoss.totalContributors} contributori</span>
                                    </div>
                                    {activeBoss.topContributors.length > 0 && (
                                        <div className="space-y-1">
                                            <div className="text-xs font-semibold text-ash-500 uppercase">Top Contributori</div>
                                            {activeBoss.topContributors.map((c, i) => (
                                                <div key={c.userId} className="flex items-center justify-between text-xs">
                                                    <span className="text-ash-700">{i + 1}. {c.name}</span>
                                                    <span className="text-ash-500 font-mono">{c.totalDamage} DMG</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="text-sm text-ash-500">Lancia una nuova Boss Battle per il team!</div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="col-span-2">
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Titolo Boss</label>
                                            <input
                                                type="text"
                                                className="w-full border-2 border-ash-200 focus:border-red-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                placeholder="es. Drago Infernale"
                                                value={bossForm.title}
                                                onChange={e => setBossForm(f => ({ ...f, title: e.target.value }))}
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Descrizione</label>
                                            <input
                                                type="text"
                                                className="w-full border-2 border-ash-200 focus:border-red-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                placeholder="Obiettivo di squadra..."
                                                value={bossForm.description}
                                                onChange={e => setBossForm(f => ({ ...f, description: e.target.value }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">HP Totali</label>
                                            <input
                                                type="number"
                                                className="w-full border-2 border-ash-200 focus:border-red-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                value={bossForm.totalHp}
                                                onChange={e => setBossForm(f => ({ ...f, totalHp: Number(e.target.value) }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Scadenza</label>
                                            <input
                                                type="datetime-local"
                                                className="w-full border-2 border-ash-200 focus:border-red-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                value={bossForm.endTime}
                                                onChange={e => setBossForm(f => ({ ...f, endTime: e.target.value }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Reward Coins</label>
                                            <input
                                                type="number"
                                                className="w-full border-2 border-ash-200 focus:border-red-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                value={bossForm.rewardCoins}
                                                onChange={e => setBossForm(f => ({ ...f, rewardCoins: Number(e.target.value) }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Reward XP</label>
                                            <input
                                                type="number"
                                                className="w-full border-2 border-ash-200 focus:border-red-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                value={bossForm.rewardXp}
                                                onChange={e => setBossForm(f => ({ ...f, rewardXp: Number(e.target.value) }))}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleCreateBoss}
                                        disabled={isProcessing}
                                        className="w-full py-2.5 px-4 bg-gradient-to-r from-red-500 to-red-700 text-white font-bold rounded-lg shadow-card hover:from-red-600 hover:to-red-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        <Swords className="w-4 h-4" />
                                        {isProcessing ? 'Creazione...' : 'Lancia Boss Battle'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Seasonal Event Section */}
                <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 overflow-hidden">
                    <div
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-ash-50 transition-colors"
                        onClick={() => setExpandedSection(expandedSection === 'event' ? null : 'event')}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-soft">
                                <Sparkles className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <div className="font-bold text-ash-800">Evento Stagionale</div>
                                <div className="text-xs text-ash-400">
                                    {activeEvent
                                        ? `Attivo: ${activeEvent.title} (x${activeEvent.xpMultiplier} XP, x${activeEvent.coinsMultiplier} Coins)`
                                        : 'Nessun evento attivo'
                                    }
                                </div>
                            </div>
                        </div>
                        {expandedSection === 'event' ? <ChevronUp className="w-5 h-5 text-ash-400" /> : <ChevronDown className="w-5 h-5 text-ash-400" />}
                    </div>

                    {expandedSection === 'event' && (
                        <div className="border-t border-ash-200/60 p-4 space-y-4 animate-fade-in">
                            {activeEvent ? (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="font-bold text-ash-800">{activeEvent.title}</div>
                                        <div className="text-xs text-ash-400">
                                            Fino al: {new Date(activeEvent.endDate).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-xs font-bold text-purple-700">
                                            x{activeEvent.xpMultiplier} XP
                                        </div>
                                        <div className="px-3 py-1.5 bg-gaming-gold/10 border border-gaming-gold/30 rounded-lg text-xs font-bold text-gaming-gold">
                                            x{activeEvent.coinsMultiplier} Coins
                                        </div>
                                        <div className="px-3 py-1.5 bg-ash-50 border border-ash-200 rounded-lg text-xs text-ash-600">
                                            {themeConfig[activeEvent.theme]?.label || activeEvent.theme}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDeactivateEvent(activeEvent.id)}
                                        disabled={isProcessing}
                                        className="px-4 py-2 bg-red-50 border border-red-200 text-red-700 font-semibold rounded-lg text-sm hover:bg-red-100 transition-all disabled:opacity-50"
                                    >
                                        Disattiva Evento
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="text-sm text-ash-500">Crea un evento con moltiplicatori XP e Coins!</div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="col-span-2">
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Titolo Evento</label>
                                            <input
                                                type="text"
                                                className="w-full border-2 border-ash-200 focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                placeholder="es. Settimana del Fuoco"
                                                value={eventForm.title}
                                                onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))}
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Descrizione</label>
                                            <input
                                                type="text"
                                                className="w-full border-2 border-ash-200 focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                placeholder="Descrizione evento..."
                                                value={eventForm.description}
                                                onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Tema</label>
                                            <select
                                                className="w-full border-2 border-ash-200 focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                value={eventForm.theme}
                                                onChange={e => setEventForm(f => ({ ...f, theme: e.target.value }))}
                                            >
                                                {EVENT_THEMES.map(t => (
                                                    <option key={t} value={t}>{themeConfig[t]?.label || t}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">XP Multiplier</label>
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="1"
                                                className="w-full border-2 border-ash-200 focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                value={eventForm.xpMultiplier}
                                                onChange={e => setEventForm(f => ({ ...f, xpMultiplier: Number(e.target.value) }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Coins Multiplier</label>
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="1"
                                                className="w-full border-2 border-ash-200 focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                value={eventForm.coinsMultiplier}
                                                onChange={e => setEventForm(f => ({ ...f, coinsMultiplier: Number(e.target.value) }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Data Inizio</label>
                                            <input
                                                type="datetime-local"
                                                className="w-full border-2 border-ash-200 focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                value={eventForm.startDate}
                                                onChange={e => setEventForm(f => ({ ...f, startDate: e.target.value }))}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-1">Data Fine</label>
                                            <input
                                                type="datetime-local"
                                                className="w-full border-2 border-ash-200 focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-ash-800 outline-none transition-all"
                                                value={eventForm.endDate}
                                                onChange={e => setEventForm(f => ({ ...f, endDate: e.target.value }))}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleCreateEvent}
                                        disabled={isProcessing}
                                        className="w-full py-2.5 px-4 bg-gradient-to-r from-purple-500 to-purple-700 text-white font-bold rounded-lg shadow-card hover:from-purple-600 hover:to-purple-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        <Sparkles className="w-4 h-4" />
                                        {isProcessing ? 'Creazione...' : 'Crea Evento Stagionale'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ===== TEAM TABLE ===== */}
            <div className="bg-white rounded-xl shadow-soft border border-ash-200/60 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gradient-to-r from-brand-charcoal to-ash-800 text-white">
                                <th className="p-4 font-semibold text-sm">Operatore</th>
                                <th className="p-4 font-semibold text-sm text-center">Ruolo</th>
                                <th className="p-4 font-semibold text-sm text-center">Livello</th>
                                <th className="p-4 font-semibold text-sm text-center">XP</th>
                                <th className="p-4 font-semibold text-sm text-center">Streak</th>
                                <th className="p-4 font-semibold text-sm text-center">Quest Oggi</th>
                                <th className="p-4 font-semibold text-sm text-right">Fenice Coins</th>
                                <th className="p-4 font-semibold text-sm text-center">Azioni</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ash-200/60">
                            {initialProfiles.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="p-8 text-center text-ash-400">Nessun operatore trovato.</td>
                                </tr>
                            )}
                            {initialProfiles.map((p: any, idx: number) => {
                                const xpPerc = Math.min((p.experience / p.targetXpForNext) * 100, 100);
                                const questsToday = teamOverview.userQuestsToday[p.id] || 0;
                                const streakCount = p.streakCount || 0;

                                return (
                                    <tr
                                        key={p.id}
                                        className="hover:bg-brand-orange-50/20 transition-all duration-200 animate-fade-in"
                                        style={{ animationDelay: `${Math.min(idx * 40, 400)}ms`, animationFillMode: 'backwards' }}
                                    >
                                        {/* Name + Level Badge */}
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-ash-100 to-ash-200 border border-ash-300 flex items-center justify-center font-bold text-ash-600 shadow-soft shrink-0 text-sm">
                                                    {p.stage?.name?.charAt(0) || 'L'}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-ash-800">{p.displayName || p.name || `GDO ${p.gdoCode}`}</div>
                                                    <div className="text-xs text-ash-400">{p.stage?.name || `Lv.${p.level}`}</div>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Role */}
                                        <td className="p-4 text-center">
                                            <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${p.role === 'CONFERME'
                                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                : 'bg-brand-orange-50 text-brand-orange border-brand-orange-200'
                                                }`}>
                                                {p.role === 'CONFERME' ? 'Conferme' : 'GDO'}
                                            </div>
                                        </td>

                                        {/* Level */}
                                        <td className="p-4 text-center">
                                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-soft bg-gradient-to-br from-ash-50 to-ash-100 text-ash-800 border-ash-200">
                                                <Shield className="w-3 h-3" /> Lv. {p.level}
                                            </div>
                                        </td>

                                        {/* XP Bar */}
                                        <td className="p-4">
                                            <div className="flex flex-col gap-1 items-center">
                                                <div className="text-xs font-bold text-ash-600">{p.experience} / {p.targetXpForNext}</div>
                                                <div className="w-24 h-2.5 bg-ash-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-brand-orange to-brand-orange-600 rounded-full transition-[width] duration-700"
                                                        style={{ width: `${xpPerc}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </td>

                                        {/* Streak */}
                                        <td className="p-4 text-center">
                                            <div className="inline-flex items-center gap-1.5">
                                                <Flame className={`w-4 h-4 ${streakCount >= 7 ? 'text-fire-500' : streakCount >= 3 ? 'text-amber-500' : 'text-ash-300'}`} />
                                                <span className={`font-bold text-sm ${streakCount >= 7 ? 'text-fire-500' : streakCount >= 3 ? 'text-amber-500' : 'text-ash-500'}`}>
                                                    {streakCount}
                                                </span>
                                            </div>
                                        </td>

                                        {/* Quests Today */}
                                        <td className="p-4 text-center">
                                            <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${questsToday > 0
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                : 'bg-ash-50 text-ash-400 border-ash-200'
                                                }`}>
                                                {questsToday > 0 && <Zap className="w-3 h-3" />}
                                                {questsToday}
                                            </div>
                                        </td>

                                        {/* Coins */}
                                        <td className="p-4 text-right">
                                            <div className="font-bold text-gaming-gold text-lg flex items-center justify-end gap-1">
                                                {(p.walletCoins ?? p.coins ?? 0).toLocaleString('it-IT')} <Coins className="w-4 h-4" />
                                            </div>
                                        </td>

                                        {/* Actions */}
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <Link
                                                    href={`/profilo/${p.id}`}
                                                    className="p-2 bg-brand-orange-50 border border-brand-orange-200/60 rounded-lg text-brand-orange hover:bg-brand-orange-100 transition-all shadow-soft hover:shadow-card"
                                                    title="Vedi Profilo RPG"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </Link>
                                                <button
                                                    onClick={() => openSalaryCoins(p.id, p.displayName || p.name || 'Operatore', 'salary', p.baseSalaryEur)}
                                                    className="p-2 bg-white border border-ash-200/60 rounded-lg text-ash-600 hover:bg-ash-100 hover:text-ash-800 transition-all shadow-soft hover:shadow-card"
                                                    title="Aggiorna Stipendio Base"
                                                >
                                                    <TrendingUp className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => openSalaryCoins(p.id, p.displayName || p.name || 'Operatore', 'coins', p.walletCoins ?? p.coins ?? 0)}
                                                    className="p-2 bg-gold-50 border border-gold-200/60 rounded-lg text-gold-700 hover:bg-gold-100 transition-all shadow-soft hover:shadow-card"
                                                    title="Invia Fenice Coins Extra"
                                                >
                                                    <Coins className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ===== SALARY / COINS MODAL ===== */}
            {activeDialog && (activeDialog === 'salary' || activeDialog === 'coins') && dialogTarget && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center animate-fade-in">
                    <div className="bg-white p-6 rounded-2xl shadow-elevated w-full max-w-sm border border-ash-200/60">
                        <div className="flex items-center gap-3 mb-4">
                            {activeDialog === 'coins' ? <Coins className="w-6 h-6 text-gold-500" /> : <TrendingUp className="w-6 h-6 text-ash-700" />}
                            <h3 className="text-lg font-bold text-ash-800">
                                {activeDialog === 'coins' ? 'Invia Coins a' : 'Modifica Salario Base per'} {dialogTarget.name}
                            </h3>
                        </div>

                        <div className="mb-6">
                            <label className="block text-xs font-semibold text-ash-500 uppercase tracking-wide mb-2">
                                {activeDialog === 'coins' ? 'Quantita\' di Coins da Regalare (+)' : 'Nuovo Stipendio Lordo Mese (€)'}
                            </label>
                            <input
                                type="number"
                                className="w-full border-2 border-ash-200 focus:border-brand-orange rounded-xl px-4 py-3 font-bold text-ash-800 outline-none transition-all"
                                value={inputValue}
                                onChange={(e) => setInputValue(Number(e.target.value))}
                            />
                            {activeDialog === 'coins' && (
                                <div className="text-xs text-ash-400 mt-2">
                                    I Coins saranno sommati a quelli gia' posseduti ({dialogTarget.currentValue}).
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => { setActiveDialog(null); setDialogTarget(null); }}
                                className="btn-ghost px-4 py-2"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleSaveSalaryCoins}
                                disabled={isProcessing}
                                className={`px-4 py-2 font-bold text-white rounded-lg shadow-card transition-all ${activeDialog === 'coins' ? 'bg-gradient-to-r from-gold-400 to-gold-500 hover:from-gold-500 hover:to-gold-600' : 'bg-brand-charcoal hover:bg-ash-800'
                                    } disabled:opacity-50`}
                            >
                                {isProcessing ? 'Salvataggio...' : 'Conferma'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
