// ═══════════════════════════════════════════════════════════════════
//  BOT SCHEDULER — deferred execution of ghost actions
// ═══════════════════════════════════════════════════════════════════
//  Loaded after bot-stores.jsx (needs SCHEDULE_GATE for reply-hours
//  interop) and before bot-engine.jsx / bot-ui-views.jsx.
//
//  WHAT THIS IS
//  ------------
//  Anything the operator can ask the ghost to do right now, they can
//  also ask it to do later — "message Marco in 10 seconds", "escalate
//  Sarah tomorrow at 9", "send the invoice on the 1st of every month".
//  Customers in chat get a deliberately tiny slice of the same
//  machinery: they can ask to be written back to at a time, and
//  nothing else.
//
//  ARCHITECTURE (and why it looks like this)
//  -----------------------------------------
//  Sending a message requires window.BotBridge, which only exists
//  inside the desktop WebView2 shell. So the server CANNOT fire these
//  jobs itself — it has no route to Telegram/Discord. The split is:
//
//    SERVER  owns the queue (bc_scheduled_actions). It is the clock,
//            the authority on due-ness, the enforcer of every customer
//            limit, and the lock manager. It never executes.
//    CLIENT  owns execution. It leases due jobs, dispatches them back
//            through the exact same ghostActionHandler the live path
//            uses, and reports the outcome.
//
//  That means a job fires when at least one operator client is open.
//  Jobs that come due while everything is shut stay pending and are
//  caught up on next boot, subject to each job's lateness policy
//  (SCHED_POLICY.onLate) — a "good morning" message six hours late is
//  worse than no message at all, so some jobs deliberately expire.
//
//  Leasing (not just "SELECT ... WHERE due") is what stops two open
//  tabs from both sending the same message. See sched_claim in api.php.
//
//  MODULE MAP
//    SCHED_TIME     timezone-correct clock/calendar maths + NL parsing
//    SCHED_POLICY   what may be scheduled, by whom, how often
//    SCHED_STORE    queue mirror, CRUD, pub/sub
//    SCHED_RUNTIME  the tick loop: lease → dispatch → report
//    SchedulingCard the agent-popup UI
// ═══════════════════════════════════════════════════════════════════


// ── TIME ENGINE ──────────────────────────────────────────────────
// Everything here is timezone-aware and DST-correct. The rules that
// matter and are easy to get wrong:
//
//   • Absolute units (seconds, minutes, hours) are EXACT elapsed time.
//     "in 24 hours" across a spring-forward is 24 real hours, so the
//     wall clock reads an hour later than it did. Correct.
//   • Calendar units (days, weeks, months, years) preserve WALL CLOCK.
//     "in a day" from 3pm is 3pm tomorrow even if that day is 23 or 25
//     hours long. Also correct, and not the same thing.
//   That distinction is the whole reason this isn't just `+ n * 864e5`.
//
//   • A wall-clock time can be NON-EXISTENT (the hour skipped by
//     spring-forward) or AMBIGUOUS (the hour repeated by fall-back).
//     zonedToEpoch resolves the first forward to the gap edge and the
//     second to the EARLIER instant, then says which happened.
// ── ONE CLOCK ────────────────────────────────────────────────────
// The server decides when a job is due, on its own clock. This machine's
// clock can be seconds (or minutes) off from it, and every countdown and
// wake-up here used Date.now() — so the card could say "due now" while the
// server still considered the job 20 seconds away, or the other way round.
// schedNow() is Date.now() corrected by the offset measured on every
// sched_list / sched_claim round trip (see SCHED_STORE.noteServerNow).
const schedNow = () => {
  try { if (typeof SCHED_STORE !== 'undefined' && SCHED_STORE.now) return SCHED_STORE.now(); } catch (_) {}
  return Date.now();
};

const SCHED_TIME = {
  // Refuse to schedule further out than this. Guards against a parse
  // bug turning "in 5 minutes" into the year 4000 and parking a row in
  // the table forever.
  MAX_HORIZON_MS: 5 * 365.25 * 864e5,
  MIN_LEAD_MS: 1000,

  MS: { s: 1000, m: 60000, h: 3600000 },

  // ── timezone primitives ───────────────────────────────────────
  _dtfCache: new Map(),
  _dtf(tz) {
    const key = tz || '';
    if (this._dtfCache.has(key)) return this._dtfCache.get(key);
    let f;
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz || undefined, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch (_) {
      // Unknown zone — fall back to device local so we degrade to
      // "slightly wrong timezone" rather than "throws on every tick".
      f = new Intl.DateTimeFormat('en-US', {
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    }
    this._dtfCache.set(key, f);
    return f;
  },

  // Wall-clock parts for an instant, in a zone. wd = 0..6, Sun=0.
  partsAt(tz, epoch) {
    const parts = {};
    try {
      for (const p of this._dtf(tz).formatToParts(new Date(epoch))) {
        if (p.type !== 'literal') parts[p.type] = p.value;
      }
    } catch (_) {
      const d = new Date(epoch);
      return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(),
               h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(),
               wd: d.getDay() };
    }
    // Intl emits hour "24" for midnight under hour12:false in some
    // engines (a real, long-standing quirk) — normalise to 0 or the
    // day arithmetic below silently lands on the wrong date.
    let h = parseInt(parts.hour, 10); if (h === 24) h = 0;
    const o = {
      y: parseInt(parts.year, 10), mo: parseInt(parts.month, 10),
      d: parseInt(parts.day, 10), h,
      mi: parseInt(parts.minute, 10), s: parseInt(parts.second, 10),
    };
    o.wd = new Date(Date.UTC(o.y, o.mo - 1, o.d)).getUTCDay();
    return o;
  },

  // Offset (ms) of `tz` at a given instant. Positive east of UTC.
  offsetAt(tz, epoch) {
    const p = this.partsAt(tz, epoch);
    const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    return asUTC - Math.floor(epoch / 1000) * 1000;
  },

  _wallEquals(tz, epoch, p) {
    const b = this.partsAt(tz, epoch);
    return b.y === p.y && b.mo === p.mo && b.d === p.d &&
           b.h === p.h && b.mi === p.mi && b.s === (p.s || 0);
  },

  // Wall clock → instant. Returns {at, shifted, ambiguous}.
  //   shifted   — the time doesn't exist (DST gap); `at` is the instant
  //               the clock jumps to, i.e. the first real moment after.
  //   ambiguous — the time happens twice; `at` is the FIRST one.
  zonedToEpoch(tz, p) {
    const target = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s || 0);

    // Sample the zone's offset on BOTH sides of the instant, not just at
    // it. Converging by iteration alone finds only one answer, so a wall
    // time repeated by a fall-back looked unique and `ambiguous` never
    // fired. The ±26h probes straddle any transition, giving us both the
    // pre- and post-shift offsets to test.
    const offsets = [];
    for (const probe of [target - 26 * 36e5, target, target + 26 * 36e5]) {
      const o = this.offsetAt(tz, probe);
      if (offsets.indexOf(o) < 0) offsets.push(o);
    }
    // Keep the iterative result too — it is exact for the common case
    // and cheap insurance against a zone with a >26h oddity.
    const conv = target - this.offsetAt(tz, target - this.offsetAt(tz, target));
    const cands = offsets.map(o => target - o);
    if (cands.indexOf(conv) < 0) cands.push(conv);

    const valid = [];
    for (const c of cands) {
      if (this._wallEquals(tz, c, p) && valid.indexOf(c) < 0) valid.push(c);
    }
    if (valid.length) {
      // Ambiguous → the EARLIER instant. Anything else means a job set
      // for "1:30am" on a fall-back night fires an hour later than the
      // first time the clock actually reads 1:30.
      return { at: Math.min.apply(null, valid), shifted: false, ambiguous: valid.length > 1 };
    }
    // Non-existent (spring-forward gap): land on the first real instant
    // after the skipped span.
    return { at: Math.max.apply(null, cands), shifted: true, ambiguous: false };
  },

  // ── calendar arithmetic (wall-clock preserving) ───────────────
  _daysInMonth(y, mo) { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); },

  addCalendar(tz, epoch, { days = 0, months = 0, years = 0 }) {
    const p = this.partsAt(tz, epoch);
    let y = p.y + years;
    let mo = p.mo + months;
    y += Math.floor((mo - 1) / 12);
    mo = ((mo - 1) % 12 + 12) % 12 + 1;
    // Clamp before adding days: Jan 31 + 1 month is Feb 28/29, not Mar 3.
    let d = Math.min(p.d, this._daysInMonth(y, mo));
    if (days) {
      const base = Date.UTC(y, mo - 1, d) + days * 864e5;
      const bd = new Date(base);
      y = bd.getUTCFullYear(); mo = bd.getUTCMonth() + 1; d = bd.getUTCDate();
    }
    return this.zonedToEpoch(tz, { y, mo, d, h: p.h, mi: p.mi, s: p.s });
  },

  // Set wall-clock time-of-day on the date `epoch` falls in.
  atTimeOn(tz, epoch, minutes, sec = 0) {
    const p = this.partsAt(tz, epoch);
    return this.zonedToEpoch(tz, {
      y: p.y, mo: p.mo, d: p.d,
      h: Math.floor(minutes / 60) % 24, mi: minutes % 60, s: sec,
    });
  },

  startOfDay(tz, epoch) { return this.atTimeOn(tz, epoch, 0, 0); },

  resolveTz(raw) {
    try {
      if (typeof SCHEDULE_GATE !== 'undefined' && SCHEDULE_GATE.resolveTz) {
        const r = SCHEDULE_GATE.resolveTz(raw);
        if (r) return r;
      }
      if (raw && typeof SCHEDULE_GATE !== 'undefined' && SCHEDULE_GATE.isValidTz && SCHEDULE_GATE.isValidTz(raw)) return raw;
    } catch (_) {}
    if (raw) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: raw }); return raw; } catch (_) {}
    }
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; }
  },

  // ── duration / countdown formatting ───────────────────────────
  // "2d 4h", "1h 12m", "45s". Two units max — past that it's noise.
  humanizeMs(ms, opts = {}) {
    const abs = Math.abs(ms);
    if (abs < 1000) return opts.zero || 'now';
    const units = [
      ['y', 365.25 * 864e5], ['mo', 30.44 * 864e5], ['d', 864e5],
      ['h', 36e5], ['m', 6e4], ['s', 1e3],
    ];
    const out = [];
    let rem = abs;
    for (let i = 0; i < units.length && out.length < 2; i++) {
      const [label, size] = units[i];
      const n = Math.floor(rem / size);
      if (n > 0 || out.length) { if (n > 0) { out.push(n + label); rem -= n * size; } }
      else continue;
    }
    if (!out.length) out.push('0s');
    return out.join(' ');
  },

  // "in 1h 12m" / "3m 20s ago" / "due now"
  countdown(at, now = schedNow()) {
    const d = at - now;
    if (Math.abs(d) < 1000) return 'due now';
    return d > 0 ? 'in ' + this.humanizeMs(d) : this.humanizeMs(-d) + ' overdue';
  },

  // Absolute stamp in the job's own zone: "today 3:40 PM",
  // "Tue 9:00 AM", "25 Dec 2026, 9:00 AM".
  describeAt(at, tz, opts = {}) {
    const z = this.resolveTz(tz);
    const h12 = opts.h12 !== false;
    const p = this.partsAt(z, at);
    const nowP = this.partsAt(z, opts.now || Date.now());
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let hh = p.h, sfx = '';
    if (h12) { sfx = hh >= 12 ? ' PM' : ' AM'; hh = hh % 12; if (hh === 0) hh = 12; }
    const time = hh + ':' + String(p.mi).padStart(2, '0') + sfx;

    const dayStart = this.startOfDay(z, opts.now || Date.now()).at;
    const diffDays = Math.round((this.startOfDay(z, at).at - dayStart) / 864e5);
    if (diffDays === 0) return 'today ' + time;
    if (diffDays === 1) return 'tomorrow ' + time;
    if (diffDays === -1) return 'yesterday ' + time;
    if (diffDays > 1 && diffDays < 7) return DAY[p.wd] + ' ' + time;
    const sameYear = p.y === nowP.y;
    return DAY[p.wd] + ' ' + p.d + ' ' + MON[p.mo - 1] +
           (sameYear ? '' : ' ' + p.y) + ', ' + time;
  },
};

