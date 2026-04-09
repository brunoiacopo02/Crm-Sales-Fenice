'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { SafeWrapper } from '@/components/SafeWrapper';
import { equipCreature, fuseCreatures } from '@/app/actions/creatureActions';
import { equipTeamCreature, fuseTeamCreatures } from '@/app/actions/teamAdventureActions';
import { Sparkles, Shield, Swords, Zap, Flame, Droplets, Wind, Sun, Moon, Mountain, Filter, Layers } from 'lucide-react';

// Types
type CreatureDef = {
    id: string;
    name: string;
    description: string;
    rarity: string;
    element: string;
    imageUrl: string | null;
    baseXpBonus: number;
    baseCoinBonus: number;
    maxLevel: number;
    isActive: boolean;
};

type OwnedCreature = {
    userCreatureId?: string;
    teamCreatureId?: string;
    creatureId: string;
    level: number;
    xpFed: number;
    isEquipped: boolean;
    obtainedAt: Date;
    name: string;
    description: string;
    rarity: string;
    element: string;
    imageUrl: string | null;
    baseXpBonus: number;
    baseCoinBonus: number;
    maxLevel?: number;
    contributedByUserId?: string | null;
};

type Props = {
    allCreatures: CreatureDef[];
    ownedCreatures: OwnedCreature[];
    isTeam: boolean;
    userId: string;
};

const RARITY_CONFIG: Record<string, { label: string; border: string; bg: string; glow: string; text: string }> = {
    common: {
        label: 'Comune',
        border: 'border-zinc-500',
        bg: 'bg-zinc-800/50',
        glow: '',
        text: 'text-zinc-400',
    },
    rare: {
        label: 'Rara',
        border: 'border-blue-500',
        bg: 'bg-blue-950/40',
        glow: 'shadow-[0_0_12px_rgba(59,130,246,0.3)]',
        text: 'text-blue-400',
    },
    epic: {
        label: 'Epica',
        border: 'border-purple-500',
        bg: 'bg-purple-950/40',
        glow: 'shadow-[0_0_16px_rgba(168,85,247,0.4)]',
        text: 'text-purple-400',
    },
    legendary: {
        label: 'Leggendaria',
        border: 'border-amber-400',
        bg: 'bg-amber-950/40',
        glow: 'shadow-[0_0_20px_rgba(251,191,36,0.5)]',
        text: 'text-amber-400',
    },
};

const ELEMENT_ICONS: Record<string, typeof Flame> = {
    fuoco: Flame,
    acqua: Droplets,
    terra: Mountain,
    aria: Wind,
    luce: Sun,
    ombra: Moon,
};

const ELEMENT_COLORS: Record<string, string> = {
    fuoco: 'text-red-400',
    acqua: 'text-cyan-400',
    terra: 'text-amber-600',
    aria: 'text-emerald-400',
    luce: 'text-yellow-300',
    ombra: 'text-violet-400',
};

