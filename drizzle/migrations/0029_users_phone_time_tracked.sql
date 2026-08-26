-- 0029 — chi ha mansioni che non passano dal centralino.
--
-- Perché serve: la scheda "Tempo al telefono" di /monitor-pause misura il
-- turno di un operatore dai tabulati del centralino, e tutto ciò che non è
-- una telefonata in uscita risulta tempo fermo. Per chi fa SOLO il GDO è una
-- misura corretta. Per chi divide il turno con altre mansioni non lo è: il
-- lavoro sulle Conferme (richiamare gli appuntamenti già fissati, gestire i
-- rifissaggi, i messaggi) non lascia traccia nei tabulati, quindi la persona
-- risulta in pausa, in ritardo o poco produttiva mentre sta lavorando.
--
-- È il caso del GDO 114 (Christel), segnalato dal committente il 2026-08-26:
-- fa anche le Conferme, e i suoi numeri di agosto (secondo posto per tempo
-- fermo) sono per buona parte quel lavoro.
--
-- Perché un campo dedicato e non `statsActive`: statsActive decide chi entra
-- nei divisori delle medie di produzione (appuntamenti, chiamate, KPI del
-- manager), e da lì Christel NON va tolta — gli appuntamenti che fissa sono
-- reali e devono contare. Qui si dichiara una cosa diversa e più stretta: che
-- il suo TEMPO non è misurabile col centralino.
--
-- Default true: per tutti gli altri non cambia niente.
ALTER TABLE users ADD COLUMN IF NOT EXISTS "phoneTimeTracked" boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN users."phoneTimeTracked" IS
    'false = il turno di questa persona non e'' misurabile dai tabulati del centralino, perche'' svolge anche mansioni che non passano dal telefono (es. Conferme). Esclude dalla scheda Tempo al telefono, NON dalle metriche di produzione.';

-- GDO 114 (Christel): fa anche le Conferme.
UPDATE users SET "phoneTimeTracked" = false WHERE name = 'GDO 114';
