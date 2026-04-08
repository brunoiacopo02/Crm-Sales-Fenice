'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { SocialNotificationToast } from '@/components/SocialNotificationToast';
import type { SocialToastData } from '@/components/SocialNotificationToast';
import type { SocialNotificationDetail } from '@/lib/animationUtils';
import { getAnimationsEnabled } from '@/lib/animationUtils';

const MAX_VISIBLE = 3;

// Boss battle check interval: every 60 seconds
const BOSS_CHECK_INTERVAL = 60_000;

export function SocialNotificationProvider({ children }: { children: React.ReactNode }) {
    const [queue, setQueue] = useState<SocialToastData[]>([]);
    const { user } = useAuth();
    const supabase = createClient();
    const router = useRouter();
    const bossNotifiedRef = useRef<Set<string>>(new Set());

    const pushNotification = useCallback((notif: Omit<SocialToastData, 'id'>) => {
        if (!getAnimationsEnabled()) return;

        const toast: SocialToastData = {
            ...notif,
            id: `social-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        };

        setQueue(prev => {
            const next = [...prev, toast];
            if (next.length > MAX_VISIBLE + 2) {
                return next.slice(-MAX_VISIBLE);
            }
            return next;
        });
    }, []);

    // Listen to custom event 'social_notification'
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<SocialNotificationDetail>).detail;
            if (!detail) return;
            pushNotification({
                type: detail.type,
                title: detail.title,
                message: detail.message,
                ctaLabel: detail.ctaLabel,
                ctaHref: detail.ctaHref,
                actorName: detail.actorName,
            });
        };

        window.addEventListener('social_notification', handler);
        return () => window.removeEventListener('social_notification', handler);
    }, [pushNotification]);

    // Supabase Realtime: listen for new achievements by other users
    useEffect(() => {
        if (!user) return;

        const channel = supabase
            .channel('social-achievements')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'userAchievements',
                },
                async (payload) => {
                    const record = payload.new as { userId?: string; achievementId?: string; tier?: number };
                    // Skip own achievements (user already gets RewardPopup)
                    if (!record || record.userId === user.id) return;

                    // Fetch actor name and achievement name
                    const [userRes, achRes] = await Promise.all([
                        supabase.from('users').select('name, displayName').eq('id', record.userId).single(),
                        supabase.from('achievements').select('name, icon').eq('id', record.achievementId).single(),
                    ]);

                    const actorName = userRes.data?.displayName || userRes.data?.name || 'Un collega';
                    const achName = achRes.data?.name || 'un badge';
                    const tierLabel = record.tier === 3 ? 'Oro' : record.tier === 2 ? 'Argento' : 'Bronzo';

                    pushNotification({
                        type: 'rare_achievement',
                        title: `${actorName} ha sbloccato un badge!`,
                        message: `${achName} (${tierLabel}) — Riuscrai a fare lo stesso?`,
                        ctaLabel: 'Vedi classifica',
                        ctaHref: '/classifica',
                        actorName,
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, supabase, pushNotification]);

    // Supabase Realtime: listen for boss battle updates
    useEffect(() => {
        if (!user) return;

        const channel = supabase
            .channel('social-bossbattles')
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'bossBattles',
                },
                (payload) => {
                    const record = payload.new as { id?: string; status?: string; title?: string; currentHp?: number; totalHp?: number };
                    if (!record) return;

                    if (record.status === 'defeated') {
                        pushNotification({
                            type: 'boss_battle_ending',
                            title: 'Boss sconfitto!',
                            message: `${record.title || 'Il Boss'} e' stato sconfitto dal team!`,
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, supabase, pushNotification]);

    // Supabase Realtime: listen for new seasonal events
    useEffect(() => {
        if (!user) return;

        const channel = supabase
            .channel('social-seasonal')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'seasonalEvents',
                },
                (payload) => {
                    const record = payload.new as { title?: string; description?: string; xpMultiplier?: number; coinsMultiplier?: number };
                    if (!record) return;

                    const multiplierMsg = [];
                    if (record.xpMultiplier && record.xpMultiplier > 1) multiplierMsg.push(`XP x${record.xpMultiplier}`);
                    if (record.coinsMultiplier && record.coinsMultiplier > 1) multiplierMsg.push(`Coins x${record.coinsMultiplier}`);

                    pushNotification({
                        type: 'seasonal_event',
                        title: 'Evento stagionale iniziato!',
                        message: `${record.title || 'Nuovo evento'} — ${multiplierMsg.length > 0 ? multiplierMsg.join(' + ') + '!' : record.description || 'Partecipa ora!'}`,
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, supabase, pushNotification]);

    // Periodic check: boss battle ending soon
    useEffect(() => {
        if (!user) return;

        const checkBossBattle = async () => {
            try {
                const { data } = await supabase
                    .from('bossBattles')
                    .select('id, title, endTime, status')
                    .eq('status', 'active')
                    .limit(1)
                    .single();

                if (!data) return;

                const endTime = new Date(data.endTime).getTime();
                const now = Date.now();
                const hoursLeft = (endTime - now) / (1000 * 60 * 60);

                // Notify when < 2 hours left (only once per battle)
                if (hoursLeft > 0 && hoursLeft <= 2 && !bossNotifiedRef.current.has(data.id)) {
                    bossNotifiedRef.current.add(data.id);
                    const timeStr = hoursLeft < 1
                        ? `${Math.round(hoursLeft * 60)} minuti`
                        : `${Math.round(hoursLeft)} ore`;

                    pushNotification({
                        type: 'boss_battle_ending',
                        title: `Boss Battle: ${timeStr} rimast${hoursLeft < 1 ? 'i' : 'e'}!`,
                        message: `${data.title} — Sbrigati a contribuire prima che scada!`,
                    });
                }
            } catch {
                // No active boss battle — ignore
            }
        };

        checkBossBattle();
        const interval = setInterval(checkBossBattle, BOSS_CHECK_INTERVAL);
        return () => clearInterval(interval);
    }, [user, supabase, pushNotification]);

    const handleDismiss = useCallback((id: string) => {
        setQueue(prev => prev.filter(t => t.id !== id));
    }, []);

    const visibleToasts = queue.slice(-MAX_VISIBLE);

    return (
        <>
            {children}
            {visibleToasts.map((toast, i) => (
                <SocialNotificationToast
                    key={toast.id}
                    data={toast}
                    onDismiss={handleDismiss}
                    index={i}
                />
            ))}
        </>
    );
}