function CreatureCard({
    creature,
    copyCount,
    isEquipped,
    onEquip,
    onFuse,
    isPending,
}: {
    creature: OwnedCreature;
    copyCount: number;
    isEquipped: boolean;
    onEquip: () => void;
    onFuse: () => void;
    isPending: boolean;
}) {
    const rarityConf = RARITY_CONFIG[creature.rarity] || RARITY_CONFIG.common;
    const ElIcon = ELEMENT_ICONS[creature.element] || Zap;
    const elColor = ELEMENT_COLORS[creature.element] || 'text-gray-400';
    const scaleFactor = 1 + ((creature.level - 1) / 9) * 2;
    const xpBonus = (creature.baseXpBonus * scaleFactor * 100).toFixed(1);
    const coinBonus = (creature.baseCoinBonus * scaleFactor * 100).toFixed(1);

    return (
        <div
            className={`relative rounded-xl border-2 ${rarityConf.border} ${rarityConf.bg} ${rarityConf.glow} p-4 flex flex-col gap-3 transition-all duration-300 hover:scale-[1.02] ${isEquipped ? 'ring-2 ring-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.4)]' : ''}`}
        >
            {/* Equipped badge */}
            {isEquipped && (
                <div className="absolute -top-2 -right-2 bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg">
                    EQUIPAGGIATA
                </div>
            )}

            {/* Image placeholder */}
            <div className="w-full aspect-square rounded-lg bg-black/30 border border-white/5 flex items-center justify-center overflow-hidden">
                {creature.imageUrl ? (
                    <img src={creature.imageUrl} alt={creature.name} className="w-full h-full object-cover rounded-lg" />
                ) : (
                    <div className="flex flex-col items-center gap-1">
                        <ElIcon className={`h-10 w-10 ${elColor} opacity-40`} />
                        <span className="text-[10px] text-white/20 uppercase">{creature.element}</span>
                    </div>
                )}
            </div>

            {/* Name + Rarity */}
            <div>
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white truncate">{creature.name}</h3>
                    <ElIcon className={`h-4 w-4 ${elColor}`} />
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${rarityConf.text}`}>
                        {rarityConf.label}
                    </span>
                    <span className="text-[10px] text-white/40">Lv.{creature.level}/{creature.maxLevel || 10}</span>
                </div>
            </div>

            {/* Bonus stats */}
            <div className="flex gap-2 text-[11px]">
                <div className="flex items-center gap-1 bg-black/30 rounded-md px-2 py-1">
                    <Sparkles className="h-3 w-3 text-yellow-400" />
                    <span className="text-yellow-300">+{xpBonus}% XP</span>
                </div>
                <div className="flex items-center gap-1 bg-black/30 rounded-md px-2 py-1">
                    <Shield className="h-3 w-3 text-amber-400" />
                    <span className="text-amber-300">+{coinBonus}% Coins</span>
                </div>
            </div>

            {/* Copies indicator */}
            {copyCount > 1 && (
                <div className="text-[10px] text-white/50">
                    <Layers className="inline h-3 w-3 mr-1" />
                    {copyCount} copie possedute
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-auto">
                <div
                    role="button"
                    tabIndex={0}
                    onClick={isPending ? undefined : onEquip}
                    onKeyDown={(e) => e.key === 'Enter' && !isPending && onEquip()}
                    className={`flex-1 text-center text-xs font-semibold py-2 rounded-lg transition-all cursor-pointer ${isEquipped
                        ? 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                        : 'bg-gradient-to-r from-amber-500 to-orange-500 text-black hover:from-amber-400 hover:to-orange-400'
                        } ${isPending ? 'opacity-50 cursor-wait' : ''}`}
                >
                    {isEquipped ? 'Rimuovi' : 'Equipaggia'}
                </div>
                {copyCount >= 4 && (
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={isPending ? undefined : onFuse}
                        onKeyDown={(e) => e.key === 'Enter' && !isPending && onFuse()}
                        className={`flex-1 text-center text-xs font-semibold py-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-500 hover:to-pink-500 transition-all cursor-pointer ${isPending ? 'opacity-50 cursor-wait' : ''}`}
                    >
                        <Swords className="inline h-3 w-3 mr-1" />
                        Fondi
                    </div>
                )}
            </div>
        </div>
    );
}

export default function InventarioCreatureClient({ allCreatures, ownedCreatures, isTeam, userId }: Props) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [rarityFilter, setRarityFilter] = useState<string>('tutti');
    const [elementFilter, setElementFilter] = useState<string>('tutti');
    const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

    // Deduplicate: group owned creatures by creatureId
    const groupedOwned = useMemo(() => {
        const groups: Record<string, OwnedCreature[]> = {};
        for (const c of ownedCreatures) {
            const key = c.creatureId;
            if (!groups[key]) groups[key] = [];
            groups[key].push(c);
        }
        return groups;
    }, [ownedCreatures]);

    // Best copy per creature (highest level, prefer equipped)
    const bestCopies = useMemo(() => {
        const result: (OwnedCreature & { copyCount: number })[] = [];
        for (const [creatureId, copies] of Object.entries(groupedOwned)) {
            const sorted = [...copies].sort((a, b) => {
                if (a.isEquipped && !b.isEquipped) return -1;
                if (!a.isEquipped && b.isEquipped) return 1;
                return b.level - a.level;
            });
            result.push({ ...sorted[0], copyCount: copies.length });
        }
        return result;
    }, [groupedOwned]);

    // Unique discovered creature IDs
    const discoveredIds = useMemo(() => new Set(ownedCreatures.map(c => c.creatureId)), [ownedCreatures]);

    // Elements in the collection
    const allElements = useMemo(() => {
        const elems = new Set(allCreatures.map(c => c.element));
        return Array.from(elems).sort();
    }, [allCreatures]);

    // Apply filters
    const filtered = useMemo(() => {
        return bestCopies.filter(c => {
            if (rarityFilter !== 'tutti' && c.rarity !== rarityFilter) return false;
            if (elementFilter !== 'tutti' && c.element !== elementFilter) return false;
            return true;
        });
    }, [bestCopies, rarityFilter, elementFilter]);

    const handleEquip = (creature: OwnedCreature) => {
        startTransition(async () => {
            const id = creature.userCreatureId || creature.teamCreatureId;
            if (!id) return;

            if (creature.isEquipped) {
                // Un-equip: just equip nothing (re-equip same creature toggles off)
                if (isTeam) {
                    await equipTeamCreature(id);
                } else {
                    await equipCreature(userId, id);
                }
            } else {
                if (isTeam) {
                    await equipTeamCreature(id);
                } else {
                    await equipCreature(userId, id);
                }
            }
            router.refresh();
        });
    };

    const handleFuse = (creature: OwnedCreature) => {
        startTransition(async () => {
            const result = isTeam
                ? await fuseTeamCreatures(creature.creatureId)
                : await fuseCreatures(userId, creature.creatureId);

            if (result.success) {
                setFeedbackMsg(`Fusione riuscita! ${creature.name} ora Lv.${result.newLevel}`);
                setTimeout(() => setFeedbackMsg(null), 3000);
            } else {
                setFeedbackMsg(result.error || 'Errore durante la fusione');
                setTimeout(() => setFeedbackMsg(null), 3000);
            }
            router.refresh();
        });
    };

    return (
        <SafeWrapper>
            <div className="space-y-6 max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 shadow-lg shadow-purple-900/30">
                            <Sparkles className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                                {isTeam ? 'Inventario Team' : 'Inventario Creature'}
                            </h1>
                            <div className="text-sm text-ash-500 mt-0.5">
                                {isTeam
                                    ? 'Le creature collezionate dal Team Conferme'
                                    : 'La tua collezione personale di creature'}
                            </div>
                        </div>
                    </div>
                    {/* Collection counter */}
                    <div className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border border-white/10 rounded-xl px-5 py-3 text-center">
                        <div className="text-2xl font-bold text-white">{discoveredIds.size}<span className="text-white/40">/{allCreatures.length}</span></div>
                        <div className="text-[10px] text-white/50 uppercase tracking-wider mt-0.5">Creature Scoperte</div>
                    </div>
                </div>

                {/* Feedback toast */}
                {feedbackMsg && (
                    <div className="bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-purple-500/30 rounded-xl px-4 py-3 text-sm text-purple-200 animate-pulse">
                        {feedbackMsg}
                    </div>
                )}

                {/* Filters */}
                <div className="flex flex-wrap gap-3 items-center bg-[#1a1a2e]/50 border border-white/5 rounded-xl p-4">
                    <Filter className="h-4 w-4 text-white/40" />
                    {/* Rarity filter */}
                    <div className="flex gap-1">
                        {['tutti', 'common', 'rare', 'epic', 'legendary'].map(r => {
                            const label = r === 'tutti' ? 'Tutti' : (RARITY_CONFIG[r]?.label || r);
                            const isActive = rarityFilter === r;
                            return (
                                <div
                                    key={r}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setRarityFilter(r)}
                                    onKeyDown={(e) => e.key === 'Enter' && setRarityFilter(r)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${isActive
                                        ? 'bg-white/15 text-white border border-white/20'
                                        : 'bg-white/5 text-white/50 border border-transparent hover:bg-white/10 hover:text-white/70'
                                        }`}
                                >
                                    {label}
                                </div>
                            );
                        })}
                    </div>
                    {/* Separator */}
                    <div className="w-px h-6 bg-white/10" />
                    {/* Element filter */}
                    <div className="flex gap-1">
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setElementFilter('tutti')}
                            onKeyDown={(e) => e.key === 'Enter' && setElementFilter('tutti')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${elementFilter === 'tutti'
                                ? 'bg-white/15 text-white border border-white/20'
                                : 'bg-white/5 text-white/50 border border-transparent hover:bg-white/10 hover:text-white/70'
                                }`}
                        >
                            Tutti
                        </div>
                        {allElements.map(el => {
                            const ElIcon = ELEMENT_ICONS[el] || Zap;
                            const isActive = elementFilter === el;
                            return (
                                <div
                                    key={el}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setElementFilter(el)}
                                    onKeyDown={(e) => e.key === 'Enter' && setElementFilter(el)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1 ${isActive
                                        ? 'bg-white/15 text-white border border-white/20'
                                        : 'bg-white/5 text-white/50 border border-transparent hover:bg-white/10 hover:text-white/70'
                                        }`}
                                    title={el.charAt(0).toUpperCase() + el.slice(1)}
                                >
                                    <ElIcon className={`h-3.5 w-3.5 ${ELEMENT_COLORS[el] || ''}`} />
                                    <span className="capitalize">{el}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Grid */}
                {filtered.length === 0 ? (
                    <div className="text-center py-16 text-white/30">
                        <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <div className="text-lg font-medium">Nessuna creatura trovata</div>
                        <div className="text-sm mt-1">
                            {ownedCreatures.length === 0
                                ? 'Apri bauli e sconfiggi boss per ottenere creature!'
                                : 'Prova a cambiare i filtri'}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {filtered.map((creature) => {
                            const id = creature.userCreatureId || creature.teamCreatureId || creature.creatureId;
                            return (
                                <SafeWrapper key={id}>
                                    <CreatureCard
                                        creature={creature}
                                        copyCount={creature.copyCount}
                                        isEquipped={creature.isEquipped}
                                        onEquip={() => handleEquip(creature)}
                                        onFuse={() => handleFuse(creature)}
                                        isPending={isPending}
                                    />
                                </SafeWrapper>
                            );
                        })}
                    </div>
                )}

                {/* Rarity distribution */}
                <div className="bg-[#1a1a2e]/50 border border-white/5 rounded-xl p-4">
                    <div className="text-xs text-white/40 uppercase tracking-wider mb-3">Distribuzione Collezione</div>
                    <div className="grid grid-cols-4 gap-3">
                        {(['common', 'rare', 'epic', 'legendary'] as const).map(r => {
                            const total = allCreatures.filter(c => c.rarity === r).length;
                            const owned = new Set(ownedCreatures.filter(c => c.rarity === r).map(c => c.creatureId)).size;
                            const conf = RARITY_CONFIG[r];
                            return (
                                <div key={r} className={`rounded-lg border ${conf.border} ${conf.bg} p-3 text-center`}>
                                    <div className={`text-lg font-bold ${conf.text}`}>{owned}/{total}</div>
                                    <div className="text-[10px] text-white/40 uppercase">{conf.label}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </SafeWrapper>
    );
}
