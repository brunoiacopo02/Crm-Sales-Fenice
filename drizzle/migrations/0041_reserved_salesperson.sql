-- 0041: venditore riservato (PO 06/10/2026).
--
-- Lead del lancio che l'admin aveva dato da chiamare a un venditore (002, 004)
-- e che poi passano ai GDO: quando il GDO fissa, le Conferme devono assegnarli
-- a quel venditore. La colonna lo ricorda; il pannello Conferme lo preseleziona.
-- Null sui lead normali.

alter table public.leads add column if not exists "reservedSalespersonId" text
  references public.users(id) on delete set null;
