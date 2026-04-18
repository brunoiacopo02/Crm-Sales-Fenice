import { pgTable, text, integer, real, boolean, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';

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
    status: text('status').default('NEW').notNull(),
    callCount: integer('callCount').default(0).notNull(),
    assignedToId: text('assignedToId').references(() => users.id),
    lastCallDate: timestamp('lastCallDate', { withTimezone: true, mode: 'date' }),
    lastCallNote: text('lastCallNote'),
    recallNote: text('recallNote'),
    agendaSentAt: timestamp('agendaSentAt', { withTimezone: true, mode: 'date' }),
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
        confirmationsOutcomeIdx: index('confirmations_outcome_idx').on(table.confirmationsOutcome),
        assignedStatusIdx: index('assigned_status_idx').on(table.assignedToId, table.status),
        assignedRecallIdx: index('assigned_recall_idx').on(table.assignedToId, table.recallDate),
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
}, (table) => {
    return {
        userIdIdx: index('calllogs_user_id_idx').on(table.userId),
        userCreatedAtIdx: index('calllogs_user_created_at_idx').on(table.userId, table.createdAt),
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
}, (table) => {
    return {
        leadIdIdx: index('lead_events_lead_id_idx').on(table.leadId),
        userIdIdx: index('lead_events_user_id_idx').on(table.userId),
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
    workingDaysOverride: integer('workingDaysOverride'), // nullable — manager manual override
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const dailyKpiSnapshots = pgTable('dailyKpiSnapshots', {
    id: text('id').primaryKey(),
    date: text('date').notNull().unique(), // 'YYYY-MM-DD'
    fissaggioVariazionePerc: real('fissaggioVariazionePerc').default(0).notNull(),
});

export const gdoNotes = pgTable('gdoNotes', {
    id: text('id').primaryKey(),
    gdoUserId: text('gdoUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    authorUserId: text('authorUserId').notNull().references(() => users.id),
    content: text('content').notNull(),
    category: text('category').notNull(), // 'formazione' | 'positivo' | 'negativo' | 'disciplinare'
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
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
});

export const userAchievements = pgTable('userAchievements', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    achievementId: text('achievementId').notNull().references(() => achievements.id),
    tier: integer('tier').notNull(), // 1 = bronze, 2 = silver, 3 = gold
    unlockedAt: timestamp('unlockedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
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
});

export const bossContributions = pgTable('bossContributions', {
    id: text('id').primaryKey(),
    battleId: text('battleId').notNull().references(() => bossBattles.id),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    damage: integer('damage').notNull(),
    action: text('action').notNull(), // 'appointment_set' | 'manual'
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
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
    // Extra offsets: difference between the Excel "Numeri Mensili" totals and the
    // per-funnel delta sums. Added on top of funnel totals in getMetricsOverview.
    appExtra: integer('appExtra').default(0).notNull(),
    confermeExtra: integer('confermeExtra').default(0).notNull(),
    trattativeExtra: integer('trattativeExtra').default(0).notNull(),
    closeExtra: integer('closeExtra').default(0).notNull(),
    fatturatoExtraEur: real('fatturatoExtraEur').default(0).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
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
    fillDurationMs: integer('fillDurationMs'),
    suspicious: boolean('suspicious').default(false).notNull(),
    invalidatedBy: text('invalidatedBy').references(() => users.id),
    invalidatedAt: timestamp('invalidatedAt', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
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
}, (table) => {
    return {
        salesUserIdx: index('sales_surveys_user_idx').on(table.salesUserId),
        createdAtIdx: index('sales_surveys_created_idx').on(table.createdAt),
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
}, (table) => {
    return {
        unqYmFunnel: unique('funnel_baseline_unique').on(table.yearMonth, table.funnelName),
    };
});
