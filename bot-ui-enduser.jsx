// ───────────────────────────────────────────────────────────────────
// bot-ui-enduser.jsx — Customer record, shown inside the chat
// The floating profile popup was retired. Its content now appears where
// it happened in the conversation (chapters, interests, notes, payments,
// escalations as in-thread "moments"), the AI summary shows on hover of
// the chat header's identity pill, and "Mark as customer" lives in the
// contact list's right-click menu. Also owns the end-user fetch cache and
// the coin/fiat/status metadata.
//     DEMO_END_USER_DATA              — sample data for the demo account
//     ExpiryCountdown                 — live ticker for purchase expiry
//     EU_CACHE                        — per-account end-user fetch cache
//     COIN_META / FIAT_META / CRYPTO_RATES_STORE / useCryptoRates
//                                     — currency formatting + live rates
//     STATUS_PALETTE / CoinChip / BioCard / CollapsibleSection
//                                     — visual atoms used only here
//     useEndUserRecord / ChatMomentRow / ChatSummaryHover / setCustomerMark
//                                     — the in-chat record (see bottom)
// ───────────────────────────────────────────────────────────────────

// ── DEMO CUSTOMER DATA — injected when the demo account is active ────────────
const DEMO_END_USER_DATA = {
  end_user: {
    id: 1, name: 'Mr. Flume', handle: 'MrFlume',
    email: 'flume@protonmail.com', phone: '',
    notes: 'High-engagement crypto buyer. Prefers LTC payments.',
    verified: 1,
    bio: 'The way I see things.',
    status_text: 'Browsing',
  },
  purchases: [
    { id: 1, product_id: 1, product_name: 'Package Yellow', product_price: '0.42 LTC', purchased_at: '2025-04-12', expires_at: '2026-04-12', status: 'active', coin: 'ltc' },
    { id: 2, product_id: 2, product_name: 'Quick-Start Bundle', product_price: '0.0018 BTC', purchased_at: '2025-03-04', expires_at: null, status: 'active', coin: 'btc' },
  ],
  transactions: [
    { id: 1, amount: '0.42000000', currency: 'LTC', status: 'completed', product_name: 'Package Yellow',     reference: 'INV-2025-0412', created_at: '2025-04-12T10:22:00Z', notes: '' },
    { id: 2, amount: '0.00180000', currency: 'BTC', status: 'completed', product_name: 'Quick-Start Bundle', reference: 'INV-2025-0304', created_at: '2025-03-04T08:11:00Z', notes: '' },
    { id: 3, amount: '120.00',     currency: 'USDT',status: 'pending',   product_name: 'Package Green',      reference: 'INV-2025-0501', created_at: '2025-05-01T14:30:00Z', notes: 'Awaiting on-chain confirmation' },
  ],
  memory: {
    stage: 'browsing', trust: 58, engagement: 44, happiness: 72,
    facts: { region: 'EU', preferred_coin: 'LTC', wallet_type: 'self-custody' },
    prefs: { preferred_coin: 'LTC (declined)', contact_time: 'evenings UTC', comms_style: 'direct' },
    interests: [
      { name: 'Package Yellow', status: 'considering', sku: 'PKG-Y', note: 'customer confirmed intent to buy' },
      { name: 'Package Green',  status: 'shown',       sku: 'PKG-G', note: 'shown after Yellow declined' },
    ],
    notes: [
      'Declined LTC twice — try USDT TRC20 next.',
      'Mentioned wanting cross-chain support.',
    ],
    signals: ['c:declined:ltc','c:picked:ltc','p:buy_intent','q:greeting'],
    latest_thinking: {
      customer_intent: 'comparing packages, weighing payment options',
      current_stage: 'browsing',
      conversation_phase: 'discovery',
      customer_mood: 'engaged',
      spam_signal: false,
      updated_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    },
    open_threads: ['Send USDT TRC20 wallet address.'],
  },
  summary: 'Engaged crypto buyer evaluating Package Yellow. Has declined LTC; consider offering USDT TRC20.',
  stats: {
    total_messages: 18, inbound_messages: 9, outbound_messages: 9,
    first_contact_at: '2025-03-04T08:00:00Z',
    last_contact_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    spend_by_currency: { LTC: 0.42, BTC: 0.0018 },
  },
};

// ── ExpiryCountdown ───────────────────────────────────────────────────
// Live countdown to a purchase's expires_at timestamp. Re-renders every
// second by tick state. Returns null when no expiry; otherwise paints a
// small pill (e.g. "12d 4h 33m 12s") that turns warn → err as the date
// approaches, and displays "expired" once it passes.
const ExpiryCountdown = ({ expiresAt }) => {
  const [, tick] = React.useReducer(x => x+1, 0);
  React.useEffect(() => {
    if (!expiresAt) return;
    // Adaptive cadence — ticking once per second is wasteful when expiry
    // is days away. We poll the remaining time and choose the smallest
    // useful interval: every second inside the last hour, every minute
    // inside the last day, and every 5 minutes otherwise. Re-arms after
    // each tick because the cadence shrinks as we approach zero.
    let id;
    const arm = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      const interval = ms <= 0 ? 60_000
        : ms < 3600_000     ? 1000
        : ms < 86_400_000   ? 60_000
        :                     300_000;
      id = setTimeout(() => { tick(); arm(); }, interval);
    };
    arm();
    return () => clearTimeout(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  // expiresAt may be a DATE ('YYYY-MM-DD') or full timestamp. Date()
  // parses both; for date-only strings JS treats them as UTC midnight
  // which is fine for a day-granularity countdown.
  const target = new Date(expiresAt).getTime();
  if (!isFinite(target)) return null;
  const now = Date.now();
  const ms  = target - now;
  if (ms <= 0) {
    // Expired — softer dusty-rose tone matching STATUS_PALETTE.failed.
    return (
      <span title={`Expired ${new Date(expiresAt).toLocaleString()}`} style={{
        display:'inline-flex',alignItems:'center',gap:4,
        padding:'2px 7px',borderRadius:5,
        fontSize:9.5,fontWeight:700,fontFamily:'var(--mono)',letterSpacing:'0.04em',
        color:'#d99089',background:'rgba(217,144,137,0.06)',border:'1px solid rgba(217,144,137,0.20)',
        textTransform:'uppercase',
      }}>EXPIRED</span>
    );
  }
  const totalSec = Math.floor(ms/1000);
  const days  = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins  = Math.floor((totalSec % 3600) / 60);
  const secs  = totalSec % 60;
  // Format compactly. Show days if any, then hours/min/sec; collapse
  // smaller units when far from expiry so the pill stays readable.
  let label;
  if (days >= 7)      label = `${days}d ${hours}h`;
  else if (days >= 1) label = `${days}d ${hours}h ${mins}m`;
  else if (hours>=1)  label = `${hours}h ${mins}m ${String(secs).padStart(2,'0')}s`;
  else                label = `${mins}m ${String(secs).padStart(2,'0')}s`;
  // Dim, professional palette that matches the rest of the panel's
  // muted badge tones (sage/amber/dusty-rose at low opacity). Far from
  // expiry reads as a quiet pewter; closer in, it warms toward amber,
  // and only inside the final 24h does it shade toward a soft rose.
  // Borders/backgrounds stay at low opacity so the chip blends with
  // the surrounding surface instead of competing with content.
  let col, bg, bd;
  if (days >= 30) {
    // Comfortable — quiet pewter, almost neutral.
    col = 'rgba(180,188,200,0.78)';
    bg  = 'rgba(255,255,255,0.035)';
    bd  = 'rgba(255,255,255,0.08)';
  } else if (days >= 7) {
    // Healthy — muted sage matching STATUS_PALETTE.active/.purchased.
    col = '#7eb89a';
    bg  = 'rgba(126,184,154,0.06)';
    bd  = 'rgba(126,184,154,0.18)';
  } else if (days >= 1) {
    // Approaching — soft amber matching STATUS_PALETTE.considering.
    col = '#d9a86a';
    bg  = 'rgba(217,168,106,0.06)';
    bd  = 'rgba(217,168,106,0.20)';
  } else {
    // Inside last 24h — dusty rose matching STATUS_PALETTE.failed.
    col = '#d99089';
    bg  = 'rgba(217,144,137,0.07)';
    bd  = 'rgba(217,144,137,0.22)';
  }
  return (
    <span title={`Expires ${new Date(expiresAt).toLocaleString()}`} style={{
      display:'inline-flex',alignItems:'center',gap:4,
      padding:'2px 7px',borderRadius:5,
      fontSize:10,fontWeight:600,fontFamily:'var(--mono)',
      color:col,background:bg,border:`1px solid ${bd}`,letterSpacing:'-0.005em',
    }}>{label}</span>
  );
};

// ── END-USER PIPELINE PANEL ──────────────────────────────────
// ── EndUserPipelinePanel ──────────────────────────────────────────────
// Apple/iOS-inspired side-docked profile panel with content-driven height.
// Three modes:
//   • 'docked' — 56px collapsed rail flush with the right edge (default)
//   • 'open'   — expanded panel docked to the right edge, content-driven height
//   • 'float'  — legacy free-floating draggable popup (power-user opt-in)
// Hierarchy: identity → live signals → active intents → invoices/payments
//   → purchases → discovered facts → recent activity → notes → contact.
// Crypto-aware: coin chips, brand colours, real iconography for BTC/ETH/
// LTC/USDT/XMR/DOGE/SOL/BCH/TRX/XRP and a generic fallback.

// ── END-USER DATA CACHE ────────────────────────────────────────────────
// Memoises the last successful get_end_user response per conversation so
// re-opening the panel shows cached data INSTANTLY while a background
// fetch refreshes it. Without this the panel renders empty until the
// network round-trip lands, and CRM-derived sections (Active interests,
// What we know) appear missing on first paint — the symptom users see as
// "I have to switch tabs to make it show up".
//
// Memory cache:    Map<convId, {data, ts}>  — fast, session-scoped
// Persistent:      localStorage 'eu-cache-v1' = {convId: {data, ts}, ...}
//                  trimmed to the most recent 25 conversations, ≤ 1MB.
// Subscribers:     components subscribe so a background refresh in one
//                  panel updates any other open instance for the same conv.
// ── EU_CACHE — End-user popup data cache (per-account-scoped) ──────────
// Bug history: this used to key entries by `convId` alone. That caused a
// catastrophic cross-account leak: two operators each have their own
// conversation row for the same Telegram chat (chat id "12345" → conv id
// "telegram_12345" on BOTH accounts). The cache shared one bucket between
// them, so when operator B opened the popup, the very first paint showed
// operator A's customer record (purchases, invoices, notes, contact) until
// the API reload landed — and even then, localStorage was already poisoned
// with the wrong account's data. We now scope every cache key by the
// signed-in account's id, AND we wipe the whole bucket on logout. The
// effective key is `${accountId}::${convId}`, so two operators with the
// same conv id cannot collide. Keys without an active account are dropped
// entirely (won't read or write) so a not-yet-authed boot can't pull a
// stale entry from a previous session into the wrong account.
const EU_CACHE = (() => {
  const IDB_PREFIX  = 'eu:';            // IDB keys: "eu:<accountId>::<convId>"
  const LS_KEY      = 'eu-cache-v2';    // localStorage mirror for instant reads
  const LEGACY_KEY  = 'eu-cache-v1';
  const MAX_CONVS   = 25;
  const MAX_BYTES   = 1024 * 1024;
  const mem         = new Map();        // composite-key -> {data, ts}
  const subs        = new Map();        // composite-key -> Set<fn>

  const acctId = () => {
    try {
      const a = (typeof AUTH_STORE !== 'undefined' && AUTH_STORE && AUTH_STORE.account) || null;
      return a && (a.id != null) ? String(a.id) : null;
    } catch(_) { return null; }
  };
  const compositeKey = (convId) => {
    const aid = acctId();
    if (!aid || !convId) return null;
    return aid + '::' + convId;
  };

  try { localStorage.removeItem(LEGACY_KEY); } catch(_){}

  // Synchronous LS hydration for instant warm-start.
  const _hydrateFromRaw = (parsed) => {
    if (!parsed || typeof parsed !== 'object') return;
    Object.keys(parsed).forEach(k => {
      if (k.indexOf('::') < 1) return;
      const v = parsed[k];
      if (v && v.data) mem.set(k, { data: v.data, ts: Number(v.ts) || 0 });
    });
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _hydrateFromRaw(JSON.parse(raw));
  } catch(_){}

  // Async IDB hydration — merges newer IDB entries on top of LS snapshot.
  if (typeof IDB_STORE !== 'undefined') {
    IDB_STORE.keys(IDB_PREFIX).then(async (keys) => {
      for (const k of (keys || [])) {
        try {
          const entry = await IDB_STORE.get(k);
          if (!entry || !entry.data) continue;
          const ck = k.slice(IDB_PREFIX.length);
          const existing = mem.get(ck);
          if (!existing || (entry.ts || 0) > (existing.ts || 0)) {
            mem.set(ck, entry);
            const set = subs.get(ck);
            if (set) set.forEach(fn => { try { fn(entry.data); } catch(_){} });
          }
        } catch(_){}
      }
    }).catch(()=>{});
  }

  // Persist to IDB (durable) + LS snapshot (fast sync read).
  //
  // PERF: the localStorage snapshot sorts, serialises and writes up to 1MB
  // synchronously. It used to run on every single record fetch (each chat
  // open plus a 15s poll), which is a visible main-thread stall. The IDB
  // write stays immediate; the snapshot is coalesced into one write when
  // the page is idle, and flushed on hide/unload so nothing is lost.
  let lsTimer = null;
  const writeSnapshot = () => {
    lsTimer = null;
    try {
      const all = Array.from(mem.entries())
        .sort((a,b) => (b[1].ts||0) - (a[1].ts||0))
        .slice(0, MAX_CONVS);
      const obj = {};
      for (const [k,v] of all) obj[k] = v;
      let serialised = JSON.stringify(obj);
      while (serialised.length > MAX_BYTES && all.length > 1) {
        all.pop();
        const trimmed = {};
        for (const [k,v] of all) trimmed[k] = v;
        serialised = JSON.stringify(trimmed);
      }
      localStorage.setItem(LS_KEY, serialised);
    } catch(_){}
  };
  const scheduleSnapshot = () => {
    if (lsTimer) return;
    const run = () => writeSnapshot();
    lsTimer = (typeof requestIdleCallback === 'function')
      ? { idle: requestIdleCallback(run, { timeout: 2000 }) }
      : { t: setTimeout(run, 600) };
  };
  const flushSnapshot = () => {
    if (!lsTimer) return;
    try {
      if (lsTimer.idle != null && typeof cancelIdleCallback === 'function') cancelIdleCallback(lsTimer.idle);
      if (lsTimer.t != null) clearTimeout(lsTimer.t);
    } catch (_) {}
    writeSnapshot();
  };
  try {
    window.addEventListener('pagehide', flushSnapshot);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSnapshot(); });
  } catch (_) {}
  const persist = (ck, entry) => {
    if (typeof IDB_STORE !== 'undefined' && ck && entry) {
      IDB_STORE.set(IDB_PREFIX + ck, entry).catch(()=>{});
    }
    scheduleSnapshot();
  };
  // Cheap structural fingerprint, kept beside each entry (never persisted),
  // so an unchanged poll result can be recognised without re-rendering.
  const jsonOf = (data) => { try { return JSON.stringify(data); } catch (_) { return ''; } };

  return {
    get(convId) {
      const k = compositeKey(convId);
      if (!k) return null;
      const e = mem.get(k);
      return e ? e.data : null;
    },
    set(convId, data) {
      if (!convId || !data) return false;
      const k = compositeKey(convId);
      if (!k) return false;
      // Identical to what's cached (the common 15s-poll outcome): refresh the
      // timestamp in memory only — no disk write, no subscriber fan-out, no
      // re-render of the open chat.
      const json = jsonOf(data);
      const prev = mem.get(k);
      if (prev && json) {
        if (prev._json === undefined) {
          Object.defineProperty(prev, '_json', { value: jsonOf(prev.data), writable: true, enumerable: false, configurable: true });
        }
        if (prev._json === json) { prev.ts = Date.now(); return false; }
      }
      const entry = { data, ts: Date.now() };
      mem.set(k, entry);
      persist(k, entry);
      Object.defineProperty(entry, '_json', { value: json, writable: true, enumerable: false, configurable: true });
      const set = subs.get(k);
      if (set) set.forEach(fn => { try { fn(data); } catch(_){} });
      return true;
    },
    // Age of the cached record in ms (Infinity when absent). Used by hover
    // prefetch to avoid refetching something that is still fresh.
    age(convId) {
      const k = compositeKey(convId);
      const e = k ? mem.get(k) : null;
      return e ? (Date.now() - (e.ts || 0)) : Infinity;
    },
    clear(convId) {
      if (convId) {
        const k = compositeKey(convId);
        if (k) {
          mem.delete(k);
          if (typeof IDB_STORE !== 'undefined') IDB_STORE.del(IDB_PREFIX + k).catch(()=>{});
        }
      } else {
        mem.clear();
        if (typeof IDB_STORE !== 'undefined') IDB_STORE.clear(IDB_PREFIX).catch(()=>{});
      }
      persist(null, null);
      flushSnapshot();
    },
    clearForCurrentAccount() {
      const aid = acctId();
      if (!aid) { this.clear(); return; }
      const prefix = aid + '::';
      Array.from(mem.keys()).forEach(k => {
        if (k.indexOf(prefix) === 0) {
          mem.delete(k);
          if (typeof IDB_STORE !== 'undefined') IDB_STORE.del(IDB_PREFIX + k).catch(()=>{});
        }
      });
      persist(null, null);
    },
    sub(convId, fn) {
      const k = compositeKey(convId);
      if (!k) return () => {};
      if (!subs.has(k)) subs.set(k, new Set());
      subs.get(k).add(fn);
      return () => {
        const s = subs.get(k);
        if (!s) return;
        s.delete(fn);
        if (!s.size) subs.delete(k);   // don't keep an empty Set per visited conv forever
      };
    },
  };
})();

// ── HOVER PREFETCH ──────────────────────────────────────────────────────
// Called when the operator's pointer rests on a contact row: the record is
// fetched into EU_CACHE ahead of the click, so the chat opens with its
// moments and summary already in place. De-duplicated per conversation and
// skipped while a cached copy is still fresh.
const _euPrefetchInflight = new Map();
const prefetchEndUserRecord = (convId) => {
  try {
    if (!convId || euIsDemo()) return;
    if (_euPrefetchInflight.has(convId)) return;
    if (EU_CACHE.age(convId) < 30000) return;
    const p = apiGet('get_end_user', `&conv_id=${encodeURIComponent(convId)}`)
      .then(res => { if (res && !res.error) EU_CACHE.set(convId, res); })
      .catch(() => {})
      .finally(() => { _euPrefetchInflight.delete(convId); });
    _euPrefetchInflight.set(convId, p);
  } catch (_) {}
};

const COIN_META = {
  btc:  {sym:'₿', name:'Bitcoin',     col:'#F7931A', tint:'rgba(247,147,26,0.14)',  bd:'rgba(247,147,26,0.32)'},
  eth:  {sym:'Ξ', name:'Ethereum',    col:'#8A92B2', tint:'rgba(138,146,178,0.14)', bd:'rgba(138,146,178,0.32)'},
  ltc:  {sym:'Ł', name:'Litecoin',    col:'#3F8AC9', tint:'rgba(63,138,201,0.14)',  bd:'rgba(63,138,201,0.32)'},
  usdt: {sym:'₮', name:'Tether',      col:'#26A17B', tint:'rgba(38,161,123,0.14)',  bd:'rgba(38,161,123,0.32)'},
  usdc: {sym:'$', name:'USD Coin',    col:'#2775CA', tint:'rgba(39,117,202,0.14)',  bd:'rgba(39,117,202,0.32)'},
  xmr:  {sym:'ɱ', name:'Monero',      col:'#FF6600', tint:'rgba(255,102,0,0.14)',   bd:'rgba(255,102,0,0.32)'},
  doge: {sym:'Ð', name:'Dogecoin',    col:'#C2A633', tint:'rgba(194,166,51,0.14)',  bd:'rgba(194,166,51,0.32)'},
  sol:  {sym:'◎', name:'Solana',      col:'#9945FF', tint:'rgba(153,69,255,0.14)',  bd:'rgba(153,69,255,0.32)'},
  bch:  {sym:'Ƀ', name:'Bitcoin Cash',col:'#0AC18E', tint:'rgba(10,193,142,0.14)',  bd:'rgba(10,193,142,0.32)'},
  trx:  {sym:'T', name:'TRON',        col:'#FF060A', tint:'rgba(255,6,10,0.14)',    bd:'rgba(255,6,10,0.32)'},
  xrp:  {sym:'✕', name:'XRP',         col:'#999999', tint:'rgba(153,153,153,0.14)', bd:'rgba(153,153,153,0.32)'},
  bnb:  {sym:'B', name:'BNB',         col:'#F3BA2F', tint:'rgba(243,186,47,0.14)',  bd:'rgba(243,186,47,0.32)'},
  dai:  {sym:'◈', name:'DAI',         col:'#F5AC37', tint:'rgba(245,172,55,0.14)',  bd:'rgba(245,172,55,0.32)'},
  matic:{sym:'M', name:'Polygon',     col:'#8247E5', tint:'rgba(130,71,229,0.14)',  bd:'rgba(130,71,229,0.32)'},
  ada:  {sym:'A', name:'Cardano',     col:'#0033AD', tint:'rgba(0,51,173,0.14)',    bd:'rgba(0,51,173,0.32)'},
  dot:  {sym:'●', name:'Polkadot',    col:'#E6007A', tint:'rgba(230,0,122,0.14)',   bd:'rgba(230,0,122,0.32)'},
};
const FIAT_META = {
  usd: {sym:'$', name:'US Dollar', col:'#7d8b96'},
  eur: {sym:'€', name:'Euro',      col:'#7d8b96'},
  gbp: {sym:'£', name:'GB Pound',  col:'#7d8b96'},
  aud: {sym:'A$',name:'AUD',       col:'#7d8b96'},
  cad: {sym:'C$',name:'CAD',       col:'#7d8b96'},
  jpy: {sym:'¥', name:'Yen',       col:'#7d8b96'},
};

