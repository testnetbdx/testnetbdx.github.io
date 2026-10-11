-- Migration 011: Only @gmail.com addresses can sign up (blocks temp/disposable mail)
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email !~* '@gmail\.com$' then
    raise exception 'Only @gmail.com addresses are allowed to sign up.';
  end if;
  insert into public.profiles (id, name, email)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)),
          new.email);
  return new;
end $$;
