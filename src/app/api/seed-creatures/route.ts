import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

// 80 creature totali: 35 comuni, 25 rare, 14 epiche, 6 leggendarie
const creatures = [
    // === COMUNI (35) — XP +2%, Coins +1% ===
    { id: 'c-001', name: 'Fiammella', description: 'Una piccola fiamma danzante che scalda il cuore', rarity: 'common', element: 'fuoco', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-002', name: 'Brace', description: 'Carboni ardenti che non si spengono mai', rarity: 'common', element: 'fuoco', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-003', name: 'Scintilla', description: 'Un guizzo di luce elettrica che rimbalza ovunque', rarity: 'common', element: 'luce', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-004', name: 'Cenere', description: 'Residuo di antiche battaglie, ancora caldo al tatto', rarity: 'common', element: 'fuoco', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-005', name: 'Favillina', description: 'Piccola favilla che illumina il buio', rarity: 'common', element: 'luce', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-006', name: 'Lucciola', description: 'Insetto luminoso delle notti estive', rarity: 'common', element: 'luce', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-007', name: 'Bragia', description: 'Tizzone rovente che brucia senza sosta', rarity: 'common', element: 'fuoco', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-008', name: 'Tizzoncino', description: 'Piccolo carbone che cova la fiamma', rarity: 'common', element: 'fuoco', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-009', name: 'Sassolino', description: 'Pietra levigata dal fiume, dura e resistente', rarity: 'common', element: 'terra', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-010', name: 'Germoglio', description: 'Un tenero virgulto che spunta dalla terra', rarity: 'common', element: 'terra', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-011', name: 'Goccia', description: 'Una goccia d\'acqua cristallina che non cade mai', rarity: 'common', element: 'acqua', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-012', name: 'Soffio', description: 'Una brezza leggera che sussurra segreti', rarity: 'common', element: 'aria', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-013', name: 'Muschio', description: 'Soffice manto verde che copre le pietre', rarity: 'common', element: 'terra', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-014', name: 'Onda', description: 'Piccola onda che danza sulla superficie', rarity: 'common', element: 'acqua', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-015', name: 'Nebbietta', description: 'Sottile velo di nebbia che avvolge tutto', rarity: 'common', element: 'aria', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-016', name: 'Stellina', description: 'Frammento di stella caduta sulla terra', rarity: 'common', element: 'luce', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-017', name: 'Ombrina', description: 'Piccola ombra che gioca con la luce', rarity: 'common', element: 'ombra', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-018', name: 'Cristallo', description: 'Gemma trasparente che riflette l\'arcobaleno', rarity: 'common', element: 'luce', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-019', name: 'Funghetto', description: 'Piccolo fungo luminescente della foresta', rarity: 'common', element: 'terra', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-020', name: 'Bollicina', description: 'Bolla d\'aria incantata che fluttua serena', rarity: 'common', element: 'acqua', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-021', name: 'Pagliuzza', description: 'Filo d\'erba dorato mosso dal vento', rarity: 'common', element: 'terra', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-022', name: 'Zefiro', description: 'Venticello primaverile che porta fortuna', rarity: 'common', element: 'aria', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-023', name: 'Fiocco', description: 'Cristallo di neve che non si scioglie', rarity: 'common', element: 'acqua', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-024', name: 'Luccicanza', description: 'Bagliore dorato che appare al tramonto', rarity: 'common', element: 'luce', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-025', name: 'Corallo', description: 'Rametto di corallo rosso dal mare profondo', rarity: 'common', element: 'acqua', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-026', name: 'Argilla', description: 'Terra malleabile che prende qualsiasi forma', rarity: 'common', element: 'terra', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-027', name: 'Vortice', description: 'Piccolo mulinello d\'aria che gira su se stesso', rarity: 'common', element: 'aria', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-028', name: 'Penombra', description: 'Ombra delicata che danza al crepuscolo', rarity: 'common', element: 'ombra', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-029', name: 'Lapillo', description: 'Pietruzza vulcanica ancora calda', rarity: 'common', element: 'fuoco', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-030', name: 'Rugiada', description: 'Goccia mattutina che brilla come diamante', rarity: 'common', element: 'acqua', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-031', name: 'Polline', description: 'Polvere dorata portata dal vento', rarity: 'common', element: 'aria', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-032', name: 'Ghiaino', description: 'Piccola pietra di fiume liscia e tonda', rarity: 'common', element: 'terra', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-033', name: 'Lumino', description: 'Piccola lanterna che non si spegne', rarity: 'common', element: 'luce', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-034', name: 'Fumetto', description: 'Sbuffo di fumo che assume forme buffe', rarity: 'common', element: 'aria', baseXpBonus: 0.02, baseCoinBonus: 0.01 },
    { id: 'c-035', name: 'Crepuscolo', description: 'Essenza del momento tra giorno e notte', rarity: 'common', element: 'ombra', baseXpBonus: 0.02, baseCoinBonus: 0.01 },

    // === RARE (25) — XP +5%, Coins +3% ===
    { id: 'r-001', name: 'Drago Ambra', description: 'Drago dorato che custodisce tesori di resina fossile', rarity: 'rare', element: 'fuoco', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-002', name: 'Lupo Fuoco', description: 'Lupo con pelliccia di fiamme, veloce come il vento', rarity: 'rare', element: 'fuoco', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-003', name: 'Aquila Dorata', description: 'Rapace maestoso con piume che brillano al sole', rarity: 'rare', element: 'aria', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-004', name: 'Volpe Celeste', description: 'Volpe astuta con code che dipingono aurore boreali', rarity: 'rare', element: 'aria', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-005', name: 'Cervo Cristallo', description: 'Cervo con corna di cristallo che riflettono la luce', rarity: 'rare', element: 'luce', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-006', name: 'Serpente Smeraldo', description: 'Rettile sinuoso con scaglie di gemma verde', rarity: 'rare', element: 'terra', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-007', name: 'Orso Ghiaccio', description: 'Orso possente coperto di brina eterna', rarity: 'rare', element: 'acqua', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-008', name: 'Gufo Stellare', description: 'Gufo notturno i cui occhi sono costellazioni', rarity: 'rare', element: 'luce', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-009', name: 'Leone Sabbia', description: 'Leone maestoso fatto di sabbia del deserto', rarity: 'rare', element: 'terra', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-010', name: 'Falco Tempesta', description: 'Falco che cavalca i fulmini durante i temporali', rarity: 'rare', element: 'aria', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-011', name: 'Delfino Luna', description: 'Delfino che nuota tra le onde al chiaro di luna', rarity: 'rare', element: 'acqua', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-012', name: 'Pantera Ombra', description: 'Felino silenzioso che si fonde con le tenebre', rarity: 'rare', element: 'ombra', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-013', name: 'Cinghiale Ferro', description: 'Cinghiale con zanne di metallo incandescente', rarity: 'rare', element: 'terra', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-014', name: 'Civetta Nebbia', description: 'Civetta eterea che appare e scompare nella foschia', rarity: 'rare', element: 'aria', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-015', name: 'Tartaruga Marina', description: 'Tartaruga antica con guscio coperto di coralli', rarity: 'rare', element: 'acqua', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-016', name: 'Lince Aurora', description: 'Lince agile con pelliccia che cambia colore', rarity: 'rare', element: 'luce', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-017', name: 'Corvo Notturno', description: 'Corvo intelligente avvolto da un manto di stelle', rarity: 'rare', element: 'ombra', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-018', name: 'Salamandra Lava', description: 'Salamandra che vive nel magma vulcanico', rarity: 'rare', element: 'fuoco', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-019', name: 'Cavallo Vento', description: 'Destriero etereo che galoppa tra le nuvole', rarity: 'rare', element: 'aria', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-020', name: 'Toro Magma', description: 'Toro possente con corna di roccia fusa', rarity: 'rare', element: 'fuoco', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-021', name: 'Medusa Abisso', description: 'Medusa luminescente delle profondità marine', rarity: 'rare', element: 'acqua', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-022', name: 'Ragno Seta', description: 'Ragno che tesse tele di filo d\'argento', rarity: 'rare', element: 'ombra', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-023', name: 'Golem Quarzo', description: 'Colosso di pietra con cuore di cristallo', rarity: 'rare', element: 'terra', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-024', name: 'Fenicottero Rosa', description: 'Uccello elegante con piume infuocate', rarity: 'rare', element: 'fuoco', baseXpBonus: 0.05, baseCoinBonus: 0.03 },
    { id: 'r-025', name: 'Pipistrello Eclissi', description: 'Pipistrello che vola solo durante le eclissi', rarity: 'rare', element: 'ombra', baseXpBonus: 0.05, baseCoinBonus: 0.03 },

    // === EPICHE (14) — XP +10%, Coins +5% ===
    { id: 'e-001', name: 'Fenice Guerriera', description: 'Fenice in armatura di fiamme, inarrestabile in battaglia', rarity: 'epic', element: 'fuoco', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-002', name: 'Serpente Oro', description: 'Serpente leggendario con scaglie d\'oro puro', rarity: 'epic', element: 'terra', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-003', name: 'Chimera Tempesta', description: 'Bestia mitologica con tre teste elementali', rarity: 'epic', element: 'aria', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-004', name: 'Grifone Reale', description: 'Grifone con ali d\'aquila e corpo di leone dorato', rarity: 'epic', element: 'aria', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-005', name: 'Hydra Marina', description: 'Hydra a sette teste che domina gli oceani', rarity: 'epic', element: 'acqua', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-006', name: 'Unicorno Astrale', description: 'Unicorno con corno che emette luce stellare', rarity: 'epic', element: 'luce', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-007', name: 'Basilisco Tenebra', description: 'Re dei serpenti il cui sguardo pietrifica', rarity: 'epic', element: 'ombra', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-008', name: 'Minotauro Vulcano', description: 'Minotauro nato dal cuore di un vulcano attivo', rarity: 'epic', element: 'fuoco', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-009', name: 'Leviatano Glaciale', description: 'Mostro marino delle acque artiche eterne', rarity: 'epic', element: 'acqua', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-010', name: 'Pegaso Fulmine', description: 'Cavallo alato che cavalca i lampi nelle tempeste', rarity: 'epic', element: 'aria', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-011', name: 'Sfinge Cosmica', description: 'Guardiana degli enigmi tra le stelle', rarity: 'epic', element: 'luce', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-012', name: 'Golem Diamante', description: 'Colosso indistruttibile fatto di diamante puro', rarity: 'epic', element: 'terra', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-013', name: 'Kitsune Nove Code', description: 'Volpe mistica con nove code di fuoco sacro', rarity: 'epic', element: 'fuoco', baseXpBonus: 0.10, baseCoinBonus: 0.05 },
    { id: 'e-014', name: 'Drago Spettrale', description: 'Drago fantasma che si manifesta dal reame delle ombre', rarity: 'epic', element: 'ombra', baseXpBonus: 0.10, baseCoinBonus: 0.05 },

    // === LEGGENDARIE (6) — XP +15%, Coins +10% ===
    { id: 'l-001', name: 'Fenice Imperiale', description: 'La Fenice suprema, sovrana di tutti gli elementi. Rinasce dalle ceneri con potenza devastante', rarity: 'legendary', element: 'fuoco', baseXpBonus: 0.15, baseCoinBonus: 0.10 },
    { id: 'l-002', name: 'Drago Celeste', description: 'Drago primordiale che governa i cieli e comanda le tempeste', rarity: 'legendary', element: 'aria', baseXpBonus: 0.15, baseCoinBonus: 0.10 },
    { id: 'l-003', name: 'Divinita del Fuoco', description: 'Entità ancestrale nata dalla prima fiamma dell\'universo', rarity: 'legendary', element: 'fuoco', baseXpBonus: 0.15, baseCoinBonus: 0.10 },
    { id: 'l-004', name: 'Titano Fiamma', description: 'Gigante primordiale il cui corpo è un inferno vivente', rarity: 'legendary', element: 'fuoco', baseXpBonus: 0.15, baseCoinBonus: 0.10 },
    { id: 'l-005', name: 'Araldo Supremo', description: 'Messaggero divino che annuncia le ere di gloria', rarity: 'legendary', element: 'luce', baseXpBonus: 0.15, baseCoinBonus: 0.10 },
    { id: 'l-006', name: 'Fenice Eterna', description: 'La Fenice che trascende il tempo stesso, immortale e onnisciente', rarity: 'legendary', element: 'luce', baseXpBonus: 0.15, baseCoinBonus: 0.10 },
];

export async function GET() {
    try {
        console.log(`Seeding ${creatures.length} creature...`);

        let inserted = 0;
        for (const c of creatures) {
            const result = await db.execute(sql`
                INSERT INTO creatures (id, name, description, rarity, element, "imageUrl", "baseXpBonus", "baseCoinBonus", "maxLevel", "isActive")
                VALUES (${c.id}, ${c.name}, ${c.description}, ${c.rarity}, ${c.element}, ${null}, ${c.baseXpBonus}, ${c.baseCoinBonus}, ${10}, ${true})
                ON CONFLICT (id) DO NOTHING
            `);
            inserted++;
        }

        console.log(`Seed completato: ${inserted} creature processate`);
        return NextResponse.json({
            success: true,
            message: `Seed completato: ${creatures.length} creature (35 comuni, 25 rare, 14 epiche, 6 leggendarie)`,
            total: creatures.length
        });
    } catch (error) {
        console.error("Errore seed creature:", error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
