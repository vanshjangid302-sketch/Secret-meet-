/* Secret Meet frontend — plain JavaScript, no build step.
 * Loaded after config.js (Supabase settings) and the Supabase JS library.
 * Table and column names are listed in TABLES below; adjust them if your
 * Supabase schema differs (see supabase/schema.sql for the expected layout).
 */
(() => {
  'use strict';

  const TABLES = {
    profiles: 'profiles', // id (= auth user id), display_name, age, city, bio, photo_url
    likes: 'likes',       // liker_id, liked_id
    messages: 'messages', // id, sender_id, receiver_id, body, created_at
    blocks: 'blocks',     // blocker_id, blocked_id
    reports: 'reports'    // reporter_id, reported_id, reason
  };
  const POLL_MS = 4000;

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const config = window.SECRET_MEET_CONFIG || {};
  const isPlaceholder = (v) => typeof v !== 'string' || !v.trim() || /^PASTE_/i.test(v.trim());
  const SUPABASE_URL = isPlaceholder(config.SUPABASE_URL) ? '' : config.SUPABASE_URL.trim().replace(/\/+$/, '');
  const SUPABASE_KEY = isPlaceholder(config.SUPABASE_ANON_KEY) ? '' : config.SUPABASE_ANON_KEY.trim();
  const configured = SUPABASE_URL.startsWith('https://') && Boolean(SUPABASE_KEY);

  function setStatus(el, message, kind) {
    el.textContent = message || '';
    el.classList.toggle('error', kind === 'error');
    el.classList.toggle('ok', kind === 'ok');
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3800);
  }

  function safePhoto(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      const u = new URL(url.trim());
      return u.protocol === 'https:' ? u.href : '';
    } catch {
      return '';
    }
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
  }

  function paintAvatar(el, p) {
    const photo = safePhoto(p?.photo_url);
    el.textContent = photo ? '' : initials(p?.display_name);
    el.style.backgroundImage = photo ? `url("${photo.replace(/"/g, '%22')}")` : '';
  }

  function nameAge(p) {
    const name = p?.display_name || 'Member';
    return p?.age ? `${name}, ${p.age}` : name;
  }

  function friendlyError(error) {
    if (!error) return 'Something went wrong.';
    const msg = error.message || String(error);
    if (error.code === '42P01' || /relation .* does not exist|Could not find the table/i.test(msg)) {
      return `${msg} — create the table in Supabase (see supabase/schema.sql).`;
    }
    if (error.code === '42501' || /row-level security/i.test(msg)) {
      return `${msg} — check the table's RLS policies.`;
    }
    return msg;
  }

  const isMissingColumn = (error) =>
    Boolean(error) && (error.code === 'PGRST204' || error.code === '42703' || /column/i.test(error.message || ''));

  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyText || 'Please wait…';
      button.disabled = true;
    } else {
      if (button.dataset.label) button.textContent = button.dataset.label;
      button.disabled = false;
    }
  }

  // ---------- Supabase client ----------
  let client = null;
  const setupNotice = $('setupNotice');
  if (!configured) {
    setupNotice.innerHTML =
      '<strong>Setup pending:</strong> add your Supabase Project URL and public <code>anon</code> key in <code>config.js</code>. Never use a service-role key.';
    setupNotice.classList.remove('hidden');
  } else if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    setupNotice.textContent = 'The Supabase library could not be loaded. Check your internet connection or content blockers, then reload.';
    setupNotice.classList.remove('hidden');
  } else {
    try {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    } catch (e) {
      setupNotice.textContent = `Supabase could not start: ${e.message}. Check the values in config.js.`;
      setupNotice.classList.remove('hidden');
    }
  }

  // ---------- state ----------
  const state = {
    mode: 'login',
    user: null,
    profile: null,
    view: null,
    queue: [],
    liked: new Set(),
    likedMe: new Set(),
    hidden: new Set(),
    passed: new Set(),
    chatWith: null,
    pollTimer: null,
    messageSignature: '',
    acting: false
  };

  const views = { discover: $('discover'), matches: $('matches'), chat: $('chat'), profile: $('profile') };

  // ---------- auth UI ----------
  const status = $('status');

  function setMode(mode) {
    state.mode = mode;
    const signup = mode === 'signup';
    $('loginTab').classList.toggle('active', !signup);
    $('signupTab').classList.toggle('active', signup);
    $('loginTab').setAttribute('aria-selected', String(!signup));
    $('signupTab').setAttribute('aria-selected', String(signup));
    $('submitAuth').textContent = signup ? 'Create account' : 'Login';
    $('ageConfirmRow').classList.toggle('hidden', !signup);
    $('password').autocomplete = signup ? 'new-password' : 'current-password';
    setStatus(status, '');
  }
  $('loginTab').addEventListener('click', () => setMode('login'));
  $('signupTab').addEventListener('click', () => setMode('signup'));

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!client) {
      setStatus(status, 'Supabase is not configured yet. Add your project URL and anon key in config.js.', 'error');
      return;
    }
    const email = $('email').value.trim();
    const password = $('password').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return setStatus(status, 'Enter a valid email address.', 'error');
    if (password.length < 6) return setStatus(status, 'Password must be at least 6 characters.', 'error');
    if (state.mode === 'signup' && !$('ageConfirm').checked) {
      return setStatus(status, 'Please confirm you are 18 or older.', 'error');
    }

    const btn = $('submitAuth');
    setBusy(btn, true, 'Working…');
    setStatus(status, '');
    try {
      if (state.mode === 'signup') {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + window.location.pathname }
        });
        if (error) throw error;
        if (!data.session) {
          setMode('login');
          setStatus(status, 'Account created. Check your inbox to confirm your email, then log in.', 'ok');
        } else {
          setStatus(status, 'Account created. Welcome!', 'ok');
        }
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setStatus(status, 'Logged in.', 'ok');
      }
      $('password').value = '';
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  $('logout').addEventListener('click', async () => {
    stopPolling();
    if (client) await client.auth.signOut().catch(() => {});
    applySession(null);
    toast('Logged out.');
  });

  // ---------- session handling ----------
  async function applySession(session) {
    const user = session?.user || null;
    if (user && state.user && user.id === state.user.id) {
      state.user = user; // token refresh — nothing else to do
      return;
    }
    if (!user) {
      stopPolling();
      Object.assign(state, { user: null, profile: null, view: null, queue: [], chatWith: null, messageSignature: '' });
      state.liked.clear(); state.likedMe.clear(); state.hidden.clear(); state.passed.clear();
      $('profileForm').reset();
      Object.values(views).forEach((v) => v.classList.add('hidden'));
      $('mainNav').classList.add('hidden');
      $('hero').classList.remove('hidden');
      $('auth').classList.remove('hidden');
      return;
    }

    state.user = user;
    state.passed = loadPassed();
    $('auth').classList.add('hidden');
    $('hero').classList.add('hidden');
    $('mainNav').classList.remove('hidden');

    await loadMyProfile();
    const complete = state.profile && state.profile.display_name && state.profile.age;
    const fromHash = (window.location.hash || '').slice(1);
    if (!complete) {
      $('profileHint').textContent = 'Finish your profile so others can discover you.';
      go('profile');
    } else {
      go(fromHash === 'matches' || fromHash === 'profile' ? fromHash : 'discover');
    }
  }

  // ---------- navigation ----------
  function go(view) {
    if (!state.user || !views[view]) return;
    if (view !== 'chat') stopPolling();
    state.view = view;
    Object.entries(views).forEach(([name, el]) => el.classList.toggle('hidden', name !== view));
    document.querySelectorAll('#mainNav a[data-view]').forEach((a) => {
      const active = a.dataset.view === view || (view === 'chat' && a.dataset.view === 'matches');
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (view !== 'chat' && window.location.hash !== `#${view}`) {
      history.replaceState(null, '', `#${view}`);
    }
    if (view === 'discover') loadDiscover();
    if (view === 'matches') loadMatches();
    if (view === 'profile') fillProfileForm(state.profile);
  }

  document.querySelectorAll('[data-view]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.user) go(link.dataset.view);
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // ---------- profile ----------
  const profileStatus = $('profileStatus');

  async function loadMyProfile() {
    if (!client || !state.user) return;
    const { data, error } = await client.from(TABLES.profiles).select('*').eq('id', state.user.id).maybeSingle();
    if (error) {
      setStatus(profileStatus, `Could not load your profile: ${friendlyError(error)}`, 'error');
      state.profile = null;
      return;
    }
    state.profile = data;
    fillProfileForm(data);
  }

  function fillProfileForm(p) {
    $('displayName').value = p?.display_name || '';
    $('age').value = p?.age || '';
    $('city').value = p?.city || '';
    $('photoUrl').value = p?.photo_url || '';
    $('bio').value = p?.bio || '';
    paintAvatar($('profileAvatar'), p || { display_name: state.user?.email });
  }

  $('photoUrl').addEventListener('input', () => {
    paintAvatar($('profileAvatar'), { display_name: $('displayName').value || state.user?.email, photo_url: $('photoUrl').value });
  });

  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!client || !state.user) return setStatus(profileStatus, 'Please log in first.', 'error');

    const displayName = $('displayName').value.trim();
    const age = Number($('age').value);
    const photoRaw = $('photoUrl').value.trim();
    const photo = safePhoto(photoRaw);
    if (!displayName) return setStatus(profileStatus, 'Please add a display name.', 'error');
    if (!Number.isInteger(age) || age < 18 || age > 99) return setStatus(profileStatus, 'Age must be a whole number between 18 and 99.', 'error');
    if (photoRaw && !photo) return setStatus(profileStatus, 'Photo URL must be a valid https:// link.', 'error');

    const core = { id: state.user.id, display_name: displayName, age, bio: $('bio').value.trim() };
    const full = { ...core, city: $('city').value.trim() || null, photo_url: photo || null };

    const btn = $('saveProfile');
    setBusy(btn, true, 'Saving…');
    setStatus(profileStatus, '');
    try {
      let saved = full;
      let { error } = await client.from(TABLES.profiles).upsert(full);
      if (error && isMissingColumn(error)) {
        // Older schema without city / photo_url — save the core fields only.
        ({ error } = await client.from(TABLES.profiles).upsert(core));
        saved = core;
        if (!error) {
          setStatus(profileStatus, 'Profile saved. City and photo were skipped because those columns are missing from the profiles table.', 'ok');
        }
      }
      if (error) throw error;
      const wasIncomplete = !(state.profile && state.profile.display_name && state.profile.age);
      state.profile = { ...(state.profile || {}), ...saved };
      paintAvatar($('profileAvatar'), state.profile);
      if (saved === full) setStatus(profileStatus, 'Profile saved.', 'ok');
      $('profileHint').textContent = 'A complete profile helps people connect.';
      if (wasIncomplete) {
        toast('Profile saved — start discovering!');
        go('discover');
      }
    } catch (err) {
      setStatus(profileStatus, friendlyError(err), 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  // ---------- relations (likes / blocks) ----------
  const passedKey = () => `secretmeet:passed:${state.user?.id}`;
  function loadPassed() {
    try { return new Set(JSON.parse(localStorage.getItem(passedKey()) || '[]')); } catch { return new Set(); }
  }
  function savePassed() {
    try { localStorage.setItem(passedKey(), JSON.stringify([...state.passed].slice(-500))); } catch { /* storage full or disabled */ }
  }

  async function loadRelations() {
    const me = state.user.id;
    const [likesRes, blocksRes] = await Promise.all([
      client.from(TABLES.likes).select('liker_id, liked_id').or(`liker_id.eq.${me},liked_id.eq.${me}`),
      client.from(TABLES.blocks).select('blocker_id, blocked_id').or(`blocker_id.eq.${me},blocked_id.eq.${me}`)
    ]);
    state.liked.clear();
    state.likedMe.clear();
    if (likesRes.error) {
      console.warn('Secret Meet: likes not available —', likesRes.error.message);
    } else {
      for (const row of likesRes.data || []) {
        if (row.liker_id === me) state.liked.add(row.liked_id);
        if (row.liked_id === me) state.likedMe.add(row.liker_id);
      }
    }
    // Blocks are optional: if the table is missing, nothing is hidden.
    state.hidden.clear();
    if (!blocksRes.error) {
      for (const row of blocksRes.data || []) {
        state.hidden.add(row.blocker_id === me ? row.blocked_id : row.blocker_id);
      }
    }
    return likesRes.error;
  }

  // ---------- discover ----------
  const discoverMsg = $('profilesList');

  async function loadDiscover() {
    if (!client || !state.user) return;
    const btn = $('refresh');
    setBusy(btn, true, 'Loading…');
    setStatus(discoverMsg, '');
    $('discoverCount').textContent = 'Finding people for you…';
    try {
      const likesError = await loadRelations();
      if (likesError) setStatus(discoverMsg, `Likes are unavailable: ${friendlyError(likesError)}`, 'error');
      const { data, error } = await client.from(TABLES.profiles).select('*').neq('id', state.user.id).limit(200);
      if (error) throw error;
      state.queue = (data || []).filter((p) =>
        p && p.id && p.display_name &&
        !(p.age && Number(p.age) < 18) &&
        !state.liked.has(p.id) && !state.passed.has(p.id) && !state.hidden.has(p.id)
      );
    } catch (err) {
      state.queue = [];
      setStatus(discoverMsg, `Could not load profiles: ${friendlyError(err)}`, 'error');
    } finally {
      setBusy(btn, false);
      renderCard();
    }
  }

  function renderCard() {
    const p = state.queue[0];
    const card = $('profileCard');
    $('discoverEmpty').classList.toggle('hidden', Boolean(p));
    card.classList.toggle('hidden', !p);
    $('discoverCount').textContent = p
      ? `${state.queue.length} ${state.queue.length === 1 ? 'person' : 'people'} to discover`
      : 'You’re all caught up.';
    if (!p) return;

    const img = $('cardImg');
    const photo = safePhoto(p.photo_url);
    $('cardInitials').textContent = initials(p.display_name);
    img.classList.add('hidden');
    img.removeAttribute('src');
    if (photo) {
      img.onload = () => img.classList.remove('hidden');
      img.onerror = () => img.classList.add('hidden');
      img.src = photo;
      img.alt = `Photo of ${p.display_name}`;
    }
    $('cardName').textContent = nameAge(p);
    $('cardCity').textContent = p.city || '';
    $('cardBio').textContent = p.bio || 'Still writing their story…';
  }

  async function react(liked) {
    const p = state.queue[0];
    if (!p || state.acting) return;
    state.acting = true;
    $('likeBtn').disabled = $('passBtn').disabled = true;
    try {
      if (liked) {
        const { error } = await client.from(TABLES.likes).insert({ liker_id: state.user.id, liked_id: p.id });
        if (error && error.code !== '23505') throw error; // 23505 = already liked
        state.liked.add(p.id);
        if (state.likedMe.has(p.id)) toast(`It’s a match with ${p.display_name}! Say hi in Matches.`);
        else toast(`You liked ${p.display_name}.`);
      } else {
        state.passed.add(p.id);
        savePassed();
      }
      state.queue.shift();
      renderCard();
    } catch (err) {
      toast(`Like failed: ${friendlyError(err)}`);
    } finally {
      state.acting = false;
      $('likeBtn').disabled = $('passBtn').disabled = false;
    }
  }

  $('likeBtn').addEventListener('click', () => react(true));
  $('passBtn').addEventListener('click', () => react(false));
  $('refresh').addEventListener('click', loadDiscover);
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'discover' || e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowRight') react(true);
    if (e.key === 'ArrowLeft') react(false);
  });

  // ---------- safety: block & report ----------
  async function blockUser(p) {
    if (!p || !window.confirm(`Block ${p.display_name || 'this member'}? You won’t see each other anymore.`)) return false;
    const { error } = await client.from(TABLES.blocks).insert({ blocker_id: state.user.id, blocked_id: p.id });
    if (error && error.code !== '23505') { toast(`Block failed: ${friendlyError(error)}`); return false; }
    state.hidden.add(p.id);
    toast(`${p.display_name || 'Member'} has been blocked.`);
    return true;
  }

  async function reportUser(p) {
    if (!p) return;
    const reason = window.prompt(`Why are you reporting ${p.display_name || 'this member'}? (fake profile, harassment, underage, spam…)`);
    if (reason === null) return;
    const text = reason.trim().slice(0, 500);
    if (!text) return toast('Please describe the problem so we can review it.');
    const { error } = await client.from(TABLES.reports).insert({ reporter_id: state.user.id, reported_id: p.id, reason: text });
    toast(error ? `Report failed: ${friendlyError(error)}` : 'Thanks — your report was sent for review.');
  }

  $('cardBlock').addEventListener('click', async () => {
    const p = state.queue[0];
    if (await blockUser(p)) { state.queue.shift(); renderCard(); }
  });
  $('cardReport').addEventListener('click', () => reportUser(state.queue[0]));
  $('chatBlock').addEventListener('click', async () => {
    if (await blockUser(state.chatWith)) { state.chatWith = null; go('matches'); }
  });
  $('chatReport').addEventListener('click', () => reportUser(state.chatWith));

  // ---------- matches ----------
  const matchesStatus = $('matchesStatus');

  async function loadMatches() {
    if (!client || !state.user) return;
    const btn = $('refreshMatches');
    const list = $('matchList');
    setBusy(btn, true, 'Loading…');
    setStatus(matchesStatus, '');
    try {
      const likesError = await loadRelations();
      if (likesError) throw likesError;
      const ids = [...state.liked].filter((id) => state.likedMe.has(id) && !state.hidden.has(id));
      let people = [];
      if (ids.length) {
        const { data, error } = await client.from(TABLES.profiles).select('*').in('id', ids);
        if (error) throw error;
        people = data || [];
      }

      // Latest message per match, for previews (optional).
      const latest = new Map();
      if (people.length) {
        const me = state.user.id;
        const { data: msgs } = await client.from(TABLES.messages)
          .select('sender_id, receiver_id, body, created_at')
          .or(`sender_id.eq.${me},receiver_id.eq.${me}`)
          .order('created_at', { ascending: false })
          .limit(300);
        for (const m of msgs || []) {
          const other = m.sender_id === me ? m.receiver_id : m.sender_id;
          if (!latest.has(other)) latest.set(other, m);
        }
      }
      people.sort((a, b) => String(latest.get(b.id)?.created_at || '').localeCompare(String(latest.get(a.id)?.created_at || '')));

      list.replaceChildren(...people.map((p) => {
        const li = document.createElement('li');
        const btnEl = document.createElement('button');
        btnEl.type = 'button';
        const av = document.createElement('div');
        av.className = 'avatar';
        paintAvatar(av, p);
        const who = document.createElement('div');
        who.className = 'who';
        const strong = document.createElement('strong');
        strong.textContent = nameAge(p);
        const preview = document.createElement('span');
        preview.className = 'preview';
        const last = latest.get(p.id);
        preview.textContent = last ? `${last.sender_id === state.user.id ? 'You: ' : ''}${last.body}` : (p.city || 'New match — say hi!');
        who.append(strong, preview);
        btnEl.append(av, who);
        btnEl.addEventListener('click', () => openChat(p));
        li.append(btnEl);
        return li;
      }));
      $('matchesEmpty').classList.toggle('hidden', people.length > 0);
    } catch (err) {
      list.replaceChildren();
      $('matchesEmpty').classList.add('hidden');
      setStatus(matchesStatus, `Could not load matches: ${friendlyError(err)}`, 'error');
    } finally {
      setBusy(btn, false);
    }
  }
  $('refreshMatches').addEventListener('click', loadMatches);

  // ---------- chat ----------
  const chatStatus = $('chatStatus');

  function openChat(p) {
    state.chatWith = p;
    state.messageSignature = '';
    $('chatName').textContent = nameAge(p);
    $('chatMeta').textContent = p.city || 'Matched';
    paintAvatar($('chatAvatar'), p);
    $('messageList').replaceChildren();
    setStatus(chatStatus, '');
    go('chat');
    loadMessages(true);
    startPolling();
    $('messageInput').focus();
  }

  async function loadMessages(scrollToEnd) {
    const other = state.chatWith;
    if (!client || !state.user || !other) return;
    const me = state.user.id;
    const { data, error } = await client.from(TABLES.messages)
      .select('*')
      .or(`and(sender_id.eq.${me},receiver_id.eq.${other.id}),and(sender_id.eq.${other.id},receiver_id.eq.${me})`)
      .order('created_at', { ascending: true })
      .limit(300);
    if (state.chatWith !== other) return; // switched chats meanwhile
    if (error) {
      setStatus(chatStatus, `Messages unavailable: ${friendlyError(error)}`, 'error');
      return;
    }
    const rows = data || [];
    const signature = `${rows.length}:${rows[rows.length - 1]?.id ?? ''}`;
    if (signature === state.messageSignature) return;
    state.messageSignature = signature;

    const box = $('messageList');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = `You matched with ${other.display_name || 'this member'}. Start the conversation!`;
      box.replaceChildren(empty);
    } else {
      box.replaceChildren(...rows.map((m) => {
        const div = document.createElement('div');
        div.className = `bubble${m.sender_id === me ? ' mine' : ''}`;
        div.textContent = m.body;
        if (m.created_at) {
          const t = document.createElement('time');
          const d = new Date(m.created_at);
          t.dateTime = d.toISOString();
          t.textContent = d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          div.append(t);
        }
        return div;
      }));
    }
    if (scrollToEnd || nearBottom) box.scrollTop = box.scrollHeight;
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') loadMessages(false);
    }, POLL_MS);
  }
  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  $('messageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const other = state.chatWith;
    const input = $('messageInput');
    const body = input.value.trim().slice(0, 1000);
    if (!other || !body) return;
    const btn = $('sendBtn');
    setBusy(btn, true, '…');
    setStatus(chatStatus, '');
    try {
      const { error } = await client.from(TABLES.messages).insert({ sender_id: state.user.id, receiver_id: other.id, body });
      if (error) throw error;
      input.value = '';
      await loadMessages(true);
    } catch (err) {
      setStatus(chatStatus, `Message not sent: ${friendlyError(err)}`, 'error');
    } finally {
      setBusy(btn, false);
      input.focus();
    }
  });

  $('chatBack').addEventListener('click', () => { state.chatWith = null; go('matches'); });

  // ---------- start ----------
  setMode('login');
  if (client) {
    // Defer work out of the auth callback (recommended by supabase-js to avoid deadlocks).
    client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => applySession(session), 0);
    });
  } else {
    setStatus(status, 'Setup pending: add your Supabase URL and public anon key in config.js.', 'error');
  }
})();