// ── NATURAL-LANGUAGE TIME PARSING ────────────────────────────────
// Bolted onto SCHED_TIME rather than living in its own object: it is
// useless without the DST-correct primitives above and they are the
// only thing it calls.
//
// Design notes worth knowing before editing:
//
//  • The LLM is ALLOWED to hand us a plain ISO instant (`at_iso`) and
//    usually should. This parser exists for (a) the operator typing
//    free text into the panel, (b) the model emitting a phrase it did
//    not resolve, (c) the customer path, where we deliberately do NOT
//    let the model pick the instant unsupervised.
//
//  • Everything resolves RELATIVE TO A ZONE. There is no such thing as
//    "9am" without one. Callers pass the operator's zone, or the
//    customer's when it is on record.
//
//  • Bare clock times are meridiem-ambiguous ("at 9"). Rather than
//    guess silently we pick the NEXT occurrence of either reading and
//    flag `ambiguousMeridiem`, so the ghost can confirm in its reply
//    instead of quietly scheduling something for 9pm.
Object.assign(SCHED_TIME, {

  _NUM_WORDS: {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45,
    fifty: 50, sixty: 60, ninety: 90, couple: 2, few: 3, several: 3,
    dozen: 12, half: 0.5, quarter: 0.25,
  },

  // Canonical unit → {kind, size}. `kind:'abs'` is exact elapsed time,
  // `kind:'cal'` preserves wall clock. See the header on SCHED_TIME.
  _UNITS: [
    [/^(?:seconds?|secs?|s)$/,                      { kind: 'abs', ms: 1000 }],
    [/^(?:minutes?|mins?|m)$/,                      { kind: 'abs', ms: 60000 }],
    [/^(?:hours?|hrs?|hr|h)$/,                      { kind: 'abs', ms: 3600000 }],
    [/^(?:days?|d)$/,                               { kind: 'cal', days: 1 }],
    [/^(?:weeks?|wks?|wk|w)$/,                      { kind: 'cal', days: 7 }],
    [/^(?:fortnights?)$/,                           { kind: 'cal', days: 14 }],
    [/^(?:months?|mons?|mos?|mo)$/,                 { kind: 'cal', months: 1 }],
    [/^(?:quarters?|qtrs?)$/,                       { kind: 'cal', months: 3 }],
    [/^(?:years?|yrs?|yr|y)$/,                      { kind: 'cal', years: 1 }],
  ],

  _DAYS: {
    sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3, weds: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5, saturday: 6, sat: 6,
  },
  _MONTHS: {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
    april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
    august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
    november: 11, nov: 11, december: 12, dec: 12,
  },
  // Named times of day, in minutes-from-midnight. These are product
  // decisions, not facts — "evening" meaning 6pm is a choice. Kept in
  // one table so they can be tuned without hunting through regexes.
  _DAYPARTS: {
    'first thing': 8 * 60, 'early morning': 7 * 60, morning: 9 * 60,
    noon: 12 * 60, midday: 12 * 60, lunch: 12 * 60 + 30,
    afternoon: 14 * 60, evening: 18 * 60, tonight: 20 * 60,
    night: 21 * 60, midnight: 0, eod: 17 * 60, cob: 17 * 60,
    'end of day': 17 * 60, 'close of business': 17 * 60,
  },

  _normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
      .replace(/\bhalf an hour\b/g, '30 minutes')
      .replace(/\bhalf a day\b/g, '12 hours')
      .replace(/\bquarter of an hour\b/g, '15 minutes')
      .replace(/\ba couple of\b/g, '2')
      .replace(/\ba few\b/g, '3')
      .replace(/\bthe day after tomorrow\b/g, 'in 2 days')
      .replace(/\bovermorrow\b/g, 'in 2 days')
      .replace(/\bfortnight\b/g, '2 weeks')
      .replace(/\bmidnight tonight\b/g, 'midnight')
      .replace(/[,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  _num(tok) {
    if (tok == null) return null;
    const s = String(tok).trim();
    if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
    if (Object.prototype.hasOwnProperty.call(this._NUM_WORDS, s)) return this._NUM_WORDS[s];
    return null;
  },

  // Alternation of every number word, LONGEST FIRST. Order is not
  // cosmetic: regex alternation is first-match-wins, so listing `a`
  // before `an` makes "an hour" match `a`, leave "n hour", and fail.
  _numAlt() {
    if (this._numAltCache) return this._numAltCache;
    const words = Object.keys(this._NUM_WORDS).sort((x, y) => y.length - x.length);
    this._numAltCache = '\\d+(?:\\.\\d+)?|' + words.join('|');
    return this._numAltCache;
  },

  _unit(tok) {
    const s = String(tok || '').trim();
    for (const [re, def] of this._UNITS) if (re.test(s)) return def;
    return null;
  },

  // "2d 4h 30m", "1 hour 30 minutes", "an hour", "90 mins"
  // Returns {abs:ms, cal:{days,months,years}} or null.
  _parseDuration(text) {
    const s = this._normalize(text);
    // Glued forms first: 1h30m, 2d4h
    const glued = s.match(/^(?:\d+(?:\.\d+)?\s*[a-z]+\s*)+$/);
    const re = new RegExp('(' + this._numAlt() + ')\\s*([a-z]+)', 'g');
    let m, found = false;
    const out = { abs: 0, cal: { days: 0, months: 0, years: 0 } };
    while ((m = re.exec(s)) !== null) {
      const n = this._num(m[1]);
      const u = this._unit(m[2]);
      if (n == null || !u) continue;
      found = true;
      if (u.kind === 'abs') out.abs += n * u.ms;
      else {
        // Fractional calendar units are meaningless ("half a month") —
        // degrade to an absolute approximation rather than rejecting.
        if (n % 1 !== 0) {
          const approxDay = 864e5, approxMo = 30.44 * 864e5, approxYr = 365.25 * 864e5;
          out.abs += n * ((u.days || 0) * approxDay + (u.months || 0) * approxMo + (u.years || 0) * approxYr);
        } else {
          out.cal.days   += (u.days   || 0) * n;
          out.cal.months += (u.months || 0) * n;
          out.cal.years  += (u.years  || 0) * n;
        }
      }
    }
    if (!found) return null;
    void glued;
    return out;
  },

  // "9am" / "21:30" / "9.30pm" / "noon" → minutes from midnight.
  // Returns {min, explicitMeridiem} or null.
  _parseClock(text) {
    const s = this._normalize(text);
    for (const key of Object.keys(this._DAYPARTS)) {
      if (new RegExp('\\b' + key.replace(/ /g, '\\s+') + '\\b').test(s)) {
        return { min: this._DAYPARTS[key], explicitMeridiem: true, daypart: key };
      }
    }
    // A bare number is NOT a time. "in 2 days", "every 2 hours" and
    // "15/01/2027" all contain digits that look like hours, and an
    // earlier version of this happily read "2 days" as 02:00. So a
    // candidate must carry one of three qualifiers: a meridiem, a
    // colon/dot minute part, or a leading "at".
    //
    // Slash dates are stripped first — "15/01" would otherwise satisfy
    // the colon-ish branch via its own separator on some inputs.
    const t = s.replace(/\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, ' ');

    const build = (h, mi, mer, explicit) => {
      if (mi > 59) return null;
      if (mer) {
        if (h > 12) return null;
        if (mer === 'am' && h === 12) h = 0;
        if (mer === 'pm' && h !== 12) h += 12;
        return { min: h * 60 + mi, explicitMeridiem: true };
      }
      if (h > 23) return null;
      return { min: h * 60 + mi, explicitMeridiem: explicit || h > 12 };
    };

    // 1. Explicit meridiem — "9am", "at 5:30 pm".
    let m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/);
    if (m) {
      const r = build(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0,
        m[3].replace(/\./g, '').toLowerCase(), true);
      if (r) return r;
    }
    // 2. Colon form — treated as 24h and therefore unambiguous. This is
    //    also the shape the model emits when it resolves a time itself.
    m = t.match(/\b(\d{1,2}):(\d{2})\b/);
    if (m) {
      const r = build(parseInt(m[1], 10), parseInt(m[2], 10), '', true);
      if (r) return r;
    }
    // 3. "at N" — but not when N is counting something ("at 2 days").
    m = t.match(/\bat\s+(\d{1,2})(?:[:.](\d{2}))?\b(?!\s*(?:s|m|h|d|w|y|sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|hr|hrs|day|days|week|weeks|month|months|year|years)\b)/);
    if (m) {
      const r = build(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, '', false);
      if (r) return r;
    }
    return null;
  },

  // ── recurrence ────────────────────────────────────────────────
  // "every day at 9", "every 2 hours", "weekly", "every mon and fri",
  // "on the 1st of every month". Returns a rule or null.
  _parseRecur(text, tz, clock) {
    const s = this._normalize(text);
    if (!/\b(every|each|daily|hourly|weekly|monthly|yearly|annually|recurring|repeat(?:ing|s)?)\b/.test(s)) return null;

    const atMin = clock ? clock.min : null;

    if (/\bhourly\b/.test(s)) return { kind: 'interval', ms: 36e5 };
    if (/\bdaily\b|\bevery\s+day\b/.test(s)) return { kind: 'daily', every: 1, atMin };
    if (/\bevery\s+other\s+day\b/.test(s)) return { kind: 'daily', every: 2, atMin };
    if (/\bweekly\b|\bevery\s+week\b/.test(s)) return { kind: 'weekly', every: 1, atMin, days: null };
    if (/\bmonthly\b|\bevery\s+month\b/.test(s)) return { kind: 'monthly', every: 1, atMin, dayOfMonth: null };
    if (/\b(?:yearly|annually)\b|\bevery\s+year\b/.test(s)) return { kind: 'yearly', every: 1, atMin };

    // "every weekday" / "every weekend"
    if (/\bevery\s+weekdays?\b/.test(s))  return { kind: 'weekly', every: 1, atMin, days: [1,2,3,4,5] };
    if (/\bevery\s+weekends?\b/.test(s))  return { kind: 'weekly', every: 1, atMin, days: [0,6] };

    // "every monday", "every mon and fri", "every tue, thu"
    const dayHits = [];
    for (const [name, idx] of Object.entries(this._DAYS)) {
      if (new RegExp('\\b' + name + '\\b').test(s) && !dayHits.includes(idx)) dayHits.push(idx);
    }
    if (dayHits.length) return { kind: 'weekly', every: 1, atMin, days: dayHits.sort() };

    // "every 2 hours" / "every 15 minutes" / "every 3 days"
    const iv = s.match(new RegExp('\\bevery\\s+(' + this._numAlt() + ')\\s*([a-z]+)'));
    if (iv) {
      const n = this._num(iv[1]); const u = this._unit(iv[2]);
      if (n != null && u) {
        if (u.kind === 'abs') return { kind: 'interval', ms: Math.max(60000, n * u.ms) };
        if (u.days)   return { kind: 'daily',   every: Math.max(1, Math.round(n * u.days)), atMin };
        if (u.months) return { kind: 'monthly', every: Math.max(1, Math.round(n * u.months)), atMin, dayOfMonth: null };
        if (u.years)  return { kind: 'yearly',  every: Math.max(1, Math.round(n * u.years)), atMin };
      }
    }
    void tz;
    return null;
  },

  // Given a rule and the instant it last ran (or its anchor), produce
  // the next instant strictly after `after`.
  //
  // Computed from the SCHEDULED time, never the actual fire time, so a
  // job that ran 40s late does not drift 40s later every cycle. When
  // catching up after downtime we skip whole missed occurrences rather
  // than replaying them — nobody wants 60 backlogged "daily standup"
  // pings on Monday morning.
  nextOccurrence(rule, anchor, after, tz) {
    if (!rule) return null;
    const z = this.resolveTz(tz);
    let cur = anchor;
    let guard = 0;
    const GUARD_MAX = 4000;

    if (rule.kind === 'interval') {
      const step = Math.max(60000, rule.ms || 36e5);
      if (cur > after) return cur;
      const jumps = Math.floor((after - cur) / step) + 1;
      return cur + jumps * step;
    }

    const setTime = (epoch) => (rule.atMin == null ? epoch : this.atTimeOn(z, epoch, rule.atMin).at);

    while (guard++ < GUARD_MAX) {
      let next;
      if (rule.kind === 'daily') {
        next = setTime(this.addCalendar(z, cur, { days: Math.max(1, rule.every || 1) }).at);
      } else if (rule.kind === 'weekly') {
        if (Array.isArray(rule.days) && rule.days.length) {
          // Walk forward day by day to the next selected weekday.
          let probe = cur;
          for (let i = 1; i <= 7 * Math.max(1, rule.every || 1) + 7; i++) {
            probe = this.addCalendar(z, cur, { days: i }).at;
            if (rule.days.includes(this.partsAt(z, probe).wd)) break;
          }
          next = setTime(probe);
        } else {
          next = setTime(this.addCalendar(z, cur, { days: 7 * Math.max(1, rule.every || 1) }).at);
        }
      } else if (rule.kind === 'monthly') {
        next = setTime(this.addCalendar(z, cur, { months: Math.max(1, rule.every || 1) }).at);
      } else if (rule.kind === 'yearly') {
        next = setTime(this.addCalendar(z, cur, { years: Math.max(1, rule.every || 1) }).at);
      } else {
        return null;
      }
      if (!Number.isFinite(next) || next <= cur) return null;  // no progress — bail rather than spin
      cur = next;
      if (cur > after) return cur;
    }
    return null;
  },

  // ── main entry ────────────────────────────────────────────────
  // parse("in 10 seconds", {tz}) →
  //   { ok, at, tz, recur, phrase, ambiguousMeridiem, shifted, ambiguous, reason }
  parse(text, opts = {}) {
    const tz  = this.resolveTz(opts.tz);
    const now = opts.now || Date.now();
    const raw = String(text || '').trim();
    const s   = this._normalize(raw);
    const fail = (reason) => ({ ok: false, reason, phrase: raw, tz });

    if (!s) return fail('no time given');

    // 0. An explicit ISO instant always wins — no guessing.
    const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?/);
    if (iso) {
      if (iso[5]) {
        const d = Date.parse(raw);
        if (!isNaN(d)) return this._finish(d, tz, raw, null, now, {});
      }
      const [y, mo, dd] = iso[1].split('-').map(Number);
      const clk = iso[2] != null
        ? { min: parseInt(iso[2], 10) * 60 + parseInt(iso[3], 10), explicitMeridiem: true }
        : this._parseClock(s.replace(iso[0], '')) || { min: 9 * 60, explicitMeridiem: true };
      const r = this.zonedToEpoch(tz, { y, mo, d: dd, h: Math.floor(clk.min / 60), mi: clk.min % 60, s: iso[4] ? +iso[4] : 0 });
      const recur0 = this._parseRecur(s, tz, clk);
      return this._finish(r.at, tz, raw, recur0, now, r);
    }

    const clock = this._parseClock(s);
    const recur = this._parseRecur(s, tz, clock);

    // 1. Pure relative: "in 10 seconds", "2 hours from now", "after 5m"
    const relm = s.match(/\b(?:in|after|within)\s+(.+)$/) || s.match(/^(.+?)\s+(?:from now|later|from here)\b/);
    if (relm && !/\bevery|each\b/.test(s)) {
      const dur = this._parseDuration(relm[1]);
      if (dur && (dur.abs || dur.cal.days || dur.cal.months || dur.cal.years)) {
        let at = now + dur.abs;
        if (dur.cal.days || dur.cal.months || dur.cal.years) at = this.addCalendar(tz, at, dur.cal).at;
        // "in 3 days at 9am" — the clock overrides the carried time.
        if (clock && /\bat\b/.test(s)) at = this.atTimeOn(tz, at, clock.min).at;
        return this._finish(at, tz, raw, recur, now, {});
      }
    }

    // 2. Day anchor + optional clock.
    let anchorDay = null;                      // epoch inside the target day
    let anchorExplicit = false;

    if (/\btomorrow\b|\btmr\b|\btmrw\b/.test(s)) { anchorDay = this.addCalendar(tz, now, { days: 1 }).at; anchorExplicit = true; }
    else if (/\btoday\b|\btonight\b|\bthis (?:morning|afternoon|evening)\b/.test(s)) { anchorDay = now; anchorExplicit = true; }
    else if (/\bnext week\b/.test(s))  { anchorDay = this.addCalendar(tz, now, { days: 7 }).at;  anchorExplicit = true; }
    else if (/\bnext month\b/.test(s)) { anchorDay = this.addCalendar(tz, now, { months: 1 }).at; anchorExplicit = true; }
    else if (/\bnext year\b/.test(s))  { anchorDay = this.addCalendar(tz, now, { years: 1 }).at;  anchorExplicit = true; }

    // Weekday names: "friday", "next friday", "this monday".
    if (anchorDay == null && !recur) {
      for (const [name, idx] of Object.entries(this._DAYS)) {
        if (!new RegExp('\\b' + name + '\\b').test(s)) continue;
        const isNext = /\bnext\b/.test(s);
        const todayWd = this.partsAt(tz, now).wd;
        let delta = (idx - todayWd + 7) % 7;
        // Bare "friday" on a Friday means next Friday unless a clock
        // later today is given — handled by the roll-forward below.
        if (delta === 0 && isNext) delta = 7;
        if (isNext && delta > 0 && /\bnext\b/.test(s) && delta < 7) { /* "next fri" = upcoming fri */ }
        anchorDay = this.addCalendar(tz, now, { days: delta }).at;
        anchorExplicit = true;
        break;
      }
    }

    // Explicit calendar dates: "25 dec", "dec 25", "25/12", "25/12/2026"
    if (anchorDay == null) {
      let dm = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/);
      let day = null, mon = null, yr = null;
      if (dm && this._MONTHS[dm[2]]) { day = +dm[1]; mon = this._MONTHS[dm[2]]; }
      if (day == null) {
        dm = s.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
        if (dm && this._MONTHS[dm[1]]) { mon = this._MONTHS[dm[1]]; day = +dm[2]; }
      }
      if (day == null) {
        dm = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
        if (dm) {
          // Day-first. Ambiguous by locale; documented, not guessed.
          day = +dm[1]; mon = +dm[2];
          if (dm[3]) { yr = +dm[3]; if (yr < 100) yr += 2000; }
        }
      }
      const ym = s.match(/\b(20\d{2})\b/);
      if (yr == null && ym) yr = +ym[1];
      if (day != null && mon >= 1 && mon <= 12) {
        const p = this.partsAt(tz, now);
        const useYear = yr != null ? yr : p.y;
        if (day < 1 || day > this._daysInMonth(useYear, mon)) return fail('that date does not exist');
        let at = this.zonedToEpoch(tz, { y: useYear, mo: mon, d: day, h: 12, mi: 0, s: 0 }).at;
        // No year given and the date already passed → next year.
        if (yr == null && at < now - 864e5) {
          at = this.zonedToEpoch(tz, { y: useYear + 1, mo: mon, d: day, h: 12, mi: 0, s: 0 }).at;
        }
        anchorDay = at; anchorExplicit = true;
      }
    }

    // 3. Combine anchor + clock.
    if (anchorDay != null || clock || recur) {
      const base = anchorDay != null ? anchorDay : now;
      let at, ambiguousMeridiem = false, extra = {};

      if (clock) {
        const r = this.atTimeOn(tz, base, clock.min);
        at = r.at; extra = r;
        if (!clock.explicitMeridiem && clock.min < 12 * 60) {
          // Bare "9". For a ONE-OFF, take whichever of 9am/9pm comes
          // next — "remind me at 9" said at 2pm means tonight.
          // For a RECURRING job, keep the morning reading and start
          // tomorrow: "every day at 9" is 9am to everyone, and flipping
          // it to 21:00 because the request happened to be made after
          // breakfast would bake the wrong time into every occurrence.
          if (!recur) {
            const pm = this.atTimeOn(tz, base, clock.min + 12 * 60).at;
            if (at <= now && pm > now) at = pm;
          }
          ambiguousMeridiem = true;
        }
        // Clock with no day anchor that has already passed → tomorrow.
        if (at <= now && !anchorExplicit) at = this.atTimeOn(tz, this.addCalendar(tz, base, { days: 1 }).at, clock.min).at;
      } else if (anchorDay != null) {
        // Day with no time → 9am local, the conventional default.
        at = this.atTimeOn(tz, base, 9 * 60).at;
        if (at <= now) at = this.atTimeOn(tz, this.addCalendar(tz, base, { days: 1 }).at, 9 * 60).at;
      } else {
        // Recurrence with no explicit start: begin at the next slot.
        at = recur && recur.kind === 'interval' ? now + (recur.ms || 36e5) : this.atTimeOn(tz, now, recur && recur.atMin != null ? recur.atMin : 9 * 60).at;
        if (at <= now) at = this.addCalendar(tz, at, { days: 1 }).at;
      }

      // A weekly rule must start on one of its own days.
      if (recur && recur.kind === 'weekly' && Array.isArray(recur.days) && recur.days.length) {
        let probe = at, i = 0;
        while (!recur.days.includes(this.partsAt(tz, probe).wd) && i++ < 8) {
          probe = this.addCalendar(tz, probe, { days: 1 }).at;
          if (recur.atMin != null) probe = this.atTimeOn(tz, probe, recur.atMin).at;
        }
        at = probe;
      }
      if (at <= now && recur) {
        const nx = this.nextOccurrence(recur, at, now, tz);
        if (nx) at = nx;
      }
      return this._finish(at, tz, raw, recur, now, Object.assign({ ambiguousMeridiem }, extra));
    }

    // 4. Bare duration with no preposition: "10 seconds", "2h"
    const bare = this._parseDuration(s);
    if (bare && (bare.abs || bare.cal.days || bare.cal.months || bare.cal.years)) {
      let at = now + bare.abs;
      if (bare.cal.days || bare.cal.months || bare.cal.years) at = this.addCalendar(tz, at, bare.cal).at;
      return this._finish(at, tz, raw, recur, now, {});
    }

    return fail("couldn't understand that time");
  },

  _finish(at, tz, phrase, recur, now, flags) {
    if (!Number.isFinite(at)) return { ok: false, reason: 'invalid time', phrase, tz };
    if (at - now > this.MAX_HORIZON_MS) return { ok: false, reason: 'too far in the future (max 5 years)', phrase, tz };
    // Small negatives are almost always "in 0 seconds" rounding or a
    // clock that just ticked past; nudge rather than reject.
    if (at <= now) {
      if (now - at < 60000) at = now + 1000;
      else return { ok: false, reason: 'that time is in the past', phrase, tz, at };
    }
    return {
      ok: true, at, tz, recur: recur || null, phrase,
      ambiguousMeridiem: !!flags.ambiguousMeridiem,
      shifted: !!flags.shifted, ambiguous: !!flags.ambiguous,
    };
  },
});

