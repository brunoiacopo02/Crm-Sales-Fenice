import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

// 10 boss avventura — ogni 10 stadi
const bosses = [
    {
        id: 'boss-01', stageNumber: 10, name: 'Lupo Ombra',
        description: 'Un lupo spettrale avvolto nelle tenebre, i suoi occhi brillano di rosso sangue nella notte eterna',
        totalHp: 300, element: 'fuoco',
        rewardCreatureId: 'e-001', rewardCoins: 200, rewardTitle: 'Domatore di Ombre'
    },
    {
        id: 'boss-02', stageNumber: 20, name: 'Toro Pietra',
        description: 'Colosso di granito vivente, le sue cariche fanno tremare la terra per chilometri',
        totalHp: 500, element: 'terra',
        rewardCreatureId: 'e-002', rewardCoins: 350, rewardTitle: 'Spaccapietre'
    },
    {
        id: 'boss-03', stageNumber: 30, name: 'Serpente Velenoso',
        description: 'Serpente marino gigante il cui veleno corrompe le acque per leghe intere',
        totalHp: 700, element: 'acqua',
        rewardCreatureId: 'e-005', rewardCoins: 500, rewardTitle: 'Cacciatore di Serpenti'
    },
    {
        id: 'boss-04', stageNumber: 40, name: 'Aquila Ghiaccio',
        description: 'Rapace ancestrale le cui ali generano bufere di neve e grandine mortale',
        totalHp: 900, element: 'aria',
        rewardCreatureId: 'e-004', rewardCoins: 650, rewardTitle: 'Signore dei Cieli'
    },
    {
        id: 'boss-05', stageNumber: 50, name: 'Drago Rosso',
        description: 'Il terrore dei cieli, un drago antico il cui fuoco fonde la roccia stessa',
        totalHp: 1200, element: 'fuoco',
        rewardCreatureId: 'l-001', rewardCoins: 1000, rewardTitle: 'Uccisore di Draghi'
    },
    {
        id: 'boss-06', stageNumber: 60, name: 'Scorpione Oro',
        description: 'Scorpione gigante con esoscheletro d\'oro massiccio e coda avvelenata',
        totalHp: 1500, element: 'terra',
        rewardCreatureId: 'e-012', rewardCoins: 800, rewardTitle: 'Conquistatore del Deserto'
    },
    {
        id: 'boss-07', stageNumber: 70, name: 'Kraken',
        description: 'Mostro degli abissi con tentacoli che possono inghiottire intere navi',
        totalHp: 2000, element: 'acqua',
        rewardCreatureId: 'e-009', rewardCoins: 1200, rewardTitle: 'Terrore degli Abissi'
    },
    {
        id: 'boss-08', stageNumber: 80, name: 'Fenice Oscura',
        description: 'Versione corrotta della Fenice, rinasce dalle cenere nere portando distruzione',
        totalHp: 2500, element: 'ombra',
        rewardCreatureId: 'l-004', rewardCoins: 1500, rewardTitle: 'Purificatore di Ombre'
    },
    {
        id: 'boss-09', stageNumber: 90, name: 'Chimera Ancestrale',
        description: 'La Chimera originale, madre di tutte le bestie mitologiche, con tre teste elementali',
        totalHp: 3000, element: 'luce',
        rewardCreatureId: 'e-011', rewardCoins: 2000, rewardTitle: 'Leggenda Vivente'
    },
    {
        id: 'boss-10', stageNumber: 100, name: 'Divinita del Fuoco',
        description: 'L\'entita suprema, nata dalla prima fiamma dell\'universo. Solo i veri campioni possono sfidarla',
        totalHp: 5000, element: 'fuoco',
        rewardCreatureId: 'l-003', rewardCoins: 5000, rewardTitle: 'Campione della Fenice'
    },
];

export async function GET() {
    try {
        console.log(`Seeding ${bosses.length} adventure bosses...`);

        for (const b of bosses) {
            await db.execute(sql`
                INSERT INTO "adventureBosses" (id, "stageNumber", name, description, "imageUrl", "totalHp", element, "rewardCreatureId", "rewardCoins", "rewardTitle")
                VALUES (${b.id}, ${b.stageNumber}, ${b.name}, ${b.description}, ${null}, ${b.totalHp}, ${b.element}, ${b.rewardCreatureId}, ${b.rewardCoins}, ${b.rewardTitle})
                ON CONFLICT (id) DO NOTHING
            `);
        }

        console.log("Seed boss completato!");
        return NextResponse.json({
            success: true,
            message: `Seed completato: ${bosses.length} boss avventura (stage 10-100)`,
            total: bosses.length
        });
    } catch (error) {
        console.error("Errore seed boss:", error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