// ── CRYPTO RATES STORE ───────────────────────────────────────────────
// Tiny client cache + fetcher for crypto→USD conversion. Hits the
// `get_crypto_rates` endpoint which itself caches 60s server-side, so
// repeated frontend reads are essentially free. Subscribers re-render
// whenever a fresh rate table lands.
const CRYPTO_RATES_STORE = (() => {
  let rates = {};            // { BTC:{USD:62345.12, ...}, ... }
  let updatedAt = 0;
  let inflight = null;
  const subs = new Set();
  const notify = () => subs.forEach(fn => { try { fn(); } catch(_){} });
  const fetchRates = () => {
    if (inflight) return inflight;
    if (typeof apiGet !== 'function') return Promise.resolve(rates);
    inflight = apiGet('get_crypto_rates').then(res => {
      inflight = null;
      if (res && res.rates && typeof res.rates === 'object') {
        rates = res.rates;
        updatedAt = res.updated_at || Math.floor(Date.now()/1000);
        notify();
      }
      return rates;
    }).catch(() => { inflight = null; return rates; });
    return inflight;
  };
  return {
    get rates(){ return rates; },
    get updatedAt(){ return updatedAt; },
    // True once there is at least one usable pair in the table. The invoice
    // path checks this before it decides it has "no rate available".
    get ready(){ for (const k in rates) return true; return false; },
    fetch: fetchRates,
    // ── ensure() — the headless entry point ───────────────────────────
    // THE BUG THIS EXISTS FOR: the only thing that ever populated this
    // table was the useCryptoRates hook, which runs on mount. The AI mints
    // invoices with no payments view open, so `rates` was an empty object,
    // lookupRate() returned null, and every invoice went out fiat-only —
    // the customer got an address and a dollar figure with no idea how much
    // ETH to actually send. Whether the crypto amount appeared came down to
    // which tab the operator happened to be looking at.
    //
    // Anything that needs a rate to be CORRECT (rather than just to render)
    // awaits this first. Resolves with the table either way — a failed
    // fetch is not an error here, the caller degrades to fiat-only.
    ensure(maxAgeSec){
      const maxAge = isFinite(maxAgeSec) ? maxAgeSec : 300;
      const ageOk  = updatedAt && (Math.floor(Date.now()/1000) - updatedAt) < maxAge;
      let has = false; for (const k in rates) { has = true; break; }
      if (has && ageOk) return Promise.resolve(rates);
      return fetchRates();
    },
    sub:   fn => { subs.add(fn); return () => subs.delete(fn); },
    // Convert a crypto amount to USD. Returns null when no rate available.
    toUsd(amount, code){
      const n = parseFloat(amount); if (!isFinite(n)) return null;
      const c = String(code||'').toUpperCase();
      const r = rates[c] && (rates[c].USD || rates[c].usd);
      if (!r || !isFinite(r)) return null;
      return n * r;
    },
  };
})();

// ── SELF-STARTING REFRESH ────────────────────────────────────────────
// Independent of any React component. The AI sells around the clock with
// nothing mounted, so the rate table has to keep itself warm rather than
// wait for someone to open the payments panel. The first call often lands
// before sign-in completes and quietly fails; the interval picks it up, and
// ensure() covers anything that needs a rate before the next tick.
try {
  setTimeout(() => { try { CRYPTO_RATES_STORE.fetch(); } catch(_){} }, 1500);
  setInterval(() => { try { CRYPTO_RATES_STORE.fetch(); } catch(_){} }, 5*60*1000);
} catch(_){}

// Format a USD value for display next to a crypto amount.
const fmtUsd = (n) => {
  if (!isFinite(n) || n === null) return '';
  if (n >= 1000) return '$' + n.toLocaleString(undefined, {maximumFractionDigits:0});
  if (n >= 1)    return '$' + n.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  return '$' + n.toLocaleString(undefined, {maximumFractionDigits:4});
};

// React hook — subscribe to the rates store and re-render on update.
// Auto-fetches on first mount; refetches every 5 minutes while mounted.
const useCryptoRates = () => {
  const [, force] = React.useReducer(x => x+1, 0);
  React.useEffect(() => {
    const u = CRYPTO_RATES_STORE.sub(force);
    if (!CRYPTO_RATES_STORE.updatedAt) CRYPTO_RATES_STORE.fetch();
    const iv = setInterval(() => CRYPTO_RATES_STORE.fetch(), 5*60*1000);
    return () => { u(); clearInterval(iv); };
  }, []);
  return CRYPTO_RATES_STORE;
};
const coinKey = (raw) => {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/\s+/g,'').replace(/[()]/g,'');
  // Strip network prefixes: trc20/usdt → usdt, erc20/usdt → usdt, bep20/usdt → usdt
  const m = s.match(/(?:^|\/)(btc|eth|ltc|usdt|usdc|xmr|doge|sol|bch|trx|xrp|bnb|dai|matic|ada|dot)(?:$|\b)/);
  return m ? m[1] : null;
};
const fiatKey = (raw) => {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  return FIAT_META[s] ? s : null;
};

// ── coinKeyLoose ──────────────────────────────────────────────────────
// Free-text coin parser for AI-written preference values. `coinKey` above
// is intentionally strict (it runs on product names, where "Sol Package"
// must not become Solana) and it fails on values like "USDT (TRC20)"
// because stripping spaces glues the network onto the ticker. This one
// splits on any non-alphanumeric and accepts full coin names too.
const COIN_WORDS = {
  bitcoin:'btc', ethereum:'eth', ether:'eth', litecoin:'ltc', tether:'usdt',
  monero:'xmr', dogecoin:'doge', doge:'doge', solana:'sol', tron:'trx',
  ripple:'xrp', cardano:'ada', polkadot:'dot', polygon:'matic',
};
const coinKeyLoose = (raw) => {
  if (!raw) return null;
  const toks = String(raw).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of toks) {
    if (COIN_META[t]) return t;
    if (COIN_WORDS[t]) return COIN_WORDS[t];
  }
  return null;
};
// "LTC (declined)", "not USDT", "refuses ETH" — a coin mentioned in a
// negative sense must never be surfaced as the customer's preference.
const isNegativeCoinValue = (raw) => /declin|refus|reject|avoid|dislike|\bnot\b|\bno\b|won'?t|never/i.test(String(raw || ''));

// ── Language display ──────────────────────────────────────────────────
// The agent reports its reply language as BCP-47 (`pt-br`, `zh-cn`); the
// model may also record a free-text `profile.language` ("french"). We
// show one short, human name and keep the full detail in the tooltip.
const LANG_NAMES = {
  en:'English', es:'Spanish', pt:'Portuguese', fr:'French', de:'German', it:'Italian',
  nl:'Dutch', ru:'Russian', uk:'Ukrainian', pl:'Polish', tr:'Turkish', ar:'Arabic',
  fa:'Persian', he:'Hebrew', hi:'Hindi', ur:'Urdu', bn:'Bengali', zh:'Chinese',
  ja:'Japanese', ko:'Korean', vi:'Vietnamese', th:'Thai', id:'Indonesian', ms:'Malay',
  tl:'Filipino', sv:'Swedish', no:'Norwegian', da:'Danish', fi:'Finnish', el:'Greek',
  cs:'Czech', ro:'Romanian', hu:'Hungarian', bg:'Bulgarian', sr:'Serbian', hr:'Croatian',
  sw:'Swahili', yo:'Yoruba', ig:'Igbo', ha:'Hausa', am:'Amharic', zu:'Zulu', af:'Afrikaans',
};
const langNameToCode = (() => {
  const m = {};
  Object.entries(LANG_NAMES).forEach(([c, n]) => { m[n.toLowerCase()] = c; });
  return m;
})();
const languageInfo = (code, freeText) => {
  const raw = String(code || '').trim().toLowerCase();
  const valid = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(raw) ? raw : '';
  const text = String(freeText || '').trim();
  let base = valid ? valid.split('-')[0] : '';
  if (!base && text) {
    const t = text.toLowerCase();
    base = langNameToCode[t] || (/^[a-z]{2,3}$/.test(t) ? t : '');
  }
  let name = '';
  let full = '';
  try {
    if (base && typeof Intl !== 'undefined' && Intl.DisplayNames) {
      const dn = new Intl.DisplayNames(['en'], { type: 'language' });
      name = dn.of(base) || '';
      full = valid ? (dn.of(valid) || name) : name;
    }
  } catch (_) {}
  if (!name || name.toLowerCase() === base) name = LANG_NAMES[base] || '';
  if (!name && text) name = text.charAt(0).toUpperCase() + text.slice(1);
  if (!name) return null;
  return { code: base ? base.toUpperCase() : '', name, full: full || name, source: valid ? 'reply' : 'profile' };
};

// ── Notes: consolidation ──────────────────────────────────────────────
// Mirrors mem_note_* in api.php so the popup stays clean even for memory
// files written before the server learned to consolidate (and when the
// API is an older build). Notes on the same topic collapse into the most
// recent wording, carrying a count of how often the topic came up.
const NOTE_STOP = new Set((
  'a an the is are was were be been being am of in on at to and or with for from by as ' +
  'has have had they their them he she his her it its this that these those there here if but so ' +
  'than then about after before again still also just very really even despite without whether while ' +
  'when what which who not no any some more most much many lot lack user customer client buyer someone ' +
  'ask asks asked asking say said says mention mentioned express expressed expressing concern concerned ' +
  'concerns keep keeps kept repeat repeated repeatedly told tell strong strongly seem seems want wants ' +
  'wanted wanting twice two time times next try now'
).split(' '));
const NOTE_SYN = {
  refunds:'refund', refunded:'refund', refundable:'refund', refunding:'refund', moneyback:'refund', chargeback:'refund',
  satisfaction:'satisf', satisfied:'satisf', unsatisfied:'satisf', dissatisfied:'satisf', satisfy:'satisf', guarantee:'satisf', guaranteed:'satisf',
  test:'trial', tests:'trial', testing:'trial', tested:'trial', trial:'trial', sample:'trial', demo:'trial',
  prices:'price', pricing:'price', cost:'price', costs:'price', expensive:'price', cheap:'price', cheaper:'price', discount:'price',
  scam:'trust', legit:'trust', legitimate:'trust', trustworthy:'trust', fraud:'trust', sketchy:'trust',
  bitcoin:'btc', litecoin:'ltc', tether:'usdt', ethereum:'eth', monero:'xmr', dogecoin:'doge', solana:'sol',
  declined:'declin', declines:'declin', decline:'declin', refused:'declin', rejected:'declin',
  dislikes:'declin', dislike:'declin', refuses:'declin', rejects:'declin',
  prefers:'prefer', preferred:'prefer', preference:'prefer', like:'prefer', likes:'prefer', liked:'prefer',
  loves:'prefer', favours:'prefer', favors:'prefer',
};
const noteTokens = (s) => {
  const out = new Set();
  String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).forEach(w => {
    if (!w || w.length < 2 || NOTE_STOP.has(w)) return;
    if (NOTE_SYN[w]) w = NOTE_SYN[w];
    else if (w.length > 5) w = w.replace(/(ing|edly|ed|ly|es|s)$/, '');
    if (w && !NOTE_STOP.has(w)) out.add(w);
  });
  return out;
};
const noteSimilarity = (a, b) => {
  if (!a.size || !b.size) return 0;
  if (a.has('declin') !== b.has('declin')) return 0;
  let inter = 0;
  a.forEach(k => { if (b.has(k)) inter++; });
  if (inter < 2) return (inter === 1 && a.size === 1 && b.size === 1) ? 1 : 0;
  if (inter / Math.max(a.size, b.size) < 0.4) return 0;
  return inter / Math.min(a.size, b.size);
};
// Severity ranks the list: 2 = needs attention, 1 = transactional detail,
// 0 = background colour. Only severity 2 gets a text label — the dot
// colour carries the rest so rows stay quiet.
const noteCategory = (txt) => {
  const t = String(txt || '').toLowerCase();
  // ── WHO the note is about matters as much as the word in it ──────────
  // These used to be bare substring tests, so a customer asking "is this
  // legit, I don't want to get scammed" was filed as a red FLAG (the word
  // "scam"), "asked about the refund policy" as a REFUND request and "no
  // rush, not urgent" as URGENT. A flag is supposed to say something is
  // wrong with THIS customer or THIS order; a worry, a policy question or a
  // negation is ordinary pre-sale conversation and is filed as such.
  const worry = /\b(?:worr\w*|concern\w*|afraid|nervous|scared|cautious|wary|sceptic\w*|skeptic\w*|unsure|doubt\w*|hesitan\w*|trust\w*|legit\w*|reassur\w*|make sure|want\w* to know|wonder\w*|asked (?:if|whether|about)|asks? (?:if|whether|about)|checking (?:if|whether)|is (?:it|this|that) (?:a )?(?:scam|legit|safe|real))\b/;
  const negated = (re) => new RegExp(String.raw`\b(?:not|no|never|isn'?t|wasn'?t|without|non)[\s-]+(?:\w+\s+){0,2}?(?:${re})`).test(t);
  // Genuine red flags: the customer (or the order) is the risk.
  const hardFlag = /\b(?:chargebacks?|charged back|disput\w*|threat\w*|lawyer|legal action|sue|suing|police|report(?:ed|ing)? (?:us|you|the (?:shop|store|seller))|abus\w*|harass\w*|insult\w*|fake (?:payment|proof|screenshot|tx|transaction)|forged|stolen card|blacklist\w*)\b/;
  const fraudWord = /\b(?:fraud\w*|scam\w*|scammer\w*)\b/;
  if (hardFlag.test(t) || (fraudWord.test(t) && !worry.test(t) && !negated('fraud\\w*|scam\\w*')))
    return { key:'flag', label:'Flag', sev:2, col:'#d99089' };
  // Worried about being scammed: worth knowing, not a red flag.
  if (fraudWord.test(t)) return { key:'trust', label:null, sev:1, col:'#9b95d4' };
  // Upset — needs a human's attention, but it isn't a red flag.
  if (/\b(?:angry|furious|upset|frustrat\w*|annoyed|livid|rude|hostile|unhappy|dissatisf\w*)\b/.test(t) && !negated('angry|upset|unhappy|frustrat\\w*'))
    return { key:'upset', label:'Upset', sev:2, col:'#d49270' };
  // ("Escalated" is not listed: the hand-over has its own separator, so a
  // note restating it would only draw the same event twice.)
  if (/\b(?:urgent\w*|asap|emergenc\w*|critical)\b/.test(t)
      && !negated('urgent\\w*|critical|emergenc\\w*') && !/\bno (?:rush|hurry)\b/.test(t))
    return { key:'urgent', label:'Urgent', sev:2, col:'#d49270' };
  // A refund is only a flag when one is actually being asked for. "Asked
  // about the refund policy" is a pre-sale question.
  if (/\brefund/.test(t)) {
    const policy = /\brefund\w*\s+(?:policy|policies|terms|guarantee|option\w*|rules?)\b|\b(?:policy|guarantee)\b/.test(t) || worry.test(t);
    const asking = /\b(?:wants?|wanted|want\w*|request\w*|demand\w*|asking for|asked for|asks for|needs?|expect\w*|get)\s+(?:\w+\s+){0,2}?(?:a\s+|the\s+|their\s+|his\s+|her\s+|my\s+)?(?:full\s+|partial\s+)?refund|\brefund\s+(?:request\w*|me|them|him|her)\b|\bmoney back\b/.test(t);
    if (asking || !policy) return { key:'refund', label:'Refund', sev:2, col:'#d9a86a' };
    return { key:'refund-q', label:null, sev:1, col:'#d9a86a' };
  }
  if (/\b(?:complain\w*)\b/.test(t)) return { key:'complaint', label:null, sev:1, col:'#d49270' };
  if (/\b(?:wallet|address|paid|payment|invoice|coin|btc|eth|ltc|xmr|usdt|trc20|erc20)\b/.test(t))
    return { key:'payment', label:null, sev:1, col:'#7fb4f0' };
  if (/\b(?:e-?mail|phone|contact|telegram|discord|whatsapp|signal)\b/.test(t))
    return { key:'contact', label:null, sev:1, col:'#9b95d4' };
  if (/\b(?:loyal|repeat customer|happy|positive|thanks|thank you|grateful)\b/.test(t))
    return { key:'positive', label:null, sev:0, col:'#7eb89a' };
  return { key:'general', label:null, sev:0, col:'rgba(178,184,196,0.55)' };
};
// raw: strings (legacy, oldest → newest) or {n,t,u,x} records, in any order.
// Returns records sorted newest-first, topic-consolidated, capped.
// Anchors: the customer messages a note is evidenced by, as recorded by
// the server — [{id, ts, q}] where q is the start of the message text.
const normNoteAnchors = (m) => {
  if (!Array.isArray(m)) return [];
  const byKey = new Map();
  m.forEach(a => {
    if (!a || typeof a !== 'object') return;
    const id = Number(a.id || 0), ts = Number(a.ts || 0), q = String(a.q || '');
    if (id <= 0 && ts <= 0) return;
    byKey.set(id > 0 ? `i${id}` : `t${ts}|${q}`, { id, ts, q });
  });
  return [...byKey.values()].sort((a, b) => (a.ts - b.ts) || (a.id - b.id));
};
// raw: strings (legacy, oldest → newest) or {n,t,u,m} records, in any order.
// Returns records sorted newest-first, topic-consolidated, capped.
//
// COUNT: `mentions` is the number of DISTINCT customer messages anchored to
// the note — never a tally of how often the AI wrote it. A record with no
// anchors (legacy, or written before anchoring existed) counts as 1, even
// if an older build stored an inflated `x`.
const consolidateNotes = (raw, { cap = 12, nowMs = Date.now(), ttlMs = 30 * 86400_000 } = {}) => {
  const list = Array.isArray(raw) ? raw : [];
  const recs = list.map((n, i) => {
    const obj = n && typeof n === 'object';
    const text = obj ? String(n.n || n.text || n.note || '').trim() : String(n || '').trim();
    if (!text) return null;
    const t = obj ? Number(n.t || 0) : 0;
    const u = obj ? Number(n.u || n.t || 0) : 0;
    // `l` = server estimated the time from a legacy string: fine for
    // ordering and expiry, but not precise enough to print or jump to.
    const estimated = !!(obj && n.l);
    const anchors = obj ? normNoteAnchors(n.m) : [];
    // Wording anchor: the customer message the CURRENT wording was written
    // against (server `wi`/`wt`). The chat draws the note there, so a note
    // that later learns something new moves to where it learned it instead
    // of rewriting a separator further up the thread.
    const wi = obj ? Number(n.wi || 0) : 0;
    const wt = obj ? Number(n.wt || 0) : 0;
    return { text, t, u, anchors, wi, wt, estimated, order: u > 0 ? u : (i - list.length) };
  }).filter(Boolean)
    .filter(r => !(r.u > 0) || (nowMs - r.u) < ttlMs)
    .sort((a, b) => b.order - a.order);
  const kept = [];
  recs.forEach(r => {
    const tok = noteTokens(r.text);
    if (!tok.size) return;
    let best = -1, bestScore = 0;
    kept.forEach((k, i) => { const sc = noteSimilarity(tok, k.tok); if (sc > bestScore) { bestScore = sc; best = i; } });
    if (best >= 0 && bestScore >= 0.6) {
      kept[best].anchors = normNoteAnchors([...kept[best].anchors, ...r.anchors]);
      if (r.t && (!kept[best].t || r.t < kept[best].t)) kept[best].t = r.t;
      return;
    }
    kept.push({ ...r, tok, cat: noteCategory(r.text) });
  });
  return kept.slice(0, cap).map(k => {
    const last = k.anchors[k.anchors.length - 1] || null;
    return {
      ...k,
      mentions: Math.max(1, k.anchors.length),
      // What the time label shows and what "jump" targets: the customer's
      // most recent message about this, when known. Otherwise the moment
      // the note was first written (just after the message that caused it).
      shownTs: last ? last.ts : (k.estimated ? 0 : k.t),
      dated: !!(last ? last.ts : (!k.estimated && k.t > 0)),
    };
  });
};

// Render free text with coin tickers highlighted in their coin colour
// ("prefers LTC over BTC"). Used for interest notes.
const renderNoteInline = (txt) => {
  if (!txt) return null;
  const re = /\b(btc|eth|ltc|usdt|usdc|xmr|doge|sol|bch|trx|xrp|bnb|dai|matic|ada|dot)\b/gi;
  const parts = []; let lastIdx = 0; let m2;
  while ((m2 = re.exec(txt)) !== null) {
    if (m2.index > lastIdx) parts.push(txt.slice(lastIdx, m2.index));
    const code = m2[1].toLowerCase(); const meta = COIN_META[code];
    parts.push(<span key={m2.index} style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:'0.92em',color:meta?meta.col:'rgba(200,205,215,0.85)',letterSpacing:'0.02em',padding:'0 1px'}}>{m2[1].toUpperCase()}</span>);
    lastIdx = m2.index + m2[0].length;
  }
  if (lastIdx < txt.length) parts.push(txt.slice(lastIdx));
  return parts.length ? parts : txt;
};

// Card container for list sections in the profile popup. Module-level so
// React sees the same component type across renders (see ListSection).
const EuListSection = ({children}) => (
  <div style={{
    margin:'0 12px 8px',
    background:'rgba(255,255,255,0.014)',
    border:'1px solid rgba(255,255,255,0.048)',
    borderRadius:12,
    overflow:'hidden',
    backdropFilter:'blur(4px)',
    WebkitBackdropFilter:'blur(4px)',
  }}>{children}</div>
);

