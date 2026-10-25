-- 0053: email e password di accesso cambiate dal CRM (PO 25/10/2026).
--
-- Il GDO sceglie da solo email e password dal profilo, senza mail di conferma;
-- l'admin vede sempre l'email di accesso di tutti e può reimpostare la
-- password di chiunque (gli account sono strumenti aziendali). La password non
-- si salva mai leggibile: solo l'hash bcrypt di Supabase Auth.
--
-- La funzione la chiama solo il server (ruolo postgres, connessione Drizzle):
-- execute tolto a public, anon e authenticated, così la chiave anon non può
-- usarla via RPC. I permessi (chi può cambiare cosa) li controlla la server
-- action, che legge il ruolo dalla tabella users.

create or replace function public.cambia_credenziali(p_user text, p_email text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
    v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
    if not exists (select 1 from auth.users where id = p_user::uuid) then
        return 'utente';
    end if;
    if v_email is not null then
        if exists (select 1 from auth.users where lower(email) = v_email and id <> p_user::uuid)
            or exists (select 1 from public.users where lower(email) = v_email and id <> p_user) then
            return 'email_usata';
        end if;
        update auth.users
            set email = v_email, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
            where id = p_user::uuid;
        update auth.identities
            set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(v_email)), updated_at = now()
            where user_id = p_user::uuid and provider = 'email';
        update public.users set email = v_email where id = p_user;
    end if;
    if p_password is not null and length(p_password) > 0 then
        update auth.users
            set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
            where id = p_user::uuid;
    end if;
    return 'ok';
end;
$$;

revoke all on function public.cambia_credenziali(text, text, text) from public, anon, authenticated;
