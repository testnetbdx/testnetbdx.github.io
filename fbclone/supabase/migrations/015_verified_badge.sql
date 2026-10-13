-- Migration 015: verified badge (admin-only toggle)
alter table profiles add column if not exists verified boolean not null default false;

-- Prevent non-admins from self-verifying
create or replace function prevent_self_verify()
returns trigger language plpgsql as $$
begin
  if new.verified = true and old.verified = false and not is_admin() then
    raise exception 'Only admins can verify users.';
  end if;
  return new;
end $$;

drop trigger if exists trg_prevent_self_verify on profiles;
create trigger trg_prevent_self_verify
  before update of verified on profiles
  for each row execute function prevent_self_verify();