// ── ExpandableText ────────────────────────────────────────────────────
// Title + optional body that clamp to a few lines and expand in place.
// Used by Active Interests and Chapters, where AI-written text used to be
// cut off with no way to read the rest.
//   • Measures real overflow (ResizeObserver), so the "More" control only
//     appears when something is actually hidden — short rows stay clean.
//   • Expands/collapses with a measured height transition (no jump).
//   • The toggle stops propagation, so it can live inside a clickable row
//     (a chapter row still jumps to the chat when clicked elsewhere).
//   • clickToExpand: clicking the text itself toggles too — for rows that
//     have no other click action.
// Props: title, body (nodes), titleLines, bodyLines, titleStyle, bodyStyle,
//        titleAside (node right of title), meta (node in footer row),
//        clickToExpand, gap.
const ExpandableText = ({
  title, body, titleLines = 1, bodyLines = 2,
  titleStyle, bodyStyle, titleAside, meta, clickToExpand = false, gap = 2,
}) => {
  const [open, setOpen] = React.useState(false);
  const [clamped, setClamped] = React.useState(false);
  const wrapRef  = React.useRef(null);
  const titleRef = React.useRef(null);
  const bodyRef  = React.useRef(null);
  const fromH    = React.useRef(null);

  // Overflow detection — only meaningful while collapsed.
  React.useLayoutEffect(() => {
    if (open) return;
    const check = () => {
      const over = [titleRef.current, bodyRef.current].some(el =>
        el && (el.scrollHeight - el.clientHeight > 1));
      setClamped(prev => prev === over ? prev : over);
    };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    [titleRef.current, bodyRef.current].forEach(el => el && ro.observe(el));
    return () => ro.disconnect();
  }, [open, title, body]);

  // Height animation between the clamped and full layouts.
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || fromH.current == null) return;
    const from = fromH.current;
    fromH.current = null;
    el.style.height = 'auto';
    const to = el.offsetHeight;
    if (Math.abs(to - from) < 1) { el.style.height = ''; return; }
    el.style.height = from + 'px';
    void el.offsetHeight;                       // commit the start height
    el.style.transition = 'height 0.22s cubic-bezier(0.4,0,0.2,1)';
    el.style.height = to + 'px';
    const done = () => {
      el.style.height = ''; el.style.transition = '';
      el.removeEventListener('transitionend', done);
    };
    el.addEventListener('transitionend', done);
    const t = setTimeout(done, 320);
    return () => clearTimeout(t);
  }, [open]);

  const toggle = (e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (wrapRef.current) fromH.current = wrapRef.current.offsetHeight;
    setOpen(o => !o);
  };
  const clampStyle = (lines) => open ? { whiteSpace:'normal' } : {
    display:'-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient:'vertical', overflow:'hidden',
  };
  const canToggle = open || clamped;
  const showFooter = canToggle || meta;

  return (
    <div ref={wrapRef} style={{minWidth:0, overflow:'hidden'}}
      onClick={clickToExpand && canToggle ? toggle : undefined}>
      <div style={{display:'flex', alignItems:'flex-start', gap:8, minWidth:0}}>
        <div ref={titleRef} style={{flex:1, minWidth:0, wordBreak:'break-word', ...clampStyle(titleLines), ...titleStyle}}>
          {title}
        </div>
        {titleAside}
      </div>
      {body ? (
        <div ref={bodyRef} style={{marginTop:gap, wordBreak:'break-word', ...clampStyle(bodyLines), ...bodyStyle}}>
          {body}
        </div>
      ) : null}
      {showFooter && (
        <div style={{display:'flex', alignItems:'center', gap:8, marginTop:4, minHeight:14}}>
          <div style={{flex:1, minWidth:0}}>{meta}</div>
          {canToggle && (
            <button type="button" onClick={toggle}
              aria-expanded={open}
              style={{
                all:'unset', cursor:'pointer', flexShrink:0,
                display:'inline-flex', alignItems:'center', gap:3,
                fontSize:10.5, fontWeight:500, lineHeight:1,
                color:'rgba(160,168,180,0.78)', padding:'2px 0',
                transition:'color 0.12s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'rgba(235,236,244,0.92)'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(160,168,180,0.78)'}>
              {open ? 'Less' : 'More'}
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                style={{transform: open ? 'rotate(180deg)' : 'none', transition:'transform 0.2s ease'}}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ── TraitChip ─────────────────────────────────────────────────────────
// One quiet fact about the customer under their name: preferred coin,
// language, location. Fixed 22px height, single line, truncates instead
// of wrapping so the strip never grows a ragged second row of half-chips.
const TraitChip = ({ lead, label, title, color, tone }) => (
  <span title={title} style={{
    display:'inline-flex', alignItems:'center', gap:6,
    height:22, padding:'0 8px 0 4px', borderRadius:11,
    maxWidth:'100%', minWidth:0, boxSizing:'border-box',
    background: tone === 'muted' ? 'rgba(127,180,240,0.07)' : 'rgba(255,255,255,0.045)',
    border: `1px solid ${tone === 'muted' ? 'rgba(127,180,240,0.20)' : 'rgba(255,255,255,0.075)'}`,
    fontSize:11, fontWeight:500, lineHeight:1, letterSpacing:'-0.005em',
    color: color || 'rgba(225,229,236,0.88)', whiteSpace:'nowrap', flexShrink:1,
  }}>
    <span style={{display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>{lead}</span>
    <span style={{overflow:'hidden', textOverflow:'ellipsis', minWidth:0}}>{label}</span>
  </span>
);
const TraitMonogram = ({ text }) => (
  <span style={{
    width:14, height:14, borderRadius:7, flexShrink:0,
    display:'inline-flex', alignItems:'center', justifyContent:'center',
    background:'rgba(255,255,255,0.08)', color:'rgba(210,216,226,0.85)',
    fontSize:7.5, fontWeight:700, letterSpacing:'0.02em', lineHeight:1,
    fontFamily:'var(--mono)',
  }}>{text}</span>
);
// Stable colour for an interest-status pill — exported as a util so the
// rail mini-dot can use the same palette as the expanded interest rows.
// Subtler dark tones — borders/backgrounds use lower opacity so chips
// blend into the surface instead of competing with content. Greens are
// muted sage/emerald (not lime) so completed/active states feel
// professional rather than neon. Considering/refunded share a soft amber.
const STATUS_PALETTE = {
  asked:       {c:'#7fb4f0', bg:'rgba(51,144,236,0.07)',  bd:'rgba(51,144,236,0.18)'},
  shown:       {c:'#8dd3f5', bg:'rgba(50,173,230,0.07)',  bd:'rgba(50,173,230,0.18)'},
  considering: {c:'#d9a86a', bg:'rgba(217,168,106,0.07)', bd:'rgba(217,168,106,0.20)'},
  declined:    {c:'#d99089', bg:'rgba(217,144,137,0.06)', bd:'rgba(217,144,137,0.18)'},
  purchased:   {c:'#7eb89a', bg:'rgba(126,184,154,0.07)', bd:'rgba(126,184,154,0.20)'},
  active:      {c:'#7eb89a', bg:'rgba(126,184,154,0.07)', bd:'rgba(126,184,154,0.20)'},
  completed:   {c:'#7eb89a', bg:'rgba(126,184,154,0.07)', bd:'rgba(126,184,154,0.20)'},
  pending:     {c:'#8dd3f5', bg:'rgba(50,173,230,0.07)',  bd:'rgba(50,173,230,0.20)'},
  refunded:    {c:'#d9a86a', bg:'rgba(217,168,106,0.07)', bd:'rgba(217,168,106,0.20)'},
  failed:      {c:'#d99089', bg:'rgba(217,144,137,0.06)', bd:'rgba(217,144,137,0.18)'},
  escalated:   {c:'#d49270', bg:'rgba(212,146,112,0.08)', bd:'rgba(212,146,112,0.22)'},
};
// Activity-signal humaniser — turns "c:declined:ltc" into a structured
// record the UI can render. Signals may be plain strings (legacy) or
// objects {s:string, t:number} where `t` is a unix-ms timestamp captured
// at log-time so the panel can sort and show "2m ago". The structured
// form is preferred — see CRM HYGIENE in api.php.
const humaniseSignal = (raw) => {
  // Accept {s,t} objects or plain strings.
  let s, ts = 0;
  if (raw && typeof raw === 'object' && 's' in raw) { s = String(raw.s||''); ts = Number(raw.t||0); }
  else { s = String(raw||''); }
  s = s.trim(); if (!s) return null;
  const parts = s.split(':').map(x => x.trim()).filter(Boolean);
  const head = (parts[0] || '').toLowerCase();
  const coin = coinKey(parts[parts.length-1]);
  // Group lookup — each prefix maps to a top-level meaning, a colour
  // family (subtle, matches STATUS_PALETTE tones), and a glyph.
  const PREFIX = {
    q:    {label:'Asked',      icon:'?', col:'#8dd3f5', bg:'rgba(50,173,230,0.06)',  bd:'rgba(50,173,230,0.18)', group:'question'},
    p:    {label:'Intent',     icon:'↗', col:'#7fb4f0', bg:'rgba(51,144,236,0.06)',  bd:'rgba(51,144,236,0.18)', group:'product'},
    c:    {label:'Picked',     icon:'◉', col:'#7fb4f0', bg:'rgba(51,144,236,0.06)',  bd:'rgba(51,144,236,0.18)', group:'choice'},
    a:    {label:'Action',     icon:'✓', col:'#7ed99a', bg:'rgba(48,209,88,0.06)',   bd:'rgba(48,209,88,0.18)',  group:'action'},
    obj:  {label:'Objection',  icon:'!', col:'#f08c84', bg:'rgba(255,69,58,0.06)',   bd:'rgba(255,69,58,0.18)',  group:'objection'},
    flag: {label:'Flag',       icon:'⚑', col:'#f08c84', bg:'rgba(255,69,58,0.06)',   bd:'rgba(255,69,58,0.18)',  group:'flag'},
    esc:  {label:'Escalated',  icon:'▲', col:'#f5a878', bg:'rgba(255,120,40,0.08)',  bd:'rgba(255,120,40,0.24)', group:'escalation'},
  };
  const SUBLABEL = {
    declined:'Declined', picked:'Picked', buy_intent:'Buy intent',
    greeting:'Greeted', shown:'Shown', considering:'Considering',
    confirmed:'Confirmed', refund:'Refund req.', help:'Help req.',
    cancel:'Cancel req.', price:'Price', trust:'Trust', scam:'Scam',
  };
  let label = (PREFIX[head] || {label:s}).label;
  let style = PREFIX[head] || {col:'#7d8b96', bg:'rgba(255,255,255,0.03)', bd:'rgba(255,255,255,0.07)', icon:'·', group:'misc'};
  let detail = '';
  if (parts.length >= 2) {
    const mid = parts[1].toLowerCase();
    if (SUBLABEL[mid]) label = SUBLABEL[mid];
    if (parts.length >= 3) detail = (coin ? coin.toUpperCase() : parts.slice(2).join(' '));
    else if (coin && mid !== coin) detail = coin.toUpperCase();
    else if (coin && mid === coin) detail = coin.toUpperCase();
  }
  return { label, detail, coin, raw:s, ts, ...style };
};
// Crypto / fiat row chip (24px circle with monogram). Falls back to a
// neutral pill for unknown currencies.
const CoinChip = ({code, size=22}) => {
  if (!code) return null;
  const key = String(code).toLowerCase();
  const meta = COIN_META[key] || (FIAT_META[key] && {...FIAT_META[key], tint:'rgba(125,139,150,0.10)', bd:'rgba(125,139,150,0.24)'});
  if (!meta) {
    return (
      <div style={{
        width:size, height:size, borderRadius:'50%', flexShrink:0,
        display:'flex', alignItems:'center', justifyContent:'center',
        background:'rgba(125,139,150,0.10)', border:'1px solid rgba(125,139,150,0.24)',
        color:'#7d8b96', fontSize: size*0.5, fontWeight:700, fontFamily:'var(--mono)',
        letterSpacing:'-0.02em',
      }}>{String(code).slice(0,1).toUpperCase()}</div>
    );
  }
  return (
    <div title={meta.name} style={{
      width:size, height:size, borderRadius:'50%', flexShrink:0,
      display:'flex', alignItems:'center', justifyContent:'center',
      background:meta.tint, border:`1px solid ${meta.bd}`,
      color:meta.col, fontSize: Math.max(8.5, size*0.55), fontWeight:700, fontFamily:'var(--mono)',
      letterSpacing:'-0.02em', lineHeight:1,
    }}>{meta.sym}</div>
  );
};

// ── BioCard ─────────────────────────────────────────────────────────────
// Customer self-description container. Subtle inset surface with a soft
// "BIO" caption + decorative quote glyph, so the operator instantly
// understands this text is FROM the customer (not metadata our system
// captured). Long bios collapse to two lines with an inline 'more' toggle.
const BioCard = ({bio, status, accent, sub, divider}) => {
  const [expanded, setExpanded] = React.useState(false);
  const [overflows, setOverflows] = React.useState(false);
  const textRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const el = textRef.current; if (!el) return;
    // Compare the clamped scroll height against the visible client height
    // when collapsed; if the content is taller, we need a "more" toggle.
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [bio]);
  return (
    <div style={{
      position:'relative',
      padding:'9px 11px 9px 32px',
      borderRadius:10,
      background:'rgba(255,255,255,0.025)',
      border:`1px solid ${divider}`,
      boxShadow:'inset 0 1px 0 rgba(255,255,255,0.025)',
    }}>
      {/* Decorative quote glyph */}
      <span aria-hidden="true" style={{
        position:'absolute', top:6, left:9,
        fontFamily:'Georgia, "Times New Roman", serif',
        fontSize:24, lineHeight:1, color:accent,
        opacity:0.35, fontWeight:700, userSelect:'none',
        pointerEvents:'none',
      }}>“</span>

      {/* Caption row: "BIO" label + optional inline platform status dot */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        gap:6, marginBottom:3, minHeight:11,
      }}>
        <span style={{
          fontSize:9, fontWeight:700, color:sub,
          letterSpacing:'0.09em', textTransform:'uppercase',
        }}>Bio</span>
        {status && (
          <span style={{
            display:'inline-flex', alignItems:'center', gap:4,
            fontSize:9.5, color:accent, fontWeight:500, letterSpacing:'-0.005em',
          }}>
            <span style={{width:4, height:4, borderRadius:'50%', background:accent, flexShrink:0}}/>
            {status}
          </span>
        )}
      </div>

      {/* Bio text — clamped to 2 lines unless expanded */}
      <div ref={textRef} style={{
        fontSize:12, color:'rgba(255,255,255,0.82)',
        letterSpacing:'-0.005em', lineHeight:1.42,
        wordBreak:'break-word', whiteSpace:'pre-wrap', userSelect:'text',
        display: expanded ? 'block' : '-webkit-box',
        WebkitLineClamp: expanded ? 'unset' : 2,
        WebkitBoxOrient:'vertical', overflow:'hidden',
      }}>{bio}</div>

      {/* More / less toggle — only when content actually overflows */}
      {overflows && (
        <button
          onClick={()=>setExpanded(x=>!x)}
          style={{
            background:'transparent', border:'none', padding:'2px 0 0',
            fontSize:10.5, fontWeight:600, color:accent, cursor:'pointer',
            letterSpacing:'-0.005em',
          }}
          onMouseEnter={e=>e.currentTarget.style.opacity='0.8'}
          onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
};

// ── CollapsibleSection ────────────────────────────────────────────────
// Stable, top-level component used for the expand/collapse rows in the
// customer-info panel (Recent activity, Notes). Defined OUTSIDE
// EndUserPipelinePanel so React preserves DOM identity across renders
// of the parent — this is what makes the click target reliably register
// the toggle and the height transition animate smoothly.
//
//   - Header is a real <button> (keyboard-accessible, can't be missed by
//     React reconciliation).
//   - Body uses the `grid-template-rows: 0fr ↔ 1fr` trick so we get a
//     pure CSS height transition without measuring children.
const CollapsibleSection = React.memo(function CollapsibleSection({
  open, onToggle, title, right, children, sub, text, chevIcon,
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        style={{
          all:'unset', boxSizing:'border-box',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          width:'auto', margin:'2px 12px 0', padding:'8px 10px',
          fontSize:10, fontWeight:600, color:sub,
          letterSpacing:'0.06em', textTransform:'uppercase',
          borderRadius:7, cursor:'pointer', userSelect:'none',
          transition:'background 0.12s, color 0.12s',
        }}
        onMouseEnter={(e)=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.color=text;}}
        onMouseLeave={(e)=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color=sub;}}>
        <span style={{display:'inline-flex', alignItems:'center', gap:7}}>
          <span style={{
            display:'inline-flex',
            transition:'transform 0.2s cubic-bezier(0.4,0,0.2,1)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            opacity: 0.9,
          }}>{chevIcon}</span>
          {title}
        </span>
        {right}
      </button>
      <div style={{
        display:'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        transition:'grid-template-rows 0.24s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{minHeight:0, overflow:'hidden'}}>{children}</div>
      </div>
    </>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// CUSTOMER RECORD IN THE CHAT
// ═══════════════════════════════════════════════════════════════════════
// The floating profile popup is gone. What it showed now lives where it
// happened:
//
//   useEndUserRecord      — the get_end_user record for one conversation,
//                           cached (EU_CACHE) and kept live while the chat
//                           is open.
//   buildChatMoments      — turns chapters, interests, notes, payments,
//                           settled invoices, escalations and "AI unassigned"
//                           into moments, each pinned to the exact gap
//                           between bubbles it belongs to (by message id
//                           first, then text, then server-time).
//   ChatMomentRow         — the quiet separator lines rendered in that gap.
//                           One line each, truncated; hover shows the rest.
//   InvoiceFollowers      — open invoices, following the newest message until
//                           they settle, then sticking where that happened.
//   ChatSummaryHover      — the AI summary card shown beside the header
//                           identity pill on hover.
//   setCustomerMark       — "Mark as customer" from the contact list's
//                           right-click menu (verified flag + Customers group).
//   resolveConversationEscalation — "Resolve & resume AI", used by the
//                           escalation moment and the right-click menu.
// ═══════════════════════════════════════════════════════════════════════

const euIsDemo = () => {
  try { return !!(AUTH_STORE.account && AUTH_STORE.account.email === 'demo@botcommand.app'); }
  catch (_) { return false; }
};

// Server timestamps arrive as epoch ms, ISO strings, or MySQL DATETIME
// ("YYYY-MM-DD HH:MM:SS", stored UTC). Returns epoch ms or 0.
const euParseTs = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (/^\d+$/.test(s)) return +s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const t = new Date(s).getTime();
  return isFinite(t) ? t : 0;
};

const euAgo = (ts, now = Date.now()) => {
  if (!ts) return '';
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);        if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);        if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month:'short', day:'numeric' });
};

const euSpan = (a, b) => {
  if (!a || !b || b <= a) return '';
  const sec = Math.round((b - a) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60); if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);   if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

// ── useEndUserRecord ──────────────────────────────────────────────────
// One conversation's customer record. Instant first paint from EU_CACHE,
// then a background refresh; re-fetches when the conversation row changes
// (the AI writes chapters/notes/interests right after its turn), when the
// tab becomes visible again, on a slow poll, and when anything dispatches
// 'bc-eu-refresh' for this conversation.
const useEndUserRecord = (convId) => {
  const demo = euIsDemo();
  const [data, setData] = React.useState(() =>
    !convId ? null : (demo ? DEMO_END_USER_DATA : EU_CACHE.get(convId)));
  // Conversation switch — reseed from cache during render, so the first
  // commit of the new chat never carries the previous contact's record
  // (a passive effect ran after paint, which flashed old moments).
  const [boundConv, setBoundConv] = React.useState(convId);
  if (boundConv !== convId) {
    setBoundConv(convId);
    setData(!convId ? null : (demo ? DEMO_END_USER_DATA : (EU_CACHE.get(convId) || null)));
  }
  const inflightRef  = React.useRef(null);
  const lastFetchRef = React.useRef(0);
  const convRef      = React.useRef(convId);
  convRef.current = convId;

  const reload = React.useCallback((opts = {}) => {
    if (!convId) return Promise.resolve(null);
    if (demo) { setData(DEMO_END_USER_DATA); return Promise.resolve(DEMO_END_USER_DATA); }
    const now = Date.now();
    if (!opts.force && (now - lastFetchRef.current) < 800) return Promise.resolve(null);
    if (inflightRef.current && !opts.force) return inflightRef.current;
    lastFetchRef.current = now;
    const forConv = convId;
    const sentAt = Date.now();
    const p = apiGet('get_end_user', `&conv_id=${encodeURIComponent(forConv)}`).then(res => {
      if (inflightRef.current === p) inflightRef.current = null;
      if (res && res.server_now_ms) {
        euNoteServerClock(res.server_now_ms, sentAt, Date.now());
        // Changes on every call — kept out of the cache so an unchanged
        // record still compares equal and doesn't re-render the chat.
        delete res.server_now_ms;
      }
      if (res && !res.error) {
        // set() returns false when the record is identical to the cache; in
        // that case the state already holds it and a re-render buys nothing.
        const changed = EU_CACHE.set(forConv, res);
        if (convRef.current === forConv && (changed || !EU_CACHE.get(forConv))) {
          setData(EU_CACHE.get(forConv) || res);
        }
        if (res.end_user) {
          BLOCK_STORE.set(forConv, {
            blocked: !!Number(res.end_user.is_blocked),
            muted:   !!Number(res.end_user.is_muted),
          });
        }
      }
      return res;
    }).catch(err => {
      if (inflightRef.current === p) inflightRef.current = null;
      console.warn('[end-user record]', err && err.message);
      return null;
    });
    inflightRef.current = p;
    return p;
  }, [convId, demo]);

  // Conversation switch — reseed from cache (never show the previous
  // contact's record for a frame), then refresh.
  React.useEffect(() => {
    if (!convId) return;
    if (demo) setData(DEMO_END_USER_DATA);
    inflightRef.current = null;
    reload({ force: true });
  }, [convId, demo, reload]);

  React.useEffect(() => {
    if (!convId || demo) return;
    return EU_CACHE.sub(convId, (next) => { if (next && convRef.current === convId) setData(next); });
  }, [convId, demo]);

  // Conversation-row changes. Debounced: the memory patch lands a beat
  // after the reply that produced it.
  React.useEffect(() => {
    if (!convId || demo || typeof MSGS_STORE === 'undefined' || !MSGS_STORE.sub) return;
    const fp = (c) => c ? [c.since || c._lastInboundAt || 0, c.last || '', c.ai || '',
      c.stage || '', c.escalated ? 1 : 0, c.agent_id || ''].join('|') : '';
    let last = fp(MSGS_STORE.list && MSGS_STORE.list.find(m => m.id === convId));
    let t = null;
    const unsub = MSGS_STORE.sub(() => {
      const c = MSGS_STORE.list && MSGS_STORE.list.find(m => m.id === convId);
      const next = fp(c);
      if (!c || next === last) return;
      last = next;
      clearTimeout(t);
      t = setTimeout(() => reload(), 1500);
    });
    return () => { clearTimeout(t); unsub && unsub(); };
  }, [convId, demo, reload]);

  // Slow poll while visible + explicit refresh requests.
  React.useEffect(() => {
    if (!convId || demo) return;
    let iv = null;
    const start = () => { if (!iv) iv = setInterval(() => reload(), 15000); };
    const stop  = () => { if (iv) { clearInterval(iv); iv = null; } };
    const onVis = () => { if (document.hidden) stop(); else { start(); reload({ force: true }); } };
    const onAsk = (e) => { if (e && e.detail && e.detail.convId === convId) reload({ force: true }); };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('bc-eu-refresh', onAsk);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('bc-eu-refresh', onAsk);
    };
  }, [convId, demo, reload]);

  return { data, reload };
};

const requestEndUserRefresh = (convId) => {
  try { window.dispatchEvent(new CustomEvent('bc-eu-refresh', { detail: { convId } })); } catch (_) {}
};

// ── Server clock ──────────────────────────────────────────────────────
// Separators are placed by comparing stamps from two clocks: the server
// (history, chapters, notes, escalations, transactions) and this browser
// (live bubbles, invoices, a just-made unassign). get_end_user reports the
// server's time; the sample with the shortest round-trip wins, so the
// estimate is within half a network hop. Everything is compared in
// SERVER time: browser stamps get `skew` added.
const EU_CLOCK = { skew: 0, rtt: Infinity, at: 0 };
const euNoteServerClock = (serverNowMs, sentAt, recvAt) => {
  const s = Number(serverNowMs);
  if (!isFinite(s) || s <= 0 || !sentAt || !recvAt) return;
  const rtt = Math.max(0, recvAt - sentAt);
  // A better (faster) sample always wins; an old one is replaced after 10 min
  // so a laptop clock that drifted or was corrected doesn't stay wrong.
  if (rtt <= EU_CLOCK.rtt || (recvAt - EU_CLOCK.at) > 600000) {
    EU_CLOCK.skew = Math.round(s - (sentAt + rtt / 2));
    EU_CLOCK.rtt = rtt;
    EU_CLOCK.at = recvAt;
  }
};
const euServerTime = (browserMs) => browserMs ? browserMs + EU_CLOCK.skew : 0;

// ── Moment tones ──────────────────────────────────────────────────────
// Same muted family the chapter glyphs and note categories used in the
// old panel, so the colours an operator learned still mean the same.
const MOMENT_INK = {
  topic:       'rgba(150,170,195,0.9)',
  question:    'rgba(141,180,210,0.95)',
  objection:   'rgba(222,150,140,0.95)',
  decision:    'rgba(146,200,160,0.95)',
  payment:     'rgba(170,164,225,0.95)',
  escalation:  'rgba(226,156,118,0.95)',
  resolution:  'rgba(126,190,156,0.95)',
  asked:       'rgba(150,170,195,0.9)',
  shown:       'rgba(150,170,195,0.9)',
  considering: 'rgba(120,176,240,0.95)',
  declined:    'rgba(222,150,140,0.9)',
  purchased:   'rgba(126,190,156,0.95)',
  paid:        'rgba(126,190,156,0.95)',
  pending:     'rgba(224,176,110,0.95)',
  detected:    'rgba(120,176,240,0.95)',
  failed:      'rgba(222,150,140,0.95)',
  muted:       'rgba(160,164,182,0.7)',
  note:        'rgba(178,184,198,0.75)',
  agent:       'rgba(170,164,225,0.9)',
};

const CHAPTER_META = {
  topic:'Topic', question:'Question', objection:'Objection', decision:'Decision',
  payment:'Payment', escalation:'Escalation', resolution:'Resolved',
};
const INTEREST_META = {
  asked:'Asked about', shown:'Shown', considering:'Considering', declined:'Passed on', purchased:'Bought',
};
// How much a moment matters — decides which lines stay visible when a gap
// between two bubbles collects more than fits.
const INTEREST_RANK = { purchased:66, considering:55, declined:50, shown:30, asked:28 };
const CHAPTER_RANK  = { objection:72, escalation:72, decision:70, payment:70, resolution:64, question:62, topic:60 };

// ── Anchoring ─────────────────────────────────────────────────────────
// A moment belongs to a BOUNDARY between bubbles: boundary b renders
// directly above thread[b]; boundary thread.length is below the last one.
//
// Order of trust, strictly:
//   1. the server message id the moment was anchored to (exact)
//   2. the start of that message's text (exact regardless of clocks)
//   3. the latest bubble whose time is AT OR BEFORE the moment, both in
//      server time
// There is deliberately no "nearest bubble" fallback and no grace window:
// both used to put a moment under a message that was sent after it.
const buildThreadIndex = (thread) => {
  const n = Array.isArray(thread) ? thread.length : 0;
  const byId = new Map();
  const times = new Array(n);
  for (let i = 0; i < n; i++) {
    const m = thread[i];
    if (!m) { times[i] = 0; continue; }
    const id = Number(m.id || 0);
    if (id > 0 && !byId.has(id)) byId.set(id, i);
    const ts = Number(m.ts) || 0;
    times[i] = ts ? (m._local ? euServerTime(ts) : ts) : 0;
  }
  return { thread, n, byId, times };
};

const roleOk = (m, role) => !role || role === 'any' || (role === 'in' ? m.r === 'in' : m.r !== 'in');

const idxAtOrBefore = (ix, t, role) => {
  if (!t) return -1;
  let best = -1;
  for (let i = 0; i < ix.n; i++) {
    const mt = ix.times[i];
    if (!mt || mt > t || !roleOk(ix.thread[i], role)) continue;
    best = i;
  }
  return best;
};

const euNormText = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// { id?, ts?, q?, role? } → bubble index, or -1 when the message isn't in
// the thread (the moment is then left out rather than guessed).
// The id we were given names a real bubble, but on the wrong side of the
// exchange. Walk to the nearest bubble of the role we need — backwards
// first, because the AI records what it worked out against its OWN reply,
// and the message that PROMPTED that reply is the one before it.
const slideToRole = (ix, from, role) => {
  for (let i = from; i >= 0; i--) if (ix.thread[i] && roleOk(ix.thread[i], role)) return i;
  for (let i = from + 1; i < ix.n; i++) if (ix.thread[i] && roleOk(ix.thread[i], role)) return i;
  return -1;
};

const anchorIndex = (ix, spec) => {
  const role = spec.role || 'any';
  const id = Number(spec.id || 0);
  if (id > 0 && ix.byId.has(id)) {
    const i = ix.byId.get(id);
    if (roleOk(ix.thread[i], role)) return i;
    // ── WHY THIS DOESN'T JUST GIVE UP ──────────────────────────────
    // It used to fall straight through to the timestamp scan here, and
    // that scan returns -1 the moment there is no usable timestamp — at
    // which point the caller drops the moment entirely, without a word.
    //
    // That is the "Shown · A, B" line that should have read "A, B, C, D".
    // A 'shown' interest is recorded against the REPLY that showed the
    // products, so status_msg_id names a bot bubble, while the interest
    // is anchored with role:'in'. Every one of those took this branch.
    // The ones that happened to carry a parseable status_at survived via
    // the timestamp scan; the ones that didn't were silently discarded,
    // so a reply that showed four packages produced a separator naming
    // however many of them the AI had timestamped.
    //
    // The id is the strongest signal we have and it is exact. Keep it and
    // correct the role instead of throwing the whole moment away.
    const slid = slideToRole(ix, i, role);
    if (slid >= 0) return slid;
  }
  const want = euNormText(spec.q);
  if (want.length >= 3) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < ix.n; i++) {
      const m = ix.thread[i];
      if (!m || !roleOk(m, role)) continue;
      const have = euNormText(m.c);
      if (!have) continue;
      const hit = have === want || have.startsWith(want) || (want.length >= 16 && have.includes(want))
        || (want.startsWith(have) && have.length >= 12);
      if (!hit) continue;
      const d = spec.ts && ix.times[i] ? Math.abs(ix.times[i] - spec.ts) : (ix.n - i);
      if (d <= bestD) { bestD = d; best = i; }
    }
    if (best >= 0) return best;
  }
  return idxAtOrBefore(ix, Number(spec.ts) || 0, role);
};

// The last bubble of the AI/operator reply to the customer message at
// `custIdx` that went out at or after `sinceTs`. -1 while that reply isn't
// in the thread yet.
// ── Turns ───────────────────────────────────────────────────────────
// Everything the AI works out on a turn — a note, an interest, a topic, a
// hand-over — is bookkeeping about that exchange, so it belongs AFTER the
// exchange: below the reply to the customer's message, not wedged between
// the message and the reply. `afterTurn` is the gap under the reply run
// that answers the customer burst containing `custIdx` (or under the burst
// itself when nothing has been sent back).
const afterTurn = (ix, custIdx) => {
  if (custIdx < 0) return -1;
  let j = custIdx + 1;
  while (j < ix.n && ix.thread[j].r === 'in') j++;     // rest of the burst
  if (j >= ix.n) return ix.n;                          // no reply: under the burst
  while (j + 1 < ix.n && ix.thread[j + 1].r !== 'in') j++;
  return j + 1;
};

// The customer burst the AI is answering right now: the last run of
// customer messages, whether or not the first bubbles of the reply have
// gone out yet. null when the AI isn't mid-turn.
const liveTurnOf = (ix, busy) => {
  if (!busy) return null;
  let j = ix.n - 1;
  while (j >= 0 && ix.thread[j].r !== 'in') j--;
  if (j < 0) return null;
  let s = j;
  while (s - 1 >= 0 && ix.thread[s - 1].r === 'in') s--;
  return { start: s, end: j };
};

// AI statuses that mean a reply is still being worked out or typed.
const AI_TURN_BUSY = new Set(['reading', 'thinking', 'replying', 'reconsidering']);

// "BlackMail/BlackRose (Gold)" → { fam: 'BlackMail/BlackRose', variant: 'Gold' }
const productFamily = (name) => {
  const s = String(name || '').trim();
  let m = s.match(/^(.+?)\s*[(\[]\s*([^)\]]+?)\s*[)\]]\s*$/);
  if (m) return { fam: m[1].trim(), variant: m[2].trim() };
  m = s.match(/^(.+?)\s+[-–—:]\s+(.+)$/);
  if (m) return { fam: m[1].trim(), variant: m[2].trim() };
  return { fam: s, variant: '' };
};

// ── compactItemList ───────────────────────────────────────────────────
// Turn an invoice's line items into something that fits on a separator.
//
// A separator line is one row of small text with an ellipsis on it, so the
// full "Mantool Bronze + Mantool Silver + Mantool Gold" is read as
// "Mantool Bronze + Mantool Sil…" and the customer's actual order is the
// part that got cut. Three things shorten it, none of them specific to any
// one naming convention:
//
//   1. An explicit variant marker the operator already wrote — "Thing
//      (Large)", "Thing - Large" — is split by productFamily.
//   2. Failing that, a run of words EVERY name shares, at the front or the
//      back. "Mantool Bronze"/"Mantool Silver" share a leading word, so the
//      line becomes "Mantool · Bronze, Silver"; "Bronze Pack"/"Silver Pack"
//      share a trailing one and become "Pack · Bronze, Silver". This is
//      derived from the names in hand, so it works for whatever the
//      operator happens to call things, and does nothing at all when they
//      share no words.
//   3. Past a few entries the rest is counted rather than listed. Nothing
//      is lost: the hover card spells every line out in full.
//
// Quantities always survive — "×3" is the part of a line item a reader
// cannot reconstruct from anything else.
const compactItemList = (items, opts = {}) => {
  const max = Math.max(1, opts.max || 3);
  const list = (Array.isArray(items) ? items : [])
    .filter(x => x && String(x.name || '').trim())
    .map(x => ({ name: String(x.name).trim(), qty: Math.max(1, Number(x.qty) || 1) }));
  if (!list.length) return '';
  const withQty = (label, qty) => (qty > 1 ? `${label} ×${qty}` : label);
  if (list.length === 1) return withQty(list[0].name, list[0].qty);

  // 1. Operator-written variants.
  const fams = list.map(x => ({ ...x, ...productFamily(x.name) }));
  const famKeys = new Set(fams.map(f => f.fam.toLowerCase()));
  if (famKeys.size === 1 && fams.every(f => f.variant)) {
    return joinCapped(fams.map(f => withQty(f.variant, f.qty)), max, `${fams[0].fam} · `);
  }

  // 2. A run of words shared by every name, leading or trailing.
  const toks = list.map(x => x.name.split(/\s+/).filter(Boolean));
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const runLen = (pick) => {
    let n = 0;
    for (;;) {
      // Never consume a whole name — every entry has to keep something.
      if (toks.some(t => t.length <= n + 1)) return n;
      const ref = pick(toks[0], n);
      if (!toks.every(t => same(pick(t, n), ref))) return n;
      n++;
    }
  };
  const lead = runLen((t, n) => t[n]);
  const tail = runLen((t, n) => t[t.length - 1 - n]);
  if (lead || tail) {
    const useLead = lead >= tail;
    const n = useLead ? lead : tail;
    const shared = (useLead ? toks[0].slice(0, n) : toks[0].slice(toks[0].length - n)).join(' ');
    const rest = list.map((x, i) => withQty(
      (useLead ? toks[i].slice(n) : toks[i].slice(0, toks[i].length - n)).join(' '), x.qty));
    return joinCapped(rest, max, `${shared} · `);
  }

  // 3. Nothing in common — list them as they are.
  return joinCapped(list.map(x => withQty(x.name, x.qty)), max, '', ' + ');
};

// Keep the first few, count the rest. The separator is a summary; the hover
// card behind it is the detail.
const joinCapped = (parts, max, prefix = '', sep = ', ') => {
  if (parts.length <= max) return prefix + parts.join(sep);
  const shown = parts.slice(0, max);
  return `${prefix}${shown.join(sep)} +${parts.length - max} more`;
};

// The line items of an invoice, whatever shape the row is in.
const invItems = (inv) => {
  try {
    if (typeof INVOICE_ITEMS !== 'undefined') return INVOICE_ITEMS.itemsOf(inv) || [];
  } catch (_) {}
  return [];
};

// Notes the AI writes that only restate the status the line already shows
// ("listed as option for purchase" under Shown). They add nothing.
const INTEREST_NOTE_GENERIC = /^(?:was\s+|been\s+)?(?:listed|shown|presented|offered|mentioned|quoted|displayed|included|named|recommended|suggested|pitched)\b|\b(?:as\s+(?:an?\s+)?option|for\s+purchase|in\s+(?:the\s+)?(?:list|catalog(?:ue)?|options))\b|^(?:customer\s+)?(?:asked|inquired|enquired)\s+about\b|^(?:is\s+)?(?:considering|interested|thinking about|looking at)\b/i;

// "A (Bronze), A (Silver), B" → "A · Bronze, Silver; B"
const compactProductNames = (names) => {
  const fams = new Map();
  names.forEach(n => {
    const { fam, variant } = productFamily(n);
    const k = fam.toLowerCase();
    if (!fams.has(k)) fams.set(k, { fam, variants: [], bare: false });
    const f = fams.get(k);
    if (variant) { if (!f.variants.includes(variant)) f.variants.push(variant); } else f.bare = true;
  });
  return [...fams.values()].map(f => f.variants.length
    ? `${f.fam} · ${f.variants.join(', ')}${f.bare ? ' +base' : ''}` : f.fam).join('; ');
};

const jumpTo = (detail) => {
  try { window.dispatchEvent(new CustomEvent('bc:jumpToMessage', { detail })); } catch (_) {}
};

// ── Click targets ─────────────────────────────────────────────────────
// WHY A SEPARATOR NOW CARRIES ITS OWN BUBBLE
// Every separator is PLACED by anchorIndex — message id first, then text,
// then server time — against this exact thread. Its click, though, used to
// throw all of that away and send only a timestamp (plus, for notes, a text
// fragment) to the chat, which then re-guessed the bubble on its own with
// different rules: raw browser/server stamps with no skew correction, a
// 5-second grace, "latest customer message at/before", a nearest-time
// tie-break between every bubble whose text matched a short fragment. Two
// independent guesses about the same message disagree, and they disagree
// more the longer the chat is, because there are more bubbles near any
// given time and more short replies ("ok", "yes") that match a fragment.
//
// Notes were worse still: placed at their FIRST evidencing message but
// jumped to their LAST one, so every time the customer mentioned the same
// thing again an old separator started pointing further down the chat —
// the "old ones change" report.
//
// So a separator now records the bubble it was placed against (the row
// object itself, plus its server id) and the click asks for exactly that
// row. The chat resolves it by identity, then by id; the text/time fields
// ride along only as a fallback for a row that has since been replaced by
// a reload before the moments rebuilt.
const bubbleTarget = (ix, i) => {
  if (!ix || i == null || i < 0 || i >= ix.n) return null;
  const m = ix.thread[i];
  if (!m) return null;
  return {
    ref: m,
    id: Number(m.id || 0) || 0,
    idx: i,
    // Raw stamp (the chat compares against its bubbles' own m.ts).
    ts: Number(m.ts) || 0,
    text: String(m.c || '').slice(0, 80),
    r: m.r,
  };
};
const jumpToBubble = (convId, target) => {
  if (!target) return;
  jumpTo({ convId, target, ts: target.ts, text: target.text,
    role: target.r === 'in' ? 'in' : '', match: 'before' });
};

// ── Invoice helpers ───────────────────────────────────────────────────
const invCoinTicker = (coin) => {
  const c = String(coin || '').toLowerCase();
  try {
    if (typeof CRYPTAPI_COINS !== 'undefined') {
      const hit = CRYPTAPI_COINS.find(x => x.id === c);
      if (hit) return hit.ticker;
    }
  } catch (_) {}
  const tail = c.split('/').pop();
  return tail ? tail.toUpperCase() : '';
};
const invFiat = (inv) => {
  const code = String(inv.fiat || 'USD').toUpperCase();
  const raw = String(inv.amount_fiat == null ? '' : inv.amount_fiat).replace(/^[^0-9.]*/, '');
  if (!raw) return '';
  const n = parseFloat(raw);
  const amt = isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) : raw;
  let sym = '';
  try { sym = (typeof FIAT_BY_CODE !== 'undefined' && FIAT_BY_CODE[code] && FIAT_BY_CODE[code].symbol) || ''; } catch (_) {}
  return sym && sym !== 'kr' ? `${sym}${amt}` : `${amt} ${code}`;
};
const invCrypto = (inv, paid) => {
  const v = paid ? (inv.amount_coin || inv.amount_coin_quoted) : inv.amount_coin_quoted;
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return '';
  const s = n.toLocaleString(undefined, { maximumFractionDigits: 8 });
  return `${s} ${invCoinTicker(inv.coin)}`;
};
// What the invoice is FOR, taken from its line items first.
//
// This used to read inv.description before anything else. The description is
// the AI's own note ("bronze and silver"), which is not a promise about what
// the invoice actually covers — so an invoice that had quietly collapsed to
// one product still advertised two everywhere it was displayed, and the
// mismatch between the row and the money was invisible. The items are the
// row's truth: bill, delivery and licences all follow them. The note is only
// a fallback for rows that never had items resolved.
const invProduct = (inv, opts = {}) => {
  // Checked FIRST. A row flagged this way is known to be asking for more
  // than its one resolved line covers, and that line is exactly what
  // INVOICE_ITEMS.label would return — so reading the items here would
  // caption an $85 order with the $35 thing on it, which is the mismatch
  // this flag exists to prevent. The order summary goes out instead.
  if (inv && inv.basket_unresolved) {
    const ol = String(inv.order_label || inv.description || inv.note || '').trim();
    return ol || 'Order';
  }
  // Line items are the row's truth: the bill, the delivery and the licences
  // all follow them, so they are the one description that cannot drift from
  // the money. EVERY line is represented — showing "Bronze" on a
  // Bronze + Silver invoice is the mismatch these lines exist to surface —
  // but shortened to fit one row of separator text unless the caller wants
  // it whole (the hover card does).
  const fromItems = compactItemList(invItems(inv), { max: opts.full ? 24 : 3 });
  if (fromItems) return fromItems;
  const d = String(inv.description || inv.note || '').trim();
  if (d) return d;
  try {
    if (inv.product_id && typeof PRODS_STORE !== 'undefined') {
      const p = (PRODS_STORE.list || []).find(x => String(x.id) === String(inv.product_id));
      if (p && p.name) return p.name;
    }
  } catch (_) {}
  return '';
};
const invShortRef = (inv) => String(inv.id || '').replace(/^inv_/, '').slice(-5).toUpperCase();

