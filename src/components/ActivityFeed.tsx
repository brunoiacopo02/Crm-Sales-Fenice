'use client';

import { useEffect, useState, useCallback } from 'react';
import { getActivityFeed, type ActivityFeedItem } from '@/app/actions/activityFeedActions';
import { Phone, Calendar, Trophy, Sword, Gift, Star, TrendingUp, Coins } from 'lucide-react';

const REFRESH_INTERVAL = 30_000; // 30 seconds

const iconMap: Record<ActivityFeedItem['type'], React.ElementType> = {
    appointment_set: Calendar,
    achievement_unlocked: Trophy,
    quest_completed: Sword,
    loot_drop: Gift,
    level_up: Star,
    coins_earned: Coins,
    call_made: Phone,
    deal_closed: TrendingUp,
};

const colorBorderMap: Record<ActivityFeedItem['color'], string> = {
    orange: 'border-l-brand-orange-400',
    ember: 'border-l-ember-400',
    gold: 'border-l-gold-400',
    ash: 'border-l-ash-300',
};

const colorBgMap: Record<ActivityFeedItem['color'], string> = {
    orange: 'bg-brand-orange-50',
    ember: 'bg-ember-50',
    gold: 'bg-gold-50',
    ash: 'bg-gray-50',
};

const colorIconMap: Record<ActivityFeedItem['color'], string> = {
    orange: 'text-brand-orange-600',
    ember: 'text-ember-500',
    gold: 'text-gold-500',
    ash: 'text-ash-500',
};

function getRelativeTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'ora';
    if (minutes < 60) return `${minutes} min fa`;
    if (hours < 24) return `${hours}h fa`;
    if (days === 1) return 'ieri';
    return `${days}g fa`;
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

function FeedItem({ item, isNew }: { item: ActivityFeedItem; isNew: boolean }) {
    const Icon = iconMap[item.type] ?? Phone;
    const displayName = item.userDisplayName || item.userName;

    return (
        <div
            className={`flex items-start gap-3 p-3 rounded-lg border-l-3 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 cursor-default ${colorBorderMap[item.color]} ${isNew ? 'animate-[slide-in-right_0.3s_ease-out]' : ''}`}
            style={{ backgroundColor: 'var(--color-brand-light)' }}
        >
            {/* Avatar */}
            <div className="shrink-0">
                {item.avatarUrl ? (
                    <img
                        src={item.avatarUrl}
                        alt={displayName}
                        className="w-8 h-8 rounded-full object-cover ring-2 ring-white shadow-sm"
                    />
                ) : (
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm ${item.color === 'gold' ? 'bg-gold-500' : item.color === 'ember' ? 'bg-ember-400' : item.color === 'orange' ? 'bg-brand-orange-500' : 'bg-ash-400'}`}>
                        {getInitials(displayName)}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <div className={`shrink-0 ${colorIconMap[item.color]}`}>
                        <Icon className="w-3.5 h-3.5" />
                    </div>
                    <p className="text-sm text-gray-800 truncate">
                        <span className="font-semibold">{displayName}</span>{' '}
                        <span className="text-gray-600">{item.description}</span>
                    </p>
                </div>
                {item.detail && (
                    <div className={`mt-0.5 text-xs font-medium ${colorIconMap[item.color]}`}>
                        {item.detail}
                    </div>
                )}
            </div>

            {/* Timestamp */}
            <div className="shrink-0 text-[11px] text-gray-400 mt-0.5">
                {getRelativeTime(item.timestamp)}
            </div>
        </div>
    );
}

export function ActivityFeed() {
    const [items, setItems] = useState<ActivityFeedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());

    const fetchFeed = useCallback(async (isRefresh = false) => {
        try {
            const data = await getActivityFeed();
            if (isRefresh && items.length > 0) {
                // Find truly new items
                const existingIds = new Set(items.map(i => i.id));
                const freshIds = new Set(data.filter(d => !existingIds.has(d.id)).map(d => d.id));
                if (freshIds.size > 0) {
                    setNewItemIds(freshIds);
                    setTimeout(() => setNewItemIds(new Set()), 1000);
                }
            }
            setItems(data);
        } catch {
            // silently fail — feed is non-critical
        } finally {
            setLoading(false);
        }
    }, [items]);

    useEffect(() => {
        fetchFeed();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-refresh every 30 seconds
    useEffect(() => {
        const interval = setInterval(() => fetchFeed(true), REFRESH_INTERVAL);
        return () => clearInterval(interval);
    }, [fetchFeed]);

    // Listen for reward_earned events to trigger immediate refresh
    useEffect(() => {
        const handler = () => {
            setTimeout(() => fetchFeed(true), 2000); // slight delay for DB write
        };
        window.addEventListener('reward_earned', handler);
        return () => window.removeEventListener('reward_earned', handler);
    }, [fetchFeed]);

    if (loading) {
        return (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-brand-orange animate-pulse" />
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Feed Live</h3>
                </div>
                <div className="space-y-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex items-center gap-3 animate-pulse">
                            <div className="w-8 h-8 rounded-full bg-gray-200" />
                            <div className="flex-1 space-y-1.5">
                                <div className="h-3 bg-gray-200 rounded w-3/4" />
                                <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Feed Live</h3>
                </div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                    {items.length} eventi
                </div>
            </div>

            {/* Scrollable feed */}
            <div className="overflow-y-auto max-h-[400px] p-2 space-y-1.5 scrollbar-thin">
                {items.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">
                        Nessuna attivita' recente
                    </div>
                ) : (
                    items.map((item) => (
                        <FeedItem
                            key={item.id}
                            item={item}
                            isNew={newItemIds.has(item.id)}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
