-- 0047: il ruolo nei metadati di Supabase Auth segue sempre public.users (25/10/2026).
--
-- Il CRM legge ruolo, aziende e area da user_metadata, che un utente loggato
-- può riscriversi da solo dal browser (auth.updateUser). Un GDO poteva quindi
-- dichiararsi CONFERME o ADMIN. Da qui in poi la verità è public.users:
-- * ogni aggiornamento di auth.users rimette nei metadati i valori di public.users
--   (se la riga esiste), qualunque cosa arrivi dal browser;
-- * quando cambiano ruolo/aziende/area in public.users, i metadati si allineano.
-- Le funzioni non sollevano mai errori: il login non deve rompersi.

create or replace function public.pin_auth_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    u record;
begin
    begin
        select role, allowed_companies, area, "marketingRole", "companyId"
          into u from public.users where id = new.id::text;
        if found then
            new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb);
            -- il ruolo si allinea sempre
            new.raw_user_meta_data := new.raw_user_meta_data || jsonb_build_object('role', u.role);
            -- gli altri campi solo se presenti nei metadati: chi oggi non li ha
            -- (default nel codice) non cambia comportamento, chi prova ad
            -- aggiungerli dal browser riceve il valore di public.users
            if new.raw_user_meta_data ? 'area' then
                new.raw_user_meta_data := new.raw_user_meta_data || jsonb_build_object('area', u.area);
            end if;
            if new.raw_user_meta_data ? 'companyId' then
                new.raw_user_meta_data := new.raw_user_meta_data || jsonb_build_object('companyId', u."companyId");
            end if;
            if new.raw_user_meta_data ? 'allowedCompanies' then
                new.raw_user_meta_data := new.raw_user_meta_data || jsonb_build_object('allowedCompanies', coalesce(to_jsonb(u.allowed_companies), 'null'::jsonb));
            end if;
            if new.raw_user_meta_data ? 'marketingRole' then
                new.raw_user_meta_data := new.raw_user_meta_data || jsonb_build_object('marketingRole', coalesce(to_jsonb(u."marketingRole"), 'null'::jsonb));
            end if;
        end if;
    exception when others then
        null;
    end;
    return new;
end;
$$;

drop trigger if exists pin_auth_metadata on auth.users;
create trigger pin_auth_metadata
    before update on auth.users
    for each row execute function public.pin_auth_metadata();

create or replace function public.sync_auth_metadata_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    begin
        -- l'update su auth.users fa scattare pin_auth_metadata, che copia i valori
        update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
         where id::text = new.id;
    exception when others then
        null;
    end;
    return new;
end;
$$;

drop trigger if exists sync_auth_metadata_from_users on public.users;
create trigger sync_auth_metadata_from_users
    after update of role, allowed_companies, area, "marketingRole", "companyId" on public.users
    for each row
    when (old.role is distinct from new.role
          or old.allowed_companies is distinct from new.allowed_companies
          or old.area is distinct from new.area
          or old."marketingRole" is distinct from new."marketingRole"
          or old."companyId" is distinct from new."companyId")
    execute function public.sync_auth_metadata_from_users();

revoke execute on function public.pin_auth_metadata() from public, anon, authenticated;
revoke execute on function public.sync_auth_metadata_from_users() from public, anon, authenticated;
