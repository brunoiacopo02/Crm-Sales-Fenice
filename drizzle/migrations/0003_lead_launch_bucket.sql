ALTER TABLE "leads" ADD COLUMN "launchBucket" text;

-- Indice parziale: tutte le query del pool filtrano su (launchBucket NOT NULL AND assignedToId IS NULL).
-- L'indice parziale è piccolo e rende O(log n) il count del pool, che viene letto a ogni
-- apertura della card LaunchPoolCard in /import.
CREATE INDEX "leads_launch_bucket_pool_idx"
  ON "leads" ("launchBucket")
  WHERE "launchBucket" IS NOT NULL AND "assignedToId" IS NULL;