// This conversation's invoices worth showing: real ones (an address was
// minted) that are open or settled. Failed mints never reached the customer.
const invoicesForConv = (convId) => {
  if (!convId || typeof PAYMENTS_STORE === 'undefined') return [];
  // A direct chat's invoices carry its sales-side id (see bcSameConv); an
  // erased contact's old invoices are no longer theirs to show.
  return (PAYMENTS_STORE.invoices || []).filter(i =>
    i && bcSameConv(i.conv_id, convId) && !i.wiped_at && i.status !== 'failed' && (i.address || i.status === 'confirmed'));
};

// Hover-card detail lines shared by open and settled invoices.
const invDetails = (inv, txTs) => {
  const lines = [];
  // The separator itself is capped and may read "+2 more"; this is where
  // the rest actually lives, so it is always the full list.
  const items = invItems(inv);
  if (items.length > 1) lines.push(compactItemList(items, { max: 24 }));
  const crypto = invCrypto(inv, inv.status === 'confirmed');
  if (crypto) lines.push(inv.status === 'confirmed' ? `Received ${crypto}` : `Quoted ${crypto}`);
  const need = Number(inv.min_confirmations || 1);
  const got = Number(inv.confirmations || 0);
  if (inv.status === 'pending' && got > 0) lines.push(`${got} of ${need} confirmation${need === 1 ? '' : 's'}`);
  const created = Number(inv.created || 0) * 1000;
  if (created) lines.push(`Sent ${euAgo(created)}`);
  if (inv.address) lines.push(`${String(inv.address).slice(0, 8)}…${String(inv.address).slice(-6)}`);
  lines.push(`Ref ${invShortRef(inv)}`);
  return lines;
};

