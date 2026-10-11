/* ============================================================
   FaceClone — Supabase data layer (db.js)
   Requires: config.js (SUPABASE_URL / KEY) + supabase-js UMD.
   All realtime subscriptions go through onTable().
   ============================================================ */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let ME = null; // current user's profiles row

/* ---------------- Auth ---------------- */
async function bootSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) ME = await fetchMyProfile();
  sb.auth.onAuthStateChange(async (_ev, s) => {
    if (s) { ME = await fetchMyProfile(); }
    else ME = null;
  });
  return ME;
}
async function fetchMyProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).single();
  return data || null;
}
async function signUp(name, email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
  if (error) throw error;
  if (!data.session) return { needsVerification: true, email };  // confirm-email ON
  for (let i = 0; i < 10; i++) {           // wait for profile trigger
    await new Promise(r => setTimeout(r, 500));
    ME = await fetchMyProfile();
    if (ME) break;
  }
  if (!ME) throw new Error('Profile not created yet — try logging in.');
  return ME;
}
async function resendVerification(email) {
  const { error } = await sb.auth.resend({ type: 'signup', email });
  if (error) throw error;
}
async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://testnetbdx.github.io/fbclone/',
  });
  if (error) throw error;
}
async function updatePassword(newPass) {
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) throw error;
}
async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  ME = await fetchMyProfile();
  if (ME && ME.banned) { await sb.auth.signOut(); ME = null; throw new Error('This account has been banned.'); }
  return ME;
}
async function signOut() { await sb.auth.signOut(); ME = null; }

