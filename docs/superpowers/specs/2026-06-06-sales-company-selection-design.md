# Sales Company Selection — Design Spec

**Data:** 2026-06-06
**Autore:** Claude (CRM Fenice)
**Stato:** Approvato (direzione confermata da Bruno; staff condiviso, switch in-app, lista per-utente)

## 1. Obiettivo

Permettere a un singolo account sales (manager, GDO, conferme, venditore) di **operare su più aziende** (oggi Fenice + Serenamente) scegliendo l'azienda **al login** e potendo cambiarla **in-app** da uno switcher in topbar. In base all'azienda selezionata, l'utente vede e scrive esclusivamente dati/lead/KPI di quell'azienda.

Questo estende il lato **sales** del modello multi-tenancy già completo (tutti i 56 action file sono tenant-scoped su `companyId`). Oggi `currentTenant()` legge un `companyId` **fisso** dai `user_metadata`: lo rendiamo **selezionabile** a runtime, in modo sicuro.

### Non-obiettivi (YAGNI)
- **Nessuna modalità "Tutte le aziende"** sul sales (il marketing ce l'ha, ma su pipeline/import/KPI sales non ha senso e romperebbe l'assegnazione lead). Lo switcher sales è **sempre mono-azienda**.
- **Nessun KPI aggregato cross-azienda** ora (eventuale feature futura).
- **Nessun account separato per azienda** (un account a testa, esplicitamente richiesto).
- Nessuna modifica al modulo marketing (ha già il suo selettore e il suo cookie indipendente).

## 2. Requisiti (raccolti in brainstorming)

| # | Requisito | Decisione |
|---|-----------|-----------|
| R1 | Staff condiviso | Le stesse persone lavorano Fenice e Serenamente: un account a testa |
| R2 | Scelta azienda | Al login **e** switch in-app (topbar) senza ri-login |
| R3 | Permessi | **Lista aziende consentite per-utente** (`allowedCompanies`), non "tutti vedono tutto" |
| R4 | Isolamento | Vedere/scrivere solo i dati dell'azienda selezionata; impossibile selezionare aziende non consentite |
| R5 | Back-compat | Gli account Fenice esistenti continuano a funzionare senza interruzioni |

## 3. Architettura

### 3.1 Modello dei permessi (entitlement)
- **Fonte di verità runtime:** `user_metadata.allowedCompanies: string[]` (es. `['fenice','serenamente']`). Letta da `currentTenant()` **senza** roundtrip DB (coerente con la nota di performance in `tenancy.ts`).
- **Specchio queryabile:** colonna `users.allowedCompanies` (Postgres `text[]`), usata per admin/reporting e per popolare lo switcher. Tenuta in sync dallo script di provisioning.
- **Fallback back-compat:** se `allowedCompanies` manca → `[companyId ?? 'fenice']`. Un solo elemento ⇒ nessuno switcher, nessuna pagina di scelta, comportamento identico ad oggi.

