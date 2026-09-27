// ───────────────────────────────────────────────────────────────────
// bot-core.jsx — API client, error handling & text helpers
// Pure utilities. No React. Loaded first.
//   - apiFetch / apiGet (with tolerant JSON parsing + 401 → sign-out)
//   - global window.error / unhandledrejection bridges to the .NET console
//   - stripMarkdown — normalises LLM markdown for plain-text platforms
//   - promoteImplicitSplits — promotes blank-line / sentence breaks to [[SPLIT]]
// ───────────────────────────────────────────────────────────────────

// ── API ───────────────────────────────────────────────────────
const API = 'api.php';
// Tolerant JSON parser: an empty body or a body that's not valid JSON used to
// throw a SyntaxError that the caller's .catch() turned into a generic
// "Unexpected end of JSON input". That hid the real problem (PHP fatal /
// permission error / 500). We now read the response as text first, log the
// raw payload + HTTP status when it can't be parsed, and resolve to a
// structured {error,...} so callers can keep going.
const _parseApi = async (action, r) => {
  // 401 on any private endpoint → kick to login. We DON'T fire this for the
  // auth_* actions themselves so the login form can show its own error.
  if (r.status === 401 && action && action.indexOf('auth_') !== 0) {
    AUTH_STORE.signOut();   // clears local session — UI re-renders to <LoginRegister/>
  }
  const txt = await r.text();
  if (!txt) {
    console.warn('[api]', action, 'empty response — HTTP', r.status, r.statusText);
    return { error: `Empty response (HTTP ${r.status})` };
  }
  try { return JSON.parse(txt); }
  catch (e) {
    console.warn('[api]', action, 'non-JSON response — HTTP', r.status, '— body:', txt.slice(0, 500));
    return { error: `Bad response (HTTP ${r.status}): ${txt.slice(0, 200)}` };
  }
};
// All requests carry the session cookie so the server can identify the
// account. Without `credentials: 'include'` the cookie is dropped on
// cross-origin requests (which happens in the WebView2 host).
//
// ── TIMEOUT POLICY ──
// Every API call gets a hard deadline via AbortController. Without this,
// a hung PHP/MySQL connection or a 3-provider LLM fallback chain (up to
// 3×60s = 180s server-side) would tie up the JS engine pipeline
// indefinitely — `_runOne` await blocks, no inbound progresses, and the
// operator UI shows "Replying…" forever. With it, the fetch rejects after
// the deadline and the engine's existing transient-error retry path
// recovers cleanly.
//
// Timeouts are ACTION-SPECIFIC because LLM calls legitimately need up to
// ~75s (one provider + buffer) while routine DB writes never need more
// than ~15s. The action whitelist below is intentionally short — anything
// not listed gets the default 30s.
const API_TIMEOUTS = {
  ai_reply:        75000,    // one full Gemini/OpenAI/Claude call + buffer
  retry_ai_reply:  75000,    // same
  // The dashboard ghost composer goes through one full LLM round-trip
  // (Gemini/OpenAI/Claude — call_*() in api.php uses a 60s ceiling each)
  // before returning. The previous default of 30s aborted cleanly-formed
  // commands while the model was still composing structured JSON, leaving
  // the operator staring at a frozen "Sending…" chip with no recovery.
  // 75s = 60s server-side cap + 15s for retries / network jitter.
  ghost_command:   75000,
  // A bot reply the server writes in this request (no background worker
  // running), and a file sent to Telegram / Discord through the server.
  bot_relay_tick: 180000,
  bot_relay_send: 180000,
};
const API_TIMEOUT_DEFAULT = 30000;

function _timeoutFor(action) {
  return API_TIMEOUTS[action] || API_TIMEOUT_DEFAULT;
}

function _withTimeout(action, fetchFn) {
  const ctl = new AbortController();
  const ms = _timeoutFor(action);
  const tid = setTimeout(() => {
    try { ctl.abort(); } catch(_) {}
  }, ms);
  return fetchFn(ctl.signal).finally(() => clearTimeout(tid)).catch(err => {
    // AbortError surfaces as a generic error string — translate it into
    // a structured payload the engine recognises as transient.
    if (err && (err.name === 'AbortError' || /aborted/i.test(err.message || ''))) {
      console.warn('[api]', action, 'aborted after', ms, 'ms');
      return { error: 'timeout after ' + ms + 'ms (' + action + ')' };
    }
    throw err;
  });
}

