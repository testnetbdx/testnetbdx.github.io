/* ============================================================
   CinePlay — Supabase config
   Project: testnetbdx's Project (shared with FaceClone)
   URL + publishable key from Supabase dashboard → Project
   Settings → API. The publishable key is designed to be public
   in client-side code; RLS policies in supabase/schema.sql
   protect the data.
   NEVER use the secret key or a personal access token here.
   ============================================================ */
const SUPABASE_URL = "https://lbuydigldmjumkbvdmyi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Keq6DFn_yqsTyne3t7XzLA__l2J6ynD";

function supabaseConfigured() {
  return typeof SUPABASE_URL === 'string'
    && SUPABASE_URL.startsWith('https://')
    && typeof SUPABASE_ANON_KEY === 'string'
    && !SUPABASE_ANON_KEY.startsWith('YOUR_');
}
