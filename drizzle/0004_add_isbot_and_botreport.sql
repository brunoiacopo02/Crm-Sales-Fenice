ALTER TABLE "users" ADD COLUMN "isBot" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "botReport" jsonb;
