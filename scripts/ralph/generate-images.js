const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = 'AIzaSyB3bYcpHcRZRPcY6q2JDaMXM-jDMS99I38';
const MODEL = 'gemini-2.5-flash-image';
const BASE_DIR = path.join(__dirname, '..', '..', 'public', 'assets');

// Ensure directories
['creatures', 'bosses', 'gamification'].forEach(d => {
    const dir = path.join(BASE_DIR, d);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const STYLE = 'fantasy cartoon game art style, vibrant colors, dark background, centered composition, high quality, no text';

const CREATURES = [
    // Legendary (all 6)
    { id: 'l-001', name: 'Fenice Imperiale', prompt: `A majestic imperial phoenix with golden crown, massive flaming wings spread wide, royal red and gold plumage, divine aura, ${STYLE}` },
    { id: 'l-002', name: 'Drago Celeste', prompt: `A celestial sky dragon made of clouds and lightning, ethereal blue-white scales, flowing mane of wind, stars in its eyes, ${STYLE}` },
    { id: 'l-003', name: 'Divinita del Fuoco', prompt: `A fire deity creature, humanoid phoenix form engulfed in white-hot flames, molten gold armor, godlike presence, ${STYLE}` },
    { id: 'l-004', name: 'Titano Fiamma', prompt: `A colossal flame titan, body of living magma and obsidian, towering presence, volcanic eruptions on shoulders, ${STYLE}` },
    { id: 'l-005', name: 'Araldo Supremo', prompt: `A supreme herald of light, angelic winged creature with six golden wings, radiant halo, holding a luminous scepter, ${STYLE}` },
    { id: 'l-006', name: 'Fenice Eterna', prompt: `An eternal phoenix reborn from cosmic fire, nebula-colored feathers of purple and gold, infinite loop of flame around body, ${STYLE}` },
    // Epic (8 most iconic)
    { id: 'e-001', name: 'Fenice Guerriera', prompt: `A warrior phoenix in battle armor, fiery red feathers, sharp talons, determined eyes, battle scars, ${STYLE}` },
    { id: 'e-002', name: 'Serpente Oro', prompt: `A golden serpent with jeweled scales, coiled around a crystal, earth element, emerald eyes, ${STYLE}` },
    { id: 'e-004', name: 'Grifone Reale', prompt: `A royal griffin with eagle head and lion body, golden feathers and brown fur, wind element, majestic pose, ${STYLE}` },
    { id: 'e-005', name: 'Hydra Marina', prompt: `A three-headed water hydra, deep blue scales, bioluminescent markings, ocean waves splashing, ${STYLE}` },
    { id: 'e-007', name: 'Basilisco Tenebra', prompt: `A shadow basilisk with glowing purple eyes, dark scales that absorb light, venomous aura, ${STYLE}` },
    { id: 'e-008', name: 'Minotauro Vulcano', prompt: `A volcanic minotaur with molten lava veins, obsidian horns, fire breathing, muscular build, ${STYLE}` },
    { id: 'e-011', name: 'Sfinge Cosmica', prompt: `A cosmic sphinx with starfield fur, golden mask, light element, mysterious gaze, galaxies in eyes, ${STYLE}` },
    { id: 'e-013', name: 'Kitsune Nove Code', prompt: `A nine-tailed fire fox kitsune, each tail a different flame color, mischievous smile, Japanese inspired, ${STYLE}` },
    // Rare (8 distributed)
    { id: 'r-001', name: 'Drago Ambra', prompt: `A young amber dragon, warm orange scales, small wings, friendly expression, fire element, chibi proportions, ${STYLE}` },
    { id: 'r-002', name: 'Lupo Fuoco', prompt: `A fire wolf with flame mane, red-orange fur, fierce eyes, running pose, ember trail, ${STYLE}` },
    { id: 'r-003', name: 'Aquila Dorata', prompt: `A golden eagle with metallic feathers, wind element, spread wings, sharp talons, sunlit glow, ${STYLE}` },
    { id: 'r-005', name: 'Cervo Cristallo', prompt: `A crystal deer with translucent antlers made of light, gentle expression, aurora borealis effect, ${STYLE}` },
    { id: 'r-007', name: 'Orso Ghiaccio', prompt: `An ice bear with frost armor, pale blue fur, snowflakes floating around, water element, ${STYLE}` },
    { id: 'r-009', name: 'Leone Sabbia', prompt: `A sand lion with golden mane made of sandstorm, earth element, desert warrior pose, ${STYLE}` },
    { id: 'r-012', name: 'Pantera Ombra', prompt: `A shadow panther dissolving into darkness, purple-black fur, glowing violet eyes, stealthy, ${STYLE}` },
    { id: 'r-016', name: 'Lince Aurora', prompt: `An aurora lynx with fur that shimmers like northern lights, green and pink gradient, light element, ${STYLE}` },
];

const BOSSES = [
    { stage: 10, name: 'Lupo Ombra', prompt: `An epic dark fantasy shadow wolf boss, massive size, glowing red eyes, body made of fire and shadow, menacing snarl, ${STYLE}` },
    { stage: 20, name: 'Toro Pietra', prompt: `An epic stone bull boss creature, body of cracked granite with glowing lava veins, massive horns, earth element, ${STYLE}` },
    { stage: 30, name: 'Serpente Velenoso', prompt: `An epic venomous sea serpent boss, enormous coiled body, bioluminescent blue scales, water element, fangs dripping, ${STYLE}` },
    { stage: 40, name: 'Aquila Ghiaccio', prompt: `An epic frost eagle boss, giant wingspan, feathers of ice crystals, blizzard around it, air element, piercing blue eyes, ${STYLE}` },
    { stage: 50, name: 'Drago Rosso', prompt: `An epic red dragon boss, massive and terrifying, breathing white-hot fire, golden treasure hoard, battle-scarred scales, ${STYLE}` },
    { stage: 60, name: 'Scorpione Oro', prompt: `An epic golden scorpion boss, armored with gold plating, venomous crystal tail, earth element, desert emperor, ${STYLE}` },
    { stage: 70, name: 'Kraken', prompt: `An epic kraken boss, enormous tentacles rising from dark water, bioluminescent suckers, ancient and terrifying, ${STYLE}` },
    { stage: 80, name: 'Fenice Oscura', prompt: `An epic dark phoenix boss, corrupted with shadow flames, purple-black fire wings, once majestic now twisted, ${STYLE}` },
    { stage: 90, name: 'Chimera', prompt: `An epic chimera boss with lion head, goat body, serpent tail, radiant light element, holy golden aura, three heads, ${STYLE}` },
    { stage: 100, name: 'Divinita del Fuoco', prompt: `The ultimate fire god boss, towering entity of pure divine flame, multiple arms, cosmic fire crown, final boss energy, most epic and powerful, ${STYLE}` },
];

const EXTRA = [
    { file: 'gamification/script-master-badge.png', prompt: `A golden badge icon for "Script Master" achievement in a CRM game, headset with microphone, flame accents, premium RPG style, ${STYLE}` },
    { file: 'gamification/script-streak-badge.png', prompt: `A flame streak badge for consistent script usage in a CRM game, numbered "5" in center, fire trail, combo counter style, ${STYLE}` },
    { file: 'gamification/quest-scroll.png', prompt: `A fantasy quest scroll icon, slightly unrolled parchment with golden seal, RPG game UI element, ${STYLE}` },
    { file: 'gamification/treasure-chest.png', prompt: `A fantasy treasure chest icon, wooden with golden bands, slightly open with golden light emanating, RPG style, ${STYLE}` },
];

function generateImage(prompt) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        });
        const req = https.request({
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => {
                try {
                    const r = JSON.parse(data);
                    if (r.error) return reject(new Error(r.error.message.substring(0, 150)));
                    const parts = r.candidates?.[0]?.content?.parts || [];
                    const imgPart = parts.find(p => p.inlineData);
                    if (imgPart) {
                        resolve(Buffer.from(imgPart.inlineData.data, 'base64'));
                    } else {
                        reject(new Error('No image in response'));
                    }
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    let success = 0, failed = 0;
    const total = CREATURES.length + BOSSES.length + EXTRA.length;
    console.log(`Generating ${total} images...\n`);

    // Creatures
    for (const c of CREATURES) {
        const outPath = path.join(BASE_DIR, 'creatures', `creature-${c.id}.png`);
        if (fs.existsSync(outPath)) { console.log(`SKIP ${c.name} (exists)`); success++; continue; }
        try {
            process.stdout.write(`[${success+failed+1}/${total}] ${c.name}... `);
            const buf = await generateImage(c.prompt);
            fs.writeFileSync(outPath, buf);
            console.log(`OK (${Math.round(buf.length/1024)}KB)`);
            success++;
        } catch (e) {
            console.log(`FAIL: ${e.message.substring(0, 80)}`);
            failed++;
        }
        await sleep(2000); // Rate limit: ~30 req/min
    }

    // Bosses
    for (const b of BOSSES) {
        const outPath = path.join(BASE_DIR, 'bosses', `boss-${b.stage}.png`);
        if (fs.existsSync(outPath)) { console.log(`SKIP Boss ${b.name} (exists)`); success++; continue; }
        try {
            process.stdout.write(`[${success+failed+1}/${total}] Boss: ${b.name}... `);
            const buf = await generateImage(b.prompt);
            fs.writeFileSync(outPath, buf);
            console.log(`OK (${Math.round(buf.length/1024)}KB)`);
            success++;
        } catch (e) {
            console.log(`FAIL: ${e.message.substring(0, 80)}`);
            failed++;
        }
        await sleep(2000);
    }

    // Extra gamification assets
    for (const x of EXTRA) {
        const outPath = path.join(BASE_DIR, x.file);
        if (fs.existsSync(outPath)) { console.log(`SKIP ${x.file} (exists)`); success++; continue; }
        try {
            process.stdout.write(`[${success+failed+1}/${total}] ${x.file}... `);
            const buf = await generateImage(x.prompt);
            fs.writeFileSync(outPath, buf);
            console.log(`OK (${Math.round(buf.length/1024)}KB)`);
            success++;
        } catch (e) {
            console.log(`FAIL: ${e.message.substring(0, 80)}`);
            failed++;
        }
        await sleep(2000);
    }

    console.log(`\nDone! Success: ${success}, Failed: ${failed}`);
}

main().catch(console.error);
