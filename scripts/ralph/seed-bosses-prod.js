const { Pool } = require('pg');
const pool = new Pool({
    connectionString: 'postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

const bosses = [
    { id: 'boss-01', stageNumber: 10, name: 'Lupo Ombra', description: 'Un lupo spettrale avvolto nelle tenebre', totalHp: 300, element: 'fuoco', rewardCreatureId: 'e-001', rewardCoins: 200, rewardTitle: 'Domatore di Ombre' },
    { id: 'boss-02', stageNumber: 20, name: 'Toro Pietra', description: 'Colosso di granito vivente', totalHp: 500, element: 'terra', rewardCreatureId: 'e-002', rewardCoins: 350, rewardTitle: 'Spaccapietre' },
    { id: 'boss-03', stageNumber: 30, name: 'Serpente Velenoso', description: 'Serpente marino gigante il cui veleno corrompe le acque', totalHp: 700, element: 'acqua', rewardCreatureId: 'e-005', rewardCoins: 500, rewardTitle: 'Cacciatore di Serpenti' },
    { id: 'boss-04', stageNumber: 40, name: 'Aquila Ghiaccio', description: 'Rapace ancestrale le cui ali generano bufere', totalHp: 900, element: 'aria', rewardCreatureId: 'e-004', rewardCoins: 650, rewardTitle: 'Signore dei Cieli' },
    { id: 'boss-05', stageNumber: 50, name: 'Drago Rosso', description: 'Drago antico il cui fuoco fonde la roccia', totalHp: 1200, element: 'fuoco', rewardCreatureId: 'l-001', rewardCoins: 1000, rewardTitle: 'Uccisore di Draghi' },
    { id: 'boss-06', stageNumber: 60, name: 'Scorpione Oro', description: 'Scorpione gigante con esoscheletro d\'oro massiccio', totalHp: 1500, element: 'terra', rewardCreatureId: 'e-012', rewardCoins: 800, rewardTitle: 'Conquistatore del Deserto' },
    { id: 'boss-07', stageNumber: 70, name: 'Kraken', description: 'Mostro degli abissi con tentacoli giganteschi', totalHp: 2000, element: 'acqua', rewardCreatureId: 'e-009', rewardCoins: 1200, rewardTitle: 'Terrore degli Abissi' },
    { id: 'boss-08', stageNumber: 80, name: 'Fenice Oscura', description: 'Versione corrotta della Fenice, rinasce dalle cenere nere', totalHp: 2500, element: 'ombra', rewardCreatureId: 'l-004', rewardCoins: 1500, rewardTitle: 'Purificatore di Ombre' },
    { id: 'boss-09', stageNumber: 90, name: 'Chimera Ancestrale', description: 'La Chimera originale, madre di tutte le bestie mitologiche', totalHp: 3000, element: 'luce', rewardCreatureId: 'e-011', rewardCoins: 2000, rewardTitle: 'Leggenda Vivente' },
    { id: 'boss-10', stageNumber: 100, name: 'Divinita del Fuoco', description: 'L\'entita suprema, nata dalla prima fiamma dell\'universo', totalHp: 5000, element: 'fuoco', rewardCreatureId: 'l-003', rewardCoins: 5000, rewardTitle: 'Campione della Fenice' },
];

async function seed() {
    const client = await pool.connect();
    try {
        for (const b of bosses) {
            await client.query(
                `INSERT INTO "adventureBosses" (id, "stageNumber", name, description, "imageUrl", "totalHp", element, "rewardCreatureId", "rewardCoins", "rewardTitle")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 ON CONFLICT (id) DO NOTHING`,
                [b.id, b.stageNumber, b.name, b.description, null, b.totalHp, b.element, b.rewardCreatureId, b.rewardCoins, b.rewardTitle]
            );
        }
        console.log('Seeded ' + bosses.length + ' bosses');

        const res = await client.query('SELECT id, name, "stageNumber", "totalHp" FROM "adventureBosses" ORDER BY "stageNumber"');
        console.log('Bosses:', res.rows.map(r => `Stage ${r.stageNumber}: ${r.name} (${r.totalHp}HP)`));
    } finally {
        client.release();
        await pool.end();
    }
}

seed().catch(e => { console.error(e); process.exit(1); });
