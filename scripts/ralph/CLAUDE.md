# Ralph Agent Instructions — CRM Fenice Addiction Redesign

Sei un agente di coding autonomo che lavora sul progetto CRM Fenice. Questa run e' dedicata al REDESIGN VISIVO COMPLETO della gamification e dell'UI per renderla immersiva come un gioco mobile (Clash Royale, Duolingo). Lavori SOLO in locale, NON fai deploy.

## Contesto Progetto

CRM Fenice: Next.js 16 (App Router), Tailwind CSS v4, Supabase (PostgreSQL), Drizzle ORM. Leggi il CLAUDE.md nella root del progetto per regole di codifica.

## Principi di Design OBBLIGATORI

1. **La Pipeline Chiamate e' SACRA**: non modificare MAI la logica della pipeline. Solo restyling visivo delle card e del layout. La pipeline resta AL CENTRO della pagina, chiara e leggibile.
2. **Produttivita' prima di tutto**: ogni elemento gamification deve incentivare un'AZIONE PRODUTTIVA (chiamata, fissaggio, conferma). Zero reward per azioni passive.
3. **Solo GDO e CONFERME**: la gamification visiva si applica solo a questi due ruoli. VENDITORE e MANAGER/TL vedono la versione pulita. Il TL deve poter controllare tutto dal suo pannello.
4. **Warm, non freddo**: palette calda (fuoco, oro, ambra su sfondo scuro premium). Mai grigi piatti. Ispirazione: Clash Royale (giallo primario, verde secondario), Genshin Impact (card con glow).
5. **SafeWrapper SEMPRE**: ogni componente gamification DEVE essere wrappato in `<SafeWrapper>` (gia' creato in src/components/SafeWrapper.tsx). Se crasha, la pagina continua a funzionare.
6. **walletCoins, non coins**: il campo corretto per i coins visibili e' `walletCoins` nella tabella users. MAI usare il campo `coins` (legacy). Lo store usa `walletCoins`. Le transazioni vanno loggate in `coinTransactions`.

## Psicologia da Applicare

- **Anticipazione > Ricompensa**: la dopamina si rilascia PRIMA del reward. Creare suspense (countdown, shake, glow crescente) prima di mostrare il premio.
- **Variable Ratio Reward**: reward random sono piu' addictive di quelli fissi. I loot drop devono avere rarita' casuali.
- **Loss Aversion**: la paura di perdere la streak motiva piu' del guadagno. La fiamma della streak deve sembrare "viva" e il suo spegnimento deve essere drammatico.
- **Progress Endowment**: mostrare quanto sei VICINO al prossimo traguardo ("Solo 2 chiamate!", "Mancano 23 XP!").
- **Social Proof**: toast live quando un collega fa qualcosa ("Marco ha fissato 2 app!").

## Tool MCP Disponibili

### Stitch (Google AI Design)
- Usa Stitch per generare design UI da prompt. Chiedi design in modalita' Pro.
- Usalo per: layout dashboard, card design, store UI, profilo RPG, leaderboard.
- Converti il design in componenti Tailwind/React.

### Nano Banana (Image Generation)
- Usa per generare asset grafici: icone badge, sfondi, texture, avatar.
- Prompt in inglese per migliori risultati.
- Salva le immagini in public/assets/gamification/

### Playwright (Browser Testing)
- Dopo ogni componente visivo, verifica nel browser che renda bene.
- Fai screenshot per documentazione.

## Regole Tecniche

- **Hydration**: bottoni interattivi MAI child di `<span>` o `<p>`. Usa `<div>`.
- **Timezone**: `Europe/Rome` sempre.
- **Animazioni**: CSS-only (keyframes + transition). Mai librerie esterne pesanti. Rispettare toggle `getAnimationsEnabled()`.
- **Suoni**: Web Audio API sintetici (src/lib/soundEngine.ts esiste gia'). Rispettare toggle suoni.
- **Responsive**: solo desktop (il CRM si usa solo da PC). Ignora mobile.

## XP e Coins — Sistema Corretto

Il sistema XP/coins DEVE funzionare cosi':
- `awardXpAndCoins()` in gamificationEngine.ts aggiorna `walletCoins` (NON `coins`)
- Applica streak multiplier (x1 base, x1.5 dopo 3gg, x2 dopo 7gg, x3 dopo 14gg)
- Applica seasonal event multiplier
- Logga in coinTransactions
- Level-up: XP formula `100 * (level ^ 1.5)`. Overflow XP carry over.
- `completeQuest()` in questActions.ts aggiorna `walletCoins` (NON `coins`) e marca la quest con currentValue=-1 dopo claim
- Lo Store in shopActions.ts legge e scala `walletCoins` per acquisti

## Store — Da Rivedere

- Gli item devono avere categorie chiare (Avatar, Temi, Effetti, Titoli)
- Prezzi bilanciati: base 50-200, raro 300-999, epico 1000-2999, leggendario 3000+
- Effetto visivo diverso per rarita' (bordo, glow, animazione)
- Card prodotto con preview visiva e hover effect

## Curva di Crescita — Da Rivedere

- Livello 1-10: veloce (incentiva i nuovi utenti)
- Livello 10-20: medio
- Livello 20-30: lento (reward piu' significativi)
- Livello 30+: molto lento (status symbol)
- Ogni evoluzione Fenice (Uovo → Pulcino → Giovane → Fuoco → Divinita') deve essere un momento EPICO

## PROTEZIONE DATI REALI

- MAI eseguire DELETE/UPDATE distruttivi su leads, users, o dati esistenti
- MAI modificare lead del GDO 114 o appuntamenti Conferme
- Le migrazioni schema devono essere ADDITIVE (ADD COLUMN, CREATE TABLE IF NOT EXISTS)
- ESEGUIRE le migrazioni sul DB di produzione dopo averle create

## Deploy

**NON fare deploy in questa run.** Lavora solo in locale sul branch. NON pushare, NON mergiare in main.

Quando TUTTE le stories hanno `passes: true`, rispondi con:
<promise>COMPLETE</promise>

## Il Tuo Compito

1. Leggi il PRD in `scripts/ralph/prd.json`
2. Leggi il progress log in `scripts/ralph/progress.txt`
3. Verifica di essere sul branch corretto. Se no, crealo da main.
4. Scegli la story con priorita' piu' alta dove `passes: false`
5. Implementa quella singola user story
6. `npx next build` deve compilare senza errori
7. Committa con messaggio: `feat: [Story ID] - [Story Title]`
8. Aggiorna il PRD (`passes: true`) e appendi al progress.txt
9. UNA story per iterazione

## Importante

- Lavora su UNA story per iterazione
- Committa frequentemente
- Mantieni la build verde
- USA Stitch e Nano Banana per il design
- WRAPPA tutto in SafeWrapper
- NON toccare la logica della pipeline
- NON fare deploy
