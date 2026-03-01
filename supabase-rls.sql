-- Enable Realtime
-- Si applica alle tabelle vitali per la collaborazione UI
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
ALTER PUBLICATION supabase_realtime ADD TABLE "breakSessions";
ALTER PUBLICATION supabase_realtime ADD TABLE "teamGoals";
ALTER PUBLICATION supabase_realtime ADD TABLE "appointmentPresence";

-- RLS: Ruoli e Policies base (Assumendo l'uso temporaneo di un Service Role o Custom JWT per `auth.uid()`)
-- NB: In Drizzle, le tabelle create hanno nomi lowerCamelCase passati come stringhe, e Drizzle per PG tipicamente preserva la stringa o crea lower_case se non quotato. Drizzle usa il nome esatto passato in table(): es. 'breakSessions'

-- Abilitazione RLS
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leadEvents" ENABLE ROW LEVEL SECURITY;

-- 1. UTENTI
-- I manager vedono tutti.
-- Gli altri vedono se stessi. (Esempio semplificato, in un CRM spesso info base come "nome" collega sono visibili)
CREATE POLICY "Users can view themselves" ON "users"
  FOR SELECT USING (auth.uid()::text = id);
  
-- 2. LEADS
-- Manager bypass (vede tutto).
-- GDO: Vede i suoi e i NEW se ha permesso
CREATE POLICY "GDO can view assigned leads" ON "leads"
  FOR SELECT USING (
    (auth.uid()::text = "assignedToId") OR 
    ("status" = 'NEW' AND "assignedToId" IS NULL)
  );

-- Sales: Vede i lead venditore
CREATE POLICY "Sales can view assigned leads" ON "leads"
  FOR SELECT USING (auth.uid()::text = "salespersonUserId");

-- Conferme: Vede i lead da confermare (es. stato PRE_CONFERMA o appuntamenti recenti)
-- Da raffinare in base al campo esatto 'funnel' o 'status' usato per Conferme.

-- 3. NOTIFICHE (Realtime sicure)
CREATE POLICY "Users can see own notifications" ON "notifications"
  FOR SELECT USING (auth.uid()::text = "recipientUserId");

CREATE POLICY "Users can update own notifications" ON "notifications"
  FOR UPDATE USING (auth.uid()::text = "recipientUserId");

-- 4. SERVICE ROLE BYPASS
-- Lato server (Next.js server actions, API routes), l'utilizzo del SUPABASE_SERVICE_ROLE_KEY o `postgres` role
-- bypasserà queste policy per farti continuare a usare il CRM senza downtime, mentre prepariamo Supabase Auth.