// ── POLICY ───────────────────────────────────────────────────────
// The single source of truth on the CLIENT for what may be deferred.
// api.php carries a mirror of this and the mirror is the one that
// counts — everything here is a fast local check so the UI can refuse
// politely before a round trip. Never treat a client-side pass as
// authorisation; the server re-validates every field on every write.
const SCHED_POLICY = {

  // Verbs an OPERATOR may schedule. Deliberately a deny-list applied to
  // the live ghost vocabulary rather than a hand-kept allow-list, so a
  // new ghost verb is schedulable the day it ships instead of silently
  // being dropped. The excluded ones are excluded for a reason:
  //   clarify/noop      — conversational, nothing to defer
  //   confirm           — part of the nonce handshake, not an action
  //   dashboard_reset   — destroys layout; a surprise 3am reset is bad
  //   web_search        — result would be stale by the time anyone read it
  //   *_search          — read-only lookups, pointless deferred
  NEVER_SCHEDULE: [
    'clarify', 'noop', 'confirm', 'dashboard_reset',
    'web_search', 'message_search', 'contact_search', 'customer_profile',
    'schedule_create', 'schedule_cancel', 'schedule_list', 'schedule_update',
    'schedule_view',
  ],

  // Mirrors $DESTRUCTIVE in api.php. Schedulable, but creation must go
  // through the existing confirm-nonce handshake — and the confirmation
  // states the fire time, so "refund Marco next Friday" is confirmed as
  // a future refund, not as an immediate one.
  DESTRUCTIVE: [
    'refund', 'license_renew', 'license_replace', 'license_revoke',
    'product_delete', 'wallet_delete',
  ],

  // The ENTIRE customer-facing surface. One verb.
  //
  // customer_followup does NOT carry a message body. The customer
  // supplies a short `topic` ("remind me about the pro plan") and the
  // agent writes the actual message in persona at fire time. This is
  // the single most important line in the file: if customers could
  // schedule literal text, a scheduled job would become a stored
  // prompt-injection vector and a way to make your agent say anything
  // you like, on your timetable, over your channel.
  CUSTOMER_VERBS: ['customer_followup'],

  CUSTOMER_LIMITS: {
    maxPending: 3,          // concurrent, per conversation
    maxPerDay: 5,           // creations per rolling 24h, per conversation
    minLeadMs: 60 * 1000,   // no "message me in 2 seconds" games
    maxHorizonMs: 60 * 864e5,
    minGapMs: 5 * 60 * 1000,// two scheduled items can't be 30s apart
    topicMaxLen: 200,
    quietStartMin: 22 * 60, // 22:00 — deliveries inside quiet hours slide
    quietEndMin: 8 * 60,    // 08:00   to the end of the window…
    quietOverridable: true, // …unless the customer explicitly named that time
  },

  OPERATOR_LIMITS: {
    maxPending: 500,
    minLeadMs: 1000,
    maxHorizonMs: 5 * 365.25 * 864e5,
  },

  // What to do about a job that came due while every client was shut.
  //   run      fire it whenever we next boot, however late
  //   skip     if late at all, drop it
  //   grace    fire only if within `graceMs`, else mark missed
  // Time-of-day-sensitive things default to grace; state changes
  // (escalate, toggles, refunds) default to run — being late is not a
  // reason to leave an escalation unraised.
  defaultLateness(verb) {
    if (verb === 'customer_followup' || verb === 'message_send' || verb === 'contact_followup') {
      return { onLate: 'grace', graceMs: 2 * 3600e3 };
    }
    if (verb === 'agent_proactive') return { onLate: 'grace', graceMs: 6 * 3600e3 };
    return { onLate: 'run', graceMs: 0 };
  },

  isDestructive(verb) { return this.DESTRUCTIVE.indexOf(String(verb || '')) >= 0; },

  canOperatorSchedule(verb) {
    const v = String(verb || '').trim().toLowerCase();
    if (!v) return { ok: false, reason: 'no action given' };
    if (this.NEVER_SCHEDULE.indexOf(v) >= 0) return { ok: false, reason: `"${v}" can't be scheduled — it only makes sense right now` };
    return { ok: true, destructive: this.isDestructive(v) };
  },

  canCustomerSchedule(verb, agent) {
    const v = String(verb || '').trim().toLowerCase();
    if (this.CUSTOMER_VERBS.indexOf(v) < 0) return { ok: false, reason: 'not permitted for customers' };
    if (!agent || !agent.allowCustomerScheduling) return { ok: false, reason: 'customer scheduling is off for this agent' };
    return { ok: true };
  },

  // Effective per-agent limits: operator overrides clamped into sane
  // bounds so a typo (maxPending: 9999) can't turn into a spam cannon.
  customerLimitsFor(agent) {
    const L = Object.assign({}, this.CUSTOMER_LIMITS);
    if (!agent) return L;
    if (Number.isFinite(+agent.custSchedMaxPending)) L.maxPending = Math.max(0, Math.min(10, +agent.custSchedMaxPending));
    if (Number.isFinite(+agent.custSchedMaxPerDay)) L.maxPerDay = Math.max(0, Math.min(20, +agent.custSchedMaxPerDay));
    if (Number.isFinite(+agent.custSchedMaxDays))   L.maxHorizonMs = Math.max(1, Math.min(365, +agent.custSchedMaxDays)) * 864e5;
    if (agent.custSchedQuietHours === false) { L.quietStartMin = null; L.quietEndMin = null; }
    return L;
  },

  // Strip anything that could act as control plane if this string is
  // later dropped into a prompt. Mirrors the inbound sanitiser in
  // api.php save_message, plus zero-width characters (a real smuggling
  // trick for hiding instructions inside innocuous-looking text).
  sanitizeTopic(text, maxLen) {
    let s = String(text == null ? '' : text);
    s = s.replace(/\[\[\s*(?:ACTION|INVOICE|LICENSE_RESULT|LICENSE|SPLIT)\s*:[^\]]*\]\]/gi, ' ');
    s = s.replace(/\[\[|\]\]/g, ' ');
    s = s.replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\uFEFF]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s.slice(0, maxLen || this.CUSTOMER_LIMITS.topicMaxLen);
  },

  // Slide a delivery out of quiet hours. Returns {at, moved}.
  applyQuietHours(at, tz, limits, explicitTime) {
    if (!limits || limits.quietStartMin == null || limits.quietEndMin == null) return { at, moved: false };
    if (explicitTime && limits.quietOverridable) return { at, moved: false };
    const p = SCHED_TIME.partsAt(SCHED_TIME.resolveTz(tz), at);
    const min = p.h * 60 + p.mi;
    const start = limits.quietStartMin, end = limits.quietEndMin;
    const inQuiet = start > end ? (min >= start || min < end) : (min >= start && min < end);
    if (!inQuiet) return { at, moved: false };
    // Push to the end of the quiet window (next morning if we're past midnight).
    let target = SCHED_TIME.atTimeOn(tz, at, end).at;
    if (target <= at) target = SCHED_TIME.atTimeOn(tz, SCHED_TIME.addCalendar(tz, at, { days: 1 }).at, end).at;
    return { at: target, moved: true };
  },
};


