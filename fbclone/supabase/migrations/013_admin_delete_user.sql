-- Migration 013: proper user delete (content + profile + auth identity), admin-only
create or replace function admin_delete_user(target_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Not authorized.';
  end if;
  delete from public.posts where author_id = target_id;
  delete from public.comments where author_id = target_id;
  delete from public.reactions where user_id = target_id;
  delete from public.comment_reactions where user_id = target_id;
  delete from public.stories where author_id = target_id;
  delete from public.profiles where id = target_id;
  delete from auth.users where id = target_id;
end $$;
