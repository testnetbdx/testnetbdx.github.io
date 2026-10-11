-- Migration 014: grant execute on admin_delete_user to authenticated users (function itself checks is_admin)
grant execute on function admin_delete_user(uuid) to authenticated;
grant execute on function admin_delete_user(uuid) to service_role;