// ── QUEUE MIRROR ─────────────────────────────────────────────────
// A local read-model of bc_scheduled_actions. The server is the
// authority; this exists so the UI and the ghost's "what's scheduled?"
// answer are instant, and so a countdown can tick without polling.
//
// Same pub/sub shape as AGENTS_STORE / TASKS_STORE elsewhere in the
// codebase, so useScheduled() behaves like every other hook here.
const SCHED_STORE = {
  list: [],
  loaded: false,
  // Server clock minus this machine's clock, in ms. See schedNow().
  clockOffset: 0,
  _offsetSamples: 0,
  now() { return Date.now() + this.clockOffset; },
  // sentAt / recvAt bracket the request; the server's stamp is taken to be
  // from the middle of that window. Smoothed so one slow response can't
  // swing every countdown on screen.
  noteServerNow(serverMs, sentAt, recvAt) {
    const s = Number(serverMs);
    if (!Number.isFinite(s) || s <= 0) return;
    const rtt = Math.max(0, recvAt - sentAt);
    if (rtt > 10000) return;                       // too slow to say anything useful
    const sample = s - (sentAt + rtt / 2);
    this.clockOffset = this._offsetSamples
      ? Math.round(this.clockOffset * 0.6 + sample * 0.4)
      : Math.round(sample);
    this._offsetSamples++;
  },
  loading: false,
  lastSync: 0,
  lastError: '',
  _subs: new Set(),

  sub(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  notify() {
    const snap = [...this.list];
    this._subs.forEach(fn => { try { fn(snap); } catch (e) { console.error('[sched sub]', e); } });
  },

  _norm(r) {
    if (!r || typeof r !== 'object') return null;
    const at = typeof r.run_at_ms === 'number' ? r.run_at_ms
             : (r.run_at ? Date.parse(String(r.run_at).replace(' ', 'T') + 'Z') : NaN);
    if (!Number.isFinite(at)) return null;
    let attrs = r.attrs;
    if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch (_) { attrs = {}; } }
    let recur = r.recur;
    if (typeof recur === 'string') { try { recur = JSON.parse(recur); } catch (_) { recur = null; } }
    return {
      id: String(r.id),
      verb: String(r.verb || ''),
      attrs: attrs && typeof attrs === 'object' ? attrs : {},
      at,
      tz: r.tz || '',
      status: r.status || 'pending',
      origin: r.origin || 'operator',
      convId: r.conv_id || '',
      agentId: r.agent_id || null,
      label: r.label || '',
      phrase: r.phrase || '',
      recur: recur || null,
      recurCount: +r.recur_count || 0,
      recurMax: r.recur_max == null ? null : +r.recur_max,
      recurUntil: r.recur_until_ms || null,
      attempts: +r.attempts || 0,
      onLate: r.on_late || 'run',
      graceMs: +r.grace_ms || 0,
      lastError: r.last_error || '',
      firedAt: r.fired_at_ms || null,
      createdAt: r.created_at_ms || null,
    };
  },

  async load(force = false) {
    if (this.loading) return this.list;
    try { if (typeof AUTH_STORE !== 'undefined' && AUTH_STORE.account && AUTH_STORE.account.guest) return this.list; } catch (_) {}
    if (!force && this.loaded && Date.now() - this.lastSync < 5000) return this.list;
    this.loading = true;
    try {
      const sentAt = Date.now();
      const res = await apiFetch('sched_list', { include_done: 1, limit: 200 });
      if (res && res.server_now_ms) this.noteServerNow(res.server_now_ms, sentAt, Date.now());
      const rows = (res && res.jobs) || [];
      this.list = rows.map(r => this._norm(r)).filter(Boolean);
      this.loaded = true;
      this.lastSync = Date.now();
      this.lastError = '';
    } catch (e) {
      this.lastError = (e && e.message) || 'load failed';
      console.warn('[sched] load failed', this.lastError);
    } finally {
      this.loading = false;
      this.notify();
    }
    return this.list;
  },

  pending() {
    return this.list
      .filter(j => j.status === 'pending' || j.status === 'running')
      .sort((a, b) => a.at - b.at);
  },
  forConv(convId) { return this.pending().filter(j => String(j.convId) === String(convId)); },
  byId(id) { return this.list.find(j => String(j.id) === String(id)) || null; },

  async create(job) {
    const res = await apiFetch('sched_create', job);
    if (res && res.job) {
      const n = this._norm(res.job);
      if (n) { this.list = [...this.list.filter(j => j.id !== n.id), n]; this.notify(); }
      return n;
    }
    return null;
  },

  async cancel(id, reason) {
    const res = await apiFetch('sched_cancel', { id, reason: reason || '' });
    if (res && res.cancelled) {
      this.list = this.list.map(j => (String(j.id) === String(id) ? { ...j, status: 'cancelled' } : j));
      this.notify();
      return true;
    }
    return false;
  },

  async update(id, patch) {
    const res = await apiFetch('sched_update', Object.assign({ id }, patch || {}));
    if (res && res.job) {
      const n = this._norm(res.job);
      if (n) { this.list = this.list.map(j => (j.id === n.id ? n : j)); this.notify(); }
      return n;
    }
    return null;
  },

  // Compact projection for the ghost's context pack and for the
  // "what's scheduled?" answer. Countdown is computed fresh.
  summarize(now = schedNow(), limit = 25) {
    return this.pending().slice(0, limit).map(j => ({
      id: j.id,
      what: j.label || SCHED_STORE.describeJob(j),
      verb: j.verb,
      when: SCHED_TIME.describeAt(j.at, j.tz, { now }),
      in: SCHED_TIME.countdown(j.at, now),
      repeats: j.recur ? SCHED_STORE.describeRecur(j.recur) : null,
      origin: j.origin,
      for: j.attrs && (j.attrs.target || j.attrs.contact || j.attrs.customer) || '',
    }));
  },

  describeJob(j) {
    const a = j.attrs || {};
    const who = a.target || a.contact || a.customer || a.thread || a.name || '';
    switch (j.verb) {
      case 'message_send':       return who ? `Message ${who}` : 'Send a message';
      case 'customer_followup':  return a.topic ? `Follow up: ${a.topic}` : 'Follow up with the customer';
      case 'contact_followup':   return who ? `Follow up with ${who}` : 'Follow up';
      case 'escalate':           return who ? `Escalate ${who}` : 'Escalate';
      case 'de_escalate':        return who ? `De-escalate ${who}` : 'De-escalate';
      case 'invoice_create':     return who ? `Invoice ${who}` : 'Create invoice';
      case 'refund':             return who ? `Refund ${who}` : 'Refund';
      case 'agent_toggle':       return `Turn ${a.on === false || a.on === 'false' ? 'off' : 'on'} ${a.name || 'agent'}`;
      case 'note_create':        return a.text ? `Note: ${String(a.text).slice(0, 40)}` : 'Add a note';
      case 'report_generate':    return `${a.kind || 'Report'} report`;
      default:                   return j.verb.replace(/_/g, ' ');
    }
  },

  describeRecur(r) {
    if (!r) return null;
    const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const fmt = (min) => {
      let h = Math.floor(min / 60) % 24; const mi = min % 60;
      const sfx = h >= 12 ? 'pm' : 'am'; h = h % 12; if (h === 0) h = 12;
      return h + (mi ? ':' + String(mi).padStart(2, '0') : '') + sfx;
    };
    const at = r.atMin != null ? ' at ' + fmt(r.atMin) : '';
    switch (r.kind) {
      case 'interval': return 'every ' + SCHED_TIME.humanizeMs(r.ms);
      case 'daily':    return (r.every > 1 ? `every ${r.every} days` : 'daily') + at;
      case 'weekly':   return (Array.isArray(r.days) && r.days.length ? 'every ' + r.days.map(d => DAY[d]).join(', ') : 'weekly') + at;
      case 'monthly':  return (r.every > 1 ? `every ${r.every} months` : 'monthly') + at;
      case 'yearly':   return 'yearly' + at;
      default:         return 'repeating';
    }
  },
};
if (typeof window !== 'undefined') window.__schedStore = SCHED_STORE;

