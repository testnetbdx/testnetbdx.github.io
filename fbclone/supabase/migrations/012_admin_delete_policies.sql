-- Migration 012: allow admins to delete reactions / comment_reactions / stories (for user wipe)
drop policy if exists "rx: owner or admin delete" on reactions;
create policy "rx: owner or admin delete" on reactions for delete
  using (user_id = auth.uid() or is_admin());

drop policy if exists "crx: owner or admin delete" on comment_reactions;
create policy "crx: owner or admin delete" on comment_reactions for delete
  using (user_id = auth.uid() or is_admin());

drop policy if exists "stories: owner or admin delete" on stories;
create policy "stories: owner or admin delete" on stories for delete
  using (author_id = auth.uid() or is_admin());
