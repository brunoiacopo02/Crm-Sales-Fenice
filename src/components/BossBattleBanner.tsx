'use client';

import { useEffect, useState, useCallback } from 'react';
import { getActiveBossBattle, getUserBossContribution } from '@/app/actions/bossBattleActions';
import { Skull, Swords, Heart, Timer, Users, Trophy, ChevronDown, ChevronUp } from 'lucide-react';

interface BossBattleData {
    id: string;
    title: string;
    description: string;
    totalHp: number;
    currentHp: number;
    rewardCoins: number;
    rewardXp: number;
    endTime: Date;
    status: string;
    topContributors: Array<{ userId: string; name: string; totalDamage: number }>;
    totalContributors: number;
}

interface UserContribution {
    totalDamage: number;
    hitCount: number;
}

export function BossBattleBanner({ userId }: { userId: string }) {
    const [battle, setBattle] = useState<BossBattleData | null>(null);
    const [userContrib, setUserContrib] = useState<UserContribution | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [timeLeft, setTimeLeft] = useState('');

    const fetchBattle = useCallback(async () => {
        const data = await getActiveBossBattle();
        if (data) {
            setBattle(data as BossBattleData);
            const contrib = await getUserBossContribution(userId, data.id);
            setUserContrib(contrib);
        } else {
            setBattle(null);
        }
    }, [userId]);

    useEffect(() => {
        fetchBattle();
        const interval = setInterval(fetchBattle, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, [fetchBattle]);

    // Countdown timer
    useEffect(() => {
        if (!battle) return;
        const tick = () => {
            const now = new Date();
            const end = new Date(battle.endTime);
            const diff = end.getTime() - now.getTime();
            if (diff <= 0) {
                setTimeLeft('Scaduto');
                return;
            }
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            if (hours > 24) {
                const days = Math.floor(hours / 24);
                setTimeLeft(`${days}g ${hours % 24}h`);
            } else {
                setTimeLeft(`${hours}h ${minutes}m`);
            }
        };
        tick();
        const interval = setInterval(tick, 60000);
        return () => clearInterval(interval);
    }, [battle]);

    if (!battle) return null;

    const hpPercent = Math.max(0, (battle.currentHp / battle.totalHp) * 100);
    const damageDealt = battle.totalHp - battle.currentHp;

    // HP bar color based on remaining HP
    const hpColor = hpPercent > 60 ? 'from-ember-500 to-ember-400'
        : hpPercent > 30 ? 'from-brand-orange-500 to-brand-orange-400'
        : 'from-green-500 to-green-400';

    return (
        <div className="rounded-xl border border-ember-200 bg-gradient-to-br from-brand-charcoal via-ash-900 to-ember-900 p-4 shadow-lg animate-fade-in overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-ember-500 to-ember-700 flex items-center justify-center shadow-md">
                            <Skull className="w-5 h-5 text-white" />
                        </div>
                        {battle.currentHp > 0 && (
                            <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-ember-400 animate-glow-pulse" />
                        )}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="text-sm font-bold text-white">{battle.title}</div>
                            {battle.currentHp <= 0 && (
                                <div className="badge badge-success text-[10px]">SCONFITTO!</div>
                            )}
                        </div>
                        <div className="text-xs text-ash-400">{battle.description}</div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-ash-300">
                        <Timer className="w-3.5 h-3.5" />
                        <div>{timeLeft}</div>
                    </div>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="p-1 rounded-md hover:bg-white/10 transition-colors text-ash-400"
                    >
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            {/* HP Bar */}
            <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 text-xs text-ash-300">
                        <Heart className="w-3.5 h-3.5 text-ember-400" />
                        <div>{battle.currentHp.toLocaleString()} / {battle.totalHp.toLocaleString()} HP</div>
                    </div>
                    <div className="text-xs text-ash-400">
                        {damageDealt.toLocaleString()} danni inflitti
                    </div>
                </div>
                <div className="h-3 rounded-full bg-ash-800 overflow-hidden relative">
                    <div
                        className={`h-full rounded-full bg-gradient-to-r ${hpColor} transition-all duration-1000 ease-out relative`}
                        style={{ width: `${hpPercent}%` }}
                    >
                        {hpPercent > 5 && (
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" style={{ backgroundSize: '200% 100%' }} />
                        )}
                    </div>
                </div>
            </div>

            {/* Reward Preview */}
            <div className="mt-2 flex items-center gap-3">
                <div className="flex items-center gap-1 text-xs text-gold-300">
                    <Trophy className="w-3 h-3" />
                    <div>{battle.rewardCoins} coins</div>
                </div>
                {battle.rewardXp > 0 && (
                    <div className="text-xs text-brand-orange-300">+{battle.rewardXp} XP</div>
                )}
                <div className="flex items-center gap-1 text-xs text-ash-400 ml-auto">
                    <Users className="w-3 h-3" />
                    <div>{battle.totalContributors} guerrieri</div>
                </div>
            </div>

            {/* Expanded Section */}
            {expanded && (
                <div className="mt-3 pt-3 border-t border-white/10 animate-fade-in">
                    <div className="grid grid-cols-2 gap-3">
                        {/* Your Contribution */}
                        <div className="rounded-lg bg-white/5 p-3">
                            <div className="text-xs text-ash-400 mb-1.5">Il tuo contributo</div>
                            {userContrib && userContrib.hitCount > 0 ? (
                                <div>
                                    <div className="flex items-center gap-1.5">
                                        <Swords className="w-4 h-4 text-brand-orange" />
                                        <div className="text-lg font-bold text-white">{userContrib.totalDamage}</div>
                                        <div className="text-xs text-ash-400">danni</div>
                                    </div>
                                    <div className="text-xs text-ash-500 mt-1">{userContrib.hitCount} colpi inferti</div>
                                </div>
                            ) : (
                                <div className="text-xs text-ash-500">Fissa un appuntamento per colpire!</div>
                            )}
                        </div>

                        {/* Top Contributors */}
                        <div className="rounded-lg bg-white/5 p-3">
                            <div className="text-xs text-ash-400 mb-1.5">Top Guerrieri</div>
                            <div className="space-y-1">
                                {battle.topContributors.slice(0, 3).map((c, i) => (
                                    <div key={c.userId} className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-1.5">
                                            <div className={`w-4 text-center font-bold ${i === 0 ? 'text-gold-400' : i === 1 ? 'text-ash-300' : 'text-brand-orange-600'}`}>
                                                {i + 1}
                                            </div>
                                            <div className="text-ash-200 truncate max-w-[80px]">{c.name}</div>
                                        </div>
                                        <div className="text-ash-400">{c.totalDamage} dmg</div>
                                    </div>
                                ))}
                                {battle.topContributors.length === 0 && (
                                    <div className="text-xs text-ash-500">Nessun contributo ancora</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