const useScheduled = () => {
  const [v, setV] = React.useState([...SCHED_STORE.list]);
  React.useEffect(() => SCHED_STORE.sub(setV), []);
  return v;
};


// ── RUNTIME ──────────────────────────────────────────────────────
// The loop that actually makes things happen:
//
//   tick → ask server for due jobs and LEASE them (atomic, so two open
//          tabs can't both take the same one)
//        → preflight each against live state
//        → dispatch through the normal ghost action path
//        → report success/failure back, which also advances recurrence
//
// Dispatch goes through window.__bcwLayoutAction (which falls through
// to __ghostActionHandler) — the exact same entry point the live
// composer uses. A scheduled escalation and a typed one run identical
// code; there is no second implementation to drift.
const SCHED_RUNTIME = {
  TICK_MS: 15000,          // how often we ask the server for due work
  LEASE_MS: 120000,        // a claimed job is ours for this long
  MAX_ATTEMPTS: 3,
  _timer: null,
  _running: false,
  _inFlight: new Set(),
  started: false,
  _wake: null,
  _again: false,

  start() {
    if (this.started) return;
    this.started = true;
    // Kick once immediately so a job that came due while the app was
    // shut fires on boot rather than up to TICK_MS later.
    if (this._kick) clearTimeout(this._kick);
    this._kick = setTimeout(() => { this._kick = null; this.tick(); }, 2500);
    this._timer = setInterval(() => this.tick(), this.TICK_MS);
    // ── ON TIME, NOT "WITHIN 15 SECONDS" ────────────────────────────
    // The interval alone meant a job due at 3:00 went out anywhere up to
    // fifteen seconds late — the countdown hit zero and nothing happened.
    // Whenever the queue changes, a one-off timer is armed for the next
    // job's exact due time, so the claim lands right as it becomes due.
    if (!this._unsubArm) this._unsubArm = SCHED_STORE.sub(() => this._armNext());
    this._armNext();
    // A laptop waking from sleep gets a timer storm or a missed tick
    // depending on the browser; visibility is the reliable signal.
    // One stable handler: start() runs again after every stop() (logout →
    // login), and an inline arrow here stacked a fresh listener each time,
    // so N sign-ins fired N ticks per wake and leaked N closures.
    if (!this._onVis) this._onVis = () => { if (!document.hidden) this.tick(); };
    try {
      document.removeEventListener('visibilitychange', this._onVis);
      document.addEventListener('visibilitychange', this._onVis);
    } catch (_) {}
    console.log('[sched] runtime started');
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._wake)  { clearTimeout(this._wake); this._wake = null; }
    if (this._unsubArm) { try { this._unsubArm(); } catch (_) {} this._unsubArm = null; }
    if (this._kick)  { clearTimeout(this._kick); this._kick = null; }
    if (this._onVis) { try { document.removeEventListener('visibilitychange', this._onVis); } catch (_) {} }
    this.started = false;
  },

  // Arm a one-off wake-up for the next pending job. The small margin lets
  // the server's own clock tick past run_at before we ask for it.
  _armNext() {
    if (!this.started) return;
    if (this._wake) { clearTimeout(this._wake); this._wake = null; }
    const now = schedNow();
    let next = Infinity;
    for (const j of SCHED_STORE.list) {
      if (j.status !== 'pending') continue;
      // Long overdue and still pending means the server isn't handing it
      // out (another tab holds it, or it is being retried later) — the
      // interval covers that; hammering the server every second doesn't.
      if (j.at < now - 5000) continue;
      if (j.at < next) next = j.at;
    }
    if (!Number.isFinite(next)) return;
    const delay = Math.max(250, next - now + 400);
    // Beyond a few hours the regular interval and visibility ticks are
    // plenty; a very long timer just drifts across sleep.
    if (delay > 6 * 3600e3) return;
    this._wake = setTimeout(() => { this._wake = null; this.tick(); }, delay);
  },

  async tick() {
    if (this._running) { this._again = true; return; }
    // Nothing to execute into if we aren't logged in.
    // (A guest chat has no scheduled jobs and can't claim any.)
    try { if (typeof AUTH_STORE !== 'undefined' && AUTH_STORE && (AUTH_STORE.user === null || (AUTH_STORE.account && AUTH_STORE.account.guest))) return; } catch (_) {}
    this._running = true;
    try {
      const sentAt = Date.now();
      const res = await apiFetch('sched_claim', {
        lease_ms: this.LEASE_MS,
        owner: this._ownerId(),
        limit: 10,
      });
      if (res && res.server_now_ms) SCHED_STORE.noteServerNow(res.server_now_ms, sentAt, Date.now());
      const jobs = (res && res.jobs) || [];
      if (jobs.length) {
        console.log('[sched] claimed', jobs.length, 'due job(s)');
        for (const raw of jobs) {
          const job = SCHED_STORE._norm(raw);
          if (job && !this._inFlight.has(job.id)) {
            this._inFlight.add(job.id);
            // Deliberately not awaited in series — a slow send must not
            // hold up the rest of the batch. Each reports independently.
            this.run(job).finally(() => this._inFlight.delete(job.id));
          }
        }
        SCHED_STORE.load(true);
      }
    } catch (e) {
      console.warn('[sched] tick failed', e && e.message);
    } finally {
      this._running = false;
      // A wake-up that arrived while this tick was busy asked for another.
      if (this._again) { this._again = false; setTimeout(() => this.tick(), 50); }
      else this._armNext();
    }
  },

  // Stable per-tab id so leases are attributable in the audit log.
  _ownerId() {
    if (this._owner) return this._owner;
    try {
      let o = sessionStorage.getItem('bc.sched.owner');
      if (!o) { o = 'c' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('bc.sched.owner', o); }
      this._owner = o;
    } catch (_) { this._owner = 'c' + Math.random().toString(36).slice(2, 10); }
    return this._owner;
  },

  // ── preflight ─────────────────────────────────────────────────
  // Between scheduling and firing, the world moves. Everything that
  // could have changed underneath a job is checked here, and the
  // answer is one of: run / defer (put it back with a new time) /
  // cancel (it can never be valid again).
  preflight(job) {
    const now = schedNow();
    const lateBy = now - job.at;

    // 1. Lateness. Time-of-day-sensitive jobs expire rather than
    //    arriving embarrassingly late.
    if (lateBy > 0 && job.onLate === 'skip' && lateBy > 60000) {
      return { action: 'cancel', reason: `missed its slot (${SCHED_TIME.humanizeMs(lateBy)} late)` };
    }
    if (lateBy > 0 && job.onLate === 'grace' && job.graceMs > 0 && lateBy > job.graceMs) {
      return { action: 'cancel', reason: `too late to be useful (${SCHED_TIME.humanizeMs(lateBy)} late, grace ${SCHED_TIME.humanizeMs(job.graceMs)})` };
    }

    // 2. Conversation-scoped jobs need a live conversation.
    const needsConv = ['customer_followup', 'message_send', 'escalate', 'de_escalate', 'invoice_create', 'contact_followup'];
    if (needsConv.indexOf(job.verb) >= 0) {
      const conv = this._resolveConv(job);
      if (!conv && job.convId) {
        return { action: 'cancel', reason: 'the conversation no longer exists' };
      }
      if (conv) {
        // Blocked customer — never message, never re-raise. Terminal.
        if (conv.blocked || conv.is_blocked) {
          return { action: 'cancel', reason: 'the customer is blocked' };
        }
        // A human has taken this conversation. Anything the AI would
        // say now talks over them. Hold, don't cancel — de-escalation
        // is normal and the follow-up is usually still wanted.
        const aiSpeaks = ['customer_followup', 'agent_proactive'];
        if (conv.escalated && aiSpeaks.indexOf(job.verb) >= 0) {
          return { action: 'defer', ms: 30 * 60e3, reason: 'conversation is escalated to a human' };
        }
      }
    }

    // 3. Agent availability. A scheduled AI message that lands outside
    //    the agent's reply hours breaks the illusion the hours exist
    //    for, so slide it to the next open window.
    if (job.verb === 'customer_followup' || job.verb === 'agent_proactive') {
      const agent = this._resolveAgent(job);
      if (agent) {
        if (!agent.active) return { action: 'defer', ms: 60 * 60e3, reason: 'agent is paused' };
        if (job.verb === 'customer_followup' && !agent.allowCustomerScheduling) {
          return { action: 'cancel', reason: 'customer scheduling was turned off for this agent' };
        }
        if (job.verb !== 'customer_followup' && !agent.allowScheduling) {
          return { action: 'cancel', reason: 'scheduling was turned off for this agent' };
        }
        try {
          if (agent.schedule && agent.schedule.enabled && !SCHEDULE_GATE.isOpen(agent.schedule)) {
            const wait = SCHEDULE_GATE.msUntilOpen(agent.schedule);
            if (Number.isFinite(wait) && wait > 0) {
              return { action: 'defer', ms: Math.min(wait + 5000, 7 * 864e5), reason: 'outside the agent\'s reply hours' };
            }
          }
        } catch (_) {}
      } else if (job.agentId) {
        return { action: 'cancel', reason: 'the agent was deleted' };
      }
    }

    // 4. Desktop bridge. Anything that has to reach a platform needs
    //    the .NET shell. In a plain browser we defer rather than fail —
    //    the operator probably just has the web view open too.
    const needsBridge = ['customer_followup', 'message_send', 'agent_proactive'];
    if (needsBridge.indexOf(job.verb) >= 0) {
      try {
        if (window.BotBridge && typeof window.BotBridge.isWebView2 === 'function' && !window.BotBridge.isWebView2()) {
          return { action: 'defer', ms: 5 * 60e3, reason: 'not running in the desktop app' };
        }
        if (!window.BotBridge) return { action: 'defer', ms: 5 * 60e3, reason: 'platform bridge not ready' };
      } catch (_) {}
    }

    return { action: 'run' };
  },

  _resolveConv(job) {
    try {
      if (typeof MSGS_STORE === 'undefined' || !Array.isArray(MSGS_STORE.list)) return null;
      if (job.convId) {
        const byId = MSGS_STORE.list.find(c => String(c.id) === String(job.convId));
        if (byId) return byId;
      }
      const a = job.attrs || {};
      const t = String(a.target || a.contact || a.customer || a.thread || '').trim();
      if (t && typeof ghostResolveConv === 'function') return ghostResolveConv(t.toLowerCase());
    } catch (_) {}
    return null;
  },

  _resolveAgent(job) {
    try {
      if (typeof AGENTS_STORE === 'undefined') return null;
      if (job.agentId) {
        const a = AGENTS_STORE.byId(job.agentId);
        if (a) return a;
      }
      const conv = this._resolveConv(job);
      if (conv && conv.agentId) { const a = AGENTS_STORE.byId(conv.agentId); if (a) return a; }
      return AGENTS_STORE.defaultActive();
    } catch (_) { return null; }
  },

  // ── execute one job ───────────────────────────────────────────
  async run(job) {
    // Never early. The server only hands out jobs that are due, but if a
    // job somehow arrives ahead of its time it goes back in the queue at
    // its own time rather than running now — a message that lands early
    // is exactly the failure this whole feature must not have.
    const early = job.at - schedNow();
    if (early > 3000) {
      console.warn('[sched] job', job.id, 'handed out', Math.round(early / 1000), 's early — putting it back');
      await this._report(job, { status: 'deferred', run_at_ms: job.at, error: '' });
      return;
    }

    const pre = this.preflight(job);

    if (pre.action === 'cancel') {
      console.log('[sched] cancelling', job.id, '—', pre.reason);
      await this._report(job, { status: 'cancelled', error: pre.reason });
      this._toast(job, 'cancelled', pre.reason);
      return;
    }
    if (pre.action === 'defer') {
      const to = schedNow() + Math.max(30000, pre.ms || 60000);
      console.log('[sched] deferring', job.id, 'to', new Date(to).toISOString(), '—', pre.reason);
      await this._report(job, { status: 'deferred', run_at_ms: to, error: pre.reason });
      return;
    }

    try {
      const ok = await this._dispatch(job);
      if (ok && ok.ok !== false) {
        await this._report(job, { status: 'done', result: (ok && ok.report) || '' });
        this._toast(job, 'done', (ok && ok.report) || '');
      } else {
        const msg = (ok && ok.reason) || 'action reported failure';
        // noRetry marks an outcome we genuinely cannot resolve by trying
        // again — chiefly a send whose delivery was never confirmed,
        // where a retry could double-message a customer.
        await this._fail(job, msg, !!(ok && ok.noRetry));
      }
    } catch (e) {
      await this._fail(job, (e && e.message) || 'threw during dispatch');
    }
  },

  async _fail(job, reason, noRetry) {
    const attempts = (job.attempts || 0) + 1;
    if (!noRetry && attempts < this.MAX_ATTEMPTS) {
      // Exponential backoff: 1m, 5m. Transient platform errors (flood
      // waits, a bridge restarting) recover inside that window.
      const backoff = [60e3, 300e3][attempts - 1] || 300e3;
      console.warn('[sched] retry', job.id, 'attempt', attempts, '—', reason);
      await this._report(job, { status: 'deferred', run_at_ms: schedNow() + backoff, error: reason, attempts });
      return;
    }
    console.warn('[sched] failed permanently', job.id, '—', reason);
    await this._report(job, { status: 'failed', error: reason, attempts });
    this._toast(job, 'failed', reason);
  },

  async _report(job, patch) {
    try {
      await apiFetch('sched_report', Object.assign({ id: job.id, owner: this._ownerId() }, patch));
    } catch (e) {
      // If we can't report, the lease simply expires and the job gets
      // retried by whoever picks it up next. Safe by construction.
      console.warn('[sched] report failed', job.id, e && e.message);
    }
    SCHED_STORE.load(true);
  },

  // customer_followup is the one verb with no ghost handler, because
  // its message doesn't exist until now. The server composes it in the
  // agent's persona (it holds the LLM key, the agent row and the
  // transcript); the client only relays.
  async _composeAndSend(job) {
    const conv = this._resolveConv(job);
    if (!conv) return { ok: false, reason: 'conversation not found' };
    const platform = conv.p || conv.platform || '';
    const chatId = String(conv.chatId || conv.chat_id || '');
    if (!chatId) return { ok: false, reason: 'no chat id on that conversation' };

    const res = await apiFetch('sched_compose', { id: job.id, conv_id: conv.id });
    const text = res && String(res.text || '').trim();
    if (!text) return { ok: false, reason: (res && res.reason) || 'could not compose a message' };

    // ── WAIT FOR THE BRIDGE TO CONFIRM ────────────────────────────
    // BotBridge.sendMessage is fire-and-forget: it posts to the .NET
    // host and returns immediately. The real outcome arrives later as
    // sendOk or sendError.
    //
    // An earlier version treated "dispatched" as "delivered", which was
    // the worst possible bug for this feature. A blocked user, an
    // unresolved Telegram peer or a flood-wait produced a job marked
    // done, never retried, AND a line written into the local transcript
    // for a message that never left the machine — so the agent's next
    // turn reasoned from a conversation history that was fiction.
    //
    // Correlation is by platform + chat id, which is all the bridge
    // gives us. Two concurrent sends to the SAME chat could in principle
    // cross acks; scheduled follow-ups to one conversation are
    // serialised by the pending-cap, so that window is effectively shut.
    const ack = new Promise((resolve) => {
      let settled = false;
      const matches = (d) => d && String(d.platform || '') === platform && String(d.chatId || '') === chatId;
      const finish = (out) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('bcSendError', onErr);
        window.removeEventListener('bcEvent', onEvt);
        resolve(out);
      };
      const onErr = (ev) => { if (matches(ev && ev.detail)) finish({ ok: false, reason: String((ev.detail && ev.detail.error) || 'send failed') }); };
      const onEvt = (ev) => {
        const d = ev && ev.detail;
        if (!d || d.event !== 'sendOk') return;
        if (matches(d.data)) finish({ ok: true });
      };
      // Listeners go on BEFORE the send — the host can ack in under a
      // millisecond and an ack fired before we were listening would hang
      // here until the timeout.
      window.addEventListener('bcSendError', onErr);
      window.addEventListener('bcEvent', onEvt);
      const timer = setTimeout(() => finish({
        ok: false,
        // Neither ack arrived. The message may or may not have gone out,
        // so retrying risks double-messaging a customer while doing
        // nothing risks silence. We fail WITHOUT retry and surface it:
        // a visible failure the operator can act on beats both a silent
        // drop and a duplicate. The bridge acks locally in milliseconds,
        // so this realistically only fires when the host is wedged.
        reason: 'the desktop bridge never confirmed delivery — not retried, to avoid double-messaging',
        noRetry: true,
      }), 15000);
    });

    try {
      if (!window.BotBridge || typeof window.BotBridge.sendMessage !== 'function') {
        return { ok: false, reason: 'platform bridge unavailable' };
      }
      window.BotBridge.sendMessage(platform, chatId, text);
    } catch (e) {
      return { ok: false, reason: 'bridge send threw: ' + ((e && e.message) || 'unknown') };
    }

    const out = await ack;

    if (!out.ok) {
      // A Telegram peer that has gone cold is the one failure worth
      // actively repairing: ask the host to re-resolve and persist it so
      // the scheduled retry (1m / 5m) has a live access_hash to use.
      if (/peer not in cache|PEER_ID_INVALID/i.test(out.reason)) {
        try {
          const handle = String(conv.handle || conv.h || '').trim().replace(/^@/, '');
          if (platform === 'telegram' && window.BotBridge && typeof window.BotBridge.resolvePeer === 'function') {
            window.BotBridge.resolvePeer(platform, chatId, handle);
            apiFetch('save_peer_cache', { platform, chat_id: chatId, handle }).catch(() => {});
          }
        } catch (_) {}
      }
      return out;
    }

    // Only now is this a real message. Writing to MSGS_STORE before the
    // ack is what put phantom messages in the transcript.
    try {
      const opts = (typeof GHOST_MSG_OPTS !== 'undefined') ? GHOST_MSG_OPTS : undefined;
      MSGS_STORE.onOutbound(conv.id, chatId, platform, text, opts);
      MSGS_STORE.pushAudit(conv.id, `\u23f0 Scheduled follow-up sent${job.phrase ? ' (' + job.phrase + ')' : ''}`);
    } catch (e) { console.warn('[sched] local save failed', e && e.message); }

    return { ok: true, report: `Sent scheduled follow-up to ${conv.name || conv.handle || conv.id}.` };
  },

  async _dispatch(job) {
    if (job.verb === 'customer_followup') return this._composeAndSend(job);

    // _conv_id pins the job to the conversation it was booked for, so the
    // handler doesn't have to find the person again by name at fire time
    // (a rename, or two contacts with similar names, sent it elsewhere or
    // nowhere).
    const act = { verb: job.verb, attrs: Object.assign({}, job.attrs, {
      _scheduled: '1', _job_id: job.id, _conv_id: job.convId || '',
    }) };

    // Most ghost handlers are fire-and-forget with results announced on
    // the bcGhostResult event. Listen for the matching announcement so
    // we can record a real outcome instead of assuming success.
    const settle = new Promise((resolve) => {
      let done = false;
      const onResult = (ev) => {
        const d = ev && ev.detail;
        if (!d || done) return;
        if (String(d._job_id || '') !== String(job.id)) return;
        // resolved:null is a progress note ("Looking up Marco…"), not an
        // outcome. Taking it as success marked jobs done before the send
        // had happened, so a failure after it was never retried or shown.
        if (d.resolved === null) return;
        done = true;
        window.removeEventListener('bcGhostResult', onResult);
        resolve(d.resolved === false
          ? { ok: false, reason: d.reason || d.report || 'failed' }
          : { ok: true, report: d.report || '' });
      };
      window.addEventListener('bcGhostResult', onResult);
      // Handlers that complete synchronously never announce. Resolving
      // optimistically after a short wait is correct for those; a real
      // failure still arrives on the event and is recorded by _report.
      setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener('bcGhostResult', onResult);
        resolve({ ok: true, report: '' });
      }, 12000);
    });

    let handled = false;
    try {
      if (typeof window.__bcwLayoutAction === 'function') handled = !!window.__bcwLayoutAction(act);
      else if (typeof window.__ghostActionHandler === 'function') handled = !!window.__ghostActionHandler(act);
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'handler threw' };
    }
    if (!handled) return { ok: false, reason: `nothing handled "${job.verb}"` };
    return settle;
  },

  _toast(job, kind, detail) {
    let label = '';
    try { label = job.label || SCHED_STORE.describeJob(job) || ''; } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent('bcSchedFired', {
        detail: { kind, job, detail, label },
      }));
    } catch (_) {}
    // Nothing listened to bcSchedFired, so a scheduled action ran (or
    // failed) in silence. Surface it with the shared status pill.
    try {
      if (typeof bcToast === 'function') {
        const d = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 90);
        if (kind === 'done')           bcToast('Scheduled action done', 'ok', { detail: label || d || undefined });
        else if (kind === 'failed')    bcToast('Scheduled action failed' + (label ? ' — ' + label : ''), 'err', { detail: d || undefined });
        else if (kind === 'cancelled') bcToast('Scheduled action skipped' + (label ? ' — ' + label : ''), 'warn', { detail: d || undefined });
      }
    } catch (_) {}
  },
};

