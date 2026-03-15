CREATE TABLE "appointmentPresence" (
	"id" text PRIMARY KEY NOT NULL,
	"leadId" text NOT NULL,
	"userId" text NOT NULL,
	"status" text DEFAULT 'viewing' NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastHeartbeatAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignmentSettings" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'equal' NOT NULL,
	"settings" jsonb,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedBy" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breakSessions" (
	"id" text PRIMARY KEY NOT NULL,
	"gdoUserId" text NOT NULL,
	"dateLocal" text NOT NULL,
	"breakIndex" integer NOT NULL,
	"startTime" timestamp with time zone DEFAULT now() NOT NULL,
	"endTime" timestamp with time zone,
	"durationSeconds" integer DEFAULT 0,
	"status" text DEFAULT 'in_corso' NOT NULL,
	"exceededSeconds" integer DEFAULT 0,
	"overrideFlag" boolean DEFAULT false,
	"overrideReason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendarConnections" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"accessToken" text NOT NULL,
	"refreshToken" text NOT NULL,
	"tokenExpiry" timestamp with time zone NOT NULL,
	"primaryCalendarId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendarConnections_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "calendarEvents" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"leadId" text NOT NULL,
	"eventType" text NOT NULL,
	"googleEventId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "callLogs" (
	"id" text PRIMARY KEY NOT NULL,
	"leadId" text NOT NULL,
	"userId" text,
	"outcome" text NOT NULL,
	"note" text,
	"discardReason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coinTransactions" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmationsNotes" (
	"id" text PRIMARY KEY NOT NULL,
	"leadId" text NOT NULL,
	"authorId" text NOT NULL,
	"text" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dailyKpiSnapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"fissaggioVariazionePerc" real DEFAULT 0 NOT NULL,
	CONSTRAINT "dailyKpiSnapshots_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "importLogs" (
	"id" text PRIMARY KEY NOT NULL,
	"totalRows" integer NOT NULL,
	"importedCount" integer NOT NULL,
	"duplicateCount" integer NOT NULL,
	"invalidCount" integer NOT NULL,
	"perGdoAssigned" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internalAlerts" (
	"id" text PRIMARY KEY NOT NULL,
	"senderId" text NOT NULL,
	"receiverId" text,
	"message" text NOT NULL,
	"isRead" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leadEvents" (
	"id" text PRIMARY KEY NOT NULL,
	"leadId" text NOT NULL,
	"eventType" text NOT NULL,
	"userId" text,
	"fromSection" text,
	"toSection" text,
	"metadata" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text NOT NULL,
	"funnel" text,
	"status" text DEFAULT 'NEW' NOT NULL,
	"callCount" integer DEFAULT 0 NOT NULL,
	"assignedToId" text,
	"lastCallDate" timestamp with time zone,
	"lastCallNote" text,
	"recallDate" timestamp with time zone,
	"appointmentDate" timestamp with time zone,
	"appointmentNote" text,
	"appointmentCreatedAt" timestamp with time zone,
	"discardReason" text,
	"confCall1At" timestamp with time zone,
	"confCall2At" timestamp with time zone,
	"confCall3At" timestamp with time zone,
	"confVslUnseen" boolean DEFAULT false NOT NULL,
	"confNeedsReschedule" boolean DEFAULT false NOT NULL,
	"confirmationsOutcome" text,
	"confirmationsDiscardReason" text,
	"confirmationsUserId" text,
	"confirmationsTimestamp" timestamp with time zone,
	"salespersonAssigned" text,
	"salespersonAssignedAt" timestamp with time zone,
	"salespersonUserId" text,
	"salespersonOutcome" text,
	"salespersonOutcomeNotes" text,
	"salespersonOutcomeAt" timestamp with time zone,
	"closeProduct" text,
	"closeAmountEur" real,
	"notClosedReason" text,
	"followUp1Date" timestamp with time zone,
	"followUp2Date" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "marketingBudgets" (
	"id" text PRIMARY KEY NOT NULL,
	"funnel" text NOT NULL,
	"month" text NOT NULL,
	"spentAmountEur" real DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthlyTargets" (
	"id" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"targetAppFissati" integer DEFAULT 0 NOT NULL,
	"targetAppConfermati" integer DEFAULT 0 NOT NULL,
	"targetTrattative" integer DEFAULT 0 NOT NULL,
	"targetClosed" integer DEFAULT 0 NOT NULL,
	"targetValoreContratti" real DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthlyTargets_month_unique" UNIQUE("month")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipientUserId" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"metadata" jsonb,
	"status" text DEFAULT 'unread' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"readAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shopItems" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"cost" integer NOT NULL,
	"cssValue" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" text PRIMARY KEY NOT NULL,
	"startTime" timestamp with time zone NOT NULL,
	"endTime" timestamp with time zone NOT NULL,
	"actualEndTime" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"startedByManagerId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teamGoals" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"targetCount" integer NOT NULL,
	"currentCount" integer DEFAULT 0 NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"rewardCoins" integer NOT NULL,
	"goalType" text DEFAULT 'database' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userPurchases" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"shopItemId" text NOT NULL,
	"purchasedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"password" text NOT NULL,
	"role" text DEFAULT 'GDO' NOT NULL,
	"gdoCode" integer,
	"displayName" text,
	"avatarUrl" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"walletCoins" integer DEFAULT 0 NOT NULL,
	"equippedItemId" text,
	"dailyApptTarget" integer DEFAULT 2 NOT NULL,
	"weeklyConfirmedTarget" integer DEFAULT 5 NOT NULL,
	"baseSalaryEur" real DEFAULT 1350 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"experience" integer DEFAULT 0 NOT NULL,
	"totalBonusesEur" real DEFAULT 0 NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_gdoCode_unique" UNIQUE("gdoCode")
);
--> statement-breakpoint
CREATE TABLE "weeklyGamificationRules" (
	"id" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"targetTier1" integer DEFAULT 10 NOT NULL,
	"rewardTier1" real DEFAULT 135 NOT NULL,
	"targetTier2" integer DEFAULT 13 NOT NULL,
	"rewardTier2" real DEFAULT 270 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weeklyGamificationRules_month_unique" UNIQUE("month")
);
--> statement-breakpoint
ALTER TABLE "appointmentPresence" ADD CONSTRAINT "appointmentPresence_leadId_leads_id_fk" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointmentPresence" ADD CONSTRAINT "appointmentPresence_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakSessions" ADD CONSTRAINT "breakSessions_gdoUserId_users_id_fk" FOREIGN KEY ("gdoUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendarConnections" ADD CONSTRAINT "calendarConnections_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendarEvents" ADD CONSTRAINT "calendarEvents_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendarEvents" ADD CONSTRAINT "calendarEvents_leadId_leads_id_fk" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callLogs" ADD CONSTRAINT "callLogs_leadId_leads_id_fk" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coinTransactions" ADD CONSTRAINT "coinTransactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmationsNotes" ADD CONSTRAINT "confirmationsNotes_leadId_leads_id_fk" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmationsNotes" ADD CONSTRAINT "confirmationsNotes_authorId_users_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internalAlerts" ADD CONSTRAINT "internalAlerts_senderId_users_id_fk" FOREIGN KEY ("senderId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internalAlerts" ADD CONSTRAINT "internalAlerts_receiverId_users_id_fk" FOREIGN KEY ("receiverId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadEvents" ADD CONSTRAINT "leadEvents_leadId_leads_id_fk" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadEvents" ADD CONSTRAINT "leadEvents_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToId_users_id_fk" FOREIGN KEY ("assignedToId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_salespersonUserId_users_id_fk" FOREIGN KEY ("salespersonUserId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientUserId_users_id_fk" FOREIGN KEY ("recipientUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_startedByManagerId_users_id_fk" FOREIGN KEY ("startedByManagerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userPurchases" ADD CONSTRAINT "userPurchases_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userPurchases" ADD CONSTRAINT "userPurchases_shopItemId_shopItems_id_fk" FOREIGN KEY ("shopItemId") REFERENCES "public"."shopItems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assigned_to_idx" ON "leads" USING btree ("assignedToId");--> statement-breakpoint
CREATE INDEX "recall_date_idx" ON "leads" USING btree ("recallDate");--> statement-breakpoint
CREATE INDEX "appointment_date_idx" ON "leads" USING btree ("appointmentDate");