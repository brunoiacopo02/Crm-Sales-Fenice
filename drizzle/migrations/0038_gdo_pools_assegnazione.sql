-- Assegnazione dei GDO ai pool (PO 2026-09-15). Va eseguita DOPO il deploy del
-- codice di 0037: finche' `reassign.ts` legge `acAutoIntake`, togliere quel
-- flag a chi lavora i ridati li manderebbe ai GDO sbagliati.
--
--   freschi          -> 106, 112, 119   (tetto 60/giorno a testa)
--   ridati dal bot   -> 114, 118, 110
--   scorta           -> 114             (prende l'eccedenza oltre il tetto)
--
-- Il bot (isBot) resta fuori da entrambi i pool: lo governa la fascia oraria,
-- e le UPDATE lo escludono esplicitamente.

update users set "acAutoIntake" = true,  "dailyFreshCap" = 60
  where "companyId" = 'fenice' and role = 'GDO' and "isBot" = false
    and name in ('GDO 106', 'GDO 112', 'GDO 119');

update users set "acAutoIntake" = false, "dailyFreshCap" = null
  where "companyId" = 'fenice' and role = 'GDO' and "isBot" = false
    and name not in ('GDO 106', 'GDO 112', 'GDO 119');

update users set "botReturnIntake" = true
  where "companyId" = 'fenice' and role = 'GDO' and "isBot" = false
    and name in ('GDO 114', 'GDO 118', 'GDO 110');

update users set "freshOverflowScorta" = true
  where "companyId" = 'fenice' and role = 'GDO' and "isBot" = false
    and name = 'GDO 114';