// ── UI ───────────────────────────────────────────────────────────
// Components are defined here rather than in bot-ui-views.jsx so the
// whole feature stays in one file. They are deliberately self-contained
// (no dependency on ToggleRow / Field, which are declared in a file
// that loads LATER) — the visual language is matched by hand instead.

// Drawn with the shared .bc-switch class (BotCommand.html) so it matches
// every other switch in the settings popups.
const SchedSwitch = ({ on, onChange, disabled }) => (
  <span aria-hidden="true" className="bc-switch" data-on={on ? '1' : '0'}
    style={{ opacity: disabled ? 0.4 : 1 }}
    onClick={disabled ? undefined : (e) => { e.stopPropagation(); onChange(!on); }} />
);

const SchedRow = ({ label, hint, value, onChange, disabled }) => (
  <div
    role="switch" aria-checked={!!value} aria-disabled={!!disabled}
    onClick={() => !disabled && onChange(!value)}
    style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
    }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--t1)' }}>{label}</div>
      {hint && <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 2, lineHeight: 1.35 }}>{hint}</div>}
    </div>
    <SchedSwitch on={!!value} onChange={onChange} disabled={disabled} />
  </div>
);

// Small stepper. Free-typing a cap invites typos that become spam
// limits, so the value is constrained at the control, not validated
// after the fact.
const SchedNumber = ({ label, hint, value, onChange, min = 0, max = 99, suffix, disabled }) => {
  const v = Number.isFinite(+value) ? +value : min;
  const clamp = (n) => Math.max(min, Math.min(max, n));
  const btn = (txt, delta) => (
    <button type="button" disabled={disabled || (delta < 0 ? v <= min : v >= max)}
      onClick={(e) => { e.stopPropagation(); onChange(clamp(v + delta)); }}
      style={{
        width: 22, height: 22, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        color: 'var(--t2)', fontSize: 13, lineHeight: '18px', padding: 0,
        opacity: (delta < 0 ? v <= min : v >= max) ? 0.3 : 1,
      }}>{txt}</button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', opacity: disabled ? 0.45 : 1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--t1)' }}>{label}</div>
        {hint && <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 2, lineHeight: 1.35 }}>{hint}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {btn('\u2212', -1)}
        <span style={{ minWidth: 34, textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: 'var(--t1)', fontVariantNumeric: 'tabular-nums' }}>
          {v}{suffix ? <span style={{ color: 'var(--t3)', fontWeight: 400 }}>{suffix}</span> : null}
        </span>
        {btn('+', 1)}
      </div>
    </div>
  );
};