// When an invoice stopped being open, in SERVER time. Browser stamps get the
// skew; the paid transaction (server stamp) backs up invoices confirmed
// before confirmed_at was recorded.
const invSettledAt = (inv, txByRef) => {
  const tx = txByRef.get(String(inv.id));
  const s = (v) => (Number(v) > 0 ? euServerTime(Number(v) * 1000) : 0);
  if (inv.status === 'confirmed') {
    return s(inv.confirmed_at) || (tx ? tx.ts : 0) || s(inv.last_delivery_attempt) || s(inv.last_checked);
  }
  if (inv.status === 'cancelled') return s(inv.cancelled_at);
  if (inv.status === 'expired') return s(inv.expired_at);
  return 0;
};

// ── Headlines ─────────────────────────────────────────────────────────
// A separator is one quiet line, so what it says has to be a headline,
// not a sentence. The AI writes notes, hand-over reasons and similar text
// as prose ("The customer is worried the licence won't transfer. They
// asked twice."). This keeps the first clause and drops the subject every
// one of them shares — "Worried the licence won't transfer" — and the
// hover card still carries the whole thing. Nothing here knows any
// particular wording; it works on sentence shape alone.
const HEADLINE_SUBJECT = /^(?:the\s+)?(?:customer|user|client|buyer|contact|lead|prospect|person)(?:'s(?=\s))?\s+(?:(?:is|was|seems(?:\s+to\s+be)?|appears(?:\s+to\s+be)?)\s+)?/i;
const momentHeadline = (text, max = 90) => {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/^(?:note|update|fyi)\s*[:\-–—]\s*/i, '');
  const stripped = s.replace(HEADLINE_SUBJECT, '');
  if (stripped.length >= 3 && stripped !== s) s = stripped;
  // First clause — a sentence end, a dash aside or a parenthetical — as
  // long as what's left still says something on its own.
  const breaks = /[.;!?](?=\s|$)|\s[—–]\s|\s-\s|\s\(/g;
  let m;
  while ((m = breaks.exec(s))) { if (m.index >= 12) { s = s.slice(0, m.index); break; } }
  s = s.replace(/[\s.,;:!\-–—]+$/, '');
  if (s.length > max) {
    const cut = s.slice(0, max + 1);
    const sp = cut.lastIndexOf(' ');
    s = (sp > max * 0.6 ? cut.slice(0, sp) : cut.slice(0, max)).replace(/[\s,;:·\-–—(]+$/, '') + '…';
  }
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
};

// "Urgent: needs it by Friday" under the kind "Urgent" says the kind twice.
const stripMetaEcho = (label, meta) => {
  const l = String(label || ''), m = String(meta || '').trim();
  if (!m || !l) return l;
  const esc = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = l.replace(new RegExp(`^${esc}\\s*[:\\-–—·]\\s*`, 'i'), '');
  return out.length >= 3 ? out.charAt(0).toUpperCase() + out.slice(1) : l;
};

// ── When a note stops being true ─────────────────────────────────────
// Notes are written about a moment, and many describe a STATE that ends:
// "ready to pay" ends when they pay (or an invoice takes over), "needs
// this urgently" ends when the hand-over is resolved. Left alone, those
// lines sit in the thread long after the thing they describe has
// happened. Rather than matching any particular wording, a note is sorted
// by what KIND of state it describes, and retired as soon as an outcome
// of that kind is recorded after it:
//
//   intent  — buying / paying / invoicing intent or a claimed payment.
//             Ends on a settled payment or an invoice issued after it.
//   issue   — urgency, a problem, a complaint, a refund. Ends on a
//             resolved hand-over, a resolution chapter, or a refund.
//
// Durable facts (preferences, contact details, fraud / threat flags) are
// never retired: they stay true after the sale.
const NOTE_DURABLE = /\b(?:prefer\w*|favou?r\w*|likes?|loves?|e-?mail|phone|telegram|discord|whatsapp|signal|contact|time ?zone|language|speaks?|fraud\w*|scam\w*|chargeback\w*|threat\w*|lawyer|police|abus\w*|blacklist\w*|banned)\b/i;
const NOTE_INTENT = new RegExp([
  // an intent verb, then (within a short clause) a commerce verb
  String.raw`\b(?:ready|about|going|plans?|planning|wants?|wanted|wanting|willing|intends?|intending|decided|deciding|agreed|agrees|keen|eager|looking|trying|likely|would\s+like|will|asked\s+for|asks\s+for|asking\s+for|requested|requests|requesting|waiting|awaiting|needs?)\b[^.;!?]{0,32}?\b(?:pay|paying|payment|buy|buying|purchas\w*|order\w*|checkout|check\s+out|invoice\w*|wallet|address|send\w*|transfer\w*|proceed\w*|deal|sign(?:ing)?\s+up|subscrib\w*)\b`,
  // weighing it up
  String.raw`\b(?:interested\s+in|considering|comparing|undecided|hesitant|hesitating|on\s+the\s+fence|negotiat\w*|haggl\w*)\b`,
  // a payment the customer says is made or on its way
  String.raw`\b(?:(?:has|have|just|already)\s+paid|sent\s+(?:the\s+)?(?:payment|money|funds|coins?|crypto)|payment\s+(?:sent|made|incoming|pending|on\s+(?:the|its)\s+way))\b`,
].join('|'), 'i');
const NOTE_ISSUE = /\b(?:urgent\w*|asap|emergenc\w*|critical|immediately|right\s+away|deadline|waiting|delay\w*|late|missing|problem\w*|issue\w*|error\w*|bug\w*|broken|stuck|not\s+(?:received|arrived|working|delivered)|(?:didn|hasn|haven|wasn|isn)'?t\s+(?:received|arrived|get|got|work\w*|deliver\w*)|can'?t\s+(?:access|log\s?in|open|download|activate|find)|help|support|escalat\w*|complain\w*|unhappy|frustrat\w*|angry|upset|refund\w*)\b/i;
const noteLifecycle = (text) => {
  const t = String(text || '');
  if (!t || NOTE_DURABLE.test(t)) return null;
  const intent = NOTE_INTENT.test(t), issue = NOTE_ISSUE.test(t);
  return (intent || issue) ? { intent, issue } : null;
};

// Transactions keyed by the INVOICE part of their reference ("<inv>#1.2").
const refInvoiceIdOf = (ref) => String(ref || '').split('#')[0];
const txByInvoiceRef = (transactions) => {
  const out = new Map();
  (Array.isArray(transactions) ? transactions : []).forEach(t => {
    if (!t || !t.reference) return;
    const k = refInvoiceIdOf(t.reference);
    const ts = Number(t.created_ts) || euParseTs(t.created_at);
    if (!k || !ts) return;
    const prev = out.get(k);
    if (!prev || ts < prev.ts) out.set(k, { ts });
  });
  return out;
};

// Every outcome that can end a note's state, in server time.
const momentOutcomes = (data, invoices, chapters) => {
  const out = { sale: [], issued: [], resolved: [], refund: [] };
  const d = data || {};
  const txs = Array.isArray(d.transactions) ? d.transactions : [];
  const byRef = txByInvoiceRef(txs);
  (invoices || []).forEach(inv => {
    if (!inv || inv.status === 'failed') return;
    const c = Number(inv.created) || 0;
    if (c > 0) out.issued.push(euServerTime(c * 1000));
    if (inv.status === 'confirmed') { const at = invSettledAt(inv, byRef); if (at) out.sale.push(at); }
  });
  txs.forEach(t => {
    if (!t) return;
    const ts = Number(t.created_ts) || euParseTs(t.created_at);
    if (!ts) return;
    const st = String(t.status || 'completed').toLowerCase();
    if (st === 'refunded') out.refund.push(ts);
    else if (st === 'completed' || st === 'paid' || st === 'confirmed') out.sale.push(ts);
  });
  const esc = Object.prototype.hasOwnProperty.call(d, 'escalation') ? d.escalation
    : ((d.end_user && d.end_user.escalation) || null);
  if (esc && String(esc.status || '') !== 'pending') {
    const r = euParseTs(esc.resolved_at);
    if (r) out.resolved.push(r);
  }
  (chapters || []).forEach(ch => {
    if (ch.resolved && ch.end) out.resolved.push(ch.end);
    else if (ch.kind === 'resolution' && ch.start) out.resolved.push(ch.start);
  });
  return out;
};

// `since`: when the note's CURRENT wording was established. A small grace
// covers an invoice issued in the same turn the note was written.
const noteRetired = (life, since, outcomes) => {
  if (!life || !since || !outcomes) return false;
  const after = (list) => list.some(t => t && t >= since - 60000);
  if (life.intent && (after(outcomes.sale) || after(outcomes.issued))) return true;
  if (life.issue && (after(outcomes.resolved) || after(outcomes.refund))) return true;
  return false;
};

// ── productMatcher ────────────────────────────────────────────────────
// Does a bubble name this product? Used to hold interest separators to
// what the thread actually shows. Deliberately forgiving about HOW it is
// named — people and the AI both say "the bronze one" for "Mantool
// Bronze" — but it needs a word that picks THIS product out: the full
// name, the SKU, every meaningful word of the name, or the words that set
// it apart from the operator's other products.
const PRODUCT_GENERIC = new Set(('the a an of and or for with to in on by my your our ' +
  'package packages pack packs plan plans bundle bundles tier tiers edition version product products ' +
  'service services item items option options deal offer set kit license licence key keys ' +
  'basic standard').split(' '));
const productWords = (s) => euNormText(s).split(' ').filter(w => w && (w.length >= 2 || /\d/.test(w)));
const productMatcher = (name, sku, allNames) => {
  const full = euNormText(name);
  const skuN = euNormText(sku);
  const words = productWords(name);
  let key = words.filter(w => !PRODUCT_GENERIC.has(w));
  if (!key.length) key = words;
  // Words no OTHER product shares — "bronze" in "Mantool Bronze" when the
  // catalogue also has "Mantool Silver".
  const others = new Set();
  (allNames || []).forEach(n => {
    if (euNormText(n) === full) return;
    productWords(n).forEach(w => others.add(w));
  });
  const distinct = key.filter(w => !others.has(w));
  const has = (padded, w) => padded.includes(` ${w} `) || padded.includes(` ${w}s `) || padded.includes(` ${w}es `);
  return (m) => {
    if (!m) return false;
    const txt = euNormText(`${m.c || ''} ${m.caption || ''} ${m.mc || ''}`);
    if (!txt) return false;
    const padded = ` ${txt} `;
    if (full && padded.includes(` ${full} `)) return true;
    if (skuN && skuN.length >= 2 && padded.includes(` ${skuN} `)) return true;
    if (key.length && key.every(w => has(padded, w))) return true;
    if (distinct.length && distinct.length < key.length && distinct.every(w => has(padded, w))) return true;
    return false;
  };
};

// ── collectMomentItems ────────────────────────────────────────────────
// Raw moments, one per fact, each with its boundary and phase:
//   phase 0 — about the bubble ABOVE (a note, a payment, a hand-over)
//   phase 1 — opens the bubble BELOW (a chapter)
// In a shared gap, phase 0 always prints first, so a note about one message
// can never end up filed under the chapter that starts with the next.
const collectMomentItems = (data, thread, convId, conv, invoices, busy) => {
  const items = [];
  if (!data || !Array.isArray(thread) || !thread.length) return items;
  const ix = buildThreadIndex(thread);
  const crm = data.crm || {}, memory = data.memory || {};
  const after = (i) => (i >= 0 ? i + 1 : -1);
  // While the AI is still answering a burst, what it has already noted
  // about that burst waits until the reply has finished going out — then
  // it lands below the reply instead of above the bubbles still typing.
  const liveTurn = liveTurnOf(ix, busy);
  const heldBack = (custIdx) => !!liveTurn && custIdx >= liveTurn.start;
  const add = (boundary, phase, it) => {
    if (boundary < 0 || boundary > ix.n) return;
    const label = typeof it.label === 'string' ? stripMetaEcho(it.label, it.meta) : it.label;
    items.push({ ...it, label, boundary, phase, convId });
  };

  // CHAPTERS — above the customer message that opened them. Small talk is
  // the absence of a topic, not a moment.
  const chaptersRaw = Array.isArray(crm.chapters) ? crm.chapters
    : (Array.isArray(memory.chapters) ? memory.chapters : []);
  const chapters = chaptersRaw
    .filter(c => c && typeof c === 'object' && c.title && c.kind !== 'small_talk')
    .map(c => ({
      id: String(c.id || ''), title: String(c.title), summary: String(c.summary || ''),
      kind: CHAPTER_META[c.kind] ? String(c.kind) : 'topic',
      start: Number(c.start_ts || 0), end: Number(c.end_ts || c.start_ts || 0),
      startMsg: Number(c.start_msg_id || 0),
      open: String(c.status || 'open') === 'open',
      resolved: String(c.closed_reason || '') === 'escalation_resolved',
    }))
    .filter(c => c.start > 0 || c.startMsg > 0)
    .sort((a, b) => a.start - b.start);
  // Where every chapter starts, worked out once, so each chapter's range
  // can end exactly where the next one begins.
  const chIdx = chapters.map(ch => anchorIndex(ix, { id: ch.startMsg, ts: ch.start, role: 'in' }));
  // The run of bubbles a chapter covers, decided HERE, from the same
  // indices the separators are drawn at. This used to be left to the chat,
  // which re-derived it from timestamps and then asked a language model to
  // pick the boundaries — a different answer on different clicks, and one
  // that drifted further off the longer the conversation got.
  const chapterRange = (i) => {
    const s = chIdx[i];
    if (s < 0) return null;
    let bound = ix.n - 1;
    chIdx.forEach((o, k) => { if (k !== i && o > s && o - 1 < bound) bound = o - 1; });
    let e = bound;
    const ch = chapters[i];
    if (!ch.open && ch.end > 0) {
      let last = idxAtOrBefore(ix, ch.end, 'any');
      if (last >= s) {
        // A customer message that closed the chapter keeps its reply.
        if (ix.thread[last] && ix.thread[last].r === 'in') {
          while (last + 1 < ix.n && ix.thread[last + 1] && ix.thread[last + 1].r !== 'in') last++;
        }
        e = Math.min(bound, last);
      }
    }
    if (e < s) e = s;
    return { s, e };
  };
  chapters.forEach((ch, i) => {
    const prev = chapters[i - 1] || null, next = chapters[i + 1] || null;
    const kind = ch.resolved ? 'resolution' : ch.kind;
    const idx = chIdx[i];
    if (idx < 0 || heldBack(idx)) return;
    // A "Question" chapter is the customer's question, restated directly
    // above the bubble that asks it. It still bounds the ranges around it
    // (chIdx above), it just isn't drawn.
    if (kind === 'question') return;
    const range = chapterRange(i);
    const startTarget = bubbleTarget(ix, range ? range.s : idx);
    const endTarget   = bubbleTarget(ix, range ? range.e : idx);
    const span = !ch.open && euSpan(ch.start, ch.end);
    add(idx, 1, {
      key: `ch:${ch.id || ch.start}`, type: 'chapter', ts: ch.start,
      // A topic or a question is narrative colour; an objection, decision,
      // payment, escalation or resolution is a turn the operator must see.
      quiet: kind === 'topic' || kind === 'question',
      rank: CHAPTER_RANK[kind] || 60, ink: MOMENT_INK[kind] || MOMENT_INK.topic,
      meta: CHAPTER_META[kind], label: momentHeadline(ch.title, 60) || ch.title,
      full: momentHeadline(ch.title, 60) !== ch.title ? ch.title : undefined,
      details: [ch.summary, ch.open ? 'Ongoing' : (span ? `Lasted ${span}` : '')].filter(Boolean),
      time: ch.start ? euAgo(ch.start) : '',
      locate: () => {
        try {
          window.dispatchEvent(new CustomEvent('bc:jumpToRange', { detail: {
            convId, chapterId: ch.id, startTs: ch.start, endTs: ch.end || ch.start,
            kind: ch.kind, prevEndTs: prev ? (prev.end || prev.start) : 0,
            nextStartTs: next ? next.start : 0, isLatest: !next,
            chapterTitle: ch.title, chapterSummary: ch.summary,
            startTarget, endTarget,
          }}));
        } catch (_) {}
      },
    });
  });

  // INTERESTS — placed where the CURRENT status became true (status_at /
  // status_msg_id), never where the product was last mentioned:
  //   asked / considering / passed → under the customer message that said so
  //   shown  → under the reply that showed it; hidden until it's in the chat
  //   bought → where the sale landed
  const interests = Array.isArray(crm.interests) ? crm.interests
    : (Array.isArray(memory.interests) ? memory.interests : []);
  // ── WHAT THE CUSTOMER HAS MOVED PAST ────────────────────────────────
  // Once a product is on an invoice, the customer has stopped considering
  // it — they asked to be billed for it. Leaving "Considering X" in the
  // thread after that is a stale read of a question that has already been
  // answered, and it is at its worst exactly where it is most likely to
  // appear: directly under the invoice that answered it. So the pre-sale
  // statuses are dropped for anything now on an invoice.
  //
  // Only the pending ones go. "Bought" and "Passed on" are outcomes, not
  // states waiting to resolve, and they stay where they happened.
  //
  // An invoice only clears interest that predates it. A returning customer
  // weighing up a product they bought months ago is considering it again,
  // and the old invoice has nothing to say about that.
  const INTEREST_PENDING = { asked: true, shown: true, considering: true };
  const billedFor = [];
  (invoices || []).forEach(inv => {
    if (!inv || inv.status === 'failed') return;
    const at = (Number(inv.created) || 0) * 1000;
    let text = '';
    try { text = String(INVOICE_ITEMS.label(inv) || ''); } catch (_) {}
    text = (text + ' ' + String(inv.description || '')).trim().toLowerCase();
    const ids = new Set();
    try {
      INVOICE_ITEMS.itemsOf(inv).forEach(it => { if (it && it.product_id) ids.add(String(it.product_id)); });
    } catch (_) {}
    if (inv.product_id != null) ids.add(String(inv.product_id));
    if (text || ids.size) billedFor.push({ at, text, ids });
  });
  const isBilled = (it, ts) => {
    if (!billedFor.length) return false;
    const name = String((it && it.name) || '').trim().toLowerCase();
    const pid  = (it && (it.product_id != null)) ? String(it.product_id) : '';
    if (!name && !pid) return false;
    // Whole-name match only: a "Gold" interest must not be cleared by a
    // "Gold Plus" invoice, which is a different product at a different price.
    const re = name ? new RegExp('(?:^|[^a-z0-9])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i') : null;
    return billedFor.some(b => {
      if (ts && b.at && b.at < ts - 60000) return false;
      if (pid && b.ids.has(pid)) return true;
      return !!(re && b.text && re.test(b.text));
    });
  };

  // ── WHAT THE THREAD CAN PROVE ─────────────────────────────────────
  // An interest is the AI's own bookkeeping, written in the same response
  // as the reply — before that reply has been typed out, and before the
  // operator has had the chance to discard it, or a new customer message
  // has superseded it. So "Shown · X" used to appear for products the
  // customer never actually saw: the draft that described them was thrown
  // away, rewritten by the server's reply checks, or the AI simply filed
  // products it had only been thinking about. The separator now draws only
  // what the visible thread backs up:
  //   shown        → a reply (AI or operator) that actually names it
  //   considering  → named by the customer, or in the reply they were
  //   / passed on    reacting to, or in the answer to them
  //   asked        → not drawn: the customer's own message right above
  //                  already says it, the line only repeated it
  //   bought       → drawn as before (the server proves it from a payment)
  const allNames = [];
  try { (PRODS_STORE.list || []).forEach(p => { if (p && p.name) allNames.push(String(p.name)); }); } catch (_) {}
  interests.forEach(x => { if (x && x.name) allNames.push(String(x.name)); });
  const runOf = (i, wantIn) => {
    // The contiguous run of bubbles on one side of the exchange around i.
    let s0 = i, e0 = i;
    while (s0 - 1 >= 0 && ix.thread[s0 - 1] && ((ix.thread[s0 - 1].r === 'in') === wantIn)) s0--;
    while (e0 + 1 < ix.n && ix.thread[e0 + 1] && ((ix.thread[e0 + 1].r === 'in') === wantIn)) e0++;
    return { s: s0, e: e0 };
  };
  const runMentions = (run, hit) => {
    if (!run) return false;
    for (let k = run.s; k <= run.e; k++) { if (ix.thread[k] && hit(ix.thread[k])) return true; }
    return false;
  };
  // Reply runs after the customer burst holding custIdx, oldest first.
  const replyRunsAfter = (custIdx, max) => {
    const out = [];
    let j = custIdx + 1;
    while (j < ix.n && out.length < max) {
      while (j < ix.n && ix.thread[j] && ix.thread[j].r === 'in') j++;
      if (j >= ix.n) break;
      const r = runOf(j, false);
      out.push(r);
      j = r.e + 1;
    }
    return out;
  };

  const interestItems = [];
  interests.forEach(it => {
    if (!it || !it.name) return;
    const st = String(it.status || '').toLowerCase();
    const status = INTEREST_META[st] ? st : 'asked';
    // "Asked about X" directly under the customer asking about X.
    if (status === 'asked') return;
    const askedTs = euParseTs(it.asked_at);
    const statusTs = euParseTs(it.status_at);
    const updTs = euParseTs(it.updated_at);
    const ts = statusTs || updTs || askedTs;
    const msgId = it.status_msg_id;
    if (!ts && !msgId) return;
    // Already invoiced for → the customer is past weighing it up.
    if (INTEREST_PENDING[status] && isBilled(it, ts)) return;
    const hit = productMatcher(it.name, it.sku, allNames);
    let boundary, at;
    if (status === 'purchased') {
      at = msgId ? anchorIndex(ix, { id: msgId, ts, role: 'any' }) : idxAtOrBefore(ix, ts, 'any');
      boundary = after(at);
    } else if (status === 'shown') {
      // The reply that named it. Start from the exact bubble the server
      // recorded when that is a reply; otherwise from the customer message
      // the AI was answering, and look at the next few replies to it (the
      // reply may have gone out in pieces, or the AI named it a turn late).
      const exact = Number(msgId || 0);
      let run = null;
      if (exact > 0 && ix.byId.has(exact) && ix.thread[ix.byId.get(exact)].r !== 'in') {
        const r = runOf(ix.byId.get(exact), false);
        if (runMentions(r, hit)) run = r;
      }
      if (!run) {
        const cust = anchorIndex(ix, { id: msgId, ts, role: 'in' });
        if (cust < 0 || heldBack(cust)) return;
        run = replyRunsAfter(cust, 3).find(r => runMentions(r, hit)) || null;
      }
      if (!run) return;          // never actually shown in this chat
      boundary = run.e + 1;
      at = run.s;
      for (let k = run.s; k <= run.e; k++) { if (hit(ix.thread[k])) { at = k; break; } }
    } else {
      // considering / passed — below the reply to the customer message
      // that made it true, and only if the product is actually part of
      // that exchange.
      const cust = anchorIndex(ix, { id: msgId, ts, role: 'in' });
      if (cust < 0 || heldBack(cust)) return;
      const burst = runOf(cust, true);
      const before = burst.s > 0 ? runOf(burst.s - 1, false) : null;
      const reply = replyRunsAfter(cust, 1)[0] || null;
      if (!runMentions(burst, hit) && !runMentions(before, hit) && !runMentions(reply, hit)) return;
      boundary = afterTurn(ix, cust);
      at = cust;
    }
    interestItems.push({ boundary, it, status, ts, target: bubbleTarget(ix, at) });
  });
  // Same status in the same gap reads as one line: "Shown · A, B, C".
  const byGap = new Map();
  interestItems.forEach(x => {
    if (x.boundary < 0) return;
    const k = `${x.boundary}|${x.status}`;
    if (!byGap.has(k)) byGap.set(k, []);
    byGap.get(k).push(x);
  });
  byGap.forEach(list => {
    list.sort((a, b) => a.ts - b.ts);
    const { boundary, status } = list[0];
    const names = list.map(x => String(x.it.name));
    // Only notes that say something the line doesn't: no status restated,
    // no duplicates, and named by variant rather than the full product.
    const seenNotes = new Set();
    const notes = [];
    list.forEach(x => {
      // The AI often prefixes the note with the product it's about.
      const nm = String(x.it.name || '');
      let n = String(x.it.note || '').trim();
      if (nm && n.toLowerCase().startsWith(nm.toLowerCase())) n = n.slice(nm.length).replace(/^\s*[:\-–—]\s*/, '').trim();
      if (!n || INTEREST_NOTE_GENERIC.test(n)) return;
      const k = n.toLowerCase();
      if (seenNotes.has(k)) return;
      seenNotes.add(k);
      const { variant } = productFamily(x.it.name);
      notes.push(list.length > 1 ? `${variant || x.it.name}: ${n}` : n);
    });
    add(boundary, 0, {
      key: `in:${status}:${names.map(s => s.toLowerCase()).join('|')}`, type: 'interest',
      memberKeys: list.map(x => `in:${String(x.it.name).toLowerCase()}|${x.it.sku || ''}`),
      ts: list[0].ts, rank: INTEREST_RANK[status], ink: MOMENT_INK[status], status,
      quiet: status !== 'purchased',
      meta: INTEREST_META[status], label: compactProductNames(names), coinText: true,
      details: notes.slice(0, 3),
      time: euAgo(list[list.length - 1].ts),
      locate: (() => {
        const t = (list.find(x => x.target) || {}).target || null;
        return t ? () => jumpToBubble(convId, t) : undefined;
      })(),
    });
  });

  // NOTES — drawn where their CURRENT wording was established.
  //
  // The server keeps one record per topic and updates its wording in place
  // as the conversation goes on. This used to draw that record at its FIRST
  // evidence while showing its LATEST wording, so a note that picked up new
  // information rewrote a separator far up the thread whose neighbours
  // never said anything of the kind. Now the line stands where the wording
  // it shows was written (the server's wording anchor, or — for records
  // written before that existed — the latest customer message that
  // evidenced it). A restatement doesn't move it; new information does,
  // and the old spot empties, so a topic is only ever drawn once.
  const notesArr = Array.isArray(crm.notes) ? [...crm.notes].reverse()
    : (Array.isArray(memory.notes) ? memory.notes : []);
  const outcomes = momentOutcomes(data, invoices, chapters);
  consolidateNotes(notesArr, { cap: 12, ttlMs: Infinity }).forEach(note => {
    const first = note.anchors[0] || null;
    const last = note.anchors[note.anchors.length - 1] || null;
    let spec = null;
    if (note.wi > 0 || note.wt > 0) spec = { id: note.wi, ts: note.wt };
    else if (last) spec = { id: last.id, ts: last.ts, q: last.q };
    else if (!note.estimated && note.t) spec = { ts: note.t };
    if (!spec) return;
    // A note that describes a state which has since ended (the payment it
    // was waiting on landed, the problem was resolved) leaves the thread.
    // Records without a wording anchor are judged from their first
    // evidence: an old build rewrote their wording on every turn, so their
    // own stamps can't say whether the text predates the outcome.
    const since = note.wt || (first ? first.ts : 0) || (note.estimated ? 0 : note.t);
    if (noteRetired(noteLifecycle(note.text), since, outcomes)) return;
    const idx = anchorIndex(ix, { ...spec, role: 'in' });
    if (idx < 0 || heldBack(idx)) return;
    const full = note.text.charAt(0).toUpperCase() + note.text.slice(1);
    const head = momentHeadline(note.text);
    if (!head) return;
    // Background colour ("seems friendly", "said thanks") stays in the
    // customer profile; the thread only carries notes that change what you
    // would do next — a detail (payment, contact) or something to act on.
    if (!(note.cat.sev >= 1)) return;
    const sev2 = note.cat.sev === 2;
    const ts = spec.ts || 0;
    // The click goes to the bubble the line is drawn from.
    const target = bubbleTarget(ix, idx);
    add(afterTurn(ix, idx), 0, {
      key: `nt:${euNormText(head).slice(0, 48)}`, type: 'note', ts,
      quiet: !sev2,
      rank: sev2 ? 68 : (note.cat.sev === 1 ? 45 : 40),
      ink: sev2 ? note.cat.col : MOMENT_INK.note,
      meta: note.cat.label || 'Note', label: head, full: full !== head ? full : undefined, coinText: true,
      details: note.mentions > 1 ? [`Mentioned in ${note.mentions} messages`] : [],
      time: ts ? euAgo(ts) : '',
      locate: target ? () => jumpToBubble(convId, target) : undefined,
    });
  });

  // PAYMENTS — transactions. One that settles an invoice is drawn by the
  // invoice line instead, so a sale never shows twice.
  //
  // A multi-product invoice is fulfilled as ONE TRANSACTION PER UNIT — that
  // is what gives each unit its own licence, serial and delivery stamp — and
  // those units reference the invoice as "<invoice id>#<line>.<unit>". The
  // old check compared the reference to the invoice id whole, so none of
  // them matched and a two-package sale drew a "Paid" separator for every
  // unit AND the invoice's own settled line: three lines for one payment.
  // Matching on the reference's invoice part fixes that for any number of
  // units, in any catalogue.
  const invIds = new Set((invoices || []).map(i => String(i.id)));
  const refInvoiceId = refInvoiceIdOf;

  // Whatever is left is a payment with no invoice behind it (recorded by
  // hand, or taken out of band). Those still arrive in batches, so they are
  // grouped as well: by the invoice they reference when they name one, and
  // otherwise by where they land in the thread, so several payments recorded
  // together read as one line instead of a stack of near-identical ones.
  const txGroups = new Map();
  (Array.isArray(data.transactions) ? data.transactions : []).forEach(t => {
    if (!t) return;
    if (t.reference && invIds.has(refInvoiceId(t.reference))) return;
    const ts = Number(t.created_ts) || euParseTs(t.created_at);
    if (!ts) return;
    const st = String(t.status || 'completed');
    const boundary = Math.max(0, after(idxAtOrBefore(ix, ts, 'any')));
    const cur = String(t.currency || '').toUpperCase();
    const base = t.reference ? refInvoiceId(t.reference) : '';
    const key = base
      ? `r:${base}:${st}`
      : `b:${boundary}:${st}:${cur}:${Math.floor(ts / 300000)}`;
    let g = txGroups.get(key);
    if (!g) { g = { key, boundary, ts, st, cur, rows: [] }; txGroups.set(key, g); }
    g.rows.push(t);
    if (ts < g.ts) g.ts = ts;                 // the group happened when the first of them did
    g.boundary = Math.min(g.boundary, boundary);
  });

  txGroups.forEach(g => {
    const tone = g.st === 'pending' ? 'pending' : (g.st === 'failed' || g.st === 'refunded') ? 'failed' : 'paid';
    // One figure for the group. Units of one sale each carry their slice of
    // the total, so the sum is what the customer actually paid.
    let total = 0, summable = true;
    g.rows.forEach(t => { const n = parseFloat(t.amount); if (isFinite(n)) total += n; else summable = false; });
    const amount = summable
      ? `${total.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${g.cur}`.trim()
      : String(g.rows[0].amount || '').trim();
    // Names collapse the same way an invoice's do: repeats become "×2",
    // shared words are factored out, and a long tail is counted.
    const merged = [];
    g.rows.forEach(t => {
      const nm = String(t.product_name || '').trim();
      if (!nm) return;
      const hit = merged.find(m => m.name.toLowerCase() === nm.toLowerCase());
      if (hit) hit.qty++; else merged.push({ name: nm, qty: 1 });
    });
    const what = compactItemList(merged, { max: 3 });
    const refs = [...new Set(g.rows.map(t => refInvoiceId(t.reference)).filter(Boolean))];
    add(g.boundary, 0, {
      key: `tx:${g.key}`, type: 'payment', ts: g.ts,
      rank: tone === 'paid' ? 85 : tone === 'pending' ? 80 : 75, ink: MOMENT_INK[tone],
      meta: g.st === 'pending' ? 'Payment pending' : g.st === 'refunded' ? 'Refunded'
          : g.st === 'failed' ? 'Payment failed' : 'Paid',
      label: what ? `${amount} · ${what}` : amount,
      details: [
        g.rows.length > 1 ? `${g.rows.length} items` : '',
        merged.length > 1 ? compactItemList(merged, { max: 24 }) : '',
        refs.length ? `Ref ${refs.join(', ')}` : '',
        g.rows.map(t => t.notes || '').filter(Boolean).join(' · '),
      ].filter(Boolean),
      time: euAgo(g.ts),
    });
  });

  // SETTLED INVOICES — an open invoice follows the newest messages (see
  // useInvoiceFollowers); once it settles it stays where that happened.
  // Keyed on the INVOICE part of the reference, not the whole thing. A
  // multi-unit sale references "<invoice id>#<line>.<unit>", so an exact-id
  // lookup found nothing and an invoice confirmed without its own
  // confirmed_at stamp had no settle time at all — it was dropped, and the
  // only trace of the sale was the per-unit lines this same fix removes.
  // The earliest unit wins: that is when the money actually landed.
  const txByRef = txByInvoiceRef(data.transactions);
  (invoices || []).forEach(inv => {
    if (inv.status === 'pending') return;
    const at = invSettledAt(inv, txByRef);
    if (!at) return;
    const paid = inv.status === 'confirmed';
    const product = invProduct(inv);
    const fiat = invFiat(inv) || invCrypto(inv, paid);
    add(Math.max(0, after(idxAtOrBefore(ix, at, 'any'))), 0, {
      key: `inv:${inv.id}:${inv.status}`, invId: String(inv.id), type: 'invoice', ts: at,
      settled: true, rank: paid ? 86 : 44, ink: paid ? MOMENT_INK.paid : MOMENT_INK.muted,
      meta: paid ? 'Paid' : inv.status === 'cancelled' ? 'Invoice cancelled' : 'Invoice expired',
      label: [fiat, product].filter(Boolean).join(' · ') || `Invoice ${invShortRef(inv)}`,
      details: invDetails(inv),
      time: euAgo(at),
    });
  });

  // ESCALATION — the hand-over, with the resolve action.
  const hasEsc = Object.prototype.hasOwnProperty.call(data, 'escalation');
  const esc = hasEsc ? data.escalation
    : ((data.end_user && data.end_user.escalation) || (conv && conv.escalation) || null);
  const unassignReason = conv && !conv.agent_id ? String(conv.unassignReason || '') : '';
  let unassignFolded = false;
  if (esc && esc.raised_at) {
    const raised = euParseTs(esc.raised_at);
    const pending = String(esc.status || '') === 'pending';
    const meta = (esc.kind === 'refund' || esc.reason === 'refund_request') ? 'Refund requested'
      : (esc.kind === 'help' || esc.reason === 'help_request') ? 'Needs you' : 'Handed to you';
    const message = esc.message
      || (esc.reason === 'refund_request' ? 'Customer asked about a refund'
        : esc.reason === 'help_request' ? 'Outside what the AI can handle'
        : 'The AI handed this conversation to you');
    // The escalation's own unassign ("Escalated to you — …") says the same
    // thing, so it rides on this line instead of drawing a second one.
    if (pending && /^escalated\b/i.test(unassignReason)) unassignFolded = true;
    const rIdx = esc.raised_msg_id ? anchorIndex(ix, { id: esc.raised_msg_id, ts: raised, role: 'any' })
      : idxAtOrBefore(ix, raised, 'any');
    // Raised on a customer message → below the hand-over reply to it, once
    // that reply has gone out. Raised by the operator after a reply → there.
    const rHeld = rIdx >= 0 && ix.thread[rIdx].r === 'in' && heldBack(rIdx);
    const rBoundary = rIdx < 0 ? -1 : (ix.thread[rIdx].r === 'in' ? afterTurn(ix, rIdx) : rIdx + 1);
    // A hand-over that is STILL OPEN does not belong in the middle of the
    // thread. It was drawn at the message that caused it, which means three
    // more customer messages and it has scrolled out of sight — while the
    // thing it is telling you (the AI is muted, nobody is covering this) is
    // still true right now. So while it is pending it renders as a follower
    // under the newest message instead (buildEscalationFollower below), and
    // settles into this spot the moment it is resolved.
    if (raised && rIdx >= 0 && !rHeld && !pending) {
      add(rBoundary, 0, {
        key: `esc:${raised}`, flipKey: `esc:${convId}`, type: 'escalation', ts: raised,
        rank: 48, ink: MOMENT_INK.escalation,
        meta, label: momentHeadline(message),
        full: momentHeadline(message) !== message ? message : undefined,
        details: ['Resolved since'],
        time: euAgo(raised),
        locate: (() => {
          const t = bubbleTarget(ix, rIdx);
          return t ? () => jumpToBubble(convId, t) : undefined;
        })(),
      });
    }
    const resolved = euParseTs(esc.resolved_at);
    if (!pending && resolved) {
      const vIdx = esc.resolved_msg_id ? anchorIndex(ix, { id: esc.resolved_msg_id, ts: resolved, role: 'any' })
        : idxAtOrBefore(ix, resolved, 'any');
      if (vIdx >= 0) {
        add(vIdx + 1, 0, {
          key: `esc-res:${resolved}`, type: 'escalation', ts: resolved, rank: 48,
          ink: MOMENT_INK.resolution, meta: 'Resolved', label: 'AI resumed', time: euAgo(resolved),
        });
      }
    }
  }

  // AGENT STEPPED BACK — only while it's still true (no agent on, a reason
  // recorded), and at the moment it happened. Older servers that don't send
  // the time keep the old place at the foot of the thread.
  if (unassignReason && !unassignFolded) {
    const raw = Number(conv.unassignAt || 0);
    const at = raw ? (conv._unassignAtLocal ? euServerTime(raw) : raw) : 0;
    const b = at ? Math.max(0, after(idxAtOrBefore(ix, at, 'any'))) : ix.n;
    add(b, 0, {
      key: `un:${raw || 'foot'}`, type: 'agent', ts: at || Date.now(), rank: 58,
      ink: MOMENT_INK.agent, meta: 'AI unassigned',
      label: momentHeadline(unassignReason.replace(/^escalated (to|by) you\s*[—-]\s*/i, '')),
      full: unassignReason.replace(/^escalated (to|by) you\s*[—-]\s*/i, ''),
      details: ['Assign an agent to resume replies'],
      time: at ? euAgo(at) : '',
    });
  }
  return items;
};

// ── buildEscalationFollower ───────────────────────────────────────────
// The open hand-over, as a line that follows the newest message rather than
// sitting where it was raised. Same source as the escalation moment, so the
// two can never disagree — the only difference is where it is drawn and
// that this one carries the action.
//
// It reads one rank above the open-invoice line on purpose: an unpaid
// invoice is waiting on the customer, an open escalation is waiting on YOU.
// That is also why it is drawn BELOW the invoice line — last thing above
// the composer, closest to the reply box, so it is the thing your eye lands
// on before you start typing.
//
// `time` is deliberately NOT baked in here; ThreadFollowers recomputes it on
// its own tick so "12m ago" doesn't quietly go stale on a chat left open.
const buildEscalationFollower = (data, convId, conv) => {
  const d = data || {};
  const hasEsc = Object.prototype.hasOwnProperty.call(d, 'escalation');
  const esc = hasEsc ? d.escalation
    : ((d.end_user && d.end_user.escalation) || (conv && conv.escalation) || null);
  if (!esc || !esc.raised_at) return null;
  if (String(esc.status || '') !== 'pending') return null;
  const raised = euParseTs(esc.raised_at);
  if (!raised) return null;
  // The operator clicked resolve in this session and the conversations list
  // hasn't caught up. Drop the line immediately rather than leaving a
  // resolved escalation nagging from the foot of the thread.
  try {
    const o = (typeof window !== 'undefined' && window.__bcEscResolvedNow) || {};
    if (convId && o[convId]) return null;
  } catch (_) {}
  const unassigned = !!(conv && !conv.agent_id);
  const meta = (esc.kind === 'refund' || esc.reason === 'refund_request') ? 'Refund requested'
    : (esc.kind === 'help' || esc.reason === 'help_request') ? 'Needs you' : 'Handed to you';
  const label = esc.message
    || (esc.reason === 'refund_request' ? 'Customer asked about a refund'
      : esc.reason === 'help_request' ? 'Outside what the AI can handle'
      : 'The AI handed this conversation to you');
  return {
    key: `escf:${raised}`,
    // Remembered spot for the FLIP: when this resolves, the settled line in
    // the thread glides out of wherever this one was standing.
    flipKey: `esc:${convId}`,
    type: 'escalation', ts: raised, attention: true, rank: 100,
    ink: MOMENT_INK.escalation, meta, label: momentHeadline(label),
    full: momentHeadline(label) !== label ? label : undefined,
    details: [unassigned ? 'AI paused and unassigned' : 'AI paused'],
    primary: euIsDemo() ? null : {
      label: 'Resolve & resume AI', busyLabel: 'Resolving…',
      run: () => resolveConversationEscalation(convId),
    },
    // No thread here (this line doesn't depend on history), so it asks by
    // the server id the escalation was raised on; the chat resolves that
    // exactly and only falls back to time when the id isn't in the thread.
    locate: () => jumpTo({ convId, ts: raised, role: 'in', match: 'before',
      target: Number(esc.raised_msg_id || 0) > 0 ? { id: Number(esc.raised_msg_id) } : null }),
  };
};

// ── Combining ─────────────────────────────────────────────────────────
// The thread is the conversation; these lines are margin notes on it, and
// they only stay useful while there are few of them. Three rules keep them
// that way, none of them tied to any particular wording:
//
//   1. ONE LINE PER GAP. Everything that lands between the same two bubbles
//      merges into a single line: the most important entry is spelled out,
//      the rest is a quiet "+N" whose hover card lists every one of them.
//      Two separators are never stacked on top of each other.
//
//   2. EVERYTHING WHERE IT HAPPENED. Nothing is folded into an earlier
//      line (that filed later events under older separators and made the
//      thread read out of order). Noise is removed at the source instead:
//      only what the thread proves, and only what is worth a glance.
//
//   3. NO RESTATING. An entry that says nothing another line doesn't
//      already say ("Note · Interested in Gold" beside "Considering ·
//      Gold") is dropped — within a gap, and for routine notes, anywhere
//      in the thread.

const momentIsQuiet = (e) => !!(e && e.quiet && !e.attention);

// Words that only say what KIND of line something is — they carry no
// subject matter, so they don't count when comparing two lines' content.
const MOMENT_FILLER = noteTokens(
  'interest interested interesting consider considering considered show shown showing showed ' +
  'look looking looked buy buying bought purchase purchased pay paying ready option options ' +
  'listed offered presented passed mention note topic question discuss discussed discussing ' +
  'talk talked talking inquire inquired enquire enquired curious');
const momentCore = (e) => {
  const out = new Set();
  if (!e) return out;
  noteTokens(`${typeof e.label === 'string' ? e.label : ''} ${e.full || ''}`)
    .forEach(t => { if (!MOMENT_FILLER.has(t)) out.add(t); });
  return out;
};
// Is `a` fully said by `b`? Only QUIET entries are ever dropped this way:
// a payment, a hand-over or a flag always keeps its place on the line.
const momentRestates = (a, b, ca, cb) => {
  if (!a || !b || a === b || !momentIsQuiet(a)) return false;
  if (!ca.size) return false;
  for (const t of ca) if (!cb.has(t)) return false;
  return true;
};
const momentByImportance = (a, b) =>
  ((b.attention ? 1 : 0) - (a.attention ? 1 : 0))
  || ((momentIsQuiet(a) ? 1 : 0) - (momentIsQuiet(b) ? 1 : 0))
  || ((b.rank || 0) - (a.rank || 0))
  || ((a.ts || 0) - (b.ts || 0));
const momentByTime = (a, b) => (a.phase - b.phase) || ((a.ts || 0) - (b.ts || 0)) || ((b.rank || 0) - (a.rank || 0));

// Keeps the most informative version of anything said twice. Compared
// pairwise, so the order entries arrive in doesn't matter: an entry goes
// when another one says everything it says; when two say exactly the same
// thing, the more important one stays. `against` are entries already on
// the line (never dropped here).
const dedupeMoments = (list, against = []) => {
  const seen = new Set(against.map(x => x.key));
  const uniq = [];
  list.slice().sort(momentByImportance).forEach(e => {
    if (!e || seen.has(e.key)) return;
    seen.add(e.key);
    uniq.push(e);
  });
  const pool = against.concat(uniq);
  const cores = new Map(pool.map(e => [e, momentCore(e)]));
  return uniq.filter(a => !pool.some(b => {
    if (b === a) return false;
    const ca = cores.get(a), cb = cores.get(b);
    if (!momentRestates(a, b, ca, cb)) return false;
    // Identical content: only the less important copy goes.
    if (ca.size === cb.size) return against.includes(b) || momentByImportance(b, a) < 0;
    return true;
  }));
};

const buildChatMoments = (data, thread, convId, conv, invoices, busy) => {
  const rows = new Map();
  let items = collectMomentItems(data, thread, convId, conv, invoices, busy);
  if (!items.length) return rows;

  // NO RESTATING, ACROSS THE WHOLE THREAD. A routine note that says nothing
  // a product, payment or chapter line elsewhere doesn't already say
  // ("Interested in Gold" when "Considering · Gold" is drawn) is dropped
  // wherever it sits — not only when the two happen to share a gap.
  // Flags, payments and hand-overs are never dropped this way.
  const cores = new Map(items.map(e => [e, momentCore(e)]));
  items = items.filter(a => {
    if (a.type !== 'note' || !momentIsQuiet(a)) return true;
    const ca = cores.get(a);
    return !items.some(b => b !== a && b.type !== 'note' && momentRestates(a, b, ca, cores.get(b)));
  });

  const byBoundary = new Map();
  items.forEach(it => {
    if (!byBoundary.has(it.boundary)) byBoundary.set(it.boundary, []);
    byBoundary.get(it.boundary).push(it);
  });
  // One line per gap, in thread order. Nothing is folded into a line
  // ABOVE where it happened any more: that used to file a later "Shown"
  // or note under an earlier separator, so the thread read out of order.
  // The filtering in collectMomentItems is what keeps the count down now.
  [...byBoundary.keys()].sort((a, b) => a - b).forEach(boundary => {
    const own = dedupeMoments(byBoundary.get(boundary));
    if (!own.length) return;
    const primary = own[0];
    const extras = dedupeMoments(own.slice(1), [primary]).sort(momentByTime);
    rows.set(boundary, {
      key: `mo:${boundary}`, boundary, primary, extras,
      itemKeys: byBoundary.get(boundary).map(x => x.key),
    });
  });
  return rows;
};

// Re-render when this conversation's invoices change.
const useConvInvoices = (convId) => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    if (typeof PAYMENTS_STORE === 'undefined' || !PAYMENTS_STORE.sub) return;
    return PAYMENTS_STORE.sub(force);
  }, []);
  const list = invoicesForConv(convId);
  const sig = list.map(i => [i.id, i.status, i.confirmations || 0, i.confirmed_at || 0, i.cancelled_at || 0,
    i.expired_at || 0, i.amount_fiat, i.amount_coin || '', i.description || ''].join(':')).join('|');
  // Stable array identity while nothing relevant changed.
  const ref = React.useRef({ sig: null, list: [] });
  if (ref.current.sig !== sig) ref.current = { sig, list };
  return ref.current;
};

