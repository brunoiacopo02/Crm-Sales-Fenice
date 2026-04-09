import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        console.log("Seeding Venditori achievements...");

        // Seed 8 Venditori-specific achievements across 3 categories
        await db.execute(sql`
            INSERT INTO achievements (id, name, description, icon, category, metric, "tier1Target", "tier2Target", "tier3Target")
            VALUES
                -- CLOSER: deal chiusi (3 tiers)
                ('ach-vend-closer-1', 'Closer', 'Chiudi i deal con determinazione', 'HandshakeIcon', 'venditori_chiusure', 'total_deals_chiusi', 10, 50, 100),

                -- FATTURATORE: fatturato EUR (3 tiers)
                ('ach-vend-fatturatore-1', 'Fatturatore', 'Il fatturato parla per te', 'Euro', 'venditori_fatturato', 'total_fatturato_eur', 10000, 50000, 100000),

                -- PERSUASORE: tasso chiusura % (3 tiers)
                ('ach-vend-persuasore-1', 'Persuasore', 'Il tuo tasso di chiusura è impressionante', 'TrendingUp', 'venditori_conversione', 'tasso_chiusura_percent', 70, 80, 90),

                -- Extra achievements for depth (5 more)
                ('ach-vend-macchina-vendite', 'Macchina da Vendite', 'Non ti fermi mai: deal a raffica!', 'Zap', 'venditori_chiusure', 'total_deals_chiusi', 150, 300, 500),
                ('ach-vend-milionario', 'Milionario', 'Il tuo fatturato supera ogni aspettativa', 'Crown', 'venditori_fatturato', 'total_fatturato_eur', 200000, 500000, 1000000),
                ('ach-vend-inarrestabile', 'Inarrestabile', 'Chiudi quasi tutto quello che tocchi', 'Flame', 'venditori_conversione', 'tasso_chiusura_percent', 85, 92, 98),
                ('ach-vend-primo-deal', 'Primo Deal', 'Il primo deal non si scorda mai', 'Star', 'venditori_chiusure', 'total_deals_chiusi', 1, 5, 20),
                ('ach-vend-broker', 'Broker', 'Fattura come un professionista', 'Briefcase', 'venditori_fatturato', 'total_fatturato_eur', 5000, 25000, 75000)
            ON CONFLICT (id) DO NOTHING
        `);

        console.log("Venditori achievements seeded successfully!");
        return NextResponse.json({ success: true, message: "8 Venditori achievements seeded." });
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error("Errore seed achievements venditori:", e);
        return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
    }
}