### 3.2 Selezione attiva (cookie)
- Cookie **HttpOnly, Secure, SameSite=Lax, path=/**: `sales_active_company`.
- Contiene **solo** l'id azienda selezionato (mono-valore, no `all`).
- Per-dispositivo/browser: cambiare azienda su un device non altera le altre sessioni (a differenza dell'opzione scartata di scrivere nei `user_metadata`).

### 3.3 Risoluzione in `currentTenant()`
Nuova logica (in `src/lib/tenancy.ts`):

```
1. user = supabase.auth.getUser()   // come oggi
2. meta = user.user_metadata
3. allowed = meta.allowedCompanies ?? [meta.companyId ?? 'fenice']
4. cookieVal = cookies().get('sales_active_company')?.value
5. companyId = (cookieVal && allowed.includes(cookieVal))
                 ? cookieVal
                 : (meta.companyId && allowed.includes(meta.companyId))
                     ? meta.companyId
                     : allowed[0]
6. return { ...campi esistenti, companyId, allowedCompanies: allowed }
```

- `TenantContext` guadagna un campo `allowedCompanies: string[]`.
- **Validazione sempre server-side:** un cookie manomesso con un'azienda non consentita viene ignorato (cade nel fallback). Mai fidarsi del solo cookie.
- `cookies()` da `next/headers` funziona sia nei Server Component sia nelle Server Action (entrambi i contesti in cui `currentTenant()` è usato).

### 3.4 Interazione col modulo marketing (rischio da gestire)
`currentTenant()` è chiamato anche dalle route marketing, ma il marketing **non** scoping-a i dati via `ctx.companyId`: usa il suo cookie dedicato (`getSelectedCompany`) e `assertMarketingArea` (che guarda solo `ctx.area`). Cookie sales (`sales_active_company`) e cookie marketing restano **distinti**. In fase di implementazione si verifica che nessuna route marketing usi `ctx.companyId` per leggere dati; se ne emergesse una, si scopa esplicitamente sul cookie marketing.

## 4. Componenti

| Componente | Tipo | Responsabilità |
|-----------|------|----------------|
| `src/lib/tenancy.ts` | mod | Risoluzione azienda attiva + nuovo campo `allowedCompanies` in `TenantContext` |
| `drizzle/migrations/0011_user_allowed_companies.sql` | new | `ALTER TABLE users ADD COLUMN allowed_companies text[]` |
| `src/db/schema.ts` | mod | Colonna `allowedCompanies` su `users` |
| `POST /api/company/select` | new | Valida `companyId ∈ allowedCompanies`, set cookie, ritorna ok |
| `GET /api/company/selection` | new | Ritorna `{ active, canSwitch, companies:[{id,display_name}] }` |
| `src/app/seleziona-azienda/page.tsx` | new | Pagina di scelta post-login (solo se >1 azienda e nessuna selezione valida) |
| `src/app/(dashboard)/layout.tsx` | mod | Guardia: redirect a `/seleziona-azienda` se serve; passa azienda corrente alla topbar |
| `src/components/sales/SalesCompanySwitcher.tsx` | new | Dropdown switcher in topbar (visibile solo se `canSwitch`) |
| `src/components/Topbar.tsx` | mod | Monta switcher + **badge nome azienda corrente** ben visibile |
| `scripts/grantCompanyAccess.ts` | new | Provisioning: setta `allowedCompanies` (metadata + colonna) per un elenco di utenti |

## 5. Flussi

### 5.1 Login
1. Login Supabase esistente (invariato).
2. La **guardia nel layout sales** legge `currentTenant()`:
   - `allowedCompanies.length === 1` → autoseleziona quell'azienda (set cookie se assente), prosegue.
   - `allowedCompanies.length > 1` **e** cookie assente/non valido → `redirect('/seleziona-azienda')`.
   - cookie valido → prosegue normalmente.
3. `/seleziona-azienda` mostra le aziende consentite; al click → `POST /api/company/select` → redirect a `/`.

### 5.2 Switch in-app
1. Utente clicca lo switcher in topbar (visibile solo se `canSwitch = allowedCompanies.length > 1`).
2. `POST /api/company/select { companyId }` → validazione server → set cookie.
3. `router.refresh()` + `window.location.reload()` (alcune query server leggono il cookie a inizio request). Pattern identico al `CompanySwitcher` marketing.

### 5.3 Import lead (verifica end-to-end)
- Con Serenamente selezionato, `processCsvImport`/`createManualLead` inseriscono con `companyId='serenamente'` e assegnano ai **GDO di Serenamente** (`users.companyId='serenamente'` **oppure** — vedi §8 — ai GDO con accesso a Serenamente). Vedi nota aperta §8.1.

## 6. Sicurezza

- **Entitlement** in `user_metadata` (non manomettibile dal client; il client può leggere ma non riscrivere i metadata senza service role).
- **Cookie HttpOnly** non leggibile/scrivibile da JS client.
- **Doppia validazione**: `/api/company/select` rifiuta aziende fuori da `allowedCompanies`; `currentTenant()` ri-valida ad ogni chiamata e degrada al fallback.
- **Lead-level**: `assertLeadInCompany` invariato — un id lead dal client deve appartenere all'azienda attiva.
- **Nessun escalation**: cambiare azienda non cambia `role` né `area`; un GDO resta GDO in entrambe le aziende.

## 7. Provisioning Serenamente (rollout)

1. Migrazione 0011 applicata (colonna `allowed_companies`).
2. `scripts/grantCompanyAccess.ts` riceve l'elenco utenti (roster fornito da Bruno) e setta per ciascuno:
   - `user_metadata.allowedCompanies = ['fenice','serenamente']`
   - `users.allowed_companies = ['fenice','serenamente']`
3. Lo staff condiviso ora vede lo switcher e può lavorare entrambe le aziende. Serenamente parte con dati vuoti; i lead arrivano via import (CSV/manuale) con Serenamente selezionata.

## 8. Note aperte / decisioni di dettaglio

### 8.1 Assegnazione lead con staff condiviso — DA RISOLVERE in plan
`importLeads` oggi assegna ai GDO con `users.companyId === ctx.companyId`. Ma con staff **condiviso**, un GDO ha `users.companyId='fenice'` e lavora anche Serenamente via `allowedCompanies`. Quindi filtrare gli assegnatari per `users.companyId='serenamente'` darebbe **zero GDO** → import fallito.
**Decisione:** l'elenco GDO assegnabili per un'azienda X = utenti con `role='GDO'`, `isActive`, e **`X ∈ allowedCompanies`** (non `companyId === X`). Questo va applicato in `importLeads.ts` (`getActiveGdosForImport`, `processCsvImport`, `createManualLead`) e ovunque si elenchino operatori per assegnazione/redistribuzione (`redistributeLeadsActions`, eventuali selettori conferme/venditori). Il piano implementativo deve mappare tutti i punti che oggi filtrano operatori per `companyId` e convertirli alla semantica `allowedCompanies`. I **lead** restano scoped per `companyId` (invariato); cambia solo come si selezionano gli **operatori assegnabili**.

### 8.2 Indicatore azienda corrente
Badge sempre visibile in topbar con `display_name` dell'azienda attiva e colore distintivo, per prevenire data-entry sull'azienda sbagliata. Obbligatorio, non opzionale.

### 8.3 Default azienda
Nessuna preferenza "ultima usata" persistita lato server (YAGNI). Il cookie già funge da memoria di sessione/dispositivo. Alla prima entrata multi-azienda si passa sempre da `/seleziona-azienda`.

## 9. Strategia di test

Vincoli reali del progetto: niente framework di test unitari configurato; la verifica avviene con **script `tsx` mirati** + check manuale in dev (pattern già usato: `scripts/e2e*.ts`, `scripts/check-*.mjs`).

- **TS check**: `npx tsc --noEmit` pulito dopo ogni file.
- **Script di verifica** `scripts/verifyCompanySelection.ts`:
  - `currentTenant()` con cookie valido → azienda = cookie; con cookie non consentito → fallback; senza cookie → fallback.
  - `POST /api/company/select` con azienda non consentita → rifiuto.
- **Verifica funzionale in dev** (Playwright/browse o manuale):
  - Login utente multi-azienda → pagina `/seleziona-azienda` → scelgo Serenamente → dashboard mostra badge Serenamente.
  - Import 1 lead manuale → in DB ha `companyId='serenamente'`, assegnato a un GDO con Serenamente in `allowedCompanies`.
  - Switch a Fenice in topbar → i lead Serenamente spariscono dalla vista, compaiono i Fenice.
  - Utente mono-azienda (Fenice legacy) → nessuno switcher, nessuna pagina di scelta, tutto come prima.

## 10. File toccati (riepilogo)

**Nuovi:** `0011_user_allowed_companies.sql`, `api/company/select/route.ts`, `api/company/selection/route.ts`, `seleziona-azienda/page.tsx`, `components/sales/SalesCompanySwitcher.tsx`, `scripts/grantCompanyAccess.ts`, `scripts/verifyCompanySelection.ts`.

**Modificati:** `lib/tenancy.ts`, `db/schema.ts`, `(dashboard)/layout.tsx`, topbar sales, `importLeads.ts` (+ altri punti di selezione operatori da mappare in §8.1), `redistributeLeadsActions.ts`.
