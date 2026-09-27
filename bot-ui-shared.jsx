// ───────────────────────────────────────────────────────────────────
// bot-ui-shared.jsx — Shared UI atoms (icons, avatars, chat widgets)
// Small visual primitives used by both MsgList and the various chat
// surfaces. These are the building blocks; screen-level views live in
// bot-ui-views.jsx.
//     Tg/Dc/Gemini/OpenAi/Anthropic icons + LLM_PROVIDERS table
//     BotAva / Ava / Pip              — avatars + presence dot
//     DraftPreview / UpcomingChunks   — draft chunk + queued chunk previews
//     ensureComposerStyles            — AI-draft strip + dynamic Send button styles
//     NOW_TICK / useNowTick           — shared 1Hz clock for the whole app
//     ChatBubbleRow                   — reusable bubble with hover timestamp
//     CtxMenu                         — message right-click menu
//     ConvAiControls                  — per-chat AI on/off + agent picker
//     InPageChat                      — full-pane chat view
// ───────────────────────────────────────────────────────────────────

// ── ICONS ────────────────────────────────────────────────────
// ── DraftPreview — renders the current draft chunk's text, plus a faint
//    "upcoming" preview list when this draft is part of a multi-message
//    split reply (chunkTotal > 1). Each chunk now arrives as its OWN
//    draft from the engine, so the user never sees raw [[SPLIT]] markers
//    — they see only the current message's text + a teaser of what's
//    queued next. Backward-compatible: if `upcoming` is omitted (legacy
//    callers passing a single text with embedded splits) we fall back to
//    splitting the text inline as before.
const DRAFT_SPLIT_RE = /\s*\[\[SPLIT\]\]\s*/i;
const DraftPreview = ({text, fontSize=11.5, opacity=0.85, upcoming, showUpcoming=true}) => {
  if (!text) return <div className="b-text" style={{opacity, fontSize}}>…</div>;

  // Legacy fallback: text contains [[SPLIT]] and no `upcoming` was passed.
  // Render the inline divider style we used before per-chunk drafts existed.
  if (!upcoming && DRAFT_SPLIT_RE.test(text)) {
    const parts = text.split(new RegExp(DRAFT_SPLIT_RE.source, 'gi'))
      .map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      return (
        <div style={{marginTop:2,display:'flex',flexDirection:'column',gap:0}}>
          {parts.map((chunk, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 0',opacity:0.55}}>
                  <span style={{flex:1,height:1,background:'linear-gradient(to right, transparent, rgba(108,99,255,0.35), transparent)'}}/>
                  <span style={{fontSize:8.5,fontWeight:700,color:'rgba(168,156,247,0.75)',letterSpacing:'0.12em',fontFamily:'var(--mono)'}}>NEW MESSAGE</span>
                  <span style={{flex:1,height:1,background:'linear-gradient(to right, transparent, rgba(108,99,255,0.35), transparent)'}}/>
                </div>
              )}
              <div className="b-text" style={{opacity,fontSize,whiteSpace:'pre-wrap'}}>{chunk}</div>
            </React.Fragment>
          ))}
        </div>
      );
    }
  }

  // Standard path: just the current chunk's text. Upcoming preview is
  // rendered separately by the composer (see UpcomingChunks below) so the
  // preview can sit OUTSIDE the editable bubble.
  return (
    <div className="b-text" style={{opacity, fontSize, marginTop:2, whiteSpace:'pre-wrap'}}>{text}</div>
  );
};

// ── COMPOSER STYLES ─────────────────────────────────────────────────
// The composer panel in every state — manual, reply, edit, AI draft — and
// the ghost chat's. Glass tinted from the accent; text labels instead of
// badges; colour spent only on state (accent while the AI counts down,
// a muted amber once it's holding for you).
const ensureComposerStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-composer-style')) return;
  const st = document.createElement('style');
  st.id = 'bc-composer-style';
  st.textContent = `
/* ── The composer shell ──
   One glass panel for every state (idle, typing, replying, editing, AI
   draft). Tinted from the accent, blurred enough to separate it from the
   thread and still let bubbles read through, never milky. Its height is
   animated from its content (see useComposerHeight) and it widens a
   little when an AI draft needs the room. */
.bc-comp {
  --comp-tint: color-mix(in oklab, var(--acc, #6c63ff) 6%, #13141d);
  display: flex; flex-direction: column; justify-content: flex-end;
  max-width: max(420px, calc(var(--msg-col-w, 680px) - 120px));
  background: color-mix(in srgb, var(--comp-tint) 68%, transparent);
  -webkit-backdrop-filter: blur(22px) saturate(150%); backdrop-filter: blur(22px) saturate(150%);
  border: 1px solid rgba(255,255,255,0.075); border-radius: 0 14px 14px 14px; overflow: hidden;
  box-shadow: 0 20px 44px -20px rgba(0,0,0,0.65), 0 2px 8px -2px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05);
}
html[data-glass="clear"] .bc-comp { background: color-mix(in srgb, var(--comp-tint) 55%, transparent); }
html[data-glass="solid"] .bc-comp { background: color-mix(in srgb, var(--comp-tint) 94%, transparent); }
.bc-comp[data-draft="1"] { max-width: max(440px, calc(var(--msg-col-w, 680px) - 90px));
  border-color: color-mix(in oklab, var(--acc, #6c63ff) 16%, rgba(255,255,255,0.07)); }
.bc-comp:focus-within { border-color: rgba(255,255,255,0.11); }
.bc-comp[data-draft="1"]:focus-within { border-color: color-mix(in oklab, var(--acc, #6c63ff) 24%, rgba(255,255,255,0.09)); }
.bc-comp-in { flex-shrink: 0; position: relative; }

/* ── AI draft ── */
.bc-dr { position: relative; padding: 9px 12px 9px; cursor: default;
  border-bottom: 1px solid rgba(255,255,255,0.055); }
/* Countdown: a hairline along the very top edge of the panel. */
.bc-dr-bar { position: absolute; left: 0; right: 0; top: 0; height: 2px; overflow: hidden; background: rgba(255,255,255,0.04); }
/* The fill is one compositor animation per draft (see DraftCountdownFill):
   scaleX from its real starting point to 1 over exactly the time left —
   no per-tick width updates, so it glides at the display's refresh rate. */
.bc-dr-fill { position: absolute; inset: 0; transform-origin: 0 50%; transform: scaleX(0); will-change: transform;
  background: linear-gradient(90deg, color-mix(in oklab, var(--acc, #6c63ff) 40%, transparent), color-mix(in oklab, var(--acc, #6c63ff) 75%, #dcdce8)); }
.bc-dr-fill[data-run="1"] { animation-name: bcDrRun; animation-timing-function: linear; animation-fill-mode: both; }
@keyframes bcDrRun { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.bc-dr-bar[data-state="paused"] .bc-dr-fill { background: rgba(214,170,100,0.55); }
.bc-dr-tick { position: absolute; top: 0; bottom: 0; width: 2px; background: color-mix(in srgb, var(--comp-tint) 90%, transparent); }
/* Countdown trace — the line runs along the top edge, turns the panel's
   rounded corner and carries on down the right side before the message
   goes. Drawn as one SVG path laid over the draft section, following the
   panel's own 14px corner (13px inside the border). Progress is a
   stroke-dashoffset on a pathLength=1 path, so speed is constant along the
   whole route — the corner is taken at the same pace as the straight. */
.bc-dr-trace { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 1; }
.bc-dr-trace path { fill: none; }
.bc-dr-track { stroke: rgba(255,255,255,0.045); stroke-width: 2; }
.bc-dr-run { stroke-width: 2; stroke-linecap: butt; }
.bc-dr-comet { stroke-width: 2.4; stroke-linecap: round;
  stroke: color-mix(in oklab, var(--acc, #6c63ff) 35%, #f4f4fa);
  filter: drop-shadow(0 0 3px color-mix(in oklab, var(--acc, #6c63ff) 70%, transparent)); }
.bc-dr-trace[data-state="paused"] .bc-dr-comet { stroke: #e2c48f; filter: none; opacity: .75; }
.bc-dr-trace-tick { fill: color-mix(in srgb, var(--comp-tint) 92%, transparent); }
.bc-dr-head { display: flex; align-items: center; gap: 8px; min-height: 20px; margin-bottom: 6px;
  font-size: 11px; line-height: 1; letter-spacing: -0.005em; }
.bc-dr-status { display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0; font-weight: 600; color: var(--t1); }
.bc-dr-status[data-state="paused"] { color: #dcc49b; }
.bc-dr-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: color-mix(in oklab, var(--acc, #6c63ff) 70%, #e0e0ea); }
.bc-dr-status[data-state="live"] .bc-dr-dot { animation: bcDrPulse 1.6s ease-in-out infinite; }
.bc-dr-status[data-state="paused"] .bc-dr-dot { background: #cfa865; animation: none; }
@keyframes bcDrPulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.bc-dr-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--t3); font-weight: 400;
  font-variant-numeric: tabular-nums; }
.bc-dr-meta::before { content: ''; display: inline-block; width: 1px; height: 10px; margin: 0 8px 0 0; vertical-align: -1px;
  background: rgba(255,255,255,0.1); }
.bc-dr-spacer { flex: 1; }
.bc-dr-note { flex-shrink: 0; white-space: nowrap; color: var(--t3); font-variant-numeric: tabular-nums; }
.bc-dr-note b { font-weight: 500; color: var(--t2); }
.bc-dr-link { all: unset; box-sizing: border-box; flex-shrink: 0; height: 22px; padding: 0 8px; border-radius: 6px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; font-weight: 500; color: var(--t2);
  transition: background-color .15s ease, color .15s ease; }
.bc-dr-link:hover { background: rgba(255,255,255,0.06); color: var(--t1); }
.bc-dr-x { all: unset; box-sizing: border-box; flex-shrink: 0; width: 22px; height: 22px; border-radius: 6px; margin-right: -4px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: var(--t3);
  transition: background-color .15s ease, color .15s ease; }
.bc-dr-x:hover { background: rgba(255,255,255,0.06); color: #e2a59d; }
.bc-dr-edit { display: block; width: 100%; box-sizing: border-box; padding: 6px 9px; border-radius: 8px; resize: none; outline: none;
  font-family: var(--font); font-size: 12.5px; line-height: 1.5; letter-spacing: -0.005em; color: var(--t1);
  background: rgba(255,255,255,0.028); border: 1px solid rgba(255,255,255,0.05);
  transition: background-color .15s ease, border-color .15s ease; }
.bc-dr-edit:hover { border-color: rgba(255,255,255,0.08); }
.bc-dr-edit:focus { background: rgba(255,255,255,0.04); border-color: color-mix(in oklab, var(--acc, #6c63ff) 32%, rgba(255,255,255,0.08)); }
.bc-dr-atts { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.bc-dr-att { position: relative; width: 52px; height: 52px; border-radius: 8px; overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
.bc-dr-att img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bc-dr-queue { display: flex; flex-direction: column; gap: 2px; margin-top: 7px; }
.bc-dr-queue-head { display: flex; align-items: center; gap: 6px; margin-bottom: 1px; font-size: 10.5px; color: var(--t3); }
.bc-dr-queue-item { display: flex; align-items: flex-start; gap: 8px; padding: 2px 2px 2px 9px;
  font-size: 11.5px; line-height: 1.45; color: var(--t2); border-left: 2px solid rgba(255,255,255,0.07); }
.bc-dr-queue-num { flex-shrink: 0; min-width: 10px; font-size: 10px; color: var(--t3); font-variant-numeric: tabular-nums; line-height: 1.65; }

/* ── Attachment tray ── */
.bc-tray { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 10px 7px;
  border-bottom: 1px solid rgba(255,255,255,0.05); }
.bc-tray-img { position: relative; width: 48px; height: 48px; flex-shrink: 0; border-radius: 9px; overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
.bc-tray-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bc-tray-x { position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; border-radius: 50%; border: none; padding: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center; color: #fff; background: rgba(8,9,16,0.72);
  opacity: 0; transition: opacity .15s ease; }
.bc-tray-img:hover .bc-tray-x, .bc-tray-x:focus-visible { opacity: 1; }
.bc-tray-busy { font-size: 11px; color: var(--t3); padding: 0 4px; }

/* ── Input row ── */
.bc-row { display: flex; align-items: flex-end; gap: 4px; padding: 5px 6px; }
.bc-ibtn { all: unset; box-sizing: border-box; flex-shrink: 0; width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: var(--t3);
  transition: background-color .15s ease, color .15s ease; }
.bc-ibtn:hover { background: rgba(255,255,255,0.055); color: var(--t1); }
.bc-ibtn[disabled] { opacity: .45; cursor: default; background: transparent; }
.bc-ibtn[data-tone="acc"] { color: color-mix(in oklab, var(--acc, #6c63ff) 55%, #d8d8e4); }
.bc-ibtn[data-tone="acc"]:hover { background: color-mix(in oklab, var(--acc, #6c63ff) 14%, transparent); color: var(--t1); }
.bc-input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; resize: none;
  font-family: var(--font); font-size: 13px; line-height: 1.45; letter-spacing: -0.005em; color: var(--t1);
  padding: 5px 4px; max-height: 110px; overflow-y: auto; }
.bc-input::placeholder { color: var(--t3); }
.bc-count { flex-shrink: 0; align-self: flex-end; margin-bottom: 7px; font-size: 10.5px; color: var(--t3);
  font-variant-numeric: tabular-nums; user-select: none; transition: color .18s ease; }
.bc-count[data-cap="1"] { color: #d7ad6b; }

/* Send — AI draft mode: a compact labelled button. */
.bc-send { all: unset; box-sizing: border-box; flex-shrink: 0; height: 28px; padding: 0 8px 0 11px; border-radius: 8px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 500; letter-spacing: -0.01em; color: var(--t1);
  background: color-mix(in oklab, var(--acc, #6c63ff) 20%, rgba(255,255,255,0.03));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--acc, #6c63ff) 26%, rgba(255,255,255,0.05));
  transition: background-color .18s ease, box-shadow .18s ease, transform .12s ease; }
.bc-send:hover { background: color-mix(in oklab, var(--acc, #6c63ff) 28%, rgba(255,255,255,0.04)); }
.bc-send:active { transform: scale(.97); }
.bc-send[data-mode="manual"] { background: rgba(255,255,255,0.07); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.09); }
.bc-send[data-mode="manual"]:hover { background: rgba(255,255,255,0.1); }
.bc-send-lbl { display: inline-grid; }
.bc-send-lbl > span { grid-area: 1 / 1; white-space: nowrap; transition: opacity .18s ease, transform .26s cubic-bezier(.16,1,.3,1); }
.bc-send-lbl > span[data-on="0"] { opacity: 0; transform: translateY(5px); }
.bc-send-ico { display: inline-flex; opacity: .8; }
/* Send — manual mode: an icon button, always there so there's a visible way to
   send (phones have no Enter key); dimmed until there's something to send. */
.bc-go { all: unset; box-sizing: border-box; flex-shrink: 0; width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: var(--t1);
  background: color-mix(in oklab, var(--acc, #6c63ff) 26%, rgba(255,255,255,0.03));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--acc, #6c63ff) 30%, rgba(255,255,255,0.05));
  transition: opacity .18s ease, transform .22s cubic-bezier(.16,1,.3,1), background-color .15s ease; }
.bc-go:hover { background: color-mix(in oklab, var(--acc, #6c63ff) 36%, rgba(255,255,255,0.04)); }
.bc-go:active { transform: scale(.94); }
.bc-go[data-show="0"] { color: var(--t3); background: rgba(255,255,255,0.04); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
  opacity: .55; cursor: default; pointer-events: none; }
.bc-send:focus-visible, .bc-go:focus-visible, .bc-ibtn:focus-visible, .bc-dr-link:focus-visible, .bc-dr-x:focus-visible {
  outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
/* Phones and tablets. The composer clears the home bar; on a phone it
   takes the chat's full width (less a small margin) instead of floating in
   the middle. Fingers get bigger targets, the tray's remove buttons show
   without a hover, and text is a size a phone can read. */
.ipc .bc-comp { margin-bottom: env(safe-area-inset-bottom); }
@media (max-width: 560px) {
  .ipc .bc-comp { width: calc(100% - 20px) !important; bottom: 10px !important; }
}
@media (pointer: coarse) {
  .bc-row { padding: 6px 7px; gap: 6px; }
  .bc-ibtn, .bc-go { width: 36px; height: 36px; border-radius: 10px; }
  .bc-send { height: 36px; padding: 0 10px 0 13px; }
  .bc-input { font-size: 15px; padding: 7px 4px; }
  .bc-tray-x { opacity: 1; }
  .bc-dr-x { width: 30px; height: 30px; }
}
@media (prefers-reduced-motion: reduce) {
  /* The countdown line is information, not decoration — it keeps running. */
  .bc-comp, .bc-comp *:not(.bc-dr-fill):not(.bc-dr-run):not(.bc-dr-comet) { animation: none !important; transition: none !important; }
}
html[data-motion="reduced"] .bc-comp, html[data-motion="reduced"] .bc-comp *:not(.bc-dr-fill):not(.bc-dr-run):not(.bc-dr-comet) { animation: none !important; transition: none !important; }
`;
  document.head.appendChild(st);
};

// ── DRAFT COUNTDOWN FILL ────────────────────────────────────────────────
// The line that runs to "send". It used to be a width set from React every
// tick with a short CSS transition between ticks — each tick restarted the
// easing, which is the stutter. Now it is ONE compositor animation per
// running countdown: it starts at the true elapsed point (negative delay)
// and runs scaleX to 1 over exactly the time that is left, so it moves at
// the display's refresh rate with nothing on the main thread. It mounts
// fresh (keyed by sendAt) whenever the countdown restarts — a new message
// in the reply, or resuming after a pause — and while paused it simply
// holds its position.
const DraftCountdownFill = React.memo(function DraftCountdownFill({total, sendAt, paused, progress}) {
  const [delay] = React.useState(() => {
    const t = Math.max(1, total || 1);
    const left = Math.max(0, Math.min(t, (sendAt || 0) - Date.now()));
    return -(t - left);
  });
  if (paused) {
    return <div className="bc-dr-fill" style={{transform: `scaleX(${Math.max(0, Math.min(1, progress || 0)).toFixed(4)})`}}/>;
  }
  return <div className="bc-dr-fill" data-run="1"
    style={{animationDuration: Math.max(1, total || 1) + 'ms', animationDelay: delay + 'ms'}}/>;
});

// ── DRAFT COUNTDOWN TRACE ───────────────────────────────────────────
// The countdown line, routed round the panel: along the top edge, round
// the rounded top-right corner and a short way down the right side. The
// geometry is measured once per size change (ResizeObserver) and turned
// into one path; the motion itself is a single CSS animation per running
// countdown, started at the true elapsed point (negative delay) exactly
// like the old straight fill, so nothing runs on the main thread per frame.
//
// Route (inside the 1px border, stroke centred 1px in):
//   top:    (0,1) → (W-13,1)
//   corner: quarter circle r=12 about (W-13,13) → (W-1,13)
//   side:   (W-1,13) → (W-1,13+tail), tail ≈ 45% of the section, 18–64px
// The tail fades as it descends, so the line dissolves into the send
// rather than stopping dead.
const DR_CORNER = 13;   // panel radius 14 less the 1px border
const DR_R = 12;        // path radius (stroke centred 1px in)
const drGeom = (w, h) => {
  const tail = Math.max(18, Math.min(64, Math.round(h * 0.45), Math.max(18, h - DR_CORNER - 6)));
  const a = Math.max(0, w - DR_CORNER);
  const b = Math.PI / 2 * DR_R;
  const L = a + b + tail;
  const d = `M0,1 H${a.toFixed(2)} A${DR_R},${DR_R} 0 0 1 ${(w - 1).toFixed(2)},${DR_CORNER} V${(DR_CORNER + tail).toFixed(2)}`;
  const at = (f) => {
    const x = Math.max(0, Math.min(1, f)) * L;
    if (x <= a) return [x, 1];
    if (x <= a + b) {
      const t = (x - a) / DR_R;
      return [a + DR_R * Math.sin(t), DR_CORNER - DR_R * Math.cos(t)];
    }
    return [w - 1, DR_CORNER + (x - a - b)];
  };
  return { d, L, tail, at };
};
let _drTraceSeq = 0;
// Both strokes are driven in real pixels, measured from the rendered path
// (getTotalLength), by the Web Animations API with explicit numbers. The
// first version used pathLength="1" plus a CSS variable inside @keyframes;
// the variable-in-keyframes form does not interpolate reliably, so the
// bright tip jumped to the END of the route (down the right side) part-way
// through the countdown. Nothing here depends on either any more.
const DraftCountdownRun = React.memo(function DraftCountdownRun({d, total, sendAt, paused, progress, gradId}) {
  const runRef = React.useRef(null);
  const cometRef = React.useRef(null);
  const HEAD = 16;   // px length of the bright tip
  const pClamp = Math.max(0, Math.min(1, progress || 0));
  React.useLayoutEffect(() => {
    const run = runRef.current, comet = cometRef.current;
    if (!run || !comet || typeof run.getTotalLength !== 'function') return;
    const L = run.getTotalLength();
    if (!(L > 0)) return;
    // Dash patterns wider than the path, so exactly one dash is ever on it.
    run.style.strokeDasharray = `${L} ${L + 4}`;
    comet.style.strokeDasharray = `${HEAD} ${L + HEAD + 4}`;
    const at = (p) => ({ run: L * (1 - p), comet: HEAD - L * p });
    if (paused) {
      const v = at(pClamp);
      run.style.strokeDashoffset = v.run;
      comet.style.strokeDashoffset = v.comet;
      return;
    }
    const dur = Math.max(1, total || 1);
    const elapsed = Math.max(0, Math.min(dur, dur - ((sendAt || 0) - Date.now())));
    const v0 = at(0), v1 = at(1), vNow = at(elapsed / dur);
    // Set the current position first so the very first frame is right.
    run.style.strokeDashoffset = vNow.run;
    comet.style.strokeDashoffset = vNow.comet;
    if (typeof run.animate !== 'function') return;
    const opts = { duration: dur, easing: 'linear', fill: 'both' };
    const a1 = run.animate([{ strokeDashoffset: v0.run }, { strokeDashoffset: v1.run }], opts);
    const a2 = comet.animate([{ strokeDashoffset: v0.comet }, { strokeDashoffset: v1.comet }], opts);
    a1.currentTime = elapsed;
    a2.currentTime = elapsed;
    return () => { try { a1.cancel(); a2.cancel(); } catch (_) {} };
  }, [d, paused, sendAt, total, paused ? pClamp : 0]);
  return (
    <>
      <path ref={runRef} className="bc-dr-run" d={d}
        stroke={paused ? 'rgba(214,170,100,0.55)' : `url(#${gradId})`}
        style={{strokeDasharray: '0 99999'}}/>
      <path ref={cometRef} className="bc-dr-comet" d={d} style={{strokeDasharray: '0 99999'}}/>
    </>
  );
});
const DraftCountdownTrace = React.memo(function DraftCountdownTrace({total, sendAt, paused, progress, chunkTotal}) {
  const svgRef = React.useRef(null);
  const [box, setBox] = React.useState(null);
  const idRef = React.useRef(null);
  if (!idRef.current) idRef.current = 'bcdr' + (++_drTraceSeq);
  React.useLayoutEffect(() => {
    const host = svgRef.current && svgRef.current.parentElement;
    if (!host) return;
    const measure = () => {
      const w = Math.round(host.clientWidth), h = Math.round(host.clientHeight);
      setBox(b => (b && b.w === w && b.h === h) ? b : { w, h });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  const g = box && box.w > 40 ? drGeom(box.w, box.h) : null;
  const id = idRef.current;
  return (
    <svg ref={svgRef} className="bc-dr-trace" data-state={paused ? 'paused' : 'live'} aria-hidden="true"
      width={box ? box.w : 0} height={box ? box.h : 0}>
      {g && (
        <>
          <defs>
            <linearGradient id={id + 'g'} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={box.w} y2="0">
              <stop offset="0" style={{stopColor:'color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent)'}}/>
              <stop offset="1" style={{stopColor:'color-mix(in oklab, var(--acc, #6c63ff) 75%, #dcdce8)'}}/>
            </linearGradient>
            {/* The side run fades out as it descends. */}
            <linearGradient id={id + 'f'} gradientUnits="userSpaceOnUse" x1="0" y1={DR_CORNER} x2="0" y2={DR_CORNER + g.tail}>
              <stop offset="0" stopColor="#fff" stopOpacity="1"/>
              <stop offset="1" stopColor="#fff" stopOpacity="0.15"/>
            </linearGradient>
            <mask id={id + 'm'} maskUnits="userSpaceOnUse" x="-4" y="-4" width={box.w + 8} height={box.h + 8}>
              <rect x="-4" y="-4" width={box.w + 8} height={DR_CORNER + 4} fill="#fff"/>
              <rect x="-4" y={DR_CORNER} width={box.w + 8} height={g.tail + 8} fill={`url(#${id}f)`}/>
            </mask>
          </defs>
          <g mask={`url(#${id}m)`}>
            <path className="bc-dr-track" d={g.d}/>
            <DraftCountdownRun key={paused ? 'p' : 'r' + sendAt + ':' + box.w + 'x' + box.h}
              d={g.d} total={total} sendAt={sendAt} paused={paused} progress={progress}
              gradId={id + 'g'}/>
          </g>
          {chunkTotal > 1 && Array.from({length: chunkTotal - 1}).map((_, i) => {
            const [x, y] = g.at((i + 1) / chunkTotal);
            return <circle key={i} className="bc-dr-trace-tick" cx={x} cy={y} r="1.4"/>;
          })}
        </>
      )}
    </svg>
  );
});

// ── UpcomingChunks — the chunks queued behind the current draft ───────
const UpcomingChunks = ({chunks, startIdx, total}) => {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;
  return (
    <div className="bc-dr-queue">
      <div className="bc-dr-queue-head">
        <span>Then {chunks.length} more</span>
      </div>
      {chunks.map((c, i) => {
        const trimmed = c.length > 110 ? c.slice(0, 108).trimEnd() + '…' : c;
        return (
          <div key={i} title={c} className="bc-dr-queue-item">
            <span className="bc-dr-queue-num">{startIdx ? startIdx + i : i + 2}</span>
            <span style={{whiteSpace:'pre-wrap', wordBreak:'break-word', flex:1, minWidth:0}}>{trimmed}</span>
          </div>
        );
      })}
    </div>
  );
};


// ── Shared 1Hz "now" ticker. One setInterval for the whole app drives all
//    "ago" timestamps so we don't pay the cost of one timer per bubble.
//    Subscribers register a no-arg callback; the tick simply forces a
//    re-render (or whatever the callback chooses to do).
const NOW_TICK = (() => {
  const subs = new Set();
  let timer = null;
  return {
    sub(fn) {
      subs.add(fn);
      if (!timer) {
        timer = setInterval(() => { subs.forEach(s => { try { s(); } catch(_){} }); }, 1000);
      }
      return () => {
        subs.delete(fn);
        if (subs.size === 0 && timer) { clearInterval(timer); timer = null; }
      };
    },
  };
})();

// useNowTick — subscribe a component to the shared 1Hz ticker so any
// "ago" labels inside re-render every second.
const useNowTick = () => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => NOW_TICK.sub(force), []);
};

// fmtMsgAgo — premium relative-time formatter with progressive granularity:
//   < 5s     → "now"
//   < 60s    → "12s ago"
//   < 60m    → "5m ago"
//   < 24h    → "3h ago"
//   < 7d     → "2d ago"
//   else     → "Mar 14"  (or "Mar 14, 2024" if not this year)
// Accepts a millisecond timestamp OR (as a fallback for legacy messages
// that only carry an "HH:MM" display string) the original raw string,
// in which case it returns it as-is rather than lying with a bogus age.
const fmtMsgAgo = (ts, fallbackStr) => {
  // Direct-chat rows carry an ISO date string rather than epoch ms; read it
  // too, so their bubbles get the same "5m ago" as every other chat.
  let ms = (typeof ts === 'number' && ts > 0) ? ts : null;
  if (ms === null && typeof ts === 'string' && ts.length > 8) { const p = Date.parse(ts); if (Number.isFinite(p) && p > 0) ms = p; }
  if (ms === null) return fallbackStr || '';
  const diff = Date.now() - ms;
  if (!isFinite(diff) || diff < 0) return 'now';
  const s = Math.floor(diff / 1000);
  if (s < 5)         return 'now';
  if (s < 60)        return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60)        return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24)        return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 7)         return d + 'd ago';
  // Older than a week — show a calendar date instead. Same year: "Mar 14",
  // older: "Mar 14, 2024".
  const date = new Date(ms);
  const month = date.toLocaleString(undefined, { month: 'short' });
  const day   = date.getDate();
  return (date.getFullYear() === new Date().getFullYear())
    ? `${month} ${day}`
    : `${month} ${day}, ${date.getFullYear()}`;
};

// ── ChatBubbleRow — shared bubble renderer with hover timestamp ──────────
// Timestamp behavior:
//   • Short bubble (height ≤ SHORT_BUBBLE_PX → roughly 6 lines or less):
//     pinned to vertical center so it doesn't slide as the cursor moves.
//     Looks calm, doesn't chase the mouse on small messages.
//   • Tall bubble (multi-line / wall of text): tracks the mouse Y, clamped
//     to the bubble so the timestamp always stays adjacent to the row your
//     eyes are on. This is the original behavior — useful for long bubbles,
//     visual noise on short ones.
//   • Time text is the live "Xs / Xm / Xh / Xd ago" relative form, ticking
//     every second via the shared NOW_TICK so a freshly-sent message goes
//     "now" → "5s ago" → "1m ago" without a manual refresh.
// Threshold derivation: bubble line-height ≈ 19px + ~12px vertical padding.
// 6 lines × 19 + 12 ≈ 126px, rounded up to 140 so the boundary is forgiving
// (a 6-line bubble that wraps a hair extra still pin-centers).
// ── useTypeToFocus ───────────────────────────────────────────────────
// Start typing anywhere in a chat view and the composer takes focus, the
// way a desktop chat client behaves — no clicking into the box first.
//
// The guards matter more than the feature. Each one is a way this can make
// the app feel broken in a manner that's hard to attribute:
//
//   • Already focused          → nothing to do
//   • Another input/textarea   → never steal from a field the user chose
//   • contentEditable          → same rule as an input
//   • Ctrl / Cmd / Alt held    → a shortcut, not typing (⌘C, ⌘R, ⌘K…)
//   • Non-printing keys        → Tab, Escape, arrows, F-keys must still work
//   • Text selected            → user is about to copy, not type
//   • Dialog open              → don't pull focus out from under a modal
//
// We only FOCUS; we never inject the character. The keystroke still lands
// in the newly-focused textarea natively, so nothing is duplicated or
// dropped — and IME composition (Chinese, Japanese, Korean) keeps working,
// which manual insertion would break outright.
//
// `disabled` covers the case where the composer is mid-send and the
// textarea is non-interactive; focusing a disabled field does nothing and
// would silently swallow the keystroke.
const useTypeToFocus = (taRef, disabled = false) => {
  React.useEffect(() => {
    const onKeyDown = (e) => {
      const ta = taRef && taRef.current;
      if (!ta || disabled || ta.disabled) return;
      if (document.activeElement === ta) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // A printable character is exactly one code point. Named keys
      // ('Enter', 'ArrowUp', 'F5', 'Dead') are longer, so this one test
      // covers every non-printing key without enumerating them. Array.from
      // is deliberate: it counts code points, so an emoji or a non-BMP
      // character isn't misread as two.
      if (!e.key || Array.from(e.key).length !== 1) return;
      const el = document.activeElement;
      if (el) {
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (el.isContentEditable) return;
      }
      const sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length > 0) return;
      if (document.querySelector('[role="dialog"], .bc-modal-open')) return;
      // preventScroll stops the thread jumping when focus lands.
      try { ta.focus({preventScroll: true}); } catch (_) { try { ta.focus(); } catch (__) {} }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [taRef, disabled]);
};

// ═══════════════════════════════════════════════════════════════════
// ATTACHMENTS — shared helpers for sending and rendering files
// ═══════════════════════════════════════════════════════════════════
// Files move through the app as base64 `data:` URLs. That is already the
// convention the engine uses for product media, and it is the one shape
// the .NET bridge understands on every platform: SendTelegramMedia,
// SendTelegramUserMedia and SendDiscordMedia all branch on
// url.StartsWith("data:") and hand the decoded bytes straight to the
// platform SDK. No upload endpoint, no temp hosting, no CORS.

const ATT_MAX_BYTES     = 25 * 1024 * 1024;  // per file — platform ceiling is ~50MB
const ATT_MAX_FILES     = 10;                // per message
const ATT_THUMB_PX      = 1024;              // longest edge of the archived thumbnail
const ATT_CAPTION_CAP   = 1000;              // below this, text rides along as a caption

const ATT_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|heif)(\?|#|$)/i;
const ATT_VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|ogv|mkv|avi)(\?|#|$)/i;
const ATT_AUDIO_EXT_RE = /\.(mp3|wav|ogg|oga|m4a|aac|opus|flac|wma)(\?|#|$)/i;

// Kind for a freshly-picked File. MIME first (the browser is usually right),
// extension as the fallback for the types Windows reports as
// application/octet-stream.
const attKindOf = (mime, name) => {
  const m = String(mime || '').toLowerCase();
  const n = String(name || '');
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (ATT_IMAGE_EXT_RE.test(n)) return 'image';
  if (ATT_VIDEO_EXT_RE.test(n)) return 'video';
  if (ATT_AUDIO_EXT_RE.test(n)) return 'audio';
  return 'document';
};

// Kind for a message already in a thread. `mt` may be anything the platform
// or the engine wrote — 'photo', 'sticker', 'voice', 'animation', '' — so
// this normalises all of them down to the four the renderer draws.
const mediaKindOf = (mt, mu) => {
  const t = String(mt || '').toLowerCase();
  const u = String(mu || '');
  if (!u) return '';
  // Links: a YouTube link plays in the chat; any other is a link row.
  if (t === 'link' || t === 'youtube' || t === 'url') return (typeof bcYouTubeId === 'function' && bcYouTubeId(u)) ? 'youtube' : 'link';
  if (/^https?:/i.test(u) && typeof bcYouTubeId === 'function' && bcYouTubeId(u)) return 'youtube';
  if (t === 'image' || t === 'photo' || t === 'sticker')                 return 'image';
  if (t === 'video' || t === 'animation' || t === 'gif' || t === 'video_note') return 'video';
  if (t === 'audio' || t === 'voice')                                    return 'audio';
  // Documents, and anything unlabelled, are sniffed from the URL. A photo
  // sent with Telegram's "send as file" arrives as a document but is still
  // worth showing inline.
  if (/^data:image\//i.test(u) || ATT_IMAGE_EXT_RE.test(u)) return 'image';
  if (/^data:video\//i.test(u) || ATT_VIDEO_EXT_RE.test(u)) return 'video';
  if (/^data:audio\//i.test(u) || ATT_AUDIO_EXT_RE.test(u)) return 'audio';
  return 'document';
};

// BotBridge.sendMedia's `mediaKind` vocabulary differs by one word from
// ours: it says 'photo' where we say 'image'. Matches the mapping the
// engine already does when it delivers product attachments.
const bridgeKindOf = (kind) => (kind === 'image' ? 'photo' : (kind || 'document'));

const prettyBytes = (n) => {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB';
  return (b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
};

// A data URL carries no filename, and bc_messages has no column for one.
// RFC 2397 lets the media type take parameters, so we tuck the name in as
// `;name=` — it survives the round trip through the database for free.
//
// This is safe on the .NET side: DecodeDataUrl splits the header on ';',
// treats the part containing '/' as the MIME type and matches "base64"
// exactly. A percent-encoded `name=` segment contains neither, so it is
// ignored exactly as it should be.
const tagDataUrlName = (url, name) => {
  if (!name || !/^data:/i.test(url || '')) return url;
  const comma = url.indexOf(',');
  if (comma < 0) return url;
  let head = url.slice(5, comma);
  if (/;name=/i.test(head)) return url;
  // FileReader emits a bare `data:;base64,` when Windows reports no MIME.
  // Give it one, or the host falls back to a nameless octet-stream.
  if (!head.split(';')[0]) head = 'application/octet-stream' + head;
  const safe = encodeURIComponent(name);
  const i64  = head.toLowerCase().lastIndexOf(';base64');
  head = i64 >= 0
    ? head.slice(0, i64) + ';name=' + safe + head.slice(i64)
    : head + ';name=' + safe;
  return 'data:' + head + url.slice(comma);
};

// Best-effort display name: the `;name=` tag above, else the last path
// segment of an http(s) URL, else a generic label for the kind.
const attNameOf = (m) => {
  const explicit = m && m.mn;
  if (explicit) return String(explicit);
  const u = String((m && m.mu) || '');
  if (!u) return '';
  if (/^data:/i.test(u)) {
    const hit = /;name=([^;,]+)/i.exec(u.slice(0, u.indexOf(',') + 1 || 200));
    if (hit) { try { return decodeURIComponent(hit[1]); } catch (_) { return hit[1]; } }
    return '';
  }
  try {
    const clean = u.split('#')[0].split('?')[0];
    const seg = clean.slice(clean.lastIndexOf('/') + 1);
    return decodeURIComponent(seg || '');
  } catch (_) { return ''; }
};

// Read a File into a data URL, with the original filename tagged on.
const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload  = () => resolve(tagDataUrlName(String(fr.result || ''), file.name));
  fr.onerror = () => reject(fr.error || new Error('read failed'));
  fr.readAsDataURL(file);
});

// Downscaled copy of an image, used as the archived version when the
// original is too big to store. Resolves to '' on any failure — the caller
// treats a missing thumbnail as "don't archive a URL at all", never as an
// error worth interrupting the send for.
const makeImageThumb = (dataUrl, maxPx) => new Promise((resolve) => {
  try {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return resolve('');
        const scale = Math.min(1, maxPx / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        const ctx = cv.getContext('2d');
        if (!ctx) return resolve('');
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(cv.toDataURL('image/jpeg', 0.82));
      } catch (_) { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  } catch (_) { resolve(''); }
});

// Does this drag carry actual files? A text selection dragged from another
// pane reports 'text/plain' and must not light up the drop target.
const dragHasFiles = (e) => {
  try {
    const t = e && e.dataTransfer && e.dataTransfer.types;
    if (!t) return false;
    return Array.prototype.indexOf.call(t, 'Files') !== -1;
  } catch (_) { return false; }
};

// ── GLOBAL DROP GUARD ───────────────────────────────────────────────
// WebView2 inherits Chromium's default: a file dropped on the page is a
// navigation. Drop a .zip anywhere outside the composer and the whole app
// is replaced by a download prompt or a directory listing, with all
// in-memory state gone. Nothing in the app recovers from that, so the
// default is cancelled process-wide and re-enabled only inside an element
// that marks itself [data-bc-dropzone].
//
// Registered once at module scope, guarded by a window flag so the JSX
// loader re-evaluating this file on a cache-bust doesn't stack listeners.
(() => {
  if (typeof window === 'undefined' || window.__bcDropGuardInstalled) return;
  window.__bcDropGuardInstalled = true;
  const inZone = (e) => {
    try {
      const t = e.target;
      return !!(t && t.closest && t.closest('[data-bc-dropzone]'));
    } catch (_) { return false; }
  };
  window.addEventListener('dragover', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();                 // required, or 'drop' never fires
    try { e.dataTransfer.dropEffect = inZone(e) ? 'copy' : 'none'; } catch (_) {}
  }, false);
  window.addEventListener('drop', (e) => {
    if (!dragHasFiles(e)) return;
    if (!inZone(e)) e.preventDefault(); // swallow it; the zone handles its own
  }, false);
})();

// ── FileChip — one attachment as a compact row ──────────────────────
// Used for documents in message bubbles and for every non-image in the
// composer tray. Icon, name, size, and a download affordance that works
// for data: URLs (the `download` attribute handles those natively).
// Inside the desktop app a file link must never be followed by the page:
// WebView2 would navigate the whole app to it (a PDF replaced the UI). The
// host opens files with their default program and saves them through a
// real Save As dialog instead. In a plain browser preview the link works.
// Touch screens have no hover. The chat composers slide out of the way until
// the pointer comes near them, which a finger never does, so there they
// stay on screen.
const bcNoHover = () => {
  try { return !!(window.matchMedia && window.matchMedia('(hover: none)').matches); }
  catch (_) { return false; }
};
// ── PRESS AND HOLD ─────────────────────────────────────────────────
// Touch screens have no right-click: holding a finger still on a message
// or a contact for about half a second opens the same menu instead. Moving
// the finger (scrolling) cancels it, the tap that ends a hold doesn't also
// count as a click, and `recent()` lets the element ignore the browser's
// own long-press contextmenu that Android sends a moment later.
const BC_HOLD_MS = 460;
const useLongPress = (onHold) => {
  const st = React.useRef({ t: 0, x: 0, y: 0, fired: 0 });
  const holdRef = React.useRef(onHold);
  holdRef.current = onHold;
  React.useEffect(() => () => clearTimeout(st.current.t), []);
  return React.useMemo(() => {
    const s = st.current;
    const cancel = () => { clearTimeout(s.t); s.t = 0; };
    return {
      recent: () => Date.now() - s.fired < 900,
      handlers: {
        onTouchStart: (e) => {
          cancel();
          if (!holdRef.current || !e.touches || e.touches.length !== 1) return;
          const t = e.touches[0];
          s.x = t.clientX; s.y = t.clientY;
          s.t = setTimeout(() => {
            s.t = 0; s.fired = Date.now();
            try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}
            holdRef.current({ clientX: s.x, clientY: s.y });
          }, BC_HOLD_MS);
        },
        onTouchMove: (e) => {
          if (!s.t || !e.touches || !e.touches[0]) return;
          const t = e.touches[0];
          if (Math.abs(t.clientX - s.x) > 8 || Math.abs(t.clientY - s.y) > 8) cancel();
        },
        onTouchEnd: (e) => { cancel(); if (Date.now() - s.fired < 700 && e.cancelable) e.preventDefault(); },
        onTouchCancel: cancel,
      },
    };
  }, []);
};

// ── CONTEXT MENU PIECES ─────────────────────────────────────────────
// Line icons for every menu row (see CONTEXT MENUS in BotCommand.html).
const CTX_ICONS = {
  chat:    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>,
  search:  <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
  check:   <path d="M20 6L9 17l-5-5"/>,
  checks:  <><path d="M18 7l-8.5 8.5L6 12"/><path d="M22 7l-8.5 8.5"/></>,
  userx:   <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M17 8l5 5M22 8l-5 5"/></>,
  resume:  <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></>,
  bell:    <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></>,
  belloff: <><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A17.9 17.9 0 0 1 18 8"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M2 2l20 20"/></>,
  copy:    <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  block:   <><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></>,
  unblock: <><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></>,
  trash:   <><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></>,
  remove:  <><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></>,
  reply:   <><path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></>,
  edit:    <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
  open:    <><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></>,
  save:    <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></>,
  agentoff:<><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 11-5.7"/><path d="M17 17h5"/></>,
};
const CtxIco = ({name}) => (
  <span className="ctx-ico" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {CTX_ICONS[name] || null}
    </svg>
  </span>
);
// A menu row: icon, label.
const CtxRow = ({icon, label, onClick, danger = false, disabled = false}) => (
  <button type="button" role="menuitem" className={`ctx-row${danger ? ' ctx-del' : ''}`} disabled={disabled}
    onClick={() => { if (!disabled) onClick(); }}>
    <CtxIco name={icon}/><span className="ctx-lbl">{label}</span>
  </button>
);
// Where the menu goes: at the pointer, opening left / up when it would run
// off the right / bottom edge, and growing out of the point it was opened
// from. Measured after it renders, so any height fits. `ay`: the top of the
// thing it belongs to (a held message), so a menu that has to open upward
// goes above that instead of over it.
const useCtxPlace = (ref, x, y, deps, ay = null) => {
  const [pos, setPos] = React.useState({ left: x, top: y, ox: 0, oy: 0 });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The layout size: the rect is mid scale-in when this runs.
    const r = { width: el.offsetWidth, height: el.offsetHeight };
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x + r.width + 8 > vw ? x - r.width : x;
    let top  = y + r.height + 8 > vh ? (ay != null ? ay - r.height : y - r.height) : y;
    left = Math.max(8, Math.min(left, vw - r.width - 8));
    top  = Math.max(8, Math.min(top,  vh - r.height - 8));
    const ox = Math.max(0, Math.min(r.width, x - left)), oy = Math.max(0, Math.min(r.height, y - top));
    if (left !== pos.left || top !== pos.top || ox !== pos.ox || oy !== pos.oy) setPos({ left, top, ox, oy });
  }, deps);   // eslint-disable-line react-hooks/exhaustive-deps
  return { left: pos.left, top: pos.top, '--ctx-ox': pos.ox + 'px', '--ctx-oy': pos.oy + 'px' };
};
// Closes on a press outside it (mouse or finger), another right-click, Esc,
// a resize or the window losing focus. `onEsc` handles Esc first when given
// (a confirm step backs out instead of closing).
const useCtxDismiss = (ref, onClose, onEsc) => {
  const closeRef = React.useRef(onClose); closeRef.current = onClose;
  const escRef = React.useRef(onEsc); escRef.current = onEsc;
  React.useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) closeRef.current(); };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      if (!(escRef.current && escRef.current())) closeRef.current();
    };
    const away = () => closeRef.current();
    const t = setTimeout(() => {
      window.addEventListener('pointerdown', down, true);
      window.addEventListener('contextmenu', down, true);
    }, 0);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('contextmenu', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
};

const bcInHost = () => {
  try { return !!(window.BotBridge && typeof window.BotBridge.isWebView2 === 'function' && window.BotBridge.isWebView2()); }
  catch (_) { return false; }
};

const FileChip = ({name, size, kind, url, onRemove, compact=false, pending=false, error=''}) => {
  const label = name || (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'File');
  const ext   = (label.includes('.') ? label.slice(label.lastIndexOf('.') + 1) : '').toUpperCase().slice(0, 4);
  const openable = !!url && !pending && !onRemove;
  const open = (e) => {
    if (!openable) return;
    e.stopPropagation();
    if (bcInHost()) { e.preventDefault(); bcBridgeSend('openMedia', { url, name: label }); }
    else bcOpenInBrowser(url);
  };
  const save = (e) => {
    e.stopPropagation();
    if (bcInHost()) { e.preventDefault(); bcBridgeSend('saveMedia', { url, name: label }); }
  };
  const sub = pending ? 'Downloading…' : (error ? error : (size ? prettyBytes(size) : ''));
  return (
    <div
      onClick={open}
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      onKeyDown={openable ? (e => { if (e.key === 'Enter' || e.key === ' ') open(e); }) : undefined}
      title={openable ? `Open ${label}` : (error || label)}
      className={openable ? 'bc-filechip bc-filechip-open' : 'bc-filechip'}
      style={{
      display:'flex', alignItems:'center', gap:8,
      padding: compact ? '5px 8px' : '7px 10px',
      borderRadius:10, maxWidth:'100%', minWidth:0,
      background:'rgba(255,255,255,0.05)',
      border:'1px solid ' + (error ? 'rgba(255,69,58,0.22)' : 'rgba(255,255,255,0.10)'),
      cursor: openable ? 'pointer' : 'default',
      transition:'background 0.12s, border-color 0.12s',
    }}>
      <div style={{
        width: compact ? 24 : 30, height: compact ? 24 : 30, flexShrink:0,
        borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center',
        background:'rgba(108,99,255,0.16)', border:'1px solid rgba(108,99,255,0.26)',
        color:'#bcb1ff', fontFamily:'var(--mono)', fontSize:7.5, fontWeight:700,
        letterSpacing:'0.02em', position:'relative',
      }}>
        {pending ? (
          <span className="bc-filechip-spin" aria-hidden="true"/>
        ) : (ext || (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
          </svg>
        ))}
      </div>
      <div style={{minWidth:0, flex:1}}>
        <div style={{
          fontSize: compact ? 11 : 12, color:'var(--t1)', fontWeight:500,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
          letterSpacing:'-0.005em',
        }} title={label}>{label}</div>
        {sub ? (
          <div style={{fontSize:9.5, color: error ? 'rgba(255,140,130,0.9)' : 'var(--t3)',
            fontFamily: error ? 'var(--font)' : 'var(--mono)', marginTop:1,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={sub}>
            {sub}
          </div>
        ) : null}
      </div>
      {onRemove ? (
        <button onClick={onRemove} title="Remove"
          style={{
            flexShrink:0, width:20, height:20, borderRadius:5, border:'none',
            background:'transparent', color:'var(--t3)', cursor:'pointer',
            fontSize:14, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center',
            transition:'all 0.12s',
          }}
          onMouseEnter={e=>{e.currentTarget.style.color='var(--err)';e.currentTarget.style.background='rgba(255,69,58,0.10)';}}
          onMouseLeave={e=>{e.currentTarget.style.color='var(--t3)';e.currentTarget.style.background='transparent';}}>×</button>
      ) : (openable ? (
        <a href={url} download={label || true} title="Save as…" onClick={save}
          style={{
            flexShrink:0, width:22, height:22, borderRadius:6,
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'var(--t2)', textDecoration:'none', transition:'all 0.12s',
          }}
          onMouseEnter={e=>{e.currentTarget.style.color='var(--acc)';e.currentTarget.style.background='rgba(108,99,255,0.12)';}}
          onMouseLeave={e=>{e.currentTarget.style.color='var(--t2)';e.currentTarget.style.background='transparent';}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </a>
      ) : null)}
    </div>
  );
};

// ── Lightbox ────────────────────────────────────────────────────────
// The previous "click to enlarge" toggled the image's maxHeight between
// 220px and 70vh. For a tall photo that did something; for a wide one —
// a screenshot, which is most of what customers actually send — it did
// nothing at all, because the limiting dimension is the WIDTH of a bubble
// capped at 62% of the chat column. The height constraint was never the
// binding one, so the click appeared dead.
//
// Rendered to <body> so it escapes .ipc-chat-col's `contain: layout style`
// and the two overflow:hidden columns above it. Anything less than a
// portal is clipped back into the bubble it came from.
const MediaLightbox = ({url, name, onClose}) => {
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // Capture + stop, or Escape also closes the chat view underneath
        // and the operator loses their place to dismiss a picture.
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return ReactDOM.createPortal(
    <div onClick={onClose}
      style={{
        position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:99999,
        display:'flex', alignItems:'center', justifyContent:'center',
        padding:'48px 40px',
        background:'rgba(6,7,14,0.88)',
        backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)',
        cursor:'zoom-out', animation:'bcLightboxIn 150ms ease',
      }}>
      <img src={url} alt={name || 'image'}
        onClick={e=>e.stopPropagation()}
        style={{
          maxWidth:'100%', maxHeight:'100%', objectFit:'contain',
          display:'block', borderRadius:8, cursor:'default',
          boxShadow:'0 30px 90px -20px rgba(0,0,0,0.8)',
        }}/>

      {/* Toolbar — filename plus a save affordance. `download` works for
          data: URLs natively, which is how User-API attachments arrive. */}
      <div onClick={e=>e.stopPropagation()}
        style={{
          position:'fixed', top:14, left:16, right:16,
          display:'flex', alignItems:'center', gap:10, cursor:'default',
        }}>
        <span style={{
          fontSize:11.5, color:'rgba(255,255,255,0.72)', fontFamily:'var(--mono)',
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>{name || ''}</span>
        <div style={{flex:1}}/>
        <a href={url} download={name || true} title="Save image"
          style={{
            width:30, height:30, borderRadius:8, flexShrink:0,
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'rgba(255,255,255,0.8)', textDecoration:'none',
            background:'rgba(255,255,255,0.08)',
          }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </a>
        <button onClick={onClose} title="Close (Esc)"
          style={{
            width:30, height:30, borderRadius:8, flexShrink:0, border:'none',
            display:'flex', alignItems:'center', justifyContent:'center',
            color:'rgba(255,255,255,0.8)', background:'rgba(255,255,255,0.08)',
            cursor:'pointer', fontSize:17, lineHeight:1, padding:0,
          }}>×</button>
      </div>
      <style>{`@keyframes bcLightboxIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>,
    document.body
  );
};

// ── FileCard — a document attachment inside a chat bubble ─────────────
// The bubble itself is the card: one surface, a type-coloured tile, the
// name with its extension always visible, size and type underneath, and a
// round save button. (FileChip above stays as the composer's removable
// attachment pill.)
const FILE_FAMILIES = [
  ['pdf',   /^(pdf)$/],
  ['doc',   /^(doc|docx|rtf|odt|txt|md|pages)$/],
  ['sheet', /^(xls|xlsx|xlsm|csv|tsv|ods|numbers)$/],
  ['slide', /^(ppt|pptx|odp|key)$/],
  ['arch',  /^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/],
  ['code',  /^(js|jsx|ts|tsx|json|html|htm|css|xml|yml|yaml|py|php|vb|cs|sql|sh|log)$/],
  ['media', /^(mp3|wav|ogg|oga|m4a|flac|mp4|mov|webm|mkv|avi|jpg|jpeg|png|gif|webp|heic|tgs)$/],
];
const fileFamilyOf = (ext) => {
  const e = String(ext || '').toLowerCase();
  for (const [fam, re] of FILE_FAMILIES) if (re.test(e)) return fam;
  return 'other';
};
const splitFileName = (label) => {
  const i = label.lastIndexOf('.');
  if (i <= 0 || i === label.length - 1 || label.length - i > 8) return [label, ''];
  return [label.slice(0, i), label.slice(i)];
};

const FileCard = ({name, size, kind, url, pending=false, error=''}) => {
  const label = name || (kind && kind !== 'document' ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'File');
  const [base, dotExt] = splitFileName(label);
  const ext = dotExt ? dotExt.slice(1).toUpperCase() : '';
  const openable = !!url && !pending && !error;
  const open = (e) => {
    if (!openable) return;
    e.stopPropagation();
    if (bcInHost()) { e.preventDefault(); bcBridgeSend('openMedia', { url, name: label }); }
    else bcOpenInBrowser(url);
  };
  const save = (e) => {
    e.stopPropagation();
    if (bcInHost()) { e.preventDefault(); bcBridgeSend('saveMedia', { url, name: label }); }
  };
  const meta = pending ? 'Downloading…'
    : error ? error
    : size ? prettyBytes(size)
    : (ext ? ext + ' file' : (kind && kind !== 'document' ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'File'));
  const cls = 'bc-fcard' + (openable ? ' is-open' : '') + (error ? ' is-err' : '') + (pending ? ' is-pending' : '');
  return (
    <div className={cls} data-fam={fileFamilyOf(ext.toLowerCase())}
      onClick={open}
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      onKeyDown={openable ? (e => { if (e.key === 'Enter' || e.key === ' ') open(e); }) : undefined}
      title={openable ? `Open ${label}` : (error || label)}>
      <div className="bc-fcard-ico" aria-hidden="true">
        {pending ? <span className="bc-filechip-spin"/> : error ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12.5"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        ) : (
          ext && ext.length <= 4 ? <span className="bc-fcard-ext">{ext}</span> : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/>
              <polyline points="14 3 14 8 19 8"/>
            </svg>
          )
        )}
      </div>
      <div className="bc-fcard-body">
        <div className="bc-fcard-name" title={label}>
          <span className="bc-fcard-base">{base}</span>
          {dotExt ? <span className="bc-fcard-dot">{dotExt}</span> : null}
        </div>
        <div className="bc-fcard-meta" title={meta}>{meta}</div>
      </div>
      {openable ? (
        <a className="bc-fcard-dl" href={url} download={label || true} title="Save as…"
           aria-label={`Save ${label}`} onClick={save} onKeyDown={e => e.stopPropagation()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v11"/><polyline points="7 10.5 12 15.5 17 10.5"/><path d="M5 20h14"/>
          </svg>
        </a>
      ) : null}
    </div>
  );
};

// ── MessageMedia — the attachment half of a chat bubble ─────────────
// Previously only images rendered, and only from a hardcoded extension
// test. Anything else — a PDF a customer sent, a voice note, a video —
// produced an empty bubble with no indication a file had even arrived.
// Every kind is handled here, and the unknown case degrades to a chip
// rather than to nothing.
//
// `radius` is the bubble's own corner geometry, handed down so an image
// that fills its bubble edge-to-edge can carry the same corners rather
// than sitting in a padded box with its own unrelated 10px rounding.
// ── IMAGE CARD ──────────────────────────────────────────────────────
// A photo always fills its bubble edge to edge, captioned or not. The
// caption and the sender label sit ON the picture, the way Photos and
// Messages present them:
//
//   overlay — caption on a soft scrim across the bottom of the image.
//             Clamped to three lines; clicking a clamped caption opens it
//             in place, clicking the picture still opens the lightbox.
//   footer  — used when an overlay wouldn't read well: the image is too
//             narrow to hold a line of text, or the caption is long. The
//             caption sits directly under the image inside the same card,
//             no gap, and the card keeps the image's width so the bubble
//             never grows wider than the picture.
//
// Which one is decided from the image's natural size once it loads, so
// nothing flips back and forth as the layout settles.
const CAPTION_OVERLAY_MAX_CHARS = 140;
const CAPTION_OVERLAY_MIN_W     = 200;
const MEDIA_MAX_H               = 300;

const ensureMediaCardStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-media-card')) return;
  const st = document.createElement('style');
  st.id = 'bc-media-card';
  st.textContent = `
.bc-media { position: relative; display: flex; flex-direction: column; margin: 0; max-width: 100%; overflow: hidden; }
.bc-media-img { display: block; max-width: 100%; max-height: ${MEDIA_MAX_H}px; height: auto; object-fit: contain; cursor: zoom-in; }
.bc-media[data-cap="footer"] .bc-media-img { width: 100%; object-fit: cover; }
.bc-media-lbl { position: absolute; top: 8px; left: 8px; z-index: 2; pointer-events: none;
  padding: 3px 7px; border-radius: 6px; font-size: 9px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; line-height: 1.2;
  color: rgba(255,255,255,0.9); background: rgba(10,12,24,0.42);
  backdrop-filter: blur(12px) saturate(140%); -webkit-backdrop-filter: blur(12px) saturate(140%);
  border: 0.5px solid rgba(255,255,255,0.12); transition: opacity .2s ease; }
.bc-media-lbl[data-who="ai"] { color: rgba(214,208,255,0.95); }
.bc-media-cap { --scrim: 0.34; --shade: 0.3; position: absolute; left: 0; right: 0; bottom: 0; z-index: 1;
  padding: 26px 12px 8px; color: #fff;
  font-size: 12.5px; line-height: 1.45; letter-spacing: -0.005em;
  text-shadow: 0 1px 1px rgba(0,0,0,calc(var(--shade) * 0.8)), 0 1px 3px rgba(0,0,0,var(--shade)), 0 0 16px rgba(0,0,0,calc(var(--shade) * 0.7));
  transition: padding .28s cubic-bezier(.32,.72,0,1); }
/* The scrim is its own layer so it can fade without touching the text.
   Its strength (--scrim) is set per image from how bright the area under
   the caption actually is: a dark photo gets barely a whisper, a bright
   screenshot gets just enough to carry white text. */
.bc-media-cap::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background: linear-gradient(180deg, rgba(8,9,20,0) 0%, rgba(8,9,20,calc(var(--scrim) * 0.08)) 18%, rgba(8,9,20,calc(var(--scrim) * 0.32)) 38%, rgba(8,9,20,calc(var(--scrim) * 0.64)) 58%, rgba(8,9,20,calc(var(--scrim) * 0.88)) 78%, rgba(8,9,20,var(--scrim)) 100%);
  opacity: .88; transition: opacity .3s ease, background-color .3s ease; }
.bc-media:hover .bc-media-cap::before { opacity: 1; }
.bc-media-cap[data-more="1"] { cursor: pointer; }
.bc-media-cap-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  white-space: pre-wrap; word-break: break-word; }
.bc-media-cap[data-open="1"] { padding-top: 10px;
  backdrop-filter: blur(10px) saturate(130%); -webkit-backdrop-filter: blur(10px) saturate(130%); }
.bc-media-cap[data-open="1"]::before { opacity: 1;
  background: rgba(8,9,20,calc(var(--scrim) + 0.22)); }
.bc-media-cap[data-open="1"] .bc-media-cap-text { display: block; -webkit-line-clamp: unset; max-height: 190px; overflow-y: auto; }
.bc-media-cap-more { display: inline-block; margin-top: 2px; font-size: 10.5px; font-weight: 500; color: rgba(255,255,255,0.6); }
.bc-media-foot { padding: 9px 12px 10px; font-size: 12.5px; line-height: 1.5; color: var(--t1);
  white-space: pre-wrap; word-break: break-word; border-top: 0.5px solid rgba(255,255,255,0.06); }
@media (prefers-reduced-motion: reduce) { .bc-media * { transition: none !important; } }
`;
  document.head.appendChild(st);
};

// How much scrim a caption needs, from the average brightness of the bottom
// third of the picture (sampled at 24×24 — enough to know light from dark,
// cheap enough to run on every load). Images a canvas isn't allowed to read
// (cross-origin without CORS) fall back to a middle value.
const captionTone = (img) => {
  let lum = 0.5;
  try {
    const W = 24, H = 24;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const y0 = Math.floor(H * 0.66);
    const px = ctx.getImageData(0, y0, W, H - y0).data;
    let sum = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      n++;
    }
    if (n) lum = sum / n;
  } catch (_) { /* tainted canvas — keep the middle value */ }
  // Curve, not a line: dark and mid-tone pictures stay light, and the scrim
  // only climbs steeply once the strip under the text is genuinely bright —
  // which is exactly where white text would otherwise vanish.
  const scrim = Math.min(0.72, Math.max(0.16, 0.14 + Math.pow(lum, 1.4) * 0.58));
  const shade = Math.min(0.75, Math.max(0.28, 0.24 + lum * 0.5));
  return { scrim: +scrim.toFixed(3), shade: +shade.toFixed(3) };
};

// ── MEDIA / AVATAR CACHES ────────────────────────────────────────────────
// Session-lifetime, size-bounded caches for things that are expensive to
// rediscover every time a bubble or avatar remounts (conversation switch,
// section fold, back-navigation):
//   • MEDIA_META_CACHE — an image's natural size and caption tone. With the
//     size known up front the <img> reserves its exact box on the very first
//     frame, so a thread never reflows as pictures decode and a restored
//     scroll position lands precisely. The tone is a canvas read-back; doing
//     it once per picture instead of once per mount saves real main-thread.
//   • AVA_READY — avatar URLs that have already decoded, so a remounted
//     avatar paints immediately instead of replaying its 280ms fade-in.
// Keys never hold a whole data: URL (a pasted photo can be megabytes); long
// URLs are keyed by length + head + tail, which is collision-safe in practice
// and keeps the caches from pinning attachment payloads in memory.
const _mediaKey = (url) => {
  const u = String(url || '');
  if (!u) return '';
  return u.length <= 1024 ? u : ('#' + u.length + ':' + u.slice(0, 96) + ':' + u.slice(-160));
};
const _boundedCache = (max) => {
  const map = new Map();
  return {
    get(k) {
      if (!k || !map.has(k)) return undefined;
      const v = map.get(k);
      map.delete(k); map.set(k, v);          // refresh recency
      return v;
    },
    set(k, v) {
      if (!k) return;
      if (map.has(k)) map.delete(k);
      map.set(k, v);
      if (map.size > max) map.delete(map.keys().next().value);
    },
    has(k) { return !!k && map.has(k); },
    clear() { map.clear(); },
  };
};
const MEDIA_META_CACHE = _boundedCache(800);
const AVA_READY        = _boundedCache(1500);

const ImageCard = ({url, name, caption, label, labelWho, corners, onZoom}) => {
  ensureMediaCardStyles();
  const cap = String(caption || '').trim();
  const mKey = _mediaKey(url);
  const cachedMeta = MEDIA_META_CACHE.get(mKey);
  const [natural, setNatural] = React.useState(() => (cachedMeta && cachedMeta.w) ? { w: cachedMeta.w, h: cachedMeta.h } : null);   // {w, h} once loaded
  const [tone, setTone] = React.useState(() => (cap && cachedMeta && cachedMeta.tone) || null);   // {scrim, shade} from the pixels
  const [open, setOpen] = React.useState(false);
  const [clamped, setClamped] = React.useState(false);
  const textRef = React.useRef(null);
  // A late-arriving URL (patchMediaUrl) swaps the picture under the same
  // card — reseed from the cache in render so no stale size is committed.
  const prevKeyRef = React.useRef(mKey);
  if (prevKeyRef.current !== mKey) {
    prevKeyRef.current = mKey;
    setNatural((cachedMeta && cachedMeta.w) ? { w: cachedMeta.w, h: cachedMeta.h } : null);
    setTone((cap && cachedMeta && cachedMeta.tone) || null);
  }

  // Width the picture renders at inside the height cap (the bubble's own
  // max-width still applies on top via max-width:100%).
  const renderW = natural ? Math.round(natural.w * Math.min(1, MEDIA_MAX_H / Math.max(1, natural.h))) : 0;
  const mode = !cap ? 'none'
    : (cap.length > CAPTION_OVERLAY_MAX_CHARS || (renderW > 0 && renderW < CAPTION_OVERLAY_MIN_W)) ? 'footer'
    : 'overlay';

  // Is the three-line clamp actually hiding anything? Re-checked when the
  // card resizes (the bubble's max-width follows the window).
  React.useLayoutEffect(() => {
    const el = textRef.current;
    if (mode !== 'overlay' || !el) { setClamped(false); return; }
    const check = () => { if (!open) setClamped(el.scrollHeight - el.clientHeight > 1); };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, cap, open, natural]);

  const footerW = mode === 'footer' && renderW ? Math.max(renderW, 220) : undefined;
  // Reserve the picture's box before it decodes. These are exactly the
  // dimensions the browser settles on after load (width capped by the
  // height limit, then by max-width:100%, height from the ratio), so the
  // only visible difference is that nothing jumps.
  const imgBox = natural
    ? (mode === 'footer'
        ? { aspectRatio: `${natural.w} / ${natural.h}` }
        : { width: renderW || undefined, aspectRatio: `${natural.w} / ${natural.h}` })
    : undefined;

  return (
    <figure className="bc-media" data-cap={mode} style={{...corners, width: footerW}}>
      <img className="bc-media-img" src={url} alt={cap || name || 'image'} loading="lazy" decoding="async"
        style={imgBox}
        onLoad={e => {
          const t = e.currentTarget;
          const prev = MEDIA_META_CACHE.get(mKey) || {};
          const next = { ...prev };
          if (t.naturalWidth) {
            next.w = t.naturalWidth; next.h = t.naturalHeight;
            setNatural(n => (n && n.w === t.naturalWidth && n.h === t.naturalHeight) ? n : { w: t.naturalWidth, h: t.naturalHeight });
          }
          if (cap) {
            const tn = prev.tone || captionTone(t);
            next.tone = tn;
            setTone(cur => (cur && cur.scrim === tn.scrim && cur.shade === tn.shade) ? cur : tn);
          }
          MEDIA_META_CACHE.set(mKey, next);
        }}
        onClick={e => { e.stopPropagation(); onZoom(); }}
        title="Click to view full size"/>
      {label && <span className="bc-media-lbl" data-who={labelWho || undefined}>{label}</span>}
      {mode === 'overlay' && (
        <figcaption className="bc-media-cap" data-open={open ? '1' : '0'} data-more={(clamped || open) ? '1' : '0'}
          style={tone ? { '--scrim': tone.scrim, '--shade': tone.shade } : undefined}
          onClick={e => {
            e.stopPropagation();
            if (clamped || open) setOpen(o => !o); else onZoom();
          }}
          title={clamped && !open ? 'Show full caption' : undefined}>
          <span ref={textRef} className="bc-media-cap-text">{cap}</span>
          {clamped && !open && <span className="bc-media-cap-more">More</span>}
        </figcaption>
      )}
      {mode === 'footer' && <figcaption className="bc-media-foot">{cap}</figcaption>}
    </figure>
  );
};

// ── THREAD RENDERING COST ───────────────────────────────────────────
// Both thread scrollers (.ipc-thread, .cwin-thread) carry an edge-fade
// mask. A masked element is the backdrop root for everything inside it, so
// a bubble's backdrop-filter can only sample the thread behind it — which
// is transparent — and blurs nothing. It still costs a separate render pass
// per bubble on every scroll and resize frame. Checked pixel-for-pixel:
// with and without the filter the thread is identical. So it's switched off
// inside threads only; bubbles drawn anywhere else keep their glass.
(() => {
  if (typeof document === 'undefined' || document.getElementById('bc-thread-perf-style')) return;
  const s = document.createElement('style');
  s.id = 'bc-thread-perf-style';
  s.textContent = `
.ipc-thread .bubble, .cwin-thread .bubble,
.ipc-thread .b-draft, .cwin-thread .b-draft {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
.bc-vid-ph { position: relative; display: flex; align-items: center; justify-content: center;
  width: 320px; max-width: 100%; aspect-ratio: 16 / 9; background: #000; cursor: pointer; }
.bc-vid-ph svg { opacity: .75; transition: opacity .15s ease; }
.bc-vid-ph:hover svg { opacity: 1; }`;
  (document.head || document.documentElement).appendChild(s);
})();

// ── LazyVideo ───────────────────────────────────────────────────────
// A <video> is expensive to have in the DOM even paused: with preload it
// fetches (or, for a data: URL, parses the whole file) and decodes a frame
// for every clip in the thread the moment the chat opens. Clips mount when
// they come within a screen or so of view — or on click — and then stay
// mounted, so a video that's playing keeps playing when scrolled past.
// One shared observer for every clip.
const _vidWatch = (() => {
  let io = null;
  const cbs = new WeakMap();
  return {
    watch(el, cb) {
      if (!el) return () => {};
      if (typeof IntersectionObserver === 'undefined') { cb(); return () => {}; }
      if (!io) {
        io = new IntersectionObserver(entries => entries.forEach(en => {
          if (!en.isIntersecting) return;
          const f = cbs.get(en.target);
          if (f) { cbs.delete(en.target); io.unobserve(en.target); f(); }
        }), { rootMargin: '900px 0px' });
      }
      cbs.set(el, cb);
      io.observe(el);
      return () => { cbs.delete(el); try { io.unobserve(el); } catch (_) {} };
    },
  };
})();
const _vidSeen = new Set();   // URLs already mounted once this session (by media key)
const LazyVideo = ({url, style}) => {
  const key = _mediaKey(url);
  const [live, setLive] = React.useState(() => _vidSeen.has(key));
  const phRef = React.useRef(null);
  React.useEffect(() => {
    if (live) return;
    return _vidWatch.watch(phRef.current, () => { _vidSeen.add(key); setLive(true); });
  }, [live, key]);
  if (live) {
    return (
      <video src={url} controls preload="metadata"
        onClick={e=>e.stopPropagation()}
        style={style}/>
    );
  }
  return (
    <div ref={phRef} className="bc-vid-ph" role="button" tabIndex={0} aria-label="Load video"
      onClick={e => { e.stopPropagation(); _vidSeen.add(key); setLive(true); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _vidSeen.add(key); setLive(true); } }}
      style={{borderRadius: style.borderRadius, borderTopLeftRadius: style.borderTopLeftRadius,
        borderTopRightRadius: style.borderTopRightRadius, borderBottomLeftRadius: style.borderBottomLeftRadius,
        borderBottomRightRadius: style.borderBottomRightRadius, marginBottom: style.marginBottom}}>
      <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.14)"/>
        <path d="M10 8.2v7.6L16 12z" fill="#fff"/>
      </svg>
    </div>
  );
};

// ── YouTube links in chat ──────────────────────────────────────────
// A YouTube link (sent by an agent from a product's photo strip, or typed
// by anyone) is drawn as a video card: the video's own thumbnail at 16:9,
// a play button and a quiet footer. Clicking plays it in a full-window
// viewer with the same frame as the image viewer (MediaLightbox), so
// nobody is sent off to a browser just to watch a clip.
const BC_YT_RE = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:[^\s#]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})(?:[^\s<>"']*)?/i;
const bcYouTubeId = (url) => {
  const m = BC_YT_RE.exec(String(url || ''));
  return m ? m[1] : '';
};
// First YouTube URL inside a piece of text, as written.
const bcYouTubeUrlIn = (text) => {
  const m = BC_YT_RE.exec(String(text || ''));
  return m ? m[0] : '';
};
const bcYtStart = (url) => {
  const m = /[?&#](?:t|start)=(\d+)(?:s)?/i.exec(String(url || ''));
  return m ? parseInt(m[1], 10) : 0;
};
// Open a file in a browser tab. Browsers refuse to open a data: URL as a
// page, and attachments (direct-chat files especially) are data: URLs, so
// those open through a blob: URL instead.
const bcOpenInBrowser = (url) => {
  if (!url) return;
  if (/^data:/i.test(url)) {
    const w = window.open('', '_blank');
    fetch(url).then(r => r.blob()).then(b => {
      const u = URL.createObjectURL(b);
      if (w) w.location.href = u; else window.open(u, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    }).catch(() => { try { if (w) w.close(); } catch (_) {} });
    return;
  }
  try { window.open(url, '_blank', 'noopener'); } catch (_) {}
};
const bcOpenExternal = (url) => {
  if (!url) return;
  if (bcInHost()) { bcBridgeSend('openMedia', { url, name: 'YouTube' }); return; }
  try { window.open(url, '_blank', 'noopener'); } catch (_) {}
};

let _ytCss = false;
const ensureYouTubeStyles = () => {
  if (_ytCss || typeof document === 'undefined') return;
  _ytCss = true;
  const st = document.createElement('style');
  st.id = 'bc-yt-style';
  st.textContent = `
.bc-yt { position: relative; display: block; width: 300px; max-width: 100%; margin: 0; padding: 0; border: none; overflow: hidden;
  background: #0b0b10; color: #fff; font: inherit; text-align: left; cursor: pointer; }
.bc-yt-frame { position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; background: #111 center / cover no-repeat; }
.bc-yt-frame::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55)); }
.bc-yt-play { position: absolute; left: 50%; top: 50%; z-index: 1; width: 46px; height: 32px; margin: -16px 0 0 -23px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center; background: rgba(18,18,24,0.72);
  box-shadow: 0 4px 16px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.12);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); transition: background-color 140ms ease, transform 140ms ease; }
.bc-yt:hover .bc-yt-play { background: #e62117; transform: scale(1.04); }
.bc-yt:focus-visible { outline: none; box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 70%, transparent); }
.bc-yt-foot { display: flex; align-items: center; gap: 7px; padding: 7px 10px 8px; background: rgba(255,255,255,0.045); min-width: 0; }
.bc-yt-logo { flex: 0 0 auto; display: inline-flex; }
.bc-yt-txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.bc-yt-cap { font-size: 12px; line-height: 1.35; color: var(--t1, #eeeef5); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.bc-yt-cap.is-full { display: block; -webkit-line-clamp: unset; font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; margin-bottom: 2px; }
.bc-yt-src { font-size: 10.5px; color: rgba(190,194,214,0.62); }
.bc-yt-inline { margin-top: 6px; border-radius: 10px; }
@keyframes bcYtIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes bcYtPop { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: none } }
.bc-ytbox { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 60px 40px 40px;
  background: rgba(6,7,14,0.9); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); animation: bcYtIn 150ms ease; }
.bc-ytbox-player { position: relative; width: min(100%, calc((100vh - 110px) * 16 / 9), 1100px); aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden;
  background: #000; box-shadow: 0 30px 90px -20px rgba(0,0,0,0.8); animation: bcYtPop 180ms cubic-bezier(0.16,1,0.3,1); }
.bc-ytbox-player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.bc-ytbox-bar { position: fixed; top: 14px; left: 16px; right: 16px; display: flex; align-items: center; gap: 8px; }
.bc-ytbox-title { display: inline-flex; align-items: center; gap: 7px; min-width: 0; font-size: 12px; color: rgba(255,255,255,0.75);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bc-ytbox-btn { flex: 0 0 auto; height: 30px; min-width: 30px; padding: 0 9px; border: none; border-radius: 8px; display: inline-flex; align-items: center;
  justify-content: center; gap: 6px; font: inherit; font-size: 11.5px; font-weight: 550; color: rgba(255,255,255,0.82);
  background: rgba(255,255,255,0.08); cursor: pointer; text-decoration: none; }
.bc-ytbox-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }
@media (prefers-reduced-motion: reduce) { .bc-ytbox, .bc-ytbox-player { animation: none; } .bc-yt-play { transition: none; } }
/* The card's "play in the mini player" button, at the end of its footer. */
.bc-yt-foot { position: relative; }
.bc-yt-mini { margin-left: auto; flex: 0 0 auto; width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  color: rgba(200,204,222,0.62); transition: background-color 120ms ease, color 120ms ease; }
.bc-yt-mini:hover, .bc-yt-mini:focus-visible { background: rgba(255,255,255,0.08); color: #fff; outline: none; }

/* ── MINI PLAYER ──
   A small floating player that keeps going while you move around the app.
   The frame stays out of the way: a hairline edge and a soft shadow, the
   video filling it corner to corner. A slim bar fades in over the top of
   the video on hover (always there, faintly, on touch screens): drag it to
   move the player, grab any corner to resize (it keeps its 16:9 shape). */
.bc-ytmini { position: fixed; z-index: 9500; border-radius: 12px; overflow: hidden; background: #000;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 20px 50px -14px rgba(0,0,0,0.75), 0 4px 14px rgba(0,0,0,0.35);
  animation: bcYtMiniIn 220ms cubic-bezier(0.16,1,0.3,1); touch-action: none; }
@keyframes bcYtMiniIn { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }
.bc-ytmini iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
.bc-ytmini[data-busy="1"] iframe { pointer-events: none; }
.bc-ytmini-bar { position: absolute; left: 0; right: 0; top: 0; z-index: 2; height: 36px; box-sizing: border-box;
  display: flex; align-items: center; gap: 4px; padding: 0 6px 6px 10px;
  background: linear-gradient(180deg, rgba(6,7,12,0.82) 0%, rgba(6,7,12,0.45) 60%, rgba(6,7,12,0) 100%);
  opacity: 0; transition: opacity 180ms ease; cursor: grab; }
.bc-ytmini[data-show="1"] .bc-ytmini-bar, .bc-ytmini[data-busy="1"] .bc-ytmini-bar { opacity: 1; }
.bc-ytmini[data-touch="1"]:not([data-show="1"]) .bc-ytmini-bar { opacity: 0.85; }
.bc-ytmini[data-busy="1"] .bc-ytmini-bar { cursor: grabbing; }
.bc-ytmini-title { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 7px;
  font-size: 11.5px; font-weight: 500; letter-spacing: -0.005em; color: rgba(255,255,255,0.86);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: none; }
.bc-ytmini-title > span { overflow: hidden; text-overflow: ellipsis; }
.bc-ytmini-btn { all: unset; box-sizing: border-box; flex: 0 0 auto; width: 26px; height: 26px; border-radius: 7px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.82);
  transition: background-color 120ms ease, color 120ms ease; }
.bc-ytmini-btn:hover, .bc-ytmini-btn:focus-visible { background: rgba(255,255,255,0.14); color: #fff; }
.bc-ytmini-rz { position: absolute; z-index: 3; width: 16px; height: 16px; touch-action: none; }
.bc-ytmini-rz[data-c="nw"] { left: 0; top: 0; cursor: nwse-resize; }
.bc-ytmini-rz[data-c="ne"] { right: 0; top: 0; cursor: nesw-resize; }
.bc-ytmini-rz[data-c="sw"] { left: 0; bottom: 0; cursor: nesw-resize; }
.bc-ytmini-rz[data-c="se"] { right: 0; bottom: 0; cursor: nwse-resize; }
/* The bottom corners show a faint grip on hover, where a resize is expected. */
.bc-ytmini-rz[data-c="se"]::after, .bc-ytmini-rz[data-c="sw"]::after { content: ""; position: absolute; bottom: 4px; width: 7px; height: 7px;
  border-bottom: 1.5px solid rgba(255,255,255,0.55); opacity: 0; transition: opacity 180ms ease; }
.bc-ytmini-rz[data-c="se"]::after { right: 4px; border-right: 1.5px solid rgba(255,255,255,0.55); border-bottom-right-radius: 3px; }
.bc-ytmini-rz[data-c="sw"]::after { left: 4px; border-left: 1.5px solid rgba(255,255,255,0.55); border-bottom-left-radius: 3px; }
.bc-ytmini[data-show="1"] .bc-ytmini-rz::after { opacity: 1; }
@media (pointer: coarse) { .bc-ytmini-rz { width: 28px; height: 28px; } .bc-ytmini-btn { width: 32px; height: 32px; } .bc-ytmini-bar { height: 42px; } }
@media (prefers-reduced-motion: reduce) { .bc-ytmini { animation: none; } }
`;
  document.head.appendChild(st);
};

const BcYtLogo = ({s = 14}) => (
  <svg width={s} height={Math.round(s * 0.72)} viewBox="0 0 28 20" aria-hidden="true">
    <rect width="28" height="20" rx="5" fill="#e62117"/><path d="M11.2 5.8v8.4L18.4 10z" fill="#fff"/>
  </svg>
);

// ── WHERE A PLAYING VIDEO IS ──
// The embed reports its current time over postMessage once asked to
// (enablejsapi=1 and a 'listening' message), which is how the lightbox and
// the mini player hand a video to each other without starting it over.
const bcYtEmbedSrc = (id, start) => {
  let origin = '';
  try { if (/^https?:/i.test(location.origin)) origin = '&origin=' + encodeURIComponent(location.origin); } catch (_) {}
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1${origin}${start ? `&start=${Math.floor(start)}` : ''}`;
};
const useYtTime = (frameRef, start) => {
  const timeRef = React.useRef(start || 0);
  React.useEffect(() => {
    const onMsg = (e) => {
      const f = frameRef.current;
      if (!f || e.source !== f.contentWindow || typeof e.data !== 'string') return;
      try {
        const d = JSON.parse(e.data);
        const t = d && d.info && d.info.currentTime;
        if (typeof t === 'number' && t >= 0) timeRef.current = t;
      } catch (_) {}
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [frameRef]);
  const onLoad = React.useCallback(() => {
    const f = frameRef.current;
    try { f && f.contentWindow && f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch (_) {}
  }, [frameRef]);
  return [timeRef, onLoad];
};

// ── MINI PLAYER ──────────────────────────────────────────────────────
// One at a time, app-wide, drawn in its own root so it keeps playing while
// you change chats or open settings. BC_YT_MINI.open({ id, url, title, t })
// starts (or replaces) it; the player's expand button goes back to the
// full-size lightbox at the same point.
const BC_YT_MINI = {
  video: null,          // { id, url, title, t, key }
  full: false,          // showing the full-size lightbox instead
  subs: new Set(),
  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  notify() { this.subs.forEach(fn => { try { fn(); } catch (_) {} }); },
  open(v) {
    if (!v || !v.id) return;
    this.video = { ...v, key: Date.now() };
    this.full = false;
    ensureYtMiniRoot();
    this.notify();
  },
  expand(t) { if (this.video) { this.video = { ...this.video, t, key: Date.now() }; this.full = true; this.notify(); } },
  close() { this.video = null; this.full = false; this.notify(); },
};
const YT_MINI_LS = 'bc.ytmini.geom';
const YT_MINI_MIN_W = 220;
const ytMiniMaxW = () => Math.max(YT_MINI_MIN_W, Math.min(960, window.innerWidth - 16));
const ytMiniClamp = (g) => {
  const w = Math.max(YT_MINI_MIN_W, Math.min(ytMiniMaxW(), g.w));
  const h = w * 9 / 16;
  return { w, x: Math.max(8, Math.min(window.innerWidth - w - 8, g.x)), y: Math.max(8, Math.min(window.innerHeight - h - 8, g.y)) };
};
const ytMiniStartGeom = () => {
  try {
    const g = JSON.parse(localStorage.getItem(YT_MINI_LS) || 'null');
    if (g && Number.isFinite(g.x) && Number.isFinite(g.y) && Number.isFinite(g.w)) return ytMiniClamp(g);
  } catch (_) {}
  // Bottom right, clear of the chat composer.
  const w = Math.min(380, window.innerWidth - 24);
  return ytMiniClamp({ w, x: window.innerWidth - w - 16, y: window.innerHeight - w * 9 / 16 - 104 });
};
const ensureYtMiniRoot = () => {
  if (typeof document === 'undefined' || window.__bcYtMiniRoot) return;
  const el = document.createElement('div');
  el.id = 'bc-ytmini-root';
  document.body.appendChild(el);
  window.__bcYtMiniRoot = ReactDOM.createRoot(el);
  window.__bcYtMiniRoot.render(<YtMiniHost/>);
};
const YtMiniHost = () => {
  const [, bump] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => BC_YT_MINI.sub(bump), []);
  const v = BC_YT_MINI.video;
  if (!v) return null;
  if (BC_YT_MINI.full) {
    return <YouTubeLightbox key={v.key} id={v.id} url={v.url} title={v.title} start={v.t}
      onClose={() => BC_YT_MINI.close()} onMini={(t) => BC_YT_MINI.open({ ...v, t })}/>;
  }
  return <YtMiniPlayer key={v.key} video={v}/>;
};
const YtMiniPlayer = ({video}) => {
  ensureYouTubeStyles();
  const frameRef = React.useRef(null);
  const [timeRef, onLoad] = useYtTime(frameRef, video.t);
  const [src] = React.useState(() => bcYtEmbedSrc(video.id, video.t));
  const [geom, setGeom] = React.useState(ytMiniStartGeom);
  const [busy, setBusy] = React.useState(false);
  const [show, setShow] = React.useState(false);
  const touch = bcNoHover();
  const geomRef = React.useRef(geom); geomRef.current = geom;
  const save = (g) => { try { localStorage.setItem(YT_MINI_LS, JSON.stringify(g)); } catch (_) {} };
  React.useEffect(() => {
    const onResize = () => setGeom(g => ytMiniClamp(g));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Drag (from the bar) and resize (from a corner) share one pointer path.
  const startGesture = (mode, corner) => (e) => {
    if (e.button != null && e.button !== 0) return;
    if (mode === 'move' && e.target.closest && e.target.closest('button')) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    const s = { px: e.clientX, py: e.clientY, ...geomRef.current, h: geomRef.current.w * 9 / 16 };
    setBusy(true);
    const move = (ev) => {
      const dx = ev.clientX - s.px, dy = ev.clientY - s.py;
      if (mode === 'move') { setGeom(ytMiniClamp({ ...s, x: s.x + dx, y: s.y + dy })); return; }
      const sx = corner.includes('e') ? 1 : -1, sy = corner.includes('s') ? 1 : -1;
      const byX = sx * dx, byY = sy * dy * 16 / 9;
      const w = Math.max(YT_MINI_MIN_W, Math.min(ytMiniMaxW(), s.w + (Math.abs(byX) > Math.abs(byY) ? byX : byY)));
      const h = w * 9 / 16;
      setGeom(ytMiniClamp({ w, x: sx > 0 ? s.x : s.x + s.w - w, y: sy > 0 ? s.y : s.y + s.h - h }));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setBusy(false);
      save(geomRef.current);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const h = geom.w * 9 / 16;
  const watch = `https://www.youtube.com/watch?v=${video.id}${timeRef.current >= 1 ? `&t=${Math.floor(timeRef.current)}s` : ''}`;
  return ReactDOM.createPortal(
    <div className="bc-ytmini" role="dialog" aria-label={video.title ? `Mini player: ${video.title}` : 'YouTube mini player'}
      data-busy={busy ? '1' : undefined} data-show={show ? '1' : undefined} data-touch={touch ? '1' : undefined}
      style={{ left: geom.x, top: geom.y, width: geom.w, height: h }}
      onPointerEnter={() => setShow(true)} onPointerLeave={() => { if (!busy) setShow(false); }}>
      <iframe ref={frameRef} src={src} title={video.title || 'YouTube video'} onLoad={onLoad}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen/>
      <div className="bc-ytmini-bar" onPointerDown={startGesture('move')}>
        <span className="bc-ytmini-title"><BcYtLogo s={14}/><span>{video.title || 'YouTube'}</span></span>
        <button type="button" className="bc-ytmini-btn" title="Open on YouTube" aria-label="Open on YouTube"
          onClick={() => bcOpenExternal(watch)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>
        </button>
        <button type="button" className="bc-ytmini-btn" title="Full size" aria-label="Full size"
          onClick={() => BC_YT_MINI.expand(timeRef.current)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
        </button>
        <button type="button" className="bc-ytmini-btn" title="Close" aria-label="Close mini player"
          onClick={() => BC_YT_MINI.close()}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      {['nw', 'ne', 'sw', 'se'].map(c => (
        <span key={c} className="bc-ytmini-rz" data-c={c} aria-hidden="true" onPointerDown={startGesture('size', c)}/>
      ))}
    </div>,
    document.body
  );
};

// `start` / `onMini`: when the lightbox is part of a hand-off with the mini
// player — where to start, and how to send the video back to it.
const YouTubeLightbox = ({id, url, title, onClose, start: startAt, onMini}) => {
  ensureYouTubeStyles();
  const frameRef = React.useRef(null);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const start = startAt != null ? startAt : bcYtStart(url);
  const [timeRef, onLoad] = useYtTime(frameRef, start);
  const [src] = React.useState(() => bcYtEmbedSrc(id, start));
  const watch = `https://www.youtube.com/watch?v=${id}${start ? `&t=${Math.floor(start)}s` : ''}`;
  const toMini = () => {
    const t = timeRef.current;
    if (onMini) onMini(t);
    else { onClose(); BC_YT_MINI.open({ id, url, title, t }); }
  };
  return ReactDOM.createPortal(
    <div className="bc-ytbox" onClick={onClose} role="dialog" aria-label="YouTube video">
      <div className="bc-ytbox-player" onClick={e => e.stopPropagation()}>
        <iframe ref={frameRef} src={src} onLoad={onLoad} title={title || 'YouTube video'} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen/>
      </div>
      <div className="bc-ytbox-bar" onClick={e => e.stopPropagation()}>
        <span className="bc-ytbox-title"><BcYtLogo s={16}/>{title || 'YouTube'}</span>
        <span style={{flex: 1}}/>
        <button type="button" className="bc-ytbox-btn" onClick={toMini} title="Keep playing in a small window you can move and resize">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none"/></svg>
          Mini player
        </button>
        <button type="button" className="bc-ytbox-btn" onClick={() => bcOpenExternal(watch)} title="Open on YouTube">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>
          YouTube
        </button>
        <button type="button" className="bc-ytbox-btn" onClick={onClose} title="Close (Esc)" aria-label="Close" style={{fontSize: 17, padding: 0}}>×</button>
      </div>
    </div>,
    document.body
  );
};

// inline: drawn under a text message (padded, own radius) rather than as
// the bubble's whole body.
// `full`: the caption is a whole message (a YouTube link sent as text), so
// it's shown in full rather than clipped to two lines.
const YouTubeCard = ({url, caption = '', corners = null, inline = false, full = false}) => {
  ensureYouTubeStyles();
  const id = bcYouTubeId(url);
  const [open, setOpen] = React.useState(false);
  const [thumb, setThumb] = React.useState(() => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  if (!id) return null;
  const cap = String(caption || '').replace(BC_YT_RE, '').trim();
  return (
    <>
      <button type="button" className={'bc-yt' + (inline ? ' bc-yt-inline' : '')} style={inline ? undefined : (corners || undefined)}
        onClick={e => { e.stopPropagation(); setOpen(true); }} title="Play video" aria-label={cap ? `Play video: ${cap}` : 'Play YouTube video'}>
        <span className="bc-yt-frame" style={{backgroundImage: `url("${thumb}")`}}>
          <img src={thumb} alt="" style={{display: 'none'}}
            onError={() => setThumb(t => (t.includes('hqdefault') ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : t))}/>
          <span className="bc-yt-play" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13L19 12z" fill="#fff"/></svg>
          </span>
        </span>
        <span className="bc-yt-foot">
          <span className="bc-yt-logo"><BcYtLogo/></span>
          <span className="bc-yt-txt">
            {cap && <span className={'bc-yt-cap' + (full ? ' is-full' : '')}>{cap}</span>}
            <span className="bc-yt-src">YouTube · Play here</span>
          </span>
          <span className="bc-yt-mini" role="button" tabIndex={0} title="Play in the mini player" aria-label="Play in the mini player"
            onClick={e => { e.stopPropagation(); BC_YT_MINI.open({ id, url, title: cap, t: bcYtStart(url) }); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); BC_YT_MINI.open({ id, url, title: cap, t: bcYtStart(url) }); } }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none"/></svg>
          </span>
        </span>
      </button>
      {open && <YouTubeLightbox id={id} url={url} title={cap} onClose={() => setOpen(false)}/>}
    </>
  );
};

// Any other link sent as an attachment: one tidy row instead of a file card.
const LinkCard = ({url, caption = ''}) => {
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
  const cap = String(caption || '').replace(url, '').trim();
  return (
    <div className="bc-fcard is-open" data-fam="other" role="button" tabIndex={0}
      onClick={e => { e.stopPropagation(); bcOpenExternal(url); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bcOpenExternal(url); } }}
      title={url}>
      <div className="bc-fcard-ico" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
      </div>
      <div className="bc-fcard-body">
        <div className="bc-fcard-name"><span className="bc-fcard-base">{cap || host}</span></div>
        <div className="bc-fcard-meta">{host}</div>
      </div>
    </div>
  );
};

const MessageMedia = ({m, radius = null, edge = false, caption = '', label = null, labelWho = ''}) => {
  const [zoom, setZoom] = React.useState(false);
  const kind = mediaKindOf(m && m.mt, m && m.mu);
  // An attachment with no URL yet (still downloading) or none at all (too
  // big / failed): a chip that says so, instead of a bare "[Document]".
  if (!kind) {
    if (m && m.mt && (m.mp || m.me || m.mn)) {
      return (
        <FileCard name={m.mn || ''} kind={m.mt === 'photo' ? 'photo' : m.mt} size={m.ms}
          pending={!!m.mp} error={m.mp ? '' : (m.me || 'Not available here')}/>
      );
    }
    return null;
  }
  const url  = m.mu;
  const name = attNameOf(m);
  const gap  = m.c ? 6 : 0;

  // Edge-to-edge media matches the bubble's corners exactly; padded media
  // keeps a modest radius of its own.
  const corners = (edge && radius)
    ? {
        borderTopLeftRadius:     radius.tl,
        borderTopRightRadius:    radius.tr,
        borderBottomLeftRadius:  radius.bl,
        borderBottomRightRadius: radius.br,
      }
    : { borderRadius: 10 };

  if (kind === 'youtube') {
    return <YouTubeCard url={url} caption={caption || m.c || ''} corners={edge ? corners : {borderRadius: 10}}/>;
  }
  if (kind === 'link') {
    return <LinkCard url={url} caption={m.c || ''}/>;
  }
  if (kind === 'image' && edge) {
    return (
      <React.Fragment>
        <ImageCard url={url} name={name} caption={caption} label={label} labelWho={labelWho}
          corners={corners} onZoom={() => setZoom(true)}/>
        {zoom && <MediaLightbox url={url} name={name} onClose={()=>setZoom(false)}/>}
      </React.Fragment>
    );
  }
  if (kind === 'image') {
    return (
      <React.Fragment>
        <img src={url} alt={m.c || name || 'image'} loading="lazy" decoding="async"
          onClick={e=>{ e.stopPropagation(); setZoom(true); }}
          title="Click to view full size"
          style={{
            ...corners,
            maxWidth:'100%', maxHeight: 300,
            marginBottom: gap,
            display:'block', cursor:'zoom-in',
            // Width, not height, is what a chat bubble constrains, so the
            // natural ratio is preserved and the height cap only catches
            // genuinely tall images.
            height:'auto', objectFit:'contain',
          }}/>
        {zoom && <MediaLightbox url={url} name={name} onClose={()=>setZoom(false)}/>}
      </React.Fragment>
    );
  }
  if (kind === 'video') {
    return (
      <LazyVideo url={url}
        style={{...corners, maxWidth:'100%', maxHeight:300, marginBottom:gap, display:'block', background:'#000'}}/>
    );
  }
  if (kind === 'audio') {
    return (
      <div style={{marginBottom:gap, minWidth:200}}>
        <audio src={url} controls preload="metadata" style={{width:'100%', maxWidth:260, display:'block'}}/>
        {name ? <div style={{fontSize:9.5, color:'var(--t3)', fontFamily:'var(--mono)', marginTop:3,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={name}>{name}</div> : null}
      </div>
    );
  }
  return (
    <FileCard name={name} kind={kind} url={url} size={m.ms}/>
  );
};

// ── MESSAGE LIFECYCLE STYLES ────────────────────────────────────────────
// Reply quotes, edited/deleted markers, the file chip's states, the chat's
// exit when its contact is deleted, and the composer's reply/edit bar.
let _msgLifeCss = false;
const ensureMsgLifecycleStyles = () => {
  if (_msgLifeCss || typeof document === 'undefined') return;
  _msgLifeCss = true;
  const st = document.createElement('style');
  st.id = 'bc-msg-life-css';
  st.textContent = `
    .bubble .b-quote{position:relative;display:flex;flex-direction:column;align-items:stretch;gap:0;
      width:100%;min-width:0;box-sizing:border-box;margin:2px 0 6px;padding:5px 10px 6px 12px;
      border:none;border-radius:8px;overflow:hidden;
      background:color-mix(in oklab, var(--acc,#6c63ff) 11%, rgba(255,255,255,0.03));
      cursor:pointer;font:inherit;color:inherit;text-align:left;transition:background-color .18s ease}
    .bubble .b-quote::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
      background:color-mix(in oklab, var(--acc,#6c63ff) 72%, #d8d8e6)}
    .bubble .b-quote:hover{background:color-mix(in oklab, var(--acc,#6c63ff) 17%, rgba(255,255,255,0.05))}
    .bubble .b-quote:focus-visible{outline:1.5px solid color-mix(in oklab, var(--acc,#6c63ff) 60%, transparent);outline-offset:1px}
    .bubble .b-quote[data-who="in"]{background:rgba(255,255,255,0.045)}
    .bubble .b-quote[data-who="in"]::before{background:color-mix(in oklab, var(--t2,#9898b4) 78%, var(--acc,#6c63ff))}
    .bubble .b-quote[data-who="in"]:hover{background:rgba(255,255,255,0.075)}
    .bubble .b-quote-who{font-size:11px;line-height:1.4;font-weight:600;letter-spacing:-0.003em;
      color:var(--bub-acc-soft,#b3adff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bubble .b-quote[data-who="in"] .b-quote-who{color:color-mix(in oklab, var(--t1,#eeeef5) 86%, var(--acc,#6c63ff))}
    .bubble .b-quote-txt{font-size:12px;line-height:1.4;color:var(--t2);white-space:nowrap;overflow:hidden;
      text-overflow:ellipsis}
    .bubble.b-has-quote{min-width:170px}
    .bubble.b-file.b-file{padding:5px;min-width:0}
    .bubble.b-file .b-lbl{padding:3px 8px 0;margin-bottom:2px}
    .bubble.b-file .b-text{padding:5px 8px 3px}
    .bubble.b-file .b-foot{padding:0 8px 3px}
    .bc-fcard{display:flex;align-items:center;gap:11px;width:260px;max-width:100%;box-sizing:border-box;
      padding:6px 8px 6px 6px;border-radius:11px;transition:background-color .18s ease;--fcc:var(--acc,#6c63ff)}
    .bc-fcard.is-open{cursor:pointer}
    @media (hover:hover){.bc-fcard.is-open:hover{background:rgba(255,255,255,0.04)}}
    .bc-fcard.is-open:focus-visible{outline:1.5px solid color-mix(in oklab, var(--acc,#6c63ff) 55%, transparent);outline-offset:0}
    .bc-fcard[data-fam="pdf"]{--fcc:#c9736b}
    .bc-fcard[data-fam="doc"]{--fcc:#6f93c4}
    .bc-fcard[data-fam="sheet"]{--fcc:#62a883}
    .bc-fcard[data-fam="slide"]{--fcc:#c7925c}
    .bc-fcard[data-fam="arch"]{--fcc:#b5a063}
    .bc-fcard[data-fam="code"]{--fcc:#9587c4}
    .bc-fcard[data-fam="media"]{--fcc:#bb7d9e}
    .bc-fcard.is-err{--fcc:#c9736b}
    .bc-fcard-ico{position:relative;flex-shrink:0;width:40px;height:40px;border-radius:10px;
      display:flex;align-items:center;justify-content:center;
      color:color-mix(in oklab, var(--fcc) 72%, var(--t1,#eeeef5));
      background:color-mix(in oklab, var(--fcc) 15%, transparent);
      box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--fcc) 20%, transparent)}
    .bc-fcard-ext{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.03em;line-height:1}
    .bc-fcard-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
    .bc-fcard-name{display:flex;min-width:0;font-size:12.5px;line-height:1.3;font-weight:500;color:var(--t1);
      letter-spacing:-0.005em}
    .bc-fcard-base{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bc-fcard-dot{flex-shrink:0;white-space:nowrap}
    .bc-fcard-meta{font-size:10.5px;line-height:1.3;color:var(--t3);white-space:nowrap;overflow:hidden;
      text-overflow:ellipsis;font-variant-numeric:tabular-nums}
    .bc-fcard.is-err .bc-fcard-meta{color:#d49a93}
    .bc-fcard.is-pending .bc-fcard-meta{color:var(--t2)}
    .bc-fcard-dl{flex-shrink:0;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;
      justify-content:center;color:var(--t2);background:rgba(255,255,255,0.055);text-decoration:none;
      transition:background-color .16s ease,color .16s ease,transform .16s var(--bub-ease,ease)}
    .bc-fcard-dl:hover{background:color-mix(in oklab, var(--acc,#6c63ff) 26%, rgba(255,255,255,0.04));color:var(--t1)}
    .bc-fcard-dl:active{transform:scale(.92)}
    .bc-fcard-dl:focus-visible{outline:1.5px solid color-mix(in oklab, var(--acc,#6c63ff) 60%, transparent);outline-offset:1px}
    .bubble .b-foot{display:flex;gap:7px;justify-content:flex-end;align-items:center;margin-top:2px;
      font-size:10px;line-height:1.2;color:var(--t3);letter-spacing:.01em;user-select:none}
    .bubble .b-foot .b-ed{cursor:help}
    .bubble .b-foot .b-err{color:color-mix(in oklab, #e3a49c 55%, var(--t3,#8a8aa8))}
    .bubble .b-foot .b-dot{color:var(--t4,#5c5c7a)}
    .bubble .b-foot .b-retry{all:unset;cursor:pointer;color:var(--t2);font-weight:600;border-radius:4px;
      padding:0 2px;margin:0 -2px;transition:color .14s ease}
    .bubble .b-foot .b-retry:hover{color:var(--t1)}
    .bubble .b-foot .b-retry:focus-visible{box-shadow:0 0 0 1.5px color-mix(in oklab, var(--acc,#6c63ff) 55%, transparent)}
    .bubble.b-deleted.b-deleted{background:color-mix(in srgb, var(--bub-in-c,#1b1c26) 45%, transparent);
      border-style:dashed;border-color:rgba(255,255,255,0.09);box-shadow:none}
    .bubble.b-deleted .b-text, .bubble.b-deleted .b-quote, .bubble.b-deleted .bc-fcard{opacity:.55}
    .bubble.b-pending{opacity:.62}
    .bubble.b-sending{opacity:.8}
    .bubble.b-failed{opacity:.78}
    .brow[data-ctx-target="1"] .bubble{box-shadow:0 0 0 1.5px color-mix(in oklab, var(--acc,#6c63ff) 50%, transparent), var(--bub-shadow, none)}
    .bc-filechip-open:hover{background:rgba(255,255,255,0.085)!important;border-color:color-mix(in oklab, var(--acc,#6c63ff) 32%, transparent)!important}
    .bc-filechip-spin{width:13px;height:13px;border-radius:50%;
      border:1.6px solid color-mix(in oklab, var(--acc,#6c63ff) 25%, transparent);
      border-top-color:color-mix(in oklab, var(--acc,#6c63ff) 70%, #e0e0ea);animation:bc-spin .8s linear infinite}
    @keyframes bc-spin{to{transform:rotate(360deg)}}
    .ipc.ipc-exit{animation:bc-ipc-exit .26s cubic-bezier(.4,0,1,1) forwards;pointer-events:none}
    @keyframes bc-ipc-exit{to{opacity:0;transform:translateY(8px) scale(.985)}}
    .bc-cbar{display:flex;align-items:center;gap:9px;padding:7px 8px 6px 12px;
      border-bottom:1px solid rgba(255,255,255,0.055);animation:bc-cbar-in .22s cubic-bezier(.16,1,.3,1)}
    @keyframes bc-cbar-in{from{opacity:0;transform:translateY(4px)}}
    .bc-cbar-ico{color:var(--bub-acc-soft,var(--acc));flex-shrink:0;display:flex}
    .bc-cbar-body{position:relative;flex:1;min-width:0;padding:4px 10px 5px 12px;border-radius:8px;overflow:hidden;
      background:color-mix(in oklab, var(--acc,#6c63ff) 11%, rgba(255,255,255,0.03))}
    .bc-cbar-body::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
      background:color-mix(in oklab, var(--acc,#6c63ff) 72%, #d8d8e6)}
    .bc-cbar-title{font-size:11px;line-height:1.4;font-weight:600;color:var(--bub-acc-soft,#b3adff)}
    .bc-cbar-txt{font-size:12px;line-height:1.4;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bc-cbar-x{flex-shrink:0;width:24px;height:24px;border-radius:7px;border:none;background:transparent;
      color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
    .bc-cbar-x:hover{background:rgba(255,255,255,.07);color:var(--t1)}
    /* Message menu: see CONTEXT MENUS in BotCommand.html. */
    @media (prefers-reduced-motion: reduce){
      .ipc.ipc-exit{animation-duration:.01s}
      .bc-cbar{animation:none}
    }`;
  document.head.appendChild(st);
};
try { ensureMsgLifecycleStyles(); } catch (_) {}

// Who a quote belongs to, as the operator reads it.
const quoteWho = (rq, conv) => {
  if (!rq) return '';
  if (rq.r === 'in') return (conv && conv.name) || 'Customer';
  if (rq.r === 'bot') return 'AI';
  return 'You';
};
const quoteText = (rq) => {
  if (!rq) return '';
  const t = String(rq.c || '').trim();
  if (t) return t;
  if (rq.mt) return rq.mt === 'photo' || rq.mt === 'image' ? 'Photo' : rq.mt === 'document' ? 'File' : rq.mt.charAt(0).toUpperCase() + rq.mt.slice(1);
  return 'Original message';
};

const SHORT_BUBBLE_PX = 140;
// `avatarNode` overrides the incoming-side avatar. Added so the ghost can
// use its emoji badge here without Ava needing to know anything about the
// ghost, and without every customer row paying for the branch.
// ── GhostRichText ─────────────────────────────────────────────
// The ghost's replies are plain text apart from one thing: fenced code
// blocks, which it emits when walking an operator through an integration.
// Rendering those as literal ``` lines looked broken, so they get a real
// code panel with a copy button.
//
// Scope is intentionally tiny. ghost_format_speak() in api.php has already
// stripped bold/italic/headings/inline-code server-side, so there is no
// markdown left to parse -- only fences to split on. Anything that is not
// a fence is rendered verbatim.
//
// Only the ghost passes rich; customer chat bubbles are untouched.
const GHOST_FENCE_RE = /```[ \t]*\r?\n?([\s\S]*?)```/g;

// ── GHOST REVEAL TIMING ───────────────────────────────────────
// Works out how a message should unfurl. The one rule that matters:
// a long reply must not take proportionally longer than a short one.
// A fixed per-word delay reads beautifully at ten words and is
// unbearable at three hundred, so the step shrinks to fit a budget
// and the whole message lands inside it either way.
//
// Why it used to look janky, and what changed:
//   • Every word was animated with a blur filter. `filter` on hundreds of
//     inline spans is repainted per span per frame, and on wrapped lines
//     the blur is drawn per line fragment, so words smeared and flickered
//     in boxes rather than softly appearing. It's now an opacity-only fade,
//     which the compositor handles cheaply and which reads as clean text
//     streaming in.
//   • The words and the bubble ran on separate clocks. The bubble's own
//     entrance is held (paused) while the avatar hops down to it, but the
//     words kept going — so a reply often arrived half-revealed inside a
//     bubble that was still invisible, or finished before the bubble had
//     settled. The words now wait for the bubble's entrance to finish
//     (see ensureGhostRevealStyles), with a safety release so text can
//     never stay hidden.
//   • A reply could replay its reveal when the thread re-rendered. Each
//     message now reveals exactly once (ghostRevealOnce).
const GC_STEP_MS   = 18;    // gap between words when there's room for it
const GC_BUDGET_MS = 850;   // longest a whole message may take to arrive
const GC_MAX_SPANS = 200;   // DOM ceiling; past this, words reveal in groups
const GC_LITE_FROM = 110;   // above this many spans, a shorter fade per span

const ghostRevealPlan = (count) => {
  const spans = Math.max(1, Math.min(count, GC_MAX_SPANS));
  return {
    // Group size — a 600-word essay becomes 200 groups of 3 rather than
    // 600 spans. Keeps the DOM bounded without changing how it looks.
    group: Math.ceil(count / spans),
    step:  Math.min(GC_STEP_MS, GC_BUDGET_MS / spans),
    lite:  spans > GC_LITE_FROM,
  };
};

// The reveal's look. Injected after the page stylesheet so it supersedes
// the older .gc-word block in BotCommand.html (which used the blur).
const ensureGhostRevealStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('gc-reveal-v2')) return;
  const st = document.createElement('style');
  st.id = 'gc-reveal-v2';
  st.textContent = `
@keyframes gc-fade-v2 { from { opacity: 0; } to { opacity: 1; } }
.gc-word, .gc-word[data-lite="1"] {
  display: inline;
  animation-name: gc-fade-v2;
  animation-duration: 360ms;
  animation-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1);
  animation-fill-mode: both;
  filter: none;
  transform: none;
}
.gc-word[data-lite="1"] { animation-duration: 240ms; }
.gc-reveal-block {
  animation: gc-fade-v2 300ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}
/* Words hold on their first (transparent) frame until the bubble has
   finished coming in — the bubble drops data-enter when its entrance ends. */
.bubble[data-enter] .gc-word,
.bubble[data-enter] .gc-reveal-block { animation-play-state: paused; }
/* Safety release: if the bubble's entrance never reports finishing (hidden
   tab, interrupted animation), the text is let go regardless. */
.b-text[data-gc-go] .gc-word,
.b-text[data-gc-go] .gc-reveal-block { animation-play-state: running !important; }
html[data-motion="reduced"] .gc-word,
html[data-motion="reduced"] .gc-reveal-block { animation: none !important; opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .gc-word, .gc-reveal-block { animation: none !important; opacity: 1; }
}
`;
  document.head.appendChild(st);
};
try { ensureGhostRevealStyles(); } catch (_) {}

// Each ghost message reveals ONCE. The first render that asks for it
// books a window long enough for the whole reveal; any later render inside
// that window keeps the same spans (so the running animation isn't
// disturbed), and any render after it draws plain text — no replay when
// the thread re-renders, the chat is reopened, or a neighbour joins the run.
const GC_REVEALED = new Map();   // message id -> ms timestamp the reveal is over
const ghostRevealOnce = (id, text) => {
  if (!id) return false;
  const now = Date.now();
  if (!GC_REVEALED.has(id)) {
    const solid = String(text || '').split(/\s+/).filter(Boolean).length;
    // entrance (≈ 280ms, or longer while the avatar hops) + stagger + fade
    GC_REVEALED.set(id, now + 1200 + ghostRevealSpan(text) + 400);
    if (GC_REVEALED.size > 400) {
      for (const [k, until] of GC_REVEALED) { if (until < now) GC_REVEALED.delete(k); }
    }
    return solid > 0;
  }
  return now < GC_REVEALED.get(id);
};

// Splits text into animated spans, GROUPING words when there are a lot of
// them so the span count stays under GC_MAX_SPANS however long the reply
// is. The spans are display:inline and carry their own whitespace, so the
// browser still breaks lines exactly where it would have — grouping changes
// the number of elements, never the layout.
const GhostRevealText = ({text, delay = 0}) => {
  const {chunks, plan} = React.useMemo(() => {
    const parts = String(text || '').split(/(\s+)/).filter(w => w !== '');
    const solid = parts.filter(w => !/^\s+$/.test(w)).length;
    const p     = ghostRevealPlan(solid);
    const out   = [];
    let cur = '', n = 0;
    for (const piece of parts) {
      cur += piece;
      if (/^\s+$/.test(piece)) continue;
      n++;
      if (n % p.group === 0) { out.push(cur); cur = ''; }
    }
    if (cur !== '') out.push(cur);
    return {chunks: out, plan: p};
  }, [text]);

  return (
    <>
      {chunks.map((c, i) => (
        <span key={i} className="gc-word" data-lite={plan.lite ? '1' : '0'}
          style={{animationDelay: `${Math.round(delay + i * plan.step)}ms`}}>{c}</span>
      ))}
    </>
  );
};

// How long a chunk of text occupies the reveal timeline, so whatever comes
// after it (a code panel, the next paragraph) starts once it has landed
// rather than on top of it.
const ghostRevealSpan = (text) => {
  const solid = String(text || '').split(/\s+/).filter(Boolean).length;
  const plan  = ghostRevealPlan(solid);
  return Math.min(solid, GC_MAX_SPANS) * plan.step;
};

const GhostCodeBlock = ({code}) => {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(()=>{
          setCopied(true); setTimeout(()=>setCopied(false), 1400);
        });
      }
    } catch (_) {}
  };
  return (
    <div style={{
      position:'relative', margin:'7px 0 3px',
      background:'rgba(0,0,0,0.30)',
      border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:8, overflow:'hidden',
    }}>
      <button onClick={copy} title="Copy code"
        style={{
          position:'absolute', top:6, right:6, zIndex:1,
          padding:'3px 8px', borderRadius:5, cursor:'pointer',
          fontSize:10, fontFamily:'var(--font)',
          background:'rgba(255,255,255,0.07)',
          border:'1px solid rgba(255,255,255,0.12)',
          color: copied ? '#7eb89a' : 'var(--t2)',
          transition:'color 0.15s',
        }}>{copied ? 'Copied' : 'Copy'}</button>
      <pre style={{
        margin:0, padding:'11px 12px', paddingRight:62,
        fontFamily:'var(--mono)', fontSize:11.5, lineHeight:1.62,
        color:'#c6c9da', whiteSpace:'pre', overflowX:'auto',
      }}>{code}</pre>
    </div>
  );
};

const GhostRichText = ({text, reveal = false}) => {
  // Safety release for the reveal: words wait for the bubble's entrance to
  // finish (see ensureGhostRevealStyles). If that never reports — a hidden
  // tab, an interrupted animation — let the text go anyway.
  const rootRef = React.useRef(null);
  React.useEffect(() => {
    if (!reveal) return;
    const id = setTimeout(() => {
      try { if (rootRef.current) rootRef.current.setAttribute('data-gc-go', '1'); } catch (_) {}
    }, 1300);
    return () => clearTimeout(id);
  }, [reveal]);
  const src = String(text || '');
  if (src.indexOf('```') === -1) {
    return (
      <div ref={rootRef} className="b-text" style={{whiteSpace:'pre-wrap'}}>
        {reveal ? <GhostRevealText text={src}/> : src}
      </div>
    );
  }
  const parts = [];
  let last = 0, m;
  GHOST_FENCE_RE.lastIndex = 0;
  while ((m = GHOST_FENCE_RE.exec(src)) !== null) {
    if (m.index > last) parts.push({t:'p', v: src.slice(last, m.index)});
    parts.push({t:'c', v: String(m[1] || '').replace(/\s+$/, '')});
    last = GHOST_FENCE_RE.lastIndex;
  }
  if (last < src.length) parts.push({t:'p', v: src.slice(last)});

  // Each part starts where the previous one finished, so a reply that
  // mixes prose and code unfurls in reading order instead of every block
  // fading up at once.
  let at = 0;
  return (
    <div ref={rootRef} className="b-text">
      {parts.map((p, i) => {
        if (p.t === 'c') {
          if (!p.v) return null;
          const d = at;
          at += 120;   // a code panel is one beat, whatever its length
          return reveal
            ? <div key={i} className="gc-reveal-block" style={{animationDelay:`${Math.round(d)}ms`}}>
                <GhostCodeBlock code={p.v}/>
              </div>
            : <GhostCodeBlock key={i} code={p.v}/>;
        }
        const trimmed = p.v.replace(/^\n+/, '').replace(/\n+$/, '');
        if (!trimmed) return null;
        const d = at;
        at += ghostRevealSpan(trimmed);
        return (
          <div key={i} style={{whiteSpace:'pre-wrap'}}>
            {reveal ? <GhostRevealText text={trimmed} delay={d}/> : trimmed}
          </div>
        );
      })}
    </div>
  );
};

// ── BUBBLE DESIGN SYSTEM ────────────────────────────────────────────
// Every bubble's surface, border, label and entrance, derived from the
// chosen accent. Injected after the page stylesheet so it wins without
// touching BotCommand.html, and installed as soon as this file loads so
// even a thread whose first row is a card (typing, scheduled, confirm)
// is styled from its first frame.
const ensureBubbleParityStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-bubble-parity')) return;
  const st = document.createElement('style');
  st.id = 'bc-bubble-parity';
  st.textContent = `
/* ════════════════════════════════════════════════════════════════
   MESSAGE BUBBLES — one design system for every bubble in the app
   (customer chats, the ghost assistant, scheduled/confirm cards).

   Every colour comes from the chosen accent (--acc) mixed into a quiet
   dark base, so a new accent re-tints the whole thread and nothing is a
   fixed brand colour. Saturation is kept low on purpose: an operator
   reads hundreds of these a day, so the surfaces sit back and the text
   carries the weight.

   Speed: surfaces are flat fills (no gradients, no backdrop blur inside
   threads), one soft two-layer shadow, and every animation moves only
   transform/opacity so the compositor does the work.
   ════════════════════════════════════════════════════════════════ */
:root {
  --bub-o: 94%;                                   /* surface opacity (Glass setting) */
  --bub-base: #1a1b24;
  --bub-in-c:  color-mix(in oklab, var(--acc, #6c63ff) 5%,  var(--bub-base));
  --bub-bot-c: color-mix(in oklab, var(--acc, #6c63ff) 8%,  var(--bub-base));
  --bub-out-c: color-mix(in oklab, var(--acc, #6c63ff) 11%, var(--bub-base));
  --bub-in:  color-mix(in srgb, var(--bub-in-c)  var(--bub-o), transparent);
  --bub-bot: color-mix(in srgb, var(--bub-bot-c) var(--bub-o), transparent);
  --bub-out: color-mix(in srgb, var(--bub-out-c) var(--bub-o), transparent);
  --bub-in-ln:  rgba(255,255,255,0.058);
  --bub-bot-ln: color-mix(in oklab, var(--acc, #6c63ff) 6%,  rgba(255,255,255,0.058));
  --bub-out-ln: color-mix(in oklab, var(--acc, #6c63ff) 8%,  rgba(255,255,255,0.06));
  --bub-in-ln-h:  rgba(255,255,255,0.09);
  --bub-bot-ln-h: color-mix(in oklab, var(--acc, #6c63ff) 10%, rgba(255,255,255,0.085));
  --bub-out-ln-h: color-mix(in oklab, var(--acc, #6c63ff) 13%, rgba(255,255,255,0.09));
  --bub-out-t: color-mix(in oklab, var(--t1, #eeeef5) 97%, var(--acc, #6c63ff));
  --bub-esc-c: #a2586a;                           /* muted wine for human hand-off */
  --bub-shadow: 0 1px 1.5px rgba(0,0,0,0.16), 0 4px 12px -6px rgba(0,0,0,0.34);
  --bub-sheen: inset 0 1px 0 rgba(255,255,255,0.03);
  --bub-ease: cubic-bezier(.16, 1, .3, 1);        /* fast start, long soft landing */
  --bub-acc-soft: color-mix(in oklab, var(--acc, #6c63ff) 58%, #d6d6e4);
}
html[data-glass="clear"] { --bub-o: 82%; }
html[data-glass="solid"] { --bub-o: 100%; }

.bubble {
  padding: 7px 12px 8px;
  font-size: 13px; line-height: 1.5; letter-spacing: -0.003em;
  -webkit-font-smoothing: antialiased;
  transition: background-color .22s ease, border-color .22s ease, opacity .22s ease, box-shadow .22s ease;
}
.bubble .b-text { overflow-wrap: anywhere; }
.bubble ::selection { background: color-mix(in oklab, var(--acc, #6c63ff) 42%, transparent); }

.bubble.b-in, .bubble.b-bot, .bubble.b-out {
  -webkit-backdrop-filter: none; backdrop-filter: none;
  box-shadow: var(--bub-shadow), var(--bub-sheen);
}
.bubble.b-in  { background: var(--bub-in);  border: 1px solid var(--bub-in-ln);  color: var(--t1); }
.bubble.b-bot { background: var(--bub-bot); border: 1px solid var(--bub-bot-ln); color: var(--t1); }
.bubble.b-out { background: var(--bub-out); border: 1px solid var(--bub-out-ln); color: var(--bub-out-t); }
/* Your own and the AI's messages sit flatter: a hairline shadow only, so
   the right-hand column never looks lit up. */
.bubble.b-out, .bubble.b-bot { box-shadow: 0 1px 1.5px rgba(0,0,0,0.14), var(--bub-sheen); }
@media (hover: hover) {
  .bubble.b-in:hover  { border-color: var(--bub-in-ln-h); }
  .bubble.b-bot:hover { border-color: var(--bub-bot-ln-h); }
  .bubble.b-out:hover { border-color: var(--bub-out-ln-h); }
}

/* Human hand-off window: same shape, a muted wine wash. */
.bubble.b-in.b-esc  { background: color-mix(in srgb, color-mix(in oklab, var(--bub-esc-c) 17%, var(--bub-in-c)) var(--bub-o), transparent);
  border-color: color-mix(in oklab, var(--bub-esc-c) 30%, rgba(255,255,255,0.05)); }
.bubble.b-bot.b-esc { background: color-mix(in srgb, color-mix(in oklab, var(--bub-esc-c) 15%, var(--bub-bot-c)) var(--bub-o), transparent);
  border-color: color-mix(in oklab, var(--bub-esc-c) 26%, rgba(255,255,255,0.05)); }
.bubble.b-out.b-esc { background: color-mix(in srgb, color-mix(in oklab, var(--bub-esc-c) 15%, var(--bub-out-c)) var(--bub-o), transparent);
  border-color: color-mix(in oklab, var(--bub-esc-c) 28%, rgba(255,255,255,0.06)); }

/* Sender label — quiet sentence case instead of shouted caps. */
.bubble .b-lbl {
  font-size: 10.5px; font-weight: 600; line-height: 1.35; letter-spacing: 0.004em;
  text-transform: none; margin-bottom: 2px;
  color: color-mix(in oklab, var(--acc, #6c63ff) 45%, var(--t2, #9898b4));
}
.bubble .b-lbl[data-who="you"] { color: color-mix(in oklab, var(--t2, #9898b4) 88%, var(--acc, #6c63ff)); }
.bc-media-lbl { font-size: 10px !important; letter-spacing: 0.01em !important; text-transform: none !important;
  font-weight: 600 !important; border-radius: 7px !important; }
.bc-media-lbl[data-who="ai"] { color: color-mix(in oklab, var(--acc, #6c63ff) 30%, #fff) !important; }
.bc-media-foot { font-size: 13px; }

/* ── Entrance ──
   New messages rise out of their own corner: 280ms, transform + opacity
   only, so it never costs a layout or paint. Reduced motion gets a short
   fade with no movement. */
@keyframes bcb-in  { from { opacity: 0; transform: translate3d(-5px, 7px, 0) scale(.965); } to { opacity: 1; transform: none; } }
@keyframes bcb-out { from { opacity: 0; transform: translate3d(5px, 7px, 0)  scale(.965); } to { opacity: 1; transform: none; } }
@keyframes bcb-fade { from { opacity: 0; } to { opacity: 1; } }
.bubble[data-enter] {
  animation-duration: 280ms; animation-timing-function: var(--bub-ease); animation-fill-mode: both;
}
.bubble[data-enter="in"]  { animation-name: bcb-in;  transform-origin: 0% 100%; }
.bubble[data-enter="out"] { animation-name: bcb-out; transform-origin: 100% 100%; }
html[data-motion="reduced"] .bubble[data-enter] { animation-name: bcb-fade; animation-duration: 140ms; }
/* Shapes: corners glide when a message joins a run (only after a bubble's
   first shaping, so opening a chat never morphs the whole thread). */
.bubble[data-shaped] {
  transition: background-color .22s ease, border-color .22s ease, opacity .22s ease, box-shadow .22s ease,
    border-top-left-radius .26s var(--bub-ease), border-top-right-radius .26s var(--bub-ease),
    border-bottom-left-radius .26s var(--bub-ease), border-bottom-right-radius .26s var(--bub-ease);
}
/* Row spacing is owned by each row (2px inside a run, 10px between runs),
   so the page's blanket gap between rows doesn't loosen a stack. */
.brow[data-side] + .brow[data-side] { margin-top: 0; }
html[data-motion="reduced"] .bubble[data-shaped] { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .bubble[data-shaped] { transition: none; }
  .bubble[data-enter] { animation-name: bcb-fade !important; animation-duration: 140ms; }
  .bubble { transition: none; }
}
`;
  document.head.appendChild(st);
};
try { ensureBubbleParityStyles(); } catch (_) {}

// ── OPERATOR AVATAR ─────────────────────────────────────────────────
// The signed-in operator, on their own manual messages. Same footprint as
// Ava / BotAva; a neutral graphite disc so it never reads as a customer's
// coloured initials or the AI's violet mark. Uses a profile picture when
// the account has one.
const OperatorAva = ({sz=28}) => {
  const acct = (typeof AUTH_STORE !== 'undefined' && AUTH_STORE.account) || {};
  const name = acct.display_name || acct.username || acct.email || 'You';
  const src  = acct.avatar_url || acct.avatar || '';
  const [broken, setBroken] = React.useState(false);
  const initial = String(name).trim().charAt(0).toUpperCase() || 'Y';
  return (
    <div title={`You · ${name}`} aria-label="You" style={{
      width:sz, height:sz, borderRadius:'50%', flexShrink:0, position:'relative', overflow:'hidden',
      display:'flex', alignItems:'center', justifyContent:'center',
      background:'linear-gradient(140deg, rgba(96,102,132,0.62) 0%, rgba(50,54,78,0.82) 100%)',
      border:'1px solid rgba(255,255,255,0.14)',
      boxShadow:'0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.10)',
      color:'rgba(238,240,250,0.95)', fontSize:Math.round(sz*0.4), fontWeight:600, letterSpacing:'-0.01em',
    }}>
      {src && !broken
        ? <img src={src} alt="" onError={()=>setBroken(true)} draggable={false}
            style={{position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover'}}/>
        : initial}
    </div>
  );
};

// ── AVATAR GLIDE ────────────────────────────────────────────────────
// The avatar sits on the LAST bubble of a run. When another message joins
// the run, the avatar used to vanish from the old bubble and pop in on the
// new one. Now it travels: the outgoing avatar records where it was (in
// scroll-content coordinates, so a scroll in the same frame doesn't skew
// it) as React detaches it, and the incoming one — mounted in the same
// commit — animates from that spot to its own with the Web Animations API.
// No state, no re-render, transform only.
const _avatarGlide = new Map();   // `${convId}:${role}` → { y, at }
const GLIDE_WINDOW_MS = 400;
const glideContentY = (el) => {
  const sc = el.closest('.ipc-thread, .cp-thread');
  if (!sc) return null;
  return el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
};
// PERF: measuring on detach forces a synchronous layout of the whole thread,
// and it happens in the middle of React's DOM mutations. On a conversation
// switch every avatar used to detach (the ref callback changed identity with
// the conversation id), so a 300-message chat did hundreds of full layouts
// per switch — the single biggest cost of opening a chat. The callback is
// now stable, and InPageChat holds measurement off for the switch commit,
// where no glide can ever play anyway (history never animates).
const _glideHold = { until: 0 };

// ── SENDER ENERGY ────────────────────────────────────────────────────
// The hop mirrors how fast the sender is going. The gap between the
// message the avatar is leaving and the one it is landing on (the
// sender's own cadence) maps to an energy between 0 (a long, considered
// pause) and 1 (a rapid-fire burst), on a log scale because that is how
// pace is felt: 0.5s vs 1s is a big difference, 20s vs 21s is none.
//
//   energy 1 → a short, snappy hop that lands with a small squash
//   energy 0 → an unhurried glide with no bounce at all
//
// Messages without a usable stamp fall back to how quickly this avatar
// hopped last time, which is the same thing measured on arrival.
const GLIDE_FAST_GAP_MS = 700;      // at or under this: full energy
const GLIDE_SLOW_GAP_MS = 12000;    // at or over this: fully calm
const _glideCadence = new Map();    // glideKey → performance.now() of the last hop
const glideEnergy = (gapMs) => {
  if (!(gapMs > 0) || !isFinite(gapMs)) return 0.5;
  const lo = Math.log(GLIDE_FAST_GAP_MS), hi = Math.log(GLIDE_SLOW_GAP_MS);
  const t = (Math.log(Math.max(1, gapMs)) - lo) / (hi - lo);
  return 1 - Math.min(1, Math.max(0, t));
};

// ── THE HOP, AS A SPRING ─────────────────────────────────────────────
// The first version played a fixed keyframe animation computed once, at
// the moment the new avatar mounted. Three things made that janky:
//
//   • The avatar is position:sticky. A new message usually lands partly
//     below the fold, so at mount time sticky had pushed the avatar up to
//     the viewport edge — and as the thread then scrolled to the new
//     message, sticky let go frame by frame. The offset baked into the
//     keyframes was measured against a target that kept moving, so the
//     avatar drifted, overshot and corrected: a stutter every time.
//   • A burst interrupted a hop mid-flight and the next one started from
//     a standstill — velocity dropped to zero between messages, so a fast
//     sender produced a series of stop-start jerks rather than one motion.
//   • The landing was a separate keyframe segment, so the avatar braked to
//     zero and then bounced: a visible seam in the middle of the move.
//
// Now the hop is a damped spring run per frame. Each frame reads where the
// avatar's real slot is RIGHT NOW (after scroll and sticky) and moves the
// avatar a physical step towards it, so a target that shifts under it is
// simply followed. Velocity is carried from one hop to the next, so a burst
// is one continuous, accelerating motion. The landing is the spring's own
// settle — one curve, no seams. Energy sets the spring: an excited sender
// gets a stiff spring with a small overshoot, a calm one a soft spring
// that eases in with none.
//
// Positions are in the thread's CONTENT coordinates and measured at the
// avatar's centre (the stretch scales around the centre, so the centre is
// where the avatar really is whatever its shape that frame).
const _hopState = new WeakMap();    // avatar el → { x, v, raf, bubble, released }

const hopSpring = (energy) => {
  const e = Math.min(1, Math.max(0, energy));
  // Stiffness on a log scale (felt speed), damping ratio from critically
  // damped (calm, no overshoot) down to 0.76 (a small, lively overshoot).
  const k = Math.exp(Math.log(45) + (Math.log(360) - Math.log(45)) * e);
  const zeta = 1 - 0.24 * e;
  return { k, c: 2 * zeta * Math.sqrt(k), e };
};

const hopCentreY = (el, sc) => {
  const r = el.getBoundingClientRect();
  return (r.top + r.bottom) / 2 - sc.getBoundingClientRect().top + sc.scrollTop;
};

// Hold the new bubble hidden (its entrance paused on its first frame,
// which is fully transparent) until the avatar arrives, then let it in at
// a pace that matches the hop.
const holdBubble = (avatarEl, energy) => {
  const row = avatarEl && avatarEl.closest && avatarEl.closest('.brow');
  const bubble = row && row.querySelector(':scope > .bubble[data-enter]');
  if (!bubble) return null;
  bubble.style.animationDuration = `${Math.round(420 - 160 * Math.min(1, Math.max(0, energy)))}ms`;
  bubble.style.animationPlayState = 'paused';
  return bubble;
};
const releaseBubble = (st) => {
  if (!st || st.released) return;
  st.released = true;
  if (st.bubble) st.bubble.style.animationPlayState = 'running';
  clearTimeout(st.safety);
};

const runAvatarHop = (el, sc, startY, startV, energy) => {
  const prev = _hopState.get(el);
  if (prev) { cancelAnimationFrame(prev.raf); releaseBubble(prev); }
  const sp = hopSpring(energy);
  const target0 = hopCentreY(el, sc);             // measured at rest (no transform yet)
  const dist0 = Math.abs(startY - target0);
  const st = {
    x: startY - target0, v: startV || 0, raf: 0, sc,
    bubble: holdBubble(el, energy), released: false, safety: 0,
    // The bubble comes in as the avatar is arriving: within 8% of the trip
    // or 3px, whichever is larger.
    arriveAt: Math.max(3, dist0 * 0.08),
    last: performance.now(), tx: 0,
    // The slot as measured at mount; the first frame compares against this
    // so a slot that shifted before the first frame is followed too.
    lastTarget: target0,
  };
  st.safety = setTimeout(() => releaseBubble(st), 1400);   // never strand a bubble
  _hopState.set(el, st);

  const apply = () => {
    // Stretch along the direction of travel with speed; zero at rest.
    const s = Math.min(0.055, Math.abs(st.v) / 22000) * (0.4 + 0.6 * sp.e);
    el.style.transform = `translate3d(0, ${st.x.toFixed(2)}px, 0) scale(${(1 - s * 0.6).toFixed(4)}, ${(1 + s).toFixed(4)})`;
    st.tx = st.x;
  };
  apply();                                         // first frame, before paint

  const step = (now) => {
    if (!el.isConnected) { releaseBubble(st); _hopState.delete(el); return; }
    // Where the slot is now: visual centre minus the offset we applied.
    const target = hopCentreY(el, sc) - st.tx;
    // Keep the avatar's VISUAL position continuous if the slot moved
    // (sticky releasing, a row above resizing): re-express it as an offset
    // from the new target. The spring then carries it home from there.
    const visual = st.lastTarget + st.x;
    st.lastTarget = target;
    st.x = visual - target;

    let dt = Math.min(0.05, Math.max(0, (now - st.last) / 1000));
    st.last = now;
    // Fixed small substeps: stable at any frame rate, identical feel on
    // 60Hz and 120Hz displays.
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      const a = -sp.k * st.x - sp.c * st.v;
      st.v += a * h;
      st.x += st.v * h;
      dt -= h;
    }
    if (!st.released && Math.abs(st.x) <= st.arriveAt) releaseBubble(st);
    if (Math.abs(st.x) < 0.25 && Math.abs(st.v) < 6) {
      el.style.transform = '';
      st.tx = 0;
      releaseBubble(st);
      _hopState.delete(el);
      return;
    }
    apply();
    st.raf = requestAnimationFrame(step);
  };
  st.raf = requestAnimationFrame(step);
};

const useAvatarGlide = (glideKey, enabled, msgTs) => {
  const nodeRef = React.useRef(null);
  const keyRef  = React.useRef(glideKey);
  keyRef.current = glideKey;
  const tsRef = React.useRef(msgTs);
  tsRef.current = msgTs;
  const setRef = React.useCallback((el) => {
    if (el) { nodeRef.current = el; return; }
    const old = nodeRef.current;
    nodeRef.current = null;
    if (!old) return;
    // Whatever this avatar was doing, it's leaving: stop its spring and let
    // its bubble in (the avatar has moved on to the next one).
    const st = _hopState.get(old);
    if (st) { cancelAnimationFrame(st.raf); releaseBubble(st); _hopState.delete(old); }
    const key = keyRef.current;
    // Detach runs before React removes the node, so it can still be measured.
    if (!old.isConnected || !key) return;
    if (performance.now() < _glideHold.until) return;
    const sc = old.closest('.ipc-thread, .cp-thread');
    if (!sc) return;
    // The visual centre — mid-hop included — and the speed it's moving at,
    // so the next hop picks the motion up instead of restarting it.
    const y = hopCentreY(old, sc);
    _avatarGlide.set(key, { y, v: st ? st.v : 0, at: performance.now(), ts: Number(tsRef.current) || 0 });
  }, []);
  React.useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!el || !enabled || !glideKey) return;
    const rec = _avatarGlide.get(glideKey);
    _avatarGlide.delete(glideKey);
    if (!rec || performance.now() - rec.at > GLIDE_WINDOW_MS) return;
    const sc = el.closest('.ipc-thread, .cp-thread');
    if (!sc) return;
    const y = hopCentreY(el, sc);
    const dy = rec.y - y;
    if (dy > -2 || dy < -900) return;            // only a real downward hop
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The sender's pace: stamp to stamp when both messages carry one,
    // otherwise the time since this avatar last hopped.
    const now = performance.now();
    const cur = Number(msgTs) || 0;
    let gap = (cur && rec.ts && cur > rec.ts) ? cur - rec.ts : 0;
    if (!gap) {
      const prevHop = _glideCadence.get(glideKey);
      gap = prevHop ? now - prevHop : 0;
    }
    _glideCadence.set(glideKey, now);
    runAvatarHop(el, sc, rec.y, rec.v, glideEnergy(gap));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Unmounting mid-hop (conversation switch) must not leave a loop running.
  React.useEffect(() => () => {
    const el = nodeRef.current;
    const st = el && _hopState.get(el);
    if (st) { cancelAnimationFrame(st.raf); releaseBubble(st); }
  }, []);
  return setRef;
};

// The avatar column beside a bubble. position:sticky keeps the avatar in
// view while a tall bubble scrolls past; the glide rides on the same node.
const AvatarRail = ({sz, glideKey, glide, ts, children}) => {
  const setRef = useAvatarGlide(glideKey, glide, ts);
  return (
    <div style={{
      width: sz, flexShrink: 0, alignSelf: 'stretch',
      display: 'flex', alignItems: 'flex-end', position: 'relative',
    }}>
      <div ref={setRef} style={{ position:'sticky', bottom: 12, width: sz, height: sz, willChange: 'transform' }}>
        {children}
      </div>
    </div>
  );
};

// ── THE HOVER TIMESTAMP ──────────────────────────────────────────────
// ONE label per thread, not one per bubble.
//
// The previous version kept a hidden label inside every bubble and tried to
// fake continuity by handing off between them: the old label snapped out,
// the new one started where the old had been and slid home. It only
// worked if the pointer crossed the gap between two bubbles fast enough —
// the handoff window was 280ms. Move slowly and the window lapsed: the old
// label faded out (and slid to its bubble's centre while fading, which read
// as it "flying away"), and a new one faded up somewhere else. Two
// labels, two animations, one seam. Two separate animation systems
// (a CSS transition on `top`, a WAAPI transform) also fought each other
// whenever the pointer moved during a hop, which was the jitter.
//
// Now there is a single floating label that lives in the thread and
// travels. Hovering a bubble points it at that bubble's timestamp slot and
// a spring carries it there — velocity preserved when you sweep across
// several bubbles, so it flows rather than stepping. Its text rolls to the
// new time in the direction of travel. It doesn't disappear when the
// pointer is between bubbles or over a separator: it waits on the last
// bubble for a moment, and only fades (in place, no movement) if the
// pointer settles somewhere that isn't a message, or leaves the thread.
//
// It sits inside the thread's content, so it scrolls with the bubbles, and
// everything here is transform/opacity on one element — no React renders.
const TS_FLOAT_GRACE_MS = 1100;     // pointer between/away from bubbles
const TS_FLOAT_EXIT_MS  = 140;      // pointer left the thread entirely
const TS_FLOAT_K        = 430;      // spring stiffness
const TS_FLOAT_ZETA     = 0.9;      // just under critical: settles with no visible wobble
// Side switch (incoming ↔ outgoing): fade out where it is, jump while
// invisible, fade in on the new side. The jump waits a little longer than
// the fade so the label is guaranteed to be fully transparent — timers and
// frames don't line up exactly, and a jump a frame early is visible.
const TS_FLOAT_SWAP_FADE_MS = 90;
const TS_FLOAT_SWAP_JUMP_MS = 120;

const tsReduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const ensureTsFloatStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-ts-float-style')) return;
  const st = document.createElement('style');
  st.id = 'bc-ts-float-style';
  st.textContent = `
.bc-ts-float { position: absolute; left: 0; top: 0; z-index: 3; pointer-events: none; user-select: none;
  opacity: 0; will-change: transform, opacity; transition: opacity 170ms ease; }
.bc-ts-float[data-shown="1"] { opacity: 1; }
.bc-ts-float[data-swap="1"] { transition: opacity ${TS_FLOAT_SWAP_FADE_MS}ms ease; opacity: 0; }
.bc-ts-float-in { position: relative; display: inline-block; white-space: nowrap;
  font-size: 9.5px; font-family: var(--mono); color: var(--t3); letter-spacing: 0.03em; line-height: 1; }
.bc-ts-float[data-side="in"]  .bc-ts-float-in { transform: translate(-100%, -50%); }
.bc-ts-float[data-side="out"] .bc-ts-float-in { transform: translate(0, -50%); }
.bc-ts-float-txt { display: inline-block; }
.bc-ts-float-ghost { position: absolute; top: 0; display: inline-block; white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .bc-ts-float, .bc-ts-float[data-swap="1"] { transition: none; } }`;
  document.head.appendChild(st);
};

const _tsF = {
  el: null, inner: null, txt: null, body: null,
  cur: null,                  // { bubble, side, sz, ts, t, py }
  x: 0, y: 0, vx: 0, vy: 0, raf: 0, last: 0,
  shown: false, side: '', text: '',
  hideT: 0, tickT: 0, swapT: 0, parkT: 0,
};
const _tsScrollers = new WeakSet();

const tsFloatEnsure = (body) => {
  const f = _tsF;
  if (f.el && f.el.isConnected && f.body === body) return true;
  if (!body) return false;
  ensureTsFloatStyles();
  if (f.el && f.el.parentNode) f.el.parentNode.removeChild(f.el);
  const el = document.createElement('div');
  el.className = 'bc-ts-float';
  el.setAttribute('aria-hidden', 'true');
  const inner = document.createElement('span');
  inner.className = 'bc-ts-float-in';
  const txt = document.createElement('span');
  txt.className = 'bc-ts-float-txt';
  inner.appendChild(txt);
  el.appendChild(inner);
  try { if (getComputedStyle(body).position === 'static') body.style.position = 'relative'; } catch (_) {}
  body.appendChild(el);
  Object.assign(f, { el, inner, txt, body, shown: false, side: '', text: '', vx: 0, vy: 0 });
  // Leaving the whole thread hides it promptly.
  const sc = body.closest('.ipc-thread, .cp-thread') || body.parentElement;
  if (sc && !_tsScrollers.has(sc)) {
    _tsScrollers.add(sc);
    sc.addEventListener('mouseleave', () => {
      if (_tsF.body && sc.contains(_tsF.body)) tsFloatScheduleHide(TS_FLOAT_EXIT_MS);
    });
  }
  return true;
};

// Where the label belongs for the current bubble, in the thread body's
// coordinates. Same slot the old per-bubble label used: past the avatar
// rail on the far side of the bubble, centred on short bubbles and
// following the pointer on tall ones.
const tsFloatTarget = () => {
  const f = _tsF, c = f.cur;
  if (!c || !c.bubble || !c.bubble.isConnected || !f.body) return null;
  const br = f.body.getBoundingClientRect();
  const r = c.bubble.getBoundingClientRect();
  const gap = (c.sz || 28) + 18;
  const x = c.side === 'in' ? (r.left - br.left - gap) : (r.right - br.left + gap);
  let yIn = r.height / 2;
  if (r.height > SHORT_BUBBLE_PX && c.py != null) {
    yIn = Math.max(10, Math.min(r.height - 10, c.py - r.top));
  }
  return { x, y: r.top - br.top + yIn };
};

const tsFloatApply = () => {
  const f = _tsF;
  if (f.el) f.el.style.transform = `translate3d(${f.x.toFixed(2)}px, ${f.y.toFixed(2)}px, 0)`;
};

const tsFloatSnap = () => {
  const f = _tsF, t = tsFloatTarget();
  if (!t) return;
  f.x = t.x; f.y = t.y; f.vx = 0; f.vy = 0;
  cancelAnimationFrame(f.raf); f.raf = 0;
  tsFloatApply();
};

const tsFloatKick = () => {
  const f = _tsF;
  if (f.raf) return;
  if (tsReduceMotion()) { tsFloatSnap(); return; }
  f.last = performance.now();
  const step = (now) => {
    f.raf = 0;
    const t = tsFloatTarget();
    if (!t) return;
    let dt = Math.min(0.05, Math.max(0, (now - f.last) / 1000));
    f.last = now;
    const c = 2 * TS_FLOAT_ZETA * Math.sqrt(TS_FLOAT_K);
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      f.vx += (-TS_FLOAT_K * (f.x - t.x) - c * f.vx) * h;
      f.vy += (-TS_FLOAT_K * (f.y - t.y) - c * f.vy) * h;
      f.x += f.vx * h; f.y += f.vy * h;
      dt -= h;
    }
    if (Math.abs(f.x - t.x) < 0.2 && Math.abs(f.y - t.y) < 0.2 && Math.abs(f.vx) < 4 && Math.abs(f.vy) < 4) {
      f.x = t.x; f.y = t.y; f.vx = 0; f.vy = 0;
      tsFloatApply();
      return;
    }
    tsFloatApply();
    f.raf = requestAnimationFrame(step);
  };
  f.raf = requestAnimationFrame(step);
};

const tsFloatSetSide = (side) => {
  const f = _tsF;
  if (f.side === side) return;
  f.side = side;
  f.el.setAttribute('data-side', side);
};

// Roll the text to a new value. dir > 0: the label is moving down, so the
// old time lifts away and the new one rises into place (and vice versa).
const tsFloatSetText = (text, dir) => {
  const f = _tsF;
  if (!f.txt || text === f.text) return;
  const prev = f.text;
  f.text = text;
  f.inner.querySelectorAll('.bc-ts-float-ghost').forEach(g => g.remove());
  try { f.txt.getAnimations().forEach(a => a.cancel()); } catch (_) {}
  if (!dir || !prev || tsReduceMotion() || typeof f.txt.animate !== 'function') {
    f.txt.textContent = text;
    return;
  }
  const ghost = document.createElement('span');
  ghost.className = 'bc-ts-float-ghost';
  ghost.textContent = prev;
  ghost.style[f.side === 'in' ? 'right' : 'left'] = '0';
  f.inner.appendChild(ghost);
  f.txt.textContent = text;
  const d = dir > 0 ? 1 : -1;
  const out = ghost.animate([
    { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
    { opacity: 0, transform: `translateY(${-4 * d}px)`, filter: 'blur(1.2px)' },
  ], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  out.onfinish = () => ghost.remove();
  out.oncancel = () => ghost.remove();
  f.txt.animate([
    { opacity: 0, transform: `translateY(${4 * d}px)`, filter: 'blur(1.2px)' },
    { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
  ], { duration: 240, delay: 50, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
};

const tsFloatShow = () => {
  const f = _tsF;
  clearTimeout(f.parkT); f.parkT = 0;
  f.shown = true;
  void f.el.offsetWidth;      // commit the snapped position before the fade starts
  f.el.setAttribute('data-shown', '1');
  // Keep "5m ago" honest while it's up, and notice if its bubble went away.
  if (!f.tickT) {
    f.tickT = setInterval(() => {
      const c = _tsF.cur;
      if (!c || !c.bubble || !c.bubble.isConnected) { tsFloatHide(); return; }
      if (_tsF.swapT) return;  // mid side-switch: it's parked until the jump
      tsFloatSetText(fmtMsgAgo(c.ts, c.t), 0);
      tsFloatKick();          // layout above may have shifted
    }, 1000);
  }
};

// ── PARKING ───────────────────────────────────────────────────────────
// THE BLANK-CHAT BUG. The label is an absolutely positioned child of the
// thread body, moved with a transform — and a transformed element still
// counts towards its scroller's scrollable area even at opacity 0. Hiding
// it used to leave it wherever it was last shown. Hover a message two
// thousand pixels down a long chat, open a short one (the thread body is
// the same DOM node, reused), and the invisible label was still sitting
// two thousand pixels down: the short chat's scrollHeight stretched to
// reach it, the entry pin scrolled to that "bottom", and the operator saw
// an empty pane with their messages somewhere above. The same happened
// inside one chat whenever the thread got shorter under a stale label.
//
// Once it has faded out, the label is moved back to the top-left corner
// of the body, where it can't stretch anything. A conversation switch
// parks it immediately, before the new chat is measured.
const TS_FLOAT_PARK_MS = 200;   // just past the 170ms fade-out
const tsFloatPark = () => {
  const f = _tsF;
  clearTimeout(f.parkT); f.parkT = 0;
  if (f.shown) return;          // shown again in the meantime — leave it be
  cancelAnimationFrame(f.raf); f.raf = 0;
  f.x = 0; f.y = 0; f.vx = 0; f.vy = 0;
  if (f.el) f.el.style.transform = 'translate3d(0px, 0px, 0)';
};

const tsFloatHide = () => {
  const f = _tsF;
  clearTimeout(f.hideT); f.hideT = 0;
  clearTimeout(f.swapT); f.swapT = 0;
  clearInterval(f.tickT); f.tickT = 0;
  cancelAnimationFrame(f.raf); f.raf = 0;
  f.shown = false;
  f.cur = null;
  if (f.el) { f.el.removeAttribute('data-shown'); f.el.removeAttribute('data-swap'); }
  clearTimeout(f.parkT);
  f.parkT = setTimeout(tsFloatPark, TS_FLOAT_PARK_MS);
};

// Hide and park in one step, with no fade — for a conversation switch,
// where the label must be out of the way before the new thread is laid out.
const tsFloatParkNow = () => {
  if (_tsTip.bubble) tsTipHide(true);
  const f = _tsF;
  if (!f.el) return;
  const el = f.el;
  el.style.transition = 'none';
  tsFloatHide();
  tsFloatPark();
  void el.offsetWidth;          // commit the jump with the fade switched off
  el.style.transition = '';
};

const tsFloatScheduleHide = (ms) => {
  const f = _tsF;
  clearTimeout(f.hideT);
  f.hideT = setTimeout(tsFloatHide, ms);
};

// ── TIMESTAMP TOOLTIP (narrow chats) ─────────────────────────────────
// The floating label lives in the margin past the avatar rail. When the
// chat is narrow that margin has no room for it (16px in the one-pane
// layout), and the label was cut off at the chat's edge. For a bubble whose
// label doesn't fit, the time is shown as a small tooltip at the pointer
// instead; everywhere else the label behaves exactly as before.
const TS_TIP_DELAY_MS = 220;
const _tsTip = { el: null, bubble: null, shown: false, showT: 0, hideT: 0, text: '' };
let _tsMeasureCtx = null, _tsFont = '';
const tsTextWidth = (text) => {
  try {
    if (!_tsMeasureCtx) _tsMeasureCtx = document.createElement('canvas').getContext('2d');
    if (!_tsFont) {
      const probe = _tsF.txt;
      _tsFont = `9.5px ${probe ? getComputedStyle(probe).fontFamily : 'monospace'}`;
    }
    _tsMeasureCtx.font = _tsFont;
    // + letter-spacing (0.03em per glyph) and a pixel of slack.
    return Math.ceil(_tsMeasureCtx.measureText(text).width + text.length * 9.5 * 0.03) + 1;
  } catch (_) { return text.length * 6.2; }
};
// Does this bubble's label fit in its margin, inside the chat's visible edge?
const tsOuterFits = (bubble, side, sz, text) => {
  const body = _tsF.body;
  const sc = body && body.closest('.ipc-thread, .cp-thread');
  if (!sc || !bubble) return true;
  const sr = sc.getBoundingClientRect();
  const r = bubble.getBoundingClientRect();
  const lw = tsTextWidth(text);
  const gap = (sz || 28) + 18;
  return side === 'in' ? (r.left - gap - lw >= sr.left + 2) : (r.right + gap + lw <= sr.right - 2);
};
const ensureTsTipStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-ts-tip-style')) return;
  const st = document.createElement('style');
  st.id = 'bc-ts-tip-style';
  st.textContent = `
.bc-ts-tip { position: fixed; left: 0; top: 0; z-index: 9990; pointer-events: none; user-select: none;
  padding: 5px 8px; border-radius: 7px; white-space: nowrap;
  font-size: 10px; font-family: var(--mono); letter-spacing: 0.03em; line-height: 1; color: var(--t2);
  background: rgba(16,17,28,0.96); border: 0.5px solid rgba(255,255,255,0.10);
  box-shadow: 0 6px 18px rgba(0,0,0,0.38);
  opacity: 0; transition: opacity 120ms ease; will-change: transform, opacity; }
.bc-ts-tip[data-shown="1"] { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .bc-ts-tip { transition: none; } }`;
  document.head.appendChild(st);
};
const tsTipPlace = (cx, cy) => {
  const t = _tsTip;
  if (!t.el) return;
  let vw = window.innerWidth, vh = window.innerHeight;
  try {
    if (window.BC_LIVE_RESIZE && window.BC_LIVE_RESIZE.viewport) {
      const vp = window.BC_LIVE_RESIZE.viewport(); vw = vp.w; vh = vp.h;
    }
  } catch (_) {}
  const w = t.el.offsetWidth || 0, h = t.el.offsetHeight || 0;
  // Centred above the pointer, kept on screen; below it near the top.
  const x = Math.max(6, Math.min(vw - w - 6, cx - w / 2));
  let y = cy - h - 12;
  if (y < 6) y = Math.min(vh - h - 6, cy + 20);
  t.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
};
const tsTipShow = (bubble, text, cx, cy) => {
  const t = _tsTip;
  ensureTsTipStyles();
  if (!t.el || !t.el.isConnected) {
    const el = document.createElement('div');
    el.className = 'bc-ts-tip';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    t.el = el; t.shown = false;
  }
  clearTimeout(t.hideT); t.hideT = 0;
  t.bubble = bubble;
  if (t.text !== text) { t.text = text; t.el.textContent = text; }
  tsTipPlace(cx, cy);
  if (t.shown) return;              // moving between bubbles: stays up
  clearTimeout(t.showT);
  t.showT = setTimeout(() => {
    t.showT = 0;
    if (!t.bubble) return;
    t.shown = true;
    t.el.setAttribute('data-shown', '1');
  }, TS_TIP_DELAY_MS);
};
const tsTipHide = (now) => {
  const t = _tsTip;
  clearTimeout(t.showT); t.showT = 0;
  clearTimeout(t.hideT); t.hideT = 0;
  const off = () => {
    t.hideT = 0; t.bubble = null; t.shown = false;
    if (t.el) t.el.removeAttribute('data-shown');
  };
  // A short grace, so crossing the gap to the next bubble doesn't blink.
  if (now) off(); else t.hideT = setTimeout(off, 90);
};

// Row handlers.
const tsFloatEnter = (bubble, info, clientY, clientX) => {
  if (!bubble) return;
  const row = bubble.closest('.brow');
  const body = row && row.parentElement;
  if (!tsFloatEnsure(body)) return;
  const f = _tsF;
  const text = fmtMsgAgo(info.ts, info.t);
  // No room in the margin: tooltip at the pointer instead of the label.
  if (!tsOuterFits(bubble, info.side, info.sz, text)) {
    if (f.shown || f.cur) tsFloatHide();
    tsTipShow(bubble, text, clientX == null ? 0 : clientX, clientY);
    return;
  }
  if (_tsTip.bubble) tsTipHide(true);
  clearTimeout(f.hideT); f.hideT = 0;
  const same = f.cur && f.cur.bubble === bubble;
  f.cur = { bubble, side: info.side, sz: info.sz, ts: info.ts, t: info.t, py: clientY };

  // Fresh appearance: put it in place first, then fade it up — nothing
  // should travel in from wherever it was last seen.
  if (!f.shown) {
    clearTimeout(f.swapT); f.swapT = 0;
    f.el.removeAttribute('data-swap');
    tsFloatSetSide(info.side);
    tsFloatSetText(text, 0);
    tsFloatSnap();
    tsFloatShow();
    return;
  }
  if (same) { if (!f.swapT) tsFloatKick(); return; }

  // Across to the other side of the chat: a hop across the whole column
  // would be a lot of motion for no information. A quick dip instead.
  //
  // THE FLY-ACROSS. f.cur already points at the new bubble here, and the
  // spring reads its target from f.cur on every frame. So if the spring
  // was still running when the swap began (it usually is — the pointer was
  // just moving along the old side), it kept going, now aimed at a slot on
  // the far side of the chat, and dragged the label across the thread
  // during the fade-out. Stopping it dead where it is means the fade-out
  // happens in place and the only movement is the invisible jump.
  if (f.side !== info.side || f.swapT) {
    cancelAnimationFrame(f.raf); f.raf = 0;
    f.vx = 0; f.vy = 0;
    tsFloatApply();
    f.el.setAttribute('data-swap', '1');
    clearTimeout(f.swapT);
    f.swapT = setTimeout(() => {
      f.swapT = 0;
      if (!f.cur) return;
      tsFloatSetSide(f.cur.side);
      tsFloatSetText(fmtMsgAgo(f.cur.ts, f.cur.t), 0);
      tsFloatSnap();
      void f.el.offsetWidth;   // commit the jump while still transparent
      f.el.removeAttribute('data-swap');
    }, TS_FLOAT_SWAP_JUMP_MS);
    return;
  }

  // Same side: travel, rolling the text in the direction of travel.
  const t = tsFloatTarget();
  tsFloatSetText(text, t ? t.y - f.y : 0);
  tsFloatKick();
};

const tsFloatMove = (bubble, clientY, clientX) => {
  if (_tsTip.bubble === bubble) { if (clientX != null) tsTipPlace(clientX, clientY); return; }
  const f = _tsF;
  if (!f.cur || f.cur.bubble !== bubble) return;
  f.cur.py = clientY;
  if (f.shown && !f.swapT) tsFloatKick();
};

const tsFloatLeave = (bubble) => {
  if (_tsTip.bubble === bubble) tsTipHide(false);
  const f = _tsF;
  if (!f.cur || f.cur.bubble !== bubble) return;
  // Stay on this bubble for a moment: the pointer is usually on its way
  // to the next one, and slow is allowed.
  tsFloatScheduleHide(TS_FLOAT_GRACE_MS);
};

// ── CONTEXTUAL BUBBLE SHAPES ────────────────────────────────────────────
// Bubbles are not one fixed shape. A run of messages from the same sender
// (close together in time, nothing drawn between them) is shaped as one
// stack:
//
//   • Sender side — the side the avatar is on — joins: tight corners
//     between stacked bubbles, a full round corner only at the top of the
//     run, and a small "tail" corner on the last one next to the avatar.
//   • Far side — adapts to the neighbours' widths. Bubbles whose widths
//     are within a few pixels are snapped to the same width, so they read
//     as a clean column instead of a ragged edge. Where one is wider, the
//     corner that is covered by its neighbour tucks in and the corner that
//     sticks out rounds in proportion to how far it sticks out — a 6px
//     step gets a 6px curve, a long overhang a full one.
//
// React draws the sender side (it knows the grouping). The far side needs
// real widths, so one pass per thread measures after layout and writes two
// CSS variables per bubble. The pass is one batched read then one batched
// write, runs before paint (so a new message never shows a wrong shape for
// a frame), and only re-runs when rows are added/removed or change size.
const BUB_R    = 18;           // full corner
const BUB_J    = 5;            // joined corner (stacked / tail)
const BUB_SNAP = 14;           // widths this close become one column
const BUB_GROUP_GAP_MS = 4 * 60 * 1000;   // a longer pause starts a new run

const _bubTs = (v) => (typeof v === 'number' ? v : (v ? (Date.parse(v) || 0) : 0));
// Do two consecutive thread rows belong to the same run?
const bcBubblesJoin = (a, b) => {
  if (!a || !b || a.r !== b.r) return false;
  if (a.r === 'bot' && String(a.agent || '') !== String(b.agent || '')) return false;
  const ta = _bubTs(a.ts), tb = _bubTs(b.ts);
  if (ta && tb && Math.abs(tb - ta) > BUB_GROUP_GAP_MS) return false;
  return true;
};

const _bubClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const bcShapeThread = (root) => {
  if (!root) return;
  const rows = root.querySelectorAll('.brow[data-side]');
  if (!rows.length) return;
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const bub = row.querySelector('.bubble');
    if (!bub) continue;
    items.push({ row, bub, start: row.getAttribute('data-gs') === '1',
      edge: row.getAttribute('data-edge') === '1', w: 0, snap: 0, ft: BUB_R, fb: BUB_R });
  }
  // 1) Clear previous snaps (writes only).
  for (const it of items) if (it.bub.style.minWidth) it.bub.style.minWidth = '';
  // 2) Read every natural width in one layout.
  for (const it of items) it.w = it.edge ? 0 : it.bub.offsetWidth;
  // 3) Walk runs.
  let g = [];
  const flush = () => {
    if (!g.length) return;
    // Snap near-equal neighbours into one column (range-limited so a slow
    // drift of widths can't chain into one oversized block).
    let c = [];
    const closeCluster = () => {
      if (c.length > 1) {
        const mx = Math.max(...c.map(x => x.w));
        c.forEach(x => { if (mx - x.w >= 1) x.snap = mx; x.w = mx; });
      }
      c = [];
    };
    for (const it of g) {
      if (it.edge) { closeCluster(); continue; }
      if (c.length) {
        const lo = Math.min(it.w, ...c.map(x => x.w)), hi = Math.max(it.w, ...c.map(x => x.w));
        if (hi - lo > BUB_SNAP) closeCluster();
      }
      c.push(it);
    }
    closeCluster();
    // Fit the far-side corners to each neighbour.
    for (let k = 0; k + 1 < g.length; k++) {
      const a = g[k], b = g[k + 1];
      if (a.edge || b.edge) continue;
      const over = Math.abs(b.w - a.w);
      if (over < 1) { a.fb = BUB_J; b.ft = BUB_J; continue; }
      const exposed = _bubClamp(over, BUB_J, BUB_R);
      // The narrower bubble's corner sits over its neighbour. Near-aligned
      // edges tuck it in so the two read as one block; once the step is
      // clearly a step it stays round (tucking there makes short bubbles
      // look boxy).
      const tucked = over <= BUB_R ? BUB_J : BUB_R;
      if (b.w > a.w) { a.fb = Math.min(a.fb, tucked); b.ft = exposed; }
      else           { b.ft = tucked; a.fb = Math.min(a.fb, exposed); }
    }
    g = [];
  };
  for (const it of items) { if (it.start) flush(); g.push(it); }
  flush();
  // 4) Write (no reads from here on).
  for (const it of items) {
    const s = it.bub.style;
    if (it.edge) { s.removeProperty('--bf-t'); s.removeProperty('--bf-b'); continue; }
    if (it.snap) s.minWidth = it.snap + 'px';
    const ft = Math.round(it.ft) + 'px', fb = Math.round(it.fb) + 'px';
    if (s.getPropertyValue('--bf-t') !== ft) s.setProperty('--bf-t', ft);
    if (s.getPropertyValue('--bf-b') !== fb) s.setProperty('--bf-b', fb);
    // Corners animate only once a bubble has been shaped, so opening a chat
    // doesn't morph every bubble — but a message joining a run smoothly
    // reshapes the one above it.
    if (!it.bub.hasAttribute('data-shaped')) {
      const b = it.bub;
      requestAnimationFrame(() => requestAnimationFrame(() => b.setAttribute('data-shaped', '1')));
    }
  }
};

// Keeps a thread's shapes right: rows arriving/leaving, a row whose content
// changed (edit, late media), pictures finishing loading, and the chat
// column resizing. Everything funnels into one pass per frame at most.
const useBubbleShaper = (threadRef, key) => {
  React.useLayoutEffect(() => {
    const root = threadRef.current;
    if (!root) return;
    let raf = 0;
    const runNow = () => { cancelAnimationFrame(raf); raf = 0; try { bcShapeThread(root); } catch (_) {} };
    const runSoon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; try { bcShapeThread(root); } catch (_) {} }); };
    runNow();
    const touchesRows = (nodes) => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.nodeType !== 1) continue;
        if (n.classList.contains('brow') || n.querySelector('.brow[data-side]')) return true;
      }
      return false;
    };
    let mo = null, ro = null;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver((list) => {
        for (const m of list) {
          // Runs before paint, so a new or reshaped row never shows a
          // stale shape for a frame.
          if (m.type === 'attributes' || touchesRows(m.addedNodes) || touchesRows(m.removedNodes)) { runNow(); return; }
        }
      });
      mo.observe(root, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['data-gs', 'data-ge', 'data-sk', 'data-edge'] });
    }
    // Column size class for the bubble widths (see .ipc-thread[data-col]
    // in BotCommand.html). Taken from the column itself, which is what
    // the bubbles sit in; the window's width says little about it (one-pane
    // mode, a wide contact list, and the oversized window drag, during
    // which the viewport is the size of the monitor).
    const colEl = root.querySelector(':scope > .ipc-body');
    const sizeCol = () => {
      if (!colEl) return false;
      const cw = colEl.clientWidth;
      if (!cw) return false;
      const size = cw < 440 ? 'sm' : cw < 600 ? 'md' : 'lg';
      if (root.getAttribute('data-col') === size) return false;
      root.setAttribute('data-col', size);
      return true;
    };
    if (sizeCol()) runNow();
    // Watch the message COLUMN, not the scroller around it. The column is
    // what the bubbles are laid out in, and while a window edge or the
    // contact panel is being dragged it is held at a fixed width
    // (CHAT_PANEL_MOTION) — watching the scroller re-shaped every bubble on
    // every step of the drag for a column that hadn't changed.
    if (typeof ResizeObserver !== 'undefined') {
      const col = colEl || root;
      let lastW = col.clientWidth;
      ro = new ResizeObserver(() => {
        const w = col.clientWidth;
        if (w !== lastW) { lastW = w; sizeCol(); runSoon(); }
      });
      ro.observe(col);
    }
    const onLoad = (e) => { const t = e.target; if (t && (t.tagName === 'IMG' || t.tagName === 'VIDEO')) runSoon(); };
    root.addEventListener('load', onLoad, true);
    root.addEventListener('loadedmetadata', onLoad, true);
    // After a drag settles, once: a row can change without the column's
    // width changing.
    const onSettle = (e) => {
      if (e && e.type === 'bc:live-resize' && e.detail && e.detail.active) return;
      runSoon();
    };
    window.addEventListener('bc:live-resize', onSettle);
    window.addEventListener('bcw:panel-resize-end', onSettle);
    return () => {
      cancelAnimationFrame(raf);
      if (mo) mo.disconnect();
      if (ro) ro.disconnect();
      root.removeEventListener('load', onLoad, true);
      root.removeEventListener('loadedmetadata', onLoad, true);
      window.removeEventListener('bc:live-resize', onSettle);
      window.removeEventListener('bcw:panel-resize-end', onSettle);
    };
  }, [threadRef, key]);
};

// hideYou: leave off the "You" label on your own bubbles. It only exists
// to tell your messages from an agent's, so a direct chat with no agent
// on it doesn't need it.
const ChatBubbleRowImpl = ({m, msg, sz=28, style={}, isGroupStart=true, isGroupEnd=true, avatarNode=null, rich=false, reveal=false, enter=null, ti, hideYou=false}) => {
  const bubbleRef = React.useRef(null);

  ensureBubbleParityStyles();
  ensureMsgLifecycleStyles();
  const isIn  = m.r === 'in';
  const isBot = m.r === 'bot';
  const isOut = !isIn && !isBot;           // typed by the operator
  const glideKey = `${(msg && msg.id) || ''}:${m.r}`;

  // ── MEDIA LAYOUT ─────────────────────────────────────────────────────
  const mediaKind = mediaKindOf(m && m.mt, m && m.mu);
  // Rows saved before the host started sending real attachments still carry
  // the "[Photo]" label the host prepends. Now that the picture itself is
  // there, the label is a caption repeating what the reader can already see,
  // so it comes off at render time too — not just for newly arriving
  // messages. Guarded on typeof because the pattern lives in bot-stores.
  let bodyText = m.c || '';
  if (mediaKind && bodyText && typeof MEDIA_LABEL_RE !== 'undefined') {
    bodyText = bodyText.replace(MEDIA_LABEL_RE, '').trim();
  }
  // Pictures always go edge-to-edge — with a caption it's laid on the image
  // (see ImageCard), and the sender label becomes a small chip on the
  // picture instead of a strip of padding above it. Uncaptioned video goes
  // edge-to-edge too; an audio player or a file chip keeps the padding.
  // A reply quote needs the bubble's padding above the picture, so a quoted
  // picture is drawn as a padded image rather than the edge-to-edge card.
  const imageCard = mediaKind === 'image' && !rich && !m.rq;
  // A YouTube attachment carries its caption in its own footer.
  const ytCard = mediaKind === 'youtube';
  if (ytCard && bodyText) bodyText = bodyText.replace(BC_YT_RE, '').trim();
  // A plain text message with a YouTube link gets the player card. Like a
  // picture, the player fills the bubble edge to edge and the words sit
  // under it in the card's footer. A quoted one keeps the bubble's padding
  // (the quote sits above it) and draws the player inset below the text.
  const ytInText = !mediaKind && !rich && !m.del ? bcYouTubeUrlIn(bodyText) : '';
  const ytEdge = !!ytInText && !m.rq;
  const mediaEdge = imageCard || (mediaKind === 'video' && !bodyText) || (ytCard && !m.rq) || ytEdge;
  // A document (or one still downloading / unavailable) is drawn as a file
  // card that fills the bubble, so the bubble drops to a thin frame around
  // it instead of wrapping a second box in its own padding.
  const fileBubble = !m.rq && (mediaKind === 'document' || mediaKind === 'link'
    || (!mediaKind && !!(m.mt && (m.mp || m.me || m.mn))));
  // Sender side is drawn here from the grouping; the far side is fitted to
  // the neighbours by bcShapeThread (see CONTEXTUAL BUBBLE SHAPES) through
  // --bf-t / --bf-b. `radius` stays numeric for edge-to-edge media, which
  // the shaper leaves at the full corner.
  const radius = isIn
    ? { tl: isGroupStart ? BUB_R : BUB_J, tr: BUB_R, br: BUB_R, bl: BUB_J }
    : { tl: BUB_R, tr: isGroupStart ? BUB_R : BUB_J, br: BUB_J, bl: BUB_R };
  const farT = mediaEdge ? `${BUB_R}px` : `var(--bf-t, ${BUB_R}px)`;
  const farB = mediaEdge ? `${BUB_R}px` : `var(--bf-b, ${BUB_R}px)`;
  const bubCorners = isIn
    ? { borderTopLeftRadius: radius.tl, borderTopRightRadius: farT, borderBottomRightRadius: farB, borderBottomLeftRadius: radius.bl }
    : { borderTopLeftRadius: farT, borderTopRightRadius: radius.tr, borderBottomRightRadius: radius.br, borderBottomLeftRadius: farB };
  // ── BURGUNDY ESCALATION TINT ─────────────────────────────────────────
  // The tint should mark exactly the messages that belong to the human-
  // handoff window — and nothing else.
  //
  //   Window opens on the customer message that *caused* the AI to
  //   escalate. The escalation's `raised_at` is stamped at the moment the
  //   AI emits [[ACTION:escalate]] — a few seconds AFTER the triggering
  //   inbound. So a strict `msgTs >= raised_at` cutoff would leave the
  //   trigger message un-tinted, which read as "this random message
  //   suddenly turned the AI off" instead of the truthful "this message
  //   is the one that needed a human". We back the window up by a small
  //   grace zone (TRIGGER_LOOKBACK_MS) so the most recent inbound that
  //   sits just before raised_at is captured too.
  //
  //   Window closes when the operator clicks "Resolve & resume AI". The
  //   server stamps `resolved_at` on the escalation blob; messages after
  //   that go back to plain (this is what makes the bubbles return to
  //   normal once the issue is handled). For a still-`pending` row,
  //   the window is open-ended — every message from raised_at onward is
  //   tinted until resolution.
  //
  //   Pre-flag for instant feedback: when the operator clicks resolve
  //   we also set window.__bcEscResolvedNow[convId] = Date.now() so the
  //   bubbles can stop tinting on the next render even before the
  //   refreshed conversations list has propagated msg.escalation. This
  //   prevents the "I clicked resolve but the bubbles stayed burgundy"
  //   UX bug.
  const escMeta = msg && msg.escalation;
  let isEscMsg = false;
  if (escMeta && escMeta.raised_at) {
    const TRIGGER_LOOKBACK_MS = 90 * 1000;  // 90s — covers AI thinking time
    const msgTs = m.ts ? +new Date(m.ts) : 0;
    const raisedTs = +new Date(escMeta.raised_at);
    if (msgTs > 0 && raisedTs > 0) {
      // Local resolve override — operator clicked resolve in this session.
      // Treats anything after that local timestamp as post-resolve regardless
      // of what the server-side escalation blob currently says.
      let localResolvedTs = 0;
      try {
        const o = (typeof window !== 'undefined' && window.__bcEscResolvedNow) || {};
        const v = o && msg && msg.id ? o[msg.id] : 0;
        if (v && Number.isFinite(+v)) localResolvedTs = +v;
      } catch(_){}

      // Effective lower bound — include the triggering inbound by allowing
      // a brief lookback window for incoming messages.
      const lowerBound = (m.r === 'in')
        ? raisedTs - TRIGGER_LOOKBACK_MS
        : raisedTs;

      let withinServerWindow = false;
      if (msgTs >= lowerBound) {
        if (escMeta.status === 'pending') {
          withinServerWindow = true;
        } else if (escMeta.status === 'resolved' && escMeta.resolved_at) {
          const resolvedTs = +new Date(escMeta.resolved_at);
          if (resolvedTs > 0 && msgTs <= resolvedTs) withinServerWindow = true;
        }
      }
      // Apply local override last — if the operator already clicked resolve
      // in this session, suppress tint for any message past that moment
      // even when the server payload still says "pending" because the
      // conversation-list refresh hasn't landed yet.
      if (withinServerWindow && localResolvedTs > 0 && msgTs > localResolvedTs) {
        withinServerWindow = false;
      }
      isEscMsg = withinServerWindow;
    }
  }
  const cls    = (isIn ? 'b-in' : isBot ? 'b-bot' : 'b-out') + (isEscMsg ? ' b-esc' : '')
    + (m.del ? ' b-deleted' : '')
    + (m._pending === 'slow' ? ' b-sending' : (m._pending && m._pending !== 'send') ? ' b-pending' : '')
    + (m.err ? ' b-failed' : '')
    + (m.rq ? ' b-has-quote' : '') + (fileBubble ? ' b-file' : '');
  // ── Right-click → message menu ──
  // Real conversations only (not the ghost). The open chat listens for
  // 'bc-msg-ctx' and draws the menu; the row just reports what was hit.
  // On a touch screen, pressing and holding the bubble does the same.
  const canCtx = !!(msg && !msg.__ghost && msg.p && msg.id);
  const openCtx = (x, y, ay) => {
    try {
      window.dispatchEvent(new CustomEvent('bc-msg-ctx', {
        detail: { x, y, ay, convId: msg.id, row: m, ti },
      }));
    } catch (_) {}
  };
  // A hold opens the menu just under the message (above it when there's no
  // room), lined up with the message's own edge, so the finger and the menu
  // don't cover what it's about.
  const hold = useLongPress(canCtx ? (p) => {
    const b = bubbleRef.current && bubbleRef.current.getBoundingClientRect();
    if (!b) { openCtx(p.clientX, p.clientY); return; }
    openCtx(isIn ? b.left : b.right, b.bottom + 6, b.top - 6);
  } : null);
  const onBubbleCtx = canCtx ? (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (hold.recent()) return;          // Android's own long-press, just after ours
    openCtx(e.clientX, e.clientY);
  } : undefined;
  const jumpToQuote = (e) => {
    e.stopPropagation();
    const rq = m.rq;
    if (!rq || !msg) return;
    // A direct chat's messages live in DM_STORE; its view does the jump.
    if (msg.__direct) {
      try { window.dispatchEvent(new CustomEvent('bc:dm-jump', { detail: { tid: msg.threadId, uid: rq.uid } })); } catch (_) {}
      return;
    }
    const t = (typeof MSGS_STORE !== 'undefined') ? MSGS_STORE.getThreadSync(msg.id) : [];
    const target = rq.uid ? t.find(r => r && r.uid === rq.uid) : null;
    if (!target) { bcToast('The original message isn’t in this chat’s history', 'info'); return; }
    try { window.dispatchEvent(new CustomEvent('bc:jumpToMessage', { detail: { convId: msg.id, target: { ref: target } } })); } catch (_) {}
  };
  const rowCls = isIn ? 'brow brow-in' : 'brow brow-r';

  // ── Entrance finished: drop the animation entirely ──
  // A finished transform animation that holds its end state (fill: both)
  // keeps the bubble on its own GPU layer, and a layer is snapped to whole
  // pixels while the rest of the thread is laid out at sub-pixel positions
  // (the message column is centred, so it often sits on a half pixel). The
  // result was that messages which arrived live sat a pixel off their
  // neighbours — out of line and unevenly spaced — until a refresh drew
  // them without the animation. Removing the attribute (and the hop's
  // inline timing) when the entrance ends puts the bubble back into normal
  // layout, identical to one loaded from history. React never re-adds it:
  // the `enter` prop for this row doesn't change again.
  const onEnterEnd = (e) => {
    if (e.target !== e.currentTarget) return;
    const n = String(e.animationName || '');
    if (n !== 'bcb-in' && n !== 'bcb-out' && n !== 'bcb-fade' && n !== 'bmsg-in' && n !== 'bmsg-out') return;
    const el = e.currentTarget;
    el.removeAttribute('data-enter');
    el.style.animationDuration = '';
    el.style.animationPlayState = '';
  };

  // The hover timestamp is one floating label per thread (see
  // THE HOVER TIMESTAMP above); rows only tell it where the pointer is.
  const tsInfo = { side: isIn ? 'in' : 'out', sz, ts: m.ts, t: m.t };
  const onRowEnter = (e) => tsFloatEnter(bubbleRef.current, tsInfo, e.clientY, e.clientX);
  const onRowMove  = (e) => tsFloatMove(bubbleRef.current, e.clientY, e.clientX);
  const onRowLeave = () => tsFloatLeave(bubbleRef.current);

  return (
    <div className={rowCls} style={{gap:8,alignItems:'flex-end',position:'relative',...style}}
         data-ti={ti == null ? undefined : ti}
         data-side={isIn ? 'l' : 'r'}
         data-gs={isGroupStart ? '1' : '0'}
         data-ge={isGroupEnd ? '1' : '0'}
         data-edge={mediaEdge ? '1' : undefined}
         data-sk={`${(m.c || '').length}|${m.mu ? 1 : 0}|${m.mt || ''}|${m.rq ? 1 : 0}|${m.ed || ''}|${m.del ? 1 : 0}|${m.mp ? 1 : 0}`}
         onMouseEnter={onRowEnter} onMouseMove={onRowMove} onMouseLeave={onRowLeave}>
      {/* Telegram-style avatar rail — the avatar lives in its OWN column
          on the bubble's side. It paints only on the LAST bubble of an
          in-group (other rows reserve a same-width spacer so edges align),
          and uses position:sticky so when the operator scrolls past a
          tall bubble, the avatar slides UP the bubble's side rail to
          stay anchored to the bottom of the viewport while still inside
          the bubble's bounds. Mirrors the timestamp's tracking behavior
          but on its own dedicated rail.

          Three avatar modes:
            • incoming  → customer avatar on the LEFT
            • bot       → robot glyph on the RIGHT (mirrored rail)
            • manual out → the operator's own avatar on the RIGHT */}
      {/* Avatar rail on every side: customer on the left, the AI's mark or
          the operator's own avatar on the right. Only the last bubble of a
          run paints it; the others hold a same-width spacer so edges align.
          When a run grows, the avatar glides down to the new last bubble. */}
      {isGroupEnd ? (
        <AvatarRail sz={sz} glideKey={glideKey} glide={!!enter} ts={m.ts}>
          {isIn
            ? (avatarNode || <Ava name={msg.name} col={msg.col} sz={sz} src={msg.avatar}/>)
            : isBot ? <BotAva sz={sz}/> : <OperatorAva sz={sz}/>}
        </AvatarRail>
      ) : (
        <div style={{width:sz,flexShrink:0}} aria-hidden="true"/>
      )}
      {/* ── BUBBLE GEOMETRY ──
          The full corner set is computed here rather than only the two
          corners that differ from the stylesheet, because a picture filling
          the bubble edge-to-edge needs to know all four to match them.
          Outer corners stay full; inner edges (touching the next bubble in
          the same-side group) shrink so a run reads as one stack. */}
      <div ref={bubbleRef} className={`bubble ${cls}`}
        onContextMenu={onBubbleCtx}
        {...(canCtx ? hold.handlers : null)}
        onAnimationEnd={onEnterEnd}
        // 'in' | 'out' | null. Null renders no attribute at all, so a
        // bubble that isn't new carries none of the animation CSS.
        data-enter={enter || undefined}
        style={{
        position:'relative',
        ...bubCorners,
        // A picture with no caption is the whole message, so the bubble's
        // 9px/13px text padding is just a frame of dead space around it —
        // which is exactly how it looked. Drop the padding and let the
        // media meet the edge; the 1px border stays and reads as a hairline
        // frame. Captioned media keeps its padding, because the text below
        // still needs it.
        // No overflow:hidden here — the hover timestamp is absolutely
        // positioned OUTSIDE the bubble (left/right: calc(100% + Npx)), so
        // clipping the bubble would delete it. The image carries the same
        // four corners instead, which rounds it without any clipping.
        ...(mediaEdge ? {padding: 0} : null),
      }}>
        {isBot && isGroupStart && !imageCard && (
          <div className="b-lbl" style={mediaEdge ? {padding:'8px 12px 6px', marginBottom:0} : undefined}>
            AI · {m.agent || msg.agent}
          </div>
        )}
        {isOut && isGroupStart && !imageCard && !m.rq && !hideYou && (
          <div className="b-lbl" data-who="you" style={mediaEdge ? {padding:'8px 12px 6px', marginBottom:0} : undefined}>
            You
          </div>
        )}
        {/* The message this one replies to. */}
        {m.rq && (
          <button type="button" className="b-quote" data-who={m.rq.r === 'in' ? 'in' : 'out'}
            onClick={jumpToQuote} title="Show the original message">
            <span className="b-quote-who">{quoteWho(m.rq, msg)}</span>
            <span className="b-quote-txt">{quoteText(m.rq)}</span>
          </button>
        )}
        {/* Images, video, audio and documents — inbound or outbound. */}
        <MessageMedia m={m} radius={radius} edge={mediaEdge}
          caption={imageCard || ytCard ? bodyText : ''}
          label={imageCard && isGroupStart ? (isBot ? `AI · ${m.agent || msg.agent}` : (isOut && !hideYou) ? 'You' : null) : null}
          labelWho={isBot ? 'ai' : ''}/>
        {bodyText && !imageCard && !ytCard && !ytEdge && mediaKind !== 'link' && (rich
          ? <GhostRichText text={bodyText} reveal={reveal}/>
          : <div className="b-text">{bodyText}</div>)}
        {ytInText && (ytEdge
          ? <YouTubeCard url={ytInText} caption={bodyText} full
              corners={{borderTopLeftRadius: radius.tl, borderTopRightRadius: radius.tr,
                        borderBottomLeftRadius: radius.bl, borderBottomRightRadius: radius.br}}/>
          : <YouTubeCard url={ytInText} inline/>)}
        {(m.ed || m.del || m.err || (m._pending && m._pending !== 'send')) ? (
          <div className="b-foot" style={mediaEdge ? {padding:'0 10px 6px'} : undefined}>
            {m._pending === 'slow'   && <span>sending…</span>}
            {m._pending === 'edit'   && <span>saving…</span>}
            {m._pending === 'delete' && <span>deleting…</span>}
            {m.ed && !m.del && !m._pending && (
              <span className="b-ed" title={m.oc ? 'Original: ' + String(m.oc).replace(MEDIA_LABEL_RE, '').trim() : 'Edited'}>edited</span>
            )}
            {m.del ? <span>{isIn && !(msg && msg.__direct) ? 'deleted by customer' : 'deleted'}</span> : null}
            {m.err ? <span className="b-err" title={m.err}>not sent</span> : null}
            {/* Direct chats resend from the bubble itself (DirectChat listens). */}
            {m.err && msg && msg.__direct ? <>
              <span className="b-dot" aria-hidden="true">·</span>
              <button type="button" className="b-retry" title={m.err}
                onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('bc-dm-retry', { detail: { uid: m.uid } })); }}>retry</button>
            </> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ── MEMOIZED BUBBLE ─────────────────────────────────────────────────────
// Message and conversation objects are mutated IN PLACE by the stores
// (patchMediaUrl sets row.mu, assignAgent sets conv.agent, …), so object
// identity can't tell us whether a bubble needs to redraw. The public
// ChatBubbleRow is a tiny shell that snapshots every value the bubble
// actually paints into a flat array; the heavy renderer only runs when one
// of those values — or a layout prop — really changed. Strings are compared
// by reference first, so even multi-MB data: URLs cost nothing to compare.
const _bubbleSnap = (m, msg) => {
  const esc = msg && msg.escalation;
  let localResolved = 0;
  if (esc) {
    try {
      const o = window.__bcEscResolvedNow;
      localResolved = (o && msg && msg.id && o[msg.id]) || 0;
    } catch (_) {}
  }
  return [
    m && m.r, m && m.c, m && m.t, m && m.ts, m && m.mt, m && m.mu, m && m.mn, m && m.agent,
    // Lifecycle — reply quote, edits, deletion, in-flight and failed states,
    // download progress. Mutated in place like everything else here.
    m && m.rq, m && m.rq && m.rq.c, m && m.ed, m && m.del, m && m._pending, m && m.err,
    m && m.mp, m && m.me, m && m.ms, m && m.uid,
    msg && msg.id, msg && msg.name, msg && msg.col, msg && msg.avatar, msg && msg.agent,
    esc ? esc.raised_at : null, esc ? esc.status : null, esc ? esc.resolved_at : null, localResolved,
  ];
};
const _shallowEqObj = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
  return true;
};
const _sameNode = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return a.type === b.type && a.key === b.key && _shallowEqObj(a.props, b.props);
};
const ChatBubbleRowMemo = React.memo(ChatBubbleRowImpl, (p, n) => {
  if (p.sz !== n.sz || p.isGroupStart !== n.isGroupStart || p.isGroupEnd !== n.isGroupEnd
      || p.rich !== n.rich || p.reveal !== n.reveal || p.enter !== n.enter || p.ti !== n.ti
      || !!p.hideYou !== !!n.hideYou) return false;
  if (!_shallowEqObj(p.style, n.style) || !_sameNode(p.avatarNode, n.avatarNode)) return false;
  const a = p._snap, b = n._snap;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
});
const ChatBubbleRow = (props) => <ChatBubbleRowMemo {...props} _snap={_bubbleSnap(props.m, props.msg)}/>;

// ── findJumpTargetIndex ───────────────────────────────────────────────
// Pick the thread bubble a 'bc:jumpToMessage' event refers to. Returns an
// index into `thread` or -1. Pure (no DOM) so it can be tested in isolation.
//   detail.text  — start of the target message's content (≤80 chars)
//   detail.ts    — epoch ms (or anything Date can parse)
//   detail.role  — optional role filter, e.g. 'in' for customer bubbles
//   detail.match — 'before' → latest bubble at/before ts; default nearest
// ── PARKED JUMP REQUESTS ──────────────────────────────────────────────
// A jump can be asked for before there is anything to jump to. Clicking a
// notification opens the conversation and asks for a specific bubble in the
// same gesture, but the thread mounts a beat later and loads its messages
// after that — so the request arrives at a component that has no rows yet
// and used to be silently dropped, landing the operator at the bottom of
// the chat with no idea which message the row meant.
//
// A request that can't be satisfied is parked here instead, and the thread
// view consumes it as soon as it has rendered messages for that
// conversation. The expiry stops a stale request from hijacking a scroll
// minutes later, when the operator has moved on and is reading something
// else in the same chat.
const BC_JUMP_PARK_MS = 15000;
const bcParkJump = (detail) => {
  if (!detail || !detail.convId) return;
  try { window.__bcPendingJump = { ...detail, __expires: Date.now() + BC_JUMP_PARK_MS }; } catch (_) {}
};
const bcTakeParkedJump = (convId) => {
  let p = null;
  try { p = window.__bcPendingJump || null; } catch (_) { return null; }
  if (!p || p.convId !== convId) return null;
  if (p.__expires && Date.now() > p.__expires) {
    try { window.__bcPendingJump = null; } catch (_) {}
    return null;
  }
  return p;
};
const bcClearParkedJump = () => { try { window.__bcPendingJump = null; } catch (_) {} };

// ── bcThreadRows ─────────────────────────────────────────────────────
// The bubble elements that correspond 1:1 with thread[i], in order.
//
// Both jump paths index this list with a THREAD index, so the list has to
// contain exactly the thread's own bubbles and nothing else. Two things
// used to break that correspondence and both put the operator on the wrong
// message:
//
//   • an UNSCOPED querySelectorAll('.brow') — used outright by the chapter
//     glow, and as a fallback by the message jump. `.brow` is also rendered
//     by the thread footer and by nested previews inside bubbles, so every
//     such element ahead of the target shifted the index by one. On a
//     thread with a followers footer or any quoted-message preview, the
//     highlight simply landed on a different bubble.
//   • no upper bound, so footer rows were addressable as if they were
//     thread rows.
//
// Scoped to direct children of .ipc-body (which is exactly what
// threadRowsEl renders — moment separators carry their own class, never
// .brow) and clamped to the thread length.
const bcThreadRows = (root, threadLen) => {
  if (!root) return [];
  const rows = Array.from(root.querySelectorAll(':scope > .ipc-body > .brow'));
  return (typeof threadLen === 'number' && threadLen >= 0) ? rows.slice(0, threadLen) : rows;
};
// The row for thread[i]. Every bubble row carries its thread index
// (data-ti), so the lookup is by identity rather than by counting DOM
// children — nothing rendered between, around or inside the rows can shift
// it. Counting stays only as a fallback for a row rendered before the
// attribute existed.
const bcThreadRowAt = (root, i, threadLen) => {
  if (!root || !(i >= 0)) return null;
  const byIdx = root.querySelector(`:scope > .ipc-body > .brow[data-ti="${i}"]`);
  if (byIdx) return byIdx;
  return bcThreadRows(root, threadLen)[i] || null;
};

// Server stamps may arrive as epoch ms, ISO strings or MySQL DATETIME
// ("YYYY-MM-DD HH:MM:SS", stored UTC). new Date() reads the last one as
// LOCAL time, which moved every such jump by the operator's UTC offset —
// hours away from the message. Same rules as euParseTs.
const bcJumpParseTs = (v) => {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (/^\d+$/.test(s)) return +s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  return +new Date(s);
};
// A bubble's time on the SERVER clock: live bubbles are stamped by this
// browser, loaded ones by the server; compare like with like.
const bcBubbleServerTs = (m) => {
  const t = m && m.ts ? +new Date(m.ts) : 0;
  if (!isFinite(t) || !t) return 0;
  try { if (m._local && typeof euServerTime === 'function') return euServerTime(t); } catch (_) {}
  return t;
};

// Scroll a thread row to the middle of its container. Bounding rects, never
// offsetTop: offsetTop is measured against the nearest positioned ancestor,
// which is not the scroll container here, so it drifts by whatever that
// ancestor's offset happens to be. The chapter glow still used offsetTop and
// landed short of its own target for exactly that reason.
const bcScrollRowIntoView = (root, node, convKey) => {
  if (!root || !node) return;
  const rootRect = root.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const target = Math.max(0, Math.round(
    root.scrollTop + (nodeRect.top - rootRect.top) - (root.clientHeight - nodeRect.height) / 2
  ));
  root.scrollTo({ top: target, behavior: 'smooth' });
  try { if (convKey != null) SCROLL_POS_CACHE.set(convKey, target); } catch (_) {}
};

// ── THE JUMP MARK ─────────────────────────────────────────────────────
// How a bubble says "this one" after a jump. It used to be a full-width
// band across the whole row plus a ring on the bubble — at chat scale that
// reads as an alert. Now it is the bubble alone: a hairline ring that
// settles in from a few pixels out, holds for a moment and fades. No fill,
// no band, no colour change on the message itself, so the text never
// shifts or re-renders. Chapter ranges get the chapter's own hue at the
// same low strength; a plain jump is a neutral cool grey.
const BC_JUMP_INK = {
  jump: '176,190,220', topic: '170,182,205', question: '124,170,214', objection: '214,142,132',
  decision: '140,194,156', payment: '162,152,222', escalation: '220,152,112',
  resolution: '126,190,156', small_talk: '160,165,176',
};
// Drawn ON the bubble, never around it: a pseudo-element laid exactly over
// the bubble's border box (inset:-1px covers the 1px border, radius
// inherited, so every corner — including the flat tail corner — matches
// to the pixel). Three layers, all low-alpha:
//   • a 1px ring that replaces the border colour for the moment
//   • a faint tint across the whole bubble
//   • one soft sheen that crosses the bubble once
// then everything fades back to the bubble's own look. No outline offset,
// so there is no gap between the mark and the message.
// Drawn ON the bubble, never around it: a pseudo-element laid exactly over
// the bubble's border box (inset:-1px covers the 1px border, radius
// inherited, so every corner — including the flat tail corner — matches
// to the pixel). Deliberately quiet — it should read as "here it is", not
// as an alert:
//   • the bubble's own 1px border brightens slightly
//   • a barely-there tint across the bubble
//   • one faint sheen that drifts across once
// then it all fades back. No outer glow, no offset, no gap.
const bcEnsureJumpStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-jump-mark-style-v3')) return;
  const st = document.createElement('style');
  st.id = 'bc-jump-mark-style-v3';
  st.textContent = `
.bubble.bc-jump-mark { position: relative; }
.bubble.bc-jump-mark::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none; z-index: 2;
  box-shadow: inset 0 0 0 1px rgba(var(--bc-jk, 176,190,220), .26);
  background:
    linear-gradient(105deg, transparent 38%, rgba(255,255,255,.035) 50%, transparent 62%) no-repeat,
    rgba(var(--bc-jk, 176,190,220), .035);
  background-size: 240% 100%, 100% 100%;
  background-position: 130% 0, 0 0;
  opacity: 0;
  animation: bcJumpMarkV3 2.2s cubic-bezier(.33,0,.2,1) both, bcJumpSheenV3 1.4s cubic-bezier(.4,0,.2,1) .15s both;
}
.bubble.bc-jump-mark[data-jrun="1"]::after { animation-name: bcJumpMarkRunV3, bcJumpSheenV3; }
@keyframes bcJumpMarkV3 {
  0%   { opacity: 0; }
  18%  { opacity: 1; }
  55%  { opacity: .8; }
  100% { opacity: 0; }
}
@keyframes bcJumpMarkRunV3 {
  0%   { opacity: 0; }
  18%  { opacity: .7; }
  55%  { opacity: .55; }
  100% { opacity: 0; }
}
@keyframes bcJumpSheenV3 {
  from { background-position: 130% 0, 0 0; }
  to   { background-position: -30% 0, 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  .bubble.bc-jump-mark::after { animation: bcJumpMarkV3 2.2s linear both; background-position: -30% 0, 0 0; }
}`;
  document.head.appendChild(st);
};
const bcMarkBubbles = (nodes, mode, kind) => {
  bcEnsureJumpStyles();
  const ink = BC_JUMP_INK[mode === 'range' ? (kind || 'topic') : 'jump'] || BC_JUMP_INK.jump;
  const run = nodes.length > 1;
  nodes.forEach(node => {
    // The row's own bubble — the first one in it; nested previews come later.
    const bub = node.querySelector('.bubble');
    if (!bub) return;
    // Clear any older highlight style (and restart cleanly on a repeat jump).
    node.classList.remove('brow-jump-hl');
    bub.classList.remove('bc-jump-mark', 'bubble-jump-flash', 'bubble-chapter-glow');
    bub.removeAttribute('data-chapter-kind');
    void bub.offsetWidth;
    bub.style.setProperty('--bc-jk', ink);
    if (run) bub.setAttribute('data-jrun', '1'); else bub.removeAttribute('data-jrun');
    bub.classList.add('bc-jump-mark');
    clearTimeout(bub.__bcJumpT);
    bub.__bcJumpT = setTimeout(() => {
      bub.classList.remove('bc-jump-mark');
      bub.removeAttribute('data-jrun');
      bub.style.removeProperty('--bc-jk');
    }, 2400);
  });
};

const jumpNormText = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ── EXACT TARGETS ────────────────────────────────────────────────────
// A chat separator knows exactly which bubble it was drawn against, and
// says so: `target` = { ref, id, idx }. `ref` is the thread row object
// itself, `id` the server row id. Either identifies the bubble with no
// guessing at all, so they are tried before anything else; the text/time
// heuristics below only run when neither is in this thread any more (a
// history reload swapped the row objects and the separator hasn't rebuilt
// yet, or the id was never recorded).
//
// The id is read through `ref` too: a live bubble gets its server id a
// beat AFTER it was sent, by mutation, so a target captured before that
// still finds it by id afterwards.
const resolveJumpTarget = (thread, t) => {
  if (!t || typeof t !== 'object' || !Array.isArray(thread) || !thread.length) return -1;
  if (t.ref) {
    const i = thread.indexOf(t.ref);
    if (i >= 0) return i;
  }
  const id = Number(t.id || (t.ref && t.ref.id) || 0);
  if (id > 0) {
    for (let i = 0; i < thread.length; i++) {
      const m = thread[i];
      if (m && Number(m.id || 0) === id) return i;
    }
  }
  // The row was replaced by an equal one (reload) — same side, same text,
  // same stamp to the second — and it still sits where it was.
  const i = Number(t.idx);
  if (t.ref && Number.isInteger(i) && i >= 0 && i < thread.length) {
    const m = thread[i], r = t.ref;
    if (m && m.r === r.r && String(m.c || '') === String(r.c || '')
        && Math.abs((Number(m.ts) || 0) - (Number(r.ts) || 0)) < 1000) return i;
  }
  return -1;
};

const findJumpTargetIndex = (thread, detail) => {
  if (!Array.isArray(thread) || !thread.length || !detail) return -1;
  if (detail.target) {
    const exact = resolveJumpTarget(thread, detail.target);
    if (exact >= 0) return exact;
  }
  // "Where the operator stopped reading": the Nth customer message from
  // the end, N being the unread count when the notification was clicked.
  // Exact, and independent of clocks and of message text.
  const nUnread = Math.floor(Number(detail.firstUnread) || 0);
  if (nUnread > 0) {
    const inb = [];
    thread.forEach((m, i) => { if (m && m.r === 'in') inb.push(i); });
    if (inb.length) return inb[Math.max(0, inb.length - nUnread)];
  }
  if (detail.last) return thread.length - 1;
  const ts = bcJumpParseTs(detail.ts);
  const hasTs = isFinite(ts) && ts > 0;
  const role = detail.role ? String(detail.role) : '';
  const cands = [];
  thread.forEach((m, i) => {
    if (!m) return;
    if (role && m.r !== role) return;
    cands.push({ i, m, mts: bcBubbleServerTs(m) });
  });
  if (!cands.length) return -1;
  const closest = (list) => {
    if (!hasTs) return list[list.length - 1].i;
    let best = list[0], bestD = Infinity;
    list.forEach(c => {
      const d = c.mts ? Math.abs(c.mts - ts) : Number.MAX_SAFE_INTEGER;
      if (d < bestD) { bestD = d; best = c; }
    });
    return best.i;
  };
  // 1. Content match — exact regardless of clock drift.
  //
  // The threshold was 2 characters. Two normalised characters ("ok", "hi",
  // "no") match a large share of the short replies in any sales thread, and
  // `want.startsWith(have) && have.length >= 8` matches any bubble that is
  // merely a PREFIX of the text we were given — so a jump aimed at a long
  // message could land on a short earlier one that happened to start the
  // same way. Both are how a notification put the operator on the wrong
  // bubble while looking, from the code's point of view, like a confident
  // exact match.
  //
  // 6 characters is short enough to keep real one-word answers matchable and
  // long enough that the match means something, and the prefix-of-want case
  // now needs a substantial overlap before it counts.
  const want = jumpNormText(detail.text);
  if (want.length >= 6) {
    const strong = [];
    const weak = [];
    cands.forEach(c => {
      const have = jumpNormText(c.m.c);
      if (!have) return;
      if (have === want || have.startsWith(want)) { strong.push(c); return; }
      if (want.length >= 16 && have.includes(want)) { strong.push(c); return; }
      if (want.startsWith(have) && have.length >= 16) weak.push(c);
    });
    const hits = strong.length ? strong : weak;
    if (hits.length) return closest(hits);
  }
  if (!hasTs) return -1;
  // 2. Latest bubble at/before ts (5s grace for clock skew).
  if (detail.match === 'before') {
    let best = null;
    cands.forEach(c => { if (c.mts && c.mts <= ts + 5000 && (!best || c.mts >= best.mts)) best = c; });
    if (best) return best.i;
  }
  // 3. Nearest timestamp.
  const dated = cands.filter(c => c.mts);
  return closest(dated.length ? dated : cands);
};

const TgIcon = ({s=14,style={}}) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{flexShrink:0,...style}}>
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" fill="#2AABEE"/>
  </svg>
);
const DcIcon = ({s=14,style={}}) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{flexShrink:0,...style}}>
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" fill="#5865F2"/>
  </svg>
);

// ── LLM provider brand marks ─────────────────────────────────
// Hand-traced single-colour glyphs for each provider. Used in the LLM
// Keys popup left rail, the ActiveLlmPicker, and the per-key field
// labels so the operator can scan providers visually.
const GeminiIcon = ({s=14,style={}}) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{flexShrink:0,...style}}>
    <defs>
      <linearGradient id="gem-g" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#4285F4"/><stop offset="0.5" stopColor="#9B72F2"/><stop offset="1" stopColor="#F94E7E"/>
      </linearGradient>
    </defs>
    <path d="M12 1c.4 5.6 4.4 9.6 10 10-5.6.4-9.6 4.4-10 10-.4-5.6-4.4-9.6-10-10C7.6 10.6 11.6 6.6 12 1z" fill="url(#gem-g)"/>
  </svg>
);
const OpenAiIcon = ({s=14,style={}}) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{flexShrink:0,...style}}>
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5z" fill="currentColor"/>
  </svg>
);
const AnthropicIcon = ({s=14,style={}}) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{flexShrink:0,...style}}>
    <path d="M14.504 3h-3.04L17.21 21h3.04L14.504 3zM7.473 3 1.728 21h3.1l1.176-3.788h6.013L13.193 21h3.1L10.548 3H7.473zm-.518 11.426 2.013-6.508 2.013 6.508H6.955z" fill="#D97757"/>
  </svg>
);

// ── TopLayer — render straight into <body> ───────────────────────
// Everything React draws lives inside .app, which is position:relative
// with z-index:1. That makes .app one layer at the page root, so a z-index
// set on anything inside it only ranks against its siblings — never against
// the dashboard's own page-level layers (the ghost's click area at 7998, the
// ghost composer at 8500, the top-right chips, the balance/notification
// bubbles). Those always won, and clicks meant for a popup went to the
// ghost or a widget behind it.
//
// Popups rendered through TopLayer sit at the page root instead, so their
// z-index is real. The accent and chat-width variables set on .app are
// carried across, because a portal no longer inherits them.
// ── MESSAGE PREVIEW (inbox rows, notifications) ─────────────────────
// Renders what bcPreviewParts (bot-stores.jsx) makes of a raw preview: a
// small line icon and a human label for attachments ("Photo", "Voice
// message", or the caption / file name when there is one) instead of the
// raw "[IMAGE]" / "[DOCUMENT]" markers. Inline, so it keeps the parent's
// single-line ellipsis.
const BC_PREVIEW_ICON = {
  photo: <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></>,
  video: <><rect x="2.5" y="5.5" width="13" height="13" rx="2.5"/><path d="M15.5 10.2l6-3.2v10l-6-3.2"/></>,
  video_note: <><circle cx="12" cy="12" r="9"/><path d="M10 8.8v6.4l5.2-3.2z"/></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></>,
  audio: <><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></>,
  voice: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>,
  gif: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 10.2l4 1.8-4 1.8z"/></>,
  sticker: <><path d="M20.5 12.5A8.5 8.5 0 1 1 11.5 3.5c0 5 4 9 9 9z"/><path d="M8.5 14.5c.9 1 2.1 1.5 3.5 1.5"/></>,
  attachment: <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>,
  contact: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  location: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></>,
  poll: <path d="M5 20V10M12 20V4M19 20v-7"/>,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>,
};
const BcPreviewText = React.memo(function BcPreviewText({text}) {
  const p = (typeof bcPreviewParts === 'function') ? bcPreviewParts(text) : { who:'', kind:'', label:'', text: String(text || '') };
  if (!p.kind) return <>{p.who ? p.who + ': ' : ''}{p.text}</>;
  const body = p.text || p.label;
  return (
    <>
      {p.who ? p.who + ': ' : ''}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        style={{display:'inline-block', verticalAlign:'-2px', marginRight:4, opacity:.8, flexShrink:0}}>
        {BC_PREVIEW_ICON[p.kind] || BC_PREVIEW_ICON.attachment}
      </svg>
      <span aria-label={p.text ? p.label + ': ' + p.text : p.label}>{body}</span>
    </>
  );
});

const TopLayer = ({children}) => {
  if (typeof document === 'undefined' || !window.ReactDOM || !ReactDOM.createPortal) return children;
  const vars = {};
  const appEl = document.querySelector('.app');
  if (appEl) {
    const cs = getComputedStyle(appEl);
    // --acc is set on the document root by App, so the portal inherits it
    // live. Copying it here froze the value from the previous render.
    ['--cw'].forEach(k => { const v = cs.getPropertyValue(k); if (v && v.trim()) vars[k] = v.trim(); });
  }
  return ReactDOM.createPortal(
    <div className="top-layer" style={{display:'contents', ...vars}}>{children}</div>,
    document.body
  );
};

// ── PopMore — expandable area for settings popups ───────────────
// Keeps secondary detail (developer reference, advanced options) one tap
// away instead of always taking height. `sub` is a short summary shown on
// the closed row so people know what's inside without opening it.
const PopMore = ({title, sub, defaultOpen=false, children}) => {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="pop-more" data-open={open ? '1' : '0'}>
      <button type="button" className="pop-more-head" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>
        <svg className="pop-more-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
        <span>{title}</span>
        {sub && !open && <span className="pop-more-sub">{sub}</span>}
      </button>
      {open && <div className="pop-more-body">{children}</div>}
    </div>
  );
};

// Provider metadata — shared by the LLM left rail, ActiveLlmPicker, and
// the per-key field cards. Tint is used for the selection ring and dot.
const LLM_PROVIDERS = [
  { id:'gemini', label:'Gemini',    full:'Google Gemini', tint:'#4285F4', Icon:GeminiIcon,    hint:'aistudio.google.com → API Keys' },
  { id:'openai', label:'OpenAI',    full:'OpenAI',        tint:'#10A37F', Icon:OpenAiIcon,    hint:'platform.openai.com/api-keys' },
  { id:'claude', label:'Anthropic', full:'Anthropic',     tint:'#D97757', Icon:AnthropicIcon, hint:'console.anthropic.com → API Keys' },
];

// ── Crypto ticker symbols ────────────────────────────────────
// The real currency glyph for each coin, so a ticker never has to be
// read as bare capitals. Unicode where the coin has an official sign
// (₿ ETH Ξ USDT ₮ LTC Ł XMR ɱ DOGE Ð), otherwise the ticker itself.
const CRYPTO_SYMBOLS = {
  BTC:'₿', BCH:'₿', ETH:'Ξ', ETC:'Ξ', USDT:'₮', USDC:'$', DAI:'◈',
  LTC:'Ł', XMR:'ɱ', DOGE:'Ð', DASH:'Đ', ZEC:'ⓩ', XRP:'✕', TRX:'⟁',
  BNB:'⬨', SOL:'◎', MATIC:'⬡', AVAX:'▲', DOT:'●', ADA:'₳', ALGO:'△',
  ATOM:'⚛', NEAR:'Ⓝ', FTM:'ϕ', ARB:'◆', OP:'⬢', BASE:'◉',
};
const cryptoSymbol = (ticker) => {
  const t = String(ticker || '').toUpperCase().split('_')[0];
  return CRYPTO_SYMBOLS[t] || '';
};
// Ticker with its symbol in front, e.g. "₿ BTC" — used in pickers and
// wallet rows so coins are identifiable at a glance.
const cryptoLabel = (ticker) => {
  const t = String(ticker || '').toUpperCase();
  const sym = cryptoSymbol(t);
  return sym ? `${sym}  ${t}` : t;
};

// Monogram tile for a coin — the symbol set in a tinted square, sized to
// sit in the same 28-32px slot as the platform and provider marks.
const CryptoGlyph = ({ticker, s=28, style={}}) => {
  const sym = cryptoSymbol(ticker) || String(ticker || '?').slice(0,2).toUpperCase();
  return (
    <span style={{
      width:s, height:s, borderRadius:Math.round(s*0.28), flexShrink:0,
      display:'inline-flex', alignItems:'center', justifyContent:'center',
      background:'rgba(255,255,255,0.045)',
      border:'0.5px solid rgba(255,255,255,0.08)',
      color:'rgba(214,218,232,0.82)',
      fontSize:Math.round(s*0.46), fontWeight:600, lineHeight:1,
      fontFamily:'var(--mono)',
      ...style,
    }}>{sym}</span>
  );
};

// ── ATOMS ────────────────────────────────────────────────────
// AI/bot avatar. Same circular footprint as Ava so it slots into the
// avatar rail without disturbing layout. Subtle violet gradient with
// a soft inner highlight reads "AI" without competing with the user
// avatars next to it. Icon is a minimal stroked robot head.
const BotAva = ({sz=28}) => {
  const icon = Math.round(sz * 0.58);
  return (
    <div style={{
      width: sz, height: sz, borderRadius: '50%',
      background: 'linear-gradient(140deg, rgba(108,99,255,0.32) 0%, rgba(72,64,160,0.45) 100%)',
      border: '1px solid rgba(140,130,255,0.32)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.10)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      color: 'rgba(220,214,255,0.92)',
    }} aria-label="AI">
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {/* Antenna */}
        <line x1="12" y1="3" x2="12" y2="6"/>
        <circle cx="12" cy="2.6" r="0.9" fill="currentColor" stroke="none"/>
        {/* Head */}
        <rect x="5" y="7" width="14" height="11" rx="3"/>
        {/* Eyes */}
        <circle cx="9" cy="12.5" r="1.05" fill="currentColor" stroke="none"/>
        <circle cx="15" cy="12.5" r="1.05" fill="currentColor" stroke="none"/>
        {/* Mouth */}
        <line x1="9.5" y1="15.6" x2="14.5" y2="15.6"/>
      </svg>
    </div>
  );
};

// Renders an <img> when an avatar URL is provided; falls back to
// initials-on-color if the URL is missing or fails to load.
//
// While something is genuinely in flight the circle runs its own quiet
// loading state: the initials dim back and a single arc sweeps the rim,
// so a conversation that has just landed in the contact list reads as
// "fetching a picture" rather than "has no picture". Two triggers:
//   • src given but not decoded yet — the image is loading.
//   • loading prop set with no src — the caller knows an avatar is
//     still being resolved upstream (a brand-new contact).
const Ava = ({name, col, sz=28, src, loading=false}) => {
  const [broken, setBroken] = React.useState(false);
  const [ready,  setReady]  = React.useState(() => !!src && AVA_READY.has(_mediaKey(src)));
  // Reset ready/broken when `src` changes to a *different* URL — but do it
  // synchronously during render (React's "adjusting state on prop change"
  // pattern), not in a useEffect. A mount-time effect fires on every mount
  // (fold/unfold, tab switch, etc.) regardless of whether src is "new", and
  // it runs asynchronously after commit. For an already-cached avatar the
  // <img>'s onLoad can fire before that effect gets a turn, so the effect's
  // setReady(false) stomps the onLoad's setReady(true) right after it lands
  // — ready gets stuck false forever with nothing left to ever flip it back
  // (the effect only re-runs if src changes again). That's the "avatars
  // never resolve" bug: it only ever bit rows whose picture loaded fast
  // enough to win that race. Resetting in-render instead means the reset
  // (if any) always happens *before* the new <img> is even committed to the
  // DOM, so there's nothing for a fast onLoad to race against.
  const prevSrc = React.useRef(src);
  if (prevSrc.current !== src) {
    prevSrc.current = src;
    const known = !!src && AVA_READY.has(_mediaKey(src));
    if (ready !== known) setReady(known);
    if (broken) setBroken(false);
  }

  const safeName = name || 'User';
  const ini = safeName.split(/\s+/).filter(Boolean).map(n=>n[0]).join('').slice(0,2).toUpperCase() || '?';
  const accent = col || '#7c6ef5';
  const busy = (!!src && !broken && !ready) || (!src && !!loading);
  const ring = Math.max(1.5, Math.round(sz * 0.05 * 2) / 2);

  // The loading layers fade out instead of vanishing the frame the picture
  // lands, so the hand-off from "loading" to "loaded" is one smooth
  // cross-fade: the image scales down into place while the sheen and the
  // arc dissolve over it.
  const [linger, setLinger] = React.useState(busy);
  React.useEffect(() => {
    if (busy) { setLinger(true); return; }
    const t = setTimeout(() => setLinger(false), 420);
    return () => clearTimeout(t);
  }, [busy]);
  const showLoad = busy || linger;
  // Only small, list-sized avatars get the sheen; on big ones it reads as
  // a skeleton screen rather than a quiet "fetching".
  const sheen = sz <= 64;

  return (
    <div className="ava" data-busy={busy ? '1' : '0'} style={{
      width:sz, height:sz, borderRadius:'50%', flexShrink:0, position:'relative',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:sz*0.36, fontWeight:600, overflow:'hidden',
      background:`${accent}18`, color: accent,
      border:`1px solid ${accent}28`,
      isolation:'isolate',
    }}>
      {src && !broken && (
        <img src={src} alt={safeName} decoding="async"
          onLoad={()=>{ AVA_READY.set(_mediaKey(src), 1); setReady(true); }}
          onError={()=>setBroken(true)}
          style={{
            position:'absolute', inset:0, width:'100%', height:'100%',
            objectFit:'cover',
            opacity: ready ? 1 : 0,
            transform: ready ? 'scale(1)' : 'scale(1.06)',
            transition:'opacity 360ms cubic-bezier(0.4,0,0.2,1), transform 620ms cubic-bezier(0.22,1,0.36,1)',
          }}/>
      )}
      {(!src || broken || !ready) && (
        <span style={{
          opacity: busy ? 0.18 : 1,
          transform: busy ? 'scale(0.92)' : 'none',
          transition:'opacity 320ms ease, transform 420ms cubic-bezier(0.22,1,0.36,1)',
        }}>{ini}</span>
      )}
      {showLoad && (
        <span aria-hidden="true" className="ava-load" style={{
          position:'absolute', inset:0, borderRadius:'50%', pointerEvents:'none',
          opacity: busy ? 1 : 0, transition:'opacity 380ms ease',
        }}>
          {/* Soft glass sheen drifting across the face. */}
          {sheen && (
            <span className="ava-sheen" style={{
              position:'absolute', top:0, bottom:0, left:'-60%', width:'60%',
              background:'linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.10) 45%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0.10) 55%, transparent 100%)',
            }}/>
          )}
          {/* Faint track so the arc has something to travel along. */}
          <span style={{
            position:'absolute', inset:0, borderRadius:'50%',
            boxShadow:`inset 0 0 0 ${ring}px ${accent}1c`,
          }}/>
          {/* The arc: a long tapered tail into a bright rounded head. */}
          <span className="ava-arc" style={{
            position:'absolute', inset:0, borderRadius:'50%',
            background:`conic-gradient(from 0deg, ${accent}00 0deg, ${accent}00 150deg, ${accent}40 250deg, ${accent}cc 330deg, ${accent} 352deg, ${accent}00 353deg)`,
            WebkitMask:`radial-gradient(farthest-side, transparent calc(100% - ${ring}px - 0.5px), #000 calc(100% - ${ring}px))`,
            mask:`radial-gradient(farthest-side, transparent calc(100% - ${ring}px - 0.5px), #000 calc(100% - ${ring}px))`,
          }}/>
        </span>
      )}
    </div>
  );
};

const Pip = ({col, pulse=false, sz=6}) => (
  <span className={pulse?'pip-pulse':''} style={{
    width:sz, height:sz, borderRadius:'50%', background:col,
    display:'inline-block', flexShrink:0,
  }}/>
);

// ── CONTEXT MENU ─────────────────────────────────────────────
const CtxMenu = ({x, y, msg, onClose, onOpen, inChat = false}) => {
  const ref = React.useRef(null);
  // ── Confirm dialog state — when an item triggers a destructive action
  // we replace the menu body with a small inline confirmation panel
  // rather than spawning a native window.confirm() (matches the design
  // language of the user-profile-popup destructive flows).
  const [confirm, setConfirm] = React.useState(null);
  // Live blocked/muted flags so the menu icons reflect current state.
  // BLOCK_STORE notifies on every change so we re-render in lock-step
  // with the rest of the app.
  const [flags, setFlags] = React.useState(() => BLOCK_STORE.get(msg.id));
  React.useEffect(() => {
    const unsub = BLOCK_STORE.sub(() => setFlags({...BLOCK_STORE.get(msg.id)}));
    return unsub;
  }, [msg.id]);
  // Customer mark — the verified tick + Customers group. Read once when the
  // menu opens; setCustomerMark (bot-ui-enduser.jsx) does the optimistic
  // update and the server writes.
  const isMarkedCustomer = isCustomerMarked(msg);
  const isEscalatedConv  = !!(msg.escalated || msg.stage === 'escalated' || msg.stage === 'needs_help');

  // Esc backs out of the confirm step if it's open, otherwise closes.
  const confirmRef = React.useRef(null); confirmRef.current = confirm;
  useCtxDismiss(ref, onClose, () => { if (!confirmRef.current) return false; setConfirm(null); return true; });
  const place = useCtxPlace(ref, x, y, [!!confirm]);

  // ── HANDLERS ───────────────────────────────────────────────────────
  // Each handler mutates client state optimistically and rolls back on
  // server failure — matches the user-profile-popup behaviour.

  const doBlock = async (next) => {
    BLOCK_STORE.set(msg.id, { blocked: next });
    try {
      const res = await apiFetch('set_end_user_block', { conv_id: msg.id, blocked: next ? 1 : 0 });
      if (res && res.error) {
        BLOCK_STORE.set(msg.id, { blocked: !next });
        bcToast('Couldn’t ' + (next ? 'block ' : 'unblock ') + (msg.name || 'this contact') + ' — ' + res.error, 'err');
      } else {
        if (res && res.platform && res.chat_id && window.BotBridge) {
          try {
            if (next) window.BotBridge.blockUser   && window.BotBridge.blockUser(res.platform, res.chat_id);
            else      window.BotBridge.unblockUser && window.BotBridge.unblockUser(res.platform, res.chat_id);
          } catch(_){}
        }
        bcToast((msg.name || 'Contact') + (next ? ' blocked' : ' unblocked'), 'ok');
      }
    } catch (e) {
      BLOCK_STORE.set(msg.id, { blocked: !next });
      bcToast('Network error — ' + (msg.name || 'the contact') + ' was not ' + (next ? 'blocked' : 'unblocked'), 'err');
    }
  };

  const doMute = async (next) => {
    BLOCK_STORE.set(msg.id, { muted: next });
    try {
      const res = await apiFetch('set_end_user_mute', { conv_id: msg.id, muted: next ? 1 : 0 });
      if (res && res.error) {
        BLOCK_STORE.set(msg.id, { muted: !next });
        bcToast('Couldn’t ' + (next ? 'mute ' : 'unmute ') + (msg.name || 'this contact') + ' — ' + res.error, 'err');
      } else {
        bcToast((msg.name || 'Contact') + (next ? ' muted' : ' unmuted'), 'ok');
      }
    } catch (e) {
      BLOCK_STORE.set(msg.id, { muted: !next });
      bcToast('Network error — ' + (msg.name || 'the contact') + ' was not ' + (next ? 'muted' : 'unmuted'), 'err');
    }
  };

  const copyHandle = () => {
    const text = msg.handle || msg.id || '';
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(() => bcToast('Copied', 'ok', { detail: text }))
          .catch(() => bcToast('Couldn’t copy', 'err'));
      } else {
        // Fallback for environments without async clipboard API.
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); bcToast('Copied', 'ok', { detail: text }); } catch(_) {}
        document.body.removeChild(ta);
      }
    } catch (_) {}
  };

  // Both delete paths end in MSGS_STORE.removeConversation, which forgets
  // the contact on this page AND announces it ('bc-conv-removed'). That
  // announcement is the fix for "the contact is gone but the chat stays
  // open": the open chat hears it, plays its exit and returns to the home
  // screen, and the Back history drops the contact.
  const name = msg.name || msg.handle || 'Contact';
  const doDeleteConv = async () => {
    try {
      const res = await apiFetch('delete_conversation', { id: msg.id });
      if (res && res.error) { bcToast('Couldn’t delete ' + name + ' — ' + res.error, 'err'); return; }
      MSGS_STORE.removeConversation(msg.id);
      bcToast(name + ' removed from your contacts', 'ok');
    } catch (e) {
      bcToast('Network error — ' + name + ' was not deleted', 'err');
    }
  };

  // Full reset — same as the user-profile popup's "Reset Customer" (wipes
  // messages, AI memory, profile, purchases, invoices, audits), then the
  // conversation row itself.
  const doDeleteWithWipe = async () => {
    try {
      const resetRes = await apiFetch('reset_end_user', { conv_id: msg.id });
      if (resetRes && resetRes.error) { bcToast('Couldn’t wipe ' + name + ' — ' + resetRes.error, 'err'); return; }
      const delRes = await apiFetch('delete_conversation', { id: msg.id });
      if (delRes && delRes.error) {
        // History is already gone; only the listing remains server-side.
        console.warn('[ctx-delete] reset OK but delete_conversation failed:', delRes.error);
      }
      MSGS_STORE.removeConversation(msg.id);
      bcToast(name + ' and all their data deleted', 'ok');
    } catch (e) {
      bcToast('Network error during delete + wipe', 'err');
    }
  };

  const requestDelete = () => {
    setConfirm({
      title: 'Delete ' + name + '?',
      choices: [
        { icon: 'userx', label: 'Remove from list', sub: 'Messages and purchases stay on record.',
          fn: () => { setConfirm(null); doDeleteConv(); onClose(); } },
        { icon: 'trash', label: 'Delete and wipe', sub: 'Also erases messages, profile, purchases and AI memory.', danger: true,
          fn: () => { setConfirm(null); doDeleteWithWipe(); onClose(); } },
      ],
    });
  };

  const isBlocked = !!flags.blocked;
  const isMuted   = !!flags.muted;

  // ── DIRECT-CHAT CONTACTS ──────────────────────────────────────────
  // Same menu, same confirm panel; the actions go through DM_STORE / DM_AI
  // because a direct chat isn't a platform conversation.
  const isDirect = !!msg.__direct;
  const dmTid = isDirect ? Number(msg.threadId) : 0;
  const dmTh = isDirect && typeof DM_STORE !== 'undefined' ? DM_STORE.threads.get(dmTid) : null;
  const dmEff = isDirect && typeof DM_AI !== 'undefined' ? DM_AI.effective(dmTid) : null;
  const dmHold = isDirect && typeof DM_AI !== 'undefined' && DM_AI.holdOf ? DM_AI.holdOf(dmTid) : null;
  const requestDmDelete = () => {
    setConfirm({
      title: 'Delete ' + name + '?',
      choices: [
        { icon: 'userx', label: 'Remove from list', sub: 'They keep their copy. Purchases stay on record.',
          fn: async () => {
            setConfirm(null); onClose();
            if (await DM_STORE.hide(dmTid)) bcToast(name + ' removed from your contacts', 'ok');
          } },
        { icon: 'trash', label: 'Delete and wipe', sub: 'Also erases their profile, purchases, AI memory and unpaid invoices.', danger: true,
          fn: async () => {
            setConfirm(null); onClose();
            if (await DM_STORE.wipe(dmTid)) bcToast(name + ' and all their data deleted', 'ok');
          } },
      ],
    });
  };
  const dmGroups = !isDirect ? null : [
    [
      ...(inChat ? [] : [{icon:'chat', label:'Open chat', fn:()=>{ onOpen(msg); }}]),
      ...(dmTh && dmTh.unread > 0 ? [{icon:'checks', label:'Mark as read', fn:()=>{ DM_STORE.markRead(dmTid); onClose(); }}] : []),
    ],
    ...(dmEff && dmEff.agent ? [[
      ...(dmHold && dmHold.kind === 'escalated' ? [
        {icon:'resume', label:'Resume agent', fn:()=>{ DM_AI.resume(dmTid).catch(e => bcToast(String(e.message || e), 'err')); onClose(); }},
      ] : []),
      {icon:'agentoff', label: dmEff.auto ? 'Don’t answer this chat' : 'Unassign ' + (dmEff.agent.name || 'agent'),
        fn:()=>{ DM_AI.assign(dmTid, 0).catch(e => bcToast(String(e.message || e), 'err')); onClose(); }},
    ]] : []),
    [
      {icon:'copy', label:'Copy handle', fn:()=>{ copyHandle(); onClose(); }},
    ],
    [
      {icon: dmTh && dmTh.blocked ? 'unblock' : 'block', label: dmTh && dmTh.blocked ? 'Unblock user' : 'Block user',
        fn:()=>{ DM_STORE.block(dmTid, !(dmTh && dmTh.blocked)); onClose(); }, d: !(dmTh && dmTh.blocked)},
      {icon:'trash', label:'Delete contact…', fn:()=>{ requestDmDelete(); }, d:true},
    ],
  ].filter(g => g.length);

  const groups = dmGroups || [
    [
      {icon:'chat',   label:'Open chat',      fn:()=>{ onOpen(msg); }},
      {icon:'search', label:'Search in chat', fn:()=>{ try { window.dispatchEvent(new CustomEvent('bc-open-chat-search', { detail: { convId: msg.id } })); } catch(_){} onClose(); }},
    ],
    [
      // Replaces the "Verified customer" switch from the old profile popup.
      {icon: isMarkedCustomer ? 'userx' : 'check', label: isMarkedCustomer ? 'Remove customer mark' : 'Mark as customer',
        fn:()=>{ setCustomerMark(msg.id, !isMarkedCustomer); onClose(); }},
      ...(isEscalatedConv ? [
        {icon:'resume', label:'Resolve & resume AI', fn:()=>{ resolveConversationEscalation(msg.id); onClose(); }},
      ] : []),
    ],
    [
      {icon: isMuted ? 'bell' : 'belloff', label: isMuted ? 'Unmute' : 'Mute', fn:()=>{ doMute(!isMuted); onClose(); }},
      {icon:'copy', label:'Copy handle', fn:()=>{ copyHandle(); onClose(); }},
    ],
    [
      {icon: isBlocked ? 'unblock' : 'block', label: isBlocked ? 'Unblock user' : 'Block user', fn:()=>{ doBlock(!isBlocked); onClose(); }, d: !isBlocked},
      {icon:'trash', label:'Delete contact…', fn:()=>{ requestDelete(); }, d:true},
    ],
  ];

  // CONFIRM SUB-STATE — replaces the menu body: the contact, then each way
  // to go as its own row with one line on what it does, and Cancel.
  if (confirm) {
    return (
      <div className="ctx ctx-wide" style={place} ref={ref} role="dialog" aria-label={confirm.title}>
        <div className="ctx-top">
          <Ava name={msg.name} col={msg.col} sz={26} src={msg.avatar}/>
          <div className="ctx-confirm-t">{confirm.title}</div>
        </div>
        <div className="ctx-line"/>
        <div className="ctx-choices">
          {confirm.choices.map((c, i) => (
            <button key={i} type="button" className={'ctx-choice' + (c.danger ? ' ctx-del' : '')} onClick={c.fn}>
              <CtxIco name={c.icon}/>
              <span className="ctx-choice-txt">
                <span className="ctx-choice-l">{c.label}</span>
                <span className="ctx-choice-s">{c.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="ctx-cancel" onClick={() => setConfirm(null)}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="ctx" style={place} ref={ref} role="menu" aria-label={`${msg.name || 'Contact'} actions`}>
      <div className="ctx-top">
        <Ava name={msg.name} col={msg.col} sz={26} src={msg.avatar}/>
        <div style={{minWidth:0}}>
          <div className="ctx-top-name">{msg.name}</div>
          {msg.handle && <div className="ctx-top-sub">{msg.handle}</div>}
        </div>
      </div>
      {groups.map((g,gi)=>(
        <React.Fragment key={gi}>
          <div className="ctx-line"/>
          {g.map((item,i)=>(
            <CtxRow key={i} icon={item.icon} label={item.label} danger={!!item.d} onClick={item.fn}/>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
};

// ── ANCHORED CHAT WINDOW (Facebook messenger style) ─────────
// ── Per-conversation AI controls ─────────────────────────────
// Compact strip used in both the popup chat header and the in-page detail
// header. Lets the user (a) flip auto-reply on/off for THIS conversation, and
// (b) reassign the conversation to a different agent. Both are persisted
// instantly so a stop-the-bot click takes effect on the very next inbound.
const ConvAiControls = ({msg, compact=false}) => {
  const agents = useAgents();
  const [open, setOpen] = React.useState(false);
  // We mirror the bool locally for instant feedback while the API call is in
  // flight. MSGS_STORE.notify() will reconcile if the request fails.
  const [auto, setAuto] = React.useState(!!msg.auto_reply);
  React.useEffect(()=>{ setAuto(!!msg.auto_reply); },[msg.auto_reply, msg.id]);
  const currentAgent = agents.find(a=>a.id===msg.agent_id) || null;
  const wrapRef = React.useRef(null);
  const trigRef = React.useRef(null);
  // The pop-out chat window clips its children (overflow:hidden), so a
  // normally-positioned absolute dropdown gets cut off and becomes
  // unusable. We anchor the menu with position:fixed against the trigger's
  // viewport rect instead, escaping the clip entirely.
  const [menuPos, setMenuPos] = React.useState(null);
  const placeMenu = React.useCallback(() => {
    const el = trigRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 236;
    let left = r.right - W;                       // right-align to trigger
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
    setMenuPos({ top: Math.round(r.bottom + 6), left: Math.round(left), width: W });
  }, []);

  // Close the agent picker when clicking outside.
  React.useEffect(()=>{
    if (!open) return;
    const h = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', h);
    return ()=>window.removeEventListener('mousedown', h);
  },[open]);

  // Re-anchor the fixed menu on open and whenever the window scrolls/resizes.
  React.useLayoutEffect(()=>{
    if (!open) return;
    placeMenu();
    const onScroll = () => placeMenu();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return ()=>{
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKey);
    };
  },[open, placeMenu]);

  const toggleAuto = (e) => {
    e.stopPropagation();
    const next = !auto;
    setAuto(next);
    msg.auto_reply = next;        // mutate the row so MSGS_STORE keeps it
    // Mark this conversation as operator-controlled so the inbound
    // backfill in MSGS_STORE.onIncoming doesn't silently revert the
    // toggle on the customer's next message.
    msg._operatorOverride = true;
    apiFetch('set_auto_reply', { id: msg.id, on: next ? 1 : 0 });
    // BUGFIX: when turning AI off, also discard any pending draft so the
    // engine unblocks immediately. Otherwise a stuck draft can keep the
    // operator staring at a "pending" pill that never clears.
    if (!next && DRAFT_STORE.get(msg.id)) {
      DRAFT_STORE.discard(msg.id);
    }
    MSGS_STORE.notify();
  };
  // Assign / unassign from the inbox row.
  //
  // This used to set agent_id and agent and stop there — no auto_reply, no
  // operator-assign notice to the store, no clearing of the flags that keep
  // an agent quiet. So which control you happened to click decided whether
  // a re-assignment actually worked: the chat header did the full job, this
  // one produced an agent that was named in the UI and permanently silent.
  // Both now call the single store path, which does every part of it.
  const pickAgent = (a) => (e) => {
    e.stopPropagation();
    MSGS_STORE.assignAgent(msg, a || null);
    setAuto(!!a);
    setOpen(false);
  };

  const fontSize = compact ? 10 : 10.5;
  const padY     = compact ? 4 : 5;
  return (
    <div ref={wrapRef} onClick={e=>e.stopPropagation()} style={{display:'flex',alignItems:'center',gap:compact?3:6,flexShrink:0}}>
      {/* AI auto-reply — subtle sparkle glyph (filled & glowing when on, hollow when off) */}
      <button onClick={toggleAuto}
        title={auto?'AI auto-reply is ON for this chat — click to pause':'AI auto-reply is OFF — click to enable'}
        aria-label={auto?'AI auto-reply on':'AI auto-reply off'}
        style={{
          width:compact?22:24, height:compact?22:24,
          display:'flex',alignItems:'center',justifyContent:'center',
          padding:0,borderRadius:'50%',cursor:'pointer',transition:'all 0.18s cubic-bezier(0.4,0,0.2,1)',
          background: auto
            ? 'radial-gradient(circle at 30% 30%, rgba(108,99,255,0.32), rgba(108,99,255,0.08) 70%)'
            : 'rgba(255,255,255,0.035)',
          border: `1px solid ${auto ? 'rgba(140,130,255,0.45)' : 'rgba(255,255,255,0.08)'}`,
          color: auto ? 'rgb(180,170,255)' : 'rgba(150,150,180,0.55)',
          boxShadow: auto ? '0 0 14px rgba(108,99,255,0.35), 0 0 0 0.5px rgba(140,130,255,0.2) inset' : 'none',
        }}
        onMouseEnter={e=>{ if (!auto) { e.currentTarget.style.background='rgba(255,255,255,0.06)'; e.currentTarget.style.color='rgba(190,190,220,0.85)'; } }}
        onMouseLeave={e=>{ if (!auto) { e.currentTarget.style.background='rgba(255,255,255,0.035)'; e.currentTarget.style.color='rgba(150,150,180,0.55)'; } }}>
        <svg width={compact?13:14} height={compact?13:14} viewBox="0 0 24 24"
          fill="none" stroke="currentColor"
          strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
          style={{transition:'all 0.18s'}}>
          <g><line x1="12" y1="3" x2="12" y2="6"/><circle cx="12" cy="2.6" r="1" fill="currentColor" stroke="none"/><rect x="5" y="6" width="14" height="13" rx="3"/><circle cx="9.2" cy="12.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="14.8" cy="12.5" r="1.4" fill="currentColor" stroke="none"/><line x1="3" y1="13" x2="5" y2="13"/><line x1="19" y1="13" x2="21" y2="13"/></g>
        </svg>
      </button>

            {/* Agent picker — borderless when used inside the header
                cluster so it integrates cleanly with the surrounding
                pill; falls back to a bordered chip elsewhere. */}
      <div style={{position:'relative'}}>
        <button ref={trigRef} onClick={e=>{e.stopPropagation();setOpen(o=>!o);}} title="Assign agent"
          style={{
            display:'flex',alignItems:'center',gap:4,padding: compact ? '3px 6px 3px 8px' : `${padY}px 8px`,
            fontSize, fontWeight:500, lineHeight:1,
            borderRadius: compact ? 999 : 6, cursor:'pointer', transition:'all 0.12s', maxWidth:140,
            background: compact ? 'transparent' : 'rgba(255,255,255,0.04)',
            color:'var(--t2)',
            border: compact ? 'none' : '1px solid rgba(255,255,255,0.08)',
          }}
          onMouseEnter={e=>{if(compact)e.currentTarget.style.background='rgba(255,255,255,0.06)';e.currentTarget.style.color='var(--t1)';}}
          onMouseLeave={e=>{if(compact)e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--t2)';}}>
          <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {currentAgent ? currentAgent.name : 'No agent'}
          </span>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,opacity:0.6}}><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {open && menuPos && (
          <div
            role="menu"
            style={{
              position:'fixed', top:menuPos.top, left:menuPos.left, width:menuPos.width,
              maxHeight:320, zIndex:2147483000,
              background:'rgba(16,17,28,0.97)',
              backdropFilter:'blur(28px) saturate(180%)',
              WebkitBackdropFilter:'blur(28px) saturate(180%)',
              border:'1px solid rgba(255,255,255,0.08)',
              borderRadius:14,
              boxShadow:'0 18px 44px -10px rgba(0,0,0,0.75), 0 4px 14px -4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
              display:'flex', flexDirection:'column', overflow:'hidden',
              transformOrigin:'top right',
              animation:'convAiMenuIn 150ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}>
            {/* Section label */}
            <div style={{
              padding:'10px 12px 6px', fontSize:10, fontWeight:700, letterSpacing:'0.08em',
              color:'var(--t4)', textTransform:'uppercase', flexShrink:0,
            }}>Assign Agent</div>

            {/* Scrollable agent list */}
            <div style={{flex:1, overflowY:'auto', padding:'0 6px 6px'}}>
              {agents.length === 0 && (
                <div style={{
                  display:'flex', flexDirection:'column', alignItems:'center', gap:8,
                  padding:'18px 12px 14px', textAlign:'center',
                }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(180,180,200,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="3" x2="12" y2="6"/>
                    <circle cx="12" cy="2.6" r="0.9" fill="rgba(180,180,200,0.35)" stroke="none"/>
                    <rect x="5" y="6" width="14" height="13" rx="3"/>
                    <circle cx="9.2" cy="12.5" r="1.2" fill="rgba(180,180,200,0.35)" stroke="none"/>
                    <circle cx="14.8" cy="12.5" r="1.2" fill="rgba(180,180,200,0.35)" stroke="none"/>
                    <line x1="3" y1="13" x2="5" y2="13"/><line x1="19" y1="13" x2="21" y2="13"/>
                  </svg>
                  <span style={{fontSize:11, color:'var(--t3)'}}>No agents configured yet.</span>
                </div>
              )}
              {agents.map(a=>{
                const sel  = a.id === msg.agent_id;
                const tone = agentTone(a);
                return (
                  <button key={a.id} onClick={pickAgent(a)} role="menuitem"
                    style={{
                      width:'100%', display:'flex', alignItems:'center', gap:10,
                      padding:'8px 8px', borderRadius:9, marginBottom:2,
                      border:`1px solid ${sel ? tone.border : 'transparent'}`,
                      background: sel ? tone.bgSel : 'transparent',
                      color:'var(--t1)', cursor:'pointer', textAlign:'left',
                      transition:'background 0.12s, border-color 0.12s',
                    }}
                    onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='rgba(255,255,255,0.05)'; }}
                    onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='transparent'; }}>
                    <span style={{
                      width:8, height:8, borderRadius:'50%', flexShrink:0,
                      background: a.active ? 'rgb(67,201,138)' : 'rgba(255,255,255,0.2)',
                      boxShadow: a.active ? '0 0 5px rgba(67,201,138,0.55)' : 'none',
                    }}/>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{
                        fontSize:12.5, fontWeight:600, lineHeight:1.15, color:'var(--t1)',
                        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', letterSpacing:'-0.01em',
                      }}>{a.name}</div>
                      <div style={{
                        fontSize:10, color:'var(--t4)', marginTop:2, lineHeight:1,
                        whiteSpace:'nowrap', overflow:'hidden',
                        display:'flex', alignItems:'center', gap:4,
                      }}>
                        <span style={{color: TIER_COLOR[modelTier(a.model)], fontSize:9.5}}>{TIER_GLYPH[modelTier(a.model)]}</span>
                        <span>{modelLabel(a.model)}</span>
                      </div>
                    </div>
                    {sel && (
                      <span style={{
                        fontSize:8.5, fontWeight:700, letterSpacing:'0.08em',
                        color: tone.text, flexShrink:0, padding:'2px 7px', borderRadius:999,
                        background:`hsla(${tone.h}, 60%, 55%, 0.16)`,
                        border:`1px solid hsla(${tone.h}, 60%, 55%, 0.32)`,
                      }}>ACTIVE</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Unassign — only shown when an agent is currently assigned */}
            {currentAgent && (
              <div style={{borderTop:'1px solid rgba(255,255,255,0.06)', padding:'6px 6px 8px', flexShrink:0}}>
                <button onClick={pickAgent(null)}
                  style={{
                    width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                    padding:'7px 8px', borderRadius:9,
                    background:'rgba(255,69,58,0.05)', border:'1px solid rgba(255,69,58,0.14)',
                    color:'rgba(255,140,130,0.92)', fontSize:11, fontWeight:600, cursor:'pointer',
                    transition:'background 0.12s, border-color 0.12s',
                  }}
                  onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,69,58,0.12)';e.currentTarget.style.borderColor='rgba(255,69,58,0.28)';}}
                  onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,69,58,0.05)';e.currentTarget.style.borderColor='rgba(255,69,58,0.14)';}}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                  Unassign agent
                </button>
              </div>
            )}
            <style>{`@keyframes convAiMenuIn{from{opacity:0;transform:translateY(-4px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>
          </div>
        )}
      </div>
    </div>
  );
};

// ── AGENT IDENTITY HELPERS ───────────────────────────────────
// Premium bot-selector identity layer. Used by InPageChat's AI menu
// to turn each agent into a recognisable entity (monogram avatar +
// stable tone color + humanised model label) instead of an anonymous
// row in a list. All pure / deterministic — same agent always gets
// the same color so operators build muscle memory.

// Curated palette of 10 hues with no adjacent collisions when sorted.
// Index by stable name-hash so renames change color (rare and acceptable).
const AGENT_HUES = [262, 198, 168, 28, 340, 218, 142, 8, 290, 48];
const agentTone = (agent) => {
  const name = (agent && agent.name) || '?';
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed = (seed + name.charCodeAt(i)) | 0;
  const h = AGENT_HUES[Math.abs(seed) % AGENT_HUES.length];
  return {
    h,
    ring:   `hsl(${h} 70% 62%)`,
    ringDk: `hsl(${h} 60% 48%)`,
    glow:   `hsla(${h}, 70%, 62%, 0.35)`,
    bgSel:  `hsla(${h}, 60%, 55%, 0.14)`,
    border: `hsla(${h}, 60%, 55%, 0.32)`,
    text:   `hsl(${h} 70% 72%)`,
  };
};
const agentInitials = (name) => {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  const a = (parts[0] || '?')[0] || '?';
  const b = (parts[1] || '')[0] || '';
  return (a + b).toUpperCase().slice(0, 2);
};

// Friendly model labels + perceived tier (drives the small tier glyph).
// Falls through to the raw model id with tier=standard for anything
// not in the library, so adding new providers is non-breaking.
const MODEL_LIBRARY = {
  // Anthropic
  'claude-opus-4-7':       { label: 'Opus 4.7',    tier: 'flagship' },
  'claude-opus-4-6':       { label: 'Opus 4.6',    tier: 'flagship' },
  'claude-sonnet-4-6':     { label: 'Sonnet 4.6',  tier: 'standard' },
  'claude-sonnet-4-5':     { label: 'Sonnet 4.5',  tier: 'standard' },
  'claude-haiku-4-5':      { label: 'Haiku 4.5',   tier: 'fast' },
  // OpenAI
  'gpt-5':                 { label: 'GPT-5',       tier: 'flagship' },
  'gpt-4o':                { label: 'GPT-4o',      tier: 'standard' },
  'gpt-4-turbo':           { label: 'GPT-4 Turbo', tier: 'standard' },
  'gpt-4o-mini':           { label: 'GPT-4o mini', tier: 'fast' },
  'gpt-3.5-turbo':         { label: 'GPT-3.5',     tier: 'fast' },
  // Google
  'gemini-2.5-pro':        { label: 'Gemini 2.5',  tier: 'flagship' },
  'gemini-2.0-pro':        { label: 'Gemini 2.0',  tier: 'standard' },
  'gemini-1.5-flash':      { label: 'Flash 1.5',   tier: 'fast' },
};
const modelLabel = (m) => (MODEL_LIBRARY[m] && MODEL_LIBRARY[m].label) || m || '—';
const modelTier  = (m) => (MODEL_LIBRARY[m] && MODEL_LIBRARY[m].tier)  || 'standard';
const TIER_GLYPH = { flagship: '✦', standard: '◆', fast: '⚡' };
const TIER_COLOR = {
  flagship: 'rgb(220,200,140)', // soft champagne
  standard: 'var(--t4)',
  fast:     'rgb(140,200,220)', // pale cyan
};

// Reusable monogram avatar — used in dropdown rows AND header.
// `size` controls the diameter; `pulse` adds the active green status
// dot at bottom-right + a soft halo when the agent is currently active.
const AgentAvatar = ({agent, size = 22, pulse = false}) => {
  const tone = agentTone(agent);
  const fontSize = Math.max(8.5, size * 0.42);
  const dotSize  = Math.max(6, size * 0.30);
  return (
    <div style={{
      position:'relative', width:size, height:size, borderRadius:'50%', flexShrink:0,
      display:'flex', alignItems:'center', justifyContent:'center',
      background: `linear-gradient(135deg, ${tone.ring} 0%, ${tone.ringDk} 100%)`,
      color:'#fff', fontSize, fontWeight:800, letterSpacing:'0.02em',
      boxShadow: pulse
        ? `0 0 0 1.5px rgba(15,16,30,0.95), 0 0 10px ${tone.glow}, inset 0 1px 0 rgba(255,255,255,0.22)`
        : `0 0 0 1.5px rgba(15,16,30,0.95), inset 0 1px 0 rgba(255,255,255,0.18)`,
      userSelect:'none',
    }}>
      {agentInitials(agent && agent.name)}
      {pulse && (
        <span style={{
          position:'absolute', right: -1, bottom: -1,
          width: dotSize, height: dotSize, borderRadius:'50%',
          background:'rgb(67,201,138)',
          border:'1.5px solid rgba(15,16,30,0.95)',
          boxShadow:'0 0 5px rgba(67,201,138,0.55)',
        }}/>
      )}
    </div>
  );
};

// ── Per-conversation scroll position cache ───────────────────
// Keyed by conv id → either SCROLL_AT_BOTTOM (the operator was reading the
// newest messages) or a scrollTop in px (they had deliberately scrolled up
// to read something older). Lives for the session only.
//
// Why a sentinel instead of "the pixel value that happened to be the bottom
// at the time": by the time the conversation is reopened the thread is
// usually taller — history paged in, replies arrived while it was closed —
// so the old number is no longer the bottom and dropped the view short of
// it, sometimes near the top on a long chat. The sentinel means "wherever
// the end is now", which is what the operator actually asked for.
//
// A px value is only ever written for a scroll the OPERATOR made. Our own
// auto-scrolls, and the position applied on entry, never create one; that
// is what makes "open at the bottom unless I chose otherwise" hold.
const SCROLL_AT_BOTTOM = 'bottom';
const SCROLL_POS_CACHE = new Map();

// A freshly opened conversation whose history has not arrived yet holds at
// most the inbox preview as a single placeholder bubble (real rows always
// carry a timestamp). Showing that lone bubble and then replacing it with
// forty real ones is the flash we hide behind the entry mask.
const threadAwaitingHistory = (arr) => !!arr && arr.length === 1 && !arr[0].ts;

// ── THREAD SKELETON ─────────────────────────────────────────────────────
// What a chat shows while its history is on the way: a few quiet bubble
// outlines where the newest messages will land, with a slow sheen across
// them. It sits over the (hidden) thread in the same column, bottom-aligned
// like the real thread, so the messages replace it in place.
//
// It never mounts or unmounts on its own — maskThread / showThread flip
// data-on directly. It only fades in after 180ms, so a chat that loads
// quickly goes straight from nothing to its messages and never flashes it.
let _skelCss = false;
const ensureThreadSkeletonStyles = () => {
  if (_skelCss || typeof document === 'undefined') return;
  _skelCss = true;
  const st = document.createElement('style');
  st.id = 'bc-thread-skel';
  st.textContent = `
.ipc-skel { position: absolute; left: 0; right: 0; top: 56px; bottom: 90px; z-index: 2; pointer-events: none;
  display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden;
  padding: 0 var(--thread-pad-x, 20px) var(--thread-pad-y, 16px);
  opacity: 0; visibility: hidden; transition: opacity 120ms ease, visibility 0s linear 120ms; }
.ipc-skel[data-on="1"] { opacity: 1; visibility: visible; transition: opacity 260ms ease 180ms, visibility 0s linear 0s; }
.ipc-skel .ipc-body { display: flex; flex-direction: column; gap: 2px; }
.ipc-skel-row { display: flex; align-items: flex-end; gap: 8px; }
.ipc-skel-row[data-side="r"] { flex-direction: row-reverse; }
.ipc-skel-row + .ipc-skel-row[data-gs="1"] { margin-top: 10px; }
.ipc-skel-ava { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; background: rgba(255,255,255,0.04); }
.ipc-skel-ava[data-hide="1"] { visibility: hidden; }
.ipc-skel-bub { position: relative; overflow: hidden; height: 34px; border-radius: 18px;
  background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.04); }
.ipc-skel-row[data-side="l"] .ipc-skel-bub { border-bottom-left-radius: 5px; }
.ipc-skel-row[data-side="r"] .ipc-skel-bub { border-bottom-right-radius: 5px;
  background: color-mix(in oklab, var(--acc, #6c63ff) 6%, rgba(255,255,255,0.03)); }
.ipc-skel-row[data-gs="0"][data-side="l"] .ipc-skel-bub { border-top-left-radius: 5px; }
.ipc-skel-row[data-gs="0"][data-side="r"] .ipc-skel-bub { border-top-right-radius: 5px; }
.ipc-skel-bub[data-tall="1"] { height: 54px; }
/* The sheen: one gradient band sliding across each outline. Transform
   only, so it is composited and costs nothing on the main thread. */
.ipc-skel-bub::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.045) 50%, transparent 100%);
  animation: bc-skel-sheen 1.6s cubic-bezier(.4,0,.2,1) infinite; }
.ipc-skel-row:nth-child(2) .ipc-skel-bub::after { animation-delay: .08s; }
.ipc-skel-row:nth-child(3) .ipc-skel-bub::after { animation-delay: .16s; }
.ipc-skel-row:nth-child(4) .ipc-skel-bub::after { animation-delay: .24s; }
.ipc-skel-row:nth-child(5) .ipc-skel-bub::after { animation-delay: .32s; }
.ipc-skel-row:nth-child(6) .ipc-skel-bub::after { animation-delay: .40s; }
.ipc-skel[data-on="0"] .ipc-skel-bub::after { animation: none; }
@keyframes bc-skel-sheen { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .ipc-skel-bub::after { animation: none; } }
html[data-motion="reduced"] .ipc-skel-bub::after { animation: none; }`;
  document.head.appendChild(st);
};
// side, width (% of the column), group start, tall, avatar shown
const THREAD_SKEL_ROWS = [
  ['l', 46, 1, 0, 0], ['l', 30, 0, 0, 1],
  ['r', 52, 1, 1, 1],
  ['l', 38, 1, 0, 0], ['l', 58, 0, 1, 1],
  ['r', 34, 1, 0, 1],
];
const ThreadSkeleton = React.memo(function ThreadSkeleton({skelRef}) {
  ensureThreadSkeletonStyles();
  return (
    <div className="ipc-skel" ref={skelRef} data-on="0" aria-hidden="true">
      <div className="ipc-body">
        {THREAD_SKEL_ROWS.map(([side, w, gs, tall, ava], i) => (
          <div key={i} className="ipc-skel-row" data-side={side} data-gs={gs ? '1' : '0'}>
            <span className="ipc-skel-ava" data-hide={ava ? '0' : '1'}/>
            <span className="ipc-skel-bub" data-tall={tall ? '1' : '0'} style={{width: w + '%'}}/>
          </div>
        ))}
      </div>
    </div>
  );
});

// ── AGENT MARK + AGENT PICKER ───────────────────────────────────────────
// The header's agent control and its menu. A simple mark (a rounded head
// with two eyes — no antenna, no ears, no glow), accent-derived colours
// and one small status dot, so it reads as part of the app rather than a
// sticker on it.
const AgentMark = ({size = 14}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="6" width="16" height="13" rx="4.5"/>
    <path d="M12 3.2v2.8"/>
    <circle cx="9.3" cy="12.4" r="1.15" fill="currentColor" stroke="none"/>
    <circle cx="14.7" cy="12.4" r="1.15" fill="currentColor" stroke="none"/>
  </svg>
);
let _agtCss = false;
const ensureAgentPickerStyles = () => {
  if (_agtCss || typeof document === 'undefined') return;
  _agtCss = true;
  const st = document.createElement('style');
  st.id = 'bc-agent-picker';
  st.textContent = `
/* ── The agent bubble ──
   Detached from the identity pill, sitting just to its right (absolutely,
   so the pill never shifts to make room for it).
   • Agent attached: a small round bubble with the agent mark and a status
     dot. Hover (or focus, or the menu being open) widens it to show the
     agent's name and a chevron.
   • No agent: nothing is shown until the pointer is on the pill; then a
     faint "assign an agent" bubble fades in beside it. */
.bc-agb { position: absolute; left: calc(100% + 6px); top: 0; height: 32px; min-width: 32px;
  display: inline-flex; align-items: center; justify-content: center; gap: 0; padding: 0 8px;
  border-radius: 999px; border: 1px solid rgba(255,255,255,0.08); cursor: pointer; font: inherit;
  background: rgba(255,255,255,0.04); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  box-shadow: 0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06);
  color: color-mix(in oklab, var(--acc, #6c63ff) 40%, #d6d7e3); white-space: nowrap;
  transition: background-color .18s ease, border-color .18s ease, color .18s ease, opacity .18s ease, transform .22s cubic-bezier(.16,1,.3,1); }
/* Bridges the 6px gap so moving from the pill to the bubble keeps the hover. */
.bc-agb::before { content: ''; position: absolute; top: 0; bottom: 0; left: -8px; width: 8px; }
.bc-agb:hover, .bc-agb[data-open="1"], .bc-agb:focus-visible { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.13); color: var(--t1); }
.bc-agb:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 50%, transparent); }
.bc-agb-ico { position: relative; display: inline-flex; flex-shrink: 0; }
.bc-agb-dot { position: absolute; right: -2px; bottom: -1px; width: 5px; height: 5px; border-radius: 50%;
  background: rgba(150,152,170,0.75); box-shadow: 0 0 0 1.5px rgba(18,19,28,0.95); }
.bc-agb-dot[data-live="1"] { background: color-mix(in oklab, var(--ok, #30d158) 70%, #a6aab4); }
.bc-agb-more { display: inline-flex; align-items: center; gap: 5px; max-width: 0; opacity: 0; overflow: hidden;
  transition: max-width .26s cubic-bezier(.16,1,.3,1), opacity .18s ease, margin-left .26s cubic-bezier(.16,1,.3,1); }
.bc-agb:hover .bc-agb-more, .bc-agb[data-open="1"] .bc-agb-more, .bc-agb:focus-visible .bc-agb-more {
  max-width: 140px; opacity: 1; margin-left: 7px; }
.bc-agb-name { font-size: 11.5px; font-weight: 500; letter-spacing: -0.005em; color: var(--t1);
  max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
.bc-agb-chev { flex-shrink: 0; opacity: .55; transition: transform .2s cubic-bezier(.16,1,.3,1); }
.bc-agb[data-open="1"] .bc-agb-chev { transform: rotate(180deg); }
/* No agent: hidden until the pill is hovered (or the menu is open). */
.bc-agb[data-on="0"] { color: var(--t3); border-style: dashed; border-color: rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.02); box-shadow: none;
  opacity: 0; transform: translateX(-4px) scale(.92); }
/* Revealed by hovering the pill OR the spot where the bubble sits (it stays
   hit-testable while invisible, so pointing at its place brings it in). */
.bc-idpill:hover .bc-agb[data-on="0"], .bc-agb[data-on="0"]:hover, .bc-agb[data-on="0"][data-open="1"], .bc-agb[data-on="0"]:focus-visible {
  opacity: 1; transform: none; }
.bc-agb[data-on="0"]:hover { color: var(--t1); border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); }
.bc-agb-plus { position: absolute; right: -3px; bottom: -2px; width: 8px; height: 8px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; background: rgba(18,19,28,1); color: currentColor; }

/* ── The agent menu — the app's own context-menu material (.ctx) ── */
.bc-agm { position: fixed; z-index: 9999; max-height: 320px; display: flex; flex-direction: column; overflow: hidden;
  background: rgba(16,17,28,0.98); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
  border: 1px solid var(--ln2, rgba(255,255,255,0.10)); border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.04) inset;
  animation: bc-agm-in 120ms ease both; }
@keyframes bc-agm-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
.bc-agm-head { padding: 9px 11px 7px; font-size: 11px; color: var(--t3); flex-shrink: 0; }
.bc-agm-line { height: 1px; background: var(--ln, rgba(255,255,255,0.055)); flex-shrink: 0; }
.bc-agm-list { flex: 1; overflow-y: auto; padding: 3px 0; }
.bc-agm-row { width: 100%; display: flex; align-items: center; gap: 9px; padding: 7px 11px; border: none; background: transparent;
  cursor: pointer; text-align: left; font: inherit; font-size: 12.5px; color: var(--t2); transition: background-color .08s, color .08s; }
.bc-agm-row:hover { background: rgba(255,255,255,0.05); color: var(--t1); }
.bc-agm-row[data-sel="1"] { color: var(--t1); }
.bc-agm-row:focus-visible { outline: none; background: rgba(255,255,255,0.06); color: var(--t1); }
.bc-agm-live { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; background: rgba(140,142,160,0.55); }
.bc-agm-live[data-live="1"] { background: color-mix(in oklab, var(--ok, #30d158) 70%, #a6aab4); }
.bc-agm-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bc-agm-model { flex-shrink: 0; max-width: 90px; font-size: 10.5px; color: var(--t4, #3a3a56); font-family: var(--mono);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bc-agm-row:hover .bc-agm-model { color: var(--t3); }
.bc-agm-check { flex-shrink: 0; width: 13px; display: inline-flex; color: var(--t2); }
.bc-agm-off { width: 100%; display: flex; align-items: center; gap: 9px; padding: 7px 11px; border: none; background: transparent;
  cursor: pointer; text-align: left; font: inherit; font-size: 12.5px; color: rgba(255,100,90,0.85); transition: background-color .08s, color .08s; }
.bc-agm-off:hover { background: rgba(255,69,58,0.1); color: var(--err, #ff453a); }
.bc-agm-foot { padding: 3px 0; flex-shrink: 0; }
@media (prefers-reduced-motion: reduce) { .bc-agm { animation: none; } .bc-agb, .bc-agb-more, .bc-agb-chev { transition: none; } }
html[data-motion="reduced"] .bc-agm { animation: none; }`;
  document.head.appendChild(st);
};

try { ensureAgentPickerStyles(); } catch (_) {}

// ── COMPOSER HEIGHT ─────────────────────────────────────────────────────
// The composer grows and shrinks with what it holds — a reply bar, an AI
// draft, a queue of follow-ups, attachments, a longer message. Its height
// is taken from its content (ResizeObserver) and applied to the panel, so
// every change animates instead of jumping. The panel is a bottom-anchored
// flex column, so while it catches up the input row stays put and the new
// content slides into view from above.
const COMPOSER_TRANSITION = [
  'transform .32s cubic-bezier(.32,.72,0,1)',
  'opacity .22s ease',
  'height .28s cubic-bezier(.2,.8,.2,1)',
  'max-width .32s cubic-bezier(.2,.8,.2,1)',
  'border-color .2s ease',
].join(', ');
const useComposerHeight = (wrapRef, innerRef) => {
  React.useLayoutEffect(() => {
    const w = wrapRef.current, inner = innerRef.current;
    if (!w || !inner || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      // + the panel's 1px top and bottom border (border-box sizing).
      const h = Math.ceil(inner.getBoundingClientRect().height) + 2;
      const cur = w.style.height;
      if (cur !== h + 'px') w.style.height = h + 'px';
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(inner);
    return () => { ro.disconnect(); w.style.height = ''; };
  }, [wrapRef, innerRef]);
};

// ── IN-PAGE CHAT PANEL ───────────────────────────────────────
// Queued-but-unsent attachments, per conversation. The text draft already
// survives a chat switch (INPUT_DRAFTS); files must too, or picking a
// six-file order out of Explorer and then glancing at another chat throws
// the whole selection away with nothing said.
const ATTACH_DRAFTS = new Map();

// ── FILE DROP OVERLAY ──
// Shown over a chat while files are dragged onto it (every chat, direct
// chats included). pointerEvents:'none' throughout. The drop itself is
// handled by the chat column, so the overlay must never become the event
// target — if it did, dragleave would fire the moment it appeared and the
// overlay would fight itself.
const ChatDropOverlay = () => (
  <div style={{
    position:'absolute', top:0, left:0, right:0, bottom:0, zIndex:14,
    pointerEvents:'none', display:'flex',
    alignItems:'center', justifyContent:'center', padding:24,
    background:'linear-gradient(180deg, rgba(14,15,28,0.52) 0%, rgba(14,15,28,0.70) 100%)',
    backdropFilter:'blur(7px)', WebkitBackdropFilter:'blur(7px)',
    animation:'bcDropFade 130ms ease',
  }}>
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center', gap:10,
      padding:'26px 34px', borderRadius:16, maxWidth:320, textAlign:'center',
      border:'1.5px dashed rgba(140,130,255,0.55)',
      background:'rgba(108,99,255,0.08)',
      boxShadow:'0 18px 50px -20px rgba(0,0,0,0.65)',
    }}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#bcb1ff"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="8 8 12 4 16 8"/><line x1="12" y1="4" x2="12" y2="16"/>
      </svg>
      <div style={{fontSize:14, fontWeight:600, color:'var(--t1)', letterSpacing:'-0.01em'}}>
        Drop to attach
      </div>
      <div style={{fontSize:11, color:'var(--t3)', lineHeight:1.5}}>
        Photos, video, audio or documents — up to {ATT_MAX_FILES} files,
        {' '}{prettyBytes(ATT_MAX_BYTES)} each
      </div>
    </div>
    <style>{`@keyframes bcDropFade { from { opacity: 0 } to { opacity: 1 } }`}</style>
  </div>
);

// ── Pin clipped chat containers ───────────────────────────────────
// .ipc and .ipc-chat-col are overflow:hidden. They have no scrollbar, but
// the browser can still scroll them — and does, whenever something focuses
// an element that sits outside the visible box (the composer while it's
// slid below the pane, or a layer that extends past the edge). Once that
// happens nothing scrolls them back: the header vanishes off the top and
// the composer floats halfway up the chat. Any such scroll is undone on
// the spot.
const pinClipScroll = (e) => {
  const el = e.currentTarget;
  if (el && (el.scrollTop || el.scrollLeft)) { el.scrollTop = 0; el.scrollLeft = 0; }
};

// First paint of a conversation: whatever the store already holds, else the
// inbox preview as a single placeholder bubble until history arrives.
const seedThreadFor = (msg) => {
  if (!msg) return [];
  if (typeof MSGS_STORE === 'undefined') return msg.last ? [{r:'in',c:msg.last,t:msg.t||'now'}] : [];
  const cached = MSGS_STORE.getThreadSync(msg.id);
  return cached.length ? [...cached] : (msg.last ? [{r:'in',c:msg.last,t:msg.t||'now'}] : []);
};

// ── MESSAGE MENU (right-click on a bubble) ─────────────────────────────
// Reply, edit, copy, open/save the attachment, delete for everyone, or
// remove from this chat — each offered only when the platform allows it,
// with a one-line reason when it doesn't. Uses the app's .ctx menu styling.
const bcCopyText = (text) => {
  const t = String(text || '');
  if (!t) return;
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fallback);
    else fallback();
  } catch (_) { fallback(); }
  bcToast('Copied', 'ok');
};

const MessageCtxMenu = ({x, y, ay, row, conv, onClose, onReply, onEdit}) => {
  const ref = React.useRef(null);
  const [confirm, setConfirm] = React.useState(null);   // 'everyone' | 'local'
  const caps = MSGS_STORE.capabilities(conv, row);
  const ref0 = MSGS_STORE.parseUid(row.uid);
  const text = String(row.c || '').replace(MEDIA_LABEL_RE, '').trim();
  const mediaKind = mediaKindOf(row.mt, row.mu);
  const fileName = attNameOf(row) || (row.mn || '');
  const isIn = row.r === 'in';
  const confirmRef = React.useRef(null); confirmRef.current = confirm;
  useCtxDismiss(ref, onClose, () => { if (!confirmRef.current) return false; setConfirm(null); return true; });
  const place = useCtxPlace(ref, x, y, [confirm], ay);

  // Why "Delete for everyone" / "Edit" is missing, in one line.
  let note = '';
  if (!row.del && !ref0) {
    note = (!isIn && row._local && !row.err)
      ? 'Still sending — actions unlock once it’s delivered.'
      : 'This message has no platform id (sent before this update), so it can only be removed here.';
  } else if (!row.del && ref0 && isIn && !caps.deleteEveryone && conv.p === 'discord') {
    note = 'Discord doesn’t let bots delete a customer’s DM.';
  } else if (row.del) {
    note = isIn ? 'The customer deleted this message.' : 'This message was deleted on the platform.';
  }

  if (confirm) {
    const everyone = confirm === 'everyone';
    const plat = conv.p === 'discord' ? 'Discord' : 'Telegram';
    return (
      <div className="ctx" ref={ref} style={{...place, width: 256}} role="dialog" aria-label="Confirm delete">
        <div className="ctx-confirm">
          <div className="ctx-confirm-t">{everyone ? 'Delete for everyone?' : 'Remove from this chat?'}</div>
          <div className="ctx-confirm-b">
            {everyone
              ? `It will be deleted on ${plat} for you and ${conv.name || 'the customer'}, and removed here.`
              : `It stays on ${plat}. It is removed from this app’s history and the AI stops seeing it.`}
          </div>
        </div>
        <div className="ctx-btns" data-row="1">
          <button type="button" className="ctx-btn" onClick={() => setConfirm(null)}>Cancel</button>
          <button type="button" className="ctx-btn" data-kind="danger"
            onClick={() => {
              MSGS_STORE.deleteMessages(conv.id, [row], everyone ? 'everyone' : 'local');
              if (!everyone) bcToast('Removed from this chat', 'ok');
              onClose();
            }}>{everyone ? 'Delete' : 'Remove'}</button>
        </div>
      </div>
    );
  }

  const hasFile = !!row.mu && !!mediaKind;
  return (
    <div className="ctx" ref={ref} style={place} role="menu" aria-label="Message actions">
      <CtxRow icon="reply" label="Reply" disabled={!caps.reply} onClick={() => { onReply(row); onClose(); }}/>
      {!isIn && <CtxRow icon="edit" label="Edit" disabled={!caps.edit} onClick={() => { onEdit(row); onClose(); }}/>}
      {caps.copy && <CtxRow icon="copy" label="Copy text" onClick={() => { bcCopyText(text); onClose(); }}/>}
      {hasFile && <CtxRow icon="open"
        label={mediaKind === 'image' ? 'Open image' : (mediaKind === 'youtube' || mediaKind === 'link') ? 'Open link' : 'Open file'}
        onClick={() => {
          if (bcInHost()) bcBridgeSend('openMedia', { url: row.mu, name: fileName });
          else bcOpenInBrowser(row.mu);
          onClose();
        }}/>}
      {hasFile && bcInHost() && <CtxRow icon="save" label="Save as…" onClick={() => { bcBridgeSend('saveMedia', { url: row.mu, name: fileName }); onClose(); }}/>}
      <div className="ctx-line"/>
      {caps.deleteEveryone && <CtxRow icon="trash" label="Delete for everyone…" danger onClick={() => setConfirm('everyone')}/>}
      <CtxRow icon="remove" label="Remove from this chat…" danger={!caps.deleteEveryone} disabled={!caps.deleteLocal}
        onClick={() => setConfirm('local')}/>
      {note ? (<><div className="ctx-line"/><div className="ctx-note">{note}</div></>) : null}
    </div>
  );
};

// ── DIRECT-CHAT MESSAGE MENU ─────────────────────────────────────────
// The same menu for a direct chat: reply, copy, edit and delete your own
// messages (within 48 hours, as elsewhere), open or save a file. There's
// nothing to remove locally in a direct chat, so that row isn't here.
const DmMessageMenu = ({x, y, ay, tid, row, peerName, onClose, onEdit, onReply}) => {
  const ref = React.useRef(null);
  const [confirm, setConfirm] = React.useState(false);
  const confirmRef = React.useRef(false); confirmRef.current = confirm;
  useCtxDismiss(ref, onClose, () => { if (!confirmRef.current) return false; setConfirm(false); return true; });
  const place = useCtxPlace(ref, x, y, [confirm], ay);
  const text = String(row.c || '').trim();
  const mediaKind = mediaKindOf(row.mt, row.mu);
  const hasFile = !!row.mu && !!mediaKind;
  const fileName = attNameOf(row) || (row.mn || '');
  const mine = row.r !== 'in';
  const canEdit = DM_STORE.canEdit(tid, row);
  const canDelete = DM_STORE.canDelete(tid, row);
  let note = '';
  if (row.del) note = mine ? 'You deleted this message.' : `${peerName || 'They'} deleted this message.`;
  else if (row.locked) note = 'This message can’t be opened in this browser.';
  else if (mine && !row.sid) note = 'Still sending — actions unlock once it’s delivered.';
  else if (mine && !canDelete && !row.err) note = 'Messages can be edited or deleted for 48 hours after sending.';

  if (confirm) {
    return (
      <div className="ctx" ref={ref} style={{...place, width: 256}} role="dialog" aria-label="Confirm delete">
        <div className="ctx-confirm">
          <div className="ctx-confirm-t">Delete for everyone?</div>
          <div className="ctx-confirm-b">It’s removed for you and {peerName || 'them'}{row.dmf ? ', along with the file' : ''}.</div>
        </div>
        <div className="ctx-btns" data-row="1">
          <button type="button" className="ctx-btn" onClick={() => setConfirm(false)}>Cancel</button>
          <button type="button" className="ctx-btn" data-kind="danger"
            onClick={() => { onClose(); DM_STORE.deleteMessage(tid, row); }}>Delete</button>
        </div>
      </div>
    );
  }
  return (
    <div className="ctx" ref={ref} style={place} role="menu" aria-label="Message actions">
      {onReply && <CtxRow icon="reply" label="Reply" disabled={!row.sid || !!row.locked || !!row.del}
        onClick={() => { onReply(row); onClose(); }}/>}
      {mine && <CtxRow icon="edit" label="Edit" disabled={!canEdit} onClick={() => { onEdit(row); onClose(); }}/>}
      {text && !row.locked && !row.del && <CtxRow icon="copy" label="Copy text" onClick={() => { bcCopyText(text); onClose(); }}/>}
      {hasFile && <CtxRow icon="open" label={mediaKind === 'image' ? 'Open image' : 'Open file'}
        onClick={() => {
          if (bcInHost()) bcBridgeSend('openMedia', { url: row.mu, name: fileName });
          else bcOpenInBrowser(row.mu);
          onClose();
        }}/>}
      {hasFile && bcInHost() && <CtxRow icon="save" label="Save as…" onClick={() => { bcBridgeSend('saveMedia', { url: row.mu, name: fileName }); onClose(); }}/>}
      {mine && (<>
        {(canEdit || text || hasFile) && <div className="ctx-line"/>}
        <CtxRow icon="trash" label="Delete for everyone…" danger disabled={!canDelete} onClick={() => setConfirm(true)}/>
      </>)}
      {note ? (<><div className="ctx-line"/><div className="ctx-note">{note}</div></>) : null}
    </div>
  );
};

const InPageChatView = ({msg, onClose, onBack, backTarget, chatWidth, _convSig}) => {
  // Seed from store cache for first mount. Conv switches are handled in
  // render (see CONVERSATION SWITCH below) so the very first commit of a
  // newly selected chat already holds its own thread.
  const [thread, setThread] = React.useState(() => seedThreadFor(msg));
  // Per-conversation manual input draft. The textarea is UNCONTROLLED
  // (uses defaultValue + ref) so React doesn't re-render the entire
  // 11k-line component tree on every keystroke — typing stays instant
  // even with the AI engine, status pills, and floating panels all
  // running. We keep two lightweight state values for the bits that
  // legitimately need to react to text changes:
  //   • hasText   → only flips when going empty↔non-empty (for the
  //                 send button enabled state and counter visibility)
  //   • inputLen  → updates on every change but is *only* read by the
  //                 character counter, which we render via a tiny
  //                 sibling effect so the parent doesn't re-render
  // The actual text source of truth lives in inputTextRef + the DOM.
  const inputTextRef = React.useRef(INPUT_DRAFTS.get(msg.id));
  const [hasText,  setHasText]  = React.useState(!!INPUT_DRAFTS.get(msg.id));
  const [inputLen, setInputLen] = React.useState((INPUT_DRAFTS.get(msg.id)||'').length);
  const [composerMode, setComposerMode]= React.useState('ai'); // 'ai' | 'manual'
  const threadRef = React.useRef(null);
  useBubbleShaper(threadRef, msg && msg.id);
  const inputRef  = React.useRef(null);
  const taRef     = React.useRef(null); // textarea ref for auto-grow

  // Type anywhere in a customer chat and the composer takes focus too —
  // the behaviour shouldn't only exist in the ghost chat. Same guards
  // apply, so the agent menu, search box and profile panel inputs all
  // keep their own keystrokes.
  useTypeToFocus(taRef);

  // Helper: write the textarea's current value through to all the
  // places that need to know about it. Cheap — just a Map.set, a ref
  // assignment, and conditional setStates that only fire on threshold
  // crossings.
  // Starting a manual reply holds any AI draft that's counting down, the
  // same as clicking the draft does. Reads the store directly so handlers
  // closed over an older render (the global keystroke listener) still act
  // on the draft that exists now.
  const holdDraftForManual = React.useCallback(() => {
    const d = (typeof DRAFT_STORE !== 'undefined') ? DRAFT_STORE.get(msg.id) : null;
    if (d && !d.paused && !d.cancelled) DRAFT_STORE.pause(msg.id);
  }, [msg.id]);

  const syncInput = React.useCallback((val) => {
    if (val && val.trim()) holdDraftForManual();
    inputTextRef.current = val;
    INPUT_DRAFTS.set(msg.id, val);
    const next = !!val;
    // Avoid a setState (and re-render) if the boolean didn't actually flip.
    setHasText(prev => prev === next ? prev : next);
    setInputLen(prev => prev === val.length ? prev : val.length);
  }, [msg.id, holdDraftForManual]);

  // ── ATTACHMENTS ─────────────────────────────────────────────────────
  // Files queued for the next manual send. `attBusy` covers the window
  // where a big file is still being read off disk — sending during it
  // would post the text and quietly lose the file.
  const [atts,     setAtts]     = React.useState(() => ATTACH_DRAFTS.get(msg.id) || []);
  const [attBusy,  setAttBusy]  = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef(null);
  // dragenter/dragleave fire once per child element the cursor crosses, so
  // a plain boolean makes the overlay strobe as the file moves over the
  // thread. Depth counting is the standard fix: only the outermost leave
  // actually clears it.
  const dragDepthRef = React.useRef(0);

  const putAtts = React.useCallback((next) => {
    if (next && next.length) ATTACH_DRAFTS.set(msg.id, next);
    else                     ATTACH_DRAFTS.delete(msg.id);
    setAtts(next || []);
  }, [msg.id]);

  const removeAtt = React.useCallback((id) => {
    putAtts((ATTACH_DRAFTS.get(msg.id) || []).filter(a => a.id !== id));
  }, [msg.id, putAtts]);

  // Shared by the paperclip, drag-and-drop and paste. Reads each file into
  // a data URL up front rather than at send time: the operator sees exactly
  // what is queued, and the send itself stays synchronous.
  const addFiles = React.useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const room = ATT_MAX_FILES - (ATTACH_DRAFTS.get(msg.id) || []).length;
    if (room <= 0) {
      console.warn('[attach] ' + ATT_MAX_FILES + '-file limit reached for this message');
      return;
    }
    setAttBusy(true);
    const accepted = [];
    for (const f of files.slice(0, room)) {
      if (f.size > ATT_MAX_BYTES) {
        console.warn('[attach] skipped, over ' + prettyBytes(ATT_MAX_BYTES) + ':', f.name, prettyBytes(f.size));
        continue;
      }
      try {
        const url   = await readFileAsDataUrl(f);
        const kind  = attKindOf(f.type, f.name);
        // Thumbnail is the archived copy when the original is too big for
        // the database. Generated now, while we already have the bytes.
        const thumb = kind === 'image' ? await makeImageThumb(url, ATT_THUMB_PX) : '';
        accepted.push({
          id:   'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name: f.name || kind,
          size: f.size,
          mime: f.type || '',
          kind, url, thumb,
        });
      } catch (err) {
        console.warn('[attach] could not read', f && f.name, err && err.message);
      }
    }
    setAttBusy(false);
    if (!accepted.length) return;
    holdDraftForManual();
    putAtts((ATTACH_DRAFTS.get(msg.id) || []).concat(accepted));
    // A file landing is activity in the composer, so hold it open and put
    // the caret in the box — the next thing the operator does is type.
    setFocused(true);
    try { taRef.current && taRef.current.focus({preventScroll: true}); } catch (_) {}
  }, [msg.id, putAtts]);

  const onDropFiles = React.useCallback((e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) addFiles(dt.files);
  }, [addFiles]);

  // Declared early so the conv-switch reset effect below can reference them.
  // The full wiring (click handlers, escape listener etc) lives further down.
  const [aiMenuOpen,   setAiMenuOpen]   = React.useState(false);
  // When the CURRENT conversation was opened. Messages older than this are
  // history and must not animate. Reset on every conv switch below, so
  // hopping into a chat that received something ten seconds ago still shows
  // that message already in place rather than flying in.
  const convOpenedAtRef = React.useRef(Date.now());

  // ── CUSTOMER RECORD IN THE THREAD ───────────────────────────────────
  // Replaces the floating profile popup. The record feeds two things:
  //   • moments — chapters, interests, notes, payments and escalations
  //     rendered as quiet dividers next to the bubbles they came from;
  //   • the AI summary card beside the header identity pill (hover).
  // All of it lives in bot-ui-enduser.jsx.
  const { data: euRecord } = useEndUserRecord(msg.id);
  // The conversation row feeds the "AI unassigned" moment (reason + when)
  // and the escalation fallback; open invoices come back as `invoiceFollowers`.
  const { map: momentRows, fresh: freshMoments, followers: invoiceFollowers,
          escalation: escalationFollower } =
    useChatMoments(msg.id, thread, euRecord, convOpenedAtRef.current, msg);
  const momentRowAt = (b) => {
    const row = momentRows.get(b);
    return row ? <ChatMomentRow key={row.key} row={row} fresh={freshMoments}/> : null;
  };

  // ── THE THREAD'S ROWS, MEMOIZED ─────────────────────────────────────
  // This component re-renders far more often than the conversation changes:
  // the AI-draft countdown ticks every 250ms, the composer tracks hover and
  // focus, the header menus open and close. Each of those used to rebuild
  // an element (and a memo snapshot) for every message in the thread, which
  // on a long, media-heavy chat is real work several times a second. The
  // rows only depend on the thread, the conversation row, and the moments
  // and invoices beside them, so they are built only when one of those does.
  const threadRowsEl = React.useMemo(() => (
    <React.Fragment>
      {thread.map((m,i)=>{
        // Telegram-style avatar grouping: the avatar only renders next to
        // the LAST message in a run of consecutive incoming bubbles. Other
        // bubbles in the same run reserve a same-width spacer so they
        // line up. The avatar also tightens spacing within a group.
        const prev = thread[i-1];
        const next = thread[i+1];
        // A run breaks on a different sender, a different AI agent, a
        // pause of a few minutes, or anything drawn between the two rows.
        const isGroupEnd   = !bcBubblesJoin(m, next) || !!momentRows.get(i + 1);
        const isGroupStart = !bcBubblesJoin(prev, m) || !!momentRows.get(i);
        // Only messages that landed AFTER this conversation was opened
        // animate in. Everything already here is history, and a thread
        // that replays itself every time you open it is the single most
        // common way this effect goes wrong.
        //
        // No artificial stagger for bursts: each message is its own
        // store update and its own render, so a run of three arriving
        // quickly already cascades on real arrival times. Faking a delay
        // on top would only add lag to whichever landed last.
        const enter = (m.ts && m.ts >= convOpenedAtRef.current)
          ? (m.r === 'in' ? 'in' : 'out')
          : null;
        // At most one combined moment row sits in the gap above each
        // bubble (the gap below the last bubble renders after the loop).
        // Rows carry their own class, never .brow, so jump/highlight
        // code that indexes .brow rows still lines up with thread[i].
        return (
          <React.Fragment key={i}>
            {momentRowAt(i)}
            <ChatBubbleRow m={m} msg={msg} sz={28} ti={i}
              isGroupStart={isGroupStart}
              isGroupEnd={isGroupEnd}
              enter={enter}
              style={{marginBottom: isGroupEnd ? 10 : 2}}/>
          </React.Fragment>
        );
      })}
      {/* The gap under the last bubble shares its spot with the footer
          below, so while anything is still open the two are drawn as
          ONE line (ThreadFollowers takes this row as `tail`) instead of
          two separators stacked on top of each other. */}
      {(invoiceFollowers.length || escalationFollower) ? null : momentRowAt(thread.length)}

      {/* ── THE FOOTER: WHAT'S STILL OPEN ─────────────────────────
          Always the last thing in the thread, so it follows new messages
          down instead of scrolling away. Open invoices first, then the
          open hand-over — the escalation sits BELOW the invoice line
          because it's the one waiting on the operator rather than on the
          customer, and it's closest to the composer for that reason.

          Both settle: a paid invoice leaves this stack and is drawn by
          momentRowAt at the point it settled, and a resolved escalation
          does exactly the same.

          "AI unassigned" used to be pinned here too. It's now a moment
          placed where it happened (collectMomentItems), still shown only
          while no agent is on and a reason is recorded. */}
      <ThreadFollowers invoices={invoiceFollowers} escalation={escalationFollower}
        tail={momentRows.get(thread.length)} fresh={freshMoments}/>
      {/* The agent's spam cooldown on this chat, counting down. */}
      {!escalationFollower && <PlatformSpamSep convId={msg.id}/>}
    </React.Fragment>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [thread, msg, _convSig, momentRows, freshMoments, invoiceFollowers, escalationFollower]);

  const [summaryOpenRaw, setSummaryOpen] = React.useState(false);
  // Nothing to show until an agent has written a summary for this chat:
  // then the pill neither lights up nor opens an empty card.
  const hasSummary = !!String((euRecord && euRecord.summary) || '').trim();
  const summaryOpen = summaryOpenRaw && hasSummary;
  const summaryTimerRef = React.useRef(null);
  const idZoneRef   = React.useRef(null);   // identity half of the header pill
  const idAvatarRef = React.useRef(null);   // the avatar inside it
  const summaryShow = React.useCallback(() => {
    clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = setTimeout(() => setSummaryOpen(true), 260);
  }, []);
  const summaryKeep = React.useCallback(() => clearTimeout(summaryTimerRef.current), []);
  const summaryHide = React.useCallback(() => {
    clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = setTimeout(() => setSummaryOpen(false), 140);
  }, []);
  React.useEffect(() => () => clearTimeout(summaryTimerRef.current), []);
  React.useEffect(() => {
    if (!summaryOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setSummaryOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [summaryOpen]);

  // When the active conversation changes, swap the textarea contents to
  // that chat's saved draft. We write directly to the DOM so we don't
  // pay the controlled-component re-render cost.
  // Layout effect (not a passive one) so the previous chat's text is never
  // painted for a frame. hasText / inputLen / atts are reset in render.
  const didMountDraftRef = React.useRef(false);
  React.useLayoutEffect(() => {
    const saved = INPUT_DRAFTS.get(msg.id);
    inputTextRef.current = saved;
    const ta = taRef.current;
    if (ta && (didMountDraftRef.current || ta.value !== saved)) {
      ta.value = saved;
      ta.style.height = 'auto';
      ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
    }
    didMountDraftRef.current = true;
    dragDepthRef.current = 0;
  }, [msg.id]);
  const s = STAGES[msg.stage]||STAGES.new;
  const a = AISTATUS[msg.ai]||AISTATUS.paused;

  // ── COMPOSER VISIBILITY ─────────────────────────────────────────────
  // The composer slides away when idle to keep the chat surface clean.
  const [hover, setHover]           = React.useState(false);
  const [composerHover, setComposerHover] = React.useState(false);
  const [focused, setFocused]       = React.useState(false);
  const composerWrapRef             = React.useRef(null);
  const composerInRef               = React.useRef(null);
  useComposerHeight(composerWrapRef, composerInRef);
  // ── Transition suppression ───────────────────────────────────────────
  // justSwitchedRef drives whether transitions are enabled. It must be
  // readable DURING render (not just in effects) because React renders
  // before effects run — reading it in render gives the correct value
  // for the FIRST paint of the new conv.
  //
  // The approach: track the "last rendered conv id" in a ref. During
  // render, if msg.id differs from that ref, this is the first render of
  // a new conv → suppress all transitions. The ref is updated in a
  // layoutEffect AFTER render (so it's always one render behind — which
  // is exactly what makes the render-time comparison work).
  //
  // We ALSO keep justSwitchedRef so effects that run async (auto-focus
  // setTimeout) can still read the suppression state without causing
  // extra renders.
  const renderedMsgIdRef = React.useRef(null); // updated post-render in layoutEffect
  const justSwitchedRef  = React.useRef(true);  // for async effects (auto-focus etc.)
  // switchEpoch increments when the suppression window ends, forcing a re-render
  // so components that read justSwitchedRef.current re-evaluate with the new value.
  const [switchEpoch, setSwitchEpoch] = React.useState(0); // eslint-disable-line no-unused-vars
  // Computed synchronously during render — true on first render of a new conv.
  const isFirstRenderOfConv = (renderedMsgIdRef.current !== msg.id);

  // ── CONVERSATION SWITCH (in render) ──────────────────────────────────
  // InPageChat is reused across conversations. This used to reset its state
  // in a layout effect, which meant the new chat was first rendered with the
  // PREVIOUS chat's thread (every bubble reconciled against the wrong data),
  // then rendered again, and scroll could only be restored two frames later.
  // Adjusting state during render is React's supported pattern for this: the
  // pass is thrown away before any child renders and restarts immediately
  // with the new values, so the first commit is already correct and scroll
  // restoration can happen synchronously before paint.
  const [boundConvId, setBoundConvId] = React.useState(msg.id);
  if (boundConvId !== msg.id) {
    setBoundConvId(msg.id);
    setThread(seedThreadFor(msg));
    const draftText = INPUT_DRAFTS.get(msg.id);
    setHasText(!!draftText);
    setInputLen(draftText.length);
    setAtts(ATTACH_DRAFTS.get(msg.id) || []);
    setDragOver(false);
    setHover(false);
    setComposerHover(false);
    setFocused(false);
    setSummaryOpen(false);
    setAiMenuOpen(false);
    // A different conversation is a fresh slate for entrance animations.
    // Set here (not in an effect) so bubbles rendered in this same pass
    // already compare against the new time and history never animates in.
    convOpenedAtRef.current = Date.now();
    // No avatar glide can play on a switch; skip the per-avatar measuring.
    _glideHold.until = performance.now() + 250;
  }

  // ── Reset ALL volatile UI state on conv switch ───────────────────────
  // InPageChat is NOT remounted between convs — React reuses the same
  // instance and swaps the msg prop. Without explicit resets, state from
  // the previous conv (hover, summary card, thread, etc.) bleeds visually
  // into the first frame of the new conv, causing the jitter/glitch.
  const prevMsgIdRef = React.useRef(msg.id);
  React.useLayoutEffect(() => {
    const isSwitch = prevMsgIdRef.current !== msg.id;
    const t0 = performance.now();
    prevMsgIdRef.current = msg.id;
    // Tell render "we've committed this conv — next render is not a switch"
    renderedMsgIdRef.current = msg.id;

    // Keep suppression active synchronously for this commit too.
    justSwitchedRef.current = true;

    // Volatile UI state (hover, menus, thread seed, opened-at) is reset in
    // render above; only the pending hover timer needs clearing here.
    clearTimeout(summaryTimerRef.current);

    // Re-enable transitions only after BOTH scroll restoration AND auto-focus
    // have completed. Auto-focus fires at ~60ms (setTimeout in effect below).
    // We use 120ms here to give a generous margin that covers both:
    //   • double-rAF scroll restore (~32ms)
    //   • auto-focus setTimeout(60ms) + one rAF (~76ms)
    // This is the key fix: the composer must not animate in during this window.
    const tid = setTimeout(() => {
      justSwitchedRef.current = false;
      renderedMsgIdRef.current = msg.id;
      // Force a re-render so components reading justSwitchedRef.current update.
      // Without this, the ref change is invisible to React and the noTransition
      // gate stays permanently enabled for any render triggered by other state.
      setSwitchEpoch(e => e + 1);
    }, 120);
    return () => clearTimeout(tid);
  }, [msg.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for events from the floating Customer-Info panel so the chat
  // can react to its action-row buttons (Message → focus input here,
  // Search → open search with the user's name pre-filled). Decoupled
  // via window events so the panel never has to reach into this
  // component's state directly.
  React.useEffect(() => {
    const onFocusInput = (e) => {
      if (e && e.detail && e.detail.convId !== msg.id) return;
      if (inputRef.current) {
        try { inputRef.current.focus({preventScroll: true}); } catch(_) {}
      }
    };
    const onOpenSearch = (e) => {
      if (e && e.detail && e.detail.convId !== msg.id) return;
      // Lightweight UX: prefill the input with a /search command so the
      // operator can scroll back through messages mentioning the user.
      // A dedicated search modal can replace this later — for now this
      // gives Search a real, observable effect instead of a no-op.
      const q = (e && e.detail && e.detail.q) || '';
      if (q && taRef.current) {
        const next = `@${q} `;
        taRef.current.value = next;
        syncInput(next);
        taRef.current.style.height = 'auto';
        taRef.current.style.height = Math.min(110, taRef.current.scrollHeight) + 'px';
        try { taRef.current.focus({preventScroll: true}); } catch(_) {}
      }
    };
    window.addEventListener('cust-info-focus-input', onFocusInput);
    window.addEventListener('cust-info-open-search', onOpenSearch);
    return () => {
      window.removeEventListener('cust-info-focus-input', onFocusInput);
      window.removeEventListener('cust-info-open-search', onOpenSearch);
    };
  }, [msg.id]);

  // Live AI draft for THIS conversation. The engine populates DRAFT_STORE
  // after the LLM responds; this hook re-renders whenever the draft state
  // for our convId changes.
  // ── Global keystroke → auto-focus the composer ──────────────────────
  // If the operator starts typing while focus is anywhere benign (not
  // already inside an input/textarea/contenteditable, no active modifier
  // keys), grab focus AND inject the typed character into the composer
  // so the keystroke isn't lost. Lets you just start typing the moment
  // a chat opens, even if the composer is currently slid away.
  React.useEffect(() => {
    const onKey = (e) => {
      // Don't intercept when the tab is hidden, or when a modifier is held
      if (document.hidden) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const t = e.target;
      const tag = (t && t.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      if (tag === 'BUTTON') return;
      e.preventDefault();
      const cap = limitFor(msg.p);
      const cur = inputTextRef.current || '';
      if (cur.length >= cap) return;
      const next = cur + e.key;
      // Mutate DOM directly for instant response, then sync state.
      if (taRef.current) {
        taRef.current.value = next;
        taRef.current.style.height = 'auto';
        taRef.current.style.height = Math.min(110, taRef.current.scrollHeight) + 'px';
      }
      syncInput(next);
      // Defer focus to the next frame so React has applied the input
      // change and the composer has slid into view first.
      requestAnimationFrame(() => {
        try {
          if (inputRef.current) {
            inputRef.current.focus({preventScroll: true});
            // Move caret to end so subsequent typing continues naturally.
            const len = inputRef.current.value.length;
            inputRef.current.setSelectionRange(len, len);
          }
        } catch(_) {}
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [msg.id]);

  // ── Auto-focus the composer when a chat opens. Sets focused=true
  //    which keeps the composer slid into view from the first paint —
  //    no need to click the chat area first to start typing.
  React.useEffect(() => {
    if (!inputRef.current) return;
    // RAF + small delay so the input's parent has rendered with
    // pointerEvents:auto by the time we focus, and the WebView2 host
    // has finished its initial layout pass.
    const t = setTimeout(() => {
      try { inputRef.current && inputRef.current.focus({preventScroll: true}); } catch(_) {}
    }, 60);
    return () => clearTimeout(t);
  }, [msg.id]);

  // ── Scroll position: save on scroll, restore on conv switch ──────────
  const scrollSaveRaf = React.useRef(null);
  const didRestoreScroll = React.useRef(false);

  // ── FOLLOW MODE ──────────────────────────────────────────────────────
  // The thread follows new messages only while the operator is reading the
  // latest ones. Three refs:
  //   followRef       — true while the view is at (or near) the bottom.
  //                     Only a scroll the OPERATOR made can turn it off.
  //   userScrollAtRef — last wheel / touch / drag / scroll-key on the thread.
  //   autoScrollUntil — our own smooth scroll is running; its intermediate
  //                     scroll events must not be mistaken for the operator
  //                     scrolling away.
  const followRef       = React.useRef(true);
  const userScrollAtRef = React.useRef(0);
  const autoScrollUntil = React.useRef(0);
  // JUMP HOLD — while a jump (notification, separator click) is landing,
  // every automatic pin to the bottom stands aside. Without it, a view that
  // was following the newest message kept followRef armed through the
  // first frames of the jump's glide, so an image decoding, a late history
  // batch or a status tick snapped it straight back down and the operator
  // ended up nowhere near the message they asked for.
  //   until — hold expiry (ms); node/idx — what is being held in view.
  const jumpHoldRef     = React.useRef({ until: 0, node: null });
  const jumpHeld        = () => Date.now() < jumpHoldRef.current.until;
  const FOLLOW_SLACK_PX = 96;
  const markUserScroll = React.useCallback(() => {
    userScrollAtRef.current = Date.now();
    jumpHoldRef.current.until = 0;          // the operator took over from a jump
  }, []);
  const onThreadKeyDown = React.useCallback((e) => {
    if (['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(e.key)) markUserScroll();
  }, [markUserScroll]);

  const onThreadScroll = React.useCallback(() => {
    const el = threadRef.current;
    if (el) {
      const now = Date.now();
      const userDriven = (now - userScrollAtRef.current) < 900;
      if (userDriven || now > autoScrollUntil.current) {
        if (userDriven) autoScrollUntil.current = 0;   // the operator took over
        followRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) <= FOLLOW_SLACK_PX;
      }
    }
    if (scrollSaveRaf.current) return;
    scrollSaveRaf.current = requestAnimationFrame(() => {
      scrollSaveRaf.current = null;
      const e2 = threadRef.current;
      // Nothing is worth remembering until the entry position has been
      // applied — the events fired while the thread is still being laid out
      // describe a view the operator never saw.
      if (!e2 || !didRestoreScroll.current) return;
      if ((e2.scrollHeight - e2.scrollTop - e2.clientHeight) <= FOLLOW_SLACK_PX) {
        // Reading the newest messages: remember the END of the thread, not
        // the pixel offset that happens to be the end right now.
        SCROLL_POS_CACHE.set(msg.id, SCROLL_AT_BOTTOM);
      } else if (userScrollAtRef.current) {
        // Parked part-way up, and the operator put it there. That is the
        // only thing that earns a pixel position.
        SCROLL_POS_CACHE.set(msg.id, e2.scrollTop);
      }
    });
  }, [msg.id]);

  // ── SEAMLESS ENTRY MASK ──────────────────────────────────────────────
  // Opening a conversation is three steps that used to be visible one by
  // one: the thread mounts, the scroll position is applied, and the history
  // arrives from the store a beat later and replaces the preview bubble.
  // The operator saw a stray bubble near the top, then the whole backlog
  // appear, then the view snap to the bottom.
  //
  // The thread is held at visibility:hidden for that window instead. It
  // still lays out — which is what lets us measure and position it — it
  // simply is not painted until it is correct, so a switch reads as the new
  // chat arriving fully formed. The mask is written straight to the DOM
  // rather than held in state: a re-render here would be one more frame of
  // work in exactly the window we are trying to keep quiet.
  //
  // REVEAL_MAX_MS is the backstop. If history is slow, or the conversation
  // genuinely has nothing in it, the thread is shown anyway rather than
  // leaving the pane blank.
  const REVEAL_MAX_MS  = 10000;   // backstop only — the loader shows meanwhile
  const REVEAL_FADE_MS = 120;   // only used when we actually had to wait
  const maskedRef      = React.useRef(false);
  // Placeholder bubbles shown while the thread is masked (see ThreadSkeleton).
  const skelRef        = React.useRef(null);
  // The history for this chat is still on its way: nothing the thread holds
  // yet is the conversation as it really is — a message or two that arrived
  // live while it was closed, or the inbox preview. Hold the mask until the
  // fetch has come back (hydrated, or tried and failed).
  const awaitingNow = (arr) => {
    if (threadAwaitingHistory(arr)) return true;
    try {
      if (typeof MSGS_STORE === 'undefined' || !MSGS_STORE._hydrated) return false;
      if (typeof euIsDemo === 'function' && euIsDemo()) return false;
      if (MSGS_STORE._hydrated.has(msg.id)) return false;
      if (MSGS_STORE._threadTried && MSGS_STORE._threadTried.has(msg.id)) return false;
      return true;
    } catch (_) { return false; }
  };
  const maskStartRef   = React.useRef(0);
  const revealRafRef   = React.useRef(0);
  const revealTimerRef = React.useRef(null);

  const clearRevealTimers = React.useCallback(() => {
    if (revealRafRef.current) { cancelAnimationFrame(revealRafRef.current); revealRafRef.current = 0; }
    if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
  }, []);

  const showThread = React.useCallback(() => {
    clearRevealTimers();
    if (skelRef.current) skelRef.current.setAttribute('data-on', '0');
    if (!maskedRef.current) return;
    maskedRef.current = false;
    const el = threadRef.current;
    if (!el) return;
    el.style.visibility = '';
    // A switch into an already-cached conversation is revealed on the very
    // next frame, which is indistinguishable from it having always been
    // there — no fade wanted or needed. A reveal that had to wait for the
    // history fetch is a longer gap, and a plain pop reads as a glitch, so
    // that one gets a short fade. Composited opacity only; the thread is
    // already positioned and nothing reflows.
    const waited = Date.now() - maskStartRef.current;
    if (waited < 120 || typeof el.animate !== 'function') return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    try {
      el.animate([{opacity: 0}, {opacity: 1}],
        {duration: REVEAL_FADE_MS, easing: 'cubic-bezier(0.22,1,0.36,1)'});
    } catch (_) {}
  }, [clearRevealTimers]);

  const maskThread = React.useCallback(() => {
    clearRevealTimers();
    const el = threadRef.current;
    if (!el) return;
    if (skelRef.current) skelRef.current.setAttribute('data-on', '1');
    maskedRef.current  = true;
    maskStartRef.current = Date.now();
    el.style.visibility = 'hidden';
    revealTimerRef.current = setTimeout(showThread, REVEAL_MAX_MS);
  }, [clearRevealTimers, showThread]);

  // Called after every pass that positions the thread. Holds the mask while
  // the only thing on screen would be the placeholder preview bubble; one
  // frame after a real thread is in place, drops it.
  const revealWhenReady = React.useCallback((awaitingHistory) => {
    if (!maskedRef.current || awaitingHistory) return;
    if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current);
    revealRafRef.current = requestAnimationFrame(() => {
      revealRafRef.current = 0;
      showThread();
    });
  }, [showThread]);

  React.useEffect(() => () => clearRevealTimers(), [clearRevealTimers]);

  // On conv switch: go to the bottom, unless this conversation was left
  // parked part-way up earlier in the session — that position is restored
  // instead. This is the whole rule: a chat opens on its newest message,
  // and only a deliberate scroll earlier in the session overrides that.
  //
  // The thread for this conversation is already in the DOM on this commit
  // (it is swapped in during render), so the position is applied right here,
  // before the browser paints — no rAF delay, no intermediate position ever
  // reaches the screen. The entry mask covers the rest of the arrival: the
  // thread is not painted at all until it holds real history at the right
  // offset, so there are no bubbles settling into place in view.
  //
  // A corrective pass on the next frame covers things that size a beat later
  // (the AI-draft padding, cached image boxes) when the view should be
  // sitting at the bottom.
  const justRestoredRef = React.useRef(false);
  React.useLayoutEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    // Hide first: everything below runs before paint, so the operator never
    // sees the thread at any position other than its final one.
    maskThread();
    // The hover timestamp from the chat we just left must not stretch this
    // one's scroll height (see PARKING above) — park it before measuring.
    tsFloatParkNow();
    autoScrollUntil.current = 0;
    // A scroll made in the PREVIOUS conversation is not the operator's hand
    // on the wheel in THIS one. Leaving it set was why clicking a second
    // chat within a moment of scrolling the first one suppressed the
    // landing pin and left long threads sitting at the top.
    userScrollAtRef.current = 0;
    const savedPos = SCROLL_POS_CACHE.get(msg.id);
    const toBottom = (savedPos == null || savedPos === SCROLL_AT_BOTTOM);
    if (toBottom) {
      el.scrollTop = el.scrollHeight;      // clamps to the true maximum
      followRef.current = true;
    } else {
      el.scrollTop = savedPos;
      followRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) <= FOLLOW_SLACK_PX;
    }
    didRestoreScroll.current = true;
    justRestoredRef.current = true;
    const awaiting = awaitingNow(thread);
    const raf = requestAnimationFrame(() => {
      const e2 = threadRef.current;
      if (!e2) return;
      if (toBottom && followRef.current && !userScrollAtRef.current && !jumpHeld()) {
        const target = e2.scrollHeight - e2.clientHeight;
        if (target - e2.scrollTop > 1) e2.scrollTop = target;
      }
    });
    revealWhenReady(awaiting);
    return () => cancelAnimationFrame(raf);
  }, [msg.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // On new messages: glide to them — unless the operator has scrolled up
  // to read something, or is scrolling right now.
  //   • A message the operator just SENT is followed even if they'd
  //     scrolled up (they acted; they expect to see it land) — but never
  //     while their hand is on the wheel.
  //   • Anything else (customer, AI) is followed only in follow mode.
  //   • History loading in above the current last message isn't "new":
  //     a following view just stays pinned, without animating.
  const lastMsgKeyRef = React.useRef('');
  const prevThreadLenRef = React.useRef(thread.length);
  const prevPlaceholderRef = React.useRef(false);
  React.useLayoutEffect(() => {
    const el = threadRef.current;
    const last = thread[thread.length - 1];
    const awaiting = awaitingNow(thread);
    // Every path below ends by re-considering the entry mask: the pass that
    // lands the real history is the one that is allowed to reveal, and it
    // does so only after it has pinned the view.
    const follow = () => {
      const key = last ? `${last.r}|${last.ts || ''}|${(last.c || '').slice(0, 24)}|${last.mu ? 1 : 0}` : '';
      const prevKey = lastMsgKeyRef.current;
      lastMsgKeyRef.current = key;
      const prevLen = prevThreadLenRef.current;
      prevThreadLenRef.current = thread.length;
      const wasPlaceholder = prevPlaceholderRef.current;
      // The preview-only seed bubble carries no timestamp; real rows always do.
      prevPlaceholderRef.current = awaiting;
      // The switch commit itself: the restore effect has just positioned the
      // view, so there is nothing to follow.
      if (justRestoredRef.current) { justRestoredRef.current = false; return; }
      if (!el || !didRestoreScroll.current || !last) return;
      // A jump is landing: its own observer keeps the target in view.
      if (jumpHeld()) return;
      const lastChanged = key !== prevKey;
      // History landing on a first open (placeholder → full thread, or a big
      // batch at once) is not "a new message": a following view pins to the
      // bottom instantly instead of gliding through the whole backlog.
      if (followRef.current && (prevLen === 0 || wasPlaceholder || thread.length - prevLen > 3)
          && (Date.now() - userScrollAtRef.current) >= 700) {
        el.scrollTop = el.scrollHeight - el.clientHeight;
        SCROLL_POS_CACHE.set(msg.id, SCROLL_AT_BOTTOM);
        return;
      }
      if ((Date.now() - userScrollAtRef.current) < 700) return;       // hand on the wheel
      const mine = last.r === 'out' && lastChanged && !!last.ts && last.ts >= convOpenedAtRef.current;
      if (!followRef.current && !mine) return;
      const target = el.scrollHeight - el.clientHeight;
      followRef.current = true;
      if (target - el.scrollTop <= 1) return;
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Content grew while our own glide is still travelling (a reply
      // streaming in, an image decoding): retarget the glide, don't snap.
      if (!lastChanged && !reduce && Date.now() < autoScrollUntil.current) {
        el.scrollTo({ top: target, behavior: 'smooth' });
        return;
      }
      // While the entry mask is still up nothing is on screen to animate,
      // so a glide would only be a delay the operator waits through.
      if (!lastChanged || reduce || maskedRef.current) { el.scrollTop = target; return; }
      autoScrollUntil.current = Date.now() + 900;
      el.scrollTo({ top: target, behavior: 'smooth' });
      SCROLL_POS_CACHE.set(msg.id, SCROLL_AT_BOTTOM);
    };
    follow();
    revealWhenReady(awaiting);
  }, [thread]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stay pinned while the thread grows on its own ───────────────────
  // Pictures decoding, a moment row expanding, a font settling: none of
  // those change `thread`, so the follow effect above never sees them and a
  // view that was reading the latest message used to end up a few lines
  // short of the bottom. One observer on the thread body keeps a following
  // view pinned. It stands aside while the operator is scrolling and while
  // our own smooth glide is travelling (that glide retargets itself).
  React.useEffect(() => {
    const el = threadRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const body = el.querySelector(':scope > .ipc-body');
    if (!body) return;
    let lastH = body.offsetHeight;
    const ro = new ResizeObserver(() => {
      const h = body.offsetHeight;
      const grew = h > lastH;
      lastH = h;
      if (!grew || !followRef.current || !didRestoreScroll.current) return;
      if (jumpHeld()) return;
      const now = Date.now();
      if (now - userScrollAtRef.current < 700 || now < autoScrollUntil.current) return;
      const target = el.scrollHeight - el.clientHeight;
      if (target - el.scrollTop > 1) el.scrollTop = target;
    });
    ro.observe(body);
    return () => ro.disconnect();
  }, []);

  // ── LANDING A JUMP ───────────────────────────────────────────────
  // One routine for every jump (notification, note, chapter…):
  //   1. arm the jump hold, so nothing pins the view back to the bottom;
  //   2. glide the target into the middle of the view;
  //   3. keep it there while the hold lasts — pictures above it decoding
  //      or a late batch of history would otherwise push it off-centre
  //      after the glide had already aimed at the old position. The
  //      operator's own scroll ends the hold immediately;
  //   4. mark the bubbles quietly.
  const bcLandOnRows = React.useCallback((root, idxs, mode, kind) => {
    const list = (idxs || []).filter(i => i >= 0).sort((a, b) => a - b);
    if (!root || !list.length) return;
    const startedAt = Date.now();
    followRef.current = false;
    autoScrollUntil.current = startedAt + 900;       // the glide's own scroll events
    jumpHoldRef.current = { until: startedAt + 2200, node: null };
    requestAnimationFrame(() => {
      const nodes = list.map(i => bcThreadRowAt(root, i, thread.length)).filter(Boolean);
      if (!nodes.length) { jumpHoldRef.current.until = 0; return; }
      const first = nodes[0];
      // A short run is centred as a whole; a long one leads with its start.
      const last = nodes[nodes.length - 1];
      const span = last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
      const centre = (span <= root.clientHeight * 0.8 && nodes.length > 1) ? null : first;
      const place = (smooth) => {
        const rr = root.getBoundingClientRect();
        let top;
        if (centre) {
          const nr = centre.getBoundingClientRect();
          top = root.scrollTop + (nr.top - rr.top) - (root.clientHeight - nr.height) / 2;
        } else {
          const a = first.getBoundingClientRect(), b = last.getBoundingClientRect();
          top = root.scrollTop + (a.top - rr.top) - (root.clientHeight - (b.bottom - a.top)) / 2;
        }
        top = Math.max(0, Math.min(Math.round(top), root.scrollHeight - root.clientHeight));
        if (Math.abs(root.scrollTop - top) <= 2) return;
        root.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
      };
      jumpHoldRef.current.node = first;
      place(true);
      // When the hold ends, follow mode is whatever the view now shows: a
      // jump that landed near the bottom keeps following new messages, one
      // that landed up in the history stays put. The position is remembered
      // the same way a manual scroll would be.
      clearTimeout(root.__bcJumpSettleT);
      root.__bcJumpSettleT = setTimeout(() => {
        if (userScrollAtRef.current > startedAt) return;   // the operator's scroll already decided
        const atBottom = (root.scrollHeight - root.scrollTop - root.clientHeight) <= FOLLOW_SLACK_PX;
        followRef.current = atBottom;
        try { SCROLL_POS_CACHE.set(msg.id, atBottom ? SCROLL_AT_BOTTOM : root.scrollTop); } catch (_) {}
      }, 2250);
      // Keep it centred through late layout, until the hold runs out or the
      // operator scrolls.
      const body = root.querySelector(':scope > .ipc-body');
      if (body && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          if (!jumpHeld() || userScrollAtRef.current > startedAt) { ro.disconnect(); return; }
          place(false);
        });
        ro.observe(body);
        setTimeout(() => ro.disconnect(), 2300);
      }
      bcMarkBubbles(nodes, mode, kind);
    });
  }, [thread, msg.id]);

  // ── Profile popup → message jump ───────────────────────────────────
  // The profile popup (notes, activity) dispatches 'bc:jumpToMessage'
  // with { convId, ts, text?, role?, match? }. Target selection lives in
  // findJumpTargetIndex (module level, below ChatBubbleRow):
  //   • `text` — the start of the customer's own message. When given, the
  //     bubble whose content matches wins, which is exact even when the
  //     timestamp is off (live messages are stamped by this browser's
  //     clock, loaded ones by the server's).
  //   • `role:'in'` — only consider customer bubbles.
  //   • `match:'before'` — take the latest bubble at/before ts rather than
  //     the nearest; used when ts is "when the AI noticed", which is always
  //     just AFTER the customer message that triggered it.
  // Old callers that only pass { convId, ts } keep nearest-timestamp.
  React.useEffect(() => {
    // Returns false when the target can't be resolved YET — the thread has
    // not loaded, or this conversation genuinely has no matching bubble.
    // The caller decides whether to park the request and try again.
    const runJump = (detail) => {
      // Nothing to aim at until the real history is here. The preview
      // bubble a chat shows before its messages load used to "match" (it
      // is the last message), the request counted as done and was cleared,
      // and the history then landed underneath it.
      if (awaitingNow(thread)) return false;
      try {
        const demo = typeof euIsDemo === 'function' && euIsDemo();
        if (!demo && typeof MSGS_STORE !== 'undefined' && MSGS_STORE._hydrated
            && !MSGS_STORE._hydrated.has(msg.id) && !(detail.target && resolveJumpTarget(thread, detail.target) >= 0)) {
          return false;
        }
      } catch (_) {}
      const bestIdx = findJumpTargetIndex(thread, detail);
      if (bestIdx < 0) return false;
      const root = threadRef.current;
      if (!root) return false;
      bcLandOnRows(root, [bestIdx], 'jump');
      return true;
    };
    const onJump = (e) => {
      const detail = (e && e.detail) || {};
      if (!detail.convId || detail.convId !== msg.id) return;
      if (runJump(detail)) bcClearParkedJump();
      else bcParkJump(detail);          // thread still loading — try again below
    };
    window.addEventListener('bc:jumpToMessage', onJump);
    // This effect re-runs whenever `thread` changes, which is exactly when a
    // parked request becomes satisfiable: the messages have just arrived.
    const parked = bcTakeParkedJump(msg.id);
    if (parked && runJump(parked)) bcClearParkedJump();
    return () => window.removeEventListener('bc:jumpToMessage', onJump);
  }, [msg.id, thread]);

  // ── Chapter range jump ────────────────────────────────────────────
  // The Chapters section in the profile popup dispatches a
  // 'bc:jumpToRange' event with {convId, startTs, endTs, prevEndTs,
  // nextStartTs, isLatest, chapterId, chapterTitle, chapterSummary, kind}.
  //
  // Instead of guessing bubble indices from timestamps (which drifts
  // because the LLM emits chapter_events AFTER the triggering bubble),
  // we call the Anthropic API with:
  //   • the chapter's title + summary (semantic anchor)
  //   • a numbered list of every candidate bubble's role + content
  //   • the timestamp-narrowed candidate window as a hint
  // The LLM returns the exact [firstIdx, lastIdx] (inclusive, 0-based)
  // into the candidate pool. This is authoritative — no grace math,
  // no over-highlighting from timestamp drift.
  //
  // A timestamp pre-filter narrows candidates to ±90 s around the
  // chapter's declared range so the prompt stays small even in long
  // conversations. The LLM then decides the precise boundaries within
  // that window. Resolved indices are cached by chapterId so repeated
  // clicks on the same chapter skip the API round-trip.
  React.useEffect(() => {
    const _cache = {};

    const applyGlow = (inRange, kind, root) => {
      if (!inRange.length) return;
      bcLandOnRows(root, inRange, 'range', (typeof kind === 'string' && kind) ? kind : 'topic');
    };

    const onJumpRange = async (e) => {
      const d = (e && e.detail) || {};
      const {
        convId: targetId,
        startTs, endTs, prevEndTs, nextStartTs,
        isLatest, kind,
        chapterId, chapterTitle, chapterSummary,
      } = d;
      if (!targetId || targetId !== msg.id) return;
      // ── EXACT RANGE ─────────────────────────────────────────────────
      // Chapter separators send the first and last bubble of the chapter,
      // worked out from the same indices the separators themselves are
      // drawn at. That is the answer — no timestamp window, no model call,
      // no per-chapter cache of indices that go stale the moment a message
      // is added. Same click, same bubbles, however long the chat gets.
      if (d.startTarget) {
        const s = resolveJumpTarget(thread, d.startTarget);
        if (s >= 0) {
          let e = d.endTarget ? resolveJumpTarget(thread, d.endTarget) : s;
          if (e < s) e = s;
          const inRange = [];
          for (let i = s; i <= e; i++) inRange.push(i);
          const root0 = threadRef.current;
          if (root0) applyGlow(inRange, kind, root0);
          return;
        }
      }
      const a0 = Number(startTs) || 0;
      const b0 = Number(endTs)   || a0;
      if (!a0) return;
      const root = threadRef.current;
      if (!root) return;

      // Cache hit — skip API for repeated clicks.
      if (chapterId && _cache[chapterId]) {
        applyGlow(_cache[chapterId], kind, root);
        return;
      }

      // Timestamp pre-filter: generous window so prompt stays small.
      const GRACE = 20000;
      const prevEnd   = Number(prevEndTs)   || 0;
      const nextStart = Number(nextStartTs) || 0;
      const tsLower = prevEnd > 0 ? Math.max(0, prevEnd - 8000) : Math.max(0, a0 - GRACE);
      const tsUpper = (isLatest || nextStart === 0)
        ? (b0 > 0 ? b0 + GRACE : Infinity)
        : nextStart + 8000;

      // Build candidate pool — bubbles inside the timestamp window.
      const candidates = [];
      thread.forEach((mm, i) => {
        const t = mm && mm.ts ? +new Date(mm.ts) : 0;
        if (!t || t < tsLower || t > tsUpper) return;
        const role = mm.r === 'in' ? 'user' : (mm.r === 'bot' ? 'bot' : 'agent');
        const text = (mm.c || '').replace(/\s+/g, ' ').slice(0, 140);
        candidates.push({ i, role, text, t });
      });

      // If timestamp window caught nothing, widen to full thread.
      const pool = candidates.length >= 1 ? candidates : thread.map((mm, i) => ({
        i,
        role: mm.r === 'in' ? 'user' : (mm.r === 'bot' ? 'bot' : 'agent'),
        text: (mm.c || '').replace(/\s+/g, ' ').slice(0, 140),
      }));

      if (!pool.length) return;

      // Single-candidate shortcut — no API needed.
      if (pool.length === 1) {
        const inRange = [pool[0].i];
        if (chapterId) _cache[chapterId] = inRange;
        applyGlow(inRange, kind, root);
        return;
      }

      // LLM call — ask Claude to identify exact bubble boundaries.
      // We send a numbered list of candidate bubbles (role + truncated
      // content) and the chapter title + summary as the semantic anchor.
      // The model returns {"first":<poolIdx>,"last":<poolIdx>} which we
      // map back to thread indices. Pool positions (not thread indices)
      // are used so the prompt stays compact and unambiguous.
      const bubbleList = pool
        .map((b, pi) => `[${pi}] ${b.role}: ${b.text || '(empty)'}`.slice(0, 160))
        .join('\n');

      const systemPrompt = 'You are a precise conversation analyst. ' +
        'Given a chapter description and a numbered list of chat bubbles, ' +
        'return ONLY a JSON object {"first":<number>,"last":<number>} ' +
        'where first and last are the 0-based positions in the provided list ' +
        'of the FIRST and LAST bubble that belong to this chapter. ' +
        'Include every bubble where the conversation is clearly on this topic. ' +
        'Exclude bubbles before this topic started and after it ended. ' +
        'Rules: (1) "user" bubbles that START the topic should be included. ' +
        '(2) "agent"/"bot" bubbles replying to that user are included. ' +
        '(3) Stop at the first bubble clearly on a different topic. ' +
        'Return ONLY the JSON, no explanation, no markdown fences.';

      const userPrompt = `Chapter title: "${chapterTitle || ''}"\nChapter summary: "${chapterSummary || ''}"\nChapter kind: ${kind || 'topic'}\n\nBubbles (list position — role — content):\n${bubbleList}\n\nReturn {"first":<number>,"last":<number>}.`;

      let inRange = [];
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 64,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const raw = (data.content || []).map(b => b.text || '').join('').trim();
          const clean = raw.replace(/```[a-z]*\n?/gi, '').trim();
          const parsed = JSON.parse(clean);
          const first = Number(parsed.first);
          const last  = Number(parsed.last);
          if (Number.isFinite(first) && Number.isFinite(last) && last >= first
              && first >= 0 && last < pool.length) {
            for (let pi = first; pi <= last; pi++) {
              if (pool[pi]) inRange.push(pool[pi].i);
            }
          }
        }
      } catch (_) { /* fall through to timestamp fallback */ }

      // Timestamp fallback — if API failed, use the pre-filtered
      // candidate pool (still far tighter than old ±30s approach).
      if (!inRange.length) {
        inRange = candidates.length ? candidates.map(b => b.i) : pool.map(b => b.i);
      }

      if (!inRange.length) return;
      if (chapterId) _cache[chapterId] = inRange;
      applyGlow(inRange, kind, root);
    };

    window.addEventListener('bc:jumpToRange', onJumpRange);
    return () => window.removeEventListener('bc:jumpToRange', onJumpRange);
  }, [msg.id, thread]);

  // ── Chapter-glow keyframes ────────────────────────────────────────
  // Injected once per page-load. Each chapter `kind` (topic, question,
  // objection, decision, payment, escalation, resolution, small_talk)
  // gets its OWN subtle gradient so different chapters glow in
  // different colours — matching the glyph palette used in the
  // profile popup chapter rows. This way the operator can correlate
  // "the orange chapter row" with "the orange highlighted bubbles"
  // without re-reading the title.
  //
  // Gradient design notes (informed by the existing chapter glyph
  // palette in the profile popup):
  //   • topic        → cool slate (neutral, doesn't compete)
  //   • question     → cool blue (inquiry / curiosity)
  //   • objection    → warm coral (resistance / friction)
  //   • decision     → sage green (commitment / forward motion)
  //   • payment      → soft violet (commercial / transaction)
  //   • escalation   → muted amber (urgency without alarm)
  //   • resolution   → mint green (success / closure)
  //   • small_talk   → dim grey (low signal / off-topic)
  //
  // Each gradient uses 150deg direction (matches the rest of the
  // palette: escalation tint, b-out bubble) and stays in the
  // 0.30-0.55 alpha range so text remains readable.
  //
  // We REPLACE the bubble's base background while glowing (rather
  // than overlaying ::before on top of the original colour) — the
  // operator asked for clean coloured highlighting without the
  // muddy "two colours layered" look. The bubble's base background
  // is suppressed via `background: none !important` on the live
  // bubble, then the gradient is painted as the new background. On
  // animation end, the class is removed and the bubble's natural
  // CSS rules reassert themselves with no flicker.
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('bc-chapter-glow-style')) return;
    const s = document.createElement('style');
    s.id = 'bc-chapter-glow-style';
    s.textContent = `
      /* ── CHAPTER HIGHLIGHT (per-kind gradients) ──
         Played when the operator clicks a chapter row in the profile
         popup. Implementation:

         The bubble's NATIVE background stays alive throughout. The
         coloured highlight is painted as a ::before overlay that
         starts at high alpha (~0.85 — high enough that the bubble's
         own colour is visually subordinate during peak), then fades
         smoothly to 0. As it fades, the bubble's own colour
         re-emerges naturally. When the JS removes the
         .bubble-chapter-glow class (after the animation has fully
         completed), the ::before is gone and the bubble has been at
         its native colour for the last ~300ms anyway — so there's
         no perceivable transition flicker.

         Earlier iterations suppressed the bubble background with
         \`background: transparent !important\` while the class was
         on, then relied on the class-removal to snap it back. That
         design had a 200ms glitch window between animation-end
         (overlay opacity 0) and class-removal where the bubble had
         neither overlay colour NOR its native colour — appearing
         momentarily blank. The current approach keeps the native
         background alive at all times, so no such window exists.

         The keyframe runs ONLY on the ::before pseudo. The .bubble
         element itself is never animated — that would (and did)
         cause the message text to fade with it. */
      /* ── CHAPTER HIGHLIGHT ────────────────────────────────────
         Matches the jump-to-message highlight: a hairline ring and a
         whisper of tint, then gone. It is a "these ones" marker, not an
         alert.

         It used to be a full-bubble wash at 0.85 alpha with the message
         labels forced to near-white with !important. At that strength the
         chapter colour replaced the bubble's own colour outright, so a run
         of highlighted bubbles stopped looking like the conversation and
         started looking like a error state — and because the wash sat over
         the text, the labels had to be shouted back into legibility, which
         is what made it feel loud rather than helpful.

         Now: the bubble keeps its own colour and its own label weights
         throughout. The tint peaks around 0.10, which is enough to pick the
         run out when you scan the column and not enough to notice when you
         are reading it. */
      @keyframes bc-chapter-glow-kf {
        0%   { opacity: 0; }
        12%  { opacity: 1; }
        62%  { opacity: 1; }
        100% { opacity: 0; }
      }
      .bubble.bubble-chapter-glow { position: relative; }
      .bubble.bubble-chapter-glow::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        z-index: 0;
        /* Default — overridden per data-chapter-kind below. */
        background: linear-gradient(150deg, rgba(120,134,156,0.10) 0%, rgba(96,108,128,0.07) 100%);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10);
        animation: bc-chapter-glow-kf 2.2s cubic-bezier(0.25,0.1,0.25,1) both;
      }
      /* Content stays above the tint. With alphas this low it would be
         legible either way, but the stacking keeps text rendering identical
         to an un-highlighted bubble — no re-antialiasing flicker. */
      .bubble.bubble-chapter-glow > * { position: relative; z-index: 1; }

      /* Per-kind tints. Same hues as the profile-popup chapter glyphs so a
         highlighted run is recognisably the chapter you clicked, at a tenth
         of the old strength. Labels and timestamps are deliberately NOT
         touched: the bubble reads exactly as it normally does. */
      .bubble.bubble-chapter-glow[data-chapter-kind="topic"]::before {
        background: linear-gradient(150deg, rgba(120,134,156,0.10) 0%, rgba(96,108,128,0.07) 100%);
      }
      .bubble.bubble-chapter-glow[data-chapter-kind="question"]::before {
        background: linear-gradient(150deg, rgba(74,138,196,0.12) 0%, rgba(52,108,164,0.08) 100%);
      }
      .bubble.bubble-chapter-glow[data-chapter-kind="objection"]::before {
        background: linear-gradient(150deg, rgba(204,118,108,0.12) 0%, rgba(168,86,80,0.08) 100%);
      }
      .bubble.bubble-chapter-glow[data-chapter-kind="decision"]::before {
        background: linear-gradient(150deg, rgba(122,176,134,0.12) 0%, rgba(86,140,106,0.08) 100%);
      }
      .bubble.bubble-chapter-glow[data-chapter-kind="payment"]::before {
        background: linear-gradient(150deg, rgba(146,138,196,0.12) 0%, rgba(112,108,168,0.08) 100%);
      }
      .bubble.bubble-chapter-glow[data-chapter-kind="escalation"]::before {
        background: linear-gradient(150deg, rgba(204,138,92,0.12) 0%, rgba(168,108,72,0.08) 100%);
      }
      .bubble.bubble-chapter-glow[data-chapter-kind="resolution"]::before {
        background: linear-gradient(150deg, rgba(108,176,144,0.12) 0%, rgba(80,140,114,0.08) 100%);
      }
      .bubble.bubble-chapter-glow[data-chapter-kind="small_talk"]::before {
        background: linear-gradient(150deg, rgba(112,118,128,0.09) 0%, rgba(88,94,104,0.06) 100%);
      }
      @media (prefers-reduced-motion: reduce) {
        .bubble.bubble-chapter-glow::before { animation: none; opacity: 1; }
      }
    `;
    document.head.appendChild(s);
  }, []);

  ensureComposerStyles();
  const liveDraft = useDraft(msg.id);
  useDraftTick(msg.id);  // forces re-render every 250ms while a draft exists
  const hasAiDraft = !!liveDraft;
  // Local edit buffer — mirrors liveDraft.text, but allows the user to type
  // freely without colliding with engine updates. We push edits back to the
  // store when the user pauses to take over.
  const [editText, setEditText] = React.useState('');
  React.useEffect(() => {
    if (liveDraft) setEditText(liveDraft.text);
    // Watch chunkIndex too — when the engine moves to the next chunk in a
    // multi-message reply, the new draft might briefly share text with the
    // previous one before the engine updates it. Tying the reset to the
    // chunk index guarantees the textarea always reflects the current
    // chunk's content, never a stale edit from the previous one.
  }, [liveDraft?.text, liveDraft?.chunkIndex, msg.id]);
  // When a fresh draft opens, force the composer into AI mode.
  React.useEffect(() => {
    if (liveDraft) setComposerMode('ai');
  }, [!!liveDraft, msg.id]);

  // Countdown seconds remaining until auto-send (paused → frozen value).
  const remainingMs = liveDraft
    ? (liveDraft.paused ? liveDraft.pausedAtRemaining : Math.max(0, liveDraft.sendAt - Date.now()))
    : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);

  // Load thread from DB (or store cache) when conversation opens.
  // The subscription only calls setThread when content actually changes
  // (length or last message id differs) — avoids re-renders from unrelated
  // conv updates triggering a full MSGS_STORE notification.
  React.useEffect(()=>{
    let cancelled = false;
    MSGS_STORE.setActive(msg.id);
    MSGS_STORE.markRead(msg.id);
    // One change detector for both the history fetch and live updates, so
    // an already-hydrated conversation (the common case when switching
    // back) doesn't re-copy and re-render an identical thread. The store
    // array's identity is part of it: a merge replaces the array, a live
    // message pushes onto it (length), and a late media URL bumps mediaRev.
    let lastArr = null, lastSig = '';
    const sigOf = (arr) => {
      const last = arr[arr.length - 1];
      // mediaRev is part of the fingerprint because a media URL arriving for
      // a message already in the thread changes none of the other terms —
      // not the length, not the last timestamp, not the text. Without it the
      // store held the photo and the open chat kept showing the "[Photo]"
      // placeholder until the conversation was reopened.
      const rev = (MSGS_STORE.mediaRev && MSGS_STORE.mediaRev[msg.id]) || 0;
      return `${arr.length}:${last?.ts||''}:${last?.c?.slice(0,12)||''}:${last?.mu ? 1 : 0}:${rev}`;
    };
    const apply = (arr) => {
      if (!arr || !arr.length) return;
      const sig = sigOf(arr);
      if (arr === lastArr && sig === lastSig) return;   // nothing changed for this conv
      lastArr = arr; lastSig = sig;
      setThread([...arr]);
    };
    // The render-time seed already reflects the store as it is right now.
    const seeded = MSGS_STORE.getThreadSync(msg.id);
    if (seeded.length) { lastArr = seeded; lastSig = sigOf(seeded); }
    MSGS_STORE.loadThread(msg.id).then(msgs=>{
      if (cancelled) return;
      // Always commit once the fetch has come back — even when nothing
      // changed — so the thread re-checks and lifts its loading state.
      const arr = (msgs && msgs.length) ? msgs : MSGS_STORE.getThreadSync(msg.id);
      lastArr = arr; lastSig = sigOf(arr);
      if (arr.length) setThread([...arr]);
      // Nothing came back at all: show the inbox preview as a settled row
      // (it carries a time, so it no longer reads as "still loading").
      else setThread(msg.last ? [{r:'in', c:msg.last, t:msg.t||'', ts:(msg.ts || (convOpenedAtRef.current - 1))}] : []);
    });
    const unsub = MSGS_STORE.sub(()=>{
      apply(MSGS_STORE.getThreadSync(msg.id));
    });
    return ()=>{
      cancelled = true;
      unsub();
      if (MSGS_STORE.activeConvId === msg.id) MSGS_STORE.setActive(null);
    };
  },[msg.id]);

  // ══ MESSAGE ACTIONS — reply, edit, and the right-click menu ═══════════
  // Keyed by conversation, so switching chats never shows another chat's
  // reply/edit bar for even one frame.
  const [actState, setActState] = React.useState(null);   // {convId, mode, row}
  const act      = actState && actState.convId === msg.id ? actState : null;
  const replyRow = act && act.mode === 'reply' ? act.row : null;
  const editRow  = act && act.mode === 'edit'  ? act.row : null;
  const actRef   = React.useRef(null);
  actRef.current = act;
  // What was in the composer before an edit started — put back afterwards.
  const preEditDraftRef = React.useRef(null);

  const setComposerText = React.useCallback((val) => {
    const v = String(val || '');
    const ta = taRef.current;
    if (ta) {
      ta.value = v;
      ta.style.height = 'auto';
      ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
    }
    syncInput(v);
  }, [syncInput]);

  const focusComposer = React.useCallback(() => {
    requestAnimationFrame(() => {
      try {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus({ preventScroll: true });
        const n = ta.value.length;
        ta.setSelectionRange(n, n);
      } catch (_) {}
    });
  }, []);

  const leaveEdit = React.useCallback(() => {
    const a = actRef.current;
    if (a && a.mode === 'edit') {
      setComposerText(preEditDraftRef.current || '');
      preEditDraftRef.current = null;
    }
  }, [setComposerText]);

  const startReply = React.useCallback((row) => {
    if (!row) return;
    leaveEdit();
    setActState({ convId: msg.id, mode: 'reply', row });
    setFocused(true);
    focusComposer();
  }, [msg.id, leaveEdit, focusComposer]);

  const startEdit = React.useCallback((row) => {
    if (!row) return;
    const a = actRef.current;
    if (!(a && a.mode === 'edit')) preEditDraftRef.current = inputTextRef.current || '';
    setActState({ convId: msg.id, mode: 'edit', row });
    setComposerText(String(row.c || '').replace(MEDIA_LABEL_RE, '').trim());
    setFocused(true);
    focusComposer();
  }, [msg.id, setComposerText, focusComposer]);

  const cancelAct = React.useCallback(() => {
    leaveEdit();
    setActState(null);
  }, [leaveEdit]);

  // The quoted/edited message went away (deleted on the platform, removed
  // here, or deleted for everyone) — drop the bar rather than act on it.
  React.useEffect(() => {
    const a = actRef.current;
    if (!a) return;
    if (a.row.del || a.row._pending === 'delete' || !thread.includes(a.row)) cancelAct();
  }, [thread, cancelAct]);

  // Leaving a chat mid-edit: that chat's composer draft is the text it had
  // before the edit, not the half-edited message.
  React.useEffect(() => () => {
    const a = actRef.current;
    if (a && a.mode === 'edit') {
      try { INPUT_DRAFTS.set(a.convId, preEditDraftRef.current || ''); } catch (_) {}
    }
    preEditDraftRef.current = null;
  }, [msg.id]);

  // ArrowUp in an empty composer edits your last message (as in Telegram).
  const lastEditableOwn = React.useCallback(() => {
    for (let i = thread.length - 1, seen = 0; i >= 0 && seen < 25; i--, seen++) {
      const r = thread[i];
      if (r && r.r !== 'in' && MSGS_STORE.capabilities(msg, r).edit) return r;
    }
    return null;
  }, [thread, msg]);

  // ArrowUp from anywhere in the open chat, not just the composer — the
  // operator has usually just clicked into the thread, which takes focus
  // away from the text box. Same rules as in the composer: nothing typed,
  // not already replying/editing, and only a message the platform lets us
  // edit (your own, with text, already delivered). Keys typed into any
  // other field, or with a dialog/menu open, are left alone.
  const lastEditableRef = React.useRef(lastEditableOwn);
  lastEditableRef.current = lastEditableOwn;
  const startEditRef = React.useRef(null);
  startEditRef.current = startEdit;
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowUp' || e.defaultPrevented || e.repeat || e.isComposing) return;
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const ta = taRef.current;
      if (!ta || ta.disabled || !ta.isConnected) return;
      const el = document.activeElement;
      if (el === ta) return;                     // the composer's own handler has it
      const chat = ta.closest('.ipc');
      if (!chat || chat.closest('[aria-hidden="true"]')) return;   // hidden (one-pane list)
      if (el && el !== document.body && el !== document.documentElement) {
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) return;
        if (!chat.contains(el)) return;          // focus is somewhere else in the app
      }
      if (actRef.current) return;
      if ((inputTextRef.current || '').trim()) return;
      if (document.querySelector('[role="dialog"], [role="menu"], .bc-modal-open, .sset-subpop')) return;
      const last = lastEditableRef.current && lastEditableRef.current();
      if (!last || !startEditRef.current) return;
      e.preventDefault();
      startEditRef.current(last);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [mctx, setMctx] = React.useState(null);   // {x, y, row, ti}
  React.useEffect(() => {
    setMctx(null);
    const h = (e) => {
      const d = (e && e.detail) || {};
      if (d.convId !== msg.id || !d.row) return;
      setMctx({ x: d.x, y: d.y, ay: d.ay, row: d.row, ti: d.ti });
    };
    window.addEventListener('bc-msg-ctx', h);
    return () => window.removeEventListener('bc-msg-ctx', h);
  }, [msg.id]);
  const closeMctx = React.useCallback(() => setMctx(null), []);
  // Outline the bubble the menu belongs to while it is open.
  React.useEffect(() => {
    if (!mctx || mctx.ti == null) return;
    const root = threadRef.current;
    const el = root && root.querySelector(`.brow[data-ti="${mctx.ti}"]`);
    if (el) el.setAttribute('data-ctx-target', '1');
    return () => { if (el) el.removeAttribute('data-ctx-target'); };
  }, [mctx]);

  // ── CONTACT DELETED WHILE ITS CHAT IS OPEN ──
  // MSGS_STORE.removeConversation announces it; the chat fades out and
  // returns to the home screen instead of staying on a contact that no
  // longer exists.
  const [exiting, setExiting] = React.useState(false);
  React.useEffect(() => {
    setExiting(false);
    let t = null;
    const h = (e) => {
      if (!e || !e.detail || e.detail.convId !== msg.id) return;
      setMctx(null);
      setExiting(true);
      let reduce = false;
      try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
      t = setTimeout(() => { try { onClose && onClose(); } catch (_) {} }, reduce ? 0 : 250);
    };
    window.addEventListener('bc-conv-removed', h);
    return () => { clearTimeout(t); window.removeEventListener('bc-conv-removed', h); };
  }, [msg.id, onClose]);

  const sendManual = ()=>{
    const raw  = inputTextRef.current || '';
    const text = raw.trim();
    // ── Edit mode: Enter saves the edit, nothing is sent as new. ──
    if (editRow) {
      if (!text) return;                 // platforms don't allow an empty edit
      MSGS_STORE.editMessage(msg.id, editRow, text);
      const restore = preEditDraftRef.current || '';
      preEditDraftRef.current = null;
      setActState(null);
      setComposerText(restore);
      return;
    }
    // ── Reply: the first message out quotes the chosen one. ──
    const replyQuote = replyRow ? MSGS_STORE.quoteOf(replyRow) : null;
    const replyRef   = replyRow ? MSGS_STORE.parseUid(replyRow.uid) : null;
    let replyUsed = false;
    const replyArgs = () => {
      if (replyUsed || !replyRef) return {};
      replyUsed = true;
      return { replyTo: replyRef.pid, replyVia: replyRef.via };
    };
    // Read the queue from the map rather than from `atts`: Enter can fire
    // from a keydown handler closed over a render older than the last file
    // that was added, and the map is always current.
    const queued = ATTACH_DRAFTS.get(msg.id) || [];
    if(!text && !queued.length) return;
    // A file still being read off disk would be dropped by the clear below.
    if (attBusy) return;
    // Clear ref + DOM + state in one shot.
    inputTextRef.current = '';
    INPUT_DRAFTS.clear(msg.id);
    if (taRef.current) {
      taRef.current.value = '';
      taRef.current.style.height = 'auto';
    }
    setHasText(false);
    setInputLen(0);
    putAtts([]);
    if (replyRow) setActState(null);

    const bridge   = (window.BotBridge && msg.chatId) ? window.BotBridge : null;
    const canMedia = !!(bridge && typeof bridge.sendMedia === 'function');

    // One file with a short line of text goes out as a single captioned
    // message, which is what the customer expects to see. More than one
    // file, or text past the platform's caption limit, is sent as
    // text-then-files instead — a caption that overflows is rejected or
    // truncated platform-side, and losing the operator's words is worse
    // than an extra bubble.
    const asCaption = canMedia && queued.length === 1 && !!text && text.length <= ATT_CAPTION_CAP;

    if (text && !asCaption) {
      const reqId = MSGS_STORE._newReq('s');
      const ra = replyArgs();
      // The tagged send (reqId, reply) goes through the generic bridge
      // channel; older hosts ignore the extra fields and still deliver.
      if (bridge && !bcBridgeSend('sendMessage', { platform: msg.p, chatId: msg.chatId, text, reqId, ...ra })) {
        bridge.sendMessage(msg.p, msg.chatId, text);
      }
      MSGS_STORE.onOutbound(msg.id, msg.chatId, msg.p, text, { reqId, reply: ra.replyTo ? replyQuote : null });
    }

    queued.forEach((a, i) => {
      const caption = (asCaption && i === 0) ? text : '';
      const reqId = MSGS_STORE._newReq('s');
      let ra = {};
      if (canMedia) {
        // Data URL in, real file out — the host decodes it and uploads with
        // the operator's original filename and extension.
        ra = replyArgs();
        if (!bcBridgeSend('sendMedia', { platform: msg.p, chatId: msg.chatId, mediaUrl: a.url, caption,
              mediaKind: bridgeKindOf(a.kind), fileName: a.name || '', reqId, ...ra })) {
          bridge.sendMedia(msg.p, msg.chatId, a.url, caption, bridgeKindOf(a.kind), a.name || '');
        }
      } else if (bridge) {
        // Host build predates sendMedia. Say so in the chat rather than let
        // the operator believe a file went out that never did.
        bridge.sendMessage(msg.p, msg.chatId,
          (caption ? caption + '\n' : '') + '[attachment: ' + (a.name || a.kind) + ']');
      }
      MSGS_STORE.onOutboundMedia(msg.id, msg.chatId, msg.p, a.url, caption, a.kind, {
        filename: a.name || '',
        thumbUrl: a.thumb || '',
        reqId: canMedia ? reqId : '',
        reply: ra.replyTo ? replyQuote : null,
      });
    });
  };
  // Send the AI draft NOW (whatever's currently in the edit buffer). The
  // engine's awaiting Promise resolves and it actually fires the message.
  const sendAI = () => {
    if (!liveDraft) return;
    DRAFT_STORE.setText(msg.id, editText);
    DRAFT_STORE.sendNow(msg.id);
  };
  // Pause/take-over: clicking the draft area or the edit field should stop
  // the timer so the user has time to read and tweak.
  const pauseDraft = () => { if (liveDraft && !liveDraft.paused) DRAFT_STORE.pause(msg.id); };
  const resumeDraft = () => { if (liveDraft && liveDraft.paused) DRAFT_STORE.resume(msg.id); };
  // The Send button follows what's in the composer: words or files typed by
  // the operator go out as their reply; an empty composer sends the AI draft.
  const manualReady = hasText || atts.length > 0;
  const sendMode    = manualReady ? 'manual' : (hasAiDraft ? 'ai' : null);
  const sendFromButton = () => { if (sendMode === 'manual') sendManual(); else if (sendMode === 'ai') sendAI(); };
  // Discard the AI draft entirely — engine will skip sending.
  const discardDraft = () => { if (liveDraft) DRAFT_STORE.discard(msg.id); };

  // ── Pipeline drawer state ──────────────────────────────────
  // Operator-only side panel. Declared early above; handlers wired here.

  // ── Topbar AI/agent control state ──────────────────────────
  const agents       = useAgents();
  const aiMenuRef    = React.useRef(null);   // pill container (layout anchor)
  const aiTrigRef    = React.useRef(null);   // robot trigger button
  const aiMenuElRef  = React.useRef(null);   // the portaled menu element
  const currentAgent = agents.find(x=>x.id===msg.agent_id) || null;
  // The header (.ipc-hdr) uses `contain: layout style` and sits inside two
  // overflow:hidden columns. The old dropdown was trapped in that 44px
  // stacking/containment context — it painted over the thread but its buttons
  // couldn't be clicked. We portal the menu to <body> and anchor it with
  // position:fixed against the trigger's viewport rect, so it's fully
  // interactive and never clipped.
  const [aiMenuPos, setAiMenuPos] = React.useState(null);
  React.useLayoutEffect(()=>{
    if (!aiMenuOpen) return;
    const place = () => {
      const el = aiTrigRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const W = 224;
      let left = r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
      setAiMenuPos({ top: Math.round(r.bottom + 6), left: Math.round(left), width: W });
    };
    place();
    const on = () => place();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    const close = (e) => {
      if (aiMenuElRef.current && aiMenuElRef.current.contains(e.target)) return;
      if (aiTrigRef.current   && aiTrigRef.current.contains(e.target))   return;
      setAiMenuOpen(false);
    };
    const t = setTimeout(()=>document.addEventListener('mousedown', close), 0);
    return ()=>{
      window.removeEventListener('scroll', on, true);
      window.removeEventListener('resize', on);
      clearTimeout(t);
      document.removeEventListener('mousedown', close);
    };
  }, [aiMenuOpen]);
  // Close on escape.
  React.useEffect(()=>{
    if (!aiMenuOpen) return;
    const h = (e) => { if (e.key === 'Escape') { setAiMenuOpen(false); } };
    window.addEventListener('keydown', h);
    return ()=>window.removeEventListener('keydown', h);
  }, [aiMenuOpen]);

  // Assign / unassign agent. Drops any pending draft (it was generated
  // by the previous agent's persona/model and would be stale).
  // Assigning an agent implicitly enables AI for this conversation;
  // unassigning disables it so the operator takes full control.
  // Assign / unassign agent.
  //
  // The work itself lives in MSGS_STORE.assignAgent so this control and the
  // inbox one cannot drift apart again — they did, and the quieter of the
  // two produced conversations that named an agent and never replied. The
  // store clears the post-sale stop, the escalation pause, any queued
  // automatic unassign, the spam cooldown and the engine's retry latches,
  // turns auto_reply on in the same server call as the assignment, and then
  // answers the customer if one is already waiting.
  const assignAgent = (a) => {
    MSGS_STORE.assignAgent(msg, a || null);
    setAiMenuOpen(false);
  };

  return (
    <div className={exiting ? 'ipc ipc-exit' : 'ipc'} onScroll={pinClipScroll} style={chatWidth ? {'--msg-col-w': `${chatWidth}px`} : undefined}>
      {mctx && (
        <TopLayer>
          <MessageCtxMenu x={mctx.x} y={mctx.y} ay={mctx.ay} row={mctx.row} conv={msg}
            onClose={closeMctx} onReply={startReply} onEdit={startEdit}/>
        </TopLayer>
      )}
      {/* ── CHAT COLUMN ──
          Also the file drop target. [data-bc-dropzone] is what the global
          guard installed at the top of this file looks for: outside a
          marked zone a dropped file is cancelled outright, because
          WebView2's default is to navigate to it and take the whole app
          down with it. */}
      <div
        className="ipc-chat-col"
        onScroll={pinClipScroll}
        data-bc-dropzone=""
        onDragEnter={e=>{
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          dragDepthRef.current += 1;
          setDragOver(true);
        }}
        onDragOver={e=>{
          if (!dragHasFiles(e)) return;
          e.preventDefault();                 // without this, 'drop' never fires
          try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
        }}
        onDragLeave={e=>{
          if (!dragHasFiles(e)) return;
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragOver(false);
        }}
        onDrop={onDropFiles}>

      {/* ── HEADER ── Minimalist redesign.
          Previously this bar had THREE independent glass elements
          (back-chip, identity-island, AI-agent-chip), each with its own
          backdrop-filter, border, shadow and hover state. That created
          three competing focal points and a lot of visual noise for what
          is functionally just "who am I talking to / who's replying".

          Now there are TWO surfaces:
            • A small back chip on the left.
            • ONE unified identity pill in the center that combines the
              contact identity AND the AI agent into a single glass
              element. It has two interactive zones separated by a
              hairline divider:
                · LEFT zone  — avatar + name + handle. Click to open
                  the customer record (was: identity island).
                · RIGHT zone — agent dot + agent name + chevron. Click
                  to open the AI dropdown (was: agent chip).
              One backdrop-filter, one border, one shadow → one premium
              glass surface, two affordances.                            */}
      <div className="ipc-hdr" style={{
        display:'flex', alignItems:'center',
        padding:'0 12px', position:'relative', gap:6,
        background:'transparent',
        backdropFilter:'none', WebkitBackdropFilter:'none',
        borderBottom:'none',
      }}>
        {/* Left: back + optional home button cluster.
            Both are 28×28 circles so they sit at the same visual weight.
            Home is subtler (no border, lower opacity) so back stays primary. */}
        <div style={{display:'flex', alignItems:'center', gap:2, flexShrink:0}}>
          <button onClick={onBack || onClose}
            title={onBack && backTarget ? `Back to ${backTarget.name}` : 'Back to messages'}
            style={{
              flexShrink:0, width:28, height:28, borderRadius:'50%',
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'var(--t2)',
              background:'rgba(255,255,255,0.05)',
              border:'1px solid rgba(255,255,255,0.06)',
              backdropFilter:'none', WebkitBackdropFilter:'none',
              cursor:'pointer', transition:'background 0.12s, color 0.12s, border-color 0.12s',
              padding:0,
            }}
            onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.10)';e.currentTarget.style.color='var(--t1)';e.currentTarget.style.borderColor='rgba(255,255,255,0.12)';}}
            onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.05)';e.currentTarget.style.color='var(--t2)';e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          {/* Home — only when there's a back-nav stack to jump over.
              Visually quieter than back: no border, dimmer icon. */}
          {onBack && onClose && (
            <button onClick={onClose}
              title="Home — back to message list"
              style={{
                flexShrink:0, width:28, height:28, borderRadius:'50%',
                display:'flex', alignItems:'center', justifyContent:'center',
                color:'var(--t3)',
                background:'transparent',
                border:'1px solid transparent',
                backdropFilter:'none', WebkitBackdropFilter:'none',
                cursor:'pointer', transition:'background 0.12s, color 0.12s, border-color 0.12s',
                padding:0,
                animation:'ipc-home-in 0.18s cubic-bezier(0.16,1,0.3,1)',
              }}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.06)';e.currentTarget.style.color='var(--t2)';e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';}}
              onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--t3)';e.currentTarget.style.borderColor='transparent';}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1z"/>
                <polyline points="9 21 9 12 15 12 15 21"/>
              </svg>
            </button>
          )}
          <style>{`@keyframes ipc-home-in{from{opacity:0;transform:scale(0.6) translateX(-4px)}to{opacity:1;transform:scale(1) translateX(0)}}`}</style>
        </div>

        {/* ── CENTERED UNIFIED IDENTITY PILL ──
            One glass surface, two interactive zones. Wraps in a
            single absolutely-centered container so it stays optically
            balanced regardless of left/right content.                  */}
        <div ref={aiMenuRef} className="bc-idpill" style={{
          position:'absolute', left:'50%', top:'50%',
          transform:'translate(-50%, -50%)',
          display:'inline-flex', alignItems:'stretch',
          maxWidth:'calc(100% - 80px)',
          height:32,
          background: summaryOpen ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${summaryOpen ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.08)'}`,
          backdropFilter:'blur(12px)',
          WebkitBackdropFilter:'blur(12px)',
          borderRadius:999,
          boxShadow: '0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.07)',
          overflow:'visible',
          transition:'background 0.15s, border-color 0.15s',
          zIndex:2,
        }}>
          {/* ── LEFT ZONE — identity. Hover shows the AI summary beside the
              pill; click toggles it (for touch). No popup any more. ── */}
          <button
            ref={idZoneRef}
            onMouseEnter={summaryShow}
            onMouseLeave={summaryHide}
            onFocus={summaryShow}
            onBlur={summaryHide}
            onClick={()=>{ clearTimeout(summaryTimerRef.current); setAiMenuOpen(false); setSummaryOpen(o=>!o); }}
            aria-label={`${msg.name}${msg.handle?' · '+msg.handle:''} · ${a.label}${hasSummary ? '. Show AI summary' : ''}`}
            aria-expanded={hasSummary ? summaryOpen : undefined}
            style={{
              display:'inline-flex', alignItems:'center', gap:8,
              padding:'3px 10px 3px 3px',
              maxWidth:240,
              background:'transparent',
              border:'none',
              borderRadius:999,
              cursor: hasSummary ? 'pointer' : 'default', userSelect:'none', overflow:'hidden',
              transition:'background 0.12s',
            }}
            onPointerEnter={e=>{ e.currentTarget.style.background='rgba(255,255,255,0.04)'; }}
            onPointerLeave={e=>{ e.currentTarget.style.background='transparent'; }}>
            {/* Avatar — status ring (bottom-right) + platform badge (top-right). */}
            <div ref={idAvatarRef} style={{position:'relative', flexShrink:0, width:26, height:26}}>
              <Ava name={msg.name} col={msg.col} sz={26} src={msg.avatar}/>
              <span style={{
                position:'absolute', top:-2, right:-2,
                width:11, height:11, borderRadius:'50%',
                background:'#14162680',
                border:'1.5px solid #14162680',
                display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 0 0 1.5px rgba(20,22,38,0.9)',
              }}>
                {msg.p==='telegram'?<TgIcon s={7}/>:<DcIcon s={7}/>}
              </span>
              <span style={{
                position:'absolute', right:-1, bottom:-1,
                width:8, height:8, borderRadius:'50%',
                background: a.col,
                border: '2px solid #14162680',
                boxShadow: a.pulse ? `0 0 0 0 ${a.col}55` : 'none',
                animation: a.pulse ? 'chip-pulse 1.8s ease-in-out infinite' : 'none',
              }}/>
            </div>
            <span style={{
              fontSize:12.5, fontWeight:600, color:'var(--t1)', letterSpacing:'-0.01em',
              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
              lineHeight:1, paddingBottom:1,
            }}>{msg.name}</span>
            <style>{`@keyframes chip-pulse {
              0%,100% { box-shadow: 0 0 0 0 ${a.col}55; }
              50%     { box-shadow: 0 0 0 4px ${a.col}00; }
            }`}</style>
          </button>

          {/* ── AGENT BUBBLE — detached, just right of the pill (see .bc-agb) ── */}
          {agents.length > 0 && (
            <button
              ref={aiTrigRef}
              type="button"
              className="bc-agb"
              // The summary belongs to the name, not the agent: moving onto
              // the bubble closes it at once so it's never in the way.
              onMouseEnter={()=>{ clearTimeout(summaryTimerRef.current); setSummaryOpen(false); }}
              data-on={currentAgent ? '1' : '0'}
              data-open={aiMenuOpen ? '1' : '0'}
              onClick={()=>{ clearTimeout(summaryTimerRef.current); setSummaryOpen(false); setAiMenuOpen(o=>!o); }}
              title={currentAgent
                ? `${currentAgent.name}${currentAgent.active ? '' : ' (paused)'} — change agent`
                : 'Assign an AI agent'}
              aria-label={currentAgent ? `AI agent ${currentAgent.name}. Change agent` : 'Assign an AI agent'}
              aria-haspopup="menu" aria-expanded={aiMenuOpen}
              data-bot-trigger>
              <span className="bc-agb-ico">
                <AgentMark size={14}/>
                {currentAgent
                  ? <span className="bc-agb-dot" data-live={currentAgent.active ? '1' : '0'}/>
                  : <span className="bc-agb-plus" aria-hidden="true">
                      <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                    </span>}
              </span>
              {currentAgent && (
                <span className="bc-agb-more">
                  <span className="bc-agb-name">{currentAgent.name}</span>
                  <svg className="bc-agb-chev" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </span>
              )}
            </button>
          )}

          {/* ── AI AGENT MENU — the app's context-menu material, portaled ── */}
          {aiMenuOpen && aiMenuPos && ReactDOM.createPortal(
            <div
              ref={aiMenuElRef}
              role="menu"
              className="bc-agm"
              style={{ top:aiMenuPos.top, left:aiMenuPos.left, width:aiMenuPos.width }}>
              <div className="bc-agm-head">{currentAgent ? 'AI agent for this chat' : 'Assign an AI agent'}</div>
              <div className="bc-agm-line"/>
              <div className="bc-agm-list">
                {agents.map(ag => {
                  const sel = ag.id === msg.agent_id;
                  return (
                    <button key={ag.id} onClick={()=>assignAgent(ag)} role="menuitemradio" aria-checked={sel}
                      className="bc-agm-row" data-sel={sel ? '1' : '0'}
                      title={`${ag.name} · ${modelLabel(ag.model)}${ag.active ? '' : ' · paused'}`}>
                      <span className="bc-agm-live" data-live={ag.active ? '1' : '0'} aria-hidden="true"/>
                      <span className="bc-agm-name">{ag.name}</span>
                      <span className="bc-agm-model">{ag.active ? modelLabel(ag.model) : 'paused'}</span>
                      <span className="bc-agm-check" aria-hidden="true">
                        {sel && (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                               strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {currentAgent && (
                <React.Fragment>
                  <div className="bc-agm-line"/>
                  <div className="bc-agm-foot">
                    <button onClick={()=>assignAgent(null)} className="bc-agm-off" role="menuitem">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                      Unassign agent
                    </button>
                  </div>
                </React.Fragment>
              )}
            </div>,
            document.body
          )}
        </div>

        <ChatSummaryHover
          open={summaryOpen && !aiMenuOpen}
          anchorEl={aiMenuRef.current}
          avatarEl={idAvatarRef.current}
          data={euRecord}
          onEnter={summaryKeep}
          onLeave={summaryHide}/>

        {/* Spacer keeps left/right balance — no right-edge actions anymore. */}
        <div style={{flex:1}}/>
      </div>

      {/* ── THREAD ── */}
      <div className="ipc-thread" ref={threadRef} onScroll={onThreadScroll}
        onWheel={markUserScroll} onTouchMove={markUserScroll} onKeyDown={onThreadKeyDown}
        onPointerDown={(e) => { if (e.target === e.currentTarget) markUserScroll(); }}
        onMouseMove={(e) => {
          // Composer reveal — tracked here (rather than with an overlay div
          // sitting on top of the thread) so nothing is ever painted above
          // real chat content. See the note where the old hot-zone used to
          // sit, just below.
          const r = e.currentTarget.getBoundingClientRect();
          setHover(e.clientY >= r.bottom - 120);
        }}
        onMouseLeave={() => setHover(false)}
        style={{paddingBottom: hasAiDraft ? 220 : 90, transition: (isFirstRenderOfConv || justSwitchedRef.current) ? 'none' : 'padding-bottom 0.22s ease'}}>
        <div className="ipc-body">
          {threadRowsEl}
        </div>
      </div>

      {/* Loading placeholder for a chat whose history is still on its way.
          Shown/hidden directly by maskThread/showThread (no re-render), and
          only fades in after a short delay, so a fast load never shows it. */}
      <ThreadSkeleton skelRef={skelRef}/>

      {/* ── FILE DROP OVERLAY ── (see ChatDropOverlay) */}
      {dragOver && <ChatDropOverlay/>}

      {/* ── COMPOSER HOVER HOT-ZONE ──
          Used to be a standalone absolutely-positioned strip here, on top
          of the thread with pointerEvents:'auto'. That div covered the
          bottom 120px of the WHOLE chat surface — not just empty space —
          so any real content that scrolled into that band (a moment's
          action button, the last bubble, etc.) had a click-blocking layer
          sitting in front of it. It only looked safe because the composer
          itself sits at a higher z-index; nothing accounted for the
          thread's own content being underneath it too. The reveal is now
          driven by onMouseMove/onMouseLeave on .ipc-thread above, which
          observes the cursor instead of intercepting it — no overlay, so
          nothing is ever in front of a click meant for the chat. */}

      {/* ── COMPOSER ──
          Premium "squircle" shape (large 18px radius — softer than a
          rounded rectangle, more refined than a pill). Sits raised
          26px off the bottom so it doesn't feel jammed against the
          edge. Slides down out of view when idle, slides back when
          active. Inside: a beautifully laid out AI draft preview
          stack (when present) followed by the type/send row. */}
      {(() => {
        // Queued files, a file mid-read, and an in-flight drag all count as
        // activity — the composer sliding away with attachments sitting in
        // it would read as the app having thrown them out.
        const composerActive = hover || focused || hasText || hasAiDraft
          || atts.length > 0 || attBusy || dragOver || !!act || bcNoHover();
        // isFirstRenderOfConv is computed at render time from renderedMsgIdRef
        // vs msg.id — true on the very first render of a new conv. This is
        // the correct gate for suppressing the composer slide-in transition.
        // Using justSwitchedRef.current here was wrong: the ref is stale on
        // the first render (effects haven't run yet) so the transition was
        // always enabled on the first paint, causing the visible slide-in.
        // noTransition suppresses composer slide when:
        //   A) isFirstRenderOfConv — first paint of a new conv (ref not yet updated)
        //   B) justSwitchedRef.current — subsequent renders before 120ms window ends
        //      (covers focused=true from auto-focus firing at ~60ms)
        const noTransition = isFirstRenderOfConv || justSwitchedRef.current;
        return (
      <div
        ref={composerWrapRef}
        className="bc-comp"
        data-draft={hasAiDraft && composerMode==='ai' && !editRow ? '1' : '0'}
        data-act={act ? act.mode : undefined}
        onMouseEnter={()=>{setHover(true); setComposerHover(true);}}
        onMouseLeave={()=>{setHover(false); setComposerHover(false);}}
        style={{
          position:'absolute', bottom:22, left:'50%',
          transform: composerActive
            ? 'translateX(-50%) translateY(0)'
            : 'translateX(-50%) translateY(calc(100% + 22px))',
          opacity: composerActive ? 1 : 0,
          width:'calc(100% - 64px)', zIndex:10,
          transition: noTransition ? 'none' : COMPOSER_TRANSITION,
          pointerEvents: composerActive ? 'auto' : 'none',
        }}>
        <div className="bc-comp-in" ref={composerInRef}>
        {/* AI draft inline in composer — editable. For multi-message replies
            each chunk arrives as its own draft; we show position (e.g. "2/3"),
            a progress bar, the editable current chunk, and a faint preview
            of upcoming chunks queued behind. */}
        {/* ── Reply / edit bar ── */}
        {act && (
          <div className="bc-cbar">
            <span className="bc-cbar-ico" aria-hidden="true">
              {act.mode === 'edit' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/></svg>
              )}
            </span>
            <div className="bc-cbar-body">
              <div className="bc-cbar-title">
                {act.mode === 'edit' ? 'Editing message' : 'Replying to ' + quoteWho({ r: act.row.r }, msg)}
              </div>
              <div className="bc-cbar-txt">{quoteText(MSGS_STORE.quoteOf(act.row))}</div>
            </div>
            <button type="button" className="bc-cbar-x" onClick={cancelAct}
              title={act.mode === 'edit' ? 'Cancel edit (Esc)' : 'Cancel reply (Esc)'} aria-label="Cancel">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        )}
        {hasAiDraft && composerMode==='ai' && !editRow && (() => {
          const chunkTotal = liveDraft.chunkTotal || 1;
          const chunkIdx   = (liveDraft.chunkIndex || 0) + 1;
          const isMulti    = chunkTotal > 1;
          const totalDelay = liveDraft.delayMs || 1;
          const elapsed    = liveDraft.paused
            ? Math.max(0, totalDelay - liveDraft.pausedAtRemaining)
            : Math.max(0, totalDelay - remainingMs);
          const progress   = Math.max(0, Math.min(1, elapsed / totalDelay));
          const isPaused   = !!liveDraft.paused;
          const agentName  = liveDraft.agent || msg.agent;
          return (
          <div className="bc-dr" onClick={pauseDraft}>
            {/* Header: state · agent · position ……… countdown or resume · discard */}
            <div className="bc-dr-head">
              <span className="bc-dr-status" data-state={isPaused ? 'paused' : 'live'}>
                <span className="bc-dr-dot" aria-hidden="true"/>
                {isPaused ? 'Draft paused' : 'AI draft'}
              </span>
              <span className="bc-dr-meta">
                {[agentName, isMulti ? `message ${chunkIdx} of ${chunkTotal}` : null].filter(Boolean).join(' · ')}
              </span>
              <span className="bc-dr-spacer"/>
              {!isPaused && (
                <span className="bc-dr-note">Sends in <b>{remainingSec}s</b></span>
              )}
              {isPaused && manualReady && (
                <span className="bc-dr-note">Holding while you reply</span>
              )}
              {isPaused && !manualReady && (
                <button type="button" className="bc-dr-link"
                  onClick={e=>{e.stopPropagation();resumeDraft();}}
                  title="Let the AI send this draft when the countdown ends">
                  <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden="true"><path d="M0.5 0.8v7.4L7.2 4.5z" fill="currentColor"/></svg>
                  Resume
                </button>
              )}
              <button type="button" className="bc-dr-x"
                onClick={e=>{e.stopPropagation();discardDraft();}}
                title={isMulti ? 'Discard remaining messages' : 'Discard draft'}
                aria-label={isMulti ? 'Discard remaining messages' : 'Discard draft'}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Countdown to send; multi-message replies get a hairline
                tick per chunk boundary. */}
            <DraftCountdownTrace total={totalDelay} sendAt={liveDraft.sendAt}
              paused={isPaused} progress={progress} chunkTotal={chunkTotal}/>

            {/* Editable current chunk text */}
            <textarea className="bc-dr-edit" value={editText}
              onChange={e=>{setEditText(e.target.value);DRAFT_STORE.setText(msg.id,e.target.value);}}
              onFocus={()=>{pauseDraft();setFocused(true);}}
              onBlur={()=>setFocused(false)}
              onClick={e=>e.stopPropagation()} rows={Math.min(5, Math.max(1, Math.ceil((editText.length||1)/72)))}/>

            {/* Attachments preview — only on the LAST chunk's draft (engine
                puts them there). Always render if present. */}
            {liveDraft.attachments && liveDraft.attachments.length > 0 && (
              <div className="bc-dr-atts">
                {liveDraft.attachments.map((att,ai)=>(
                  <div key={ai} className="bc-dr-att"><img src={att.url} alt=""/></div>
                ))}
              </div>
            )}

            {/* Upcoming chunks queued behind this one. Each is rendered as
                its own preview pill so the operator sees, at a glance, what
                will land next. Hidden when this is the last/only message. */}
            {liveDraft.upcoming && liveDraft.upcoming.length > 0 && (
              <UpcomingChunks chunks={liveDraft.upcoming} startIdx={chunkIdx+1} total={chunkTotal}/>
            )}
          </div>
          );
        })()}

        {/* ── ATTACHMENT TRAY ──
            What is about to go out with the next send. Images preview as
            thumbnails, everything else as a named chip, both removable. */}
        {(atts.length > 0 || attBusy) && (
          <div className="bc-tray">
            {atts.map(a => a.kind === 'image' ? (
              <div key={a.id} className="bc-tray-img" title={`${a.name} · ${prettyBytes(a.size)}`}>
                <img src={a.thumb || a.url} alt={a.name}/>
                <button onClick={()=>removeAtt(a.id)} title={`Remove ${a.name}`} aria-label={`Remove ${a.name}`} className="bc-tray-x">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            ) : (
              <div key={a.id} style={{maxWidth:230, minWidth:0, flexShrink:0}}>
                <FileChip name={a.name} size={a.size} kind={a.kind} compact
                  onRemove={()=>removeAtt(a.id)}/>
              </div>
            ))}
            {attBusy && (
              <span className="bc-tray-busy">Reading file…</span>
            )}
          </div>
        )}

        {/* Input row — slim, compact, multi-line capable. The textarea
            auto-grows from one line up to ~5 lines (max 110px) then
            internal-scrolls, matching Messenger / iMessage behaviour so
            the composer never grows infinitely tall. */}
        <div className="bc-row">
          {hasAiDraft && composerMode==='manual' && (
            <button type="button" className="bc-ibtn" data-tone="acc" onClick={()=>setComposerMode('ai')}
              title="Back to the AI draft" aria-label="Back to the AI draft">
              <AgentMark size={15}/>
            </button>
          )}
          {/* ── ATTACH ──
              Same circular footprint as the AI-draft toggle beside it, so
              the left edge of the composer stays one consistent shape.
              Dragging onto the thread and pasting a screenshot both reach
              the identical handler; this is just the discoverable route. */}
          <button
            type="button"
            className="bc-ibtn"
            onClick={()=>{ try { fileInputRef.current && fileInputRef.current.click(); } catch (_) {} }}
            disabled={attBusy}
            title="Attach photos or files"
            aria-label="Attach photos or files">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
          <input ref={fileInputRef} type="file" multiple style={{display:'none'}}
            onChange={e=>{
              addFiles(e.target.files);
              // Reset, or picking the same file twice in a row is a no-op.
              e.target.value = '';
            }}/>
          <textarea
            ref={el => { inputRef.current = el; taRef.current = el; }}
            rows={1}
            maxLength={limitFor(msg.p)}
            defaultValue={inputTextRef.current}
            className="bc-input"
            placeholder={
              act && act.mode === 'edit' ? 'Edit your message…'
              : act && act.mode === 'reply' ? `Reply to ${quoteWho({ r: act.row.r }, msg)}…`
              : composerMode==='ai' && hasAiDraft ? 'Or write your own reply…'
              : `Message ${String(msg.name || '').split(' ')[0] || 'customer'}…`}
            onChange={e=>{
              // Uncontrolled: DOM is the source of truth, we just mirror
              // the value into our ref + per-chat draft store. No parent
              // re-render unless hasText/inputLen actually change.
              const cap = limitFor(msg.p);
              const ta  = e.currentTarget;
              const raw = ta.value;
              const val = raw.length > cap ? raw.slice(0, cap) : raw;
              if (val !== raw) ta.value = val;
              // Auto-grow: cheap, runs directly on the DOM element.
              ta.style.height = 'auto';
              ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
              syncInput(val);
            }}
            onPaste={e=>{
              const cd = e.clipboardData || window.clipboardData;
              // A screenshot on the clipboard arrives as a File, not as
              // text — Ctrl+V used to do nothing at all for it.
              if (cd && cd.files && cd.files.length) {
                e.preventDefault();
                addFiles(cd.files);
                return;
              }
              // Truncate pasted content so a giant clipboard never blows
              // past the platform's send limit. Within-cap pastes fall
              // through to the browser so undo history stays clean.
              const cap = limitFor(msg.p);
              const pasted = cd ? cd.getData('text') : null;
              if (pasted == null) return;
              const ta = e.currentTarget;
              const cur = inputTextRef.current || '';
              const start = ta.selectionStart ?? cur.length;
              const end   = ta.selectionEnd   ?? cur.length;
              const before = cur.slice(0, start);
              const after  = cur.slice(end);
              const room   = Math.max(0, cap - before.length - after.length);
              if (pasted.length <= room) return; // native paste handles it
              e.preventDefault();
              const trimmed = pasted.slice(0, room);
              const next = before + trimmed + after;
              ta.value = next;
              ta.style.height = 'auto';
              ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
              syncInput(next);
              requestAnimationFrame(() => {
                try {
                  const pos = before.length + trimmed.length;
                  ta.setSelectionRange(pos, pos);
                } catch(_) {}
              });
            }}
            onFocus={()=>setFocused(true)}
            onBlur={()=>setFocused(false)}
            // Clicking into "Or type a manual reply…" is the operator taking
            // over, so the AI stops counting down — exactly like clicking its
            // draft. (Not onFocus: the composer auto-focuses when a chat opens,
            // and that must never pause anything.)
            onPointerDown={()=>{ if (hasAiDraft) holdDraftForManual(); }}
            onKeyDown={e=>{
              // Esc leaves reply/edit mode (and nothing else).
              if (e.key === 'Escape' && act) { e.preventDefault(); e.stopPropagation(); cancelAct(); return; }
              // ArrowUp in an empty composer edits your last message.
              // (Whitespace counts as empty — a stray newline used to block it.)
              if (e.key === 'ArrowUp' && !act && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
                  && !e.nativeEvent.isComposing && !(inputTextRef.current || '').trim()) {
                const last = lastEditableOwn();
                if (last) { e.preventDefault(); startEdit(last); return; }
              }
              // Enter sends, Shift+Enter inserts a newline (Messenger-style).
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendManual(); }
            }}/>
          {/* Character counter — only surfaces when within 10% of the
              platform cap so it stays out of the way during normal use.
              Subtle mono digits, warm accent when actually at the cap. */}
          {(() => {
            const cap = limitFor(msg.p);
            const len = inputLen;
            const showAt = Math.floor(cap * 0.9);
            if (len < showAt) return null;
            const atCap = len >= cap;
            return (
              <span className="bc-count" data-cap={atCap ? '1' : '0'}>{len}<span style={{opacity:0.55}}>/{cap}</span></span>
            );
          })()}
          {composerMode==='ai' && hasAiDraft ? (
            // One button, two jobs: with a manual reply in the composer it
            // sends that; with the composer empty it sends the AI draft. The
            // label cross-fades so the operator always knows which.
            <button type="button" className="bc-send" data-mode={sendMode === 'manual' ? 'manual' : 'ai'}
              onClick={sendFromButton}
              disabled={sendMode === 'manual' && attBusy}
              aria-label={sendMode === 'manual' ? 'Send your reply' : 'Send AI draft'}>
              <span className="bc-send-lbl">
                <span data-on={sendMode === 'manual' ? '0' : '1'} aria-hidden={sendMode === 'manual'}>Send draft</span>
                <span data-on={sendMode === 'manual' ? '1' : '0'} aria-hidden={sendMode !== 'manual'}>Send reply</span>
              </span>
              <span className="bc-send-ico" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>
                </svg>
              </span>
            </button>
          ) : (
            // Manual mode: a compact send (or save, when editing) that only
            // appears once there is something to send. Enter still sends.
            <button type="button" className="bc-go" data-show={(hasText || atts.length > 0) ? '1' : '0'}
              onClick={sendManual} disabled={attBusy}
              tabIndex={(hasText || atts.length > 0) ? 0 : -1}
              title={act && act.mode === 'edit' ? 'Save edit (Enter)' : 'Send (Enter)'}
              aria-label={act && act.mode === 'edit' ? 'Save edit' : 'Send'}>
              {act && act.mode === 'edit' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
              )}
            </button>
          )}
        </div>
        </div>{/* end bc-comp-in */}
      </div>
        );
      })()}

      {/* ── EXTERNAL SEND BUTTON ──
          Lives OUTSIDE the composer so the composer body itself stays
          perfectly centered (the button is hidden most of the time).
          Reveal is intentional only — operators looking for it move
          their mouse toward the right edge of the composer where a
          slim hot-zone lights it up. Hovering anywhere else inside
          the composer body does NOT show it (Enter is the primary
          send path). Manual mode only — AI drafts have their own
          inline Send button next to the countdown.

          Shape is Apple-esque: flat left edge (anchors visually to
          the composer's right side), softly rounded right edge —
          like a tab pulled out of the composer. */}
      {/* Send button removed — Enter sends. The composer's right edge
          stays uncluttered; no reserved space needed since the button
          was rendered as an absolutely-positioned sibling outside the
          composer flow. */}

      </div>{/* end ipc-chat-col */}
    </div>
  );
};

// ── MEMOIZED CHAT PANEL ───────────────────────────────────────────────
// MsgList re-renders on every store notify — a message in ANY conversation.
// The open chat only needs to redraw when its own conversation changed, or
// its own props did; its thread, draft and agents already arrive through
// their own subscriptions. Conversation rows are mutated in place, so the
// shell fingerprints the row's own fields (all primitives, plus the small
// escalation object) instead of trusting object identity.
const convRenderSig = (c) => {
  if (!c) return '';
  let s = '';
  for (const k in c) {
    const v = c[k];
    const t = typeof v;
    if (v == null || t === 'string' || t === 'number' || t === 'boolean') s += k + '\u0001' + v + '\u0002';
    else if (t === 'object') { try { s += k + '\u0001' + JSON.stringify(v) + '\u0002'; } catch (_) { s += k + '\u0001?\u0002'; } }
  }
  return s;
};
const InPageChatMemo = React.memo(InPageChatView, (p, n) =>
  p.msg === n.msg && p._convSig === n._convSig
  && p.onClose === n.onClose && p.onBack === n.onBack
  && p.backTarget === n.backTarget && p.chatWidth === n.chatWidth);
const InPageChat = (props) => <InPageChatMemo {...props} _convSig={convRenderSig(props.msg)}/>;

// ═══════════════════════════════════════════════════════════════════
// GHOST CHAT
// ═══════════════════════════════════════════════════════════════════
// A full conversation view for talking to the dashboard ghost, opened by
// clicking the ghost on the home screen.
//
// WHY THIS EXISTS
// ---------------
// Previously the only way to talk to the ghost was GhostComposer — a
// single-line floating input under the ghost silhouette on the dashboard.
// It worked, but the reply arrived as a chip that faded after ~5 seconds
// and nothing was ever kept. You couldn't scroll back, couldn't see what
// a batch of actions actually did, and a long answer simply didn't fit.
//
// This view reuses the SAME command pipeline (window.__ghostCmd →
// api.php?action=ghost_command → verb dispatch) but renders it as a real
// chat: persistent thread, scrollback, inline confirm cards for
// destructive verbs, and live progress for multi-action batches.
//
// DELIBERATELY OMITTED vs InPageChat
// ----------------------------------
//   • The customer record (in-thread moments, AI summary hover) — there
//     is no customer record for the ghost, so the header identity pill
//     is inert rather than a button.
//   • The AI agent assignment menu — the ghost isn't an assignable agent.
//   • DRAFT_STORE / AI draft preview — replies here are immediate, there
//     is no operator-review-before-send step.
//   • MSGS_STORE / BotBridge — nothing here is a real platform message.
//     The thread is local to this browser.
//
// SHARED WITH THE COMPOSER
// ------------------------
// The LLM session id (`ghost.session`) is deliberately the same one the
// composer uses, so a conversation that starts at the composer can be
// continued here and vice-versa. Server-side that session log has a
// 30-minute TTL and keeps the last 12 turns; our local thread outlives it,
// which means old scrollback can be visible in the UI after the model has
// forgotten it. That's intentional — a visible record is more useful than
// pretending the history is gone — but it's why "what did I just ask you"
// can miss on a thread you left open overnight.

// ── GHOST AVATAR ─────────────────────────────────────────────────────
// The ghost's avatar is the 👻 glyph on a tinted disc rather than the PNG.
// At avatar sizes (26–42px) the artwork read as a pale smudge, and it
// carries its own transparent background so it never sat properly inside
// a circular frame the way every other avatar in the app does.
//
// The disc uses the app's accent purple so it reads as "assistant, not
// contact" at a glance, and the glyph gets an explicit emoji font stack —
// without it, Linux and older Windows fall back to a monochrome outline.
//
// NOTE: this is for AVATARS ONLY. The large ghost on the empty-state
// screen above "Ask me anything" is still GHOST_CHAT_AVATAR (the PNG),
// where the artwork has the room to look like itself.
const GHOST_EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","EmojiOne Color","Android Emoji",sans-serif';

const GhostAva = ({sz = 28, dim = false}) => (
  <div aria-label="Ghost" style={{
    width: sz, height: sz, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(145deg, #7d70da 0%, #56489f 55%, #3d3277 100%)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 1px 5px rgba(0,0,0,0.32)',
    opacity: dim ? 0.75 : 1,
    userSelect: 'none', overflow: 'hidden',
  }}>
    <span style={{
      fontSize: sz * 0.56, lineHeight: 1, fontFamily: GHOST_EMOJI_FONT,
      transform: 'translateY(-' + Math.max(0.5, sz * 0.02) + 'px)',
      filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))',
    }}>👻</span>
  </div>
);

// ── GHOST LANDING SLOT ────────────────────────────────────────
// A transparent cell that tells the WebGL ghost where to be. Mounting and
// unmounting are both home changes, and neither involves a resize, so
// nothing in the ghost's own tracking would notice them — hence the
// explicit signal on each. The unmount fires on the way out so the ghost
// starts its journey back to the board as the chat closes rather than
// after it has gone.
const GhostSlot = ({size = 96}) => {
  React.useEffect(() => {
    const ping = () => { try { window.dispatchEvent(new CustomEvent('ghost:anchor-change')); } catch(_){} };
    ping();
    return ping;
  }, []);
  return (
    <div
      className="bcw-ghost-slot"
      aria-hidden="true"
      style={{
        width: size, height: size, flexShrink: 0,
        // Nothing is drawn here. The ghost is on its own full-viewport
        // canvas above this, so anything painted in the cell would sit
        // behind him and read as a halo — exactly the glow being removed.
        pointerEvents: 'none',
      }}
    />
  );
};

// Text typed at the board's ghost trigger before the chat existed. Parked
// rather than dispatched, because the keystroke happens BEFORE the chat
// mounts — an event fired then has nobody listening. The chat claims it on
// the way in, rather than fired as an event nobody is listening for yet.
let _ghostSeed = '';
// APPEND, not replace. The homepage trigger button keeps focus for the
// few renders it takes GhostChat to mount and steal it, so a fast typist
// fires this once per keystroke (see openGhostChat's onKeyDown). Replacing
// here meant every new letter clobbered the ones already parked, so only
// the last keystroke before the handoff survived — the rest were silently
// dropped. Appending lets every keystroke in that window land in order.
const seedGhostInput = (t) => { _ghostSeed += String(t || ''); };
const takeGhostSeed  = () => { const v = _ghostSeed; _ghostSeed = ''; return v; };

const GHOST_CHAT_ID     = '__ghost__';
const GHOST_CHAT_AVATAR = 'https://lefty.pro/MyResponder/copy/ghosty.png';
const GHOST_CHAT_LS_KEY = 'bc.ghost.chat.v1';
const GHOST_CHAT_MAX    = 250;   // messages retained in the local thread
const GHOST_CHAT_CAP    = 4000;  // input character cap
// How long to wait for an async verb to report back before giving up on
// it. Generous: a bulk message_send across a slow platform relay can
// legitimately take a while, and a false timeout is worse than a slow
// spinner because it implies something failed when it may not have.
// ── ghostVerbPhrase ───────────────────────────────────────────────────
// Turns the internal verb ids the server reports as unsupported into
// something readable. A bubble saying `agent_unassign` is the code leaking
// into the conversation; "take an agent off a chat" is the same fact in
// the operator's own words. Unmapped ids degrade to their spaced form
// rather than to nothing, so a verb added later still reads sensibly.
const GHOST_VERB_PHRASES = {
  message_send:        'send that message',
  invoice_create:      'raise that invoice',
  invoice_cancel:      'cancel that invoice',
  escalate:            'escalate that chat',
  de_escalate:         'clear that escalation',
  agent_assign:        'put an agent on that chat',
  agent_unassign:      'take the agent off that chat',
  agent_create:        'create that agent',
  agent_update_prompt: 'update that agent',
  agent_schedule:      'change those reply hours',
  agent_toggle:        'turn that agent on or off',
  product_create:      'add that product',
  product_update:      'update that product',
  product_delete:      'delete that product',
  product_toggle:      'turn that product on or off',
  wallet_add:          'add that wallet',
  wallet_update:       'update that wallet',
  wallet_delete:       'remove that wallet',
  schedule_create:     'schedule that',
  schedule_cancel:     'cancel that scheduled action',
  report_generate:     'build that report',
  note_create:         'save that note',
};
// ── BOO ─────────────────────────────────────────────────────────────
// It's a ghost. Now and then — rarely — a reply ends with a little "boo".
// Rules that keep it charming rather than tiresome:
//   • never on errors, warnings or questions (a question must end on the
//     question), never on code or long answers;
//   • at least GHOST_BOO_GAP ordinary replies since the last one, then only
//     a small chance each time — roughly once every twenty replies or so;
//   • added here in the browser only. The server never sees it, so the
//     model can't pick the habit up from its own history and overdo it.
const GHOST_BOO_KEY  = 'bc.ghost.boo.v1';
const GHOST_BOO_GAP  = 10;
const GHOST_BOO_ODDS = 0.14;
const GHOST_BOOS = ['Boo! 👻', 'boo 👻', '👻 boo.', 'Boo. 👻'];
const ghostMaybeBoo = (text) => {
  const s = String(text || '');
  const trimmed = s.trim();
  if (trimmed.length < 6 || trimmed.length > 480) return s;
  if (trimmed.indexOf('```') !== -1) return s;
  if (/\?\s*[\p{Extended_Pictographic}\s]*$/u.test(trimmed)) return s;   // ends on a question
  if (/\bboo\b/i.test(trimmed)) return s;                                   // already spooky
  let st = { since: 0 };
  try { st = JSON.parse(localStorage.getItem(GHOST_BOO_KEY) || '{"since":0}') || st; } catch (_) {}
  const since = (+st.since || 0) + 1;
  const hit = since > GHOST_BOO_GAP && Math.random() < GHOST_BOO_ODDS;
  try { localStorage.setItem(GHOST_BOO_KEY, JSON.stringify({ since: hit ? 0 : since })); } catch (_) {}
  if (!hit) return s;
  const boo = GHOST_BOOS[Math.floor(Math.random() * GHOST_BOOS.length)];
  // Keep the sentence tidy: finish it with a full stop if it has none.
  const base = /[.!…)\]"'”’\p{Extended_Pictographic}]$/u.test(trimmed) ? trimmed : trimmed + '.';
  return base + ' ' + boo;
};

const ghostVerbPhrase = (verbs) => {
  const list = (Array.isArray(verbs) ? verbs : [verbs])
    .map(v => GHOST_VERB_PHRASES[v] || `that (${String(v || '').replace(/_/g, ' ')})`);
  if (list.length <= 1) return list[0] || 'that';
  return list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1];
};

const GHOST_ACTION_TIMEOUT_MS = 45000;
// How long after the watchdog gives up we still accept a result and correct
// the message it left behind. Long enough for a slow platform relay, short
// enough that it can't collide with a later command.
const GHOST_LATE_REPAIR_MS = 180000;

// The synthetic "conversation" handed to openInPage(). Everything that
// consumes a conv row (ChatBubbleRow's avatar rail, the contact list row,
// the header) reads the same fields a real conv has, so no consumer needs
// a special case — they just need `__ghost` to route to this component
// instead of InPageChat.
const GHOST_CHAT_CONV = {
  id:      GHOST_CHAT_ID,
  __ghost: true,
  name:    'Ghost',
  handle:  '',
  avatar:  GHOST_CHAT_AVATAR,
  col:     '#7c6fd4',
  p:       'ghost',
  stage:   'new',
  ai:      'paused',
  unread:  0,
};

// ── THREAD STORE ─────────────────────────────────────────────────────
// Lives outside React so the thread survives unmount/remount of the chat
// pane (the operator hopping to a customer chat and back). Same pattern
// as INPUT_DRAFTS / TASKS_STORE elsewhere in the app.
const GHOST_CHAT_STORE = {
  thread: [],
  loaded: false,
  subs:   new Set(),
  sub(fn){ this.subs.add(fn); return () => this.subs.delete(fn); },
  notify(){ this.subs.forEach(fn => { try { fn(); } catch(_){} }); },

  load(){
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = localStorage.getItem(GHOST_CHAT_LS_KEY);
      const j   = raw ? JSON.parse(raw) : null;
      if (Array.isArray(j)) {
        // Drop transient rows — a "typing" or in-flight "working" marker
        // persisted across a reload would hang forever with no request
        // behind it to ever resolve it.
        this.thread = j.filter(m => m && m.kind !== 'typing' && m.kind !== 'working');
        // Any confirm card left mid-flight is dead: its nonce expired
        // server-side (600s TTL) long before the page came back.
        this.thread.forEach(m => {
          if (m.kind === 'confirm' && (!m.state || m.state === 'pending')) m.state = 'expired';
        });
      }
    } catch (_) { this.thread = []; }
  },

  _persist(){
    try {
      const keep = this.thread
        .filter(m => m.kind !== 'typing' && m.kind !== 'working')
        .slice(-GHOST_CHAT_MAX);
      localStorage.setItem(GHOST_CHAT_LS_KEY, JSON.stringify(keep));
    } catch (_) { /* quota / private mode — thread stays in memory only */ }
  },

  add(m){
    const row = {
      id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      ts: new Date().toISOString(),
      t:  new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}),
      kind: 'text',
      ...m,
    };
    this.thread = [...this.thread, row].slice(-GHOST_CHAT_MAX);
    this.notify();
    this._persist();
    return row;
  },

  patch(id, patch){
    if (!id) return;
    let hit = false;
    this.thread = this.thread.map(m => {
      if (m.id !== id) return m;
      hit = true;
      return {...m, ...patch};
    });
    if (!hit) return;
    this.notify();
    this._persist();
  },

  remove(id){
    if (!id) return;
    const before = this.thread.length;
    this.thread = this.thread.filter(m => m.id !== id);
    if (this.thread.length === before) return;
    this.notify();
    this._persist();
  },

  clear(){
    this.thread = [];
    this.notify();
    try { localStorage.removeItem(GHOST_CHAT_LS_KEY); } catch (_) {}
  },
};

// ── SESSION ID ───────────────────────────────────────────────────────
// Mirrors GhostComposer's persistence exactly: sessionStorage holds the
// synchronously-readable tab-local pointer, IndexedDB is the durable copy
// that survives an LS wipe. Reading both means a session started at the
// composer is picked up here on first send.
const ghostChatSession = {
  read(){
    try { return sessionStorage.getItem('bcw.ghost.session') || ''; } catch (_) { return ''; }
  },
  hydrate(setter){
    if (typeof IDB_STORE === 'undefined') return;
    IDB_STORE.get('ghost.session').then(v => {
      if (v && typeof v === 'string') {
        try { sessionStorage.setItem('bcw.ghost.session', v); } catch (_) {}
        if (setter) setter(v);
      }
    }).catch(() => {});
  },
  write(sid){
    if (!sid) return;
    try { sessionStorage.setItem('bcw.ghost.session', sid); } catch (_) {}
    if (typeof IDB_STORE !== 'undefined') IDB_STORE.set('ghost.session', sid).catch(() => {});
  },
};

// Verbs whose success report is REDUNDANT when the ghost has already said
// what it's doing in its own reply. During a guided setup every answer is a
// quiet save, and each one used to add its own status bubble underneath —
// "Saved agent … paused for now", "test 1 already had those settings" —
// which split every turn into two messages and buried the question the
// operator was meant to answer. For these verbs, when the reply already
// speaks for them, success is silent and only a FAILURE is shown.
// Deletes stay loud: after a confirm card the reply is just "Done.", so
// the report is the only record of what went.
const GHOST_QUIET_VERBS = new Set([
  'product_create', 'product_update', 'product_toggle',
  'agent_create', 'agent_update_prompt', 'agent_schedule',
  'agent_assign', 'agent_unassign',
  'wallet_add', 'wallet_update',
  'message_send', 'invoice_create', 'invoice_cancel',
  'escalate', 'de_escalate',
]);

// Verbs whose real outcome arrives later on the bcGhostResult event rather
// than in the ghost_command response. Kept in sync with the equivalent set
// in GhostComposer.dispatchActions.
const GHOST_ASYNC_VERBS = new Set([
  'message_send', 'invoice_create', 'escalate', 'de_escalate',
  'product_create', 'product_update', 'product_delete', 'product_toggle',
  'wallet_add', 'wallet_update', 'wallet_delete',
  // agent_create/update now really call save_agent, so their outcome
  // arrives on bcGhostResult like the product and wallet verbs.
  'agent_create', 'agent_update_prompt',
  // Reply-hours edits save through save_agent too.
  'agent_schedule',
  // Putting an agent on a chat (or taking one off) round-trips through
  // assign_agent before it can be reported.
  'agent_assign', 'agent_unassign',
  'invoice_cancel',
]);

// ── LANGUAGE ─────────────────────────────────────────────────────────
// The ghost answers in whatever language the operator writes in (prompt
// rule 9), and reports which one via the `lang` field on every response.
// The chat's own chrome follows it, otherwise you get a Spanish reply
// under an English "Needs confirmation" header with English buttons.
//
// Scope note: this covers the STRINGS THIS COMPONENT OWNS. Text composed
// by the model already arrives translated, and action reports built in
// ghostActionHandler stay English — those are operator-facing status
// lines from the client, and translating them properly would mean routing
// every report through the model. Called out here so the boundary is
// explicit rather than looking like an oversight.
//
// Falls back by base language ('pt-BR' -> 'pt') and then to English, so
// an unlisted locale degrades to something sensible instead of blank.
const GHOST_UI_STRINGS = {
  en: {ask:'Ask me anything', blurb:'Questions and actions across your whole dashboard.',
       placeholder:'Ask the ghost…', working:'Working…', send:'Send', clear:'Clear', assistant:'assistant',
       confirmHdr:'Needs confirmation', confirm:'Confirm', confirmDanger:'Yes, do it', cancel:'Cancel',
       confirmed:'Confirmed', cancelled:'Cancelled', expired:'Expired — ask again if you still want this',
       cancelledMsg:'Cancelled — nothing was changed.', done:'Done.',
       back:'Back to messages', home:'Home — back to message list',
       noAction:"I didn't find anything to do with that. Try rephrasing?",
       notReady:'Command engine not ready — reload the page.',
       suggestions:['What needs my attention today?','Add a package called Pro Bundle for $149','Which crypto wallets am I accepting?','Summarise the escalated conversations']},
  es: {ask:'Pregúntame lo que quieras', blurb:'Consultas y acciones en todo tu panel.',
       placeholder:'Pregunta al fantasma…', working:'Trabajando…', send:'Enviar', clear:'Borrar', assistant:'asistente',
       confirmHdr:'Necesita confirmación', confirm:'Confirmar', confirmDanger:'Sí, hazlo', cancel:'Cancelar',
       confirmed:'Confirmado', cancelled:'Cancelado', expired:'Caducado: vuelve a pedirlo si aún lo quieres',
       cancelledMsg:'Cancelado: no se cambió nada.', done:'Hecho.',
       back:'Volver a los mensajes', home:'Inicio: volver a la lista de mensajes',
       noAction:'No encontré nada que hacer con eso. ¿Puedes reformularlo?',
       notReady:'El motor de comandos no está listo: recarga la página.',
       suggestions:['¿Qué necesita mi atención hoy?','Añade un paquete llamado Pro Bundle por 149 $','¿Qué carteras cripto acepto?','Resume las conversaciones escaladas']},
  fr: {ask:'Posez-moi vos questions', blurb:'Questions et actions sur tout votre tableau de bord.',
       placeholder:'Demandez au fantôme…', working:'En cours…', send:'Envoyer', clear:'Effacer', assistant:'assistant',
       confirmHdr:'Confirmation requise', confirm:'Confirmer', confirmDanger:'Oui, allez-y', cancel:'Annuler',
       confirmed:'Confirmé', cancelled:'Annulé', expired:'Expiré — redemandez si vous le souhaitez toujours',
       cancelledMsg:'Annulé — rien n’a été modifié.', done:'Terminé.',
       back:'Retour aux messages', home:'Accueil — retour à la liste des messages',
       noAction:'Je n’ai rien trouvé à faire avec cela. Pouvez-vous reformuler ?',
       notReady:'Moteur de commandes indisponible — rechargez la page.',
       suggestions:['Qu’est-ce qui demande mon attention aujourd’hui ?','Ajoute un pack Pro Bundle à 149 €','Quels portefeuilles crypto j’accepte ?','Résume les conversations escaladées']},
  de: {ask:'Frag mich alles', blurb:'Fragen und Aktionen für dein gesamtes Dashboard.',
       placeholder:'Frag den Geist…', working:'Arbeite…', send:'Senden', clear:'Leeren', assistant:'Assistent',
       confirmHdr:'Bestätigung nötig', confirm:'Bestätigen', confirmDanger:'Ja, ausführen', cancel:'Abbrechen',
       confirmed:'Bestätigt', cancelled:'Abgebrochen', expired:'Abgelaufen — frag erneut, wenn du es noch willst',
       cancelledMsg:'Abgebrochen — nichts wurde geändert.', done:'Erledigt.',
       back:'Zurück zu den Nachrichten', home:'Start — zurück zur Nachrichtenliste',
       noAction:'Dazu habe ich nichts gefunden. Anders formulieren?',
       notReady:'Befehls-Engine nicht bereit — Seite neu laden.',
       suggestions:['Was braucht heute meine Aufmerksamkeit?','Füge ein Paket „Pro Bundle“ für 149 € hinzu','Welche Krypto-Wallets akzeptiere ich?','Fasse die eskalierten Unterhaltungen zusammen']},
  pt: {ask:'Pergunte-me qualquer coisa', blurb:'Perguntas e ações em todo o seu painel.',
       placeholder:'Pergunte ao fantasma…', working:'A trabalhar…', send:'Enviar', clear:'Limpar', assistant:'assistente',
       confirmHdr:'Precisa de confirmação', confirm:'Confirmar', confirmDanger:'Sim, faça isso', cancel:'Cancelar',
       confirmed:'Confirmado', cancelled:'Cancelado', expired:'Expirado — peça de novo se ainda quiser',
       cancelledMsg:'Cancelado — nada foi alterado.', done:'Pronto.',
       back:'Voltar às mensagens', home:'Início — voltar à lista de mensagens',
       noAction:'Não encontrei nada para fazer com isso. Pode reformular?',
       notReady:'Motor de comandos indisponível — recarregue a página.',
       suggestions:['O que precisa da minha atenção hoje?','Adicione um pacote Pro Bundle por 149 €','Que carteiras cripto aceito?','Resuma as conversas escaladas']},
  it: {ask:'Chiedimi qualsiasi cosa', blurb:'Domande e azioni su tutta la tua dashboard.',
       placeholder:'Chiedi al fantasma…', working:'In corso…', send:'Invia', clear:'Cancella', assistant:'assistente',
       confirmHdr:'Richiede conferma', confirm:'Conferma', confirmDanger:'Sì, procedi', cancel:'Annulla',
       confirmed:'Confermato', cancelled:'Annullato', expired:'Scaduto — richiedilo se lo vuoi ancora',
       cancelledMsg:'Annullato — non è stato modificato nulla.', done:'Fatto.',
       back:'Torna ai messaggi', home:'Home — torna all’elenco messaggi',
       noAction:'Non ho trovato nulla da fare. Puoi riformulare?',
       notReady:'Motore comandi non pronto — ricarica la pagina.',
       suggestions:['Cosa richiede la mia attenzione oggi?','Aggiungi un pacchetto Pro Bundle a 149 €','Quali wallet crypto accetto?','Riassumi le conversazioni escalate']},
  nl: {ask:'Vraag me alles', blurb:'Vragen en acties voor je hele dashboard.',
       placeholder:'Vraag het de geest…', working:'Bezig…', send:'Versturen', clear:'Wissen', assistant:'assistent',
       confirmHdr:'Bevestiging nodig', confirm:'Bevestigen', confirmDanger:'Ja, doe het', cancel:'Annuleren',
       confirmed:'Bevestigd', cancelled:'Geannuleerd', expired:'Verlopen — vraag opnieuw als je dit nog wilt',
       cancelledMsg:'Geannuleerd — er is niets gewijzigd.', done:'Klaar.',
       back:'Terug naar berichten', home:'Home — terug naar berichtenlijst',
       noAction:'Ik kon hier niets mee. Anders formuleren?',
       notReady:'Commandomotor niet gereed — herlaad de pagina.',
       suggestions:['Wat heeft vandaag mijn aandacht nodig?','Voeg een pakket Pro Bundle toe voor € 149','Welke cryptowallets accepteer ik?','Vat de geëscaleerde gesprekken samen']},
  pl: {ask:'Zapytaj mnie o wszystko', blurb:'Pytania i działania w całym Twoim panelu.',
       placeholder:'Zapytaj ducha…', working:'Pracuję…', send:'Wyślij', clear:'Wyczyść', assistant:'asystent',
       confirmHdr:'Wymaga potwierdzenia', confirm:'Potwierdź', confirmDanger:'Tak, zrób to', cancel:'Anuluj',
       confirmed:'Potwierdzono', cancelled:'Anulowano', expired:'Wygasło — poproś ponownie, jeśli nadal tego chcesz',
       cancelledMsg:'Anulowano — nic nie zmieniono.', done:'Gotowe.',
       back:'Powrót do wiadomości', home:'Start — powrót do listy wiadomości',
       noAction:'Nie znalazłem nic do zrobienia. Możesz sformułować inaczej?',
       notReady:'Silnik poleceń niegotowy — odśwież stronę.',
       suggestions:['Co dziś wymaga mojej uwagi?','Dodaj pakiet Pro Bundle za 149 zł','Jakie portfele krypto akceptuję?','Podsumuj eskalowane rozmowy']},
  tr: {ask:'Bana her şeyi sor', blurb:'Tüm paneliniz için sorular ve işlemler.',
       placeholder:'Hayalete sor…', working:'Çalışıyor…', send:'Gönder', clear:'Temizle', assistant:'asistan',
       confirmHdr:'Onay gerekiyor', confirm:'Onayla', confirmDanger:'Evet, yap', cancel:'İptal',
       confirmed:'Onaylandı', cancelled:'İptal edildi', expired:'Süresi doldu — hâlâ istiyorsan tekrar sor',
       cancelledMsg:'İptal edildi — hiçbir şey değişmedi.', done:'Tamam.',
       back:'Mesajlara dön', home:'Ana sayfa — mesaj listesine dön',
       noAction:'Bununla ilgili yapacak bir şey bulamadım. Yeniden ifade eder misin?',
       notReady:'Komut motoru hazır değil — sayfayı yenileyin.',
       suggestions:['Bugün neye dikkat etmeliyim?','149 ₺ değerinde Pro Bundle paketi ekle','Hangi kripto cüzdanları kabul ediyorum?','Yükseltilmiş konuşmaları özetle']},
  ru: {ask:'Спросите меня о чём угодно', blurb:'Вопросы и действия по всей вашей панели.',
       placeholder:'Спросите призрака…', working:'Работаю…', send:'Отправить', clear:'Очистить', assistant:'ассистент',
       confirmHdr:'Требуется подтверждение', confirm:'Подтвердить', confirmDanger:'Да, выполнить', cancel:'Отмена',
       confirmed:'Подтверждено', cancelled:'Отменено', expired:'Истекло — попросите снова, если это ещё нужно',
       cancelledMsg:'Отменено — ничего не изменилось.', done:'Готово.',
       back:'Назад к сообщениям', home:'Главная — к списку сообщений',
       noAction:'Не нашёл, что с этим сделать. Переформулируете?',
       notReady:'Движок команд не готов — перезагрузите страницу.',
       suggestions:['Что требует моего внимания сегодня?','Добавь пакет Pro Bundle за 149 $','Какие криптокошельки я принимаю?','Сделай сводку по эскалированным диалогам']},
  ar: {ask:'اسألني أي شيء', blurb:'أسئلة وإجراءات عبر لوحة التحكم بالكامل.',
       placeholder:'اسأل الشبح…', working:'جارٍ العمل…', send:'إرسال', clear:'مسح', assistant:'مساعد',
       confirmHdr:'يتطلب تأكيدًا', confirm:'تأكيد', confirmDanger:'نعم، نفّذ', cancel:'إلغاء',
       confirmed:'تم التأكيد', cancelled:'أُلغي', expired:'انتهت الصلاحية — اطلب مرة أخرى إذا كنت لا تزال تريد ذلك',
       cancelledMsg:'أُلغي — لم يتغير شيء.', done:'تم.',
       back:'العودة إلى الرسائل', home:'الرئيسية — العودة إلى قائمة الرسائل',
       noAction:'لم أجد ما أفعله بهذا. هل يمكنك إعادة الصياغة؟',
       notReady:'محرك الأوامر غير جاهز — أعد تحميل الصفحة.',
       suggestions:['ما الذي يحتاج انتباهي اليوم؟','أضف باقة باسم Pro Bundle بسعر 149 $','ما محافظ العملات الرقمية التي أقبلها؟','لخّص المحادثات المُصعّدة']},
  zh: {ask:'有什么可以帮您', blurb:'针对整个仪表板的提问与操作。',
       placeholder:'向幽灵提问…', working:'处理中…', send:'发送', clear:'清空', assistant:'助手',
       confirmHdr:'需要确认', confirm:'确认', confirmDanger:'是的，执行', cancel:'取消',
       confirmed:'已确认', cancelled:'已取消', expired:'已过期 — 如仍需要请重新提出',
       cancelledMsg:'已取消 — 未做任何更改。', done:'完成。',
       back:'返回消息', home:'主页 — 返回消息列表',
       noAction:'我没找到可执行的操作。可以换个说法吗？',
       notReady:'命令引擎未就绪 — 请刷新页面。',
       suggestions:['今天有什么需要我关注的？','添加一个名为 Pro Bundle 的套餐，价格 149 美元','我接受哪些加密钱包？','总结已升级的对话']},
  ja: {ask:'何でも聞いてください', blurb:'ダッシュボード全体の質問と操作に対応します。',
       placeholder:'ゴーストに質問…', working:'処理中…', send:'送信', clear:'クリア', assistant:'アシスタント',
       confirmHdr:'確認が必要です', confirm:'確認', confirmDanger:'はい、実行します', cancel:'キャンセル',
       confirmed:'確認済み', cancelled:'キャンセル済み', expired:'期限切れ — まだ必要ならもう一度どうぞ',
       cancelledMsg:'キャンセルしました — 何も変更されていません。', done:'完了しました。',
       back:'メッセージに戻る', home:'ホーム — メッセージ一覧に戻る',
       noAction:'該当する操作が見つかりませんでした。言い換えてもらえますか？',
       notReady:'コマンドエンジンが未準備です — ページを再読み込みしてください。',
       suggestions:['今日注意すべきことは？','Pro Bundle というパッケージを 149 ドルで追加','どの暗号ウォレットに対応していますか？','エスカレーションされた会話を要約して']},
  ko: {ask:'무엇이든 물어보세요', blurb:'대시보드 전체의 질문과 작업을 도와드립니다.',
       placeholder:'고스트에게 질문…', working:'처리 중…', send:'보내기', clear:'지우기', assistant:'어시스턴트',
       confirmHdr:'확인 필요', confirm:'확인', confirmDanger:'네, 실행합니다', cancel:'취소',
       confirmed:'확인됨', cancelled:'취소됨', expired:'만료됨 — 여전히 원하시면 다시 요청하세요',
       cancelledMsg:'취소되었습니다 — 변경된 사항이 없습니다.', done:'완료되었습니다.',
       back:'메시지로 돌아가기', home:'홈 — 메시지 목록으로',
       noAction:'수행할 작업을 찾지 못했습니다. 다시 말씀해 주시겠어요?',
       notReady:'명령 엔진이 준비되지 않았습니다 — 페이지를 새로고침하세요.',
       suggestions:['오늘 주의할 점은?','Pro Bundle 패키지를 149달러에 추가','어떤 암호화폐 지갑을 받고 있나요?','에스컬레이션된 대화 요약']},
  hi: {ask:'मुझसे कुछ भी पूछें', blurb:'आपके पूरे डैशबोर्ड के लिए सवाल और काम।',
       placeholder:'घोस्ट से पूछें…', working:'काम चल रहा है…', send:'भेजें', clear:'साफ़ करें', assistant:'सहायक',
       confirmHdr:'पुष्टि आवश्यक', confirm:'पुष्टि करें', confirmDanger:'हाँ, करें', cancel:'रद्द करें',
       confirmed:'पुष्टि हो गई', cancelled:'रद्द किया गया', expired:'समय समाप्त — अब भी चाहिए तो फिर पूछें',
       cancelledMsg:'रद्द — कुछ नहीं बदला।', done:'हो गया।',
       back:'संदेशों पर वापस', home:'होम — संदेश सूची पर वापस',
       noAction:'इसके लिए कुछ नहीं मिला। दोबारा कहेंगे?',
       notReady:'कमांड इंजन तैयार नहीं — पेज रीलोड करें।',
       suggestions:['आज मुझे किस पर ध्यान देना चाहिए?','Pro Bundle नाम का पैकेज $149 में जोड़ें','मैं कौन-से क्रिप्टो वॉलेट स्वीकार करता हूँ?','एस्केलेटेड बातचीत का सारांश दें']},
};

// Right-to-left scripts. The thread mirrors so bubbles, the confirm card
// and the composer read correctly rather than sitting left-aligned under
// right-aligned text.
const GHOST_RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv']);

const ghostBaseLang = (lang) => String(lang || 'en').toLowerCase().split('-')[0];
const ghostIsRTL    = (lang) => GHOST_RTL_LANGS.has(ghostBaseLang(lang));
// Exact locale first ('pt-BR'), then base ('pt'), then English. Every
// lookup goes through here so a partially-filled locale can never render
// an undefined label.
const ghostStrings  = (lang) => {
  const raw  = String(lang || 'en').toLowerCase();
  const base = ghostBaseLang(raw);
  return {...GHOST_UI_STRINGS.en, ...(GHOST_UI_STRINGS[base] || {}), ...(GHOST_UI_STRINGS[raw] || {})};
};

// ── SUGGESTIONS ON A FRESH GHOST CHAT ─────────────────────────────────
// What the ghost can do, offered in the light of where this account is.
// A new account is pointed at setting up (an AI key, a first agent, a first
// product, a wallet to be paid into); one that's running is offered its
// chats, payments and numbers; a busy one gets the tuning and automation.
// Nothing is suggested that doesn't apply: no "how much did I sell" before
// there's a sale, no "add your first product" once there is one, and names
// are filled in from the account ("Write a description for Pro Plan").
//
// Each entry: g = group (at most two of a group shown together), w = how
// much it matters right now (0 = doesn't apply; 13+ = shown first, always),
// v = the names it needs (null = can't be filled, so it isn't offered),
// t = the text in GHOST_SUG_LANGS order. Four are picked each time a fresh
// chat opens, weighted by w, avoiding the ones shown last time.
const GHOST_SUG_LANGS = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'ru', 'ar', 'zh', 'ja', 'ko', 'hi'];
const _gsPick = (arr) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);
const _gsName = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > 24 ? t.slice(0, 23).trimEnd() + '…' : t;
};
const GHOST_SUGGESTIONS = [
  // ── Getting set up ──
  { id: 's_key', g: 'setup', w: c => c.hasKey ? 0 : 20,
    t: ["Where do I add my AI key?", "¿Dónde añado mi clave de IA?", "Où ajouter ma clé d’IA ?", "Wo trage ich meinen KI-Schlüssel ein?", "Onde adiciono a minha chave de IA?", "Dove aggiungo la mia chiave IA?", "Waar voeg ik mijn AI-sleutel toe?", "Gdzie dodać klucz AI?", "Yapay zekâ anahtarımı nereye eklerim?", "Куда добавить ключ ИИ?", "أين أضيف مفتاح الذكاء الاصطناعي؟", "在哪里添加我的 AI 密钥？", "AIキーはどこで追加しますか？", "AI 키는 어디에 추가하나요?", "मैं अपनी AI कुंजी कहाँ जोड़ूँ?"] },
  { id: 's_what', g: 'setup', w: c => c.isNew ? 12 : 1,
    t: ["What can you do for me?", "¿Qué puedes hacer por mí?", "Que peux-tu faire pour moi ?", "Was kannst du für mich tun?", "O que podes fazer por mim?", "Cosa puoi fare per me?", "Wat kun je voor me doen?", "Co możesz dla mnie zrobić?", "Benim için neler yapabilirsin?", "Что ты умеешь?", "ماذا يمكنك أن تفعل لي؟", "你能帮我做什么？", "何ができますか？", "무엇을 도와줄 수 있나요?", "तुम मेरे लिए क्या कर सकते हो?"] },
  { id: 's_agent_sales', g: 'setup', w: c => c.agents.length ? 0 : 14,
    t: ["Create a sales agent for my shop", "Crea un agente de ventas para mi tienda", "Crée un agent commercial pour ma boutique", "Erstelle einen Verkaufsagenten für meinen Shop", "Cria um agente de vendas para a minha loja", "Crea un agente di vendita per il mio negozio", "Maak een verkoopagent voor mijn winkel", "Utwórz agenta sprzedaży dla mojego sklepu", "Mağazam için bir satış ajanı oluştur", "Создай агента по продажам для моего магазина", "أنشئ وكيل مبيعات لمتجري", "为我的店铺创建一个销售坐席", "ショップ用の販売エージェントを作成して", "내 상점용 판매 상담원을 만들어 줘", "मेरी दुकान के लिए एक सेल्स एजेंट बनाओ"] },
  { id: 's_agent_support', g: 'setup', w: c => !c.agents.length ? 9 : (c.agents.some(a => a.sellCatalog === false) ? 0 : 2),
    t: ["Set up a support agent for questions", "Configura un agente de soporte para preguntas", "Crée un agent d’assistance pour les questions", "Richte einen Support-Agenten für Fragen ein", "Configura um agente de suporte para dúvidas", "Configura un agente di supporto per le domande", "Stel een supportagent in voor vragen", "Skonfiguruj agenta wsparcia do pytań", "Sorular için bir destek ajanı kur", "Настрой агента поддержки для вопросов", "جهّز وكيل دعم للإجابة عن الأسئلة", "设置一个回答问题的客服坐席", "質問対応のサポートエージェントを設定して", "질문에 답하는 지원 상담원을 설정해 줘", "सवालों के लिए एक सपोर्ट एजेंट सेट करो"] },
  { id: 's_agent_on', g: 'setup', w: c => (c.agents.length && !c.active.length) ? 16 : 0, v: c => { const a = _gsPick(c.agents); return a ? { ai: _gsName(a.name) } : null; },
    t: ["Turn {ai} back on", "Vuelve a activar a {ai}", "Réactive {ai}", "Schalte {ai} wieder ein", "Volta a ativar {ai}", "Riattiva {ai}", "Zet {ai} weer aan", "Włącz ponownie {ai}", "{ai} ajanını tekrar aç", "Снова включи {ai}", "أعد تشغيل {ai}", "重新开启 {ai}", "{ai} を再びオンにして", "{ai}를 다시 켜 줘", "{ai} को फिर से चालू करो"] },
  { id: 's_prod_first', g: 'setup', w: c => c.products.length ? 0 : 14,
    t: ["Add my first product", "Añade mi primer producto", "Ajoute mon premier produit", "Füge mein erstes Produkt hinzu", "Adiciona o meu primeiro produto", "Aggiungi il mio primo prodotto", "Voeg mijn eerste product toe", "Dodaj mój pierwszy produkt", "İlk ürünümü ekle", "Добавь мой первый товар", "أضف منتجي الأول", "添加我的第一个产品", "最初の商品を追加して", "첫 번째 상품을 추가해 줘", "मेरा पहला प्रोडक्ट जोड़ो"] },
  { id: 's_prod_sub', g: 'setup', w: c => !c.products.length ? 8 : (c.products.some(p => /month|year/i.test(String(p.billing || ''))) ? 0 : 2),
    t: ["Add a monthly plan for $10", "Añade un plan mensual de 10 $", "Ajoute un abonnement mensuel à 10 $", "Füge ein Monatsabo für 10 $ hinzu", "Adiciona um plano mensal de 10 $", "Aggiungi un piano mensile da 10 $", "Voeg een maandabonnement van $10 toe", "Dodaj plan miesięczny za 10 $", "10 $'lık aylık bir plan ekle", "Добавь ежемесячный план за $10", "أضف خطة شهرية بسعر 10 دولارات", "添加一个每月 10 美元的套餐", "月額10ドルのプランを追加して", "월 10달러 요금제를 추가해 줘", "$10 का मासिक प्लान जोड़ो"] },
  { id: 's_bundle', g: 'catalogue', w: c => (c.prods.length >= 2 && !c.pkgs.length) ? 6 : 0,
    t: ["Bundle my products into a package", "Agrupa mis productos en un paquete", "Regroupe mes produits dans un pack", "Bündle meine Produkte zu einem Paket", "Junta os meus produtos num pacote", "Raggruppa i miei prodotti in un pacchetto", "Bundel mijn producten in een pakket", "Połącz moje produkty w pakiet", "Ürünlerimi bir pakette topla", "Объедини мои товары в пакет", "اجمع منتجاتي في باقة", "把我的产品打包成套餐", "商品をまとめてパッケージにして", "내 상품들을 패키지로 묶어 줘", "मेरे प्रोडक्ट्स को एक पैकेज में जोड़ो"] },
  { id: 's_addon', g: 'catalogue', w: c => (c.prods.length && !c.addons.length) ? 4 : 0, v: c => { const p = _gsPick(c.prods); return p ? { p: _gsName(p.name) } : null; },
    t: ["Create an add-on for {p}", "Crea un complemento para {p}", "Crée une option pour {p}", "Erstelle ein Add-on für {p}", "Cria um extra para {p}", "Crea un componente aggiuntivo per {p}", "Maak een add-on voor {p}", "Utwórz dodatek do {p}", "{p} için bir eklenti oluştur", "Создай дополнение к {p}", "أنشئ إضافة لـ {p}", "为 {p} 创建一个附加项", "{p} のアドオンを作成して", "{p}의 추가 옵션을 만들어 줘", "{p} के लिए एक ऐड-ऑन बनाओ"] },
  { id: 's_wallet', g: 'setup', w: c => c.wallets.length ? 0 : (c.products.length ? 15 : 5),
    t: ["Add a Bitcoin wallet for payments", "Añade una cartera de Bitcoin para cobrar", "Ajoute un portefeuille Bitcoin pour les paiements", "Füge eine Bitcoin-Wallet für Zahlungen hinzu", "Adiciona uma carteira Bitcoin para pagamentos", "Aggiungi un wallet Bitcoin per i pagamenti", "Voeg een Bitcoin-wallet toe voor betalingen", "Dodaj portfel Bitcoin do płatności", "Ödemeler için bir Bitcoin cüzdanı ekle", "Добавь биткоин-кошелёк для оплаты", "أضف محفظة بيتكوين للمدفوعات", "添加一个用于收款的比特币钱包", "支払い用のビットコインウォレットを追加して", "결제용 비트코인 지갑을 추가해 줘", "पेमेंट के लिए एक Bitcoin वॉलेट जोड़ो"] },
  { id: 's_wallet_usdt', g: 'money', w: c => (c.wallets.length && !c.wallets.some(k => /usdt/i.test(k))) ? 3 : 0,
    t: ["Add a USDT wallet too", "Añade también una cartera USDT", "Ajoute aussi un portefeuille USDT", "Füge auch eine USDT-Wallet hinzu", "Adiciona também uma carteira USDT", "Aggiungi anche un wallet USDT", "Voeg ook een USDT-wallet toe", "Dodaj też portfel USDT", "Bir de USDT cüzdanı ekle", "Добавь ещё кошелёк USDT", "أضف محفظة USDT أيضًا", "再添加一个 USDT 钱包", "USDTウォレットも追加して", "USDT 지갑도 추가해 줘", "एक USDT वॉलेट भी जोड़ो"] },
  { id: 's_connect', g: 'setup', w: c => (c.connected || !c.agents.length) ? 0 : 7,
    t: ["How do I connect Telegram or Discord?", "¿Cómo conecto Telegram o Discord?", "Comment connecter Telegram ou Discord ?", "Wie verbinde ich Telegram oder Discord?", "Como ligo o Telegram ou o Discord?", "Come collego Telegram o Discord?", "Hoe koppel ik Telegram of Discord?", "Jak połączyć Telegram lub Discord?", "Telegram veya Discord'u nasıl bağlarım?", "Как подключить Telegram или Discord?", "كيف أربط تيليغرام أو ديسكورد؟", "如何连接 Telegram 或 Discord？", "TelegramやDiscordはどう接続しますか？", "텔레그램이나 디스코드는 어떻게 연결하나요?", "Telegram या Discord कैसे जोड़ूँ?"] },
  { id: 's_dm_away', g: 'agents', w: c => (c.active.length && !c.dmOffline) ? 4 : 0,
    t: ["Let an agent answer my DMs while I'm away", "Que un agente responda mis mensajes directos cuando no esté", "Qu’un agent réponde à mes messages privés en mon absence", "Lass einen Agenten meine DMs beantworten, wenn ich weg bin", "Deixa um agente responder às minhas DMs quando estou fora", "Fai rispondere un agente ai miei DM quando non ci sono", "Laat een agent mijn DM's beantwoorden als ik weg ben", "Niech agent odpowiada na moje DM, gdy mnie nie ma", "Ben yokken DM'lerimi bir ajan yanıtlasın", "Пусть агент отвечает на мои ЛС, пока меня нет", "اجعل وكيلًا يرد على رسائلي الخاصة أثناء غيابي", "我不在时让坐席回复私信", "不在中はエージェントにDMへ返信させて", "내가 없을 때 상담원이 DM에 답하게 해 줘", "मेरी गैरमौजूदगी में एजेंट मेरे DM का जवाब दे"] },

  // ── Tuning agents ──
  { id: 'a_hours', g: 'agents', w: c => (c.active.length && !c.active.some(a => a.schedule && a.schedule.enabled)) ? 4 : 0, v: c => ({ a: _gsName(_gsPick(c.active).name) }),
    t: ["Set reply hours for {a}", "Fija el horario de respuesta de {a}", "Définis les horaires de réponse de {a}", "Lege Antwortzeiten für {a} fest", "Define o horário de resposta de {a}", "Imposta gli orari di risposta di {a}", "Stel antwoorduren in voor {a}", "Ustaw godziny odpowiedzi dla {a}", "{a} için yanıt saatleri belirle", "Задай часы ответов для {a}", "حدّد ساعات الرد لـ {a}", "为 {a} 设置回复时间", "{a} の返信時間を設定して", "{a}의 응답 시간을 설정해 줘", "{a} के जवाब देने के घंटे तय करो"] },
  { id: 'a_casual', g: 'agents', w: c => c.active.length ? 2 : 0, v: c => ({ a: _gsName(_gsPick(c.active).name) }),
    t: ["Make {a} sound more casual", "Haz que {a} suene más informal", "Rends {a} plus décontracté", "Lass {a} lockerer klingen", "Torna o tom de {a} mais descontraído", "Rendi {a} più informale", "Laat {a} wat losser klinken", "Niech {a} brzmi luźniej", "{a} daha samimi konuşsun", "Пусть {a} общается непринуждённее", "اجعل أسلوب {a} أكثر عفوية", "让 {a} 说话更随意一些", "{a} の口調をもっとくだけた感じに", "{a}의 말투를 더 편하게 바꿔 줘", "{a} को थोड़ा और कैज़ुअल बनाओ"] },
  { id: 'a_first', g: 'agents', w: c => c.active.some(a => !a.proactive) ? 2 : 0, v: c => ({ a: _gsName(_gsPick(c.active.filter(a => !a.proactive)).name) }),
    t: ["Let {a} message customers first", "Permite que {a} escriba primero a los clientes", "Autorise {a} à écrire en premier aux clients", "Lass {a} Kunden zuerst anschreiben", "Deixa {a} escrever primeiro aos clientes", "Lascia che {a} scriva per primo ai clienti", "Laat {a} klanten als eerste berichten", "Pozwól {a} pisać do klientów jako pierwszy", "{a} müşterilere ilk mesajı atabilsin", "Разреши {a} писать клиентам первым", "اسمح لـ {a} بمراسلة العملاء أولًا", "允许 {a} 主动联系客户", "{a} から顧客に先に連絡できるようにして", "{a}가 고객에게 먼저 메시지하게 해 줘", "{a} को ग्राहकों को पहले मैसेज करने दो"] },
  { id: 'a_stop', g: 'agents', w: c => c.active.some(a => a.sellCatalog !== false && !a.stopAfterSale) && c.products.length ? 2 : 0,
    v: c => ({ a: _gsName(_gsPick(c.active.filter(a => a.sellCatalog !== false && !a.stopAfterSale)).name) }),
    t: ["Have {a} hand chats back after a sale", "Que {a} me devuelva el chat tras una venta", "Que {a} me rende la main après une vente", "Lass {a} nach einem Verkauf an mich übergeben", "Faz com que {a} me devolva o chat após uma venda", "Fai che {a} mi ripassi la chat dopo una vendita", "Laat {a} na een verkoop het gesprek aan mij teruggeven", "Niech {a} oddaje mi czat po sprzedaży", "{a} satıştan sonra sohbeti bana bıraksın", "Пусть {a} передаёт чат мне после продажи", "اجعل {a} يعيد المحادثة إليّ بعد البيع", "让 {a} 在成交后把对话交还给我", "販売後は {a} から私にチャットを戻して", "판매 후에는 {a}가 채팅을 나에게 넘기게 해 줘", "बिक्री के बाद {a} चैट मुझे वापस दे"] },
  { id: 'a_spam', g: 'agents', w: c => c.active.some(a => a.spamThrottle === false) ? 3 : 0, v: c => ({ a: _gsName(_gsPick(c.active.filter(a => a.spamThrottle === false)).name) }),
    t: ["Turn on spam protection for {a}", "Activa la protección antispam de {a}", "Active la protection anti-spam de {a}", "Aktiviere den Spamschutz für {a}", "Ativa a proteção anti-spam de {a}", "Attiva la protezione antispam di {a}", "Zet spambescherming aan voor {a}", "Włącz ochronę przed spamem dla {a}", "{a} için spam korumasını aç", "Включи защиту от спама для {a}", "فعّل الحماية من الرسائل المزعجة لـ {a}", "为 {a} 开启垃圾消息防护", "{a} のスパム対策をオンにして", "{a}의 스팸 방지를 켜 줘", "{a} के लिए स्पैम सुरक्षा चालू करो"] },
  { id: 'a_list', g: 'agents', w: c => c.agents.length >= 2 ? 2 : 0,
    t: ["Which agents are active right now?", "¿Qué agentes están activos ahora?", "Quels agents sont actifs en ce moment ?", "Welche Agenten sind gerade aktiv?", "Que agentes estão ativos agora?", "Quali agenti sono attivi ora?", "Welke agents zijn nu actief?", "Którzy agenci są teraz aktywni?", "Şu anda hangi ajanlar aktif?", "Какие агенты сейчас активны?", "ما الوكلاء النشطون الآن؟", "现在哪些坐席在线？", "今アクティブなエージェントは？", "지금 활성화된 상담원은?", "अभी कौन से एजेंट सक्रिय हैं?"] },
  { id: 'a_assign', g: 'chats', w: c => (c.unassigned && c.active.length) ? 5 : 0,
    t: ["Which chats have no agent on them?", "¿Qué chats no tienen agente?", "Quelles discussions n’ont aucun agent ?", "Welche Chats haben keinen Agenten?", "Que conversas não têm agente?", "Quali chat non hanno un agente?", "Welke chats hebben geen agent?", "Które czaty nie mają agenta?", "Hangi sohbetlerde ajan yok?", "В каких чатах нет агента?", "ما المحادثات التي لا يتولاها أي وكيل؟", "哪些对话没有坐席负责？", "エージェントが付いていないチャットは？", "상담원이 없는 채팅은?", "किन चैट पर कोई एजेंट नहीं है?"] },

  // ── The catalogue ──
  { id: 'p_desc', g: 'catalogue', w: c => c.products.some(p => !String(p.desc || '').trim()) ? 5 : 0, v: c => ({ p: _gsName(_gsPick(c.products.filter(p => !String(p.desc || '').trim())).name) }),
    t: ["Write a description for {p}", "Escribe una descripción para {p}", "Rédige une description pour {p}", "Schreib eine Beschreibung für {p}", "Escreve uma descrição para {p}", "Scrivi una descrizione per {p}", "Schrijf een beschrijving voor {p}", "Napisz opis dla {p}", "{p} için bir açıklama yaz", "Напиши описание для {p}", "اكتب وصفًا لـ {p}", "为 {p} 写一段描述", "{p} の説明文を書いて", "{p}의 설명을 작성해 줘", "{p} के लिए विवरण लिखो"] },
  { id: 'p_links', g: 'catalogue', w: c => c.bare.length ? 4 : 0, v: c => ({ p: _gsName(_gsPick(c.bare).name) }),
    t: ["Add a download link to {p}", "Añade un enlace de descarga a {p}", "Ajoute un lien de téléchargement à {p}", "Füge {p} einen Download-Link hinzu", "Adiciona um link de download a {p}", "Aggiungi un link di download a {p}", "Voeg een downloadlink toe aan {p}", "Dodaj link do pobrania do {p}", "{p} ürününe indirme bağlantısı ekle", "Добавь ссылку для скачивания к {p}", "أضف رابط تنزيل إلى {p}", "为 {p} 添加下载链接", "{p} にダウンロードリンクを追加して", "{p}에 다운로드 링크를 추가해 줘", "{p} में डाउनलोड लिंक जोड़ो"] },
  { id: 'p_thanks', g: 'catalogue', w: c => c.products.some(p => !String(p.postPaymentText || '').trim()) ? 4 : 0, v: c => ({ p: _gsName(_gsPick(c.products.filter(p => !String(p.postPaymentText || '').trim())).name) }),
    t: ["Write the after-payment message for {p}", "Escribe el mensaje tras el pago de {p}", "Rédige le message après paiement pour {p}", "Schreib die Nachricht nach der Zahlung für {p}", "Escreve a mensagem pós-pagamento de {p}", "Scrivi il messaggio post-pagamento per {p}", "Schrijf het bericht na betaling voor {p}", "Napisz wiadomość po płatności dla {p}", "{p} için ödeme sonrası mesajı yaz", "Напиши сообщение после оплаты для {p}", "اكتب رسالة ما بعد الدفع لـ {p}", "为 {p} 写付款后的消息", "{p} の支払い後メッセージを書いて", "{p}의 결제 후 메시지를 작성해 줘", "{p} के लिए भुगतान के बाद का संदेश लिखो"] },
  { id: 'p_serial', g: 'catalogue', w: c => c.prods.some(p => !p.allowSerial) ? 2 : 0, v: c => ({ p: _gsName(_gsPick(c.prods.filter(p => !p.allowSerial)).name) }),
    t: ["Give {p} buyers a serial key", "Da una clave de licencia a quien compre {p}", "Donne une clé de licence aux acheteurs de {p}", "Gib Käufern von {p} einen Lizenzschlüssel", "Dá uma chave de licença a quem compra {p}", "Dai una chiave di licenza a chi compra {p}", "Geef kopers van {p} een licentiesleutel", "Dawaj kupującym {p} klucz licencyjny", "{p} alıcılarına seri anahtar ver", "Выдавай покупателям {p} серийный ключ", "امنح مشتري {p} مفتاح ترخيص", "给 {p} 的买家发放序列号", "{p} の購入者にシリアルキーを発行して", "{p} 구매자에게 시리얼 키를 발급해 줘", "{p} के खरीदारों को सीरियल की दो"] },
  { id: 'p_sale', g: 'catalogue', w: c => c.products.length ? 2 : 0, v: c => ({ p: _gsName(_gsPick(c.products).name) }),
    t: ["Put {p} on sale for 20% off", "Pon {p} con un 20 % de descuento", "Mets {p} en promo à -20 %", "Setz {p} um 20 % im Preis herunter", "Põe {p} com 20% de desconto", "Metti {p} in offerta al 20% di sconto", "Zet {p} in de aanbieding met 20% korting", "Obniż cenę {p} o 20%", "{p} için %20 indirim yap", "Сделай скидку 20% на {p}", "اعرض {p} بخصم 20٪", "给 {p} 打八折", "{p} を20%オフにして", "{p}를 20% 할인해 줘", "{p} पर 20% की छूट लगाओ"] },
  { id: 'p_catalogue', g: 'catalogue', w: c => c.products.length >= 3 ? 2 : 0,
    t: ["Show me my catalogue", "Muéstrame mi catálogo", "Montre-moi mon catalogue", "Zeig mir meinen Katalog", "Mostra-me o meu catálogo", "Mostrami il mio catalogo", "Laat mijn catalogus zien", "Pokaż mój katalog", "Kataloğumu göster", "Покажи мой каталог", "اعرض لي كتالوجي", "给我看看我的产品目录", "カタログを見せて", "내 카탈로그를 보여 줘", "मेरा कैटलॉग दिखाओ"] },
  { id: 'p_hide', g: 'catalogue', w: c => c.products.length >= 3 ? 1 : 0, v: c => ({ p: _gsName(_gsPick(c.products).name) }),
    t: ["Hide {p} from agents for now", "Oculta {p} a los agentes por ahora", "Masque {p} aux agents pour l’instant", "Blende {p} vorerst für Agenten aus", "Esconde {p} dos agentes por agora", "Nascondi {p} agli agenti per ora", "Verberg {p} voorlopig voor agents", "Ukryj na razie {p} przed agentami", "{p} ürününü şimdilik ajanlardan gizle", "Пока скрой {p} от агентов", "أخفِ {p} عن الوكلاء مؤقتًا", "暂时对坐席隐藏 {p}", "{p} をしばらくエージェントに非表示にして", "{p}를 당분간 상담원에게서 숨겨 줘", "{p} को अभी एजेंटों से छिपाओ"] },
  { id: 'p_interest', g: 'chats', w: c => (c.convs.length >= 3 && c.products.length) ? 3 : 0, v: c => ({ p: _gsName(_gsPick(c.products).name) }),
    t: ["Who asked about {p} but didn't buy?", "¿Quién preguntó por {p} pero no compró?", "Qui s’est renseigné sur {p} sans acheter ?", "Wer hat nach {p} gefragt, aber nicht gekauft?", "Quem perguntou por {p} mas não comprou?", "Chi ha chiesto di {p} senza comprarlo?", "Wie vroeg naar {p} maar kocht niets?", "Kto pytał o {p}, ale nie kupił?", "{p} hakkında soru sorup almayan kim?", "Кто спрашивал про {p}, но не купил?", "من سأل عن {p} ولم يشترِ؟", "谁问过 {p} 但没有购买？", "{p} について聞いたのに買わなかったのは誰？", "{p}를 문의했지만 구매하지 않은 사람은?", "किसने {p} के बारे में पूछा पर खरीदा नहीं?"] },

  // ── Money ──
  { id: 'm_week', g: 'money', w: c => c.paidWeek ? 6 : (c.paid ? 3 : 0),
    t: ["How much have I made this week?", "¿Cuánto he ganado esta semana?", "Combien ai-je gagné cette semaine ?", "Wie viel habe ich diese Woche eingenommen?", "Quanto ganhei esta semana?", "Quanto ho incassato questa settimana?", "Hoeveel heb ik deze week verdiend?", "Ile zarobiłem w tym tygodniu?", "Bu hafta ne kadar kazandım?", "Сколько я заработал на этой неделе?", "كم ربحت هذا الأسبوع؟", "我这周赚了多少？", "今週の売上はいくら？", "이번 주 매출은 얼마야?", "इस हफ़्ते मैंने कितना कमाया?"] },
  { id: 'm_month', g: 'money', w: c => c.paid ? 4 : 0,
    t: ["Revenue report for this month", "Informe de ingresos de este mes", "Rapport des revenus de ce mois", "Umsatzbericht für diesen Monat", "Relatório de receitas deste mês", "Report dei ricavi di questo mese", "Omzetrapport van deze maand", "Raport przychodów za ten miesiąc", "Bu ayın gelir raporu", "Отчёт о доходах за этот месяц", "تقرير الإيرادات لهذا الشهر", "本月收入报告", "今月の売上レポート", "이번 달 매출 보고서", "इस महीने की आय रिपोर्ट"] },
  { id: 'm_year', g: 'money', w: c => c.paid >= 10 ? 2 : 0,
    t: ["Revenue report for this year", "Informe de ingresos de este año", "Rapport des revenus de cette année", "Umsatzbericht für dieses Jahr", "Relatório de receitas deste ano", "Report dei ricavi di quest’anno", "Omzetrapport van dit jaar", "Raport przychodów za ten rok", "Bu yılın gelir raporu", "Отчёт о доходах за этот год", "تقرير الإيرادات لهذا العام", "今年的收入报告", "今年の売上レポート", "올해 매출 보고서", "इस साल की आय रिपोर्ट"] },
  { id: 'm_best', g: 'money', w: c => (c.paid >= 3 && c.products.length >= 2) ? 4 : 0,
    t: ["Which product sells best?", "¿Qué producto se vende más?", "Quel produit se vend le mieux ?", "Welches Produkt verkauft sich am besten?", "Que produto vende mais?", "Quale prodotto vende di più?", "Welk product verkoopt het best?", "Który produkt sprzedaje się najlepiej?", "En çok satan ürün hangisi?", "Какой товар продаётся лучше всего?", "أي منتج يُباع أكثر؟", "哪个产品卖得最好？", "一番売れている商品は？", "가장 잘 팔리는 상품은?", "कौन सा प्रोडक्ट सबसे ज़्यादा बिकता है?"] },
  { id: 'm_topcust', g: 'money', w: c => c.paid >= 3 ? 3 : 0,
    t: ["Who are my best customers?", "¿Quiénes son mis mejores clientes?", "Qui sont mes meilleurs clients ?", "Wer sind meine besten Kunden?", "Quem são os meus melhores clientes?", "Chi sono i miei clienti migliori?", "Wie zijn mijn beste klanten?", "Kim są moi najlepsi klienci?", "En iyi müşterilerim kimler?", "Кто мои лучшие клиенты?", "من هم أفضل عملائي؟", "谁是我最好的客户？", "一番のお得意様は誰？", "가장 좋은 고객은 누구야?", "मेरे सबसे अच्छे ग्राहक कौन हैं?"] },
  { id: 'm_unpaid', g: 'money', w: c => c.pending ? 7 : 0,
    t: ["Show my unpaid invoices", "Muestra mis facturas sin pagar", "Montre mes factures impayées", "Zeig meine unbezahlten Rechnungen", "Mostra as minhas faturas por pagar", "Mostra le mie fatture non pagate", "Toon mijn onbetaalde facturen", "Pokaż moje nieopłacone faktury", "Ödenmemiş faturalarımı göster", "Покажи неоплаченные счета", "اعرض فواتيري غير المدفوعة", "显示我未付款的发票", "未払いの請求書を表示して", "미결제 청구서를 보여 줘", "मेरे बकाया चालान दिखाओ"] },
  { id: 'm_confirm', g: 'money', w: c => c.pending ? 3 : 0,
    t: ["Any payments waiting for confirmations?", "¿Hay pagos esperando confirmaciones?", "Des paiements en attente de confirmations ?", "Warten Zahlungen auf Bestätigungen?", "Há pagamentos à espera de confirmações?", "Ci sono pagamenti in attesa di conferme?", "Wachten er betalingen op bevestigingen?", "Czy jakieś płatności czekają na potwierdzenia?", "Onay bekleyen ödeme var mı?", "Есть платежи, ожидающие подтверждений?", "هل هناك مدفوعات بانتظار التأكيد؟", "有等待确认的付款吗？", "承認待ちの支払いはある？", "확인을 기다리는 결제가 있어?", "क्या कोई भुगतान पुष्टि का इंतज़ार कर रहा है?"] },
  { id: 'm_invoice', g: 'money', w: c => (c.products.length && c.wallets.length && c.people.length) ? 3 : 0,
    v: c => ({ c: _gsName(_gsPick(c.people).name), p: _gsName(_gsPick(c.products).name) }),
    t: ["Send {c} an invoice for {p}", "Envía a {c} una factura por {p}", "Envoie à {c} une facture pour {p}", "Schick {c} eine Rechnung für {p}", "Envia a {c} uma fatura de {p}", "Invia a {c} una fattura per {p}", "Stuur {c} een factuur voor {p}", "Wyślij {c} fakturę za {p}", "{c} kişisine {p} için fatura gönder", "Отправь {c} счёт за {p}", "أرسل إلى {c} فاتورة لـ {p}", "给 {c} 发送 {p} 的发票", "{c} に {p} の請求書を送って", "{c}에게 {p} 청구서를 보내 줘", "{c} को {p} का चालान भेजो"] },
  { id: 'm_wallets', g: 'money', w: c => c.wallets.length ? 1 : 0,
    t: ["Which crypto wallets am I accepting?", "¿Qué carteras cripto acepto?", "Quels portefeuilles crypto j’accepte ?", "Welche Krypto-Wallets akzeptiere ich?", "Que carteiras cripto aceito?", "Quali wallet crypto accetto?", "Welke cryptowallets accepteer ik?", "Jakie portfele krypto akceptuję?", "Hangi kripto cüzdanları kabul ediyorum?", "Какие криптокошельки я принимаю?", "ما محافظ العملات الرقمية التي أقبلها؟", "我接受哪些加密钱包？", "どの暗号ウォレットを受け付けている？", "어떤 암호화폐 지갑을 받고 있어?", "मैं कौन से क्रिप्टो वॉलेट स्वीकार करता हूँ?"] },
  { id: 'm_weekly', g: 'auto', w: c => (c.paid && !c.scheduled) ? 3 : 0,
    t: ["Send me a revenue report every Monday", "Envíame un informe de ingresos cada lunes", "Envoie-moi un rapport de revenus chaque lundi", "Schick mir jeden Montag einen Umsatzbericht", "Envia-me um relatório de receitas todas as segundas", "Mandami un report dei ricavi ogni lunedì", "Stuur me elke maandag een omzetrapport", "Wysyłaj mi raport przychodów w każdy poniedziałek", "Her pazartesi bana gelir raporu gönder", "Присылай мне отчёт о доходах каждый понедельник", "أرسل لي تقرير الإيرادات كل يوم اثنين", "每周一给我发一份收入报告", "毎週月曜に売上レポートを送って", "매주 월요일에 매출 보고서를 보내 줘", "हर सोमवार मुझे आय रिपोर्ट भेजो"] },
  { id: 'l_expiring', g: 'money', w: c => (c.paid && c.products.some(p => p.allowSerial)) ? 3 : 0,
    t: ["Which licences expire this month?", "¿Qué licencias caducan este mes?", "Quelles licences expirent ce mois-ci ?", "Welche Lizenzen laufen diesen Monat ab?", "Que licenças expiram este mês?", "Quali licenze scadono questo mese?", "Welke licenties verlopen deze maand?", "Które licencje wygasają w tym miesiącu?", "Bu ay hangi lisansların süresi doluyor?", "Какие лицензии истекают в этом месяце?", "ما التراخيص التي تنتهي هذا الشهر؟", "哪些许可证本月到期？", "今月期限切れになるライセンスは？", "이번 달에 만료되는 라이선스는?", "इस महीने कौन से लाइसेंस खत्म हो रहे हैं?"] },

  // ── Chats and customers ──
  { id: 'c_attention', g: 'chats', w: c => (c.escalated.length || c.unread) ? 8 : ((c.convs.length || c.pending) ? 5 : 0),
    t: ["What needs my attention today?", "¿Qué necesita mi atención hoy?", "Qu’est-ce qui demande mon attention aujourd’hui ?", "Was braucht heute meine Aufmerksamkeit?", "O que precisa da minha atenção hoje?", "Cosa richiede la mia attenzione oggi?", "Wat heeft vandaag mijn aandacht nodig?", "Co dziś wymaga mojej uwagi?", "Bugün neye dikkat etmeliyim?", "Что требует моего внимания сегодня?", "ما الذي يحتاج انتباهي اليوم؟", "今天有什么需要我处理？", "今日対応が必要なことは？", "오늘 확인이 필요한 것은?", "आज किस पर ध्यान देना है?"] },
  { id: 'c_escalated', g: 'chats', w: c => c.escalated.length >= 2 ? 15 : 0,
    t: ["Summarise the escalated chats", "Resume los chats escalados", "Résume les discussions escaladées", "Fasse die eskalierten Chats zusammen", "Resume as conversas escaladas", "Riassumi le chat escalate", "Vat de geëscaleerde chats samen", "Podsumuj eskalowane czaty", "Yükseltilmiş sohbetleri özetle", "Сделай сводку по эскалированным чатам", "لخّص المحادثات المُصعّدة", "总结已升级的对话", "エスカレーションされたチャットを要約して", "에스컬레이션된 채팅을 요약해 줘", "एस्केलेट की गई चैट का सारांश दो"] },
  { id: 'c_esc_one', g: 'chats', w: c => c.escalated.length === 1 ? 15 : (c.escalated.length ? 6 : 0), v: c => ({ e: _gsName(_gsPick(c.escalated).name) }),
    t: ["What does {e} need from me?", "¿Qué necesita {e} de mí?", "Qu’attend {e} de moi ?", "Was braucht {e} von mir?", "De que precisa {e} da minha parte?", "Di cosa ha bisogno {e} da me?", "Wat heeft {e} van me nodig?", "Czego {e} ode mnie potrzebuje?", "{e} benden ne istiyor?", "Что нужно от меня {e}?", "ماذا يحتاج {e} مني؟", "{e} 需要我做什么？", "{e} は私に何を求めている？", "{e}가 나에게 필요한 건 뭐야?", "{e} को मुझसे क्या चाहिए?"] },
  { id: 'c_unread', g: 'chats', w: c => c.unread ? 8 : 0,
    t: ["Which chats are waiting on me?", "¿Qué chats me están esperando?", "Quelles discussions m’attendent ?", "Welche Chats warten auf mich?", "Que conversas estão à minha espera?", "Quali chat mi stanno aspettando?", "Welke chats wachten op mij?", "Które czaty na mnie czekają?", "Hangi sohbetler beni bekliyor?", "Какие чаты ждут моего ответа?", "ما المحادثات التي تنتظرني؟", "哪些对话在等我回复？", "私の返信待ちのチャットは？", "나를 기다리는 채팅은?", "कौन सी चैट मेरा इंतज़ार कर रही हैं?"] },
  { id: 'c_today', g: 'chats', w: c => c.convsToday >= 2 ? 4 : 0,
    t: ["Summarise today's conversations", "Resume las conversaciones de hoy", "Résume les conversations du jour", "Fasse die heutigen Unterhaltungen zusammen", "Resume as conversas de hoje", "Riassumi le conversazioni di oggi", "Vat de gesprekken van vandaag samen", "Podsumuj dzisiejsze rozmowy", "Bugünkü konuşmaları özetle", "Подведи итоги сегодняшних диалогов", "لخّص محادثات اليوم", "总结今天的对话", "今日の会話を要約して", "오늘의 대화를 요약해 줘", "आज की बातचीत का सारांश दो"] },
  { id: 'c_search', g: 'chats', w: c => (c.convs.length >= 5 && c.paid) ? 2 : 0,
    t: ["Find chats that mention a refund", "Busca chats que mencionen un reembolso", "Trouve les discussions qui parlent de remboursement", "Finde Chats, in denen eine Rückerstattung erwähnt wird", "Encontra conversas que falem de reembolso", "Trova le chat che parlano di rimborso", "Zoek chats waarin een terugbetaling wordt genoemd", "Znajdź czaty, w których pada słowo zwrot", "İadeden bahseden sohbetleri bul", "Найди чаты, где упоминается возврат", "ابحث عن المحادثات التي تذكر استردادًا", "找出提到退款的对话", "返金に触れているチャットを探して", "환불을 언급한 채팅을 찾아 줘", "वे चैट ढूँढो जिनमें रिफ़ंड का ज़िक्र है"] },
  { id: 'c_one', g: 'chats', w: c => c.recent.length ? 3 : 0, v: c => ({ c: _gsName(_gsPick(c.recent).name) }),
    t: ["Summarise my chat with {c}", "Resume mi chat con {c}", "Résume ma discussion avec {c}", "Fasse meinen Chat mit {c} zusammen", "Resume a minha conversa com {c}", "Riassumi la mia chat con {c}", "Vat mijn chat met {c} samen", "Podsumuj mój czat z {c}", "{c} ile sohbetimi özetle", "Кратко опиши мой чат с {c}", "لخّص محادثتي مع {c}", "总结我和 {c} 的对话", "{c} とのチャットを要約して", "{c}와의 채팅을 요약해 줘", "{c} के साथ मेरी चैट का सारांश दो"] },
  { id: 'c_newcust', g: 'people', w: c => c.customers.length ? 4 : 0,
    t: ["Who are my newest customers?", "¿Quiénes son mis clientes más recientes?", "Qui sont mes clients les plus récents ?", "Wer sind meine neuesten Kunden?", "Quem são os meus clientes mais recentes?", "Chi sono i miei clienti più recenti?", "Wie zijn mijn nieuwste klanten?", "Kim są moi najnowsi klienci?", "En yeni müşterilerim kimler?", "Кто мои новые клиенты?", "من هم أحدث عملائي؟", "我最新的客户是谁？", "最新の顧客は誰？", "가장 최근 고객은 누구야?", "मेरे सबसे नए ग्राहक कौन हैं?"] },
  { id: 'c_thanks', g: 'people', w: c => c.customers.length ? 3 : 0, v: c => ({ c: _gsName(_gsPick(c.customers).name) }),
    t: ["Send {c} a thank-you message", "Envía a {c} un mensaje de agradecimiento", "Envoie un message de remerciement à {c}", "Schick {c} eine Dankesnachricht", "Envia a {c} uma mensagem de agradecimento", "Invia a {c} un messaggio di ringraziamento", "Stuur {c} een bedankberichtje", "Wyślij {c} podziękowanie", "{c} kişisine bir teşekkür mesajı gönder", "Отправь {c} благодарность", "أرسل إلى {c} رسالة شكر", "给 {c} 发一条感谢消息", "{c} にお礼のメッセージを送って", "{c}에게 감사 메시지를 보내 줘", "{c} को धन्यवाद संदेश भेजो"] },
  { id: 'c_followup', g: 'auto', w: c => c.customers.length ? 3 : 0, v: c => ({ c: _gsName(_gsPick(c.customers).name) }),
    t: ["Check in with {c} next week", "Escribe a {c} la semana que viene", "Relance {c} la semaine prochaine", "Melde dich nächste Woche bei {c}", "Contacta {c} na próxima semana", "Ricontatta {c} la prossima settimana", "Neem volgende week contact op met {c}", "Odezwij się do {c} w przyszłym tygodniu", "Gelecek hafta {c} ile iletişime geç", "Напомни о себе {c} на следующей неделе", "تواصل مع {c} الأسبوع القادم", "下周跟进一下 {c}", "来週 {c} に連絡して", "다음 주에 {c}에게 안부를 물어 줘", "अगले हफ़्ते {c} से संपर्क करो"] },
  { id: 'c_repeat', g: 'people', w: c => c.customers.length >= 3 ? 2 : 0,
    t: ["Which customers bought more than once?", "¿Qué clientes han comprado más de una vez?", "Quels clients ont acheté plus d’une fois ?", "Welche Kunden haben mehr als einmal gekauft?", "Que clientes compraram mais de uma vez?", "Quali clienti hanno comprato più di una volta?", "Welke klanten kochten meer dan eens?", "Którzy klienci kupili więcej niż raz?", "Hangi müşteriler birden fazla kez aldı?", "Какие клиенты покупали больше одного раза?", "أي العملاء اشتروا أكثر من مرة؟", "哪些客户购买过不止一次？", "2回以上購入した顧客は？", "두 번 이상 구매한 고객은?", "किन ग्राहकों ने एक से ज़्यादा बार खरीदा?"] },
  { id: 'c_note', g: 'people', w: c => c.recent.length ? 1 : 0, v: c => ({ c: _gsName(_gsPick(c.recent).name) }),
    t: ["Add a note to {c}'s profile", "Añade una nota al perfil de {c}", "Ajoute une note au profil de {c}", "Füge dem Profil von {c} eine Notiz hinzu", "Adiciona uma nota ao perfil de {c}", "Aggiungi una nota al profilo di {c}", "Voeg een notitie toe aan het profiel van {c}", "Dodaj notatkę do profilu {c}", "{c} profiline bir not ekle", "Добавь заметку в профиль {c}", "أضف ملاحظة إلى ملف {c}", "在 {c} 的资料里添加备注", "{c} のプロフィールにメモを追加して", "{c}의 프로필에 메모를 추가해 줘", "{c} की प्रोफ़ाइल में एक नोट जोड़ो"] },

  // ── Scheduling, tasks, the dashboard ──
  { id: 't_sched', g: 'auto', w: c => c.scheduled ? 5 : 0,
    t: ["What's scheduled right now?", "¿Qué hay programado ahora mismo?", "Qu’est-ce qui est programmé en ce moment ?", "Was ist gerade geplant?", "O que está agendado neste momento?", "Cosa c’è in programma adesso?", "Wat staat er nu ingepland?", "Co jest teraz zaplanowane?", "Şu anda neler planlı?", "Что сейчас запланировано?", "ما المجدول حاليًا؟", "现在安排了哪些任务？", "今予定されているものは？", "지금 예약된 건 뭐야?", "अभी क्या-क्या शेड्यूल है?"] },
  { id: 't_remind', g: 'auto', w: c => (c.wallets.length || c.pending) ? 2 : 0,
    t: ["Remind me tomorrow at 9 to check payments", "Recuérdame mañana a las 9 revisar los pagos", "Rappelle-moi demain à 9 h de vérifier les paiements", "Erinnere mich morgen um 9 an die Zahlungen", "Lembra-me amanhã às 9 de ver os pagamentos", "Ricordami domani alle 9 di controllare i pagamenti", "Herinner me morgen om 9 uur aan de betalingen", "Przypomnij mi jutro o 9 o sprawdzeniu płatności", "Yarın 9'da ödemeleri kontrol etmemi hatırlat", "Напомни мне завтра в 9 проверить платежи", "ذكّرني غدًا الساعة 9 بمراجعة المدفوعات", "明天 9 点提醒我查看付款", "明日9時に支払いの確認をリマインドして", "내일 9시에 결제 확인하라고 알려 줘", "कल 9 बजे मुझे भुगतान जाँचने की याद दिलाओ"] },
  { id: 't_todo', g: 'auto', w: c => c.tasks ? 3 : 0,
    t: ["What's on my to-do list?", "¿Qué tengo en mi lista de tareas?", "Qu’y a-t-il sur ma liste de tâches ?", "Was steht auf meiner To-do-Liste?", "O que tenho na lista de tarefas?", "Cosa c’è nella mia lista di cose da fare?", "Wat staat er op mijn takenlijst?", "Co mam na liście zadań?", "Yapılacaklar listemde ne var?", "Что у меня в списке дел?", "ما الموجود في قائمة مهامي؟", "我的待办清单上有什么？", "ToDoリストには何がある？", "내 할 일 목록에 뭐가 있어?", "मेरी टू-डू लिस्ट में क्या है?"] },
  { id: 't_task_unpaid', g: 'auto', w: c => c.pending >= 2 ? 3 : 0,
    t: ["Add a task to chase unpaid invoices", "Añade una tarea para reclamar las facturas pendientes", "Ajoute une tâche pour relancer les factures impayées", "Füge eine Aufgabe hinzu, offene Rechnungen nachzuhaken", "Adiciona uma tarefa para cobrar as faturas em atraso", "Aggiungi un’attività per sollecitare le fatture non pagate", "Voeg een taak toe om onbetaalde facturen na te lopen", "Dodaj zadanie, by upomnieć się o nieopłacone faktury", "Ödenmemiş faturaları takip etmek için görev ekle", "Добавь задачу напомнить о неоплаченных счетах", "أضف مهمة لمتابعة الفواتير غير المدفوعة", "添加一个催收未付发票的任务", "未払い請求書を催促するタスクを追加して", "미결제 청구서를 챙기는 할 일을 추가해 줘", "बकाया चालानों की याद दिलाने का टास्क जोड़ो"] },
  { id: 'd_widget', g: 'dash', w: c => c.paid ? 1 : 0,
    t: ["Show the revenue widget on my dashboard", "Muestra el widget de ingresos en mi panel", "Affiche le widget des revenus sur mon tableau de bord", "Zeig das Umsatz-Widget auf meinem Dashboard", "Mostra o widget de receitas no meu painel", "Mostra il widget dei ricavi nella mia dashboard", "Toon de omzetwidget op mijn dashboard", "Pokaż widżet przychodów na moim pulpicie", "Panoma gelir widget'ını ekle", "Покажи виджет доходов на панели", "اعرض أداة الإيرادات في لوحتي", "在仪表盘上显示收入小组件", "ダッシュボードに売上ウィジェットを表示して", "대시보드에 매출 위젯을 표시해 줘", "मेरे डैशबोर्ड पर आय विजेट दिखाओ"] },
  { id: 'd_theme', g: 'dash', w: c => c.isNew ? 0 : 1,
    t: ["Switch to the light theme", "Cambia al tema claro", "Passe au thème clair", "Wechsle zum hellen Design", "Muda para o tema claro", "Passa al tema chiaro", "Schakel over naar het lichte thema", "Przełącz na jasny motyw", "Açık temaya geç", "Переключи на светлую тему", "بدّل إلى المظهر الفاتح", "切换到浅色主题", "ライトテーマに切り替えて", "라이트 테마로 바꿔 줘", "लाइट थीम पर बदलो"] },
  { id: 'd_tidy', g: 'dash', w: c => c.isNew ? 0 : 1,
    t: ["Tidy up my dashboard", "Ordena mi panel", "Range mon tableau de bord", "Räum mein Dashboard auf", "Arruma o meu painel", "Riordina la mia dashboard", "Ruim mijn dashboard op", "Uporządkuj mój pulpit", "Panomu düzenle", "Наведи порядок на моей панели", "رتّب لوحة التحكم", "整理一下我的仪表盘", "ダッシュボードを整理して", "대시보드를 정리해 줘", "मेरा डैशबोर्ड व्यवस्थित करो"] },
];

// Where the account is right now, from what's already loaded. null until
// the agents, catalogue and settings have loaded — before then, "you have no
// products" would just be wrong.
const ghostSugContext = () => {
  try {
    if (typeof AGENTS_STORE === 'undefined' || !AGENTS_STORE.loaded) return null;
    if (typeof PRODS_STORE === 'undefined' || !PRODS_STORE.loaded) return null;
    if (typeof CRED_STORE === 'undefined' || !CRED_STORE.loaded) return null;
    if (typeof PAYMENTS_STORE === 'undefined' || !PAYMENTS_STORE.loaded) return null;
  } catch (_) { return null; }
  const arr = (x) => (Array.isArray(x) ? x : []);
  const now = Date.now();
  const secs = (v) => { const n = Number(v) || 0; return n > 1e12 ? n : n * 1000; };
  const agents = arr(AGENTS_STORE.list).filter(a => a && String(a.name || '').trim());
  const active = agents.filter(a => a.active !== false);
  const cv = CRED_STORE.values || {};
  const hasKey = ['llm_gemini', 'llm_openai', 'llm_claude'].some(k => String(cv[k] || '').trim());
  const products = arr(PRODS_STORE.list).filter(p => p && String(p.name || '').trim() && p.enabledForAi !== false);
  const prods = products.filter(p => !p.type || p.type === 'prod');
  const pkgs = arr(PRODS_STORE.list).filter(p => p && p.type === 'pkg');
  const addons = arr(PRODS_STORE.list).filter(p => p && p.type === 'add');
  // Nothing goes out to a buyer after paying: no link, no file, no message.
  const bare = prods.filter(p => !String(p.postPaymentText || '').trim() && !arr(p.media).some(m => m && (m.kind === 'link' || m.url)));
  const wallets = Object.keys(PAYMENTS_STORE.wallets || {}).filter(k => { const w = PAYMENTS_STORE.wallets[k]; return w && w.address && w.enabled !== false; });
  const invs = arr(PAYMENTS_STORE.invoices).filter(Boolean);
  const pending = invs.filter(i => i.status === 'pending').length;
  const paidList = invs.filter(i => i.status === 'confirmed' || i.status === 'paid');
  const paidWeek = paidList.filter(i => now - secs(i.confirmed_at || i.created) < 7 * 864e5).length;
  let convs = [];
  try { convs = arr(MSGS_STORE.list).filter(m => m && m.id && String(m.name || '').trim() && !m.__ghost); } catch (_) {}
  const byRecent = convs.slice().sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  const escalated = convs.filter(m => m.escalated || m.stage === 'escalated');
  const customers = byRecent.filter(m => m.stage === 'customer' || m.stage === 'vip');
  const recent = byRecent.slice(0, 8);
  const convsToday = convs.filter(m => now - (Number(m.ts) || 0) < 864e5).length;
  let scheduled = 0;
  try { if (typeof SCHED_STORE !== 'undefined') scheduled = arr(SCHED_STORE.list).filter(j => j && (j.status === 'pending' || j.status === 'running')).length; } catch (_) {}
  // Tasks the operator added (the widget ships with a few examples).
  let tasks = 0;
  try { if (typeof TASKS_STORE !== 'undefined') tasks = arr(TASKS_STORE.list).filter(t => t && !t.done && t.created).length; } catch (_) {}
  let connected = false;
  try {
    connected = !!((typeof CONN_STORE !== 'undefined' && ((CONN_STORE.telegram && CONN_STORE.telegram.connected) || (CONN_STORE.discord && CONN_STORE.discord.connected)))
      || (typeof PLATFORM_ACCOUNTS !== 'undefined' && PLATFORM_ACCOUNTS.data && (arr(PLATFORM_ACCOUNTS.data.telegram).length || arr(PLATFORM_ACCOUNTS.data.discord).length))
      || (typeof DM_STORE !== 'undefined' && DM_STORE.threads && DM_STORE.threads.size));
  } catch (_) {}
  let dmOffline = false;
  try { dmOffline = typeof DM_AI !== 'undefined' && !!DM_AI.offline; } catch (_) {}
  return {
    hasKey, agents, active, products, prods, pkgs, addons, bare, wallets,
    pending, paid: paidList.length, paidWeek,
    convs, escalated, customers, recent, people: customers.length ? customers : recent, convsToday,
    unread: convs.filter(m => Number(m.unread) > 0).length,
    unassigned: convs.filter(m => !m.agent_id && m.p !== 'direct' && !m.__direct).length,
    scheduled, tasks, connected, dmOffline,
    isNew: !agents.length && !products.length,
  };
};

const _ghostSugLastKey = 'bc.ghost.sugLast';
const pickGhostSuggestions = (lang, n = 4) => {
  const ctx = ghostSugContext();
  if (!ctx) return [];
  const raw = String(lang || 'en').toLowerCase();
  let li = GHOST_SUG_LANGS.indexOf(raw);
  if (li < 0) li = GHOST_SUG_LANGS.indexOf(ghostBaseLang(raw));
  if (li < 0) li = 0;
  const cand = [];
  for (const e of GHOST_SUGGESTIONS) {
    let w = 0, vars = {};
    try {
      w = Number(e.w(ctx)) || 0;
      if (w <= 0) continue;
      if (e.v) { vars = e.v(ctx); if (!vars || Object.values(vars).some(x => !x)) continue; }
    } catch (_) { continue; }
    const text = String(e.t[li] || e.t[0]).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    cand.push({ id: e.id, g: e.g, w, text });
  }
  // Without an AI key the ghost can't answer anything else yet, so that's
  // the one thing it offers.
  if (!ctx.hasKey) { const k = cand.find(c => c.id === 's_key'); return k ? [k.text] : []; }
  let last = [];
  try { last = JSON.parse(localStorage.getItem(_ghostSugLastKey) || '[]') || []; } catch (_) { last = []; }
  // What matters most right now leads, every time (two at most).
  const urgent = cand.filter(c => c.w >= 13).sort((a, b) => b.w - a.w).slice(0, 2);
  let rest = cand.filter(c => !urgent.includes(c));
  const fresh = rest.filter(c => !last.includes(c.id));
  if (fresh.length >= n - urgent.length) rest = fresh;
  const out = urgent.slice();
  const perGroup = {};
  out.forEach(c => { perGroup[c.g] = (perGroup[c.g] || 0) + 1; });
  while (out.length < n && rest.length) {
    const open = rest.filter(c => (perGroup[c.g] || 0) < 2);
    const from = open.length ? open : rest;
    let r = Math.random() * from.reduce((s, c) => s + c.w, 0);
    let pick = from[from.length - 1];
    for (const c of from) { r -= c.w; if (r <= 0) { pick = c; break; } }
    out.push(pick);
    perGroup[pick.g] = (perGroup[pick.g] || 0) + 1;
    rest = rest.filter(c => c !== pick);
  }
  try { localStorage.setItem(_ghostSugLastKey, JSON.stringify(out.map(c => c.id))); } catch (_) {}
  return out.map(c => c.text);
};

// Translate backend error prose into something actionable, in the
// operator's language where we have it. The patterns match the English
// the server emits; the OUTPUT is localised.
const ghostFriendlyError = (raw, lang) => {
  const s = String(raw || '');
  const b = ghostBaseLang(lang);
  const T = {
    timeout: {en:'That took too long to come back. Try a shorter request, or ask again.',
              es:'Tardó demasiado en responder. Prueba con algo más corto o vuelve a preguntar.',
              fr:'La réponse a mis trop de temps. Essayez une demande plus courte.',
              de:'Das hat zu lange gedauert. Versuche eine kürzere Anfrage.',
              pt:'Demorou demasiado. Tente algo mais curto ou pergunte de novo.',
              it:'Ci ha messo troppo. Prova una richiesta più breve.',
              nl:'Dat duurde te lang. Probeer een kortere vraag.',
              pl:'To trwało zbyt długo. Spróbuj krótszego zapytania.',
              tr:'Yanıt çok uzun sürdü. Daha kısa bir istek deneyin.',
              ru:'Слишком долго. Попробуйте более короткий запрос.',
              ar:'استغرق وقتًا طويلاً. جرّب طلبًا أقصر.',
              zh:'响应时间过长。请尝试更简短的请求。',
              ja:'応答に時間がかかりすぎました。短い依頼でお試しください。',
              ko:'응답이 너무 오래 걸렸습니다. 더 짧게 요청해 보세요.',
              hi:'बहुत समय लग गया। छोटा अनुरोध आज़माएँ।'},
    nokey:   {en:'No LLM API key on file. Add one in Settings → AI providers.',
              es:'No hay clave de API. Añade una en Ajustes → Proveedores de IA.',
              fr:'Aucune clé API enregistrée. Ajoutez-en une dans Paramètres → Fournisseurs IA.',
              de:'Kein API-Schlüssel hinterlegt. Füge einen unter Einstellungen → KI-Anbieter hinzu.',
              pt:'Sem chave de API. Adicione uma em Definições → Fornecedores de IA.',
              it:'Nessuna chiave API. Aggiungine una in Impostazioni → Provider IA.',
              nl:'Geen API-sleutel. Voeg er een toe bij Instellingen → AI-providers.',
              pl:'Brak klucza API. Dodaj go w Ustawienia → Dostawcy AI.',
              tr:'API anahtarı yok. Ayarlar → Yapay zekâ sağlayıcıları’ndan ekleyin.',
              ru:'Нет ключа API. Добавьте его в Настройки → Провайдеры ИИ.',
              ar:'لا يوجد مفتاح API. أضِف واحدًا من الإعدادات ← مزوّدو الذكاء الاصطناعي.',
              zh:'未配置 API 密钥。请在设置 → AI 提供商中添加。',
              ja:'APIキーが未設定です。設定 → AIプロバイダーで追加してください。',
              ko:'API 키가 없습니다. 설정 → AI 제공업체에서 추가하세요.',
              hi:'कोई API कुंजी नहीं। सेटिंग्स → AI प्रदाता में जोड़ें।'},
    network: {en:'Network blip — try again in a moment.',
              es:'Fallo de red: inténtalo de nuevo en un momento.',
              fr:'Problème réseau — réessayez dans un instant.',
              de:'Netzwerkfehler — versuche es gleich noch einmal.',
              pt:'Falha de rede — tente novamente daqui a pouco.',
              it:'Problema di rete — riprova tra poco.',
              nl:'Netwerkstoring — probeer het zo opnieuw.',
              pl:'Problem z siecią — spróbuj za chwilę.',
              tr:'Ağ hatası — birazdan tekrar deneyin.',
              ru:'Сбой сети — повторите через мгновение.',
              ar:'خلل في الشبكة — أعد المحاولة بعد قليل.',
              zh:'网络异常 — 请稍后重试。',
              ja:'ネットワークエラー — 少ししてから再試行してください。',
              ko:'네트워크 오류 — 잠시 후 다시 시도하세요.',
              hi:'नेटवर्क समस्या — थोड़ी देर में फिर कोशिश करें।'},
    generic: {en:'Something went wrong.', es:'Algo salió mal.', fr:'Une erreur est survenue.',
              de:'Etwas ist schiefgelaufen.', pt:'Algo correu mal.', it:'Qualcosa è andato storto.',
              nl:'Er ging iets mis.', pl:'Coś poszło nie tak.', tr:'Bir şeyler ters gitti.',
              ru:'Что-то пошло не так.', ar:'حدث خطأ ما.', zh:'出了点问题。',
              ja:'問題が発生しました。', ko:'문제가 발생했습니다.', hi:'कुछ गलत हो गया।'},
  };
  const pick = (k) => T[k][b] || T[k].en;
  if (/timeout/i.test(s))                              return pick('timeout');
  // Rate-limit text carries a wait time from the server, so it is passed
  // through rather than replaced — losing the number would be worse than
  // showing English.
  if (/rate limit/i.test(s))                           return s.replace(/^Rate limit:\s*/i, '');
  if (/no.*api.*key|missing.*key|api key/i.test(s))    return pick('nokey');
  if (/network|failed to fetch|fetch failed/i.test(s)) return pick('network');
  return s || pick('generic');
};

// ── LIVE-COUNTDOWN CARD for a scheduled ghost action ────────────────
// schedule_create/schedule_update/schedule_view all finish synchronously
// — by the time the chat sees them, the row already exists in
// bc_scheduled_actions with a real id and run_at. The ghost's own
// sentence ("...which is in 7 seconds") is accurate for exactly the
// instant it was written and stale a moment later. This card is the
// fix: it re-derives the countdown from the stored timestamp every
// second, and — because it also subscribes to SCHED_STORE the same way
// every other scheduling UI in this app does — it flips itself from
// "counting down" to "Sent" / "Cancelled" / "Failed" the instant
// SCHED_RUNTIME reports the job's real outcome, even if that happens in
// a different tab. schedule_view reuses this same card verbatim when the
// operator asks about one specific queued item rather than creating a
// new one — same live bubble, just re-summoned on request.
const SCHED_CARD_STATUS = {
  done:      { text: 'Sent ✓',    color: 'rgba(120,215,160,0.9)', dot: '#78d7a0', pulse: false },
  cancelled: { text: 'Cancelled', color: 'var(--t3)',              dot: '#8a8a8a', pulse: false },
};
const ScheduledActionCard = ({ m }) => {
  const sched = m.sched || {};
  const [, bump] = React.useState(0);
  const [job, setJob] = React.useState(() =>
    (typeof SCHED_STORE !== 'undefined' && SCHED_STORE.byId) ? SCHED_STORE.byId(sched.id) : null
  );

  React.useEffect(() => {
    if (typeof SCHED_STORE === 'undefined' || !sched.id) return;
    // Pick up whatever SCHED_STORE already has (it's usually just been
    // refreshed by the schedule_create/update handler) and stay subscribed
    // for the eventual fired/cancelled/failed update.
    setJob(SCHED_STORE.byId(sched.id));
    return SCHED_STORE.sub(() => setJob(SCHED_STORE.byId(sched.id)));
  }, [sched.id]);

  const status = job ? job.status : 'pending';
  const atMs   = (job && job.at) || sched.atMs;
  const tz     = (job && job.tz) || sched.tz || '';
  const label  = (job && (job.label || (SCHED_STORE.describeJob && SCHED_STORE.describeJob(job)))) || sched.label || 'Scheduled action';
  const live   = status === 'pending' || status === 'running';

  // Tick once a second only while it's actually live — once the job
  // settles (sent/cancelled/failed) the card is static and costs nothing.
  React.useEffect(() => {
    if (!live) return;
    const id = setInterval(() => bump(t => (t + 1) % 1e6), 1000);
    return () => clearInterval(id);
  }, [live]);

  // Server-corrected clock, so this card and the server agree on "due now".
  const now = (typeof schedNow === 'function') ? schedNow() : Date.now();
  const haveTime = typeof SCHED_TIME !== 'undefined' && Number.isFinite(atMs);
  const dueNow = live && haveTime && atMs - now <= 0;
  const countdownTxt = !haveTime ? ''
    : dueNow ? 'sending…'
    : status === 'running' ? 'sending…'
    : SCHED_TIME.countdown(atMs, now);
  const whenTxt = haveTime ? SCHED_TIME.describeAt(atMs, tz, { now }) : '';

  const failedMeta = { text: job && job.lastError ? `Failed — ${job.lastError}` : 'Failed', color: 'rgba(255,138,128,0.9)', dot: '#ff8a80', pulse: false };
  const meta = live
    ? { text: countdownTxt, color: 'var(--t3)', dot: 'color-mix(in oklab, var(--acc) 65%, #d6d6e4)', pulse: true }
    : (SCHED_CARD_STATUS[status] || failedMeta);

  return (
    <div className="brow brow-in" style={{gap:8, alignItems:'flex-end', marginBottom:10}}>
      <div style={{width:28, flexShrink:0}}>
        <GhostAva sz={28}/>
      </div>
      <div className="bubble b-in" style={{minWidth:220}}>
        <div style={{
          display:'flex', alignItems:'center', gap:6, marginBottom:6,
          fontSize:9.5, fontWeight:700, letterSpacing:'0.06em',
          textTransform:'uppercase', color:'var(--t3)',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
          </svg>
          Scheduled
        </div>
        <div style={{fontSize:13, color:'var(--t1)', lineHeight:1.45}}>{label}</div>
        {whenTxt && (
          <div style={{fontSize:11.5, color:'var(--t3)', marginTop:4, lineHeight:1.45}}>{whenTxt}</div>
        )}
        <div style={{
          display:'inline-flex', alignItems:'center', gap:6, marginTop:8,
          fontSize:11, fontWeight:600, letterSpacing:'-0.005em', color: meta.color,
        }}>
          <span style={{
            width:6, height:6, borderRadius:'50%', background: meta.dot, flexShrink:0,
            animation: meta.pulse ? 'gc-pulse 1.6s ease-in-out infinite' : 'none',
          }}/>
          {meta.text}
        </div>
        <style>{`@keyframes gc-pulse{0%,100%{opacity:0.45}50%{opacity:1}}`}</style>
      </div>
    </div>
  );
};

const GhostChatView = ({onClose, onBack, backTarget, chatWidth}) => {
  GHOST_CHAT_STORE.load();
  const [, force]   = React.useReducer(x => x + 1, 0);
  const [busy, setBusy]       = React.useState(false);
  // Language the ghost is currently speaking, reported by the server on
  // every turn (prompt rule 9d). Persisted so reopening the chat doesn't
  // flash English chrome over a Spanish thread before the first reply.
  const [lang, setLang] = React.useState(() => {
    try { return localStorage.getItem('bc.ghost.lang') || 'en'; } catch (_) { return 'en'; }
  });
  const T   = ghostStrings(lang);
  const rtl = ghostIsRTL(lang);
  const [hasText, setHasText] = React.useState(false);
  const [hover, setHover]     = React.useState(false);
  const [focused, setFocused] = React.useState(false);

  // Everything already in the thread when this view opened is history and
  // must not re-animate. Comparing each message's own timestamp against the
  // moment of mount is a pure read — no ledger to keep in sync, and it
  // stays correct across the many re-renders the store notify triggers,
  // because the answer for a given message never changes.
  const openedAtRef = React.useRef(Date.now());
  const threadRef  = React.useRef(null);
  useBubbleShaper(threadRef, 'ghost');
  const taRef      = React.useRef(null);
  const inputRef   = React.useRef('');
  const sessionRef = React.useRef(ghostChatSession.read());
  const mountedRef = React.useRef(true);
  const sendLockRef= React.useRef(false);
  // Bookkeeping for a batch of async verbs in flight. `msgId` is the
  // "working…" bubble we patch with progress and finally replace with the
  // outcome, so a batch of five sends produces one updating line rather
  // than five separate bubbles.
  const pendingRef = React.useRef({counts:{}, total:0, done:0, failed:0, msgId:null, reports:[], timer:null});
  // Set when the watchdog gives up on a batch: {msgId, verbs, reports,
  // failed, at}. Lets a result that arrives afterwards rewrite the bubble
  // the watchdog left behind.
  const staleRef = React.useRef(null);

  const thread = GHOST_CHAT_STORE.thread;
  // A new set of suggestions each time the chat is fresh (opened empty, or
  // cleared), in the chat's language.
  const isEmpty = thread.length === 0;
  const [sugVisit, setSugVisit] = React.useState(0);
  const wasEmptyRef = React.useRef(isEmpty);
  React.useEffect(() => {
    if (isEmpty && !wasEmptyRef.current) setSugVisit(v => v + 1);
    wasEmptyRef.current = isEmpty;
  }, [isEmpty]);
  const langBase = ghostBaseLang(lang);
  // The suggestions read the account (agents, catalogue, wallets, chats), so
  // they're picked once that has loaded — and picked again if the chat was
  // opened before it had.
  const [sugReady, setSugReady] = React.useState(() => !!ghostSugContext());
  React.useEffect(() => {
    if (sugReady) return;
    const check = () => { if (ghostSugContext()) setSugReady(true); };
    const offs = [];
    try { offs.push(AGENTS_STORE.sub(check)); } catch (_) {}
    try { offs.push(PRODS_STORE.sub(check)); } catch (_) {}
    try { offs.push(CRED_STORE.sub(check)); } catch (_) {}
    try { offs.push(PAYMENTS_STORE.sub(check)); } catch (_) {}
    const iv = setInterval(check, 1500);
    check();
    return () => { clearInterval(iv); offs.forEach(f => { try { f && f(); } catch (_) {} }); };
  }, [sugReady]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const suggestions = React.useMemo(() => pickGhostSuggestions(lang), [sugVisit, langBase, sugReady]);

  // ── GHOST VISIBILITY WHILE CHATTING ──────────────────────────────
  // The ghost's WebGL layers are declared at z-index 7200/8400, but they
  // render inside the EmptyChatAvatar wrapper, which is position:absolute
  // with z-index:0 — a stacking context. That traps them: the chat panel
  // is a sibling at z-index:1 and therefore always paints on top, so the
  // ghost can never rise above the transcript no matter how high his own
  // z-index goes. He ends up behind the messages, bleeding through the
  // translucent chat surface, which reads as a rendering glitch.
  //
  // On the empty state he has nothing to sit behind and looks right, so
  // we keep him there and retire him the moment the thread has content.
  // The flag goes on <body> because the rule that reveals him
  // (body[data-bcw-ghost="1"]) lives in the stylesheet and has no way to
  // see this component's state.
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (thread.length > 0) document.body.setAttribute('data-bcw-ghost-chatting', '1');
    else                   document.body.removeAttribute('data-bcw-ghost-chatting');
    return () => { document.body.removeAttribute('data-bcw-ghost-chatting'); };
  }, [thread.length]);

  React.useEffect(() => {
    mountedRef.current = true;
    const unsub = GHOST_CHAT_STORE.sub(force);
    ghostChatSession.hydrate(sid => { sessionRef.current = sid; });
    return () => {
      mountedRef.current = false;
      unsub();
      // Don't leave a watchdog running against an unmounted component.
      if (pendingRef.current.timer) clearTimeout(pendingRef.current.timer);
    };
  }, []);

  // ── AUTOSCROLL ──────────────────────────────────────────────────────
  // Only pull to the bottom when the operator is already near it, so
  // reading scrollback isn't yanked away by an arriving reply.
  const pinnedRef = React.useRef(true);
  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    pinnedRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 120;
  };
  React.useLayoutEffect(() => {
    const el = threadRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [thread.length, thread[thread.length - 1]]);

  // Focus the composer when the view opens — the operator clicked the
  // ghost to say something, so put the caret where they can say it.
  React.useEffect(() => {
    const t = setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      // If they started typing at the board, carry the character in and put
      // the caret after it — the sentence continues where it began rather
      // than the first keystroke being swallowed by the transition.
      const seed = takeGhostSeed();
      if (seed) {
        ta.value = seed;
        setHasText(ta.value.trim().length > 0);
        ta.style.height = 'auto';
        ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
      }
      try { ta.focus({preventScroll: true}); } catch(_){}
      try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch(_){}
    }, 90);
    return () => clearTimeout(t);
  }, []);

  // Type anywhere in the ghost chat and the composer takes focus.
  // Disabled while busy — the textarea is non-interactive mid-send.
  useTypeToFocus(taRef, busy);

  const say = (text, extra) => GHOST_CHAT_STORE.add({r:'in', c:text, ...(extra || {})});

  // ── ASYNC ACTION RESULTS ────────────────────────────────────────────
  // ghostActionHandler fires bcGhostResult once per async verb. We count
  // them down and fold the reports into the single "working" bubble.
  React.useEffect(() => {
    const onResult = (e) => {
      if (!mountedRef.current) return;
      const d = e && e.detail;
      if (!d) return;
      // A scheduled job firing reports on this same event, but it belongs
      // to no batch typed here. Counting it against the live batch closed
      // that batch early — with the scheduled job's report in its place.
      if (d._scheduled) return;
      const p = pendingRef.current;
      const verb = d.kind;

      // ── LATE ARRIVAL ────────────────────────────────────────────────
      // The watchdog has already given up on this batch and told the
      // operator so. If the result then turns up — a slow relay, a server
      // that took longer than 45s — replace that warning with what
      // actually happened rather than leaving a scary, now-wrong message
      // sitting in the transcript. Scoped to the verbs THIS batch was
      // waiting for, and to a short window, so a later command's result
      // can never rewrite an older bubble.
      if (!p.total) {
        const s = staleRef.current;
        if (s && s.verbs[verb] && Date.now() - s.at < GHOST_LATE_REPAIR_MS) {
          s.verbs[verb] = Math.max(0, s.verbs[verb] - 1);
          if (d.resolved === false) s.failed += 1;
          s.reports.push(d.report || d.reason || (d.resolved === false ? 'Action failed' : 'Done'));
          const left = Object.values(s.verbs).reduce((n, x) => n + x, 0);
          GHOST_CHAT_STORE.patch(s.msgId, {
            kind: 'text',
            tone: s.failed ? (s.failed === s.reports.length ? 'error' : 'warn') : 'ok',
            c: s.reports.join('\n') + (left > 0 ? `\nStill waiting on ${left} more.` : ''),
          });
          if (left <= 0) staleRef.current = null;
        }
        return;
      }
      if (!p.counts[verb]) return;

      p.counts[verb] = Math.max(0, p.counts[verb] - 1);
      p.done += 1;
      const failed = d.resolved === false;
      if (failed) p.failed += 1;
      const detail = d.report || d.reason || (failed ? 'Action failed' : 'Done');
      p.reports.push(detail);

      if (failed) p.failReports = [...(p.failReports || []), detail];
      const remaining = p.total - p.done;
      if (remaining > 0 && p.quiet) return;   // nothing on screen to update
      if (remaining > 0) {
        GHOST_CHAT_STORE.patch(p.msgId, {
          kind: 'working',
          c: `${detail} · ${p.done}/${p.total}`,
        });
        return;
      }

      // Quiet batch complete: the reply already said what happened. Only a
      // failure earns a bubble — and then just the part that failed.
      if (p.quiet) {
        if (p.failed) {
          GHOST_CHAT_STORE.add({r:'in', c: (p.failReports || []).join('\n'), tone: 'warn'});
        }
        if (p.timer) clearTimeout(p.timer);
        pendingRef.current = {counts:{}, total:0, done:0, failed:0, msgId:null, reports:[], timer:null};
        if (mountedRef.current) setBusy(false);
        return;
      }

      // Batch complete. Collapse the working bubble into the outcome.
      const body = p.reports.join('\n');
      const allFailed  = p.failed === p.total;
      const someFailed = p.failed > 0 && !allFailed;
      GHOST_CHAT_STORE.patch(p.msgId, {
        kind: 'text',
        c: (allFailed || someFailed) ? body : ghostMaybeBoo(body),
        tone: allFailed ? 'error' : (someFailed ? 'warn' : 'ok'),
      });
      if (p.timer) clearTimeout(p.timer);
      pendingRef.current = {counts:{}, total:0, done:0, failed:0, msgId:null, reports:[], timer:null};
      if (mountedRef.current) setBusy(false);
    };
    window.addEventListener('bcGhostResult', onResult);
    return () => window.removeEventListener('bcGhostResult', onResult);
  }, []);

  // ── VERB DISPATCH ───────────────────────────────────────────────────
  // Prefer the dashboard overlay's dispatcher (handles widget_show/hide,
  // task_create/complete and navigate on top of the engine verbs); fall
  // back to the engine handler alone when the overlay isn't mounted.
  const dispatchActions = (actions) => {
    if (!actions || !actions.length) return false;
    const p = pendingRef.current;
    let any = false;
    const run = (typeof window !== 'undefined' && typeof window.__bcwLayoutAction === 'function')
      ? window.__bcwLayoutAction
      : (typeof window !== 'undefined' && window.__ghostActionHandler) || null;
    if (!run) return false;
    for (const a of actions) {
      try {
        if (run(a)) {
          any = true;
          if (GHOST_ASYNC_VERBS.has(a.verb)) {
            p.counts[a.verb] = (p.counts[a.verb] || 0) + 1;
            p.total += 1;
          }
        }
      } catch (err) { console.warn('[ghost-chat] action failed', a, err); }
    }
    return any;
  };

  // ── THE ROUND TRIP ──────────────────────────────────────────────────
  // `opts.confirmNonce` re-enters the same path for the confirm step of a
  // destructive verb — the server runs the queued operation and returns
  // its real action sentinels, so the handling below is identical.
  const runCommand = async (text, opts = {}) => {
    if (sendLockRef.current) return;
    if (!window.__ghostCmd) {
      say(T.notReady, {tone:'error'});
      return;
    }
    sendLockRef.current = true;
    setBusy(true);

    const typing = GHOST_CHAT_STORE.add({r:'in', kind:'typing', c:''});
    const finish = () => {
      sendLockRef.current = false;
      GHOST_CHAT_STORE.remove(typing.id);
    };

    try {
      const ctx = {
        view:        'ghost_chat',
        layout_keys: (window.__bcwLayoutKeys && window.__bcwLayoutKeys()) || [],
        session_id:  sessionRef.current || '',
      };
      if (opts.confirmNonce) ctx.confirm_nonce = opts.confirmNonce;

      const res = await window.__ghostCmd(text, ctx);
      finish();
      if (!mountedRef.current) return;

      if (res && res.session_id) {
        sessionRef.current = res.session_id;
        ghostChatSession.write(res.session_id);
      }
      if (res && res.lang) {
        setLang(res.lang);
        try { localStorage.setItem('bc.ghost.lang', res.lang); } catch (_) {}
      }

      if (!res || res.error) {
        say(ghostFriendlyError(res && res.error, res && res.lang || lang), {tone:'error'});
        setBusy(false);
        return;
      }

      // Destructive verb → render a confirm card instead of acting.
      const confirmAct = (res.actions || []).find(a => a.verb === 'confirm');
      if (confirmAct) {
        if (res.speak) say(res.speak);
        GHOST_CHAT_STORE.add({
          r: 'in', kind: 'confirm', state: 'pending', c: '',
          confirm: {
            nonce:   confirmAct.attrs.nonce   || '',
            summary: confirmAct.attrs.summary || 'Confirm this action?',
            sub:     confirmAct.attrs.sub     || '',
            verb:    confirmAct.attrs.verb    || '',
            danger:  confirmAct.attrs.danger === '1' || confirmAct.attrs.danger === 'true',
          },
        });
        setBusy(false);
        return;
      }

      const did     = dispatchActions(res.actions || []);
      const speak   = res.speak || '';
      const clarify = res.clarify || '';
      const dropped = Array.isArray(res.dropped_verbs) ? res.dropped_verbs : [];

      // A boo only ever goes on a plain reply that isn't followed by a
      // question or a batch still in flight (that gets its own chance).
      const willWork = did && pendingRef.current.total > 0
        && !Object.keys(pendingRef.current.counts).every(v => GHOST_QUIET_VERBS.has(v));
      if (speak)   say((clarify || willWork) ? speak : ghostMaybeBoo(speak));
      if (clarify) say(clarify, {tone:'ask'});

      // ── Live countdown card ──────────────────────────────────────
      // schedule_create/schedule_update/schedule_view aren't in
      // GHOST_ASYNC_VERBS — they already completed server-side by the
      // time we're here, so res.actions carries the real job id + run_at
      // (see api.php). Drop a persistent, self-ticking card so the
      // countdown the operator reads never goes stale the way the
      // one-off spoken sentence does.
      //
      // schedule_view rides the exact same card: it's how the ghost
      // re-surfaces ONE specific scheduled item the operator asked
      // about (named it, asked "show me", asked what it's for) rather
      // than a fresh creation. The accompanying `speak` line — forced
      // server-side to the deterministic description — is what actually
      // explains what the job does, since the card's own label is often
      // too terse on its own (e.g. "Message Mr. Flume" doesn't say what
      // the message is about).
      const schedAct = (res.actions || []).find(a =>
        (a.verb === 'schedule_create' || a.verb === 'schedule_update' || a.verb === 'schedule_view') &&
        a.attrs && a.attrs.id != null && a.attrs.at_ms != null
      );
      if (schedAct) {
        GHOST_CHAT_STORE.add({
          r: 'in', kind: 'scheduled', c: '',
          sched: {
            id:    String(schedAct.attrs.id),
            atMs:  Number(schedAct.attrs.at_ms),
            tz:    schedAct.attrs.tz || '',
            label: schedAct.attrs.label || '',
          },
        });
      }

      // Async work in flight — park a progress bubble the result listener
      // will take over. Note busy stays true until that lands.
      const p = pendingRef.current;
      if (did && p.total > 0 && speak && Object.keys(p.counts).every(v => GHOST_QUIET_VERBS.has(v))) {
        // Quiet batch — see GHOST_QUIET_VERBS. No progress bubble; the
        // composer stays in its "working" state until results land.
        p.quiet = true;
        p.failReports = [];
        p.timer = setTimeout(() => {
          if (!mountedRef.current) return;
          const cur = pendingRef.current;
          if (!cur.total || !cur.quiet) return;
          GHOST_CHAT_STORE.add({r:'in', tone:'warn',
            c: "That's taking longer than it should, so I've stopped waiting. It may still have gone through — worth a quick check before trying again."});
          pendingRef.current = {counts:{}, total:0, done:0, failed:0, msgId:null, reports:[], timer:null};
          setBusy(false);
        }, GHOST_ACTION_TIMEOUT_MS);
        return;
      }
      if (did && p.total > 0) {
        const row = GHOST_CHAT_STORE.add({r:'in', kind:'working', c:T.working});
        p.msgId = row.id;
        // WATCHDOG. The composer is disabled while a batch is in flight, and
        // the only thing that re-enables it is a bcGhostResult per dispatched
        // verb. If one never arrives — a handler that returns true then throws
        // before announcing, a platform relay that silently drops, a verb added
        // later to GHOST_ASYNC_VERBS whose handler doesn't announce — the input
        // would stay locked with no way out short of a reload.
        //
        // The composer doesn't need this because it releases its lock and lets
        // you keep typing regardless; we disable input instead, so we owe the
        // operator a guaranteed exit. On timeout we report what did land rather
        // than claiming success or failure, because we genuinely don't know
        // which: the action may well have completed server-side.
        const watchdogFor = p.msgId;
        p.timer = setTimeout(() => {
          if (!mountedRef.current) return;
          const cur = pendingRef.current;
          if (!cur.total || cur.msgId !== watchdogFor) return; // already settled
          const done = cur.reports.length
            ? cur.reports.join('\n') + '\n'
            : '';
          GHOST_CHAT_STORE.patch(watchdogFor, {
            kind: 'text',
            tone: 'warn',
            c: `${done}Stopped waiting after ${cur.total - cur.done} of ${cur.total} didn't report back. They may still have gone through — check before retrying.`,
          });
          // Remember what we stopped waiting for, so a late result can
          // correct this bubble instead of being dropped.
          staleRef.current = {
            msgId:   watchdogFor,
            verbs:   {...cur.counts},
            reports: [...cur.reports],
            failed:  cur.failed,
            at:      Date.now(),
          };
          pendingRef.current = {counts:{}, total:0, done:0, failed:0, msgId:null, reports:[], timer:null};
          setBusy(false);
        }, GHOST_ACTION_TIMEOUT_MS);
        return;
      }

      if (did && !speak) say(T.done, {tone:'ok'});

      if (dropped.length) {
        // Verb names are internal identifiers. Say what was attempted, not
        // what the code calls it.
        say(`I couldn't do ${ghostVerbPhrase(dropped)} — that isn't something I can do yet.`, {tone:'warn'});
      }
      if (!did && !speak && !clarify && !dropped.length) {
        say(T.noAction, {tone:'warn'});
      }
      setBusy(false);
    } catch (err) {
      finish();
      if (!mountedRef.current) return;
      say(ghostFriendlyError(err && err.message, lang), {tone:'error'});
      setBusy(false);
    }
  };

  // Put the caret back in the composer. Guarded on document.activeElement
  // so we never steal focus from somewhere the operator deliberately moved
  // it — clicking a Confirm button, or a field in another pane.
  const refocus = React.useCallback((force) => {
    const ta = taRef.current;
    if (!ta || ta.disabled) return;
    const active = document.activeElement;
    const stoleFrom = active && active !== document.body && active !== ta;
    if (stoleFrom && !force) return;
    try { ta.focus({preventScroll: true}); } catch (_) { try { ta.focus(); } catch (_) {} }
  }, []);

  const send = (override) => {
    const text = String(override != null ? override : (inputRef.current || '')).trim();
    if (!text || busy) return;
    // Clear the composer immediately — the message is now in the thread.
    inputRef.current = '';
    if (taRef.current) {
      taRef.current.value = '';
      taRef.current.style.height = 'auto';
    }
    setHasText(false);
    GHOST_CHAT_STORE.add({r:'out', c:text});
    runCommand(text);
    // Keep the caret where it was. Matters most for the suggestion chips,
    // which put focus on a button — without this the first thing you do
    // after clicking one is click the composer.
    requestAnimationFrame(() => refocus(true));
  };

  const onConfirm = (row) => {
    GHOST_CHAT_STORE.patch(row.id, {state:'confirmed'});
    runCommand('', {confirmNonce: row.confirm.nonce});
  };
  const onCancelConfirm = (row) => {
    GHOST_CHAT_STORE.patch(row.id, {state:'cancelled'});
    say(T.cancelledMsg);
  };

  const clearThread = () => {
    GHOST_CHAT_STORE.clear();
    // Drop the LLM session too, so "clear" means the ghost genuinely
    // starts fresh rather than silently remembering the cleared turns.
    sessionRef.current = '';
    try { sessionStorage.removeItem('bcw.ghost.session'); } catch (_) {}
    if (typeof IDB_STORE !== 'undefined') IDB_STORE.set('ghost.session', '').catch(() => {});
  };

  // The textarea is disabled while busy, and disabling an element blurs it.
  // So when busy clears we have to actively hand focus back, otherwise the
  // operator has to click the composer after every single reply.
  const prevBusyRef = React.useRef(busy);
  React.useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (wasBusy && !busy) {
      // One frame's grace so the disabled attribute has actually come off.
      requestAnimationFrame(() => refocus(false));
    }
  }, [busy, refocus]);

  const gcWrapRef = React.useRef(null);
  const gcInRef   = React.useRef(null);
  useComposerHeight(gcWrapRef, gcInRef);
  ensureComposerStyles();
  const composerActive = hover || focused || hasText || busy || bcNoHover();

  return (
    <div className="ipc" lang={lang} dir={rtl ? 'rtl' : 'ltr'} onScroll={pinClipScroll}
      style={chatWidth ? {'--msg-col-w': `${chatWidth}px`} : undefined}>
      {/* Tone tints for ghost replies. Scoped to .gc-tone so nothing here
          can leak into a customer chat's bubbles. Text colour AND border are
          nudged together so the state reads at a glance without shouting —
          an error bubble should be noticeable, not alarming. */}
      <style>{`
        .gc-tone-ok    .bubble { color: color-mix(in oklab, #7fbf98 45%, var(--t1)); border-color: color-mix(in oklab, #7fbf98 30%, transparent); }
        .gc-tone-warn  .bubble { color: color-mix(in oklab, #d0a060 45%, var(--t1)); border-color: color-mix(in oklab, #d0a060 32%, transparent); }
        .gc-tone-error .bubble { color: color-mix(in oklab, #d08279 50%, var(--t1)); border-color: color-mix(in oklab, #d08279 36%, transparent); }
        .gc-tone-ask   .bubble { color: var(--t1); border-color: color-mix(in oklab, var(--acc) 34%, transparent); }
      `}</style>
      <div className="ipc-chat-col" onScroll={pinClipScroll}>

        {/* ── HEADER ──
            Mirrors InPageChat's layout (back cluster left, centered
            identity pill) so switching between a customer chat and this
            one doesn't shift anything. The identity pill is a plain div,
            NOT a button: there's no customer record behind the ghost, so
            the floating profile panel that InPageChat opens here would
            have nothing to show. */}
        <div className="ipc-hdr" style={{
          display:'flex', alignItems:'center',
          padding:'0 12px', position:'relative', gap:6,
          background:'transparent', borderBottom:'none',
        }}>
          <div style={{display:'flex', alignItems:'center', gap:2, flexShrink:0}}>
            <button onClick={onBack || onClose}
              title={onBack && backTarget ? `${T.back} — ${backTarget.name}` : T.back}
              style={{
                flexShrink:0, width:28, height:28, borderRadius:'50%',
                display:'flex', alignItems:'center', justifyContent:'center',
                color:'var(--t2)', background:'rgba(255,255,255,0.05)',
                border:'1px solid rgba(255,255,255,0.06)',
                cursor:'pointer', transition:'background 0.12s, color 0.12s, border-color 0.12s',
                padding:0,
              }}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.10)';e.currentTarget.style.color='var(--t1)';}}
              onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.05)';e.currentTarget.style.color='var(--t2)';}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
              </svg>
            </button>
            {onBack && onClose && (
              <button onClick={onClose} title={T.home}
                style={{
                  flexShrink:0, width:28, height:28, borderRadius:'50%',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  color:'var(--t3)', background:'transparent',
                  border:'1px solid transparent', cursor:'pointer', padding:0,
                  transition:'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.06)';e.currentTarget.style.color='var(--t2)';}}
                onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--t3)';}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1z"/><polyline points="9 21 9 12 15 12 15 21"/>
                </svg>
              </button>
            )}
          </div>

          {/* Identity pill — inert by design (see header comment above). */}
          <div style={{
            position:'absolute', left:'50%', top:'50%',
            transform:'translate(-50%, -50%)',
            display:'inline-flex', alignItems:'center', gap:8,
            padding:'3px 12px 3px 3px',
            background:'rgba(255,255,255,0.035)',
            border:'1px solid rgba(255,255,255,0.06)',
            backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
            borderRadius:999,
            boxShadow:'0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.07)',
            zIndex:2, userSelect:'none',
          }}>
            <div style={{position:'relative', flexShrink:0, width:26, height:26}}>
              <GhostAva sz={26}/>
              <span style={{
                position:'absolute', right:-1, bottom:-1,
                width:8, height:8, borderRadius:'50%',
                background: busy ? '#e8a844' : '#7c6fd4',
                border:'2px solid #14162680',
                transition:'background 0.2s ease',
              }}/>
            </div>
            <span style={{
              fontSize:12.5, fontWeight:600, color:'var(--t1)',
              letterSpacing:'-0.01em', lineHeight:1, paddingBottom:1,
            }}>Ghost</span>
            <span style={{
              fontSize:10.5, color:'var(--t3)', lineHeight:1,
              paddingBottom:1, letterSpacing:'-0.005em',
            }}>{busy ? T.working : T.assistant}</span>
          </div>

          <div style={{flex:1}}/>
          {thread.length > 0 && (
            <button onClick={clearThread} title="Clear this conversation and reset the ghost's memory"
              style={{
                flexShrink:0, height:26, padding:'0 10px', borderRadius:999,
                fontSize:10.5, fontWeight:600, letterSpacing:'-0.005em',
                color:'var(--t3)', background:'transparent',
                border:'1px solid rgba(255,255,255,0.07)',
                cursor:'pointer', transition:'color 0.12s, border-color 0.12s',
                zIndex:3,
              }}
              onMouseEnter={e=>{e.currentTarget.style.color='var(--t1)';e.currentTarget.style.borderColor='rgba(255,255,255,0.16)';}}
              onMouseLeave={e=>{e.currentTarget.style.color='var(--t3)';e.currentTarget.style.borderColor='rgba(255,255,255,0.07)';}}>
              {T.clear}
            </button>
          )}
        </div>

        {/* ── THREAD ── */}
        <div className="ipc-thread" ref={threadRef} onScroll={onThreadScroll}
          onMouseMove={(e) => {
            // Composer reveal — see the note by the removed hot-zone overlay
            // further down. Tracked via cursor position instead of an
            // overlay so nothing sits in front of real thread content.
            const r = e.currentTarget.getBoundingClientRect();
            setHover(e.clientY >= r.bottom - 120);
          }}
          onMouseLeave={() => setHover(false)}
          style={{paddingBottom:90}}>
          <div className="ipc-body">
            {thread.length === 0 && (
              <div style={{
                display:'flex', flexDirection:'column', alignItems:'center',
                justifyContent:'center', textAlign:'center',
                padding:'64px 20px 20px', gap:14,
              }}>
                {/* ── WHERE THE GHOST LANDS ──────────────────────────
                    Not an image. This is an empty, transparent cell that
                    the live WebGL ghost uses as its home while the chat is
                    open and empty — the same mechanism the widget board
                    uses (.bcw-ghost-reserve), so the ghost springs here and
                    arrives with its eyes, its drift and its blink intact.

                    The flat PNG that used to sit here had a purple
                    drop-shadow glow behind it, which was doing two jobs at
                    once: standing in for the real ghost, and papering over
                    the fact that it was a static cut-out. With the actual
                    ghost in the slot both jobs disappear — a glow behind a
                    figure that already casts its own light just muddies it.

                    Sized a little larger than the old 64px image because
                    the ghost is rendered at depth and needs the room. */}
                <GhostSlot size={96}/>
                <div style={{fontSize:14, fontWeight:600, color:'var(--t1)', letterSpacing:'-0.01em'}}>
                  {T.ask}
                </div>
                <div style={{fontSize:11.5, color:'var(--t3)', opacity:0.8, maxWidth:320, lineHeight:1.5, marginTop:-6}}>
                  {T.blurb}
                </div>
                <div style={{display:'flex', flexWrap:'wrap', gap:7, justifyContent:'center', marginTop:4, maxWidth:440}}>
                  {suggestions.map(s => (
                    <button key={s} onClick={()=>send(s)}
                      style={{
                        padding:'6px 12px', borderRadius:999, fontSize:11.5,
                        color:'var(--t2)', background:'rgba(255,255,255,0.035)',
                        border:'1px solid rgba(255,255,255,0.07)',
                        cursor:'pointer', letterSpacing:'-0.005em',
                        transition:'background 0.12s, color 0.12s, border-color 0.12s',
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.background='color-mix(in oklab, var(--acc) 14%, transparent)';e.currentTarget.style.color='var(--t1)';e.currentTarget.style.borderColor='color-mix(in oklab, var(--acc) 32%, transparent)';}}
                      onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.035)';e.currentTarget.style.color='var(--t2)';e.currentTarget.style.borderColor='rgba(255,255,255,0.07)';}}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {thread.map((m, i) => {
              const prev = thread[i-1];
              const next = thread[i+1];

              // ── Typing indicator ──
              if (m.kind === 'typing') {
                return (
                  <div key={m.id} className="brow brow-in" style={{gap:8, alignItems:'flex-end', marginBottom:10}}>
                    <div style={{width:28, flexShrink:0}}>
                      <GhostAva sz={28}/>
                    </div>
                    <div className="bubble b-in" style={{display:'inline-flex', alignItems:'center', gap:4, padding:'11px 14px'}}>
                      {[0,1,2].map(d => (
                        <span key={d} style={{
                          width:5, height:5, borderRadius:'50%', background:'var(--t3)',
                          animation:`gc-dot 1.2s ${d * 0.16}s infinite ease-in-out`,
                        }}/>
                      ))}
                      <style>{`@keyframes gc-dot{0%,60%,100%{opacity:0.28;transform:translateY(0)}30%{opacity:0.95;transform:translateY(-3px)}}`}</style>
                    </div>
                  </div>
                );
              }

              // ── Live progress for a batch of async actions ──
              if (m.kind === 'working') {
                return (
                  <div key={m.id} className="brow brow-in" style={{gap:8, alignItems:'flex-end', marginBottom:10}}>
                    <div style={{width:28, flexShrink:0}}>
                      <GhostAva sz={28}/>
                    </div>
                    <div className="bubble b-in" style={{display:'inline-flex', alignItems:'center', gap:8}}>
                      <span style={{
                        width:11, height:11, flexShrink:0, borderRadius:'50%',
                        border:'1.5px solid color-mix(in oklab, var(--acc) 30%, transparent)',
                        borderTopColor:'color-mix(in oklab, var(--acc) 70%, #e0e0ea)',
                        animation:'gc-spin 0.7s linear infinite',
                      }}/>
                      <span style={{fontSize:12.5, color:'var(--t2)'}}>{m.c}</span>
                      <style>{`@keyframes gc-spin{to{transform:rotate(360deg)}}`}</style>
                    </div>
                  </div>
                );
              }

              // ── Live countdown for a scheduled action ──
              if (m.kind === 'scheduled') {
                return <ScheduledActionCard key={m.id} m={m} />;
              }

              // ── Confirm card for a destructive verb ──
              // The nonce is server-minted and server-validated; this card
              // is only the affordance. Cancelling simply never sends it,
              // and it expires server-side after 10 minutes regardless.
              if (m.kind === 'confirm') {
                const c = m.confirm || {};
                const settled = m.state && m.state !== 'pending';
                return (
                  <div key={m.id} className="brow brow-in" style={{gap:8, alignItems:'flex-end', marginBottom:10}}>
                    <div style={{width:28, flexShrink:0}}>
                      <GhostAva sz={28}/>
                    </div>
                    <div className="bubble b-in" style={{
                      borderColor: c.danger && !settled ? 'rgba(255,138,128,0.35)' : undefined,
                      minWidth:220,
                    }}>
                      <div style={{
                        display:'flex', alignItems:'center', gap:6, marginBottom:6,
                        fontSize:9.5, fontWeight:700, letterSpacing:'0.06em',
                        textTransform:'uppercase',
                        color: c.danger ? 'rgba(255,138,128,0.9)' : 'var(--t3)',
                      }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 9v4"/><path d="M12 17h.01"/>
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                        </svg>
                        {T.confirmHdr}
                      </div>
                      <div style={{fontSize:13, color:'var(--t1)', lineHeight:1.45}}>{c.summary}</div>
                      {c.sub && (
                        <div style={{fontSize:11.5, color:'var(--t3)', marginTop:4, lineHeight:1.45}}>{c.sub}</div>
                      )}
                      {!settled ? (
                        <div style={{display:'flex', gap:7, marginTop:10}}>
                          <button onClick={()=>onConfirm(m)} disabled={busy}
                            style={{
                              padding:'5px 14px', borderRadius:9, fontSize:11.5, fontWeight:600,
                              border:'none', cursor: busy ? 'default' : 'pointer',
                              color:'#fff', opacity: busy ? 0.5 : 1,
                              background: c.danger
                                ? 'linear-gradient(135deg,#d4574d 0%,#b8433a 100%)'
                                : 'linear-gradient(135deg, var(--acc) 0%, #8b7eff 100%)',
                            }}>
                            {c.danger ? T.confirmDanger : T.confirm}
                          </button>
                          <button onClick={()=>onCancelConfirm(m)}
                            style={{
                              padding:'5px 14px', borderRadius:9, fontSize:11.5, fontWeight:600,
                              color:'var(--t2)', background:'transparent',
                              border:'1px solid rgba(255,255,255,0.12)', cursor:'pointer',
                            }}>
                            {T.cancel}
                          </button>
                        </div>
                      ) : (
                        <div style={{
                          marginTop:8, fontSize:11, fontWeight:600, letterSpacing:'-0.005em',
                          color: m.state === 'confirmed' ? 'rgba(120,215,160,0.9)' : 'var(--t3)',
                        }}>
                          {m.state === 'confirmed' ? `✓ ${T.confirmed}`
                            : m.state === 'expired' ? T.expired
                            : `✕ ${T.cancelled}`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              // ── Ordinary message ──
              // ChatBubbleRow is the same renderer customer chats use, so
              // bubble shape, grouping and hover timestamps all match.
              //
              // Tone (ok / warn / error) is applied via a wrapper CLASS, not
              // an inline style: .b-in sets `color: var(--t1)` explicitly, so
              // a colour inherited from the row would be overridden and the
              // tint would silently do nothing. The scoped rules in the
              // <style> block below target .bubble directly and win.
              const isGroupEnd   = !next || next.kind !== 'text' || !bcBubblesJoin(m, next);
              const isGroupStart = !prev || prev.kind !== 'text' || !bcBubblesJoin(prev, m);
              // Only the ghost's own words reveal — the operator's message
              // is already on screen before it's sent, so fading it in would
              // just look like lag. And only if it arrived after this view
              // opened, so scrollback stays still.
              const msgTs  = m.ts ? Date.parse(m.ts) : 0;
              const fresh  = m.r === 'in' && msgTs > 0 && msgTs >= openedAtRef.current;
              // Once per message — a re-render never replays it.
              const reveal = fresh && ghostRevealOnce(m.id, m.c);
              return (
                <div key={m.id} className={m.tone ? `gc-tone gc-tone-${m.tone}` : undefined}>
                  <ChatBubbleRow
                    m={m}
                    rich
                    reveal={reveal}
                    enter={fresh ? (m.r === 'in' ? 'in' : 'out') : (msgTs >= openedAtRef.current ? 'out' : null)}
                    msg={GHOST_CHAT_CONV}
                    sz={28}
                    isGroupStart={isGroupStart}
                    isGroupEnd={isGroupEnd}
                    avatarNode={<GhostAva sz={28}/>}
                    style={{marginBottom: isGroupEnd ? 10 : 2}}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Hover hot-zone — removed. It used to be a standalone overlay div
            here, layered on top of the thread with the browser's default
            pointer-events:auto, covering the bottom 120px of the whole chat
            surface. Any real content scrolled into that band (e.g. a
            moment's action button, the last bubble) sat behind an invisible
            click-catcher. Same idle-hide behaviour as InPageChat, now via
            onMouseMove/onMouseLeave on .ipc-thread above instead. */}

        {/* ── COMPOSER ── same panel as a customer chat's (.bc-comp). */}
        <div
          ref={gcWrapRef}
          className="bc-comp"
          onMouseEnter={()=>setHover(true)}
          onMouseLeave={()=>setHover(false)}
          style={{
            position:'absolute', bottom:22, left:'50%',
            transform: composerActive
              ? 'translateX(-50%) translateY(0)'
              : 'translateX(-50%) translateY(calc(100% + 22px))',
            opacity: composerActive ? 1 : 0,
            width:'calc(100% - 64px)', zIndex:10,
            transition: COMPOSER_TRANSITION,
            pointerEvents: composerActive ? 'auto' : 'none',
          }}>
          <div className="bc-comp-in" ref={gcInRef}>
          <div className="bc-row" style={{paddingLeft:14}}>
            <textarea
              ref={taRef}
              rows={1}
              maxLength={GHOST_CHAT_CAP}
              disabled={busy}
              placeholder={busy ? T.working : T.placeholder}
              className="bc-input"
              style={{opacity: busy ? 0.6 : 1}}
              onChange={e=>{
                const ta = e.currentTarget;
                inputRef.current = ta.value;
                ta.style.height = 'auto';
                ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
                const next = !!ta.value;
                setHasText(prev => prev === next ? prev : next);
              }}
              onFocus={()=>setFocused(true)}
              onBlur={()=>setFocused(false)}
              onKeyDown={e=>{
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}/>
            {/* Same send affordance as a customer chat: appears once there
                is something to send; Enter remains the fast path. */}
            <button type="button" className="bc-go" data-show={hasText && !busy ? '1' : '0'}
              onClick={send} tabIndex={hasText && !busy ? 0 : -1} title="Send (Enter)" aria-label="Send">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
            </button>
          </div>
          </div>
        </div>

      </div>{/* end ipc-chat-col */}
    </div>
  );
};

// Its thread arrives through GHOST_CHAT_STORE, so it only needs to redraw
// when its own props change — not on every customer-inbox notify.
const GhostChat = React.memo(GhostChatView);

// ═══════════════════════════════════════════════════════════════════
// DIRECT CHAT — encrypted account-to-account conversations
// ═══════════════════════════════════════════════════════════════════
// Its own view rather than a flag threaded through InPageChat: the
// platform machinery there (BotBridge sends, MSGS_STORE, the customer
// record) must never see these messages. It is built from the same parts
// as every other chat — the .ipc layout, the identity pill and agent
// bubble, ChatBubbleRow, the moment lines, the .bc-comp composer with its
// AI draft — so it looks and works like one. Messages come from DM_STORE;
// agents come from DM_AI (both bot-stores.jsx), which lets an approved
// agent answer through api.php while encryption stays in the browser.

// ── Popup frame — the settings windows' glass, sized for a short task ──
const ensureDmStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-dm-style')) return;
  const st = document.createElement('style');
  st.id = 'bc-dm-style';
  st.textContent = `
.dmp { position: fixed; left: 50%; top: 50%; z-index: 9710; transform: translate(-50%, -50%);
  width: min(400px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto;
  display: flex; flex-direction: column; box-sizing: border-box;
  --pt-acc: var(--acc, #6c63ff); --t3: #8a8aa8; --t4: #7a7a9c;
  background: rgba(12,13,24,var(--glass-a, 0.66));
  backdrop-filter: blur(40px) saturate(180%) brightness(1.04);
  -webkit-backdrop-filter: blur(40px) saturate(180%) brightness(1.04);
  border: 1px solid rgba(255,255,255,0.09); border-radius: 18px;
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.08),
    0 24px 70px -16px rgba(0,0,0,0.70), 0 4px 16px rgba(0,0,0,0.30);
  animation: dmp-in 220ms cubic-bezier(0.16,1,0.3,1) both; color: var(--t1, #eeeef5); }
.dmp:focus { outline: none; }
.dmp[data-out="1"] { animation: dmp-out 150ms cubic-bezier(0.4,0,1,1) both; pointer-events: none; }
@keyframes dmp-in  { from { opacity: 0; transform: translate(-50%, -49%) scale(0.985); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes dmp-out { from { opacity: 1; transform: translate(-50%, -50%) scale(1); } to { opacity: 0; transform: translate(-50%, -49%) scale(0.975); } }
@media (prefers-reduced-motion: reduce) { .dmp, .dmp[data-out="1"] { animation: none; } }
.dmp-scrim { position: fixed; inset: 0; z-index: 9700; background: rgba(4,5,12,0.18); animation: sset-backdrop-in 140ms ease-out both; }
body:has(.dmp) .ghost-overlay-layer { pointer-events: none !important; }
body:has(.dmp) .bcw-composer-layer { opacity: 0 !important; pointer-events: none !important; }
.dmp-hd { display: flex; align-items: center; gap: 10px; padding: 14px 10px 0 18px; }
.dmp-hd-t { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }
.dmp-x { width: 26px; height: 26px; border-radius: 50%; border: none; background: transparent; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: rgba(160,164,184,0.7); transition: background .14s, color .14s; }
.dmp-x:hover { background: rgba(255,255,255,0.06); color: var(--t1, #eeeef5); }
.dmp-x:focus-visible, .dmp-btn:focus-visible, .dmp-link:focus-visible, .dmp-sw:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--pt-acc) 38%, transparent); }
.dmp-bd { padding: 12px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
.dmp-p { font-size: 12px; line-height: 1.55; color: var(--t2, #9898b4); }
.dmp-p b { color: var(--t1, #eeeef5); font-weight: 600; }
.dmp-note { font-size: 11.5px; line-height: 1.5; color: var(--t3); padding: 10px 12px; border-radius: 10px;
  background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); }
.dmp-note[data-tone="warn"] { color: rgba(255,208,140,0.9); background: rgba(255,159,10,0.06); border-color: rgba(255,159,10,0.2); }
.dmp-note[data-tone="err"] { color: rgb(240,150,144); background: rgba(255,69,58,0.06); border-color: rgba(255,69,58,0.2); }
.dmp-row { display: flex; gap: 8px; align-items: center; }
.dmp-btn { height: 32px; padding: 0 14px; border-radius: 9px; font: inherit; font-size: 12px; font-weight: 550; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; white-space: nowrap;
  color: rgba(214,216,232,0.92); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  transition: background .14s, border-color .14s, color .14s; }
.dmp-btn:hover:not(:disabled) { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.13); }
.dmp-btn:disabled { opacity: 0.45; cursor: default; }
.dmp-btn[data-v="primary"] { color: #fff; background: color-mix(in oklab, var(--pt-acc) 88%, #15162a);
  border-color: color-mix(in oklab, var(--pt-acc) 70%, #fff 12%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
.dmp-btn[data-v="primary"]:hover:not(:disabled) { background: color-mix(in oklab, var(--pt-acc) 96%, #fff 4%); }
.dmp-btn[data-v="danger"] { color: rgb(236,128,122); background: transparent; border-color: rgba(230,110,104,0.24); }
.dmp-btn[data-v="danger"]:hover:not(:disabled) { color: rgb(246,140,134); background: rgba(230,110,104,0.08); border-color: rgba(230,110,104,0.38); }
.dmp-btn[data-grow="1"] { flex: 1; }
.dmp-link { all: unset; cursor: pointer; font-size: 11.5px; color: color-mix(in oklab, var(--pt-acc) 45%, #c8c9dc); border-radius: 4px; }
.dmp-link:hover { text-decoration: underline; }
.dmp-field { width: 100%; box-sizing: border-box; height: 34px; padding: 0 11px; border-radius: 9px; outline: none;
  font: 500 12.5px/1 var(--mono, 'JetBrains Mono', monospace); letter-spacing: 0.04em; color: var(--t1, #eeeef5);
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.075); }
.dmp-field:focus { border-color: color-mix(in oklab, var(--pt-acc) 55%, transparent); background: rgba(255,255,255,0.045);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--pt-acc) 14%, transparent); }
.dmp-sw { width: 30px; height: 17px; flex-shrink: 0; border-radius: 999px; border: none; padding: 0; position: relative; cursor: pointer;
  background: rgba(255,255,255,0.1); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); transition: background .16s; }
.dmp-sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 11px; height: 11px; border-radius: 50%;
  background: rgba(220,222,235,0.72); transition: transform .18s cubic-bezier(0.22,1,0.36,1), background .16s; }
.dmp-sw[aria-checked="true"] { background: color-mix(in oklab, var(--pt-acc) 82%, #1a1b2c); }
.dmp-sw[aria-checked="true"]::after { transform: translateX(13px); background: #fff; }
.dmp-sep { height: 1px; background: rgba(255,255,255,0.06); margin: 2px 0; }
.dmp-id { display: flex; align-items: center; gap: 12px; }
.dmp-id-n { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dmp-id-h { font-size: 12px; color: var(--t3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dmp-badge { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 10.5px; font-weight: 600;
  color: color-mix(in oklab, var(--pt-acc) 30%, #f3f3f8); background: color-mix(in oklab, var(--pt-acc) 15%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--pt-acc) 34%, transparent); }
.dmp-badge[data-tone="ok"] { color: rgba(140,220,170,0.95); background: rgba(48,209,88,0.08); box-shadow: inset 0 0 0 1px rgba(48,209,88,0.22); }

/* In-chat notices (lock state, key change, blocked) */
.dmc-note, .dmc-retry, .dmc-more { --pt-acc: var(--acc, #6c63ff); }
.dmp-note[data-tone="ok"] { color: rgba(140,220,170,0.95); background: rgba(48,209,88,0.06); border-color: rgba(48,209,88,0.2); }
.dmci-hero { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; padding-top: 2px; }
.dmci-hero .dmp-id-n { margin-top: 6px; font-size: 15px; }
.dmci-hero .dmp-badge { margin-top: 8px; }
.dmci-list { display: flex; flex-direction: column; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); }
.dmci-row { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 11px; padding: 10px 12px; cursor: pointer; transition: background .14s; }
.dmci-row + .dmci-row { border-top: 1px solid rgba(255,255,255,0.05); }
.dmci-row:hover:not(:disabled) { background: rgba(255,255,255,0.04); }
.dmci-row:disabled { cursor: default; opacity: 0.6; }
.dmci-row:focus-visible { box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--pt-acc) 38%, transparent); }
.dmci-ico { width: 28px; height: 28px; flex-shrink: 0; border-radius: 8px; display: grid; place-items: center;
  color: color-mix(in oklab, var(--pt-acc) 35%, #e6e6f2); background: color-mix(in oklab, var(--pt-acc) 13%, transparent); }
.dmci-row[data-danger="1"] .dmci-ico { color: rgb(236,128,122); background: rgba(230,110,104,0.1); }
.dmci-row[data-danger="1"] .dmci-t { color: rgb(236,140,134); }
.dmci-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dmci-t { font-size: 12.5px; font-weight: 550; color: var(--t1, #eeeef5); }
.dmci-s { font-size: 11px; color: var(--t3); line-height: 1.4; }
.dmci-chev { color: var(--t4); flex-shrink: 0; }
.dmc-note { display: flex; align-items: flex-start; gap: 10px; margin: 4px auto 14px; max-width: 460px; padding: 11px 12px;
  border-radius: 12px; font-size: 12px; line-height: 1.5; color: var(--t2, #9898b4);
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); }
.dmc-note[data-tone="warn"] { background: rgba(255,159,10,0.05); border-color: rgba(255,159,10,0.18); }
.dmc-note-ico { flex-shrink: 0; margin-top: 1px; color: color-mix(in oklab, var(--acc, #6c63ff) 45%, #c8c9dc); }
.dmc-note[data-tone="warn"] .dmc-note-ico { color: rgba(255,190,110,0.9); }
.dmc-note-body { flex: 1; min-width: 0; }
.dmc-note-t { color: var(--t1, #eeeef5); font-weight: 600; margin-bottom: 2px; }
.dmc-note-acts { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.dmp-btn:focus { outline: none; }
.dmp-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 38%, transparent); }
/* Agent approval notice */
.dmp-ai-lead { font-size: 12.5px; line-height: 1.55; color: var(--t2, #9898b4); }
.dmp-ai-lead b { color: var(--t1, #eeeef5); font-weight: 600; }
.dmp-ai-fine { font-size: 11px; line-height: 1.5; color: var(--t3); }
.dmp-ai-mark { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex-shrink: 0;
  color: color-mix(in oklab, var(--pt-acc) 35%, #e6e6f2); background: color-mix(in oklab, var(--pt-acc) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--pt-acc) 24%, transparent); }
.dmp-ai-hd { display: flex; align-items: center; gap: 12px; }
.dmp-ai-hd-n { font-size: 13.5px; font-weight: 600; letter-spacing: -0.01em; color: var(--t1, #eeeef5); }
.dmp-ai-hd-s { font-size: 11.5px; color: var(--t3); margin-top: 1px; }
/* Empty direct chat: the encryption note, centred and quiet */
.dmc-empty { position: absolute; left: 0; right: 0; top: 44px; bottom: 0; z-index: 1; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px;
  padding: 0 24px 60px; text-align: center; animation: dmc-empty-in 420ms cubic-bezier(0.16,1,0.3,1) both; }
.dmc-empty-mark { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; margin-bottom: 3px;
  color: rgba(186,190,214,0.5); background: rgba(255,255,255,0.025);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }
.dmc-empty-t { font-size: 12px; font-weight: 550; letter-spacing: -0.005em; color: rgba(214,216,232,0.5); }
.dmc-empty-s { font-size: 11px; line-height: 1.45; color: rgba(160,164,184,0.36); max-width: 320px; }
@keyframes dmc-empty-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .dmc-empty { animation: none; } }
/* Direct-chat moment lines: the lock / agent glyph in front of the text */
.bc-sep-body .dmc-glyph { display: inline-flex; color: var(--ink); opacity: .8; }
.bc-sep[data-dm-act] .bc-sep-act:hover { color: var(--t1, #eeeef5); }
.dmci-e2e { display: flex; align-items: flex-start; gap: 11px; padding: 11px 12px; border-radius: 12px;
  background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); }
.dmp-pw { position: relative; }
.dmp-field-pw { padding-right: 38px; font-family: inherit; letter-spacing: normal; }
.dmp-pw-eye { position: absolute; right: 4px; top: 3px; width: 28px; height: 28px; border: none; background: transparent; border-radius: 7px;
  display: grid; place-items: center; color: var(--t3); cursor: pointer; }
.dmp-pw-eye:hover { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.05); }

.dmc-retry { display: flex; justify-content: flex-end; margin: -2px 36px 10px 0; }
/* Guest pacing: a quiet line over the composer while sending is paused. */
.dmc-pace { display: flex; align-items: center; gap: 7px; margin: 0 12px; padding: 10px 2px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.045);
  font-size: 11px; line-height: 16px; letter-spacing: .005em; color: rgba(186,190,214,0.62);
  animation: dmc-empty-in 260ms cubic-bezier(0.16,1,0.3,1) both; }
.dmc-pace svg { flex-shrink: 0; opacity: .7; }
.dmc-pace-m { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dmc-pace-t { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; height: 18px; padding: 0 7px;
  border-radius: 999px; font-size: 10.5px; font-weight: 500; font-variant-numeric: tabular-nums;
  color: rgba(214,216,232,0.72); background: rgba(255,255,255,0.035); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }
.dmc-pace-t i { font-style: normal; font-weight: 400; color: rgba(160,164,184,0.55); }
.dmc-more { display: flex; justify-content: center; margin: 0 0 12px; }
`;
  document.head.appendChild(st);
};

const DmIco = ({d, s = 14, w = 1.9}) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const DM_I = {
  lock:   <><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><polyline points="9 12 11 14 15 10"/></>,
  key:    <><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2"/></>,
  x:      <path d="M18 6L6 18M6 6l12 12"/>,
  copy:   <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>,
  down:   <><path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/></>,
  warn:   <><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></>,
  info:   <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  ban:    <><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></>,
  trash:  <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></>,
  check:  <polyline points="20 6 9 17 4 12"/>,
};

const bcCopy = async (text, done = 'Copied') => {
  try { await navigator.clipboard.writeText(text); bcToast(done, 'ok'); }
  catch (_) { try { window.prompt('Copy this', text); } catch (__) {} }
};

// Shared frame: scrim + glass window, Esc and outside-click close, with
// the same out-animation the settings windows use.
const DmPopup = ({title, onClose, children, label, compact = false}) => {
  ensureDmStyles();
  const [out, setOut] = React.useState(false);
  const ref = React.useRef(null);
  const close = React.useCallback(() => { setOut(true); setTimeout(() => onClose && onClose(), 150); }, [onClose]);
  React.useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', h, true);
    const t = setTimeout(() => { try { const f = ref.current && ref.current.querySelector('[data-autofocus]'); (f || ref.current).focus({preventScroll: true}); } catch (_) {} }, 40);
    return () => { window.removeEventListener('keydown', h, true); clearTimeout(t); };
  }, [close]);
  if (typeof document === 'undefined') return null;
  return ReactDOM.createPortal(
    <>
      <div className="dmp-scrim" onClick={close}/>
      <div ref={ref} className="dmp" data-out={out ? '1' : undefined} data-compact={compact ? '1' : undefined} role="dialog" aria-modal="true"
        aria-label={label || title} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="dmp-hd">
          <div className="dmp-hd-t">{title}</div>
          <button type="button" className="dmp-x" onClick={close} aria-label="Close"><DmIco d={DM_I.x} s={13} w={2.1}/></button>
        </div>
        <div className="dmp-bd">{typeof children === 'function' ? children(close) : children}</div>
      </div>
    </>,
    document.body
  );
};

// ── Password: opens messages in a browser that doesn't have them yet ──
// Only needed when this browser lost its message key (storage cleared
// while still signed in) or the keys were locked with a password it
// hasn't seen. Everyone else gets their messages just by signing in.
const DmPasswordPopup = ({onClose}) => {
  useDm();
  const [pw, setPw] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const closeRef = React.useRef(null);
  const sync = DM_KEYS.state === 'ready' && DM_KEYS.needsSync;
  const go = async () => {
    if (!pw || busy) return;
    setBusy(true); setErr('');
    try {
      await DM_KEYS.unlockWithPassword(pw);
      bcToast(sync ? 'Messages are now available on all your devices' : 'Your messages are ready', 'ok');
      closeRef.current && closeRef.current();
    } catch (e) { setErr(String(e && e.message || e)); }
    finally { setBusy(false); }
  };
  return (
    <DmPopup title="Confirm your password" onClose={onClose}>
      {(close) => { closeRef.current = close; return (
        <>
          <div className="dmp-p">
            {sync
              ? 'Your messages are protected with your account password. Confirm it once so they’re also available when you sign in on other devices.'
              : 'Your messages are protected with your account password. Confirm it once to open them in this browser.'}
          </div>
          <div className="dmp-pw">
            <input className="dmp-field dmp-field-pw" data-autofocus type={show ? 'text' : 'password'} autoComplete="current-password"
              placeholder="Password" aria-label="Password" value={pw}
              onChange={e => { setPw(e.target.value); if (err) setErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') go(); }}/>
            <button type="button" className="dmp-pw-eye" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
              <DmIco d={show ? <><path d="M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18.4 18.4 0 0 1 5-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2"/><path d="M1 1l22 22"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>} s={14}/>
            </button>
          </div>
          {err && <div className="dmp-note" data-tone="err">{err}</div>}
          <button type="button" className="dmp-btn" data-v="primary" disabled={!pw || busy} onClick={go}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </>
      ); }}
    </DmPopup>
  );
};

// The one popup a message-state action should open.
const DmAccessPopup = ({onClose}) => <DmPasswordPopup onClose={onClose}/>;
// Does this browser need something from the person before messages work?
// (A guest has no password yet: its keys are backed up when it creates an
// account, so there is nothing to ask for until then.)
const dmNeedsAttention = () => !(typeof bcIsGuest === 'function' && bcIsGuest()) && (DM_KEYS.state === 'password'
  || (DM_KEYS.state === 'ready' && DM_KEYS.needsSync));

// ── GUEST CHAT: create an account / end the session ──────────────────
// A guest (see GUEST in bot-stores.jsx) can turn its chat into a full
// account at any time — same account, so the conversation, its keys and
// any purchases stay — or end the session on this device. Both open from
// anywhere with a window event, so the contact list card, the profile
// line and the in-chat notice all share one pair of windows:
//   window.dispatchEvent(new CustomEvent('bc-guest-claim'))
//   window.dispatchEvent(new CustomEvent('bc-guest-leave'))
const ensureGuestStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-guest-style')) return;
  const st = document.createElement('style');
  st.id = 'bc-guest-style';
  st.textContent = `
.gcl-sub { margin-top: -10px; font-size: 12px; line-height: 1.4; color: var(--t3, #8a8aa8); }
.gcl-form { display: flex; flex-direction: column; gap: 14px; margin-top: 6px; }
.gcl-f { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.gcl-lb { font-size: 10px; font-weight: 600; line-height: 1; letter-spacing: .08em; text-transform: uppercase;
  color: rgba(200,202,222,.5); padding-left: 1px; }
.gcl-box { position: relative; display: block; }
.dmp .gcl-in { height: 36px; padding: 0 12px; font-family: inherit; font-size: 12.5px; font-weight: 500; line-height: 1; letter-spacing: normal; }
.dmp .gcl-in::placeholder { color: rgba(160,164,184,.42); font-weight: 400; }
.dmp .gcl-in.dmp-field-pw { padding-right: 40px; }
.gcl-f .dmp-pw-eye { top: 4px; right: 4px; }
/* @ in front of the username, set tight against it. */
.gcl-at { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 12.5px; font-weight: 500;
  line-height: 1; color: var(--t4, #7a7a9c); pointer-events: none; }
.dmp .gcl-in[data-at="1"] { padding-left: 24px; }
.dmp .gcl-in[data-st="1"] { padding-right: 34px; }
.gcl-f[data-bad="1"] .gcl-in { border-color: rgba(255,120,110,.4); }
.gcl-f[data-bad="1"] .gcl-lb { color: rgba(236,150,140,.8); }
/* Username status: one symbol, centred in the field's right end. Held by
   top/bottom rather than a transform, so its fade-in can't move it. */
.gcl-st { position: absolute; top: 0; bottom: 0; right: 0; width: 34px;
  display: flex; align-items: center; justify-content: center; pointer-events: none;
  color: var(--t4, #7a7a9c); animation: gcl-fade 160ms ease both; }
.gcl-st svg { display: block; flex-shrink: 0; }
@keyframes gcl-fade { from { opacity: 0; } to { opacity: 1; } }
.gcl-st[data-tone="ok"] { color: rgba(128,204,164,.85); }
.gcl-st[data-tone="bad"] { color: rgba(236,150,140,.88); }
.gcl-spin { display: block; width: 10px; height: 10px; box-sizing: border-box; flex-shrink: 0; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.14);
  border-top-color: rgba(214,216,232,.6); animation: gcl-rot .7s linear infinite; }
@keyframes gcl-rot { to { transform: rotate(360deg); } }
.gcl-hint { margin-top: -1px; padding-left: 1px; font-size: 11px; line-height: 1.3; color: var(--t3, #8a8aa8); }
.gcl-hint button { all: unset; cursor: pointer; color: color-mix(in oklab, var(--pt-acc) 45%, #cfd0e2); font-weight: 600; border-radius: 3px; }
.gcl-hint button:hover { color: var(--t1, #eeeef5); }
.gcl-hint button:focus-visible { box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--pt-acc) 55%, transparent); }
.gcl-meter { display: flex; align-items: center; gap: 10px; height: 12px; font-size: 10.5px; color: var(--t3); }
.gcl-meter span:first-child { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.gcl-meter i { height: 2px; border-radius: 2px; background: rgba(255,255,255,.07); transition: background .25s; }
.gcl-meter span:last-child { min-width: 46px; text-align: right; }
.gcl-meter[data-s="1"] i:nth-child(-n+1) { background: rgb(236,128,122); }
.gcl-meter[data-s="2"] i:nth-child(-n+2) { background: rgb(230,170,90); }
.gcl-meter[data-s="3"] i:nth-child(-n+3) { background: color-mix(in oklab, var(--pt-acc) 70%, #9ab); }
.gcl-meter[data-s="4"] i { background: rgb(80,200,150); }
.gcl-go { margin-top: 6px; height: 36px; font-size: 12.5px; }
.gcl-fine { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: -4px;
  font-size: 11px; line-height: 1.4; color: var(--t4, #7a7a9c); text-align: center; }
.gcl-fine svg { flex-shrink: 0; opacity: .8; }
/* The Guest tag beside a name (the owner's side of a guest chat). */
.bc-guest-tag { display: inline-flex; align-items: center; flex-shrink: 0; height: 16px; padding: 0 6px; border-radius: 999px;
  font-size: 9.5px; font-weight: 600; letter-spacing: .04em; line-height: 1; color: rgba(200,204,226,.78);
  background: rgba(255,255,255,.05); box-shadow: inset 0 0 0 1px rgba(255,255,255,.09); }
`;
  document.head.appendChild(st);
};
const gclStrength = (p) => {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  if (p.length < 8) s = Math.min(s, 1);
  return Math.max(1, Math.min(4, s));
};
const GCL_STRENGTH = ['', 'Too weak', 'Fair', 'Good', 'Strong'];

const GuestClaimPopup = ({onClose}) => {
  ensureDmStyles();
  // The compact window size lives with the consent notice's styles.
  if (typeof ensureDmConsentStyles === 'function') ensureDmConsentStyles();
  ensureGuestStyles();
  const acc = (typeof AUTH_STORE !== 'undefined' && AUTH_STORE.account) || {};
  // The name they chatted under stays, unless it's the "Guest 4821"
  // placeholder: then the new username stands in for it.
  const keepName = /^Guest \d{4}$/.test(String(acc.display_name || '')) ? '' : String(acc.display_name || '').trim();
  const [email, setEmail] = React.useState('');
  const [user, setUser] = React.useState('');
  const [pw, setPw] = React.useState('');
  // Username: prefilled from the name they chatted under ("arnold"), or
  // the nearest free one ("arnold2"), then checked as they type.
  const userTouched = React.useRef(false);
  const [uState, setUState] = React.useState(null);   // null | { tone, text, suggestion }
  React.useEffect(() => {
    if (!keepName) return undefined;
    let dead = false;
    apiFetch('auth_name_check', { kind: 'username', from: keepName }).then(r => {
      if (dead || userTouched.current || !r || !r.suggestion) return;
      setUser(r.suggestion);
    }).catch(() => {});
    return () => { dead = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const u = user.trim();
    if (!u) { setUState(null); return undefined; }
    if (u.length < 3) { setUState({ tone: '', text: 'Too short' }); return undefined; }
    if (!/^[A-Za-z0-9_.\-]+$/.test(u)) { setUState({ tone: 'bad', text: 'Invalid' }); return undefined; }
    let dead = false;
    setUState({ tone: '', text: 'Checking', checking: true });
    const t = setTimeout(() => {
      apiFetch('auth_name_check', { kind: 'username', value: u }).then(r => {
        if (dead || !r || r.error) return;
        setUState(r.available ? { tone: 'ok', text: 'Available' }
          : { tone: 'bad', text: /reserved/i.test(r.reason || '') ? 'Reserved' : 'Taken', suggestion: r.suggestion || '' });
      }).catch(() => { if (!dead) setUState(null); });
    }, 350);
    return () => { dead = true; clearTimeout(t); };
  }, [user]);
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [bad, setBad] = React.useState({});
  const strength = gclStrength(pw);
  // The symbol inside the username field: a spinner, a check or a cross.
  const uIcon = !!(uState && (uState.checking || uState.tone === 'ok' || uState.tone === 'bad'));
  const clear = (k) => { if (bad[k]) setBad(x => ({...x, [k]: false})); if (err) setErr(''); };
  const go = async () => {
    if (busy) return;
    const f = { email: email.trim(), username: user.trim().replace(/^@/, '') };
    f.display_name = keepName || f.username;
    const b = {
      email: !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email),
      user: f.username.length < 3 || !/^[A-Za-z0-9_.\-]+$/.test(f.username),
      pw: pw.length < 8,
    };
    if (uState && uState.tone === 'bad') b.user = true;
    if (b.email || b.user || b.pw) {
      setBad(b);
      setErr(b.email ? 'Enter a valid email address.'
        : b.user ? (uState && uState.tone === 'bad' && uState.text !== 'Invalid' ? 'That username isn’t available.' : 'Usernames are 3+ letters, numbers, _ . or -')
        : 'Use at least 8 characters for your password.');
      return;
    }
    setBusy(true); setErr(''); setBad({});
    try {
      const account = await GUEST.claim(f, pw);
      try { window.bcBoot && window.bcBoot.show('Setting up your workspace…'); } catch (_) {}
      onClose && onClose();
      AUTH_STORE.set(account);
      bcToast('Account created — your conversation is saved', 'ok');
    } catch (e) {
      const m = String(e && e.message || e);
      setErr(m);
      setBad({ email: /email/i.test(m), user: /username/i.test(m), pw: /password/i.test(m) });
      setBusy(false);
    }
  };
  const onKey = (e) => { if (e.key === 'Enter') go(); };
  const eye = show
    ? <><path d="M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18.4 18.4 0 0 1 5-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2"/><path d="M1 1l22 22"/></>
    : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>;
  return (
    <DmPopup title="Create your account" onClose={onClose} compact>
      {() => (
        <>
          <div className="gcl-sub">Keep this chat on any device.</div>
          <div className="gcl-form">
            <label className="gcl-f" data-bad={bad.email ? '1' : undefined}>
              <span className="gcl-lb">Email</span>
              <input className="dmp-field gcl-in" data-autofocus type="email" value={email}
                onChange={e => { setEmail(e.target.value); clear('email'); }} onKeyDown={onKey}
                placeholder="you@example.com" autoComplete="email" autoCapitalize="off" spellCheck={false} disabled={busy}/>
            </label>
            <div className="gcl-f" data-bad={bad.user ? '1' : undefined}>
              <label className="gcl-lb" htmlFor="gcl-user">Username</label>
              <span className="gcl-box">
                <span className="gcl-at" aria-hidden="true">@</span>
                <input id="gcl-user" className="dmp-field gcl-in" data-at="1" data-st={uIcon ? '1' : undefined} value={user}
                  onChange={e => { userTouched.current = true; setUser(e.target.value.replace(/^@/, '')); clear('user'); }} onKeyDown={onKey}
                  placeholder="yourname" autoComplete="username" autoCapitalize="off" spellCheck={false} maxLength={60} disabled={busy}/>
                {uIcon && (
                  <span className="gcl-st" data-tone={uState.tone || undefined} role="status" aria-label={uState.text} title={uState.text}>
                    {uState.checking ? <i className="gcl-spin" aria-hidden="true"/>
                      : uState.tone === 'ok' ? <DmIco d={DM_I.check} s={13} w={2.4}/>
                      : uState.tone === 'bad' ? <DmIco d={DM_I.x} s={12} w={2.4}/> : null}
                  </span>
                )}
              </span>
              {/* Why it's not available (the field shows only a symbol). */}
              {uState && uState.tone === 'bad' ? (
                <span className="gcl-hint">
                  {uState.text === 'Invalid' ? 'Use letters, numbers, _ . or - only.'
                    : uState.text === 'Reserved' ? 'That username is reserved.'
                    : 'That username is taken.'}
                  {uState.suggestion ? <> Try <button type="button" onClick={() => { userTouched.current = true; setUser(uState.suggestion); clear('user'); }}>@{uState.suggestion}</button></> : null}
                </span>
              ) : null}
            </div>
            <label className="gcl-f" data-bad={bad.pw ? '1' : undefined}>
              <span className="gcl-lb">Password</span>
              <span className="dmp-pw">
                <input className="dmp-field dmp-field-pw gcl-in" type={show ? 'text' : 'password'} value={pw}
                  onChange={e => { setPw(e.target.value); clear('pw'); }} onKeyDown={onKey}
                  placeholder="8+ characters" autoComplete="new-password" disabled={busy}/>
                <button type="button" className="dmp-pw-eye" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
                  <DmIco d={eye} s={14}/>
                </button>
              </span>
              {pw && (
                <span className="gcl-meter" data-s={strength}>
                  <span aria-hidden="true"><i/><i/><i/><i/></span>
                  <span aria-live="polite">{GCL_STRENGTH[strength]}</span>
                </span>
              )}
            </label>
          </div>
          {err && <div className="dmp-note" data-tone="err" role="alert">{err}</div>}
          <button type="button" className="dmp-btn gcl-go" data-v="primary" disabled={busy} onClick={go}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
          <div className="gcl-fine">
            <DmIco d={DM_I.lock} s={10} w={2.2}/>
            <span>Your password also unlocks your messages</span>
          </div>
        </>
      )}
    </DmPopup>
  );
};

const GuestLeavePopup = ({onClose, onClaim}) => {
  ensureDmStyles();
  if (typeof ensureDmConsentStyles === 'function') ensureDmConsentStyles();
  const [busy, setBusy] = React.useState(false);
  const leave = async () => {
    if (busy) return;
    setBusy(true);
    try { await GUEST.leave(); } catch (_) { setBusy(false); }
  };
  return (
    <DmPopup title="End guest session?" onClose={onClose} compact>
      {(close) => (
        <>
          <div className="dmp-p">You’ll lose access to this conversation on this device. To keep it, create an account first — it only takes a moment.</div>
          <div className="dmp-row">
            <button type="button" className="dmp-btn" data-v="danger" disabled={busy} onClick={leave}>
              {busy ? 'Ending…' : 'End session'}
            </button>
            <button type="button" className="dmp-btn" data-v="primary" data-grow="1" disabled={busy} onClick={() => { close(); onClaim && setTimeout(onClaim, 160); }}>
              Create account
            </button>
          </div>
        </>
      )}
    </DmPopup>
  );
};

// Mounted once (by the message list): opens the two windows on request.
const GuestPromptsHost = () => {
  const [open, setOpen] = React.useState(null);   // 'claim' | 'leave' | null
  React.useEffect(() => {
    const c = () => setOpen('claim');
    const l = () => setOpen('leave');
    window.addEventListener('bc-guest-claim', c);
    window.addEventListener('bc-guest-leave', l);
    return () => { window.removeEventListener('bc-guest-claim', c); window.removeEventListener('bc-guest-leave', l); };
  }, []);
  if (!(typeof bcIsGuest === 'function' && bcIsGuest())) return null;
  if (open === 'claim') return <GuestClaimPopup onClose={() => setOpen(null)}/>;
  if (open === 'leave') return <GuestLeavePopup onClose={() => setOpen(null)} onClaim={() => setOpen('claim')}/>;
  return null;
};

// ── Agent approval ─────────────────────────────────────────────────
// Shown the first time an agent is put on a chat (scope 'chat'), before
// "Answer new chats" is turned on (scope 'all') and before offline replies
// (scope 'offline'). A short confirmation in the settings windows' own
// language: one line on what happens, one grouped row on who can read
// what, and the buttons. Nothing else.
const ensureDmConsentStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-dmq-style')) return;
  const st = document.createElement('style');
  st.id = 'bc-dmq-style';
  st.textContent = `
.dmp[data-compact="1"] { width: min(372px, calc(100vw - 32px)); border-radius: 16px; }
.dmp[data-compact="1"] .dmp-hd { padding: 13px 10px 0 16px; }
.dmp[data-compact="1"] .dmp-hd-t { font-size: 13px; font-weight: 600; }
.dmp[data-compact="1"] .dmp-bd { padding: 10px 16px 16px; gap: 12px; }
.dmq-id { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dmq-mark { width: 30px; height: 30px; flex: 0 0 auto; border-radius: 9px; display: grid; place-items: center;
  color: color-mix(in oklab, var(--acc, #6c63ff) 45%, #eeeef5);
  background: color-mix(in oklab, var(--acc, #6c63ff) 13%, transparent);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--acc, #6c63ff) 32%, transparent); }
.dmq-id-txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dmq-id-n { font-size: 12.5px; font-weight: 600; letter-spacing: -0.008em; color: var(--t1, #eeeef5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dmq-id-s { font-size: 11px; color: rgba(160,164,184,0.66); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dmq-lead { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(200,203,222,0.82); }
.dmq-lead b { font-weight: 600; color: var(--t1, #eeeef5); }
.dmq-group { border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.035);
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); }
.dmq-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; }
.dmq-row + .dmq-row { background-image: linear-gradient(rgba(255,255,255,0.055), rgba(255,255,255,0.055));
  background-size: calc(100% - 12px) 1px; background-position: 12px 0; background-repeat: no-repeat; }
.dmq-row-ico { flex: 0 0 auto; margin-top: 1px; color: rgba(172,176,198,0.72); }
.dmq-row-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dmq-row-t { font-size: 12px; font-weight: 500; letter-spacing: -0.006em; color: var(--t1, #eeeef5); }
.dmq-row-s { font-size: 11px; line-height: 1.45; color: rgba(160,164,184,0.7); }
.dmq-foot { display: flex; justify-content: flex-end; gap: 8px; }
.dmq-btn { height: 30px; padding: 0 14px; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 550; cursor: pointer;
  color: rgba(214,216,232,0.9); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
.dmq-btn:hover:not(:disabled) { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.13); }
.dmq-btn[data-v="primary"] { color: #fff; background: color-mix(in oklab, var(--acc, #6c63ff) 88%, #15162a);
  border-color: color-mix(in oklab, var(--acc, #6c63ff) 70%, #fff 12%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
.dmq-btn[data-v="primary"]:hover:not(:disabled) { background: color-mix(in oklab, var(--acc, #6c63ff) 96%, #fff 4%); }
.dmq-btn:disabled { opacity: 0.45; cursor: default; }
.dmq-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 40%, transparent); }
.dmq-note { font-size: 11px; line-height: 1.45; padding: 0 2px; color: rgb(236,190,120); }
.dmq-note[data-tone="err"] { color: rgb(240,150,144); }
`;
  document.head.appendChild(st);
};

// The shared body: who, one line, the rows, the buttons.
const DmConsentBody = ({close, mark, name, sub, lead, rows, warn, confirmLabel, disabled, onConfirm}) => {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  return (
    <>
      <div className="dmq-id">
        <span className="dmq-mark">{mark}</span>
        <span className="dmq-id-txt">
          <span className="dmq-id-n">{name}</span>
          {sub && <span className="dmq-id-s">{sub}</span>}
        </span>
      </div>
      <p className="dmq-lead">{lead}</p>
      <div className="dmq-group">
        {rows.map((r, i) => (
          <div key={i} className="dmq-row">
            <span className="dmq-row-ico"><DmIco d={r.icon} s={13}/></span>
            <span className="dmq-row-txt">
              <span className="dmq-row-t">{r.t}</span>
              {r.s && <span className="dmq-row-s">{r.s}</span>}
            </span>
          </div>
        ))}
      </div>
      {warn && <div className="dmq-note">{warn}</div>}
      {err && <div className="dmq-note" data-tone="err">{err}</div>}
      <div className="dmq-foot">
        <button type="button" className="dmq-btn" onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className="dmq-btn" data-v="primary" data-autofocus disabled={busy || disabled}
          onClick={async () => {
            setBusy(true); setErr('');
            try { await onConfirm(); close(); }
            catch (e) { setErr(String((e && e.message) || e)); }
            finally { setBusy(false); }
          }}>
          {busy ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </>
  );
};

const DmAiConsentPopup = ({agent, llm, scope = 'chat', peerName, onConfirm, onClose}) => {
  ensureDmConsentStyles();
  if (scope === 'offline') return <DmOfflineConsentPopup onConfirm={onConfirm} onClose={onClose}/>;
  const name = (agent && agent.name) || 'This agent';
  const company = (llm && llm.company) || 'Your AI provider';
  const model = (llm && llm.model) || (agent && typeof modelLabel === 'function' ? modelLabel(agent.model) : '');
  const ready = !llm || llm.ready !== false;
  const all = scope === 'all';
  return (
    <DmPopup compact title={all ? 'Answer new chats' : 'Assign an agent'} onClose={onClose}
      label={all ? `Answer new chats with ${name}` : `Let ${name} answer ${peerName || 'this chat'}`}>
      {(close) => (
        <DmConsentBody close={close}
          mark={<AgentMark size={15}/>} name={name} sub={[model, llm && llm.company].filter(Boolean).join(' · ')}
          lead={all
            ? <>Replies to people who message you from your profile link.</>
            : <>Replies to <b>{peerName || 'this person'}</b> for you.</>}
          rows={[{
            icon: DM_I.shield,
            t: `${company} can read ${all ? 'the chats it answers' : 'this chat'}`,
            s: `Messages are sent to ${llm && llm.company ? llm.company : 'it'} to write replies. BotCommand keeps a copy until you remove the agent or delete the chat.`,
          }]}
          warn={!ready ? 'Add an AI key in Settings first.' : ''}
          disabled={!ready}
          confirmLabel={all ? 'Turn on' : 'Assign'}
          onConfirm={onConfirm}/>
      )}
    </DmPopup>
  );
};

// Offline replies: the one setting that lets the server read some
// messages, so it says which ones and for how long.
const DmOfflineConsentPopup = ({onConfirm, onClose}) => {
  ensureDmConsentStyles();
  return (
    <DmPopup compact title="Reply while you’re offline" onClose={onClose}>
      {(close) => (
        <DmConsentBody close={close}
          mark={<AgentMark size={15}/>} name="Offline replies" sub="Profile DMs"
          lead={<>Your agents keep answering profile DMs with every browser closed.</>}
          rows={[
            { icon: DM_I.shield, t: 'BotCommand’s server can read them',
              s: 'Only messages to chats with an agent, while you’re away. Its copies are deleted within 24 hours, and all of them when you turn this off.' },
            { icon: DM_I.info, t: 'Telegram and Discord aren’t included',
              s: 'They reply while the desktop app is open.' },
          ]}
          confirmLabel="Turn on"
          onConfirm={onConfirm}/>
      )}
    </DmPopup>
  );
};

// A moment line in the direct-chat thread — the same hairline, dot and
// wording style every other chat uses between bubbles (.bc-sep).
const DM_INK = {
  lock:  'rgba(170,164,225,0.95)',
  agent: 'rgba(141,180,210,0.95)',
  warn:  'rgba(224,176,110,0.95)',
  muted: 'rgba(150,170,195,0.9)',
};
const DmSep = ({ink = DM_INK.muted, meta, label, act, onAct, onClick, title, glyph}) => {
  if (typeof ensureMomentStyles === 'function') ensureMomentStyles();
  return (
    <div className="bc-seps">
      <div className="bc-sep" style={{'--ink': ink}} data-dm-act={act ? '1' : undefined}>
        <span className="bc-sep-rule l" aria-hidden="true"/>
        <div className="bc-sep-body" title={title} data-click={onClick ? '1' : undefined}
          role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
          onClick={onClick || undefined}
          onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}>
          {glyph ? <span className="dmc-glyph" aria-hidden="true">{glyph}</span> : <i className="bc-sep-dot" aria-hidden="true"/>}
          {meta && <span className="bc-sep-meta">{meta}</span>}
          {label && <span className="bc-sep-label">{label}</span>}
        </div>
        {act && <button type="button" className="bc-sep-act" onClick={onAct}><span>{act}</span></button>}
        <span className="bc-sep-rule r" aria-hidden="true"/>
      </div>
    </div>
  );
};

// ── SPAM COOLDOWN LINE ─────────────────────────────────────────────────
// While the agent's spam protection has a chat on hold, a quiet separator
// at the end of it counts down to when the agent answers again. Hover says
// why it was flagged. It goes by itself when the countdown ends (or when
// the cooldown is lifted — writing to them yourself does that).
const bcFmtLeft = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const SpamCooldownSep = ({until, reason, hits}) => {
  const [, tick] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    if (!(until > Date.now())) return;
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [until]);
  const left = until ? Math.ceil((until - Date.now()) / 1000) : 0;
  if (left <= 0) return null;
  const why = String(reason || '').trim();
  const title = [
    'The agent flagged this chat as spam' + (why ? ': ' + why : '.'),
    hits > 1 ? `Cooldown #${hits} — each one runs twice as long as the last.` : '',
    'The agent stays quiet until it ends. Writing to them yourself ends it now.',
  ].filter(Boolean).join('\n');
  return (
    <DmSep ink={DM_INK.muted} title={title}
      glyph={<DmIco d={<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v4l2.5 1.5"/></>} s={10} w={2.2}/>}
      meta="Spam cooldown"
      label={<>agent resumes in <span style={{fontVariantNumeric:'tabular-nums', color:'var(--t2)'}}>{bcFmtLeft(left)}</span></>}/>
  );
};
// Platform chats keep their cooldown in SPAM_THROTTLE (bot-stores.jsx).
const PlatformSpamSep = ({convId}) => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    if (typeof SPAM_THROTTLE === 'undefined') return undefined;
    return SPAM_THROTTLE.sub((id) => { if (!id || id === convId) force(); });
  }, [convId]);
  if (typeof SPAM_THROTTLE === 'undefined' || !convId) return null;
  const st = SPAM_THROTTLE.state.get(convId);
  if (!st || !(st.until > Date.now())) return null;
  return <SpamCooldownSep until={st.until} reason={st.lastReason} hits={st.hits}/>;
};

// Three small dots for the "is typing" line, in the separator's own ink.
// Opacity and a 1px lift only, so it runs on the compositor.
const ensureDmTypingStyles = (() => {
  let done = false;
  return () => {
    if (done || typeof document === 'undefined') return;
    done = true;
    const st = document.createElement('style');
    st.setAttribute('data-bc', 'dm-typing');
    st.textContent = `
.dmc-typ { display: inline-flex; align-items: center; gap: 2.5px; height: 8px; margin-right: 1px; }
.dmc-typ i { width: 3.5px; height: 3.5px; border-radius: 50%; background: currentColor; opacity: .35;
  animation: dmc-typ 1.25s ease-in-out infinite; }
.dmc-typ i:nth-child(2) { animation-delay: .16s; }
.dmc-typ i:nth-child(3) { animation-delay: .32s; }
@keyframes dmc-typ { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: .95; transform: translateY(-1px); } }
@media (prefers-reduced-motion: reduce) { .dmc-typ i { animation: none; opacity: .7; } }`;
    document.head.appendChild(st);
  };
})();
const DmTypingDots = () => {
  ensureDmTypingStyles();
  return <span className="dmc-typ" aria-hidden="true"><i/><i/><i/></span>;
};

// ── Chat info: who, one line on privacy, block, delete ──
// Stable stand-in for a chat no agent has worked yet (no moments to place).
const DM_NO_MOMENT_ROWS = [];
const DirectChatView = ({msg, onClose, onBack, backTarget, chatWidth}) => {
  useDm();
  useDmAi();
  ensureDmStyles();
  ensureComposerStyles();
  ensureMsgLifecycleStyles();
  const agents = useAgents();
  const tid = msg.threadId;
  const cid = DM_AI.convId(tid);
  const th = DM_STORE.threads.get(tid);
  const [hasText, setHasText] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [pop, setPop] = React.useState(null);        // 'info' | 'access' | null
  const [consent, setConsent] = React.useState(null); // { agent, llm } while the approval notice is open
  const [loadErr, setLoadErr] = React.useState('');
  const openedAtRef = React.useRef(Date.now());
  const threadRef = React.useRef(null);
  const taRef = React.useRef(null);

  // ── ATTACHMENTS ── the paperclip, drag-and-drop and paste, as in every
  // other chat. Queued per chat (ATTACH_DRAFTS), so switching away keeps
  // them. Each keeps its File: it's encrypted and uploaded when sent (see
  // DM_FILES in bot-stores.jsx).
  const [atts, setAtts] = React.useState(() => ATTACH_DRAFTS.get(cid) || []);
  const [attBusy, setAttBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef(null);
  const dragDepthRef = React.useRef(0);   // dragenter/leave fire per child crossed
  React.useEffect(() => { setAtts(ATTACH_DRAFTS.get(cid) || []); setDragOver(false); dragDepthRef.current = 0; }, [cid]);
  const putAtts = (next) => {
    if (next && next.length) ATTACH_DRAFTS.set(cid, next);
    else ATTACH_DRAFTS.delete(cid);
    setAtts(next || []);
  };
  const removeAtt = (id) => putAtts((ATTACH_DRAFTS.get(cid) || []).filter(a => a.id !== id));
  const pinnedRef = React.useRef(true);
  const glideUntilRef = React.useRef(0);    // our own smooth scroll is travelling
  const userScrollAtRef = React.useRef(0);  // the wheel / touch / keys moved it
  const enterRef = React.useRef({ tid: 0, ready: false, seen: new Map() });
  useBubbleShaper(threadRef, 'dm:' + tid);

  React.useEffect(() => {
    DM_STORE.setActive(tid);
    setLoadErr('');
    DM_STORE.loadThread(tid).catch(e => setLoadErr(String(e && e.message || e)));
    openedAtRef.current = Date.now();
    pinnedRef.current = true;
    return () => { if (DM_STORE.active === tid) DM_STORE.setActive(0); DM_STORE.acceptKey(tid); };
  }, [tid]);

  const rows = th ? th.msgs : [];
  // Files sent in this chat are fetched and decrypted when it shows them.
  React.useEffect(() => {
    rows.forEach(m => { if (m && m.dmf && m.mp) DM_FILES.load(m.dmf); });
  });
  // ── Which bubbles animate in ──
  // Decided once per message and never changed, as in every other chat:
  // what's already here when the chat opens (and history loaded above it)
  // just sits there; a message that arrives or is sent while it's open
  // rises in. Going by message ids rather than timestamps means a server
  // clock a few seconds off can't stop a bubble from animating, or cut
  // its entrance short when the sent copy comes back stamped by the
  // server.
  const ent = enterRef.current;
  if (ent.tid !== tid) { ent.tid = tid; ent.ready = false; ent.seen = new Map(); }
  let lastKnown = -1;
  for (let i = 0; i < rows.length; i++) if (ent.seen.has(rows[i].id)) lastKnown = i;
  const enterOf = rows.map((m, i) => {
    if (ent.seen.has(m.id)) return ent.seen.get(m.id);
    const v = (ent.ready && i > lastKnown) ? (m.r === 'in' ? 'in' : 'out') : null;
    ent.seen.set(m.id, v);
    return v;
  });
  if (th && th.loaded) ent.ready = true;
  const blocker = th ? DM_STORE.sendBlocker(tid) : 'Loading…';
  // The other person typing (from the poll). Nothing notifies when the
  // window simply lapses, so the view checks again just after it does.
  const typingUntil = th ? (th.peerTypingUntil || 0) : 0;
  const peerTyping = !!th && !th.blocked && !th.blockedMe && typingUntil > Date.now();
  const [, setTypingTick] = React.useState(0);
  React.useEffect(() => {
    if (!(typingUntil > Date.now())) return;
    const t = setTimeout(() => setTypingTick(n => n + 1), typingUntil - Date.now() + 60);
    return () => clearTimeout(t);
  }, [typingUntil]);
  // Leaving the chat ends my own typing.
  React.useEffect(() => () => { try { DM_STORE.typing(tid, 0); } catch (_) {} }, [tid]);
  // A failed message's "retry" (in its bubble), and a message the guest
  // limits handed back: its text returns to the composer, ready to send
  // once the pause is over.
  React.useEffect(() => {
    const onRetry = (e) => {
      const uid = e && e.detail && e.detail.uid;
      const t = DM_STORE.threads.get(tid);
      if (uid && t && t.byUid.has(uid)) DM_STORE.retry(tid, uid);
    };
    const onRestore = (e) => {
      const d = (e && e.detail) || {};
      const ta = taRef.current;
      if (Number(d.tid) !== Number(tid) || !ta || !d.text) return;
      if (ta.value.trim()) return;             // never overwrite what they've started
      ta.value = d.text;
      ta.style.height = 'auto';
      ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
      setHasText(true);
    };
    window.addEventListener('bc-dm-retry', onRetry);
    window.addEventListener('bc-dm-restore', onRestore);
    return () => { window.removeEventListener('bc-dm-retry', onRetry); window.removeEventListener('bc-dm-restore', onRestore); };
  }, [tid]);
  const canSend = !blocker;
  // Guest pacing (see DM_STORE.paceOf): shown as a quiet line over the
  // composer, with the time left when the pause has an end.
  const pace = th ? DM_STORE.paceOf(tid) : null;
  const paceUntil = pace ? pace.until : 0;
  const [, setPaceTick] = React.useState(0);
  React.useEffect(() => {
    if (!paceUntil) return;
    const iv = setInterval(() => setPaceTick(n => n + 1), 1000);
    return () => clearInterval(iv);
  }, [paceUntil]);
  const paceLeft = paceUntil ? Math.max(0, Math.ceil((paceUntil - Date.now()) / 1000)) : 0;

  // ── AI draft — the same composer card every chat uses ──
  const liveDraft = useDraft(cid);
  useDraftTick(cid);
  const hasAiDraft = !!liveDraft;
  const [editText, setEditText] = React.useState('');
  React.useEffect(() => { if (liveDraft) setEditText(liveDraft.text); }, [liveDraft && liveDraft.text, liveDraft && liveDraft.chunkIndex, cid]);
  const remainingMs = liveDraft ? (liveDraft.paused ? liveDraft.pausedAtRemaining : Math.max(0, liveDraft.sendAt - Date.now())) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const pauseDraft  = () => { if (liveDraft && !liveDraft.paused) DRAFT_STORE.pause(cid); };
  const resumeDraft = () => { if (liveDraft && liveDraft.paused) DRAFT_STORE.resume(cid); };
  const discardDraft = () => { if (liveDraft) DRAFT_STORE.discard(cid); };
  const sendAI = () => { if (!liveDraft) return; DRAFT_STORE.setText(cid, editText); DRAFT_STORE.sendNow(cid); };

  // ── Agent for this chat ──
  const eff = DM_AI.effective(tid);
  const currentAgent = eff.agent;
  const aiStatus = DM_AI.status(tid);
  const [aiMenuOpen, setAiMenuOpen] = React.useState(false);
  const [aiMenuPos, setAiMenuPos] = React.useState(null);
  const aiMenuRef = React.useRef(null), aiTrigRef = React.useRef(null), aiMenuElRef = React.useRef(null);
  // The identity pill works exactly like every other chat's: hover shows
  // the AI summary under it, a click toggles it (touch), Esc closes it.
  // It used to open the contact list's right-click menu instead.
  const [summaryOpenRaw, setSummaryOpen] = React.useState(false);
  const summaryTimerRef = React.useRef(null);
  const idAvatarRef = React.useRef(null);
  const summaryShow = React.useCallback(() => {
    clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = setTimeout(() => setSummaryOpen(true), 260);
  }, []);
  const summaryKeep = React.useCallback(() => clearTimeout(summaryTimerRef.current), []);
  const summaryHide = React.useCallback(() => {
    clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = setTimeout(() => setSummaryOpen(false), 140);
  }, []);
  React.useEffect(() => () => clearTimeout(summaryTimerRef.current), []);
  React.useEffect(() => {
    if (!summaryOpenRaw) return;
    const onKey = (e) => { if (e.key === 'Escape') setSummaryOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [summaryOpenRaw]);
  React.useEffect(() => { clearTimeout(summaryTimerRef.current); setSummaryOpen(false); }, [tid]);
  React.useLayoutEffect(() => {
    if (!aiMenuOpen) return;
    const place = () => {
      const el = aiTrigRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const W = 224;
      setAiMenuPos({ top: Math.round(r.bottom + 6), left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - W - 8))), width: W });
    };
    place();
    const on = () => place();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    const close = (e) => {
      if (aiMenuElRef.current && aiMenuElRef.current.contains(e.target)) return;
      if (aiTrigRef.current && aiTrigRef.current.contains(e.target)) return;
      setAiMenuOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setAiMenuOpen(false); };
    const t = setTimeout(() => document.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('scroll', on, true);
      window.removeEventListener('resize', on);
      window.removeEventListener('keydown', esc);
      clearTimeout(t);
      document.removeEventListener('mousedown', close);
    };
  }, [aiMenuOpen]);
  React.useEffect(() => { setAiMenuOpen(false); setConsent(null); }, [tid]);

  // ── Moments — the same separators every other chat draws ──
  // Interests, notes, chapters, payments, open invoices, hand-overs and
  // "AI unassigned". They're kept against the chat's sales-side id
  // ('dm_<thread>_<account>', see DM_AI.shopConvId), which exists once an
  // agent has worked this chat.
  const shopCid = DM_AI.shopConvId(tid);
  const hold = (typeof DM_AI.holdOf === 'function') ? DM_AI.holdOf(tid) : null;
  const hasShopInvoices = (() => { try { return invoicesForConv(shopCid).length > 0; } catch (_) { return false; } })();
  const momentsOn = !!(currentAgent || hold || hasShopInvoices || rows.some(m => m && m.r === 'bot'));
  const { data: euRecord } = useEndUserRecord(momentsOn ? shopCid : null);
  // Server message ids the moments are anchored to, by direct-message id.
  const dmIds = (euRecord && euRecord.dm_ids) || null;
  const rowsSig = rows.length + ':' + rows.map(m => (m.sid || m.uid) + (m.locked ? 'L' : '')).join(',');
  const mThread = React.useMemo(() => rows.map(m => {
    const sid = Number(m.sid) || 0;
    return {
      id: sid && dmIds ? (Number(dmIds[sid]) || 0) : 0,
      // Server time for stored messages; a message still being sent is
      // stamped by this browser (euServerTime corrects it).
      ts: sid && m.raw && m.raw.ts ? Number(m.raw.ts) * 1000 : (Date.parse(m.ts) || 0),
      _local: !sid,
      r: m.r === 'in' ? 'in' : (m.r === 'bot' ? 'bot' : 'out'),
      c: m.locked ? '' : String(m.src || m.c || ''),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rowsSig, dmIds]);
  const dmAgent = euRecord && euRecord.dm_agent ? euRecord.dm_agent : null;
  // The header pill's AI summary: only once an agent has written one.
  const hasSummary = !!String((euRecord && euRecord.summary) || '').trim();
  const summaryOpen = summaryOpenRaw && hasSummary;
  const momentConv = React.useMemo(() => ({
    id: shopCid,
    agent_id: currentAgent ? Number(currentAgent.id) : 0,
    unassignReason: !currentAgent && dmAgent ? String(dmAgent.unassign_reason || '') : '',
    unassignAt: !currentAgent && dmAgent ? (Number(dmAgent.unassigned_at_ms) || 0) : 0,
  }), [shopCid, currentAgent && currentAgent.id, dmAgent && dmAgent.unassign_reason, dmAgent && dmAgent.unassigned_at_ms]);
  const momentsBusy = aiStatus.phase === 'reading' || aiStatus.phase === 'writing' || aiStatus.phase === 'draft' || hasAiDraft;
  const { map: momentRows, fresh: freshMoments, followers: invoiceFollowers } =
    useChatMoments(shopCid, momentsOn ? mThread : DM_NO_MOMENT_ROWS, euRecord, openedAtRef.current, momentConv,
      { hydrated: !!(th && th.loaded), busy: momentsBusy });
  const momentRowAt = (b) => {
    const row = momentRows.get(b);
    return row ? <ChatMomentRow key={row.key} row={row} fresh={freshMoments}/> : null;
  };
  // The agent's record changes right after its turn (interests, notes), and
  // when a payment lands or it steps down: look again shortly after.
  React.useEffect(() => {
    if (!momentsOn) return;
    const t = setTimeout(() => { try { requestEndUserRefresh(shopCid); } catch (_) {} }, 1500);
    return () => clearTimeout(t);
  }, [momentsOn, shopCid, rows.length, eff.id, aiStatus.phase, hold && hold.kind, invoiceFollowers.length]);
  // A separator's click lands on the bubble it was drawn against.
  React.useEffect(() => {
    const land = (idx) => {
      const root = threadRef.current;
      const el = root && idx >= 0 ? bcThreadRowAt(root, idx, rows.length) : null;
      if (!el) return;
      pinnedRef.current = false;
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { el.scrollIntoView(); }
    };
    const onJump = (e) => {
      const d = (e && e.detail) || {};
      if (d.convId !== shopCid) return;
      try { land(findJumpTargetIndex(mThread, d)); } catch (_) {}
    };
    const onRange = (e) => {
      const d = (e && e.detail) || {};
      if (d.convId !== shopCid || !d.startTarget) return;
      try { land(resolveJumpTarget(mThread, d.startTarget)); } catch (_) {}
    };
    window.addEventListener('bc:jumpToMessage', onJump);
    window.addEventListener('bc:jumpToRange', onRange);
    return () => {
      window.removeEventListener('bc:jumpToMessage', onJump);
      window.removeEventListener('bc:jumpToRange', onRange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopCid, mThread]);

  const first = th ? (String(th.conv.name || '').split(/\s+/)[0] || ('@' + th.peer.username)) : '';
  // Pick an agent. A first-time pick asks for approval (the server says
  // so); a known one is assigned straight away, like any other chat.
  const pickAgent = async (ag) => {
    setAiMenuOpen(false);
    if (!ag) { try { await DM_AI.assign(tid, 0); } catch (e) { bcToast(String(e.message || e), 'err'); } return; }
    if (eff.id === Number(ag.id) && !eff.auto) return;
    try {
      const r = await DM_AI.assign(tid, ag.id, false);
      if (r && r.needApproval) setConsent({ agent: ag, llm: r.llm });
    } catch (e) { bcToast(String(e.message || e), 'err'); }
  };

  // Autoscroll only when already near the bottom; top edge loads older.
  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const now = Date.now();
    const userDriven = now - userScrollAtRef.current < 900;
    if (userDriven || now > glideUntilRef.current) {
      if (userDriven) glideUntilRef.current = 0;   // they took over
      pinnedRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 120;
    }
    if (el.scrollTop < 60 && th && th.hasMore && th.loaded) {
      const before = el.scrollHeight;
      DM_STORE.loadOlder(tid).then(() => requestAnimationFrame(() => {
        const e2 = threadRef.current; if (e2) e2.scrollTop += e2.scrollHeight - before;
      }));
    }
  };
  const markUserScroll = () => { userScrollAtRef.current = Date.now(); };
  // ── Following new messages ──
  // Same as every other chat: opening the chat (or a batch of history
  // landing) pins to the bottom at once; a new message, the typing line or
  // a separator appearing glides the view down to it. A glide already
  // travelling is retargeted rather than restarted.
  const lastRow = rows[rows.length - 1];
  const followRef = React.useRef({ tid: 0, id: null, len: 0, loaded: false });
  React.useLayoutEffect(() => {
    const el = threadRef.current;
    const f = followRef.current;
    const lastId = lastRow ? lastRow.id : null;
    const loaded = !!(th && th.loaded);
    const batch = f.tid !== tid || !f.loaded || rows.length - f.len > 3;
    if (f.tid !== tid) { pinnedRef.current = true; glideUntilRef.current = 0; }
    followRef.current = { tid, id: lastId, len: rows.length, loaded };
    if (!el || !pinnedRef.current) return;
    const target = el.scrollHeight - el.clientHeight;
    if (target - el.scrollTop <= 1) return;
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
    if (batch || reduce) { el.scrollTop = target; return; }
    if (Date.now() - userScrollAtRef.current < 700) return;       // hand on the wheel
    glideUntilRef.current = Date.now() + 900;
    el.scrollTo({ top: target, behavior: 'smooth' });
  }, [rows.length, lastRow && lastRow.id, th && th.loaded, hasAiDraft, aiStatus.phase, aiStatus.error, peerTyping,
      momentRows.size, !!momentRows.get(rows.length), invoiceFollowers.length]);

  // Stay at the bottom while the thread grows on its own (a picture
  // decoding, "sending…" showing under a slow message), unless the view
  // was scrolled up or our own glide is already on its way.
  React.useEffect(() => {
    const el = threadRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const body = el.querySelector(':scope > .ipc-body');
    if (!body) return;
    let lastH = body.offsetHeight;
    const ro = new ResizeObserver(() => {
      const h = body.offsetHeight;
      const grew = h > lastH;
      lastH = h;
      if (!grew || !pinnedRef.current) return;
      const now = Date.now();
      if (now - userScrollAtRef.current < 700 || now < glideUntilRef.current) return;
      const target = el.scrollHeight - el.clientHeight;
      if (target - el.scrollTop > 1) el.scrollTop = target;
    });
    ro.observe(body);
    return () => ro.disconnect();
  }, [tid, !!th]);

  React.useEffect(() => {
    const t = setTimeout(() => { try { taRef.current && taRef.current.focus({preventScroll: true}); } catch (_) {} }, 90);
    return () => clearTimeout(t);
  }, [tid]);
  useTypeToFocus(taRef, !canSend);

  // ── Message menu (right-click, or press and hold on a touch screen) ──
  const [mctx, setMctx] = React.useState(null);   // {x, y, row, ti}
  React.useEffect(() => {
    setMctx(null);
    const h = (e) => {
      const d = (e && e.detail) || {};
      if (!th || d.convId !== th.conv.id || !d.row) return;
      setMctx({ x: d.x, y: d.y, ay: d.ay, row: d.row, ti: d.ti });
    };
    window.addEventListener('bc-msg-ctx', h);
    return () => window.removeEventListener('bc-msg-ctx', h);
  }, [tid, !!th]);   // eslint-disable-line react-hooks/exhaustive-deps
  const closeMctx = React.useCallback(() => setMctx(null), []);
  // Outline the bubble the menu belongs to while it is open.
  React.useEffect(() => {
    if (!mctx || mctx.ti == null) return;
    const root = threadRef.current;
    const el = root && root.querySelector(`.brow[data-ti="${mctx.ti}"]`);
    if (el) el.setAttribute('data-ctx-target', '1');
    return () => { if (el) el.removeAttribute('data-ctx-target'); };
  }, [mctx]);
  // A reply's quote was tapped: bring the original into view and outline
  // it for a moment. Older history loads first if it isn't here yet.
  React.useEffect(() => {
    const h = async (e) => {
      const d = (e && e.detail) || {};
      if (Number(d.tid) !== Number(tid) || !d.uid) return;
      const thNow = DM_STORE.threads.get(tid);
      if (!thNow) return;
      let tries = 0;
      while (!thNow.byUid.get(d.uid) && thNow.hasMore && tries++ < 5) { try { await DM_STORE.loadOlder(tid); } catch (_) { break; } }
      const i = thNow.msgs.findIndex(x => x && x.uid === d.uid);
      if (i < 0) { bcToast('The original message isn’t in this chat’s history', 'info'); return; }
      requestAnimationFrame(() => {
        const root = threadRef.current;
        const el = root && root.querySelector(`.brow[data-ti="${i}"]`);
        if (!el) return;
        pinnedRef.current = false;
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { el.scrollIntoView(); }
        el.setAttribute('data-ctx-target', '1');
        setTimeout(() => el.removeAttribute('data-ctx-target'), 1400);
      });
    };
    window.addEventListener('bc:dm-jump', h);
    return () => window.removeEventListener('bc:dm-jump', h);
  }, [tid]);

  // ── Editing your last message (↑ in an empty composer), as in every
  // other chat. Enter saves, Esc cancels; what you'd typed before comes back.
  const [editRow, setEditRow] = React.useState(null);
  const editRef = React.useRef(null);
  editRef.current = editRow && editRow.tid === tid ? editRow : null;
  const preEditRef = React.useRef('');
  const setComposer = (val) => {
    const ta = taRef.current;
    if (!ta) return;
    ta.value = String(val || '');
    ta.style.height = 'auto';
    ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
    setHasText(!!ta.value.trim());
  };
  const lastEditable = () => {
    for (let i = rows.length - 1, seen = 0; i >= 0 && seen < 25; i--, seen++) {
      const r = rows[i];
      if (r && r.r !== 'in' && DM_STORE.canEdit(tid, r)) return r;
    }
    return null;
  };
  // ── Replying to a message (the message menu's Reply) ──
  const [replyRow, setReplyRow] = React.useState(null);   // { tid, row }
  const replyRef = React.useRef(null);
  replyRef.current = replyRow && replyRow.tid === tid ? replyRow : null;
  const startReply = (row) => {
    if (!row) return;
    if (editRef.current) { setEditRow(null); setComposer(preEditRef.current || ''); preEditRef.current = ''; }
    setReplyRow({ tid, row });
    setFocused(true);
    requestAnimationFrame(() => { try { taRef.current && taRef.current.focus({ preventScroll: true }); } catch (_) {} });
  };
  const cancelReply = () => { if (replyRef.current) setReplyRow(null); };
  React.useEffect(() => { setReplyRow(null); }, [tid]);
  const startEdit = (row) => {
    if (!row) return;
    setReplyRow(null);
    if (!editRef.current) preEditRef.current = taRef.current ? taRef.current.value : '';
    setEditRow({ tid, row });
    setComposer(String(row.c || ''));
    setFocused(true);
    requestAnimationFrame(() => {
      try { const ta = taRef.current; if (ta) { ta.focus({ preventScroll: true }); const n = ta.value.length; ta.setSelectionRange(n, n); } } catch (_) {}
    });
  };
  const cancelEdit = () => {
    if (!editRef.current) return;
    setEditRow(null);
    setComposer(preEditRef.current || '');
    preEditRef.current = '';
  };
  // Switching chats, or the message going away, ends the edit.
  React.useEffect(() => { if (editRow && editRow.tid !== tid) { setEditRow(null); preEditRef.current = ''; } }, [tid]);
  React.useEffect(() => {
    const e = editRef.current;
    if (e && !rows.includes(e.row)) cancelEdit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);
  const lastEditableRef = React.useRef(lastEditable); lastEditableRef.current = lastEditable;
  const startEditRef = React.useRef(startEdit); startEditRef.current = startEdit;
  // ↑ from anywhere in the open chat, not only the composer — same rules as
  // the other chats' handler: nothing typed, not already editing, and no
  // other field, dialog or menu has the key.
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowUp' || e.defaultPrevented || e.repeat || e.isComposing) return;
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const ta = taRef.current;
      if (!ta || ta.disabled || !ta.isConnected) return;
      const el = document.activeElement;
      if (el === ta) return;                     // the composer's own handler has it
      const chat = ta.closest('.ipc');
      if (!chat || chat.closest('[aria-hidden="true"]')) return;
      if (el && el !== document.body && el !== document.documentElement) {
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) return;
        if (!chat.contains(el)) return;
      }
      if (editRef.current || ta.value.trim()) return;
      if (document.querySelector('[role="dialog"], [role="menu"], .bc-modal-open, .sset-subpop')) return;
      const last = lastEditableRef.current && lastEditableRef.current();
      if (!last) return;
      e.preventDefault();
      startEditRef.current(last);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hasManual = () => !!(taRef.current && taRef.current.value.trim()) || (ATTACH_DRAFTS.get(cid) || []).length > 0;
  const sendManual = () => {
    const ta = taRef.current;
    const text = ta ? ta.value : '';
    // Read the queue from the map: Enter can fire from a handler closed over
    // a render older than the last file added.
    const queued = editRef.current ? [] : (ATTACH_DRAFTS.get(cid) || []);
    if ((!text.trim() && !queued.length) || !canSend) return;
    if (attBusy) return;                 // a file still being read would be lost
    if (text.length > 20000) { bcToast('That message is too long (20,000 characters max)', 'warn'); return; }
    // Editing: Enter saves the edit; nothing new is sent.
    const ed = editRef.current;
    if (ed) {
      if (!text.trim()) return;
      setEditRow(null);
      setComposer(preEditRef.current || '');
      preEditRef.current = '';
      DM_STORE.editMessage(tid, ed.row, text);
      return;
    }
    ta.value = ''; ta.style.height = 'auto'; setHasText(false);
    putAtts([]);
    pinnedRef.current = true;
    try { DM_STORE.typing(tid, 0); } catch (_) {}
    // A reply rides the first message that goes out.
    const reply = replyRef.current ? replyRef.current.row : null;
    setReplyRow(null);
    // One file with a short line of text goes out as a captioned file, as
    // in every other chat; otherwise the text first, then each file.
    const asCaption = queued.length === 1 && !!text.trim() && text.length <= ATT_CAPTION_CAP;
    (async () => {
      let rp = reply;
      if (text.trim() && !asCaption) { await DM_STORE.send(tid, text, rp ? { reply: rp } : {}); rp = null; }
      for (let i = 0; i < queued.length; i++) {
        await DM_STORE.sendFile(tid, queued[i], asCaption && i === 0 ? text : '', rp);
        rp = null;
      }
    })();
  };
  // Shared by the paperclip, drag-and-drop and paste. Each file is read
  // up front, so what's queued shows as it will be sent.
  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    if (!canSend) { bcToast(blocker, 'warn'); return; }
    const room = ATT_MAX_FILES - (ATTACH_DRAFTS.get(cid) || []).length;
    if (room <= 0) { bcToast(`Up to ${ATT_MAX_FILES} files per message`, 'warn'); return; }
    setAttBusy(true);
    const accepted = [];
    for (const f of files.slice(0, room)) {
      if (f.size > ATT_MAX_BYTES) { bcToast(`${f.name} is over ${prettyBytes(ATT_MAX_BYTES)}`, 'warn'); continue; }
      try {
        const url = await readFileAsDataUrl(f);
        const kind = attKindOf(f.type, f.name);
        const thumb = kind === 'image' ? await makeImageThumb(url, 160) : '';
        accepted.push({
          id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name: f.name || kind, size: f.size, mime: f.type || '', kind, url, thumb, file: f,
        });
      } catch (err) {
        console.warn('[dm-attach] could not read', f && f.name, err && err.message);
      }
    }
    setAttBusy(false);
    if (!accepted.length) return;
    pauseDraft();
    putAtts((ATTACH_DRAFTS.get(cid) || []).concat(accepted));
    // A file landing is activity in the composer: hold it open, caret in the box.
    setFocused(true);
    try { taRef.current && taRef.current.focus({ preventScroll: true }); } catch (_) {}
  };
  const onDropFiles = (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) addFiles(dt.files);
  };

  const manualReady = hasText || atts.length > 0;
  const sendMode = manualReady ? 'manual' : (hasAiDraft ? 'ai' : null);
  const sendFromButton = () => { if (sendMode === 'manual') sendManual(); else if (sendMode === 'ai') sendAI(); };

  const wrapRef = React.useRef(null), inRef = React.useRef(null);
  useComposerHeight(wrapRef, inRef);
  const composerActive = hover || focused || hasText || hasAiDraft || atts.length > 0 || attBusy || dragOver || !!(editRow && editRow.tid === tid) || !!(replyRow && replyRow.tid === tid) || bcNoHover();
  const keyState = DM_KEYS.state;

  if (!th) {
    return (
      <div className="ipc" onScroll={pinClipScroll}>
        <div className="ipc-chat-col" style={{alignItems:'center', justifyContent:'center', color:'var(--t3)', fontSize:12}}>
          This conversation is no longer available.
        </div>
      </div>
    );
  }

  const lockGlyph = <DmIco d={DM_I.lock} s={9} w={2.4}/>;
  const notices = [];
  if (keyState === 'password') {
    notices.push(<DmSep key="pw" ink={DM_INK.lock} glyph={lockGlyph} meta="Locked in this browser"
      label="Confirm your password to read your messages" act="Confirm" onAct={() => setPop('access')}/>);
  } else if (keyState === 'unsupported') {
    notices.push(<DmSep key="un" ink={DM_INK.warn} meta="Unavailable"
      label="Private windows block secure storage — use a normal window"/>);
  } else if (keyState === 'error') {
    notices.push(<DmSep key="er" ink={DM_INK.warn} meta="Messages unavailable" label={DM_KEYS.error}
      title={DM_KEYS.error} act="Try again" onAct={() => DM_KEYS.init(AUTH_STORE.account)}/>);
  }
  if (th.blocked) {
    notices.push(<DmSep key="bl" meta="Blocked" label={`You blocked ${first}`} act="Unblock" onAct={() => DM_STORE.block(tid, false)}/>);
  } else if (!th.peer.key) {
    notices.push(<DmSep key="nk" meta="Waiting" label={`${first} can receive messages once they sign in`}/>);
  }

  // "You" only matters once an agent writes here too.
  const showYou = !!currentAgent;

  // A spam cooldown the agent put on this chat (see SpamCooldownSep).
  const spamUntil = (currentAgent && currentAgent.spamThrottle !== false) ? (Number(DM_AI.spamUntil[String(tid)]) || 0) : 0;
  const spamOn = spamUntil > Date.now();
  const spamInfo = DM_AI.spamInfo ? DM_AI.spamInfo[String(tid)] : null;
  // What the agent is doing, drawn after the newest message.
  let aiLine = null;
  // The agent handed this chat over (it escalated): it stays quiet until
  // you resume it, exactly as in your other chats.
  if (currentAgent && !hasAiDraft && hold && hold.kind === 'escalated') {
    aiLine = <DmSep ink={DM_INK.warn} glyph={<AgentMark size={10}/>} meta="Needs you"
      label={hold.reason || `${currentAgent.name} handed this chat to you`} title={hold.reason || ''}
      act="Resume agent" onAct={() => DM_AI.resume(tid).catch(e => bcToast(String(e.message || e), 'err'))}/>;
  } else if (currentAgent && !hasAiDraft) {
    if (aiStatus.error) {
      aiLine = <DmSep ink={DM_INK.warn} glyph={<AgentMark size={10}/>} meta={currentAgent.name}
        label={aiStatus.error} title={aiStatus.error} act="Retry" onAct={() => DM_AI.retry(tid)}/>;
    } else if (aiStatus.phase === 'writing') {
      aiLine = <DmSep ink={DM_INK.agent} glyph={<AgentMark size={10}/>} meta={currentAgent.name} label="is writing a reply"/>;
    } else if (aiStatus.phase === 'reading') {
      aiLine = <DmSep ink={DM_INK.agent} glyph={<AgentMark size={10}/>} meta={currentAgent.name} label="is reading"/>;
    } else if (aiStatus.phase === 'note' && aiStatus.note && !spamOn) {
      // Not answering right now on purpose (reply hours, a spam cooldown —
      // the cooldown has its own countdown line instead).
      aiLine = <DmSep ink={DM_INK.agent} glyph={<AgentMark size={10}/>} meta={currentAgent.name} label={aiStatus.note} title={aiStatus.note}/>;
    }
  }

  // Status dot on the avatar — the agent's state, as in every other chat.
  const dot = !currentAgent ? null
    : (aiStatus.phase === 'writing' || aiStatus.phase === 'draft' || hasAiDraft) ? { col: 'var(--acc, #6c63ff)', pulse: true }
    : currentAgent.active === false ? { col: 'rgba(150,152,170,0.8)', pulse: false }
    : { col: 'color-mix(in oklab, var(--ok, #30d158) 70%, #a6aab4)', pulse: false };

  return (
    <div className="ipc" onScroll={pinClipScroll} style={chatWidth ? {'--msg-col-w': `${chatWidth}px`} : undefined}>
      {/* The whole chat takes dropped files, as every other chat does. It
          must be marked [data-bc-dropzone]: everywhere else the app cancels
          a drop so it can't navigate the page away (see GLOBAL DROP GUARD). */}
      <div className="ipc-chat-col" onScroll={pinClipScroll}
        data-bc-dropzone=""
        onDragEnter={e => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          dragDepthRef.current += 1;
          setDragOver(true);
        }}
        onDragOver={e => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();                 // without this, 'drop' never fires
          try { e.dataTransfer.dropEffect = canSend ? 'copy' : 'none'; } catch (_) {}
        }}
        onDragLeave={e => {
          if (!dragHasFiles(e)) return;
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragOver(false);
        }}
        onDrop={onDropFiles}>
        {/* ── HEADER — the identity pill + agent bubble every chat has ── */}
        <div className="ipc-hdr" style={{display:'flex', alignItems:'center', padding:'0 12px', position:'relative', gap:6,
          background:'transparent', backdropFilter:'none', WebkitBackdropFilter:'none', borderBottom:'none'}}>
          <div style={{display:'flex', alignItems:'center', gap:2, flexShrink:0}}>
            <button onClick={onBack || onClose} title={onBack && backTarget ? `Back to ${backTarget.name}` : 'Back to messages'} aria-label="Back"
              style={{flexShrink:0, width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                color:'var(--t2)', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.06)', cursor:'pointer', padding:0,
                transition:'background 0.12s, color 0.12s, border-color 0.12s'}}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.10)';e.currentTarget.style.color='var(--t1)';e.currentTarget.style.borderColor='rgba(255,255,255,0.12)';}}
              onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.05)';e.currentTarget.style.color='var(--t2)';e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
            </button>
            {onBack && onClose && (
              <button onClick={onClose} title="Home — back to message list" aria-label="Home"
                style={{flexShrink:0, width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                  color:'var(--t3)', background:'transparent', border:'1px solid transparent', cursor:'pointer', padding:0,
                  transition:'background 0.12s, color 0.12s, border-color 0.12s'}}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.06)';e.currentTarget.style.color='var(--t2)';e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';}}
                onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--t3)';e.currentTarget.style.borderColor='transparent';}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1z"/><polyline points="9 21 9 12 15 12 15 21"/></svg>
              </button>
            )}
          </div>

          <div ref={aiMenuRef} className="bc-idpill" style={{
            position:'absolute', left:'50%', top:'50%', transform:'translate(-50%, -50%)',
            display:'inline-flex', alignItems:'stretch', maxWidth:'calc(100% - 80px)', height:32,
            background: summaryOpen ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${summaryOpen ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.08)'}`,
            backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', borderRadius:999,
            boxShadow:'0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.07)',
            overflow:'visible', transition:'background 0.15s, border-color 0.15s', zIndex:2}}>
            <button type="button"
              onMouseEnter={summaryShow} onMouseLeave={summaryHide}
              onFocus={summaryShow} onBlur={summaryHide}
              onClick={() => { clearTimeout(summaryTimerRef.current); setAiMenuOpen(false); setSummaryOpen(o => !o); }}
              aria-label={`${th.conv.name} · @${th.peer.username} · end-to-end encrypted${hasSummary ? '. Show AI summary' : ''}`}
              aria-expanded={hasSummary ? summaryOpen : undefined}
              style={{display:'inline-flex', alignItems:'center', gap:8, padding:'3px 10px 3px 3px', maxWidth:240,
                background:'transparent', border:'none', borderRadius:999, cursor: hasSummary ? 'pointer' : 'default', userSelect:'none', overflow:'hidden',
                transition:'background 0.12s', color:'inherit', font:'inherit'}}
              onPointerEnter={e=>{ e.currentTarget.style.background='rgba(255,255,255,0.04)'; }}
              onPointerLeave={e=>{ e.currentTarget.style.background='transparent'; }}>
              <div ref={idAvatarRef} style={{position:'relative', flexShrink:0, width:26, height:26}}>
                <Ava name={th.conv.name} col={th.conv.col} sz={26} src={th.conv.avatar || undefined}/>
                {/* Where the platform badge sits on other chats: the lock. */}
                <span style={{position:'absolute', top:-2, right:-2, width:11, height:11, borderRadius:'50%',
                  background:'#14162680', border:'1.5px solid #14162680', display:'flex', alignItems:'center', justifyContent:'center',
                  boxShadow:'0 0 0 1.5px rgba(20,22,38,0.9)', color:'color-mix(in oklab, var(--acc) 45%, #d8d9ea)'}}>
                  <DmIco d={DM_I.lock} s={7} w={2.6}/>
                </span>
                {dot && (
                  <span style={{position:'absolute', right:-1, bottom:-1, width:8, height:8, borderRadius:'50%',
                    background: dot.col, border:'2px solid #14162680',
                    animation: dot.pulse ? 'dmc-dot-pulse 1.8s ease-in-out infinite' : 'none'}}/>
                )}
              </div>
              <span style={{fontSize:12.5, fontWeight:600, color:'var(--t1)', letterSpacing:'-0.01em',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', lineHeight:1, paddingBottom:1}}>{th.conv.name}</span>
              {th.peer && th.peer.guest && (ensureGuestStyles(),
                <span className="bc-guest-tag" title={`${first} is chatting without an account`}>Guest</span>)}
              <style>{`@keyframes dmc-dot-pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
                @media (prefers-reduced-motion: reduce) { [style*="dmc-dot-pulse"] { animation: none !important; } }`}</style>
            </button>

            {agents.length > 0 && (
              <button ref={aiTrigRef} type="button" className="bc-agb"
                data-on={currentAgent ? '1' : '0'} data-open={aiMenuOpen ? '1' : '0'}
                onClick={() => setAiMenuOpen(o => !o)}
                title={currentAgent
                  ? `${currentAgent.name}${currentAgent.active ? '' : ' (paused)'}${eff.auto ? ' · answering new chats' : ''} — change agent`
                  : 'Assign an AI agent'}
                aria-label={currentAgent ? `AI agent ${currentAgent.name}. Change agent` : 'Assign an AI agent'}
                aria-haspopup="menu" aria-expanded={aiMenuOpen}>
                <span className="bc-agb-ico">
                  <AgentMark size={14}/>
                  {currentAgent
                    ? <span className="bc-agb-dot" data-live={currentAgent.active ? '1' : '0'}/>
                    : <span className="bc-agb-plus" aria-hidden="true">
                        <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                      </span>}
                </span>
                {currentAgent && (
                  <span className="bc-agb-more">
                    <span className="bc-agb-name">{currentAgent.name}</span>
                    <svg className="bc-agb-chev" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
                  </span>
                )}
              </button>
            )}

            {aiMenuOpen && aiMenuPos && ReactDOM.createPortal(
              <div ref={aiMenuElRef} role="menu" className="bc-agm"
                style={{ top:aiMenuPos.top, left:aiMenuPos.left, width:aiMenuPos.width }}>
                <div className="bc-agm-head">
                  {!currentAgent ? 'Assign an AI agent' : eff.auto ? 'Answering new chats' : 'AI agent for this chat'}
                </div>
                <div className="bc-agm-line"/>
                <div className="bc-agm-list">
                  {agents.map(ag => {
                    const sel = Number(ag.id) === eff.id;
                    return (
                      <button key={ag.id} onClick={() => pickAgent(ag)} role="menuitemradio" aria-checked={sel}
                        className="bc-agm-row" data-sel={sel ? '1' : '0'}
                        title={`${ag.name} · ${modelLabel(ag.model)}${ag.active ? '' : ' · paused'}`}>
                        <span className="bc-agm-live" data-live={ag.active ? '1' : '0'} aria-hidden="true"/>
                        <span className="bc-agm-name">{ag.name}</span>
                        <span className="bc-agm-model">{ag.active ? modelLabel(ag.model) : 'paused'}</span>
                        <span className="bc-agm-check" aria-hidden="true">
                          {sel && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {currentAgent && (
                  <React.Fragment>
                    <div className="bc-agm-line"/>
                    <div className="bc-agm-foot">
                      <button onClick={() => pickAgent(null)} className="bc-agm-off" role="menuitem">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        {eff.auto ? 'Don’t answer this chat' : 'Unassign agent'}
                      </button>
                    </div>
                  </React.Fragment>
                )}
              </div>,
              document.body
            )}
          </div>

          <ChatSummaryHover
            open={summaryOpen && !aiMenuOpen}
            anchorEl={aiMenuRef.current}
            avatarEl={idAvatarRef.current}
            data={euRecord}
            onEnter={summaryKeep}
            onLeave={summaryHide}/>

          <div style={{flex:1}}/>
        </div>

        {/* Before anything has been said: a quiet note, centred in the empty
            chat. It goes once the conversation begins. */}
        {th.loaded && !rows.length && !loadErr && (
          <div className="dmc-empty">
            <span className="dmc-empty-mark" aria-hidden="true"><DmIco d={DM_I.lock} s={12} w={2}/></span>
            <span className="dmc-empty-t">End-to-end encrypted</span>
            <span className="dmc-empty-s">Only you and {first} can read these messages.</span>
          </div>
        )}

        {/* ── THREAD ── */}
        <div className="ipc-thread" ref={threadRef} onScroll={onThreadScroll}
          onWheel={markUserScroll} onTouchMove={markUserScroll}
          onPointerDown={(e) => { if (e.target === e.currentTarget) markUserScroll(); }}
          onKeyDown={(e) => { if (['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(e.key)) markUserScroll(); }}
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(e.clientY >= r.bottom - 120); }}
          onMouseLeave={() => setHover(false)}
          style={{paddingBottom: hasAiDraft ? 220 : 90, transition:'padding-bottom 0.22s ease'}}>
          <div className="ipc-body">
            {th.hasMore && th.loaded && rows.length > 0 && (
              <div className="dmc-more"><button type="button" className="dmp-btn" onClick={() => DM_STORE.loadOlder(tid)}>Load earlier messages</button></div>
            )}
            {notices}
            {th.keyChange && (
              <DmSep ink={DM_INK.lock} glyph={lockGlyph} meta="Security" label={`${first}’s keys changed`}
                title="This happens when an account’s messages are reset."/>
            )}
            {loadErr && <DmSep ink={DM_INK.warn} meta="Couldn’t load messages" label={loadErr} title={loadErr} act="Retry"
              onAct={() => { setLoadErr(''); DM_STORE.loadThread(tid).catch(e => setLoadErr(String(e && e.message || e))); }}/>}
            {rows.map((m, i) => {
              const prev = rows[i - 1], next = rows[i + 1];
              // A separator between two bubbles breaks the run, as in every other chat.
              const isGroupEnd = !next || !bcBubblesJoin(m, next) || !!momentRows.get(i + 1);
              const isGroupStart = !prev || !bcBubblesJoin(prev, m) || !!momentRows.get(i);
              return (
                <React.Fragment key={m.id}>
                  {momentRowAt(i)}
                  <ChatBubbleRow m={m} msg={th.conv} sz={28} ti={i} isGroupStart={isGroupStart} isGroupEnd={isGroupEnd}
                    hideYou={!showYou}
                    enter={enterOf[i]}
                    style={{marginBottom: isGroupEnd ? 10 : 2, opacity: m.locked ? 0.7 : 1}}/>
                </React.Fragment>
              );
            })}
            {/* Under the newest message: what just happened there, and any
                invoice still open, drawn as one line (see ThreadFollowers).
                A hand-over has its own line below (Resume agent). */}
            {invoiceFollowers.length ? null : momentRowAt(rows.length)}
            <ThreadFollowers invoices={invoiceFollowers} escalation={null}
              tail={momentRows.get(rows.length)} fresh={freshMoments}/>
            {spamOn && !aiStatus.error && !(hold && hold.kind === 'escalated') && (
              <SpamCooldownSep until={spamUntil} reason={spamInfo && spamInfo.reason} hits={spamInfo ? spamInfo.hits : 0}/>
            )}
            {aiLine}
            {/* They're away and their agent answers: this app added a copy
                of what you send that BotCommand can read. Say so. */}
            {!!th.assistAt && !!th.assistNotice && Date.now() - th.assistAt < 30 * 60 * 1000 && (
              <DmSep ink={DM_INK.warn} glyph={<AgentMark size={10}/>} meta={`${first} is away`}
                label="an assistant is replying"
                title={`${first} is away and has an assistant answering for them. While that’s on, BotCommand can read the messages you send so it can write replies, and keeps them with ${first}’s chat for their assistant.`}/>
            )}
            {peerTyping && (
              <DmSep ink={DM_INK.agent} glyph={<DmTypingDots/>} meta={first} label="is typing"/>
            )}
          </div>
        </div>

        {dragOver && canSend && <ChatDropOverlay/>}

        {/* ── COMPOSER — same panel and AI draft card as every other chat ── */}
        <div ref={wrapRef} className="bc-comp"
          data-draft={hasAiDraft ? '1' : '0'}
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
          style={{position:'absolute', bottom:22, left:'50%',
            transform: composerActive ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(calc(100% + 22px))',
            opacity: composerActive ? 1 : 0, width:'calc(100% - 64px)', zIndex:10, transition: COMPOSER_TRANSITION,
            pointerEvents: composerActive ? 'auto' : 'none'}}>
          <div className="bc-comp-in" ref={inRef}>
            {hasAiDraft && (() => {
              const chunkTotal = liveDraft.chunkTotal || 1;
              const chunkIdx   = (liveDraft.chunkIndex || 0) + 1;
              const isMulti    = chunkTotal > 1;
              const totalDelay = liveDraft.delayMs || 1;
              const elapsed    = liveDraft.paused ? Math.max(0, totalDelay - liveDraft.pausedAtRemaining) : Math.max(0, totalDelay - remainingMs);
              const progress   = Math.max(0, Math.min(1, elapsed / totalDelay));
              const isPaused   = !!liveDraft.paused;
              return (
                <div className="bc-dr" onClick={pauseDraft}>
                  <div className="bc-dr-head">
                    <span className="bc-dr-status" data-state={isPaused ? 'paused' : 'live'}>
                      <span className="bc-dr-dot" aria-hidden="true"/>
                      {isPaused ? 'Draft paused' : 'AI draft'}
                    </span>
                    <span className="bc-dr-meta">
                      {[liveDraft.agent, isMulti ? `message ${chunkIdx} of ${chunkTotal}` : null].filter(Boolean).join(' · ')}
                    </span>
                    <span className="bc-dr-spacer"/>
                    {!isPaused && <span className="bc-dr-note">Sends in <b>{remainingSec}s</b></span>}
                    {isPaused && hasText && <span className="bc-dr-note">Holding while you reply</span>}
                    {isPaused && !hasText && (
                      <button type="button" className="bc-dr-link" onClick={e => { e.stopPropagation(); resumeDraft(); }}
                        title="Let the agent send this draft when the countdown ends">
                        <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden="true"><path d="M0.5 0.8v7.4L7.2 4.5z" fill="currentColor"/></svg>
                        Resume
                      </button>
                    )}
                    <button type="button" className="bc-dr-x" onClick={e => { e.stopPropagation(); discardDraft(); }}
                      title={isMulti ? 'Discard remaining messages' : 'Discard draft'}
                      aria-label={isMulti ? 'Discard remaining messages' : 'Discard draft'}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <DraftCountdownTrace total={totalDelay} sendAt={liveDraft.sendAt} paused={isPaused} progress={progress} chunkTotal={chunkTotal}/>
                  <textarea className="bc-dr-edit" value={editText}
                    onChange={e => { setEditText(e.target.value); DRAFT_STORE.setText(cid, e.target.value); }}
                    onFocus={() => { pauseDraft(); setFocused(true); }}
                    onBlur={() => setFocused(false)}
                    onClick={e => e.stopPropagation()} rows={Math.min(5, Math.max(1, Math.ceil((editText.length || 1) / 72)))}/>
                  {liveDraft.upcoming && liveDraft.upcoming.length > 0 && (
                    <UpcomingChunks chunks={liveDraft.upcoming} startIdx={chunkIdx + 1} total={chunkTotal}/>
                  )}
                </div>
              );
            })()}
            {replyRow && replyRow.tid === tid && !(editRow && editRow.tid === tid) && (
              <div className="bc-cbar">
                <span className="bc-cbar-ico" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/></svg>
                </span>
                <div className="bc-cbar-body">
                  <div className="bc-cbar-title">Replying to {replyRow.row.r === 'in' ? first : replyRow.row.r === 'bot' ? 'your agent' : 'yourself'}</div>
                  <div className="bc-cbar-txt">{quoteText({ c: replyRow.row.c, mt: replyRow.row.mt })}</div>
                </div>
                <button type="button" className="bc-cbar-x" onClick={cancelReply} title="Cancel reply (Esc)" aria-label="Cancel reply">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            )}
            {editRow && editRow.tid === tid && (
              <div className="bc-cbar">
                <span className="bc-cbar-ico" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
                </span>
                <div className="bc-cbar-body">
                  <div className="bc-cbar-title">Editing message</div>
                  <div className="bc-cbar-txt">{quoteText(MSGS_STORE.quoteOf(editRow.row))}</div>
                </div>
                <button type="button" className="bc-cbar-x" onClick={cancelEdit} title="Cancel edit (Esc)" aria-label="Cancel edit">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            )}
            {/* ── ATTACHMENT TRAY ── what goes out with the next send. */}
            {(atts.length > 0 || attBusy) && (
              <div className="bc-tray">
                {atts.map(a => a.kind === 'image' ? (
                  <div key={a.id} className="bc-tray-img" title={`${a.name} · ${prettyBytes(a.size)}`}>
                    <img src={a.thumb || a.url} alt={a.name}/>
                    <button onClick={() => removeAtt(a.id)} title={`Remove ${a.name}`} aria-label={`Remove ${a.name}`} className="bc-tray-x">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                ) : (
                  <div key={a.id} style={{maxWidth:230, minWidth:0, flexShrink:0}}>
                    <FileChip name={a.name} size={a.size} kind={a.kind} compact onRemove={() => removeAtt(a.id)}/>
                  </div>
                ))}
                {attBusy && <span className="bc-tray-busy">Reading file…</span>}
              </div>
            )}
            {pace && (
              <div className="dmc-pace" role="status">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {paceUntil ? <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></> : <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.3A8.4 8.4 0 1 1 21 11.5z"/>}
                </svg>
                <span className="dmc-pace-m">{pace.msg}</span>
                {paceUntil > 0 && paceLeft > 0 && (
                  <span className="dmc-pace-t" aria-label={`Resumes in ${paceLeft} seconds`}>
                    <i>resumes in</i>{`${Math.floor(paceLeft / 60)}:${String(paceLeft % 60).padStart(2, '0')}`}
                  </span>
                )}
              </div>
            )}
            <div className="bc-row">
              {/* ── ATTACH ── same button as every other chat's composer. */}
              <button type="button" className="bc-ibtn"
                onClick={() => { try { fileInputRef.current && fileInputRef.current.click(); } catch (_) {} }}
                disabled={attBusy || !canSend || !!(editRow && editRow.tid === tid)}
                title="Attach photos or files" aria-label="Attach photos or files">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>
              <input ref={fileInputRef} type="file" multiple style={{display:'none'}}
                onChange={e => {
                  addFiles(e.target.files);
                  // Reset, or picking the same file twice in a row is a no-op.
                  e.target.value = '';
                }}/>
              <textarea ref={taRef} rows={1} disabled={!canSend}
                onPaste={e => {
                  // A screenshot on the clipboard arrives as a file, not text.
                  const cd = e.clipboardData || window.clipboardData;
                  if (cd && cd.files && cd.files.length && !editRef.current) {
                    e.preventDefault();
                    addFiles(cd.files);
                  }
                }}
                placeholder={!canSend ? blocker : (editRow && editRow.tid === tid) ? 'Edit your message…' : (replyRow && replyRow.tid === tid) ? `Reply to ${replyRow.row.r === 'in' ? first : 'yourself'}…` : hasAiDraft ? 'Or write your own reply…' : `Message ${first}…`}
                className="bc-input" style={{opacity: canSend ? 1 : 0.6}}
                onChange={e => {
                  const ta = e.currentTarget;
                  ta.style.height = 'auto';
                  ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
                  const nx = !!ta.value.trim();
                  // They see you typing (and stop seeing it if you clear it).
                  // Not while editing: that isn't a new message on its way.
                  if (!editRef.current) DM_STORE.typing(tid, nx ? 6000 : 0);
                  // Typing your own reply holds the agent's countdown.
                  if (nx) pauseDraft();
                  setHasText(p => p === nx ? p : nx);
                }}
                onPointerDown={() => { if (hasAiDraft) pauseDraft(); }}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                onKeyDown={e => {
                  // Esc leaves edit mode (and nothing else).
                  if (e.key === 'Escape' && editRef.current) { e.preventDefault(); e.stopPropagation(); cancelEdit(); return; }
                  if (e.key === 'Escape' && replyRef.current) { e.preventDefault(); e.stopPropagation(); cancelReply(); return; }
                  // ↑ in an empty composer edits your last message.
                  if (e.key === 'ArrowUp' && !editRef.current && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
                      && !e.nativeEvent.isComposing && !e.currentTarget.value.trim()) {
                    const last = lastEditable();
                    if (last) { e.preventDefault(); startEdit(last); return; }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (hasManual()) sendManual(); }
                }}/>
              {hasAiDraft && !(editRow && editRow.tid === tid) ? (
                <button type="button" className="bc-send" data-mode={sendMode === 'manual' ? 'manual' : 'ai'}
                  onClick={sendFromButton} disabled={!canSend}
                  aria-label={sendMode === 'manual' ? 'Send your reply' : 'Send AI draft'}>
                  <span className="bc-send-lbl">
                    <span data-on={sendMode === 'manual' ? '0' : '1'} aria-hidden={sendMode === 'manual'}>Send draft</span>
                    <span data-on={sendMode === 'manual' ? '1' : '0'} aria-hidden={sendMode !== 'manual'}>Send reply</span>
                  </span>
                  <span className="bc-send-ico" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
                  </span>
                </button>
              ) : (
                <button type="button" className="bc-go" data-show={manualReady && canSend ? '1' : '0'}
                  onClick={sendManual} tabIndex={manualReady && canSend ? 0 : -1}
                  title={editRow && editRow.tid === tid ? 'Save edit (Enter)' : 'Send (Enter)'}
                  aria-label={editRow && editRow.tid === tid ? 'Save edit' : 'Send'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {mctx && (
        <TopLayer>
          <DmMessageMenu x={mctx.x} y={mctx.y} ay={mctx.ay} tid={tid} row={mctx.row} peerName={first}
            onClose={closeMctx} onEdit={startEdit} onReply={startReply}/>
        </TopLayer>
      )}
      {pop === 'access' && <DmAccessPopup onClose={() => setPop(null)}/>}
      {consent && (
        <DmAiConsentPopup agent={consent.agent} llm={consent.llm} scope="chat" peerName={first}
          onConfirm={async () => {
            const r = await DM_AI.assign(tid, consent.agent.id, true);
            if (r && r.needApproval) throw new Error('Couldn’t save your approval. Try again.');
          }}
          onClose={() => setConsent(null)}/>
      )}
    </div>
  );
};
const DirectChat = React.memo(DirectChatView, (p, n) =>
  p.msg === n.msg && p.onClose === n.onClose && p.onBack === n.onBack && p.backTarget === n.backTarget && p.chatWidth === n.chatWidth);