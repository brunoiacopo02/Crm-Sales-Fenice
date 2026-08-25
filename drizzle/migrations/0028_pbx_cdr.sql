CREATE TABLE IF NOT EXISTS "pbxCalls" (
    "id" text PRIMARY KEY NOT NULL,
    "companyId" text DEFAULT 'fenice' NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "calldate" timestamp with time zone NOT NULL,
    "dateLocal" text NOT NULL,
    "src" text NOT NULL,
    "dstKey" text,
    "duration" integer NOT NULL,
    "billsec" integer NOT NULL,
    "disposition" text NOT NULL,
    "direction" text NOT NULL,
    "userId" text REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "pbxcalls_user_day_idx" ON "pbxCalls" ("companyId", "userId", "dateLocal");
CREATE INDEX IF NOT EXISTS "pbxcalls_dst_key_idx" ON "pbxCalls" ("dstKey");

CREATE TABLE IF NOT EXISTS "pbxExtensions" (
    "extension" text PRIMARY KEY NOT NULL,
    "companyId" text DEFAULT 'fenice' NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "label" text
);
