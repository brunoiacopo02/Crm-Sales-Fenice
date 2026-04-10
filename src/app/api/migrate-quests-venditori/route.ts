import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        // Seed VENDITORE quest templates (6 daily + 3 weekly)
        await db.execute(sql`
            INSERT INTO quests (id, title, description, type, "targetMetric", "targetValue", "rewardXp", "rewardCoins", "isActive", "role")
            VALUES
                ('vend-d-deal-1', 'Primo Deal del Giorno', 'Chiudi almeno 1 deal oggi', 'daily', 'deals_chiusi', 1, 30, 20, true, 'VENDITORE'),
                ('vend-d-deal-3', 'Closer Seriale', 'Chiudi 3 deal oggi', 'daily', 'deals_chiusi', 3, 100, 60, true, 'VENDITORE'),
                ('vend-d-esiti-3', 'Registra 3 Esiti', 'Registra l''esito per almeno 3 lead oggi', 'daily', 'esiti_registrati', 3, 20, 15, true, 'VENDITORE'),
                ('vend-d-esiti-5', 'Registra 5 Esiti', 'Registra l''esito per almeno 5 lead oggi', 'daily', 'esiti_registrati', 5, 40, 25, true, 'VENDITORE'),
                ('vend-d-fatt-3k', 'Fattura 3.000 EUR', 'Fattura almeno 3.000 EUR oggi', 'daily', 'fatturato_eur', 3000, 60, 40, true, 'VENDITORE'),
                ('vend-d-tratt-2', 'Presenta 2 Trattative', 'Presenta almeno 2 nuove trattative oggi', 'daily', 'trattative_presentate', 2, 25, 15, true, 'VENDITORE'),
                ('vend-w-deal-5', 'Settimana da Closer', 'Chiudi almeno 5 deal questa settimana', 'weekly', 'deals_chiusi', 5, 200, 120, true, 'VENDITORE'),
                ('vend-w-fatt-15k', 'Fattura 15.000 EUR', 'Fattura almeno 15.000 EUR questa settimana', 'weekly', 'fatturato_eur', 15000, 300, 200, true, 'VENDITORE'),
                ('vend-w-esiti-15', 'Maratoneta Vendite', 'Registra almeno 15 esiti questa settimana', 'weekly', 'esiti_registrati', 15, 150, 80, true, 'VENDITORE')
            ON CONFLICT (id) DO NOTHING
        `);

        return NextResponse.json({ success: true, message: "Quest Venditori: templates seeded." });
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error("Errore migrazione quest Venditori:", e);
        return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
    }
}