/* ---------------- Posts ---------------- */
async function getFeed(limit = 60) {
  const { data: posts, error } = await sb.from('posts').select('*')
    .is('group_id', null)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return hydratePosts(posts || []);
}
async function getFeedChrono(limit = 60) {
  const { data: posts, error } = await sb.from('posts').select('*')
    .is('group_id', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return hydratePosts(posts || []);
}

async function hydratePosts(posts) {
  if (!posts.length) return [];
  const ids = posts.map(p => p.id);
  const authorIds = [...new Set(posts.map(p => p.author_id))];
  const sharedIds = [...new Set(posts.map(p => p.shared_from).filter(Boolean))];
  const [profsR, rxR, commentsR, sharedR, sharesR] = await Promise.all([
    sb.from('profiles').select('id,name,bio,banned,avatar_url').in('id', authorIds),
    sb.from('reactions').select('post_id,user_id,type').in('post_id', ids),
    sb.from('comments').select('id,post_id,text,created_at,author_id,parent_id').in('post_id', ids).order('created_at', { ascending: true }),
    sharedIds.length ? sb.from('posts').select('*').in('id', sharedIds) : Promise.resolve({ data: [] }),
    sb.from('posts').select('shared_from').in('shared_from', ids),
  ]);
  const profs = profsR.data || [], rxns = rxR.data || [],
        comments = commentsR.data || [], shared = sharedR.data || [],
        shareRows = sharesR.data || [];
  let crxns = [];
  const cids = comments.map(c => c.id);
  if (cids.length) {
    const { data: crx } = await sb.from('comment_reactions').select('comment_id,user_id,type').in('comment_id', cids);
    crxns = crx || [];
  }
  const pmap = Object.fromEntries(profs.map(p => [p.id, p]));
  const cAuthorIds = [...new Set(comments.map(c => c.author_id))];
  let cmap = {};
  if (cAuthorIds.length) {
    const { data: cprofs } = await sb.from('profiles').select('id,name,avatar_url').in('id', cAuthorIds);
    cmap = Object.fromEntries((cprofs || []).map(p => [p.id, p]));
  }
  const sharedMap = {};
  for (const s of shared) {
    let sa = pmap[s.author_id];
    if (!sa) {
      const r = await sb.from('profiles').select('id,name,bio,banned,avatar_url').eq('id', s.author_id).single();
      sa = r.data;
    }
    sharedMap[s.id] = { ...s, author: sa || { name: '?', banned: false } };
  }
  return posts.map(p => ({
    ...p,
    author: pmap[p.author_id] || { name: '?', banned: false },
    reactionCounts: (() => { const c = {}; rxns.filter(r => r.post_id === p.id).forEach(r => { c[r.type] = (c[r.type] || 0) + 1; }); return c; })(),
    reactionTotal: rxns.filter(r => r.post_id === p.id).length,
    myReaction: (() => { const r = rxns.find(r => r.post_id === p.id && ME && r.user_id === ME.id); return r ? r.type : null; })(),
    shareCount: shareRows.filter(s => s.shared_from === p.id).length,
    comments: comments.filter(c => c.post_id === p.id)
      .map(c => {
        const rc = {};
        crxns.filter(r => r.comment_id === c.id).forEach(r => { rc[r.type] = (rc[r.type] || 0) + 1; });
        const mine = crxns.find(r => r.comment_id === c.id && ME && r.user_id === ME.id);
        return { ...c, author: cmap[c.author_id] || { name: '?' },
          reactionCounts: rc, reactionTotal: Object.values(rc).reduce((a, b) => a + b, 0),
          myReaction: mine ? mine.type : null };
      }),
    shared: p.shared_from ? (sharedMap[p.shared_from] || null) : null,
  }));
}

async function createPost({ text, image_url, bg, shared_from, feeling, video_url, group_id }) {
  const { data, error } = await sb.from('posts').insert({
    author_id: ME.id, text: text || '', image_url: image_url || null,
    bg: bg || null, shared_from: shared_from || null,
    feeling: feeling || null, video_url: video_url || null,
    group_id: group_id || null,
  }).select().single();
  if (error) throw error;
  return data;
}
async function deletePost(id) {
  const { error } = await sb.from('posts').delete().eq('id', id);
  if (error) throw error;
}
async function setPinned(id, pinned) {
  const { error } = await sb.from('posts').update({ pinned }).eq('id', id);
  if (error) throw error;
}
async function reactToPost(post, type) {
  const isNew = !post.myReaction;
  const { error } = await sb.from('reactions').upsert(
    { post_id: post.id, user_id: ME.id, type },
    { onConflict: 'post_id,user_id' });
  if (error) throw error;
  if (isNew && post.author_id !== ME.id)
    await notify(post.author_id, 'like', post.id, `${ME.name} reacted to your post.`);
}
async function unreactToPost(post) {
  const { error } = await sb.from('reactions').delete().eq('post_id', post.id).eq('user_id', ME.id);
  if (error) throw error;
}
async function addComment(post, text, parentId) {
  const { data, error } = await sb.from('comments')
    .insert({ post_id: post.id, author_id: ME.id, text, parent_id: parentId || null }).select().single();
  if (error) throw error;
  if (post.author_id !== ME.id)
    await notify(post.author_id, 'comment', post.id, `${ME.name} commented: "${text.slice(0, 60)}"`);
  return data;
}
async function reactToComment(comment, type) {
  const isNew = !comment.myReaction;
  const { error } = await sb.from('comment_reactions').upsert(
    { comment_id: comment.id, user_id: ME.id, type },
    { onConflict: 'comment_id,user_id' });
  if (error) throw error;
}
async function unreactToComment(comment) {
  const { error } = await sb.from('comment_reactions').delete().eq('comment_id', comment.id).eq('user_id', ME.id);
  if (error) throw error;
}

/* ---------------- Social ---------------- */
async function toggleFollow(targetId) {
  const { data } = await sb.from('follows')
    .select('*').eq('follower_id', ME.id).eq('following_id', targetId);
  if (data && data.length) {
    await sb.from('follows').delete().eq('follower_id', ME.id).eq('following_id', targetId);
    return false;
  }
  const { error } = await sb.from('follows').insert({ follower_id: ME.id, following_id: targetId });
  if (error) throw error;
  await notify(targetId, 'follow', null, `${ME.name} started following you.`);
  return true;
}
async function followingIds() {
  const { data } = await sb.from('follows').select('following_id').eq('follower_id', ME.id);
  return (data || []).map(f => f.following_id);
}
async function getUsersList(query = '') {
  let q = sb.from('profiles').select('id,name,bio,avatar_url,created_at,banned,is_admin')
    .eq('banned', false).neq('id', ME.id).order('created_at', { ascending: false }).limit(60);
  if (query) q = q.ilike('name', `%${query}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
async function getProfilePage(id) {
  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', id).single();
  if (error) throw error;
  const { data: posts } = await sb.from('posts').select('*').eq('author_id', id)
    .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(40);
  const hydrated = await hydratePosts(posts || []);
  const { count: followers } = await sb.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', id);
  return { profile, posts: hydrated, followers: followers || 0 };
}
async function updateBio(bio) {
  const { error } = await sb.from('profiles').update({ bio }).eq('id', ME.id);
  if (error) throw error;
  ME.bio = bio;
}
async function searchAll(q) {
  const [u, p] = await Promise.all([
    sb.from('profiles').select('id,name,bio,avatar_url').eq('banned', false).ilike('name', `%${q}%`).limit(20),
    sb.from('posts').select('*').ilike('text', `%${q}%`).order('created_at', { ascending: false }).limit(30),
  ]);
  return { users: u.data || [], posts: await hydratePosts(p.data || []) };
}

/* ---------------- Reports / notifications ---------------- */
async function reportPost(post_id, reason) {
  const { error } = await sb.from('reports').insert({ post_id, reporter_id: ME.id, reason });
  if (error) throw error;
}
async function notify(user_id, type, post_id, message) {
  await sb.from('notifications').insert({ user_id, actor_id: ME.id, type, post_id, message });
}
async function getNotifications(limit = 20) {
  const { data, error } = await sb.from('notifications').select('*')
    .eq('user_id', ME.id).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  const actorIds = [...new Set((data || []).map(n => n.actor_id).filter(Boolean))];
  let amap = {};
  if (actorIds.length) {
    const { data: actors } = await sb.from('profiles').select('id,name,avatar_url').in('id', actorIds);
    amap = Object.fromEntries((actors || []).map(a => [a.id, a]));
  }
  return (data || []).map(n => ({ ...n, actor: amap[n.actor_id] || { name: 'Someone' } }));
}
async function unreadNotifCount() {
  const { count } = await sb.from('notifications').select('*', { count: 'exact', head: true })
    .eq('user_id', ME.id).eq('read', false);
  return count || 0;
}
async function markNotifsRead() {
  await sb.from('notifications').update({ read: true }).eq('user_id', ME.id).eq('read', false);
}

/* ---------------- Storage ---------------- */
async function uploadImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').slice(0, 5);
  const path = `${ME.id}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('media').upload(path, file, { upsert: false });
  if (error) throw error;
  return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
}

/* ---------------- Settings ---------------- */
async function getSettings() {
  const { data } = await sb.from('settings').select('*').eq('id', 1).single();
  return data || { site_name: 'FaceClone' };
}
async function saveSettings(patch) {
  const { error } = await sb.from('settings').update(patch).eq('id', 1);
  if (error) throw error;
}

/* ---------------- Admin ---------------- */
async function adminWipeUser(uid) {
  // Proper delete: content + profile + auth identity, via secure server function.
  const { error } = await sb.rpc('admin_delete_user', { target_id: uid });
  if (error) throw error;
}
async function adminGetUsers() {
  const { data: users, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  const { data: posts } = await sb.from('posts').select('author_id');
  const counts = {};
  (posts || []).forEach(p => { counts[p.author_id] = (counts[p.author_id] || 0) + 1; });
  return (users || []).map(u => ({ ...u, postCount: counts[u.id] || 0 }));
}
async function adminSetUser(id, patch) {
  const { error } = await sb.from('profiles').update(patch).eq('id', id);
  if (error) throw error;
}
async function adminWipeUser(id) {
  // delete all posts (cascades comments/likes), then ban the profile
  const { error: e1 } = await sb.from('posts').delete().eq('author_id', id);
  if (e1) throw e1;
  const { error: e2 } = await sb.from('profiles').update({ banned: true, is_admin: false }).eq('id', id);
  if (e2) throw e2;
}
async function adminGetPosts() {
  const { data: posts, error } = await sb.from('posts').select('*')
    .order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  const hydrated = await hydratePosts(posts || []);
  return hydrated;
}
async function adminGetReports() {
  const { data: reps, error } = await sb.from('reports').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  const ids = [...new Set([
    ...(reps || []).map(r => r.reporter_id).filter(Boolean),
  ])];
  const postIds = [...new Set((reps || []).map(r => r.post_id).filter(Boolean))];
  const [usersR, postsR] = await Promise.all([
    ids.length ? sb.from('profiles').select('id,name').in('id', ids) : Promise.resolve({ data: [] }),
    postIds.length ? sb.from('posts').select('id,text,author_id').in('id', postIds) : Promise.resolve({ data: [] }),
  ]);
  const umap = Object.fromEntries((usersR.data || []).map(u => [u.id, u]));
  const auIds = [...new Set((postsR.data || []).map(p => p.author_id))];
  let aumap = {};
  if (auIds.length) {
    const { data: aus } = await sb.from('profiles').select('id,name').in('id', auIds);
    aumap = Object.fromEntries((aus || []).map(u => [u.id, u]));
  }
  const pmap = Object.fromEntries((postsR.data || []).map(p => [p.id, { ...p, author: aumap[p.author_id] || { name: '?' } }]));
  return (reps || []).map(r => ({
    ...r,
    reporter: umap[r.reporter_id] || { name: '?' },
    post: r.post_id ? (pmap[r.post_id] || null) : null,
  }));
}
async function adminResolveReport(id, status) {
  const { error } = await sb.from('reports').update({ status }).eq('id', id);
  if (error) throw error;
}
async function adminStats() {
  const [u, p, c, l, r] = await Promise.all([
    sb.from('profiles').select('*', { count: 'exact', head: true }),
    sb.from('posts').select('*', { count: 'exact', head: true }),
    sb.from('comments').select('*', { count: 'exact', head: true }),
    sb.from('reactions').select('*', { count: 'exact', head: true }),
    sb.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
  ]);
  return { users: u.count || 0, posts: p.count || 0, comments: c.count || 0, likes: l.count || 0, openReports: r.count || 0 };
}
async function adminPostsPerDay() {
  const since = new Date(); since.setDate(since.getDate() - 6); since.setHours(0, 0, 0, 0);
  const { data } = await sb.from('posts').select('created_at').gte('created_at', since.toISOString());
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    days.push({ label: d.toLocaleDateString(undefined, { weekday: 'short' }), count: 0, key: d.toDateString() });
  }
  (data || []).forEach(p => {
    const k = new Date(p.created_at).toDateString();
    const d = days.find(x => x.key === k);
    if (d) d.count++;
  });
  return days;
}
async function seedDemoPosts() {
  const pic = (s, w, h) => `https://picsum.photos/seed/${s}/${w || 640}/${h || 360}`;
  const demo = [
    { text: "Sunset at Cox's Bazar never disappoints 🌅", image_url: pic('fc-cox'), bg: null },
    { text: 'Shipped my first open-source project today. 200 stars overnight! 🚀', image_url: null, bg: 'bg-blue' },
    { text: 'Homemade biryani night 🍚 Recipe in comments 👇', image_url: pic('fc-biryani'), bg: null },
    { text: 'Bangladesh wins by 6 wickets! What a chase!! 🏏🔥', image_url: null, bg: 'bg-green' },
    { text: 'Golden hour hits different in the village 🌾', image_url: pic('fc-village'), bg: null },
    { text: 'Monday motivation: small steps every day 💪', image_url: null, bg: 'bg-orange' },
    { text: 'TIL: honey never spoils. 3000-year-old honey found in Egyptian tombs — still edible 🍯', image_url: null, bg: 'bg-teal' },
    { text: 'Morning mist over the tea gardens 🍃', image_url: pic('fc-tea'), bg: null },
  ];
  for (const d of demo) {
    // eslint-disable-next-line no-await-in-loop
    await sb.from('posts').insert({ author_id: ME.id, ...d });
  }
}

/* ---------------- Profile extras ---------------- */
async function uploadToMedia(file, folder) {
  const ext = (file.name.split('.').pop() || 'jpg').slice(0, 5);
  const path = `${ME.id}/${folder}_${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('media').upload(path, file, { upsert: false });
  if (error) throw error;
  return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
}
async function updateProfile(patch) {
  const { error } = await sb.from('profiles').update(patch).eq('id', ME.id);
  if (error) throw error;
  Object.assign(ME, patch);
}
async function getUserPhotos(uid) {
  const { data, error } = await sb.from('posts').select('id,image_url,created_at')
    .eq('author_id', uid).not('image_url', 'is', null)
    .order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  return data || [];
}
async function getFollowers(uid) {
  const { data } = await sb.from('follows').select('follower_id').eq('following_id', uid);
  const ids = (data || []).map(f => f.follower_id);
  if (!ids.length) return [];
  const { data: profs } = await sb.from('profiles').select('id,name,bio,avatar_url').in('id', ids);
  return profs || [];
}
async function getFollowing(uid) {
  const { data } = await sb.from('follows').select('following_id').eq('follower_id', uid);
  const ids = (data || []).map(f => f.following_id);
  if (!ids.length) return [];
  const { data: profs } = await sb.from('profiles').select('id,name,bio,avatar_url').in('id', ids);
  return profs || [];
}

/* ---------------- Stories ---------------- */
async function getStories() {
  const { data, error } = await sb.from('stories').select('*')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  const authorIds = [...new Set((data || []).map(s => s.author_id))];
  let amap = {};
  if (authorIds.length) {
    const { data: profs } = await sb.from('profiles').select('id,name,avatar_url').in('id', authorIds);
    amap = Object.fromEntries((profs || []).map(p => [p.id, p]));
  }
  return (data || []).map(s => ({ ...s, author: amap[s.author_id] || { name: '?' } }));
}
async function createStory({ image_url, text, bg }) {
  const { data, error } = await sb.from('stories').insert({
    author_id: ME.id, image_url: image_url || null, text: text || '', bg: bg || null,
  }).select().single();
  if (error) throw error;
  return data;
}
async function deleteStory(id) {
  const { error } = await sb.from('stories').delete().eq('id', id);
  if (error) throw error;
}
async function cleanupMyStories() {
  try {
    await sb.from('stories').delete()
      .lt('expires_at', new Date().toISOString()).eq('author_id', ME.id);
  } catch (e) { /* ignore */ }
}

/* ---------------- Saved posts ---------------- */
async function isPostSaved(postId) {
  const { data } = await sb.from('saved_posts').select('post_id')
    .eq('user_id', ME.id).eq('post_id', postId).limit(1);
  return !!(data && data.length);
}
async function toggleSave(postId) {
  if (await isPostSaved(postId)) {
    const { error } = await sb.from('saved_posts').delete().eq('user_id', ME.id).eq('post_id', postId);
    if (error) throw error;
    return false;
  }
  const { error } = await sb.from('saved_posts').insert({ user_id: ME.id, post_id: postId });
  if (error) throw error;
  return true;
}
async function getSavedPosts() {
  const { data } = await sb.from('saved_posts').select('post_id')
    .eq('user_id', ME.id).order('created_at', { ascending: false });
  const ids = (data || []).map(r => r.post_id);
  if (!ids.length) return [];
  const { data: posts } = await sb.from('posts').select('*').in('id', ids);
  const pmap = Object.fromEntries((posts || []).map(p => [p.id, p]));
  return hydratePosts(ids.map(id => pmap[id]).filter(Boolean));
}

/* ---------------- Messenger ---------------- */
async function getOrCreateConversation(otherId) {
  const { data: mine } = await sb.from('conversation_participants')
    .select('conversation_id').eq('user_id', ME.id);
  const ids = (mine || []).map(r => r.conversation_id);
  if (ids.length) {
    const { data: theirs } = await sb.from('conversation_participants')
      .select('conversation_id').eq('user_id', otherId).in('conversation_id', ids);
    for (const t of (theirs || [])) {
      const { count } = await sb.from('conversation_participants')
        .select('*', { count: 'exact', head: true }).eq('conversation_id', t.conversation_id);
      if (count === 2) return t.conversation_id;
    }
  }
  const { data: conv, error } = await sb.from('conversations').insert({}).select().single();
  if (error) throw error;
  const { error: e2 } = await sb.from('conversation_participants')
    .insert({ conversation_id: conv.id, user_id: ME.id });
  if (e2) throw e2;
  const { error: e3 } = await sb.from('conversation_participants')
    .insert({ conversation_id: conv.id, user_id: otherId });
  if (e3) throw e3;
  return conv.id;
}
async function getConversations() {
  const { data: parts } = await sb.from('conversation_participants')
    .select('conversation_id,last_read_at').eq('user_id', ME.id);
  if (!parts || !parts.length) return [];
  const cids = parts.map(p => p.conversation_id);
  const readMap = Object.fromEntries(parts.map(p => [p.conversation_id, p.last_read_at]));
  const { data: others } = await sb.from('conversation_participants')
    .select('conversation_id,user_id').in('conversation_id', cids).neq('user_id', ME.id);
  const otherByConv = {};
  (others || []).forEach(o => { otherByConv[o.conversation_id] = o.user_id; });
  const otherIds = [...new Set(Object.values(otherByConv))];
  let umap = {};
  if (otherIds.length) {
    const { data: us } = await sb.from('profiles').select('id,name,avatar_url').in('id', otherIds);
    umap = Object.fromEntries((us || []).map(u => [u.id, u]));
  }
  const { data: msgs } = await sb.from('messages')
    .select('conversation_id,sender_id,text,created_at').in('conversation_id', cids)
    .order('created_at', { ascending: false }).limit(400);
  return cids.map(cid => {
    const cms = (msgs || []).filter(m => m.conversation_id === cid);
    const last = cms[0] || null;
    const unread = cms.filter(m => m.sender_id !== ME.id && new Date(m.created_at) > new Date(readMap[cid] || 0)).length;
    return {
      id: cid, other: umap[otherByConv[cid]] || { name: '?' },
      otherId: otherByConv[cid], last, unread,
      updatedAt: last ? last.created_at : null,
    };
  }).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}
async function getMessages(cid, limit = 60) {
  const { data } = await sb.from('messages').select('*').eq('conversation_id', cid)
    .order('created_at', { ascending: true });
  return (data || []).slice(-limit);
}
async function sendMessage(cid, text) {
  const { data, error } = await sb.from('messages')
    .insert({ conversation_id: cid, sender_id: ME.id, text }).select().single();
  if (error) throw error;
  await sb.from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', cid).eq('user_id', ME.id);
  return data;
}
async function markConvRead(cid) {
  await sb.from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', cid).eq('user_id', ME.id);
}

/* ---------------- Marketplace ---------------- */
async function getListings() {
  const { data, error } = await sb.from('listings').select('*')
    .eq('sold', false).order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  const ids = [...new Set((data || []).map(l => l.seller_id))];
  let umap = {};
  if (ids.length) {
    const { data: us } = await sb.from('profiles').select('id,name,avatar_url').in('id', ids);
    umap = Object.fromEntries((us || []).map(u => [u.id, u]));
  }
  return (data || []).map(l => ({ ...l, seller: umap[l.seller_id] || { name: '?' } }));
}
async function createListing({ title, price, description, image_url }) {
  const { data, error } = await sb.from('listings')
    .insert({ seller_id: ME.id, title, price: Number(price) || 0, description: description || '', image_url: image_url || null })
    .select().single();
  if (error) throw error;
  return data;
}
async function deleteListing(id) {
  const { error } = await sb.from('listings').delete().eq('id', id);
  if (error) throw error;
}
async function toggleSold(id, sold) {
  const { error } = await sb.from('listings').update({ sold: !sold }).eq('id', id);
  if (error) throw error;
}

/* ---------------- Events ---------------- */
async function getEvents() {
  const { data, error } = await sb.from('events').select('*')
    .gte('starts_at', new Date().toISOString()).order('starts_at', { ascending: true }).limit(60);
  if (error) throw error;
  const ids = (data || []).map(e => e.id);
  const counts = {}, mine = {};
  if (ids.length) {
    const { data: rsvps } = await sb.from('event_rsvps').select('event_id,status,user_id').in('event_id', ids);
    (rsvps || []).forEach(r => {
      counts[r.event_id] = counts[r.event_id] || { interested: 0, going: 0 };
      counts[r.event_id][r.status]++;
      if (r.user_id === ME.id) mine[r.event_id] = r.status;
    });
  }
  return (data || []).map(e => ({ ...e, counts: counts[e.id] || { interested: 0, going: 0 }, myRsvp: mine[e.id] || null }));
}
async function createEvent({ title, description, location, starts_at, image_url }) {
  const { data, error } = await sb.from('events')
    .insert({ creator_id: ME.id, title, description: description || '', location: location || '', starts_at, image_url: image_url || null })
    .select().single();
  if (error) throw error;
  return data;
}
async function setRsvp(eventId, status) {
  const { error } = await sb.from('event_rsvps')
    .upsert({ event_id: eventId, user_id: ME.id, status }, { onConflict: 'event_id,user_id' });
  if (error) throw error;
}
async function deleteEvent(id) {
  const { error } = await sb.from('events').delete().eq('id', id);
  if (error) throw error;
}

/* ---------------- Groups ---------------- */
async function getGroups() {
  const { data: mine } = await sb.from('group_members').select('group_id').eq('user_id', ME.id);
  const myIds = new Set((mine || []).map(m => m.group_id));
  const { data: groups, error } = await sb.from('groups').select('*')
    .order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  const ids = (groups || []).map(g => g.id);
  const counts = {};
  if (ids.length) {
    const { data: ms } = await sb.from('group_members').select('group_id').in('group_id', ids);
    (ms || []).forEach(m => { counts[m.group_id] = (counts[m.group_id] || 0) + 1; });
  }
  return (groups || []).map(g => ({ ...g, memberCount: counts[g.id] || 0, joined: myIds.has(g.id) }));
}
async function createGroup({ name, description, cover_url }) {
  const { data, error } = await sb.from('groups')
    .insert({ creator_id: ME.id, name, description: description || '', cover_url: cover_url || null })
    .select().single();
  if (error) throw error;
  await sb.from('group_members').insert({ group_id: data.id, user_id: ME.id });
  return data;
}
async function toggleGroupJoin(groupId, joined) {
  if (joined) {
    const { error } = await sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', ME.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from('group_members').insert({ group_id: groupId, user_id: ME.id });
    if (error) throw error;
  }
}
async function deleteGroup(id) {
  const { error } = await sb.from('groups').delete().eq('id', id);
  if (error) throw error;
}
async function getGroupPage(id) {
  const { data: group, error } = await sb.from('groups').select('*').eq('id', id).single();
  if (error) throw error;
  const { data: members } = await sb.from('group_members').select('user_id').eq('group_id', id);
  const mids = (members || []).map(m => m.user_id);
  let mprofs = [];
  if (mids.length) {
    const { data } = await sb.from('profiles').select('id,name,bio,avatar_url').in('id', mids);
    mprofs = data || [];
  }
  const { data: posts } = await sb.from('posts').select('*').eq('group_id', id)
    .order('created_at', { ascending: false }).limit(40);
  return { group, members: mprofs, posts: await hydratePosts(posts || []), joined: mids.includes(ME.id) };
}

/* ---------------- Memories ---------------- */
async function getMemories() {
  const { data: posts } = await sb.from('posts').select('*').eq('author_id', ME.id)
    .order('created_at', { ascending: false }).limit(300);
  const now = new Date();
  const mems = (posts || []).filter(p => {
    const d = new Date(p.created_at);
    return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear();
  });
  return hydratePosts(mems);
}

/* ---------------- Video posts ---------------- */
async function getVideoPosts(limit = 40) {
  const { data, error } = await sb.from('posts').select('*')
    .not('video_url', 'is', null).is('group_id', null)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return hydratePosts(data || []);
}

/* ---------------- Realtime ---------------- */
function onTable(table, cb, filter) {
  const ch = sb.channel('rt-' + table + '-' + Math.random().toString(36).slice(2, 8));
  const cfg = { event: '*', schema: 'public', table };
  if (filter) cfg.filter = filter;
  ch.on('postgres_changes', cfg, cb).subscribe();
  return ch;
}
function debounce(fn, ms) {
  let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
}
