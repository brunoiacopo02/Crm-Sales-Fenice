import { pgTable, text, integer, bigint, real, boolean, timestamp, jsonb, index, uniqueIndex, unique, primaryKey, date, numeric, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { DEFAULT_DAILY_APPT_TARGET } from '@/lib/kpi/canon';

// Multi-tenant: una riga per azienda gestita dal CRM unificato (sales + marketing).
// Fenice è il tenant principale; Serenamente parte a vendere entro 2026-06-04;
// FCD seedato ma inattivo. companyId è chiave di tenancy su tutti i tavoli.
export const companies = pgTable('companies', {
    id: text('id').primaryKey(),                                                                          // 'fenice' | 'serenamente' | 'fcd'
    name: text('name').notNull(),
    displayName: text('displayName').notNull(),
    shortCode: text('shortCode').notNull(),                                                               // 'FA' | 'SE' | 'FCD'
    currency: text('currency').default('EUR').notNull(),
    isActive: boolean('isActive').default(true).notNull(),
    sortOrder: integer('sortOrder').default(0).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const users = pgTable('users', {
    id: text('id').primaryKey(),
    name: text('name'),
    email: text('email').unique(),
    password: text('password').notNull(),
    role: text('role').default('GDO').notNull(),

    // Multi-tenant + area discrimination (sales vs marketing).
    // companyId: tenant di appartenenza (default 'fenice' per back-compat con
    // gli utenti esistenti). area: in quale CRM l'utente può entrare —
    // 'sales' (default, accede al CRM tradizionale GDO/Conferme/Venditore),
    // 'marketing' (accede solo a /marketing/*), 'both' (super-admin = Bruno).
    // marketingRole è popolato SOLO per utenti con area 'marketing'|'both'
    // e mappa ai 4 ruoli del CRM marketing: manager|media_buyer|copywriter|social.
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    area: text('area').default('sales').notNull(),         // 'sales' | 'marketing' | 'both'
    marketingRole: text('marketingRole'),                  // 'manager' | 'media_buyer' | 'copywriter' | 'social' | null
    // Aziende sales selezionabili dall'utente (staff condiviso multi-tenant).
    // NULL = back-compat → l'app usa [companyId]. Sync con user_metadata.allowedCompanies.
    allowedCompanies: text('allowed_companies').array(),

    // GDO Profiling
    gdoCode: integer('gdoCode').unique(), // 105, 113, etc.
    displayName: text('displayName'),
    avatarUrl: text('avatarUrl'),
    isActive: boolean('isActive').default(true).notNull(),
    walletCoins: integer('walletCoins').default(0).notNull(),
    equippedItemId: text('equippedItemId'), // references shopItems.id optionally

    // Targets
    dailyApptTarget: integer('dailyApptTarget').default(DEFAULT_DAILY_APPT_TARGET).notNull(),
    weeklyConfirmedTarget: integer('weeklyConfirmedTarget').default(5).notNull(),
    confermeTargetTier1: integer('confermeTargetTier1').default(19).notNull(),
    confermeTargetTier2: integer('confermeTargetTier2').default(24).notNull(),
    confermeExtraTier1: real('confermeExtraTier1').default(0).notNull(),
    confermeExtraTier2: real('confermeExtraTier2').default(0).notNull(),

    // --- GAME & FINANCIAL FIELDS ---
    salesTargetEur: real('salesTargetEur'), // Target fatturato venditore (nullable)
    baseSalaryEur: real('baseSalaryEur').default(1350).notNull(),
    level: integer('level').default(1).notNull(),
    experience: integer('experience').default(0).notNull(),
    totalBonusesEur: real('totalBonusesEur').default(0).notNull(),
    coins: integer('coins').default(0).notNull(),

    // Streak system
    streakCount: integer('streakCount').default(0).notNull(),
    lastStreakDate: text('lastStreakDate'), // 'YYYY-MM-DD' format, nullable

    // Title system
    activeTitle: text('activeTitle'), // Currently equipped title, nullable

    // Universe: creature drop counter (triggers drop every ~25 actions)
    creatureDropCounter: integer('creatureDropCounter').default(0).notNull(),
    lastTimedChestAt: timestamp('lastTimedChestAt', { withTimezone: true, mode: 'date' }),

    // ActiveCampaign auto-intake (webhook): il manager toggle quali GDO ricevono
    // i lead automatici in round-robin. acLastAssignedAt traccia l'ultimo lead
    // assegnato da AC per bilanciare la distribuzione (LEAST-RECENTLY-ASSIGNED).
    acAutoIntake: boolean('acAutoIntake').default(false).notNull(),
    acLastAssignedAt: timestamp('acLastAssignedAt', { withTimezone: true, mode: 'date' }),

    // Statistiche GDO: il TL/manager sceglie quali GDO contano nelle medie
    // per-GDO (App/gg, alert, scorte). Account isActive ma non operativi
    // (es. in pausa lunga) vengono esclusi dai divisori senza disattivarli.
    statsActive: boolean('statsActive').default(true).notNull(),

    // Account bot (es. bot fissatore gdo205): partecipa al round-robin e ai KPI
    // come un GDO, ma la gamification è disattivata e all'assegnazione il CRM
    // pusha il lead al webhook del bot. Interruttore unico per gamification-off
    // + push + badge report nelle Conferme.
    isBot: boolean('isBot').default(false).notNull(),

    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const leads = pgTable('leads', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone').notNull(), // non più unique: webhook AC consente duplicati intenzionali
    funnel: text('funnel'),
    source: text('source'), // 'activecampaign' | 'csv' | 'manual' | NULL
    // UTM tracking (popolato dal webhook AC dai custom field 31-35).
    // Non mostrato in UI: riservato a future funzioni marketing analytics.
    utmSource: text('utmSource'),
    utmMedium: text('utmMedium'),
    utmCampaign: text('utmCampaign'),
    utmContent: text('utmContent'),
    utmTerm: text('utmTerm'),
    // ID del contatto ActiveCampaign (se source='activecampaign'). Permette
    // lookup O(1) per gestire gli eventi update di AC che arrivano dopo il
    // subscribe (es. Provenienza settata tardi → aggiornamento funnel).
    acContactId: text('acContactId'),
    // Flag impostato dal webhook AC quando il telefono ricevuto è strano
    // (es. meno di 9 cifre). Nell'UI è solo un triangolino accanto al
    // numero, non una nota di testo che occupa spazio.
    phoneSuspicious: boolean('phoneSuspicious').default(false).notNull(),
    // Lead self-booked tramite landing/webinar (es. webinar Video Editing 2026-05-12).
    // I lead self-booked appaiono in una sezione dedicata della dashboard Conferme,
    // dove vengono assegnati direttamente a un venditore (saltando il flusso GDO).
    isSelfBooked: boolean('isSelfBooked').default(false).notNull(),
    // Lancio Videoeditor (maggio 2026): marca i lead pescabili dal pool del lancio.
    // 'WEBINAR' = ha visto il webinar Zoom; 'NO_WEBINAR' = non l'ha visto; null = lead normale.
    launchBucket: text('launchBucket'),
    status: text('status').default('NEW').notNull(),
    callCount: integer('callCount').default(0).notNull(),
    assignedToId: text('assignedToId').references(() => users.id),
    lastCallDate: timestamp('lastCallDate', { withTimezone: true, mode: 'date' }),
    lastCallNote: text('lastCallNote'),
    recallNote: text('recallNote'),
    agendaSentAt: timestamp('agendaSentAt', { withTimezone: true, mode: 'date' }),
    recallDate: timestamp('recallDate', { withTimezone: true, mode: 'date' }),
    // Settato quando un lead con richiamo programmato riceve esito NON_RISPOSTO:
    // indica "aveva un richiamo e non ha risposto" (badge sulla card). Azzerato
    // quando viene programmato un nuovo richiamo o il lead esce dalla pipeline.
    recallMissedAt: timestamp('recallMissedAt', { withTimezone: true, mode: 'date' }),
    appointmentDate: timestamp('appointmentDate', { withTimezone: true, mode: 'date' }),
    appointmentNote: text('appointmentNote'),
    appointmentCreatedAt: timestamp('appointmentCreatedAt', { withTimezone: true, mode: 'date' }),
    discardReason: text('discardReason'),

    // Conferme Flow
    confCall1At: timestamp('confCall1At', { withTimezone: true, mode: 'date' }),
    confCall2At: timestamp('confCall2At', { withTimezone: true, mode: 'date' }),
    confCall3At: timestamp('confCall3At', { withTimezone: true, mode: 'date' }),
    // Durata in secondi delle chiamate Conferme. NULL se il timer non è stato avviato.
    confCall1Duration: integer('confCall1Duration'),
    confCall2Duration: integer('confCall2Duration'),
    confCall3Duration: integer('confCall3Duration'),
    confVslSeen: boolean('confVslSeen').default(false).notNull(),
    confNeedsReschedule: boolean('confNeedsReschedule').default(false).notNull(),
    confSnoozeAt: timestamp('confSnoozeAt', { withTimezone: true, mode: 'date' }),
    confRecallNotes: text('confRecallNotes'),

    // Report strutturato scritto dal bot fissatore al momento dell'esito.
    // Forma attesa: { summary, painPoints[], budgetSignal, urgency, objections[], levaConsigliata }.
    // Renderizzato come card "🤖 Report Bot" nel ConfermeDrawer. Nullable: solo i lead bot lo hanno.
    botReport: jsonb('botReport'),

    confirmationsOutcome: text('confirmationsOutcome'),
    confirmationsDiscardReason: text('confirmationsDiscardReason'),
    confirmationsUserId: text('confirmationsUserId'),
    confirmationsTimestamp: timestamp('confirmationsTimestamp', { withTimezone: true, mode: 'date' }),
    salespersonAssigned: text('salespersonAssigned'),
    salespersonAssignedAt: timestamp('salespersonAssignedAt', { withTimezone: true, mode: 'date' }),
    salespersonUserId: text('salespersonUserId').references(() => users.id),
    // Check-in "Inizia trattativa": timbra quando il venditore apre il lead nel CRM
    // per condurre la trattativa. NULL = non ancora iniziata. Gatea l'accesso al
    // telefono/briefing lato venditore e l'esito non è registrabile se è NULL.
    negotiationStartedAt: timestamp('negotiationStartedAt', { withTimezone: true, mode: 'date' }),
    salespersonOutcome: text('salespersonOutcome'), // 'Chiuso' | 'Non chiuso' | 'Sparito'
    salespersonOutcomeNotes: text('salespersonOutcomeNotes'),
    salespersonOutcomeAt: timestamp('salespersonOutcomeAt', { withTimezone: true, mode: 'date' }),
    closeProduct: text('closeProduct'), // 'advance' | 'gold' | 'exclusive'
    closeAmountEur: real('closeAmountEur'),
    notClosedReason: text('notClosedReason'),
    followUp1Date: timestamp('followUp1Date', { withTimezone: true, mode: 'date' }),
    followUp2Date: timestamp('followUp2Date', { withTimezone: true, mode: 'date' }),

    // Optimistic Concurrency
    version: integer('version').default(1).notNull(),

    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        statusIdx: index('status_idx').on(table.status),
        assignedToIdx: index('assigned_to_idx').on(table.assignedToId),
        recallDateIdx: index('recall_date_idx').on(table.recallDate),
        appointmentDateIdx: index('appointment_date_idx').on(table.appointmentDate),
        confirmationsOutcomeIdx: index('confirmations_outcome_idx').on(table.confirmationsOutcome),
        assignedStatusIdx: index('assigned_status_idx').on(table.assignedToId, table.status),
        assignedRecallIdx: index('assigned_recall_idx').on(table.assignedToId, table.recallDate),
        overdueOutcomeIdx: index('leads_overdue_idx').on(table.salespersonUserId, table.appointmentDate, table.salespersonOutcome),
        // Poll richiami Conferme (~150k query/g): senza questo indice partiva un seq scan a chiamata
        confSnoozeIdx: index('leads_conf_snooze_idx').on(table.companyId, table.confSnoozeAt)
            .where(sql`"confirmationsOutcome" IS NULL AND "confSnoozeAt" IS NOT NULL`),
    };
});

export const callLogs = pgTable('callLogs', {
    id: text('id').primaryKey(),
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    userId: text('userId'),
    outcome: text('outcome').notNull(),
    note: text('note'),
    discardReason: text('discardReason'),
    scriptCompleted: boolean('scriptCompleted').default(false),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        userIdIdx: index('calllogs_user_id_idx').on(table.userId),
        userCreatedAtIdx: index('calllogs_user_created_at_idx').on(table.userId, table.createdAt),
        // Resa per tentativo (row_number PARTITION BY leadId ORDER BY createdAt,id):
        // senza questo indice il sort spillava ~12MB su disco a ogni caricamento.
        // Il prefisso leadId serve anche la timeline chiamate della ContactDrawer.
        leadCreatedIdIdx: index('calllogs_lead_created_id_idx').on(table.leadId, table.createdAt, table.id),
    };
});

export const leadEvents = pgTable('leadEvents', {
    id: text('id').primaryKey(),
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    eventType: text('eventType').notNull(),
    userId: text('userId').references(() => users.id),

    fromSection: text('fromSection'),
    toSection: text('toSection'),

    metadata: jsonb('metadata'),

    timestamp: timestamp('timestamp', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        leadIdIdx: index('lead_events_lead_id_idx').on(table.leadId),
        userIdIdx: index('lead_events_user_id_idx').on(table.userId),
        // Conteggi gamification (checkAndAdvanceStage): copre companyId+userId+eventType+timestamp in index-only scan
        companyUserEventTsIdx: index('lead_events_company_user_event_ts_idx').on(table.companyId, table.userId, table.eventType, table.timestamp),
    };
});

export const breakSessions = pgTable('breakSessions', {
    id: text('id').primaryKey(),
    gdoUserId: text('gdoUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    dateLocal: text('dateLocal').notNull(),
    breakIndex: integer('breakIndex').notNull(),

    startTime: timestamp('startTime', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    endTime: timestamp('endTime', { withTimezone: true, mode: 'date' }),
    durationSeconds: integer('durationSeconds').default(0),

    status: text('status').default('in_corso').notNull(),
    exceededSeconds: integer('exceededSeconds').default(0),

    overrideFlag: boolean('overrideFlag').default(false),
    overrideReason: text('overrideReason'),

    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const notifications = pgTable('notifications', {
    id: text('id').primaryKey(),
    recipientUserId: text('recipientUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    metadata: jsonb('metadata'),
    status: text('status').default('unread').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    readAt: timestamp('readAt', { withTimezone: true, mode: 'date' }),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        companyRecipientIdx: index('notifications_company_recipient_idx').on(table.companyId, table.recipientUserId),
        // Il client Supabase (NotificationBell) filtra solo per recipientUserId + ORDER BY createdAt DESC: senza questo indice era un seq scan
        recipientCreatedIdx: index('notifications_recipient_created_idx').on(table.recipientUserId, table.createdAt.desc()),
    };
});

export const assignmentSettings = pgTable('assignmentSettings', {
    id: text('id').primaryKey(),
    mode: text('mode').default('equal').notNull(),
    settings: jsonb('settings'),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedBy: text('updatedBy').notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const importLogs = pgTable('importLogs', {
    id: text('id').primaryKey(),
    totalRows: integer('totalRows').notNull(),
    importedCount: integer('importedCount').notNull(),
    duplicateCount: integer('duplicateCount').notNull(),
    invalidCount: integer('invalidCount').notNull(),
    perGdoAssigned: jsonb('perGdoAssigned'),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const sprints = pgTable('sprints', {
    id: text('id').primaryKey(),
    startTime: timestamp('startTime', { withTimezone: true, mode: 'date' }).notNull(),
    endTime: timestamp('endTime', { withTimezone: true, mode: 'date' }).notNull(),
    actualEndTime: timestamp('actualEndTime', { withTimezone: true, mode: 'date' }),
    status: text('status').default('active').notNull(),
    startedByManagerId: text('startedByManagerId').references(() => users.id),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const shopItems = pgTable('shopItems', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    cost: integer('cost').notNull(),
    cssValue: text('cssValue').notNull(),
    isActive: boolean('isActive').default(true).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const userPurchases = pgTable('userPurchases', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    shopItemId: text('shopItemId').notNull().references(() => shopItems.id, { onDelete: 'cascade' }),
    purchasedAt: timestamp('purchasedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const coinTransactions = pgTable('coinTransactions', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const confirmationsNotes = pgTable('confirmationsNotes', {
    id: text('id').primaryKey(),
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    authorId: text('authorId').notNull().references(() => users.id),
    text: text('text').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const internalAlerts = pgTable('internalAlerts', {
    id: text('id').primaryKey(),
    senderId: text('senderId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    receiverId: text('receiverId').references(() => users.id, { onDelete: 'cascade' }), // Nullable for broadcast
    message: text('message').notNull(),
    isRead: boolean('isRead').default(false).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});


export const calendarConnections = pgTable('calendarConnections', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').default('google').notNull(),
    accessToken: text('accessToken').notNull(),
    refreshToken: text('refreshToken').notNull(),
    tokenExpiry: timestamp('tokenExpiry', { withTimezone: true, mode: 'date' }).notNull(),
    primaryCalendarId: text('primaryCalendarId'),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const calendarEvents = pgTable('calendarEvents', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    eventType: text('eventType').notNull(),
    googleEventId: text('googleEventId'),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const teamGoals = pgTable('teamGoals', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    targetCount: integer('targetCount').notNull(),
    currentCount: integer('currentCount').default(0).notNull(),
    deadline: timestamp('deadline', { withTimezone: true, mode: 'date' }).notNull(),
    rewardCoins: integer('rewardCoins').notNull(),
    goalType: text('goalType').default('database').notNull(),
    status: text('status').default('active').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const marketingBudgets = pgTable('marketingBudgets', {
    id: text('id').primaryKey(),
    funnel: text('funnel').notNull(),
    month: text('month').notNull(), // e.g. '2026-03'
    spentAmountEur: real('spentAmountEur').default(0).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const monthlyTargets = pgTable('monthlyTargets', {
    id: text('id').primaryKey(),
    month: text('month').notNull(), // e.g. '2026-03'
    targetAppFissati: integer('targetAppFissati').default(0).notNull(),
    targetAppConfermati: integer('targetAppConfermati').default(0).notNull(),
    targetTrattative: integer('targetTrattative').default(0).notNull(),
    targetClosed: integer('targetClosed').default(0).notNull(),
    targetValoreContratti: real('targetValoreContratti').default(0).notNull(),
    workingDaysOverride: integer('workingDaysOverride'), // nullable — manager manual override
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (t) => ({
    monthCompanyUnique: unique('monthlyTargets_month_companyId_unique').on(t.month, t.companyId),
}));

export const dailyKpiSnapshots = pgTable('dailyKpiSnapshots', {
    id: text('id').primaryKey(),
    date: text('date').notNull(), // 'YYYY-MM-DD'
    fissaggioVariazionePerc: real('fissaggioVariazionePerc').default(0).notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (t) => ({
    dateCompanyUnique: unique('dailyKpiSnapshots_date_companyId_unique').on(t.date, t.companyId),
}));

// Snapshot per ogni fetch della pipeline GDO. Scritto solo quando il fingerprint
// (concat ordered IDs delle 3 tab) cambia rispetto al precedente, per evitare rumore
// da re-render. Serve a diagnosticare report di "lead spariti" confrontando snapshot consecutivi.
export const pipelineSnapshots = pgTable('pipelineSnapshots', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    firstCallCount: integer('firstCallCount').notNull(),
    secondCallCount: integer('secondCallCount').notNull(),
    thirdCallCount: integer('thirdCallCount').notNull(),
    recallsCount: integer('recallsCount').notNull(),
    firstCallIds: jsonb('firstCallIds').$type<string[]>().notNull(),
    secondCallIds: jsonb('secondCallIds').$type<string[]>().notNull(),
    thirdCallIds: jsonb('thirdCallIds').$type<string[]>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

// Heartbeat DB come fonte di verità della presence Conferme (Task P1,
// 2026-07-05): il Realtime Supabase (channel `conferme_realtime_board`,
// vedi src/lib/confermePresence.ts) resta il segnale "instant" ma è
// inaffidabile su reti/tab instabili — gli operatori a volte non si vedono
// online a vicenda. Il client fa upsert ogni 45s + a ogni cambio attività;
// il Radar considera "presente" chi è fresco (< 90s) qui OPPURE visibile
// via Realtime. Scritture trascurabili (~4 operatori × 1 upsert/45s).
export const presenceHeartbeats = pgTable('presenceHeartbeats', {
    userId: text('userId').primaryKey(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    activity: text('activity').notNull(), // es. 'board' | 'call' | 'idle'
    leadId: text('leadId'),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow().notNull(),
});

export const gdoNotes = pgTable('gdoNotes', {
    id: text('id').primaryKey(),
    gdoUserId: text('gdoUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    authorUserId: text('authorUserId').notNull().references(() => users.id),
    content: text('content').notNull(),
    category: text('category').notNull(), // 'formazione' | 'positivo' | 'negativo' | 'disciplinare'
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

// --- QUEST SYSTEM ---
export const quests = pgTable('quests', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    type: text('type').notNull(), // 'daily' | 'weekly'
    targetMetric: text('targetMetric').notNull(), // 'appointments_set' | 'calls_made' | 'leads_contacted'
    targetValue: integer('targetValue').notNull(),
    rewardXp: integer('rewardXp').notNull(),
    rewardCoins: integer('rewardCoins').notNull(),
    isActive: boolean('isActive').default(true).notNull(),
    role: text('role').default('GDO').notNull(), // 'GDO' | 'CONFERME' | 'VENDITORE'
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const questProgress = pgTable('questProgress', {
    id: text('id').primaryKey(),
    questId: text('questId').notNull().references(() => quests.id),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    currentValue: integer('currentValue').default(0).notNull(),
    completed: boolean('completed').default(false).notNull(),
    completedAt: timestamp('completedAt', { withTimezone: true, mode: 'date' }),
    dateScope: text('dateScope').notNull(), // 'YYYY-MM-DD' for daily, 'YYYY-Wnn' for weekly
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        userIdIdx: index('quest_progress_user_id_idx').on(table.userId),
        userDateScopeIdx: index('quest_progress_user_date_idx').on(table.userId, table.dateScope),
    };
});

// --- ACHIEVEMENT / BADGE SYSTEM ---
export const achievements = pgTable('achievements', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    icon: text('icon').notNull(), // Lucide icon name (e.g. 'Phone', 'Trophy')
    category: text('category').notNull(), // 'calls' | 'appointments' | 'streak' | 'quests' | 'level' | 'leads' | 'coins'
    metric: text('metric').notNull(), // 'total_calls' | 'total_appointments' | 'current_streak' | 'total_quests_completed' | 'current_level' | 'total_leads_contacted' | 'total_coins_earned'
    tier1Target: integer('tier1Target').notNull(),
    tier2Target: integer('tier2Target').notNull(),
    tier3Target: integer('tier3Target').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const userAchievements = pgTable('userAchievements', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    achievementId: text('achievementId').notNull().references(() => achievements.id),
    tier: integer('tier').notNull(), // 1 = bronze, 2 = silver, 3 = gold
    unlockedAt: timestamp('unlockedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        userIdIdx: index('user_achievements_user_id_idx').on(table.userId),
        // Prevents race-condition double-unlocks (checkAchievements is called fire-and-forget from
        // multiple server actions in parallel — without this, two concurrent calls can both insert).
        uniqUserAchTier: unique('user_ach_tier_unique').on(table.userId, table.achievementId, table.tier),
    };
});

// --- LOOT DROP SYSTEM ---
export const lootDrops = pgTable('lootDrops', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    rarity: text('rarity').notNull(), // 'common' | 'rare' | 'epic' | 'legendary'
    rewardType: text('rewardType').notNull(), // 'coins' | 'coins_xp' | 'coins_title'
    rewardValue: integer('rewardValue').notNull(), // coins amount
    bonusXp: integer('bonusXp').default(0).notNull(), // extra XP for epic
    bonusTitle: text('bonusTitle'), // title string for legendary drops
    opened: boolean('opened').default(false).notNull(),
    openedAt: timestamp('openedAt', { withTimezone: true, mode: 'date' }),
    droppedAt: timestamp('droppedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

// --- BOSS BATTLE SYSTEM ---
export const bossBattles = pgTable('bossBattles', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    totalHp: integer('totalHp').notNull(),
    currentHp: integer('currentHp').notNull(),
    rewardCoins: integer('rewardCoins').notNull(),
    rewardXp: integer('rewardXp').default(0).notNull(),
    startTime: timestamp('startTime', { withTimezone: true, mode: 'date' }).notNull(),
    endTime: timestamp('endTime', { withTimezone: true, mode: 'date' }).notNull(),
    status: text('status').default('active').notNull(), // 'active' | 'defeated' | 'expired'
    createdBy: text('createdBy').references(() => users.id),
    defeatedAt: timestamp('defeatedAt', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const bossContributions = pgTable('bossContributions', {
    id: text('id').primaryKey(),
    battleId: text('battleId').notNull().references(() => bossBattles.id),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    damage: integer('damage').notNull(),
    action: text('action').notNull(), // 'appointment_set' | 'manual'
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

// --- SEASONAL EVENTS ---
export const seasonalEvents = pgTable('seasonalEvents', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    theme: text('theme').notNull(), // 'spring' | 'summer' | 'halloween' | 'christmas' | 'custom'
    startDate: timestamp('startDate', { withTimezone: true, mode: 'date' }).notNull(),
    endDate: timestamp('endDate', { withTimezone: true, mode: 'date' }).notNull(),
    xpMultiplier: real('xpMultiplier').default(1).notNull(),
    coinsMultiplier: real('coinsMultiplier').default(1).notNull(),
    isActive: boolean('isActive').default(true).notNull(),
    creatureDropBoost: boolean('creatureDropBoost').default(false).notNull(),
    createdBy: text('createdBy').references(() => users.id),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const weeklyGamificationRules = pgTable('weeklyGamificationRules', {
    id: text('id').primaryKey(),
    month: text('month').notNull(), // e.g. '2026-03'
    targetTier1: integer('targetTier1').default(10).notNull(),
    rewardTier1: real('rewardTier1').default(135).notNull(),
    targetTier2: integer('targetTier2').default(13).notNull(),
    rewardTier2: real('rewardTier2').default(270).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (t) => ({
    monthCompanyUnique: unique('weeklyGamificationRules_month_companyId_unique').on(t.month, t.companyId),
}));

// --- FENICE UNIVERSE: CREATURE SYSTEM ---
export const creatures = pgTable('creatures', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    rarity: text('rarity').notNull(), // 'common' | 'rare' | 'epic' | 'legendary'
    element: text('element').notNull(), // 'fuoco' | 'terra' | 'acqua' | 'aria' | 'luce' | 'ombra'
    imageUrl: text('imageUrl'),
    baseXpBonus: real('baseXpBonus').notNull(), // 0.02 common, 0.05 rare, 0.10 epic, 0.15 legendary
    baseCoinBonus: real('baseCoinBonus').notNull(), // 0.01 common, 0.03 rare, 0.05 epic, 0.10 legendary
    maxLevel: integer('maxLevel').default(10).notNull(),
    isActive: boolean('isActive').default(true).notNull(),
});

export const userCreatures = pgTable('userCreatures', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    creatureId: text('creatureId').notNull().references(() => creatures.id),
    level: integer('level').default(1).notNull(),
    xpFed: integer('xpFed').default(0).notNull(),
    isEquipped: boolean('isEquipped').default(false).notNull(),
    obtainedAt: timestamp('obtainedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        userIdIdx: index('user_creatures_user_id_idx').on(table.userId),
    };
});

export const adventureProgress = pgTable('adventureProgress', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    currentStage: integer('currentStage').default(1).notNull(),
    currentBossHp: integer('currentBossHp'), // nullable — NULL if not in boss fight
    lastStageCompletedAt: timestamp('lastStageCompletedAt', { withTimezone: true, mode: 'date' }),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const adventureBosses = pgTable('adventureBosses', {
    id: text('id').primaryKey(),
    stageNumber: integer('stageNumber').notNull(), // 10, 20, 30, ...
    name: text('name').notNull(),
    description: text('description').notNull(),
    imageUrl: text('imageUrl'),
    totalHp: integer('totalHp').notNull(),
    element: text('element').notNull(),
    rewardCreatureId: text('rewardCreatureId').references(() => creatures.id),
    rewardCoins: integer('rewardCoins').notNull(),
    rewardTitle: text('rewardTitle'),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const actionChests = pgTable('actionChests', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    chestType: text('chestType').notNull(), // 'bronze' | 'silver' | 'gold' | 'platinum' | 'boss'
    requiredMetric: text('requiredMetric').notNull(), // 'chiamate' | 'fissaggi' | 'conferme' | 'presenze' | 'chiusure'
    requiredValue: integer('requiredValue').notNull(),
    currentValue: integer('currentValue').default(0).notNull(),
    isReady: boolean('isReady').default(false).notNull(),
    openedAt: timestamp('openedAt', { withTimezone: true, mode: 'date' }),
    rewardCreatureId: text('rewardCreatureId').references(() => creatures.id),
    rewardCoins: integer('rewardCoins'),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

// --- FENICE UNIVERSE: TEAM RPG (CONFERME) ---
export const teamRpgProfile = pgTable('teamRpgProfile', {
    id: text('id').primaryKey(),
    teamName: text('teamName').default('Team Conferme').notNull(),
    level: integer('level').default(1).notNull(),
    totalXp: integer('totalXp').default(0).notNull(),
    currentStage: integer('currentStage').default(1).notNull(),
    currentBossHp: integer('currentBossHp'), // nullable
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const teamCreatures = pgTable('teamCreatures', {
    id: text('id').primaryKey(),
    teamId: text('teamId').notNull().references(() => teamRpgProfile.id),
    creatureId: text('creatureId').notNull().references(() => creatures.id),
    level: integer('level').default(1).notNull(),
    xpFed: integer('xpFed').default(0).notNull(),
    isEquipped: boolean('isEquipped').default(false).notNull(),
    obtainedAt: timestamp('obtainedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    contributedByUserId: text('contributedByUserId').references(() => users.id),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

// --- FENICE UNIVERSE: TRADING & DUELS ---
export const tradingOffers = pgTable('tradingOffers', {
    id: text('id').primaryKey(),
    fromUserId: text('fromUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    toUserId: text('toUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    offeredCreatureId: text('offeredCreatureId').notNull().references(() => userCreatures.id),
    requestedCreatureId: text('requestedCreatureId').notNull().references(() => userCreatures.id),
    status: text('status').default('pending').notNull(), // 'pending' | 'accepted' | 'rejected'
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

export const duels = pgTable('duels', {
    id: text('id').primaryKey(),
    challengerId: text('challengerId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    opponentId: text('opponentId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(), // 'fissaggi' | 'chiamate'
    duration: integer('duration').notNull(), // minutes
    startTime: timestamp('startTime', { withTimezone: true, mode: 'date' }).notNull(),
    endTime: timestamp('endTime', { withTimezone: true, mode: 'date' }).notNull(),
    challengerScore: integer('challengerScore').default(0).notNull(),
    opponentScore: integer('opponentScore').default(0).notNull(),
    winnerId: text('winnerId').references(() => users.id),
    rewardCoins: integer('rewardCoins').notNull(),
    status: text('status').default('active').notNull(), // 'active' | 'completed'
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

// Aggiustamenti manuali admin (presenze GDO, chiusure Conferme)
export const manualAdjustments = pgTable('manualAdjustments', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    type: text('type').notNull(), // 'presenze' | 'chiusure'
    count: integer('count').notNull().default(1),
    note: text('note'),
    addedByUserId: text('addedByUserId').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

// Monthly lead upload target for the "Panoramica Generale" admin dashboard.
// baseline + live CRM count = ACT shown in the table.
// baselineSetAt is the timestamp at which the baseline was last saved: only leads
// created AFTER this timestamp are summed on top of the baseline (to avoid
// double-counting leads that were already part of the baseline snapshot).
export const monthlyLeadTargets = pgTable('monthlyLeadTargets', {
    id: text('id').primaryKey(),
    yearMonth: text('yearMonth').notNull().unique(), // 'YYYY-MM' (Europe/Rome)
    targetNuovi: integer('targetNuovi').notNull(),
    targetDatabase: integer('targetDatabase').notNull(),
    workingDays: integer('workingDays').notNull(),
    baselineNuovi: integer('baselineNuovi').default(0).notNull(),
    baselineDatabase: integer('baselineDatabase').default(0).notNull(),
    baselineSetAt: timestamp('baselineSetAt', { withTimezone: true, mode: 'date' }),
    // Monthly metric targets for the "Numeri mensili" overview table.
    // Stored as real to allow fractional targets (e.g. target presenze = 176.4).
    // TARGET/DAY = monthly / workingDays; TARGET PREV = daily × elapsed working days.
    targetAppMonthly: real('targetAppMonthly').default(0).notNull(),
    targetConfMonthly: real('targetConfMonthly').default(0).notNull(),
    targetPresMonthly: real('targetPresMonthly').default(0).notNull(),
    targetCloseMonthly: real('targetCloseMonthly').default(0).notNull(),
    targetFatturatoMonthly: real('targetFatturatoMonthly').default(0).notNull(),
    // Target percentuali manuali (% conversione di tappa). Se > 0 sovrascrivono
    // le percentuali a cascata calcolate in getMetricsOverview; se 0 fallback su
    // cascata (targetConfMonthly / targetAppMonthly, ecc.).
    targetAppPct: real('targetAppPct').default(0).notNull(),
    targetConfPct: real('targetConfPct').default(0).notNull(),
    targetPresPct: real('targetPresPct').default(0).notNull(),
    targetClosePct: real('targetClosePct').default(0).notNull(),
    // Extra offsets: difference between the Excel "Numeri Mensili" totals and the
    // per-funnel delta sums. Added on top of funnel totals in getMetricsOverview.
    appExtra: integer('appExtra').default(0).notNull(),
    confermeExtra: integer('confermeExtra').default(0).notNull(),
    trattativeExtra: integer('trattativeExtra').default(0).notNull(),
    closeExtra: integer('closeExtra').default(0).notNull(),
    fatturatoExtraEur: real('fatturatoExtraEur').default(0).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

// --- ACTIVECAMPAIGN INTAKE FAILURES ---
// Traccia i contatti AC che non sono stati importati nel CRM. Il manager
// può esaminare i dettagli, andare a verificare su AC e segnare come
// risolto, oppure forzare un retry via la UI /lead-automatici.
export const acIntakeFailures = pgTable('acIntakeFailures', {
    id: text('id').primaryKey(),
    acContactId: text('acContactId'),
    reason: text('reason').notNull(),
    provenienza: text('provenienza'),
    email: text('email'),
    phoneRaw: text('phoneRaw'),
    payload: jsonb('payload'),
    resolvedAt: timestamp('resolvedAt', { withTimezone: true, mode: 'date' }),
    resolvedBy: text('resolvedBy').references(() => users.id),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        createdIdx: index('ac_intake_failures_created_idx').on(table.createdAt),
        resolvedIdx: index('ac_intake_failures_resolved_idx').on(table.resolvedAt),
    };
});

// --- LEAD SURVEYS (Sondaggi lead: GDO, Conferme, Venditore) ---
// One survey per lead per role (unique constraint on leadId).
// Multi-select fields stored as text[]; single-choice as text with
// enum values enforced at application layer (see src/lib/surveys/questions.ts).
// Filtro globale: applicabile SOLO a lead con funnel != 'database'.
export const gdoLeadSurveys = pgTable('gdoLeadSurveys', {
    id: text('id').primaryKey(),
    leadId: text('leadId').notNull().unique().references(() => leads.id, { onDelete: 'cascade' }),
    gdoUserId: text('gdoUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Single-choice
    ageRange: text('ageRange'),              // '18-24'|'25-35'|'35-45'|'45-55'|'55+'
    occupation: text('occupation'),          // 'disoccupato'|'studente'|'full_time'|'part_time'|'p_iva'|'pensionato'
    mainProblem: text('mainProblem'),        // 'economico'|'insoddisfatto'|'tempo'|'competenze'
    digitalKnow: text('digitalKnow'),        // 'nulla'|'ha_visto'|'conosce'|'esperto'
    changeWithin: text('changeWithin'),      // '<30gg'|'30-90gg'|'indefinito'
    changeSince: text('changeSince'),        // '<6m'|'6-12m'|'>12m'
    // Single-choice (erano multi — convertiti 2026-04-17)
    requestReason: text('requestReason'),   // 'corso'|'valuta'|'info'|'curiosita'
    expectation: text('expectation'),       // 'info'|'materiale_gratis'|'comprare'|'capire'
    // Completion & early-exit
    completed: boolean('completed').default(false).notNull(),
    earlyExitReason: text('earlyExitReason'), // 'no_budget'|'solo_corso_10h'|'curioso'|'altro'|null
    // Anti-gaming
    fillDurationMs: integer('fillDurationMs'),
    suspicious: boolean('suspicious').default(false).notNull(),
    invalidatedBy: text('invalidatedBy').references(() => users.id),
    invalidatedAt: timestamp('invalidatedAt', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        gdoUserIdx: index('gdo_surveys_user_idx').on(table.gdoUserId),
        createdAtIdx: index('gdo_surveys_created_idx').on(table.createdAt),
    };
});

export const confermeLeadSurveys = pgTable('confermeLeadSurveys', {
    id: text('id').primaryKey(),
    leadId: text('leadId').notNull().unique().references(() => leads.id, { onDelete: 'cascade' }),
    confermeUserId: text('confermeUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    remembersAppt: boolean('remembersAppt'),
    watchedVideo: boolean('watchedVideo'),
    confirmed: boolean('confirmed'),
    whyNot: text('whyNot'),                 // 'non_risponde'|'non_interessato'|'no_soldi'|'posticipa_senza_data'|null
    // Diagnosi/qualifica (Parte A)
    works: boolean('works'),                          // "lavora / non lavora"
    // Briefing venditore (Parte B) — stessa forma del botReport
    summary: text('summary'),
    painPoints: text('painPoints').array(),
    urgency: text('urgency'),                          // 'alta'|'media'|'bassa'
    budgetSignal: text('budgetSignal'),               // 'ok'|'incerto'|'no'
    objections: text('objections').array(),
    levaConsigliata: text('levaConsigliata'),
    fillDurationMs: integer('fillDurationMs'),
    suspicious: boolean('suspicious').default(false).notNull(),
    invalidatedBy: text('invalidatedBy').references(() => users.id),
    invalidatedAt: timestamp('invalidatedAt', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        confermeUserIdx: index('conferme_surveys_user_idx').on(table.confermeUserId),
        createdAtIdx: index('conferme_surveys_created_idx').on(table.createdAt),
    };
});

export const salesLeadSurveys = pgTable('salesLeadSurveys', {
    id: text('id').primaryKey(),
    leadId: text('leadId').notNull().unique().references(() => leads.id, { onDelete: 'cascade' }),
    salesUserId: text('salesUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Multi-select
    problemSignals: text('problemSignals').array(),   // ['problema_specifico','gia_provato','situazione_concreta','nessuna']
    urgencySignals: text('urgencySignals').array(),   // ['entro_3m','non_sostenibile','data_certa','nessuna']
    // Single-choice
    priceReaction: text('priceReaction'),             // 'avanti'|'modalita_pagamento'|'alto'|'non_posso'|'evita'
    fillDurationMs: integer('fillDurationMs'),
    suspicious: boolean('suspicious').default(false).notNull(),
    invalidatedBy: text('invalidatedBy').references(() => users.id),
    invalidatedAt: timestamp('invalidatedAt', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        salesUserIdx: index('sales_surveys_user_idx').on(table.salesUserId),
        createdAtIdx: index('sales_surveys_created_idx').on(table.createdAt),
    };
});

// Storia degli esiti venditore: un record per ogni tentativo/esito su un lead.
// leads.* resta lo stato "corrente" per KPI/board; questa tabella è la storia
// su cui gira l'analytics performance (motivi, funnel follow-up, tentativi medi).
export const salesAttempts = pgTable('salesAttempts', {
    id: text('id').primaryKey(),
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    salesUserId: text('salesUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // 0 = esito post-appuntamento; 1..3 = follow-up successivi.
    attemptNumber: integer('attemptNumber').notNull(),
    outcome: text('outcome').notNull(),            // 'Chiuso' | 'Non chiuso' | 'Perso' | 'Sparito'
    notClosedReason: text('notClosedReason'),      // uno degli 8 motivi (solo Non chiuso/Perso)
    nextFollowUpDate: timestamp('nextFollowUpDate', { withTimezone: true, mode: 'date' }), // solo se Non chiuso
    closeProduct: text('closeProduct'),            // 'advance'|'gold'|'exclusive' (solo Chiuso)
    closeAmountEur: real('closeAmountEur'),        // solo Chiuso
    // Data effettiva dell'esito (mirror di leads.salespersonOutcomeAt): usata per i bounds periodo.
    outcomeAt: timestamp('outcomeAt', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
}, (table) => {
    return {
        leadIdx: index('sales_attempts_lead_idx').on(table.leadId),
        userDateIdx: index('sales_attempts_user_date_idx').on(table.salesUserId, table.outcomeAt),
        companyDateIdx: index('sales_attempts_company_date_idx').on(table.companyId, table.outcomeAt),
    };
});

// Focus di coaching settimanale assegnato dal manager al venditore.
export const salesWeeklyFocus = pgTable('salesWeeklyFocus', {
    id: text('id').primaryKey(),
    salesUserId: text('salesUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    weekStart: text('weekStart').notNull(),        // 'YYYY-MM-DD' = lunedì (Rome)
    objection: text('objection'),                  // uno degli 8 motivi (nullable)
    taskNote: text('taskNote').notNull().default(''),
    createdBy: text('createdBy').notNull().references(() => users.id),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
}, (table) => {
    return {
        weekUnique: uniqueIndex('sales_weekly_focus_user_week_uq').on(table.companyId, table.salesUserId, table.weekStart),
    };
});

// Per-funnel monthly baseline table shown in "Panoramica Generale".
// - leadCount / fatturatoEur / spesaEur are ABSOLUTE values (edited directly).
// - appDelta / confermeDelta / trattativeDelta / closeDelta are DELTAS summed
//   with the live CRM count for that funnel in that month. When the admin edits
//   a displayed value, we store new_delta = new_value - current_crm_count — so
//   subsequent CRM changes still update the counter automatically.
// - dataPrimoSottoSoglia + statoSegnalazione track the alert state: when close%
//   drops below 1% (strictly), the date is recorded and status becomes PRE_RISK;
//   after 7 days without recovery, status becomes ALLERT. When close% returns
//   above 1%, both fields reset.
export const monthlyFunnelBaselines = pgTable('monthlyFunnelBaselines', {
    id: text('id').primaryKey(),
    yearMonth: text('yearMonth').notNull(), // 'YYYY-MM'
    funnelName: text('funnelName').notNull(), // stored UPPER CASE (case-insensitive match with leads.funnel)
    // Absolute values (no summing)
    leadCount: integer('leadCount').default(0).notNull(),
    // Deltas summed with live CRM counts
    appDelta: integer('appDelta').default(0).notNull(),
    confermeDelta: integer('confermeDelta').default(0).notNull(),
    trattativeDelta: integer('trattativeDelta').default(0).notNull(),
    closeDelta: integer('closeDelta').default(0).notNull(),
    // Revenue / ad spend — manual
    fatturatoEur: real('fatturatoEur').default(0).notNull(),
    spesaEur: real('spesaEur').default(0).notNull(),
    // Alert state
    dataPrimoSottoSoglia: timestamp('dataPrimoSottoSoglia', { withTimezone: true, mode: 'date' }),
    statoSegnalazione: text('statoSegnalazione').default('OK').notNull(), // 'OK' | 'PRE_RISK' | 'ALLERT'
    // Timestamp in cui la baseline leadCount è stata impostata. Solo i lead
    // creati DOPO questa data si sommano al leadCount nel display (così
    // l'import automatico aggiunge i nuovi lead al totale del funnel).
    baselineSetAt: timestamp('baselineSetAt', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        unqYmFunnel: unique('funnel_baseline_unique').on(table.yearMonth, table.funnelName),
    };
});

// Portafoglio clienti post-vendita (entità separata dai leads).
// Per ora ospita solo i clienti del corso SMM (Social Media Manager) già paganti.
// Inserimento manuale; nessun automatismo dal funnel leads.
// Workflow follow-up:
//   1. Cliente aggiunto → presente in "Pacchetto Clienti" (master, sempre)
//   2. Venditore spunta followUpMessageSent → outcome auto = 'IN_TRATTATIVA'
//   3. Venditore traccia followUpResponded / appointmentSet
//   4. Esito finale: outcome = 'CHIUSO' (con upsellAmountEur) | 'NON_CHIUSO'
export const customerPortfolios = pgTable('customerPortfolios', {
    id: text('id').primaryKey(),
    salespersonUserId: text('salespersonUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // Anagrafica
    firstName: text('firstName').notNull(),
    lastName: text('lastName').notNull(),
    email: text('email'),
    phone: text('phone'),

    // Contratto firmato
    course: text('course').default('SMM').notNull(), // 'SMM' (per ora unico)
    packageType: text('packageType').notNull(), // 'ADVANCE' | 'GOLD' | 'EXCLUSIVE'
    contractAmountEur: real('contractAmountEur').notNull(),
    contractSignedAt: timestamp('contractSignedAt', { withTimezone: true, mode: 'date' }).notNull(),

    // Follow-up workflow
    followUpMessageSent: boolean('followUpMessageSent').default(false).notNull(),
    followUpMessageSentAt: timestamp('followUpMessageSentAt', { withTimezone: true, mode: 'date' }),
    followUpResponded: boolean('followUpResponded'), // null = non valutato
    appointmentSet: boolean('appointmentSet'), // null = non valutato (include "risentito")

    // Esito upsell
    outcome: text('outcome'), // null | 'IN_TRATTATIVA' | 'CHIUSO' | 'NON_CHIUSO'
    upsellAmountEur: real('upsellAmountEur'), // valorizzato solo se outcome='CHIUSO'

    notes: text('notes'),

    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
}, (table) => {
    return {
        salespersonIdx: index('customer_portfolios_salesperson_idx').on(table.salespersonUserId),
        outcomeIdx: index('customer_portfolios_outcome_idx').on(table.outcome),
        signedAtIdx: index('customer_portfolios_signed_at_idx').on(table.contractSignedAt),
    };
});

// Settings globali chiave-valore (override modificabili da admin senza redeploy).
// Use case attuale: CPL per il calcolo Costo per Appuntamento / Costo per Contratto
// nella Dashboard Operativa Aziendale. Generica per ospitare altri parametri futuri.
export const appSettings = pgTable('appSettings', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedBy: text('updatedBy'),
    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })
});

// Outbox queue per i webhook al CRM marketing esterno.
// Ogni evento del funnel (appointment.set, appointment.outcome, deal.assigned,
// deal.closed_won, deal.closed_lost) genera una riga qui. Il worker drainer
// (cron + after() inline) la consuma con retry esponenziale.
export const marketingWebhookDeliveries = pgTable('marketingWebhookDeliveries', {
    id: text('id').primaryKey(),                                   // = eventId (UUID v4 deterministic)
    eventType: text('eventType').notNull(),                        // 'appointment.set' | 'appointment.outcome' | 'deal.assigned' | 'deal.closed_won' | 'deal.closed_lost'
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull(),                           // envelope completo già pronto da firmare
    targetUrl: text('targetUrl').notNull(),                        // URL del receiver (snapshot al momento dell'enqueue)

    status: text('status').default('pending').notNull(),           // 'pending' | 'delivered' | 'failed_permanent' | 'dead'
    attempts: integer('attempts').default(0).notNull(),
    lastAttemptAt: timestamp('lastAttemptAt', { withTimezone: true, mode: 'date' }),
    nextAttemptAt: timestamp('nextAttemptAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deliveredAt: timestamp('deliveredAt', { withTimezone: true, mode: 'date' }),

    lastResponseStatus: integer('lastResponseStatus'),
    lastError: text('lastError'),                                  // troncato a 1000 char in app

    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => {
    return {
        statusNextIdx: index('mkt_webhook_status_next_idx').on(t.status, t.nextAttemptAt),
        leadIdx: index('mkt_webhook_lead_idx').on(t.leadId),
        eventTypeIdx: index('mkt_webhook_event_type_idx').on(t.eventType),
    };
});

// ═══════════════════════════════════════════════════════════════════════════════
// MARKETING TABLES (ex crm-marketing repo, assorbito 2026-05-29)
// Schema portato da docs/merge-marketing-schema.md. Convenzioni:
//   - Tutte le marketing table hanno companyId FK su companies con onUpdate cascade.
//   - DB column names in snake_case per compat col loro raw SQL legacy (se servisse).
//   - Fix applicati durante port (vedi schema doc §"PK rewrites needed"):
//     * marketing_targets PK → (companyId, id) con id default 1
//     * ad_scripts PK → (companyId, ad_name_normalized) (era cross-tenant collision)
//     * ac_sync_state PK → (companyId) single-row
//   - Numeric: numeric(14,4) per cost metrics, numeric(10,2) per €.
//   - Counter: bigint per impressions/clicks/leads_meta.
// ═══════════════════════════════════════════════════════════════════════════════

// Funnel config per-tenant (Meta account, AC list, provenienza patterns).
// Sostituisce la vecchia hardcoded src/lib/funnels.ts.
export const companyFunnels = pgTable('company_funnels', {
    companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),                                                // slug funnel ('telegram', 'corso10ore', etc.)
    name: text('name').notNull(),
    metaAccount: text('meta_account'),                                       // act_XXXX Meta ad-account id
    metaKeyword: text('meta_keyword'),                                       // keyword filtro Meta ads
    acList: text('ac_list'),                                                 // ActiveCampaign list name
    acSalesTagId: text('ac_sales_tag_id'),
    acProvenienzaPatterns: jsonb('ac_provenienza_patterns').$type<string[]>().notNull().default([]),
    color: text('color').default('bg-slate-500').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.id] }),
}));

// EAV cache per metriche ActiveCampaign. Una riga per (company, funnel, day, metric).
// Today (Europe/Rome) NON è mai cached, solo le righe per giorni passati.
export const acDailyMetrics = pgTable('ac_daily_metrics', {
    companyId: text('company_id').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    funnelId: text('funnel_id').notNull(),
    date: date('date').notNull(),                                            // YYYY-MM-DD
    metric: text('metric').notNull(),                                        // 'leads' | 'leads_by_ad'
    payload: jsonb('payload').notNull(),                                     // shape dipende da metric
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.funnelId, t.date, t.metric] }),
    // 2026-07-05: droppato ac_daily_metrics_company_funnel_date_idx (mai usato, Disk IO)
}));

// Mirror per-contact dei record ActiveCampaign. Popolato da ac-sync cron.
export const acContacts = pgTable('ac_contacts', {
    companyId: text('company_id').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    contactId: text('contact_id').notNull(),                                 // AC contact id
    email: text('email'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    phone: text('phone'),
    cdate: timestamp('cdate', { withTimezone: true, mode: 'date' }).notNull(),   // AC created
    udate: timestamp('udate', { withTimezone: true, mode: 'date' }),             // AC updated
    funnelId: text('funnel_id'),                                             // resolved da provenienza
    provenienzaRaw: text('provenienza_raw'),                                 // custom field AC id=2
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmTerm: text('utm_term'),                                               // ad_name
    utmContent: text('utm_content'),
    isCliente: boolean('is_cliente').default(false).notNull(),               // tag id=35 'Cliente'
    contractDate: date('contract_date'),                                     // earliest cdate del Cliente tag
    contractValue: numeric('contract_value', { precision: 12, scale: 2 }),  // custom field id=43
    syncedAt: timestamp('synced_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    manuallyExcluded: boolean('manually_excluded').default(false).notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.contactId] }),
}));

// Cursore sync incrementale AC. Una riga per company.
export const acSyncState = pgTable('ac_sync_state', {
    companyId: text('company_id').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    key: text('key').notNull(),                                              // attualmente solo 'last_synced_at'
    value: text('value').notNull(),                                          // ISO timestamp
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.key] }),                      // widened da single-col per future keys
}));

// Per-ad per-day Meta Ads insights cache.
export const adsDailyInsights = pgTable('ads_daily_insights', {
    companyId: text('company_id').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    adId: text('ad_id').notNull(),
    date: date('date').notNull(),
    accountId: text('account_id').notNull(),                                 // act_XXXX
    funnelId: text('funnel_id').notNull(),
    campaignName: text('campaign_name'),
    adsetName: text('adset_name'),
    adName: text('ad_name'),
    spend: numeric('spend', { precision: 14, scale: 4 }).notNull(),
    impressions: bigint('impressions', { mode: 'number' }).notNull(),
    clicks: bigint('clicks', { mode: 'number' }).notNull(),
    cpm: numeric('cpm', { precision: 14, scale: 4 }).notNull(),
    ctr: numeric('ctr', { precision: 14, scale: 4 }).notNull(),
    cpc: numeric('cpc', { precision: 14, scale: 4 }).notNull(),
    leadsMeta: integer('leads_meta').notNull(),
    effectiveStatus: text('effective_status'),
    postUrl: text('post_url'),
}, (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.adId, t.date] }),
    // 2026-07-05: droppato ads_daily_insights_company_funnel_date_idx (mai usato, Disk IO)
}));

// Marker "fetched" — conferma che per (company, funnel, date) i dati Meta sono
// stati pull-ati, anche se zero ads. Distingue "nessun ad" da "non ancora sincronizzato".
export const adsDailyFetches = pgTable('ads_daily_fetches', {
    companyId: text('company_id').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    funnelId: text('funnel_id').notNull(),
    date: date('date').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.funnelId, t.date] }),
}));

// Spend account-level Meta (no keyword filter). Cattura brand/test ads fuori funnel.
export const metaAccountDaily = pgTable('meta_account_daily', {
    companyId: text('company_id').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    accountId: text('account_id').notNull(),                                 // act_XXXX
    date: date('date').notNull(),
    spend: numeric('spend', { precision: 14, scale: 4 }).notNull(),
    impressions: bigint('impressions', { mode: 'number' }).notNull(),
    clicks: bigint('clicks', { mode: 'number' }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.accountId, t.date] }),
}));

// Target dashboard (CAC, AOV, lead targets, ROAS).
// NOTA fix port: id era hardcoded a 1 + PK su (id) col rischio collision cross-tenant.
// PK ora (companyId, id) con id default 1 — una row per company.
// I lead_target_* funnel-specific sono Fenice-only legacy; in futuro refactor
// in child table marketing_funnel_targets (companyId, funnelId, leadTarget).
export const marketingTargets = pgTable('marketing_targets', {
    companyId: text('company_id').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    id: integer('id').default(1).notNull(),                                  // hardcoded 1 — single row per company
    aov: numeric('aov', { precision: 10, scale: 2 }).notNull(),
    cac: numeric('cac', { precision: 10, scale: 2 }).notNull(),
    costApp: numeric('cost_app', { precision: 10, scale: 2 }).notNull(),
    costConf: numeric('cost_conf', { precision: 10, scale: 2 }).notNull(),
    leadTargetTotal: integer('lead_target_total'),
    leadTargetTelegram: integer('lead_target_telegram'),                     // legacy Fenice-specific
    leadTargetCorso10ore: integer('lead_target_corso10ore'),                 // legacy Fenice-specific
    leadTargetJobsimulator: integer('lead_target_jobsimulator'),             // legacy Fenice-specific
    roasTarget: numeric('roas_target', { precision: 10, scale: 2 }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.id] }),
}));

// Script creative per-ad.
// NOTA fix port: PK era (ad_name_normalized) cross-tenant — ora (companyId, ad_name_normalized).
export const adScripts = pgTable('ad_scripts', {
    companyId: text('company_id').notNull().references(() => companies.id, { onUpdate: 'cascade' }),
    adNameNormalized: text('ad_name_normalized').notNull(),                  // canonical key (lowercased)
    adName: text('ad_name').notNull(),                                       // display name
    script: text('script').notNull(),                                        // long-form text
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.companyId, t.adNameNormalized] }),
}));

// ─── CRM event log + read models (per ora mantenuti per back-compat marketing UI) ───
// Decisione design doc §5: opzione (B) — mantenere read model proiettato in-process.
// In Fase 3+ riscrivere reader marketing su leads/leadEvents diretti, eliminare crm_appointments/crm_deals.

// Audit log immutabile webhook CRM. PK = event_id (idempotency).
export const crmEvents = pgTable('crm_events', {
    eventId: text('event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    companyId: text('company_id').notNull().references(() => companies.id),
    leadId: text('lead_id'),
    payload: jsonb('payload').notNull(),
}, (t) => ({
    // 2026-07-05: droppati crm_events_company_occurred_idx / _lead_idx / _type_idx (mai usati, Disk IO)
}));

// Read model per appointment.set + appointment.outcome.
export const crmAppointments = pgTable('crm_appointments', {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: text('company_id').notNull().references(() => companies.id),
    leadId: text('lead_id').notNull(),
    appointmentDate: date('appointment_date').notNull(),
    funnel: text('funnel'),
    utmTerm: text('utm_term'),
    status: text('status').default('SET').notNull(),
    leadName: text('lead_name'),
    leadEmail: text('lead_email'),
    leadPhone: text('lead_phone'),
    setEventId: text('set_event_id').references(() => crmEvents.eventId),
    outcomeEventId: text('outcome_event_id').references(() => crmEvents.eventId),
    setAt: timestamp('set_at', { withTimezone: true, mode: 'date' }),
    outcomeAt: timestamp('outcome_at', { withTimezone: true, mode: 'date' }),
    rawOutcome: text('raw_outcome'),
    manuallyExcluded: boolean('manually_excluded').default(false).notNull(),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
}, (t) => ({
    companyLeadDateUnique: unique('crm_appointments_company_lead_date_unique').on(t.companyId, t.leadId, t.appointmentDate),
    // 2026-07-05: droppati crm_appointments_company_date_idx / _company_funnel_date_idx / _status_idx (mai usati, Disk IO)
}));

// Read model per deal.closed_won + deal.closed_lost.
export const crmDeals = pgTable('crm_deals', {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: text('company_id').notNull().references(() => companies.id),
    leadId: text('lead_id').notNull(),
    eventId: text('event_id').notNull().references(() => crmEvents.eventId),
    status: text('status').notNull(),                                        // 'WON' | 'LOST'
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }).notNull(),
    closedDate: date('closed_date').notNull(),
    funnel: text('funnel'),
    utmTerm: text('utm_term'),
    product: text('product'),
    amountEur: numeric('amount_eur', { precision: 10, scale: 2 }),
    salespersonId: text('salesperson_id'),
    salespersonName: text('salesperson_name'),
    manuallyExcluded: boolean('manually_excluded').default(false).notNull(),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
}, (t) => ({
    companyEventUnique: unique('crm_deals_company_event_unique').on(t.companyId, t.eventId),
    // 2026-07-05: droppati crm_deals_company_closed_idx / _company_funnel_closed_idx / _company_salesperson_idx (mai usati, Disk IO)
}));