// Per-conversation record of moment keys already on screen, so only
// moments that appear while you're watching get the entrance motion.
const _momentSeen = new Map();   // convId → Set<key>

// opts (direct chats, whose messages live in DM_STORE rather than
// MSGS_STORE and whose agent runs in DM_AI):
//   hydrated — the thread's history has loaded
//   busy     — the agent is still answering (reading, writing, a draft open)
const useChatMoments = (convId, thread, data, openedAt, conv, opts) => {
  const o = opts || {};
  const inv = useConvInvoices(convId);
  // Nothing is placed against the preview bubble a chat shows before its
  // history arrives — that was the stack of separators that flashed up and
  // then jumped once the real messages loaded.
  const hydrated = o.hydrated != null ? !!o.hydrated
    : !!(typeof MSGS_STORE !== 'undefined' && MSGS_STORE._hydrated && MSGS_STORE._hydrated.has(convId));
  const ready = Array.isArray(thread) && thread.some(m => m && m.ts) && (hydrated || euIsDemo());
  const c = conv || {};
  // Is the AI still answering? Status covers reading → typing; an open
  // draft covers a reply queued for the operator or between chunks.
  let draftOpen = false;
  try { draftOpen = !!(typeof DRAFT_STORE !== 'undefined' && DRAFT_STORE.drafts && DRAFT_STORE.drafts.has(convId)); } catch (_) {}
  const busy = o.busy != null ? !!o.busy : (AI_TURN_BUSY.has(String(c.ai || '')) || draftOpen);
  const map = React.useMemo(
    () => (ready ? buildChatMoments(data, thread, convId, c, inv.list, busy) : new Map()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, busy, data, thread, convId, inv.sig, c.agent_id, c.unassignReason, c.unassignAt,
     c.escalation && c.escalation.status, c.escalation && c.escalation.raised_at]
  );
  // Stable identities, so the chat's memoized rows don't rebuild on renders
  // where nothing here changed.
  const followers = React.useMemo(
    () => (ready ? inv.list.filter(i => i.status === 'pending') : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, inv.sig]
  );
  // The open hand-over, if there is one. Not gated on `ready`: the moments
  // need a hydrated thread to have somewhere to attach, but this line
  // attaches to the foot of the thread and is the single most important
  // thing on the screen when it applies — it should not wait on history.
  const escalation = React.useMemo(
    () => buildEscalationFollower(data, convId, c),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, convId, c.agent_id, c.escalation && c.escalation.status,
     c.escalation && c.escalation.raised_at]
  );

  const seen = _momentSeen.get(convId) || new Set();
  if (!_momentSeen.has(convId)) _momentSeen.set(convId, seen);
  const lastConvRef = React.useRef(convId);
  const switching = lastConvRef.current !== convId;
  // Item keys that just appeared while watching. Worked out once per set of
  // moments: after the first render they're all in `seen`, and the entrance
  // animation has already played on the elements that carry the flag.
  const fresh = React.useMemo(() => {
    const out = new Set();
    if (switching) return out;
    map.forEach(row => [row.primary].concat(row.extras).forEach(e => {
      if (seen.has(e.key)) return;
      // Server-time stamps vs the browser-time open moment.
      if ((e.ts || 0) >= euServerTime(openedAt || 0) - 1500) out.add(e.key);
    }));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, switching]);
  React.useEffect(() => {
    lastConvRef.current = convId;
    map.forEach(row => row.itemKeys.forEach(k => seen.add(k)));
  });
  return { map, fresh, followers, escalation };
};

