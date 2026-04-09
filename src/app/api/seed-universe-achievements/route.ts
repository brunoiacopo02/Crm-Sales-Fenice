import { NextResponse } from 'next/server';
import { db } from "@/db";
import { achievements } from "@/db/schema";
import { sql } from "drizzle-orm";

const UNIVERSE_ACHIEVEMENTS = [
    // Boss defeated
    { id: 'ach-boss-1', name: 'Primo Boss Sconfitto', description: 'Sconfiggi il tuo primo boss nell\'avventura', icon: 'Sword', category: 'universe', metric: 'total_bosses_defeated', tier1Target: 1, tier2Target: 3, tier3Target: 5 },
    { id: 'ach-boss-2', name: 'Cacciatore di Boss', description: 'Sconfiggi 5 boss nell\'avventura', icon: 'Shield', category: 'universe', metric: 'total_bosses_defeated', tier1Target: 5, tier2Target: 7, tier3Target: 10 },
    // Creature collection
    { id: 'ach-creature-1', name: 'Collezionista Novizio', description: 'Possiedi 10 creature nel tuo inventario', icon: 'Sparkles', category: 'universe', metric: 'total_creatures_owned', tier1Target: 10, tier2Target: 20, tier3Target: 30 },
    { id: 'ach-creature-2', name: 'Collezionista Esperto', description: 'Possiedi 30 creature nel tuo inventario', icon: 'Sparkles', category: 'universe', metric: 'total_creatures_owned', tier1Target: 30, tier2Target: 45, tier3Target: 60 },
    // Trading
    { id: 'ach-trade-1', name: 'Commerciante', description: 'Completa il tuo primo scambio di creature', icon: 'ArrowLeftRight', category: 'universe', metric: 'total_trades_completed', tier1Target: 1, tier2Target: 5, tier3Target: 10 },
    { id: 'ach-trade-2', name: 'Mercante', description: 'Completa 10 scambi di creature', icon: 'ArrowLeftRight', category: 'universe', metric: 'total_trades_completed', tier1Target: 10, tier2Target: 20, tier3Target: 50 },
    // Duels
    { id: 'ach-duel-1', name: 'Duellante', description: 'Vinci il tuo primo duello 1v1', icon: 'Swords', category: 'universe', metric: 'total_duels_won', tier1Target: 1, tier2Target: 3, tier3Target: 5 },
    { id: 'ach-duel-2', name: 'Campione Arena', description: 'Vinci 10 duelli 1v1', icon: 'Trophy', category: 'universe', metric: 'total_duels_won', tier1Target: 10, tier2Target: 20, tier3Target: 50 },
];

export async function GET() {
    try {
        for (const ach of UNIVERSE_ACHIEVEMENTS) {
            await db.execute(sql`
                INSERT INTO achievements (id, name, description, icon, category, metric, "tier1Target", "tier2Target", "tier3Target")
                VALUES (${ach.id}, ${ach.name}, ${ach.description}, ${ach.icon}, ${ach.category}, ${ach.metric}, ${ach.tier1Target}, ${ach.tier2Target}, ${ach.tier3Target})
                ON CONFLICT (id) DO NOTHING
            `);
        }

        return NextResponse.json({ success: true, message: `${UNIVERSE_ACHIEVEMENTS.length} Universe achievements seeded` });
    } catch (error) {
        console.error("Errore seed Universe achievements:", error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