// ── WRITES IN FLIGHT ─────────────────────────────────────────
// Requests that change something on the server (a save, a payment marked
// paid, a message sent, a delete). The desktop app asks the page to finish
// these before it closes (window.bcBeforeClose): a window closed the moment
// after "mark as paid" used to cut the request off, so the server never
// heard about it. Reads and the long AI calls (which carry on on the server
// by themselves) aren't counted.
const BC_WRITES = {
  n: 0,
  re: /^(save_|set_|delete_|update_|add_|record_|assign_|resolve_|escalate_|upsert_|mark_|confirm_|cancel_)|^dm_(send|shop_paid|shop_mirror|shop_resume|outbox_done|reply_rows|reply_take|read|away|ai_assign|ai_auto|ai_offline|block|hide|wipe|publish_key|save_vault|shop_sysx)$/,
  track(promise) {
    this.n++;
    const done = () => { this.n = Math.max(0, this.n - 1); };
    return Promise.resolve(promise).then(v => { done(); return v; }, e => { done(); throw e; });
  },
};
window.bcWritesInFlight = () => BC_WRITES.n;

// Invoices the server mints, watches and delivers: every direct chat's,
// and those on a Telegram / Discord bot chat the server answered (srv).
// The app leaves those to the server.
const bcSrvInvoice = (i) => !!i && (String(i.conv_id || '').startsWith('dm_') || !!i.srv);

const apiFetch = (action, body={}) => {
  const run = _withTimeout(action, (signal) =>
    fetch(`${API}?action=${action}`, {
      method: body && Object.keys(body).length ? 'POST' : 'GET',
      credentials: 'include',
      headers: {'Content-Type':'application/json'},
      body: body && Object.keys(body).length ? JSON.stringify({action,...body}) : undefined,
      signal,
    }).then(r=>_parseApi(action, r))
  ).catch(err=>{ console.warn('[api]',action,err); return {error:err.message}; });
  return BC_WRITES.re.test(String(action)) ? BC_WRITES.track(run) : run;
};

const apiGet = (action, params='') => _withTimeout(action, (signal) =>
  fetch(`${API}?action=${action}${params}`, {
    credentials: 'include',
    signal,
  }).then(r=>_parseApi(action, r))
).catch(err=>{ console.warn('[api]',action,err); return {error:err.message}; });

// ── GLOBAL ERROR PIPE ─────────────────────────────────────────
// The .NET host attaches a DevTools console listener (Form1.OnDevToolsConsole)
// that mirrors every console.log/warn/error/info AND every uncaught exception
// into Visual Studio's Output window. We add explicit window-level handlers so
// async failures (Promise rejections, scripts loaded after page-load, errors
// fired from setTimeout / event handlers) also surface in the .NET log instead
// of dying silently in the WebView.
window.addEventListener('error', (ev) => {
  const where = ev.filename ? ` @${ev.filename}:${ev.lineno||'?'}:${ev.colno||'?'}` : '';
  console.error('[uncaught]', (ev.message || 'window.error') + where, ev.error || '');
});
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason;
  const msg = r && (r.stack || r.message) || String(r);
  console.error('[unhandled promise]', msg);
});

