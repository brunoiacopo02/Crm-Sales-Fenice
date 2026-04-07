'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Crown, ChevronDown, ChevronUp, Check, X,
    Fish, Phone, Mic, CalendarCheck, Star, Flame, Timer, Shield,
    Sparkles, Zap, Award, Compass, Crosshair, Gem, Lock
} from 'lucide-react';
import { setActiveTitle } from '@/app/actions/titleActions';
import type { UnlockedTitle } from '@/app/actions/titleActions';

const ICON_MAP: Record<string, React.ElementType> = {
    Fish, Phone, Mic, CalendarCheck, Crown, Star, Flame, Timer, Shield,
    Sparkles, Zap, Award, Compass, Crosshair, Gem, Lock,
};

const CATEGORY_LABELS: Record<string, string> = {
    calls: 'Chiamate',
    appointments: 'Appuntamenti',
    streak: 'Streak',
    level: 'Livello',
    quests: 'Quest',
    legendary: 'Leggendari',
};

const CATEGORY_ORDER = ['legendary', 'level', 'appointments', 'calls', 'streak', 'quests'];

export default function TitleSelector({
    titles,
    activeTitle,
    userId,
}: {
    titles: UnlockedTitle[];
    activeTitle: string | null;
    userId: string;
}) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const unlockedCount = titles.filter(t => t.unlocked).length;

    // Group by category
    const grouped = CATEGORY_ORDER.map(cat => ({
        category: cat,
        label: CATEGORY_LABELS[cat] || cat,
        titles: titles.filter(t => t.category === cat),
    })).filter(g => g.titles.length > 0);

    async function handleSelect(titleName: string | null) {
        setSaving(true);
        await setActiveTitle(userId, titleName);
        router.refresh();
        setSaving(false);
    }

    return (
        <div className="border border-purple-200/60 bg-gradient-to-br from-purple-50 to-brand-orange-50/30 rounded-2xl shadow-card overflow-hidden animate-fade-in" style={{ animationDelay: '150ms', animationFillMode: 'backwards' }}>
            {/* Header */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-6 hover:bg-purple-50/50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-purple-100 border border-purple-200">
                        <Crown className="w-5 h-5 text-purple-600" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-bold text-ash-800 tracking-tight">Titoli e Ranghi</h3>
                        <div className="text-xs text-ash-500 mt-0.5">
                            {unlockedCount} sbloccati su {titles.length}
                            {activeTitle && (
                                <span className="ml-2 text-purple-600 font-semibold">· Attivo: {activeTitle}</span>
                            )}
                        </div>
                    </div>
                </div>
                {isOpen ? <ChevronUp className="w-5 h-5 text-ash-400" /> : <ChevronDown className="w-5 h-5 text-ash-400" />}
            </button>

            {/* Content */}
            {isOpen && (
                <div className="px-6 pb-6 space-y-5 animate-fade-in">
                    {/* Active title display + remove */}
                    {activeTitle && (
                        <div className="flex items-center justify-between bg-gradient-to-r from-purple-100 to-brand-orange-100 rounded-xl p-3 border border-purple-200/60">
                            <div className="flex items-center gap-2">
                                <Crown className="w-4 h-4 text-purple-600" />
                                <span className="text-sm font-bold text-purple-800">{activeTitle}</span>
                                <span className="text-xs text-purple-600/70">Titolo attivo</span>
                            </div>
                            <button
                                onClick={() => handleSelect(null)}
                                disabled={saving}
                                className="text-xs text-ash-500 hover:text-red-500 transition-colors flex items-center gap-1"
                            >
                                <X className="w-3 h-3" /> Rimuovi
                            </button>
                        </div>
                    )}

                    {/* Grouped titles */}
                    {grouped.map(group => (
                        <div key={group.category}>
                            <div className="text-xs font-bold text-ash-500 uppercase tracking-wider mb-2">{group.label}</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {group.titles.map(title => {
                                    const IconComp = ICON_MAP[title.icon] || Star;
                                    const isActive = activeTitle === title.name;
                                    const isLocked = !title.unlocked;

                                    return (
                                        <button
                                            key={title.id}
                                            onClick={() => !isLocked && !isActive && handleSelect(title.name)}
                                            disabled={isLocked || saving}
                                            className={`relative flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left ${
                                                isActive
                                                    ? 'bg-gradient-to-r from-purple-100 to-purple-50 border-purple-300 shadow-soft ring-2 ring-purple-200'
                                                    : isLocked
                                                        ? 'bg-ash-50 border-ash-200/60 opacity-50 cursor-not-allowed'
                                                        : 'bg-white border-ash-200/60 hover:border-purple-300 hover:shadow-soft cursor-pointer'
                                            }`}
                                        >
                                            <div className={`p-1.5 rounded-lg ${
                                                isActive ? 'bg-purple-200 text-purple-700'
                                                    : isLocked ? 'bg-ash-200 text-ash-400'
                                                        : title.source === 'legendary' ? 'bg-gold-100 text-gold-600'
                                                            : 'bg-purple-100 text-purple-500'
                                            }`}>
                                                {isLocked ? <Lock className="w-4 h-4" /> : <IconComp className="w-4 h-4" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className={`text-sm font-semibold truncate ${isActive ? 'text-purple-800' : isLocked ? 'text-ash-400' : 'text-ash-800'}`}>
                                                    {title.name}
                                                </div>
                                                <div className="text-[11px] text-ash-500 truncate">{title.description}</div>
                                            </div>
                                            {isActive && (
                                                <Check className="w-4 h-4 text-purple-600 flex-shrink-0" />
                                            )}
                                            {title.source === 'legendary' && !isLocked && (
                                                <div className="absolute -top-1 -right-1 bg-gold-400 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-gold-300 shadow-sm">
                                                    LOOT
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