// Live countdown. Re-renders on its own clock so the whole agent popup
// isn't re-rendered once a second just to move a "12m left" label.
const SchedCountdown = ({ at }) => {
  const [, setT] = React.useState(0);
  React.useEffect(() => {
    // Tick every second under a minute, otherwise every 30s — a "3d 4h"
    // label does not need per-second updates.
    const near = at - schedNow() < 90000;
    const id = setInterval(() => setT(x => x + 1), near ? 1000 : 30000);
    return () => clearInterval(id);
  }, [at, Math.floor((at - schedNow()) / 60000)]);
  const left = at - schedNow();
  const urgent = left > 0 && left < 60000;
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
      color: left < 0 ? 'rgba(214,160,130,0.95)' : urgent ? 'var(--t1)' : 'var(--t2)',
    }}>{SCHED_TIME.countdown(at)}</span>
  );
};

// The queue, filtered to one agent (or all). Doubles as the operator's
// answer to "what's scheduled?" without asking the ghost.
const SchedQueue = ({ agentId, convId, emptyText, max = 8 }) => {
  const all = useScheduled();
  const [busy, setBusy] = React.useState('');
  React.useEffect(() => { SCHED_STORE.load(); }, []);

  const jobs = React.useMemo(() => {
    let list = SCHED_STORE.pending();
    if (convId) list = list.filter(j => String(j.convId) === String(convId));
    else if (agentId) list = list.filter(j => !j.agentId || String(j.agentId) === String(agentId));
    return list.slice(0, max);
  }, [all, agentId, convId, max]);

  if (!jobs.length) {
    return <div style={{ fontSize: 10.5, color: 'var(--t3)', padding: '4px 0' }}>
      {emptyText || 'Nothing scheduled yet.'}
    </div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {jobs.map(j => (
        <div key={j.id} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8,
          background: 'rgba(255,255,255,0.022)', border: '1px solid rgba(255,255,255,0.055)',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: j.origin === 'customer' ? 'rgba(200,170,120,0.85)' : 'rgba(170,172,190,0.75)',
          }} title={j.origin === 'customer' ? 'Requested by the customer' : 'Set by you'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11.5, fontWeight: 500, color: 'var(--t1)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{j.label || SCHED_STORE.describeJob(j)}</div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 1 }}>
              {SCHED_TIME.describeAt(j.at, j.tz)}
              {j.recur ? ' · ' + SCHED_STORE.describeRecur(j.recur) : ''}
              {j.attempts > 0 ? ` · retry ${j.attempts}` : ''}
            </div>
          </div>
          <SchedCountdown at={j.at} />
          <button type="button" title="Cancel this"
            disabled={busy === j.id}
            onClick={async () => {
              setBusy(j.id);
              try { await SCHED_STORE.cancel(j.id, 'cancelled by operator'); }
              finally { setBusy(''); }
            }}
            style={{
              width: 20, height: 20, borderRadius: 5, flexShrink: 0, cursor: 'pointer', padding: 0,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--t3)', fontSize: 12, lineHeight: '16px',
            }}>×</button>
        </div>
      ))}
    </div>
  );
};

