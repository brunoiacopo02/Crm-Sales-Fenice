-- 0027 — data di presa in carico del lead da parte di un operatore.
--
-- Perché serve: fino a oggi "lead assegnati nel mese" era calcolato su
-- `createdAt`, cioè sulla data di import. Per i lead che entrano da
-- ActiveCampaign le due date coincidono (assegnati nello stesso istante in cui
-- nascono), ma per i pool /import no: un lead caricato a settembre 2025 e
-- distribuito a un GDO ad agosto 2026 finiva contato — se contato — nel mese
-- di import, dove nessuno lo guarda. La decisione PO del 2026-07-20 diceva
-- "contano dall'assegnazione": era stata applicata come filtro
-- (or(launchBucket IS NULL, assignedToId IS NOT NULL)) ma mai come data.
--
-- Semantica: PRIMA assegnazione, non l'ultima. Un lead che il bot restituisce
-- e che viene riassegnato a un GDO umano non deve rientrare nel mese corrente:
-- era già stato contato quando è entrato in circolo la prima volta.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS "assignedAt" timestamptz;

-- Backfill dagli eventi ASSIGNED (la prima assegnazione registrata).
UPDATE leads l
SET "assignedAt" = e.primo
FROM (
    SELECT "leadId", min(timestamp) AS primo
    FROM "leadEvents"
    WHERE "eventType" = 'ASSIGNED'
    GROUP BY "leadId"
) e
WHERE e."leadId" = l.id AND l."assignedAt" IS NULL;

-- Lead assegnati prima che l'evento ASSIGNED esistesse (o assegnati da flussi
-- che non lo scrivono): si ripiega sulla data di creazione, che per quei lead
-- è la stessa cosa — erano assegnati all'import.
UPDATE leads
SET "assignedAt" = "createdAt"
WHERE "assignedToId" IS NOT NULL AND "assignedAt" IS NULL;

-- Le query filtrano su COALESCE("assignedAt", "createdAt") in finestre di
-- mese: senza indice diventa un seq scan su tutta la tabella.
CREATE INDEX IF NOT EXISTS leads_company_assigned_at_idx
    ON leads ("companyId", (COALESCE("assignedAt", "createdAt")));