// ── Styles (injected once) ────────────────────────────────────────────
// Separators are margin notes on the conversation, so they are drawn at
// the lowest contrast that is still readable: a hairline that fades in
// from the edges, a 4px ink dot, the kind in its own muted colour and the
// text in the thread's quietest grey. Colour and contrast only arrive
// when the pointer does.
const ensureMomentStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-moment-style-v2')) return;
  const prevStyle = document.getElementById('bc-moment-style');
  if (prevStyle) prevStyle.remove();
  const s = document.createElement('style');
  s.id = 'bc-moment-style-v2';
  s.textContent = `
.bc-seps { --ease: cubic-bezier(.32,.72,0,1); display: flex; flex-direction: column; margin: 8px 0 10px; padding: 0 6px; }
.bc-sep { position: relative; display: flex; align-items: center; gap: 10px; min-height: 18px; }
.bc-sep-rule { flex: 1 1 24px; min-width: 12px; height: 1px; transform-origin: center;
  background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.05) 100%); }
.bc-sep-rule.r { background: linear-gradient(270deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.05) 100%); }
.bc-sep[data-follow="1"] .bc-sep-rule {
  background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--ink) 24%, transparent) 0 2px, transparent 2px 6px);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 75%); mask-image: linear-gradient(90deg, transparent, #000 75%); }
.bc-sep[data-follow="1"] .bc-sep-rule.r {
  -webkit-mask-image: linear-gradient(270deg, transparent, #000 75%); mask-image: linear-gradient(270deg, transparent, #000 75%); }

.bc-sep-body { flex: 0 1 auto; min-width: 0; max-width: min(${SEP_BODY_MAX}px, 100%); box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 6px; height: 18px; padding: 0 7px; border-radius: 9px;
  font-size: 10.5px; line-height: 18px; letter-spacing: 0.005em; white-space: nowrap;
  color: rgba(186,190,210,0.44); outline: none; transition: color .16s ease, background-color .16s ease; }
.bc-sep-body[data-click="1"] { cursor: pointer; }
.bc-sep-body[data-click="1"]:hover, .bc-sep-body[data-tip="1"]:hover, .bc-sep-body:focus-visible {
  color: rgba(222,225,240,0.8); background: rgba(255,255,255,0.035); }
.bc-sep-body:focus-visible { box-shadow: 0 0 0 1px rgba(140,130,255,0.45); }
.bc-sep-dot { flex-shrink: 0; width: 4px; height: 4px; border-radius: 50%; background: var(--ink); opacity: .75; }
.bc-sep-meta { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font-weight: 500; color: var(--ink); opacity: .72; transition: opacity .16s ease; }
.bc-sep-body:hover .bc-sep-meta, .bc-sep-body:focus-visible .bc-sep-meta { opacity: .95; }
.bc-sep-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.bc-sep-more { flex-shrink: 0; box-sizing: border-box; height: 14px; padding: 0 5px; border-radius: 7px;
  font-size: 9.5px; font-weight: 500; line-height: 14px; letter-spacing: 0.01em; font-variant-numeric: tabular-nums;
  color: rgba(186,190,210,0.58); background: rgba(255,255,255,0.045); transition: color .16s ease, background-color .16s ease; }
.bc-sep-more[data-strong="1"] { color: color-mix(in srgb, var(--more-ink) 80%, transparent);
  background: color-mix(in srgb, var(--more-ink) 12%, transparent); }
.bc-sep-body:hover .bc-sep-more, .bc-sep-body:focus-visible .bc-sep-more { color: rgba(222,225,240,0.85); background: rgba(255,255,255,0.075); }

/* The action reads as part of the line, not a badge on it. */
.bc-sep-act { all: unset; box-sizing: border-box; position: relative; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 5px; height: 18px; margin-left: -4px; padding: 0 6px 0 11px;
  cursor: pointer; font-size: 10.5px; font-weight: 500; line-height: 18px; white-space: nowrap;
  color: rgba(186,190,210,0.55); border-radius: 9px; transition: color .16s ease, background-color .16s ease; }
.bc-sep-act::before { content: ''; position: absolute; left: 0; top: 5px; bottom: 5px; width: 1px; background: rgba(255,255,255,0.09); }
.bc-sep-act svg { flex-shrink: 0; opacity: .75; transition: opacity .16s ease; }
.bc-sep-act:hover { color: rgba(142,224,168,0.95); }
.bc-sep-act:hover svg { opacity: 1; }
.bc-sep-act:focus-visible { box-shadow: 0 0 0 1px rgba(142,224,168,0.4); }
.bc-sep-act[aria-disabled="true"] { opacity: .6; cursor: default; }
.bc-sep-act[aria-disabled="true"]:hover { color: rgba(186,190,210,0.55); }
.bc-sep-act[aria-disabled="true"] svg { animation: bcSepSpin 1s linear infinite; }
@keyframes bcSepSpin { to { transform: rotate(360deg); } }

.bc-sep-tip { position: fixed; z-index: 9999; max-width: 300px; box-sizing: border-box;
  padding: 8px 12px; border-radius: 10px;
  background: rgba(19,21,38,0.96); backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 12px 34px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
  pointer-events: none; animation: bcSepTipIn .12s cubic-bezier(.16,1,.3,1) both; }
.bc-sep-tip-item + .bc-sep-tip-item { margin-top: 7px; padding-top: 7px; border-top: 1px solid rgba(255,255,255,0.06); }
.bc-sep-tip-meta { display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.02em;
  color: var(--ink, rgba(200,203,222,0.85)); }
.bc-sep-tip-meta::before { content: ''; width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: .8; flex-shrink: 0; }
.bc-sep-tip-time { margin-left: auto; padding-left: 10px; font-weight: 400; letter-spacing: 0; color: rgba(150,154,172,0.7); }
.bc-sep-tip-text { margin-top: 2px; font-size: 12px; line-height: 1.5; color: rgba(226,229,238,0.92); white-space: normal; word-break: break-word; }
.bc-sep-tip-detail { margin-top: 2px; font-size: 11px; line-height: 1.45; color: rgba(170,174,192,0.78); white-space: normal; word-break: break-word; }
.bc-sep-tip-rest { margin-top: 7px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 10.5px; color: rgba(150,154,172,0.75); }
@keyframes bcSepTipIn { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }

.bc-sep[data-attn="1"] .bc-sep-body { color: rgba(222,225,240,0.66); }
.bc-sep[data-attn="1"] .bc-sep-dot, .bc-sep[data-follow="1"] .bc-sep-dot { animation: bcSepBreathe 3.2s ease-in-out infinite; }
.bc-sep[data-follow="1"] .bc-sep-body { color: rgba(214,218,236,0.56); }

@keyframes bcSepBreathe { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ink) 35%, transparent); }
  50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink) 0%, transparent); } }
@keyframes bcSepIn   { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
@keyframes bcSepDraw { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
@keyframes bcSepSettle { 0% { box-shadow: 0 0 0 0 rgba(126,190,156,0.5); } 100% { box-shadow: 0 0 0 5px rgba(126,190,156,0); } }
.bc-sep[data-fresh="1"] .bc-sep-body { animation: bcSepIn .4s var(--ease) .05s both; }
.bc-sep[data-fresh="1"] .bc-sep-rule.l { transform-origin: right center; animation: bcSepDraw .5s var(--ease) both; }
.bc-sep[data-fresh="1"] .bc-sep-rule.r { transform-origin: left center;  animation: bcSepDraw .5s var(--ease) both; }
.bc-sep[data-fresh="1"][data-settled="1"] .bc-sep-body { animation: none; }
.bc-sep[data-fresh="1"][data-settled="1"] .bc-sep-rule { animation: none; }
.bc-sep[data-fresh="1"][data-settled="1"] .bc-sep-dot { animation: bcSepSettle .9s ease-out 2; }

.bc-sumcard { position: fixed; z-index: 9998; width: 300px; max-width: calc(100vw - 16px); box-sizing: border-box;
  padding: 9px 12px 11px; border-radius: 10px;
  background: rgba(16,17,28,0.97); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--ln2, rgba(255,255,255,0.10));
  box-shadow: 0 10px 32px -8px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.03) inset;
  transform-origin: top center; animation: bcSumIn .15s cubic-bezier(.16,1,.3,1) both; }
.bc-sumcard-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
  font-size: 11px; font-weight: 500; color: var(--t3, #6a6a86); letter-spacing: 0; }
.bc-sumcard-head svg { color: color-mix(in oklab, var(--acc, #6c63ff) 45%, #9a9ab0); flex-shrink: 0; }
.bc-sumcard-when { margin-left: auto; font-size: 10.5px; color: var(--t4, #4a4a66); font-weight: 400; font-variant-numeric: tabular-nums; }
.bc-sumcard-text { font-size: 12px; line-height: 1.55; color: rgba(214,216,228,0.88); letter-spacing: -0.003em;
  display: -webkit-box; -webkit-line-clamp: 8; -webkit-box-orient: vertical; overflow: hidden; }
.bc-sumcard-empty { font-size: 11.5px; line-height: 1.5; color: var(--t3, #6a6a86); }
@keyframes bcSumIn { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }

/* ── THE THREAD'S FOOTER ──────────────────────────────────────────────
   What is still open (unpaid invoices, an unanswered hand-over) follows
   the newest message as ONE line; the rest sits behind its "+N". An open
   hand-over is waiting on the OPERATOR and mutes the AI, so when it leads
   the line it gets a solid rule in its own ink and a legible action. */
.bc-seps-foot .bc-sep[data-attn="1"][data-follow="1"] .bc-sep-rule {
  background: linear-gradient(90deg, rgba(255,255,255,0) 0%, color-mix(in srgb, var(--ink) 30%, transparent) 100%);
  -webkit-mask-image: none; mask-image: none; }
.bc-seps-foot .bc-sep[data-attn="1"][data-follow="1"] .bc-sep-rule.r {
  background: linear-gradient(270deg, rgba(255,255,255,0) 0%, color-mix(in srgb, var(--ink) 30%, transparent) 100%); }
.bc-seps-foot .bc-sep[data-attn="1"][data-follow="1"] .bc-sep-body { color: rgba(226,229,240,0.8); }
.bc-seps-foot .bc-sep[data-attn="1"][data-follow="1"] .bc-sep-meta { opacity: 1; }
.bc-seps-foot .bc-sep[data-attn="1"][data-follow="1"] .bc-sep-act { color: rgba(214,218,236,0.72); }
.bc-seps-foot .bc-sep[data-attn="1"][data-follow="1"] { animation: bcSepFootIn .42s var(--ease) both; }
@keyframes bcSepFootIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .bc-seps *, .bc-seps-foot .bc-sep, .bc-sumcard, .bc-sep-tip { animation: none !important; transition: none !important; }
}`;
  document.head.appendChild(s);
};

// Coin tickers in AI-written text keep their coin colour (renderNoteInline).
const momentText = (e, text) => (e.coinText && typeof renderNoteInline === 'function') ? renderNoteInline(text) : text;

// ── Fitting a line to its width ───────────────────────────────────────
// A separator is one row. When its text is longer than the room it has,
// CSS alone cuts it mid-word ("Worried the licence won't tra…"). Instead
// the text is measured against the space that is actually free — the row
// minus the rules, the dot, the kind, the "+N" and any action — and cut at
// the last whole word that fits, without a dangling "and"/"with" before
// the ellipsis. Re-fitted whenever the row's width changes (window resize,
// side panel opening). The full text is always in the hover card, and the
// CSS ellipsis stays underneath as a last-resort safety net.
const SEP_BODY_MAX = 440;
const SEP_RULE_MIN = 12;
let _sepMeasureCtx = null;
const sepMeasure = (font, str) => {
  try {
    if (!_sepMeasureCtx) _sepMeasureCtx = document.createElement('canvas').getContext('2d');
    _sepMeasureCtx.font = font;
    return _sepMeasureCtx.measureText(str).width;
  } catch (_) { return str.length * 6; }
};
const SEP_TICKER = /\b(?:btc|eth|ltc|usdt|usdc|xmr|doge|sol|bch|trx|xrp|bnb|dai|matic|ada|dot)\b/gi;
const SEP_TAIL_WORD = /^(?:and|or|but|with|the|a|an|of|to|for|in|on|at|by|from|as|via|&|\+|vs\.?|·|-|–|—)$/i;
const fitSepLabel = (full, avail, font, coinText) => {
  // Coin tickers render a touch wider (mono, bold) — allow for it.
  const w = (s) => sepMeasure(font, s) + (coinText ? ((s.match(SEP_TICKER) || []).length * 3) : 0);
  if (!(avail > 0)) return { text: '', cut: true };
  if (w(full) <= avail) return { text: full, cut: false };
  const words = full.split(/\s+/).filter(Boolean);
  const build = (k) => {
    const parts = words.slice(0, k);
    while (parts.length > 1 && SEP_TAIL_WORD.test(parts[parts.length - 1])) parts.pop();
    const t = parts.join(' ').replace(/[\s,;:·/\-–—(+&]+$/, '');
    return t ? `${t}…` : '';
  };
  let lo = 1, hi = words.length - 1, best = '';
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = build(mid);
    if (t && w(t) <= avail) { best = t; lo = mid + 1; } else hi = mid - 1;
  }
  if (best) return { text: best, cut: true };
  // Even the first word doesn't fit. Below a few characters' worth of room
  // a fragment says nothing — the kind alone is shown and the hover has
  // the text.
  if (avail < 40) return { text: '', cut: true };
  const first = words[0] || '';
  let l = 1, h = first.length - 1, b = '';
  while (l <= h) {
    const m = (l + h) >> 1;
    const t = `${first.slice(0, m)}…`;
    if (w(t) <= avail) { b = t; l = m + 1; } else h = m - 1;
  }
  return { text: b, cut: true };
};

