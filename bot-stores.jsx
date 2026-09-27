// ───────────────────────────────────────────────────────────────────
// bot-stores.jsx — Global stores & per-conversation runtime helpers
// All the in-memory data stores and their useXxx() React hooks, plus the
// small per-conversation behaviour helpers that the AI engine relies on.
//     AUTH_STORE / AI_MASTER          — sign-in + master AI on-off
//     BLOCK_STORE / MSGS_STORE        — conversations, threads, block flags
//     CONN_STORE / CRED_STORE         — platform connection + LLM credentials
//     TG_AUTH_STORE / BRIDGE_STORE    — Telegram OTP modal + .NET bridge state
//     STAGES / AISTATUS               — small enums used everywhere
//     INBOUND_TRACKER / SPAM_THROTTLE — first-seen + per-customer rate limiting

// ── IDB_STORE — Military-grade IndexedDB persistence layer ───────────
// Replaces localStorage/sessionStorage for all critical state (EU_CACHE,
// ghost session, peer warm-up list) so Ctrl+Shift+Z / tab close / history
// clear cannot wipe session data. Falls back to localStorage silently on
// environments where IDB is blocked (private mode edge cases).
//
// Usage:
//   await IDB_STORE.set('key', value)       — store any JSON-serialisable value
//   await IDB_STORE.get('key')              — returns value or null
//   await IDB_STORE.del('key')              — delete one key
//   await IDB_STORE.keys(prefix?)          — list all keys (optionally filtered)
//   await IDB_STORE.clear(prefix?)         — delete keys matching prefix, or all
const IDB_STORE = (() => {
  const DB_NAME    = 'bc_persist_v1';
  const STORE_NAME = 'kv';
  const DB_VERSION = 1;
  let _db = null;
  let _ready = null;   // Promise<IDBDatabase>

  const _open = () => {
    if (_ready) return _ready;
    _ready = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
        req.onerror   = () => { resolve(null); };
        req.onblocked = () => { resolve(null); };
      } catch (_) { resolve(null); }
    });
    return _ready;
  };

  // LS fallback helpers
  const _lsKey = (k) => '__bc_idb__' + k;
  const _lsGet = (k) => { try { const v = localStorage.getItem(_lsKey(k)); return v !== null ? JSON.parse(v) : null; } catch(_){ return null; } };
  const _lsSet = (k, v) => { try { localStorage.setItem(_lsKey(k), JSON.stringify(v)); } catch(_){} };
  const _lsDel = (k)    => { try { localStorage.removeItem(_lsKey(k)); } catch(_){} };
  const _lsKeys = (pfx) => {
    const out = []; try {
      for (let i = 0; i < localStorage.length; i++) {
        const lk = localStorage.key(i);
        if (!lk || !lk.startsWith('__bc_idb__')) continue;
        const k = lk.slice('__bc_idb__'.length);
        if (!pfx || k.startsWith(pfx)) out.push(k);
      }
    } catch(_){} return out;
  };

  const _tx = async (mode, fn) => {
    const db = await _open();
    if (!db) return undefined;
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, mode);
        const st = tx.objectStore(STORE_NAME);
        const req = fn(st);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  };

  return {
    async get(key) {
      try {
        const v = await _tx('readonly', st => st.get(key));
        return v !== undefined ? v : null;
      } catch (_) { return _lsGet(key); }
    },
    async set(key, value) {
      try {
        await _tx('readwrite', st => st.put(value, key));
        _lsSet(key, value);  // Mirror to LS as secondary backup
      } catch (_) { _lsSet(key, value); }
    },
    async del(key) {
      try { await _tx('readwrite', st => st.delete(key)); } catch (_) {}
      _lsDel(key);
    },
    async keys(prefix) {
      try {
        const db = await _open();
        if (!db) return _lsKeys(prefix);
        return new Promise((resolve) => {
          try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const st = tx.objectStore(STORE_NAME);
            const req = st.getAllKeys();
            req.onsuccess = () => {
              const all = req.result || [];
              resolve(prefix ? all.filter(k => String(k).startsWith(prefix)) : all);
            };
            req.onerror = () => resolve(_lsKeys(prefix));
          } catch (_) { resolve(_lsKeys(prefix)); }
        });
      } catch (_) { return _lsKeys(prefix); }
    },
    async clear(prefix) {
      try {
        const ks = await this.keys(prefix);
        await Promise.all(ks.map(k => this.del(k)));
      } catch (_) {}
      if (!prefix) {
        // Also wipe LS mirrors
        _lsKeys().forEach(k => _lsDel(k));
      }
    },
  };
})();

//     PRESENCE_SIMULATOR              — online/typing-presence pacing
//     SCHEDULE_GATE / REPETITION_GUARD / IMPERFECTION
//                                     — humanising layer (hours, repeats, typos)
//     AGENTS_STORE / DRAFT_STORE / INPUT_DRAFTS / PLATFORM_LIMITS
//                                     — agent CRUD + draft chunk lifecycle
// ───────────────────────────────────────────────────────────────────

// ── AUTH STORE ────────────────────────────────────────────────
// Holds the signed-in account + a "loading" flag while we hit auth_whoami on
// boot. Components branch on these to render <LoginRegister/> vs the app.
const AUTH_STORE = {
  account: null,        // { id, email, username, display_name } | null
  checked: false,       // true once whoami has resolved at least once
  subs: new Set(),
  sub(fn){ this.subs.add(fn); return ()=>this.subs.delete(fn); },
  notify(){ this.subs.forEach(fn=>fn(this.account, this.checked)); },
  set(account){ this.account = account || null; this.checked = true; this.notify(); },
  // Kicks the user back to the login screen WITHOUT calling the API — used by
  // _parseApi when it sees a 401 so we don't loop on dead sessions.
  signOut(){
    if (this.account === null && this.checked) return;
    this.account = null; this.checked = true; this.notify();
  },
  // Server-side logout — clears the PHP session AND wipes local stores so
  // nothing from the previous account leaks across.
  async logout(){
    try { await apiFetch('auth_logout'); } catch(_) {}
    // Wipe in-memory caches so a subsequent login doesn't see stale data.
    MSGS_STORE._epoch++;
    MSGS_STORE.list = []; MSGS_STORE.threads = {}; MSGS_STORE.auditLog = {}; MSGS_STORE.activeConvId = null;
    // Without these the next sign-in believed every thread was already
    // hydrated and opened conversations with empty history.
    MSGS_STORE._hydrated = new Set();
    MSGS_STORE._threadInflight = new Map();
    MSGS_STORE._threadTried = new Set();
    if (MSGS_STORE._warmTimer) { clearTimeout(MSGS_STORE._warmTimer); MSGS_STORE._warmTimer = null; }
    MSGS_STORE.mediaRev = {};
    MSGS_STORE._pendingAcks = {};
    Object.values(MSGS_STORE._ops || {}).forEach(o => { try { clearTimeout(o.timer); } catch (_) {} });
    MSGS_STORE._ops = {};
    MSGS_STORE.notify();
    // Session-only UI caches that hold per-account data (attachment drafts
    // are whole files as data URLs — real memory).
    try { if (typeof ATTACH_DRAFTS !== 'undefined') ATTACH_DRAFTS.clear(); } catch(_){}
    try { if (typeof SCROLL_POS_CACHE !== 'undefined') SCROLL_POS_CACHE.clear(); } catch(_){}
    try { if (typeof MEDIA_META_CACHE !== 'undefined') MEDIA_META_CACHE.clear(); } catch(_){}
    try { if (typeof _momentSeen !== 'undefined') _momentSeen.clear(); } catch(_){}
    try { if (typeof _avatarGlide !== 'undefined') _avatarGlide.clear(); } catch(_){}
    try { if (typeof _rowFirstSeen !== 'undefined') { _rowFirstSeen.clear(); _rowSeenPrimed.done = false; } } catch(_){}
    AGENTS_STORE.list = []; AGENTS_STORE.loaded = false; AGENTS_STORE.notify();
    PRODS_STORE.list = []; PRODS_STORE.subs.forEach(fn=>fn(PRODS_STORE.list));
    PAYMENTS_STORE.wallets = {}; PAYMENTS_STORE.invoices = []; PAYMENTS_STORE.loaded = false; PAYMENTS_STORE.notify();
    // Tear down the payment-polling watchdog so its stale closure doesn't keep
    // running against the next account's (empty) invoice list. resumePending()
    // restarts it cleanly on the next sign-in.
    try { if (typeof INVOICE_PROCESSOR !== 'undefined' && INVOICE_PROCESSOR.stopPolling) INVOICE_PROCESSOR.stopPolling(); } catch(_){}
    CRED_STORE.values = {}; CRED_STORE.meta = {}; CRED_STORE.loaded = false; CRED_STORE.notify();
    try { if (typeof PREFS_STORE !== 'undefined' && PREFS_STORE.reset) PREFS_STORE.reset(); } catch(_){}
    // ── HARD WIPE PROFILE-POPUP CACHES ─────────────────────────────────
    // EU_CACHE keeps end-user popup data (purchases, invoices, notes,
    // contact details). It's persisted to localStorage. We MUST flush it
    // on logout — otherwise the next operator who logs in on the same
    // browser sees the previous account's customer record before the API
    // refresh lands. BLOCK_STORE is in-memory only but mirroring it for
    // hygiene (otherwise a stale block flag could suppress a fresh inbound
    // for one render cycle on the new account).
    try { if (typeof EU_CACHE !== 'undefined' && EU_CACHE.clear) EU_CACHE.clear(); } catch(_){}
    try {
      if (typeof BLOCK_STORE !== 'undefined') {
        BLOCK_STORE.flags = {};
        if (typeof BLOCK_STORE.notify === 'function') BLOCK_STORE.notify();
      }
    } catch(_){}
    // Per-conversation drafts and input buffers are also account-tainted
    // because their convIds (e.g. "telegram_12345") collide across accounts.
    try { if (typeof INPUT_DRAFTS !== 'undefined' && INPUT_DRAFTS.clear) INPUT_DRAFTS.clear(); } catch(_){}
    // Pending AI drafts own timers and an unresolved promise the reply
    // pipeline is awaiting. Clearing the map alone left both alive: timers
    // kept firing into an empty store and the engine's awaits never
    // settled, pinning their closures for the rest of the session. Finalise
    // each one as a superseded discard instead, then clear.
    try {
      if (typeof DRAFT_STORE !== 'undefined' && DRAFT_STORE.drafts) {
        // Queued drafts first, so finalising the open ones can't start them.
        if (typeof DRAFT_STORE.abandonQueued === 'function') DRAFT_STORE.abandonQueued();
        Array.from(DRAFT_STORE.drafts.keys()).forEach(id => {
          try { const d = DRAFT_STORE.drafts.get(id); if (d) d.superseded = true; DRAFT_STORE._finalize(id, false); } catch(_){}
        });
        if (typeof DRAFT_STORE.drafts.clear === 'function') DRAFT_STORE.drafts.clear();
      }
    } catch(_){}
    this.signOut();
  },
};
const useAuth = () => {
  const [s, setS] = React.useState({account: AUTH_STORE.account, checked: AUTH_STORE.checked});
  React.useEffect(()=>AUTH_STORE.sub((account, checked)=>setS({account, checked})), []);
  return s;
};


// Mirrors the credential `ai_enabled` (default ON). The reply queue checks
// this before doing anything; the server-side ai_reply endpoint enforces the
// same gate independently so a stale client can't bypass it. UI lives in
// SettingsView → General.
const AI_MASTER = {
  enabled: true,            // optimistic default — corrected by load() below
  loaded:  false,
  subs: new Set(),
  sub(fn){ this.subs.add(fn); return ()=>this.subs.delete(fn); },
  notify(){ this.subs.forEach(fn=>fn(this.enabled)); },
  hydrate(creds){
    // The global on/off switch has been retired: agents are paused one at
    // a time from the agent list. Replies are therefore always allowed
    // here. An account that had switched everything off is switched back
    // on once, so nobody is left with agents that silently never reply
    // and no control to fix it.
    const v = creds && creds.values && creds.values.ai_enabled;
    if (v === '0' && !this._reset) {
      this._reset = true;
      try { CRED_STORE.set('ai_enabled', '1'); } catch (_) {}
    }
    this.enabled = true;
    this.loaded = true;
    this.notify();
  },
  set(on){
    this.enabled = !!on;
    this.notify();
    return CRED_STORE.set('ai_enabled', on ? '1' : '0');
  },
};
const useAiMaster = () => {
  const [on, setOn] = React.useState(AI_MASTER.enabled);
  React.useEffect(()=>AI_MASTER.sub(setOn),[]);
  return on;
};

// ── LIVE MESSAGE STORE ────────────────────────────────────────
// Loaded from DB on startup. All mutations save back to DB.
//
// Threads are keyed by conv_id (= `${platform}_${chatId}`) — NEVER by chatId
// alone, otherwise live in-memory threads and DB-loaded threads end up under
// different keys and the UI flickers between empty/full.
// ── BLOCK_STORE — per-conversation block / mute flags ─────────────────
// Mirrors the bc_end_users.is_blocked / is_muted columns server-side.
// Populated lazily as the operator opens a conversation (via get_end_user)
// or eagerly when the panel toggles a flag. MSGS_STORE.onIncoming consults
// this before persisting an inbound so blocked users have their messages
// dropped at the JS boundary even when the .NET host can't enforce the
// block at the platform level (Bot API / Discord). Subscribers can listen
// for changes and re-render — used by the Customer-Info panel so the
// Block/Mute action tiles always reflect the current state.
const BLOCK_STORE = {
  flags: {},   // convId → { blocked: bool, muted: bool }
  subs:  new Set(),
  get(convId) {
    return this.flags[convId] || { blocked: false, muted: false };
  },
  set(convId, partial) {
    const cur = this.flags[convId] || { blocked: false, muted: false };
    this.flags[convId] = { ...cur, ...partial };
    this.notify();
  },
  isBlocked(convId) { return !!(this.flags[convId] && this.flags[convId].blocked); },
  isMuted(convId)   { return !!(this.flags[convId] && this.flags[convId].muted); },
  sub(fn)    { this.subs.add(fn); return () => this.subs.delete(fn); },
  notify()   { this.subs.forEach(fn => { try { fn(); } catch(_) {} }); },
};

// ── PREFS_STORE — account-level inbound filtering + persistent block list ──
// Backed by a single CRED_STORE meta key ("inbound_prefs") so it persists
// server-side and survives reloads / re-logins, same pattern PAYMENTS_STORE
// uses. Drives three things, all platform-agnostic (telegram / discord /
// any future platform):
//   • allow[platform][chatType]  — accept inbound from private / group /
//                                   channel chats independently per platform.
//   • contactsOnly[platform]      — when true, only accept inbound from
//                                   senders we already have a conversation
//                                   with (i.e. people in the contact list).
//                                   New/unknown senders are dropped.
//   • blocked[]                   — persistent block list of individual
//                                   users, keyed by platform + handle and/or
//                                   chatId. Survives across conversations, so
//                                   a blocked user is dropped even if they
//                                   message from a fresh chat. Wired to the
//                                   Block action in the contact list / chat
//                                   profile panel and editable from Settings →
//                                   Preferences → Filters.
// Leading "[Photo]" / "[Document]" labels the .NET host prepends to an
// attachment message. Stripped from the bubble once the actual file is
// attached, kept when it is all we have.
const MEDIA_LABEL_RE = /^\[(photo|image|video|document|file|audio|voice|gif|sticker|media|animation)\]\s*/i;
// Longest data: URL we will write to bc_messages. base64 inflates by ~33%,
// so this lands a POST comfortably under a default 8M post_max_size.
const MEDIA_PERSIST_MAX = 3500000;

// ── MESSAGE PREVIEW FORMATTING ────────────────────────────────────────
// Attachment messages reach the inbox preview in several raw shapes: the
// host's "[Photo]" / "[Document]" labels, the "[image] caption" form the
// outbound media path writes, "📎 name.pdf", and whatever api.php stored
// as last_msg. None of those should ever be shown as-is. Everything that
// displays a preview goes through bcPreviewParts, which turns them into a
// kind (for the icon) plus a human label, e.g. Photo / Voice message.
const BC_MEDIA_KINDS = {
  photo:'photo', image:'photo', picture:'photo', img:'photo',
  video:'video', video_note:'video_note', videonote:'video_note', round:'video_note',
  document:'file', doc:'file', file:'file',
  audio:'audio', music:'audio', song:'audio',
  voice:'voice', voice_note:'voice', voicenote:'voice',
  gif:'gif', animation:'gif',
  sticker:'sticker',
  media:'attachment', attachment:'attachment',
  contact:'contact', location:'location', venue:'location', poll:'poll', link:'link',
};
const BC_MEDIA_LABEL = {
  photo:'Photo', video:'Video', video_note:'Video message', file:'File', audio:'Audio',
  voice:'Voice message', gif:'GIF', sticker:'Sticker', attachment:'Attachment',
  contact:'Contact', location:'Location', poll:'Poll', link:'Link',
};
function bcPreviewParts(raw) {
  let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  let who = '';
  const pm = /^(AI|You):\s*/.exec(s);
  if (pm) { who = pm[1]; s = s.slice(pm[0].length); }
  let kind = '';
  const mm = /^\[\s*([a-z][a-z _-]{1,20}?)(?:\s+([^\]]*))?\s*\]\s*/i.exec(s);
  if (mm) {
    const k = BC_MEDIA_KINDS[mm[1].toLowerCase().replace(/[\s-]+/g, '_')];
    if (k) {
      kind = k;
      // "[file name.pdf]" — the too-large-to-archive marker carries a name.
      const inner = (mm[2] || '').trim();
      s = s.slice(mm[0].length).trim() || inner;
    }
  }
  if (!kind && /^📎\s*/u.test(s)) { kind = 'file'; s = s.replace(/^📎\s*/u, ''); }
  if (!kind && /^data:(image|video|audio)\//i.test(s)) {
    kind = ({ image:'photo', video:'video', audio:'audio' })[RegExp.$1.toLowerCase()];
    s = '';
  }
  return { who, kind, label: kind ? BC_MEDIA_LABEL[kind] : '', text: s };
}
// Plain-text form, for places that can only show a string.
function bcPreviewPlain(raw) {
  const p = bcPreviewParts(raw);
  const body = p.kind ? (p.text ? (p.kind === 'file' ? p.text : p.label + ': ' + p.text) : p.label) : p.text;
  return (p.who ? p.who + ': ' : '') + body;
}

// ── Bridge + toast helpers ────────────────────────────────────────────
// Sends any action to the desktop host. Uses the generic send() so new
// actions (editMessage, deleteMessages, openMedia, saveMedia) need no
// change to BotCommand.html. false = not running inside the desktop app.
function bcBridgeSend(action, payload) {
  try {
    const b = window.BotBridge;
    if (!b || typeof b.send !== 'function') return false;
    // No desktop app: what the server can send for a connected bot goes
    // there (see BC_RELAY); anything else can't be done here.
    if (typeof b.isWebView2 === 'function' && !b.isWebView2()) {
      return typeof BC_RELAY !== 'undefined' && BC_RELAY.route(action, payload || {});
    }
    b.send(action, payload || {});
    return true;
  } catch (_) { return false; }
}

// ── NETWORK MONITOR ───────────────────────────────────────────────────
// navigator.onLine only reports whether an adapter is up. A router reset,
// a dropped Wi-Fi uplink or a captive portal all leave it saying "online"
// while nothing gets through. So reachability is PROBED: a no-cors request
// to the Telegram API edge (and a neutral fallback) every few seconds. A
// no-cors fetch resolves with an opaque response when the host answered
// at all and rejects when it could not be reached, which is exactly the
// signal needed, without reading anything.
//
// Also watches for the machine sleeping: timers do not run while it is
// suspended, so a tick that arrives far later than scheduled means the
// PC was asleep and every socket it had is almost certainly dead.
//
// Emits window 'bc:net' with detail { online, why, downForMs }.
const NET_MONITOR = {
  online: true,
  offlineSince: 0,
  lastOnlineAt: Date.now(),
  _fails: 0,
  _started: false,
  _probeTimer: null,
  _probing: false,
  PROBE_URLS: ['https://api.telegram.org/', 'https://www.gstatic.com/generate_204', 'https://discord.com/api/v10/gateway'],
  start() {
    if (this._started || typeof window === 'undefined') return;
    this._started = true;
    window.addEventListener('offline', () => { this._fails = 2; this._set(false, 'adapter'); this._schedule(3000); });
    window.addEventListener('online',  () => { this.probeNow(); });
    // Sleep / resume detection.
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      const gap = now - last;
      last = now;
      if (gap > 30000) {
        console.log('[net] resumed after ' + Math.round(gap / 1000) + 's of suspended timers');
        this._emit({ online: this.online, why: 'resume', downForMs: gap });
        this.probeNow();
      }
    }, 5000);
    this._schedule(4000);
  },
  _schedule(ms) {
    clearTimeout(this._probeTimer);
    this._probeTimer = setTimeout(() => this.probeNow(), ms);
  },
  async _reachable() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    const one = (url) => new Promise((resolve, reject) => {
      const ctl = new AbortController();
      const t = setTimeout(() => { try { ctl.abort(); } catch (_) {} reject(new Error('timeout')); }, 6000);
      fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + '_bc=' + Date.now(),
            { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctl.signal })
        .then(() => { clearTimeout(t); resolve(true); }, (e) => { clearTimeout(t); reject(e); });
    });
    try {
      if (typeof Promise.any === 'function') { await Promise.any(this.PROBE_URLS.map(one)); return true; }
      for (const u of this.PROBE_URLS) { try { await one(u); return true; } catch (_) {} }
      return false;
    } catch (_) { return false; }
  },
  async probeNow() {
    if (this._probing) return this.online;
    this._probing = true;
    try {
      const ok = await this._reachable();
      if (ok) { this._fails = 0; this._set(true, 'probe'); }
      else {
        this._fails++;
        // Two misses in a row before calling it: one slow probe is not an outage.
        if (this._fails >= 2) this._set(false, 'probe');
      }
    } finally {
      this._probing = false;
      this._schedule(this.online ? (this._fails ? 3000 : 10000) : 3000);
    }
    return this.online;
  },
  // Something else saw a network failure (an API call) — check right away.
  hint() { if (this.online && !this._probing) this.probeNow(); },
  _set(online, why) {
    if (online === this.online) return;
    const now = Date.now();
    const downForMs = online ? (now - (this.offlineSince || now)) : 0;
    this.online = online;
    if (online) this.lastOnlineAt = now; else this.offlineSince = now;
    console.log('[net] ' + (online ? 'back online after ' + Math.round(downForMs / 1000) + 's' : 'offline') + ' (' + why + ')');
    this._emit({ online, why, downForMs });
  },
  _emit(detail) {
    try { window.dispatchEvent(new CustomEvent('bc:net', { detail })); } catch (_) {}
  },
};

// ── DURABLE WRITES ────────────────────────────────────────────────────
// A message row that fails to save while the connection is down is gone
// for good: the thread looks right until a reload, and the agent's history
// is missing whatever the customer said. Writes on this path are retried
// until they land (network back, or a slow retry clock), then resolve with
// the server's answer, so callers awaiting an id still get one.
//
// Only transport failures retry. An answer from the server — even an
// error — is final. save_message carries a client uid so a retry after a
// request that DID land (a timeout on the response) is rejected as a
// duplicate by the (account, conv, msg_uid) unique key instead of doubling
// the row.
const BC_NET_ERR_RE = /failed to fetch|networkerror|network error|load failed|network request failed|err_internet|err_network|err_connection|timeout after|aborted|fetch failed/i;
const DURABLE_WRITES = {
  queue: [],
  _timer: null,
  _wired: false,
  run(action, body) {
    this._wire();
    if (action === 'save_message' && body && !body.msg_uid) {
      body = { ...body, msg_uid: 'c:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) };
    }
    return apiFetch(action, body).then(res => {
      if (res && res.error && BC_NET_ERR_RE.test(String(res.error))) {
        NET_MONITOR.hint();
        return new Promise(resolve => {
          this.queue.push({ action, body, resolve, first: Date.now(), tries: 1 });
          this._arm(8000);
        });
      }
      return res;
    });
  },
  _wire() {
    if (this._wired || typeof window === 'undefined') return;
    this._wired = true;
    window.addEventListener('bc:net', (e) => { if (e.detail && e.detail.online) this._arm(400); });
  },
  _arm(ms) {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, ms);
  },
  async flush() {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0);
    for (const it of batch) {
      const res = await apiFetch(it.action, it.body);
      if (res && res.error && BC_NET_ERR_RE.test(String(res.error)) && Date.now() - it.first < 6 * 3600 * 1000) {
        it.tries++;
        this.queue.push(it);
        continue;
      }
      if (it.tries > 1) console.log('[durable] ' + it.action + ' landed after ' + it.tries + ' tries');
      it.resolve(res);
    }
    if (this.queue.length) this._arm(NET_MONITOR.online ? 15000 : 30000);
  },
};
const apiFetchDurable = (action, body) => DURABLE_WRITES.run(action, body);

// ── STATUS PILL ─────────────────────────────────────────────────────
// The ONE confirmation / status pill for the whole app: "Changes saved",
// "Alice removed from your contacts", "Couldn't save — …". Every save,
// delete and failure notice goes through here so they all look and
// behave the same, and follow the live accent colour (--acc) and theme.
//
//   bcToast(text, tone?, opts?)
//     tone  'ok' (default look, accent check) | 'err' | 'warn' | 'info'
//     opts  { detail }  quieter second part, e.g. the item's name
//           { ms }      override how long it stays
//
// Quiet by design: bottom-centre, small, fades itself out. One at a time
// (a new one replaces the old). Hover holds it; click dismisses it.
// Sits above every popup (z-index) so a save inside an editor sheet is
// always seen.
function bcToast(text, tone, opts) {
  try {
    if (!text) return;
    opts = opts || {};
    tone = ['ok', 'err', 'warn', 'info'].includes(tone) ? tone : 'info';
    if (!document.getElementById('bc-toast-css')) {
      const st = document.createElement('style');
      st.id = 'bc-toast-css';
      st.textContent = `
        .bc-toast{position:fixed;left:50%;bottom:24px;z-index:2147483000;
          max-width:min(460px,calc(100vw - 40px));
          display:flex;align-items:center;gap:9px;padding:6px 15px 6px 7px;border-radius:999px;
          font:500 12px/1.35 var(--font,'Inter',sans-serif);letter-spacing:-0.005em;color:var(--t1,#eeeef5);
          background:color-mix(in srgb, var(--s1,#11121e) 88%, transparent);
          border:1px solid color-mix(in srgb, var(--acc,#6c63ff) 24%, rgba(255,255,255,0.07));
          box-shadow:0 12px 32px -14px rgba(0,0,0,0.7),0 0 0 1px rgba(0,0,0,0.22),inset 0 1px 0 rgba(255,255,255,0.045);
          backdrop-filter:blur(18px) saturate(1.3);-webkit-backdrop-filter:blur(18px) saturate(1.3);
          opacity:0;transform:translate(-50%,10px) scale(0.98);pointer-events:none;cursor:default;
          transition:opacity .18s ease,transform .28s cubic-bezier(0.22,1,0.36,1),border-color .2s ease}
        .bc-toast[data-on="1"]{opacity:1;transform:translate(-50%,0) scale(1);pointer-events:auto}
        .bc-toast-ico{width:20px;height:20px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;
          color:var(--acc,#6c63ff);background:color-mix(in srgb, var(--acc,#6c63ff) 17%, transparent)}
        .bc-toast-ico svg{width:11px;height:11px;display:block}
        .bc-toast-txt{min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
        .bc-toast-sub{color:var(--t2,#9898b4);font-weight:400}
        .bc-toast[data-tone="err"]{border-color:color-mix(in srgb, var(--err,#ff453a) 30%, rgba(255,255,255,0.06))}
        .bc-toast[data-tone="err"] .bc-toast-ico{color:var(--err,#ff453a);background:color-mix(in srgb, var(--err,#ff453a) 15%, transparent)}
        .bc-toast[data-tone="warn"]{border-color:color-mix(in srgb, var(--warn,#ff9f0a) 28%, rgba(255,255,255,0.06))}
        .bc-toast[data-tone="warn"] .bc-toast-ico{color:var(--warn,#ff9f0a);background:color-mix(in srgb, var(--warn,#ff9f0a) 15%, transparent)}
        @media (prefers-reduced-motion: reduce){.bc-toast{transition:opacity .2s ease;transform:translate(-50%,0)}}`;
      document.head.appendChild(st);
    }
    let el = document.getElementById('bc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bc-toast'; el.className = 'bc-toast';
      el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      el.addEventListener('mouseenter', () => clearTimeout(bcToast._t));
      el.addEventListener('mouseleave', () => { if (el.dataset.on === '1') bcToast._arm(1400); });
      el.addEventListener('click', () => { clearTimeout(bcToast._t); el.dataset.on = '0'; });
      document.body.appendChild(el);
    }
    bcToast._arm = (ms) => { clearTimeout(bcToast._t); bcToast._t = setTimeout(() => { el.dataset.on = '0'; }, ms); };
    const ICONS = {
      ok:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      err:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="6" x2="12" y2="13.5"/><line x1="12" y1="18" x2="12" y2="18.01"/></svg>',
      warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="6" x2="12" y2="13.5"/><line x1="12" y1="18" x2="12" y2="18.01"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4.5"/></svg>',
    };
    el.dataset.tone = tone;
    el.innerHTML = '';
    const ico = document.createElement('span');
    ico.className = 'bc-toast-ico'; ico.setAttribute('aria-hidden', 'true'); ico.innerHTML = ICONS[tone];
    const txt = document.createElement('span');
    txt.className = 'bc-toast-txt';
    txt.appendChild(document.createTextNode(String(text)));
    if (opts.detail) {
      const sub = document.createElement('span');
      sub.className = 'bc-toast-sub';
      sub.appendChild(document.createTextNode(' · ' + String(opts.detail)));
      txt.appendChild(sub);
    }
    el.appendChild(ico); el.appendChild(txt);
    el.title = String(text) + (opts.detail ? ' · ' + opts.detail : '');
    el.dataset.on = '0';
    void el.offsetWidth;
    el.dataset.on = '1';
    bcToast._arm(opts.ms || (tone === 'err' ? 5200 : tone === 'warn' ? 4200 : 2400));
  } catch (_) {}
}
try { window.bcToast = bcToast; } catch (_) {}

// The inbound gate (MSGS_STORE.onIncoming) and the AI engine both consult
// this so blocked / filtered traffic never reaches the operator OR the agent.
const PREFS_DEFAULTS = () => ({
  allow: {
    telegram: { private: true, group: true, channel: true },
    discord:  { private: true, group: true, channel: true },
  },
  contactsOnly: { telegram: false, discord: false },
  blocked: [],   // [{ platform, handle, chatId, name, ts }]
});
// Normalise the raw bridge chatType into one of: private | group | channel.
const normChatType = (ct) => {
  const t = String(ct || 'private').toLowerCase();
  if (t === 'channel') return 'channel';
  if (t === 'group' || t === 'supergroup' || t === 'guild') return 'group';
  return 'private';
};
const normHandle = (h) => String(h || '').trim().replace(/^@/, '').toLowerCase();

const PREFS_STORE = {
  prefs: PREFS_DEFAULTS(),
  loaded: false,
  subs: new Set(),
  sub(fn){ this.subs.add(fn); return ()=>this.subs.delete(fn); },
  notify(){ this.subs.forEach(fn=>{ try{ fn(); }catch(_){}}); },

  hydrateFromCreds(){
    try {
      const p = (typeof CRED_STORE !== 'undefined') ? CRED_STORE.getMeta('inbound_prefs') : null;
      const d = PREFS_DEFAULTS();
      if (p && typeof p === 'object') {
        this.prefs = {
          allow: {
            telegram: { ...d.allow.telegram, ...((p.allow&&p.allow.telegram)||{}) },
            discord:  { ...d.allow.discord,  ...((p.allow&&p.allow.discord)||{}) },
          },
          contactsOnly: { ...d.contactsOnly, ...(p.contactsOnly||{}) },
          blocked: Array.isArray(p.blocked) ? p.blocked : [],
        };
      } else {
        this.prefs = d;
      }
    } catch(e) {
      console.warn('[prefs] hydrate failed', e);
      this.prefs = PREFS_DEFAULTS();
    }
    this.loaded = true;
    this.notify();
  },
  reset(){ this.prefs = PREFS_DEFAULTS(); this.loaded = false; this.notify(); },
  _persist(){
    try { return CRED_STORE.set('inbound_prefs', '1', this.prefs); }
    catch(e){ console.warn('[prefs] persist failed', e); return Promise.resolve(); }
  },

  // ── filter setters ──
  setAllow(platform, chatType, on){
    const d = PREFS_DEFAULTS();
    const cur = this.prefs.allow[platform] || d.allow[platform] || { private:true, group:true, channel:true };
    this.prefs = { ...this.prefs, allow: { ...this.prefs.allow, [platform]: { ...cur, [chatType]: !!on } } };
    this.notify(); return this._persist();
  },
  setContactsOnly(platform, on){
    this.prefs = { ...this.prefs, contactsOnly: { ...this.prefs.contactsOnly, [platform]: !!on } };
    this.notify(); return this._persist();
  },

  // ── block list ──
  isBlockedUser(platform, handle, chatId){
    const h = normHandle(handle);
    const cid = String(chatId || '');
    return (this.prefs.blocked || []).some(b =>
      b && b.platform === platform && (
        (h && normHandle(b.handle) === h) ||
        (cid && String(b.chatId || '') === cid)
      )
    );
  },
  block(platform, { handle, chatId, name } = {}){
    if (!platform) return Promise.resolve();
    if (this.isBlockedUser(platform, handle, chatId)) return Promise.resolve();
    const row = { platform, handle: handle||'', chatId: chatId? String(chatId):'', name: name||'', ts: Date.now() };
    this.prefs = { ...this.prefs, blocked: [...(this.prefs.blocked||[]), row] };
    this.notify(); return this._persist();
  },
  unblock(platform, { handle, chatId } = {}){
    const h = normHandle(handle); const cid = String(chatId||'');
    this.prefs = { ...this.prefs, blocked: (this.prefs.blocked||[]).filter(b =>
      !(b && b.platform === platform && (
        (h && normHandle(b.handle) === h) ||
        (cid && String(b.chatId||'') === cid)
      ))
    )};
    this.notify(); return this._persist();
  },

  // ── inbound gate decision — returns {ok:bool, reason:string} ──
  // `known` = true when we already have a conversation with this sender
  // (i.e. they're in the contact list).
  evaluateInbound({ platform, chatType, handle, chatId, known }){
    const p = platform || 'telegram';
    if (this.isBlockedUser(p, handle, chatId)) return { ok:false, reason:'blocked user' };
    const ct = normChatType(chatType);
    const allow = (this.prefs.allow && this.prefs.allow[p]) || { private:true, group:true, channel:true };
    if (allow[ct] === false) return { ok:false, reason:`${ct} chats filtered for ${p}` };
    if (this.prefs.contactsOnly && this.prefs.contactsOnly[p] && !known) {
      return { ok:false, reason:'contacts-only mode — sender not in contact list' };
    }
    return { ok:true, reason:'' };
  },
};
const usePrefs = () => {
  const [v, setV] = React.useState({ prefs: PREFS_STORE.prefs, loaded: PREFS_STORE.loaded });
  React.useEffect(()=>PREFS_STORE.sub(()=>setV({ prefs: PREFS_STORE.prefs, loaded: PREFS_STORE.loaded })),[]);
  return v;
};

// ── CONVERSATION RECENCY ──────────────────────────────────────
// Conversations carry TWO time fields and they do different jobs:
//   m.t   — display string, "HH:MM", what the operator reads in the row.
//   m.ts  — epoch milliseconds, the ONLY thing that may decide sort order.
//
// These helpers exist because m.t used to be doing both jobs, which is
// unsortable: "HH:MM" has no date, so yesterday's 23:58 outranked today's
// 00:04, and any row whose stamp wasn't HH:MM (empty, a date, a locale
// with AM/PM) parsed to nothing and sank to the bottom of the inbox.

// Display stamp for "now" — unchanged behaviour, hoisted so every writer
// formats identically instead of re-deriving the same toLocaleTimeString.
const convStamp = (d) => (d || new Date())
  .toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit', hour12:false});

// Best available epoch-ms for a conversation row coming out of the DB.
// Preference order, most trustworthy first:
//   1. updated_ts  — UNIX_TIMESTAMP(updated_at) from MySQL. Unambiguous.
//   2. updated_at  — datetime string. MySQL hands these back in the session
//                    timezone with no offset, so it's parsed as UTC; that's
//                    the correct read for a TIMESTAMP column on a default
//                    (UTC) session and is only ever off by a fixed amount,
//                    which preserves relative order either way.
//   3. last_t      — the "HH:MM" display stamp, resolved against today.
const convTsFromRow = (r) => {
  if (!r) return 0;
  const unix = Number(r.updated_ts);
  if (Number.isFinite(unix) && unix > 0) return unix * 1000;
  if (r.updated_at) {
    const parsed = Date.parse(String(r.updated_at).replace(' ', 'T') + 'Z');
    if (Number.isFinite(parsed)) return parsed;
  }
  return clockToTs(r.last_t);
};

// Resolve a bare "HH:MM" stamp into epoch-ms against today's date. A stamp
// that lands in the future is read as yesterday's — that's the midnight
// rollover case, where a 23:58 stamp seen at 00:04 belongs to the previous
// day rather than 24 hours from now. Returns 0 when unparseable so the row
// sorts as "oldest" rather than "newest".
const clockToTs = (stamp) => {
  const r = /^(\d{1,2}):(\d{2})/.exec(String(stamp || ''));
  if (!r) return 0;
  const d = new Date();
  d.setHours(+r[1], +r[2], 0, 0);
  let v = d.getTime();
  if (v > Date.now() + 60000) v -= 86400000;   // stamp is from yesterday
  return v;
};

// ── EVERY SEND IS TRACKED ─────────────────────────────────────────────
// Operator sends always carried a request id (reqId) so the host's sendOk /
// sendError could be matched to the exact bubble. Automated sends — AI
// replies, invoices, payment confirmations, deliveries, ghost messages —
// went through BotBridge.sendMessage / sendMedia with no id at all, so when
// one failed (offline, peer not cached, flood wait) nothing noticed: the row
// stayed in the database as something the agent had said, and the next
// reply was built on a message the customer never received. That is how
// the agent came to believe it had already given an address it never sent.
//
// The bridge's two plain send calls are wrapped so every send gets a reqId,
// and the row recorded for it (onOutbound / onOutboundMedia, which may run
// just before or just after the send) is paired with that id by conversation
// + content. Nothing at the call sites changes.
const SEND_TAGS = {
  sent: [],      // { key, kind, sig, reqId, at }  — sends whose row has not appeared yet
  rows: [],      // { key, kind, sig, row, at }    — rows whose send has not happened yet
  early: {},     // reqId → error that arrived before its row was tagged
  WINDOW_MS: 30000,
  _sig(kind, v) {
    const t = String(v || '');
    if (kind === 'media') return t.length <= 256 ? t : t.length + ':' + t.slice(0, 96) + ':' + t.slice(-96);
    return t.replace(/\s+/g, ' ').trim();
  },
  _prune() {
    const cut = Date.now() - this.WINDOW_MS;
    this.sent = this.sent.filter(x => x.at > cut);
    this.rows = this.rows.filter(x => x.at > cut && !x.row._req);
  },
  noteSend(platform, chatId, kind, value, reqId) {
    this._prune();
    const key = (platform || 'telegram') + '_' + String(chatId || '');
    const sig = this._sig(kind, value);
    const i = this.rows.findIndex(x => x.key === key && x.kind === kind && x.sig === sig);
    if (i >= 0) { const x = this.rows.splice(i, 1)[0]; this._tag(key, x.row, reqId); return; }
    this.sent.push({ key, kind, sig, reqId, at: Date.now() });
  },
  claim(convId, row, kind, value) {
    this._prune();
    const sig = this._sig(kind, value);
    const i = this.sent.findIndex(x => x.key === convId && x.kind === kind && x.sig === sig);
    if (i >= 0) { const x = this.sent.splice(i, 1)[0]; this._tag(convId, row, x.reqId); return; }
    this.rows.push({ key: convId, kind, sig, row, at: Date.now() });
  },
  _tag(key, row, reqId) {
    row._req = String(reqId);
    const err = this.early[row._req];
    if (err) {
      delete this.early[row._req];
      try { MSGS_STORE._markUndelivered(key, row, err.error); } catch (_) {}
    }
  },
  failed(reqId, d) { this.early[reqId] = d || {}; setTimeout(() => { delete this.early[reqId]; }, this.WINDOW_MS); },
};
(function wrapBridgeSends() {
  const b = (typeof window !== 'undefined') ? window.BotBridge : null;
  if (!b || b.__bcTagged || typeof b.send !== 'function') return;
  b.__bcTagged = true;
  const newReq = (t) => t + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  b.sendMessage = function (pl, c, t) {
    const reqId = newReq('a');
    try { SEND_TAGS.noteSend(pl, c, 'text', t, reqId); } catch (_) {}
    b.send('sendMessage', { platform: pl, chatId: c, text: t, reqId });
  };
  b.sendMedia = function (pl, c, url, caption, kind, fileName) {
    const reqId = newReq('a');
    try { SEND_TAGS.noteSend(pl, c, 'media', url, reqId); } catch (_) {}
    b.send('sendMedia', { platform: pl, chatId: c, mediaUrl: url, caption: caption || '',
                          mediaKind: kind || 'photo', fileName: fileName || '', reqId });
  };
})();

// ── BOT RELAY (see BOT RELAY in api.php) ──────────────────────────────
// Telegram bots (BotFather) and Discord bots answered by the server.
//   • In a browser (no desktop app) the server receives their messages and
//     its agent answers them. This page shows those chats live
//     (bot_relay_feed), and what you send from here — a reply you type, a
//     file, an edit, a delete — goes out through the server
//     (bot_relay_send) instead of the desktop host.
//   • In the desktop app, the page tells the server every 30s which bots it
//     is receiving for itself (bot_host_ping) and when it closes
//     (bot_host_away). The server only steps in while it's gone.
// A personal Telegram account (the User API) still needs the desktop app.
const BC_RELAY = {
  state: { telegram: { on: false }, discord: { on: false } },
  loaded: false,
  cursor: 0,
  subs: new Set(),
  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  notify() { this.subs.forEach(fn => { try { fn(); } catch (_) {} }); },
  inHost() { try { const b = window.BotBridge; return !!(b && typeof b.isWebView2 === 'function' && b.isWebView2()); } catch (_) { return false; } },
  // The server sends for this platform from this page: its bot is on and
  // no desktop app is running it right now.
  canSend(p) { const s = this.state[p]; return !!(s && s.on && !s.host); },
  _apply(relays) {
    if (!relays) return;
    this.state = { telegram: relays.telegram || { on: false }, discord: relays.discord || { on: false } };
    this.loaded = true;
    // In a browser nothing else reports the connection, so the server's
    // word is it (Settings, the inbox and the chat header read CONN_STORE).
    if (!this.inHost() && typeof CONN_STORE !== 'undefined') {
      ['telegram', 'discord'].forEach(p => {
        const s = this.state[p] || {};
        const cur = CONN_STORE[p] || {};
        const next = { connected: !!s.on && !s.error, via: s.on ? 'server' : '', botName: s.bot_name || '',
                       username: s.username || '', botId: s.bot_id || '', error: s.on ? (s.error || '') : '' };
        if (Object.keys(next).some(k => (cur[k] || '') !== (next[k] || ''))) CONN_STORE.set(p, next);
      });
    }
    this.notify();
  },
  async refresh() {
    const r = await apiGet('bot_relay_status');
    if (r && r.relays) this._apply(r.relays);
    return r;
  },
  // Connect a bot to the server (checks the token with Telegram / Discord).
  async connect(p, token) {
    const r = await apiFetch('bot_relay_connect', { platform: p, token: token || '' });
    if (r && r.relays) this._apply(r.relays);
    if (r && r.ok) this._schedule(300);
    return r;
  },
  async disconnect(p) {
    const r = await apiFetch('bot_relay_disconnect', { platform: p });
    if (r && r.relays) this._apply(r.relays);
    return r;
  },

  // ── Sends from this page when there's no desktop app ──
  // Answers with the same events the desktop host would (sendOk,
  // sendError, editResult, deleteResult). true = handled here.
  ACTIONS: ['sendMessage', 'sendMedia', 'sendChatAction', 'editMessage', 'deleteMessages'],
  route(action, payload) {
    if (this.inHost() || this.ACTIONS.indexOf(action) < 0) return false;
    const pl = payload || {};
    const p = pl.platform;
    if (p !== 'telegram' && p !== 'discord') return false;
    const fire = (event, data) => { try { window.dispatchEvent(new CustomEvent('bcEvent', { detail: { event, data } })); } catch (_) {} };
    const fail = (error) => {
      if (action === 'sendMessage' || action === 'sendMedia') fire('sendError', { platform: p, chatId: pl.chatId, error, reqId: pl.reqId || '', text: pl.text || pl.caption || '' });
      else if (action === 'editMessage') fire('editResult', { platform: p, chatId: pl.chatId, messageId: pl.messageId, reqId: pl.reqId || '', ok: false, error, text: pl.text || '' });
      else if (action === 'deleteMessages') fire('deleteResult', { platform: p, chatId: pl.chatId, messageIds: [], requested: pl.messageIds || [], reqId: pl.reqId || '', ok: false, error });
    };
    if (!this.canSend(p)) {
      if (action !== 'sendChatAction') {
        fail(this.state[p] && this.state[p].host ? 'Your desktop app is running this bot right now. Send from there.'
                                                 : 'This bot isn’t connected. Connect it in Settings → Connections.');
      }
      return true;
    }
    apiFetch('bot_relay_send', { ...pl, op: action }).then(r => {
      if (r && r.event) fire(r.event, r.data);
      else if (action !== 'sendChatAction') fail((r && r.error) || 'Couldn’t reach the server.');
    });
    return true;
  },

  // ── The live view (browser) ──
  _timer: null, _busy: false, _ticking: false, _started: false, _inited: false,
  start() {
    if (this._started) return;
    this._started = true;
    if (this.inHost()) { this._startHost(); return; }
    this._schedule(400);
  },
  stop() {
    this._started = false;
    clearTimeout(this._timer); this._timer = null;
    clearInterval(this._hostTimer); this._hostTimer = null;
    if (this._unsubConn) { this._unsubConn(); this._unsubConn = null; }
    this.cursor = 0;
    this._inited = false;
    this.state = { telegram: { on: false }, discord: { on: false } };
    this.loaded = false;
    this.notify();
  },
  _schedule(ms) {
    clearTimeout(this._timer);
    if (!this._started || this.inHost()) return;
    this._timer = setTimeout(() => this._poll(), ms);
  },
  async _poll() {
    if (this._busy) { this._schedule(1000); return; }
    this._busy = true;
    let next = 30000;
    try {
      // The first call only learns where to start (the inbox has loaded
      // the history itself); after that, everything newer.
      const r = await apiFetch('bot_relay_feed', this._inited ? { since: this.cursor || 0 } : { init: 1 });
      if (r && r.ok) {
        this._apply(r.relays);
        if (this._inited) this._merge(r.conversations || [], r.messages || []);
        this._inited = true;
        this.cursor = Math.max(this.cursor, Number(r.cursor) || 0);
        const on = ['telegram', 'discord'].some(p => this.state[p] && this.state[p].on);
        next = on ? (document.hidden ? 15000 : 4000) : 30000;
        // No background worker on this server right now: this page runs
        // the reply that's due (the server does the work, in this request).
        if (r.due) this._tick();
      }
    } catch (_) {}
    finally { this._busy = false; this._schedule(next); }
  },
  _tick() {
    if (this._ticking) return;
    this._ticking = true;
    apiFetch('bot_relay_tick', { run: 1 }).catch(() => {}).finally(() => { this._ticking = false; this._schedule(600); });
  },
  // New rows from the server into the inbox and any open thread.
  _merge(convRows, msgs) {
    if (typeof MSGS_STORE === 'undefined' || (!convRows.length && !msgs.length)) return;
    const S = MSGS_STORE;
    const before = new Set(S.list.map(c => c.id));
    const touched = new Set();
    convRows.forEach(r => {
      const ex = S.list.find(c => c.id === r.id);
      if (!ex) {
        S.load([r]);
        try { BC_NOTIFY.fire('newChat', { title: 'New conversation', body: `${r.name || 'Someone'}: ${r.last_msg || ''}`, convId: r.id }); } catch (_) {}
      } else {
        if (r.name) ex.name = r.name;
        if (r.handle) ex.handle = r.handle;
        if (r.avatar) ex.avatar = r.avatar;
        ex.last = r.last_msg; ex.t = r.last_t; ex.ts = convTsFromRow(r);
        ex.auto_reply = parseInt(r.auto_reply) === 1;
        ex.agent_id = r.agent_id ? parseInt(r.agent_id) : null;
        if (r.agent) ex.agent = r.agent;
        // Its place on the list (a sale made it a customer; the agent
        // handed it to you) as the server has it, and a heads-up for the
        // hand-over, as a chat answered here would give.
        if (r.stage) ex.stage = r.stage;
        const wasEsc = !!ex.escalated;
        ex.escalated = !!r.escalated;
        ex.escalation = r.escalation || null;
        if (ex.escalated && !wasEsc) {
          try { BC_NOTIFY.fire('handover', { title: `Needs you: ${ex.name || 'customer'}`,
            body: (r.escalation && (r.escalation.reason || r.escalation.message)) || 'The agent handed this chat to you', convId: r.id }); } catch (_) {}
        }
      }
      touched.add(r.id);
    });
    msgs.forEach(m => {
      const key = m.conv_id;
      const conv = S.list.find(c => c.id === key);
      const th = S.threads[key];
      if (th) {
        // Already here: the same server row, the same platform message, or
        // a bubble this page sent a moment ago (its save may not have
        // landed yet, so it has no id to match).
        const hit = th.find(x => (x.id && Number(x.id) === m.id) || (m.uid && x.uid === m.uid)
          || (m.r !== 'in' && x.r === m.r && !x.id && (x.c || '') === (m.c || '') && Math.abs((x.ts || 0) - m.ts) < 120000));
        if (hit) { if (!hit.id) hit.id = m.id; if (m.uid && !hit.uid) hit.uid = m.uid; }
        else {
          const row = { ...m };
          delete row.conv_id;
          if (!row.err) delete row.err;
          th.push(row);
        }
      }
      if (m.r === 'in' && conv && before.has(key)) {
        const open = S.activeConvId === key;
        if (!open) {
          conv.unread = (conv.unread || 0) + 1;
          try { BC_NOTIFY.fire('newMessage', { title: conv.name || 'New message', body: m.c || (m.mn ? '📎 ' + m.mn : 'New message'), convId: key }); } catch (_) {}
        }
      }
    });
    if (touched.size) {
      const top = S.list.filter(c => touched.has(c.id)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      S.list = [...top, ...S.list.filter(c => !touched.has(c.id))];
    }
    touched.forEach(id => { if (S.threads[id]) S.threads[id] = [...S.threads[id]]; });
    S.notify();
  },

  // ── The desktop app's side ──
  _hostTimer: null, _unsubConn: null,
  _startHost() {
    const ping = () => {
      if (!AUTH_STORE.account || typeof CONN_STORE === 'undefined') return;
      const c = (p) => {
        const s = CONN_STORE[p] || {};
        // Telegram through your own account (User API) isn't a bot the
        // server can run; the host says which one is connected.
        const userApi = p === 'telegram' && (s.mode ? s.mode === 'user' : !String(CRED_STORE.get('tg_bot_token') || '').trim());
        return { connected: !!s.connected, bot_id: s.botId || '', bot_name: s.botName || '', username: s.username || '', user_api: userApi };
      };
      apiFetch('bot_host_ping', { telegram: c('telegram'), discord: c('discord') }).then(r => { if (r && r.relays) this._apply(r.relays); });
    };
    this._hostTimer = setInterval(ping, 30000);
    setTimeout(ping, 1500);
    // A change is told a moment later: a bot connected just now had its
    // token saved a moment before, and the server needs it to take over.
    let last = '', soon = null;
    this._unsubConn = CONN_STORE.sub(() => {
      const k = ['telegram', 'discord'].map(p => (CONN_STORE[p] && CONN_STORE[p].connected) ? 1 : 0).join('');
      if (k !== last) { last = k; clearTimeout(soon); soon = setTimeout(ping, 1200); }
    });
  },
  // The desktop app is closing: the server takes its bots over now.
  hostAway() {
    if (!this.inHost() || !this._started) return Promise.resolve();
    try {
      return fetch(`${API}?action=bot_host_away`, { method: 'POST', keepalive: true, credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bot_host_away' }) }).catch(() => {});
    } catch (_) { return Promise.resolve(); }
  },
};
const useRelay = () => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => BC_RELAY.sub(force), []);
  return BC_RELAY;
};
// Every send the page asks of the desktop host goes through BotBridge.send.
// Without the host, the ones the server can do go there instead.
(function relayBridgeSends() {
  const b = (typeof window !== 'undefined') ? window.BotBridge : null;
  if (!b || b.__bcRelay || typeof b.send !== 'function') return;
  b.__bcRelay = true;
  const orig = b.send;
  b.send = function (action, payload) {
    try { if (BC_RELAY.route(action, payload)) return; } catch (_) {}
    return orig.call(b, action, payload);
  };
})();

// ── Notifications ─────────────────────────────────────────────────
// What Preferences → Notifications actually controls. Events are raised
// from the places they happen (new chats and messages in MSGS_STORE,
// hand-overs and agent errors in the reply engine, paid invoices in
// PAYMENTS_STORE) through BC_NOTIFY.fire(kind, …). Each alert can play a
// short chime and, where the browser allows it, show a desktop
// notification. Settings live in this browser (localStorage).
const BC_NOTIFY = {
  KEY: 'bc.notify.v1',
  defaults: {
    handover: true, newChat: true, newMessage: false, payment: true, aiError: true,
    sound: true, desktop: false, onlyAway: true,
  },
  _subs: new Set(),
  _last: new Map(),
  _ctx: null,
  get() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(this.KEY) || 'null');
      return {...this.defaults, ...(raw && typeof raw === 'object' ? raw : {})};
    } catch (_) { return {...this.defaults}; }
  },
  set(patch) {
    const next = {...this.get(), ...patch};
    try { window.localStorage.setItem(this.KEY, JSON.stringify(next)); } catch (_) {}
    this._subs.forEach(f => { try { f(next); } catch (_) {} });
    return next;
  },
  sub(f) { this._subs.add(f); return () => this._subs.delete(f); },
  desktopSupport() {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'none';
    return Notification.permission;   // 'default' | 'granted' | 'denied'
  },
  async askDesktop() {
    if (this.desktopSupport() === 'none') return 'none';
    try { return await Notification.requestPermission(); } catch (_) { return this.desktopSupport(); }
  },
  away() {
    try { return document.hidden || !document.hasFocus(); } catch (_) { return false; }
  },
  // Chime: two or three soft sine notes; each kind has its own shape so
  // they can be told apart without looking.
  chime(kind) {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      const ctx = this._ctx || (this._ctx = new C());
      if (ctx.state === 'suspended') ctx.resume();
      const notes = {
        handover:   [784, 1047, 784],
        payment:    [659, 880, 1319],
        aiError:    [392, 311],
        newChat:    [880, 1175],
        newMessage: [988],
      }[kind] || [880];
      const t0 = ctx.currentTime + 0.02;
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const s = t0 + i * 0.11;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.09, s + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.38);
        o.connect(g); g.connect(ctx.destination);
        o.start(s); o.stop(s + 0.42);
      });
    } catch (_) {}
  },
  fire(kind, {title = '', body = '', convId = ''} = {}) {
    const p = this.get();
    if (!p[kind]) return;
    // One alert per kind and chat every few seconds: a burst of messages
    // is one ping, not five.
    const k = kind + ':' + convId;
    const now = Date.now();
    if (now - (this._last.get(k) || 0) < 6000) return;
    this._last.set(k, now);
    const away = this.away();
    if (p.onlyAway && !away && kind !== 'handover') return;
    if (p.sound) this.chime(kind);
    if (p.desktop && away && this.desktopSupport() === 'granted') {
      try {
        const n = new Notification(title || 'BotCommand', {body: String(body || '').slice(0, 180), tag: k, silent: true});
        n.onclick = () => { try { window.focus(); n.close(); } catch (_) {} };
      } catch (_) {}
    }
  },
};
// Browsers only let sound play after the page has been clicked once.
if (typeof window !== 'undefined') {
  const warm = () => {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (C && !BC_NOTIFY._ctx) BC_NOTIFY._ctx = new C();
      if (BC_NOTIFY._ctx && BC_NOTIFY._ctx.state === 'suspended') BC_NOTIFY._ctx.resume();
    } catch (_) {}
    window.removeEventListener('pointerdown', warm, true);
  };
  window.addEventListener('pointerdown', warm, true);
}
const useNotifyPrefs = () => {
  const [p, setP] = React.useState(() => BC_NOTIFY.get());
  React.useEffect(() => BC_NOTIFY.sub(setP), []);
  return [p, (patch) => BC_NOTIFY.set(patch)];
};

const MSGS_STORE = {
  list: [],
  threads: {},   // conv_id → [{r,c,t,mt,mu}]
  // Operator-only audit log, NEVER sent to the customer or persisted to
  // the conversation history DB. Keyed by conv_id; each entry is
  // {t,c} (timestamp, content). Used for license-issued notes,
  // post-payment delivery summaries, and other internal diagnostics
  // that the operator needs visibility on but the customer / LLM must
  // not see. Without this, internal notes were leaking into the
  // visible chat AND being saved to bc_messages, which then poisoned
  // the LLM history on subsequent ai_reply calls (the model saw weird
  // "✓ License auto-issued" lines and tried to converse around them).
  auditLog: {},     // conv_id → [{t,c}]
  activeConvId: null,  // currently-open conversation; suppresses unread bumps
  subs: new Set(),
  // One snapshot per notify, shared by every subscriber. It used to copy the
  // whole conversation list once PER subscriber on every store event. Each
  // subscriber is isolated so one throwing listener can't starve the rest
  // (which previously left parts of the UI silently stale).
  notify() {
    const snap = this.list.slice();
    this.subs.forEach(fn => {
      try { fn(snap); } catch (e) { console.error('[msgs] subscriber threw', e); }
    });
  },
  sub(fn)  { this.subs.add(fn); return ()=>this.subs.delete(fn); },
  setActive(id) { this.activeConvId = id; },
  // Append an internal-only audit log entry for the operator. Visible
  // only via getAudit() / future Audit panel UI; never goes to the
  // customer, never goes to the LLM history, never saved server-side.
  pushAudit(convId, content) {
    if (!convId || !content) return;
    if (!this.auditLog[convId]) this.auditLog[convId] = [];
    this.auditLog[convId].push({ t: Date.now(), c: String(content) });
    // Keep last 200 per conv so we don't grow forever during a long session.
    if (this.auditLog[convId].length > 200) {
      this.auditLog[convId] = this.auditLog[convId].slice(-200);
    }
    // Mirror to the JS console so it's still grep-able in the .NET
    // output window even before any audit-panel UI exists.
    console.log('[audit]', convId, '·', content);
  },
  getAudit(convId) {
    return Array.isArray(this.auditLog[convId]) ? this.auditLog[convId] : [];
  },

  // Called once at startup to populate from DB.
  // MERGES with anything already in memory rather than wiping it (avoids
  // race where a message arrived before the conversations API resolved).
  load(rows) {
    const seen = new Set(this.list.map(m=>m.id));
    const fromDb = rows.map(r=>({
      id: r.id, chatId: r.chat_id, p: r.platform,
      name: r.name, handle: r.handle, avatar: r.avatar||'',
      chatType: r.chat_type||'private',
      col: r.col,
      stage: r.stage, last: r.last_msg, t: r.last_t,
      // Real sort key. The `t` field above is a DISPLAY string ("HH:MM") and
      // must never be used for ordering — it has no date component, so a
      // 23:58 message from last week outranks a 00:04 message from today.
      // `updated_ts` is UNIX_TIMESTAMP(updated_at) straight from MySQL, so
      // it needs no timezone guessing. Older servers that don't send it fall
      // back to parsing updated_at, then to the HH:MM stamp.
      ts: convTsFromRow(r),
      // Why the AI stepped back, when it wasn't the operator's doing. Empty
      // whenever an agent is assigned.
      unassignReason: r.unassign_reason || '',
      // When that happened (epoch ms, server clock), so the chat can put the
      // notice where it happened instead of pinning it to the foot.
      unassignAt: r.unassigned_ts ? (Number(r.unassigned_ts) * 1000 || 0) : 0,
      _unassignAtLocal: false,
      // ── THE OPERATOR'S DECISION SURVIVES A RESTART ──────────────
      // `_operatorOverride` used to exist only in memory. After a restart
      // it was gone, so the next inbound's backfill in onIncoming() saw a
      // conversation with no agent, decided that must be an oversight, and
      // re-assigned the default agent with auto_reply on — reviving a
      // conversation a post-sale stop (or the operator) had deliberately
      // handed back to a human. The server now persists the flag; we read
      // it here so the backfill makes the same decision it would have made
      // before the restart.
      _operatorOverride: !!(parseInt(r.operator_override)||0),
      // When an operator last put an agent BACK on. Non-null means a
      // post-sale stop on this conversation has been deliberately lifted,
      // so read receipts and replies behave normally again until the next
      // sale. Stored as epoch ms; the server keeps the authoritative copy.
      postSaleResumeAt: r.post_sale_resume_at ? (Date.parse(String(r.post_sale_resume_at).replace(' ', 'T')) || Date.now()) : null,
      ai: r.ai_status, agent: r.agent, unread: parseInt(r.unread)||0,
      agent_id: r.agent_id ? parseInt(r.agent_id) : null,
      auto_reply: parseInt(r.auto_reply)===1,
      memSummary: r.mem_summary || '',
      // Escalation flags surfaced by get_conversations. Decoded server-side
      // so the inbox row carries a structured object (or null) plus a quick
      // boolean for the filter.
      escalated:  !!r.escalated,
      escalation: r.escalation || null,
      // Post-sale setup (username / account help) state — see
      // POST_SALE_ONBOARDING. Server-authoritative; survives a restart.
      onboarding: (() => {
        const v = r.post_sale_onboarding;
        if (!v) return null;
        if (typeof v === 'object') return v;
        try { const o = JSON.parse(v); return (o && typeof o === 'object') ? o : null; } catch (_) { return null; }
      })(),
    }));
    // In-memory entries first (newer), then DB entries we haven't seen yet
    const merged = [...this.list];
    fromDb.forEach(d=>{ if(!seen.has(d.id)) merged.push(d); });
    this.list = merged;
    // Marks that the saved conversation list has arrived at least once, so
    // onIncoming can tell a genuinely new contact from one that merely
    // hadn't been loaded yet (see the bc:inbound signal below).
    this._loadedOnce = true;
    this.notify();
  },

  // Called when a real message comes in from .NET
  onIncoming(entry) {
    // Auth gate: if no operator is signed in, persisting is impossible (every
    // API call would 401 and just spam the log). We still update the local
    // in-memory list so the unread badge reflects reality, but we skip every
    // network call. The next sign-in will reload from .NET history if needed.
    if (!AUTH_STORE.account) {
      console.warn('[ai] inbound dropped — no operator signed in. Sign in to start handling messages.');
      return;
    }
    const platform = entry.platform || 'telegram';
    const chatId   = String(entry.chatId || '');
    if (!chatId) return;
    const key = platform + '_' + chatId;

    // Block gate — operator has explicitly blocked this user. We drop the
    // inbound entirely (no DB write, no list update, no unread bump). The
    // platform-side block (Telegram User API) should already have stopped
    // the message reaching us, but for Bot API / Discord where we can't
    // enforce server-side this is the only barrier.
    if (BLOCK_STORE.isBlocked(key)) {
      console.log('[block] dropped inbound from blocked user:', key);
      return;
    }

    // Inbound-preferences gate — per-platform chat-type filter, contacts-only
    // allowlist, and the persistent block list (Settings → Preferences →
    // Filters). Dropped here at the JS boundary so neither the operator's
    // inbox NOR the AI agent ever sees filtered traffic.
    try {
      if (typeof PREFS_STORE !== 'undefined' && PREFS_STORE.loaded) {
        const known = !!this.list.find(m => m.id === key);
        const verdict = PREFS_STORE.evaluateInbound({
          platform,
          chatType: entry.chatType || 'private',
          handle: entry.handle,
          chatId,
          known,
        });
        if (!verdict.ok) {
          console.log('[prefs] dropped inbound (' + verdict.reason + '):', key);
          return;
        }
      }
    } catch (e) { console.warn('[prefs] inbound gate threw', e && e.message); }

    const now = convStamp();
    // The host labels attachment messages "[Photo]" / "[Document]" so they
    // are never blank in the inbox. Once the file itself is attached that
    // label is just noise sitting under the image, so it comes off the
    // bubble — but it stays as the conversation-list preview, where there
    // is no thumbnail to speak for the message.
    // The file chip (or picture) now speaks for the attachment in every
    // state — ready, still downloading, or unavailable — so the host's
    // "[Document]" label comes off whenever the message carries one.
    const rawText  = entry.text || '';
    const label    = entry.mediaType ? `[${entry.mediaType}]` : '';
    const fileName = String(entry.fileName || '');
    const hasFile  = !!(entry.mediaUrl || entry.mediaPending || entry.mediaError || fileName);
    const text     = (entry.mediaType && hasFile)
      ? rawText.replace(MEDIA_LABEL_RE, '').trim()
      : (rawText || label);
    const preview  = text || (fileName ? '📎 ' + fileName : label) || rawText;
    // Extra attachments of one Discord message arrive as parts 1..n. They
    // are bubbles, not new messages: no unread bump, no AI turn.
    const part     = Number(entry.part) || 0;
    const existing = this.list.find(m=>m.id===key);
    const isOpen = this.activeConvId === key;
    // Mention/reply flags forwarded by the .NET bridge. Default false so an
    // older bridge that doesn't set them still works (treated as "not addressed").
    const mentioned   = !!entry.mentioned;
    const replyToBot  = !!entry.replyToBot;
    const chatType    = entry.chatType || 'private';

    let conv;
    if (existing) {
      // Refresh name/handle/avatar in case the user updated their profile.
      if (entry.name)   existing.name   = entry.name;
      if (entry.handle) existing.handle = entry.handle;
      if (entry.avatar) existing.avatar = entry.avatar;
      if (entry.chatType) existing.chatType = entry.chatType;
      existing.last   = preview;
      existing.t      = now;
      existing.ts     = Date.now();
      if (!isOpen && part === 0) existing.unread = (existing.unread||0) + 1;

      // Backfill agent + auto_reply if this conversation predates the
      // AI pipeline (existing rows came back with auto_reply=0 from
      // older saves). If we have an active agent and the conversation
      // has no agent assigned yet, adopt the active agent's defaults.
      //
      // BUGFIX (operator override): if the operator has explicitly
      // unassigned the agent or turned auto_reply off via the chat
      // header, we MUST NOT silently revert that choice on the next
      // inbound. Without this guard, hitting "disable AI" or
      // "unassign agent" appeared to work — until the customer's next
      // message triggered a backfill that re-assigned the default
      // agent and re-enabled auto_reply, and the AI started replying
      // again. The `_operatorOverride` flag is set by ConvAiControls /
      // the topbar AI chip whenever the operator deliberately changes
      // these values.
      //
      // Cross-session note: there used to be a second backfill branch
      // here that re-enabled auto_reply whenever an assigned conv had
      // it off. That was meant to recover from an AGENTS_STORE load
      // race, but the new-conv branch below already handles that race
      // with `agentsReady` + the `onceLoaded` callback. The second
      // branch was duplicative AND it silently re-enabled AI for
      // conversations the operator had deliberately paused before
      // restart. Removed.
      const defAgent = AGENTS_STORE.defaultActive();
      if (existing._operatorOverride) {
        // Operator has spoken — leave agent_id and auto_reply alone.
      } else if (defAgent && !existing.agent_id) {
        existing.agent_id  = defAgent.id;
        existing.agent     = defAgent.name;
        existing.auto_reply = !!defAgent.autoReply;
        apiFetch('assign_agent',   { id: existing.id, agent_id: defAgent.id });
        apiFetch('set_auto_reply', { id: existing.id, on: defAgent.autoReply ? 1 : 0 });
      }

      // Move to top
      this.list = [existing, ...this.list.filter(m=>m.id!==key)];
      conv = existing;
      if (!isOpen && part === 0) {
        BC_NOTIFY.fire('newMessage', {title: existing.name || 'New message', body: preview, convId: key});
      }
    } else {
      const col = ['#7c6ef5','#5ba3e8','#43c98a','#e8a844','#e87070','#9b7ff0','#3ec9d6','#e060c0','#8dc94a','#e8883a'][this.list.length%10];
      // Default new conversations to whichever agent is "active" right now,
      // with auto_reply mirroring that agent's auto_reply_default.
      // ── RACE FIX ──────────────────────────────────────────────
      // If AGENTS_STORE hasn't finished loading yet (very first inbound
      // can land before get_agents resolves) defAgent is null → the conv
      // would otherwise be locked with agent_id=null, auto_reply=false
      // and the AI would never fire even after agents loaded. We now
      // optimistically default auto_reply=true and queue a backfill that
      // runs the moment AGENTS_STORE.load() completes.
      const defAgent = AGENTS_STORE.defaultActive();
      const agentsReady = AGENTS_STORE.loaded && AGENTS_STORE.list.length > 0;
      conv = { id:key, chatId, p:platform,
        name: entry.name||entry.handle||'User',
        handle: entry.handle||chatId,
        avatar: entry.avatar||'',
        chatType: entry.chatType||'private',
        col, stage:'new', last:preview, t:now, ts:Date.now(), ai:'waiting',
        agent: (defAgent && defAgent.name) || 'Sales Bot',
        agent_id: (defAgent && defAgent.id) || null,
        auto_reply: agentsReady
          ? !!(defAgent && defAgent.autoReply)
          : true,    // optimistic — backfilled below once agents arrive
        unread: isOpen ? 0 : 1 };
      this.list = [conv, ...this.list];
      if (part === 0) BC_NOTIFY.fire('newChat', {title: 'New conversation', body: `${conv.name}: ${preview || ''}`, convId: key});

      if (!agentsReady) {
        console.warn('[ai] inbound arrived before AGENTS_STORE loaded — queuing backfill for', key);
        AGENTS_STORE.onceLoaded(()=>{
          const a = AGENTS_STORE.defaultActive();
          const c = MSGS_STORE.list.find(m=>m.id===key);
          if (!c) return;
          if (a && !c.agent_id) {
            c.agent_id = a.id; c.agent = a.name; c.auto_reply = !!a.autoReply;
            apiFetch('assign_agent',   { id:key, agent_id:a.id });
            apiFetch('set_auto_reply', { id:key, on: a.autoReply ? 1 : 0 });
            console.log('[ai] post-load backfill applied to', key, '→ agent=', a.name);
            MSGS_STORE.notify();
          } else if (!a) {
            // No agent at all — close the optimistic toggle so the server
            // doesn't reject ai_reply with "no agent configured" repeatedly.
            c.auto_reply = false;
            apiFetch('set_auto_reply', { id:key, on:0 });
            console.warn('[ai] no agents configured — auto_reply turned OFF for', key);
            MSGS_STORE.notify();
          }
        });
      }
    }
    // ── Signal for the dashboard ghost ──
    // One lightweight event per real inbound (extra attachment parts don't
    // count). The ghost uses it to perk up: a subtle surprise when a new
    // contact writes in, a quick glance towards the inbox for a known one.
    // isNew is only trusted once the saved list has loaded, otherwise every
    // message during start-up would look like a stranger.
    if (part === 0) {
      try {
        window.dispatchEvent(new CustomEvent('bc:inbound', { detail: {
          convId: key, platform,
          isNew: !existing && !!this._loadedOnce,
        } }));
      } catch (_) {}
    }
    // Persist conversation FIRST, then the message. Previously this was
    // fire-and-forget which let save_message race ahead — and even when that
    // race didn't bite, ai_reply (fired later) could land before the conv
    // row finished writing. The Conversation Not Found errors in the .NET
    // log traced back to exactly this. The await is cheap (one DB upsert)
    // and removes the race entirely.
    if (!this.threads[key]) this.threads[key] = [];
    // pid / uid are the platform's own identifiers for this message. They
    // were being dropped, which left nothing to match a late-arriving media
    // URL against — see patchMediaUrl below.
    const msgRow = { r:'in', c:text, t:now, ts: Date.now(), mt:entry.mediaType||'', mu:entry.mediaUrl||'',
                     pid: entry.id != null ? String(entry.id) : '', uid: entry.uid || '',
                     mn: fileName, ms: Number(entry.fileSize) || 0,
                     mp: !!entry.mediaPending && !entry.mediaUrl, me: entry.mediaError || '',
                     mentioned, replyToBot, _local: true };
    // ── The message this one quotes ──
    // Ids are numbered per API (bot vs user account), so the target's uid
    // is built with the same prefix as this message's own uid.
    if (entry.replyToId) {
      const rq = MSGS_STORE._buildQuote(key, chatId, entry.uid, String(entry.replyToId), {
        text: entry.replyText || '', fromSelf: !!entry.replyFromSelf,
      });
      if (rq) { msgRow.rt = rq.uid; msgRow.rq = rq; }
    }
    this.threads[key].push(msgRow);
    apiFetch('save_conversation', conv).then(async (convRes)=>{
      if (convRes && convRes.error) {
        console.error('[ai] save_conversation failed:', convRes.error, '— conv:', key, 'auth_required:', !!convRes.auth_required, 'reclaimable:', convRes.reclaimable, 'other_acc_id:', convRes.other_acc_id);
        // Cross-account conflict: the conv row exists but is owned by another
        // workspace. The server's auto-reclaim handles stale rows; this branch
        // catches the LIVE-other-workspace case. We surface a one-time toast
        // (via the global error log) so the operator knows to use the manual
        // takeover button rather than silently losing every message.
        if (/another workspace/i.test(convRes.error) && convRes.reclaimable === false) {
          if (!window.__convClaimWarned) window.__convClaimWarned = {};
          if (!window.__convClaimWarned[key]) {
            window.__convClaimWarned[key] = true;
            console.warn('[ai] conv', key, 'is owned by account', convRes.other_acc_id,
                         '— call apiFetch("force_claim_conversation",{id:"'+key+'"}) to take it over.');
          }
        }
        return;   // No point continuing — message + ai_reply would both 403.
      }
      // Backfill platform-supplied profile metadata onto bc_end_users so
      // the profile popup shows real avatars / bios / cover photos. Only
      // fields the host actually populated are sent (so we never clobber
      // an operator edit with an empty string). Fire-and-forget — a
      // failure here doesn't block the message pipeline.
      const meta = {};
      if (entry.avatar)   meta.avatar_url  = entry.avatar;
      if (entry.coverUrl) meta.cover_url   = entry.coverUrl;
      if (entry.bio)      meta.bio         = entry.bio;
      if (entry.status)   meta.status_text = entry.status;
      if (Object.keys(meta).length > 0) {
        apiFetch('upsert_end_user_meta', { conv_id: key, ...meta }).catch(()=>{});
      }
      // Inbound attachments arrive as base64 data URLs (the host downloads
      // the file and inlines it). Same ceiling as outbound: past the cap the
      // POST exceeds post_max_size and the whole save is rejected, which
      // would lose the message row, not just the picture. The full URL stays
      // in the in-memory thread either way.
      const inUrl = msgRow.mu || entry.mediaUrl || '';
      const keepUrl = (/^data:/i.test(inUrl) && inUrl.length > MEDIA_PERSIST_MAX) ? '' : inUrl;
      if (inUrl && !keepUrl) {
        console.warn('[media] inbound attachment too large to archive (' +
          Math.round(inUrl.length / 1024) + 'KB) — visible now, not after a reload');
      }
      return apiFetchDurable('save_message', {
        conv_id: key, role: 'in',
        content: (text || (keepUrl || fileName ? '' : label)),
        media_type: entry.mediaType||'', media_url: keepUrl,
        media_name: fileName,
        ts: now, msg_uid: entry.uid||'',
        mentioned: mentioned ? 1 : 0,
        reply_to_bot: replyToBot ? 1 : 0,
        reply_to_uid: msgRow.rt || '',
        reply_meta: msgRow.rq ? JSON.stringify(msgRow.rq) : '',
      });
    }).then((msgRes)=>{
      if (!msgRes) return;     // Bailed earlier — already logged.
      if (msgRes.error) {
        console.error('[ai] save_message failed:', msgRes.error, '— conv:', key, 'auth_required:', !!msgRes.auth_required);
        return;
      }
      // The server may have filled in a quote the page couldn't (the quoted
      // message wasn't loaded here).
      if (msgRes.rq && msgRow.rq && !msgRow.rq.c && (msgRes.rq.c || msgRes.rq.mt)) {
        msgRow.rq = { ...msgRow.rq, ...msgRes.rq };
        MSGS_STORE._bump(key);
      }
      // A media download finished while this row was being written.
      if (msgRow._lateMedia) {
        const lm = msgRow._lateMedia; delete msgRow._lateMedia;
        MSGS_STORE._persistMedia(key, msgRow, lm);
      }

      // The server row id. Notes, chapters and escalations are anchored to
      // message ids server-side; with it on the live bubble the chat places
      // them exactly, without waiting for a history reload.
      if (msgRes.id && Number(msgRes.id) > 0) msgRow.id = Number(msgRes.id);
      // Extra attachment parts are bubbles, not turns.
      if (part > 0) return;
      // Trigger the auto-reply pipeline AFTER the inbound is persisted, so the
      // server-side prompt builder reads the latest message in history.
      console.log('[ai] inbound saved', {key, chatType, mentioned, replyToBot,
        auto_reply: conv.auto_reply, agent_id: conv.agent_id});

      // Per-conversation kill switch wins over everything else.
      if (!conv.auto_reply) {
        console.warn('[ai] auto_reply OFF for this conversation — toggle the AI pill in the chat header to enable');
        return;
      }
      // Channel-scope gate: respects the agent's reply_private / reply_groups /
      // reply_channels / reply_only_if_mentioned settings. This is the layer
      // that fixes "the bot replies to every group it gets added to".
      const agent = (conv.agent_id ? AGENTS_STORE.byId(conv.agent_id) : null) || AGENTS_STORE.defaultActive();
      const gate = AI_REPLY_QUEUE.shouldReply(conv, agent, { mentioned, replyToBot });
      if (!gate.ok) {
        console.warn('[ai] skipped:', gate.reason, {chatType, mentioned, replyToBot});
        return;
      }
      AI_REPLY_QUEUE.enqueue(key);
    });

    // Realism: record this inbound for the burst-settle / "still typing"
    // detector AND nudge any in-flight draft to reconsider — if the bot is
    // currently sitting on a draft for this conv, the user has just changed
    // the context out from under it.
    if (part > 0) { this.notify(); return; }
    INBOUND_TRACKER.onInbound(key, entry.id);
    if (DRAFT_STORE.get(key)) {
      // Mark the draft as superseded; the engine loop notices on its next
      // tick (or the draft's own subscriber) and recycles back through the
      // LLM with the new context.
      DRAFT_STORE.markSuperseded(key);
    }
    this.notify();
  },

  // ── "THEY BOUGHT SOMETHING" ─────────────────────────────────
  // Mirrors conv_mark_customer() in api.php so the badge appears the
  // moment a payment confirms rather than waiting for the next full
  // conversations load. Same precedence rules, for the same reasons:
  // 'vip' is a higher tier and is never demoted to 'customer', and an
  // open escalation outranks both so a live problem can't be filed away
  // under Customers. The server re-applies this on its own authority —
  // this is purely so the operator sees it happen.
  // ── THE AI STEPPING BACK, ON THE RECORD ─────────────────────
  // Used when something automatic takes the agent off a conversation —
  // a post-sale stop, an escalation. Three things have to happen together
  // or the operator is left guessing:
  //
  //   the agent comes OFF (not merely muted, so the header pill shows
  //   nobody is covering this and offers to put someone back),
  //   auto_reply goes off with it (an assigned-but-silent agent is the
  //   confusing middle state this replaces),
  //   and the reason is recorded so the chat can say why.
  //
  // `_operatorOverride` is set so the next inbound's backfill doesn't
  // quietly re-assign the default agent and undo all of it — the same
  // guard the operator's own unassign uses.
  // Bumped every time the OPERATOR assigns an agent by hand. An automatic
  // unassign captures this before it starts and refuses to fire if it has
  // moved — see the guard below.
  _assignSeq: 0,
  noteOperatorAssign(){ this._assignSeq++; return this._assignSeq; },

  unassignAgent(convId, reason, opts){
    const m = this.list.find(x => x && x.id === convId);
    if (!m) return false;
    if (!m.agent_id && !m.agent) return false;   // already nobody's
    // ── THE OPERATOR WINS ────────────────────────────────────
    // The post-payment pipeline runs for minutes (paced confirmation,
    // delivery, wind-down) and the deferred escalation unassign lands at
    // the end of an AI turn. In both cases the operator may well have put
    // an agent back on in the meantime — and the unassign, arriving after,
    // would silently take it straight off again. The header would show
    // nobody assigned, auto-reply would be off, and the next customer
    // message would go unanswered with no visible cause. That is the
    // "I reassigned an agent and it never replied" report.
    //
    // Callers that may be delayed pass the assign-sequence they saw when
    // they decided to unassign. If it has moved, a human has since made a
    // decision about this conversation and it stands.
    if (opts && opts.seq != null && opts.seq !== this._assignSeq) {
      console.log('[agent] skipping automatic unassign of', convId,
        '— an agent was assigned by hand since this was decided');
      return false;
    }
    m.agent_id = null;
    m.agent = '';
    m.auto_reply = false;
    m._operatorOverride = true;
    m.unassignReason = String(reason || '');
    m.unassignAt = Date.now();
    m._unassignAtLocal = true;   // browser clock (see chat separators)
    // Coming off clears any earlier resume. The NEXT sale then stops the
    // agent exactly as the first one did, instead of a single re-assignment
    // buying the customer permanent immunity from stop-after-sale.
    m.postSaleResumeAt = null;
    // Any pending draft belonged to the agent that just left. Sending it
    // later would be a message from someone who is no longer on the chat.
    try { if (typeof DRAFT_STORE !== 'undefined' && DRAFT_STORE.get(convId)) DRAFT_STORE.discard(convId); } catch(_){}
    // `operator:1` tells the server this is a decision worth remembering,
    // so the inbound backfill can't undo it after a restart.
    try { apiFetch('assign_agent',  { id: convId, agent_id: null, reason: m.unassignReason, operator: 1 }); } catch(_){}
    try { apiFetch('set_auto_reply', { id: convId, on: 0 }); } catch(_){}
    this.list = [...this.list];
    this.notify();
    return true;
  },

  // ── PUTTING AN AGENT (BACK) ON ──────────────────────────────
  // The single path for every assignment and hand-unassignment the operator
  // makes, from any control in the app. It exists because there used to be
  // two of them — the chat header and the inbox pill — and they did
  // different amounts of work. The inbox one set agent_id and nothing else,
  // so it left auto_reply off, left an escalation pause in place, left a
  // queued automatic unassign armed, and left the engine's failure counters
  // where they were. The result was the reported bug: the header showed an
  // agent, the status dot sat red, and the customer's messages went
  // unanswered with nothing on screen to explain why.
  //
  // Everything that could keep a freshly-assigned agent silent is cleared
  // here, in one place, so no caller can forget a step:
  //
  //   auto_reply            on, in the same server call as the assignment
  //   post-sale stop        lifted server-side via resume:1
  //   escalation pause      cleared
  //   queued auto-unassign  disarmed (and _assignSeq bumped so one already
  //                         in flight stands down instead of firing later)
  //   spam cooldown         cleared
  //   engine retry state    failure budget, reconsider count, recovery timer
  //   stale draft           discarded — it came from the previous agent
  //   status dot            back to "waiting" from error/paused/off-hours
  //
  // Finally, if the customer is already sitting there waiting for an answer,
  // it answers now rather than making them send another message first.
  //
  // Returns a promise so callers can await the server round-trip; the local
  // state is updated synchronously either way.
  // `conv` may be the conversation id OR the row object itself. Callers in
  // the chat header hold a row that isn't always the same reference as the
  // one in `list` (pop-out windows, ghost-resolved contacts); mutating the
  // object they actually render keeps the control responsive instead of
  // silently doing nothing.
  assignAgent(conv, agent, opts){
    const m = (conv && typeof conv === 'object')
      ? conv
      : this.list.find(x => x && x.id === conv);
    if (!m || !m.id) return Promise.resolve(false);
    const convId = m.id;
    const a = agent || null;
    const o = opts || {};
    // Keep the canonical row in step when the caller handed us a copy.
    const canon = this.list.find(x => x && x.id === convId);
    if (canon && canon !== m) {
      canon.agent_id = a ? a.id : null;
      canon.agent    = a ? a.name : '';
      canon.auto_reply = !!a;
      canon.unassignReason = '';
      canon.unassignAt = 0;
      canon._operatorOverride = true;
      canon.postSaleResumeAt = a ? Date.now() : null;
      if (a) {
        delete canon._escalationPaused;
        delete canon._unassignAfterTurn;
        delete canon._unassignAfterSeq;
      }
    }

    m.agent_id = a ? a.id : null;
    m.agent    = a ? a.name : '';
    // Assigning an agent implicitly enables AI for this conversation;
    // unassigning disables it so the operator takes full control.
    m.auto_reply = !!a;
    // Putting someone back on is the answer to whatever took the last agent
    // off, so the notice goes with it. Unassigning by hand carries no reason
    // — the operator knows why they did it, and inventing one would be noise.
    m.unassignReason = '';
    m.unassignAt = 0;
    // Operator-driven — block the inbound backfill from re-assigning the
    // default agent on the next customer message.
    m._operatorOverride = true;
    // Tell the store a human just made this call, so any automatic unassign
    // still in flight from a post-sale pipeline or an escalation stands down
    // instead of undoing it a moment later.
    this.noteOperatorAssign();

    if (a) {
      m.postSaleResumeAt = Date.now();
      delete m._escalationPaused;
      delete m._unassignAfterTurn;
      delete m._unassignAfterSeq;
      // A red dot after a re-assignment is the symptom operators actually
      // notice. These three states are all "the agent isn't going to answer",
      // and none of them survives a deliberate assignment.
      if (m.ai === 'error' || m.ai === 'paused' || m.ai === 'off_hours' || m.ai === 'throttled') {
        m.ai = 'waiting';
      }
      try { if (typeof SPAM_THROTTLE !== 'undefined') SPAM_THROTTLE.clear(convId); } catch(_){}
      try { if (typeof AI_REPLY_QUEUE !== 'undefined') AI_REPLY_QUEUE.clearConvState(convId); } catch(_){}
    } else {
      m.postSaleResumeAt = null;
    }

    try { if (typeof DRAFT_STORE !== 'undefined' && DRAFT_STORE.get(convId)) DRAFT_STORE.discard(convId); } catch(_){}
    this.list = [...this.list];
    this.notify();

    // `resume:1` is what lifts the post-sale stop server-side, and
    // `auto_reply:1` rides along in the same statement so the two can never
    // disagree. set_auto_reply still goes out for older servers that don't
    // understand the extra fields.
    const p = apiFetch('assign_agent', {
      id: convId,
      agent_id: a ? a.id : null,
      operator: 1,
      resume: a ? 1 : 0,
      auto_reply: a ? 1 : 0,
    });
    try { apiFetch('set_auto_reply', { id: convId, on: a ? 1 : 0 }); } catch(_){}

    // Wait for the assignment to land before asking for a reply. Firing the
    // reply first is a race the customer loses: ai_reply would read the row
    // as it was a moment ago — still post-sale-stopped — refuse, and turn
    // auto_reply straight back off.
    return Promise.resolve(p).catch(()=>null).then(()=>{
      if (!a || o.reply === false) return true;
      try {
        if (typeof AI_REPLY_QUEUE !== 'undefined' && AI_REPLY_QUEUE.resumeAfterAssign) {
          AI_REPLY_QUEUE.resumeAfterAssign(convId);
        }
      } catch (e) { console.warn('[agent] resume-after-assign failed', e && e.message); }
      return true;
    });
  },

  markCustomer(convId){
    const m = this.list.find(x => x && x.id === convId);
    if (!m) return false;
    const s = String(m.stage || '');
    if (s === 'customer' || s === 'vip' || s === 'escalated' || s === 'needs_help') return false;
    m.stage = 'customer';
    this.list = [...this.list];
    this.notify();
    return true;
  },

  onOutbound(convId, chatId, platform, text, opts) {
    // ── INTERNAL-ONLY ROUTING ──
    // When opts._internal=true, this is an operator-facing diagnostic
    // (license issued, delivery sent, partial-failure warning, etc.) —
    // it must NOT render in the customer-visible chat, must NOT be
    // saved as a message in bc_messages (which would corrupt the LLM
    // history on subsequent ai_reply calls), and must NOT trigger any
    // platform-side send. Route to the audit log instead and return.
    if (opts && opts._internal) {
      MSGS_STORE.pushAudit(convId, text);
      return;
    }
    const now = convStamp();
    if (!this.threads[convId]) this.threads[convId] = [];
    // Role defaults to 'out' (manual operator). When the AI engine sends,
    // it passes {role:'bot', agent:<name>} so the bubble renders with the
    // bot avatar + "AI · <agent>" label.
    const role  = (opts && opts.role)  || 'out';
    const agent = (opts && opts.agent) || '';
    const outRow = {r:role,c:text,t:now,ts: Date.now(),mt:'',mu:'',agent,_local:true};
    // Operator sends tag the row (reqId) so the platform's id for it can be
    // attached exactly; a reply carries the quote it was sent with.
    if (opts && opts.reqId) outRow._req = String(opts.reqId);
    else SEND_TAGS.claim(convId, outRow, 'text', text);
    if (opts && opts.reply && opts.reply.uid) { outRow.rt = opts.reply.uid; outRow.rq = opts.reply; }
    this.threads[convId].push(outRow);
    this._claimPendingAck(convId, outRow);
    const m = this.list.find(m=>m.id===convId);
    if (m) {
      m.unread = 0;
      m.last = (role === 'bot' ? 'AI: ' : 'You: ') + text;
      m.t = now;
      m.ts = Date.now();
      this.list = [m, ...this.list.filter(x=>x.id!==convId)];
    }
    // Operator (or auto-reply) outbound clears any active spam-throttle
    // cooldown — we want a manual operator nudge to give the customer a
    // fresh start rather than lingering on a stale silence.
    try { if (typeof SPAM_THROTTLE !== 'undefined') SPAM_THROTTLE.clear(convId); } catch(_){}
    // save_message updates last_msg server-side; no need for separate save_conversation
    const saved = apiFetchDurable('save_message', {
      conv_id: convId, role, content: text, ts: now, agent,
      reply_to_uid: outRow.rt || '',
      reply_meta: outRow.rq ? JSON.stringify(outRow.rq) : '',
    });
    this._trackSave(outRow, saved);
    this.notify();
  },

  // Persist an outbound media message (attachment from the AI). Kept separate
  // from onOutbound so the conversation last-message preview shows a sensible
  // label (e.g. "[image]") rather than the raw URL, and so the bubble renders
  // the image inline using the existing media_url thread renderer.
  onOutboundMedia(convId, chatId, platform, mediaUrl, caption, mediaType, opts) {
    // Same internal-routing guard as onOutbound. In current code this is
    // never called with _internal=true (media goes to customers, not the
    // operator), but keep the guard so future callers can't accidentally
    // leak gated media URLs into the audit-only path.
    if (opts && opts._internal) {
      MSGS_STORE.pushAudit(convId, '[media] ' + (caption || mediaUrl || ''));
      return;
    }
    const now = convStamp();
    if (!this.threads[convId]) this.threads[convId] = [];
    const mt = mediaType || 'image';
    const role  = (opts && opts.role)  || 'out';
    const agent = (opts && opts.agent) || '';
    const fname = (opts && opts.filename) || '';
    const mRow = {r:role, c: caption || '', t: now, ts: Date.now(), mt, mu: mediaUrl, mn: fname, agent, _local: true};
    if (opts && opts.reqId) mRow._req = String(opts.reqId);
    else SEND_TAGS.claim(convId, mRow, 'media', mediaUrl);
    if (opts && opts.reply && opts.reply.uid) { mRow.rt = opts.reply.uid; mRow.rq = opts.reply; }
    this.threads[convId].push(mRow);
    this._claimPendingAck(convId, mRow);
    const m = this.list.find(m=>m.id===convId);
    if (m) {
      const prefix = role === 'bot' ? 'AI' : 'You';
      m.last = caption ? `${prefix}: [${mt}] ${caption}` : `${prefix}: [${mt}]`;
      m.t = now;
      m.ts = Date.now();
      this.list = [m, ...this.list.filter(x=>x.id!==convId)];
    }
    // ── PERSISTENCE GUARD FOR INLINE data: URLs ──
    // Operator attachments arrive here as base64 data URLs. base64 inflates
    // the payload by ~33%, so a 6 MB video becomes an 8 MB POST body — past
    // the default post_max_size on most PHP hosts. api.php answers that with
    // a 413-shaped error and the ENTIRE save is lost, taking the caption and
    // the message row with it. So: anything past the cap is not sent to the
    // server verbatim.
    //   • images → persist the downscaled thumbnail the composer generated,
    //     so the bubble still has something to draw after a reload
    //   • everything else → persist no URL, and put a readable marker in
    //     content so the row isn't blank (and so the LLM history reads
    //     "operator sent BlackMail.zip" rather than an empty turn)
    // The full-resolution URL stays in this.threads for the session, and the
    // platform already has the real file — this only bounds what we archive.
    const MAX_PERSIST = (opts && opts.maxPersistChars) || 3500000;
    const isData  = /^data:/i.test(String(mediaUrl || ''));
    const thumb   = (opts && opts.thumbUrl) || '';
    let persistUrl = mediaUrl || '';
    if (isData && persistUrl.length > MAX_PERSIST) {
      persistUrl = (thumb && thumb.length <= MAX_PERSIST) ? thumb : '';
      if (!persistUrl) {
        console.warn('[media] attachment too large to archive (' +
          Math.round(mediaUrl.length / 1024) + 'KB) — sent to the customer, not stored:', fname || mt);
      }
    }
    const persistContent = persistUrl
      ? (caption || '')
      : (caption || ('[' + mt + (fname ? ' ' + fname : '') + ']'));
    const savedM = apiFetchDurable('save_message', {
      conv_id: convId, role,
      content: persistContent,
      media_type: mt, media_url: persistUrl,
      media_name: fname,
      ts: now, agent,
      reply_to_uid: mRow.rt || '',
      reply_meta: mRow.rq ? JSON.stringify(mRow.rq) : '',
    });
    this._trackSave(mRow, savedM);
    this.notify();
  },

  // Bumped whenever a message's media URL is patched in place. The thread
  // subscription in InPageChat fingerprints a conversation by length + last
  // timestamp + last message text, none of which change when a URL is
  // filled in on an existing row — so without this counter the store would
  // hold the right data and the open chat would never repaint.
  mediaRev: {},

  // ── LATE MEDIA URL ──
  // The .NET host posts an inbound message the moment it arrives, before it
  // knows the download URL, so the operator isn't left waiting on a file
  // server. It resolves the URL on a background task and forwards it on the
  // userProfileUpdate event a moment later.
  //
  // That second half was being thrown away: the userProfileUpdate handler
  // read avatar/bio/coverUrl and ignored mediaUrl entirely. The URL arrived,
  // was discarded, and every photo a customer sent stayed a bare "[Photo]"
  // placeholder for the life of the conversation.
  // ══════════════════════════════════════════════════════════════════
  // MESSAGE LIFECYCLE — platform identity, replies, edits, deletions
  // ══════════════════════════════════════════════════════════════════
  // Every message the platform knows about carries a uid of the form
  //   tg:<chat>:<id>    Telegram Bot API
  //   tgu:<chat>:<id>   Telegram User API (the operator's own account)
  //   dc:<chan>:<id>    Discord            (#n suffix = extra attachment)
  // Inbound rows get it on arrival; outbound rows get it when the desktop
  // host acknowledges the send (sendOk → onSendAck). It is what edit,
  // delete and reply events are matched against, and the prefix says which
  // API has to perform an edit or delete (a bot can't touch what the user
  // account sent, and the two number the same chat differently).

  parseUid(uid) {
    const m = /^(tgu|tg|dc):(-?\d+):(\d+)(?:#(\d+))?$/.exec(String(uid || ''));
    if (!m) return null;
    return { prefix: m[1], chat: m[2], pid: m[3], part: m[4] ? Number(m[4]) : 0,
             via: m[1] === 'tgu' ? 'user' : m[1] === 'tg' ? 'bot' : '' };
  },

  // What the operator may do with a bubble, given what the platform allows.
  capabilities(conv, row) {
    const none = { reply:false, edit:false, deleteEveryone:false, deleteLocal:false, copy:false };
    if (!conv || !row || conv.__ghost) return none;
    const ref  = this.parseUid(row.uid);
    const live = !row.del && !row._pending;
    const text = String(row.c || '').replace(MEDIA_LABEL_RE, '').trim();
    const mine = row.r !== 'in';
    const chatType = String(conv.chatType || 'private').toLowerCase();
    const dcServer = conv.p === 'discord' && (chatType === 'guild' || chatType === 'group');
    return {
      reply: !!ref && live,
      // Text and captions. A picture sent without a caption has nothing to
      // edit, and Discord can't add text to an attachment-only message.
      edit: !!ref && live && mine && !!text && ref.part === 0,
      // Telegram lets either side delete in private chats (bots: < 48 h).
      // Discord bots can delete their own messages anywhere, other people's
      // only in a server with Manage Messages — never in DMs.
      deleteEveryone: !!ref && live && (mine || conv.p === 'telegram' || dcServer),
      deleteLocal: !row._pending,
      copy: !!text,
    };
  },

  _bump(convId) {
    const t = this.threads[convId];
    if (t) this.threads[convId] = [...t];
    this.mediaRev[convId] = (this.mediaRev[convId] || 0) + 1;
    this.notify();
  },

  _trackSave(row, promise) {
    row._saved = Promise.resolve(promise).then(r => {
      if (r && !r.error && Number(r.id) > 0) row.id = Number(r.id);
      return row.id || 0;
    }).catch(() => row.id || 0);
  },

  // Run `fn(ref)` against the stored row once it exists server-side.
  _whenSaved(row, fn) {
    Promise.resolve(row._saved).then(() => {
      if (row.id) fn({ id: row.id });
      else if (this.parseUid(row.uid)) fn({ uid: row.uid });
    }).catch(() => {});
  },

  _clipQuote(s) {
    const t = String(s || '').replace(MEDIA_LABEL_RE, '').replace(/\s+/g, ' ').trim();
    return t.length > 280 ? t.slice(0, 279) + '…' : t;
  },

  // Quote snapshot for a row the operator is replying to.
  quoteOf(row) {
    if (!row) return null;
    return { uid: row.uid || '', pid: (this.parseUid(row.uid) || {}).pid || '',
             r: row.r, c: this._clipQuote(row.c), mt: row.mt || '' };
  },

  // Quote snapshot for an inbound reply, from what this page has loaded.
  _buildQuote(key, chatId, ownUid, replyToId, hint) {
    const own = this.parseUid(ownUid);
    const prefix = own ? own.prefix : (key.indexOf('discord_') === 0 ? 'dc' : 'tgu');
    const chat = own ? own.chat : chatId;
    const uid = `${prefix}:${chat}:${replyToId}`;
    const t = (this.threads[key] || []).find(m => m && m.uid === uid);
    return {
      uid, pid: String(replyToId),
      r: t ? t.r : ((hint && hint.fromSelf) ? 'out' : 'in'),
      c: this._clipQuote(t ? t.c : (hint && hint.text) || ''),
      mt: t ? (t.mt || '') : '',
    };
  },

  // Inbox preview follows the newest message that is still there.
  _refreshPreview(convId) {
    const conv = this.list.find(m => m.id === convId);
    if (!conv) return;
    const t = this.threads[convId] || [];
    for (let i = t.length - 1; i >= 0; i--) {
      const m = t[i];
      if (!m || m.del) continue;
      const body = String(m.c || '').replace(MEDIA_LABEL_RE, '').trim()
        || (m.mn ? '📎 ' + m.mn : (m.mt ? `[${m.mt}]` : ''));
      conv.last = m.r === 'bot' ? 'AI: ' + body : m.r === 'in' ? body : 'You: ' + body;
      return;
    }
    conv.last = '';
  },

  // ── Send acknowledgements ──────────────────────────────────────
  _pendingAcks: {},
  _norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); },
  _rowTakesAck(row, d) {
    if (!row || row.r === 'in' || !row._local || row._acked) return false;
    if (d.reqId) return row._req === String(d.reqId);
    if (row._req) return false;                  // waiting for its own tagged ack
    if (Date.now() - (row.ts || 0) > 15 * 60 * 1000) return false;
    const isMedia = d.kind === 'media';
    if (isMedia !== !!(row.mu || row.mt)) return false;
    return this._norm(isMedia ? String(row.c || '') : row.c) === this._norm(d.text);
  },
  onSendAck(d) {
    if (!d || !d.uid || !d.messageId || d.messageId === '0') return;
    const key = (d.platform || 'telegram') + '_' + String(d.chatId || '');
    const thread = this.threads[key] || [];
    // Oldest unacknowledged match first: sends are acknowledged in order.
    const row = thread.find(r => this._rowTakesAck(r, d));
    if (!row) {
      // The row can land a moment after the ack (a send path that records
      // the bubble after posting). Hold it briefly.
      const list = (this._pendingAcks[key] = (this._pendingAcks[key] || [])
        .filter(p => Date.now() - p.at < 60000));
      list.push({ d, at: Date.now() });
      return;
    }
    this._applyAck(key, row, d);
  },
  _claimPendingAck(convId, row) {
    const list = this._pendingAcks[convId];
    if (!list || !list.length) return;
    const i = list.findIndex(p => Date.now() - p.at < 60000 && this._rowTakesAck(row, p.d));
    if (i < 0) return;
    const p = list.splice(i, 1)[0];
    this._applyAck(convId, row, p.d);
  },
  _applyAck(key, row, d) {
    row.pid = String(d.messageId);
    row.uid = String(d.uid);
    row._acked = true;
    delete row.err;
    this._bump(key);
    this._whenSaved(row, ref => {
      if (ref.id) apiFetch('update_message', { conv_id: key, id: ref.id, new_uid: row.uid }).catch(() => {});
    });
  },
  onSendError(d) {
    if (!d) return;
    const key = (d.platform || 'telegram') + '_' + String(d.chatId || '');
    const thread = this.threads[key] || [];
    let row = null;
    if (d.reqId) row = thread.find(r => r && r._req === String(d.reqId));
    // An untagged failure (an older host build, or a send that never got a
    // tag): the newest un-acknowledged local outbound with the same text.
    if (!row && !d.reqId) {
      const want = this._norm(d.text || '');
      for (let i = thread.length - 1; i >= 0; i--) {
        const r = thread[i];
        if (!r || r.r === 'in' || !r._local || r._acked || r.err) continue;
        if (Date.now() - (r.ts || 0) > 5 * 60 * 1000) break;
        if (!want || this._norm(r.c) === want) { row = r; break; }
      }
    }
    if (!row) { if (d.reqId) SEND_TAGS.failed(String(d.reqId), d); return; }
    this._markUndelivered(key, row, d.error);
  },
  // A message that never reached the customer must not count as said. It
  // stays visible to the operator (marked), but the server leaves it out
  // of the agent's history, and the engine is told so it can answer again
  // once the platform is back instead of believing the customer has it.
  _markUndelivered(key, row, error) {
    if (!row || row.err) return;
    row.err = String(error || 'Not delivered');
    this._bump(key);
    this._whenSaved(row, ref => {
      apiFetchDurable('update_message', { conv_id: key, ...(ref.id ? { id: ref.id } : { uid: ref.uid }), send_failed: 1 });
    });
    if (row.r === 'bot') {
      try { if (typeof AI_REPLY_QUEUE !== 'undefined' && AI_REPLY_QUEUE.onDeliveryFailed) AI_REPLY_QUEUE.onDeliveryFailed(key, row); } catch (_) {}
    } else {
      bcToast('Message not delivered — ' + row.err, 'err');
    }
  },
  // Load the full history before the agent reasons about a conversation.
  // Resolves early (with whatever is cached) if the server is slow, so a
  // hung request can never hold a reply hostage.
  ensureHydrated(convId, maxWaitMs) {
    if (!convId || this._hydrated.has(convId)) return Promise.resolve(this.threads[convId] || []);
    return Promise.race([
      this.loadThread(convId),
      new Promise(r => setTimeout(() => r(this.threads[convId] || []), maxWaitMs || 6000)),
    ]);
  },

  // ── Attachments that finish downloading after the message ──────
  patchMediaUrl(convId, messageId, mediaUrl, uid, meta) {
    if (!mediaUrl) return false;
    const thread = this.threads[convId];
    if (!thread || !thread.length) return false;
    let row = null;
    if (uid) row = thread.find(m => m && m.r === 'in' && m.uid === uid);
    const want = (messageId === null || messageId === undefined) ? '' : String(messageId);
    if (!row && want) row = thread.find(m => m && m.r === 'in' && String(m.pid || '') === want && !m.mu);
    // No id on the event, or no match: take the newest inbound row that
    // announced media but never received a URL.
    if (!row && !uid) {
      for (let i = thread.length - 1; i >= 0; i--) {
        const m = thread[i];
        if (m && m.r === 'in' && m.mt && !m.mu) { row = m; break; }
      }
    }
    if (!row || row.mu === mediaUrl) return false;
    row.mu = mediaUrl; row.mp = false; row.me = '';
    if (meta && meta.name && !row.mn) row.mn = meta.name;
    this._bump(convId);
    this._persistMedia(convId, row, { url: mediaUrl, type: row.mt, name: row.mn });
    return true;
  },
  _persistMedia(convId, row, info) {
    const url = (/^data:/i.test(info.url) && info.url.length > MEDIA_PERSIST_MAX) ? '' : info.url;
    if (!url) return;
    const payload = { conv_id: convId, media_url: url, media_type: info.type || '', media_name: info.name || '' };
    if (row.id) { apiFetch('update_message', { ...payload, id: row.id }).catch(() => {}); return; }
    // The row's own save may still be in flight — retry when it lands.
    row._lateMedia = info;
    if (row.uid) apiFetch('update_message', { ...payload, uid: row.uid }).catch(() => {});
  },
  onMediaReady(d) {
    if (!d) return;
    const key = (d.platform || 'telegram') + '_' + String(d.chatId || '');
    if (d.ok && d.mediaUrl) {
      this.patchMediaUrl(key, d.messageId, d.mediaUrl, d.uid, { name: d.fileName });
      return;
    }
    const row = (this.threads[key] || []).find(m => m && m.uid === d.uid);
    if (row) { row.mp = false; row.me = d.error || 'Download failed'; this._bump(key); }
  },

  // ── Edits and deletions reported by the platform ───────────────
  _findByUid(key, uid, pidHint, isOut) {
    const t = this.threads[key] || [];
    let row = t.find(m => m && m.uid === uid);
    if (!row && pidHint) {
      row = t.find(m => m && String(m.pid || '') === String(pidHint) && !String(m.uid || '').includes('#')
        && (isOut === undefined || (isOut ? m.r !== 'in' : m.r === 'in')));
    }
    return row || null;
  },
  onRemoteEdit(d) {
    if (!d || !d.chatId) return;
    const key = (d.platform || 'telegram') + '_' + String(d.chatId);
    const conv = this.list.find(m => m.id === key);
    if (!conv) return;                               // not a chat we track
    const row = this._findByUid(key, d.uid, d.messageId, d.isOut);
    const newText = String(d.text || '');
    if (row) {
      const cur = String(row.c || '').replace(MEDIA_LABEL_RE, '').trim();
      if (cur === newText.trim() || row.del) return;  // reactions, previews
      if (!row.oc) row.oc = row.c;
      row.c = newText;
      row.ed = Date.now();
      this._bump(key);
      this._refreshPreview(key);
    }
    // Persist by uid even when the thread isn't loaded; the server keeps
    // the original text and ignores unchanged content.
    apiFetch('update_message', { conv_id: key, uid: d.uid, content: newText }).catch(() => {});
    // The agent may be drafting an answer to the old wording.
    if (!d.isOut) { try { if (DRAFT_STORE.get(key)) DRAFT_STORE.markSuperseded(key); } catch (_) {} }
  },
  onRemoteDelete(d) {
    if (!d || !Array.isArray(d.messageIds) || !d.messageIds.length) return;
    const platform = d.platform || 'telegram';
    const prefix = d.prefix || (platform === 'discord' ? 'dc' : 'tgu');
    const ids = new Set(d.messageIds.map(String));
    // Telegram's User API names no chat for private-chat deletions (ids are
    // unique per account there), so every Telegram thread is checked.
    const keys = d.chatId
      ? [platform + '_' + String(d.chatId)]
      : Object.keys(this.threads).filter(k => k.indexOf(platform + '_') === 0);
    const touched = [];
    keys.forEach(key => {
      const conv = this.list.find(m => m.id === key);
      if (!d.chatId && conv && /^(supergroup|channel)$/i.test(conv.chatType || '')) return;
      let hit = false;
      (this.threads[key] || []).forEach(m => {
        const ref = m && this.parseUid(m.uid);
        if (!ref || ref.prefix !== prefix || !ids.has(ref.pid) || m.del) return;
        if (d.chatId && ref.chat !== String(d.chatId)) return;
        m.del = Date.now(); hit = true;
      });
      if (hit) {
        touched.push(key);
        this._refreshPreview(key);
        this._bump(key);
        try { if (DRAFT_STORE.get(key)) DRAFT_STORE.markSuperseded(key); } catch (_) {}
      }
    });
    apiFetch('mark_messages_deleted', {
      platform, prefix, chat_id: d.chatId || '', ids: [...ids],
    }).catch(() => {});
  },

  // ── Operator actions: edit, delete ─────────────────────────────
  _ops: {},
  _newReq(tag) { return tag + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },

  editMessage(convId, row, newText) {
    const conv = this.list.find(m => m.id === convId);
    const ref = row && this.parseUid(row.uid);
    const text = String(newText || '').trim();
    if (!conv || !ref || !text) return false;
    if (text === String(row.c || '').replace(MEDIA_LABEL_RE, '').trim()) return false;
    const reqId = this._newReq('e');
    const prev = { c: row.c, ed: row.ed, oc: row.oc };
    if (!row.oc) row.oc = row.c;
    row.c = text; row.ed = Date.now(); row._pending = 'edit';
    this._bump(convId);
    this._refreshPreview(convId);
    const sent = bcBridgeSend('editMessage', {
      platform: conv.p, chatId: ref.chat, messageId: ref.pid, text, via: ref.via, reqId,
    });
    const op = { type: 'edit', key: convId, row, prev };
    this._ops[reqId] = op;
    op.timer = setTimeout(() => this.onEditResult({ reqId, ok: false,
      error: sent ? 'No response from the desktop app' : 'Desktop app not connected' }), sent ? 30000 : 0);
    return true;
  },
  onEditResult(d) {
    const op = d && this._ops[d.reqId];
    if (!op) return;
    delete this._ops[d.reqId];
    clearTimeout(op.timer);
    const row = op.row;
    row._pending = null;
    if (d.ok) {
      const payload = { conv_id: op.key, content: row.c };
      if (row.id) payload.id = row.id; else payload.uid = row.uid;
      apiFetch('update_message', payload).catch(() => {});
    } else {
      row.c = op.prev.c; row.ed = op.prev.ed; row.oc = op.prev.oc;
      bcToast('Couldn’t edit the message — ' + (d.error || 'unknown error'), 'err');
    }
    this._bump(op.key);
    this._refreshPreview(op.key);
  },

  // mode 'everyone' — delete on the platform, then here.
  // mode 'local'    — remove from this app (and the AI's memory) only.
  deleteMessages(convId, rows, mode) {
    const conv = this.list.find(m => m.id === convId);
    const list = (rows || []).filter(Boolean);
    if (!conv || !list.length) return false;
    if (mode !== 'everyone') {
      this._removeRows(convId, list);
      return true;
    }
    const ref = this.parseUid(list[0].uid);
    if (!ref) return false;
    // Every part of a multi-attachment message goes with it.
    const pids = new Set(list.map(r => (this.parseUid(r.uid) || {}).pid).filter(Boolean));
    const targets = (this.threads[convId] || []).filter(m => {
      const r = m && this.parseUid(m.uid);
      return r && r.prefix === ref.prefix && pids.has(r.pid);
    });
    targets.forEach(m => { m._pending = 'delete'; });
    this._bump(convId);
    const reqId = this._newReq('d');
    const sent = bcBridgeSend('deleteMessages', {
      platform: conv.p, chatId: ref.chat, messageIds: [...pids], via: ref.via, reqId,
    });
    const op = { type: 'delete', key: convId, rows: targets };
    this._ops[reqId] = op;
    op.timer = setTimeout(() => this.onDeleteResult({ reqId, ok: false, messageIds: [],
      error: sent ? 'No response from the desktop app' : 'Desktop app not connected' }), sent ? 30000 : 0);
    return true;
  },
  onDeleteResult(d) {
    const op = d && this._ops[d.reqId];
    if (!op) return;
    delete this._ops[d.reqId];
    clearTimeout(op.timer);
    const done = new Set((d.messageIds || []).map(String));
    const gone = [], kept = [];
    op.rows.forEach(m => {
      const r = this.parseUid(m.uid);
      if (r && done.has(r.pid)) gone.push(m); else { m._pending = null; kept.push(m); }
    });
    if (gone.length) this._removeRows(op.key, gone);
    else this._bump(op.key);
    if (kept.length) bcToast('Couldn’t delete for everyone — ' + (d.error || 'unknown error'), 'err');
  },
  _removeRows(convId, rows) {
    const drop = new Set(rows);
    const t = this.threads[convId] || [];
    this.threads[convId] = t.filter(m => !drop.has(m));
    rows.forEach(m => {
      const done = (ref) => apiFetch('delete_message', { conv_id: convId, ...ref }).catch(() => {});
      if (m.id) done({ id: m.id });
      else if (m._saved) this._whenSaved(m, done);
      else if (m.uid) done({ uid: m.uid });
    });
    this.mediaRev[convId] = (this.mediaRev[convId] || 0) + 1;
    this._refreshPreview(convId);
    this.list = [...this.list];
    this.notify();
  },

  // ── Removing a whole conversation ──────────────────────────────
  // One place that forgets a contact on this page. Announces it with
  // 'bc-conv-removed' so an open chat can close itself (with its exit
  // transition) and the Back history drops it.
  removeConversation(convId) {
    if (!convId) return;
    try { if (typeof PAYMENTS_STORE !== 'undefined' && PAYMENTS_STORE.clearForConv) PAYMENTS_STORE.clearForConv(convId); } catch (_) {}
    delete this.threads[convId];
    delete this.auditLog[convId];
    delete this.mediaRev[convId];
    delete this._pendingAcks[convId];
    this._hydrated.delete(convId);
    this._threadInflight.delete(convId);
    this._threadTried.delete(convId);
    this.list = this.list.filter(m => m.id !== convId);
    if (this.activeConvId === convId) this.activeConvId = null;
    const clr = (store, fn) => { try { if (typeof store !== 'undefined' && store && store[fn]) store[fn](convId); } catch (_) {} };
    try { if (typeof EU_CACHE           !== 'undefined') clr(EU_CACHE, 'clear'); } catch (_) {}
    try { if (typeof DRAFT_STORE        !== 'undefined') clr(DRAFT_STORE, 'discard'); } catch (_) {}
    try { if (typeof INPUT_DRAFTS       !== 'undefined') clr(INPUT_DRAFTS, 'clear'); } catch (_) {}
    try { if (typeof ATTACH_DRAFTS      !== 'undefined') clr(ATTACH_DRAFTS, 'delete'); } catch (_) {}
    try { if (typeof SPAM_THROTTLE      !== 'undefined') clr(SPAM_THROTTLE, 'clear'); } catch (_) {}
    try { if (typeof INBOUND_TRACKER    !== 'undefined') clr(INBOUND_TRACKER, 'clear'); } catch (_) {}
    try { if (typeof PRESENCE_SIMULATOR !== 'undefined') clr(PRESENCE_SIMULATOR, 'clear'); } catch (_) {}
    try { if (window.__bcEscResolvedNow) delete window.__bcEscResolvedNow[convId]; } catch (_) {}
    this.notify();
    try { window.dispatchEvent(new CustomEvent('bc-conv-removed', { detail: { convId } })); } catch (_) {}
  },

  markRead(convId) {
    const m = this.list.find(m=>m.id===convId);
    if (m && m.unread>0) { m.unread=0; apiFetch('mark_read',{id:convId}); this.notify(); }
  },

  // Conversations whose full history has been fetched from the server at
  // least once this session. Presence here — NOT "the array has something
  // in it" — is what decides whether a fetch is needed.
  _hydrated: new Set(),
  // In-flight history requests, so a hover prefetch followed by the click
  // (or two quick opens) share ONE get_messages call instead of racing.
  _threadInflight: new Map(),
  // Conversations whose history request has come back at least once, even
  // if it failed. The open chat keeps its loading state until the thread is
  // hydrated OR tried, so a failed fetch shows what we have instead of
  // spinning forever.
  _threadTried: new Set(),
  // Bumped on logout; a response that lands after it belongs to the old
  // session and must not repopulate the new one.
  _epoch: 0,

  // Warm a conversation before it is opened (contact-row hover). Idempotent
  // and free when the thread is already hydrated or already being fetched.
  prefetchThread(convId) {
    if (!convId || this._hydrated.has(convId) || this._threadInflight.has(convId)) return;
    if (!AUTH_STORE.account) return;
    this.loadThread(convId);
  },

  loadThread(convId, opts) {
    // THE BUG THIS REPLACES
    // The old guard was `if (threads[convId].length) return it`. That reads
    // as a cache check but isn't one: onIncoming pushes every arriving
    // message straight into threads[convId], so a conversation the operator
    // has never opened still ends up with an array of one or two messages
    // sitting in memory. Opening it then saw a non-empty array, decided the
    // history was already loaded, and showed only the handful of messages
    // that happened to arrive while the app was running — the rest of the
    // thread never being asked for at all.
    //
    // That is exactly the reported shape: the older messages are missing,
    // and a page refresh brings them back, because a refresh empties
    // threads[] so the next open takes the fetch path.
    if (!convId) return Promise.resolve([]);
    if (!opts?.force && this._hydrated.has(convId)) {
      return Promise.resolve(this.threads[convId] || []);
    }
    if (!opts?.force && this._threadInflight.has(convId)) {
      return this._threadInflight.get(convId);
    }
    const epoch = this._epoch;
    const p = apiGet('get_messages', `&conv_id=${encodeURIComponent(convId)}`).then(res=>{
      if (epoch !== this._epoch) return [];
      const server = Array.isArray(res && res.messages) ? res.messages : [];
      const local  = this.threads[convId] || [];
      this.threads[convId] = MSGS_STORE._mergeThread(server, local);
      this._hydrated.add(convId);
      this.notify();
      return this.threads[convId];
    }).catch(err=>{
      // Deliberately NOT marked hydrated — a failed fetch must not convince
      // the next open that the history is complete. Keep what we have and
      // try again next time.
      console.warn('[thread] history fetch failed for', convId, err && err.message);
      return this.threads[convId] || [];
    }).finally(()=>{
      if (epoch === this._epoch) this._threadTried.add(convId);
      if (this._threadInflight.get(convId) === p) this._threadInflight.delete(convId);
    });
    this._threadInflight.set(convId, p);
    return p;
  },

  // Server history is the authority, but a message sent seconds ago may not
  // be in it yet (save_message is fire-and-forget, and the read can race the
  // write). Anything local that is NEWER than the newest server row and
  // isn't already present survives the merge, so a just-sent message never
  // vanishes the moment the history loads behind it.
  _mergeThread(server, local) {
    if (!local.length) return server;
    if (!server.length) return local;
    // Media URLs are often data: URLs several megabytes long. Building the key
    // from the whole string concatenated (and then compared) megabytes per
    // row for every server row checked. Length + head + tail identifies the
    // same attachment just as well.
    const muKey = (u) => {
      const s = String(u || '');
      return s.length <= 512 ? s : `#${s.length}:${s.slice(0, 96)}:${s.slice(-128)}`;
    };
    const key = m => `${m.r}\u0000${m.c || ''}\u0000${muKey(m.mu)}`;
    // A platform uid identifies the message outright — even after it was
    // edited (text changed) or its attachment arrived late (URL changed).
    const pUid = m => (/^(tgu|tg|dc):/.test(String(m.uid || '')) ? String(m.uid) : '');
    const serverUids = new Set(server.map(pUid).filter(Boolean));
    let newest = 0;
    for (const m of server) if ((m.ts || 0) > newest) newest = m.ts || 0;
    // Matching on text alone is not enough. Server timestamps come from
    // created_at at second resolution while local ones are Date.now() in
    // milliseconds, so the SAME message legitimately carries two different
    // numbers and can't be matched exactly. But text alone would throw away
    // a genuine repeat — a customer who says "ok" now and "ok" again ten
    // minutes later has said two things, not one.
    //
    // So: same text, and close enough in time to be the same event.
    const SAME_EVENT_MS = 120000;
    const extras = local.filter(m => {
      const ts = m.ts || 0;
      // Anything inside the window the server just reported on is the
      // server's business — it is the authority for that stretch.
      if (ts <= newest) return false;
      if (pUid(m) && serverUids.has(pUid(m))) return false;
      const k = key(m);
      return !server.some(sv => key(sv) === k && Math.abs((sv.ts || 0) - ts) <= SAME_EVENT_MS);
    });
    return extras.length ? server.concat(extras) : server;
  },

  getThreadSync(convId) {
    const t = this.threads[convId];
    if (t) return t;
    // A direct chat's sales conversation ("dm_<thread>_<account>") reads the
    // decrypted thread, so the agent's state block, product inference and
    // payment wording see it exactly like any other chat.
    const m = /^dm_(\d+)_\d+$/.exec(String(convId || ''));
    if (m && typeof DM_STORE !== 'undefined') {
      const th = DM_STORE.threads.get(Number(m[1]));
      if (th) return th.msgs.filter(x => x && x.sid && !x.locked && !x.err)
        .map(x => ({ ...x, id: x.sid, ts: Date.parse(x.ts) || 0 }));
    }
    return [];
  },

  // Warm the most recent conversations in the background right after the
  // inbox loads, so opening one of them for the first time is instant.
  // One request at a time, only when the browser is idle, and it steps
  // aside the moment a real open is already fetching something.
  _warmTimer: null,
  warmThreads(max) {
    if (!AUTH_STORE.account) return;
    const epoch = this._epoch;
    const queue = this.list.slice(0, Math.max(0, max || 8)).map(c => c && c.id).filter(Boolean);
    const idle = (fn) => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 1500 });
      else this._warmTimer = setTimeout(fn, 120);
    };
    const next = () => {
      if (epoch !== this._epoch || !queue.length) return;
      if (this._threadInflight.size) { this._warmTimer = setTimeout(() => idle(next), 250); return; }
      const id = queue.shift();
      if (this._hydrated.has(id)) { idle(next); return; }
      this.loadThread(id).finally(() => idle(next));
    };
    this._warmTimer = setTimeout(() => idle(next), 400);
  },
};

let MSGS = MSGS_STORE.list;
const useMsgs = ()=>{
  const [msgs,setMsgs]=React.useState(MSGS_STORE.list);
  React.useEffect(()=>MSGS_STORE.sub(setMsgs),[]);
  return msgs;
};

// ── CONNECTION STATUS STORE ───────────────────────────────────
// Survives Settings tab unmount — components read from here on mount.
// Extended with:
//   log[]      — ring-buffer of timestamped platform events (last 60)
//   accounts[] — multi-account list (each platform can have multiple entries)
//   addLog()   — add a structured log entry from anywhere
const CONN_STORE = {
  telegram:{connected:false,botName:'',username:'',botId:'',avatar:'',error:''},
  discord: {connected:false,botName:'',username:'',botId:'',avatar:'',error:''},

  // Structured connection log — ring-buffer, last 60 entries.
  // Each entry: { ts, platform, level ('ok'|'warn'|'error'|'info'), msg }
  log: [],
  LOG_MAX: 60,

  subs: new Set(),
  set(platform, patch) {
    this[platform] = { ...this[platform], ...patch };
    this.subs.forEach(fn => fn());
  },
  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  notify() { this.subs.forEach(fn => fn()); },

  // Add a log entry. Called by the bcEvent handler for every platform event.
  addLog(platform, level, msg) {
    const entry = { ts: Date.now(), platform, level: level || 'info', msg: String(msg || '') };
    this.log.push(entry);
    if (this.log.length > this.LOG_MAX) this.log = this.log.slice(-this.LOG_MAX);
    this.notify();
  },

  // Clear log (useful for the UI reset button)
  clearLog() { this.log = []; this.notify(); },
};
// CONN_STORE.set() replaces the platform object, while addLog() (fired for
// every connection log line) leaves it untouched. Only a real replacement
// produces a new copy, so log chatter no longer re-renders every consumer.
const useConn = () => {
  const srcRef = React.useRef({ tg: CONN_STORE.telegram, dc: CONN_STORE.discord });
  const [tg, setTg] = React.useState(() => ({...CONN_STORE.telegram}));
  const [dc, setDc] = React.useState(() => ({...CONN_STORE.discord}));
  React.useEffect(() => {
    const sync = () => {
      const s = srcRef.current;
      if (s.tg !== CONN_STORE.telegram) { s.tg = CONN_STORE.telegram; setTg({...CONN_STORE.telegram}); }
      if (s.dc !== CONN_STORE.discord)  { s.dc = CONN_STORE.discord;  setDc({...CONN_STORE.discord}); }
    };
    sync();   // catch a change that landed between render and subscribe
    return CONN_STORE.sub(sync);
  }, []);
  return [tg, dc];
};
// Log-only hook — re-renders only when the log changes, not on every conn update.
const useConnLog = () => {
  const [log, setLog] = React.useState(CONN_STORE.log);
  React.useEffect(() => CONN_STORE.sub(() => setLog([...CONN_STORE.log])), []);
  return log;
};

// ── CREDENTIALS STORE ─────────────────────────────────────────
// Persists tokens & API keys across restarts. Loaded once on startup;
// SettingsView reads/writes through here so values survive tab navigation.
const CRED_STORE = {
  values: {},  // key → string (token / api key)
  meta:   {},  // key → object (last-known bot profile, etc.)
  loaded: false,
  subs: new Set(),
  sub(fn){ this.subs.add(fn); return ()=>this.subs.delete(fn); },
  notify(){ this.subs.forEach(fn=>fn()); },

  load() {
    return apiGet('get_credentials').then(res=>{
      const c = res.credentials||{};
      this.values = {};
      this.meta   = {};
      Object.keys(c).forEach(k=>{
        this.values[k] = c[k].value||'';
        if (c[k].meta) this.meta[k] = c[k].meta;
      });
      this.loaded = true;
      this.notify();
    });
  },

  set(key, value, meta) {
    this.values[key] = value||'';
    if (meta) this.meta[key] = meta;
    this.notify();
    return apiFetch('save_credential', { key, value: value||'', meta: meta||null });
  },

  clear(key) {
    delete this.values[key];
    delete this.meta[key];
    this.notify();
    return apiFetch('delete_credential', { key });
  },

  get(key)     { return this.values[key] || ''; },
  getMeta(key) { return this.meta[key]   || null; },
};
const useCreds = ()=>{
  const [v,setV] = React.useState({values:{...CRED_STORE.values},meta:{...CRED_STORE.meta},loaded:CRED_STORE.loaded});
  React.useEffect(()=>CRED_STORE.sub(()=>setV({values:{...CRED_STORE.values},meta:{...CRED_STORE.meta},loaded:CRED_STORE.loaded})),[]);
  return v;
};

// ── CONNECTION SUPPRESS ───────────────────────────────────────
// When the operator deliberately disconnects (or removes/switches an
// account), we set the matching flag so the always-on auto-connect
// supervisor (app root) stands down and does NOT immediately reconnect.
// Cleared the moment a fresh connect is issued for that platform.
const CONN_SUPPRESS = { telegram: false, discord: false };

// ── PLATFORM ACCOUNTS STORE ───────────────────────────────────
// Lets the operator save MULTIPLE Telegram/Discord accounts and switch
// between them. The .NET host still runs ONE live client per platform at a
// time, so exactly one account per platform is "active" (connected); the
// rest are saved for quick switching. The active account's credentials are
// mirrored into the legacy CRED_STORE keys (tg_bot_token / tg_api_id /
// tg_api_hash / tg_phone / dc_bot_token) so the connection engine, the
// backend ai_reply path, and the auto-connect supervisor all keep working
// unchanged whether the operator has one account or several.
//
// Persisted as meta on the credential key 'platform_accounts'.
const PLATFORM_ACCOUNTS = {
  data: { telegram: [], discord: [], activeTg: null, activeDc: null },
  loaded: false,
  subs: new Set(),
  sub(fn){ this.subs.add(fn); return ()=>this.subs.delete(fn); },
  notify(){ this.subs.forEach(fn=>{ try { fn(); } catch(_){} }); },

  hydrate(){
    try {
      const m = CRED_STORE.getMeta('platform_accounts');
      if (m && typeof m === 'object') {
        this.data = { telegram:[], discord:[], activeTg:null, activeDc:null, ...m,
          telegram: Array.isArray(m.telegram) ? m.telegram : [],
          discord:  Array.isArray(m.discord)  ? m.discord  : [] };
      }
    } catch(_){}
    // Seed from the legacy single-account credentials exactly once, then mark
    // it done and persist so we never re-seed (which would duplicate the
    // account on every reload).
    if (!this.data.migrated) {
      this._migrateFromLegacy();
      this.data.migrated = true;
      this._persist();
    }
    this.loaded = true;
    this.notify();
  },

  // Seed a first account from the legacy single-account credentials so
  // existing users see their current account in the new list.
  _migrateFromLegacy(){
    const v = (CRED_STORE.values || {});
    const prof = CRED_STORE.getMeta('tg_bot_profile') || {};
    if ((this.data.telegram || []).length === 0) {
      if (v.tg_bot_token) {
        const id = 'tg_' + Math.random().toString(36).slice(2, 9);
        this.data.telegram.push({ id, mode:'bot', label: prof.username || prof.botName || 'Bot API', token: v.tg_bot_token });
        this.data.activeTg = this.data.activeTg || id;
      } else if (v.tg_api_id && v.tg_api_hash && v.tg_phone) {
        const id = 'tg_' + Math.random().toString(36).slice(2, 9);
        this.data.telegram.push({ id, mode:'user', label: prof.username || v.tg_phone || 'User API', apiId: v.tg_api_id, apiHash: v.tg_api_hash, phone: v.tg_phone });
        this.data.activeTg = this.data.activeTg || id;
      }
    }
    const dprof = CRED_STORE.getMeta('dc_bot_profile') || {};
    if ((this.data.discord || []).length === 0 && v.dc_bot_token) {
      const id = 'dc_' + Math.random().toString(36).slice(2, 9);
      this.data.discord.push({ id, label: dprof.username || dprof.botName || 'Discord bot', token: v.dc_bot_token });
      this.data.activeDc = this.data.activeDc || id;
    }
  },

  _persist(){ try { return CRED_STORE.set('platform_accounts', '1', this.data); } catch(_){} },

  list(platform){ return (this.data[platform] || []).slice(); },
  activeId(platform){ return platform === 'telegram' ? this.data.activeTg : this.data.activeDc; },
  get(platform, id){ return (this.data[platform] || []).find(a => a.id === id) || null; },

  add(platform, acct){
    const id = (platform === 'telegram' ? 'tg_' : 'dc_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const row = { id, ...acct };
    this.data[platform] = [...(this.data[platform] || []), row];
    this.notify(); this._persist();
    return row;
  },
  update(platform, id, patch){
    this.data[platform] = (this.data[platform] || []).map(a => a.id === id ? { ...a, ...patch } : a);
    this.notify(); this._persist();
  },
  remove(platform, id){
    this.data[platform] = (this.data[platform] || []).filter(a => a.id !== id);
    if (platform === 'telegram' && this.data.activeTg === id) this.data.activeTg = null;
    if (platform === 'discord'  && this.data.activeDc === id) this.data.activeDc = null;
    this.notify(); this._persist();
  },
  setActive(platform, id){
    if (platform === 'telegram') this.data.activeTg = id; else this.data.activeDc = id;
    this.notify(); this._persist();
  },

  // Mirror an account's credentials into the legacy CRED_STORE keys the rest
  // of the app reads. Called right before issuing a connect so a single live
  // connection (the .NET host's model) always reflects the chosen account.
  mirrorToLegacy(platform, id){
    const a = this.get(platform, id);
    if (!a) return;
    if (platform === 'telegram') {
      if (a.mode === 'bot') {
        CRED_STORE.set('tg_bot_token', a.token || '');
        // Clear user-API keys so the supervisor picks the bot token path.
        CRED_STORE.set('tg_api_id', ''); CRED_STORE.set('tg_api_hash', ''); CRED_STORE.set('tg_phone', '');
      } else {
        CRED_STORE.set('tg_api_id', a.apiId || '');
        CRED_STORE.set('tg_api_hash', a.apiHash || '');
        CRED_STORE.set('tg_phone', a.phone || '');
        CRED_STORE.set('tg_bot_token', '');
      }
    } else {
      CRED_STORE.set('dc_bot_token', a.token || '');
    }
  },
};
const usePlatformAccounts = () => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => PLATFORM_ACCOUNTS.sub(force), []);
  return PLATFORM_ACCOUNTS;
};

// Telegram User-API auth store — driven by the .NET host when MTProto login
// needs an OTP or 2FA password. The OTP modal subscribes; .NET fires
// "telegramAuthRequired" with kind="code"|"password".
const TG_AUTH_STORE = {
  state: { open:false, kind:null, phone:'', error:'' },
  subs: new Set(),
  notify(){ this.subs.forEach(fn=>fn({...this.state})); },
  sub(fn){ this.subs.add(fn); fn({...this.state}); return ()=>this.subs.delete(fn); },
  request(kind, phone){ this.state = {open:true, kind, phone:phone||this.state.phone, error:''}; this.notify(); },
  setError(msg){ this.state = {...this.state, error:msg||''}; this.notify(); },
  close(){ this.state = {open:false, kind:null, phone:'', error:''}; this.notify(); },
};
const useTgAuth = () => {
  const [s,setS] = React.useState(TG_AUTH_STORE.state);
  React.useEffect(()=>TG_AUTH_STORE.sub(setS),[]);
  return s;
};

// ── INVOICE DELIVERY IN-FLIGHT LOCK ───────────────────────────────
// The post-payment pipeline below is a long-running async job (it sleeps
// for typing/read-delay simulation, hits the server, then sends each
// attachment with gaps — easily 10–40s end to end). Its idempotency was
// previously enforced ONLY by persisted flags (customer_confirmed_msg_sent,
// delivered) that get stamped at the END of the job. That leaves a wide
// race window: if a second `invoiceConfirmed` fires for the same invoice
// before the first job stamps its flags (watchdog tick + resumePending
// catch-up firing within the same second, two overlapping ticks, or a
// manual + automatic confirm), BOTH jobs pass the flag check and run to
// completion — so the customer gets the confirmation line twice and every
// file/link twice. This synchronous in-memory claim closes that window:
// the FIRST event for a given invoice id claims the lock immediately
// (before any await), and any concurrent event for the same id is dropped.
// The lock is released in a finally once the whole pipeline settles.
const INVOICE_DELIVERY_INFLIGHT = new Set();

// ── AGENT VOICE ───────────────────────────────────────────────────────
// The one way the SYSTEM speaks to a customer. Anything the client sends on
// its own initiative (the manual-setup follow-up, "that coin isn't taken
// here", a multi-key handover, the empty-reply fallback…) is written by the
// agent's own model under its persona, copying how it has been texting this
// customer, in their language — via compose_agent_line (persona_line() in
// api.php). A fixed sentence is only ever the FALLBACK for when the model
// can't be reached, so an outage costs some texture, never the message.
//
// say(convId, kind, spec, fallback):
//   spec.brief        what the message has to do (required)
//   spec.facts        the only facts it may state
//   spec.mustInclude  exact strings that must survive (keys, links, amounts)
//   spec.multiline    allow line breaks / [[SPLIT]]
//   spec.sourceText   operator text to ADAPT instead of writing fresh
//   spec.emoji        false forbids emoji
//   spec.lang         force a language (default: the conversation's)
//   fallback          string, or () => string, used when composing fails
// Recent lines of the same kind on the same chat are passed back as
// "don't reuse this", so a returning customer never hears the same wording.
const AGENT_VOICE = {
  _recent: new Map(),
  langFor(convId){
    try {
      if (typeof IMPERFECTION === 'undefined' || !IMPERFECTION.detectLang) return '';
      const th = (typeof MSGS_STORE !== 'undefined' && MSGS_STORE.getThreadSync) ? (MSGS_STORE.getThreadSync(convId) || []) : [];
      const inb = th.filter(m => m && m.r === 'in').slice(-6).map(m => m.c || '').join(' ');
      const all = th.slice(-10).filter(m => m && (m.r === 'in' || m.r === 'bot')).map(m => m.c || '').join(' ').replace(/\[\[[^\]]*\]\]/g, ' ');
      return IMPERFECTION.detectLang(all) || IMPERFECTION.detectLang(inb) || '';
    } catch (_) { return ''; }
  },
  async say(convId, kind, spec = {}, fallback = ''){
    const fb = () => { try { return String((typeof fallback === 'function' ? fallback() : fallback) || ''); } catch (_) { return ''; } };
    if (!convId || !spec || !spec.brief || typeof apiFetch !== 'function') return fb();
    const key = String(convId) + '|' + String(kind || '');
    const must = (spec.mustInclude || []).map(String).filter(Boolean);
    try {
      const r = await Promise.race([
        apiFetch('compose_agent_line', {
          conv_id: convId,
          kind: String(kind || ''),
          brief: String(spec.brief),
          facts: JSON.stringify(spec.facts || []),
          must_include: JSON.stringify(must),
          avoid: JSON.stringify((this._recent.get(key) || []).slice(-4)),
          lang: spec.lang || this.langFor(convId) || 'auto',
          emoji: spec.emoji === false ? 0 : 1,
          multiline: spec.multiline ? 1 : 0,
          max_len: spec.maxLen || 0,
          source_text: spec.sourceText || '',
        }),
        new Promise(res => setTimeout(() => res(null), spec.timeoutMs || 10000)),
      ]);
      const t = r && !r.error ? String(r.text || '').trim() : '';
      if (t && must.every(m => t.includes(m))) {
        const list = this._recent.get(key) || [];
        list.push(t);
        this._recent.set(key, list.slice(-6));
        return t;
      }
    } catch (_) { /* fallback below */ }
    return fb();
  },
};

// ── COMBINED DELIVERY COMPOSER ────────────────────────────────────────
// Post-payment text is written by the operator for ONE product and sent
// verbatim. That is right for a single sale and wrong the moment a payment
// covers several things: pasting each product's message back to back
// repeats every shared line ("thanks for buying", the support link, the
// setup steps) once per product, and two units of the same product send the
// whole message twice to change one serial.
//
// This merges the per-unit payloads the server already built (placeholders
// resolved, one per unit) into ONE message:
//   • units of the same product: lines that are identical are kept once;
//     lines that differ (the serial, the per-licence link) are listed, and a
//     "Label:" lead-in shared by all of them is written once above the list;
//   • different products: each gets a "Product name:" heading over the lines
//     that are unique to it, lines every product shares move above or below
//     the sections once, and a line already said for an earlier product is
//     not repeated for a later one;
//   • attachments are sent once per file (by URL) and, when several products
//     are involved, captioned with the product they belong to.
// A single unit of a single product comes out exactly as it always has.
const DELIVERY_COMPOSER = {
  norm(line){ return String(line || '').trim().replace(/\s+/g, ' ').toLowerCase(); },
  tidy(lines){
    return (Array.isArray(lines) ? lines.join('\n') : String(lines || ''))
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  },

  // SEVERAL SEPARATE KEYS, ONE {SERIAL} PLACEHOLDER. The operator writes
  // the after-payment message for one purchase ("your key: {SERIAL}"). Two
  // units bought as two separate keys give two texts that differ only in
  // the key. Each text's own key is swapped for a marker; when that leaves
  // the SAME template for every unit, the template is written once with
  // every key where the placeholder was, each on its own line so it can be
  // copied — whether {SERIAL} sat alone on a line, after a "Label:", or in
  // the middle of a sentence. Returns null when the texts are not one
  // template (the general merge below takes over).
  mergeKeyedTexts(texts, serials){
    const TOKEN = '\u0000KEY\u0000';
    const pairs = texts.map((x, i) => ({ text: String(x || '').replace(/\r\n/g, '\n').trim(), key: String((serials || [])[i] || '').trim() }))
      .filter(p => p.text && p.key);
    const keys = [...new Set(pairs.map(p => p.key))];
    if (pairs.length < 2 || keys.length < 2) return null;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tpls = pairs.map(p => p.text.replace(new RegExp(esc(p.key), 'g'), TOKEN));
    if (!tpls[0].includes(TOKEN) || tpls.some(t => t !== tpls[0])) return null;
    const out = [];
    tpls[0].split('\n').forEach(line => {
      if (!line.includes(TOKEN)) { out.push(line); return; }
      const idx = line.indexOf(TOKEN);
      const before = line.slice(0, idx).replace(/\s+$/, '');
      const after = line.slice(idx + TOKEN.length).split(TOKEN).join('').replace(/^[\s,.;:)\]-]+/, '').trim();
      if (before) out.push(before);
      keys.forEach(k => out.push(k));
      if (after) out.push(after);
    });
    return this.tidy(out);
  },

  mergeUnitTexts(texts, serials){
    if (serials) {
      const keyed = this.mergeKeyedTexts(texts, serials);
      if (keyed) return keyed;
      // Some units got a key and some didn't (an issuance failed): the
      // key-less texts would only add an empty "your key:" line. Merge
      // the keyed ones; the missing key is reported to the operator.
      const withKey = texts.filter((x, i) => String((serials[i] || '')).trim());
      if (withKey.length && withKey.length < texts.length) {
        const again = this.mergeKeyedTexts(withKey, serials.filter(s => String(s || '').trim()));
        if (again) return again;
        texts = withKey;
      }
    }
    const t = texts.map(x => String(x || '').replace(/\r\n/g, '\n').trim()).filter(Boolean);
    if (t.length <= 1) return t[0] || '';
    if (t.every(x => x === t[0])) return t[0];
    const split = t.map(x => x.split('\n'));
    const out = [];
    if (split.every(l => l.length === split[0].length)) {
      // Same template, same shape: compare line by line.
      for (let i = 0; i < split[0].length; i++) {
        const vals = split.map(l => l[i]);
        const distinct = [...new Set(vals)];
        if (distinct.length === 1) { out.push(distinct[0]); continue; }
        let pre = distinct[0];
        distinct.forEach(v => { while (pre && !v.startsWith(pre)) pre = pre.slice(0, -1); });
        const colon = pre.lastIndexOf(':');
        const lead = colon >= 2 ? pre.slice(0, colon + 1) : '';
        if (lead.trim().length >= 3 && distinct.every(v => v.slice(lead.length).trim())) {
          out.push(lead.trim());
          distinct.forEach(v => out.push(v.slice(lead.length).trim()));
        } else {
          distinct.forEach(v => out.push(v));
        }
      }
    } else {
      // Shapes differ (a placeholder resolved empty on one unit). Fall back
      // to keeping each distinct line once, in order of first appearance.
      const seen = new Set();
      t.forEach((x, n) => {
        if (n) out.push('');
        x.split('\n').forEach(line => {
          const k = this.norm(line);
          if (!k) { out.push(''); return; }
          if (seen.has(k)) return;
          seen.add(k); out.push(line);
        });
      });
    }
    return this.tidy(out);
  },

  // units: [{ key, product_id, name, text, attachments }]
  compose(units){
    const groups = [];
    const byKey = new Map();
    units.forEach(u => {
      const k = u.product_id ? 'p' + u.product_id : 'n' + this.norm(u.name);
      let g = byKey.get(k);
      if (!g) { g = { name: String(u.name || '').trim(), units: [] }; byKey.set(k, g); groups.push(g); }
      g.units.push(u);
    });
    const multi = groups.length > 1;
    groups.forEach(g => {
      g.qty = g.units.length;
      g.label = (g.name || 'Item') + (g.qty > 1 ? ` ×${g.qty}` : '');
      g.keys = [...new Set(g.units.map(u => String(u.serial || '').trim()).filter(Boolean))];
      g.lines = this.mergeUnitTexts(g.units.map(u => u.text), g.units.map(u => u.serial || '')).split('\n');
      if (g.lines.length === 1 && !g.lines[0].trim()) g.lines = [];
    });

    const header = [], footer = [];
    if (multi) {
      const withText = groups.filter(g => g.lines.some(l => l.trim()));
      if (withText.length >= 2) {
        const sets = withText.map(g => new Set(g.lines.map(l => this.norm(l)).filter(Boolean)));
        const shared = new Set([...sets[0]].filter(k => sets.every(s => s.has(k))));
        if (shared.size) {
          const first = withText[0].lines;
          const firstUnique = first.findIndex(l => this.norm(l) && !shared.has(this.norm(l)));
          const placed = new Set();
          first.forEach((l, i) => {
            const k = this.norm(l);
            if (!shared.has(k) || placed.has(k)) return;
            placed.add(k);
            (firstUnique === -1 || i < firstUnique ? header : footer).push(l);
          });
          withText.forEach(g => { g.lines = g.lines.filter(l => !shared.has(this.norm(l))); });
        }
      }
      // A line already said for an earlier product isn't repeated later.
      const said = new Set();
      groups.forEach(g => {
        const mine = new Set();
        g.lines = g.lines.filter(l => {
          const k = this.norm(l);
          if (!k) return true;
          if (said.has(k)) return false;
          mine.add(k);
          return true;
        });
        mine.forEach(k => said.add(k));
      });
    }

    const blocks = [];
    if (header.length) blocks.push(this.tidy(header));
    groups.forEach(g => {
      const body = this.tidy(g.lines);
      if (!body) return;
      // Heading by product name only: the keys/lines under it already
      // show how many there are, and "Gold ×2:" is a label, not speech.
      blocks.push(multi ? `${g.name || 'Item'}:\n${body}` : body);
    });
    if (footer.length) blocks.push(this.tidy(footer));
    const text = blocks.join('\n\n').trim();

    // Units whose delivery includes the text — a failed text send only
    // holds back those units, not ones that were attachment-only.
    const textOwners = units.filter(u => String(u.text || '').trim()).map(u => u.key);

    const attachments = [];
    const byUrl = new Map();
    groups.forEach(g => g.units.forEach(u => (Array.isArray(u.attachments) ? u.attachments : []).forEach(a => {
      if (!a || !a.url) return;
      let e = byUrl.get(a.url);
      if (!e) { e = { att: a, owners: [], names: [] }; byUrl.set(a.url, e); attachments.push(e); }
      if (!e.owners.includes(u.key)) e.owners.push(u.key);
      if (g.name && !e.names.includes(g.name)) e.names.push(g.name);
    })));
    attachments.forEach(e => {
      let cap = String(e.att.caption || '').trim();
      if (multi && e.names.length) {
        const lbl = e.names.join(' + ');
        if (!this.norm(cap).includes(this.norm(lbl))) cap = cap ? `${lbl}: ${cap}` : lbl;
      }
      e.caption = cap.slice(0, 1000);
    });

    return { text, textOwners, attachments, multi, groups };
  },

  // Split a long message at paragraph, then line, boundaries so it fits the
  // platform's message cap instead of being truncated or rejected.
  chunk(text, limit){
    const max = Math.max(500, (limit || 4096) - 96);
    if (!text || text.length <= max) return text ? [text] : [];
    const out = [];
    let cur = '';
    const push = (piece, joiner) => {
      if (!cur) { cur = piece; return; }
      if (cur.length + joiner.length + piece.length <= max) { cur += joiner + piece; return; }
      out.push(cur); cur = piece;
    };
    text.split('\n\n').forEach(p => {
      if (p.length <= max) { push(p, '\n\n'); return; }
      p.split('\n').forEach(line => {
        while (line.length > max) { push(line.slice(0, max), '\n'); line = line.slice(max); }
        push(line, '\n');
      });
    });
    if (cur) out.push(cur);
    return out;
  },
};

// ── POST-PAYMENT PIPELINE ─────────────────────────────────────────────
// When an invoice lands as confirmed (on-chain, or confirmed by hand in the
// Payments panel), run the post-payment sequence for it:
//   1. Payment confirmation message (paced, in persona)
//   2. record_invoice_payment for every UNIT on the invoice (server txn +
//      licence / serial per unit)
//   3. ONE combined delivery (DELIVERY_COMPOSER) — text then attachments
//   4. Manual-setup follow-up (tasks from every product involved, once)
//   5. Stop After Sale, which now waits while anything else is still open
//      (POST_SALE_POLICY in bot-engine.jsx)
//
// Work is BATCHED PER CONVERSATION. Payments that land together (a poll tick
// confirming two invoices, a manual confirm right after an on-chain one) are
// handled as one sequence: one "got both, thanks", one merged delivery, one
// follow-up — never two overlapping streams of messages racing each other.
// Anything that lands while a batch is running is queued and handled right
// after it, in order.
//
// All customer-facing sends go through realisticSend so typing indicators and
// read delays are never bypassed. Idempotency lives on the invoice row
// (customer_confirmed_msg_sent / manual_msg_sent / delivered) and on each
// server transaction (delivered_at), so replays only re-send what didn't
// make it.
const INVOICE_PIPELINE = {
  _convs: new Map(),   // convId -> { queue: Map(key -> data), running, timer, firstAt }
  DEBOUNCE_MS: 2500,
  MAX_WAIT_MS: 8000,

  // Bridged to the .NET host (Form1 `jsLog` handler) so every step is visible
  // in the app's output window, not just DevTools. Prefixed "[invoice]".
  ilog(msg, obj){
    let line = '[invoice] ' + msg;
    if (typeof obj !== 'undefined') {
      try { line += ' ' + (typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch (_) { line += ' [unserialisable]'; }
    }
    try { console.warn(line); } catch (_) {}
    try { if (window.BotBridge && typeof window.BotBridge.log === 'function') window.BotBridge.log(line, 'info'); } catch (_) {}
  },

  isBusy(convId){
    const st = this._convs.get(convId);
    return !!(st && (st.running || st.queue.size));
  },

  resolveConv(convId){
    let conv = MSGS_STORE.list.find(m => m.id === convId);
    // RECOVERY PATH — conv list might be a mid-load stale snapshot.
    if (!conv && convId) {
      try {
        const s = String(convId);
        const parts = s.split(':');
        if (parts.length >= 2) {
          conv = { id: convId, p: parts[0], chatId: parts.slice(1).join(':') };
        } else {
          const m = s.match(/^([a-z]+)_(.+)$/i);
          if (m) conv = { id: convId, p: m[1], chatId: m[2] };
        }
        if (conv) this.ilog('conv not in MSGS_STORE — using id-decoded fallback', { id: conv.id, p: conv.p, chatId: conv.chatId });
      } catch (_) {}
    }
    return conv || null;
  },

  enqueue(data){
    const ilog = this.ilog.bind(this);
    // A direct chat's payment: the server runs its delivery (it holds the
    // conversation there, and delivers while you're away too). A payment you
    // confirmed by hand is handed over to it here.
    if (data && bcSrvInvoice(data)) {
      if (!data._retryDelivery && data.id) {
        ilog('direct chat payment — handing delivery to the server', { id: data.id });
        apiFetch('dm_shop_paid', { invoice_id: data.id })
          .then(r => { if (r && !r.error) { try { DM_STORE._schedule(400); } catch (_) {} } })
          .catch(() => {});
      }
      return;
    }
    ilog('EVENT invoiceConfirmed received', {
      id: data.id, conv_id: data.conv_id, reference: data.reference,
      product_id: data.product_id, product: data.product,
      items: Array.isArray(data.items) ? data.items.length : 0,
      coin: data.coin, amount_fiat: data.amount_fiat, fiat: data.fiat,
      amount_coin: data.amount_coin || data.amount_coin_quoted,
      confirmations: data.confirmations, status: data.status,
      _retryDelivery: !!data._retryDelivery
    });
    const convId = data.conv_id;
    const invRow = data.id ? PAYMENTS_STORE.invoices.find(i => i.id === data.id) : null;
    const key = String(data.id || data.reference || (data.conv_id + ':' + (data.address || '')));
    if (INVOICE_DELIVERY_INFLIGHT.has(key)) {
      ilog('DROP — delivery already in-flight or queued (duplicate event)', { key });
      return;
    }
    if (!data._retryDelivery && invRow && invRow.customer_confirmed_msg_sent && invRow.delivered) {
      ilog('SKIP — already fully delivered (confirmed + delivered flags set); nothing to send', { key });
      return;
    }
    INVOICE_DELIVERY_INFLIGHT.add(key);
    try { if (data.id && typeof POST_SALE_POLICY !== 'undefined') POST_SALE_POLICY.markInflight(convId, data.id); } catch (_) {}
    let st = this._convs.get(convId);
    if (!st) { st = { queue: new Map(), running: false, timer: null, firstAt: 0 }; this._convs.set(convId, st); }
    st.queue.set(key, data);
    if (!st.firstAt) st.firstAt = Date.now();
    ilog('queued for post-payment batch', { key, conv_id: convId, queued: st.queue.size, running: st.running });
    this._schedule(convId);
  },

  _schedule(convId){
    const st = this._convs.get(convId);
    if (!st || st.running) return;
    if (st.timer) clearTimeout(st.timer);
    const wait = Math.max(0, Math.min(this.DEBOUNCE_MS, (st.firstAt || Date.now()) + this.MAX_WAIT_MS - Date.now()));
    st.timer = setTimeout(() => { this._flush(convId); }, wait);
  },

  async _flush(convId){
    const st = this._convs.get(convId);
    if (!st || st.running) return;
    st.timer = null;
    st.running = true;
    const entries = [...st.queue.entries()].map(([key, data]) => ({ key, data }));
    st.queue.clear();
    st.firstAt = 0;
    try {
      await this._runBatch(convId, entries);
    } catch (err) {
      this.ilog('PIPELINE THREW — delivery may be incomplete', { error: (err && err.message) || String(err), stack: (err && err.stack) ? String(err.stack).slice(0, 300) : null });
    } finally {
      // Release every claim however the batch exited, so a later legitimate
      // retry (watchdog re-fire after a partial failure) can run.
      entries.forEach(({ key, data }) => {
        INVOICE_DELIVERY_INFLIGHT.delete(key);
        try { if (data.id && typeof POST_SALE_POLICY !== 'undefined') POST_SALE_POLICY.clearInflight(convId, data.id); } catch (_) {}
      });
      this.ilog('released delivery locks', { keys: entries.map(e => e.key) });
      st.running = false;
      if (st.queue.size) { st.firstAt = Date.now(); this._schedule(convId); }
      else this._convs.delete(convId);
    }
  },

  // ── MANUAL-SETUP FOLLOW-UP ─────────────────────────────────────
  // The customer-facing "there's still <tasks> to do by hand" message.
  // Shared by the payment batch (no post-sale setup needed) and
  // POST_SALE_ONBOARDING (sent once the username / account help steps are
  // finished).
  //
  // It is written by the agent's own model under its persona, in the
  // conversation's language, with the chat in front of it (AGENT_VOICE).
  // The fixed sentences in manualFollowupText below are only the fallback
  // for when the model can't be reached — they used to be what every
  // customer got, which is why "you're all paid up ✅ just the … left to
  // do, i'll come back to you here once it's in place" arrived word for
  // word on sale after sale.
  async manualFollowupLine(conv, tasks, tone, emojiOn, stopAfter){
    const list = (Array.isArray(tasks) ? tasks : []).map(t => String(t || '').trim()).filter(Boolean);
    if (!list.length) return '';
    const fallback = () => this.manualFollowupText(list, tone, emojiOn, stopAfter);
    if (!conv || !conv.id || typeof AGENT_VOICE === 'undefined') return fallback();
    // The operator's task notes are written for the operator ("SMTP SETUP",
    // "20 public links"). The model is told to say them the way a person
    // would to a customer, never to paste them.
    const facts = [
      'their payment has gone through and anything automatic has already been sent to them',
      ...list.map(t => 'still to be done BY YOU, by hand, for their order: ' + t.replace(/\s*[\u2014\u2013]\s*/g, ' ')),
      'you will message them here once it is done',
    ];
    const brief = stopAfter
      ? "Tell them what is still left for you to do by hand for their order (see FACTS) and that you'll message them here once it's done. This is the last thing you'll say for a while, so leave them with a clear expectation. Say the tasks the way you'd naturally describe them to a customer: never paste the notes, never use capitals or a list. If you already thanked them for paying in the chat above, don't thank them again. No invented times, reasons or excuses."
      : "Tell them there's still something you need to do by hand for their order (see FACTS) and that you'll confirm here once it's done. Say the tasks the way you'd naturally describe them to a customer: never paste the notes, never use capitals or a list. If you already thanked them for paying in the chat above, don't thank them again. No invented times, reasons or excuses.";
    return AGENT_VOICE.say(conv.id, 'manual_setup', { brief, facts, emoji: emojiOn !== false, maxLen: 400 }, fallback);
  },

  // Fallback wording for manualFollowupLine (model unreachable).
  manualFollowupText(tasks, tone, emojiOn, stopAfter){
    tasks = (Array.isArray(tasks) ? tasks : []).map(t => String(t || '').trim()).filter(Boolean);
    if (!tasks.length) return '';
            // ── TASK NORMALISER ───────────────────────────────────────────
            // The templates below slot the operator's task strings straight
            // after "i'll …" / "need to …". Operators write tasks however they
            // like — sometimes a verb phrase ("add the SMTPs"), often a bare
            // NOUN phrase ("20 public links", "SMTP setup"). Dropping a noun
            // phrase after "i'll" produces broken output like
            // "i'll 20 public links". We also see shouty ALL-CAPS task text
            // ("20 PUBLIC LINKS") leak verbatim into the customer message.
            // Normalise each task so it always reads as a natural verb phrase:
            //   • collapse ALL-CAPS words to lowercase (keep short acronyms
            //     like SMTP/API/VPN/IP intact),
            //   • strip any em/en dashes the operator pasted in,
            //   • if the phrase doesn't already start with a sensible verb,
            //     prefix "add" so "20 public links" -> "add your 20 public links".
            const ACRONYMS = /^(smtp|smtps|api|apis|vpn|vpns|ip|ips|dns|url|urls|id|ids|otp|2fa|sql|ssh|ftp|cdn|crm|llc|seo|kyc|usdt|btc|eth|ltc|nft)$/i;
            const STARTS_WITH_VERB = /^(add|set\b|set up|setup|setting|configure|config|install|enable|activate|create|make|build|load|upload|register|provision|issue|generate|assign|link|connect|finish|complete|sort|prep|prepare|put|get|grant|apply|attach|deploy|whitelist|verify|unlock|top\s*up|topup|send)\b/i;
            const normaliseTask = (raw) => {
              let s = String(raw || '').trim();
              if (!s) return '';
              // Strip em/en dashes (they're an AI tell + break the sentence).
              s = s.replace(/\s*[\u2014\u2013]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
              // De-shout ALL-CAPS words, preserving genuine short acronyms.
              s = s.split(/\b/).map(tok => {
                if (/^[A-Z0-9]{2,}$/.test(tok) && !ACRONYMS.test(tok)) {
                  return tok.toLowerCase();
                }
                return tok;
              }).join('');
              // If it doesn't already begin with a verb, treat it as a noun
              // phrase and prefix a natural verb so "20 public links" becomes
              // "add your 20 public links". Use "your" only when it reads
              // naturally (skip if it already has a possessive/article).
              if (!STARTS_WITH_VERB.test(s)) {
                const hasDet = /^(the|your|a|an|some|all|их|this|that|these|those)\b/i.test(s);
                s = 'add ' + (hasDet ? '' : 'your ') + s;
                s = s.replace(/\s{2,}/g, ' ').trim();
              }
              // Lowercase the leading word so it flows after "i'll".
              s = s.charAt(0).toLowerCase() + s.slice(1);
              return s;
            };
            const normTasks = tasks.map(normaliseTask).filter(Boolean);
            if (normTasks.length === 0) return '';

            const taskPhrase = normTasks.length === 1
              ? normTasks[0]
              : normTasks.slice(0, -1).join(', ') + ' and ' + normTasks[normTasks.length - 1];
            let pool;
            const e = (s) => emojiOn ? s : '';
            const t = String(tone || '').toLowerCase();
            // ── WIND-DOWN WORDING ──────────────────────────────────────
            // Two different situations, and the old bank blurred them.
            //
            // `stopAfter` means the agent is about to go silent, so this is
            // the last thing the customer hears. It has to leave them with a
            // clear expectation. The previous lines all opened by inventing
            // an excuse ("i'm just at work atm", "i'm away from my desk") —
            // a detail nobody asked for, unverifiable, and identical every
            // time, which is exactly the shape of a machine reaching for a
            // reason. They also closed on "i'll ping you here", which
            // promises a notification instead of saying what is happening.
            //
            // These state the work and the outcome, and nothing else.
            if (stopAfter) {
              if (t.includes('formal') || t.includes('professional')) {
                pool = [
                  `That's all settled. I still need to ${taskPhrase}, which I'll do shortly, and I'll confirm here once it's ready.`,
                  `Payment is complete. The last step is to ${taskPhrase}; I'll have that done and confirm it here.`,
                  `All received. I'll ${taskPhrase} and come back to you here once everything is in place.`,
                ];
              } else if (t.includes('blunt') || t.includes('terse') || t.includes('direct')) {
                pool = [
                  `all settled. still need to ${taskPhrase}. i'll confirm here when it's done.`,
                  `done on payment. last step is to ${taskPhrase}, then you're set.`,
                  `paid up. i'll ${taskPhrase} shortly and come back here.`,
                ];
              } else if (t.includes('chill') || t.includes('relaxed') || t.includes('laid')) {
                pool = [
                  `all sorted on the payment side, just need to ${taskPhrase} and then you're good, i'll come back here once it's done`,
                  `we're all settled up, last thing is to ${taskPhrase} and i'll confirm here`,
                  `that's everything paid, i'll ${taskPhrase} and let you know here once it's in place`,
                ];
              } else {
                pool = [
                  `that's everything settled. the last bit is to ${taskPhrase}, and i'll confirm here once it's done`,
                  `all good on the payment side. i still need to ${taskPhrase}, then you're fully set up`,
                  `you're all paid up ${e('✅')} just the ${taskPhrase} left to do, i'll come back to you here once it's in place`,
                  `everything's gone through. i'll ${taskPhrase} and confirm here once it's ready, shouldn't be long`,
                  `we're settled. last step my end is to ${taskPhrase}, and i'll let you know here the moment it's done`,
                ];
              }
            } else {
              if (t.includes('formal') || t.includes('professional')) {
                pool = [
                  `One moment while I ${taskPhrase}. I'll confirm here as soon as it's ready.`,
                  `I'll ${taskPhrase} now and let you know the moment it's set up.`,
                  `Just need to ${taskPhrase} first, then you're all set.`,
                ];
              } else if (t.includes('blunt') || t.includes('terse') || t.includes('direct')) {
                pool = [
                  `give me a minute, need to ${taskPhrase} first.`,
                  `on it. i'll ${taskPhrase} and confirm here.`,
                  `one step left: ${taskPhrase}. won't be long.`,
                ];
              } else if (t.includes('chill') || t.includes('relaxed') || t.includes('laid')) {
                pool = [
                  `give me a sec to ${taskPhrase} and you're good to go`,
                  `just need to ${taskPhrase} real quick, then you're all set`,
                  `one sec, gotta ${taskPhrase} and then that's you sorted`,
                ];
              } else {
                pool = [
                  `give me a minute to ${taskPhrase} for you ${e('🙏')} i'll confirm here once it's ready`,
                  `just need to ${taskPhrase} on my end, then you're all set`,
                  `one moment while i ${taskPhrase}, i'll let you know here as soon as it's live`,
                  `i'll ${taskPhrase} now and confirm here once it's all in place ${e('🙌')}`,
                ];
              }
            }
        return pool[Math.floor(Math.random() * pool.length)];
  },

  async _runBatch(convId, entries){
    const ilog = this.ilog.bind(this);
    if (!entries.length) return;
    const conv = this.resolveConv(convId);
    if (!conv) {
      ilog('ABORT — could not resolve conversation for event; nothing will be delivered', { conv_id: convId });
      return;
    }
    const agentForConv = (conv.agent_id ? AGENTS_STORE.byId(conv.agent_id) : null) || AGENTS_STORE.defaultActive();
    const toneForConv = ((agentForConv && agentForConv.tone) || 'Friendly').toLowerCase();
    const emojiForConv = !agentForConv || agentForConv.emoji !== false;
    const nowS = () => Math.floor(Date.now() / 1000);
    const note = (text) => {
      try { MSGS_STORE.onOutbound(conv.id, conv.chatId, conv.p, text, { role:'bot', agent:'System', _internal:true }); } catch (_) {}
    };

    // ── REALISM SEND HELPER ───────────────────────────────────────
    // Every customer-facing outbound goes through this. It:
    //   1. Waits a "read delay" (agent sees the payment, glances at phone)
    //   2. Fires a typing indicator and holds for the WPM-computed duration
    //   3. Sends the message
    //   4. Records it in MSGS_STORE
    // Returns true on success, false on failure.
      const realisticSend = async (text, opts = {}) => {
        if (!text || !text.trim()) return false;
        // ── OUTBOUND SANITISER ────────────────────────────────────────
        // These payment-side messages are sent straight to the customer and
        // never pass through the LLM-reply post-processor in api.php, so they
        // miss its em-dash strip. Apply the same cleanup here so a stray em/en
        // dash (from an operator-authored task string or template) never lands
        // as the tell-tale AI " — " connector, and so shouty ALL-CAPS fragments
        // pasted in by the operator don't go out verbatim.
        text = String(text)
          .replace(/\s*[\u2014\u2013]\s*/g, ', ')   // em/en dash → comma
          .replace(/, ,+/g, ',')
          .replace(/ {2,}/g, ' ')
          .replace(/\s+([?.!,])/g, '$1')
          .trim();
        if (!text) return false;
        try {
          const wpm = (agentForConv && agentForConv.wpm) || 75;
          const cps = (wpm * 5) / 60;
          // Read delay: how long before they "notice" the payment / start typing.
          // Skip for follow-on messages in the same burst (opts.skipReadDelay).
          if (!opts.skipReadDelay) {
            const rdBase = toneForConv.includes('blunt') || toneForConv.includes('direct') ? 700
              : toneForConv.includes('formal') || toneForConv.includes('professional') ? 1400 : 1100;
            await sleep(rdBase + Math.floor(Math.random() * 2200));
          } else {
            // Short inter-message gap so messages don't land simultaneously.
            await sleep(1200 + Math.floor(Math.random() * 1400));
          }
          // Typing indicator: fire once, re-fire every 4s for long messages.
          const TICK_LIFESPAN_MS = 4800;
          const typeMs = Math.max(900, Math.min(12000, Math.round((text.length / cps) * 1000)));
          const sendTick = () => {
            if (window.BotBridge && conv.chatId) {
              try { window.BotBridge.sendChatAction(conv.p, conv.chatId, 'typing'); } catch(_) {}
            }
          };
          // ── COMPOSER ──────────────────────────────────────────────────
          // Every message this pipeline sends — payment confirmation, the
          // after-payment delivery, keys, renewal line, manual-setup
          // follow-up — goes through the SAME composer as the agent's own
          // replies: it appears in the chat's composer with the countdown,
          // and the operator can edit, send now or discard it. The countdown
          // IS the typing time (the customer sees "typing…" meanwhile), just
          // like an agent reply.
          //
          // These used to bypass the composer (opts.critical) because a
          // customer typing "paid!" superseded the draft and the message was
          // lost. DRAFT_STORE.review now treats a supersede as "send it
          // anyway", so nothing is lost and nothing is hidden from the
          // operator. Only an explicit Discard holds a message back.
          const useComposer = typeof DRAFT_STORE !== 'undefined' && typeof DRAFT_STORE.review === 'function' && !!(conv && conv.id);
          let tickInterval = null;
          let tickUntil = Date.now() + typeMs;
          const startTicks = (ms) => {
            tickUntil = Date.now() + ms;
            sendTick();
            try { INBOUND_TRACKER.onAgentTyping(conv.id, tickUntil + 1500); } catch (_) {}
            if (tickInterval) clearInterval(tickInterval);
            tickInterval = setInterval(() => {
              if (Date.now() >= tickUntil - TICK_LIFESPAN_MS) return;
              sendTick();
            }, 4000);
          };
          const stopTicks = () => {
            if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
            try { INBOUND_TRACKER.onAgentTypingStop(conv.id); } catch (_) {}
          };
          let finalText = text;
          if (useComposer) {
            startTicks(typeMs);
            let rv;
            try {
              rv = await DRAFT_STORE.review(conv.id, text, { delayMs: typeMs, agent: (agentForConv && agentForConv.name) || 'System' });
            } finally { stopTicks(); }
            if (!rv || !rv.send || !rv.text) {
              // The operator chose not to send it. For a pipeline message
              // that is a decision, not a failure: it is not retried (the
              // watchdog would otherwise keep re-offering it), and the
              // operator gets a note saying what was held back.
              console.log('[invoice] payment-side message discarded by operator for', conv.id);
              if (opts.critical) {
                try { note(`🗑 You discarded this message, so it was not sent and won't be retried: "${String(text).slice(0, 140)}${String(text).length > 140 ? '…' : ''}"`); } catch (_) {}
                return 'discarded';
              }
              return false;
            }
            finalText = rv.text;
            if (rv.superseded) console.log('[invoice] payment-side draft superseded by inbound — sending anyway for', conv.id);
          } else {
            startTicks(typeMs);
            await sleep(typeMs);
            stopTicks();
          }

          // Send.
          try { if (typeof ilog === 'function') ilog('realisticSend → outbound text', { chatId: conv.chatId, len: finalText.length, text: finalText.slice(0, 160) }); } catch (_) {}
          if (window.BotBridge && conv.chatId) {
            window.BotBridge.sendMessage(conv.p, conv.chatId, finalText);
          }
          MSGS_STORE.onOutbound(conv.id, conv.chatId, conv.p, finalText, {
            role: 'bot',
            agent: (agentForConv && agentForConv.name) || 'System',
          });
          return true;
        } catch (err) {
          console.warn('[invoice] realisticSend failed', err && err.message);
          return false;
        }
      };

    // ── WORKING SET ───────────────────────────────────────────────
    // The live invoice row is the source of truth (items, amounts, flags);
    // the event payload only fills in what the row doesn't have.
    const invs = entries.map(({ key, data }) => {
      const row = data.id ? PAYMENTS_STORE.invoices.find(i => i.id === data.id) : null;
      const src = row ? { ...data, ...row } : { ...data };
      if (!src.id && !src.reference) src.reference = 'inv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      return {
        key, data, row, src,
        retry: !!data._retryDelivery,
        needsConfirmMsg: !data._retryDelivery && !(row && row.customer_confirmed_msg_sent),
        fallbackPid: 0,
        units: [],
      };
    });
    const batchIds = invs.map(x => x.src.id).filter(Boolean).map(String);
    ilog('batch starting', {
      conv_id: conv.id,
      invoices: invs.map(x => ({ id: x.src.id, retry: x.retry, confirmed_msg_sent: !!(x.row && x.row.customer_confirmed_msg_sent), delivered: !!(x.row && x.row.delivered), items: Array.isArray(x.src.items) ? x.src.items.length : 0 })),
    });

    // ── RESOLVE MISSING PRODUCT LINKS (single-product invoices) ────────
    // An invoice can carry a product *reference* (catalogue id as a string,
    // or its name) without a numeric product_id — legacy rows, or a mint
    // that stored the name only. Without an id the server records the sale
    // with product_id=NULL and delivery/licence silently skip. Resolve it
    // (id, then case-insensitive name); as a last resort infer it from the
    // chat — but only when exactly ONE unlinked invoice is in this batch,
    // since one inference can't honestly be applied to several orders.
    const unlinked = invs.filter(x => !(Array.isArray(x.src.items) && x.src.items.length) && !x.src.product_id);
    for (const x of invs) {
      if (Array.isArray(x.src.items) && x.src.items.length) continue;
      let pid = Number(x.src.product_id) || 0;
      if (!pid && x.src.product) {
        try {
          let rp = (typeof INVOICE_PROCESSOR !== 'undefined' && INVOICE_PROCESSOR.resolveProduct)
            ? (INVOICE_PROCESSOR.resolveProduct(x.src.product) || null) : null;
          if ((!rp || !rp.id) && typeof PRODS_STORE !== 'undefined' && Array.isArray(PRODS_STORE.list)) {
            const ref = String(x.src.product).trim(), refLc = ref.toLowerCase();
            rp = PRODS_STORE.list.find(p => String(p.id) === ref)
              || PRODS_STORE.list.find(p => String(p.name || '').trim().toLowerCase() === refLc) || null;
          }
          if (rp && rp.id) { pid = rp.id; ilog('resolved missing product_id from data.product', { product: x.src.product, resolved_pid: pid }); }
          else ilog('WARN — could not resolve product_id from data.product', { product: x.src.product });
        } catch (e) { ilog('product_id resolve threw', { error: e && e.message }); }
      }
      if (!pid && unlinked.length === 1 && typeof INVOICE_PROCESSOR !== 'undefined' && INVOICE_PROCESSOR.inferProductFromConv) {
        try {
          const inf = INVOICE_PROCESSOR.inferProductFromConv(conv.id);
          if (inf && inf.id) { pid = inf.id; ilog('inferred product_id from conversation at payment time', { resolved_pid: pid, name: inf.name }); }
          else ilog('WARN — no product on invoice and none inferable from conversation; delivery will be skipped (no_product)');
        } catch (e) { ilog('product inference at payment time threw', { error: (e && e.message) || String(e) }); }
      } else if (!pid && unlinked.length > 1) {
        ilog('WARN — several unlinked invoices in one batch; not guessing a product for each', { id: x.src.id });
      }
      x.fallbackPid = pid;
    }
    invs.forEach(x => {
      try { x.units = INVOICE_ITEMS.units(x.src, x.fallbackPid); } catch (e) { x.units = []; }
      if (!x.units.length) {
        x.units = [{ ref: String(x.src.id || x.src.reference), line_index: 0, unit_index: 0, qty: 1,
                     product_id: x.fallbackPid || null, name: '', amount: '', total_units: 1 }];
      }
      x.label = INVOICE_ITEMS.label(x.src) || (x.units[0] && x.units[0].name) || 'payment';
    });

    // ── STEP 1: PAYMENT CONFIRMATION MESSAGE ──────────────────────
    // ONE message for everything in the batch that hasn't been confirmed to
    // the customer yet. Two payments landing together get "got both,
    // thanks", not two separate confirmations a second apart.
    const toConfirm = invs.filter(x => x.needsConfirmMsg);
    if (toConfirm.length) {
      const data = toConfirm[0].src;
      const count = toConfirm.length;
      // A payment confirmed shortly after another one on this chat reads as
      // "that one's in too" rather than a fresh first confirmation.
      const followOn = count === 1 && (PAYMENTS_STORE.invoices || []).some(i => i && i.conv_id === conv.id
        && !batchIds.includes(String(i.id)) && Number(i.customer_confirmed_msg_at)
        && nowS() - Number(i.customer_confirmed_msg_at) < 15 * 60);
      const coin  = (data.coin || '').toUpperCase();
      const amtCoinDisp = data.amount_coin || data.amount_coin_quoted;
      // ── NO FIGURES IN THE CONFIRMATION ──────────────────────────
      // The figures are computed as grounding for compose_payment_line and
      // the audit trail, never read back to the customer.
          const fiatDisp = (() => {
            const FIAT_SYM = { USD:'$', EUR:'€', GBP:'£', JPY:'¥', AUD:'A$', CAD:'C$', NZD:'NZ$' };
            const fiatCode = String(data.fiat || 'USD').toUpperCase();
            try {
              const fn = (typeof INVOICE_PROCESSOR !== 'undefined' && INVOICE_PROCESSOR.parseFiatAmount)
                ? INVOICE_PROCESSOR.parseFiatAmount(data.amount_fiat) : null;
              if (fn !== null && isFinite(fn) && fn > 0) {
                const fs = INVOICE_PROCESSOR.fmtFiatAmount(fn);
                return `${FIAT_SYM[fiatCode] || ''}${fs}${FIAT_SYM[fiatCode] ? '' : ' ' + fiatCode}`;
              }
            } catch (_) {}
            return '';
          })();
      // ── CONFIRMED MEANS CONFIRMED ───────────────────────────────
      // This pipeline only ever runs for an invoice whose status IS
      // confirmed. An invoice the operator confirmed by hand usually still
      // shows 0 on-chain confirmations, and that 0 used to be sent as
      // kind=payment_partial — so the persona line told a customer who had
      // been confirmed that their payment was "still settling". The kind is
      // now always payment_confirmed, and a confirmation count below the
      // wallet's threshold is never quoted.
      const minConf = Math.max(1, Number(data.min_confirmations) || 1);
      const rawConfs = Math.min(...toConfirm.map(x => Number(x.src.confirmations) || 0));
      const confs = rawConfs >= minConf ? rawConfs : 0;
          const e = (s) => emojiForConv ? s : '';
          const t = toneForConv;
          let pool;
          if (t.includes('formal') || t.includes('professional')) {
            pool = confs <= 1 ? [
              `That's come through, thank you.`,
              `Received, thank you.`,
              `That's arrived. Much appreciated.`,
              `All received. Thank you.`,
              `Confirmed at my end. Thank you.`,
              `Got that, thank you.`,
            ] : [
              `That's fully cleared now. Thank you.`,
              `Settled at ${confs} confirmations. Thank you.`,
              `All the way through now, ${confs} confirmations. Thank you.`,
            ];
          } else if (t.includes('chill') || t.includes('relaxed') || t.includes('laid')) {
            pool = confs <= 1 ? [
              `got it, cheers ${e('🤙')}`,
              `yep that's come through, all good`,
              `all received, thanks`,
              `that's in, we're good`,
              `got that, cheers`,
              `came through fine, thanks`,
              `yep, showing my end. cheers`,
            ] : [
              `all the way through now, ${confs} confs`,
              `settled at ${confs} confs, we're good`,
              `fully cleared now, all good`,
            ];
          } else if (t.includes('blunt') || t.includes('terse') || t.includes('direct')) {
            pool = confs <= 1 ? [
              `got it.`,
              `received, thanks.`,
              `that's in.`,
              `cleared. thanks.`,
              `confirmed.`,
              `got that, ta.`,
            ] : [
              `confirmed, ${confs} confs.`,
              `settled at ${confs} confs.`,
              `fully cleared.`,
            ];
          } else {
            // Default = Friendly / unknown tone. Casual but warm.
            // Avoid "payment received" / "got it" — those overlap with the
            // manual-setup followup wording and sound like repetition.
            pool = confs <= 1 ? [
              `got it, thank you`,
              `that's come through, thanks`,
              `all good, received`,
              `yep that's in, cheers`,
              `got that, thanks a lot`,
              `came through fine, thank you`,
              `received, appreciate it`,
              `that's arrived ${e('✅')} thanks`,
              `all sorted my end, thanks`,
            ] : [
              `fully confirmed now, ${confs} confs. all good`,
              `cleared with ${confs} confirmations, we're set`,
              `all done, confirmed at ${confs} confs. thanks for waiting`,
            ];
          }
          // ── LANGUAGE ────────────────────────────────────────────────
          // Every pool above is English and tone-branched. A customer who
          // has been spoken to in French all the way through the sale was
          // getting "nice, $35 just came through. thanks!" at the most
          // important moment in the transaction.
          //
          // For a non-English conversation we swap to a per-language bank.
          // Those aren't tone-branched — writing five tones × fifteen
          // languages that all sound like a real person is not something
          // I can do well, and a stilted "blunt Korean" variant would read
          // worse than a neutral-friendly one. English keeps its full tone
          // range; everything else gets warm-neutral, which is safe in
          // every register.
          let confirmLang = null;
          try {
            if (typeof IMPERFECTION !== 'undefined' && IMPERFECTION.detectLang) {
              const th = (MSGS_STORE.getThreadSync && MSGS_STORE.getThreadSync(conv.id)) || [];
              // Look at BOTH sides: the agent's own outbound is the strongest
              // signal of the language the customer is being served in, and
              // the customer's inbound covers the cold-start case.
              const sample = th.slice(-10)
                .filter(m => m && (m.r === 'in' || m.r === 'bot'))
                .map(m => m.c || '').join(' ')
                .replace(/\[\[[^\]]*\]\]/g, ' ');
              confirmLang = IMPERFECTION.detectLang(sample);
            }
          } catch (_) {}
          if (confirmLang && confirmLang !== 'en' && PAYMENT_CONFIRM_BANK[confirmLang]) {
            const bank = PAYMENT_CONFIRM_BANK[confirmLang];
            const set  = confs <= 1 ? bank.one : bank.many;
            // `subject` replaces the amount these banks were written around.
            // Same reasoning as the English pools: the figure is theirs and
            // they just sent it. Each language supplies its own natural noun
            // for "the payment" so the sentences still parse.
            pool = set.map(fn => fn(bank.subject || '', confs))
                      .map(t => String(t).replace(/\s{2,}/g, ' ').trim());
          }
          // Random picking repeats, and repeats are exactly what gives this
          // away: a returning customer who has bought three times should not
          // get the identical sentence each time. PHRASE_MEMORY excludes
          // anything recently used on this conversation, and falls back to a
          // plain random pick only once every option has been spent.
      if ((!confirmLang || confirmLang === 'en') && (count > 1 || followOn)) {
        const tt = toneForConv;
        const ee = (s) => emojiForConv ? s : '';
        const both = count === 2;
        if (count > 1) {
          if (tt.includes('formal') || tt.includes('professional')) {
            pool = both ? [`Both payments have come through, thank you.`, `Both received, thank you.`, `That's both of them in. Thank you.`]
                        : [`All ${count} payments have come through, thank you.`, `Everything's received, thank you.`];
          } else if (tt.includes('chill') || tt.includes('relaxed') || tt.includes('laid')) {
            pool = both ? [`got both, cheers ${ee('🤙')}`, `yep both came through, all good`, `both in, we're good`]
                        : [`got all of them, cheers`, `all ${count} came through, all good`];
          } else if (tt.includes('blunt') || tt.includes('terse') || tt.includes('direct')) {
            pool = both ? [`got both.`, `both received, thanks.`, `both in.`]
                        : [`all received.`, `got all ${count}.`];
          } else {
            pool = both ? [`got both, thank you`, `both came through, thanks`, `that's both in, cheers`, `both received ${ee('✅')} thanks`]
                        : [`got all of those, thank you`, `all ${count} came through, thanks`, `everything's in, cheers`];
          }
        } else {
          if (tt.includes('formal') || tt.includes('professional')) {
            pool = [`That one has come through as well, thank you.`, `The other payment is in too. Thank you.`];
          } else if (tt.includes('chill') || tt.includes('relaxed') || tt.includes('laid')) {
            pool = [`that one's in too, cheers`, `got the other one as well, all good`];
          } else if (tt.includes('blunt') || tt.includes('terse') || tt.includes('direct')) {
            pool = [`that one's in too.`, `other one received.`];
          } else {
            pool = [`that one's come through too, thanks`, `got the other one as well, thank you`, `that one's in as well, cheers`];
          }
        }
      }
      const phraseKind = count > 1 ? 'payment_confirm_multi' : 'payment_confirm';
      // Avoid echoing the wording the payment block signed off with — the
      // customer read that line minutes ago and this is the reply to it.
      let confirmText = PHRASE_MEMORY.pickDistinct(conv.id, phraseKind, pool,
        ['invoice_tail', 'invoice_amount', 'payment_confirm', 'payment_confirm_multi']
          .filter(k => k !== phraseKind));

      // ── PERSONA PASS ──────────────────────────────────────────────
      // Ask the server to write the line under the real persona. Every
      // failure path falls back to the pool; the race guard keeps a hung
      // provider from holding up a message the customer is waiting on.
      try {
        const composed = await Promise.race([
          apiFetch('compose_payment_line', {
            conv_id:           conv.id,
            kind:              'payment_confirmed',
            coin,
            amount_coin:       count > 1 ? '' : (amtCoinDisp || ''),
            amount_fiat:       count > 1 ? '' : (data.amount_fiat != null ? String(data.amount_fiat) : ''),
            fiat:              String(data.fiat || 'USD'),
            fiat_display:      count > 1 ? '' : fiatDisp,
            confirmations:     confs,
            min_confirmations: minConf,
            manual_confirm:    rawConfs < minConf ? 1 : 0,
            payments_count:    count,
            follow_on:         followOn ? 1 : 0,
            product:           toConfirm.map(x => x.label).filter(Boolean).join('; ').slice(0, 120),
            lang:              confirmLang || 'en',
            emoji:             emojiForConv ? 1 : 0,
          }),
          new Promise(r => setTimeout(() => r(null), 8000)),
        ]);
        if (composed && composed.text && !composed.error) confirmText = composed.text;
      } catch (_) { /* pool stands */ }
      PHRASE_MEMORY.remember(conv.id, phraseKind, confirmText);

      const confirmOk = await realisticSend(confirmText, { critical: true });
      if (confirmOk) {
        const at = nowS();
        for (const x of toConfirm) {
          if (x.src.id) { try { await PAYMENTS_STORE.updateInvoice(x.src.id, { customer_confirmed_msg_sent: true, customer_confirmed_msg_at: at }); } catch (_) {} }
        }
      }
    }

    // ── STEP 2: record_invoice_payment — ONE CALL PER UNIT ─────────
    // Each unit is its own server transaction, keyed by a reference derived
    // from the invoice id (see INVOICE_ITEMS.units). That is what gives each
    // unit its own licence/serial and its own delivered_at stamp, and it is
    // idempotent: a replay returns duplicate=true for units already recorded.
    const isNonTransient = (msg) => /product not found|conversation not found|end user resolution failed|reference required|conv_id required/i.test(String(msg || ''));
    const results = [];
    let markedCustomer = false;
    const recordArgs = (x, unit, pidForCall) => {
      const base = String(x.src.id || x.src.reference);
      const paidCoin = (x.src.amount_coin || x.src.amount_coin_quoted)
        ? `paid ${x.src.amount_coin || x.src.amount_coin_quoted} ${(x.src.coin || '').split('/').pop().toUpperCase()}` : '';
      const multiUnit = unit.total_units > 1;
      return {
        conv_id:    conv.id,
        reference:  unit.ref,
        product_id: pidForCall,
        renew_license_id: String(x.src.renew_license_id || ''),
        renew_serial:     String(x.src.renew_serial || ''),
        // "N terms on one key": units after the first extend the key the
        // line's first unit got instead of minting their own.
        stack_group: (unit.same_key && unit.unit_index > 0 && unit.stack_group) ? unit.stack_group : '',
        agent_id:   x.src.agent_id || '',
        amount:     multiUnit ? (unit.amount || '') : (x.src.amount_fiat || ''),
        currency:   (x.src.fiat || 'USD').toUpperCase(),
        notes:      [
          x.src.note || x.src.description || '',
          multiUnit ? `${unit.name || 'item'} (unit ${x.units.indexOf(unit) + 1} of ${unit.total_units} on ${base}${unit.same_key ? ', same key' : ''})` : '',
          paidCoin,
        ].filter(Boolean).join(' · '),
      };
    };
    for (const x of invs) {
      for (const unit of x.units) {
        let res = null, lastErr = null, dropped = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const pidForCall = (lastErr && /product not found/i.test(lastErr)) ? (dropped = true, 0) : (unit.product_id || 0);
          try {
            // Renewal of a key the customer already holds (renew= on the
            // invoice) is resolved per unit by the server; the fiat leg is
            // each unit's share (shares add up to the total to the cent).
            res = await apiFetch('record_invoice_payment', recordArgs(x, unit, pidForCall));
            if (res && !res.error) { lastErr = null; break; }
            lastErr = (res && res.error) || 'unknown error';
          } catch (e) {
            lastErr = (e && e.message) || String(e);
            res = null;
          }
          if (lastErr && isNonTransient(lastErr) && !/product not found/i.test(lastErr)) {
            ilog('record_invoice_payment non-transient error, abandoning retries', { ref: unit.ref, error: lastErr });
            break;
          }
          if (attempt < 3) {
            ilog('record_invoice_payment attempt ' + attempt + ' failed — retrying', { ref: unit.ref, error: lastErr });
            await sleep(2000 * attempt);
          }
        }
        const r = { x, unit, res: (lastErr ? null : res), err: lastErr, dropped, state: null };
        if (!r.err && r.res && !markedCustomer) {
          markedCustomer = true;
          try { MSGS_STORE.markCustomer(conv.id); } catch (_) {}
        }
        results.push(r);
      }
    }

    // ── SAME-KEY STACKS ───────────────────────────────────────────
    // For a "N terms on one key" line, the first unit that got a license
    // is the KEEPER; every other unit whose license is that same key is an
    // extra term on it. Extras send nothing of their own (no second copy
    // of the delivery, no "your key is renewed" line) and the keeper's
    // delivery is rebuilt so {EXPIRES} shows the final, stacked date.
    const licIdOf = (r) => Number(r && r.res && r.res.license && r.res.license.license_id) || 0;
    const expOf   = (r) => String((r && r.res && r.res.license && r.res.license.expires_at) || '');
    const stackGroups = new Map();
    results.forEach(r => {
      if (!r.unit.same_key || !r.res || r.err) return;
      const gk = r.x.src.id + '|' + r.unit.line_index;
      if (!stackGroups.has(gk)) stackGroups.set(gk, []);
      stackGroups.get(gk).push(r);
    });
    for (const grp of stackGroups.values()) {
      const keeper = grp.find(r => licIdOf(r));
      if (!keeper) continue;
      const kid = licIdOf(keeper);
      const extras = grp.filter(r => r !== keeper && licIdOf(r) === kid);
      if (!extras.length) continue;
      extras.forEach(r => { r.stacked = true; r.stackKeeper = keeper; });
      keeper.stackTerms = 1 + extras.length;
      const finalExp = [keeper, ...extras].map(expOf).filter(Boolean).sort().pop() || '';
      if (finalExp && keeper.res.license) keeper.res = { ...keeper.res, license: { ...keeper.res.license, expires_at: finalExp } };
      const dlvK = keeper.res.delivery;
      if (dlvK && dlvK.ok && !dlvK.already_delivered && extras.some(r => !r.res.duplicate || !keeper.res.duplicate)) {
        try {
          const again = await apiFetch('record_invoice_payment', recordArgs(keeper.x, keeper.unit, keeper.unit.product_id || 0));
          if (again && !again.error && again.delivery) keeper.res = { ...keeper.res, delivery: again.delivery };
        } catch (_) { /* first-pass delivery stands */ }
      }
      ilog('same-key stack', { invoice: keeper.x.src.id, line: keeper.unit.line_index, license_id: kid, terms: keeper.stackTerms, expires: finalExp });
    }

    // Failures and dropped product links, grouped into one note each.
    const recordFailed = results.filter(r => r.err || !r.res);
    if (recordFailed.length) {
      const missing = recordFailed.filter(r => /product not found/i.test(String(r.err || '')));
      const other = recordFailed.filter(r => !/product not found/i.test(String(r.err || '')));
      missing.forEach(r => { r.state = 'abandoned'; });
      other.forEach(r => { r.state = 'record_failed'; });
      if (missing.length) {
        note(`⚠ Post-payment delivery FAILED for ${[...new Set(missing.map(r => r.unit.name || r.x.label))].join(', ')}: the product no longer exists in your catalogue. Licence NOT auto-issued and Customers-only media NOT sent. Issue and send manually from the Licenses panel (${[...new Set(missing.map(r => r.unit.ref))].join(', ')}).`);
      }
      if (other.length) {
        ilog('record_invoice_payment FAILED after retries — delivery aborted for these units', other.map(r => ({ ref: r.unit.ref, error: r.err || 'no response' })));
        note(`⚠ Post-payment delivery failed for ${[...new Set(other.map(r => r.unit.name || r.x.label))].join(', ')} (${other[0].err || 'no response'}). Licence may not be issued and Customers-only media has NOT been sent. The polling watchdog will retry on its next pass, or issue manually from the Licenses panel.`);
      }
    }
    const droppedUnits = results.filter(r => !r.state && r.dropped);
    if (droppedUnits.length) {
      droppedUnits.forEach(r => { r.state = 'abandoned'; });
      note(`⚠ Recorded WITHOUT a product link for ${[...new Set(droppedUnits.map(r => r.unit.name || r.x.label))].join(', ')}: the product id was rejected by the server. Customers-only media and auto-licence were skipped for ${droppedUnits.length === 1 ? 'it' : 'them'}. Deliver manually from the Licenses panel.`);
    }

    // ── RENEWALS (internal note + one line to the customer) ──────────
    // A renewal keeps the customer's existing serial and gives it a new
    // term. The operator sees exactly which key moved from what date to
    // what date; a key that was suspended/cancelled on purpose is renewed
    // in time only and flagged for a human. The customer is told ONCE
    // (flag on the invoice row survives replays) that the key they already
    // have works again — unless the operator's own post-payment text
    // already quotes the serial, in which case that says it.
    try {
      const renewedAll = results.filter(r => r.res && r.res.license && r.res.license.renewed && !r.stacked);
      const renewed = renewedAll.filter(r => !r.res.duplicate || !(r.x.row && r.x.row.renewal_msg_sent));
      if (renewed.length) {
        const lines = renewed.map(r => {
          const l = r.res.license;
          const n = r.unit.name || (r.res.delivery && r.res.delivery.product_name) || r.x.label || 'license';
          return `${n}${l.serial ? ' ' + l.serial : ''}: ${l.previous_expires_at || (l.expires_at ? '—' : 'no expiry')} → ${l.expires_at || 'no expiry'}${l.held ? ` (still ${l.status || 'switched off'} — reactivate it by hand if that's right)` : ''}`;
        });
        if (!renewedAll.every(r => r.res.duplicate)) {
          note(`🔄 ${renewed.length === 1 ? 'License renewed' : renewed.length + ' licenses renewed'} — same serial, new term. ${lines.join(' · ')}`);
        }
        const heldOnes = renewed.filter(r => r.res.license.held);
        if (heldOnes.length && !renewedAll.every(r => r.res.duplicate)) {
          note(`⚠ The customer paid to renew a key you had ${heldOnes.map(r => r.res.license.status || 'switched off').join('/')}. The time was added but the key is still off. Set it back to active in Licenses if the renewal should go ahead, or refund them.`);
        }
        // One customer-facing line for every key that is working again.
        const toTell = renewed.filter(r => {
          const l = r.res.license;
          if (l.held) return false;
          if (r.x.row && r.x.row.renewal_msg_sent) return false;
          const dtext = String((r.res.delivery && r.res.delivery.text) || '');
          return !(l.serial && dtext.includes(l.serial));
        });
        if (toTell.length) {
          const fmtDate = (d) => {
            if (!d) return '';
            try {
              const dt = new Date(String(d).slice(0, 10) + 'T12:00:00');
              return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
            } catch (_) { return String(d); }
          };
          const one = (l) => {
            const key = l.serial ? `your key ${l.serial}` : 'your license';
            return l.expires_at ? `${key} is renewed and working again until ${fmtDate(l.expires_at)}` : `${key} is renewed and working again`;
          };
          let msg = toTell.length === 1
            ? `${one(toTell[0].res.license)}, same key as before so nothing to change on your side`
            : `all renewed, same keys as before: ${toTell.map(r => one(r.res.license).replace(/^your /, '')).join('; ')}`;
          msg = msg.charAt(0).toUpperCase() + msg.slice(1);
          // Same persona + language as every other line the agent writes.
          // Any failure keeps the plain line above.
          try {
            let rLang = null;
            if (typeof IMPERFECTION !== 'undefined' && IMPERFECTION.detectLang) {
              const th = (MSGS_STORE.getThreadSync && MSGS_STORE.getThreadSync(conv.id)) || [];
              rLang = IMPERFECTION.detectLang(th.slice(-10).filter(m => m && (m.r === 'in' || m.r === 'bot'))
                .map(m => m.c || '').join(' ').replace(/\[\[[^\]]*\]\]/g, ' '));
            }
            const composed = await Promise.race([
              apiFetch('compose_payment_line', {
                conv_id:  conv.id,
                kind:     'license_renewed',
                renewals: JSON.stringify(toTell.map(r => ({
                  product: r.unit.name || (r.res.delivery && r.res.delivery.product_name) || '',
                  serial:  r.res.license.serial || '',
                  expires: r.res.license.expires_at || '',
                  expires_display: fmtDate(r.res.license.expires_at),
                }))),
                lang:     rLang || 'en',
                emoji:    emojiForConv ? 1 : 0,
              }),
              new Promise(r => setTimeout(() => r(null), 8000)),
            ]);
            if (composed && composed.text && !composed.error) msg = composed.text;
          } catch (_) { /* plain line stands */ }
          const ok = await realisticSend(msg, { critical: true });
          if (ok) {
            for (const r of toTell) {
              if (r.x.src.id) { try { await PAYMENTS_STORE.updateInvoice(r.x.src.id, { renewal_msg_sent: true }); } catch (_) {} }
            }
          }
        }
        // Refresh the Licenses view so the new date shows straight away.
        try { window.dispatchEvent(new CustomEvent('bcEvent', { detail: { event: 'licensesChanged', data: { conv_id: conv.id } } })); } catch (_) {}
      }
    } catch (e) { ilog('renewal notice failed (non-fatal)', { error: (e && e.message) || String(e) }); }

    // ── LICENCE AUDIT NOTE (internal) — one line for the whole batch ──
    try {
      // Keys and codes from a stock list are not licences (they are noted
      // below and shown on the invoice), so they are left out here.
      const issued = results.filter(r => r.res && r.res.license && r.res.license.issued && !r.res.license.stock_item);
      if (issued.length) {
        const byName = new Map();
        issued.forEach(r => {
          const n = r.unit.name || (r.res.delivery && r.res.delivery.product_name) || r.x.label || 'product';
          if (!byName.has(n)) byName.set(n, []);
          const l = r.res.license;
          if (l.serial || l.expires_at) byName.get(n).push([l.serial, l.expires_at ? `expires ${l.expires_at}` : ''].filter(Boolean).join(' '));
        });
        const parts = [`✓ ${issued.length === 1 ? 'License' : issued.length + ' licenses'} auto-issued.`];
        byName.forEach((list, n) => { parts.push(list.length ? `${n}: ${list.join(', ')}` : n); });
        note(parts.join(' · '));
      }
      const keepers = results.filter(r => r.stackTerms > 1 && !(r.res && r.res.duplicate && results.filter(e => e.stackKeeper === r).every(e => e.res.duplicate)));
      keepers.forEach(r => {
        const l = r.res.license || {};
        // A key that never runs out has no term to extend — the extra units
        // are simply held on the same serial (server: license_action='shared').
        const lifetime = !l.expires_at || !!l.shared;
        note(`🔗 ${r.unit.name || r.x.label || 'Product'}: ${lifetime ? `${r.stackTerms} bought, all under ONE key` : `${r.stackTerms} terms stacked on ONE key`}${l.serial ? ' ' + l.serial : ''}${l.expires_at ? `, now valid until ${l.expires_at}` : ''}.`);
      });
    } catch (_) {}

    // ── STOCK LIST NOTE (internal) — what was handed out, what ran out ──
    // Items come off the product's "Keys and codes" list on the server. The
    // operator sees which one went to this buyer, a warning when the list
    // is nearly empty, and a clear next step when it ran out mid-sale.
    try {
      const fresh = results.filter(r => r.res && !r.err && !r.res.duplicate && r.res.delivery && !r.res.delivery.already_delivered);
      const given = fresh.flatMap(r => r.res.delivery.stock || []);
      const owed  = fresh.flatMap(r => r.res.delivery.stock_owed || []);
      const left = new Map();
      [...given, ...owed].forEach(s => { if (s && s.product_id) left.set(String(s.product_id), s); });
      if (given.length) {
        const byName = new Map();
        given.forEach(s => { const k = s.name || 'Product'; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(s); });
        const parts = [...byName.entries()].map(([n, list]) => {
          const lbl = String(list[0].label || 'item').toLowerCase();
          const one = list.length === 1 && !String(list[0].item || '').includes('\n') ? ` ${list[0].item}` : '';
          return `${n}: ${list.length === 1 ? lbl : list.length + ' × ' + lbl}${one}`;
        });
        note(`📦 Keys and codes · ${parts.join(' · ')} · Recorded on the invoice.`);
        [...left.values()].filter(s => given.includes(s) && s.left > 0 && s.left <= 3).forEach(s => {
          note(`⚠ ${s.name}: only ${s.left} ${String(s.label || 'item').toLowerCase()}${s.left === 1 ? '' : 's'} left in the stock list. Add more in Catalog → ${s.name} → Keys and codes.`);
        });
      }
      if (owed.length) {
        const names = [...new Set(owed.map(s => s.name).filter(Boolean))];
        const lbl = String(owed[0].label || 'item').toLowerCase();
        note(`⏳ ${names.join(', ')} ran out: this customer paid but there was no ${lbl} left to give them. Their after-payment message is held until then. Add more in Catalog → ${names[0] || 'the product'} → Keys and codes, then choose Send to waiting customers.`);
      }
      // The invoice popup lists what each sale handed out: refresh it.
      if (given.length || owed.length) {
        try { window.dispatchEvent(new CustomEvent('bcEvent', { detail: { event: 'invoiceKeysChanged', data: { conv_id: conv.id } } })); } catch (_) {}
      }
      // Keep the catalogue's "N left" in step without a reload.
      if (left.size && typeof PRODS_STORE !== 'undefined') {
        let changed = false;
        PRODS_STORE.list = PRODS_STORE.list.map(p => {
          const s = left.get(String(p.id));
          if (!s) return p;
          changed = true;
          const c = p.stockCount || {};
          const isOwed = owed.includes(s);
          return {...p, stockCount: {...c, available: Math.max(0, Number(s.left) || 0),
            given: (Number(c.given) || 0) + given.filter(g => String(g.product_id) === String(p.id)).length,
            owed: (Number(c.owed) || 0) + owed.filter(o => String(o.product_id) === String(p.id)).length,
            unsent: Number(c.unsent) || 0}};
        });
        if (changed) PRODS_STORE.notify();
      }
    } catch (_) {}

    // ── STEP 3: COMBINED DELIVERY ─────────────────────────────────
    const serialOfR = (r) => String((r && r.res && r.res.delivery && r.res.delivery.serial)
      || (r && r.res && r.res.license && r.res.license.serial) || '').trim();
    // A payment that only RENEWED a key the customer already holds (not an
    // extra term stacked onto a key bought in this same order). Nothing
    // about it needs delivering or setting up again: the files, setup text,
    // manual tasks and username were all handled when they first bought.
    const isRenewalR = (r) => !!(r && r.res && !r.err && !r.stacked && (
      (r.res.license && r.res.license.renewed) || (r.res.delivery && r.res.delivery.renewal_skip)));
    let deliveredText = '';
    const deliverables = [];
    const noProduct = [];
    const nothingToSend = [];
    for (const r of results) {
      if (r.state) continue;
      if (r.stacked) {
        // Extra term on the keeper's key — the keeper carries the delivery.
        r.state = 'stacked';
        if (r.res.transaction_id) { try { await apiFetch('confirm_delivery', { transaction_id: r.res.transaction_id }); } catch (_) {} }
        continue;
      }
      const dlv = r.res.delivery;
      ilog('record OK — delivery payload', {
        ref: r.unit.ref, transaction_id: r.res.transaction_id, duplicate: r.res.duplicate,
        license_issued: r.res.license ? !!r.res.license.issued : null,
        delivery_ok: dlv ? !!dlv.ok : null, delivery_reason: dlv ? (dlv.reason || null) : null,
        already_delivered: dlv ? !!dlv.already_delivered : null,
        product_id: dlv ? (dlv.product_id || null) : null,
        text_len: dlv && dlv.text ? String(dlv.text).length : 0,
        attachments_count: dlv && Array.isArray(dlv.attachments) ? dlv.attachments.length : 0,
      });
      if (!dlv) { r.state = 'no_delivery'; ilog('WARN — no delivery object on record response', { ref: r.unit.ref }); continue; }
      if (!dlv.ok) { r.state = 'not_ok'; ilog('WARN — delivery.ok=false; nothing delivered for this unit', { ref: r.unit.ref, reason: dlv.reason || null }); continue; }
      if (dlv.already_delivered) { r.state = 'done'; r.alreadyDelivered = true; continue; }
      // Renewal of a key whose delivery already went out with the original
      // purchase: the renewal line (above) is the whole message. Stamped as
      // delivered so the watchdog never replays the full delivery.
      if (dlv.renewal_skip) {
        r.state = 'renewal';
        if (r.res.transaction_id) { try { await apiFetch('confirm_delivery', { transaction_id: r.res.transaction_id }); } catch (_) {} }
        continue;
      }
      const hasText = !!(dlv.text && String(dlv.text).trim());
      const atts = Array.isArray(dlv.attachments) ? dlv.attachments : [];
      if (!hasText && !atts.length) {
        if (dlv.reason === 'no_product' || !dlv.product_id) { r.state = 'no_product'; noProduct.push(r); }
        else { r.state = 'nothing'; nothingToSend.push(r); }
        continue;
      }
      deliverables.push(r);
    }

    if (noProduct.length && noProduct.some(r => !r.x.retry)) {
      note(`⚠ Payment received but ${[...new Set(noProduct.map(r => r.x.label))].join(', ')} ${noProduct.length === 1 ? 'has' : 'have'} NO product linked, so nothing could be auto-delivered for ${noProduct.length === 1 ? 'it' : 'them'}. Attach the correct product in the Payments panel (the next pass delivers automatically), and make sure future invoices include product= or items=.`);
    }
    if (nothingToSend.length) {
      // A product whose only deliverable is its key is not "nothing": the
      // key goes out in its own message below.
      // Waiting on the stock list is not "nothing configured" either.
      const fresh = nothingToSend.filter(r => !r.x.retry && !serialOfR(r) && !((r.res.delivery && r.res.delivery.stock_owed) || []).length);
      if (fresh.length) {
        note(`⚠ Nothing to auto-deliver for ${[...new Set(fresh.map(r => (r.res.delivery && r.res.delivery.product_name) || r.unit.name || 'this product'))].join(', ')}. Add a post-payment message and/or Customers-only media in the Products tab so the next buyer gets their files automatically.`);
      }
      for (const r of nothingToSend) {
        if (r.res.transaction_id) { try { await apiFetch('confirm_delivery', { transaction_id: r.res.transaction_id }); } catch (_) {} }
      }
    }

    if (deliverables.length) {
      const composed = DELIVERY_COMPOSER.compose(deliverables.map(r => ({
        key:         r.unit.ref,
        product_id:  (r.res.delivery && r.res.delivery.product_id) || r.unit.product_id,
        name:        (r.res.delivery && r.res.delivery.product_name) || r.unit.name || '',
        text:        r.res.delivery.text || '',
        attachments: r.res.delivery.attachments || [],
        serial:      serialOfR(r),
      })));
      // ── SEVERAL KEYS IN A MESSAGE WRITTEN FOR ONE ────────────────
      // The merged text now carries every key, but its wording was written
      // for a single one ("here's your key:"). The agent adjusts the
      // wording for several, in its own voice, without touching anything
      // else. Every key, every link and every number must survive or the
      // merged text goes out as it is.
      const multiKeyGroups = composed.groups.filter(g => (g.keys || []).length > 1);
      if (composed.text && multiKeyGroups.length && typeof AGENT_VOICE !== 'undefined') {
        try {
          const src = composed.text;
          const allKeys = [...new Set(composed.groups.flatMap(g => g.keys || []))];
          const links = src.match(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\w+/g) || [];
          const nums = (src.match(/\b\d[\d.,:/-]{2,}\b/g) || []).filter(n => !allKeys.some(k => k.includes(n)));
          const must = [...new Set([...allKeys, ...links, ...nums])];
          const adapted = await AGENT_VOICE.say(conv.id, 'delivery_keys', {
            brief: `TEXT TO ADAPT is the message you send once someone has paid. It was written for ONE key, but this customer bought ${multiKeyGroups.map(g => `${g.keys.length} of ${g.name || 'the product'}`).join(' and ')} on separate keys, and every key is already in it. Change the wording only as much as needed so it reads right for several keys (for example "your key" becomes "your keys"), with each key on its own line. Keep every instruction, step, link, number and line break otherwise exactly as written. Add nothing, remove nothing, no greeting or sign-off. Same language as the text.`,
            sourceText: src,
            mustInclude: must,
            multiline: true,
            maxLen: Math.round(src.length * 1.5) + 200,
            timeoutMs: 12000,
          }, '');
          const lines = (s) => s.split('\n').filter(l => l.trim()).length;
          if (adapted && adapted.length >= src.length * 0.6 && lines(adapted) >= lines(src) - 2) {
            composed.text = adapted;
            ilog('multi-key delivery wording adapted by the agent', { keys: allKeys.length });
          }
        } catch (_) { /* merged text stands */ }
      }
      ilog('combined delivery composed', {
        units: deliverables.length, products: composed.groups.length, multi: composed.multi,
        text_len: composed.text.length, attachments: composed.attachments.length,
      });

      const failedKeys = new Set();
      const failures = [];
      let textOk = true, textDiscarded = false;
      if (composed.text) {
        const chunks = DELIVERY_COMPOSER.chunk(composed.text, (typeof limitFor === 'function') ? limitFor(conv.p) : 4096);
        for (const chunk of chunks) {
          try {
            const ok = await realisticSend(chunk, { skipReadDelay: true, critical: true });
            // Operator discarded it in the composer: their call, not a
            // failure — nothing to retry, and it was not delivered.
            if (ok === 'discarded') { textDiscarded = true; break; }
            if (!ok) { textOk = false; failures.push('post-payment text: send returned false'); break; }
          } catch (err) {
            textOk = false; failures.push('post-payment text: ' + ((err && err.message) || String(err))); break;
          }
        }
        if (!textOk) composed.textOwners.forEach(k => failedKeys.add(k));
        if (textOk && !textDiscarded) deliveredText = composed.text;
        ilog(textOk ? 'post-payment text sent OK' : 'post-payment text send FAILED', { chunks: chunks.length });
      }

      const hasMediaBridge = window.BotBridge && typeof window.BotBridge.sendMedia === 'function';
      let attachOk = 0, attachFail = 0;
      for (let j = 0; j < composed.attachments.length; j++) {
        const e = composed.attachments[j];
        const att = e.att;
        // Short gap between attachments so they don't stack instantly.
        await sleep(1200 + Math.floor(Math.random() * 800));
        try {
          if (window.BotBridge && conv.chatId) {
            if (att.type === 'link') {
              window.BotBridge.sendMessage(conv.p, conv.chatId, (e.caption ? e.caption + '\n' : '') + att.url);
            } else if (hasMediaBridge) {
              let kind = (att.type || 'photo').toLowerCase();
              if (kind === 'image') kind = 'photo';
              if (kind === 'file' || kind === 'document') kind = 'document';
              window.BotBridge.sendMedia(conv.p, conv.chatId, att.url, e.caption || '', kind, att.filename || '');
            } else {
              window.BotBridge.sendMessage(conv.p, conv.chatId, (e.caption ? e.caption + '\n' : '') + att.url);
            }
          } else {
            ilog('WARN — cannot dispatch attachment ' + j + ': BotBridge or chatId missing', { botBridge: !!window.BotBridge, chatId: conv.chatId });
          }
          MSGS_STORE.onOutboundMedia(conv.id, conv.chatId, conv.p, att.url, e.caption || '', att.type || 'image', { role:'bot', agent: (agentForConv && agentForConv.name) || 'System' });
          attachOk++;
        } catch (err) {
          attachFail++;
          e.owners.forEach(k => failedKeys.add(k));
          failures.push(`attachment "${(e.caption || att.type || 'unnamed')}": ${(err && err.message) || String(err)}`);
          ilog('attachment ' + j + ' FAILED', { error: (err && err.message) || String(err) });
        }
      }

      // Stamp each unit that fully made it; anything held back by a failure
      // stays unstamped so the watchdog re-sends only that part.
      for (const r of deliverables) {
        if (failedKeys.has(r.unit.ref)) { r.state = 'partial'; continue; }
        r.state = 'done';
        if (r.res.transaction_id) {
          try { await apiFetch('confirm_delivery', { transaction_id: r.res.transaction_id }); }
          catch (err) { ilog('confirm_delivery FAILED (watchdog will retry)', { ref: r.unit.ref, error: (err && err.message) || String(err) }); }
        }
      }
      const names = composed.groups.map(g => g.label).join(', ');
      if (!failedKeys.size) {
        const summary = `✓ Post-payment delivery sent for ${names}` +
          `${composed.text ? ' · text' : ''}${composed.attachments.length ? ` · ${composed.attachments.length} attachment${composed.attachments.length === 1 ? '' : 's'}` : ''}` +
          `${composed.multi ? ' · combined into one delivery' : ''}`;
        note(summary);
        ilog('DELIVERY SUCCESS — ' + summary);
      } else {
        const failBits = [
          `⚠ Post-payment delivery PARTIAL FAILURE for ${names}.`,
          `Text: ${composed.text ? (textOk ? 'sent' : 'FAILED') : 'n/a'}.`,
          `Attachments: ${attachOk}/${composed.attachments.length} sent${attachFail ? ` (${attachFail} FAILED)` : ''}.`,
        ];
        if (failures.length) failBits.push('Errors: ' + failures.slice(0, 3).join('; ') + '.');
        failBits.push('System will retry the failed part on the next polling pass (~90s).');
        note(failBits.join(' '));
        ilog('DELIVERY PARTIAL FAILURE', { textOk, attachOk, attachFail, failures: failures.slice(0, 3) });
      }
    }

    // ── INVOICE-LEVEL STATE ───────────────────────────────────────
    // An invoice is delivered when every one of its units is settled:
    // delivered, already delivered, nothing configured to send, or abandoned
    // because its product is gone. Anything else leaves it open for the
    // watchdog.
    for (const x of invs) {
      if (!x.src.id) continue;
      const rs = results.filter(r => r.x === x);
      if (!rs.length) continue;
      const states = rs.map(r => r.state);
      const settled = states.every(st => st === 'done' || st === 'nothing' || st === 'abandoned' || st === 'stacked' || st === 'renewal');
      const patch = {};
      if (settled) {
        patch.delivered = true;
        if (states.includes('abandoned')) patch.delivery_failed_reason = 'product_not_found';
        else if (states.every(st => st === 'nothing')) patch.delivery_failed_reason = 'no_media_configured';
      } else if (states.includes('no_product')) {
        patch.delivery_failed_reason = 'no_product';
      }
      if (Object.keys(patch).length) { try { await PAYMENTS_STORE.updateInvoice(x.src.id, patch); } catch (_) {} }
    }

    // ── STEP 3b: SERIAL KEYS THE DELIVERY TEXT DIDN'T CARRY ───────
    // The key only reached the buyer when the operator's post-payment text
    // had a {SERIAL} placeholder. No placeholder (or no text at all) meant
    // a paid customer with no key. Any key that wasn't in what was actually
    // sent goes out now in its own short message — once per invoice.
    try {
      const needSerial = results.filter(r => {
        if (!r.res || r.err || r.stacked || r.alreadyDelivered) return false;
        if (!(r.state === 'done' || r.state === 'nothing')) return false;
        const row = PAYMENTS_STORE.invoices.find(i => i.id === r.x.src.id) || {};
        if (row.serial_msg_sent) return false;
        const k = serialOfR(r);
        if (!k) return false;
        const l = r.res.license || {};
        // A renewal keeps the key they already have; the renewal line says so.
        if (l.renewed) return false;
        // Judged ONLY on what was actually sent. The server's per-unit
        // serial_in_text said "this unit's own text had its key", which was
        // true for every unit of a multi-key order even when the merged
        // message that went out carried only one of them — so the second
        // key was never sent.
        if (deliveredText && deliveredText.includes(k)) return false;
        return true;
      });
      if (needSerial.length) {
        // Casual date ("22 Oct", year only when it isn't this year) — the
        // formal "October 22, 2026" read like a receipt.
        const fmtD = (d) => {
          if (!d) return '';
          try {
            const dt = new Date(String(d).slice(0, 10) + 'T12:00:00');
            if (isNaN(dt)) return String(d);
            const sameYear = dt.getFullYear() === new Date().getFullYear();
            return dt.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
          } catch (_) { return String(d); }
        };
        const groups = new Map();
        needSerial.forEach(r => {
          const name = r.unit.name || (r.res.delivery && r.res.delivery.product_name) || r.x.label || '';
          const exp = String((r.res.license && r.res.license.expires_at) || (r.res.delivery && r.res.delivery.expires_at) || '');
          const gk = name + '|' + exp + '|' + (r.stackTerms || 1);
          if (!groups.has(gk)) groups.set(gk, { product: name, serials: [], expires: exp, expires_display: fmtD(exp), terms: r.stackTerms || 1 });
          const g = groups.get(gk);
          const k = serialOfR(r);
          if (!g.serials.includes(k)) g.serials.push(k);
        });
        const facts = [...groups.values()];
        const totalKeys = facts.reduce((n, g) => n + g.serials.length, 0);
        // Plain fallback, used only when the agent's own model can't write
        // it. Kept flat and short: no greeting, no cheer, no upsell.
        const sameExp = new Set(facts.map(g => g.expires_display)).size === 1 ? facts[0].expires_display : '';
        let msg;
        if (totalKeys === 1) {
          const g = facts[0];
          msg = `here's your key${g.product ? ' for ' + g.product : ''}:\n${g.serials[0]}`
            + (g.terms > 1 ? `\nall ${g.terms} are on this one key` : '')
            + (g.expires_display ? `\ngood till ${g.expires_display}` : '');
        } else if (facts.length === 1) {
          const g = facts[0];
          msg = `here are your ${g.serials.length} keys${g.product ? ' for ' + g.product : ''}, one each:\n${g.serials.join('\n')}`
            + (g.expires_display ? `\n${g.serials.length === 2 ? 'both' : 'all'} good till ${g.expires_display}` : '');
        } else {
          msg = `here are your keys:\n` + facts.map(g => (g.product ? g.product + ':\n' : '') + g.serials.join('\n')
            + (g.expires_display && !sameExp ? `\ngood till ${g.expires_display}` : '')).join('\n\n')
            + (sameExp ? `\nall good till ${sameExp}` : '');
        }
        const t0 = toneForConv;
        if (t0.includes('formal') || t0.includes('professional')) msg = msg.charAt(0).toUpperCase() + msg.slice(1);
        try {
          let sLang = null;
          if (typeof IMPERFECTION !== 'undefined' && IMPERFECTION.detectLang) {
            const th = (MSGS_STORE.getThreadSync && MSGS_STORE.getThreadSync(conv.id)) || [];
            sLang = IMPERFECTION.detectLang(th.slice(-10).filter(m => m && (m.r === 'in' || m.r === 'bot'))
              .map(m => m.c || '').join(' ').replace(/\[\[[^\]]*\]\]/g, ' '));
          }
          const composedS = await Promise.race([
            apiFetch('compose_payment_line', {
              conv_id: conv.id, kind: 'serial_delivery',
              serials: JSON.stringify(facts.map(g => ({ product: g.product, serials: g.serials, expires_display: g.expires_display, terms: g.terms }))),
              lang: sLang || 'en', emoji: emojiForConv ? 1 : 0,
            }),
            new Promise(r => setTimeout(() => r(null), 15000)),
          ]);
          if (composedS && composedS.text && !composedS.error
              && facts.every(g => g.serials.every(k => composedS.text.includes(k)))) msg = composedS.text;
        } catch (_) { /* plain message stands */ }
        const okS = await realisticSend(msg, { skipReadDelay: true, critical: true });
        if (okS) {
          const ids = [...new Set(needSerial.map(r => r.x.src.id).filter(Boolean))];
          for (const id of ids) { try { await PAYMENTS_STORE.updateInvoice(id, { serial_msg_sent: true }); } catch (_) {} }
          note(`🔑 Sent the customer their key${totalKeys === 1 ? '' : 's'} in a separate message because the post-payment text didn't include ${totalKeys === 1 ? 'it' : 'them'}. Add {SERIAL} to the product's after-payment message to have it in the same message next time.`);
        } else {
          note(`⚠ The customer's key${totalKeys === 1 ? '' : 's'} could NOT be sent (${facts.map(g => g.serials.join(', ')).join('; ')}). Send ${totalKeys === 1 ? 'it' : 'them'} manually.`);
        }
      }
    } catch (err) { ilog('serial message threw', { error: (err && err.message) || String(err) }); }

    // ── STEP 4: POST-SALE SETUP, THEN THE MANUAL-SETUP FOLLOW-UP ──
    // Order matters and used to be wrong: the "i still need to <tasks>"
    // message went out (and Stop After Sale took the agent off) straight
    // after delivery, so a product that also asks for a USERNAME or offers
    // ACCOUNT HELP never got either. Now:
    //   • username / account help needed → POST_SALE_ONBOARDING runs them
    //     with the agent; the manual-setup message and the stop wait for it
    //     (tasks are stored with the setup state, so a reload loses nothing);
    //   • nothing to ask → the manual-setup message goes out now, as before.
    // Tasks and flags include the products inside a package.
    let onboardingHeld = false;
    try {
      // Renewals don't count: their setup was done with the first purchase.
      const recordedFor = (x) => results.some(r => r.x === x && r.res && !r.err && !isRenewalR(r));
      const invRow = (x) => PAYMENTS_STORE.invoices.find(i => i.id === x.src.id) || {};
      const manualInvs = invs.filter(x => !x.retry && recordedFor(x) && !invRow(x).manual_msg_sent);
      const prodById = (pid) => (pid ? ((PRODS_STORE.list || []).find(p => String(p.id) === String(pid)) || null) : null);
      const withChildren = (prod) => {
        const out = prod ? [prod] : [];
        if (prod && prod.type === 'pkg' && Array.isArray(prod.products)) {
          prod.products.forEach(cid => { const c = prodById(cid); if (c && String(c.id) !== String(prod.id)) out.push(c); });
        }
        return out;
      };
      const rawTasks = [];
      const contributors = new Set();
      manualInvs.forEach(x => {
        const pids = [...new Set(results.filter(r => r.x === x && r.res && !r.err && !isRenewalR(r))
          .map(r => r.unit.product_id).filter(Boolean).map(String))];
        const prods = pids.map(prodById).filter(Boolean);
        if (!prods.length && x.src.product && typeof INVOICE_PROCESSOR !== 'undefined' && INVOICE_PROCESSOR.resolveProduct) {
          const rp = INVOICE_PROCESSOR.resolveProduct(x.src.product);
          if (rp) prods.push(rp);
        }
        prods.forEach(prod => withChildren(prod).forEach(pp => {
          (Array.isArray(pp.manualTasks) ? pp.manualTasks : []).forEach(tt => {
            const st = String(tt || '').trim();
            if (st) { rawTasks.push(st); contributors.add(x); }
          });
        }));
      });
      // A stock list that ran out before this sale: the item is still to
      // come, so the agent says so the same way as any step done by hand.
      manualInvs.forEach(x => {
        results.filter(r => r.x === x && r.res && !r.err && !isRenewalR(r)).forEach(r => {
          ((r.res.delivery && r.res.delivery.stock_owed) || []).forEach(s => {
            rawTasks.push(`send over your ${String((s && s.label) || 'code').toLowerCase()}`);
            contributors.add(x);
          });
        });
      });
      const seenTask = new Set();
      const tasks = rawTasks.filter(st => { const k = st.toLowerCase().replace(/\s+/g, ' '); if (seenTask.has(k)) return false; seenTask.add(k); return true; });

      // Setup steps owed by the customer: one entry per KEY (a stacked
      // key counts once), account help once per product.
      const obItems = [];
      const seenLic = new Set();
      results.forEach(r => {
        if (!r.res || r.err || r.stacked || r.state === 'abandoned' || r.state === 'record_failed') return;
        if (r.x.retry) return;
        const row = invRow(r.x);
        if (row.manual_msg_sent || row.onboarding_started) return;
        if (isRenewalR(r)) return;   // username / account were set up when they first bought
        const prod = prodById(r.unit.product_id || (r.res.delivery && r.res.delivery.product_id));
        if (!prod) return;
        const fam = withChildren(prod);
        const wantUser = fam.some(pp => pp && pp.allowUsername);
        const wantAcc  = fam.some(pp => pp && pp.allowAccountCreation);
        if (!wantUser && !wantAcc) return;
        const lid = licIdOf(r);
        if (lid && seenLic.has(lid)) return;
        if (lid) seenLic.add(lid);
        obItems.push({ license_id: lid, product_id: Number(prod.id), product: r.unit.name || prod.name || '',
                       serial: serialOfR(r), need_username: wantUser && !!lid, account_help: wantAcc, _x: r.x });
      });

      const obActive = typeof POST_SALE_ONBOARDING !== 'undefined' && POST_SALE_ONBOARDING.isActive(conv.id);
      if (typeof POST_SALE_ONBOARDING !== 'undefined' && (obItems.length || (obActive && tasks.length))) {
        const gate = POST_SALE_ONBOARDING.canRun(conv, agentForConv);
        if (gate.ok) {
          const heldInvs = new Set([...obItems.map(i => i._x), ...contributors]);
          const started = await POST_SALE_ONBOARDING.start(conv, agentForConv, {
            items: obItems.map(({ _x, ...rest }) => rest),
            tasks,
            invoiceIds: [...heldInvs].map(x => x.src.id).filter(Boolean).map(String),
            stopAfter: !!(agentForConv && agentForConv.stopAfterSale),
          });
          if (started.needed) {
            onboardingHeld = true;
            for (const x of heldInvs) {
              if (x.src.id) { try { await PAYMENTS_STORE.updateInvoice(x.src.id, { onboarding_started: true, manual_msg_sent: true }); } catch (_) {} }
            }
            const what = [];
            if (obItems.some(i => i.need_username)) what.push('the username');
            if (obItems.some(i => i.account_help)) what.push('account help');
            note(`⏳ Post-sale setup started${what.length ? ' (' + what.join(' + ') + ')' : ''}. ${tasks.length ? 'The manual-setup message' : 'Wrap-up'}${agentForConv && agentForConv.stopAfterSale ? ' and Stop After Sale' : ''} will follow once the customer has done it.`);
            ilog('post-sale onboarding started', { conv_id: conv.id, items: obItems.length, tasks: tasks.length });
          } else if (started.error) {
            ilog('post-sale onboarding could not start — carrying on without it', { error: started.error });
          }
        } else if (obItems.length) {
          const names = [...new Set(obItems.map(i => i.product).filter(Boolean))].join(', ') || 'this order';
          const what = [obItems.some(i => i.need_username) ? 'their username' : '', obItems.some(i => i.account_help) ? 'help creating an account' : ''].filter(Boolean).join(' and ');
          note(`⚠ ${names} needs ${what} from the customer, but the agent can't handle it here (${gate.reason}). Please ask them yourself.`);
        }
      }

      if (!onboardingHeld && tasks.length) {
        // The "last thing you'll hear from me" wording only when the agent
        // really is about to stop — not while another payment is still open.
        const stopAfter = (typeof POST_SALE_POLICY !== 'undefined')
          ? POST_SALE_POLICY.wouldStop(conv, agentForConv, { excludeIds: batchIds })
          : !!(agentForConv && agentForConv.stopAfterSale);
        const followupText = await this.manualFollowupLine(conv, tasks, toneForConv, emojiForConv, stopAfter);
        if (followupText) {
          await realisticSend(followupText, { skipReadDelay: true, critical: true });
          for (const x of contributors) {
            if (x.src.id) { try { await PAYMENTS_STORE.updateInvoice(x.src.id, { manual_msg_sent: true }); } catch (_) {} }
          }
        }
      }
    } catch (err) { ilog('post-sale setup / manual follow-up threw', { error: (err && err.message) || String(err) }); }

    // ── STEP 5: STOP AFTER SALE ───────────────────────────────────
    // Captured as late as possible but still before the unassign, so an
    // operator who takes the conversation over during the wind-down keeps
    // it. POST_SALE_POLICY defers the stop while any other payment on this
    // chat is still open, and while a post-sale setup is running (that
    // applies the stop itself once it has sent the manual-setup message).
    const postSaleAssignSeq = MSGS_STORE._assignSeq;
    // A batch that only renewed keys the customer already had is not a new
    // sale: nothing needs setting up by hand, so the agent stays on.
    const onlyRenewals = results.some(r => r.res && !r.err) && results.filter(r => r.res && !r.err && !r.stacked).every(isRenewalR);
    if (onlyRenewals) {
      const skipped = results.some(r => r.state === 'renewal');
      note(`🔄 Renewal only${skipped ? ': the after-payment delivery was not sent again (they got it with their original purchase, and the agent can re-send it if they ask)' : ''}. ${agentForConv && agentForConv.stopAfterSale ? 'Stop After Sale skipped, since there is nothing new to set up.' : ''}`.trim());
    }
    if (!onlyRenewals && !onboardingHeld && agentForConv && agentForConv.stopAfterSale && results.some(r => r.res && !r.err)) {
      try {
        const paidAt = Math.max(0, ...invs.map(x => Number(x.src.confirmed_at) || 0)) || nowS();
        const outcome = POST_SALE_POLICY.afterPayment(conv, agentForConv, { seq: postSaleAssignSeq, excludeIds: batchIds, paidAt });
        ilog('stop-after-sale → ' + outcome, { conv_id: conv.id });
      } catch (e) { ilog('stop-after-sale evaluation failed', { error: e && e.message }); }
    }

    ilog('batch finished', { conv_id: conv.id, units: results.map(r => ({ ref: r.unit.ref, state: r.state })) });
  },
};


// ── POST-SALE ONBOARDING ──────────────────────────────────────────────
// Runs AFTER payment confirmation + delivery (+ the separate serial message)
// and BEFORE the manual-setup message and Stop After Sale, for products that
// "Ask for a username" and/or offer "Help create an account" (a package
// counts when any product inside it does).
//
//   start()   stores the steps server-side (bc_conversations.post_sale_
//             onboarding) and has the agent open the first step in its own
//             voice (a forced AI turn; a plain fallback message if that turn
//             never goes out).
//   onReply() every AI reply carries the updated state: usernames bound to
//             the licence, account help marked done.
//   finish()  once every step is done (or the setup times out / the agent is
//             taken off): manual-setup message → Stop After Sale.
//
// While a setup is active the server keeps the stop-after-sale gate open,
// POST_SALE_POLICY defers the stop, and read receipts stay normal.
const POST_SALE_ONBOARDING = {
  TTL_S: 24 * 3600,                 // must match BC_ONB_TTL_S in api.php
  KICKOFF_FALLBACK_MS: 150 * 1000,
  _finishing: new Set(),
  _timer: null,

  _conv(convId){ return ((typeof MSGS_STORE !== 'undefined' && MSGS_STORE.list) || []).find(m => m && m.id === convId) || null; },
  stateOf(convId){ const c = this._conv(convId); return (c && c.onboarding) || null; },
  _age(st){ return Math.floor(Date.now() / 1000) - (Number(st && st.started_at) || 0); },
  isActive(convId){
    const st = this.stateOf(convId);
    return !!(st && st.status === 'active' && Number(st.started_at) > 0 && this._age(st) <= this.TTL_S);
  },
  // Active by status, whatever its age — a setup that still owes the
  // customer its wrap-up message.
  hasUnfinished(convId){ const st = this.stateOf(convId); return !!(st && st.status === 'active'); },
  _open(st){
    const items = (st && Array.isArray(st.items)) ? st.items : [];
    return {
      user: items.filter(i => i && i.need_username && !String(i.username || '').trim()),
      acc:  items.filter(i => i && i.account_help && !i.account_done),
    };
  },
  _note(conv, text){
    try { MSGS_STORE.onOutbound(conv.id, conv.chatId, conv.p, text, { role:'bot', agent:'System', _internal:true }); } catch (_) {}
  },
  _agentFor(conv){
    try { return (conv.agent_id ? AGENTS_STORE.byId(conv.agent_id) : null) || AGENTS_STORE.defaultActive(); } catch (_) { return null; }
  },

  canRun(conv, agent){
    if (typeof AI_MASTER !== 'undefined' && AI_MASTER && AI_MASTER.enabled === false) return { ok:false, reason:'AI is switched off' };
    if (!conv || !conv.agent_id) return { ok:false, reason:'no agent is assigned' };
    if (!conv.auto_reply) return { ok:false, reason:'auto-reply is off' };
    if (!agent || agent.active === false) return { ok:false, reason:'the agent is paused' };
    try { if (typeof AI_REPLY_QUEUE !== 'undefined' && AI_REPLY_QUEUE.isEscalationPaused(conv)) return { ok:false, reason:'the chat is escalated' }; } catch (_) {}
    try {
      if (typeof AI_REPLY_QUEUE !== 'undefined') {
        const g = AI_REPLY_QUEUE.shouldReply(conv, agent, {});
        if (!g.ok) return { ok:false, reason: g.reason };
      }
    } catch (_) {}
    return { ok:true };
  },

  async start(conv, agent, opts = {}){
    let res = null;
    try {
      res = await apiFetch('onboarding', {
        op: 'start', conv_id: conv.id,
        items: JSON.stringify(opts.items || []),
        tasks: JSON.stringify(opts.tasks || []),
        invoice_ids: JSON.stringify(opts.invoiceIds || []),
        stop_after: opts.stopAfter ? 1 : 0,
      });
    } catch (e) { res = { error: (e && e.message) || String(e) }; }
    if (!res || res.error) return { needed: false, error: (res && res.error) || 'no response' };
    const live = this._conv(conv.id) || conv;
    if (res.state) live.onboarding = res.state;
    if (!res.needed) return { needed: false };
    if (!(res.state && res.state.kickoff_sent)) this._kickoff(live);
    this._ensureTimer();
    try { MSGS_STORE.notify(); } catch (_) {}
    return { needed: true, state: res.state };
  },

  // The agent writes first: one forced AI turn flagged as the kickoff so the
  // server hands it the "open the first step" instruction.
  _kickoff(conv){
    conv._onbKickoffAt = Date.now();
    conv._onbKickoffDone = false;
    try {
      if (!AI_REPLY_QUEUE._forceRun) AI_REPLY_QUEUE._forceRun = new Set();
      AI_REPLY_QUEUE._forceRun.add(conv.id);
      AI_REPLY_QUEUE.enqueue(conv.id);
    } catch (e) { console.warn('[onboarding] kickoff enqueue failed', e && e.message); }
  },

  _kickoffText(st){
    const o = this._open(st);
    const names = (list) => [...new Set(list.map(i => i.product).filter(Boolean))];
    if (o.user.length) {
      const n = names(o.user);
      return n.length === 1
        ? `quick one so i can finish setting up your ${n[0]}: what username do you want it tied to?`
        : `quick one so i can finish setting everything up: what username do you want your ${n.join(' and ')} tied to?`;
    }
    const n = names(o.acc);
    return `do you already have an account for ${n.length ? n.join(' and ') : 'it'}, or do you want me to walk you through setting one up?`;
  },

  // Same question in the conversation's language (AGENT_Q in bot-engine.jsx:
  // built-in wording, else the agent's model, English only as a last resort).
  async _kickoffTextLocalized(conv, st){
    const o = this._open(st);
    const names = (list) => [...new Set(list.map(i => i.product).filter(Boolean))];
    if (typeof AGENT_Q !== 'undefined') {
      try {
        const t = await AGENT_Q.onboarding(conv.id, { user: names(o.user), acc: names(o.acc) }, conv._replyLang || '');
        if (t) return t;
      } catch (_) {}
    }
    return this._kickoffText(st);
  },

  async _send(conv, agent, text){
    text = String(text || '')
      .replace(/\s*[\u2014\u2013]\s*/g, ', ')
      .replace(/ {2,}/g, ' ')
      .trim();
    if (!text) return false;
    try {
      const wpm = (agent && agent.wpm) || 75;
      const cps = (wpm * 5) / 60;
      await sleep(1400 + Math.floor(Math.random() * 1800));
      const typeMs = Math.max(900, Math.min(12000, Math.round((text.length / cps) * 1000)));
      const tick = () => { try { if (window.BotBridge && conv.chatId) window.BotBridge.sendChatAction(conv.p, conv.chatId, 'typing'); } catch (_) {} };
      tick();
      const iv = setInterval(tick, 4000);
      try { INBOUND_TRACKER.onAgentTyping(conv.id, Date.now() + typeMs + 1500); } catch (_) {}
      // Same composer + countdown as the agent's replies (see
      // DRAFT_STORE.review); the countdown is the typing time.
      if (typeof DRAFT_STORE !== 'undefined' && typeof DRAFT_STORE.review === 'function') {
        let rv;
        try { rv = await DRAFT_STORE.review(conv.id, text, { delayMs: typeMs, agent: (agent && agent.name) || 'System' }); }
        finally { clearInterval(iv); try { INBOUND_TRACKER.onAgentTypingStop(conv.id); } catch (_) {} }
        if (!rv || !rv.send || !rv.text) {
          this._note(conv, `🗑 You discarded this message, so it was not sent: "${text.slice(0, 140)}${text.length > 140 ? '…' : ''}"`);
          return true;   // the operator's decision, not a send failure
        }
        text = rv.text;
      } else {
        await sleep(typeMs);
        clearInterval(iv);
        try { INBOUND_TRACKER.onAgentTypingStop(conv.id); } catch (_) {}
      }
      if (window.BotBridge && conv.chatId) window.BotBridge.sendMessage(conv.p, conv.chatId, text);
      MSGS_STORE.onOutbound(conv.id, conv.chatId, conv.p, text, { role:'bot', agent: (agent && agent.name) || 'System' });
      return true;
    } catch (e) {
      console.warn('[onboarding] send failed', e && e.message);
      return false;
    }
  },

  // Called by the engine with payload.onboarding after every AI turn while
  // a setup is open.
  onReply(convId, onb, replyText){
    const conv = this._conv(convId);
    if (!conv || !onb) return;
    conv.onboarding = onb;
    const spoke = String(replyText || '').replace(/\[\[[^\]]*\]\]/g, '').trim() !== '';
    if (conv._onbKickoffAt && (spoke || onb.kickoff_sent)) conv._onbKickoffDone = true;
    (Array.isArray(onb.changes) ? onb.changes : []).forEach(ch => {
      if (ch.type === 'username') {
        this._note(conv, `👤 Username "${ch.username}" bound to ${ch.product || 'the licence'}${ch.serial ? ' (' + ch.serial + ')' : ''}${ch.backstop ? ' — taken from the customer\'s reply' : ''}.`);
      } else if (ch.type === 'account') {
        this._note(conv, `✓ Account help for ${ch.product || 'the product'} marked done.`);
      }
    });
    if (onb.status === 'active' && onb.complete) conv._onboardingFinishAfterTurn = true;
    try { MSGS_STORE.notify(); } catch (_) {}
  },

  // reason: 'complete' | 'expired' | 'cancelled'
  async finish(convId, reason = 'complete'){
    if (this._finishing.has(convId)) return;
    this._finishing.add(convId);
    try {
      const conv = this._conv(convId);
      if (!conv) return;
      let st = conv.onboarding;
      try {
        const g = await apiFetch('onboarding', { op: 'get', conv_id: convId });
        if (g && !g.error && g.state) st = g.state;
      } catch (_) {}
      if (!st || st.status !== 'active') { conv.onboarding = st || null; return; }
      const agent = this._agentFor(conv);
      const o = this._open(st);
      const covered = reason !== 'cancelled' && !!conv.agent_id;
      const tasks = Array.isArray(st.tasks) ? st.tasks.filter(Boolean) : [];

      if (o.user.length || o.acc.length) {
        const bits = [];
        if (o.user.length) bits.push(`username for ${[...new Set(o.user.map(i => i.product || 'licence'))].join(', ')}`);
        if (o.acc.length) bits.push(`account help for ${[...new Set(o.acc.map(i => i.product || 'product'))].join(', ')}`);
        this._note(conv, `⚠ Post-sale setup ${reason === 'expired' ? 'timed out' : reason === 'cancelled' ? 'stopped (the agent is no longer covering this chat)' : 'ended'} with steps still open: ${bits.join('; ')}. Follow up with the customer yourself.`);
      } else {
        const users = (st.items || []).filter(i => i.need_username && i.username).map(i => `${i.product || 'licence'} → ${i.username}`);
        this._note(conv, `✓ Post-sale setup finished${users.length ? ' · ' + users.join(', ') : ''}.`);
      }

      if (tasks.length) {
        if (covered) {
          const stopAfter = !!(agent && agent.stopAfterSale) && (typeof POST_SALE_POLICY !== 'undefined'
            ? POST_SALE_POLICY.wouldStop(conv, agent, { excludeIds: st.invoice_ids || [] }) : true);
          const tone = ((agent && agent.tone) || 'Friendly').toLowerCase();
          const text = await INVOICE_PIPELINE.manualFollowupLine(conv, tasks, tone, !agent || agent.emoji !== false, stopAfter);
          const ok = text ? await this._send(conv, agent, text) : false;
          if (!ok) this._note(conv, `⚠ The manual-setup message could not be sent. Still to do: ${tasks.join('; ')}.`);
        } else {
          this._note(conv, `📝 Manual setup still to do for this customer: ${tasks.join('; ')}.`);
        }
      }

      try { await apiFetch('onboarding', { op: 'finish', conv_id: convId, status: reason }); } catch (_) {}
      conv.onboarding = { ...st, status: reason, finished_at: Math.floor(Date.now() / 1000), complete: !o.user.length && !o.acc.length };
      delete conv._onbKickoffAt;
      delete conv._onbKickoffDone;
      delete conv._onboardingFinishAfterTurn;

      // Stop After Sale — now, after the wrap-up message, never before it.
      if (covered && agent && agent.stopAfterSale && typeof POST_SALE_POLICY !== 'undefined') {
        try {
          const outcome = POST_SALE_POLICY.afterPayment(conv, agent, {
            seq: MSGS_STORE._assignSeq,
            excludeIds: st.invoice_ids || [],
            paidAt: Number(st.started_at) || 0,
            fromOnboarding: true,
          });
          console.log('[onboarding] stop-after-sale →', outcome, convId);
          if (outcome === 'stopped') { try { AI_REPLY_QUEUE._setStatus(convId, 'paused'); } catch (_) {} }
        } catch (e) { console.warn('[onboarding] stop-after-sale failed', e && e.message); }
      }
    } finally {
      this._finishing.delete(convId);
      try { MSGS_STORE.notify(); } catch (_) {}
    }
  },

  _queueBusy(convId){
    try {
      const q = AI_REPLY_QUEUE.queues.get(convId);
      if (q && (q.running || (q.jobs && q.jobs.length))) return true;
    } catch (_) {}
    try { if (INVOICE_PIPELINE.isBusy(convId)) return true; } catch (_) {}
    return false;
  },

  // Housekeeping: kickoff fallback, time-outs, agent taken off, and a setup
  // that completed while the app was closed.
  async _sweep(){
    const list = ((typeof MSGS_STORE !== 'undefined' && MSGS_STORE.list) || []).filter(c => c && c.onboarding && c.onboarding.status === 'active');
    for (const conv of list) {
      if (this._finishing.has(conv.id)) continue;
      try {
        const st = conv.onboarding;
        if (!conv.agent_id) { await this.finish(conv.id, 'cancelled'); continue; }
        let paused = false;
        try { paused = AI_REPLY_QUEUE.isEscalationPaused(conv); } catch (_) {}
        if (this._age(st) > this.TTL_S) {
          if (this._queueBusy(conv.id)) continue;
          await this.finish(conv.id, paused ? 'cancelled' : 'expired');
          continue;
        }
        if (paused || this._queueBusy(conv.id)) continue;
        const o = this._open(st);
        if (!o.user.length && !o.acc.length) { await this.finish(conv.id, 'complete'); continue; }
        if (!st.kickoff_sent && !conv._onbKickoffDone) {
          const agent = this._agentFor(conv);
          if (!conv._onbKickoffAt) {
            if (this.canRun(conv, agent).ok) this._kickoff(conv);
          } else if (Date.now() - conv._onbKickoffAt > this.KICKOFF_FALLBACK_MS) {
            // The agent's turn never went out (provider error, reply dropped):
            // ask plainly so the customer isn't left waiting.
            conv._onbKickoffDone = true;
            const ok = await this._send(conv, agent, await this._kickoffTextLocalized(conv, st));
            if (ok) {
              try { const r = await apiFetch('onboarding', { op: 'kickoff', conv_id: conv.id }); if (r && r.state) conv.onboarding = r.state; } catch (_) {}
            }
          }
        }
      } catch (e) { console.warn('[onboarding] sweep failed for', conv.id, e && e.message); }
    }
  },

  _ensureTimer(){
    if (this._timer) return;
    this._timer = setInterval(() => { this._sweep().catch(() => {}); }, 30 * 1000);
  },
};
POST_SALE_ONBOARDING._ensureTimer();


// Wire .NET events → stores. Single global listener — components must NOT
// attach their own duplicates (would cause every store to update twice).
window.addEventListener('bcEvent', e=>{
  const {event,data}=e.detail;
  if (event==='telegramStatus') {
    CONN_STORE.set('telegram', data);
    if (data && data.connected) {
      const meta = { botName:data.botName||'', username:data.username||'', botId:data.botId||'', avatar:data.avatar||'' };
      CRED_STORE.set('tg_bot_profile', '', meta);
      TG_AUTH_STORE.close();
      CONN_STORE.addLog('telegram', 'ok', 'Connected' + (data.username ? ' as ' + data.username : '') + (data.mode === 'user' ? ' (User API)' : ' (Bot API)'));
      // Startup peer warm — resolve ALL known Telegram contacts so the ghost
      // can send proactively without needing a prior inbound this session.
      //
      // RACE FIX: telegramStatus fires early (before get_conversations returns).
      // We schedule the warm-up to run as soon as MSGS_STORE has data. If it's
      // already loaded we run immediately; otherwise we poll briefly and also
      // listen for the first MSGS_STORE notify. We also load the server-side
      // peer cache (bc_tg_peer_cache) and resolve any peers stored there that
      // aren't already in MSGS_STORE — covers proactive contacts who have never
      // messaged this session.
      const _doPeerWarm = (extraPeers) => {
        try {
          if (!window.BotBridge || typeof window.BotBridge.resolvePeer !== 'function') return;
          // Merge MSGS_STORE contacts + server-cached peers, deduplicated by chatId.
          const seen = new Set();
          const toResolve = [];
          const storeList = (typeof MSGS_STORE !== 'undefined' && Array.isArray(MSGS_STORE.list)) ? MSGS_STORE.list : [];
          storeList.forEach(c => {
            if ((c.p || c.platform || '').toLowerCase() !== 'telegram') return;
            const cid = String(c.chatId || c.chat_id || '');
            if (!cid || seen.has(cid)) return;
            seen.add(cid);
            toResolve.push({ cid, handle: String(c.handle || c.h || '').trim().replace(/^@/, '') });
          });
          if (Array.isArray(extraPeers)) {
            extraPeers.forEach(p => {
              const cid = String(p.chat_id || '');
              if (!cid || seen.has(cid)) return;
              seen.add(cid);
              toResolve.push({ cid, handle: String(p.handle || '').trim().replace(/^@/, '') });
            });
          }
          toResolve.forEach(({ cid, handle }, i) => {
            setTimeout(() => {
              try { window.BotBridge.resolvePeer('telegram', cid, handle); } catch (_) {}
              // Persist peer to server-side cache so future restarts don't need inbound
              try { apiFetch('save_peer_cache', { platform: 'telegram', chat_id: cid, handle }); } catch (_) {}
            }, i * 100);
          });
          if (toResolve.length) {
            console.log('[peer-warm] queued', toResolve.length, 'telegram peer resolves on connect');
            CONN_STORE.addLog('telegram', 'info', 'Peer warm-up: queued ' + toResolve.length + ' contacts');
            // Also kick a server-side contact sync
            try { apiFetch('sync_contacts', {}); } catch (_) {}
          }
        } catch (_) {}
      };

      // Load server-side peer cache first, then do the warm-up.
      const _loadAndWarm = () => {
        apiGet('get_peer_cache', '&platform=telegram')
          .then(res => _doPeerWarm((res && res.peers) || []))
          .catch(() => _doPeerWarm([]));
      };

      const msgsLoaded = typeof MSGS_STORE !== 'undefined'
        && Array.isArray(MSGS_STORE.list) && MSGS_STORE.list.length > 0;

      if (msgsLoaded) {
        _loadAndWarm();
      } else {
        // Wait for MSGS_STORE to populate — subscribe to its first notify.
        let warmed = false;
        const unsub = (typeof MSGS_STORE !== 'undefined') ? MSGS_STORE.sub(() => {
          if (warmed || !MSGS_STORE.list || !MSGS_STORE.list.length) return;
          warmed = true;
          try { unsub(); } catch(_) {}
          _loadAndWarm();
        }) : null;
        // Fallback: if no notify arrives within 8s, warm with whatever we have.
        setTimeout(() => {
          if (warmed) return;
          warmed = true;
          try { if (unsub) unsub(); } catch(_) {}
          _loadAndWarm();
        }, 8000);
      }
    } else {
      if (data && data.error) {
        CONN_STORE.addLog('telegram', 'error', data.error || 'Disconnected');
        if (TG_AUTH_STORE.state.open) TG_AUTH_STORE.setError(data.error);
      } else {
        CONN_STORE.addLog('telegram', 'info', 'Disconnected');
      }
    }
  }
  if (event==='telegramAuthRequired') {
    TG_AUTH_STORE.request((data&&data.kind)||'code', data&&data.phone);
    CONN_STORE.addLog('telegram', 'info', (data&&data.kind)==='password' ? '2FA password requested' : 'OTP code requested for ' + (data&&data.phone||''));
  }
  if (event==='discordStatus') {
    CONN_STORE.set('discord', data);
    if (data && data.connected) {
      const meta = { botName:data.botName||'', username:data.username||'', botId:data.botId||'', avatar:data.avatar||'' };
      CRED_STORE.set('dc_bot_profile', '', meta);
      CONN_STORE.addLog('discord', 'ok', 'Connected as ' + (data.username || data.botName || '?'));
    } else {
      CONN_STORE.addLog('discord', data&&data.error ? 'error' : 'info', data&&data.error ? data.error : 'Disconnected');
    }
  }
  // .NET's new platformLog events — fed directly into the connection log
  if (event==='platformLog' && data) {
    CONN_STORE.addLog(data.platform || 'telegram', data.level || 'info', data.msg || '');
  }
  if (event==='newMessage')   MSGS_STORE.onIncoming(data);
  // Async profile backfill from User API — avatar/bio arrive after the
  // message has already been displayed. Patch the conversation row and
  // persist to bc_end_users so the profile popup shows real data.
  if (event==='userProfileUpdate' && data && data.chatId) {
    const key = (data.platform || 'telegram') + '_' + String(data.chatId);
    const conv = MSGS_STORE.list && MSGS_STORE.list.find(m => m.id === key);
    if (conv) {
      if (data.avatar) conv.avatar = data.avatar;
      MSGS_STORE.notify && MSGS_STORE.notify();
    }
    // This event doubles as the media-URL backfill for inbound attachments.
    // It is not only a profile update, despite the name.
    if (data.mediaUrl) {
      try { MSGS_STORE.patchMediaUrl(key, data.messageId, data.mediaUrl, data.uid || ''); }
      catch (e) { console.warn('[media] backfill patch failed', e && e.message); }
    }
    const meta = {};
    if (data.avatar)   meta.avatar_url = data.avatar;
    if (data.bio)      meta.bio        = data.bio;
    if (data.coverUrl) meta.cover_url  = data.coverUrl;
    if (Object.keys(meta).length > 0) {
      apiFetch('upsert_end_user_meta', { conv_id: key, ...meta }).catch(()=>{});
    }
  }
  // Optional bridge event — if a future build of the .NET host forwards
  // "user is typing" events from Telegram User-API or Discord gateway, the
  // realism layer will consume them. Safe no-op when the event never fires.
  // `stop`   — the platform said they stopped (Telegram's cancel action);
  //            the indicator ends now rather than when the window lapses.
  // `action` — what they are doing: typing, record_voice, upload_photo…
  if (event==='userTyping' && data && data.platform && data.chatId) {
    const key = data.platform + '_' + String(data.chatId);
    if (data.stop) INBOUND_TRACKER.onUserTypingStop(key);
    else INBOUND_TRACKER.onUserTyping(key, data.ms || 6000, data.action);
  }
  // Diagnostic — bridge tells us whether each markRead call succeeded so the
  // operator can see WHY read receipts aren't appearing on the customer side.
  // Logs to console at warn level on failure so it's visible in DevTools.
  if (event==='readReceiptResult') {
    if (data && data.ok) {
      console.log('[ai] read receipt sent', data);
    } else {
      console.warn('[ai] read receipt FAILED — toggle is on but receipt did not deliver:', data && data.reason, data);
    }
  }
  if (event==='telegramError') {
    CONN_STORE.set('telegram', { error: (data&&data.error)||'Unknown error' });
    CONN_STORE.addLog('telegram', 'error', (data&&data.error)||'Unknown error');
  }
  if (event==='discordError') {
    CONN_STORE.set('discord', { error: (data&&data.error)||'Unknown error' });
    CONN_STORE.addLog('discord', 'error', (data&&data.error)||'Unknown error');
  }
  if (event==='sendError') {
    // Stringify the payload so the actual error message surfaces in the
    // .NET output window — `console.warn('...', obj)` was just printing
    // "Object" with no useful detail. JSON-stringify with a 2-space
    // indent for readability, fall back to String(data) if the object
    // is circular (rare but possible with bridge payloads).
    let detail;
    try { detail = JSON.stringify(data, null, 2); }
    catch(_) { detail = String(data); }
    const platform = (data && data.platform) || 'unknown';
    const errMsg   = (data && data.error)    || '(no error string)';
    console.warn('[send error] platform=' + platform + ' error=' + errMsg + ' full=' + detail);
    window.dispatchEvent(new CustomEvent('bcSendError', { detail: data }));
    try { MSGS_STORE.onSendError(data); } catch (e) { console.warn('[lifecycle] sendError', e && e.message); }
  }
  // ── Message lifecycle (see MSGS_STORE: MESSAGE LIFECYCLE) ──
  const _life = (fn) => { try { fn(); } catch (e) { console.warn('[lifecycle] ' + event, e && e.message); } };
  if (event==='sendOk')          _life(() => MSGS_STORE.onSendAck(data));
  if (event==='messageEdited')   _life(() => MSGS_STORE.onRemoteEdit(data));
  if (event==='messagesDeleted') _life(() => MSGS_STORE.onRemoteDelete(data));
  if (event==='mediaReady')      _life(() => MSGS_STORE.onMediaReady(data));
  if (event==='editResult')      _life(() => MSGS_STORE.onEditResult(data));
  if (event==='deleteResult')    _life(() => MSGS_STORE.onDeleteResult(data));
  if (event==='mediaSaved' && data) {
    if (data.ok) bcToast('Saved ' + (data.name || 'file'), 'ok');
    else if (!data.cancelled) bcToast('Couldn’t save the file — ' + (data.error || 'unknown error'), 'err');
  }
  if (event==='mediaOpened' && data) {
    if (!data.ok) bcToast('Couldn’t open the file — ' + (data.error || 'unknown error'), 'err');
    else if (data.revealed) bcToast((data.name || 'This file') + ' is a program — shown in its folder instead of opened', 'info');
  }
  if (event==='dotNetReady')   BRIDGE_STORE.setReady((data&&data.msg)||'.NET connected');

  // .NET confirms whether a platform-side block/unblock succeeded. Log the
  // result so the operator can diagnose Telegram User API peer-cache issues.
  if (event==='blockResult') {
    if (data && data.ok) {
      console.log('[block] platform action confirmed', data);
    } else {
      console.warn('[block] platform action FAILED', data && data.reason, data);
    }
  }

  // ── Invoice lifecycle ──
  // An invoice landing as confirmed (on-chain or by hand) hands off to
  // INVOICE_PIPELINE, which batches per conversation and runs the whole
  // post-payment sequence: confirmation, per-unit recording + licences, one
  // combined delivery, the manual-setup follow-up, and Stop After Sale.
  if (event==='invoiceConfirmed' && data && data.conv_id) {
    try { INVOICE_PIPELINE.enqueue(data); }
    catch (e) { console.warn('[invoice] enqueue failed', e && e.message); }
  }

});

// Bridge connection store — app-wide .NET status
const BRIDGE_STORE = {
  ready: false,
  msg: '',
  subs: new Set(),
  setReady(msg) { this.ready=true; this.msg=msg; this.subs.forEach(fn=>fn(true,msg)); },
  sub(fn) { this.subs.add(fn); return ()=>this.subs.delete(fn); },
};
const useBridge = ()=>{
  const [ready,setReady]=React.useState(BRIDGE_STORE.ready);
  const [msg,setMsg]=React.useState(BRIDGE_STORE.msg);
  React.useEffect(()=>BRIDGE_STORE.sub((r,m)=>{setReady(r);setMsg(m);}),[]);
  return [ready,msg];
};

const STAGES = {
  new:        {label:'New Lead',   col:'#5b9cf0'},
  prospect:   {label:'Prospect',   col:'#e8a844'},
  customer:   {label:'Customer',   col:'#43c98a'},
  needs_help: {label:'Needs Help', col:'#e87550'},
  purchasing: {label:'Purchasing', col:'#9b7ff0'},
  vip:        {label:'VIP',        col:'#e8c040'},
  churned:    {label:'Churned',    col:'#5a5a6a'},
};

const AISTATUS = {
  replying:      {label:'Replying',      col:'#43c98a', pulse:true },
  // "reading" → bot has noticed the inbound and is letting it settle (waiting
  // for the user to finish typing their burst before formulating a reply).
  reading:       {label:'Reading',       col:'#5ba3e8', pulse:true },
  // "user_typing" → the bot has paused composing because the user is
  // actively typing/sending more messages. Distinct from generic "reading"
  // so the operator can see the bot is intentionally holding for the
  // user's incoming burst, not just slow.
  user_typing:   {label:'User typing…',  col:'#e8c044', pulse:true },
  // "thinking" → the read-delay window (post-burst) before the LLM call
  // fires. The bot has decided the user is done; this is the simulated
  // "I'm composing my response in my head" beat.
  thinking:      {label:'Thinking',      col:'#7c8ef5', pulse:true },
  // "reconsidering" → a reply was already drafted/queued but a new inbound
  // landed mid-flight, so the bot is rebuilding context. Visually distinct so
  // the operator can see the bot is rebuilding rather than stuck.
  reconsidering: {label:'Reconsidering', col:'#9b7ff0', pulse:true },
  // "away" → presence simulator says the bot is offline / asleep. Read delay
  // will be inflated to mimic a real person who hasn't seen the chat yet.
  away:          {label:'Away',          col:'#6c6c80', pulse:false},
  waiting:       {label:'Waiting',       col:'#e8a844', pulse:false},
  paused:        {label:'Paused',        col:'#3a3a4e', pulse:false},
  error:         {label:'Error',         col:'#e87070', pulse:true },
};

// ── INBOUND TRACKER ───────────────────────────────────────────
// Per-conversation rolling state about how the user is currently sending
// messages. The realism engine uses this to:
//   1. Wait for a burst of incoming messages to "settle" before the LLM is
//      called — so the bot replies to the WHOLE thought, not the first
//      sentence the user fired off.
//   2. Detect "the user is still typing" via the gap between consecutive
//      inbound messages — if they're firing every <SETTLE_MS> ms, the bot
//      should hold its reply.
//   3. Surface a `notify()` hook so any in-flight reply / draft can react to
//      a new inbound arriving mid-flight (and reconsider its reply).
//
// We deliberately do NOT depend on a real "user is typing" event from the
// platform bridge — Telegram's Bot API does not expose typing-from-user
// events at all, and Discord's are unreliable for this use case. The
// gap-between-inbounds heuristic is what actually works in production.
//
// The tracker also opportunistically consumes a `userTyping` bridge event
// IF the .NET host ever starts forwarding one (defensive forward-compat) —
// any such event extends the settle window.
const INBOUND_TRACKER = {
  state: new Map(),    // convId → { last: ts, gaps: [ms,...], typingUntil: ts }
  subs:  new Set(),
  sub(fn){ this.subs.add(fn); return ()=>this.subs.delete(fn); },
  notify(convId){ this.subs.forEach(fn => { try { fn(convId); } catch(_){} }); },

  // Called from MSGS_STORE.onIncoming for every inbound. Updates rolling stats.
  // `msgId` (optional) is the platform-side id of the inbound — saved so the
  // realism layer can later call markRead with the correct max id.
  onInbound(convId, msgId) {
    const now = Date.now();
    let s = this.state.get(convId);
    if (!s) { s = { last: 0, gaps: [], typingUntil: 0, lastMsgId: 0 }; this.state.set(convId, s); }
    if (s.last) {
      const gap = now - s.last;
      // B3: If the conversation has been quiet for > 5 minutes, the prior
      // "tempo" history (rolling median of gaps) is no longer relevant.
      // Without this reset, a fresh message after a 24-hour gap would still
      // be evaluated against the old burst tempo (median 0.4s) — making
      // isLikelyStillTyping() return true and pinning the bot in settle-wait
      // for 25 seconds before it figures out the user actually IS done.
      if (gap > 5 * 60 * 1000) {
        s.gaps = [];
        console.log('[ai] resetting stale tempo for', convId, 'after', Math.round(gap/1000), 's quiet');
      } else {
        // Cap rolling history at 5 entries — enough to spot a burst without
        // letting one decade-old gap skew the rolling-mean.
        s.gaps.push(gap);
        if (s.gaps.length > 5) s.gaps.shift();
      }
    }
    s.last = now;
    if (msgId) s.lastMsgId = Number(msgId) || s.lastMsgId;
    this.notify(convId);
  },

  // Called from a `userTyping` bcEvent if the bridge ever forwards one. Each
  // event keeps the user "typing" for ~6 seconds in the absence of further
  // events (matches Telegram's natural typing-action lifespan).
  onUserTyping(convId, ms, action) {
    let s = this.state.get(convId);
    if (!s) { s = { last: 0, gaps: [], typingUntil: 0 }; this.state.set(convId, s); }
    s.typingUntil = Math.max(s.typingUntil, Date.now() + (ms || 6000));
    // What they are doing, for the contact list ("recording voice"…).
    s.typingAction = String(action || 'typing');
    // When typing was last REPORTED. The contact list compares it with the
    // last inbound: a message that lands after the latest typing report
    // means they finished typing, so the indicator stops at once instead of
    // lingering for the rest of the platform's typing window.
    s.typingAt = Date.now();
    this.notify(convId);
  },

  // The platform reported that they STOPPED (Telegram sends an explicit
  // cancel when the draft is cleared or the app is left). Ends the typing
  // window at once, for the contact list and the settle logic alike.
  onUserTypingStop(convId) {
    const s = this.state.get(convId);
    if (!s || !(s.typingUntil > Date.now())) return;
    s.typingUntil = 0;
    this.notify(convId);
  },

  // The AGENT is typing — set by the reply engine for as long as a chunk
  // is being "typed" (the same window the customer sees "typing…" for),
  // and by the payment pipeline's realistic sends. Purely for the operator's
  // contact list; it never affects settle / burst logic, which only ever
  // reads the customer fields above. `until` is a hard stop so a crashed
  // or discarded reply can never leave the indicator stuck on.
  onAgentTyping(convId, until) {
    if (!convId) return;
    let s = this.state.get(convId);
    if (!s) { s = { last: 0, gaps: [], typingUntil: 0 }; this.state.set(convId, s); }
    const next = Math.max(Date.now() + 800, Number(until) || 0);
    if (s.agentTypingUntil === next) return;
    s.agentTypingUntil = next;
    this.notify(convId);
  },
  onAgentTypingStop(convId) {
    const s = convId && this.state.get(convId);
    if (!s || !(s.agentTypingUntil > 0)) return;
    s.agentTypingUntil = 0;
    this.notify(convId);
  },

  // True if either (a) the bridge says the user is typing, or (b) the last
  // inbound landed within `windowMs` AND the rolling-mean gap is short
  // (i.e. they're firing follow-ups). settle window defaults are tuned so
  // that "two sentences fired half-a-second apart" reads as a burst, but
  // "one message every 30 seconds" doesn't.
  isLikelyStillTyping(convId, windowMs) {
    const s = this.state.get(convId);
    if (!s) return false;
    const now = Date.now();
    if (s.typingUntil > now) return true;
    if (!s.last) return false;
    const sinceLast = now - s.last;
    if (sinceLast > (windowMs || 5000)) return false;
    // If we have no gap history yet, but the last inbound is fresh, treat
    // it as "still typing" for the first SETTLE_MS — bursts almost always
    // include at least one follow-up.
    if (!s.gaps.length) return sinceLast < 1500;
    // Use the median of the last few gaps as a robust "their tempo".
    const sorted = [...s.gaps].sort((a,b)=>a-b);
    const median = sorted[Math.floor(sorted.length/2)];
    // They're "still typing" if the typical gap is short (≤ windowMs) AND
    // the time since their last message is shorter than that typical gap
    // plus one settle window — i.e. another message could plausibly land.
    return median <= (windowMs || 5000) && sinceLast < median + (windowMs || 5000);
  },

  // Block until the inbound burst settles. Resolves once `quietMs` have
  // passed since the most recent inbound AND no "user is typing" event is
  // active, OR the optional abort signal fires. Polls cheaply; the resolve
  // also fires immediately when notify() runs after a new inbound, so the
  // loop reacts fast.
  async awaitSettle(convId, quietMs, opts) {
    quietMs = quietMs || 1500;
    const maxWait = (opts && opts.maxWait) || 25000;   // cap so a chatty user can't pin us forever
    const tickMs  = 200;
    const deadline = Date.now() + maxWait;
    while (Date.now() < deadline) {
      const s = this.state.get(convId);
      const last = (s && s.last) || 0;
      const typingUntil = (s && s.typingUntil) || 0;
      const sinceLast = Date.now() - (last || Date.now());
      if (!last) return;                                       // nothing inbound yet — don't block
      if (sinceLast >= quietMs && typingUntil <= Date.now()) return;
      if (opts && opts.abortIf && opts.abortIf()) return;
      await sleep(tickMs);
    }
  },

  // For the engine: snapshot the last inbound time so we can detect "did a
  // new inbound arrive after this point" without polling internals.
  lastInboundAt(convId) {
    const s = this.state.get(convId);
    return (s && s.last) || 0;
  },

  // Latest inbound msg id we've seen from the platform — used by the
  // read-receipt path so the bot can ack "everything up to id N" in one shot.
  // Returns 0 if no msg id has been forwarded for this conv (older bridge
  // versions, or platforms that don't expose stable ids).
  lastInboundMsgId(convId) {
    const s = this.state.get(convId);
    return (s && s.lastMsgId) || 0;
  },
};

// ── SPAM_THROTTLE ─────────────────────────────────────────────
// Per-conversation cooldown that suppresses outbound replies for a stretch
// after the LLM flags an inbound as spam. The cooldown EXTENDS (doubling
// from the agent's base spamCooldownSec) on each subsequent spam hit so a
// flooder gets progressively more silence rather than being able to keep
// burning LLM tokens with garbage. Reset by ANY non-spam inbound or by an
// operator manually intervening (sending a reply themselves).
//
// State per conv: { until: ts_ms, hits: int, lastReason: string }
//   • until      = wall-clock ts (ms) at which replies are allowed again. 0 = no cooldown.
//   • hits       = number of consecutive spam flags. Resets to 0 on any clean inbound.
//   • lastReason = LLM's spam_reason string from the last hit (surfaced in UI / state block).
//
// Cap: cooldown doubles on each hit but maxes out at 30 minutes per hit so a
// single classifier mistake can't lock a conv out for hours.
const SPAM_THROTTLE = {
  state: new Map(),
  subs:  new Set(),
  sub(fn){ this.subs.add(fn); return ()=>this.subs.delete(fn); },
  notify(convId){ this.subs.forEach(fn => { try { fn(convId); } catch(_){} }); },

  MAX_COOLDOWN_MS: 30 * 60 * 1000,   // 30 min hard cap per hit

  // Mark the conv as having received a spam-flagged inbound. Bumps the hit
  // count, computes the new cooldown duration (doubles each hit), and pushes
  // the `until` timestamp out to now + duration. Returns the cooldown ms
  // applied so callers can log it.
  hit(convId, baseCooldownSec, reason) {
    const base = Math.max(5, Math.min(1800, parseInt(baseCooldownSec, 10) || 60));
    let s = this.state.get(convId);
    if (!s) { s = { until: 0, hits: 0, lastReason: '' }; this.state.set(convId, s); }
    s.hits += 1;
    // Double on each subsequent hit: hit#1 = base, hit#2 = 2x, hit#3 = 4x...
    const factor = Math.pow(2, Math.max(0, s.hits - 1));
    const ms = Math.min(this.MAX_COOLDOWN_MS, base * 1000 * factor);
    s.until = Date.now() + ms;
    s.lastReason = (reason || '').toString().slice(0, 200);
    this.notify(convId);
    return ms;
  },

  // Any non-spam inbound (or operator intervention) wipes the cooldown so
  // the conv recovers immediately when behaviour normalises.
  clear(convId) {
    if (this.state.has(convId)) {
      this.state.delete(convId);
      this.notify(convId);
    }
  },

  // True when this conv is currently silenced by the throttle.
  isThrottled(convId) {
    const s = this.state.get(convId);
    if (!s || !s.until) return false;
    if (Date.now() >= s.until) {
      // Expired naturally — drop the cooldown but KEEP the hit counter so
      // a fresh spam burst escalates faster than the first one did.
      s.until = 0;
      this.notify(convId);
      return false;
    }
    return true;
  },

  // ms remaining on the cooldown, or 0 when not throttled.
  remainingMs(convId) {
    const s = this.state.get(convId);
    if (!s || !s.until) return 0;
    return Math.max(0, s.until - Date.now());
  },

  // Snapshot for UI / debugging.
  status(convId) {
    const s = this.state.get(convId);
    if (!s) return { throttled: false, hits: 0, remainingMs: 0, lastReason: '' };
    return {
      throttled:   this.isThrottled(convId),
      hits:        s.hits,
      remainingMs: this.remainingMs(convId),
      lastReason:  s.lastReason,
    };
  },
};

// ── PRESENCE SIMULATOR ────────────────────────────────────────
// Drives the simulated "is the bot online right now" state per-conversation.
// Without this, the bot is always-on and replies in lock-step with every
// inbound — the dead giveaway the user complained about. With it, we model
// a person who:
//   • drifts to "away" after a stretch of inactivity
//   • drifts to "offline" after a longer stretch
//   • when they "come back online" after being offline, they take noticeably
//     longer to read & reply to the next message (because they were AFK)
//   • their availability is tied to a rolling activity window scoped to THIS
//     conversation, so different chats can have different presences at once
//
// The simulator does NOT broadcast presence anywhere — there's no "user
// online" surface on the Bot API. It only adjusts the timing curve so the
// bot's behaviour FEELS human. That's the whole point: the realism comes
// from when it replies, not from a green dot.
const PRESENCE_SIMULATOR = {
  state: new Map(),    // convId → { mode: 'online'|'away'|'offline', since: ts }
  subs:  new Set(),
  sub(fn){ this.subs.add(fn); return ()=>this.subs.delete(fn); },
  notify(convId){ this.subs.forEach(fn => { try { fn(convId); } catch(_){} }); },

  // Thresholds (ms). Tuned so a "fresh" conversation feels responsive but
  // a chat that's been idle for 5+ minutes feels like the agent has stepped
  // away. These are intentionally agent-overridable below.
  _windows(agent) {
    const a = agent || {};
    // Multiplier — agents with low WPM / "thoughtful" delay are sleepier.
    const slow = (a.delay === 'thoughtful') ? 1.5 : (a.delay === 'quick' ? 0.6 : 1.0);
    return {
      AWAY_AFTER:    (a.awayAfterMs    ?? 4 * 60 * 1000) * slow,   // 4 min idle → away
      OFFLINE_AFTER: (a.offlineAfterMs ?? 18 * 60 * 1000) * slow,  // 18 min idle → offline
      // Extra read-delay applied when "coming back" from each state. Random
      // multiplier per call so consecutive returns aren't identical.
      AWAY_RETURN_MS:    [3000, 12000],     // 3-12s extra
      OFFLINE_RETURN_MS: [12000, 45000],    // 12-45s extra (just got back)
    };
  },

  _get(convId) {
    let s = this.state.get(convId);
    if (!s) { s = { mode: 'online', since: Date.now() }; this.state.set(convId, s); }
    return s;
  },

  // Refresh presence based on time since last inbound + the agent's tuning.
  // Returns the new mode and (if a transition happened) how much extra delay
  // the engine should add to simulate the bot "coming back".
  // Called by the engine right when it picks up a new job.
  evaluate(convId, agent) {
    const s = this._get(convId);
    const w = this._windows(agent);
    const lastInbound = INBOUND_TRACKER.lastInboundAt(convId);
    // We measure idleness as "time since the last interaction in either
    // direction" — outbound replies count too, since a bot that just sent a
    // message is obviously online.
    const lastActivity = Math.max(lastInbound || 0, s._lastOutboundAt || 0, s.since || 0);
    const idleFor = Date.now() - lastActivity;
    // Determine target mode.
    let target = 'online';
    if (idleFor >= w.OFFLINE_AFTER) target = 'offline';
    else if (idleFor >= w.AWAY_AFTER) target = 'away';
    // The engine is firing because a NEW inbound just landed → after we
    // factor in the return-delay, we'll be online again.
    const previousMode = s.mode;
    const transitioned = previousMode !== 'online' && target !== 'online';
    // Compute the "return penalty" — only applied if we WERE away/offline
    // and are now waking up. Online → online costs nothing.
    let returnPenaltyMs = 0;
    if (previousMode === 'offline') {
      returnPenaltyMs = rand(w.OFFLINE_RETURN_MS[0], w.OFFLINE_RETURN_MS[1]);
    } else if (previousMode === 'away') {
      returnPenaltyMs = rand(w.AWAY_RETURN_MS[0], w.AWAY_RETURN_MS[1]);
    }
    // After applying the penalty (which the engine sleeps through), the bot
    // is "online" again until it goes idle.
    s.mode = 'online';
    s.since = Date.now();
    this.notify(convId);
    return {
      previousMode,
      currentMode: 'online',
      transitioned,
      returnPenaltyMs: Math.round(returnPenaltyMs),
    };
  },

  // Called when an outbound message lands. Keeps `_lastOutboundAt` fresh
  // so the next idleness calculation includes our own activity.
  noteOutbound(convId) {
    const s = this._get(convId);
    s._lastOutboundAt = Date.now();
    s.mode = 'online';
    s.since = Date.now();
    this.notify(convId);
  },

  // Idle-tick — runs on a global interval and demotes a conversation from
  // online → away → offline as time passes since the last activity. Lets
  // the chat-list UI reflect a bot that's drifted away.
  tick(agent) {
    const w = this._windows(agent);
    const now = Date.now();
    for (const [convId, s] of this.state) {
      const lastInbound = INBOUND_TRACKER.lastInboundAt(convId);
      const lastActivity = Math.max(lastInbound || 0, s._lastOutboundAt || 0);
      if (!lastActivity) continue;
      const idleFor = now - lastActivity;
      let target = 'online';
      if (idleFor >= w.OFFLINE_AFTER) target = 'offline';
      else if (idleFor >= w.AWAY_AFTER) target = 'away';
      if (target !== s.mode) {
        s.mode = target;
        s.since = now;
        this.notify(convId);
      }
    }
  },

  modeOf(convId) {
    const s = this.state.get(convId);
    return (s && s.mode) || 'online';
  },
};

// Global presence tick — fires once every 30s. Cheap (Map walk per tick)
// and lets the UI surface "away/offline" badges without each row polling.
setInterval(() => {
  // Use the default active agent's windows for generic ticking; per-conv
  // refinement happens inside evaluate() at job-pickup time.
  PRESENCE_SIMULATOR.tick(AGENTS_STORE.defaultActive());
}, 30000);

// ── SCHEDULE_GATE ─────────────────────────────────────────────
// Reply hours for an agent. Mirrors the way a human operator running a
// side-business works: set blocks of hours on set days, with explicit
// behaviour for messages that land outside those blocks:
//   • mode = 'pause'   → don't reply, but DON'T pretend to be offline.
//                        The conversation just sits there and is picked
//                        up if the customer writes again during hours.
//   • mode = 'queue'   → don't reply right now, but remember the chat.
//                        When the hours open, AI_REPLY_QUEUE re-fires the
//                        waiting chats one after another (see
//                        AI_REPLY_QUEUE._deferUntilOpen).
//   • mode = 'offline' → behave like the presence simulator's offline
//                        state: when the next inside-hours message lands,
//                        prepend a long "just got back" return penalty
//                        BEFORE replying. Most aggressive realism.
//
// Schedule shape v2 (matches what api.php save_agent re-encodes):
//   {
//     enabled:  bool
//     tz:       IANA timezone ('Australia/Perth'). '' = this device's zone.
//     mode:     'pause' | 'queue' | 'offline'
//     windows:  [ { days:[0..6], startMin:0..1439, endMin:0..1439 }, … ]
//               1..14 blocks. days are weekday ints (0=Sun..6=Sat).
//     days / startMin / endMin
//               legacy mirror of windows[0] so an older cached build
//               still reads something sensible. Never read these
//               directly — always go through normalize().
//   }
//
// Block semantics:
//   end > start  → same-day block, e.g. Mon 09:00–12:00.
//   end < start  → overnight block. The part after midnight belongs to the
//                  day it STARTED on: a Fri 22:00–02:00 block covers
//                  Sat 01:00, not Fri 01:00. (v1 matched the early-hours
//                  part against the wrong day — a Fri-only night shift
//                  also opened at 01:00 on Friday morning.)
//   end = start  → the whole day, 00:00–24:00.
//   days = []    → block is inactive.
//   endMin = 0   → "until midnight".
//
// v1 schedules (single days/startMin/endMin, no `windows`) are read as one
// block. In v1 an empty days list meant "every day", and that is kept.
//
// We don't ship a tzdb in the browser — Intl.DateTimeFormat does the
// conversion. Any failure (bad tz string) fails OPEN so a typo can never
// permanently mute an agent.
const SCHEDULE_GATE = {
  MAX_WINDOWS: 14,
  DEFAULT_WINDOW: { days:[1,2,3,4,5], startMin:540, endMin:1020 },
  DAY_SHORT: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
  DAY_ORDER: [1,2,3,4,5,6,0],   // Monday-first, for display

  // ── shape ────────────────────────────────────────────────────
  _clampMin(v, dflt) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(0, Math.min(1439, n)) : dflt;
  },
  _cleanDays(days) {
    if (!Array.isArray(days)) return null;
    const out = [];
    days.forEach(d => { const n = parseInt(d, 10); if (n >= 0 && n <= 6 && !out.includes(n)) out.push(n); });
    return out.sort((a, b) => a - b);
  },

  // Always returns a complete v2 object. Safe on null, v1, junk.
  normalize(schedule) {
    const s = (schedule && typeof schedule === 'object') ? schedule : {};
    const mode = ['pause','queue','offline'].includes(s.mode) ? s.mode : 'pause';
    const tz   = typeof s.tz === 'string' ? s.tz.trim().slice(0, 64) : '';
    let windows;
    if (Array.isArray(s.windows)) {
      windows = s.windows
        .filter(w => w && typeof w === 'object')
        .slice(0, this.MAX_WINDOWS)
        .map(w => ({
          days:     this._cleanDays(w.days) || [],
          startMin: this._clampMin(w.startMin, 540),
          endMin:   this._clampMin(w.endMin, 1020),
        }));
    } else if (s.days != null || s.startMin != null || s.endMin != null) {
      const d = this._cleanDays(s.days);
      windows = [{
        days:     d && d.length ? d : [0,1,2,3,4,5,6],
        startMin: this._clampMin(s.startMin, 540),
        endMin:   this._clampMin(s.endMin, 1020),
      }];
    } else {
      windows = [{ ...this.DEFAULT_WINDOW, days: [...this.DEFAULT_WINDOW.days] }];
    }
    const first = windows[0] || this.DEFAULT_WINDOW;
    return {
      enabled: !!s.enabled, tz, mode, windows,
      days: [...first.days], startMin: first.startMin, endMin: first.endMin,
    };
  },

  // ── time ─────────────────────────────────────────────────────
  // Resolve "now" in the agent's TZ (or local). Returns {weekday, minutes}.
  // Returns null on a parse error so callers fail open.
  _localNow(tz) {
    try {
      const d = new Date();
      if (!tz) {
        return { weekday: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
      }
      // hourCycle:'h23' — with plain hour12:false some engines report the
      // midnight hour as "24", which put 00:xx a whole day off.
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'short',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      });
      const parts = fmt.formatToParts(d);
      const wd = parts.find(p => p.type === 'weekday')?.value || 'Sun';
      const hh = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10) % 24;
      const mm = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
      const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
      return { weekday: map[wd] ?? d.getDay(), minutes: hh * 60 + mm };
    } catch (_) {
      return null;
    }
  },
  deviceTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; }
  },
  isValidTz(tz) {
    if (!tz) return true;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (_) { return false; }
  },
  // Every IANA zone the browser knows, cached. Falls back to a short list
  // on engines without Intl.supportedValuesOf.
  allTimeZones() {
    if (this._zones) return this._zones;
    let z = [];
    try { if (typeof Intl.supportedValuesOf === 'function') z = Intl.supportedValuesOf('timeZone'); } catch (_) {}
    if (!z.length) z = ['UTC','Europe/London','Europe/Paris','Europe/Berlin','Europe/Madrid','Europe/Moscow',
      'Africa/Johannesburg','Asia/Dubai','Asia/Kolkata','Asia/Singapore','Asia/Hong_Kong','Asia/Tokyo',
      'Australia/Perth','Australia/Sydney','Pacific/Auckland','America/Sao_Paulo','America/New_York',
      'America/Chicago','America/Denver','America/Los_Angeles'];
    if (!z.includes('UTC')) z = ['UTC', ...z];
    this._zones = z;
    return z;
  },
  // Loose timezone input → canonical IANA name, '' (device) or null.
  // Accepts "Australia/Perth", "australia/perth", "Perth", "new york",
  // "UTC", "local", "device".
  resolveTz(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t || /^(local|device|this device|my (time|device|computer)|default|auto)$/i.test(t)) return '';
    if (/^(utc|gmt|z|zulu)$/i.test(t)) return 'UTC';
    const zones = this.allTimeZones();
    const norm = s => s.toLowerCase().replace(/[\s_-]+/g, '');
    const want = norm(t);
    const exact = zones.find(z => norm(z) === want);
    if (exact) return exact;
    const city = zones.find(z => norm(z.split('/').pop()) === want);
    if (city) return city;
    return this.isValidTz(t) ? t : null;
  },

  // ── evaluation ───────────────────────────────────────────────
  _inWindow(w, wd, min) {
    if (!w.days.length) return false;
    const s = w.startMin, e = w.endMin;
    if (s === e) return w.days.includes(wd);
    if (e > s)   return w.days.includes(wd) && min >= s && min < e;
    // Overnight: evening part today, early-hours part belongs to yesterday.
    return (w.days.includes(wd) && min >= s) || (w.days.includes((wd + 6) % 7) && min < e);
  },

  // True if the schedule says we're currently inside the reply hours.
  // Disabled / missing schedule = always inside (never blocks replies).
  isOpen(schedule) {
    if (!schedule || !schedule.enabled) return true;
    const s = this.normalize(schedule);
    const now = this._localNow(s.tz);
    if (!now) return true;   // TZ broken — fail open
    return s.windows.some(w => this._inWindow(w, now.weekday, now.minutes));
  },

  // How many ms until the hours re-open. Returns 0 if already open, if
  // disabled, or if no block will ever open (no days picked).
  msUntilOpen(schedule) {
    if (!schedule || !schedule.enabled) return 0;
    const s = this.normalize(schedule);
    const now = this._localNow(s.tz);
    if (!now) return 0;
    if (s.windows.some(w => this._inWindow(w, now.weekday, now.minutes))) return 0;
    let best = Infinity;
    for (let i = 0; i <= 7; i++) {
      const wd = (now.weekday + i) % 7;
      for (const w of s.windows) {
        if (!w.days.includes(wd)) continue;
        const start = w.startMin === w.endMin ? 0 : w.startMin;
        const at = i * 1440 + start - now.minutes;
        if (at > 0 && at < best) best = at;
      }
    }
    return best === Infinity ? 0 : best * 60 * 1000;
  },

  // 7 × 1440 coverage map, index = weekday*1440 + minute. Used for the
  // week strip in the editor and for status(). ~10k bytes, cheap.
  weekMask(schedule) {
    const s = this.normalize(schedule);
    const m = new Uint8Array(10080);
    for (const w of s.windows) {
      for (const d of w.days) {
        const base = d * 1440;
        if (w.startMin === w.endMin)    m.fill(1, base, base + 1440);
        else if (w.endMin > w.startMin) m.fill(1, base + w.startMin, base + w.endMin);
        else {
          m.fill(1, base + w.startMin, base + 1440);
          const nb = ((d + 1) % 7) * 1440;
          m.fill(1, nb, nb + w.endMin);
        }
      }
    }
    return m;
  },

  // Human-facing status for the editor header and the ghost:
  //   {state:'always'}                         schedule off
  //   {state:'empty'}                          on, but no hours at all
  //   {state:'badtz'}                          tz string not understood
  //   {state:'open'|'closed', changeIn, changeAt:{weekday,minutes}}
  //   changeIn null = never changes (open all week)
  status(schedule) {
    const s = this.normalize(schedule);
    if (!s.enabled) return { state: 'always' };
    if (!this.isValidTz(s.tz)) return { state: 'badtz' };
    const now = this._localNow(s.tz);
    if (!now) return { state: 'badtz' };
    const mask = this.weekMask(s);
    if (!mask.some(v => v)) return { state: 'empty' };
    const idx  = now.weekday * 1440 + now.minutes;
    const cur  = mask[idx];
    for (let k = 1; k <= 10080; k++) {
      const j = (idx + k) % 10080;
      if (mask[j] !== cur) {
        return { state: cur ? 'open' : 'closed', changeIn: k,
                 changeAt: { weekday: Math.floor(j / 1440), minutes: j % 1440 } };
      }
    }
    return { state: cur ? 'open' : 'closed', changeIn: null, changeAt: null };
  },

  // ── formatting ───────────────────────────────────────────────
  uses12h() {
    if (this._h12 != null) return this._h12;
    try {
      const o = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
      this._h12 = o.hour12 != null ? !!o.hour12 : /h1[12]/.test(o.hourCycle || '');
    } catch (_) { this._h12 = true; }
    return this._h12;
  },
  // compact: "9am" / "9:30pm" / "21:30".  Full: "9:00 AM" / "09:00".
  // isEnd: 0 minutes reads as "midnight" / "24:00".
  fmtTime(min, opts = {}) {
    const h12 = opts.h12 != null ? opts.h12 : this.uses12h();
    const m = ((Math.round(Number(min) || 0) % 1440) + 1440) % 1440;
    if (opts.isEnd && m === 0) return h12 ? (opts.compact ? 'midnight' : 'Midnight') : '24:00';
    const h = Math.floor(m / 60), mm = m % 60;
    if (!h12) return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const hh = h % 12 || 12;
    if (opts.compact) return `${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
    return `${hh}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  },
  daysLabel(days) {
    const set = new Set(days || []);
    if (!set.size) return 'No days';
    if (set.size === 7) return 'Every day';
    const key = [...set].sort().join('');
    if (key === '12345') return 'Weekdays';
    if (key === '06')    return 'Weekends';
    const S = this.DAY_SHORT, order = this.DAY_ORDER, runs = [];
    let run = null;
    order.forEach((d, i) => {
      if (!set.has(d)) return;
      if (run && run.end === i - 1) run.end = i;
      else { run = { start: i, end: i }; runs.push(run); }
    });
    return runs.map(r => r.start === r.end ? S[order[r.start]]
      : `${S[order[r.start]]}–${S[order[r.end]]}`).join(', ');
  },
  windowLabel(w, opts = {}) {
    const time = w.startMin === w.endMin ? 'all day'
      : `${this.fmtTime(w.startMin, { ...opts, compact: true })}–${this.fmtTime(w.endMin, { ...opts, compact: true, isEnd: true })}`;
    return `${this.daysLabel(w.days)} ${time}`;
  },
  // "Mon–Wed 9am–12pm; Thu–Fri 1pm–5pm". Blocks sharing the same hours
  // are merged so two rows for Mon and Wed read as one phrase.
  describe(schedule, opts = {}) {
    const s = this.normalize(schedule);
    const groups = new Map();
    s.windows.forEach(w => {
      if (!w.days.length) return;
      const k = w.startMin === w.endMin ? 'all' : `${w.startMin}-${w.endMin}`;
      if (!groups.has(k)) groups.set(k, { startMin: w.startMin, endMin: w.endMin, days: new Set() });
      w.days.forEach(d => groups.get(k).days.add(d));
    });
    if (!groups.size) return 'No hours set';
    const firstDay = g => Math.min(...[...g.days].map(d => this.DAY_ORDER.indexOf(d)));
    return [...groups.values()]
      .sort((a, b) => firstDay(a) - firstDay(b) || a.startMin - b.startMin)
      .map(g => this.windowLabel({ ...g, days: [...g.days] }, opts))
      .join('; ');
  },

  // ── parsing (ghost chat input) ───────────────────────────────
  // Tolerant of how people and models write hours: "9", "9am", "9:30 pm",
  // "21:00", "0900", "noon", "midnight", "9h30".
  _timeTok(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw > 24 ? { h: Math.floor(raw / 60) % 24, m: Math.round(raw) % 60, sfx: null }
                      : { h: Math.floor(raw), m: Math.round((raw % 1) * 60), sfx: null };
    }
    const t = String(raw).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t) return null;
    if (/^(noon|midday)$/.test(t)) return { h: 12, m: 0, sfx: 'pm' };
    if (t === 'midnight')          return { h: 0,  m: 0, sfx: 'am' };
    const m4 = t.match(/^(\d{2})(\d{2})$/);
    if (m4) return (+m4[1] <= 24 && +m4[2] <= 59) ? { h: +m4[1], m: +m4[2], sfx: null } : null;
    const mt = t.match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p|h|hrs?)?$/);
    if (!mt) return null;
    const h = +mt[1], m = mt[2] ? +mt[2] : 0;
    let sfx = mt[3] ? (mt[3][0] === 'a' ? 'am' : mt[3][0] === 'p' ? 'pm' : null) : null;
    if (h > 24 || m > 59) return null;
    if (sfx && h > 12) sfx = null;          // "13pm" — take the 24h reading
    return { h, m, sfx };
  },
  _tokToMin(tok, sfxOverride) {
    const sfx = sfxOverride !== undefined ? sfxOverride : tok.sfx;
    let h = tok.h;
    if (sfx === 'am') h = h % 12;
    else if (sfx === 'pm') h = (h % 12) + 12;
    if (h >= 24) h = 0;                     // "24:00" = midnight
    return h * 60 + tok.m;
  },
  parseTime(raw) { const t = this._timeTok(raw); return t ? this._tokToMin(t) : null; },
  // Fill in missing am/pm the way a person reads it:
  //   "9-5pm" → 9am–5pm   "1-5pm" → 1pm–5pm   "9-5" → 9am–5pm
  //   "9pm-2" → 9pm–2am   "22:00-06:00" → overnight
  _rangeFromToks(a, b) {
    let end = this._tokToMin(b), start;
    if (!a.sfx && b.sfx) {
      start = this._tokToMin(a, b.sfx);
      if (start >= end && end !== 0) start = this._tokToMin(a, 'am');
    } else {
      start = this._tokToMin(a);
    }
    if (!a.sfx && !b.sfx && a.h <= 12 && b.h >= 1 && b.h <= 12 && end <= start) {
      end = (end + 720) % 1440;
    }
    if (a.sfx && !b.sfx && b.h >= 1 && b.h <= 12 && end <= start) {
      const alt = this._tokToMin(b, 'pm');
      if (alt > start) end = alt;
    }
    return { startMin: start, endMin: end };
  },
  parseRange(raw) {
    const t = String(raw || '').toLowerCase().trim();
    if (/^(all ?day|24 ?h(ours|rs)?|24\/7|around the clock)$/.test(t)) return { startMin: 0, endMin: 0 };
    const m = t.match(/^(.+?)\s*(?:-|–|—|\bto\b|\buntil\b|\btill\b|\bthrough\b)\s*(.+)$/);
    if (!m) return null;
    const a = this._timeTok(m[1].replace(/^(from|between)\s+/, '').trim());
    const b = this._timeTok(m[2].trim());
    return a && b ? this._rangeFromToks(a, b) : null;
  },
  // "mon-wed", "Monday to Wednesday", "weekdays", "weekends", "every day",
  // "mon, wed & fri", [1,2,3], ["mon","tue"]. Returns sorted ints or null.
  parseDays(raw) {
    if (raw == null || raw === '') return null;
    const MAP = { su:0, sun:0, sunday:0, mo:1, mon:1, monday:1, tu:2, tue:2, tues:2, tuesday:2,
      we:3, wed:3, weds:3, wednesday:3, th:4, thu:4, thur:4, thurs:4, thursday:4,
      fr:5, fri:5, friday:5, sa:6, sat:6, saturday:6 };
    const order = this.DAY_ORDER;
    const set = new Set();
    for (const it of (Array.isArray(raw) ? raw : [raw])) {
      if (typeof it === 'number') { if (it >= 0 && it <= 6) set.add(it); else if (it === 7) set.add(0); continue; }
      let t = String(it == null ? '' : it).toLowerCase().replace(/\./g, '').trim();
      if (!t) continue;
      if (/^\d$/.test(t)) { const n = +t; if (n <= 6) set.add(n); else if (n === 7) set.add(0); continue; }
      t = t.replace(/\b(every ?day|daily|all ?days?|all ?week|7 days|seven days)\b/g, ' mon-sun ')
           .replace(/\b(week ?days|business days|work ?days|working days)\b/g, ' mon-fri ')
           .replace(/\bweek ?ends?\b/g, ' sat sun ');
      t = t.replace(/([a-z]+)\s*(?:-|–|—|\bto\b|\bthrough\b|\bthru\b|\btill\b|\buntil\b)\s*([a-z]+)/g, (all, a, b) => {
        const ka = a.replace(/s$/, ''), kb = b.replace(/s$/, '');
        const da = MAP[a] ?? MAP[ka], db = MAP[b] ?? MAP[kb];
        if (da == null || db == null) return all;
        const i = order.indexOf(da), j = order.indexOf(db), out = [];
        for (let k = 0; k < 7; k++) { const idx = (i + k) % 7; out.push(order[idx]); if (idx === j) break; }
        return ' ' + out.map(d => '#' + d).join(' ') + ' ';
      });
      t.split(/[\s,;/&+]+/).forEach(tok => {
        if (!tok) return;
        if (tok[0] === '#') { set.add(+tok.slice(1)); return; }
        const d = MAP[tok] ?? MAP[tok.replace(/s$/, '')];
        if (d != null) set.add(d);
      });
    }
    return set.size ? [...set].sort((a, b) => a - b) : null;
  },
  // Blocks from ghost attrs. Accepts an array of objects
  // ({days, start, end} / {days, hours:"9-5"} / {days, all_day:true}) or
  // text ("mon-wed 9am-12pm; thu-fri 1-5pm"). Returns
  // [{days|null, startMin|null, endMin|null}] or null. days:null means the
  // text named no days; time null only survives with opts.allowNoTime
  // (used for "remove Wednesday").
  parseWindows(input, opts = {}) {
    if (input == null || input === '') return null;
    const out = [];
    const ALLDAY = /\b(all ?day|24 ?h(ours|rs)?|24\/7|around the clock)\b/i;
    const TIME = '(?:\\d{1,2}(?:[:.h]\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?|noon|midday|midnight)';
    const RANGE = new RegExp('(?:\\b(?:from|between)\\s+)?(' + TIME + ')\\s*(?:-|–|—|\\bto\\b|\\buntil\\b|\\btill\\b|\\band\\b)\\s*(' + TIME + ')', 'i');
    const push = (days, range) => {
      if (!range && !opts.allowNoTime) return;
      if (!range && !days) return;
      out.push({ days, startMin: range ? range.startMin : null, endMin: range ? range.endMin : null });
    };
    const fromText = (txt) => {
      String(txt).split(/[;\n|]+/).forEach(seg0 => {
        // A comma-joined list with several time ranges is several blocks:
        // "mon-wed 9-12, thu, fri 1-5" → [mon-wed 9-12] [thu, fri 1-5].
        const pieces = seg0.split(',');
        const hasTime = p => RANGE.test(p) || ALLDAY.test(p);
        let segs = [seg0];
        if (pieces.length > 1 && pieces.filter(hasTime).length > 1) {
          segs = []; let buf = [];
          pieces.forEach(p => { buf.push(p); if (hasTime(p)) { segs.push(buf.join(',')); buf = []; } });
          if (buf.length) { if (segs.length) segs[segs.length - 1] += ',' + buf.join(','); else segs.push(buf.join(',')); }
        }
        segs.forEach(seg => {
          seg = seg.trim(); if (!seg) return;
          let range = null, rest = seg;
          if (ALLDAY.test(seg)) { range = { startMin: 0, endMin: 0 }; rest = seg.replace(new RegExp(ALLDAY.source, 'ig'), ' '); }
          else {
            const m = seg.match(RANGE);
            if (m) {
              const a = this._timeTok(m[1]), b = this._timeTok(m[2]);
              if (a && b) range = this._rangeFromToks(a, b);
              rest = seg.replace(m[0], ' ');
            }
          }
          push(this.parseDays(rest.replace(/\b(from|between|on|at|hours?|and|only)\b/ig, ' ')), range);
        });
      });
    };
    const fromObj = (o) => {
      const days = this.parseDays(o.days ?? o.day ?? o.on);
      let range = null;
      if (o.all_day === true || o.allDay === true || ALLDAY.test(String(o.hours || o.time || ''))) {
        range = { startMin: 0, endMin: 0 };
      } else if (typeof o.startMin === 'number' && typeof o.endMin === 'number') {
        range = { startMin: this._clampMin(o.startMin, 540), endMin: this._clampMin(o.endMin, 1020) };
      } else {
        const sRaw = o.start ?? o.from ?? o.open, eRaw = o.end ?? o.to ?? o.until ?? o.close;
        if (sRaw != null && eRaw != null) {
          const a = this._timeTok(typeof sRaw === 'number' ? sRaw : String(sRaw));
          const b = this._timeTok(typeof eRaw === 'number' ? eRaw : String(eRaw));
          if (a && b) range = this._rangeFromToks(a, b);
        } else if (o.hours || o.time) {
          range = this.parseRange(o.hours || o.time);
        }
      }
      push(days, range);
    };
    (Array.isArray(input) ? input : [input]).forEach(it => {
      if (it && typeof it === 'object') fromObj(it); else if (it != null) fromText(it);
    });
    return out.length ? out : null;
  },
};

// ── REPETITION_GUARD ──────────────────────────────────────────
// Cheap defence against the "the bot opened with the same phrase 4 times in
// a row" tell. Stores a small rolling ring of fingerprints of recently-sent
// outbound messages PER CONVERSATION. A new draft that fingerprints to a
// match in the ring gets a single regenerate hint passed back to the engine,
// which appends an explicit "don't repeat your last opener" line to the
// system_extra and re-runs the LLM call once.
//
// Fingerprint: lowercase first 6 words of the message after trimming filler
// (greetings, wakeup tokens, names) — captures the OPENING SHAPE, which is
// what humans actually notice. Plus a single hash of the whole-message
// length-banded skeleton so we also catch "thanks for the message — happy
// to help with that. let me know if you have other questions." style
// recurring closers.
//
// Optimisation notes:
//   • djb2 hash, no base64 / hex — kept as a JS number (53-bit, plenty
//     for a ring of 6-20 fingerprints).
//   • Ring is per-conv. We don't share globally — different conversations
//     SHOULD see the bot's standard greetings; that's not the giveaway.
//     The giveaway is "this same person has been told 'great question!'
//     four times this thread."
//   • Window size capped at 20 (the typical operator setting will be 4-8).
//   • check() is O(window-size) — the whole pass for one reply is < 50 ops
//     on a 6-deep ring. No allocations in the hot path.
const REPETITION_GUARD = {
  // convId → { entries: [{opener, subOpener, tokens, moves, shape, preview}], cap }
  rings: new Map(),

  // djb2 — fast, non-cryptographic, plenty good for fingerprint dedupe.
  _hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return h;
  },

  // ── TOKENS ──
  // Content words only, lightly stemmed, so "it lands" / "it landed" /
  // "it's landing" collapse together. Exact-hash matching is what let
  // near-identical replies through before: one changed word produced a
  // different hash and the guard saw nothing.
  _STOP: new Set(['a','an','the','and','or','but','if','so','then','that','this','it','its','is','are','was','were','be','been','am','i','you','your','yours','we','our','my','me','to','of','in','on','at','for','with','from','by','as','will','ll','would','can','could','should','just','yeah','yep','ok','okay','do','does','did','have','has','had','get','got','there','here','when','once','soon','any','some','all','no','not','up','out','about','into','over','than','them','they','he','she','his','her']),

  _stem(w) {
    if (w.length <= 3) return w;
    return w.replace(/(ing|ed|es|s)$/, '') || w;
  },

  _tokens(text) {
    const t = String(text || '')
      .replace(/\[\[(?:SPLIT|ACTION:[^\]]*|INVOICE:[^\]]*)\]\]/gi, ' ')
      .replace(/Send\s+[A-Z0-9/]+\s+to:[\s\S]*/i, ' ')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, ' ');
    const out = [];
    for (const raw of t.split(/\s+/)) {
      if (!raw) continue;
      const w = raw.replace(/'/g, '');
      if (!w || this._STOP.has(w)) continue;
      out.push(this._stem(w));
    }
    return out;
  },

  // Jaccard overlap of two token lists.
  _sim(a, b) {
    if (!a.length || !b.length) return 0;
    const A = new Set(a), B = new Set(b);
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter / (A.size + B.size - inter);
  },

  // ── MOVES ──
  // What the message DOES, independent of the words it uses. This is the
  // detector that catches the failure the old guard could not see: the
  // model saying the identical thing in fresh wording every turn.
  // "i'll ping you when it lands" and "i'll let you know once it clears"
  // share almost no tokens and are the same move.
  _MOVES: [
    ['greet',          /^\s*(?:hi|hey|hello|heya|hiya|yo|sup|howdy|morning|good\s+(?:morning|afternoon|evening))\b/i],
    ['reassure',       /\b(?:no worries|no problem|not a problem|no stress|all good|don'?t worry|no biggie|it'?s fine)\b/i],
    ['agree',          /\b(?:sure thing|of course|absolutely|certainly|sounds good|works for me|will do|can do|got it|gotcha|understood)\b/i],
    ['promise_update', /\b(?:i'?ll|i\s+will|ill)\b[^.!?]{0,40}\b(?:ping|let\s+you\s+know|message\s+you|update\s+you|shout|text\s+you|get\s+back\s+to\s+you|tell\s+you)\b|\bkeep\s+you\s+(?:posted|updated|in\s+the\s+loop)\b/i],
    ['ask_patience',   /\b(?:give\s+it\s+(?:a\s+few|a\s+couple|another|some)|shouldn'?t\s+be\s+long|any\s+(?:minute|moment)\s+now|soon\s+as\s+it|once\s+it\s+(?:lands|confirms|clears|goes\s+through|comes\s+in)|as\s+soon\s+as\s+it|hang\s+tight|bear\s+with)\b/i],
    ['offer_help',     /\b(?:anything\s+else|need\s+anything|let\s+me\s+know\s+if|happy\s+to\s+help|here\s+if\s+you\s+need|any\s+other\s+questions|feel\s+free\s+to)\b/i],
    ['thanks',         /\b(?:thanks|thank\s+you|cheers|appreciate\s+it)\b/i],
    ['apologise',      /\b(?:sorry|apologies|apologise|apologize|my\s+bad)\b/i],
    ['quote_price',    /[$€£]\s?\d|\b\d+(?:\.\d+)?\s?(?:usd|eur|gbp|btc|ltc|eth|xmr|usdt)\b|\/mo\b|\bper\s+month\b/i],
    ['stock_status',   /\b(?:in\s+stock|out\s+of\s+stock|sold\s+out|we\s+(?:have|got|stock)|available|restock)\b/i],
    ['confirm_paid',   /\b(?:got\s+your\s+payment|payment\s+(?:received|confirmed|landed)|just\s+landed|came\s+through|all\s+confirmed|\d+\s+of\s+\d+\s+confirm)\b/i],
    ['ask_coin',       /\b(?:which|what)\b[^?]{0,30}\b(?:coin|crypto|currency)\b|\bpay\s+with\b/i],
    ['ask_product',    /\b(?:which|what)\b[^?]{0,30}\b(?:one|product|package|plan|tier|option)\b/i],
    ['ask_need',       /\b(?:what\s+are\s+you\s+(?:after|looking\s+for)|what\s+can\s+i\s+get\s+you|how\s+can\s+i\s+help|what\s+do\s+you\s+need)\b/i],
    ['escalate',       /\b(?:pass\s+(?:this\s+)?(?:to|on)|flag\s+(?:a|the)\s+human|hand\s+(?:this\s+)?over)\b/i],
  ],

  // Moves that hand the customer nothing new. A reply made only of these
  // is a filler turn — fluent, polite and empty.
  _SOCIAL: new Set(['greet','reassure','agree','promise_update','ask_patience','offer_help','thanks','apologise']),

  _LABELS: {
    greet:'greeting them', reassure:'reassuring them', agree:'acknowledging',
    promise_update:'promising to update them', ask_patience:'asking them to wait',
    offer_help:'offering further help', thanks:'thanking them', apologise:'apologising',
    quote_price:'quoting a price', stock_status:'giving stock info',
    confirm_paid:'giving payment status', ask_coin:'asking which coin',
    ask_product:'asking which product', ask_need:'asking what they want',
    escalate:'offering a human',
  },

  _moves(text) {
    const t = String(text || '');
    const out = [];
    for (const [id, re] of this._MOVES) if (re.test(t)) out.push(id);
    return out;
  },

  _isFiller(moves) {
    return moves.length > 0 && moves.every(m => this._SOCIAL.has(m));
  },

  // Strip leading greeting/ack so we fingerprint the SUBSTANTIVE opener
  // too. We keep both: the raw opener catches "hey gary" repeating, the
  // substantive one catches the same sentence behind a rotating ack.
  _normalizeOpener(text) {
    if (!text) return '';
    let t = String(text).toLowerCase().trim();
    t = t.replace(/^(hey(?:\s+\w+)?|hi(?:\s+\w+)?|hello(?:\s+\w+)?|yo(?:\s+\w+)?|sup|good\s+(?:morning|afternoon|evening))[!,.\s—-]+/i, '');
    t = t.replace(/^(yeah|yep|yup|sure|ok(?:ay)?|sounds\s+good|got\s+it|cool|nice|awesome|great|perfect|absolutely|certainly|of\s+course|no\s+worries|no\s+problem)[!,.\s—-]+/i, '');
    return t.split(/\s+/).slice(0, 6).join(' ').replace(/[^\w\s']/g, '').trim();
  },

  _rawOpener(text) {
    return String(text || '').toLowerCase().trim()
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
  },

  // Structural rhythm: bubble count, sentence count, length band, whether
  // it ends on a question. Three replies sharing a signature read as a
  // template even when every word differs.
  //
  // A leading social beat ("got it", "hey") is now its own bubble on most
  // replies by design, so counting it here would make nearly every reply
  // share a signature and fire this check constantly. We measure the
  // SUBSTANCE instead: drop an opening bubble that is only a short marker.
  _stripLeadMarker(text) {
    const parts = String(text || '').split(/\[\[SPLIT\]\]/i);
    if (parts.length > 1 && this._tokens(parts[0]).length <= 2) {
      return parts.slice(1).join('[[SPLIT]]');
    }
    return String(text || '');
  },

  _shapeSig(text) {
    if (!text) return '';
    const body0     = this._stripLeadMarker(text);
    const bubbles   = (body0.match(/\[\[SPLIT\]\]/gi) || []).length + 1;
    const body      = body0.replace(/\[\[[^\]]*\]\]/g, ' ');
    const sentences = (body.match(/[.!?]+/g) || []).length;
    const len       = body.trim().length;
    const band      = len < 30 ? 0 : len < 80 ? 1 : len < 200 ? 2 : len < 500 ? 3 : 4;
    const endsQ     = /\?\s*$/.test(body.trim()) ? 1 : 0;
    return `${bubbles}:${Math.min(sentences, 4)}:${band}:${endsQ}`;
  },

  _entry(text) {
    return {
      opener:    this._hash(this._rawOpener(text)),
      subOpener: this._hash(this._normalizeOpener(text)),
      tokens:    this._tokens(text),
      moves:     this._moves(text),
      shape:     this._shapeSig(text),
      preview:   String(text).replace(/\[\[[^\]]*\]\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90),
    };
  },

  // Full check. Returns { repeat, kind, detail, offender } so the caller
  // can build a hint that names the ACTUAL offence instead of always
  // telling the model to "vary your opener" when the real problem was
  // that it promised an update for the third turn running.
  check(convId, text, windowSize) {
    const none = { repeat: false, kind: '', detail: '', offender: '' };
    if (!text) return none;
    const ring = this.rings.get(convId);
    if (!ring || !ring.entries.length) return none;

    const cap = Math.max(2, Math.min(20, windowSize || ring.cap || 6));
    const recent = ring.entries.slice(-cap);
    const cur = this._entry(text);

    // Very short replies ("yeah", "ok") legitimately recur. Nothing to vary.
    if (cur.tokens.length < 3 && !this._isFiller(cur.moves)) return none;

    // 1. Near-duplicate wording. Fuzzy, so one swapped word no longer hides it.
    for (let i = recent.length - 1; i >= 0; i--) {
      if (this._sim(cur.tokens, recent[i].tokens) >= 0.55) {
        return { repeat: true, kind: 'near_duplicate', offender: recent[i].preview,
                 detail: 'This is almost word-for-word something you already sent.' };
      }
    }

    // 2. This turn adds nothing AND echoes a move the last reply already
    //    made. Matched by OVERLAP, not exact set equality: "i'll ping you
    //    when it lands" is [promise_update] and "i'll let you know once it
    //    goes through" is [promise_update, ask_patience]. Those sets are
    //    not equal, and demanding equality let the exact case this guard
    //    exists to catch walk straight past it.
    //
    //    Only the CURRENT turn has to be empty. The previous reply may
    //    well have carried real information alongside the promise — that
    //    does not license re-promising it, which is the commonest version
    //    of this failure.
    const prev = recent[recent.length - 1];
    if (cur.moves.length && this._isFiller(cur.moves) && prev.moves.length) {
      const shared = cur.moves.filter(m => prev.moves.includes(m));
      if (shared.length) {
        const label = shared.map(m => this._LABELS[m] || m).join(' + ');
        return { repeat: true, kind: 'same_move', offender: prev.preview,
                 detail: `You are ${label} again, which is something your last reply already did. Different words, same move.` };
      }
    }

    // 3. Filler streak — three turns running with nothing new in any of them.
    if (this._isFiller(cur.moves) && recent.length >= 2
        && this._isFiller(recent[recent.length - 1].moves)
        && this._isFiller(recent[recent.length - 2].moves)) {
      return { repeat: true, kind: 'filler_streak', offender: prev.preview,
               detail: 'This would be your third reply in a row that tells the customer nothing they did not already know.' };
    }

    // 4. Reused opener. A short social marker ("got it", "hey") is now the
    //    standard way a reply starts, and there are only so many of them —
    //    reusing one four replies apart is normal human speech, so checking
    //    those against the whole window would regenerate constantly. Short
    //    markers are therefore only compared against the last two replies;
    //    a substantive opener is still checked across the full window.
    const curIsMarker = this._tokens(String(text).split(/\[\[SPLIT\]\]/i)[0]).length <= 2;
    const openerScope = curIsMarker ? recent.slice(-2) : recent;
    for (let i = openerScope.length - 1; i >= 0; i--) {
      if (openerScope[i].opener === cur.opener || (cur.subOpener && openerScope[i].subOpener === cur.subOpener)) {
        return { repeat: true, kind: 'same_opener', offender: openerScope[i].preview,
                 detail: curIsMarker
                   ? 'You opened your last reply with this exact word too. Use a different one, or go straight into the answer with no opener.'
                   : 'You have opened a reply this way already in this conversation.' };
      }
    }

    // 5. Structural template — same rhythm three times running. Weakest
    //    signal, so it needs a full run before it fires.
    if (recent.length >= 2 && cur.shape === prev.shape && cur.shape === recent[recent.length - 2].shape) {
      return { repeat: true, kind: 'same_shape', offender: prev.preview,
               detail: 'Your last two replies had this identical rhythm (same bubble count, same length, same ending). A third makes it a visible template.' };
    }

    return none;
  },

  // Back-compat boolean wrapper — existing callers keep working.
  isRepeat(convId, text, windowSize) {
    return this.check(convId, text, windowSize).repeat;
  },

  // The engine records each [[SPLIT]] bubble separately as it sends, but
  // check() runs against the whole draft. Left alone, a 3-bubble reply
  // becomes 3 ring entries whose shape signature always reads "1 bubble",
  // and the rhythm check ends up comparing whole replies against
  // fragments. The caller passes isContinuation=true for chunks 2..n of
  // the same reply so we fold them back into one entry. We deliberately
  // do NOT infer this from timing: in a fast back-and-forth two genuinely
  // separate replies can land seconds apart, and merging those would
  // quietly corrupt the ring.
  record(convId, text, windowSize, isContinuation) {
    if (!text) return;
    const cap = Math.max(2, Math.min(20, windowSize || 6));
    let ring = this.rings.get(convId);
    if (!ring) { ring = { entries: [], cap }; this.rings.set(convId, ring); }
    ring.cap = cap;
    const last = ring.entries[ring.entries.length - 1];
    if (isContinuation && last) {
      // Rejoin with the SPLIT marker, not a newline: a reassembled entry has
      // to look like the draft it came from, or the shape signature cannot
      // tell where the bubble boundaries were and a leading social beat
      // stops being strippable.
      const raw = last.raw + '\n[[SPLIT]]\n' + text;
      const merged = this._entry(raw);
      merged.raw = raw;
      ring.entries[ring.entries.length - 1] = merged;
    } else {
      const e = this._entry(text);
      e.raw = String(text);
      ring.entries.push(e);
    }
    ring._lastTouch = Date.now();
    while (ring.entries.length > cap) ring.entries.shift();
  },

  // After a restart the ring is empty, so the first replies of a session
  // were checked against nothing. Rebuild it from the loaded history: every
  // run of consecutive agent bubbles (AI or operator — both are "us" to the
  // customer) becomes one entry, undelivered ones excluded.
  seedFromThread(convId, thread, windowSize) {
    if (!convId || !Array.isArray(thread) || !thread.length) return;
    const ring = this.rings.get(convId);
    if (ring && ring.entries.length) return;
    const cap = Math.max(2, Math.min(20, windowSize || 6));
    const cutoff = Date.now() - 6 * 3600 * 1000;
    const replies = [];
    let cur = null;
    for (const m of thread) {
      if (!m || m.del) continue;
      const mine = (m.r === 'bot' || m.r === 'out') && !m.err;
      if (!mine) { if (m.r === 'in') cur = null; continue; }
      if ((m.ts || 0) < cutoff) { cur = null; continue; }
      const text = String(m.c || '').trim();
      if (!text) continue;
      if (cur) cur.push(text); else { cur = [text]; replies.push(cur); }
    }
    for (const parts of replies.slice(-cap)) this.record(convId, parts.join('\n[[SPLIT]]\n'), cap, false);
  },

  // Last line of defence after a regenerate that still repeats: drop any
  // bubble that is a near-copy of something already sent. Returns the
  // remaining text, and whether everything was a copy.
  dedupeChunks(convId, text) {
    const ring = this.rings.get(convId);
    const parts = String(text || '').split(/\s*\[\[SPLIT\]\]\s*/i).map(x => x.trim()).filter(Boolean);
    if (!ring || !ring.entries.length || !parts.length) return { text, dropped: 0, allDup: false };
    const sent = [];
    for (const e of ring.entries) {
      for (const b of String(e.raw || '').split(/\s*\[\[SPLIT\]\]\s*/i)) {
        const tk = this._tokens(b);
        if (tk.length >= 3) sent.push(tk);
      }
    }
    const keep = parts.filter(p => {
      if (/\[\[(?:ACTION|INVOICE|LICENSE)/i.test(p)) return true;
      const tk = this._tokens(p);
      if (tk.length < 3) return true;
      return !sent.some(s2 => this._sim(tk, s2) >= 0.6);
    });
    return { text: keep.join('\n[[SPLIT]]\n'), dropped: parts.length - keep.length, allDup: keep.length === 0 };
  },

  resetIfStale(convId, sinceMs) {
    if (!sinceMs) return;
    const ring = this.rings.get(convId);
    if (!ring) return;
    if (Date.now() - (ring._lastTouch || 0) > sinceMs) { this.rings.delete(convId); return; }
    ring._lastTouch = Date.now();
  },

  // Dynamic hint. The old one was a single static string about openers,
  // which is useless when the offence was something else — the model was
  // told to vary its opener while the real problem was that it had
  // promised an update three turns running. Naming the specific offence
  // and quoting the offending message is what makes the retry land.
  hintFor(convId, draft) {
    const res = draft ? this.check(convId, draft, 0) : null;
    let head = 'REPETITION — REWRITE BEFORE SENDING.';
    let body = 'Your last few replies reused the same phrasing. Vary it.';
    let offender = '';

    if (res && res.repeat) {
      body = res.detail;
      offender = res.offender;
    }

    const lines = [head, body];
    if (offender) lines.push(`The reply you are echoing was: "${offender}"`);

    if (res && (res.kind === 'same_move' || res.kind === 'filler_streak')) {
      lines.push(
        'Rewording it will NOT fix this — the problem is not the words, it is that this turn adds nothing.',
        'Do ONE of these instead:',
        '  1. Give them something they do not have yet: a number, a status, a concrete option, a real answer.',
        '  2. If there is genuinely nothing new, send something almost empty ("still nothing yet", "yep") rather than dressing the same message up again.',
        '  3. If even that adds nothing, set thinking.should_reply=false and stay quiet. Real people go quiet. It is not a failure.',
        'Do NOT re-promise anything you have already promised. They heard you the first time.'
      );
    } else if (res && res.kind === 'same_shape') {
      lines.push('Change the RHYTHM, not just the words: different number of messages, different length, do not end the same way.');
    } else {
      lines.push('Start on different words, change the rhythm, and do not reuse any phrase from your recent replies. Going straight into the content with no opener is usually the cleanest fix.');
    }
    return lines.join('\n');
  },
};

// ── IMPERFECTION ──────────────────────────────────────────────
// Optional, gated, deterministic-ish prose transforms that make the bot's
// output look more human. Each transform reads its probability from the
// agent and decides per-call whether to fire. Transforms compose: typo
// injection runs first, then lowercase drift, then we OPTIONALLY emit a
// short "self-correction" follow-up chunk.
//
// Why this is gated by style: a 'pro' agent dropping commas and lowercase
// would read as broken, not human. So:
//   • typo / lowercase drift NEVER fire on style='pro' or style='expert'
//     regardless of the slider value (the slider is a ceiling, not a floor).
//   • self-correction can fire on any style, because it's just "*the" /
//     "sorry, meant Tuesday" — that's an apology beat, not malformed prose.
// ── SCRIPT / LANGUAGE DETECTION FOR THE REALISM LAYER ────────────────
// The realism features (typos, lowercase drift, self-corrections) were
// written assuming English. Two of them break on other languages:
//
//   • selfCorrectionFor() draws from a hard-coded ENGLISH phrase bank and
//     sends the result to the customer as its own message. A Chinese
//     customer got a fluent Chinese reply followed by "sorry, brain fart".
//   • injectTypo()'s /[a-z]{4,}/ only sees ASCII, so it silently does
//     nothing for CJK/Cyrillic/Arabic and, worse, matches only the ASCII
//     FRAGMENT of an accented word ("tambi" inside "también"), producing
//     mutations that don't read like real typos.
//
// detectScript classifies the text so each feature can adapt rather than
// misfire. Deliberately cheap and heuristic — this runs on every outbound
// chunk and only needs to be right enough to pick a strategy.
const detectScript = (text) => {
  const t = String(text || '');
  if (!t.trim()) return 'latin';
  // Order matters. Kana is tested BEFORE Han: Japanese prose mixes kanji
  // (Han range) with kana, so checking Han first labels ordinary Japanese
  // as Chinese. Kana is decisive in both directions — Japanese text almost
  // always contains some, and Chinese never contains any.
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(t))               return 'kana';
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(t))               return 'han';
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(t))               return 'hangul';
  if (/[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff]/.test(t)) return 'arabic';
  if (/[\u0590-\u05ff]/.test(t))                            return 'hebrew';
  if (/[\u0400-\u04ff]/.test(t))                            return 'cyrillic';
  if (/[\u0370-\u03ff]/.test(t))                            return 'greek';
  if (/[\u0900-\u097f]/.test(t))                            return 'devanagari';
  if (/[\u0e00-\u0e7f]/.test(t))                            return 'thai';
  return 'latin';
};

// Scripts with no letter case at all. Lowercase drift is meaningless for
// these — applying it is a no-op, but skipping is clearer and cheaper.
const CASELESS_SCRIPTS = new Set(['han', 'kana', 'hangul', 'arabic', 'hebrew', 'devanagari', 'thai']);

// Does this text look like English? Used ONLY to decide whether the
// English self-correction bank is safe to use. Conservative by design:
// when unsure we suppress the filler rather than risk sending English
// into a non-English conversation.
//
// Non-Latin script → definitely not English. Latin script with accented
// characters or non-English stopwords → treat as not-English. Bare ASCII
// with no signal is ambiguous (Spanish "vale hasta manana" has no accents)
// so we look for common English function words as positive evidence.
const looksEnglish = (text) => {
  const t = String(text || '').trim();
  if (!t) return true;                              // nothing to corrupt
  if (detectScript(t) !== 'latin') return false;
  // Accented Latin letters — strong signal of a non-English language.
  if (/[\u00c0-\u024f]/.test(t)) return false;
  const low = ' ' + t.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  // Common non-English function words that are pure ASCII.
  const foreign = [' el ',' la ',' los ',' las ',' que ',' con ',' para ',' pero ',' esta ',' este ',' por ',' una ',' del ',' als ',
                   ' het ',' een ',' niet ',' voor ',' maar ',' ist ',' nicht ',' und ',' oder ',' aber ',' auch ',' sie ',
                   ' les ',' des ',' est ',' pas ',' vous ',' nous ',' mais ',' pour ',
                   ' nao ',' voce ',' obrigado ',' isso ',' como ',' mas ',
                   ' che ',' non ',' sono ',' anche ',' questo ',' grazie '];
  if (foreign.some(w => low.includes(w))) return false;
  // Positive English evidence. A short reply ("ok", "sure") has none, and
  // that is fine — short replies are ambiguous in every language, and the
  // filler is low-value there anyway.
  const english = [' the ',' and ',' you ',' your ',' that ',' this ',' with ',' for ',' have ',' just ',' will ',' can ',
                   ' its ',' it ',' is ',' are ',' was ',' to ',' of ',' on ',' we ',' i ',' me ',' my ',' do ',' not ',
                   ' ok ',' yes ',' no ',' thanks ',' sure ',' hi ',' hey ',' hello '];
  return english.some(w => low.includes(w));
};

// ── PAYMENT CONFIRMATION, BY LANGUAGE ────────────────────────────────
// Sent the moment a payment confirms. English keeps its tone-branched
// pools elsewhere in this file; these are warm-neutral equivalents for
// non-English conversations. Functions rather than templates because the
// amount lands in a different position depending on the language.
// ── PHRASE MEMORY ────────────────────────────────────────────────────
// Stops a canned line being reused on the same conversation. Random
// selection from a pool of six will hand a repeat customer the same
// sentence roughly one time in six, and a customer who has bought three
// times and seen "got it, thank you" twice has learned something about
// who they are talking to.
//
// Keyed per conversation AND per kind, so the payment confirmation bank
// and any future bank keep separate histories. The remembered value is the
// text that actually went out, which means a persona-composed line also
// counts against a later identical one.
//
// Memory is intentionally in-process only. Losing it on restart costs one
// possible repeat, months apart; persisting it would mean a storage write
// on a path that sits in front of a message the customer is waiting for.
const PHRASE_MEMORY = {
  _seen: new Map(),                 // `${convId}::${kind}` -> [text, ...]
  _stable: new Map(),               // `${convId}::${kind}##${key}` -> text
  _key(convId, kind){ return String(convId || '') + '::' + String(kind || ''); },
  _list(convId, kind){
    const k = this._key(convId, kind);
    if (!this._seen.has(k)) this._seen.set(k, []);
    return this._seen.get(k);
  },
  // Pick something this conversation has not had recently. Once every
  // option is spent the history clears and the full pool is live again,
  // so a very long-running conversation cycles rather than starving.
  pick(convId, kind, pool){
    const opts = Array.isArray(pool) ? pool.filter(x => x && String(x).trim()) : [];
    if (!opts.length) return '';
    const seen = this._list(convId, kind);
    let fresh = opts.filter(o => !seen.includes(o));
    if (!fresh.length) { seen.length = 0; fresh = opts; }
    return fresh[Math.floor(Math.random() * fresh.length)];
  },
  // Same as pick(), but pinned to a stable key so ONE thing always renders
  // the same phrasing while DIFFERENT things vary.
  //
  // The invoice block needs exactly this. The old code hashed the wallet
  // address into a seed and indexed the pool with it, which pinned the
  // phrasing per invoice but gave no guarantee that two invoices differ —
  // with seven options, two addresses collide about one time in seven, and
  // a customer who orders twice hits it far more often than that sounds
  // because the pool is re-entered from scratch every time. pick() handles
  // the variation; the key handles the pinning; the two no longer fight.
  //
  // Pass the address (or invoice id) as stableKey: re-sending the same
  // invoice, or the dedupe path reusing a pending one, reproduces the
  // identical wording instead of quietly rewording a message the customer
  // has already seen.
  pickStable(convId, kind, pool, stableKey){
    const opts = Array.isArray(pool) ? pool.filter(x => x && String(x).trim()) : [];
    if (!opts.length) return '';
    const sk = String(stableKey || '');
    if (!sk) { const p = this.pick(convId, kind, opts); this.remember(convId, kind, p); return p; }
    const ck = this._key(convId, kind) + '##' + sk;
    if (this._stable.has(ck)) return this._stable.get(ck);
    const picked = this.pick(convId, kind, opts);
    this._stable.set(ck, picked);
    this.remember(convId, kind, picked);
    // Bounded. Map iterates in insertion order, so the oldest pins go first.
    if (this._stable.size > 500) {
      const drop = this._stable.size - 500;
      let i = 0;
      for (const key of this._stable.keys()) { if (i++ >= drop) break; this._stable.delete(key); }
    }
    return picked;
  },
  // What this conversation has recently been sent from a given bank.
  recent(convId, kind){ return this._list(convId, kind).slice(); },

  // Distinctive words that make two short messages feel like the same
  // message. Deliberately narrow: these are the words the payment banks
  // actually collide on, not a general stopword list.
  _MARKERS: /\b(exact|exactly|address|send|sending|sent|confirm|confirmed|confirms|clear|cleared|clears|receive|received|arrive|arrived|minute|minutes|rush|through|good|sorted)\b/gi,
  _markerSet(text){
    return new Set((String(text || '').toLowerCase().match(this._MARKERS) || [])
      .map(w => w.replace(/(s|ed|ing)$/, '')));
  },

  // pick(), but also steering clear of anything this conversation has
  // already heard from OTHER banks.
  //
  // The banks are written independently and know nothing about each other,
  // so the payment tail and the confirmation that follows it could land on
  // the same idea back to back: "i'll confirm here once it clears" and then,
  // minutes later, "cleared. thanks." Read on their own each is fine; read
  // in a column they are one sentence said twice, which is exactly the tell
  // this whole file exists to avoid. If avoidance would empty the pool we
  // fall back to plain pick() — saying something slightly echoey beats
  // saying nothing at the moment money lands.
  pickDistinct(convId, kind, pool, avoidKinds){
    const opts = Array.isArray(pool) ? pool.filter(x => x && String(x).trim()) : [];
    if (!opts.length) return '';
    const kinds = Array.isArray(avoidKinds) ? avoidKinds : [];
    if (!kinds.length) return this.pick(convId, kind, opts);
    const used = new Set();
    for (const k of kinds) {
      for (const t of this.recent(convId, k)) {
        for (const w of this._markerSet(t)) used.add(w);
      }
    }
    if (!used.size) return this.pick(convId, kind, opts);
    const fresh = opts.filter(o => {
      for (const w of this._markerSet(o)) if (used.has(w)) return false;
      return true;
    });
    return this.pick(convId, kind, fresh.length ? fresh : opts);
  },

  remember(convId, kind, text){
    const t = String(text || '').trim();
    if (!t) return;
    const seen = this._list(convId, kind);
    if (!seen.includes(t)) seen.push(t);
    // Keep the window small. Remembering forever would eventually exclude
    // everything and force the reset path on every single call.
    if (seen.length > 12) seen.splice(0, seen.length - 12);
  },
};

const PAYMENT_CONFIRM_BANK = {
  es: {subject:'el pago', one:[a=>`listo, ${a} ha entrado. ¡gracias!`, a=>`${a} confirmado, todo en orden`, a=>`perfecto, acabo de ver ${a}. ¡gracias!`],
       many:[(a,c)=>`${a} totalmente confirmado (${c} confirmaciones). ¡todo listo!`, (a,c)=>`${a} liquidado con ${c} confirmaciones`]},
  fr: {subject:'le paiement', one:[a=>`c'est bon, ${a} est arrivé. merci !`, a=>`${a} confirmé, tout est en ordre`, a=>`parfait, je vois ${a}. merci !`],
       many:[(a,c)=>`${a} entièrement confirmé (${c} confirmations). tout est bon !`, (a,c)=>`${a} réglé avec ${c} confirmations`]},
  de: {subject:'die Zahlung', one:[a=>`super, ${a} ist da. danke!`, a=>`${a} bestätigt, alles passt`, a=>`perfekt, ${a} ist eingegangen. danke!`],
       many:[(a,c)=>`${a} vollständig bestätigt (${c} bestätigungen). alles gut!`, (a,c)=>`${a} mit ${c} bestätigungen abgeschlossen`]},
  pt: {subject:'o pagamento', one:[a=>`boa, ${a} entrou. obrigado!`, a=>`${a} confirmado, está tudo certo`, a=>`perfeito, acabei de ver ${a}. obrigado!`],
       many:[(a,c)=>`${a} totalmente confirmado (${c} confirmações). tudo certo!`, (a,c)=>`${a} liquidado com ${c} confirmações`]},
  it: {subject:'il pagamento', one:[a=>`ottimo, ${a} è arrivato. grazie!`, a=>`${a} confermato, tutto a posto`, a=>`perfetto, ho visto ${a}. grazie!`],
       many:[(a,c)=>`${a} completamente confermato (${c} conferme). tutto ok!`, (a,c)=>`${a} liquidato con ${c} conferme`]},
  nl: {subject:'de betaling', one:[a=>`top, ${a} is binnen. bedankt!`, a=>`${a} bevestigd, alles goed`, a=>`mooi, ik zie ${a}. bedankt!`],
       many:[(a,c)=>`${a} volledig bevestigd (${c} bevestigingen). helemaal goed!`, (a,c)=>`${a} afgerond met ${c} bevestigingen`]},
  pl: {subject:'płatność', one:[a=>`super, ${a} dotarło. dzięki!`, a=>`${a} potwierdzone, wszystko gra`, a=>`widzę ${a}. dzięki!`],
       many:[(a,c)=>`${a} w pełni potwierdzone (${c} potwierdzeń). wszystko gotowe!`, (a,c)=>`${a} rozliczone przy ${c} potwierdzeniach`]},
  tr: {subject:'ödeme', one:[a=>`harika, ${a} geldi. teşekkürler!`, a=>`${a} onaylandı, her şey tamam`, a=>`${a} ulaştı. teşekkürler!`],
       many:[(a,c)=>`${a} tamamen onaylandı (${c} onay). her şey hazır!`, (a,c)=>`${a} ${c} onayla tamamlandı`]},
  ru: {subject:'платёж', one:[a=>`отлично, ${a} пришло. спасибо!`, a=>`${a} подтверждено, всё в порядке`, a=>`вижу ${a}. спасибо!`],
       many:[(a,c)=>`${a} полностью подтверждено (${c} подтверждений). всё готово!`, (a,c)=>`${a} зачислено при ${c} подтверждениях`]},
  zh: {subject:'款项', one:[a=>`收到了，${a} 已到账。谢谢！`, a=>`${a} 已确认，一切正常`, a=>`${a} 到账了，谢谢！`],
       many:[(a,c)=>`${a} 已完全确认（${c} 次确认），一切就绪！`, (a,c)=>`${a} 已在 ${c} 次确认后结算`]},
  ja: {subject:'お支払い', one:[a=>`${a} の入金を確認しました。ありがとうございます！`, a=>`${a} 確認できました、問題ありません`, a=>`${a} 届きました。ありがとうございます！`],
       many:[(a,c)=>`${a} が完全に確認されました（${c} 承認）。準備完了です！`, (a,c)=>`${a} は ${c} 承認で確定しました`]},
  ko: {subject:'결제', one:[a=>`${a} 입금 확인했습니다. 감사합니다!`, a=>`${a} 확인되었습니다, 모두 정상입니다`, a=>`${a} 들어왔습니다. 감사합니다!`],
       many:[(a,c)=>`${a} 완전히 확인되었습니다 (${c}회 확인). 모두 준비됐습니다!`, (a,c)=>`${a} 이(가) ${c}회 확인으로 정산되었습니다`]},
  ar: {subject:'الدفعة', one:[a=>`تمام، وصل ${a}. شكرًا لك!`, a=>`تم تأكيد ${a}، كل شيء على ما يرام`, a=>`رأيت ${a}. شكرًا!`],
       many:[(a,c)=>`تم تأكيد ${a} بالكامل (${c} تأكيدات). كل شيء جاهز!`, (a,c)=>`تمت تسوية ${a} بـ ${c} تأكيدات`]},
  hi: {subject:'भुगतान', one:[a=>`बढ़िया, ${a} आ गया। धन्यवाद!`, a=>`${a} पुष्ट हो गया, सब ठीक है`, a=>`${a} मिल गया। धन्यवाद!`],
       many:[(a,c)=>`${a} पूरी तरह पुष्ट (${c} पुष्टियाँ)। सब तैयार है!`, (a,c)=>`${a} ${c} पुष्टियों के साथ निपट गया`]},
};

const IMPERFECTION = {
  // Tiny per-char swap. Picks one or two adjacent letters and either drops
  // a letter or swaps it with the next. Skips: words shorter than 4 chars,
  // numbers, URLs, code-y tokens (anything with `/`, `:`, `_`, `@`).
  // Returns the (possibly-mutated) text.
  injectTypo(text, ratePct, style) {
    if (!text || !ratePct) return text;
    if (style === 'pro' || style === 'expert' || style === 'concise') return text;
    // ratePct is 0..100 — interpreted as "percent chance per word, capped".
    // A rate of 3 means each eligible word has a 3% chance of getting
    // mutated, which on a typical 30-word reply lands a typo on most replies.
    // We hard-clamp the per-message budget at 2 typos so the agent never
    // emits a wall of garbled text.
    const r = Math.max(0, Math.min(100, ratePct)) / 100;
    let budget = 2;

    // Character-based scripts (Chinese, Japanese, Korean, Thai) have no
    // word boundaries and no letter-level typos in the Latin sense — a
    // dropped or swapped character produces a DIFFERENT WORD, not a
    // recognisable slip. Transposing two hanzi can change the meaning
    // entirely or emit nonsense, so we skip typo injection for them
    // rather than risk garbling a customer's reply.
    const script = detectScript(text);
    if (script === 'han' || script === 'kana' || script === 'hangul' || script === 'thai') return text;

    // Unicode-aware word pattern. The old /\b([a-z]{4,})\b/gi matched
    // ASCII only, so "también" matched just the "tambi" fragment (JS \b
    // treats "é" as a non-word char) and mutations landed mid-word in ways
    // that don't read like real typos. This matches whole words including
    // accented Latin, Cyrillic, Greek, Hebrew and Arabic letters.
    const WORD_RE = /[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff]{4,}/g;
    return text.replace(WORD_RE, (word, offset, full) => {
      if (budget <= 0) return word;
      // Skip URLs, code, addresses (rough proxies — if the surrounding
      // chars are weird, it's not prose).
      if (/[\/:_@]/.test(word)) return word;
      // The letter run is often only PART of something that must reach the
      // customer exactly: "AUVM" in the key AUVM-5CCQ-ZS6V, "download" in
      // https://x.io/download, "setup" in setup_v2.zip. Look at the whole
      // whitespace-delimited token around it (minus ordinary sentence
      // punctuation at its edges); if anything inside it isn't a letter, or
      // the word is in capitals (keys, codes, acronyms), leave it alone.
      try {
        let s = offset, e = offset + word.length;
        while (s > 0 && !/\s/.test(full[s - 1])) s--;
        while (e < full.length && !/\s/.test(full[e])) e++;
        const tok = full.slice(s, e).replace(/^[("'\u201c\u2018\[]+|[)"'\u201d\u2019\],.!?;:…]+$/g, '');
        if (/[^A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff'\u2019]/.test(tok)) return word;
        if (word === word.toUpperCase() && word !== word.toLowerCase()) return word;
      } catch (_) { return word; }
      if (Math.random() > r) return word;
      budget--;
      // Pick a swap mode. Bias toward "drop a letter" — the most common
      // real human typo on phone keyboards.
      // Array.from so a surrogate pair (rare here, but possible) counts as
      // one character and we never split it in half.
      const chars = Array.from(word);
      if (chars.length < 4) return word;
      const mode = Math.random();
      const i = 1 + Math.floor(Math.random() * (chars.length - 2));   // never first/last char
      // Operate on the codepoint array throughout. Mixing `chars`-derived
      // indices with word.slice()/word[i] would drift apart the moment a
      // surrogate pair appears earlier in the word.
      if (mode < 0.45) {
        // drop one letter
        return chars.slice(0, i).concat(chars.slice(i + 1)).join('');
      } else if (mode < 0.85) {
        // swap with next letter
        return chars.slice(0, i)
          .concat([chars[i + 1], chars[i]])
          .concat(chars.slice(i + 2)).join('');
      } else {
        // duplicate the letter
        return chars.slice(0, i)
          .concat([chars[i], chars[i]])
          .concat(chars.slice(i + 1)).join('');
      }
    });
  },

  // Casual lowercase drift: drop the leading capital and the trailing
  // period/exclamation on short, prose-only chunks. Skips: chunks with
  // links, action sentinels (already filtered upstream), or that are a
  // question (the trailing '?' is informationally important).
  applyLowercaseDrift(text, enabled, style) {
    // Caseless scripts (CJK, Arabic, Hebrew, Devanagari, Thai) have no
    // leading capital to drop, and their sentences don't end in '.', so
    // this is a no-op at best. Bail early rather than run the Latin
    // heuristics over text they were never written for.
    if (CASELESS_SCRIPTS.has(detectScript(text))) return text;
    if (!text || !enabled) return text;
    if (style === 'pro' || style === 'expert') return text;
    // Don't molest URL-laden text.
    if (/https?:\/\//i.test(text)) return text;
    // Don't strip from very short replies (< 8 chars) — already informal.
    if (text.length < 8) return text;
    // Skip if the chunk has multiple sentences — partial casing reads worse
    // than consistent casing.
    const sentenceCount = (text.match(/[.!?]\s+[A-Z]/g) || []).length;
    if (sentenceCount > 0) return text;
    let t = text;
    // Lowercase the very first letter of the chunk, but only if the
    // first WORD isn't a name (proper noun). Heuristic: only do it when
    // the first word is one of a curated set of common openers, OR
    // the second character is also lowercase (indicating it WAS already
    // a normal capitalised word, not an acronym).
    const firstChar = t[0];
    const secondChar = t[1] || '';
    if (/[A-Z]/.test(firstChar) && /[a-z]/.test(secondChar)) {
      t = firstChar.toLowerCase() + t.slice(1);
    }
    // Drop the trailing period (but never '!' or '?').
    if (t.endsWith('.') && !t.endsWith('..')) {
      t = t.slice(0, -1);
    }
    return t;
  },

  // Decide (probabilistically) whether to emit a short self-correction
  // follow-up after the main reply. Returns null = no follow-up; otherwise
  // returns a string suitable for sending as a separate chunk. The trigger
  // is a hash of typoMutated XOR original — i.e. we only generate a "*the"
  // style correction if we ACTUALLY mutated text. Non-mutated text never
  // gets a follow-up.
  //
  // One correction shape:
  //   "*<word>"   — used when we mutated a real word. Picks the original
  //                 word, prefixed with '*'. This is the dominant phone-
  //                 keyboard correction style.
  // (A second, typo-less "soft" shape — "actually scratch that", "wait,
  // ignore that" — was removed: it retracted real answers at random.)
  selfCorrectionFor(originalText, mutatedText, pct, style) {
    if (!pct || Math.random() * 100 >= pct) return null;
    // If we DID mutate text, find the changed word and emit "*original".
    if (originalText && mutatedText && originalText !== mutatedText) {
      // Diff at word boundaries. Find the first word that differs.
      const oWords = originalText.split(/\s+/);
      const mWords = mutatedText.split(/\s+/);
      for (let i = 0; i < Math.min(oWords.length, mWords.length); i++) {
        if (oWords[i] !== mWords[i] && oWords[i] && /^[a-zA-Z]{3,}$/.test(oWords[i])) {
          return '*' + oWords[i].toLowerCase();
        }
      }
    }
    // No typo to correct → send NOTHING.
    //
    // This used to fire a random "soft" beat from CORRECTION_BANKS here
    // ("wait, ignore that", "actually scratch that", "or not, idk"). Every
    // one of those phrases RETRACTS whatever was just said, and the bank
    // was picked at random with no idea what the reply contained — so a
    // real answer ("you can get two.") was followed by the agent taking it
    // back. To a customer that reads as the seller changing their mind or
    // as a broken bot, never as a human. A self-correction is only honest
    // when there is something to correct, i.e. the "*word" fix above.
    // The banks are kept (detectLang shares the language detection) but
    // are no longer sent to customers.
    return null;
  },

  // Self-correction phrase banks, keyed by base language. Each is written
  // to read like a real person's afterthought in that language, not a
  // literal translation of the English — "brain fart" has no natural
  // equivalent in most of these, so each bank uses its own idiom.
  //
  // A language is included ONLY where the phrasing is idiomatic. Anything
  // not listed returns null and the filler is skipped entirely, which is
  // the correct default: no filler is always better than wrong-language
  // filler in front of a paying customer.
  CORRECTION_BANKS: {
    en: ['actually scratch that', 'wait, ignore that', 'or not, idk', 'sorry, brain fart', '*ignore me'],
    es: ['bueno, olvida eso', 'espera, ignora eso', 'o no, ni idea', 'perdón, me lié', '*ignórame'],
    fr: ['enfin, oublie ça', 'attends, ignore ça', 'ou pas, je sais pas', 'pardon, j\u2019ai buggé', '*oublie'],
    de: ['ach, vergiss das', 'warte, ignorier das', 'oder auch nicht, keine ahnung', 'sorry, hatte ein blackout', '*ignorier mich'],
    pt: ['esquece isso', 'espera, ignora isso', 'ou não, sei lá', 'desculpa, deu branco', '*ignora'],
    it: ['anzi, lascia stare', 'aspetta, ignora', 'o forse no, boh', 'scusa, ho avuto un vuoto', '*ignorami'],
    nl: ['laat maar', 'wacht, negeer dat', 'of niet, geen idee', 'sorry, even kwijt', '*negeer mij'],
    pl: ['nieważne', 'czekaj, zignoruj to', 'albo nie, nie wiem', 'sorry, zaćmienie', '*ignoruj'],
    tr: ['neyse, boş ver', 'dur, onu boş ver', 'ya da değil, bilmiyorum', 'pardon, aklım gitti', '*beni boş ver'],
    ru: ['хотя не, забей', 'стоп, не то', 'или нет, не знаю', 'сорри, затупил', '*не обращай внимания'],
  },

  // Resolve the bank for a piece of outgoing text.
  //
  // Detection is by SCRIPT plus a light word check, not by any stored
  // profile: the agent may switch language mid-conversation, and the text
  // in front of us is the most reliable evidence of what language this
  // particular message is in.
  // Language code for a piece of text, or null when we can't tell.
  // Extracted from correctionBankFor so the invoice block can localise
  // against the SAME detection — two independent detectors would drift and
  // you'd get a Spanish reply with a French invoice header.
  detectLang(text) {
    const t = String(text || '');
    const script = detectScript(t);
    if (script === 'cyrillic') return 'ru';
    if (script === 'han')      return 'zh';
    if (script === 'kana')     return 'ja';
    if (script === 'hangul')   return 'ko';
    if (script === 'arabic')   return 'ar';
    if (script === 'devanagari') return 'hi';
    if (script === 'hebrew')   return 'he';
    if (script === 'thai')     return 'th';
    if (script === 'greek')    return 'el';
    if (script !== 'latin')    return null;
    if (looksEnglish(t))       return 'en';
    const low = ' ' + t.toLowerCase().replace(/[^\u00c0-\u024fa-z\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
    const hit = (words) => words.some(w => low.includes(w));
    if (hit([' que ',' los ',' las ',' con ',' para ',' pero ',' esta ',' gracias ',' hola ',' está ',' señor '])) return 'es';
    if (hit([' não ',' você ',' obrigado ',' isso ',' está ',' pra ',' então ']))                                  return 'pt';
    if (hit([' les ',' des ',' est ',' pas ',' vous ',' bonjour ',' merci ',' être ',' c’est ']))              return 'fr';
    if (hit([' het ',' een ',' niet ',' voor ',' maar ',' bedankt ',' ik ',' jij ',' wij ']))                       return 'nl';
    if (hit([' nicht ',' und ',' oder ',' aber ',' auch ',' danke ',' ich ',' für ',' ein ']))                      return 'de';
    if (hit([' che ',' non ',' sono ',' anche ',' questo ',' grazie ',' ciao ',' perché ']))                        return 'it';
    if (hit([' nie ',' jest ',' dla ',' dziękuję ',' cześć ',' tak ',' żeby ']))                                    return 'pl';
    if (hit([' bir ',' için ',' değil ',' teşekkür ',' merhaba ',' var ',' yok ']))                                 return 'tr';
    return null;
  },

  correctionBankFor(text) {
    const t = String(text || '');
    const script = detectScript(t);
    // Cyrillic is effectively Russian for our purposes here; the other
    // non-Latin scripts have no bank, so they return null and stay silent.
    if (script === 'cyrillic') return this.CORRECTION_BANKS.ru;
    if (script !== 'latin')    return null;
    if (looksEnglish(t))       return this.CORRECTION_BANKS.en;
    // Latin script, clearly not English. Identify which one via a few
    // high-signal markers; fall through to silence when unsure.
    const low = ' ' + t.toLowerCase().replace(/[^\u00c0-\u024fa-z\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
    const hit = (words) => words.some(w => low.includes(w));
    if (hit([' que ',' los ',' las ',' con ',' para ',' pero ',' esta ',' gracias ',' hola ',' está ',' señor '])) return this.CORRECTION_BANKS.es;
    if (hit([' não ',' você ',' obrigado ',' isso ',' está ',' pra ',' então ']))                                  return this.CORRECTION_BANKS.pt;
    if (hit([' les ',' des ',' est ',' pas ',' vous ',' bonjour ',' merci ',' être ',' c\u2019est ']))              return this.CORRECTION_BANKS.fr;
    // 'hallo' is deliberately absent from BOTH the Dutch and German marker
    // sets — it is spelled identically in the two languages and cannot
    // disambiguate them. The surviving markers are mutually exclusive pairs
    // (ik/ich, een/ein, niet/nicht, voor/für), so neither can claim the
    // other's text regardless of order.
    if (hit([' het ',' een ',' niet ',' voor ',' maar ',' bedankt ',' ik ',' jij ',' wij ']))                       return this.CORRECTION_BANKS.nl;
    if (hit([' nicht ',' und ',' oder ',' aber ',' auch ',' danke ',' ich ',' für ',' ein ']))                      return this.CORRECTION_BANKS.de;
    if (hit([' che ',' non ',' sono ',' anche ',' questo ',' grazie ',' ciao ',' perché ']))                        return this.CORRECTION_BANKS.it;
    if (hit([' nie ',' jest ',' dla ',' dziękuję ',' cześć ',' tak ',' żeby ']))                                    return this.CORRECTION_BANKS.pl;
    if (hit([' bir ',' için ',' değil ',' teşekkür ',' merhaba ',' var ',' yok ']))                                 return this.CORRECTION_BANKS.tr;
    return null;
  },

  // Top-level: apply typo + drift to a chunk, return { text, original }.
  // The caller can then ask selfCorrectionFor() with these two values.
  apply(text, agent) {
    if (!agent) return { text, original: text, mutated: false };
    const original = text;
    let out = this.injectTypo(text, agent.typoRate || 0, agent.style);
    out = this.applyLowercaseDrift(out, agent.lowercaseDrift, agent.style);
    return { text: out, original, mutated: out !== original };
  },
};

// ── AGENTS STORE ──────────────────────────────────────────────
// Lives at module scope so the auto-reply engine (which fires from
// MSGS_STORE.onIncoming, also at module scope) can read agent config without
// having to hop through React state. AgentsView mounts a useAgents() hook that
// just mirrors this store and pushes saves through it.
const AGENTS_STORE = {
  list: [],
  loaded: false,
  subs: new Set(),
  notify(){ this.subs.forEach(fn=>fn([...this.list])); },
  sub(fn){ this.subs.add(fn); return ()=>this.subs.delete(fn); },
  load(rows){
    this.list = (rows||[]).map(a=>({
      ...a,
      wpm: a.wpm ?? 75,
      delay: a.delay ?? 'natural',
      style: a.style ?? 'human',
      tone: a.tone ?? 'Friendly',
      escalate: a.escalate ?? '3 failures',
      emoji: a.emoji ?? true,
      proactive: a.proactive ?? false,
      autoReply: a.autoReply ?? true,
      typingIndicator: a.typingIndicator ?? true,
      readDelayMin: a.readDelayMin ?? 2,
      readDelayMax: a.readDelayMax ?? 9,
      msgGapMin: a.msgGapMin ?? 1,
      msgGapMax: a.msgGapMax ?? 4,
      // Channel-scope toggles. Defaults match a "DM-only, mention-required for
      // groups" stance — the safest behaviour for a freshly added agent.
      replyPrivate:         a.replyPrivate         ?? true,
      replyGroups:          a.replyGroups          ?? false,
      replyChannels:        a.replyChannels        ?? false,
      replyOnlyIfMentioned: a.replyOnlyIfMentioned ?? true,
      // ── Realism tuning ──
      // settleMs:    quiet window after the LAST inbound before we trust the
      //              user has finished their burst (and we let the LLM run).
      //              Lower = snappier; higher = safer for chatty users.
      // presenceSim: master switch for the away/offline simulator. When off,
      //              the bot behaves as always-online (legacy behaviour).
      // awayAfterMs / offlineAfterMs: idleness thresholds (ms). Read by
      //              PRESENCE_SIMULATOR._windows().
      // readReceipts: when true, the bot fires a "mark as read" on the
      //              platform AFTER the simulated read-delay (matching when
      //              a real person would have noticed). When false (the
      //              default for most platforms where bots can't be "seen"
      //              anyway), nothing is sent. Telegram User API only.
      settleMs:        a.settleMs        ?? 1800,
      presenceSim:     a.presenceSim     ?? true,
      awayAfterMs:     a.awayAfterMs     ?? 4 * 60 * 1000,
      offlineAfterMs:  a.offlineAfterMs  ?? 18 * 60 * 1000,
      readReceipts:    a.readReceipts    ?? false,
      // ── Realism: silence + spam throttle ──
      // silenceMode:     when true, the agent honours the LLM's
      //                  thinking.should_reply=false decision and stays quiet
      //                  on filler messages (👍, "ok", "thanks"...).
      //                  When false, the agent always sends a reply.
      // spamThrottle:    when true, the agent honours the LLM's
      //                  thinking.spam_signal=true decision and puts the
      //                  conversation on a temporary cooldown that escalates
      //                  with repeated spam (cooldown doubles each time, capped
      //                  at ~30 minutes; reset by any non-spam inbound).
      // spamCooldownSec: base cooldown in seconds for the FIRST spam hit.
      silenceMode:      a.silenceMode      ?? true,
      spamThrottle:     a.spamThrottle     ?? true,
      spamCooldownSec:  a.spamCooldownSec  ?? 60,
      // ── Realism v2 ──
      // schedule:        reply hours — one or more day/time blocks (see SCHEDULE_GATE).
      //                  Disabled by default so existing agents keep replying
      //                  24/7. When enabled, the engine consults SCHEDULE_GATE
      //                  at the very top of _runOne and chooses pause / queue /
      //                  offline based on the schedule's mode field.
      // hesitationPct:   % chance per long reply that the typing indicator
      //                  stutters mid-compose (typing → pause → typing). 0
      //                  disables the feature entirely.
      // selfCorrectPct:  % chance after each text chunk that a short
      //                  correction follow-up ("*the", "actually scratch
      //                  that") gets sent as its own message. Pairs with
      //                  typoRate but doesn't strictly require it.
      // typoRate:        per-word % chance of a typo injection on prose
      //                  chunks. Capped at 2 typos per message regardless
      //                  of slider. Disabled on style='pro'/'expert'.
      // lowercaseDrift:  drop leading capital + trailing period on short
      //                  single-sentence prose chunks. Off for 'pro'/'expert'.
      // repetitionGuard: per-conversation rolling fingerprint check against
      //                  recently-sent openers / shapes. Triggers ONE LLM
      //                  regenerate hint on a match. Defaults ON because
      //                  it's a pure-defensive guard with no false-positives
      //                  that hurt the conversation.
      // repetitionWindow: how many recent replies to compare against.
      // waitForUserTyping: if the user starts typing while we have a draft
      //                  pending, hold the send and consider regenerating
      //                  with the new context once they finish. Defaults ON.
      // Always normalised to the v2 multi-block shape here, so every
      // reader (editor, engine, ghost) sees `windows` even for agents
      // saved by the old single-window editor.
      schedule: SCHEDULE_GATE.normalize(a.schedule),
      hesitationPct:     a.hesitationPct     ?? 0,
      selfCorrectPct:    a.selfCorrectPct    ?? 0,
      typoRate:          a.typoRate          ?? 0,
      lowercaseDrift:    a.lowercaseDrift    ?? false,
      repetitionGuard:   a.repetitionGuard   ?? true,
      repetitionWindow:  a.repetitionWindow  ?? 6,
      waitForUserTyping: a.waitForUserTyping ?? true,
      // Per-agent kill switch for AI-driven license issuance. Defaults
      // OFF so the AI never mints licenses unless the operator opts in.
      // Even when ON, the server still requires a confirmed transaction
      // to back every issuance — this flag just controls whether the
      // capability is exposed in the system prompt at all.
      allowAiLicenses:  a.allowAiLicenses   ?? a.allow_ai_licenses ?? false,
      // Separate permission for changing the price of, or cancelling, an
      // unpaid invoice (split out of allowAiLicenses).
      allowAiInvoices:  a.allowAiInvoices   ?? a.allow_ai_invoices ?? false,
      // Paid renewals of an existing license (same serial, new term). ON
      // unless the operator switched it off — missing means on.
      allowAiRenewals:  (() => {
        const v = a.allowAiRenewals ?? a.allow_ai_renewals;
        return !(v === false || v === 0 || v === '0');
      })(),
      // ── DEFERRED ACTIONS ──────────────────────────────────────
      // allowScheduling         agent may run ghost verbs on a timer
      // allowCustomerScheduling customers may book a callback on their
      //                         OWN conversation. Strict subset of the
      //                         above — meaningless without it, so the
      //                         editor and the server both force it off
      //                         when the parent is off.
      // The cust* caps are per-customer and re-clamped server-side;
      // these values are a UI convenience, never a trust boundary.
      allowScheduling:         a.allowScheduling         ?? a.allow_scheduling          ?? false,
      allowCustomerScheduling: (a.allowCustomerScheduling ?? a.allow_customer_scheduling ?? false)
                                 && (a.allowScheduling ?? a.allow_scheduling ?? false),
      custSchedMaxPending:     a.custSchedMaxPending     ?? a.cust_sched_max_pending     ?? 3,
      custSchedMaxPerDay:      a.custSchedMaxPerDay      ?? a.cust_sched_max_per_day     ?? 5,
      custSchedMaxDays:        a.custSchedMaxDays        ?? a.cust_sched_max_days        ?? 60,
      custSchedQuietHours:     a.custSchedQuietHours     ?? a.cust_sched_quiet_hours     ?? true,
    }));
    this.loaded = true;
    this.notify();
    // Drain anything waiting on us — used by MSGS_STORE.onIncoming when
    // an inbound landed before agents finished loading.
    if (this._waiters && this._waiters.length) {
      const w = this._waiters; this._waiters = [];
      w.forEach(fn=>{ try { fn(); } catch(e){ console.error('[agents waiter]', e); } });
    }
  },
  // Run `fn` as soon as agents have loaded. If already loaded, runs immediately.
  onceLoaded(fn){
    if (this.loaded) { fn(); return; }
    if (!this._waiters) this._waiters = [];
    this._waiters.push(fn);
  },
  upsert(agent){
    const i = this.list.findIndex(a=>a.id===agent.id);
    if (i>=0) this.list[i] = {...this.list[i], ...agent};
    else this.list = [...this.list, agent];
    this.notify();
  },
  remove(id){ this.list = this.list.filter(a=>a.id!==id); this.notify(); },
  byId(id){ return this.list.find(a=>a.id===id); },
  defaultActive(){ return this.list.find(a=>a.active) || this.list[0] || null; },
};
const useAgents = ()=>{
  const [a,setA] = React.useState([...AGENTS_STORE.list]);
  React.useEffect(()=>AGENTS_STORE.sub(setA),[]);
  return a;
};

// ── AI DRAFT STORE ────────────────────────────────────────────
// Holds the pending LLM reply for each conversation between the moment
// the LLM responds and the moment we actually send. While a draft is
// pending the user can:
//   • see the live "Replying" indicator + countdown
//   • click the draft to PAUSE the auto-send timer
//   • edit the text in place
//   • hit Send to fire it now, or Discard to cancel
// When the timer naturally expires (or Send is clicked) the engine
// sends via .NET and clears the slot.
// ── PER-CHAT MANUAL INPUT DRAFTS ────────────────────────────────────
// Stores the operator's in-progress typed text per conversation so
// switching chats never spills text from one composer into another.
// Lives outside React so it survives unmount/remount of InPageChat.
const INPUT_DRAFTS = {
  map: new Map(),                       // convId -> string
  get(convId) { return this.map.get(convId) || ''; },
  set(convId, text) {
    if (text) this.map.set(convId, text);
    else this.map.delete(convId);
  },
  // clear(convId) drops one entry; clear() with no arg wipes the lot
  // (used by AUTH_STORE.logout so the next operator never inherits the
  // previous one's typed-but-unsent text).
  clear(convId) {
    if (convId === undefined || convId === null) this.map.clear();
    else this.map.delete(convId);
  },
};

// ── PLATFORM MESSAGE-LENGTH LIMITS ──────────────────────────────────
// Hard caps imposed by each chat platform's send API. Enforced at the
// composer (cannot type or paste past the cap) to mirror what the user
// sees in the official client and prevent send failures downstream.
//   • Telegram: 4096 chars/text message (sendMessage API).
//   • Discord:  2000 chars/message for non-Nitro accounts (we use the
//               conservative cap so messages always go through).
const PLATFORM_LIMITS = {
  telegram: 4096,
  discord:  2000,
};
const limitFor = (p) => PLATFORM_LIMITS[p] || 4096;

const DRAFT_STORE = {
  drafts: new Map(),    // convId -> { text, sendAt, paused, pausedAtRemaining, agent, provider, resolve, cancelled }
  subs: new Set(),
  notify(convId) { this.subs.forEach(fn => fn(convId)); },
  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },

  // Engine creates a draft, awaits the returned promise; the promise resolves
  // with { send, text } when the user fires it or the timer expires, OR
  // { send:false } if it was discarded.
  // Optional opts.chunkIndex/chunkTotal/upcoming let the engine open a draft
  // for ONE chunk of a multi-message reply — the UI surfaces the position
  // (e.g. "2/3") and the upcoming chunks as a faint preview so the operator
  // can see what's queued behind the current bubble.
  // ONE DRAFT AT A TIME PER CHAT, IN ORDER. A second open() for a chat
  // that already has a draft on screen (the payment pipeline's delivery
  // message while the agent's own reply is counting down, or the other way
  // round) used to REPLACE the first one in the map without resolving it —
  // whoever was awaiting the first draft then waited forever. It now queues
  // behind it and opens, with its own full countdown, when that one is sent
  // or discarded.
  _waiting: new Map(),     // convId -> [{ start, abandon }]
  open(convId, opts) {
    return new Promise(resolve => {
      const start = () => this._openNow(convId, opts, resolve);
      if (this.drafts.has(convId)) {
        const q = this._waiting.get(convId) || [];
        q.push({ start, abandon: () => { try { resolve({ send: false, text: opts.text, attachments: opts.attachments || [], superseded: true, abandoned: true }); } catch (_) {} } });
        this._waiting.set(convId, q);
        return;
      }
      start();
    });
  },
  _startNext(convId) {
    const q = this._waiting.get(convId);
    if (!q || !q.length) return;
    const next = q.shift();
    if (!q.length) this._waiting.delete(convId);
    setTimeout(() => {
      if (this.drafts.has(convId)) { const q2 = this._waiting.get(convId) || []; q2.unshift(next); this._waiting.set(convId, q2); return; }
      next.start();
    }, 0);
  },
  // Logout: nothing queued may open afterwards.
  abandonQueued() {
    this._waiting.forEach(q => q.forEach(w => w.abandon()));
    this._waiting.clear();
  },

  // Review a message the SYSTEM is about to send (payment confirmation,
  // after-payment delivery, keys, manual-setup follow-up…) in the same
  // composer, with the same countdown, as the agent's own replies. The
  // countdown is the typing time, exactly like an agent chunk.
  //   → { send:true, text }           timer ran out / operator hit Send
  //   → { send:true, text, superseded } the customer wrote meanwhile: it
  //                                    still goes (a payment message must
  //                                    not vanish because they typed "paid")
  //   → { send:false, discarded:true } the operator discarded it
  async review(convId, text, opts = {}) {
    let r;
    try {
      r = await this.open(convId, {
        text, attachments: [], delayMs: Math.max(800, opts.delayMs || 2500),
        agent: opts.agent || 'System', provider: '', chunkIndex: 0, chunkTotal: 1, upcoming: [],
      });
    } catch (_) { return { send: true, text }; }
    if (r && r.abandoned) return { send: false, discarded: true, abandoned: true };   // signed out
    if (r && r.send) return { send: true, text: String(r.text || '').trim() };
    if (r && r.superseded) return { send: true, text: String((r.text || text) || '').trim(), superseded: true };
    return { send: false, discarded: true };
  },

  _openNow(convId, opts, resolve) {
    {
      const d = {
        text: opts.text,
        attachments: opts.attachments || [],
        sendAt: Date.now() + opts.delayMs,
        delayMs: opts.delayMs,
        paused: false,
        pausedAtRemaining: 0,
        agent: opts.agent,
        provider: opts.provider,
        // Multi-chunk metadata. chunkIndex is 0-based; chunkTotal is 1 for
        // single-message replies. `upcoming` is the array of chunk strings
        // that will follow this one — purely for preview, never edited.
        chunkIndex: opts.chunkIndex || 0,
        chunkTotal: opts.chunkTotal || 1,
        upcoming:   Array.isArray(opts.upcoming) ? opts.upcoming : [],
        resolve,
        cancelled: false,
      };
      this.drafts.set(convId, d);
      this.notify(convId);
      // Fire the auto-send timer.
      this._scheduleTimer(convId);
    }
  },

  _scheduleTimer(convId) {
    const d = this.drafts.get(convId);
    if (!d || d.paused || d.cancelled) return;
    const ms = Math.max(0, d.sendAt - Date.now());
    if (d._timeout) clearTimeout(d._timeout);
    d._timeout = setTimeout(() => {
      const cur = this.drafts.get(convId);
      if (!cur || cur.cancelled || cur.paused) return;
      // Timer expired naturally → fire send.
      this._finalize(convId, true);
    }, ms);
  },

  // Update the draft text mid-flight (user edits while paused).
  setText(convId, text) {
    const d = this.drafts.get(convId);
    if (!d) return;
    d.text = text;
    this.notify(convId);
  },

  // User clicked the draft → pause auto-send so they can edit / approve.
  //
  // BUGFIX (stuck-pending-draft): we now also start a "max pause" watchdog.
  // If the operator pauses a draft and walks away (or gets distracted), the
  // engine's _runOne is awaiting this draft's promise — without the
  // watchdog, the AI reply queue for this conversation stalls indefinitely
  // and no further AI replies fire. After MAX_PAUSE_MS we auto-discard so
  // the engine can unblock and the next inbound (which is almost certainly
  // already there if the operator forgot the draft) gets a fresh reply.
  pause(convId) {
    const d = this.drafts.get(convId);
    if (!d || d.paused) return;
    d.paused = true;
    d.pausedAtRemaining = Math.max(0, d.sendAt - Date.now());
    if (d._timeout) { clearTimeout(d._timeout); d._timeout = null; }
    // 5 minute hard cap — long enough for a real operator edit, short
    // enough that a forgotten draft doesn't permanently break the
    // conversation.
    const MAX_PAUSE_MS = 5 * 60 * 1000;
    if (d._pauseWatchdog) clearTimeout(d._pauseWatchdog);
    d._pauseWatchdog = setTimeout(() => {
      const cur = this.drafts.get(convId);
      if (!cur || cur.cancelled || !cur.paused) return;
      console.warn('[draft] max-pause watchdog fired — discarding stale paused draft', { convId });
      // Mark as superseded so the engine re-runs against latest context
      // when the next inbound arrives, instead of silently dropping.
      cur.superseded = true;
      this._finalize(convId, false);
    }, MAX_PAUSE_MS);
    this.notify(convId);
  },

  // Resume a previously-paused draft (rare; usually the user just hits Send).
  resume(convId) {
    const d = this.drafts.get(convId);
    if (!d || !d.paused) return;
    d.paused = false;
    if (d._pauseWatchdog) { clearTimeout(d._pauseWatchdog); d._pauseWatchdog = null; }
    d.sendAt = Date.now() + d.pausedAtRemaining;
    this._scheduleTimer(convId);
    this.notify(convId);
  },

  // User clicked Send manually — fire now with whatever text is currently in the draft.
  sendNow(convId) { this._finalize(convId, true); },

  // User clicked Discard — drop the draft, do not send.
  discard(convId) { this._finalize(convId, false); },

  // Realism: a new inbound landed while we were sitting on this draft. Mark
  // the draft as superseded so the engine knows to throw it away and re-run
  // the LLM with the up-to-date context.
  //
  // BUGFIX (stuck-pending-draft): previously we just set the flag and
  // returned. That works fine while the draft's auto-send timer is still
  // ticking — the timer fires, _finalize runs, the engine sees
  // result.superseded and re-enqueues. But if the OPERATOR has paused the
  // draft (clicked it to edit), the timer is cleared and there's nothing
  // left to ever resolve the engine's promise. The conversation sits
  // forever with a "pending message" that never unpauses. The customer
  // keeps typing, the engine is blocked awaiting a promise that will
  // never resolve, and AI_REPLY_QUEUE.queues[convId].running stays true,
  // so no new enqueues fire either.
  //
  // Fix: if the draft is paused when a new inbound supersedes it, force
  // the resolution so the engine unblocks and re-runs against the new
  // context. The operator's edit is discarded — they can re-edit the
  // fresh draft when it lands. Better than silently dropping replies.
  markSuperseded(convId) {
    const d = this.drafts.get(convId);
    if (!d || d.cancelled) return;
    d.superseded = true;
    if (d.paused) {
      // Force-finalize so the engine's awaited promise resolves and the
      // queue can drain. _finalize itself notifies subscribers.
      this._finalize(convId, false);
      return;
    }
    this.notify(convId);
  },

  // Engine-side: tear down a draft because we're going to re-run the LLM
  // with new context. Resolves the pending promise with send=false and
  // superseded=true so the caller can distinguish from a user discard.
  cancelForReconsider(convId) {
    const d = this.drafts.get(convId);
    if (!d || d.cancelled) return;
    d.superseded = true;
    this._finalize(convId, false);
  },

  // Internal: resolve the engine's pending promise and clean up.
  _finalize(convId, send) {
    const d = this.drafts.get(convId);
    if (!d || d.cancelled) return;
    d.cancelled = true;
    if (d._timeout) clearTimeout(d._timeout);
    if (d._pauseWatchdog) clearTimeout(d._pauseWatchdog);
    this.drafts.delete(convId);
    this.notify(convId);
    try { d.resolve({ send, text: d.text, attachments: d.attachments || [], superseded: !!d.superseded }); } catch(_) {}
    this._startNext(convId);
  },

  get(convId) { return this.drafts.get(convId) || null; },
};
// React hook — re-renders subscribers whose convId draft changed.
// Read straight from the store during render. The previous version held a
// copy in state, which (a) showed the previous conversation's draft on the
// first frame after a switch, and (b) never re-rendered on setText/pause
// because the draft object is mutated in place and setState bailed out on
// the identical reference — the UI only caught up on the next 250ms tick.
const useDraft = (convId) => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => DRAFT_STORE.sub(changed => {
    if (changed === convId) force();
  }), [convId]);
  return DRAFT_STORE.get(convId);
};
// Tick hook — forces a re-render every 250ms while a draft exists, so the
// countdown numbers update smoothly. Stays idle when no draft is open.
const useDraftTick = (convId) => {
  const [, setT] = React.useState(0);
  React.useEffect(() => {
    const d = DRAFT_STORE.get(convId);
    if (!d) return;
    const i = setInterval(() => setT(x => x + 1), 250);
    return () => clearInterval(i);
  // eslint-disable-next-line
  }, [convId, DRAFT_STORE.get(convId)?.cancelled, DRAFT_STORE.get(convId)?.paused]);
};

// ═══════════════════════════════════════════════════════════════════
// DIRECT MESSAGES — end-to-end encrypted, account to account
// ═══════════════════════════════════════════════════════════════════
// Lets two BotCommand accounts talk directly: no Telegram, no Discord,
// no .NET host. Everything goes through api.php, which only ever sees
// public keys and ciphertext.
//
// KEYS
//   Each account has an ECDH P-256 key pair made HERE, in the browser.
//   The private half lives in this device's IndexedDB (database bc_dm)
//   and is never sent anywhere. The server stores the public half.
//
// MESSAGES
//   Both sides derive the same AES-256-GCM key from ECDH(my private,
//   their public) through HKDF-SHA-256, bound to both account ids and
//   both key ids. Every message gets a fresh random 96-bit IV. The
//   ciphertext is also bound (as GCM additional data) to its thread, its
//   sender, its recipient, both key ids and its own id, so the server
//   can't move, re-address or replay it without decryption failing.
//   Plaintext is padded to 128-byte steps so length leaks less.
//
// OTHER BROWSERS
//   Nothing to save or type. The password is stretched in the browser
//   (DM_AUTH) into a login key — the only thing the server ever receives
//   at sign-in — and a separate message key that never leaves the browser.
//   The message key locks a copy of the private keys that the server
//   stores but can't open; signing in anywhere unlocks it automatically.
//   Security therefore rests on the password: the server could only try to
//   guess it offline, 600,000 PBKDF2 rounds per guess.
//
// KEY SWAPS
//   Each device remembers the first key it saw for a contact (pins,
//   localStorage). If the server later hands out a different one, the
//   chat says so; if you had verified the old safety number, sending is
//   held until you accept the new key.

const DM_B64 = {
  enc(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(str) {
    const s = atob(String(str || ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};
const DM_TE = new TextEncoder();
const DM_TD = new TextDecoder();
const DM_CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const DM_CRYPTO = {
  supported() {
    try { return !!(window.isSecureContext !== false && window.crypto && crypto.subtle && window.indexedDB); }
    catch (_) { return false; }
  },
  async genKeyPair() {
    return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  },
  async pubRawB64(pubKey) {
    return DM_B64.enc(await crypto.subtle.exportKey('raw', pubKey));
  },
  async importPub(b64) {
    return crypto.subtle.importKey('raw', DM_B64.dec(b64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  },
  async importPrivJwk(jwk) {
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  },
  async fingerprint(b64) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', DM_B64.dec(b64)));
    return Array.from(h, x => x.toString(16).padStart(2, '0')).join('');
  },
  // One AES key per (my key, their key) pair. Order-independent, so both
  // ends derive the identical key.
  async pairKey(myPriv, peerPub, me, peer) {
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPub }, myPriv, 256);
    const ikm = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const [lo, hi] = me.acc < peer.acc ? [me, peer] : [peer, me];
    const info = DM_TE.encode(`bc-dm-v1|pair|${lo.acc}:${lo.key}|${hi.acc}:${hi.key}`);
    const salt = await crypto.subtle.digest('SHA-256', DM_TE.encode('bc-dm-v1 salt'));
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikm,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  aad(m) {
    return DM_TE.encode(`bc-dm-v1|${m.thread_id}|${m.sender_id}:${m.sender_key}>${m.recipient_id}:${m.recipient_key}|${m.uid}`);
  },
  pad(bytes) {
    const n = Math.ceil((bytes.length + 1) / 128) * 128;
    const out = new Uint8Array(n);
    out.set(bytes); out[bytes.length] = 0x80;
    return out;
  },
  unpad(bytes) {
    let i = bytes.length - 1;
    while (i >= 0 && bytes[i] === 0) i--;
    if (i < 0 || bytes[i] !== 0x80) throw new Error('bad padding');
    return bytes.subarray(0, i);
  },
  async seal(aesKey, obj, aadBytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pt = this.pad(DM_TE.encode(JSON.stringify(obj)));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadBytes }, aesKey, pt);
    return { iv: DM_B64.enc(iv), ct: DM_B64.enc(ct) };
  },
  async open(aesKey, ivB64, ctB64, aadBytes) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: DM_B64.dec(ivB64), additionalData: aadBytes }, aesKey, DM_B64.dec(ctB64));
    return JSON.parse(DM_TD.decode(this.unpad(new Uint8Array(pt))));
  },
  uid() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, x => DM_CROCKFORD[x & 31]).join('') + Date.now().toString(36);
  },
// ── Vault: the account's private message keys, locked with the message
// key derived from the password (DM_AUTH). Stored on the server, which
// can't open it. Any browser the person signs in to unlocks it on its own.
  async sealVault(encKey, acc, keys, current) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = DM_TE.encode(JSON.stringify({ v: 2, acc, current, keys, at: Date.now() }));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: DM_TE.encode('bc-vault-v2|' + acc) }, encKey, body);
    return JSON.stringify({ v: 2, iv: DM_B64.enc(iv), ct: DM_B64.enc(ct) });
  },
  async openVault(encKey, acc, vaultStr) {
    const v = JSON.parse(vaultStr);
    if (!v || v.v !== 2) throw new Error('unreadable vault');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: DM_B64.dec(v.iv), additionalData: DM_TE.encode('bc-vault-v2|' + acc) }, encKey, DM_B64.dec(v.ct));
    return JSON.parse(DM_TD.decode(pt));
  },
};

// ── Tiny IndexedDB wrapper for CryptoKey objects (structured clone) ──
const DM_IDB = (() => {
  let ready = null;
  const open = () => ready || (ready = new Promise((resolve) => {
    try {
      const req = indexedDB.open('bc_dm', 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore('keyring'); } catch (_) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (_) { resolve(null); }
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    if (!db) { if (mode === 'readwrite') throw new Error('This browser can’t store keys (private window?)'); return null; }
    return new Promise((res, rej) => {
      try {
        const t = db.transaction('keyring', mode);
        const r = fn(t.objectStore('keyring'));
        t.oncomplete = () => res(r && 'result' in r ? (r.result || null) : true);
        t.onerror = () => (mode === 'readwrite' ? rej(t.error || new Error('Key storage failed')) : res(null));
      } catch (e) { mode === 'readwrite' ? rej(e) : res(null); }
    });
  };
  return {
    get: (k) => tx('readonly', s => s.get(k)),
    put: (k, v) => tx('readwrite', s => s.put(v, k)),
    del: (k) => tx('readwrite', s => s.delete(k)).catch(() => false),
  };
})();

// ── DM_AUTH — the password, stretched in the browser ───────────────
// PBKDF2-SHA-256 (600k rounds, per-account salt) turns the password into
// 32 bytes, which HKDF splits into:
//   login key   → sent to the server instead of the password;
//   message key → an AES key that never leaves this browser. It opens the
//                 vault, so signing in is all it takes to read messages.
// The message key is kept in this browser's IndexedDB as a
// non-extractable key, so a page reload doesn't ask for the password.
const DM_AUTH = {
  _mem: new Map(),
  _b64u(s) { return DM_B64.dec(String(s || '').replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s || '').length + 3) % 4)); },
  _newSalt() { return DM_B64.enc(crypto.getRandomValues(new Uint8Array(16))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  async derive(password, salt, it) {
    const base = await crypto.subtle.importKey('raw', DM_TE.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: this._b64u(salt), iterations: it || 600000 }, base, 256);
    const master = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey']);
    const z = new Uint8Array(32);
    const auth = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: z, info: DM_TE.encode('bc-login-v1') }, master, 256);
    const enc = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: z, info: DM_TE.encode('bc-messages-v1') }, master,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { auth: DM_B64.enc(auth), enc };
  },
  supported() { return DM_CRYPTO.supported(); },
  async remember(acc, enc) {
    if (!acc || !enc) return;
    this._mem.set(Number(acc), enc);
    try { await DM_IDB.put('enc:' + acc, enc); } catch (_) {}
  },
  async get(acc) {
    acc = Number(acc);
    if (this._mem.has(acc)) return this._mem.get(acc);
    const k = await DM_IDB.get('enc:' + acc);
    if (k) this._mem.set(acc, k);
    return k || null;
  },
  async forget(acc) { this._mem.delete(Number(acc)); await DM_IDB.del('enc:' + acc); },
  async _pre(login) {
    const r = await apiFetch('auth_prelogin', { login });
    if (!r || r.error || !r.salt) throw new Error((r && r.error) || 'Couldn’t reach the server. Check your connection.');
    return r;
  },
  // Sign in with a password. Returns the api response ({account} or {error}).
  async signIn(login, password) {
    if (!this.supported()) return apiFetch('auth_login', { login, password });   // no Web Crypto: plain sign-in
    const pre = await this._pre(login);
    const d = await this.derive(password, pre.salt, pre.it);
    const body = pre.v === 1 ? { login, password, new_auth: d.auth } : { login, auth: d.auth };
    const res = await apiFetch('auth_login', body);
    if (res && res.account) await this.remember(res.account.id, d.enc);
    return res;
  },
  // Sign-ups solve the same small puzzle as guest chats (see GUEST_POW).
  async _signupPow() {
    const ch = await apiFetch('auth_guest_challenge', { _: 1 });
    if (!ch || ch.error || !ch.c || !ch.s) return null;     // not offered: the server doesn't ask for one
    const issued = Date.now();
    const n = await GUEST_POW.solve(ch.s, Number(ch.bits) || 18);
    const wait = 1200 - (Date.now() - issued);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    return { c: ch.c, n };
  },
  async register(fields, password, attempt = 0) {
    const pow = await this._signupPow();
    if (!this.supported()) return apiFetch('auth_register', { ...fields, password, ...(pow ? { pow } : {}) });
    const salt = this._newSalt();
    const d = await this.derive(password, salt, 600000);
    const res = await apiFetch('auth_register', { ...fields, auth: d.auth, kdf_salt: salt, ...(pow ? { pow } : {}) });
    if (res && res.code === 'pow' && attempt < 1) return this.register(fields, password, attempt + 1);
    if (res && res.account) await this.remember(res.account.id, d.enc);
    return res;
  },
  // Already signed in, but this browser has no message key: confirm the
  // password once so it gets one.
  async confirm(password) {
    const a = AUTH_STORE.account;
    if (!a) throw new Error('You’re signed out');
    const pre = await this._pre(a.username || a.email);
    const d = await this.derive(password, pre.salt, pre.it);
    const r = await apiFetch('auth_check', pre.v === 1 ? { password, new_auth: d.auth } : { auth: d.auth });
    if (!r || r.error) throw new Error((r && r.error) || 'That password isn’t right.');
    await this.remember(a.id, d.enc);
  },
};

// ── DM_KEYS — this account's key state in this browser ──
//   state: 'off' | 'loading' | 'ready' | 'password' | 'unsupported' | 'error'
//     ready      keys usable. needsSync = the server copy is behind and
//                this browser doesn't have the message key to update it.
//     password   keys exist on the server; the password opens them here.
const DM_KEYS = {
  state: 'off', error: '', acc: 0, me: null, ring: null, server: null,
  needsSync: false, discoverable: true, shareUrl: '',
  // What the public profile link shows (see dm_contact_page in api.php).
  showSeen: true, showLinks: true,
  // Guests (people without an account): may they message you, and does
  // your agent answer them.
  allowGuests: true, guestAi: true,
  _pub: new Map(),        // key id → { acc, pub, fp, key: CryptoKey|null }
  _pair: new Map(),       // "mine|theirs" → AES key
  _epoch: 0,
  subs: new Set(),
  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  notify() { this.subs.forEach(fn => { try { fn(); } catch (e) { console.warn('[dm] sub', e); } }); },
  _set(p) { Object.assign(this, p); this.notify(); },
  reset() {
    this._epoch++;
    Object.assign(this, { state: 'off', error: '', acc: 0, me: null, ring: null, server: null, needsSync: false, shareUrl: '' });
    this._pub.clear(); this._pair.clear();
    this.notify();
  },
  // Signing out of a browser removes its copy of the keys once the server
  // copy is up to date — the next sign-in restores them from the password.
  async wipeLocal() {
    const acc = this.acc;
    if (!acc) return;
    const synced = this.state === 'ready' && !this.needsSync;
    try { await DM_AUTH.forget(acc); } catch (_) {}
    if (synced) { try { await DM_IDB.del('acc:' + acc); } catch (_) {} }
  },
  async _saveRing() { await DM_IDB.put('acc:' + this.acc, this.ring); },
  _ingestServer(st) {
    this.server = { key: st.key || null, vaultKeyId: st.vault_key_id || null };
    this.me = st.me || this.me;
    this.discoverable = st.discoverable !== false;
    this.showSeen = st.show_seen !== false;
    this.showLinks = st.show_links !== false;
    this.allowGuests = st.allow_guests !== false;
    this.guestAi = st.guest_ai !== false;
    // Guest pacing (see GUEST ABUSE LIMITS in api.php), so the composer
    // holds before the server has to refuse anything.
    this.guestLimits = st.guest_limits || null;
    this.shareUrl = st.share_url || this.shareUrl;
    if (st.key) this._pub.set(st.key.id, { acc: st.key.account_id, pub: st.key.pub, fp: st.key.fp, key: null });
  },
  async init(account) {
    const acc = Number(account && account.id) || 0;
    if (!acc) { this.reset(); return; }
    if (!DM_CRYPTO.supported()) { this._set({ state: 'unsupported', acc }); return; }
    const epoch = ++this._epoch;
    this._set({ state: 'loading', acc, error: '' });
    try {
      const ring = (await DM_IDB.get('acc:' + acc)) || { acc, current: 0, keys: {} };
      const enc = await DM_AUTH.get(acc);
      const st = await apiFetch('dm_status', { _: 1 });
      if (epoch !== this._epoch) return;
      if (!st || st.error) throw new Error((st && st.error) || 'Couldn’t reach the server');
      this.ring = ring;
      this._ingestServer(st);
      const sk = st.key;
      if (!sk) {
        // First time anywhere: make the keys and store the locked copy.
        await this._createAndPublish(false);
        if (epoch !== this._epoch) return;
        const synced = enc ? await this._sync(enc) : false;
        this._set({ state: 'ready', needsSync: !synced });
        return;
      }
      const local = ring.keys[sk.id];
      if (local) {
        if (local.pub !== sk.pub) throw new Error('For your safety, messages are paused: the server sent a key that doesn’t match this browser. Reload, and contact support if it keeps happening.');
        ring.current = sk.id;
        await this._saveRing();
        const synced = st.vault_key_id === sk.id || (enc ? await this._sync(enc) : false);
        this._set({ state: 'ready', needsSync: !synced });
        return;
      }
      if (st.vault_key_id === sk.id) {
        if (enc && await this._restore(enc)) { this._set({ state: 'ready', needsSync: false }); return; }
        this._set({ state: 'password' });
        return;
      }
      // A key with no copy any browser can open: the account's messages
      // were set up by a system that no longer exists. Move on to a new
      // key — contacts see a one-line "keys changed" notice, and older
      // messages locked to the lost key show as unavailable.
      await this._createAndPublish(true);
      if (epoch !== this._epoch) return;
      const synced = enc ? await this._sync(enc) : false;
      this._pair.clear();
      this._set({ state: 'ready', needsSync: !synced });
    } catch (e) {
      if (epoch !== this._epoch) return;
      console.warn('[dm] init', e);
      this._set({ state: 'error', error: String(e && e.message || e) });
    }
  },
  async _createAndPublish(rotate) {
    const kp = await DM_CRYPTO.genKeyPair();
    const pub = await DM_CRYPTO.pubRawB64(kp.publicKey);
    const r = await apiFetch('dm_publish_key', { pub, rotate: rotate ? 1 : 0 });
    if (!r || r.error) {
      if (r && r.error === 'key_exists') throw new Error('Your account was being set up in another browser at the same moment. Reload the page to continue.');
      throw new Error((r && r.error) || 'Couldn’t finish setting up messages');
    }
    const id = r.key.id;
    this.ring.keys[id] = { priv: kp.privateKey, pub, fp: r.key.fp, at: Date.now() };
    this.ring.current = id;
    await this._saveRing();
    this.server = { key: r.key, vaultKeyId: null };
    this._pub.set(id, { acc: this.acc, pub, fp: r.key.fp, key: kp.publicKey });
    return id;
  },
  // Upload a fresh locked copy of every key this browser holds.
  async _sync(enc) {
    try {
      const keys = [];
      for (const [id, k] of Object.entries(this.ring.keys)) {
        try { keys.push({ id: Number(id), pub: k.pub, fp: k.fp, jwk: await crypto.subtle.exportKey('jwk', k.priv) }); } catch (_) {}
      }
      const vault = await DM_CRYPTO.sealVault(enc, this.acc, keys, this.ring.current);
      const r = await apiFetch('dm_save_vault', { key_id: this.ring.current, vault });
      if (!r || r.error) return false;
      this.server = { ...(this.server || {}), vaultKeyId: this.ring.current };
      return true;
    } catch (e) { console.warn('[dm] sync', e); return false; }
  },
  async _restore(enc) {
    const v = await apiFetch('dm_get_vault', { _: 1 });
    if (!v || v.error || !v.vault) return false;
    let data;
    try { data = await DM_CRYPTO.openVault(enc, this.acc, v.vault); } catch (_) { return false; }
    for (const k of (data.keys || [])) {
      if (this.ring.keys[k.id]) continue;
      this.ring.keys[k.id] = { priv: await DM_CRYPTO.importPrivJwk(k.jwk), pub: k.pub, fp: k.fp, at: Date.now() };
    }
    const sk = this.server && this.server.key;
    if (!sk || !this.ring.keys[sk.id] || this.ring.keys[sk.id].pub !== sk.pub) return false;
    this.ring.current = sk.id;
    await this._saveRing();
    this._pair.clear();
    try { DM_STORE.redecryptAll(); } catch (_) {}
    return true;
  },
  // Password entered in the app: this browser doesn't hold the message key
  // (storage was cleared, or the keys were locked by a password it hasn't
  // seen).
  async unlockWithPassword(password) {
    await DM_AUTH.confirm(password);
    await this.init(AUTH_STORE.account);
    if (this.state === 'password') throw new Error('That password didn’t open your messages. If you changed it recently, use the password you had before.');
    try { DM_STORE.redecryptAll(); DM_STORE.refreshThreads(); } catch (_) {}
  },
  current() {
    if (this.state !== 'ready' || !this.ring) return null;
    const id = this.ring.current;
    const k = this.ring.keys[id];
    return k ? { id, ...k } : null;
  },
  async setDiscoverable(on) {
    const r = await apiFetch('dm_set_public', { on: on ? 1 : 0 });
    if (!r || r.error) throw new Error((r && r.error) || 'Could not update');
    this._ingestPublic(r);
  },
  // Profile link: show the rough last-active time / the connected
  // Telegram and Discord accounts. key is 'show_seen' or 'show_links'.
  async setPublicShow(key, on) {
    if (!['show_seen', 'show_links', 'allow_guests', 'guest_ai'].includes(key)) return;
    const r = await apiFetch('dm_set_public', { [key]: on ? 1 : 0 });
    if (!r || r.error) throw new Error((r && r.error) || 'Could not update');
    this._ingestPublic(r);
  },
  _ingestPublic(r) {
    this._set({
      discoverable: !!r.discoverable,
      showSeen: r.show_seen === undefined ? this.showSeen : !!r.show_seen,
      showLinks: r.show_links === undefined ? this.showLinks : !!r.show_links,
      allowGuests: r.allow_guests === undefined ? this.allowGuests : !!r.allow_guests,
      guestAi: r.guest_ai === undefined ? this.guestAi : !!r.guest_ai,
    });
  },
  // Offline replies: the account's agent key is kept in this browser's
  // ring too — and so in the password vault — so the replies it sent while
  // you were away open here, even after the server deletes its copy.
  async addAgentKeys(list) {
    if (this.state !== 'ready' || !this.ring || !Array.isArray(list)) return false;
    let added = false;
    for (const k of list) {
      if (!k || !k.id || !k.jwk || this.ring.keys[k.id]) continue;
      try {
        if (await DM_CRYPTO.fingerprint(k.pub) !== k.fp) continue;
        this.ring.keys[k.id] = { priv: await DM_CRYPTO.importPrivJwk(k.jwk), pub: k.pub, fp: k.fp, at: Date.now(), agent: true };
        added = true;
      } catch (e) { console.warn('[dm] agent key', e); }
    }
    if (!added) return false;
    await this._saveRing();
    const enc = await DM_AUTH.get(this.acc);
    if (enc && !(await this._sync(enc))) this._set({ needsSync: true });
    this._pair.clear();
    try { DM_STORE.redecryptAll(); } catch (_) {}
    return true;
  },
  async loadAgentKeys() {
    if (this.state !== 'ready') return false;
    const r = await apiFetch('dm_ai_agent_keys', { _: 1 });
    return (r && !r.error) ? this.addAgentKeys(r.keys || []) : false;
  },
  rememberPub(k) {
    if (k && k.id && !this._pub.has(k.id)) this._pub.set(k.id, { acc: k.account_id, pub: k.pub, fp: k.fp, key: null });
  },
  async ensurePubs(ids) {
    const need = [...new Set(ids.filter(id => id && !this._pub.has(id)))];
    if (!need.length) return;
    const r = await apiFetch('dm_pubkeys', { ids: need });
    (r && r.keys || []).forEach(k => this.rememberPub(k));
  },
  // The AES key for one message, from whichever of my keys it used.
  async keyFor(myKeyId, peerKeyId, peerAcc) {
    const cacheKey = myKeyId + '|' + peerKeyId;
    if (this._pair.has(cacheKey)) return this._pair.get(cacheKey);
    const mine = this.ring && this.ring.keys[myKeyId];
    if (!mine) return null;
    const p = this._pub.get(peerKeyId);
    if (!p) return null;
    if (!p.key) {
      // Never trust a label: the fingerprint must match the bytes.
      if (await DM_CRYPTO.fingerprint(p.pub) !== p.fp) throw new Error('Key fingerprint mismatch');
      p.key = await DM_CRYPTO.importPub(p.pub);
    }
    const k = await DM_CRYPTO.pairKey(mine.priv, p.key, { acc: this.acc, key: myKeyId }, { acc: peerAcc, key: peerKeyId });
    this._pair.set(cacheKey, k);
    return k;
  },
};

// ── Contact key pins (trust on first use) ──
const DM_PINS = {
  _k() { return 'bc.dm.pins.' + (DM_KEYS.acc || 0); },
  all() { try { return JSON.parse(localStorage.getItem(this._k()) || '{}') || {}; } catch (_) { return {}; } },
  get(peerId) { return this.all()[peerId] || null; },
  set(peerId, v) { const a = this.all(); a[peerId] = v; try { localStorage.setItem(this._k(), JSON.stringify(a)); } catch (_) {} },
};

// ── DM_STORE — threads, messages, polling ──
const DM_COLORS = ['#7c6ef5','#5ba3e8','#43c98a','#e8a844','#e87070','#9b7ff0','#3ec9d6','#e060c0','#8dc94a','#e8883a'];
const dmColFor = (name) => {
  let h = 0; const s = String(name || '').toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DM_COLORS[h % DM_COLORS.length];
};
const DM_LOCKED_TEXT = '🔒 Message unavailable in this browser';
// ── FILES IN DIRECT CHATS ────────────────────────────────────────────
// A file or picture an agent sends in a direct chat (a product image, the
// files after a payment) travels as a private, signed download link
// (api.php?action=dm_file&k=…). The link carries what the file is — name,
// type, kind — so it's drawn like every other chat's attachment: the
// picture itself, or a file card, with any caption as the text. Links from
// before that metadata existed still become a file card.
// Returns { c, mt, mu, mn } or null when the text has no such link.
const DM_FILE_LINK_RE = /(?:https?:\/\/[^\s<>"']*?)?api\.php\?action=dm_file&k=([A-Za-z0-9_\-]+)\.([A-Za-z0-9_\-]+)/;
function dmFileFromText(text) {
  const src = String(text || '');
  const m = src.match(DM_FILE_LINK_RE);
  if (!m) return null;
  let url = m[0];
  if (!/^https?:\/\//i.test(url)) {
    try { url = new URL(url, typeof API === 'string' ? new URL(API, location.href).href : location.href).href; } catch (_) {}
  }
  let meta = {};
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    meta = JSON.parse(decodeURIComponent(Array.from(bin, ch => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0')).join(''))) || {};
  } catch (_) { meta = {}; }
  const kind = ['image', 'video', 'audio', 'document'].includes(meta.k) ? meta.k
    : /^image\//i.test(meta.m || '') ? 'image' : /^video\//i.test(meta.m || '') ? 'video' : /^audio\//i.test(meta.m || '') ? 'audio' : 'document';
  let name = String(meta.n || '').trim();
  if (!name) name = kind === 'image' ? 'image' : 'file';
  // What's left once the link is out is the caption (the file name alone
  // is not repeated as a caption under its own card).
  let c = (src.slice(0, m.index) + src.slice(m.index + m[0].length)).replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  if (c && kind !== 'image' && c === name) c = '';
  return { c, mt: kind, mu: url, mn: name };
}
// ── FILES YOU SEND IN A DIRECT CHAT ──────────────────────────────────
// Sealed like the messages: each file is encrypted here with its own random
// key and uploaded in parts (api.php dm_file_put), so the server only ever
// holds ciphertext. The key, name and type travel inside the message body
// ({ k:'file', f:{…} }), so only the two people in the chat can open it.
// Opening one downloads the ciphertext (dm_file_get), decrypts it and hands
// the bubble a data: URL — the same kind of URL every other chat's
// attachments use, so pictures, video, audio and file cards (open / save in
// the desktop app included) all work unchanged.
const DM_FILE_PART = 786432;             // bytes per upload part — must match api.php
const DM_FILE_AAD  = 'bc-dm-file-v1';
const DM_FILES = {
  urls: new Map(),      // file id → data: URL, once opened (or sent from this browser)
  failed: new Map(),    // file id → why it couldn't be opened
  _busy: new Set(),     // file ids being fetched
  kindOf(f) {
    const k = f && f.k;
    return ['image', 'video', 'audio', 'document'].includes(k) ? k : 'document';
  },
  // The text standing in for a file wherever only text will do: the agent's
  // history, the server's away replies, and an app too old to draw it.
  label(f, caption) {
    const k = this.kindOf(f);
    const what = k === 'image' ? 'Photo' : k === 'video' ? 'Video' : k === 'audio' ? 'Audio' : 'File';
    return (caption ? caption + '\n' : '') + `[${what}: ${String((f && f.n) || 'file')}]`;
  },
  // What a row carrying this file shows right now.
  fields(f) {
    const id = Number(f && f.id) || 0;
    const url = this.urls.get(id);
    if (url) return { mu: url, mp: false, me: '' };
    const why = this.failed.get(id);
    return why ? { mu: '', mp: false, me: why } : { mu: '', mp: true, me: '' };
  },
  // Encrypt and upload one queued attachment ({ file, name, mime, size, kind }).
  // Resolves the file's description for the message body.
  async upload(tid, att) {
    const src = att.file || await (await fetch(att.url)).blob();
    const bytes = new Uint8Array(await src.arrayBuffer());
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: DM_TE.encode(DM_FILE_AAD) }, key, bytes));
    let id = 0;
    for (let seq = 0, off = 0; off < ct.length; seq++, off += DM_FILE_PART) {
      const r = await apiFetch('dm_file_put', { thread_id: tid, file_id: id, seq, size: ct.length,
        data: DM_B64.enc(ct.subarray(off, off + DM_FILE_PART)) });
      if (!r || r.error || !r.file_id) throw new Error((r && r.error) || 'Upload failed');
      id = Number(r.file_id);
    }
    return { id, key: DM_B64.enc(await crypto.subtle.exportKey('raw', key)), iv: DM_B64.enc(iv),
      n: String(att.name || 'file').slice(0, 200), m: String(att.mime || '').slice(0, 100),
      s: Number(att.size) || bytes.length, k: this.kindOf({ k: att.kind }) };
  },
  // Fetch and open a file the first time a chat shows it. Every row carrying
  // it (the open chat and the contact list's preview) then takes the result.
  load(f) {
    const id = Number(f && f.id) || 0;
    if (!id || !f.key || !f.iv || this.urls.has(id) || this.failed.has(id) || this._busy.has(id)) return;
    this._busy.add(id);
    (async () => {
      const res = await fetch(`${API}?action=dm_file_get&id=${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 404 ? 'No longer available' : 'Couldn’t download');
      const key = await crypto.subtle.importKey('raw', DM_B64.dec(f.key), 'AES-GCM', false, ['decrypt']);
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: DM_B64.dec(f.iv), additionalData: DM_TE.encode(DM_FILE_AAD) }, key, await res.arrayBuffer());
      const url = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => reject(fr.error || new Error('read failed'));
        fr.readAsDataURL(new Blob([pt], { type: String(f.m || 'application/octet-stream') }));
      });
      this.urls.set(id, typeof tagDataUrlName === 'function' ? tagDataUrlName(url, String(f.n || '')) : url);
    })().catch(e => {
      this.failed.set(id, String((e && e.name === 'OperationError') ? 'Couldn’t open this file' : (e && e.message) || 'Couldn’t open this file'));
    }).finally(() => {
      this._busy.delete(id);
      this._patch(id);
    });
  },
  _patch(id) {
    const fix = (row) => { if (row && row.dmf && Number(row.dmf.id) === id) Object.assign(row, this.fields(row.dmf)); };
    DM_STORE.threads.forEach(th => { th.msgs.forEach(fix); fix(th._lastRow); });
    DM_STORE.notify();
  },
  reset() { this.urls.clear(); this.failed.clear(); this._busy.clear(); },
};

// Contact-list preview for a row: its text, or what it carries.
function dmPreviewOf(row) {
  if (!row) return '';
  if (row.locked) return '🔒 Encrypted message';
  if (row.del) return 'Message deleted';
  if ((row.mu || row.dmf) && !row.c) return row.mt === 'image' ? '📷 Photo' : row.mt === 'video' ? '🎬 Video' : row.mt === 'audio' ? '🎵 Audio' : '📎 ' + (row.mn || 'File');
  return row.c || '';
}

// Pick up ?chat=<username> from a contact link before anything rewrites
// the URL, and keep it until the person is signed in.
const DM_PENDING = (() => {
  try {
    const u = new URL(window.location.href);
    const c = u.searchParams.get('chat');
    if (c && /^@?[A-Za-z0-9_.\-]{1,60}$/.test(c)) {
      sessionStorage.setItem('bc.dm.pending', c.replace(/^@/, ''));
      // The contact page's buttons open the sign-in screen on the matching
      // tab: "Continue as guest" → Guest, "Create account" → Register.
      if (u.searchParams.get('guest') === '1') sessionStorage.setItem('bc.dm.guest', '1');
      else if (u.searchParams.get('signup') === '1') sessionStorage.setItem('bc.dm.guest', 'register');
      else sessionStorage.removeItem('bc.dm.guest');
      u.searchParams.delete('chat');
      u.searchParams.delete('guest');
      u.searchParams.delete('signup');
      window.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    }
  } catch (_) {}
  return {
    peek() { try { return sessionStorage.getItem('bc.dm.pending') || ''; } catch (_) { return ''; } },
    take() { const v = this.peek(); try { sessionStorage.removeItem('bc.dm.pending'); sessionStorage.removeItem('bc.dm.guest'); } catch (_) {} return v; },
    wantsGuest() { try { return !!this.peek() && sessionStorage.getItem('bc.dm.guest') === '1'; } catch (_) { return false; } },
    wantsSignup() { try { return !!this.peek() && sessionStorage.getItem('bc.dm.guest') === 'register'; } catch (_) { return false; } },
  };
})();

// ── GUEST CHAT ─────────────────────────────────────────────────────
// Someone who opened a contact link can talk to its owner without an
// account (api.php auth_guest). The guest is a real, hidden account with
// access to that one conversation; its keys live in this browser only.
// Creating an account (claim) keeps the same account — and so the chat —
// and backs the keys up under the new password like any other account.
// A resume token in localStorage signs the guest back in on this device
// if the session is lost; it is removed on claim or when the guest leaves.
// ── GUEST_POW — the puzzle a browser solves before starting a guest chat ──
// sha256(s + n) must start with `bits` zero bits (api.php checks it). The
// message is always one SHA-256 block (≤ 55 bytes), so this is a small,
// allocation-free single-block SHA-256; it yields to the page every few
// thousand tries so the UI never freezes.
const GUEST_POW = (() => {
  const K = new Int32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const W = new Int32Array(64);
  const B = new Uint8Array(64);
  // Leading zero bits of sha256(B[0..len)), B already padded.
  const zeros = () => {
    for (let i = 0; i < 16; i++) W[i] = (B[i * 4] << 24) | (B[i * 4 + 1] << 16) | (B[i * 4 + 2] << 8) | B[i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    const w0 = (H[0] + a) >>> 0;
    return w0 ? Math.clz32(w0) : 32 + Math.clz32((H[1] + b) >>> 0);
  };
  const load = (s, n) => {
    const ns = String(n), len = s.length + ns.length;
    B.fill(0);
    for (let i = 0; i < s.length; i++) B[i] = s.charCodeAt(i);
    for (let i = 0; i < ns.length; i++) B[s.length + i] = ns.charCodeAt(i);
    B[len] = 0x80;
    const bl = len * 8;
    B[62] = (bl >>> 8) & 255; B[63] = bl & 255;
  };
  const yieldNow = () => new Promise(r => setTimeout(r, 0));
  return {
    zerosOf(s, n) { load(s, n); return zeros(); },
    // Resolves with the nonce (as a string). `stop()` true abandons it.
    async solve(s, bits, stop) {
      s = String(s);
      if (!/^[\x20-\x7e]{1,40}$/.test(s)) throw new Error('Bad challenge');
      for (let n = 0; n < 1e12;) {
        const end = n + 8000;
        for (; n < end; n++) { load(s, n); if (zeros() >= bits) return String(n); }
        if (stop && stop()) throw new Error('Cancelled');
        await yieldNow();
      }
      throw new Error('No solution');
    },
  };
})();

const bcIsGuest = (acc) => {
  const a = acc === undefined ? (typeof AUTH_STORE !== 'undefined' ? AUTH_STORE.account : null) : acc;
  return !!(a && a.guest);
};
const GUEST = {
  _k: 'bc.guest.resume',
  token() { try { return localStorage.getItem(this._k) || ''; } catch (_) { return ''; } },
  keep(t) { try { if (t) localStorage.setItem(this._k, t); } catch (_) {} },
  forget() { try { localStorage.removeItem(this._k); } catch (_) {} },
  // Start a guest chat with the owner of contact link `to`. The server
  // first hands out a small proof-of-work puzzle (auth_guest_challenge):
  // about a second for a browser, and expensive for a script making
  // accounts in bulk. A puzzle that went stale is fetched once more.
  async start(to, name, attempt = 0) {
    const ch = await apiFetch('auth_guest_challenge', { _: 1 });
    if (!ch || ch.error || !ch.c || !ch.s) throw new Error((ch && ch.error) || 'Couldn’t start the chat. Check your connection and try again.');
    const issued = Date.now();
    const n = await GUEST_POW.solve(ch.s, Number(ch.bits) || 18);
    // The server wants a moment between the puzzle and the answer.
    const wait = 1200 - (Date.now() - issued);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const r = await apiFetch('auth_guest', { to: String(to || '').replace(/^@/, ''), name: String(name || '').trim(), pow: { c: ch.c, n } });
    if (r && r.code === 'pow' && attempt < 1) return this.start(to, name, attempt + 1);
    if (!r || r.error || !r.account) throw new Error((r && r.error) || 'Couldn’t start the chat. Check your connection and try again.');
    if (r.resume) this.keep(r.resume);
    return r.account;
  },
  // The session is gone but this browser was a guest: pick it up again.
  async resume() {
    const t = this.token();
    if (!t) return null;
    try {
      const r = await apiFetch('auth_guest_resume', { token: t });
      if (r && r.account) return r.account;
      if (r && r.gone) this.forget();
    } catch (_) {}
    return null;
  },
  // Turn this guest into a full account. fields: { email, username, display_name }.
  async claim(fields, password) {
    const acc = AUTH_STORE.account;
    if (!bcIsGuest(acc)) throw new Error('You already have an account.');
    let res, enc = null;
    if (DM_AUTH.supported()) {
      const salt = DM_AUTH._newSalt();
      const d = await DM_AUTH.derive(password, salt, 600000);
      enc = d.enc;
      res = await apiFetch('auth_claim', { ...fields, auth: d.auth, kdf_salt: salt });
    } else {
      res = await apiFetch('auth_claim', { ...fields, password });
    }
    if (!res || res.error || !res.account) throw new Error((res && res.error) || 'Couldn’t create your account. Try again.');
    this.forget();
    if (enc) {
      await DM_AUTH.remember(res.account.id, enc);
      // The keys this browser made for the chat, locked with the new
      // password, so the conversation opens wherever they sign in.
      let synced = false;
      try { if (DM_KEYS.state === 'ready' && DM_KEYS.ring) synced = await DM_KEYS._sync(enc); } catch (_) {}
      DM_KEYS._set({ needsSync: !synced });
    }
    // The owner side of direct chats (agents, invoices) is theirs now too.
    try { DM_AI.load(); } catch (_) {}
    return res.account;
  },
  // End the guest session on this device. Nothing here can reopen the chat
  // afterwards, so the keys go too.
  async leave() {
    const acc = Number(AUTH_STORE.account && AUTH_STORE.account.id) || 0;
    this.forget();
    if (acc) {
      try { await DM_AUTH.forget(acc); } catch (_) {}
      try { await DM_IDB.del('acc:' + acc); } catch (_) {}
    }
    await AUTH_STORE.logout();
  },
};
if (typeof window !== 'undefined') { window.GUEST = GUEST; window.bcIsGuest = bcIsGuest; }

const DM_STORE = {
  threads: new Map(),      // thread id → thread
  convs: [],               // contact-list rows, newest first
  cursor: 0,
  sig: '',
  active: 0,
  loaded: false,
  _timer: null, _running: false, _fail: 0, _epoch: 0,
  _lookups: new Map(),     // lower(username) → { at, user|null, err }
  subs: new Set(),
  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  notify() {
    this.convs = Array.from(this.threads.values())
      .filter(t => t.visible || t.id === this.active)
      .map(t => t.conv)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    this.subs.forEach(fn => { try { fn(); } catch (e) { console.warn('[dm] sub', e); } });
  },
  convId(tid) { return 'dm_' + tid; },
  threadOf(conv) { return conv && conv.__direct ? this.threads.get(conv.threadId) || null : null; },

  start(account) {
    this.stop(true);
    if (!account || !account.id) return;
    const epoch = this._epoch;
    this._running = true;
    const guest = bcIsGuest(account);
    (async () => {
      await DM_KEYS.init(account);
      if (epoch !== this._epoch) return;
      // Agents, invoices and away replies are the owner's side of a chat;
      // a guest has none of them.
      if (!guest) {
        try { await DM_AI.load(); } catch (_) {}
        try { await DM_KEYS.loadAgentKeys(); } catch (_) {}
      }
      if (epoch !== this._epoch) return;
      await this.refreshThreads();
      const r = await apiFetch('dm_poll', { since: 0 });
      if (epoch !== this._epoch) return;
      if (r && !r.error) {
        this.cursor = Math.max(this.cursor, Number(r.cursor) || 0); this.sig = r.sig || '';
        this.ecursor = Math.max(this.ecursor || 0, Number(r.ecursor) || 0);
      }
      this.loaded = true;
      this.notify();
      if (guest) this._openGuestChat(account);
      else this._openPending();
      this._schedule(1500);
      // Anything that came in while this app was closed and still has no
      // answer gets one now (see DM_AI.catchUp).
      if (!guest) { try { DM_AI.catchUp(); } catch (e) { console.warn('[dm-ai] catch-up', e); } }
    })().catch(e => console.warn('[dm] start', e));
  },
  stop(keepKeys) {
    this._epoch++;
    this._running = false;
    clearTimeout(this._timer); this._timer = null;
    this.threads.clear(); this.convs = []; this.cursor = 0; this.ecursor = 0; this.sig = ''; this.active = 0; this.loaded = false; this._payRev = null;
    this._lookups.clear();
    try { DM_AI.reset(); } catch (_) {}
    DM_FILES.reset();
    this._sendChain.clear();
    if (!keepKeys) DM_KEYS.reset();
    this.notify();
  },
  _schedule(ms) {
    clearTimeout(this._timer);
    if (!this._running) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const base = ms != null ? ms : (hidden ? 15000 : 3000);
    const backoff = this._fail ? Math.min(30000, 2000 * 2 ** Math.min(this._fail, 4)) : 0;
    this._timer = setTimeout(() => this.poll(), Math.max(base, backoff));
  },
  async poll() {
    if (!this._running) return;
    const epoch = this._epoch;
    try {
      // A closing app (see bcGoingAway) no longer counts as present, so a
      // poll that leaves on its way out can't undo "I'm away".
      const r = await apiFetch('dm_poll', { since: this.cursor || 0, esince: this.ecursor || 0, ready: DM_KEYS.state === 'ready' && !this._leaving ? 1 : 0 });
      if (epoch !== this._epoch) return;
      if (!r || r.error) { this._fail++; return; }
      this._fail = 0;
      const rows = r.messages || [];
      if (!this.cursor) this.cursor = Number(r.cursor) || 0;
      let needThreads = r.sig && r.sig !== this.sig;
      for (const m of rows) {
        this.cursor = Math.max(this.cursor, m.id);
        if (!this.threads.has(m.thread_id)) needThreads = true;
      }
      // The thread list's own "last message" preview must not swallow the
      // messages this poll delivers: those are ingested as LIVE below, which
      // is what wakes the agent and fires the notification. (Taking them in
      // as previews first is what made an agent answer a chat's first
      // message and then go quiet.)
      if (needThreads) { this.sig = r.sig; await this.refreshThreads(new Set(rows.map(m => m.id))); }
      if (rows.length) await this._ingest(rows, true);
      // Messages edited since the last poll (theirs, or yours elsewhere).
      if (Array.isArray(r.edits) && r.edits.length) await this._applyEdits(r.edits);
      if (r.ecursor != null) this.ecursor = Math.max(this.ecursor || 0, Number(r.ecursor) || 0);
      // Direct-chat sales: payment rows changed (a new invoice, a payment
      // confirmed, the agent stepping down), and messages the server has
      // queued for this account to send (thank-you, keys, files).
      if (r.pay_rev != null && r.pay_rev !== this._payRev && !bcIsGuest()) {
        const first = this._payRev == null;
        this._payRev = r.pay_rev;
        try { DM_AI.refreshShop(first); } catch (_) {}
      }
      if (r.outbox > 0 && DM_KEYS.state === 'ready' && !bcIsGuest()) { try { DM_OUTBOX.flush(); } catch (_) {} }
      if (Array.isArray(r.typing)) this._applyTyping(r.typing);
      if (Array.isArray(r.spam) && !bcIsGuest()) { try { DM_AI.syncSpam(r.spam); } catch (_) {} }
      // An offline reply (someone's agent, while they're away) is due:
      // run it. Any signed-in browser does this, so it never depends on the
      // server carrying on after a response, which shared hosts don't allow.
      // Not while closing: a run started now would be cut off with the page.
      if (r.tick && !this._leaving) this._tick();
    } catch (e) {
      this._fail++;
    } finally {
      if (epoch === this._epoch) this._schedule();
    }
  },

  async _tick() {
    if (this._ticking || !this._running) return;
    this._ticking = true;
    try {
      const r = await apiFetch('dm_ai_tick', { _: 1 });
      if (r && r.ran) this._schedule(300);     // fetch what it just sent
    } catch (_) {} finally { this._ticking = false; }
  },
  _makeThread(t) {
    const peer = t.peer || {};
    const name = peer.display_name || peer.username || 'User';
    return {
      id: t.id, peer, msgs: [], byUid: new Map(), loaded: false, loading: null, hasMore: true,
      lastId: t.last_msg_id || 0, unread: t.unread || 0, myRead: t.my_read || 0, peerRead: t.peer_read || 0,
      unreadUpTo: t.last_msg_id || 0,   // the server's unread count already covers messages up to here
      blocked: !!t.blocked, blockedMe: !!t.blocked_me, visible: true, keyChange: null,
      conv: {
        id: this.convId(t.id), threadId: t.id, peerId: peer.id, p: 'direct', __direct: true,
        name, handle: '@' + (peer.username || ''), avatar: peer.avatar || '', col: dmColFor(peer.username || name),
        last: '', t: '', ts: (t.created_ts || 0) * 1000, unread: t.unread || 0,
        ...(typeof DM_AI !== 'undefined' && DM_AI.flagsFor ? DM_AI.flagsFor(t.id) : { stage: 'direct', escalated: false }),
        chatType: 'private', guest: !!peer.guest,
      },
    };
  },
  // Remember each contact's key. If it changes later (they reset their
  // account's messages), the chat shows a one-line notice — the same thing
  // WhatsApp and Signal do. Nothing to confirm; messages keep flowing.
  _checkPin(th) {
    const k = th.peer && th.peer.key;
    if (!k) return;
    DM_KEYS.rememberPub({ ...k, account_id: th.peer.id });
    const pin = DM_PINS.get(th.peer.id);
    if (!pin) { DM_PINS.set(th.peer.id, { keyId: k.id, fp: k.fp, at: Date.now() }); return; }
    if (pin.fp === k.fp) { if (pin.keyId !== k.id) DM_PINS.set(th.peer.id, { ...pin, keyId: k.id }); return; }
    th.keyChange = { at: Date.now() };
    DM_PINS.set(th.peer.id, { keyId: k.id, fp: k.fp, at: Date.now() });
  },
  // Same trust-on-first-use for a contact's away-agent key.
  _checkAgentPin(th, k) {
    const id = 'a' + th.peer.id;
    const pin = DM_PINS.get(id);
    if (pin && pin.fp !== k.fp) th.keyChange = { at: Date.now() };
    if (!pin || pin.fp !== k.fp) DM_PINS.set(id, { keyId: k.id, fp: k.fp, at: Date.now() });
  },
  acceptKey(tid) {
    const th = this.threads.get(tid);
    if (!th || !th.keyChange) return;
    th.keyChange = null;
    this.notify();
  },

  async refreshThreads(skipIds) {
    const epoch = this._epoch;
    const r = await apiFetch('dm_threads', { _: 1 });
    if (epoch !== this._epoch || !r || r.error) return;
    if (r.sig) this.sig = r.sig;
    const seen = new Set();
    const lasts = [];
    for (const t of (r.threads || [])) {
      seen.add(t.id);
      this._upsertThread(t);
      if (t.last && !(skipIds && skipIds.has(t.last.id))) lasts.push(t.last);
    }
    this.threads.forEach(th => { th.visible = seen.has(th.id); });
    if (lasts.length) await this._ingest(lasts, false);
    this.notify();
  },
  _upsertThread(t) {
    let th = this.threads.get(t.id);
    if (!th) { th = this._makeThread(t); this.threads.set(t.id, th); }
    else {
      th.peer = t.peer || th.peer;
      th.conv.name = th.peer.display_name || th.peer.username || th.conv.name;
      th.conv.handle = '@' + (th.peer.username || '');
      th.conv.guest = !!th.peer.guest;
      // Their profile photo (a new photo is a new URL).
      th.conv.avatar = th.peer.avatar || '';
      th.lastId = Math.max(th.lastId, t.last_msg_id || 0);
      th.myRead = Math.max(th.myRead, t.my_read || 0);
      th.peerRead = Math.max(th.peerRead, t.peer_read || 0);
      th.blocked = !!t.blocked; th.blockedMe = !!t.blocked_me;
      th.unread = this.active === th.id ? 0 : (t.unread || 0);
      th.unreadUpTo = Math.max(th.unreadUpTo || 0, t.last_msg_id || 0);
      th.conv.unread = th.unread;
    }
    th.visible = true;
    this._checkPin(th);
    return th;
  },

  // Decrypt one server row into a chat-bubble row.
  async _decrypt(m) {
    const me = DM_KEYS.acc;
    const mineOut = m.sender_id === me;
    const peerAcc = mineOut ? m.recipient_id : m.sender_id;
    const myKey = mineOut ? m.sender_key : m.recipient_key;
    const peerKey = mineOut ? m.recipient_key : m.sender_key;
    const base = { id: m.uid, sid: m.id, uid: m.uid, r: mineOut ? 'out' : 'in', raw: m,
      ts: new Date((m.ts || 0) * 1000).toISOString(), t: convStamp(new Date((m.ts || 0) * 1000)),
      ...(m.ed ? { ed: m.ed * 1000 } : {}) };
    try {
      if (DM_KEYS.state !== 'ready' || !DM_KEYS.ring || !DM_KEYS.ring.keys[myKey]) return { ...base, c: DM_LOCKED_TEXT, locked: true };
      const k = await DM_KEYS.keyFor(myKey, peerKey, peerAcc);
      if (!k) return { ...base, c: DM_LOCKED_TEXT, locked: true };
      const body = await DM_CRYPTO.open(k, m.iv, m.ct, DM_CRYPTO.aad(m));
      const text = String(body && body.t || '');
      // A file someone sent from a chat (see FILES YOU SEND IN A DIRECT
      // CHAT): drawn from its decrypted copy once it's fetched. Otherwise a
      // file link becomes the attachment itself (see FILES IN DIRECT CHATS).
      // `src` keeps the text as sent for the agent's history.
      // Deleted for everyone by its sender (see DM_STORE.deleteMessage).
      if (body && body.k === 'del') {
        const gone = { c: '', del: true, mu: '', mt: '', mn: '', ms: 0, mp: false, me: '', src: '', dmf: null, rq: null, rt: '', _q: null };
        return (mineOut && m.ai) ? { ...base, r: 'bot', agent: DM_AI.agentName(m.ai), aiId: m.ai, ...gone } : { ...base, ...gone };
      }
      const sent = body && body.k === 'file' && body.f && Number(body.f.id) ? body.f : null;
      const file = sent ? null : dmFileFromText(text);
      const content = sent
        ? { c: String(body.c || ''), mt: DM_FILES.kindOf(sent), mn: String(sent.n || 'file'), ms: Number(sent.s) || 0,
            src: text || DM_FILES.label(sent, body.c), dmf: sent, ...DM_FILES.fields(sent) }
        : file ? { c: file.c, mt: file.mt, mu: file.mu, mn: file.mn, src: text } : { c: text };
      // A reply carries the message it answers (see DM_STORE._quoteFor):
      // whose it was is worked out from this side, so both people see the
      // right name on it.
      const q = body && body.q && body.q.uid ? body.q : null;
      if (q) {
        const who = Number(q.from) === Number(me) ? (q.ai ? 'bot' : 'out') : 'in';
        Object.assign(content, { _q: q, rt: String(q.uid), rq: { uid: String(q.uid), r: who, c: String(q.c || ''), mt: String(q.mt || '') } });
      }
      // Written by one of this account's agents (the server only tells the
      // sender): drawn like any other chat's AI message.
      if (mineOut && m.ai) return { ...base, r: 'bot', agent: DM_AI.agentName(m.ai), aiId: m.ai, ...content };
      return { ...base, ...content };
    } catch (e) {
      return { ...base, c: 'This message couldn’t be opened.', locked: true, bad: true };
    }
  },
  async _ingest(rows, live) {
    const ids = [];
    rows.forEach(m => ids.push(m.sender_key, m.recipient_key));
    try { await DM_KEYS.ensurePubs(ids); } catch (_) {}
    const touched = new Set();
    const aiWake = new Set();
    for (const m of rows) {
      const th = this.threads.get(m.thread_id);
      if (!th) continue;
      const row = await this._decrypt(m);
      const existing = th.byUid.get(m.uid);
      if (existing) {
        if (!existing.sid) { Object.assign(existing, row, { _pending: false, err: '' }, this._keepStamp(existing)); touched.add(th); }
        continue;
      }
      // Only add to the loaded window; otherwise it becomes the preview.
      if (th.loaded || live) {
        const at = th.msgs.findIndex(x => x.sid && x.sid > m.id);
        if (at === -1) th.msgs.push(row); else th.msgs.splice(at, 0, row);
        th.byUid.set(m.uid, row);
      }
      if (!th._lastRow || (th._lastRow.sid || 0) < m.id) th._lastRow = row;
      th.lastId = Math.max(th.lastId, m.id);
      th.visible = true;
      if (live && row.r === 'in' && m.id > th.myRead) {
        if (this.active === th.id && typeof document !== 'undefined' && !document.hidden) this.markRead(th.id);
        else {
          if (m.id > (th.unreadUpTo || 0)) { th.unread++; th.unreadUpTo = m.id; }
          try { BC_NOTIFY.fire('newMessage', { title: th.conv.name, body: row.locked ? 'New private message' : dmPreviewOf(row), convId: th.conv.id }); } catch (_) {}
        }
      }
      if (live && row.r === 'in') {
        aiWake.add(th.id);
        if (th.sendHold && th.sendHold.reply) th.sendHold = null;
        // Their message landed, so they've stopped typing it.
        if (th.peerTypingUntil) { th.peerTypingUntil = 0; try { INBOUND_TRACKER.onUserTypingStop(th.conv.id); } catch (_) {} }
      }
      touched.add(th);
    }
    touched.forEach(th => this._syncConv(th));
    if (touched.size) this.notify();
    aiWake.forEach(tid => { try { DM_AI.onIncoming(tid); } catch (e) { console.warn('[dm-ai] wake', e); } });
  },
  _syncConv(th) {
    // Newest of: the loaded window's tail, or the latest preview row.
    const tail = th.msgs.length ? th.msgs[th.msgs.length - 1] : null;
    const last = !tail ? th._lastRow
      : (th._lastRow && tail.sid && th._lastRow.sid > tail.sid) ? th._lastRow : tail;
    if (last) {
      th._lastRow = last;
      const who = last.r === 'out' ? 'You: ' : last.r === 'bot' ? (last.agent || 'AI') + ': ' : '';
      th.conv.last = who + dmPreviewOf(last);
      th.conv.t = last.t;
      th.conv.ts = Date.parse(last.ts) || th.conv.ts;
    }
    th.conv.unread = th.unread;
  },
  async redecryptAll() {
    for (const th of this.threads.values()) {
      for (let i = 0; i < th.msgs.length; i++) {
        const r = th.msgs[i];
        if (r.locked && r.raw) { const n = await this._decrypt(r.raw); th.msgs[i] = n; th.byUid.set(n.uid, n); }
      }
      if (th._lastRow && th._lastRow.locked && th._lastRow.raw) th._lastRow = await this._decrypt(th._lastRow.raw);
      this._syncConv(th);
    }
    this.notify();
  },

  loadThread(tid) {
    const th = this.threads.get(tid);
    if (!th) return Promise.resolve();
    if (th.loaded) return Promise.resolve();
    if (th.loading) return th.loading;
    th.loading = (async () => {
      const r = await apiFetch('dm_messages', { thread_id: tid, limit: 60 });
      if (!r || r.error) { th.loading = null; throw new Error((r && r.error) || 'Could not load messages'); }
      try { await DM_KEYS.ensurePubs((r.messages || []).flatMap(m => [m.sender_key, m.recipient_key])); } catch (_) {}
      const rows = [];
      for (const m of (r.messages || [])) {
        if (th.byUid.has(m.uid)) { rows.push(th.byUid.get(m.uid)); continue; }
        const row = await this._decrypt(m); rows.push(row); th.byUid.set(m.uid, row);
      }
      const pending = th.msgs.filter(x => !x.sid);
      th.msgs = rows.concat(pending);
      th.hasMore = !!r.has_more;
      th.loaded = true; th.loading = null;
      this._syncConv(th);
      this.notify();
    })();
    return th.loading;
  },
  async loadOlder(tid) {
    const th = this.threads.get(tid);
    if (!th || !th.hasMore || th._older) return;
    const first = th.msgs.find(x => x.sid);
    if (!first) { th.hasMore = false; return; }
    th._older = true;
    try {
      const r = await apiFetch('dm_messages', { thread_id: tid, before_id: first.sid, limit: 60 });
      if (!r || r.error) return;
      try { await DM_KEYS.ensurePubs((r.messages || []).flatMap(m => [m.sender_key, m.recipient_key])); } catch (_) {}
      const rows = [];
      for (const m of (r.messages || [])) {
        if (th.byUid.has(m.uid)) continue;
        const row = await this._decrypt(m); rows.push(row); th.byUid.set(m.uid, row);
      }
      th.msgs = rows.concat(th.msgs);
      th.hasMore = !!r.has_more;
      this.notify();
    } finally { th._older = false; }
  },
  setActive(tid) {
    this.active = tid || 0;
    if (tid) this.markRead(tid);
  },
  markRead(tid) {
    const th = this.threads.get(tid);
    if (!th) return;
    const top = th.lastId;
    th.unread = 0; th.conv.unread = 0;
    if (top > th.myRead) {
      th.myRead = top;
      apiFetch('dm_read', { thread_id: tid, up_to: top });
    }
    this.notify();
  },

  // Why sending is impossible right now, or '' when it's fine.
  sendBlocker(tid) {
    const th = this.threads.get(tid);
    if (!th) return 'This conversation isn’t loaded';
    const first = String(th.conv.name || '').split(/\s+/)[0] || ('@' + th.peer.username);
    if (DM_KEYS.state === 'loading' || DM_KEYS.state === 'off') return 'Getting ready…';
    if (DM_KEYS.state === 'password') return 'Enter your password to send messages from this browser';
    if (DM_KEYS.state !== 'ready') return 'Messages aren’t available in this browser right now';
    if (th.blocked) return `You blocked ${first}`;
    if (th.blockedMe) return `${first} isn’t accepting your messages`;
    if (!th.peer.key) return `${first} can receive messages once they sign in to BotCommand`;
    // Paused by the guest limits: the composer says why and doesn't send.
    const pace = this.paceOf(tid);
    if (pace) return pace.msg;
    return '';
  },
  // The guest limits' pause on this chat's composer, or null:
  // { msg, until } — until is 0 when it lasts until they reply (or reload).
  paceOf(tid) {
    const th = this.threads.get(tid);
    if (!th) return null;
    const hold = th.sendHold;
    if (hold) {
      if (hold.until && Date.now() >= hold.until) th.sendHold = null;
      else return { msg: hold.msg, until: hold.until || 0 };
    }
    if (!bcIsGuest()) return null;
    const lim = Number(DM_KEYS.guestLimits && DM_KEYS.guestLimits.unanswered) || 0;
    if (lim <= 0) return null;
    let run = 0;
    for (let i = th.msgs.length - 1; i >= 0; i--) {
      const m = th.msgs[i];
      if (m.r === 'in') break;
      if (!m.err && !m.del) run++;
    }
    if (run < lim) return null;
    const first = String(th.conv.name || '').split(/\s+/)[0] || ('@' + th.peer.username);
    return { msg: `Waiting for ${first} to reply`, until: 0 };
  },
  // Hold this chat's composer: until `ms` from now, or (ms 0) until they
  // next write, or (forever) until the app reloads.
  _holdSend(th, msg, ms, forever) {
    clearTimeout(th._holdTimer);
    th.sendHold = { msg, until: ms > 0 ? Date.now() + ms : 0, reply: !ms && !forever };
    if (ms > 0) th._holdTimer = setTimeout(() => { th.sendHold = null; this.notify(); }, ms + 50);
    this.notify();
  },
  // opts.ai = { id, name } when an agent wrote it. Resolves true once the
  // server has stored it.
  async send(tid, text, opts = {}) {
    const th = this.threads.get(tid);
    const body = String(text || '').replace(/\s+$/, '');
    if (!th || !body.trim()) return false;
    const why = this.sendBlocker(tid);
    if (why) { if (!opts.ai) bcToast(why, 'warn'); return false; }
    // You writing to them yourself ends a spam cooldown (the server too).
    if (!opts.ai && !opts.ob) { try { if (typeof DM_AI !== 'undefined') delete DM_AI.spamUntil[String(tid)]; } catch (_) {} }
    const uid = DM_CRYPTO.uid();
    const now = new Date();
    th._typingSentAt = 0;
    const row = { id: uid, uid, r: opts.ai ? 'bot' : 'out', c: body, ts: now.toISOString(), t: convStamp(now), _pending: 'send' };
    const file = dmFileFromText(body);
    if (file) Object.assign(row, { c: file.c, mt: file.mt, mu: file.mu, mn: file.mn, src: body });
    if (opts.ai) { row.agent = opts.ai.name; row.aiId = opts.ai.id; }
    if (opts.reply) this._setReply(th, row, opts.reply);
    // A queued message (an agent's reply bubble, or a payment message from
    // the outbox): the server marks it sent in the same request that stores
    // it, so it can never go out twice (see dm_send's `ob`).
    if (opts.ob && opts.ob.id) row._ob = opts.ob;
    th.msgs.push(row); th.byUid.set(uid, row);
    this._slowAfter(row);
    this._syncConv(th); this.notify();
    // Right after the server asked for an away copy, add it up front
    // instead of taking the extra round trip again.
    const hint = th.agentKeyHint && Date.now() - th.agentKeyHint.at < 60000 ? th.agentKeyHint.key : null;
    await this._inOrder(tid, () => this._deliver(th, row, body, 0, hint));
    // A chat with an agent on it: what you (or it) sent joins the agent's
    // copy of the conversation, as in every other chat.
    if (row.sid && !opts.noMirror) { try { DM_AI.noteSent(tid, row.sid, body); } catch (_) {} }
    return opts.wantId ? (row.sid || 0) : !!row.sid;
  },
  // One attachment from the composer ({ file, url, name, mime, size, kind }),
  // with an optional caption, as its own message. The bubble shows it at
  // once from the local copy while it's encrypted, uploaded and sent.
  // ── REPLIES ──────────────────────────────────────────────────────────
  // A reply carries a small snapshot of the message it answers, inside the
  // encrypted body: its uid (to jump to it), whose it was (by account, so
  // each side can say "You" or the other person's name) and a clipped copy
  // of its text or what it holds.
  _quoteFor(th, row) {
    if (!th || !row || !row.uid || row.locked || row.del) return null;
    const mine = row.r !== 'in';
    const t = String(row.c || '').replace(/\s+/g, ' ').trim();
    return { uid: String(row.uid), from: mine ? Number(DM_KEYS.acc) : Number(th.peer.id), ai: row.r === 'bot' ? 1 : 0,
      c: t.length > 280 ? t.slice(0, 279) + '…' : t, mt: String(row.mt || '') };
  },
  _setReply(th, row, target) {
    const q = this._quoteFor(th, target);
    if (!q) return;
    row._q = q;
    row.rt = q.uid;
    row.rq = { uid: q.uid, r: target.r === 'in' ? 'in' : target.r === 'bot' ? 'bot' : 'out', c: q.c, mt: q.mt };
  },
  async sendFile(tid, att, caption, reply) {
    const th = this.threads.get(tid);
    if (!th || !att || !(att.file || att.url)) return false;
    const why = this.sendBlocker(tid);
    if (why) { bcToast(why, 'warn'); return false; }
    try { if (typeof DM_AI !== 'undefined') delete DM_AI.spamUntil[String(tid)]; } catch (_) {}
    const uid = DM_CRYPTO.uid();
    const now = new Date();
    th._typingSentAt = 0;
    const cap = String(caption || '').replace(/\s+$/, '');
    const row = { id: uid, uid, r: 'out', c: cap, mt: att.kind, mu: att.url, mn: att.name, ms: att.size,
      ts: now.toISOString(), t: convStamp(now), _pending: 'send', _att: att, _cap: cap };
    if (reply) this._setReply(th, row, reply);
    th.msgs.push(row); th.byUid.set(uid, row);
    this._slowAfter(row);
    this._syncConv(th); this.notify();
    return this._inOrder(tid, () => this._sendFileRow(th, row));
  },
  // Messages in one chat go out one after another, in the order they were
  // made: a file still uploading holds back the text typed after it, so
  // both people see them in the same order.
  _sendChain: new Map(),
  _inOrder(tid, fn) {
    const next = (this._sendChain.get(tid) || Promise.resolve()).then(fn);
    const tail = next.catch(() => {});
    this._sendChain.set(tid, tail);
    tail.then(() => { if (this._sendChain.get(tid) === tail) this._sendChain.delete(tid); });
    return next;
  },
  // Upload (once) and send. A failed upload or send leaves the bubble with
  // "Not sent — retry", which comes back here.
  async _sendFileRow(th, row) {
    if (!row._fileBody) {
      try {
        const f = await DM_FILES.upload(th.id, row._att);
        DM_FILES.urls.set(f.id, row._att.url);
        row.dmf = f;
        row._fileBody = { v: 1, k: 'file', t: DM_FILES.label(f, row._cap), c: row._cap, f };
        row.src = row._fileBody.t;
      } catch (e) {
        row._pending = false;
        row.err = String(e && e.message || e) || 'Upload failed';
        this.notify();
        return false;
      }
    }
    const hint = th.agentKeyHint && Date.now() - th.agentKeyHint.at < 60000 ? th.agentKeyHint.key : null;
    await this._deliver(th, row, row._fileBody.t, 0, hint);
    if (row.sid) {
      delete row._att;
      try { DM_AI.noteSent(th.id, row.sid, row._fileBody.t); } catch (_) {}
    }
    return !!row.sid;
  },
  // ── EDITING YOUR OWN MESSAGES ──────────────────────────────────────
  // Same rules as the other chats: your own text message (or one your
  // agent sent), already delivered, not a file, and within 48 hours
  // (DM_EDIT_WINDOW in api.php).
  canEdit(tid, row) {
    const th = this.threads.get(Number(tid));
    if (!th || !row || row.r === 'in' || !row.sid || row._pending || row.err || row.locked || row.del) return false;
    if (row.mu || row.mt || row.src) return false;
    if (!String(row.c || '').trim()) return false;
    const sent = (row.raw && row.raw.ts ? row.raw.ts * 1000 : Date.parse(row.ts)) || 0;
    if (sent && Date.now() - sent > 48 * 3600 * 1000 - 60000) return false;
    return !this.sendBlocker(th.id);
  },
  // ── DELETING YOUR OWN MESSAGES ─────────────────────────────────────
  // "Delete for everyone": your own message (or your agent's), delivered,
  // within the same 48 hours as editing. It's an edit to a sealed "deleted"
  // marker, so it reaches the other side the way an edit does and the
  // server still can't read anything; a file it carried is deleted too.
  canDelete(tid, row) {
    const th = this.threads.get(Number(tid));
    if (!th || !row || row.r === 'in' || !row.sid || row._pending || row.err || row.locked || row.del) return false;
    const sent = (row.raw && row.raw.ts ? row.raw.ts * 1000 : Date.parse(row.ts)) || 0;
    if (sent && Date.now() - sent > 48 * 3600 * 1000 - 60000) return false;
    return !this.sendBlocker(th.id);
  },
  async deleteMessage(tid, row) {
    const th = this.threads.get(Number(tid));
    if (!th || !this.canDelete(tid, row)) return false;
    row._pending = 'delete';
    this._syncConv(th); this.notify();
    const hint = th.agentKeyHint && Date.now() - th.agentKeyHint.at < 60000 ? th.agentKeyHint.key : null;
    const ok = await this._deliverEdit(th, row, '', 0, hint, true);
    if (!ok) { row._pending = false; this._syncConv(th); this.notify(); return false; }
    try { if (typeof DM_AI !== 'undefined' && DM_AI.noteEdited) DM_AI.noteEdited(th.id, row.sid, '[message deleted]'); } catch (_) {}
    return true;
  },
  // Resolves true once the server has the new text.
  async editMessage(tid, row, text) {
    const th = this.threads.get(Number(tid));
    const next = String(text || '').replace(/\s+$/, '');
    if (!th || !row || !next.trim() || !this.canEdit(tid, row)) return false;
    if (next === String(row.c || '')) return false;
    const prev = { c: row.c, ed: row.ed, oc: row.oc };
    if (!row.oc) row.oc = row.c;
    row.c = next; row.ed = Date.now(); row._pending = 'edit';
    this._syncConv(th); this.notify();
    const hint = th.agentKeyHint && Date.now() - th.agentKeyHint.at < 60000 ? th.agentKeyHint.key : null;
    const ok = await this._deliverEdit(th, row, next, 0, hint);
    if (!ok) {
      row.c = prev.c; row.ed = prev.ed; row.oc = prev.oc; row._pending = false;
      this._syncConv(th); this.notify();
      return false;
    }
    // The agent's copy of the chat takes the new text too.
    try { if (typeof DM_AI !== 'undefined' && DM_AI.noteEdited) DM_AI.noteEdited(th.id, row.sid, next); } catch (_) {}
    return true;
  },
  async _deliverEdit(th, row, text, attempt, agentKey, del = false) {
    try {
      const mine = DM_KEYS.current();
      const pk = th.peer.key;
      if (!mine || !pk) throw new Error(this.sendBlocker(th.id) || 'Not ready');
      DM_KEYS.rememberPub({ ...pk, account_id: th.peer.id });
      // Same uid as the original, so the same AAD shape as a send — sealed
      // to the chat's current keys.
      const env = { thread_id: th.id, sender_id: DM_KEYS.acc, recipient_id: th.peer.id,
        sender_key: mine.id, recipient_key: pk.id, uid: row.uid };
      const k = await DM_KEYS.keyFor(mine.id, pk.id, th.peer.id);
      if (!k) throw new Error('Missing key');
      const body = del ? { v: 1, k: 'del', at: Date.now() } : { v: 1, k: 'text', t: text, at: Date.now() };
      if (!del && row._q) body.q = row._q;        // an edited reply is still a reply
      const sealed = await DM_CRYPTO.seal(k, body, DM_CRYPTO.aad(env));
      let agentEnv = null;
      if (agentKey) {
        DM_KEYS.rememberPub({ ...agentKey, account_id: th.peer.id });
        const ak = await DM_KEYS.keyFor(mine.id, agentKey.id, th.peer.id);
        if (!ak) throw new Error('Missing key');
        const ae = await DM_CRYPTO.seal(ak, body, DM_CRYPTO.aad({ ...env, recipient_key: agentKey.id }));
        agentEnv = { key_id: agentKey.id, iv: ae.iv, ct: ae.ct };
      }
      const r = await apiFetch('dm_edit', { thread_id: th.id, id: row.sid, sender_key: mine.id, recipient_key: pk.id,
        ...sealed, ...(agentEnv ? { agent_env: agentEnv } : {}), ...(del ? { deleted: 1 } : {}) });
      if (r && r.message) {
        const fresh = await this._decrypt(r.message);
        Object.assign(row, fresh, { _pending: false, err: '' }, this._keepStamp(row));
        if (!row.ed && !del) row.ed = Date.now();
        this._syncConv(th); this.notify();
        return true;
      }
      const code = r && (r.code || r.error);
      if (code === 'agent_env' && r.agent_key && attempt < 2) {
        this._checkAgentPin(th, r.agent_key);
        return this._deliverEdit(th, row, text, attempt + 1, r.agent_key, del);
      }
      if (code === 'peer_key_changed' && attempt < 1) {
        await this.refreshThreads();
        const why = this.sendBlocker(th.id);
        if (why) throw new Error(why);
        return this._deliverEdit(this.threads.get(th.id) || th, row, text, attempt + 1, agentKey, del);
      }
      if (code === 'stale_own_key') { DM_KEYS.init(AUTH_STORE.account); throw new Error('Your key changed on another device'); }
      if (code === 'blocked') th.blockedMe = true;
      throw new Error((r && r.error) || 'Not saved');
    } catch (e) {
      bcToast('Couldn’t ' + (del ? 'delete' : 'edit') + ' the message — ' + String(e && e.message || e), 'err');
      return false;
    }
  },
  // Edits that came in from the poll: the other person's, or yours from
  // another device. Each carries its stamp, so a repeat changes nothing.
  async _applyEdits(list) {
    const ids = [];
    list.forEach(m => ids.push(m.sender_key, m.recipient_key));
    try { await DM_KEYS.ensurePubs(ids); } catch (_) {}
    const touched = new Set();
    for (const m of list) {
      const th = this.threads.get(m.thread_id);
      if (!th) continue;
      const rows = [];
      const hit = th.byUid.get(m.uid);
      if (hit) rows.push(hit);
      if (th._lastRow && th._lastRow.uid === m.uid && th._lastRow !== hit) rows.push(th._lastRow);
      for (const row of rows) {
        if (row._pending === 'edit') continue;                 // our own save is on its way
        if ((row.raw && Number(row.raw.rev)) >= Number(m.rev || 0)) continue;
        const fresh = await this._decrypt(m);
        const before = row.c;
        Object.assign(row, fresh, this._keepStamp(row));
        if (!row.oc && before && before !== row.c) row.oc = before;
        touched.add(th);
        // The agent working this chat sees the new wording too.
        if (!fresh.locked) { try { if (typeof DM_AI !== 'undefined' && DM_AI.noteEdited) DM_AI.noteEdited(th.id, m.id, fresh.src || fresh.c); } catch (_) {} }
      }
    }
    touched.forEach(th => this._syncConv(th));
    if (touched.size) this.notify();
  },
  async retry(tid, uid) {
    const th = this.threads.get(tid);
    const row = th && th.byUid.get(uid);
    if (!row || row.sid) return;
    row.err = ''; row._pending = 'send'; this._slowAfter(row); this.notify();
    if (row._att || row._fileBody) { await this._sendFileRow(th, row); return; }
    const text = row.src || row.c;
    await this._deliver(th, row, text, 0);
    if (row.sid) { try { DM_AI.noteSent(tid, row.sid, text); } catch (_) {} }
  },
  // A message on its way looks like any sent message: no dimming and no
  // footer, so the bubble doesn't flicker or change size in the moment it
  // takes to deliver. Only a send that's still going after a couple of
  // seconds says "sending…" ('slow').
  _slowAfter(row) {
    setTimeout(() => {
      if (row._pending === 'send' && !row.sid && !row.err) { row._pending = 'slow'; this.notify(); }
    }, 1800);
  },
  // The bubble you sent keeps the time it showed while sending. The
  // server's copy is stamped a moment later, to the second, by another
  // clock; switching to it reshuffled the run's corners and the hover time
  // right as the message settled. A reload shows the server's time.
  _keepStamp(row) {
    return row && row.ts ? { ts: row.ts, t: row.t } : {};
  },
  // agentKey: the other person is away and their agent answers for them
  // (offline replies). The server asks for it with 'agent_env'; the message
  // then also carries a copy encrypted to that key, and the chat says so.
  async _deliver(th, row, text, attempt, agentKey) {
    try {
      const mine = DM_KEYS.current();
      const pk = th.peer.key;
      if (!mine || !pk) throw new Error(this.sendBlocker(th.id) || 'Not ready');
      DM_KEYS.rememberPub({ ...pk, account_id: th.peer.id });
      const env = { thread_id: th.id, sender_id: DM_KEYS.acc, recipient_id: th.peer.id,
        sender_key: mine.id, recipient_key: pk.id, uid: row.uid };
      const k = await DM_KEYS.keyFor(mine.id, pk.id, th.peer.id);
      if (!k) throw new Error('Missing key');
      // A file message carries the file's description (and key) instead;
      // a reply, the message it answers.
      const body = row._fileBody ? { ...row._fileBody, at: Date.now() } : { v: 1, k: 'text', t: text, at: Date.now() };
      if (row._q) body.q = row._q;
      const sealed = await DM_CRYPTO.seal(k, body, DM_CRYPTO.aad(env));
      let agentEnv = null;
      if (agentKey) {
        DM_KEYS.rememberPub({ ...agentKey, account_id: th.peer.id });
        const ak = await DM_KEYS.keyFor(mine.id, agentKey.id, th.peer.id);   // checks the fingerprint
        if (!ak) throw new Error('Missing key');
        const ae = await DM_CRYPTO.seal(ak, body, DM_CRYPTO.aad({ ...env, recipient_key: agentKey.id }));
        agentEnv = { key_id: agentKey.id, iv: ae.iv, ct: ae.ct };
      }
      const r = await apiFetch('dm_send', { ...env, ...sealed, ...(row.aiId ? { ai_agent: row.aiId } : {}),
        ...(agentEnv ? { agent_env: agentEnv } : {}), ...(row._ob ? { ob: row._ob } : {}),
        ...(row._fileBody ? { files: [row._fileBody.f.id] } : {}) });
      if (r && r.message) {
        // assist: their agent can answer for them if they're away, so this
        // app keeps adding its readable copy up front. assist_notice: they
        // ARE away and their agent may say it's an AI, so the "away, an
        // assistant is replying" line shows; otherwise nothing in the thread
        // says an assistant is answering.
        if (r.assist && agentKey) {
          th.assistAt = Date.now(); th.assistAway = !!r.assist_away; th.assistNotice = !!r.assist_notice;
          th.agentKeyHint = { key: agentKey, at: Date.now() };
        }
        else th.agentKeyHint = null;
        // Your first message in this chat: "Answer new chats" no longer
        // covers it (see dm_send), so the header shows that straight away.
        if (r.ai && typeof DM_AI !== 'undefined') {
          const before = DM_AI.effective(th.id).id;
          DM_AI.rows.set(Number(th.id), { agentId: Number(r.ai.agent_id) || 0, manualOff: !!r.ai.manual_off, allowed: new Set((r.ai.allowed || []).map(Number)) });
          if (before !== DM_AI.effective(th.id).id) DM_AI.cancel(th.id);
          DM_AI.notify();
        }
        const m = r.message;
        const fresh = await this._decrypt(m);
        Object.assign(row, fresh, { _pending: false, err: '' }, this._keepStamp(row));
        th.byUid.set(m.uid, row);
        th.lastId = Math.max(th.lastId, m.id); th.myRead = Math.max(th.myRead, m.id);
        this._syncConv(th); this.notify();
        return;
      }
      const code = r && (r.code || r.error);
      if (code === 'agent_env' && r.agent_key && attempt < 2) {
        this._checkAgentPin(th, r.agent_key);
        return this._deliver(th, row, text, attempt + 1, r.agent_key);
      }
      if (code === 'peer_key_changed' && attempt < 1) {
        await this.refreshThreads();
        const why = this.sendBlocker(th.id);
        if (why) throw new Error(why);
        return this._deliver(this.threads.get(th.id) || th, row, text, attempt + 1, agentKey);
      }
      if (code === 'stale_own_key') { DM_KEYS.init(AUTH_STORE.account); throw new Error('Your key changed on another device'); }
      // A queued message (payment delivery, a reply bubble) that the server
      // or another device has already sent: ours is a duplicate, so it goes.
      if (code === 'ob_taken') {
        const at = th.msgs.indexOf(row);
        if (at !== -1) th.msgs.splice(at, 1);
        th.byUid.delete(row.uid);
        this._syncConv(th); this.notify();
        return;
      }
      if (code === 'blocked') th.blockedMe = true;
      // A guest's limits (see GUEST ABUSE LIMITS in api.php): not a failed
      // message but a pause. The bubble is taken back, its text returns to
      // the composer, and the composer holds for as long as the limit does.
      if (r && bcIsGuest() && !row._fileBody && ['guest_wait', 'guest_off', 'too_long', 'rate_limited'].includes(r.code)) {
        const first = String(th.conv.name || '').split(/\s+/)[0] || ('@' + th.peer.username);
        const at = th.msgs.indexOf(row);
        if (at !== -1) th.msgs.splice(at, 1);
        th.byUid.delete(row.uid);
        this._syncConv(th);
        try { window.dispatchEvent(new CustomEvent('bc-dm-restore', { detail: { tid: th.id, text: String(text || '') } })); } catch (_) {}
        if (r.code === 'rate_limited') this._holdSend(th, 'Sending paused', Math.max(1, Number(r.retry_after) || 30) * 1000);
        else if (r.code === 'guest_wait') this._holdSend(th, `Waiting for ${first} to reply`, 0);
        else if (r.code === 'guest_off') this._holdSend(th, `${first} isn’t accepting guest messages right now`, 0, true);
        else { this.notify(); bcToast(r.error, 'warn'); }
        return;
      }
      throw new Error((r && r.error) || 'Not delivered');
    } catch (e) {
      row._pending = false;
      row.err = String(e && e.message || e);
      this.notify();
    }
  },

  // Exact @username lookup, cached briefly.
  async lookup(username) {
    const u = String(username || '').replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9_.\-]{3,60}$/.test(u)) return { user: null, invalid: true };
    const key = u.toLowerCase();
    const hit = this._lookups.get(key);
    if (hit && Date.now() - hit.at < 60000) return hit;
    const r = await apiFetch('dm_lookup', { username: u });
    const out = { at: Date.now(), user: (r && r.user) || null, err: r && r.error ? r.error : '' };
    if (!out.err) this._lookups.set(key, out);
    return out;
  },
  // Open (or create) the chat with a user and return its contact-list row.
  async openWith(user) {
    const r = await apiFetch('dm_open', user.id ? { peer_id: user.id } : { username: user.username });
    if (!r || r.error || !r.thread) throw new Error((r && r.error) || 'Could not open the chat');
    const th = this._upsertThread(r.thread);
    // The chat's agent state as the server has it now. Opening a chat
    // doesn't change it; a chat you start loses the "Answer new chats"
    // agent when you send the first message (see dm_send).
    if (r.ai && typeof DM_AI !== 'undefined') {
      DM_AI.rows.set(Number(th.id), { agentId: Number(r.ai.agent_id) || 0, manualOff: !!r.ai.manual_off, allowed: new Set((r.ai.allowed || []).map(Number)) });
      DM_AI.notify();
    }
    if (r.thread.last) await this._ingest([r.thread.last], false);
    this._syncConv(th);
    this.notify();
    return th.conv;
  },
  // A guest has exactly one conversation: go straight to it — the one from
  // the link they just followed, or the one they came back to.
  async _openGuestChat(account) {
    const name = DM_PENDING.take();
    const host = Number(account && account.guest_of) || 0;
    try {
      let conv = null;
      if (host) {
        const th = Array.from(this.threads.values()).find(t => Number(t.peer && t.peer.id) === host);
        conv = th ? th.conv : await this.openWith({ id: host });
        // Followed someone else's link while already a guest: a guest talks
        // to one person, so say how to reach the other.
        const hostName = String(conv && conv.handle || '').replace(/^@/, '');
        if (name && hostName && name.toLowerCase() !== hostName.toLowerCase()) {
          setTimeout(() => bcToast('You’re chatting as a guest with @' + hostName + '. Create an account to message @' + name + '.', 'info'), 600);
        }
      } else if (name) {
        conv = await this.openWith({ username: name });
      } else if (this.convs.length) {
        conv = this.convs[0];
      }
      if (conv) window.dispatchEvent(new CustomEvent('bc-open-conv', { detail: { msg: conv } }));
    } catch (e) {
      bcToast('Couldn’t open the conversation — ' + (e && e.message || 'please try again'), 'warn');
    }
  },
  async _openPending() {
    const name = DM_PENDING.take();
    if (!name) return;
    try {
      if (DM_KEYS.me && DM_KEYS.me.username && DM_KEYS.me.username.toLowerCase() === name.toLowerCase()) {
        bcToast('That’s your own contact link', 'info'); return;
      }
      const conv = await this.openWith({ username: name });
      window.dispatchEvent(new CustomEvent('bc-open-conv', { detail: { msg: conv } }));
    } catch (e) {
      bcToast('Couldn’t open @' + name + ' — ' + (e && e.message || 'not found'), 'warn');
    }
  },
  async block(tid, on) {
    const r = await apiFetch('dm_block', { thread_id: tid, on: on ? 1 : 0 });
    if (!r || r.error) { bcToast((r && r.error) || 'Could not update', 'err'); return; }
    const th = this.threads.get(tid); if (th) th.blocked = !!on;
    this.notify();
    bcToast(on ? 'Blocked. They can’t message you.' : 'Unblocked', 'ok');
  },
  // ── TYPING ─────────────────────────────────────────────────────────
  // Who is typing to me, from each poll ([{thread_id, ms}] — a thread not in
  // the list isn't typing). Kept on the thread for the chat's separator and
  // passed to INBOUND_TRACKER so the contact list shows the dots too.
  _applyTyping(list) {
    const now = Date.now();
    const on = new Map();
    list.forEach(x => { const t = Number(x && x.thread_id), ms = Number(x && x.ms) || 0; if (t && ms > 0) on.set(t, ms); });
    let changed = false;
    this.threads.forEach(th => {
      const ms = on.get(th.id) || 0;
      const was = th.peerTypingUntil > now;
      if (ms > 0) {
        th.peerTypingUntil = now + ms;
        try { INBOUND_TRACKER.onUserTyping(th.conv.id, ms, 'typing'); } catch (_) {}
        if (!was) changed = true;
      } else if (th.peerTypingUntil) {
        th.peerTypingUntil = 0;
        try { INBOUND_TRACKER.onUserTypingStop(th.conv.id); } catch (_) {}
        if (was) changed = true;
      }
    });
    if (changed) this.notify();
  },
  // I'm typing in this chat (ms), or stopped (0). While typing it's re-sent
  // at most every 3.5s, which keeps the other side's 6s window alive.
  // force: send now whatever the throttle (an agent starting a bubble).
  typing(tid, ms, force) {
    tid = Number(tid);
    const th = this.threads.get(tid);
    if (!th || this.sendBlocker(tid)) return;
    const now = Date.now();
    ms = Math.max(0, Number(ms) || 0);
    if (ms > 0) {
      if (!force && th._typingSentAt && now - th._typingSentAt < 3500) return;
      th._typingSentAt = now;
    } else {
      if (!th._typingSentAt || now - th._typingSentAt > 16000) { th._typingSentAt = 0; return; }
      th._typingSentAt = 0;
    }
    apiFetch('dm_typing', { thread_id: tid, ms }).catch(() => {});
  },

  // "Delete": the chat leaves this account's list (the other person keeps
  // their copy); purchases and keys stay as the business record.
  async hide(tid) {
    const r = await apiFetch('dm_hide', { thread_id: tid });
    if (!r || r.error) { bcToast((r && r.error) || 'Could not delete', 'err'); return false; }
    this._forget(tid);
    return true;
  },
  // "Delete + wipe": the same, plus everything kept about this contact —
  // profile, purchases and keys, AI memory, follow-ups, the agent's state
  // for this chat and any unpaid invoice (see dm_wipe in api.php).
  async wipe(tid) {
    const r = await apiFetch('dm_wipe', { thread_id: tid });
    if (!r || r.error) { bcToast((r && r.error) || 'Could not delete', 'err'); return false; }
    this._forget(tid);
    try { await DM_AI.load(); } catch (_) {}
    try { DM_AI.refreshShop(true); } catch (_) {}
    return true;
  },
  // This browser's side of either: the thread empties and leaves the list,
  // its agent job and draft stop, and an open chat on it closes.
  _forget(tid) {
    tid = Number(tid);
    try { DM_AI.cancel(tid); } catch (_) {}
    const th = this.threads.get(tid);
    if (th) {
      th.msgs = []; th.byUid.clear(); th._lastRow = null; th.visible = false; th.conv.last = ''; th.unread = 0; th.conv.unread = 0;
      th.loaded = true; th.hasMore = false; th.assistAt = 0; th.assistAway = false; th.assistNotice = false; th.agentKeyHint = null; th.peerTypingUntil = 0;
      th.unreadUpTo = Math.max(th.unreadUpTo || 0, th.lastId || 0); th.keyChange = null;
    }
    if (this.active === tid) this.active = 0;
    try { delete DM_AI.holds[String(tid)]; } catch (_) {}
    this.notify();
    try { window.dispatchEvent(new CustomEvent('bc-conv-removed', { detail: { convId: this.convId(tid) } })); } catch (_) {}
  },
};

// ── DM_AI — agents in direct chats ─────────────────────────────────
// Direct chats are end-to-end encrypted, so only this browser can read
// them — and so only this browser can let an agent answer one. When a
// message arrives in a chat that has an agent:
//   1. wait the agent's read delay (a burst of messages resets it);
//   2. send the recent, already-decrypted messages to api.php
//      (dm_ai_reply), which calls the account's AI provider and returns
//      the reply — nothing is stored or logged there;
//   3. show each bubble as a draft in the composer, counting down the
//      agent's typing time, exactly like every other chat;
//   4. encrypt and send it through DM_STORE like any message.
// The server claims each incoming message once, so two open browsers
// never both answer. Agents need the owner's approval per chat (or the
// "Answer new chats" setting), checked again by the server on every reply.
const DM_AI = {
  loaded: false,
  auto: 0,                 // agent that answers new chats (0 = off)
  offline: false,          // server may answer while no browser is open
  offlineSupported: true,
  rows: new Map(),         // thread id → { agentId, manualOff, allowed:Set }
  llm: {},                 // agent id → { company, model, ready }
  holds: {},               // thread id → { kind:'escalated', reason } (agent handed over)
  customers: new Set(),    // thread ids whose contact has bought
  spamUntil: {},           // thread id → ms: a spam cooldown is running (see dm_spam_hit)
  spamInfo: {},            // thread id → { hits, reason } for that cooldown (the countdown line)
  jobs: new Map(),         // thread id → job (see _job)
  subs: new Set(),
  _epoch: 0,
  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  notify() { this.subs.forEach(fn => { try { fn(); } catch (e) { console.warn('[dm-ai] sub', e); } }); },
  convId(tid) { return 'dm_' + tid; },

  reset() {
    this._epoch++;
    this.jobs.forEach((j, tid) => this._stopJob(tid, j));
    this.jobs.clear(); this.rows.clear();
    this.loaded = false; this.auto = 0; this.llm = {}; this.offline = false; this.holds = {}; this.customers = new Set(); this.spamUntil = {}; this.spamInfo = {};
    this._mirrorQ.forEach(q => clearTimeout(q.timer)); this._mirrorQ.clear();
    this.notify();
  },
  async load() {
    const epoch = this._epoch;
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    const r = await apiFetch('dm_ai_state', { _: 1, tz });
    if (epoch !== this._epoch || !r || r.error) return;
    this.auto = Number(r.auto_agent_id) || 0;
    this.llm = r.llm || {};
    this.offline = !!r.offline;
    this.offlineSupported = r.offline_supported !== false;
    this.offlineStatus = r.offline_status || null;
    this.holds = r.holds || {};
    this.customers = new Set((r.customers || []).map(Number));
    this.rows.clear();
    this.spamUntil = {};
    (r.threads || []).forEach(t => {
      this.rows.set(Number(t.thread_id), {
        agentId: Number(t.agent_id) || 0, manualOff: !!t.manual_off, allowed: new Set((t.allowed || []).map(Number)),
      });
      if (Number(t.spam_left) > 0) this.spamUntil[String(Number(t.thread_id))] = Date.now() + Number(t.spam_left) * 1000;
    });
    // Reasons and hit counts arrive with the next poll (syncSpam).
    this.loaded = true;
    this.notify();
    this.syncConvFlags();
    this.syncPromptRules();
  },
  // A direct chat sits in the contact list like any other chat: Escalated
  // while its agent has handed it to you, Customers once they've bought,
  // Incoming otherwise. Kept in step whenever either changes.
  flagsFor(tid) {
    const h = this.holdOf(tid);
    const escalated = !!(h && h.kind === 'escalated');
    return { escalated, stage: escalated ? 'escalated' : (this.customers.has(Number(tid)) ? 'customer' : 'direct') };
  },
  syncConvFlags() {
    if (typeof DM_STORE === 'undefined') return;
    let changed = false;
    DM_STORE.threads.forEach((th, tid) => {
      const f = this.flagsFor(tid);
      if (th.conv.escalated !== f.escalated || th.conv.stage !== f.stage) { th.conv.escalated = f.escalated; th.conv.stage = f.stage; changed = true; }
    });
    if (changed) DM_STORE.notify();
  },

  // ── SALES IN DIRECT CHATS ──────────────────────────────────────
  // The chat's conversation on the sales side: purchases, invoices and the
  // agent's memory are all keyed on it.
  shopConvId(tid) { return 'dm_' + Number(tid) + '_' + (Number(DM_KEYS.acc) || 0); },
  holdOf(tid) { return this.holds[String(Number(tid))] || null; },
  async resume(tid) {
    tid = Number(tid);
    const r = await apiFetch('dm_shop_resume', { thread_id: tid });
    if (!r || r.error) throw new Error((r && r.error) || 'Couldn’t resume the agent');
    delete this.holds[String(tid)];
    this.notify();
    this.syncConvFlags();
    this._kick(tid);
  },
  // Messages sent in a covered chat join the agent's copy (batched).
  _mirrorQ: new Map(),
  noteSent(tid, sid, text) {
    tid = Number(tid);
    const eff = this.effective(tid);
    if (!eff.agent || !this.isApproved(tid, eff.id) || !sid) return;
    const q = this._mirrorQ.get(tid) || { rows: [], timer: null };
    q.rows.push({ id: Number(sid), c: String(text || '') });
    clearTimeout(q.timer);
    q.timer = setTimeout(() => {
      this._mirrorQ.delete(tid);
      apiFetch('dm_shop_mirror', { thread_id: tid, rows: q.rows }).catch(() => {});
    }, 1200);
    this._mirrorQ.set(tid, q);
  },
  // A message in this chat was edited: the agent's copy takes the new text.
  noteEdited(tid, sid, text) {
    tid = Number(tid);
    const eff = this.effective(tid);
    if (!eff.agent || !this.isApproved(tid, eff.id) || !sid || !String(text || '').trim()) return;
    apiFetch('dm_shop_mirror', { thread_id: tid, edit: 1, rows: [{ id: Number(sid), c: String(text) }] }).catch(() => {});
  },
  // Invoices and the agent's state changed on the server.
  async refreshShop(first) {
    try {
      const r = await apiFetch('dm_shop_invoices', { _: 1 });
      if (r && !r.error && typeof PAYMENTS_STORE !== 'undefined' && PAYMENTS_STORE.mergeServerRows) PAYMENTS_STORE.mergeServerRows(r.invoices || []);
    } catch (_) {}
    if (!first) { try { await this.load(); } catch (_) {} }
  },
  // The fixed part of what this app adds to every agent prompt (style,
  // context and payment rules), kept on the server so replies written while
  // you're away get the same rules. Re-sent only when it changes.
  _sysxHash: '', _sysxTimer: null,
  syncPromptRules() {
    clearTimeout(this._sysxTimer);
    this._sysxTimer = setTimeout(async () => {
      try {
        if (typeof INVOICE_PROCESSOR === 'undefined' || !AUTH_STORE.account) return;
        const text = [INVOICE_PROCESSOR.buildStyleBlock(), INVOICE_PROCESSOR.buildContextBlock(), '<<SALES>>', INVOICE_PROCESSOR.buildSystemBlock()]
          .filter(Boolean).join('\n\n');
        let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
        const key = (DM_KEYS.acc || 0) + ':' + h + ':' + text.length;
        if (key === this._sysxHash) return;
        const r = await apiFetch('dm_shop_sysx', { text });
        if (r && !r.error) this._sysxHash = key;
      } catch (_) {}
    }, 4000);
  },

  agentById(id) {
    id = Number(id) || 0;
    if (!id || typeof AGENTS_STORE === 'undefined') return null;
    return AGENTS_STORE.list.find(a => Number(a.id) === id) || null;
  },
  agentName(id) { const a = this.agentById(id); return a ? a.name : 'Agent'; },
  row(tid) { return this.rows.get(Number(tid)) || { agentId: 0, manualOff: false, allowed: new Set() }; },
  // The agent answering this chat: { id, agent, auto }.
  effective(tid) {
    const r = this.row(tid);
    let id = 0, auto = false;
    if (r.agentId) id = r.agentId;
    else if (this.auto && !r.manualOff) { id = this.auto; auto = true; }
    return { id, agent: id ? this.agentById(id) : null, auto };
  },
  isApproved(tid, agentId) {
    agentId = Number(agentId) || 0;
    return !!agentId && (this.row(tid).allowed.has(agentId) || agentId === this.auto);
  },
  // "Gemini 2.5 Flash" / "Google" for the approval notice.
  describe(agentId) { return this.llm[String(Number(agentId) || 0)] || null; },
  // The server's live list of chats on a spam cooldown (every dm_poll): the
  // countdown line follows it, including cooldowns the offline agent starts.
  syncSpam(list) {
    const until = {}, info = {};
    const now = Date.now();
    (list || []).forEach(x => {
      const k = String(Number(x && x.thread_id) || 0), left = Number(x && x.left) || 0;
      if (k === '0' || left <= 0) return;
      until[k] = now + left * 1000;
      info[k] = { hits: Number(x.hits) || 0, reason: String(x.reason || '') };
    });
    // Only redraw when something really changed (the clocks drift by a
    // poll's worth; under two seconds counts as the same cooldown).
    const a = this.spamUntil, keys = new Set([...Object.keys(a), ...Object.keys(until)]);
    let changed = false;
    keys.forEach(k => { if (!a[k] !== !until[k] || Math.abs((a[k] || 0) - (until[k] || 0)) > 2000) changed = true; });
    this.spamInfo = info;
    if (!changed) return;
    this.spamUntil = until;
    this.notify();
  },
  status(tid) { const j = this.jobs.get(Number(tid)); return j ? { phase: j.phase, error: j.error, note: j.note || '' } : { phase: '', error: '', note: '' }; },

  // Assign (agentId) or unassign (0). Resolves { ok } or
  // { needApproval, llm } when this agent hasn't been approved here yet —
  // the caller shows the notice and calls again with approve = true.
  async assign(tid, agentId, approve) {
    tid = Number(tid); agentId = Number(agentId) || 0;
    const r = await apiFetch('dm_ai_assign', { thread_id: tid, agent_id: agentId, approve: approve ? 1 : 0 });
    if (r && r.code === 'approval_needed') {
      if (r.llm) this.llm[String(agentId)] = r.llm;
      return { needApproval: true, llm: r.llm || this.describe(agentId) };
    }
    if (!r || r.error) throw new Error((r && r.error) || 'Couldn’t update the agent');
    const before = this.effective(tid).id;
    this.rows.set(tid, { agentId: Number(r.agent_id) || 0, manualOff: !!r.manual_off, allowed: new Set((r.allowed || []).map(Number)) });
    if (before !== this.effective(tid).id) this.cancel(tid);
    this.notify();
    // Someone already waiting gets an answer, as in every other chat.
    if (agentId) this._kick(tid);
    return { ok: true };
  },
  async setAuto(agentId, approve) {
    agentId = Number(agentId) || 0;
    const r = await apiFetch('dm_ai_auto', { agent_id: agentId, approve: approve ? 1 : 0 });
    if (!r || r.error) throw new Error((r && r.error) || 'Couldn’t update the setting');
    this.auto = Number(r.auto_agent_id) || 0;
    // Chats that were only covered by the old setting stop here.
    this.jobs.forEach((j, tid) => { if (!this.effective(tid).agent) this.cancel(tid); });
    this.notify();
  },

  // Offline replies on/off. On: the server makes the agent key and this
  // browser keeps a copy. Off: this browser makes sure it holds the key
  // first (so past replies stay readable), then the server deletes its
  // copy and every envelope.
  async setOffline(on, approve) {
    if (on) {
      const r = await apiFetch('dm_ai_offline', { on: 1, approve: approve ? 1 : 0 });
      if (!r || r.error) throw new Error((r && r.error) || 'Couldn’t turn on offline replies');
      try { await DM_KEYS.addAgentKeys([r.agent_key]); } catch (_) {}
      this.offline = true;
    } else {
      try { await DM_KEYS.loadAgentKeys(); } catch (_) {}
      const r = await apiFetch('dm_ai_offline', { on: 0 });
      if (!r || r.error) throw new Error((r && r.error) || 'Couldn’t turn off offline replies');
      this.offline = false;
    }
    this.notify();
  },

  _job(tid) {
    let j = this.jobs.get(tid);
    if (!j) { j = { timer: null, running: false, again: false, cancelled: false, phase: '', error: '', doneIn: 0 }; this.jobs.set(tid, j); }
    return j;
  },
  _stopJob(tid, j) {
    clearTimeout(j.timer); j.timer = null;
    clearTimeout(j.noteTimer); j.noteTimer = null;
    j.cancelled = true; j.again = false;
    if (j.typingIv) { clearInterval(j.typingIv); j.typingIv = null; }
    const cid = this.convId(tid);
    try { if (DRAFT_STORE.get(cid)) DRAFT_STORE.discard(cid); } catch (_) {}
    try { INBOUND_TRACKER.onAgentTypingStop(cid); } catch (_) {}
    try { DM_STORE.typing(tid, 0); } catch (_) {}
  },
  cancel(tid) {
    tid = Number(tid);
    const j = this.jobs.get(tid);
    if (!j) return;
    this._stopJob(tid, j);
    this.jobs.delete(tid);
    this.notify();
  },
  _setPhase(tid, j, phase, error) {
    if (phase !== 'note') j.note = '';
    if (j.phase === phase && (error === undefined || j.error === error)) return;
    j.phase = phase; if (error !== undefined) j.error = error;
    this.notify();
  },
  // Deliberately not answering right now, and why (shown under the chat).
  _hold(tid, j, note, retryMs) {
    clearTimeout(j.timer); j.timer = null;
    j.note = note; j.phase = 'note'; j.error = '';
    if (retryMs > 0) j.timer = setTimeout(() => { j.timer = null; this._run(tid); }, Math.min(retryMs, 2147483000));
    this.notify();
  },
  // Outside the agent's reply hours (SCHEDULE_GATE), as in its other chats:
  // 'queue' answers once they open; 'pause' / 'offline' leave it.
  _offHours(tid, j, mode, ms) {
    this._hold(tid, j, mode === 'queue' ? 'Outside its reply hours · answers when they open' : 'Outside its reply hours', mode === 'queue' && ms > 0 ? ms + 3000 : 0);
  },
  // A spam cooldown (SPAM_THROTTLE): quiet until it runs out.
  _spamQuiet(tid, j, ms) {
    const m = Math.max(1, Math.ceil(ms / 60000));
    this._hold(tid, j, `Holding off · flagged as spam (${m} min)`, 0);
    // The note goes when the cooldown does.
    clearTimeout(j.noteTimer);
    j.noteTimer = setTimeout(() => { if (j.phase === 'note') { j.phase = ''; j.note = ''; this.notify(); } }, Math.min(ms + 500, 2147483000));
  },
  // "Just got back" (PRESENCE_SIMULATOR): a chat that had gone quiet for a
  // while gets its answer a little later, as in every other chat. Worked out
  // from the gap before this burst of messages.
  _presenceMs(tid, a) {
    const th = DM_STORE.threads.get(tid);
    const rows = th ? th.msgs : [];
    let i = rows.length - 1;
    while (i >= 0 && rows[i].r !== 'in') i--;
    while (i > 0 && rows[i - 1].r === 'in') i--;
    if (i <= 0) return 0;
    const gap = (Date.parse(rows[i].ts) || 0) - (Date.parse(rows[i - 1].ts) || 0);
    const slow = a.delay === 'thoughtful' ? 1.5 : (a.delay === 'quick' ? 0.6 : 1.0);
    const u = Math.random();
    if (gap >= 18 * 60000 * slow) return 12000 + u * 33000;
    if (gap >= 4 * 60000 * slow) return 3000 + u * 9000;
    return 0;
  },

  // Opening the app (or signing in again): a chat whose newest message is
  // theirs and still unanswered is picked up as if it had just arrived —
  // the server didn't get to it (offline replies off, no key, a failure),
  // or it came in during the moment the app was closing. The server says
  // 'handled' for anything already answered or being answered, so this
  // never replies twice. Only recent messages: older ones were left
  // unanswered on purpose.
  catchUp() {
    const cutoff = Date.now() - 12 * 3600 * 1000;
    DM_STORE.threads.forEach((th, tid) => {
      const last = th && th._lastRow;
      if (!th.visible || th.blocked || th.blockedMe || !last || last.r !== 'in' || last.locked) return;
      if ((Date.parse(last.ts) || 0) < cutoff) return;
      this.onIncoming(tid);
    });
  },
  // A new message from the other person.
  onIncoming(tid) {
    tid = Number(tid);
    if (DM_STORE._leaving) return;          // closing: the server answers
    if (typeof AGENTS_STORE !== 'undefined' && !AGENTS_STORE.loaded) { AGENTS_STORE.onceLoaded(() => this.onIncoming(tid)); return; }
    const eff = this.effective(tid);
    if (!eff.agent || eff.agent.active === false || !this.isApproved(tid, eff.id)) return;
    const j = this._job(tid);
    j.cancelled = false;
    if (j.running) {
      // Mid-reply: finish with the newer context instead.
      j.again = true;
      try { DRAFT_STORE.markSuperseded(this.convId(tid)); } catch (_) {}
      return;
    }
    const a = eff.agent;
    // The agent's own read delay, like its other chats; each new message in
    // a burst restarts it, so it answers once they've finished.
    const lo = Math.max(0, Number(a.readDelayMin ?? 2)), hi = Math.max(lo, Number(a.readDelayMax ?? 9));
    const settle = Math.max(0, Math.min(6000, Number(a.settleMs ?? 1800)));
    let away = 0;
    try { if (a.presenceSim !== false) away = this._presenceMs(tid, a); } catch (_) {}
    this._schedule(tid, Math.min(30000, settle + (lo + Math.random() * (hi - lo)) * 1000) + away);
  },
  _kick(tid) { const j = this._job(tid); j.cancelled = false; j.error = ''; this._schedule(tid, 900); },
  // The other person sees the agent typing from the moment it starts
  // writing until the last bubble goes, kept alive every few seconds (their
  // app only looks every few seconds, and one signal lasts 15s at most).
  // Not while you've paused the draft to take over.
  _typingOn(tid, j) {
    this._typingOff(tid, j, true);
    const cid = this.convId(tid);
    const beat = () => {
      let paused = false;
      try { const d = DRAFT_STORE.get(cid); paused = !!(d && d.paused); } catch (_) {}
      if (!paused) { try { DM_STORE.typing(tid, 12000, true); } catch (_) {} }
    };
    beat();
    j.typingIv = setInterval(beat, 7000);
  },
  _typingOff(tid, j, keep) {
    if (j && j.typingIv) { clearInterval(j.typingIv); j.typingIv = null; }
    if (!keep) { try { DM_STORE.typing(tid, 0); } catch (_) {} }
  },
  retry(tid) { this._kick(Number(tid)); },
  _schedule(tid, ms) {
    const j = this._job(tid);
    clearTimeout(j.timer);
    this._setPhase(tid, j, 'reading', '');
    j.timer = setTimeout(() => { j.timer = null; this._run(tid); }, ms);
  },
  // Typing time, exactly as the Telegram/Discord engine works it out:
  // characters at the agent's WPM (5 chars a word), 1.2s–30s, and later
  // bubbles of a split reply a little quicker (x0.75, max 9s).
  _typingMs(agent, text, i) {
    const cps = (Math.max(10, Number(agent.wpm) || 75) * 5) / 60;
    const len = String(text || '').length;
    if (i > 0) return Math.max(1200, Math.min(9000, Math.round((len / cps) * 1000 * 0.75)));
    return Math.max(1200, Math.min(30000, Math.round((len / cps) * 1000)));
  },

  // Report queued reply bubbles as sent ({id, dm_id}) or dropped (ids).
  _rows(tid, sent, drop) {
    if ((!sent || !sent.length) && (!drop || !drop.length)) return;
    apiFetch('dm_reply_rows', { thread_id: Number(tid), sent: sent || [], drop: drop || [] }).catch(() => {});
  },
  // Threads where this browser's agent is typing a reply out right now.
  activeThreads() {
    const out = [];
    this.jobs.forEach((j, tid) => { if (j.running) out.push(Number(tid)); });
    return out;
  },
  async _run(tid) {
    const j = this._job(tid);
    if (j.running) { j.again = true; return; }
    const epoch = this._epoch;
    const cid = this.convId(tid);
    if (DM_STORE._leaving) { this._setPhase(tid, j, ''); return; }
    const th = DM_STORE.threads.get(tid);
    const eff = this.effective(tid);
    const agent = eff.agent;
    if (!th || !agent || agent.active === false || !this.isApproved(tid, eff.id) || DM_STORE.sendBlocker(tid)) {
      this._setPhase(tid, j, ''); return;
    }
    j.running = true; j.again = false;
    try {
      if (!th.loaded) { try { await DM_STORE.loadThread(tid); } catch (_) {} }
      // Only messages this browser could open; locked ones are left out.
      const rows = th.msgs.filter(x => x.sid && !x.locked && !x.err);
      // Their newest message. Anything after it that YOU typed means it's
      // answered; agent-side messages after it may just be a payment's
      // thank-you / key / files, which don't answer what they asked — the
      // server knows which, and says 'handled' when a real reply went out.
      let li = rows.length - 1;
      while (li >= 0 && rows[li].r !== 'in') { if (rows[li].r === 'out') return; li--; }
      const last = li >= 0 ? rows[li] : null;
      if (!last || last.sid <= j.doneIn) return;
      // Still typing, and the agent is set to wait for that (as in its
      // other chats): answer once they stop.
      if (agent.waitForUserTyping !== false && th.peerTypingUntil > Date.now()) {
        this._schedule(tid, Math.min(20000, th.peerTypingUntil - Date.now() + 1200));
        return;
      }
      // Its reply hours and a spam cooldown, checked before it starts typing,
      // as in every other chat (the server checks them again).
      try {
        const sch = agent.schedule;
        if (sch && sch.enabled && typeof SCHEDULE_GATE !== 'undefined' && !SCHEDULE_GATE.isOpen(sch)) {
          this._offHours(tid, j, sch.mode || 'pause', SCHEDULE_GATE.msUntilOpen(sch));
          return;
        }
      } catch (_) {}
      const quietMs = (this.spamUntil[String(tid)] || 0) - Date.now();
      if (agent.spamThrottle !== false && quietMs > 0) { this._spamQuiet(tid, j, quietMs); return; }
      this._setPhase(tid, j, 'writing', '');
      try { INBOUND_TRACKER.onAgentTyping(cid, Date.now() + 60000); } catch (_) {}
      this._typingOn(tid, j);
      const history = rows.slice(-40).map(x => ({ id: x.sid, r: x.r === 'in' ? 'in' : 'out', c: String(x.src || x.c || '') }));
      // The same live prompt blocks every other chat sends (sales state,
      // payments on this chat, accepted coins, style and context rules).
      let systemExtra = '';
      try { if (typeof INVOICE_PROCESSOR !== 'undefined') systemExtra = INVOICE_PROCESSOR.buildSystemExtra(this.shopConvId(tid)) || ''; } catch (_) {}
      // After ~2 minutes of waiting on their order's delivery, answer anyway.
      const force = (j.deliverWaits || 0) >= 30 ? 1 : 0;
      // A reply overtaken by a newer message is written again with it in
      // view — three times in a row at most, then it goes out.
      const reconsider = (j.recons || 0) < 3 ? 1 : 0;
      const r = await apiFetch('dm_ai_reply', { thread_id: tid, last_in: last.sid, history, system_extra: systemExtra, force, reconsider });
      if (epoch !== this._epoch || j.cancelled) return;
      if (!r || r.error) {
        if (r && r.code === 'not_approved') { this.load(); return; }
        if (r && r.code === 'bad_last_in') return;
        // A provider or network hiccup is tried again (3s, then 8s), then
        // once more half a minute later, as in every other chat.
        if (!r || r.code === 'llm_failed') {
          j.llmFails = (j.llmFails || 0) + 1;
          if (j.llmFails <= 2) { this._schedule(tid, [3000, 8000][j.llmFails - 1] * (0.75 + Math.random() * 0.5)); return; }
          if (!j.recovering) {
            j.recovering = true;
            this._setPhase(tid, j, '', String((r && r.error) || 'The agent couldn’t reply'));
            this._notifyError(tid);
            clearTimeout(j.timer);
            j.timer = setTimeout(() => { j.timer = null; if (!j.cancelled && epoch === this._epoch) this._run(tid); }, 30000);
            return;
          }
        }
        j.llmFails = 0; j.recovering = false;
        this._setPhase(tid, j, '', String((r && r.error) || 'The agent couldn’t reply'));
        this._notifyError(tid);
        return;
      }
      j.llmFails = 0; j.recovering = false;
      if (r.skip === 'reconsider') { j.recons = (j.recons || 0) + 1; this._schedule(tid, 700); return; }
      if (r.skip === 'off_hours') { this._offHours(tid, j, r.mode || 'pause', (Number(r.reopen_in) || 0) * 1000); return; }
      if (r.skip === 'spam' || r.skip === 'throttled') {
        const ms = (Number(r.left) || 60) * 1000;
        this.spamUntil[String(tid)] = Date.now() + ms;
        if (r.hits != null || r.reason != null) this.spamInfo[String(tid)] = { hits: Number(r.hits) || 0, reason: String(r.reason || '') };
        this._spamQuiet(tid, j, ms);
        return;
      }
      if (r.skip === 'rate_limited') { this._setPhase(tid, j, '', 'Paused after 40 replies this hour'); return; }
      // A guest chat (see GUEST ABUSE LIMITS in api.php): left unanswered.
      if (r.skip === 'guest_ai_off') { j.doneIn = last.sid; this._hold(tid, j, 'Not answering guests (Profile settings)', 0); return; }
      if (r.skip === 'guest_limit') { j.doneIn = last.sid; this._hold(tid, j, 'This contact has reached their reply limit for now', 0); return; }
      if (r.skip === 'guest_owner_limit') { j.doneIn = last.sid; this._hold(tid, j, 'Replies to guests and new contacts are paused — limit reached for now', 0); return; }
      if (r.skip === 'escalated') {
        this.holds[String(tid)] = (r.hold && r.hold.kind) ? r.hold : { kind: 'escalated', reason: '' };
        this._setPhase(tid, j, ''); this.notify(); this.syncConvFlags(); return;
      }
      // This reply handed the chat over (it escalated as it answered): you're
      // told, as in every other chat.
      if (r.hold && r.hold.kind === 'escalated' && !this.holdOf(tid)) {
        this.holds[String(tid)] = r.hold; this.notify(); this.syncConvFlags();
        try {
          if (typeof BC_NOTIFY !== 'undefined') BC_NOTIFY.fire('handover', { title: `Needs you: ${(th.conv && th.conv.name) || 'customer'}`,
            body: r.hold.reason || `${agent.name || 'The agent'} handed this chat to you`, convId: th.conv && th.conv.id });
        } catch (_) {}
      }
      if (r.skip === 'post_sale_stop' || r.skip === 'paused') { this._setPhase(tid, j, ''); this.load(); return; }
      // The contact was deleted / wiped while the reply was being written.
      if (r.skip === 'gone' || r.skip === 'handled') { if (r.skip === 'handled') j.doneIn = last.sid; this._setPhase(tid, j, ''); return; }
      if (r.skip === 'private_off') { this._setPhase(tid, j, '', 'This agent is set not to reply in private chats'); return; }
      // Their payment's messages are still going out: send those first,
      // then answer. Someone else is writing this chat's reply: wait for it.
      if (r.skip === 'delivering') { j.deliverWaits = (j.deliverWaits || 0) + 1; try { DM_OUTBOX.flush(); } catch (_) {} this._schedule(tid, 4000); return; }
      j.deliverWaits = 0;
      if (r.skip === 'busy') { this._schedule(tid, 6000); return; }
      // Nothing came out of a reply that should have said something (the
      // server gave the message back): write it again rather than leave
      // them unanswered. A reply decided against on purpose ('no reply
      // needed', handed over, muted) is left as it is.
      if ((!Array.isArray(r.parts) || !r.parts.length) && (r.skip === 'empty' || !r.skip)) {
        j.emptyTries = (j.emptyTries || 0) + 1;
        if (j.emptyTries <= 3) { this._schedule(tid, 5000 * j.emptyTries); return; }
        j.emptyTries = 0;
        this._setPhase(tid, j, '', 'The agent wrote an empty reply');
        return;
      }
      j.emptyTries = 0;
      if (Array.isArray(r.invoices) && r.invoices.length && typeof PAYMENTS_STORE !== 'undefined' && PAYMENTS_STORE.mergeServerRows) {
        try { PAYMENTS_STORE.mergeServerRows(r.invoices); } catch (_) {}
      }
      j.doneIn = last.sid;
      // Newer message: start over with it in view (three times in a row at
      // most; then this reply goes out and the newer one is answered next).
      if (j.again && (j.recons || 0) < 3) { j.recons = (j.recons || 0) + 1; return; }
      j.recons = 0;
      // Same finishing as the other chats: markdown out, and the agent's own
      // texture (typo rate, lowercase drift) applied per bubble below.
      // A file bubble carries a signed link: markdown clean-up could eat the
      // underscores in its signature, so it's left exactly as the server sent it.
      // Each bubble is queued on the server (r.rows, same order): it's
      // reported as sent the moment it goes, or dropped if the draft is
      // discarded or replaced. Whatever is still unreported if this tab
      // closes is sent by the server / your next browser instead of lost.
      const rowIds = Array.isArray(r.rows) ? r.rows.map(x => Number(x && x.id) || 0) : [];
      const all = (r.parts || []).map((x, k) => {
        let t = String(x || '');
        if (!DM_FILE_LINK_RE.test(t)) { try { t = stripMarkdown(t); } catch (_) {} }
        return { text: t.trim(), id: rowIds[k] || 0 };
      });
      const emptyIds = all.filter(p => !p.text && p.id).map(p => p.id);
      if (emptyIds.length) this._rows(tid, [], emptyIds);
      const kept = all.filter(p => p.text);
      const parts = kept.map(p => p.text);
      const dropFrom = (k) => this._rows(tid, [], kept.slice(k).map(p => p.id).filter(Boolean));
      const who = { id: Number(r.agent && r.agent.id) || eff.id, name: (r.agent && r.agent.name) || agent.name };
      for (let i = 0; i < parts.length; i++) {
        // Closing: the rest stays queued and the server sends it — never dropped.
        if (DM_STORE._leaving) return;
        if (j.cancelled || epoch !== this._epoch) { if (j.cancelled) dropFrom(i); return; }
        // Links, keys, payment addresses and amounts are never given a fake typo.
        const guarded = /https?:\/\/|www\.|\b[A-Z0-9]{4,}(?:-[A-Z0-9]{3,}){1,}\b|[A-Za-z0-9]{24,}|\d/.test(parts[i]);
        let imperf = { text: parts[i], original: parts[i], mutated: false };
        if (!guarded) { try { imperf = IMPERFECTION.apply(parts[i], agent); } catch (_) {} }
        // Sending a file takes as long as its caption would to type, not the link.
        const fileOf = dmFileFromText(imperf.text);
        let delayMs = this._typingMs(agent, fileOf ? (fileOf.c || 'x') : imperf.text, i);
        // Now and then a pause before a long one, as someone stops to think
        // (the agent's hesitation setting, as in its other chats).
        const hes = Math.max(0, Math.min(50, Number(agent.hesitationPct) || 0));
        if (hes && imperf.text.length >= 80 && Math.random() * 100 < hes) delayMs += 2200 + Math.random() * 2300;
        this._setPhase(tid, j, 'draft');
        try { INBOUND_TRACKER.onAgentTyping(cid, Date.now() + delayMs); } catch (_) {}
        // The other person sees you typing while the agent types, the same
        // as they would a person.
        try { DM_STORE.typing(tid, Math.min(15000, delayMs + 1500), true); } catch (_) {}
        const res = await DRAFT_STORE.open(cid, {
          text: imperf.text, attachments: [], delayMs, agent: who.name, provider: '',
          chunkIndex: i, chunkTotal: parts.length, upcoming: parts.slice(i + 1),
        });
        // Superseded = they wrote again while this was counting down: the
        // reply is rebuilt with that message in view instead.
        if (DM_STORE._leaving) return;
        if (res && res.superseded) { dropFrom(i); j.again = true; return; }
        if (!res || !res.send) { dropFrom(i); return; }
        const text = String(res.text || '').trim();
        if (!text) { this._rows(tid, [], [kept[i].id].filter(Boolean)); continue; }
        if (j.cancelled || epoch !== this._epoch) { if (j.cancelled) dropFrom(i); return; }
        // Take it from the queue first: if another device (or the server,
        // while this draft sat paused) already sent it, it isn't sent twice.
        if (kept[i].id) {
          let tk = null;
          try { tk = await apiFetch('dm_reply_take', { id: kept[i].id }); } catch (_) { tk = null; }
          if (tk && !tk.error && tk.taken === false) continue;
        }
        const sentId = await DM_STORE.send(tid, text, { ai: who, wantId: true, ob: kept[i].id ? { id: kept[i].id } : null });
        // Not delivered: left queued, so it's retried from there.
        if (!sentId) return;
        if (kept[i].id) this._rows(tid, [{ id: kept[i].id, dm_id: sentId }], []);
        // The "*word" fix after a typo, when the agent is set up for it —
        // only if the operator didn't edit the draft first.
        if (imperf.mutated && text === imperf.text) {
          let fix = '';
          try { fix = IMPERFECTION.selfCorrectionFor(imperf.original, imperf.text, agent.selfCorrectPct || 0, agent.style); } catch (_) {}
          if (fix && !j.cancelled && epoch === this._epoch) {
            await new Promise(res2 => setTimeout(res2, 400 + Math.random() * 800));
            await DM_STORE.send(tid, fix, { ai: who });
          }
        }
      }
    } catch (e) {
      console.warn('[dm-ai] run', e);
      this._setPhase(tid, j, '', 'The agent couldn’t reply');
    } finally {
      j.running = false;
      this._typingOff(tid, j);
      try { INBOUND_TRACKER.onAgentTypingStop(cid); } catch (_) {}
      if (j.phase !== '' && j.phase !== 'note' && !j.timer) this._setPhase(tid, j, '');
      if (j.again && !j.cancelled && epoch === this._epoch) {
        j.again = false;
        // The agent's usual gap between one reply and the next.
        let gap = 700;
        try {
          const ag = this.effective(tid).agent;
          const lo = Math.max(0, Number(ag && ag.msgGapMin != null ? ag.msgGapMin : 1)), hi = Math.max(lo, Number(ag && ag.msgGapMax != null ? ag.msgGapMax : 4));
          if (j.recons) gap = 700; else gap = Math.max(700, (lo + Math.random() * (hi - lo)) * 1000);
        } catch (_) {}
        this._schedule(tid, gap);
      }
    }
  },
  // "Agent couldn't reply", as a notification like every other chat's.
  _notifyError(tid) {
    try {
      const th = DM_STORE.threads.get(Number(tid));
      if (typeof BC_NOTIFY !== 'undefined') BC_NOTIFY.fire('aiError', { title: 'Agent couldn’t reply', body: th && th.conv ? `Chat with ${th.conv.name}` : '', convId: th && th.conv && th.conv.id });
    } catch (_) {}
  },
};
// The reply is one full AI call; give it the same deadline ai_reply has.
try {
  API_TIMEOUTS.dm_ai_reply = 150000; API_TIMEOUTS.dm_ai_tick = 180000;
  API_TIMEOUTS.dm_outbox_done = 150000; API_TIMEOUTS.dm_shop_paid = 150000;
} catch (_) {}

// ── DM_OUTBOX — messages the server queued for direct chats ──────────
// After a payment on a direct chat the server writes the thank-you, the
// key, the file links and the setup message; this browser holds the chat
// key, so it sends them (in order, with a short natural gap) and reports
// each one back. While you're away with offline replies on, the server
// sends them itself.
const DM_OUTBOX = {
  _busy: false, _again: false,
  async flush() {
    if (this._busy) { this._again = true; return; }
    if (DM_KEYS.state !== 'ready' || !DM_STORE._running || DM_STORE._leaving) return;
    this._busy = true;
    try {
      do {
        this._again = false;
        // A reply this browser's agent is still typing out is its own to send.
        const c = await apiFetch('dm_outbox_claim', { skip_threads: DM_AI.activeThreads() });
        if (!c || c.error || !Array.isArray(c.rows) || !c.rows.length) break;
        const results = [];
        let refreshed = false;
        for (const row of c.rows) {
          // Closing: what's left is released to the server (dm_away).
          if (DM_STORE._leaving) break;
          let tid = Number(row.thread_id);
          if (!DM_STORE.threads.has(tid) && !refreshed) { refreshed = true; try { await DM_STORE.refreshThreads(); } catch (_) {} }
          const th = DM_STORE.threads.get(tid);
          let dmId = 0;
          if (th && !DM_STORE.sendBlocker(tid)) {
            const eff = DM_AI.effective(tid);
            const who = eff.agent ? { id: Number(eff.agent.id), name: eff.agent.name } : { id: 0, name: 'Agent' };
            const cid = DM_AI.convId(tid);
            const fileRow = dmFileFromText(row.text);
            // Long enough for their app (which looks every few seconds) to
            // show the typing before it lands.
            const ms = Math.max(2500, Math.min(6000, String(fileRow ? (fileRow.c || '') : (row.text || '')).length * 35));
            try { INBOUND_TRACKER.onAgentTyping(cid, Date.now() + ms); } catch (_) {}
            try { DM_STORE.typing(tid, ms + 1500, true); } catch (_) {}
            await new Promise(res => setTimeout(res, ms));
            try { INBOUND_TRACKER.onAgentTypingStop(cid); } catch (_) {}
            try { dmId = await DM_STORE.send(tid, row.text, { ai: who, wantId: true, noMirror: true, ob: { id: row.id, token: c.token } }); } catch (_) { dmId = 0; }
          }
          results.push({ id: row.id, dm_id: Number(dmId) || 0 });
          // Stop at a failure so later messages don't overtake it.
          if (!dmId) break;
        }
        // Rows claimed but not attempted are released by the claim timeout.
        await apiFetch('dm_outbox_done', { token: c.token, results });
      } while (this._again);
    } catch (e) { console.warn('[dm-outbox]', e); }
    finally { this._busy = false; }
  },
};
// Closing the app marks you away straight away, so your offline replies
// start without waiting for the presence timeout.
// The desktop host (Form1) calls window.bcGoingAway() as it closes, since
// a WebView2 being torn down may never fire pagehide.
// Resolves once the server has it.
window.bcGoingAway = () => {
  if (!DM_STORE._running) return Promise.resolve();
  DM_STORE._leaving = true;
  if (DM_STORE._awaySent) return DM_STORE._awaySent;
  try {
    DM_STORE._awaySent = fetch(`${API}?action=dm_away`, { method: 'POST', keepalive: true, credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dm_away' }) }).catch(() => {});
  } catch (_) { DM_STORE._awaySent = Promise.resolve(); }
  return DM_STORE._awaySent;
};
// The desktop app (Form1) calls this when its window is closed and waits
// for it (up to ~12s) before tearing the page down. Closing it the moment
// after "mark as paid" used to cut off the requests that tell the server
// (the list save, the delivery request), so the server never knew the
// invoice was paid, and a reply this app had started was left half done.
//   1. Stop starting anything new here: this app no longer counts as
//      present, its agent starts no new replies and it sends no more queued
//      messages (the server sends those, and finishes replies, once it's
//      told this app is gone).
//   2. Let every save / send already on its way land.
//   3. Tell the server this app is gone (dm_away) and wait for that too.
window.bcBeforeClose = async () => {
  const until = Date.now() + 10000;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  try { DM_STORE._leaving = true; } catch (_) {}
  // The invoice list saves are chained: the last one queued must go out.
  try {
    if (typeof PAYMENTS_STORE !== 'undefined' && PAYMENTS_STORE._persistChain) {
      await Promise.race([PAYMENTS_STORE._persistChain, wait(Math.max(0, until - Date.now()))]);
    }
  } catch (_) {}
  while (Date.now() < until) {
    let n = 0;
    try { n = window.bcWritesInFlight ? window.bcWritesInFlight() : 0; } catch (_) {}
    if (!n) break;
    await wait(120);
  }
  try { await Promise.race([window.bcGoingAway(), wait(Math.max(1500, until - Date.now()))]); } catch (_) {}
};
try { window.addEventListener('pagehide', () => window.bcGoingAway()); } catch (_) {}
// Back from the browser's page cache (or the host changed its mind about
// closing): present again, and anything that arrived meanwhile is answered.
try {
  window.addEventListener('pageshow', (e) => {
    if (!DM_STORE._leaving) return;
    DM_STORE._leaving = false;
    DM_STORE._awaySent = null;
    if (e && e.persisted && DM_STORE._running) { DM_STORE._schedule(300); try { DM_AI.catchUp(); } catch (_) {} }
  });
} catch (_) {}
// A renamed agent shows its new name on messages it already wrote.
try {
  AGENTS_STORE.sub(() => {
    let changed = false;
    DM_STORE.threads.forEach(th => th.msgs.forEach(m => {
      if (m.aiId) { const n = DM_AI.agentName(m.aiId); if (m.agent !== n) { m.agent = n; changed = true; } }
    }));
    if (changed) DM_STORE.notify();
    DM_AI.notify();
  });
} catch (_) {}
const useDmAi = () => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => DM_AI.sub(force), []);
  return DM_AI;
};

// Keep DM life-cycle tied to the signed-in account.
(() => {
  let lastId = 0;
  const onAuth = (account) => {
    const id = account && account.id ? Number(account.id) : 0;
    if (id === lastId) return;
    lastId = id;
    if (id) DM_STORE.start(account);
    else { DM_KEYS.wipeLocal().finally(() => DM_STORE.stop(false)); }
  };
  AUTH_STORE.sub((account) => onAuth(account));
  if (AUTH_STORE.account) onAuth(AUTH_STORE.account);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && DM_STORE._running) { DM_STORE._schedule(250); if (DM_STORE.active) DM_STORE.markRead(DM_STORE.active); }
    });
  }
})();

// Server-run bots (BC_RELAY) follow the signed-in account too. Closing the
// desktop app hands its bots to the server at once (as dm_away does for
// direct chats), rather than after the presence timeout.
(() => {
  let lastId = 0;
  const onAuth = (account) => {
    // Bots belong to full accounts; a guest runs none (and becoming a full
    // account starts them).
    const id = account && account.id && !account.guest ? Number(account.id) : 0;
    if (id === lastId) return;
    lastId = id;
    BC_RELAY.stop();
    if (id) BC_RELAY.start();
  };
  AUTH_STORE.sub((account) => onAuth(account));
  if (AUTH_STORE.account) onAuth(AUTH_STORE.account);
  const dmAway = window.bcGoingAway;
  window.bcGoingAway = () => Promise.all([dmAway ? dmAway() : null, BC_RELAY.hostAway()]).then(() => {});
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && BC_RELAY._started) BC_RELAY._schedule(200); });
  }
})();

// Re-render on DM changes (list or keys).
const useDm = () => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const a = DM_STORE.sub(force), b = DM_KEYS.sub(force);
    return () => { a(); b(); };
  }, []);
  return DM_STORE;
};