// ── MARKDOWN STRIPPER ─────────────────────────────────────────
// LLMs love emitting "**bold**", "*italic*", "`code`", "* bullet" lists,
// "1. numbered" lists, "# heading" lines, and link "[text](url)" syntax —
// none of which Telegram or Discord renders by default in plain bot text.
// This helper turns them into clean human-readable prose. Idempotent and
// safe on already-clean strings. Preserves intentional newlines (so split
// chunks survive) and the [[INVOICE]] / [[SPLIT]] sentinels.
function stripMarkdown(s) {
  if (!s || typeof s !== 'string') return s || '';
  let out = s;
  // Code fences ```lang\ncode\n``` → just the code body
  out = out.replace(/```[a-z0-9_-]*\n?([\s\S]*?)```/gi, (_, body) => body.trim());
  // Inline `code` → code (drop backticks)
  out = out.replace(/`([^`\n]+)`/g, '$1');
  // Markdown links [text](url) → "text (url)" or just text if url is bare
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, text, url) => {
    if (text.trim() === url.trim()) return url;
    return `${text} (${url})`;
  });
  // Bold / italic — handle ***triple***, **double**, *single*, __u__, _i_
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  out = out.replace(/\*\*(.+?)\*\*/g, '$1');
  out = out.replace(/(?<![A-Za-z0-9_])\*([^*\n]+?)\*(?![A-Za-z0-9_])/g, '$1');
  out = out.replace(/__(.+?)__/g, '$1');
  out = out.replace(/(?<![A-Za-z0-9])_([^_\n]+?)_(?![A-Za-z0-9])/g, '$1');
  // Strikethrough ~~text~~
  out = out.replace(/~~(.+?)~~/g, '$1');
  // Headings: "# Heading" / "## Heading" → "Heading" (just drop the hashes)
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  // Blockquotes: leading "> "
  out = out.replace(/^\s{0,3}>\s?/gm, '');
  // Bullets: "* item", "- item", "+ item" at line start → just "item"
  out = out.replace(/^\s{0,3}[*+\-]\s+/gm, '');
  // Numbered lists: "1. item" / "1) item" → "item"
  out = out.replace(/^\s{0,3}\d{1,3}[.)]\s+/gm, '');
  // Horizontal rules
  out = out.replace(/^\s*[-*_]{3,}\s*$/gm, '');
  // Collapse 3+ blank lines down to 2
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

// ── IMPLICIT-SPLIT NORMALIZER ─────────────────────────────────
// Promotes natural break points to explicit [[SPLIT]] markers so they get
// sent as separate chat messages by the send pipeline. The LLM has TWO
// failure modes we need to handle:
//
//   1. "Blank-line splits" — model leaves a blank line between paragraphs
//      instead of using the sentinel. Easy: promote the blank line.
//
//   2. "Wall of text" — model forgets to split at all and runs everything
//      together on one line ("Hi there! How can I help today?"). The
//      prompt asks it not to do this, but it slips through. We detect
//      sentence boundaries in long single-line replies and inject splits
//      at the most natural place (between sentences), so the customer
//      sees the human-style burst the operator expects.
//
// Rules:
//   - Trigger: 2+ consecutive newlines between non-empty lines (case 1),
//     OR a single line >= 35 chars containing 2+ sentence enders (case 2).
//   - Skip if the reply is <25 chars (too short to bother splitting).
//   - Preserve any [[SPLIT]] / [[INVOICE]] sentinels already present.
//   - Treat the substituted invoice block (recognised by "Send X to:"
//     plus an "Invoice #" line) as one atomic chunk — we don't split
//     between the amount line and the address line.
//   - For wall-of-text, we cap at 3 chunks total. More than that and we
//     trust whatever the model intended — over-splitting is its own tell.
// Join two message fragments into one bubble so the result still reads like
// a sentence rather than a run-on. Models usually punctuate their own lines,
// but short bullet-ish beats ("both in stock" / "free shipping") often don't,
// and gluing those with a bare space produced unreadable merges.
// ── PAYMENT BLOCK RECOGNITION — SINGLE SOURCE OF TRUTH ────────────────
// Everything downstream that needs to answer "is this a rendered payment
// block?" asks here. This used to be fifteen separate copies of
// /Send\s+[A-Z0-9/]+\s+to:/i scattered across bot-core and bot-engine,
// which was wrong in two ways:
//
//   1. That label is ENGLISH ONLY. The block renders in fifteen languages,
//      so a Spanish or Japanese payment block matched none of the guards.
//      It got shredded into one message per line, the sale-closed check
//      missed it, and the agent could fire a SECOND invoice on top of one
//      the customer was already holding.
//   2. It pinned the block to exactly ONE layout. The block is now written
//      in several shapes (see INVOICE_PROCESSOR.buildSubstitution), so a
//      label-matching guard would silently stop recognising most of them —
//      the same failure as (1), but on every conversation rather than the
//      non-English ones.
//
// The invariant that DOES hold in every language and every layout is that
// the address sits alone on its own line. buildSubstitution guarantees it
// (the address is never interpolated into a sentence), so that is what we
// match on. The old English label is still accepted so that blocks already
// sitting in conversation history keep being recognised after this change.
const PAYMENT_BLOCK = {
  // A bare address on its own line: 25+ unbroken address-safe characters.
  // base58 / bech32 / 0x-hex all qualify. A URL does not (it carries "/"
  // and "." which are outside the class) and neither does prose (spaces).
  ADDRESS_LINE_RE: /(^|\n)[ \t]*[A-Za-z0-9:_-]{25,}[ \t]*(?=\r?\n|$)/,
  // Pre-localisation English label, kept for backwards compatibility with
  // messages already stored in threads.
  LEGACY_LABEL_RE: /Send\s+[A-Z0-9/]+\s+to:/i,
  SENTINEL_RE: /\[\[(?:INVOICE:|ACTION:\s*invoice\s*\|)/i,

  hasAddress(t) { return this.ADDRESS_LINE_RE.test(String(t || '')); },

  // The customer is looking at a REAL address right now (block already
  // substituted). This is the test that "did we already close the sale?"
  // and "is this chunk atomic?" both want.
  isRendered(t) {
    const s = String(t || '');
    return this.ADDRESS_LINE_RE.test(s) || this.LEGACY_LABEL_RE.test(s);
  },

  // Rendered block OR an unsubstituted sentinel that is about to become one.
  looksLike(t) {
    const s = String(t || '');
    return this.isRendered(s) || this.SENTINEL_RE.test(s);
  },

  // Is this single line part of the payment block rather than prose around
  // it? Used to keep the block together when splitting, and to find where
  // the block starts. Deliberately shape-based, not word-based, so it holds
  // for every language and every layout variant.
  isBlockLine(line) {
    const t = String(line || '').trim();
    if (!t || t.length > 130) return false;
    if (/^[A-Za-z0-9:_-]{25,}$/.test(t)) return true;         // the address itself
    if (/^\(.*\)$/.test(t)) return true;                       // (network minimum ...)
    if (/:\s*$/.test(t) && t.length <= 60) return true;        // "Send LTC to:" / "LTC 주소:"
    // "0.664 LTC ($35)" — a figure next to a ticker. Tickers are ASCII in
    // every language, which is what makes this portable.
    if (/\d/.test(t) && /[A-Z]{2,10}(?:\/[A-Z0-9]{2,10})?/.test(t) && t.length <= 90) return true;
    // "Amount: <anything short>" / "Importe: ..." / "金額: ..."
    if (/^[^\n:]{1,30}:[ \t]\S/.test(t) && t.length <= 110) return true;
    return false;
  },

  // Index at which the payment block starts inside `text`, or -1.
  // Anchors on the address line, then walks BACKWARDS over up to three
  // contiguous block lines so a split lands in front of the whole block
  // instead of in the middle of it. Replaces the old INVOICE_RENDERED
  // regex, which could only ever find an English one.
  findStart(text) {
    const s = String(text || '');
    const m = s.match(this.ADDRESS_LINE_RE);
    if (!m) {
      const legacy = s.match(this.LEGACY_LABEL_RE);
      return legacy ? s.indexOf(legacy[0]) : -1;
    }
    // Start of the address line itself.
    let idx = s.indexOf(m[0]) + (m[1] ? m[1].length : 0);
    const before = s.slice(0, idx);
    const lines = before.split(/\n/);
    // lines[lines.length-1] is the empty remainder after the final \n.
    let back = 0;
    let cut = idx;
    for (let i = lines.length - 2; i >= 0 && back < 3; i--) {
      const ln = lines[i];
      if (!this.isBlockLine(ln)) break;
      cut -= (ln.length + 1);
      back++;
    }
    return Math.max(0, cut);
  },
};

function glueFragments(a, b) {
  const left = (a || '').trim();
  const right = (b || '').trim();
  if (!left) return right;
  if (!right) return left;
  if (/[.!?,;:—-]$/.test(left)) return left + ' ' + right;
  // New sentence starting with a capital or a digit → full stop.
  if (/^[A-Z0-9]/.test(right)) return left + '. ' + right;
  return left + ', ' + right;
}

function promoteImplicitSplits(s) {
  if (!s || typeof s !== 'string') return s || '';
  if (s.length < 25) return s;

  // C4: Skip implicit-splitting if the text contains preformatted/code-style
  // content. Sales replies never need this, but tech-support flows do, and
  // splitting code at every blank line shreds it into incoherent fragments.
  // Cheap detector: triple-backtick fences, OR ≥2 lines with 4+ spaces of
  // leading indent.
  if (/```/.test(s)) return s;
  const indentedLines = (s.match(/^[ \t]{4,}\S/gm) || []).length;
  if (indentedLines >= 2) return s;

  // ── SHARED DETECTORS ──────────────────────────────────────────────
  // A bare address on its own line: 25+ unbroken address-safe characters,
  // no spaces. Every detector below also tests this, because the "Send X
  // to:" phrase is ENGLISH ONLY — the block renders that label in fifteen
  // languages, so a Spanish or Japanese payment block matched none of the
  // invoice guards and got shredded line by line into separate messages.
  const hasAddressLine = (t) => PAYMENT_BLOCK.hasAddress(t);
  const isInvoiceish   = (t) => PAYMENT_BLOCK.looksLike(t);

  // A "list line" is one entry in an enumeration the customer is meant to
  // read as a SET: a bullet, a numbered item, or a "name — $price" style
  // catalogue row. These must never be exploded into one message each;
  // that's what turns a two-product answer into a six-message burst.
  const isListLine = (line) => {
    const t = (line || '').trim();
    if (!t) return false;
    if (/^[-•*·–]\s+\S/.test(t)) return true;                 // - foo / • foo
    if (/^\(?\d{1,2}[.)]\s+\S/.test(t)) return true;          // 1. foo / 2) foo
    if (/^[a-z][.)]\s+\S/i.test(t) && t.length < 60) return true;
    // "name ($50)" / "name - $50" / "name: $50/mo" catalogue rows.
    if (/[^\s].*(?:[:\-–—]\s*)?[$£€]\s?\d/.test(t) && t.length < 80) return true;
    return false;
  };

  // 2+ consecutive list lines = a list block; keep it in ONE bubble.
  const looksLikeList = (lines) => {
    let run = 0;
    for (const ln of lines) {
      if (isListLine(ln)) { run++; if (run >= 2) return true; }
      else run = 0;
    }
    return false;
  };

  // ── DYNAMIC BUBBLE BUDGET ─────────────────────────────────────────
  // How many bubbles this particular reply has earned. Short replies get
  // fewer; an invoice earns one extra because the address block is always
  // its own bubble and shouldn't eat the conversational budget.
  const bareLen = s.replace(/\[\[(?:SPLIT|ACTION:[^\]]*|INVOICE:[^\]]*)\]\]/gi, ' ').trim().length;
  let MAX_BUBBLES;
  if (bareLen < 90)       MAX_BUBBLES = 2;   // a one-liner is a one-liner
  else if (bareLen < 220) MAX_BUBBLES = 3;
  else                    MAX_BUBBLES = 3;   // long replies still cap at 3 prose bubbles
  // A payment block is worth TWO extra bubbles, not one: some layouts fire
  // the figure, the address and the follow-up line as three short messages,
  // and at +1 the cap merged the figure back into whatever prose came before
  // it — which is the one merge that makes the amount easy to miss.
  if (isInvoiceish(s)) MAX_BUBBLES += 2;

  // ── PASS 0: separate prose from any [[INVOICE: ...]] / [[ACTION:invoice|...]] sentinel ──
  // Common LLM failure mode: "Sure! Here you go: [[ACTION:invoice|...]]" all
  // on one line. We auto-promote this to "Sure! Here you go:" [[SPLIT]]
  // "[[ACTION:invoice|...]]" so the address bubble (after substitution) is
  // visually separate from the conversational beat. Also handles the
  // rendered-invoice case (after substitution) where prose is glued to
  // "Amount: ..." or "Send X to:" — splits before those markers too.
  const INVOICE_SENTINEL = /\[\[(?:INVOICE:|ACTION:\s*invoice\s*\|)[^\]]+\]\]/i;
  // Allow up to two "Label: value" lines ahead of the send-to line, so the
  // split lands in front of the WHOLE block rather than in the middle of
  // it. The block renders as "For: <item>" / "Amount: <figure>" / "Send X
  // to:" / <address>; matching only from "Amount:" left the "For:" line
  // stranded in the previous bubble, and matching only from "Send X to:"
  // (which is what happened whenever anything sat between the amount and
  // the address) tore the block into three separate messages.
  //
  // The label lines are matched generically rather than by name because
  // they are localised: "Concepto"/"Importe" in Spanish, "内容"/"金額" in
  // Japanese. Bounded lengths keep ordinary prose containing a colon from
  // being swallowed, and leftmost-match means the block's own first label
  // line always wins.
  const splitBeforeInvoice = (text) => {
    const trimmed = text.trim();
    // Skip if no invoice or if already starts with invoice (nothing to peel off).
    // The rendered case is located by PAYMENT_BLOCK.findStart, which anchors on
    // the address line and walks back over the block's own lines — so it finds
    // the block in any language and in any of the layout variants, where the
    // old INVOICE_RENDERED regex only ever found an English one in the single
    // layout it was written against.
    const sentMatch = trimmed.match(INVOICE_SENTINEL);
    let idx;
    if (sentMatch) {
      idx = trimmed.indexOf(sentMatch[0]);
    } else {
      idx = PAYMENT_BLOCK.findStart(trimmed);
      if (idx === -1) return trimmed;
    }
    if (idx <= 0) return trimmed;        // invoice is at the very start — nothing to split off
    const before = trimmed.slice(0, idx).trim();
    const after  = trimmed.slice(idx).trim();
    // Don't split if prose-before is trivially short — let it ride with the invoice.
    if (before.length < 5) return trimmed;
    return before + '\n[[SPLIT]]\n' + after;
  };
  // Apply pass-0 to the WHOLE string (the invoice can appear anywhere; we
  // process each blank-line paragraph individually below for further splits).
  s = splitBeforeInvoice(s);

  // ── PASS 1: blank-line → [[SPLIT]] ──
  // Walk paragraphs separated by blank lines. We do NOT split within a
  // paragraph — single newlines stay intact (helpful for short address
  // blocks). A "paragraph" here is anything between blank lines.
  const paragraphs = s.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  let out;
  if (paragraphs.length > 1) {
    const joiner = '\n[[SPLIT]]\n';
    // Don't split between paragraphs where one is an invoice payment block —
    // CryptAPI address lines look more cohesive in a single bubble.
    const isInvoiceBlock = p => PAYMENT_BLOCK.isRendered(p);
    out = paragraphs[0];
    for (let i = 1; i < paragraphs.length; i++) {
      const prev = paragraphs[i-1];
      const cur  = paragraphs[i];
      // If either side already has [[SPLIT]] adjacent, just rejoin with
      // a blank line so we don't produce "[[SPLIT]]\n[[SPLIT]]" pairs.
      const prevEndsSplit = /\[\[SPLIT\]\]\s*$/i.test(prev);
      const curStartsSplit = /^\s*\[\[SPLIT\]\]/i.test(cur);
      const skip = isInvoiceBlock(prev) || isInvoiceBlock(cur) || prevEndsSplit || curStartsSplit;
      out += skip ? '\n\n' + cur : joiner + cur;
    }
  } else {
    out = s;
  }

  // ── PASS 1.5: single-newline → [[SPLIT]] (NARROW — lists are protected) ──
  // Models often put each intended bubble on its own line. We promote those,
  // but this pass used to fire on EVERY newline, which shredded catalogue
  // listings ("yellow $50\nmantool $214") into one message per product and
  // produced the 6-7 message bursts operators complained about.
  //
  // We now refuse to split a segment when:
  //   • it contains the substituted invoice/address block, OR
  //   • its lines look like an enumeration (a list is ONE thought), OR
  //   • the lines are short fragments that clearly belong together.
  {
    const segments = out.split(/\n\[\[SPLIT\]\]\n/i);   // preserve any existing splits
    // Shape-based, not label-based — see PAYMENT_BLOCK.isBlockLine. The old
    // literal "Amount:" / "Send X to:" / "(Network minimum" list only ever
    // matched an English block in the one layout it was written against.
    const INVOICE_LINE = { test: (ln) => PAYMENT_BLOCK.isBlockLine(ln) };
    const rebuilt = segments.map(seg => {
      if (!/\n/.test(seg)) return seg;                  // single line — nothing to do
      // Invoice block stays fully intact (amount + address + tail = one bubble).
      if (PAYMENT_BLOCK.isRendered(seg)) return seg;

      const lines = seg.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return lines.join('');

      // Re-stitch into pieces. Two kinds of run are kept TOGETHER:
      //   • invoice-block lines (amount / address / network note), and
      //   • consecutive list rows — an enumeration is ONE thought, and
      //     exploding it is what turned a three-product answer into a
      //     three-message burst.
      // Non-list prose lines around the list still become their own beats,
      // so a greeting or a closing question isn't swallowed into the list.
      const pieces = [];
      let buf = [];
      let bufKind = null;   // 'invoice' | 'list'
      const flush = () => { if (buf.length) { pieces.push(buf.join('\n')); buf = []; bufKind = null; } };
      for (const ln of lines) {
        const kind = INVOICE_LINE.test(ln) ? 'invoice' : (isListLine(ln) ? 'list' : null);
        if (kind && bufKind === kind) { buf.push(ln); continue; }
        flush();
        if (kind) { buf = [ln]; bufKind = kind; }
        else pieces.push(ln);
      }
      flush();
      // A lone list row is just prose — don't leave it stranded as its own
      // bubble; fold it into the previous piece.
      const collapsed = [];
      for (const p of pieces) {
        const rows = p.split('\n');
        if (collapsed.length && rows.length === 1 && isListLine(p)) {
          collapsed[collapsed.length - 1] += '\n' + p;
        } else {
          collapsed.push(p);
        }
      }
      // Merge stray short fragments forward so we don't ship "ok." alone.
      const merged = [];
      for (const p of collapsed) {
        if (merged.length && p.length < 12 && !/\?$/.test(p) && !/\n/.test(p)) {
          merged[merged.length - 1] = glueFragments(merged[merged.length - 1], p);
        } else {
          merged.push(p);
        }
      }
      return merged.join('\n[[SPLIT]]\n');
    });
    out = rebuilt.join('\n[[SPLIT]]\n');
  }

  // ── PASS 2: sentence-boundary split for "wall of text" chunks ──
  // For each chunk that's still too long and lacks any [[SPLIT]], try to
  // break it at sentence boundaries. We only inject ONE split per chunk to
  // avoid over-fragmenting.
  const splitChunks = out.split(/\n\[\[SPLIT\]\]\n/i);
  const totalSplits = splitChunks.length - 1;

  // Helper — split a single-line wall of text at sentence boundaries.
  // Returns either the original string OR a 2-piece string joined by [[SPLIT]].
  const splitWallOfText = (text) => {
    const trimmed = text.trim();
    // Skip invoice blocks (amount + address must stay together).
    if (PAYMENT_BLOCK.isRendered(trimmed)) return trimmed;
    // Skip if already short or already multi-line.
    // Raised from 35 → 120: a two-sentence reply is a perfectly natural
    // single message. Only genuine walls of text earn a split here.
    if (trimmed.length < 120) return trimmed;
    if (/\n/.test(trimmed)) return trimmed;
    // Never fragment an enumeration written inline.
    if (isListLine(trimmed) && trimmed.length < 100) return trimmed;

    // ── Peel a leading greeting into its own bubble first ──
    // "hey. we got X. what's up?" → "hey." + "we got X. what's up?"
    // Real people fire the greeting as its own message. We only peel when
    // there's substantive content after it.
    let head = '';
    let body = trimmed;
    const greetMatch = trimmed.match(/^((?:hi|hey|hello|heya|yo|sup|howdy|morning|good\s+(?:morning|afternoon|evening)|g'?day)[!.,…]*\s*(?:there|man|mate|friend)?[!.,…]*)\s+(.*)$/is);
    if (greetMatch && greetMatch[2] && greetMatch[2].trim().length >= 12) {
      head = greetMatch[1].trim();
      body = greetMatch[2].trim();
    }

    // Find sentence-ender positions in the body: ., !, ? followed by space +
    // a likely sentence start. We split the body at its midmost boundary.
    const splitOnce = (txt) => {
      const t = txt.trim();
      if (t.length < 80) return [t];
      const enders = [];
      const re = /([.!?])(\s+)(?=[A-Za-z(@$])/g;
      let m;
      while ((m = re.exec(t)) !== null) enders.push(m.index + 1);
      if (!enders.length) return [t];
      const mid = t.length / 2;
      let best = enders[0], bestDist = Math.abs(enders[0] - mid);
      for (let i = 1; i < enders.length; i++) {
        const d = Math.abs(enders[i] - mid);
        if (d < bestDist) { best = enders[i]; bestDist = d; }
      }
      const left = t.slice(0, best).trim();
      const right = t.slice(best).trim();
      if (left.length < 20 || right.length < 20) return [t];
      return [left, right];
    };

    const bodyPieces = splitOnce(body);
    const pieces = (head ? [head] : []).concat(bodyPieces);
    if (pieces.length <= 1) return trimmed;     // nothing gained
    return pieces.join('\n[[SPLIT]]\n');
  };

  // Apply wall-of-text splitting to each chunk, respecting the global budget.
  let chunksOut = [];
  let currentSplits = totalSplits;
  for (const chunk of splitChunks) {
    if (currentSplits >= MAX_BUBBLES - 1) {
      // Already at budget — pass remaining chunks through untouched.
      chunksOut.push(chunk);
      continue;
    }
    const split = splitWallOfText(chunk);
    if (split !== chunk.trim()) {
      const added = (split.match(/\[\[SPLIT\]\]/gi) || []).length;
      const budget = (MAX_BUBBLES - 1) - currentSplits;
      if (added <= budget) {
        currentSplits += added;
        chunksOut.push(split);
      } else {
        // Keep only `budget` splits; merge the overflow tail back together.
        const parts = split.split(/\n\[\[SPLIT\]\]\n/i);
        const kept = parts.slice(0, budget);
        const tail = parts.slice(budget).reduce((acc, x) => glueFragments(acc, x), '');
        if (tail) kept.push(tail);
        currentSplits += budget;
        chunksOut.push(kept.join('\n[[SPLIT]]\n'));
      }
    } else {
      chunksOut.push(split);
    }
  }

  out = chunksOut.join('\n[[SPLIT]]\n');

  // ── PASS 2.5: MERGE PARALLEL ENUMERATION CHUNKS ───────────────────
  // A spec rundown split across bubbles — "bronze has X at $35. silver has Y
  // at $50." / "platinum has Z at $100. gold has W at $150." — is ONE answer
  // to ONE question, and the customer reads it as the bot machine-gunning
  // them. PASS 1.5 already keeps a newline-separated list together, but the
  // model often emits explicit [[SPLIT]] markers between the halves, which
  // bypassed that protection entirely.
  //
  // Detector: two adjacent chunks that are structurally parallel — both
  // priced/enumerative, neither a question, neither carrying a sentinel.
  {
    const parts = out.split(/\n\[\[SPLIT\]\]\n/i).map(p => p.trim()).filter(Boolean);
    const priced = (p) => /[$£€]\s?\d/.test(p) || /^[-•*·–]\s|^\(?\d{1,2}[.)]\s/.test(p);
    const mergeable = (p) => priced(p)
      && p.indexOf('?') === -1
      && !/\[\[(?:ACTION|INVOICE|LICENSE):/i.test(p)
      && !PAYMENT_BLOCK.isRendered(p);
    const merged = [];
    for (const p of parts) {
      const prev = merged.length ? merged[merged.length - 1] : null;
      if (prev && mergeable(prev) && mergeable(p) && (prev.length + p.length) <= 320) {
        merged[merged.length - 1] = prev + ' ' + p;
      } else {
        merged.push(p);
      }
    }
    out = merged.join('\n[[SPLIT]]\n');
  }

  // ── PASS 3: GLOBAL BUBBLE CAP (authoritative) ─────────────────────
  // The old MAX_TOTAL_CHUNKS only constrained PASS 2 — it was computed AFTER
  // passes 1 and 1.5 had already run, so a reply that arrived as seven lines
  // sailed straight through and the customer got seven messages. This pass
  // is the real ceiling and runs last, no matter which pass created the
  // splits or whether the model emitted [[SPLIT]] markers itself.
  out = enforceBubbleCap(out, MAX_BUBBLES);

  return out;
}

// Merge a split reply back down to at most `max` bubbles.
//
// Rather than lopping off the tail (which loses the closing beat), we
// repeatedly merge the ADJACENT PAIR with the smallest combined length —
// so the two shortest neighbouring fragments join first and the reply keeps
// its natural shape. Invoice/address bubbles are atomic and never merged
// into a neighbour, since the address must stay on its own.
function enforceBubbleCap(text, max) {
  if (!text || typeof text !== 'string') return text || '';
  if (!Number.isFinite(max) || max < 1) max = 3;

  let parts = text.split(/\s*\[\[SPLIT\]\]\s*/i).map(p => p.trim()).filter(Boolean);
  if (parts.length <= max) return parts.join('\n[[SPLIT]]\n');

  const isAtomic = (p) => PAYMENT_BLOCK.looksLike(p);

  let guard = 0;
  while (parts.length > max && guard++ < 50) {
    let bestIdx = -1, bestLen = Infinity;
    for (let i = 0; i < parts.length - 1; i++) {
      // Never fold an invoice bubble into its neighbour.
      if (isAtomic(parts[i]) || isAtomic(parts[i + 1])) continue;
      const combined = parts[i].length + parts[i + 1].length;
      if (combined < bestLen) { bestLen = combined; bestIdx = i; }
    }
    if (bestIdx === -1) break;   // everything left is atomic — stop
    // Join with a newline when either side is a list row (keeps the
    // enumeration readable), otherwise with a space so it reads as prose.
    const a = parts[bestIdx], b = parts[bestIdx + 1];
    const listy = /^[-•*·–]\s|^\(?\d{1,2}[.)]\s|[$£€]\s?\d/.test(a) || /^[-•*·–]\s|^\(?\d{1,2}[.)]\s/.test(b);
    const glue = listy ? '\n' : ' ';
    parts.splice(bestIdx, 2, (listy ? (a + glue + b).trim() : glueFragments(a, b)));
  }

  return parts.join('\n[[SPLIT]]\n');
}

// ── HANDLE NORMALISATION ──────────────────────────────────────
// Canonical form of a handle or licence username: trimmed, zero-width
// junk removed, EVERY leading @ stripped. Never returns a leading @ —
// prefix it at render time, exactly once.
const bcNormHandle = (raw) =>
  String(raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
    .trim();

// Is this a real, human-facing handle, or a platform id that ended up in
// the handle column? An all-digits "handle" is a Telegram chat id and
// must never be shown with an @ in front of it.
const bcIsRealHandle = (raw) => {
  const s = bcNormHandle(raw);
  if (!s) return false;
  if (/^\d+$/.test(s)) return false;   // Telegram chat id, not a username
  if (/\s/.test(s)) return false;      // a display name that landed here
  return !/^(unknown|null|none|n\/a|user|deleted account)$/i.test(s);
};

// Discord leaves "#0" (legacy "#0000") on migrated accounts. That is a
// sentinel, not part of the name, so drop it for display. A genuine old
// discriminator like "#4821" is kept, because it still identifies them.
const bcBaseHandle = (raw) => {
  const s = bcNormHandle(raw);
  const i = s.indexOf('#');
  if (i === -1) return s;
  const disc = s.slice(i + 1);
  return (disc === '' || disc === '0' || disc === '0000') ? s.slice(0, i) : s;
};

// Render-ready handle: "@alice", or '' when there is nothing honest to
// show. Callers should hide the row entirely on ''.
//   bcAtHandle('@@alice')     -> '@alice'
//   bcAtHandle('riley_c#0')   -> '@riley_c'   (Discord migrated sentinel)
//   bcAtHandle('8412339901')  -> ''
const bcAtHandle = (raw) => (bcIsRealHandle(raw) ? '@' + bcBaseHandle(raw) : '');
