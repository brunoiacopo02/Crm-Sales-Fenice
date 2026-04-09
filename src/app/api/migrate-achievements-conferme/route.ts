import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        // Seed 8 Conferme-specific achievements across 4 categories
        await db.execute(sql`
            INSERT INTO achievements (id, name, description, icon, category, metric, "tier1Target", "tier2Target", "tier3Target")
            VALUES
                -- CONFERMATORE: conferme fatte (3 tiers)
                ('ach-conf-confermatore-1', 'Confermatore', 'Conferma appuntamenti con precisione', 'CheckCircle', 'conferme', 'total_conferme', 50, 200, 500),

                -- SENTINELLA: chiamate conferme (3 tiers)
                ('ach-conf-sentinella-1', 'Sentinella', 'Ogni chiamata è un passo verso la conferma', 'PhoneCall', 'conferme_calls', 'total_conferme_chiamate', 100, 500, 1000),

                -- RECUPERATORE: richiami andati a buon fine (3 tiers)
                ('ach-conf-recuperatore-1', 'Recuperatore', 'Recupera i lead dal limbo dei richiami', 'RefreshCw', 'conferme_richiami', 'total_conferme_richiami_ok', 10, 50, 100),

                -- PRECISIONE CHIRURGICA: tasso conferma % (3 tiers)
                ('ach-conf-precisione-1', 'Precisione Chirurgica', 'Il tuo tasso di conferma è impressionante', 'Crosshair', 'conferme_precisione', 'tasso_conferma_percent', 80, 90, 95),

                -- Extra achievements for depth (4 more)
                ('ach-conf-maratoneta-conf', 'Maratoneta delle Conferme', 'Non ti fermi mai: conferme a raffica!', 'Zap', 'conferme', 'total_conferme', 750, 1000, 2000),
                ('ach-conf-centralino-conf', 'Centralino Conferme', 'Il telefono non smette mai di squillare', 'Headphones', 'conferme_calls', 'total_conferme_chiamate', 2000, 5000, 10000),
                ('ach-conf-salvatore', 'Salvatore', 'Nessun richiamo è perso con te', 'LifeBuoy', 'conferme_richiami', 'total_conferme_richiami_ok', 150, 300, 500),
                ('ach-conf-cecchino', 'Cecchino', 'Ogni colpo va a segno: conferma quasi tutto', 'Target', 'conferme_precisione', 'tasso_conferma_percent', 85, 92, 98)
            ON CONFLICT (id) DO NOTHING
        `);

        return NextResponse.json({ success: true, message: "8 Conferme achievements seeded." });
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error("Errore seed achievements conferme:", e);
        return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
    }
}
