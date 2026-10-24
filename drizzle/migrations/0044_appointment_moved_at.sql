-- 0044: quando è stato spostato l'appuntamento (PO 24/10/2026).
--
-- Dal 27/10 le Conferme chiamano il giorno prima solo le call del mattino
-- fissate PRIMA di quel giorno: le altre si chiamano la mattina stessa. Uno
-- spostamento conta come un fissaggio nuovo, ma `appointmentCreatedAt` non va
-- ritimbrato (alimenta "appuntamenti fissati oggi"). Questa colonna lo ricorda;
-- la scrivono tutti i punti che spostano una data già fissata. Null finché
-- l'appuntamento non viene spostato.

alter table public.leads add column if not exists "appointmentMovedAt" timestamptz;
