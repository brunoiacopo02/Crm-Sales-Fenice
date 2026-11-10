import { sql, type SQL, type Column } from 'drizzle-orm';
import { BLACK_FRIDAY_FUNNEL } from '@/lib/acIntake/blackFriday';
import { UTM_BROCHURE_PG } from '@/lib/brochure/brochure';

/**
 * Quanti freschi ha avuto OGGI un account bot, ai fini del tetto giornaliero
 * (routing `bot_tetto`, riserva serale compresa).
 *
 * Regola del PO (09/11/2026): i lead Black Friday sono FUORI dal tetto del bot.
 * Vanno sempre al bot, a qualunque ora e senza limite, e quindi non devono
 * nemmeno togliere posti ai lead normali: prima il conteggio li includeva e il
 * 9/11 46 BF su 228 avevano spinto ai GDO altrettanti freschi normali.
 *
 * Si escludono sul funnel del lead, che copre tutti i casi: i BF nati tali
 * (routing `black_friday_bot`) e quelli convertiti dopo (webhook o
 * /api/admin/bf-converti), che hanno il funnel riscritto a 'BLACK FRIDAY'.
 * Il `coalesce` tiene dentro i lead col funnel NULL; `upper(trim(..))` e' lo
 * stesso confronto di `decidiConversioneBf`.
 *
 * Regola del PO (10/11/2026): stessa cosa per i lead della campagna brochure
 * (la scheda del corso in PDF promessa nell'inserzione). Si riconoscono dagli
 * utm della campagna pdf, la stessa regola di `isLeadBrochureAc` e della pagina
 * brochure (`UTM_BROCHURE_PG`), NON dal funnel PROFESSIONI: chi scrive dal link
 * wa.me della landing resta nel conteggio come prima.
 *
 * `userId` e' la colonna dell'utente bot della query esterna (users.id);
 * `todayRome` la data 'YYYY-MM-DD' del giorno italiano.
 */
export function sqlFreschiBotOggiPerTetto(userId: Column | SQL, todayRome: string, companyId: string): SQL {
    return sql`(
        SELECT count(*) FROM leads l
        WHERE l."assignedToId" = ${userId}
          AND l."companyId" = ${companyId}
          AND l."createdAt" >= (${todayRome} || ' 00:00')::timestamp AT TIME ZONE 'Europe/Rome'
          AND upper(trim(coalesce(l."funnel", ''))) <> ${BLACK_FRIDAY_FUNNEL}
          AND concat_ws(' ', l."utmSource", l."utmMedium", l."utmCampaign", l."utmContent", l."utmTerm") !~* ${UTM_BROCHURE_PG}
    )`;
}