// ── One separator line ────────────────────────────────────────────────
// FLIP for invoices: an open invoice's line sits under the newest message;
// when it settles, a new line renders at the moment it settled. Its last
// measured spot is remembered per invoice so the settled line glides in
// from wherever the open one was — the "split off and stick".
const _invLineSpot = new Map();   // invoiceId (or a line's flipKey) → { top, at }
const invLineTop = (el) => {
  const body = el && el.closest && el.closest('.ipc-body');
  if (!body) return null;
  return el.getBoundingClientRect().top - body.getBoundingClientRect().top;
};

// entry     — the one entry spelled out on the line
// extras    — further entries merged into this line, shown as "+N"
// tipItems  — what the hover card lists, when that isn't [entry, ...extras]
// flipIds   — invoice/flip ids whose spot this line stands for
const SeparatorLine = ({ entry, extras, tipItems, flipIds, fresh, follow }) => {
  const e = entry;
  const extra = Array.isArray(extras) ? extras.filter(Boolean) : [];
  const moreN = extra.length;
  const strongExtra = extra.filter(x => !momentIsQuiet(x)).sort(momentByImportance)[0];
  const moreInk = strongExtra ? strongExtra.ink : '';
  const full = typeof e.label === 'string' ? e.label : '';
  const lineRef = React.useRef(null);
  const bodyRef = React.useRef(null);
  const [busy, setBusy] = React.useState(false);
  const [tipOpen, setTipOpen] = React.useState(false);
  const [fit, setFit] = React.useState(null);

  React.useLayoutEffect(() => {
    const row = lineRef.current, body = bodyRef.current;
    if (!row || !body || !full) { setFit(null); return; }
    let raf = 0, alive = true;
    const run = () => {
      if (!alive) return;
      const rowW = row.clientWidth;
      if (!rowW) return;
      const rs = getComputedStyle(row);
      const rowGap = parseFloat(rs.columnGap) || 0;
      const act = row.querySelector('.bc-sep-act');
      const actW = act ? act.getBoundingClientRect().width + rowGap : 0;
      const bodyMax = Math.min(SEP_BODY_MAX, rowW - 2 * (SEP_RULE_MIN + rowGap) - actW);
      const bs = getComputedStyle(body);
      const gap = parseFloat(bs.columnGap) || 0;
      let fixed = (parseFloat(bs.paddingLeft) || 0) + (parseFloat(bs.paddingRight) || 0);
      let n = 0;
      Array.from(body.children).forEach(ch => {
        if (ch.classList.contains('bc-sep-label')) return;
        // scrollWidth: the kind may be momentarily squeezed by an over-long
        // label on first paint; what it NEEDS is what counts.
        fixed += Math.ceil(Math.max(ch.getBoundingClientRect().width, ch.scrollWidth || 0));
        n++;
      });
      fixed += n * gap;
      const avail = Math.floor(bodyMax - fixed - 2);
      const font = `${bs.fontStyle} ${bs.fontWeight} ${bs.fontSize} ${bs.fontFamily}`;
      const r = fitSepLabel(full, avail, font, !!e.coinText);
      setFit(prev => (prev && prev.src === full && prev.text === r.text && prev.cut === r.cut)
        ? prev : { src: full, text: r.text, cut: r.cut });
    };
    run();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); });
      ro.observe(row);
    }
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(run); } catch (_) {}
    return () => { alive = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); };
  }, [full, moreN, busy, e.meta, !!e.primary, !!e.coinText]);

  const fitted = fit && fit.src === full;
  const shown = fitted ? fit.text : full;
  const cut = fitted ? fit.cut : false;

  React.useLayoutEffect(() => {
    // A line that stands for open invoices (or the open hand-over) records
    // its spot for each, so whichever settles glides out of it.
    const ids = flipIds || e.invIds || (e.invId ? [e.invId] : (e.flipKey ? [e.flipKey] : []));
    if (!ids.length) return;
    const el = lineRef.current;
    const top = invLineTop(el);
    if (top == null) return;
    const now = Date.now();
    if (!follow && ids.length === 1) {
      const prev = _invLineSpot.get(ids[0]);
      if (prev && prev.follow && now - prev.at < 90000 && Math.abs(prev.top - top) > 2
          && typeof el.animate === 'function'
          && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        try {
          el.animate([{ transform: `translateY(${prev.top - top}px)` }, { transform: 'none' }],
            { duration: 460, easing: 'cubic-bezier(.32,.72,0,1)' });
        } catch (_) {}
      }
    }
    ids.forEach(id => _invLineSpot.set(id, { top, at: now, follow: !!follow }));
  });

  const click = e.locate || null;
  const tipList = tipItems || [e].concat(extra);
  const hasTip = !!tipItems || moreN > 0 || cut || !!e.full;

  const runPrimary = async (ev) => {
    ev.stopPropagation();
    if (busy || !e.primary) return;
    setBusy(true);
    try { await e.primary.run(); } finally { setBusy(false); }
  };

  const openTip  = () => hasTip && setTipOpen(true);
  const closeTip = () => setTipOpen(false);

  return (
    <div ref={lineRef} className="bc-sep" style={{ '--ink': e.ink }}
      data-fresh={fresh ? '1' : undefined} data-attn={e.attention ? '1' : undefined}
      data-follow={follow ? '1' : undefined} data-settled={e.settled ? '1' : undefined}>
      <span className="bc-sep-rule l" aria-hidden="true"/>
      <div ref={bodyRef} className="bc-sep-body"
        data-click={click ? '1' : undefined}
        data-tip={hasTip ? '1' : undefined}
        role={click ? 'button' : undefined} tabIndex={0}
        aria-label={`${e.meta}${full ? `: ${e.full || full}` : ''}${moreN ? `, and ${moreN} more` : ''}`}
        onClick={click || undefined}
        onKeyDown={click ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); click(); } } : undefined}
        onMouseEnter={openTip} onMouseLeave={closeTip}
        onFocus={openTip} onBlur={closeTip}>
        <i className="bc-sep-dot" aria-hidden="true"/>
        <span className="bc-sep-meta">{e.meta}</span>
        {shown && <span className="bc-sep-label">{momentText(e, shown)}</span>}
        {moreN > 0 && (
          // Tinted when what it hides matters (a payment, a flag…), so an
          // important entry merged behind another is never invisible.
          <span className="bc-sep-more" aria-hidden="true"
            data-strong={moreInk ? '1' : undefined} style={moreInk ? { '--more-ink': moreInk } : undefined}>+{moreN}</span>
        )}
      </div>
      {e.primary && (
        <button type="button" className="bc-sep-act" aria-disabled={busy ? 'true' : undefined} onClick={runPrimary}>
          {busy ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
              strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          )}
          <span>{busy ? (e.primary.busyLabel || e.primary.label) : e.primary.label}</span>
        </button>
      )}
      <span className="bc-sep-rule r" aria-hidden="true"/>
      {hasTip && <SepTip open={tipOpen} anchorEl={bodyRef.current} items={tipList}/>}
    </div>
  );
};

// ── SepTip ───────────────────────────────────────────────────────────
// The hover card behind a line: every entry the line stands for, each in
// full, with when it happened. Only mounted on lines that hide something.
const SEP_TIP_MAX = 8;
const SepTip = ({ open, anchorEl, items }) => {
  const [pos, setPos] = React.useState(null);
  const cardRef = React.useRef(null);

  const place = React.useCallback(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const W = 300, GAP = 8, M = 8;
    const h = cardRef.current ? cardRef.current.offsetHeight : 50;
    const left = Math.max(M, Math.min(r.left, window.innerWidth - W - M));
    // Separators sit in the gap between two bubbles — prefer the card
    // above the line, falling back below when there isn't room there.
    if (r.top - GAP - h >= M) {
      setPos({ side: 'above', left: Math.round(left), top: Math.round(r.top - GAP - h) });
    } else {
      setPos({ side: 'below', left: Math.round(left), top: Math.round(r.bottom + GAP) });
    }
  }, [anchorEl]);

  React.useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
    const raf = requestAnimationFrame(place);   // re-measure with the real card height
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  if (!open || typeof document === 'undefined') return null;
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const shownItems = list.slice(0, SEP_TIP_MAX);
  const rest = list.length - shownItems.length;

  return ReactDOM.createPortal(
    <div ref={cardRef} className="bc-sep-tip" role="tooltip" data-side={pos ? pos.side : 'above'}
      style={{ left: pos ? pos.left : -9999, top: pos ? pos.top : -9999, visibility: pos ? 'visible' : 'hidden' }}>
      {shownItems.map((it, i) => {
        const text = it.full || it.label;
        return (
          <div className="bc-sep-tip-item" key={it.key || i} style={{ '--ink': it.ink }}>
            <div className="bc-sep-tip-meta">{it.meta}{it.time ? <span className="bc-sep-tip-time">{it.time}</span> : null}</div>
            {text && <div className="bc-sep-tip-text">{momentText(it, text)}</div>}
            {Array.isArray(it.details) && it.details.length > 0 &&
              <div className="bc-sep-tip-detail">{it.details.join(' · ')}</div>}
          </div>
        );
      })}
      {rest > 0 && <div className="bc-sep-tip-rest">and {rest} more</div>}
    </div>,
    document.body
  );
};

// ── ChatMomentRow ─────────────────────────────────────────────────────
// Everything that sits in one gap between bubbles — always ONE line.
// Only the spelled-out entry animates in: an entry that merely joins an
// existing line's "+N" must not replay that line's entrance.
const ChatMomentRow = React.memo(function ChatMomentRow({ row, fresh }) {
  ensureMomentStyles();
  if (!row || !row.primary) return null;
  const f = fresh || new Set();
  return (
    <div className="bc-seps">
      <SeparatorLine key={row.primary.key} entry={row.primary} extras={row.extras}
        fresh={f.has(row.primary.key)}/>
    </div>
  );
});

// ── Open invoices ─────────────────────────────────────────────────────
// Open invoices follow the newest message as a quiet reminder that money
// is outstanding. Each leaves the moment it settles and stays in the
// thread where that happened (collectMomentItems → SETTLED INVOICES).
// Returns the line's entry plus, for several invoices, the per-invoice
// entries its hover card lists.
const buildInvoiceFollower = (invoices) => {
  const list = Array.isArray(invoices) ? invoices : [];
  if (!list.length) return null;
  const sorted = list.slice().sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0));
  const detectedN = sorted.filter(inv => Number(inv.confirmations || 0) > 0).length;
  const perInvoice = sorted.map(inv => {
    const detected = Number(inv.confirmations || 0) > 0;
    const created = Number(inv.created || 0) * 1000;
    return {
      key: `invf:${inv.id}`, invId: String(inv.id), type: 'invoice', rank: 84,
      ink: detected ? MOMENT_INK.detected : MOMENT_INK.pending,
      meta: detected ? 'Payment detected' : 'Awaiting payment',
      label: [invFiat(inv) || invCrypto(inv), invProduct(inv)].filter(Boolean).join(' · ') || `Invoice ${invShortRef(inv)}`,
      full: [invFiat(inv) || invCrypto(inv), invProduct(inv, { full: true })].filter(Boolean).join(' · ') || undefined,
      details: sorted.length > 1 ? invDetails(inv).slice(0, 2) : invDetails(inv),
      time: created ? euAgo(created) : '',
    };
  });
  if (sorted.length === 1) return { entry: perInvoice[0], tipItems: undefined };
  // Several open at once read as ONE reminder: the total when they share a
  // currency, the count, and how many have money on the way.
  const fiats = new Set(sorted.map(inv => String(inv.fiat || 'USD').toUpperCase()));
  let total = '';
  if (fiats.size === 1) {
    const sum = sorted.reduce((acc, inv) => {
      const n = parseFloat(String(inv.amount_fiat == null ? '' : inv.amount_fiat).replace(/^[^0-9.]*/, ''));
      return isFinite(n) ? acc + n : NaN;
    }, 0);
    if (isFinite(sum) && sum > 0) total = invFiat({ amount_fiat: Math.round(sum * 100) / 100, fiat: [...fiats][0] });
  }
  const allDetected = detectedN === sorted.length;
  return {
    entry: {
      key: 'invf:group', invIds: sorted.map(inv => String(inv.id)), type: 'invoice', rank: 84,
      ink: allDetected ? MOMENT_INK.detected : MOMENT_INK.pending,
      meta: allDetected ? 'Payments detected' : 'Awaiting payment',
      label: [total, `${sorted.length} invoices`, (detectedN && !allDetected) ? `${detectedN} detected` : '']
        .filter(Boolean).join(' · '),
    },
    tipItems: perInvoice,
  };
};

// Kept for callers that render open invoices on their own.
const InvoiceFollowers = ({ invoices }) => {
  ensureMomentStyles();
  const f = buildInvoiceFollower(invoices);
  if (!f) return null;
  return <SeparatorLine key={f.entry.key} entry={f.entry} tipItems={f.tipItems} follow/>;
};

// ── ThreadFollowers ───────────────────────────────────────────────────
// Everything that trails the newest message: open invoices, the open
// hand-over, and whatever was just recorded under the last bubble (`tail`,
// e.g. "Paid" the moment an invoice settles). These all sit in the same
// place, so they are ONE line, never a stack:
//
//   • an open hand-over always leads — it is waiting on YOU, mutes the AI
//     and carries the action;
//   • otherwise the most important entry leads (a payment that just landed
//     outranks the reminder about another invoice still open);
//   • everything else is the "+N", listed in full in the hover card.
//
// When the next message arrives the tail entries stay where they happened
// (their own line above) and this line goes on following.
const ThreadFollowers = ({ invoices, escalation, tail, fresh }) => {
  ensureMomentStyles();
  const list = Array.isArray(invoices) ? invoices : [];
  // Hover times go stale on a chat left open; one timer keeps them honest.
  const [, tick] = React.useReducer(x => x + 1, 0);
  const alive = list.length > 0 || !!escalation;
  React.useEffect(() => {
    if (!alive) return;
    const iv = setInterval(tick, 30000);
    return () => clearInterval(iv);
  }, [alive]);
  if (!alive) return null;

  // euAgo is resolved here rather than where the entry was built, so the
  // relative time follows the tick above.
  const esc = escalation ? { ...escalation, time: escalation.ts ? euAgo(escalation.ts) : '' } : null;
  const inv = buildInvoiceFollower(list);
  const cands = [];
  if (esc) cands.push({ e: esc, follow: true });
  if (inv) cands.push({ e: inv.entry, follow: true, tip: inv.tipItems });
  if (tail && tail.primary) {
    [tail.primary].concat(tail.extras || []).forEach(t => cands.push({ e: t, follow: false }));
  }
  if (!cands.length) return null;
  cands.sort((a, b) => momentByImportance(a.e, b.e));
  const lead = cands[0];
  const rest = cands.slice(1);
  const expand = !!lead.tip || rest.some(c => c.tip);
  const tipItems = expand ? cands.reduce((acc, c) => acc.concat(c.tip || [c.e]), []) : undefined;
  let flipIds;
  if (lead.follow) {
    flipIds = [];
    cands.filter(c => c.follow).forEach(c => {
      const x = c.e;
      (x.invIds || (x.invId ? [x.invId] : [])).forEach(id => flipIds.push(id));
      if (x.flipKey) flipIds.push(x.flipKey);
    });
  }
  const f = fresh || new Set();

  return (
    <div className="bc-seps bc-seps-foot" aria-live="polite">
      <SeparatorLine key={lead.e.key} entry={lead.e} extras={rest.map(c => c.e)}
        tipItems={tipItems} flipIds={flipIds} follow={lead.follow}
        fresh={!lead.follow && f.has(lead.e.key)}/>
    </div>
  );
};

// ── ChatSummaryHover ──────────────────────────────────────────────────
// The AI summary for the open chat, shown on hover of the header identity
// pill. It always opens BELOW the pill, centred on it, so it never covers
// the agent bubble beside the pill (or anything else in the header).
const ChatSummaryHover = ({ open, anchorEl, avatarEl, data, onEnter, onLeave }) => {
  ensureMomentStyles();
  const [pos, setPos] = React.useState(null);
  const cardRef = React.useRef(null);

  const place = React.useCallback(() => {
    if (!anchorEl) return;
    const r  = anchorEl.getBoundingClientRect();
    const M = 8, GAP = 8;
    const W = Math.min(300, window.innerWidth - M * 2);
    const left = Math.max(M, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - M));
    setPos({ side: 'below', left: Math.round(left), top: Math.round(r.bottom + GAP) });
  }, [anchorEl, avatarEl]);

  React.useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
    const raf = requestAnimationFrame(place);   // re-measure with the real card height
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place, data]);

  if (!open || typeof document === 'undefined') return null;
  const summary = String((data && data.summary) || '').trim();
  const lt = (data && data.memory && data.memory.latest_thinking) || {};
  const updated = euParseTs(lt.updated_at);

  return ReactDOM.createPortal(
    <div ref={cardRef} className="bc-sumcard" role="tooltip"
      data-side="below"
      onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{
        left: pos ? pos.left : -9999, top: pos ? pos.top : -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}>
      <div className="bc-sumcard-head">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>
        </svg>
        Summary
        {summary && updated > 0 && <span className="bc-sumcard-when">{euAgo(updated)}</span>}
      </div>
      {summary
        ? <div className="bc-sumcard-text">{summary}</div>
        : <div className="bc-sumcard-empty">
            {data ? 'The AI writes a summary once the conversation gets going.' : 'Loading summary…'}
          </div>}
    </div>,
    document.body
  );
};

// ── resolveConversationEscalation ─────────────────────────────────────
// Same steps the popup's "Resolve & resume AI" banner button ran.
const resolveConversationEscalation = async (convId) => {
  if (!convId || euIsDemo()) return false;
  try {
    window.__bcEscResolvedNow = window.__bcEscResolvedNow || {};
    window.__bcEscResolvedNow[convId] = Date.now();
  } catch (_) {}
  try {
    const r = await apiFetch('resolve_escalation', { conv_id: convId, resume_ai: 1 });
    if (r && r.error) {
      try { delete window.__bcEscResolvedNow[convId]; } catch (_) {}
      bcToast('Couldn’t resolve the escalation — ' + r.error, 'err');
      return false;
    }
    try {
      if (typeof AI_REPLY_QUEUE !== 'undefined' && AI_REPLY_QUEUE.resumeAfterEscalation) {
        const res = AI_REPLY_QUEUE.resumeAfterEscalation(convId, {
          escalation: r && r.escalation,
          resumeAi: true,
          awaitingReply: r && typeof r.awaiting_reply === 'boolean' ? r.awaiting_reply : undefined,
        });
        if (res && !res.resumed) console.warn('[resolve] resume skipped:', res.reason);
      }
    } catch (e) { console.warn('[resolve] resume failed', e && e.message); }
    requestEndUserRefresh(convId);
    bcToast('Resolved — the agent is replying again', 'ok');
    return true;
  } catch (e) {
    try { delete window.__bcEscResolvedNow[convId]; } catch (_) {}
    bcToast('Network error — the escalation was not resolved', 'err');
    return false;
  }
};

// ── Customer mark (right-click menu) ──────────────────────────────────
// "Customer" is two fields on the server, and they move together exactly
// as they do when a payment confirms (conv_mark_customer in api.php):
//   bc_end_users.verified   — the verified tick
//   bc_conversations.stage  — which group the contact sits in
// An open escalation keeps its stage so a live problem isn't filed away
// under Customers; the verified flag still changes.
const isCustomerMarked = (conv) => {
  if (!conv) return false;
  if (conv.stage === 'customer' || conv.stage === 'vip') return true;
  const rec = EU_CACHE.get(conv.id);
  return !!(rec && rec.end_user && Number(rec.end_user.verified));
};

const setCustomerMark = async (convId, on) => {
  if (!convId) return false;
  const list = (typeof MSGS_STORE !== 'undefined' && MSGS_STORE.list) || [];
  const conv = list.find(m => m && m.id === convId);
  const prevStage = conv ? String(conv.stage || '') : '';
  const escalated = prevStage === 'escalated' || prevStage === 'needs_help';
  let nextStage = prevStage;
  if (on && !escalated && prevStage !== 'customer' && prevStage !== 'vip') nextStage = 'customer';
  if (!on && (prevStage === 'customer' || prevStage === 'vip')) nextStage = 'new';

  const applyStage = (st) => {
    if (!conv || conv.stage === st) return;
    conv.stage = st;
    MSGS_STORE.list = [...MSGS_STORE.list];
    MSGS_STORE.notify && MSGS_STORE.notify();
  };
  applyStage(nextStage);
  if (euIsDemo()) return true;

  try {
    // save_end_user writes every profile field, so start from the stored
    // record — otherwise marking someone would blank their email and notes.
    const rec = await apiGet('get_end_user', `&conv_id=${encodeURIComponent(convId)}`);
    if (!rec || rec.error) throw new Error((rec && rec.error) || 'could not load the contact');
    const eu = rec.end_user || {};
    const saved = await apiFetch('save_end_user', {
      conv_id: convId,
      name: eu.name || '', handle: eu.handle || '', email: eu.email || '',
      phone: eu.phone || '', notes: eu.notes || '',
      verified: on ? 1 : 0,
    });
    if (saved && saved.error) throw new Error(saved.error);
    if (nextStage !== prevStage) {
      const st = await apiFetch('update_stage', { id: convId, stage: nextStage });
      if (st && st.error) throw new Error(st.error);
    }
    EU_CACHE.set(convId, { ...rec, end_user: { ...eu, verified: on ? 1 : 0 } });
    requestEndUserRefresh(convId);
    bcToast(on ? 'Marked as customer' : 'Customer mark removed', 'ok', { detail: eu.name || undefined });
    return true;
  } catch (e) {
    applyStage(prevStage);
    bcToast('Couldn’t ' + (on ? 'mark as customer' : 'remove the customer mark') + ' — ' + (e && e.message ? e.message : 'network error'), 'err');
    return false;
  }
};