// ── THE CARD ─────────────────────────────────────────────────────
// Replaces the old "Tasks (optional)" chip grid in the agent popup.
// That control fed twelve fixed strings to the prompt as a vague hint;
// this one controls real capability.
const SchedulingCard = ({ draft, update, compact = false, agentId }) => {
  const on = !!draft.allowScheduling;
  const custOn = on && !!draft.allowCustomerScheduling;

  const Head = ({ children }) => compact
    ? <div className="sset-pop-section-label">{children}</div>
    : (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 10,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 7, flexShrink: 0,
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t2)',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', letterSpacing: '-0.01em' }}>Scheduling</div>
          <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 1, lineHeight: 1.3 }}>Actions this agent can run later</div>
        </div>
      </div>
    );

  const body = (
    <>
      <SchedRow
        label="Scheduled actions"
        hint="e.g. “message Marco in 10 minutes”"
        value={on}
        onChange={v => {
          update('allowScheduling', v);
          // Customer scheduling is a strict subset. Leaving it set while
          // the parent is off would be a switch that lies.
          if (!v) update('allowCustomerScheduling', false);
        }} />

      <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '2px 0' }} />

      <SchedRow
        label="Customer callbacks"
        hint="“Message me tomorrow at 6”"
        value={custOn}
        disabled={!on}
        onChange={v => update('allowCustomerScheduling', v)} />

      {custOn && (
        <div style={{
          display: 'flex', flexDirection: 'column',
          padding: '2px 0 2px 10px', marginLeft: 2,
          borderLeft: '1px solid rgba(255,255,255,0.08)',
        }}>
          <SchedNumber label="Pending per customer" min={1} max={10}
            value={draft.custSchedMaxPending == null ? 3 : draft.custSchedMaxPending}
            onChange={v => update('custSchedMaxPending', v)} />
          <SchedNumber label="Requests per day" min={1} max={20}
            value={draft.custSchedMaxPerDay == null ? 5 : draft.custSchedMaxPerDay}
            onChange={v => update('custSchedMaxPerDay', v)} />
          <SchedNumber label="Max days ahead" suffix="d" min={1} max={365}
            value={draft.custSchedMaxDays == null ? 60 : draft.custSchedMaxDays}
            onChange={v => update('custSchedMaxDays', v)} />
          <SchedRow label="Quiet hours"
            hint="10pm–8am moves to morning"
            value={draft.custSchedQuietHours !== false}
            onChange={v => update('custSchedQuietHours', v)} />
        </div>
      )}

      {on && (
        <>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '2px 0' }} />
          <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 2 }}>
            Queue
          </div>
          <SchedQueue agentId={agentId} emptyText="Nothing scheduled." />
        </>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="sset-pop-section">
        <Head>Scheduling</Head>
        <div className="bc-card" style={{
          padding: '6px 12px 8px', display: 'flex', flexDirection: 'column', gap: 2,
        }}>{body}</div>
      </div>
    );
  }
  return (
    <div className="ag-card" style={{
      background: 'rgba(12,13,26,0.52)',
      backdropFilter: 'blur(20px) saturate(160%)', WebkitBackdropFilter: 'blur(20px) saturate(160%)',
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 13,
      padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <Head>Scheduling</Head>
      {body}
    </div>
  );
};


// ── BOOT ─────────────────────────────────────────────────────────
// Start the runtime once the app signals it is authenticated. Guarded
// so repeated logins don't stack tick loops.
if (typeof window !== 'undefined') {
  window.SCHED_TIME = SCHED_TIME;
  window.SCHED_POLICY = SCHED_POLICY;
  window.SCHED_RUNTIME = SCHED_RUNTIME;
  window.addEventListener('bcAuthReady', () => {
    try { SCHED_RUNTIME.start(); SCHED_STORE.load(true); } catch (e) { console.warn('[sched] boot failed', e); }
  });
  // Some boot paths never fire bcAuthReady (e.g. a restored session).
  // A one-shot delayed start covers those; start() is idempotent.
  setTimeout(() => { try { SCHED_RUNTIME.start(); } catch (_) {} }, 8000);
}