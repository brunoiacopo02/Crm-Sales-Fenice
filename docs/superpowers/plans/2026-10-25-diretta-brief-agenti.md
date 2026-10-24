# Brief comune per gli agenti del restyle "Diretta"

Leggere per primi:
1. `docs/superpowers/specs/2026-10-25-restyle-diretta-gamification-design.md`: le decisioni, che valgono su tutto.
2. `C:\Users\bruno\AppData\Local\Temp\claude\C--Users-bruno-Desktop-CRM-GDO\fc3aa782-5269-40df-ad90-bf34e66d8ef5\scratchpad\sintesi_agenti.md`: audit del codice con i percorsi e le righe.
3. `C:\Users\bruno\Downloads\stile-fenice-slide-SKILL (10).md`: le regole di stile, da applicare alla UI.

Moduli già pronti, da usare senza duplicarli:
- `src/lib/diretta/config.ts`: obiettivi di default, `peakWindow`, `shiftWindow`, `euroFromPresences`, `stepReached`, `isTeamMember`, `personName`.
- `src/lib/diretta/settings.ts`: `isDirettaOn(role)`, `readGamificationTargets()`, `writeSetting()`.
- `src/lib/economy/ledger.ts`: `creditOnce()` e `reverseOnce()`, idempotenti.
- `src/db/schema.ts`: tabelle della migrazione 0045, già applicata in produzione. Contiene `users.firstName`, `scintille`, `piume`, `profileImageUrl`, `currencyLedger`, `teamChests`, `teamChestAwards`, `rewardItems`, `rewardPurchases`, `dailyQuotes` e `dailyQuoteSchedule`.
- Il layout mette `data-ui="diretta"` sul div radice quando l'interruttore è acceso. I token CSS `--d-*` sono in fondo a `globals.css` e c'è Poppins (`--font-poppins`).

## Come lavori

1. Crea il tuo worktree dal ramo base, con il nome che ti è assegnato:
   ```
   git -C "C:/Users/bruno/Desktop/CRM GDO" worktree add -b feat/diretta-<nome> "C:/Users/bruno/Desktop/CRM-GDO-diretta-<nome>" feat/restyle-diretta
   cp "C:/Users/bruno/Desktop/CRM GDO/.env.local" "C:/Users/bruno/Desktop/CRM-GDO-diretta-<nome>/"
   cd "C:/Users/bruno/Desktop/CRM-GDO-diretta-<nome>" && npm ci --no-audit --no-fund
   ```
   Lavora SOLO in quel worktree.
2. **Database di produzione: solo SELECT** (`mcp__supabase__execute_sql`, project `ncutwzsifzundikwllxp`). Niente INSERT, UPDATE, DELETE o DDL.
   - Se ti serve una migrazione, scrivila in `drizzle/migrations/0046_<nome>.sql` (solo additiva), aggiorna `schema.ts` e segnalala nel rapporto: la applico io.
   - Le operazioni sui dati da fare al go-live (riassegnazioni, azzeramenti) vanno in uno script idempotente in `scripts/diretta/<nome>-*.ts`, con una modalità `--dry-run` di default: non eseguirle.
3. **Niente push, niente deploy, niente merge**: committi solo sul tuo ramo, con l'ultima riga del messaggio `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
4. **Regole del codice**:
   - Drizzle per tutte le query (niente SQL raw nell'app), server action in `src/app/actions/`.
   - Mai bottoni dentro `span` o `p`. Orologi e "X minuti fa" solo lato client (come `clientNow` in LeadCard).
   - Non toccare i canali realtime né l'emissione di `realtime_update`.
   - Commenti in italiano, sobri, come quelli del codice intorno.
   - Il comportamento vecchio resta identico quando l'interruttore della Diretta è spento, salvo dove la spec dice diversamente (bot, lancio, Serenamente e logiche economiche valgono sempre).
5. **Stile Diretta**:
   - fondo `#171717`, superfici `#262626`, testo `#F2F2F2`, testo secondario `#BFBFBF`;
   - l'arancione `#FF9330` solo per ciò che conta adesso, e sull'arancione il testo è nero;
   - Poppins 400/500/600; raggi 8 e 16; numeri con `tabular-nums`;
   - niente ombre, gradienti, pillole (`rounded-full`), emoji, maiuscolo spaziato, monospace, card annidate o bordi colorati su un lato solo;
   - icone `lucide-react` già in uso, con tratto sottile.
6. **Prima di finire**:
   - `npx tsc --noEmit` pulito;
   - `npm test` verde, aggiungendo i tuoi test di logica pura in `src/lib/**.test.ts` e registrandoli nello script `test` di package.json;
   - controlla che non ci siano bottoni dentro span o p nei file toccati.
7. **Rapporto finale**, in italiano e breve:
   - ramo e commit;
   - file toccati;
   - cosa fa;
   - cosa NON hai fatto o è rimasto in dubbio;
   - migrazioni o script da eseguire al go-live;
   - eventuali conflitti attesi con altri rami.

## Rami in parallelo (non toccare i file degli altri se non indicato)

| Nome | Possiede |
|---|---|
| `home` | Home GDO Diretta, metriche, Topbar/Sidebar in variante Diretta, schermata d'inizio turno, pagina admin degli obiettivi e degli interruttori, nomi veri nelle UI GDO/Conferme/manager |
| `lead` | `getPipelineLeads` (solo la parte che legge i lead), instradamento vergini e ridati, ora di arrivo, rimozione dei riferimenti al bot, rimozione dei lead del lancio, Serenamente nascosta |
| `economia` | Premi nelle action degli esiti (pipelineActions dalla riga ~600 in giù, confermeActions), forzieri di squadra, stacco della vecchia gamification lato server, bonus presenze, script di azzeramento |
| `negozio` | Negozio nuovo GDO+Conferme, immagini, classifica nuova, pulizia di profilo e pagine creature |
| `citazioni` | Citazione del giorno e consiglio di vendita: lettura, componente, pagina admin di approvazione, generatore del calendario, import |
| `conferme` | Restyle Diretta della board Conferme e rimozione degli overlay di gamification lato Conferme, bonus Conferme |
