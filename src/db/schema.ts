import { pgTable, text, integer, real, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: text('id').primaryKey(),
    name: text('name'),
    email: text('email').unique(),
    password: text('password').notNull(),
    role: text('role').default('GDO').notNull(),

    // GDO Profiling
    gdoCode: integer('gdoCode').unique(), // 105, 113, etc.
    displayName: text('displayName'),
    avatarUrl: text('avatarUrl'),
    isActive: boolean('isActive').default(true).notNull(),
    walletCoins: integer('walletCoins').default(0).notNull(),
    equippedItemId: text('equippedItemId'), // references shopItems.id optionally

    // Targets
    dailyApptTarget: integer('dailyApptTarget').default(2).notNull(),
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

    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const leads = pgTable('leads', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone').unique().notNull(),
    funnel: text('funnel'),
    status: text('status').default('NEW').notNull(),
    callCount: integer('callCount').default(0).notNull(),
    assignedToId: text('assignedToId').references(() => users.id),
    lastCallDate: timestamp('lastCallDate', { withTimezone: true, mode: 'date' }),
    lastCallNote: text('lastCallNote'),
    recallDate: timestamp('recallDate', { withTimezone: true, mode: 'date' }),
    appointmentDate: timestamp('appointmentDate', { withTimezone: true, mode: 'date' }),
    appointmentNote: text('appointmentNote'),
    appointmentCreatedAt: timestamp('appointmentCreatedAt', { withTimezone: true, mode: 'date' }),
    discardReason: text('discardReason'),

    // Conferme Flow
    confCall1At: timestamp('confCall1At', { withTimezone: true, mode: 'date' }),
    confCall2At: timestamp('confCall2At', { withTimezone: true, mode: 'date' }),
    confCall3At: timestamp('confCall3At', { withTimezone: true, mode: 'date' }),
    confVslSeen: boolean('confVslSeen').default(false).notNull(),
    confNeedsReschedule: boolean('confNeedsReschedule').default(false).notNull(),
    confSnoozeAt: timestamp('confSnoozeAt', { withTimezone: true, mode: 'date' }),
    confRecallNotes: text('confRecallNotes'),

    confirmationsOutcome: text('confirmationsOutcome'),
    confirmationsDiscardReason: text('confirmationsDiscardReason'),
    confirmationsUserId: text('confirmationsUserId'),
    confirmationsTimestamp: timestamp('confirmationsTimestamp', { withTimezone: true, mode: 'date' }),
    salespersonAssigned: text('salespersonAssigned'),
    salespersonAssignedAt: timestamp('salespersonAssignedAt', { withTimezone: true, mode: 'date' }),
    salespersonUserId: text('salespersonUserId').references(() => users.id),
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
}, (table) => {
    return {
        statusIdx: index('status_idx').on(table.status),
        assignedToIdx: index('assigned_to_idx').on(table.assignedToId),
        recallDateIdx: index('recall_date_idx').on(table.recallDate),
        appointmentDateIdx: index('appointment_date_idx').on(table.appointmentDate),
    };
});

export const callLogs = pgTable('callLogs', {
    id: text('id').primaryKey(),
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    userId: text('userId'),
    outcome: text('outcome').notNull(),
    note: text('note'),
    discardReason: text('discardReason'),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
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
});

export const assignmentSettings = pgTable('assignmentSettings', {
    id: text('id').primaryKey(),
    mode: text('mode').default('equal').notNull(),
    settings: jsonb('settings'),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedBy: text('updatedBy').notNull(),
});

export const importLogs = pgTable('importLogs', {
    id: text('id').primaryKey(),
    totalRows: integer('totalRows').notNull(),
    importedCount: integer('importedCount').notNull(),
    duplicateCount: integer('duplicateCount').notNull(),
    invalidCount: integer('invalidCount').notNull(),
    perGdoAssigned: jsonb('perGdoAssigned'),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const sprints = pgTable('sprints', {
    id: text('id').primaryKey(),
    startTime: timestamp('startTime', { withTimezone: true, mode: 'date' }).notNull(),
    endTime: timestamp('endTime', { withTimezone: true, mode: 'date' }).notNull(),
    actualEndTime: timestamp('actualEndTime', { withTimezone: true, mode: 'date' }),
    status: text('status').default('active').notNull(),
    startedByManagerId: text('startedByManagerId').references(() => users.id),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const shopItems = pgTable('shopItems', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    cost: integer('cost').notNull(),
    cssValue: text('cssValue').notNull(),
    isActive: boolean('isActive').default(true).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const userPurchases = pgTable('userPurchases', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    shopItemId: text('shopItemId').notNull().references(() => shopItems.id, { onDelete: 'cascade' }),
    purchasedAt: timestamp('purchasedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const coinTransactions = pgTable('coinTransactions', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const confirmationsNotes = pgTable('confirmationsNotes', {
    id: text('id').primaryKey(),
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    authorId: text('authorId').notNull().references(() => users.id),
    text: text('text').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const internalAlerts = pgTable('internalAlerts', {
    id: text('id').primaryKey(),
    senderId: text('senderId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    receiverId: text('receiverId').references(() => users.id, { onDelete: 'cascade' }), // Nullable for broadcast
    message: text('message').notNull(),
    isRead: boolean('isRead').default(false).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
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
});

export const calendarEvents = pgTable('calendarEvents', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    eventType: text('eventType').notNull(),
    googleEventId: text('googleEventId'),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
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
});

export const marketingBudgets = pgTable('marketingBudgets', {
    id: text('id').primaryKey(),
    funnel: text('funnel').notNull(),
    month: text('month').notNull(), // e.g. '2026-03'
    spentAmountEur: real('spentAmountEur').default(0).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const monthlyTargets = pgTable('monthlyTargets', {
    id: text('id').primaryKey(),
    month: text('month').notNull().unique(), // e.g. '2026-03'
    targetAppFissati: integer('targetAppFissati').default(0).notNull(),
    targetAppConfermati: integer('targetAppConfermati').default(0).notNull(),
    targetTrattative: integer('targetTrattative').default(0).notNull(),
    targetClosed: integer('targetClosed').default(0).notNull(),
    targetValoreContratti: real('targetValoreContratti').default(0).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const dailyKpiSnapshots = pgTable('dailyKpiSnapshots', {
    id: text('id').primaryKey(),
    date: text('date').notNull().unique(), // 'YYYY-MM-DD'
    fissaggioVariazionePerc: real('fissaggioVariazionePerc').default(0).notNull(),
});

export const weeklyGamificationRules = pgTable('weeklyGamificationRules', {
    id: text('id').primaryKey(),
    month: text('month').notNull().unique(), // e.g. '2026-03'
    targetTier1: integer('targetTier1').default(10).notNull(),
    rewardTier1: real('rewardTier1').default(135).notNull(),
    targetTier2: integer('targetTier2').default(13).notNull(),
    rewardTier2: real('rewardTier2').default(270).notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});
