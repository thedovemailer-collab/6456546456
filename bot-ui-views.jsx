// ───────────────────────────────────────────────────────────────────
// bot-ui-views.jsx — Top-level pages: Messages, Dashboard, Agents, Products, Licenses
// Each of these is a full sidebar destination. They share the atoms in
// bot-ui-shared.jsx but are otherwise independent of each other.
//     STAGE_BADGE                     — stage chip palette (used by MsgList)
//     MsgList                         — Telegram-style 2-pane conversation list
//     Dashboard + Sparkline / SalesChart / DonutChart / G styles
//     AgentsView                      — agent list + tabbed editor
//       + RealismTab + many shared form atoms (NumRow, RangePair, etc.)
//     ProductsView + ProductEditor + MediaList + PostPaymentEditor
//     LicensesView + LicenseDetail
// ───────────────────────────────────────────────────────────────────

// Stage badge palette — hoisted out of row render so it isn't reallocated
// on every list update. Subtler dark-tone palette to match the rest of
// the app — these badges sit alongside names so they need to whisper.
const STAGE_BADGE = {
  new:        {label:'NEW',      color:'rgba(127,180,212,0.75)',color2:'rgba(127,180,212,1)', bg:'rgba(127,180,212,0.07)',  border:'rgba(127,180,212,0.18)'},
  prospect:   {label:'PROSPECT', color:'rgba(212,168,102,0.75)',color2:'rgba(212,168,102,1)', bg:'rgba(212,168,102,0.07)',  border:'rgba(212,168,102,0.18)'},
  purchasing: {label:'BUYING',   color:'rgba(155,149,212,0.75)',color2:'rgba(155,149,212,1)', bg:'rgba(155,149,212,0.07)',  border:'rgba(155,149,212,0.18)'},
  needs_help: {label:'HELP',     color:'rgba(212,146,112,0.85)',color2:'rgba(212,146,112,1)', bg:'rgba(212,146,112,0.08)',  border:'rgba(212,146,112,0.24)'},
  escalated:  {label:'ESCALATED',color:'rgba(245,168,120,0.95)',color2:'rgba(245,168,120,1)', bg:'rgba(255,120,40,0.10)',   border:'rgba(255,120,40,0.30)'},
  churned:    {label:'CHURNED',  color:'rgba(120,120,140,0.6)', color2:'rgba(120,120,140,1)', bg:'rgba(120,120,140,0.06)',  border:'rgba(120,120,140,0.16)'},
};

// ── EMPTY-CHAT AVATAR ─────────────────────────────────────────
// A floating sheet ghost (the printed/painted ghost.png graphic) that
// behaves like real cloth caught mid-sway. Sits where no chat is
// selected, paired with a context-aware briefing line.
//
// Rendering strategy:
//   • PRIMARY: real WebGL via Three.js (r128). The ghost.png texture is
//     mapped onto a finely-subdivided plane (96 × 128 segments). A custom
//     vertex shader applies layered, hem-weighted sine "noise" so the
//     bottom of the sheet flutters like fabric while the head stays
//     near-rigid. Multiple distortion layers run on different phases:
//       – per-x phase offset → adjacent cloth points sway out of sync
//       – breathing scale    → soft whole-body inhale/exhale
//       – lateral sway       → sideways drift driven by uTime
//       – Z-pucker           → fake depth ripple along the hem
//     The fragment shader passes the PNG's alpha through unchanged so
//     the printed eyes / drape lines / tatty edge of the original art
//     are preserved 1:1 — but they now move with the cloth.
//   • FALLBACK: a plain <img> with multi-stage CSS keyframe transforms
//     (skew + scale + translate) so the ghost still looks alive without
//     WebGL.
//
// Entry animation: rises from below, scale overshoot, fades in.
// Briefing engine (unchanged): rotates context-aware lines every ~6.8s.
const GHOST_IMG_URL      = 'https://lefty.pro/MyResponder/copy/ghosty.png';
const GHOST_BACK_IMG_URL = 'https://lefty.pro/MyResponder/copy/ghostyb2.png';

// ── Ghost session persistence ────────────────────────────────
// Lives at module scope so it survives EmptyChatAvatar unmount/remount
// (which happens every time the user opens or closes a chat). On first
// mount the entry animation plays normally. On subsequent mounts we skip
// it and restore the ghost's last known world-space position so it never
// replays the rise-in just because the user went back to the dashboard.
// ── Ghost position persistence ───────────────────────────────
// Two layers:
//   1. Module-level _ghostSession: survives EmptyChatAvatar unmount/remount
//      within the same page session (opening/closing chats).
//   2. localStorage 'bc.ghost.pos.v2': survives page reload.
//
// userMovedGhost = true once the user drags the ghost away from the dock.
// While true, setHome() calls from the ResizeObserver (sidebar resize,
// widget toggle) update GHOST_HOME_DEFAULT but do NOT redirect ghostHome
// or activate dropSpring — the ghost stays exactly where the user put it.
// v2 — KEY BUMPED DELIBERATELY.
//
// The timing fixes below make the ghost centre correctly, but they could
// not help anyone who already had a saved position: v1 stored `userMoved`,
// and once that flag is true every setHome() call updates the default
// WITHOUT moving the ghost. So a position nudged weeks ago (possibly by an
// accidental drag) pinned it off-centre forever, and no amount of correct
// centring logic would override it — by design, since we must not yank a
// deliberately-placed ghost back to the dock on every resize.
//
// Bumping the key retires that stale state exactly once: everyone starts
// centred again, and a drag after this point persists as normal under v2.
// The old v1 entry is left in localStorage rather than deleted — it costs
// a few bytes and makes this reversible if it turns out someone did want
// their old spot.
const _GHOST_POS_LS_KEY = 'bc.ghost.pos.v2';
const _ghostPosLS = (() => {
  try {
    const raw = localStorage.getItem(_GHOST_POS_LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o.homeX === 'number') return o;
    }
  } catch (_) {}
  return null;
})();

const _ghostSession = {
  hasPlayed:    false,  // true after the first entry animation completes
  posX:         _ghostPosLS ? _ghostPosLS.posX  : null,
  posY:         _ghostPosLS ? _ghostPosLS.posY  : null,
  scale:        _ghostPosLS ? _ghostPosLS.scale : null,
  opacity:      1,
  homeX:        _ghostPosLS ? _ghostPosLS.homeX : null,
  homeY:        _ghostPosLS ? _ghostPosLS.homeY : null,
  // True once the user has dragged the ghost away from its dock.
  // Reset only when the user explicitly double-clicks to return to dock
  // (or calls ghostCtl.reset()) — OR on a fresh page load (see below).
  //
  // FIX (ghost not re-centring on refresh): this used to be restored from
  // localStorage on every load, same as posX/homeX:
  //   userMoved: _ghostPosLS ? !!_ghostPosLS.userMoved : false
  // That meant a single drag, ever, permanently opted the ghost out of the
  // dock-recentring that setHome() does on every future page load — the
  // exact "off-centre v1 key" bug this file already fixed once (see the
  // block comment above this const). Bumping the LS key cured it for
  // everyone at the time, but the underlying cause wasn't touched: any
  // drag from that point on reproduces the same stuck-off-centre symptom
  // on the very next refresh.
  // A hard page load re-runs this whole module from scratch, so
  // "userMoved" doesn't yet mean anything for the new page — nothing has
  // been dragged in THIS session. So always start false here; a mid-session
  // drag still sets (and keeps) it true via onPointerUpDoc below, so
  // dragging behaves exactly as before within one visit — it just no
  // longer survives a refresh and silently disables recentring forever.
  userMoved:    false,
  _restoreHome: false,
  // Throttled localStorage flush — max once per 500ms
  _lsFlushTid:  null,
  flushToLS() {
    if (this._lsFlushTid) return;
    this._lsFlushTid = setTimeout(() => {
      this._lsFlushTid = null;
      try {
        localStorage.setItem(_GHOST_POS_LS_KEY, JSON.stringify({
          posX:      this.posX,
          posY:      this.posY,
          scale:     this.scale,
          homeX:     this.homeX,
          homeY:     this.homeY,
          userMoved: this.userMoved,
        }));
      } catch (_) {}
    }, 500);
  },
};

// ── Ghost dev / test panel ─────────────────────────────────
// Floating, draggable, dark-glass control surface that exposes the
// imperative ghost controller (emotions, body actions, intro / exit
// presets, ripple). Designed to feel like an internal Anthropic-grade
// debug HUD rather than a child's toy — uniform spacing, monospace
// labels, low-saturation accent.
const GHOST_EMOTIONS = [
  { id:'chill',       label:'Chill',       hint:'Idle baseline' },
  { id:'happy',       label:'Happy',       hint:'Soft crescent + smile' },
  { id:'laughing',    label:'Laughing',    hint:'Wide mouth + tear' },
  { id:'sad',         label:'Sad',         hint:'Drooped lids + frown' },
  { id:'crying',      label:'Crying',      hint:'Streaming tears' },
  { id:'angry',       label:'Angry',       hint:'V-brow + red blush' },
  { id:'surprised',   label:'Surprised',   hint:'Wide eyes + !' },
  { id:'suspicious',  label:'Suspicious',  hint:'Narrow + tilted' },
  { id:'sleepy',      label:'Sleepy',      hint:'Half-shut, slow' },
  { id:'love',        label:'Love',        hint:'Heart eyes' },
  { id:'dizzy',       label:'Dizzy',       hint:'Spiral overlay' },
  { id:'scared',      label:'Scared',      hint:'Pinpoint + sweat' },
  { id:'embarrassed', label:'Embarrassed', hint:'Red blush + sweat' },
  { id:'determined',  label:'Determined',  hint:'Furrowed focus' },
];
const GHOST_INTROS = [
  { id:'rise_in',    label:'Rise in',    hint:'Floats up from below with soft fade' },
  { id:'drop_in',    label:'Drop in',    hint:'Falls from above with elastic bounce' },
  { id:'fade_in',    label:'Fade in',    hint:'Gentle opacity materialise' },
  { id:'portal_in',  label:'Portal in',  hint:'Spins into existence from a point' },
];
const GHOST_EXITS = [
  { id:'fade_out',   label:'Fade out',   hint:'Soft opacity dissolve' },
  { id:'rise_out',   label:'Rise out',   hint:'Drifts upward and fades' },
  { id:'shrink_out', label:'Shrink out', hint:'Scales down to nothing' },
  { id:'portal_out', label:'Portal out', hint:'Spins and collapses inward' },
];
const GHOST_ACTIONS = [
  { id:'drift',       label:'Drift',        hint:'Loop · slow organic wander' },
  { id:'patrol',      label:'Patrol',       hint:'Loop · visits screen waypoints' },
  { id:'orbit',       label:'Orbit',        hint:'Loop · smooth figure-8 path' },
  { id:'peek',        label:'Peek corner',  hint:'Loop · darts to a corner and back' },
];

// ── Ghost hitbox / silhouette editor ──────────────────────────
// Lets the user trace the real silhouette of the ghost.png shape over
// the live ghost on screen. Drag individual vertices, or skew / rotate /
// scale / translate the whole polygon as a group, then apply — the live
// hit-div clip-path updates instantly. Output is a paste-able block of
// UV coordinates (0..1, top-left origin) that match GHOST_POLY_UV.
//
// Persists to localStorage so the chosen polygon survives reloads, and
// the runtime applies any saved poly on startup (see ghost effect).
const GHOST_POLY_LS_KEY = 'ghostHitPolyUV_v3';

// Default polygon — the baked-in silhouette traced via the editor.
// Reset button restores this. Coordinates are UV (0..1, top-left origin)
// matching the plane's UVs and the PNG.
const DEFAULT_GHOST_POLY_UV = [
  [0.500,0.040],[0.720,0.080],[0.816,0.259],[0.848,0.400],
  [0.880,0.620],[0.850,0.840],[0.620,0.920],[0.380,0.920],
  [0.209,0.853],[0.120,0.620],[0.196,0.426],[0.244,0.239],
  [0.280,0.080],
];


// ── Eye preset store ───────────────────────────────────────
// Saved "eye types" — independent localStorage key from eyeCfg so the
// presets persist across cfg resets. Built-in presets ship in code and
// always appear in the list; user presets are appended below them.
const EYE_PRESETS_LS_KEY = 'ghostEyePresets_v1';

const BUILTIN_EYE_PRESETS = [
  {
    id: 'kawaii', name: 'Kawaii', builtIn: true, cfg: {
      pupilFill: 0.55, scleraColor: '#FAFAFF', scleraBright: 1.0, scleraGrad: 0.20,
      pupilColor: '#000000', pupilBright: 1.0, hiColor: '#FFFFFF', hiBright: 1.0,
      outlineColor: '#0A0A10', outlineAlpha: 0.55, outlineWidth: 0.020,
      restX: -0.32, restY: -0.30, sizeMul: 1.0, lidAware: true,
      glints: [
        { x: 0, y: 0,    size: 1.00, shape: 1, bright: 1.0, on: true  },
        { x: 1.5, y: 1.5,size: 0.45, shape: 0, bright: 1.0, on: true  },
        { x: 0, y: 0,    size: 0.30, shape: 0, bright: 1.0, on: false },
        { x: 0, y: 0,    size: 0.30, shape: 0, bright: 1.0, on: false },
      ],
      gloss: false, sparkle: false, glisten: false, crossShine: false,
    },
  },
  {
    id: 'sparkle', name: 'Sparkle', builtIn: true, cfg: {
      pupilFill: 0.55, scleraColor: '#FAFAFF', scleraBright: 1.0, scleraGrad: 0.18,
      pupilColor: '#000000', pupilBright: 1.0, hiColor: '#FFFFFF', hiBright: 1.0,
      outlineColor: '#0A0A10', outlineAlpha: 0.55, outlineWidth: 0.020,
      restX: -0.32, restY: -0.30, sizeMul: 1.0, lidAware: true,
      glints: [
        { x: 0,    y: 0,    size: 1.00, shape: 1, bright: 1.0, on: true },
        { x: 1.7,  y: 1.4,  size: 0.42, shape: 0, bright: 1.0, on: true },
        { x: -1.6, y: 1.3,  size: 0.36, shape: 0, bright: 1.0, on: true },
        { x: 0.2,  y: -1.6, size: 0.28, shape: 5, bright: 1.0, on: true },
      ],
      gloss: true, sparkle: true, glisten: false, crossShine: false,
    },
  },
  {
    id: 'triple', name: 'Triple cluster', builtIn: true, cfg: {
      pupilFill: 0.60, scleraColor: '#FAFAFF', scleraBright: 1.0, scleraGrad: 0.20,
      pupilColor: '#000000', pupilBright: 1.0, hiColor: '#FFFFFF', hiBright: 1.0,
      outlineColor: '#0A0A10', outlineAlpha: 0.55, outlineWidth: 0.020,
      restX: -0.32, restY: -0.30, sizeMul: 1.0, lidAware: true,
      glints: [
        { x: 0,   y: 0,   size: 1.00, shape: 1, bright: 1.0, on: true },
        { x: 0,   y: 2.6, size: 0.55, shape: 0, bright: 1.0, on: true },
        { x: 2.0, y: 1.6, size: 0.32, shape: 0, bright: 1.0, on: true },
        { x: 0,   y: 0,   size: 0.30, shape: 0, bright: 1.0, on: false },
      ],
      gloss: false, sparkle: false, glisten: true, crossShine: false,
    },
  },
  {
    id: 'love', name: 'Anime love', builtIn: true, cfg: {
      pupilFill: 0.85, scleraColor: '#FFF0F4', scleraBright: 1.0, scleraGrad: 0.25,
      pupilColor: '#1B0A12', pupilBright: 1.0, hiColor: '#FFE6EC', hiBright: 1.0,
      outlineColor: '#3A0612', outlineAlpha: 0.45, outlineWidth: 0.020,
      restX: -0.20, restY: -0.20, sizeMul: 1.1, lidAware: true,
      glints: [
        { x: 0,    y: 0,   size: 1.00, shape: 4, bright: 1.0, on: true  },
        { x: 1.5,  y: 1.4, size: 0.45, shape: 0, bright: 1.0, on: true  },
        { x: -1.5, y: 1.4, size: 0.40, shape: 0, bright: 1.0, on: true  },
        { x: 0,    y: 0,   size: 0.30, shape: 0, bright: 1.0, on: false },
      ],
      gloss: true, sparkle: true, glisten: true, crossShine: false,
    },
  },
  {
    id: 'cat', name: 'Cat-eye', builtIn: true, cfg: {
      pupilFill: 0.45, scleraColor: '#FAFAFF', scleraBright: 1.0, scleraGrad: 0.18,
      pupilColor: '#000000', pupilBright: 1.0, hiColor: '#FFFFFF', hiBright: 1.0,
      outlineColor: '#0A0A10', outlineAlpha: 0.55, outlineWidth: 0.020,
      restX: -0.20, restY: -0.20, sizeMul: 1.2, lidAware: true,
      glints: [
        { x: 0, y: 0, size: 1.00, shape: 6, bright: 1.0, on: true  },
        { x: 0, y: 0, size: 0.30, shape: 0, bright: 1.0, on: false },
        { x: 0, y: 0, size: 0.30, shape: 0, bright: 1.0, on: false },
        { x: 0, y: 0, size: 0.30, shape: 0, bright: 1.0, on: false },
      ],
      gloss: false, sparkle: false, glisten: false, crossShine: false,
    },
  },
  {
    id: 'big-pupil', name: 'Big pupil', builtIn: true, cfg: {
      pupilFill: 0.85, scleraColor: '#FAFAFF', scleraBright: 1.0, scleraGrad: 0.18,
      pupilColor: '#000000', pupilBright: 1.0, hiColor: '#FFFFFF', hiBright: 1.0,
      outlineColor: '#0A0A10', outlineAlpha: 0.55, outlineWidth: 0.020,
      restX: -0.30, restY: -0.30, sizeMul: 1.0, lidAware: true,
      glints: [
        { x: 0,   y: 0,   size: 1.00, shape: 1, bright: 1.0, on: true  },
        { x: 1.5, y: 1.5, size: 0.45, shape: 0, bright: 1.0, on: true  },
        { x: 0,   y: 0,   size: 0.30, shape: 0, bright: 1.0, on: false },
        { x: 0,   y: 0,   size: 0.30, shape: 0, bright: 1.0, on: false },
      ],
      gloss: false, sparkle: false, glisten: false, crossShine: false,
    },
  },
  {
    id: 'all-pupil', name: 'All pupil', builtIn: true, cfg: {
      pupilFill: 0.910, scleraColor: '#7D7D7D', scleraBright: 1.500, scleraGrad: 0.490,
      pupilColor: '#000000', pupilBright: 1.500, hiColor: '#C9C9C9', hiBright: 1.500,
      outlineColor: '#0A0A10', outlineAlpha: 1.000, outlineWidth: 0.0290,
      restX: 0.090, restY: -0.340, sizeMul: 0.90, lidAware: true,
      mouseTrack: false, manualX: 0.120, manualY: -0.030,
      glints: [
        { x: 0.000,  y:  0.000, size: 0.05, shape: 0, bright: 1.00, on: false },
        { x: 2.008,  y: -0.866, size: 0.48, shape: 0, bright: 0.54, on: true  },
        { x: -0.851, y:  0.629, size: 2.32, shape: 0, bright: 0.54, on: true  },
        { x: 1.118,  y:  1.280, size: 0.30, shape: 0, bright: 1.00, on: false },
      ],
      gloss: false, sparkle: false, glisten: false, crossShine: false,
    },
  },
  {
    id: 'glassy', name: 'Glassy', builtIn: true, cfg: {
      pupilFill: 0.55, scleraColor: '#FAFAFF', scleraBright: 1.0, scleraGrad: 0.30,
      pupilColor: '#020208', pupilBright: 1.0, hiColor: '#FFFFFF', hiBright: 1.0,
      outlineColor: '#0A0A10', outlineAlpha: 0.55, outlineWidth: 0.020,
      restX: -0.32, restY: -0.30, sizeMul: 1.0, lidAware: true,
      glints: [
        { x: 0,   y: 0,   size: 1.00, shape: 1, bright: 1.0, on: true  },
        { x: 1.5, y: 1.5, size: 0.45, shape: 0, bright: 1.0, on: true  },
        { x: 0,   y: 0,   size: 0.30, shape: 0, bright: 1.0, on: false },
        { x: 0,   y: 0,   size: 0.30, shape: 0, bright: 1.0, on: false },
      ],
      gloss: true, sparkle: false, glisten: true, crossShine: true,
    },
  },
  {
    id: 'pinpoint', name: 'Pinpoint', builtIn: true, cfg: {
      pupilFill: 0.18, scleraColor: '#FAFAFF', scleraBright: 1.0, scleraGrad: 0.18,
      pupilColor: '#000000', pupilBright: 1.0, hiColor: '#FFFFFF', hiBright: 1.0,
      outlineColor: '#0A0A10', outlineAlpha: 0.55, outlineWidth: 0.020,
      restX: 0.0, restY: 0.0, sizeMul: 0.9, lidAware: true,
      glints: [
        { x: 0, y: 0, size: 1.00, shape: 0, bright: 1.0, on: true  },
        { x: 0, y: 0, size: 0.30, shape: 0, bright: 1.0, on: false },
        { x: 0, y: 0, size: 0.30, shape: 0, bright: 1.0, on: false },
        { x: 0, y: 0, size: 0.30, shape: 0, bright: 1.0, on: false },
      ],
      gloss: false, sparkle: false, glisten: false, crossShine: false,
    },
  },
  {
    id: 'inverted', name: 'Inverted', builtIn: true, cfg: {
      pupilFill: 0.55, scleraColor: '#0A0A10', scleraBright: 1.0, scleraGrad: 0.0,
      pupilColor: '#FAFAFF', pupilBright: 1.0, hiColor: '#0A0A10', hiBright: 1.0,
      outlineColor: '#FAFAFF', outlineAlpha: 0.65, outlineWidth: 0.020,
      restX: -0.32, restY: -0.30, sizeMul: 1.0, lidAware: true,
      glints: [
        { x: 0,   y: 0,   size: 1.00, shape: 1, bright: 1.0, on: true  },
        { x: 1.5, y: 1.5, size: 0.45, shape: 0, bright: 1.0, on: true  },
        { x: 0,   y: 0,   size: 0.30, shape: 0, bright: 1.0, on: false },
        { x: 0,   y: 0,   size: 0.30, shape: 0, bright: 1.0, on: false },
      ],
      gloss: false, sparkle: false, glisten: false, crossShine: false,
    },
  },
  {
    id: 'classic', name: 'Classic (legacy)', builtIn: true, cfg: {
      pupilFill: 1.00, scleraColor: '#0D0D12', scleraBright: 1.0, scleraGrad: 0.0,
      pupilColor: '#0D0D12', pupilBright: 1.0, hiColor: '#B8B9BD', hiBright: 0.7,
      outlineColor: '#0A0A10', outlineAlpha: 0.0, outlineWidth: 0.020,
      restX: -0.26, restY: -0.14, sizeMul: 1.0, lidAware: true,
      glints: [
        { x: 0,   y: 0,   size: 1.00, shape: 0, bright: 1.0, on: true  },
        { x: 1.8, y: 1.6, size: 0.45, shape: 0, bright: 1.0, on: true  },
        { x: 0,   y: 0,   size: 0.30, shape: 0, bright: 1.0, on: false },
        { x: 0,   y: 0,   size: 0.30, shape: 0, bright: 1.0, on: false },
      ],
      gloss: false, sparkle: false, glisten: false, crossShine: false,
    },
  },
];

const loadEyePresets = () => {
  try {
    const raw = localStorage.getItem(EYE_PRESETS_LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter(p => p && p.id && p.cfg);
    }
  } catch (_) {}
  return [];
};
const saveEyePresets = (userPresets) => {
  try { localStorage.setItem(EYE_PRESETS_LS_KEY, JSON.stringify(userPresets)); } catch (_) {}
};
const allEyePresets = () => [...BUILTIN_EYE_PRESETS, ...loadEyePresets()];

// ── Eye config log block ──────────────────────────────────────
// Diagnostic readout of the entire eye configuration plus a few live
// runtime values. Used in the Setup tab so the operator can copy the
// whole snapshot and paste it back to set new defaults. Two formats:
//   • Pretty (human-readable, sectioned, key=value) — easier to scan
//   • JSON   (a single JSON blob — paste-ready for code defaults)
const EyeConfigLog = ({cfg, livePupil}) => {
  const [fmt, setFmt] = React.useState('pretty');
  const [copied, setCopied] = React.useState(false);
  const fmtNum = (v, d=3) => (v == null || isNaN(+v)) ? String(v) : Number(v).toFixed(d);
  const safeCfg = cfg || {};
  const glints = Array.isArray(safeCfg.glints) ? safeCfg.glints : [];
  const lp = livePupil || {x:0, y:0};

  const prettyText = (() => {
    const lines = [];
    lines.push('# Ghost eye config — full snapshot');
    lines.push('# Paste this back to set as new defaults.');
    lines.push('');
    lines.push('[active preset]');
    lines.push(`  id              = ${safeCfg.activePreset || '(none)'}`);
    lines.push('');
    lines.push('[cluster aim]');
    lines.push(`  mouseTrack      = ${!!safeCfg.mouseTrack}`);
    lines.push(`  manualX         = ${fmtNum(safeCfg.manualX, 3)}`);
    lines.push(`  manualY         = ${fmtNum(safeCfg.manualY, 3)}`);
    lines.push(`  restX           = ${fmtNum(safeCfg.restX, 3)}`);
    lines.push(`  restY           = ${fmtNum(safeCfg.restY, 3)}`);
    lines.push(`  sizeMul         = ${fmtNum(safeCfg.sizeMul, 3)}`);
    lines.push(`  lidAware        = ${!!safeCfg.lidAware}`);
    lines.push('');
    lines.push('[layers — sclera (white-of-eye)]');
    lines.push(`  scleraColor     = ${safeCfg.scleraColor || ''}`);
    lines.push(`  scleraBright    = ${fmtNum(safeCfg.scleraBright, 3)}`);
    lines.push(`  scleraGrad      = ${fmtNum(safeCfg.scleraGrad, 3)}`);
    lines.push('');
    lines.push('[layers — pupil (dark inner)]');
    lines.push(`  pupilFill       = ${fmtNum(safeCfg.pupilFill, 3)}     # 0=tiny, 1=fills entire eye (no sclera)`);
    lines.push(`  pupilColor      = ${safeCfg.pupilColor || ''}`);
    lines.push(`  pupilBright     = ${fmtNum(safeCfg.pupilBright, 3)}`);
    lines.push('');
    lines.push('[layers — highlights]');
    lines.push(`  hiColor         = ${safeCfg.hiColor || ''}`);
    lines.push(`  hiBright        = ${fmtNum(safeCfg.hiBright, 3)}`);
    lines.push('');
    lines.push('[layers — outline]');
    lines.push(`  outlineColor    = ${safeCfg.outlineColor || ''}`);
    lines.push(`  outlineAlpha    = ${fmtNum(safeCfg.outlineAlpha, 3)}`);
    lines.push(`  outlineWidth    = ${fmtNum(safeCfg.outlineWidth, 4)}`);
    lines.push('');
    lines.push('[glints — 4 slots]');
    glints.forEach((g, i) => {
      lines.push(`  glint[${i}]`);
      lines.push(`    on            = ${!!g.on}`);
      lines.push(`    x             = ${fmtNum(g.x, 3)}     # in primary-radius units, -2.5..2.5`);
      lines.push(`    y             = ${fmtNum(g.y, 3)}`);
      lines.push(`    size          = ${fmtNum(g.size, 3)}`);
      lines.push(`    shape         = ${g.shape}     # 0=round 1=oval-tall 2=oval-wide 3=slit 4=heart 5=star 6=crescent`);
      lines.push(`    bright        = ${fmtNum(g.bright, 3)}`);
    });
    lines.push('');
    lines.push('[polish toggles]');
    lines.push(`  gloss           = ${!!safeCfg.gloss}`);
    lines.push(`  sparkle         = ${!!safeCfg.sparkle}`);
    lines.push(`  glisten         = ${!!safeCfg.glisten}`);
    lines.push(`  crossShine      = ${!!safeCfg.crossShine}`);
    lines.push('');
    lines.push('[runtime / live]');
    lines.push(`  livePupilX      = ${fmtNum(lp.x, 3)}`);
    lines.push(`  livePupilY      = ${fmtNum(lp.y, 3)}`);
    lines.push(`  ts              = ${new Date().toISOString()}`);
    return lines.join('\n');
  })();

  const jsonText = JSON.stringify(safeCfg, null, 2);
  const text = fmt === 'pretty' ? prettyText : jsonText;

  const copy = () => {
    try {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } catch (_) {}
  };

  return (
    <div style={{
      display:'flex', flexDirection:'column', gap:6,
    }}>
      {/* Format toggle */}
      <div style={{display:'flex', gap:6}}>
        <button onClick={()=>setFmt('pretty')}
          style={{
            flex:1, padding:'6px 8px', fontSize:10.5,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color: fmt==='pretty' ? 'rgba(238,234,255,1)' : 'rgba(200,205,225,0.55)',
            background: fmt==='pretty' ? 'rgba(122,108,210,0.18)' : 'rgba(255,255,255,0.035)',
            border:'1px solid', borderColor: fmt==='pretty' ? 'rgba(160,150,230,0.45)' : 'rgba(255,255,255,0.07)',
            borderRadius:6, cursor:'pointer',
          }}
        >Pretty</button>
        <button onClick={()=>setFmt('json')}
          style={{
            flex:1, padding:'6px 8px', fontSize:10.5,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color: fmt==='json' ? 'rgba(238,234,255,1)' : 'rgba(200,205,225,0.55)',
            background: fmt==='json' ? 'rgba(122,108,210,0.18)' : 'rgba(255,255,255,0.035)',
            border:'1px solid', borderColor: fmt==='json' ? 'rgba(160,150,230,0.45)' : 'rgba(255,255,255,0.07)',
            borderRadius:6, cursor:'pointer',
          }}
        >JSON</button>
        <button onClick={copy}
          title="Copy log to clipboard"
          style={{
            padding:'6px 12px', fontSize:10.5,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color: copied ? 'rgba(67,201,138,1)' : 'rgba(108,99,255,0.95)',
            background: copied ? 'rgba(67,201,138,0.12)' : 'rgba(108,99,255,0.10)',
            border:`1px solid ${copied ? 'rgba(67,201,138,0.45)' : 'rgba(108,99,255,0.45)'}`,
            borderRadius:6, cursor:'pointer',
            transition:'all 140ms ease',
          }}
        >{copied ? '✓ Copied' : '⎘ Copy'}</button>
      </div>
      {/* Log block — read-only, selectable, scrollable */}
      <textarea
        readOnly
        value={text}
        onClick={e=>e.target.select()}
        spellCheck={false}
        style={{
          width:'100%', boxSizing:'border-box',
          minHeight:240, maxHeight:360,
          padding:10,
          fontSize:10, lineHeight:1.45,
          fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',
          color:'rgba(220,225,240,0.92)',
          background:'rgba(0,0,0,0.32)',
          border:'1px solid rgba(108,99,255,0.18)',
          borderRadius:8,
          resize:'vertical',
          whiteSpace:'pre',
          overflow:'auto',
        }}
      />
      <div style={{fontSize:9.5, color:'rgba(160,165,185,0.45)', lineHeight:1.5}}>
        Tip — paste this into chat and ask for these values to be set as the new built-in defaults. JSON format goes straight into the preset library.
      </div>
    </div>
  );
};

// ── Eye editor (5-tab dashboard popup panel) ──────────────────
// Tabs: Style / Aim / Effects / Setup / Presets.
// Style — per-glint editor (drag dots on the eye preview, edit each
//         glint's shape/size/brightness/on individually) + cluster size.
// Aim — mouse-track vs manual + XY pad for the cluster centre.
// Effects — colors and brightness for sclera / pupil / highlights /
//           outline + the gloss/sparkle/glisten/cross-shine toggles.
// Setup — pupil fill (0..1, slider that includes the "all pupil" mode
//         when at 1.0), rest position, lid-awareness toggle.
// Presets — built-in + user-saved eye types: apply / save / rename /
//           delete / duplicate / import-export.
const GhostEyesEditor = ({ctlRef}) => {
  // Local mirror of the controller's eye config. Pulled on mount,
  // pushed on every change. The dashboard renders from this state so
  // the UI is always reactive to slider drags.
  const [cfg, setCfgState] = React.useState(() => ({}));
  const [eyeSubTab, setEyeSubTab] = React.useState('style');
  const [livePupil, setLivePupil] = React.useState({x:0, y:0});
  // Selected glint index in the per-glint editor (Style tab).
  const [selGlint, setSelGlint] = React.useState(0);
  const [presets, setPresets] = React.useState(() => allEyePresets());
  const padRef = React.useRef(null);
  const padDragRef = React.useRef(false);
  const eyePadRef = React.useRef(null);
  const eyePadDragRef = React.useRef({active:false, idx:-1});

  // Initial sync from controller.
  React.useEffect(() => {
    const c = ctlRef.current;
    if (c && c.getEyeCfg) {
      const got = c.getEyeCfg();
      if (got) setCfgState(got);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push to controller whenever cfg changes. Wrapper updates state + ctl.
  const pushCfg = React.useCallback((patch) => {
    setCfgState(prev => {
      const next = {...prev, ...patch};
      const c = ctlRef.current;
      if (c && c.setEyeCfg) c.setEyeCfg(patch);
      return next;
    });
  }, [ctlRef]);
  // Patch a single glint by index.
  const pushGlint = React.useCallback((idx, patch) => {
    setCfgState(prev => {
      const cur = (prev.glints || []).slice();
      cur[idx] = {...(cur[idx] || {}), ...patch};
      const next = {...prev, glints: cur};
      const c = ctlRef.current;
      if (c && c.setEyeCfg) c.setEyeCfg({glints: cur});
      return next;
    });
  }, [ctlRef]);

  // Live pupil polling — ~30Hz so the live readout is responsive.
  React.useEffect(() => {
    const id = setInterval(() => {
      const c = ctlRef.current;
      if (c && c.getPupilLive) {
        const p = c.getPupilLive();
        if (p) setLivePupil(p);
      }
    }, 33);
    return () => clearInterval(id);
  }, [ctlRef]);

  // ── XY pad (Aim tab) ───────────────────────────────────────
  const onPadPointer = (e) => {
    if (cfg.mouseTrack) return;
    const r = padRef.current && padRef.current.getBoundingClientRect();
    if (!r) return;
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top)  / r.height;
    pushCfg({
      manualX: Math.max(-1, Math.min(1, u * 2 - 1)),
      manualY: Math.max(-1, Math.min(1, -(v * 2 - 1))),
    });
  };
  const onPadDown = (e) => {
    if (cfg.mouseTrack) return;
    e.preventDefault();
    padDragRef.current = true;
    onPadPointer(e);
    const move = (ev) => { if (padDragRef.current) onPadPointer(ev); };
    const up = () => {
      padDragRef.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── Per-glint preview pad (Style tab) ──────────────────────
  // Maps pad space (0..1) to glint coordinates (-2.5..2.5 hr1 units).
  const PAD_RANGE = 2.5;
  const glintPadCoords = (e) => {
    const r = eyePadRef.current && eyePadRef.current.getBoundingClientRect();
    if (!r) return null;
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top)  / r.height;
    return {
      x: Math.max(-PAD_RANGE, Math.min(PAD_RANGE, (u * 2 - 1) * PAD_RANGE)),
      y: Math.max(-PAD_RANGE, Math.min(PAD_RANGE, (v * 2 - 1) * PAD_RANGE)),
    };
  };
  const onEyePadDown = (e, idx) => {
    e.preventDefault();
    e.stopPropagation();
    eyePadDragRef.current = {active:true, idx};
    setSelGlint(idx);
    const move = (ev) => {
      if (!eyePadDragRef.current.active) return;
      const c = glintPadCoords(ev);
      if (c) pushGlint(eyePadDragRef.current.idx, c);
    };
    const up = () => {
      eyePadDragRef.current = {active:false, idx:-1};
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const SHAPES = [
    { id: 0, label: 'Round'    },
    { id: 1, label: 'Oval-tall'},
    { id: 2, label: 'Oval-wide'},
    { id: 3, label: 'Slit'     },
    { id: 4, label: 'Heart'    },
    { id: 5, label: 'Star'     },
    { id: 6, label: 'Crescent' },
  ];

  const baseBtn = {
    flex:'1 1 calc(50% - 6px)', minWidth:0,
    padding:'8px 9px', fontSize:11,
    fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',
    letterSpacing:'0.02em',
    color:'rgba(225,228,240,0.90)',
    background:'rgba(255,255,255,0.035)',
    border:'1px solid rgba(255,255,255,0.07)',
    borderRadius:8, cursor:'pointer',
    textAlign:'left',
    display:'flex', flexDirection:'column', gap:2,
  };
  const activeBtn = {
    ...baseBtn,
    background:'linear-gradient(135deg, rgba(122,108,210,0.25), rgba(86,72,168,0.18))',
    border:'1px solid rgba(160,150,230,0.45)',
    color:'rgba(238,234,255,1)',
  };
  const sectionLabel = {
    fontSize:10.5, color:'rgba(180,185,205,0.55)',
    letterSpacing:'0.06em', textTransform:'uppercase',
    padding:'4px 0 2px',
  };
  const sectionLabelTop = {
    ...sectionLabel,
    padding:'10px 0 4px', borderTop:'1px solid rgba(255,255,255,0.05)',
  };
  const hint = { fontSize:10, color:'rgba(180,185,205,0.45)', lineHeight:1.45 };
  const sliderRow = (label, value, decimals, min, max, step, onChange, suffix='') => (
    <div style={{display:'flex', flexDirection:'column', gap:5, marginTop:4}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span style={{fontSize:11, color:'rgba(190,195,215,0.75)', fontFamily:'ui-monospace,monospace'}}>{label}</span>
        <span style={{fontSize:11, fontFamily:'ui-monospace,monospace', color:'rgba(238,234,255,1)', fontWeight:600}}>{Number(value).toFixed(decimals)}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{width:'100%', accentColor:'rgba(122,108,210,0.9)'}}
        onChange={e=>onChange(parseFloat(e.target.value))}/>
    </div>
  );
  const colorRow = (label, value, onChange) => (
    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, padding:'4px 0'}}>
      <span style={{fontSize:11, color:'rgba(190,195,215,0.75)', fontFamily:'ui-monospace,monospace'}}>{label}</span>
      <div style={{display:'flex', alignItems:'center', gap:6}}>
        <input type="color" value={value || '#FFFFFF'}
          onChange={e=>onChange(e.target.value)}
          style={{width:32, height:24, border:'1px solid rgba(255,255,255,0.08)', borderRadius:6, padding:0, cursor:'pointer', background:'transparent'}}/>
        <span style={{fontSize:10, fontFamily:'ui-monospace,monospace', color:'rgba(190,195,215,0.55)'}}>{(value || '').toUpperCase()}</span>
      </div>
    </div>
  );

  const SUB_TABS = [
    { id:'style',   label:'Style'   },
    { id:'aim',     label:'Aim'     },
    { id:'effects', label:'Effects' },
    { id:'setup',   label:'Setup'   },
    { id:'presets', label:'Presets' },
  ];

  // Pad indicator position in pad space (0..1).
  const padDotU = (livePupil.x + 1) / 2;
  const padDotV = (1 - (livePupil.y + 1) / 2);

  // ── Preset actions ─────────────────────────────────────────
  const refreshPresets = () => setPresets(allEyePresets());
  const applyPreset = (preset) => {
    if (!preset || !preset.cfg) return;
    pushCfg({...preset.cfg, activePreset: preset.id});
  };
  const saveCurrentAsPreset = () => {
    const name = window.prompt('Name this eye type:', 'My eye');
    if (!name) return;
    const cur = loadEyePresets();
    const id = 'u-' + Date.now();
    const snap = {
      pupilFill: cfg.pupilFill, scleraColor: cfg.scleraColor, scleraBright: cfg.scleraBright,
      scleraGrad: cfg.scleraGrad, pupilColor: cfg.pupilColor, pupilBright: cfg.pupilBright,
      hiColor: cfg.hiColor, hiBright: cfg.hiBright, outlineColor: cfg.outlineColor,
      outlineAlpha: cfg.outlineAlpha, outlineWidth: cfg.outlineWidth,
      restX: cfg.restX, restY: cfg.restY, sizeMul: cfg.sizeMul, lidAware: cfg.lidAware,
      glints: (cfg.glints || []).map(g => ({...g})),
      gloss: cfg.gloss, sparkle: cfg.sparkle, glisten: cfg.glisten, crossShine: cfg.crossShine,
    };
    cur.push({id, name, cfg: snap});
    saveEyePresets(cur);
    pushCfg({activePreset: id});
    refreshPresets();
  };
  const renamePreset = (preset) => {
    if (preset.builtIn) return;
    const name = window.prompt('Rename preset:', preset.name);
    if (!name) return;
    const cur = loadEyePresets();
    const idx = cur.findIndex(p => p.id === preset.id);
    if (idx >= 0) { cur[idx].name = name; saveEyePresets(cur); refreshPresets(); }
  };
  const deletePreset = (preset) => {
    if (preset.builtIn) return;
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return;
    const cur = loadEyePresets().filter(p => p.id !== preset.id);
    saveEyePresets(cur);
    refreshPresets();
  };
  const duplicatePreset = (preset) => {
    const name = window.prompt('Name the copy:', preset.name + ' copy');
    if (!name) return;
    const cur = loadEyePresets();
    cur.push({id:'u-'+Date.now(), name, cfg: JSON.parse(JSON.stringify(preset.cfg))});
    saveEyePresets(cur);
    refreshPresets();
  };
  const exportPreset = (preset) => {
    const txt = JSON.stringify(preset, null, 2);
    try {
      navigator.clipboard.writeText(txt)
        .then(() => bcToast('Preset copied', 'ok', { detail: preset && preset.name ? preset.name : undefined }))
        .catch(() => bcToast('Couldn’t copy the preset', 'err'));
    } catch(_) { bcToast('Couldn’t copy the preset', 'err'); }
  };
  const importPresetFromClipboard = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      const o = JSON.parse(txt);
      if (!o || !o.cfg) { bcToast('The clipboard doesn’t contain a preset', 'warn'); return; }
      const cur = loadEyePresets();
      cur.push({id:'u-'+Date.now(), name: o.name || 'Imported', cfg: o.cfg});
      saveEyePresets(cur);
      refreshPresets();
      bcToast('Preset imported', 'ok', { detail: o.name || undefined });
    } catch (e) {
      bcToast('Couldn’t import a preset from the clipboard', 'err');
    }
  };

  return (
    <>
      <div style={{
        fontSize:10.5, color:'rgba(180,185,205,0.55)',
        letterSpacing:'0.06em', textTransform:'uppercase',
        paddingBottom:4,
      }}>Eye design</div>
      <div style={{...hint, paddingBottom:6}}>
        Real 4-layer eye: sclera, pupil, highlights, outline. Each layer has its own colour and brightness. Drop pupil fill to 100% for the no-sclera look, or build any face from scratch in the Style tab.
      </div>

      {/* Sub-tab nav */}
      <div style={{display:'flex', gap:4, paddingBottom:2}}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={()=>setEyeSubTab(t.id)}
            style={{
              flex:1, padding:'6px 4px',
              fontSize:10, letterSpacing:'0.04em', textTransform:'uppercase',
              color: eyeSubTab===t.id ? 'rgba(238,234,255,1)' : 'rgba(200,205,225,0.55)',
              background: eyeSubTab===t.id ? 'rgba(122,108,210,0.18)' : 'transparent',
              border:'1px solid', borderColor: eyeSubTab===t.id ? 'rgba(160,150,230,0.45)' : 'rgba(255,255,255,0.06)',
              borderRadius:7, cursor:'pointer',
              transition:'background 140ms ease, color 140ms ease, border-color 140ms ease',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ────────────────  STYLE TAB  ──────────────── */}
      {eyeSubTab === 'style' && (
        <>
          <div style={sectionLabel}>Per-glint editor</div>
          <div style={{...hint, paddingBottom:4}}>Drag any dot to position it. The numbered dots are the four highlight slots — toggle them on/off, change their shape, size, and brightness below.</div>

          {/* Eye preview pad — shows pupil + 4 draggable glints. */}
          <div
            ref={eyePadRef}
            style={{
              position:'relative',
              aspectRatio:'1 / 1',
              background:'radial-gradient(circle at 50% 50%, rgba(252,252,255,0.10) 0%, rgba(252,252,255,0.06) 38%, rgba(0,0,0,0) 60%)',
              border:'1px solid rgba(108,99,255,0.20)',
              borderRadius:'50%',
              cursor:'crosshair',
              overflow:'hidden',
              userSelect:'none', touchAction:'none',
            }}
          >
            {/* Sclera disc (just the outline, the real one is rendered by the ghost) */}
            <div style={{
              position:'absolute', inset:'4%', borderRadius:'50%',
              background: cfg.scleraColor || '#FAFAFF',
              opacity: 0.85,
            }}/>
            {/* Pupil disc, sized by pupilFill */}
            <div style={{
              position:'absolute', left:'50%', top:'50%',
              width:`${(cfg.pupilFill != null ? cfg.pupilFill : 0.55) * 88}%`,
              height:`${(cfg.pupilFill != null ? cfg.pupilFill : 0.55) * 88}%`,
              transform:'translate(-50%, -50%)',
              borderRadius:'50%',
              background: cfg.pupilColor || '#000000',
            }}/>
            {/* Crosshair guides */}
            <div style={{position:'absolute', left:0, right:0, top:'50%', height:1, background:'rgba(166,149,224,0.18)'}}/>
            <div style={{position:'absolute', top:0, bottom:0, left:'50%', width:1, background:'rgba(166,149,224,0.18)'}}/>
            {/* The 4 draggable glint dots */}
            {(cfg.glints || []).map((g, i) => {
              const u = (g.x / PAD_RANGE) / 2 + 0.5;
              const v = (g.y / PAD_RANGE) / 2 + 0.5;
              const active = i === selGlint;
              return (
                <div key={i}
                  onPointerDown={e=>onEyePadDown(e, i)}
                  title={`Glint ${i+1}${g.on?'':' (off)'}`}
                  style={{
                    position:'absolute',
                    left:`calc(${(u*100).toFixed(2)}% - 11px)`,
                    top: `calc(${(v*100).toFixed(2)}% - 11px)`,
                    width:22, height:22, borderRadius:'50%',
                    background: g.on ? (cfg.hiColor || '#FFFFFF') : 'rgba(80,80,90,0.55)',
                    border: active ? '2px solid rgba(166,149,224,1)' : '1.5px solid rgba(0,0,0,0.65)',
                    boxShadow: active ? '0 0 10px rgba(166,149,224,0.7)' : '0 0 4px rgba(0,0,0,0.35)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:10, fontWeight:700, color: g.on ? '#000' : '#fff',
                    cursor:'grab', touchAction:'none',
                  }}
                >{i+1}</div>
              );
            })}
          </div>

          {/* Glint slot selector */}
          <div style={{display:'flex', gap:6, marginTop:8}}>
            {(cfg.glints || []).map((g, i) => (
              <button key={i} onClick={()=>setSelGlint(i)}
                style={{
                  flex:1, padding:'6px 4px', fontSize:10.5,
                  letterSpacing:'0.04em', textTransform:'uppercase',
                  color: i===selGlint ? 'rgba(238,234,255,1)' : 'rgba(200,205,225,0.55)',
                  background: i===selGlint ? 'rgba(122,108,210,0.18)' : 'rgba(255,255,255,0.035)',
                  border:'1px solid', borderColor: i===selGlint ? 'rgba(160,150,230,0.45)' : 'rgba(255,255,255,0.07)',
                  borderRadius:7, cursor:'pointer',
                  opacity: g.on ? 1 : 0.55,
                }}
              >Glint {i+1}{g.on?'':' ◌'}</button>
            ))}
          </div>

          {/* Selected glint controls */}
          {(() => {
            const g = (cfg.glints || [])[selGlint] || {};
            const patch = (p) => pushGlint(selGlint, p);
            return (
              <div style={{
                marginTop:8, padding:'10px 11px', borderRadius:8,
                background:'rgba(0,0,0,0.18)',
                border:'1px solid rgba(255,255,255,0.06)',
                display:'flex', flexDirection:'column', gap:6,
              }}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <span style={{fontSize:10, color:'rgba(108,99,255,0.7)', letterSpacing:'0.06em'}}>GLINT {selGlint+1}</span>
                  <button onClick={()=>patch({on: !g.on})}
                    style={{
                      padding:'4px 10px', fontSize:10.5,
                      fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
                      color: g.on ? 'rgba(67,201,138,1)' : 'rgba(200,205,225,0.55)',
                      background: g.on ? 'rgba(67,201,138,0.12)' : 'rgba(255,255,255,0.03)',
                      border:`1px solid ${g.on ? 'rgba(67,201,138,0.45)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius:6, cursor:'pointer',
                    }}
                  >{g.on ? '● ON' : '○ OFF'}</button>
                </div>
                {sliderRow('Size',       g.size   != null ? g.size   : 1,  2, 0.05, 2.5, 0.01, v=>patch({size:v}), '×')}
                {sliderRow('Brightness', g.bright != null ? g.bright : 1,  2, 0,    1.5, 0.01, v=>patch({bright:v}))}
                <div style={{...sectionLabel, padding:'4px 0 2px'}}>Shape</div>
                <div style={{display:'flex', flexWrap:'wrap', gap:5}}>
                  {SHAPES.map(s => (
                    <button key={s.id} onClick={()=>patch({shape: s.id})}
                      style={{
                        flex:'1 1 calc(33% - 5px)', minWidth:0,
                        padding:'5px 6px', fontSize:10.5,
                        fontFamily:'ui-monospace,monospace',
                        color: g.shape === s.id ? 'rgba(238,234,255,1)' : 'rgba(200,205,225,0.7)',
                        background: g.shape === s.id ? 'rgba(122,108,210,0.18)' : 'rgba(255,255,255,0.035)',
                        border:'1px solid', borderColor: g.shape === s.id ? 'rgba(160,150,230,0.45)' : 'rgba(255,255,255,0.07)',
                        borderRadius:6, cursor:'pointer',
                      }}
                    >{s.label}</button>
                  ))}
                </div>
                <div style={{display:'flex', gap:6, marginTop:4}}>
                  <button onClick={()=>patch({x:0, y:0})}
                    style={{
                      flex:1, padding:'6px 8px', fontSize:10.5,
                      fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
                      color:'rgba(225,228,240,0.85)',
                      background:'rgba(255,255,255,0.04)',
                      border:'1px solid rgba(255,255,255,0.08)',
                      borderRadius:6, cursor:'pointer',
                    }}
                  >Centre</button>
                  <button onClick={()=>{
                    const i = selGlint;
                    pushGlint(i, {x:0, y:0, size: i===0?1:0.4, shape:0, bright:1, on: i<2});
                  }}
                    style={{
                      flex:1, padding:'6px 8px', fontSize:10.5,
                      fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
                      color:'rgba(225,228,240,0.85)',
                      background:'rgba(255,255,255,0.04)',
                      border:'1px solid rgba(255,255,255,0.08)',
                      borderRadius:6, cursor:'pointer',
                    }}
                  >Reset slot</button>
                </div>
              </div>
            );
          })()}

          {sliderRow('Cluster size', cfg.sizeMul != null ? cfg.sizeMul : 1, 2, 0.20, 1.80, 0.01, v=>pushCfg({sizeMul:v}), '×')}
        </>
      )}

      {/* ────────────────  AIM TAB  ──────────────── */}
      {eyeSubTab === 'aim' && (
        <>
          <div style={sectionLabel}>Cluster aim</div>
          <div style={{display:'flex', gap:6}}>
            <button onClick={()=>pushCfg({mouseTrack: true})}
              style={cfg.mouseTrack ? activeBtn : baseBtn}>
              <span style={{fontSize:11.5, fontWeight:600}}>◉ Track mouse</span>
              <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>Highlights follow cursor</span>
            </button>
            <button onClick={()=>pushCfg({mouseTrack: false})}
              style={!cfg.mouseTrack ? activeBtn : baseBtn}>
              <span style={{fontSize:11.5, fontWeight:600}}>✋ Manual</span>
              <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>Drag pad below</span>
            </button>
          </div>

          {/* XY pad — manual cluster control */}
          <div
            ref={padRef}
            onPointerDown={onPadDown}
            style={{
              position:'relative',
              aspectRatio:'1.4 / 1',
              background:'rgba(0,0,0,0.30)',
              border:'1px solid rgba(108,99,255,0.20)',
              borderRadius:8,
              cursor: cfg.mouseTrack ? 'not-allowed' : 'crosshair',
              opacity: cfg.mouseTrack ? 0.55 : 1,
              touchAction:'none', userSelect:'none',
              overflow:'hidden',
              marginTop:8,
            }}
          >
            <div style={{position:'absolute', left:0, right:0, top:'50%', height:1, background:'rgba(166,149,224,0.22)'}}/>
            <div style={{position:'absolute', top:0, bottom:0, left:'50%', width:1, background:'rgba(166,149,224,0.22)'}}/>
            <div style={{
              position:'absolute',
              left:`calc(${(padDotU * 100).toFixed(2)}% - 6px)`,
              top: `calc(${(padDotV * 100).toFixed(2)}% - 6px)`,
              width:12, height:12, borderRadius:'50%',
              background:'rgba(238,234,255,0.95)',
              boxShadow:'0 0 8px rgba(166,149,224,0.55)',
              pointerEvents:'none',
            }}/>
            <div style={{
              position:'absolute', left:7, top:5,
              fontSize:9, color:'rgba(180,185,205,0.45)',
              letterSpacing:'0.06em', textTransform:'uppercase',
              pointerEvents:'none',
            }}>{cfg.mouseTrack ? 'tracking' : 'drag to aim'}</div>
          </div>

          <div style={{
            padding:'8px 11px', borderRadius:8,
            background:'rgba(0,0,0,0.28)',
            border:'1px solid rgba(108,99,255,0.18)',
            fontFamily:'ui-monospace,monospace', fontSize:10,
            color:'rgba(190,195,215,0.85)', lineHeight:1.7,
            userSelect:'text', cursor:'text',
            display:'flex', justifyContent:'space-between', gap:8,
            marginTop:6,
          }}>
            <span style={{color:'rgba(108,99,255,0.7)', letterSpacing:'0.06em'}}>LIVE</span>
            <span><span style={{color:'rgba(108,99,255,0.7)'}}>X</span> {livePupil.x.toFixed(3)}</span>
            <span><span style={{color:'rgba(108,99,255,0.7)'}}>Y</span> {livePupil.y.toFixed(3)}</span>
          </div>

          {!cfg.mouseTrack && (
            <div style={{
              padding:'10px 11px', borderRadius:8,
              background:'rgba(0,0,0,0.18)',
              border:'1px solid rgba(255,255,255,0.06)',
              display:'flex', flexDirection:'column', gap:7,
              marginTop:6,
            }}>
              <div style={{fontSize:9.5, color:'rgba(108,99,255,0.7)', letterSpacing:'0.08em'}}>MANUAL POSITION</div>
              {sliderRow('Manual X', cfg.manualX != null ? cfg.manualX : 0, 2, -1, 1, 0.01, v=>pushCfg({manualX:v}))}
              {sliderRow('Manual Y', cfg.manualY != null ? cfg.manualY : 0, 2, -1, 1, 0.01, v=>pushCfg({manualY:v}))}
              <button onClick={()=>pushCfg({manualX:0, manualY:0})}
                style={{
                  padding:'7px 9px', fontSize:10.5,
                  fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
                  color:'rgba(225,228,240,0.85)',
                  background:'rgba(255,255,255,0.04)',
                  border:'1px solid rgba(255,255,255,0.08)',
                  borderRadius:6, cursor:'pointer',
                }}
              >Centre cluster</button>
            </div>
          )}
        </>
      )}

      {/* ────────────────  EFFECTS TAB  ──────────────── */}
      {eyeSubTab === 'effects' && (
        <>
          <div style={{...hint, paddingBottom:4}}>Colour and brightness for every layer of the eye. The whole eye disc is the sclera; the pupil sits inside it; highlights sit inside the pupil; the outline rims the whole thing.</div>

          <div style={sectionLabel}>Sclera (white-of-eye)</div>
          {colorRow('Colour',     cfg.scleraColor || '#FAFAFF', v=>pushCfg({scleraColor:v}))}
          {sliderRow('Brightness', cfg.scleraBright != null ? cfg.scleraBright : 1, 2, 0, 1.5, 0.01, v=>pushCfg({scleraBright:v}))}
          {sliderRow('Depth gradient', cfg.scleraGrad != null ? cfg.scleraGrad : 0.18, 2, 0, 1, 0.01, v=>pushCfg({scleraGrad:v}))}

          <div style={sectionLabelTop}>Pupil (dark inner)</div>
          {colorRow('Colour',     cfg.pupilColor || '#000000', v=>pushCfg({pupilColor:v}))}
          {sliderRow('Brightness', cfg.pupilBright != null ? cfg.pupilBright : 1, 2, 0, 1.5, 0.01, v=>pushCfg({pupilBright:v}))}

          <div style={sectionLabelTop}>Highlights</div>
          {colorRow('Colour',     cfg.hiColor || '#FFFFFF', v=>pushCfg({hiColor:v}))}
          {sliderRow('Brightness', cfg.hiBright != null ? cfg.hiBright : 1, 2, 0, 1.5, 0.01, v=>pushCfg({hiBright:v}))}

          <div style={sectionLabelTop}>Outline (rim)</div>
          {colorRow('Colour',     cfg.outlineColor || '#0A0A10', v=>pushCfg({outlineColor:v}))}
          {sliderRow('Opacity',    cfg.outlineAlpha != null ? cfg.outlineAlpha : 0.55, 2, 0, 1, 0.01, v=>pushCfg({outlineAlpha:v}))}
          {sliderRow('Width',      cfg.outlineWidth != null ? cfg.outlineWidth : 0.020, 3, 0, 0.05, 0.001, v=>pushCfg({outlineWidth:v}))}

          <div style={sectionLabelTop}>Polish layers</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
            <button onClick={()=>pushCfg({gloss: !cfg.gloss})} style={cfg.gloss ? activeBtn : baseBtn}>
              <span style={{fontSize:11.5, fontWeight:600}}>◐ Top gloss</span>
              <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>Crescent shine strip</span>
            </button>
            <button onClick={()=>pushCfg({sparkle: !cfg.sparkle})} style={cfg.sparkle ? activeBtn : baseBtn}>
              <span style={{fontSize:11.5, fontWeight:600}}>✦ Sparkle stars</span>
              <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>Animated 4-point twinkle</span>
            </button>
            <button onClick={()=>pushCfg({glisten: !cfg.glisten})} style={cfg.glisten ? activeBtn : baseBtn}>
              <span style={{fontSize:11.5, fontWeight:600}}>◌ Glisten</span>
              <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>Subtle pulse on glints</span>
            </button>
            <button onClick={()=>pushCfg({crossShine: !cfg.crossShine})} style={cfg.crossShine ? activeBtn : baseBtn}>
              <span style={{fontSize:11.5, fontWeight:600}}>✚ Cross-shine</span>
              <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>Diamond spike through primary</span>
            </button>
          </div>
        </>
      )}

      {/* ────────────────  SETUP TAB  ──────────────── */}
      {eyeSubTab === 'setup' && (
        <>
          <div style={sectionLabel}>Pupil fill</div>
          <div style={{...hint, paddingBottom:4}}>0% = tiny pinprick pupil with maximum sclera. 100% = pupil fills the entire eye (no white visible — the "all pupil" mode). Drag freely.</div>
          {sliderRow('Fill',
            cfg.pupilFill != null ? cfg.pupilFill : 0.55,
            2, 0, 1, 0.01,
            v => pushCfg({pupilFill: v}),
            ` (${Math.round((cfg.pupilFill != null ? cfg.pupilFill : 0.55) * 100)}%)`.replace(/^.{4}/,'')
          )}

          <div style={sectionLabelTop}>Default position (rest)</div>
          <div style={{...hint, paddingBottom:4}}>Where the highlight cluster sits when the cursor is centred / Manual XY is zero.</div>
          {sliderRow('Rest X', cfg.restX != null ? cfg.restX : -0.32, 2, -1, 1, 0.01, v=>pushCfg({restX:v}))}
          {sliderRow('Rest Y', cfg.restY != null ? cfg.restY : -0.30, 2, -1, 1, 0.01, v=>pushCfg({restY:v}))}
          <button onClick={()=>pushCfg({restX: -0.32, restY: -0.30})}
            style={{
              padding:'7px 9px', fontSize:10.5,
              fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
              color:'rgba(225,228,240,0.85)',
              background:'rgba(255,255,255,0.04)',
              border:'1px solid rgba(255,255,255,0.08)',
              borderRadius:6, cursor:'pointer', marginTop:2,
            }}
          >Reset rest (default)</button>

          <div style={sectionLabelTop}>Lid awareness</div>
          <div style={{display:'flex', gap:6}}>
            <button onClick={()=>pushCfg({lidAware: true})}
              style={cfg.lidAware ? activeBtn : baseBtn}>
              <span style={{fontSize:11.5, fontWeight:600}}>👁 Soft-fade</span>
              <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>Glints fade near lids</span>
            </button>
            <button onClick={()=>pushCfg({lidAware: false})}
              style={!cfg.lidAware ? activeBtn : baseBtn}>
              <span style={{fontSize:11.5, fontWeight:600}}>✂ Hard clip</span>
              <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>Original behaviour</span>
            </button>
          </div>

          <div style={sectionLabelTop}>Reset</div>
          <button onClick={()=>{
            if (window.confirm('Reset all eye settings to defaults?')) {
              const c = ctlRef.current;
              if (c && c.setEyeCfg) {
                // Apply the All-pupil built-in (the new tuned default).
                const def = BUILTIN_EYE_PRESETS.find(p => p.id === 'all-pupil');
                if (def) {
                  c.setEyeCfg({...def.cfg, activePreset:'all-pupil'});
                  setCfgState(c.getEyeCfg ? c.getEyeCfg() : {});
                }
              }
            }
          }}
            style={{
              width:'100%', padding:'9px 10px', fontSize:11,
              fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
              color:'rgba(255,180,180,0.85)',
              background:'rgba(180,60,60,0.08)',
              border:'1px solid rgba(180,60,60,0.30)',
              borderRadius:8, cursor:'pointer',
            }}
          >Reset everything to All-pupil default</button>

          {/* ── Log / diagnostics ───────────────────────────── */}
          <div style={sectionLabelTop}>Config log</div>
          <div style={{...hint, paddingBottom:4}}>
            Full snapshot of every eye setting. Copy this and paste it back to set new defaults — every value the shader uses lives here.
          </div>
          <EyeConfigLog cfg={cfg} livePupil={livePupil}/>
        </>
      )}

      {/* ────────────────  PRESETS TAB  ──────────────── */}
      {eyeSubTab === 'presets' && (
        <>
          <div style={{...hint, paddingBottom:4}}>Tap to apply. Built-ins are read-only — duplicate to edit. Save the current look as your own preset to come back to it later.</div>

          <div style={{display:'flex', gap:6, paddingBottom:6}}>
            <button onClick={saveCurrentAsPreset}
              style={{
                flex:1, padding:'8px 10px', fontSize:11,
                fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
                color:'rgba(108,99,255,0.95)',
                background:'rgba(108,99,255,0.10)',
                border:'1px solid rgba(108,99,255,0.45)',
                borderRadius:8, cursor:'pointer',
              }}
            >＋ Save current as preset</button>
            <button onClick={importPresetFromClipboard} title="Paste preset JSON from clipboard"
              style={{
                padding:'8px 10px', fontSize:11,
                fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
                color:'rgba(225,228,240,0.85)',
                background:'rgba(255,255,255,0.04)',
                border:'1px solid rgba(255,255,255,0.08)',
                borderRadius:8, cursor:'pointer',
              }}
            >⇣ Import</button>
          </div>

          <div style={{
            display:'grid', gap:6,
            gridTemplateColumns:'repeat(auto-fill, minmax(120px, 1fr))',
          }}>
            {presets.map(p => {
              const active = cfg.activePreset === p.id;
              return (
                <div key={p.id}
                  style={{
                    padding:8, borderRadius:8,
                    background: active ? 'rgba(122,108,210,0.18)' : 'rgba(255,255,255,0.035)',
                    border:'1px solid', borderColor: active ? 'rgba(160,150,230,0.55)' : 'rgba(255,255,255,0.07)',
                    display:'flex', flexDirection:'column', gap:4,
                  }}
                >
                  {/* Preview swatch */}
                  <div onClick={()=>applyPreset(p)}
                    title={`Apply ${p.name}`}
                    style={{
                      position:'relative', height:46, borderRadius:6,
                      background:'rgba(0,0,0,0.30)',
                      border:'1px solid rgba(255,255,255,0.06)',
                      overflow:'hidden', cursor:'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                    }}
                  >
                    {[0,1].map(side => {
                      const fill = p.cfg.pupilFill != null ? p.cfg.pupilFill : 0.55;
                      const sclera = p.cfg.scleraColor || '#FAFAFF';
                      const pupil = p.cfg.pupilColor || '#000000';
                      const hi = p.cfg.hiColor || '#FFFFFF';
                      return (
                        <div key={side} style={{
                          width:20, height:24, borderRadius:'50%',
                          background: sclera,
                          position:'relative', overflow:'hidden',
                        }}>
                          <div style={{
                            position:'absolute', left:'50%', top:'50%',
                            width: `${fill*92}%`, height: `${fill*92}%`,
                            transform:'translate(-50%, -50%)',
                            borderRadius:'50%', background: pupil,
                          }}/>
                          <div style={{
                            position:'absolute', left:'30%', top:'25%',
                            width:5, height:6, borderRadius:'50%',
                            background: hi,
                          }}/>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{
                    fontSize:11, fontWeight:600,
                    color:'rgba(238,234,255,0.95)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                  }}>{p.name}</div>
                  <div style={{display:'flex', gap:4}}>
                    <button onClick={()=>applyPreset(p)}
                      style={{
                        flex:1, padding:'4px 6px', fontSize:9.5,
                        fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
                        color:'rgba(225,228,240,0.90)',
                        background:'rgba(255,255,255,0.04)',
                        border:'1px solid rgba(255,255,255,0.08)',
                        borderRadius:5, cursor:'pointer',
                      }}
                    >APPLY</button>
                    <button onClick={()=>duplicatePreset(p)} title="Duplicate"
                      style={{
                        padding:'4px 6px', fontSize:9.5,
                        color:'rgba(225,228,240,0.75)',
                        background:'rgba(255,255,255,0.03)',
                        border:'1px solid rgba(255,255,255,0.08)',
                        borderRadius:5, cursor:'pointer',
                      }}
                    >⎘</button>
                    <button onClick={()=>exportPreset(p)} title="Export to clipboard"
                      style={{
                        padding:'4px 6px', fontSize:9.5,
                        color:'rgba(225,228,240,0.75)',
                        background:'rgba(255,255,255,0.03)',
                        border:'1px solid rgba(255,255,255,0.08)',
                        borderRadius:5, cursor:'pointer',
                      }}
                    >↑</button>
                    {!p.builtIn && (
                      <>
                        <button onClick={()=>renamePreset(p)} title="Rename"
                          style={{
                            padding:'4px 6px', fontSize:9.5,
                            color:'rgba(225,228,240,0.75)',
                            background:'rgba(255,255,255,0.03)',
                            border:'1px solid rgba(255,255,255,0.08)',
                            borderRadius:5, cursor:'pointer',
                          }}
                        >✎</button>
                        <button onClick={()=>deletePreset(p)} title="Delete"
                          style={{
                            padding:'4px 6px', fontSize:9.5,
                            color:'rgba(255,180,180,0.85)',
                            background:'rgba(180,60,60,0.06)',
                            border:'1px solid rgba(180,60,60,0.25)',
                            borderRadius:5, cursor:'pointer',
                          }}
                        >×</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
};

const GhostHitboxEditor = ({ctlRef}) => {
  // editorOpen = whether the on-screen polygon editor overlay is shown
  const [editorOpen, setEditorOpen] = React.useState(false);
  // Polygon state. Each point is [u,v] in 0..1 UV space.
  const [poly, setPoly] = React.useState(() => {
    try {
      const raw = localStorage.getItem(GHOST_POLY_LS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length >= 3 && arr.every(p => Array.isArray(p) && p.length === 2)) {
          return arr.map(([u,v]) => [+u, +v]);
        }
      }
    } catch (_) {}
    return DEFAULT_GHOST_POLY_UV.map(p => [...p]);
  });
  // Group transform — applied on top of `poly` to produce display points.
  // Reset to identity when committed via "Bake into polygon".
  const [tx,    setTx]    = React.useState(0);    // translate U (-0.3..0.3)
  const [ty,    setTy]    = React.useState(0);    // translate V
  const [skewX, setSkewX] = React.useState(0);    // shear U by V (-0.5..0.5)
  const [skewY, setSkewY] = React.useState(0);    // shear V by U
  const [rot,   setRot]   = React.useState(0);    // degrees (-30..30)
  const [scaleX,setScaleX]= React.useState(1);    // 0.5..1.5
  const [scaleY,setScaleY]= React.useState(1);
  // Live hit-div rect for overlay positioning.
  const [rect,  setRect]  = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  const [pasteBuf, setPasteBuf] = React.useState('');
  const [pasteErr, setPasteErr] = React.useState('');
  // Freeze toggle — default ON so editing is stable. User can disable it
  // to verify the polygon stays attached as the ghost moves around.
  const [freeze, setFreeze] = React.useState(true);
  // Hit-div calibration sliders — fine-tune alignment of the click-area
  // rectangle with the rendered ghost. offsetX/Y are fractions of the
  // hit-div, so they scale with depth automatically.
  const [calOffX,  setCalOffX]  = React.useState(0);
  const [calOffY,  setCalOffY]  = React.useState(0);
  const [calSclX,  setCalSclX]  = React.useState(1);
  const [calSclY,  setCalSclY]  = React.useState(1);
  // Refs for direct DOM positioning of the overlay — avoids React re-render
  // churn so the overlay tracks the ghost frame-perfectly.
  const overlayRef = React.useRef(null);
  const lastRectRef = React.useRef(null);

  // Pull initial calibration from the controller (which loaded it from
  // localStorage) when the controller first becomes available.
  React.useEffect(() => {
    const c = ctlRef.current;
    if (c && c.getHitCal) {
      const cal = c.getHitCal();
      if (cal) {
        setCalOffX(cal.offsetX || 0);
        setCalOffY(cal.offsetY || 0);
        setCalSclX(cal.scaleX  || 1);
        setCalSclY(cal.scaleY  || 1);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push calibration to controller whenever sliders change.
  React.useEffect(() => {
    const c = ctlRef.current;
    if (c && c.setHitCal) c.setHitCal({offsetX:calOffX, offsetY:calOffY, scaleX:calSclX, scaleY:calSclY});
  }, [calOffX, calOffY, calSclX, calSclY, ctlRef]);

  // Compose transform: returns transformed UV pts.
  // Transform pivot is the polygon's centroid so rotate/scale feel natural.
  const xformedPoly = React.useMemo(() => {
    const cx = poly.reduce((a,p)=>a+p[0],0) / poly.length;
    const cy = poly.reduce((a,p)=>a+p[1],0) / poly.length;
    const cosR = Math.cos(rot * Math.PI / 180);
    const sinR = Math.sin(rot * Math.PI / 180);
    return poly.map(([u,v]) => {
      // Centre on pivot
      let du = u - cx, dv = v - cy;
      // Skew
      const su = du + skewX * dv;
      const sv = dv + skewY * du;
      // Scale
      const scu = su * scaleX;
      const scv = sv * scaleY;
      // Rotate
      const ru = scu * cosR - scv * sinR;
      const rv = scu * sinR + scv * cosR;
      // Translate back from pivot, plus group translate.
      return [ru + cx + tx, rv + cy + ty];
    });
  }, [poly, tx, ty, skewX, skewY, rot, scaleX, scaleY]);

  // Push polygon into the live hit-div whenever it changes.
  React.useEffect(() => {
    const c = ctlRef.current;
    if (c && c.setHitPolygon) c.setHitPolygon(xformedPoly);
  }, [xformedPoly, ctlRef]);

  // Track the live hit-div rect every animation frame and pin the overlay
  // directly via DOM (bypassing React) so it tracks the ghost without lag,
  // even when the ghost is moving (freeze=false). We also keep the rect
  // in a ref + state — state for first-mount sizing of the SVG, ref for
  // hit-test math during vertex drags.
  React.useEffect(() => {
    if (!editorOpen) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = ctlRef.current;
      if (!c || !c.getHitRect) return;
      const r = c.getHitRect();
      if (!r) return;
      lastRectRef.current = r;
      const ov = overlayRef.current;
      if (ov) {
        // Direct DOM write — way cheaper than setState every frame.
        ov.style.left   = r.left   + 'px';
        ov.style.top    = r.top    + 'px';
        ov.style.width  = r.width  + 'px';
        ov.style.height = r.height + 'px';
        if (ov.style.display === 'none') ov.style.display = 'block';
      }
      // First-time / after-resize sync to React state so SVG mounts.
      const prev = rect;
      if (!prev || Math.abs(prev.width - r.width) > 0.5 || Math.abs(prev.height - r.height) > 0.5) {
        setRect(r);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editorOpen, ctlRef, rect]);

  // Freeze the ghost (no movement) while editor is open IF user wants it.
  // When freeze is off, the ghost continues to move and the overlay tracks
  // it live — useful for verifying the polygon hugs the silhouette under
  // motion / breathing / idle cloth physics.
  React.useEffect(() => {
    const c = ctlRef.current; if (!c) return;
    if (editorOpen && freeze && c.freezeForEditor) c.freezeForEditor(true);
    else if (c.freezeForEditor)                    c.freezeForEditor(false);
    return () => {
      const c2 = ctlRef.current;
      if (c2 && c2.freezeForEditor) c2.freezeForEditor(false);
    };
  }, [editorOpen, freeze, ctlRef]);

  // Vertex drag — when user drags a handle in the SVG.
  const dragInfo = React.useRef(null);
  const onVertexDown = (i, e) => {
    e.preventDefault(); e.stopPropagation();
    const r0 = lastRectRef.current || rect;
    if (!r0) return;
    // The vertex we're moving is the *transformed* one. We translate the
    // user's drag into a delta on the source polygon by treating the
    // transform as identity at drag-time (i.e. baking in any current
    // transform first would be ideal — but for simplicity, we move the
    // source point by the same delta as the displayed point).
    dragInfo.current = { idx: i, startX: e.clientX, startY: e.clientY,
                         startPoly: poly.map(p => [...p]),
                         startXformed: xformedPoly.map(p => [...p]) };
    const move = (ev) => {
      const di = dragInfo.current; if (!di) return;
      // Read the LIVE rect — if the ghost has moved during the drag, the
      // delta needs to be normalised against the current ghost size, not
      // the size when the drag started.
      const r = lastRectRef.current || r0;
      const dxUv = (ev.clientX - di.startX) / r.width;
      const dyUv = (ev.clientY - di.startY) / r.height;
      // Only the dragged vertex moves on the source polygon.
      // To preserve the visual under a non-identity transform, we'd need
      // the inverse — for the use cases here (small skew/rot tweaks)
      // moving the source point directly is close enough.
      const next = di.startPoly.map(p => [...p]);
      next[di.idx] = [
        Math.max(-0.2, Math.min(1.2, di.startPoly[di.idx][0] + dxUv)),
        Math.max(-0.2, Math.min(1.2, di.startPoly[di.idx][1] + dyUv)),
      ];
      setPoly(next);
    };
    const up = () => {
      dragInfo.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Bake current transform into the polygon, then reset transform to identity.
  const bakeTransform = () => {
    setPoly(xformedPoly.map(p => [...p]));
    setTx(0); setTy(0); setSkewX(0); setSkewY(0); setRot(0); setScaleX(1); setScaleY(1);
  };

  // Persist + apply.
  const apply = () => {
    bakeTransform();
    try {
      localStorage.setItem(GHOST_POLY_LS_KEY, JSON.stringify(xformedPoly));
    } catch (_) {}
  };

  const resetDefault = () => {
    setPoly(DEFAULT_GHOST_POLY_UV.map(p => [...p]));
    setTx(0); setTy(0); setSkewX(0); setSkewY(0); setRot(0); setScaleX(1); setScaleY(1);
    try { localStorage.removeItem(GHOST_POLY_LS_KEY); } catch (_) {}
  };

  // Halve points — drop every other vertex (keeps shape, reduces handles).
  // Operates on the source polygon, not the transformed one.
  const halvePoints = () => {
    if (poly.length <= 4) return;  // don't go below a quad
    const next = poly.filter((_, i) => i % 2 === 0);
    setPoly(next);
  };
  // Double points — insert a midpoint between each adjacent pair.
  const doublePoints = () => {
    if (poly.length >= 64) return;  // hard cap so users can't blow up the SVG
    const next = [];
    for (let i = 0; i < poly.length; i++) {
      next.push([...poly[i]]);
      const j = (i + 1) % poly.length;
      next.push([
        (poly[i][0] + poly[j][0]) / 2,
        (poly[i][1] + poly[j][1]) / 2,
      ]);
    }
    setPoly(next);
  };

  // Copy values block — formatted exactly like GHOST_POLY_UV in source.
  const copyValues = () => {
    const lines = xformedPoly.map(([u,v]) =>
      `[${u.toFixed(3)},${v.toFixed(3)}]`
    );
    // Group 4 per line for readability.
    const grouped = [];
    for (let i = 0; i < lines.length; i += 4) {
      grouped.push('  ' + lines.slice(i, i+4).join(','));
    }
    const txt = `const GHOST_POLY_UV = [\n${grouped.join(',\n')},\n];`;
    try { navigator.clipboard.writeText(txt).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false), 2000); }); } catch (_) {}
  };

  // Paste values — accept either raw JSON array or a `const GHOST_POLY_UV = [ ... ];` block.
  const applyPaste = () => {
    setPasteErr('');
    const raw = pasteBuf.trim();
    if (!raw) { setPasteErr('paste a polygon array first'); return; }
    try {
      // Strip surrounding `const ... = ` and trailing `;`
      let body = raw.replace(/^[^\[]*/, '').replace(/[^\]]*$/, '');
      // Strip trailing commas before ] or } — JSON.parse can't handle them,
      // but my own copy-output emits them, and humans often leave them too.
      body = body.replace(/,(\s*[\]}])/g, '$1');
      // Now should look like `[[u,v],[u,v],...]`
      const arr = JSON.parse(body);
      if (!Array.isArray(arr) || arr.length < 3) throw new Error('need at least 3 points');
      const cleaned = arr.map(p => {
        if (!Array.isArray(p) || p.length < 2) throw new Error('each point must be [u,v]');
        return [+p[0], +p[1]];
      });
      setPoly(cleaned);
      setTx(0); setTy(0); setSkewX(0); setSkewY(0); setRot(0); setScaleX(1); setScaleY(1);
      try { localStorage.setItem(GHOST_POLY_LS_KEY, JSON.stringify(cleaned)); } catch (_) {}
      setPasteBuf('');
    } catch (e) {
      setPasteErr('parse error: ' + (e.message || 'invalid format'));
    }
  };

  // Render the SVG editor when open. The wrapper div is positioned via
  // direct DOM writes inside the rAF loop above — that's why we don't
  // pass left/top/width/height via JSX style here; React would lag a
  // frame behind the ghost, and a moving ghost would visibly desync.
  const editorOverlay = editorOpen ? (
    <div
      ref={overlayRef}
      style={{
        position:'fixed',
        left: 0, top: 0, width: 0, height: 0,
        zIndex: 9998, pointerEvents:'none',
        display: rect ? 'block' : 'none',
      }}
    >
      {/* Hit-div bounding box outline (cyan dashed) — shows the FULL
          rectangle the polygon is clipped within. If this box doesn't
          line up with the rendered ghost, the size math is wrong; if
          it lines up but the polygon doesn't hug the silhouette, the
          polygon points need adjusting. Vital for debugging alignment. */}
      <div style={{
        position:'absolute', inset:0,
        border:'1px dashed rgba(80,220,255,0.65)',
        boxSizing:'border-box',
        pointerEvents:'none',
      }}/>
      {/* Reference ghost PNG underlay — same image as the live ghost,
          stretched to fit the hit-div exactly. The polygon is in the
          same UV space as this image, so trace AGAINST this — the
          silhouette here is exactly what the polygon should hug. */}
      <img
        src={GHOST_IMG_URL}
        alt=""
        draggable={false}
        style={{
          position:'absolute', inset:0,
          width:'100%', height:'100%',
          opacity:0.55,
          pointerEvents:'none',
          objectFit:'fill',  // stretch to hit-div bounds, matching plane UVs
        }}
        onError={(e)=>{ e.currentTarget.style.display='none'; }}
      />
      {/* Centre crosshair — marks the exact centre of the hit-div, which
          should correspond to ghost.position in screen-space. */}
      <div style={{
        position:'absolute', left:'50%', top:'50%',
        width:14, height:14,
        marginLeft:-7, marginTop:-7,
        pointerEvents:'none',
      }}>
        <div style={{position:'absolute', left:0, right:0, top:'50%', height:1, background:'rgba(80,220,255,0.6)'}}/>
        <div style={{position:'absolute', top:0, bottom:0, left:'50%', width:1, background:'rgba(80,220,255,0.6)'}}/>
      </div>
      <svg
        viewBox="0 0 1 1" preserveAspectRatio="none"
        style={{position:'absolute', inset:0, width:'100%', height:'100%', overflow:'visible', pointerEvents:'none'}}
      >
        <defs>
          <linearGradient id="ghHitFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(108,99,255,0.18)"/>
            <stop offset="100%" stopColor="rgba(108,99,255,0.06)"/>
          </linearGradient>
        </defs>
        <polygon
          points={xformedPoly.map(p => `${p[0]},${p[1]}`).join(' ')}
          fill="url(#ghHitFill)"
          stroke="rgba(166,149,224,0.95)"
          strokeWidth="0.006"
          vectorEffect="non-scaling-stroke"
          style={{pointerEvents:'none'}}
        />
        {xformedPoly.map((p, i) => (
          <circle
            key={i} cx={p[0]} cy={p[1]} r="0.024"
            fill={i === 0 ? 'rgba(255,200,80,0.95)' : 'rgba(238,234,255,0.95)'}
            stroke="rgba(20,15,40,0.9)" strokeWidth="0.005"
            vectorEffect="non-scaling-stroke"
            style={{cursor:'grab', pointerEvents:'all'}}
            onPointerDown={(e)=>onVertexDown(i, e)}
          />
        ))}
      </svg>
    </div>
  ) : null;

  // Slider helper
  const Slider = ({label, value, set, min, max, step, fmt}) => (
    <div style={{display:'flex', flexDirection:'column', gap:3}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span style={{fontSize:10.5, color:'rgba(190,195,215,0.75)', fontFamily:'ui-monospace,monospace'}}>{label}</span>
        <span style={{fontSize:11, fontFamily:'ui-monospace,monospace', color:'rgba(238,234,255,1)', fontWeight:600}}>{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{width:'100%', accentColor:'rgba(122,108,210,0.9)'}}
        onChange={e => set(parseFloat(e.target.value))}/>
    </div>
  );

  return (
    <>
      {/* Render overlay via portal-style fragment — JSX in the same tree is fine
          because the wrapper uses position:fixed. */}
      {editorOverlay}

      <div style={{
        fontSize:10.5, color:'rgba(180,185,205,0.55)',
        letterSpacing:'0.06em', textTransform:'uppercase',
        paddingBottom:4,
      }}>Silhouette / hitbox</div>

      <div style={{display:'flex', gap:6}}>
        <button
          onClick={()=>setEditorOpen(o => !o)}
          style={{
            flex:2, padding:'9px 10px', fontSize:11.5,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color: editorOpen ? 'rgba(255,200,120,1)' : 'rgba(225,228,240,0.95)',
            background: editorOpen
              ? 'linear-gradient(135deg, rgba(180,120,60,0.28), rgba(140,80,40,0.18))'
              : 'rgba(255,255,255,0.04)',
            border: `1px solid ${editorOpen ? 'rgba(220,170,80,0.45)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius:8, cursor:'pointer',
          }}
        >{editorOpen ? '◉ EDITING — click to close' : '◯ Open polygon editor'}</button>
        <button
          onClick={()=>setFreeze(f => !f)}
          disabled={!editorOpen}
          title={freeze ? 'Ghost is held still — click to let it move (overlay still tracks)' : 'Ghost moves freely — click to pause it'}
          style={{
            flex:1, padding:'9px 8px', fontSize:10.5,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color: !editorOpen ? 'rgba(150,155,175,0.40)' : (freeze ? 'rgba(167,234,180,1)' : 'rgba(225,180,120,1)'),
            background: !editorOpen ? 'rgba(255,255,255,0.02)' :
                        freeze ? 'rgba(60,130,90,0.18)' : 'rgba(180,120,60,0.18)',
            border: `1px solid ${!editorOpen ? 'rgba(255,255,255,0.05)' :
                        freeze ? 'rgba(110,200,140,0.40)' : 'rgba(220,170,80,0.40)'}`,
            borderRadius:8, cursor: editorOpen ? 'pointer' : 'not-allowed',
          }}
        >{freeze ? '⏸ Frozen' : '▶ Live'}</button>
      </div>

      {editorOpen && (
        <div style={{fontSize:10, color:'rgba(180,185,205,0.55)', lineHeight:1.5}}>
          Drag the dots on the ghost to reshape the click-area · or use the sliders below to skew/rotate/scale the whole shape · {freeze ? 'ghost is paused — toggle ▶ Live to test that the polygon stays attached as it moves' : 'ghost is moving · the editor overlay rides along with it · toggle ⏸ Frozen if you want it to hold still'}
        </div>
      )}

      <div style={{
        padding:'10px 11px', borderRadius:8,
        background:'rgba(0,0,0,0.18)',
        border:'1px solid rgba(80,220,255,0.18)',
        display:'flex', flexDirection:'column', gap:7,
      }}>
        <div style={{fontSize:9.5, color:'rgba(80,220,255,0.75)', letterSpacing:'0.08em'}}>HIT-BOX ALIGNMENT (cyan box)</div>
        <div style={{fontSize:9.5, color:'rgba(180,200,210,0.55)', letterSpacing:'0.02em', lineHeight:1.5}}>
          Use these first to make the cyan dashed box hug the rendered ghost. Offsets scale with depth, so dial-in at one scale stays correct at others.
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
          <Slider label="Offset X"     value={calOffX}  set={setCalOffX}  min={-0.50} max={0.50} step={0.005}/>
          <Slider label="Offset Y"     value={calOffY}  set={setCalOffY}  min={-0.50} max={0.50} step={0.005}/>
          <Slider label="Box scale X"  value={calSclX}  set={setCalSclX}  min={0.40}  max={2.00} step={0.01}/>
          <Slider label="Box scale Y"  value={calSclY}  set={setCalSclY}  min={0.40}  max={2.00} step={0.01}/>
        </div>
        <div style={{display:'flex', gap:6}}>
          <button
            onClick={()=>{ setCalOffX(0); setCalOffY(0); setCalSclX(1); setCalSclY(1); }}
            style={{
              flex:1, padding:'7px 9px', fontSize:10.5,
              fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
              color:'rgba(225,228,240,0.85)',
              background:'rgba(255,255,255,0.04)',
              border:'1px solid rgba(255,255,255,0.08)',
              borderRadius:6, cursor:'pointer',
            }}
          >Reset alignment</button>
        </div>
      </div>

      <div style={{
        padding:'10px 11px', borderRadius:8,
        background:'rgba(0,0,0,0.18)',
        border:'1px solid rgba(255,255,255,0.06)',
        display:'flex', flexDirection:'column', gap:7,
      }}>
        <div style={{fontSize:9.5, color:'rgba(108,99,255,0.7)', letterSpacing:'0.08em'}}>GROUP TRANSFORM (live preview)</div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
          <Slider label="Translate U"  value={tx}     set={setTx}     min={-0.30} max={0.30} step={0.005}/>
          <Slider label="Translate V"  value={ty}     set={setTy}     min={-0.30} max={0.30} step={0.005}/>
          <Slider label="Skew U(of V)" value={skewX}  set={setSkewX}  min={-0.50} max={0.50} step={0.01}/>
          <Slider label="Skew V(of U)" value={skewY}  set={setSkewY}  min={-0.50} max={0.50} step={0.01}/>
          <Slider label="Rotate °"     value={rot}    set={setRot}    min={-30}   max={30}   step={0.5} fmt={v=>v.toFixed(1)+'°'}/>
          <Slider label="Scale X"      value={scaleX} set={setScaleX} min={0.50}  max={1.50} step={0.01}/>
          <Slider label="Scale Y"      value={scaleY} set={setScaleY} min={0.50}  max={1.50} step={0.01}/>
        </div>
        <div style={{display:'flex', gap:6}}>
          <button
            onClick={bakeTransform}
            title="Bake the slider transform into the polygon points and reset sliders"
            style={{
              flex:1, padding:'7px 9px', fontSize:10.5,
              fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
              color:'rgba(225,228,240,0.85)',
              background:'rgba(255,255,255,0.04)',
              border:'1px solid rgba(255,255,255,0.08)',
              borderRadius:6, cursor:'pointer',
            }}
          >⤓ Bake transform into points</button>
        </div>
      </div>

      {/* Point management — fewer / more vertex handles. */}
      <div style={{display:'flex', gap:6, alignItems:'center'}}>
        <span style={{
          fontSize:10, color:'rgba(180,185,205,0.65)',
          fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
          minWidth:55,
        }}>{poly.length} pts</span>
        <button
          onClick={halvePoints}
          disabled={poly.length <= 4}
          title="Drop every other vertex"
          style={{
            flex:1, padding:'7px 9px', fontSize:10.5,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color: poly.length <= 4 ? 'rgba(150,155,175,0.40)' : 'rgba(225,228,240,0.85)',
            background:'rgba(255,255,255,0.04)',
            border:'1px solid rgba(255,255,255,0.08)',
            borderRadius:6,
            cursor: poly.length <= 4 ? 'not-allowed' : 'pointer',
          }}
        >− Halve</button>
        <button
          onClick={doublePoints}
          disabled={poly.length >= 64}
          title="Insert midpoint between each adjacent pair"
          style={{
            flex:1, padding:'7px 9px', fontSize:10.5,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color: poly.length >= 64 ? 'rgba(150,155,175,0.40)' : 'rgba(225,228,240,0.85)',
            background:'rgba(255,255,255,0.04)',
            border:'1px solid rgba(255,255,255,0.08)',
            borderRadius:6,
            cursor: poly.length >= 64 ? 'not-allowed' : 'pointer',
          }}
        >+ Double</button>
      </div>

      <div style={{display:'flex', gap:6}}>
        <button
          onClick={apply}
          style={{
            flex:1, padding:'8px 10px', fontSize:11,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color:'rgba(167,234,180,1)',
            background:'linear-gradient(135deg, rgba(60,130,90,0.22), rgba(40,90,60,0.16))',
            border:'1px solid rgba(110,200,140,0.40)',
            borderRadius:8, cursor:'pointer',
          }}
        >✓ Apply &amp; save</button>
        <button
          onClick={resetDefault}
          style={{
            padding:'8px 10px', fontSize:11,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color:'rgba(200,205,225,0.55)',
            background:'rgba(255,255,255,0.035)',
            border:'1px solid rgba(255,255,255,0.07)',
            borderRadius:8, cursor:'pointer',
          }}
        >Reset</button>
      </div>

      {/* Live values readout — selectable & copyable */}
      <div style={{
        position:'relative',
        padding:'10px 12px', borderRadius:8,
        background:'rgba(0,0,0,0.28)',
        border:'1px solid rgba(108,99,255,0.18)',
        fontFamily:'ui-monospace,monospace', fontSize:10,
        color:'rgba(190,195,215,0.85)', lineHeight:1.55,
        userSelect:'text', cursor:'text',
        maxHeight:140, overflowY:'auto',
      }}>
        <div style={{fontSize:9, color:'rgba(108,99,255,0.6)', letterSpacing:'0.08em', marginBottom:4, userSelect:'none'}}>
          CURRENT VALUES — {xformedPoly.length} pts · select all &amp; copy
        </div>
        <pre style={{margin:0, whiteSpace:'pre-wrap', wordBreak:'break-all', color:'rgba(220,225,240,0.92)'}}>
{`const GHOST_POLY_UV = [\n${(() => {
  const lines = xformedPoly.map(([u,v]) => `[${u.toFixed(3)},${v.toFixed(3)}]`);
  const grouped = [];
  for (let i = 0; i < lines.length; i += 4) grouped.push('  ' + lines.slice(i, i+4).join(','));
  return grouped.join(',\n');
})()},\n];`}
        </pre>
      </div>

      <div style={{display:'flex', gap:6}}>
        <button
          onClick={copyValues}
          style={{
            flex:1, padding:'8px 10px', fontSize:11,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color: copied ? 'rgba(67,201,138,1)' : 'rgba(225,228,240,0.90)',
            background: copied ? 'rgba(67,201,138,0.12)' : 'rgba(255,255,255,0.035)',
            border:`1px solid ${copied ? 'rgba(67,201,138,0.45)' : 'rgba(255,255,255,0.07)'}`,
            borderRadius:8, cursor:'pointer',
            transition:'all 140ms ease',
          }}
        >{copied ? '✓ Copied!' : '⎘ Copy values'}</button>
      </div>

      {/* Paste-back area — accepts Claude's reply or any GHOST_POLY_UV block. */}
      <div style={{
        padding:'10px 11px', borderRadius:8,
        background:'rgba(0,0,0,0.18)',
        border:'1px solid rgba(255,255,255,0.06)',
        display:'flex', flexDirection:'column', gap:6,
      }}>
        <div style={{fontSize:9.5, color:'rgba(108,99,255,0.7)', letterSpacing:'0.08em'}}>PASTE VALUES BACK</div>
        <textarea
          value={pasteBuf}
          onChange={e => { setPasteBuf(e.target.value); setPasteErr(''); }}
          placeholder="Paste a GHOST_POLY_UV array or [[u,v],...] block here..."
          rows={4}
          style={{
            width:'100%', boxSizing:'border-box',
            padding:'7px 9px', fontSize:10.5,
            fontFamily:'ui-monospace,monospace',
            color:'rgba(220,225,240,0.92)',
            background:'rgba(0,0,0,0.30)',
            border:'1px solid rgba(255,255,255,0.07)',
            borderRadius:6, resize:'vertical', outline:'none',
          }}
        />
        {pasteErr && (
          <div style={{fontSize:10, color:'rgba(255,140,140,0.85)', fontFamily:'ui-monospace,monospace'}}>{pasteErr}</div>
        )}
        <button
          onClick={applyPaste}
          style={{
            padding:'7px 10px', fontSize:11,
            fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
            color:'rgba(225,228,240,0.92)',
            background:'rgba(108,99,255,0.18)',
            border:'1px solid rgba(160,150,230,0.40)',
            borderRadius:6, cursor:'pointer',
          }}
        >→ Apply pasted values</button>
      </div>
    </>
  );
};

const GhostDevPanel = ({open, setOpen, ctlRef, emo, setEmo, intro, setIntro, exit, setExit, inChat}) => {
  // Draggable position — persists in component state.
  const [pos,     setPos]     = React.useState({x: 24, y: 24});
  const [drag,    setDrag]    = React.useState(null);
  const [section, setSection] = React.useState('emotions'); // emotions | actions | intro_exit
  // Currently-running action (polled). Used to highlight the active
  // looping movement button so the user knows which action is on.
  const [runningAction, setRunningAction] = React.useState(null);
  const [isLooping,     setIsLooping]     = React.useState(false);
  // Position calibration state — live X/Y/Scale dials for tuning home position.
  // Defaults match the new dock home; the `useEffect` below re-syncs from the
  // live controller as soon as it's available so the panel always reflects
  // the actual ghost state, not stale React defaults.
  const [calX,    setCalX]    = React.useState(2.10);
  const [calY,    setCalY]    = React.useState(1.70);
  const [calS,    setCalS]    = React.useState(0.46);
  const [copied,  setCopied]  = React.useState(false);
  const [calMax,  setCalMax]  = React.useState(0.59);
  // ── Ghost menu button visibility ────────────────────────────
  // The launcher button that opened this panel was removed from the
  // homepage by request (see the "if (!open)" branch below), which left
  // `open`/setOpen with no way to ever become true from the dashboard.
  // Appearance settings can bring it back via a simple localStorage flag +
  // custom event — see getGhostMenuBtnEnabled/GHOST_MENU_BTN_EVENT in
  // bot-ui-settings.jsx.
  const [showGhostMenuBtn, setShowGhostMenuBtn] = React.useState(() => {
    try { return localStorage.getItem('bc.ghost.menuBtn.v1') === '1'; } catch (_) { return false; }
  });
  React.useEffect(() => {
    const onChange = (e) => setShowGhostMenuBtn(!!(e && e.detail));
    window.addEventListener('bc:ghost-menu-btn-change', onChange);
    return () => window.removeEventListener('bc:ghost-menu-btn-change', onChange);
  }, []);

  // Pull live position + scale calibration from the controller as soon as
  // it's available, so the panel doesn't briefly show stale defaults.
  React.useEffect(()=>{
    if (!open) return;
    const c = ctlRef.current;
    if (!c) return;
    try {
      if (c.getScaleCal) {
        const sc = c.getScaleCal();
        if (sc) { setCalS(sc.home); setCalMax(sc.max); }
      }
      if (c.state && c.state.home) {
        setCalX(+c.state.home.x);
        setCalY(+c.state.home.y);
      }
    } catch (_) {}
  }, [open, ctlRef]);

  React.useEffect(()=>{
    if (!open) return;
    const id = setInterval(() => {
      const c = ctlRef.current;
      if (!c) return;
      try {
        const s = c.state;
        setRunningAction(s ? s.action : null);
        setIsLooping(s ? !!s.looping : false);
      } catch (_) {}
    }, 200);
    return () => clearInterval(id);
  }, [open, ctlRef]);

  React.useEffect(()=>{
    if (!drag) return;
    const move = (e) => {
      setPos({
        x: Math.max(8, Math.min(window.innerWidth  - 360, drag.startX + (e.clientX - drag.mx))),
        y: Math.max(8, Math.min(window.innerHeight - 100, drag.startY + (e.clientY - drag.my))),
      });
    };
    const up = () => setDrag(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [drag]);

  const fire = (kind, name) => {
    const c = ctlRef.current; if (!c) return;
    if (kind === 'emotion') c.setEmotion(name);
    if (kind === 'action')  c.playAction(name);
  };

  // Homepage-only: widgets / ghost / notifications / balance have no
  // business showing up over a chat. This whole component is portalled
  // straight to document.body (see the createPortal call in
  // EmptyChatAvatar), which means it never inherited the dashboard's own
  // visibility:hidden/pointer-events:none while a chat is open — it was
  // rendering right on top of the conversation regardless. Bail out here
  // instead, once inChat is known, rather than relying on the portal
  // target's ancestry.
  // Defensive: WidgetLauncherButton / ProfitBubble / NotificationsBubble come
  // from bot-ui-widgets.jsx, a separate script loaded earlier in the boot
  // sequence. This component previously read window.* exactly once at first
  // render — if that load was ever delayed for any reason (slow disk read,
  // embedded-browser timing, a transient fetch hiccup), the chips would
  // silently stay missing forever with no way to recover short of a full
  // reload. Poll briefly until they land on window, then force one
  // re-render so the chips appear on their own.
  const [, forceWidgetsCheck] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const W = (typeof window !== 'undefined') ? window : {};
    if (W.WidgetLauncherButton && W.ProfitBubble && W.NotificationsBubble) return;
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      if (W.WidgetLauncherButton && W.ProfitBubble && W.NotificationsBubble) {
        clearInterval(id);
        forceWidgetsCheck();
      } else if (tries > 40) { // ~10s — stop polling, but leave a clear trail
        clearInterval(id);
        console.error(
          '[GhostDevPanel] bot-ui-widgets.jsx never finished loading — ' +
          'window.WidgetLauncherButton/ProfitBubble/NotificationsBubble are ' +
          'still undefined after 10s, so the widgets/notifications/balance ' +
          'chips will stay hidden. Check the Network tab for a failed or ' +
          'missing request to bot-ui-widgets.jsx, and check the Console for ' +
          'any error logged while that file was evaluating.'
        );
      }
    }, 250);
    return () => clearInterval(id);
  }, []);

  if (inChat) return null;

  // Floating launcher when collapsed — top-right of the ghost stage,
  // tiny pill button so it doesn't fight the briefing UI for attention.
  if (!open) {
    const W = (typeof window !== 'undefined') ? window : {};
    const NB = W.NotificationsBubble;
    const PB = W.ProfitBubble;
    // Ghost dev panel button and widgets launcher button removed from the
    // homepage by request — the ghost dev panel can no longer be opened
    // from here, and dashboard widget editing is no longer surfaced via
    // this launcher. Only the balance (ProfitBubble) and notifications
    // (NotificationsBubble) chips remain, unless "Show ghost menu button"
    // is turned on in Appearance settings, which restores a small button
    // for reopening the ghost dev panel.
    return (
      <div style={{position:'absolute', top:14, right:14, display:'flex', alignItems:'center', gap:10, zIndex:30}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          {showGhostMenuBtn && (
            <button
              onClick={()=>setOpen(true)}
              title="Ghost menu"
              aria-label="Ghost menu"
              style={{
                display:'flex', alignItems:'center', justifyContent:'center',
                width:26, height:26, padding:0, borderRadius:7,
                background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.10)',
                color:'rgba(225,228,240,0.85)', cursor:'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
          )}
          {PB && <PB/>}
          {NB && <NB/>}
        </div>
      </div>
    );
  }

  const baseBtn = {
    flex:'1 1 calc(50% - 6px)',
    minWidth:0,
    padding:'9px 10px',
    fontSize:11.5,
    fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',
    letterSpacing:'0.02em',
    color:'rgba(225,228,240,0.90)',
    background:'rgba(255,255,255,0.035)',
    border:'1px solid rgba(255,255,255,0.07)',
    borderRadius:8,
    cursor:'pointer',
    textAlign:'left',
    transition:'background 140ms ease, border-color 140ms ease, color 140ms ease',
    display:'flex', flexDirection:'column', gap:2,
  };
  const activeBtn = {
    ...baseBtn,
    background:'linear-gradient(135deg, rgba(122,108,210,0.25), rgba(86,72,168,0.18))',
    border:'1px solid rgba(160,150,230,0.45)',
    color:'rgba(238,234,255,1)',
  };

  return (
    <div
      style={{
        position:'fixed',
        left: pos.x, top: pos.y,
        width: 380,
        maxHeight: '85vh',
        zIndex: 9999,
        background:'linear-gradient(180deg, rgba(20,22,40,0.88), rgba(14,15,28,0.92))',
        border:'1px solid rgba(255,255,255,0.09)',
        borderRadius:14,
        backdropFilter:'blur(22px) saturate(170%)',
        WebkitBackdropFilter:'blur(22px) saturate(170%)',
        boxShadow:'0 18px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
        color:'rgba(232,235,245,0.95)',
        fontFamily:'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto',
        userSelect: drag ? 'none' : 'auto',
        // Lay out as a column so header + tabs stay pinned and the body
        // is the only scrolling region. Outer hidden so rounded corners
        // clip cleanly.
        display:'flex', flexDirection:'column',
        overflow:'hidden',
      }}
    >
      {/* Header / drag handle */}
      <div
        onMouseDown={(e)=>setDrag({mx:e.clientX, my:e.clientY, startX:pos.x, startY:pos.y})}
        style={{
          display:'flex', alignItems:'center', gap:10,
          padding:'10px 14px',
          borderBottom:'1px solid rgba(255,255,255,0.06)',
          cursor:'grab',
        }}
      >
        <div style={{
          width:8, height:8, borderRadius:'50%',
          background:'#a695e0',
          boxShadow:'0 0 10px rgba(166,149,224,0.65)',
        }}/>
        <div style={{flex:1, fontSize:12, fontWeight:600, letterSpacing:'0.04em', textTransform:'uppercase'}}>
          Ghost · Dev Panel
        </div>
        <button
          onClick={()=>{ const c=ctlRef.current; if(c) c.reset(); }}
          title="Reset to chill"
          style={{
            padding:'4px 9px', fontSize:10.5, letterSpacing:'0.05em',
            color:'rgba(220,225,240,0.75)',
            background:'rgba(255,255,255,0.04)',
            border:'1px solid rgba(255,255,255,0.08)',
            borderRadius:6, cursor:'pointer',
          }}
        >RESET</button>
        <button
          onClick={()=>setOpen(false)}
          title="Close"
          style={{
            width:24, height:24, padding:0, fontSize:14, lineHeight:1,
            color:'rgba(220,225,240,0.75)',
            background:'transparent', border:'1px solid rgba(255,255,255,0.08)',
            borderRadius:6, cursor:'pointer',
          }}
        >×</button>
      </div>

      {/* Section tabs */}
      <div style={{display:'flex', padding:'10px 14px 0', gap:6}}>
        {[
          {id:'emotions',   label:'Emotions'},
          {id:'actions',    label:'Movement'},
          {id:'intro_exit', label:'Intro / Exit'},
          {id:'position',   label:'Position'},
          {id:'eyes',       label:'Eyes'},
          {id:'hitbox',     label:'Hitbox'},
        ].map(s => (
          <button
            key={s.id}
            onClick={()=>setSection(s.id)}
            style={{
              flex:1, padding:'7px 8px',
              fontSize:11, letterSpacing:'0.04em', textTransform:'uppercase',
              color: section===s.id ? 'rgba(238,234,255,1)' : 'rgba(200,205,225,0.55)',
              background: section===s.id ? 'rgba(122,108,210,0.18)' : 'transparent',
              border:'1px solid', borderColor: section===s.id ? 'rgba(160,150,230,0.45)' : 'rgba(255,255,255,0.06)',
              borderRadius:8, cursor:'pointer',
              transition:'background 140ms ease, color 140ms ease, border-color 140ms ease',
            }}
          >{s.label}</button>
        ))}
      </div>

      {/* Section body — scroll inside the popup so long sections (Eyes!)
          never push the bottom off-screen. flex:1 fills remaining height
          under the pinned header + section tabs. */}
      <div style={{
        padding:'12px 14px 14px',
        display:'flex', flexDirection:'column', gap:10,
        overflowY:'auto',
        flex:'1 1 auto',
        minHeight:0,
      }}>
        {section === 'emotions' && (
          <>
            <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
              {GHOST_EMOTIONS.map(e => (
                <button
                  key={e.id}
                  onClick={()=>{ setEmo(e.id); fire('emotion', e.id); }}
                  style={emo === e.id ? activeBtn : baseBtn}
                >
                  <span style={{fontSize:11.5, fontWeight:600, letterSpacing:'0.02em'}}>{e.label}</span>
                  <span style={{fontSize:10, color:'rgba(190,195,215,0.55)', letterSpacing:'0.01em'}}>{e.hint}</span>
                </button>
              ))}
            </div>
            <div style={{
              fontSize:10.5, color:'rgba(180,185,205,0.55)',
              letterSpacing:'0.04em', textTransform:'uppercase',
              padding:'4px 0', borderTop:'1px solid rgba(255,255,255,0.05)',
            }}>
              tip: hover the ghost to make him suspicious · click him for happy
            </div>
          </>
        )}

        {section === 'actions' && (
          <>
            <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
              {GHOST_ACTIONS.map(a => {
                const isRunning = runningAction === a.id;
                const isLoopingBtn = isRunning && isLooping;
                return (
                  <button
                    key={a.id}
                    onClick={()=>fire('action', a.id)}
                    style={isRunning ? activeBtn : baseBtn}
                  >
                    <span style={{fontSize:11.5, fontWeight:600, letterSpacing:'0.02em', display:'flex', alignItems:'center', gap:6}}>
                      {a.label}
                      {isLoopingBtn && (
                        <span style={{
                          fontSize:8, padding:'1px 5px',
                          background:'rgba(166,149,224,0.30)',
                          border:'1px solid rgba(166,149,224,0.60)',
                          borderRadius:4, letterSpacing:'0.10em',
                        }}>LOOP</span>
                      )}
                    </span>
                    <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>
                      {isLoopingBtn ? 'click again to stop' : a.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{
              fontSize:10.5, color:'rgba(180,185,205,0.55)',
              letterSpacing:'0.04em', textTransform:'uppercase',
              padding:'4px 0', borderTop:'1px solid rgba(255,255,255,0.05)',
            }}>
              movement actions loop until clicked again · others run once
            </div>
            <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
              <button onClick={()=>{ const c=ctlRef.current; if(c) c.pulseRipple(0.5, 0.55); }} style={{...baseBtn, flex:1}}>
                <span style={{fontSize:11.5, fontWeight:600}}>Pulse ripple</span>
                <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>One-shot cloth wave</span>
              </button>
              <button onClick={()=>{ const c=ctlRef.current; if(c) c.dragEnabled = !c.dragEnabled; }} style={{...baseBtn, flex:1}}>
                <span style={{fontSize:11.5, fontWeight:600}}>Toggle drag</span>
                <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>Grab + throw ghost</span>
              </button>
              <button onClick={()=>{ const c=ctlRef.current; if(c) c.reset(); }} style={{...baseBtn, flex:1}}>
                <span style={{fontSize:11.5, fontWeight:600}}>Reset home</span>
                <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>Centre + chill</span>
              </button>
            </div>
            <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
              <button
                onClick={()=>{ const c=ctlRef.current; if(c) c.testTurn(); }}
                style={{
                  ...baseBtn, flex:'1 1 100%',
                  background:'linear-gradient(135deg, rgba(80,55,160,0.28), rgba(55,40,110,0.20))',
                  border:'1px solid rgba(140,120,220,0.40)',
                  color:'rgba(220,215,255,1)',
                }}
              >
                <span style={{fontSize:12, fontWeight:700, letterSpacing:'0.04em'}}>⟳ Test Turn Animation</span>
                <span style={{fontSize:10, color:'rgba(200,195,240,0.65)'}}>Front → fade out → back → fade in → front · watch the turn transition</span>
              </button>
            </div>
          </>
        )}

        {section === 'intro_exit' && (
          <>
            <div style={{
              fontSize:10.5, color:'rgba(180,185,205,0.55)',
              letterSpacing:'0.06em', textTransform:'uppercase',
              padding:'2px 0',
            }}>Intro</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
              {GHOST_INTROS.map(i => (
                <button
                  key={i.id}
                  onClick={()=>{ setIntro(i.id); fire('action', i.id); }}
                  style={intro === i.id ? activeBtn : baseBtn}
                >
                  <span style={{fontSize:11.5, fontWeight:600}}>{i.label}</span>
                  <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>{i.hint}</span>
                </button>
              ))}
            </div>
            <div style={{
              fontSize:10.5, color:'rgba(180,185,205,0.55)',
              letterSpacing:'0.06em', textTransform:'uppercase',
              padding:'8px 0 2px', borderTop:'1px solid rgba(255,255,255,0.05)',
            }}>Exit</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
              {GHOST_EXITS.map(x => (
                <button
                  key={x.id}
                  onClick={()=>{ setExit(x.id); fire('action', x.id); }}
                  style={exit === x.id ? activeBtn : baseBtn}
                >
                  <span style={{fontSize:11.5, fontWeight:600}}>{x.label}</span>
                  <span style={{fontSize:10, color:'rgba(190,195,215,0.55)'}}>{x.hint}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {section === 'position' && (
          <>
            <div style={{
              fontSize:10.5, color:'rgba(180,185,205,0.55)',
              letterSpacing:'0.06em', textTransform:'uppercase',
              paddingBottom:4,
            }}>Home position &amp; depth</div>

            {/* X slider */}
            <div style={{display:'flex', flexDirection:'column', gap:5}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span style={{fontSize:11, color:'rgba(190,195,215,0.75)', fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em'}}>X (horizontal)</span>
                <span style={{fontSize:12, fontFamily:'ui-monospace,monospace', color:'rgba(238,234,255,1)', fontWeight:600}}>{calX.toFixed(2)}</span>
              </div>
              <input type="range" min="-4" max="4" step="0.05" value={calX}
                style={{width:'100%', accentColor:'rgba(122,108,210,0.9)'}}
                onChange={e=>{
                  const v=parseFloat(e.target.value);
                  setCalX(v);
                  const c=ctlRef.current; if(c&&c.setHome) c.setHome(v, calY, calS);
                }}/>
            </div>

            {/* Y slider */}
            <div style={{display:'flex', flexDirection:'column', gap:5}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span style={{fontSize:11, color:'rgba(190,195,215,0.75)', fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em'}}>Y (vertical · +up)</span>
                <span style={{fontSize:12, fontFamily:'ui-monospace,monospace', color:'rgba(238,234,255,1)', fontWeight:600}}>{calY.toFixed(2)}</span>
              </div>
              <input type="range" min="-4" max="4" step="0.05" value={calY}
                style={{width:'100%', accentColor:'rgba(122,108,210,0.9)'}}
                onChange={e=>{
                  const v=parseFloat(e.target.value);
                  setCalY(v);
                  const c=ctlRef.current; if(c&&c.setHome) c.setHome(calX, v, calS);
                }}/>
            </div>

            {/* Scale slider */}
            <div style={{display:'flex', flexDirection:'column', gap:5}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span style={{fontSize:11, color:'rgba(190,195,215,0.75)', fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em'}}>HOME_SCALE (far = small)</span>
                <span style={{fontSize:12, fontFamily:'ui-monospace,monospace', color:'rgba(238,234,255,1)', fontWeight:600}}>{calS.toFixed(2)}</span>
              </div>
              <input type="range" min="0.25" max="1.35" step="0.01" value={calS}
                style={{width:'100%', accentColor:'rgba(122,108,210,0.9)'}}
                onChange={e=>{
                  const v=parseFloat(e.target.value);
                  setCalS(v);
                  const c=ctlRef.current; if(c&&c.setHome) c.setHome(calX, calY, v);
                }}/>
            </div>

            {/* Max Closeness slider */}
            <div style={{display:'flex', flexDirection:'column', gap:5}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span style={{fontSize:11, color:'rgba(190,195,215,0.75)', fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em'}}>MAX CLOSENESS (approach scale)</span>
                <span style={{fontSize:12, fontFamily:'ui-monospace,monospace', color:'rgba(238,234,255,1)', fontWeight:600}}>{calMax.toFixed(2)}</span>
              </div>
              <input type="range" min="0.50" max="2.00" step="0.01" value={calMax}
                style={{width:'100%', accentColor:'rgba(122,108,210,0.9)'}}
                onChange={e=>{
                  const v=parseFloat(e.target.value);
                  setCalMax(v);
                  const c=ctlRef.current; if(c&&c.setMaxScale) c.setMaxScale(v);
                }}/>
              <div style={{fontSize:9.5, color:'rgba(160,165,185,0.45)', letterSpacing:'0.03em'}}>
                How large the ghost gets when fully close to screen. HOME_SCALE = far end.
              </div>
            </div>

            {/* Live settings log — selectable monospace block the user can copy/paste */}
            <div style={{
              position:'relative',
              padding:'10px 12px', borderRadius:8,
              background:'rgba(0,0,0,0.28)',
              border:'1px solid rgba(108,99,255,0.18)',
              fontFamily:'ui-monospace,monospace', fontSize:10.5,
              color:'rgba(190,195,215,0.85)', lineHeight:1.8,
              userSelect:'text', cursor:'text',
            }}>
              <div style={{fontSize:9, color:'rgba(108,99,255,0.6)', letterSpacing:'0.08em', marginBottom:4, userSelect:'none'}}>CURRENT VALUES — select all &amp; copy</div>
              <div><span style={{color:'rgba(108,99,255,0.7)'}}>X</span> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style={{color:'rgba(238,234,255,1)', fontWeight:600}}>{calX.toFixed(2)}</span></div>
              <div><span style={{color:'rgba(108,99,255,0.7)'}}>Y</span> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style={{color:'rgba(238,234,255,1)', fontWeight:600}}>{calY.toFixed(2)}</span></div>
              <div><span style={{color:'rgba(108,99,255,0.7)'}}>HOME_SCALE</span> &nbsp;&nbsp;<span style={{color:'rgba(238,234,255,1)', fontWeight:600}}>{calS.toFixed(2)}</span></div>
              <div><span style={{color:'rgba(108,99,255,0.7)'}}>MAX_SCALE</span> &nbsp;&nbsp;&nbsp;<span style={{color:'rgba(238,234,255,1)', fontWeight:600}}>{calMax.toFixed(2)}</span></div>
            </div>

            {/* Copy + Reset row */}
            <div style={{display:'flex', gap:6}}>
              <button
                onClick={()=>{
                  const txt = `X (horizontal)${calX.toFixed(2)}\nY (vertical · +up)${calY.toFixed(2)}\nHOME_SCALE (far = small)${calS.toFixed(2)}\nMAX CLOSENESS (approach scale)${calMax.toFixed(2)}`;
                  try { navigator.clipboard.writeText(txt).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000); }); } catch(_){}
                }}
                style={{
                  flex:1, padding:'8px 10px', fontSize:11,
                  fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
                  color: copied ? 'rgba(67,201,138,1)' : 'rgba(225,228,240,0.90)',
                  background: copied ? 'rgba(67,201,138,0.12)' : 'rgba(255,255,255,0.035)',
                  border:`1px solid ${copied ? 'rgba(67,201,138,0.45)' : 'rgba(255,255,255,0.07)'}`,
                  borderRadius:8, cursor:'pointer',
                  transition:'all 140ms ease',
                }}
              >{copied ? '✓ Copied!' : '⎘ Copy values'}</button>
              <button
                onClick={()=>{
                  setCalX(2.10); setCalY(1.70); setCalS(0.46); setCalMax(0.59);
                  const c=ctlRef.current; if(c&&c.setHome) c.setHome(2.10, 1.70, 0.46);
                  if(c&&c.setMaxScale) c.setMaxScale(0.59);
                }}
                style={{
                  padding:'8px 10px', fontSize:11,
                  fontFamily:'ui-monospace,monospace', letterSpacing:'0.04em',
                  color:'rgba(200,205,225,0.55)',
                  background:'rgba(255,255,255,0.035)',
                  border:'1px solid rgba(255,255,255,0.07)',
                  borderRadius:8, cursor:'pointer',
                }}
              >Reset</button>
            </div>
            <div style={{
              fontSize:10, color:'rgba(180,185,205,0.40)',
              letterSpacing:'0.03em', lineHeight:1.5,
            }}>
              Drag sliders · hit Copy · paste the values to set as new defaults.
            </div>
          </>
        )}

        {section === 'eyes' && (
          <GhostEyesEditor ctlRef={ctlRef} />
        )}

        {section === 'hitbox' && (
          <GhostHitboxEditor ctlRef={ctlRef} />
        )}
      </div>
    </div>
  );
};

// Tiny briefing pill that appears at the top of the contact list panel.
// Reads the live line published by the chat stage via window.__briefing
// and a window 'briefing-update' event, so we don't have to prop-drill
// through the conversation tree. Fixed height + clamped to two lines so
// the layout never reflows when copy length changes.
const BriefingPill = () => {
  const [data, setData] = React.useState(() => (typeof window!=='undefined' && window.__briefing) || {currentLine:'', fade:true});
  React.useEffect(() => {
    const h = () => setData({...(window.__briefing||{})});
    window.addEventListener('__briefing-update', h);
    return () => window.removeEventListener('__briefing-update', h);
  }, []);
  const line = data.currentLine || 'Standing by.';
  const visible = data.fade !== false;
  const now = new Date();
  const t = now.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  return (
    <div style={{
      // No container — just a clean two-row ticker. Fixed 38px height
      // keeps search/chips from shifting as the line cycles.
      height: 38, margin: '2px 2px 12px',
      display:'flex', alignItems:'center', gap:10,
      overflow:'hidden',
    }}>
      {/* Pulse — soft halo + tight core */}
      <div style={{position:'relative', width:8, height:8, flexShrink:0}}>
        <span style={{
          position:'absolute', inset:0, borderRadius:'50%',
          background:'rgba(140,180,140,0.18)',
          animation:'cust-esc-pulse 2.4s ease-in-out infinite',
        }}/>
        <span style={{
          position:'absolute', top:2, left:2, width:4, height:4, borderRadius:'50%',
          background:'rgba(160,200,160,0.95)',
          boxShadow:'0 0 8px rgba(140,200,150,0.7)',
        }}/>
      </div>
      <div style={{flex:1, minWidth:0, display:'flex', flexDirection:'column', justifyContent:'center', gap:1}}>
        <div style={{display:'flex', alignItems:'baseline', gap:8}}>
          <span style={{
            fontSize:8.5, fontWeight:700, letterSpacing:'0.22em',
            color:'rgba(190,194,210,0.5)', textTransform:'uppercase',
          }}>Briefing</span>
          <span style={{flex:1, height:1, background:'linear-gradient(90deg, rgba(255,255,255,0.05), transparent)'}}/>
          {/* Weather chip — dim icon + tabular temperature.
              Replaces the prior clock readout; the clock is already
              available on the dashboard widget. */}
          <span style={{display:'inline-flex', alignItems:'center', gap:4, color:'rgba(180,184,200,0.5)'}}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}>
              <circle cx="8" cy="9" r="3.2"/>
              <path d="M18 16h-1.05A5 5 0 1 0 9 19h9a3 3 0 0 0 0-3z"/>
            </svg>
            <span style={{
              fontSize:10, fontFamily:'JetBrains Mono,ui-monospace,monospace',
              fontVariantNumeric:'tabular-nums',
              letterSpacing:'0.02em',
            }}>20°C</span>
          </span>
        </div>
        <div style={{
          fontSize:11.5, lineHeight:1.25, fontWeight:450,
          color:'rgba(232,234,242,0.86)',
          letterSpacing:'-0.005em',
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(-2px)',
          transition:'opacity 0.5s ease, transform 0.5s ease',
        }}>{line}</div>
      </div>
    </div>
  );
};

// ── GuestCard ──────────────────────────────────────────────────────
// Stands where the search field is for a guest (one conversation, nothing
// to search), in the same quiet glass and the same height, so the header
// reads the same as everyone else's. One line: why, and the way to do it.
const GuestCard = () => {
  const [over, setOver] = React.useState(false);
  return (
    <div title="You’re chatting as a guest. Create an account to keep this conversation on any device."
      style={{
        display:'flex', alignItems:'center', gap:8, height:32, boxSizing:'border-box',
        padding:'0 4px 0 11px', marginBottom:10, borderRadius:10,
        background:'rgba(255,255,255,0.025)', border:'0.5px solid rgba(255,255,255,0.055)',
      }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true" style={{color:'var(--t3)', flexShrink:0, opacity:0.85}}>
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
      </svg>
      <span style={{flex:1, minWidth:0, fontSize:12, color:'var(--t3)', letterSpacing:'-0.005em',
        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
        Keep this chat
      </span>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('bc-guest-claim'))}
        onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}
        style={{flexShrink:0, height:24, padding:'0 9px', borderRadius:7, cursor:'pointer', font:'inherit',
          fontSize:11, fontWeight:550, whiteSpace:'nowrap',
          color: over ? 'var(--t1)' : 'color-mix(in oklab, var(--acc, #6c63ff) 45%, #cfd0e2)',
          background: over ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)',
          border:'1px solid rgba(255,255,255,0.07)',
          transition:'background 0.14s, color 0.14s'}}>
        Create account
      </button>
    </div>
  );
};

// ── GuestEmptyPane ─────────────────────────────────────────────────
// The chat column with no chat open, for a guest: a quiet pointer back to
// their conversation in place of the operator's dashboard.
const GuestEmptyPane = () => (
  <div style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
    gap:7, padding:'0 24px 40px', textAlign:'center'}}>
    <span aria-hidden="true" style={{width:34, height:34, borderRadius:'50%', display:'grid', placeItems:'center', marginBottom:4,
      color:'rgba(186,190,214,0.55)', background:'rgba(255,255,255,0.025)', boxShadow:'inset 0 0 0 1px rgba(255,255,255,0.06)'}}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.3A8.4 8.4 0 1 1 21 11.5z"/>
      </svg>
    </span>
    <span style={{fontSize:12.5, fontWeight:550, color:'rgba(214,216,232,0.62)', letterSpacing:'-0.005em'}}>Select your conversation</span>
    <span style={{fontSize:11.5, lineHeight:1.5, color:'rgba(160,164,184,0.45)', maxWidth:300}}>
      Your chat is on the left. Messages are end-to-end encrypted.
    </span>
  </div>
);

// ── ContactListProfile ─────────────────────────────────────────────
// Who is signed in, as a quiet header line above the search. The name
// reads as the panel's title; the right-hand end holds "Sign out", which
// stays out of sight until the pointer comes near the line (or keyboard
// focus reaches it), then fades in as muted text that only warms to red
// under the pointer itself. Signing out still asks for confirmation, so a
// stray click can't end the session. Fixed height: the search never moves.
// `big`: on a phone (one-pane layout) the name is the screen's title. The
// dashboard's balance and notification chips aren't shown there: earnings
// open from the Payments section of the settings sheet instead.
const ContactListProfile = ({account, big = false}) => {
  const [near, setNear] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Left inset 11px = the search field's own padding, so the name sits on the
  // same vertical line as the magnifier below; "Sign out" ends on the line
  // of the search text's right padding.
  const box = big
    ? { minHeight:24, margin:'2px 0 8px', padding:'0 4px 0 11px' }
    : { height:20, margin:'0 0 7px', padding:'0 4px 0 11px' };
  if (!account) return <div style={box} aria-hidden="true"/>;
  const name = String(account.display_name || account.username || account.email || '').trim();
  const email = String(account.email || '').trim();
  const shown = near || focus || busy;
  // A guest has no account to sign out of: ending the session gives up the
  // chat on this device, so it asks first (GuestLeavePopup).
  const guest = !!account.guest;
  if (guest && typeof ensureGuestStyles === 'function') ensureGuestStyles();

  const signOut = async () => {
    if (guest) { window.dispatchEvent(new CustomEvent('bc-guest-leave')); return; }
    if (busy) return;
    if (!window.confirm('Sign out of this workspace?')) return;
    setBusy(true);
    try { if (typeof AUTH_STORE !== 'undefined' && AUTH_STORE.logout) await AUTH_STORE.logout(); }
    finally { setBusy(false); }
  };

  return (
    <div
      onMouseEnter={()=>setNear(true)} onMouseLeave={()=>{ setNear(false); setOver(false); }}
      style={{
        ...box, boxSizing:'border-box',
        display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
        userSelect:'none',
      }}>
      {/* A touch screen has no hover to reveal Sign out: tapping the name does. */}
      {/* On a phone the name is the screen's title, like any messaging
          app's list header. */}
      <span style={{flex:'0 1 auto', minWidth:0, display:'inline-flex', alignItems:'center', gap:7}}>
      <span title={guest ? `${name} · chatting as a guest` : [name, email].filter(Boolean).join(' · ')} onClick={()=>setNear(n => !n)} style={{
        flex:'0 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        fontSize: big ? 12.5 : 11.5, fontWeight:600,
        letterSpacing:'-0.005em', lineHeight: big ? '24px' : '20px',
        color:'rgba(226,228,240,0.82)', cursor:'default',
      }}>{name}</span>
      {guest && <span className="bc-guest-tag">Guest</span>}
      </span>
      <button type="button" onClick={signOut}
        onMouseEnter={()=>setOver(true)} onMouseLeave={()=>setOver(false)}
        onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
        aria-label={guest ? 'End guest session' : 'Sign out'} title={guest ? 'End this guest session' : 'Sign out of this workspace'}
        tabIndex={0}
        style={{
          all:'unset', boxSizing:'border-box', flexShrink:0, cursor: busy ? 'default' : 'pointer',
          display:'inline-flex', alignItems:'center', gap:4,
          height:20, padding:'0 7px', borderRadius:6,
          fontSize:10, fontWeight:500, letterSpacing:'0.005em', lineHeight:'20px',
          color: over ? 'rgba(236,150,150,0.92)' : 'rgba(168,172,194,0.5)',
          background: over ? 'rgba(220,90,90,0.08)' : 'transparent',
          boxShadow: focus ? '0 0 0 1px rgba(150,148,200,0.45)' : 'none',
          opacity: shown ? 1 : 0,
          transform: shown ? 'none' : 'translateX(3px)',
          pointerEvents: shown ? 'auto' : 'none',
          transition:'opacity 0.16s ease, transform 0.16s ease, color 0.14s ease, background-color 0.14s ease',
        }}>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        <span>{guest ? 'End session' : busy ? 'Signing out…' : 'Sign out'}</span>
      </button>
    </div>
  );
};

// Mount point for the widget dashboard overlay. Listens for the
// edit-toggle event posted by the launcher button.
//
// `hidden` flag: when an in-page chat is open we keep the overlay
// MOUNTED (so widget state, ghost rig and composer state aren't torn
// down) but visually suppress it by toggling a class on <body>. The
// CSS rules in bot-ui-widgets.css (body[data-bcw-hidden="1"] ...)
// hide both .bcw-board and .bcw-composer-layer with display:none so
// none of it bleeds through into the chat surface, AND the WebGL
// ghost overlay canvases are hidden too. Force-close edit mode while
// hidden so the operator never returns to a stale editing state.
const BcwOverlayMountView = ({hidden, ghost}) => {
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => {
    const h = (e) => setEditing(!!e.detail);
    window.addEventListener('bcw:edit-toggle', h);
    return () => window.removeEventListener('bcw:edit-toggle', h);
  }, []);
  React.useEffect(() => { window.__bcwEditing = editing; }, [editing]);
  // Reflect hidden state on <body> so plain CSS can suppress the
  // fixed-position dashboard layers without unmounting them.
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    // Two different kinds of "a chat is open". For a customer chat the
    // ghost should freeze exactly where it was and come back untouched.
    // For the GHOST's own chat he is the subject of the screen — he has to
    // stay alive and travel to the slot in the empty state, so the board
    // hides but he does not.
    if (ghost) document.body.setAttribute('data-bcw-ghost', '1');
    else       document.body.removeAttribute('data-bcw-ghost');
    if (hidden) {
      document.body.setAttribute('data-bcw-hidden', '1');
      // If the user was in edit mode when they opened a chat, drop
      // out of it so the dashed grid / edit panel won't pop back the
      // moment the chat closes — they can re-enter with the launcher.
      if (editing) setEditing(false);
    } else {
      document.body.removeAttribute('data-bcw-hidden');
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.removeAttribute('data-bcw-hidden');
        document.body.removeAttribute('data-bcw-ghost');
      }
    };
  }, [hidden, ghost, editing]);
  const Overlay = (typeof window !== 'undefined') && window.WidgetDashboardOverlay;
  if (!Overlay) return null;
  return <Overlay editing={editing} setEditing={setEditing}/>;
};
// Props are two booleans; it has no reason to redraw when the inbox changes.
const BcwOverlayMount = React.memo(BcwOverlayMountView);

const EmptyChatAvatarView = ({liveMsgs, inChat}) => {
  const auth = (typeof useAuth === 'function') ? useAuth() : {account:null};
  const account = auth && auth.account || null;
  const [tick, setTick]       = React.useState(0);                     // forces clock refresh
  const [lineIdx, setLineIdx] = React.useState(0);
  const [fade, setFade]       = React.useState(true);
  const [weather, setWeather] = React.useState(null);
  const [hasThree, setHasThree] = React.useState(() => typeof window !== 'undefined' && !!window.THREE);
  const threeMountRef  = React.useRef(null);
  const ghostOverlayRef = React.useRef(null);  // full-viewport fixed canvas host (far layer, behind bubble)
  const ghostOverlayNearRef = React.useRef(null); // near layer, in front of bubble
  const entrySeedRef    = React.useRef(Math.random());
  // Imperative controller surface — populated by the WebGL effect below
  // and consumed by the floating dev/test popup. setEmotion/playAction
  // mutate target uniforms; the per-frame tick eases them.
  const ghostCtlRef   = React.useRef(null);
  const [devOpen,  setDevOpen]  = React.useState(false);
  const [devEmo,   setDevEmo]   = React.useState('chill');
  const [devIntro, setDevIntro] = React.useState('rise_in');
  const [devExit,  setDevExit]  = React.useState('fade_out');

  // ── briefing line generator ─────────────────────────────────
  // Rebuilt on every rotation so freshly-arrived data shows up promptly.
  const buildLines = React.useCallback(() => {
    const lines = [];
    const now = new Date();
    const hr  = now.getHours();
    const greet =
      hr < 5  ? 'Working late' :
      hr < 12 ? 'Good morning' :
      hr < 17 ? 'Good afternoon' :
      hr < 22 ? 'Good evening' :
                'Burning the midnight oil';
    const name = (account && (account.display_name || account.username || (account.email||'').split('@')[0])) || '';
    lines.push(name ? `${greet}, ${name}.` : `${greet}.`);

    // Time + day context
    const dayName = now.toLocaleDateString(undefined, {weekday:'long'});
    const timeStr = now.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
    lines.push(`It's ${timeStr} on ${dayName}.`);

    // Inbox stats — derived on the fly from live messages
    const total = (liveMsgs || []).length;
    const unread = (liveMsgs || []).filter(m => m.unread).length;
    const escalated = (liveMsgs || []).filter(m => m.stage === 'escalated' || m.stage === 'needs_help');
    if (unread > 0)        lines.push(`${unread} unread thread${unread===1?'':'s'} waiting.`);
    if (escalated.length)  lines.push(`${escalated.length} need${escalated.length===1?'s':''} a human eye.`);

    // Platform / activity colour
    if (total) {
      const byPlatform = liveMsgs.reduce((acc,m)=>{ const p=m.p||'other'; acc[p]=(acc[p]||0)+1; return acc; }, {});
      const top = Object.entries(byPlatform).sort((a,b)=>b[1]-a[1])[0];
      if (top && top[1] >= 3) {
        const pretty = ({telegram:'Telegram', discord:'Discord', whatsapp:'WhatsApp'})[top[0]] || (top[0][0].toUpperCase()+top[0].slice(1));
        lines.push(`Most of today's traffic is on ${pretty}.`);
      }
    } else {
      lines.push(`Inbox is empty — calm before the next wave.`);
    }

    // Weather (only if we managed to fetch it)
    if (weather) {
      const tempUnit = '°C';
      const where = weather.city ? ` in ${weather.city}` : '';
      lines.push(`${weather.desc}${where}, ${Math.round(weather.temp)}${tempUnit}.`);
    }

    // Closing prompts — pick whichever is most relevant given the state.
    if (escalated.length)   lines.push(`Pick a thread on the left when you're ready.`);
    else if (unread > 0)    lines.push(`Open a thread to dive in.`);
    else                    lines.push(`Pick a conversation on the left to begin.`);

    return lines;
  }, [liveMsgs, account, weather]);

  // Cache the latest line list so the rotation doesn't re-derive constantly.
  const linesRef = React.useRef([]);
  React.useEffect(() => { linesRef.current = buildLines(); }, [buildLines]);

  // Clock tick (every minute) so "It's 3:42 PM" stays current.
  React.useEffect(() => {
    const id = setInterval(() => setTick(t=>t+1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Briefing rotation — fade out, swap line, fade in. ~7s per line.
  React.useEffect(() => {
    const id = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        const lines = linesRef.current;
        if (lines && lines.length) {
          setLineIdx(i => (i + 1) % lines.length);
        }
        setFade(true);
      }, 420); // matches CSS transition
    }, 6800);
    return () => clearInterval(id);
  }, []);

  // Best-effort weather fetch — tries once at mount, fails silently.
  // Open-Meteo + ipapi.co are both free and key-less. If either errors
  // (offline, blocked, CORS, rate-limit) we just don't show weather.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const geo = await fetch('https://ipapi.co/json/', {cache:'force-cache'}).then(r=>r.ok?r.json():null);
        if (!geo || !geo.latitude || !geo.longitude || cancelled) return;
        const w = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code`,
          {cache:'force-cache'}
        ).then(r=>r.ok?r.json():null);
        if (!w || !w.current || cancelled) return;
        const code = w.current.weather_code;
        const desc = (
          code === 0 ? 'Clear skies' :
          code <= 3 ? 'Partly cloudy' :
          code <= 48 ? 'Foggy' :
          code <= 67 ? 'Rainy' :
          code <= 77 ? 'Snowy' :
          code <= 82 ? 'Showering' :
          code <= 99 ? 'Stormy' :
          'Mild weather'
        );
        setWeather({temp: w.current.temperature_2m, desc, city: geo.city || ''});
      } catch (_) { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll for THREE if it wasn't ready at first render. Gives up after 3s.
  React.useEffect(() => {
    if (hasThree) return;
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      if (typeof window !== 'undefined' && window.THREE) { setHasThree(true); clearInterval(id); }
      else if (tries > 30) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [hasThree]);

  // ── Three.js cloth-distorted PNG ghost rig ──────────────────
  // The PNG is mapped onto a 96×128 plane. Vertex shader applies layered
  // distortion that's hem-weighted so the head stays still and the
  // bottom flutters like fabric. Per-x phase offset means each strip of
  // cloth moves out of sync with its neighbours.
  React.useEffect(() => {
    if (!hasThree) return;
    const THREE = window.THREE;
    const mountFar  = ghostOverlayRef.current;
    const mountNear = ghostOverlayNearRef.current;
    const mount = mountFar; // renderer initially attached to far layer
    if (!THREE || !mount) return;

    // ── Full-viewport canvas ───────────────────────────────────
    let VW = window.innerWidth, VH = window.innerHeight;
    // GHOST_UNIT_PX: pixels per world-unit. Must match the ortho camera's
    // half-height. orthoH = 4.4*(VH/BASE_H), half = 2.2*(VH/BASE_H).
    // So 1 world-unit = (VH/2) / (2.2*(VH/320)) = 320/(2*2.2) = 72.73px at any VH.
    // But we want it in terms of VH: (VH/2) / (2.2*(VH/320)) = 320/4.4 = 72.73 (fixed px? No—)
    // Actually: half-height of ortho in world = 2.2*(VH/BASE_H)
    // half-height in pixels = VH/2
    // So 1 world-unit = (VH/2) / (2.2*(VH/BASE_H)) = BASE_H / (2 * 2.2) = 320/4.4 ≈ 72.73px
    // This is CONSTANT regardless of VH — we need a VH-relative version:
    // pxPerWorldUnit = (VH/2) / (orthoH/2) = VH / orthoH
    const BASE_H = 320;
    const GHOST_UNIT_PX = () => {
      const oH = 4.4 * (VH / BASE_H);
      return VH / oH; // pixels per world-unit, matches ortho camera exactly
    };
    const pxToWX = (px) => (px - VW * 0.5) / GHOST_UNIT_PX();
    const pxToWY = (py) => -(py - VH * 0.5) / GHOST_UNIT_PX();
    const wToPX  = (wx) => wx * GHOST_UNIT_PX() + VW * 0.5;
    const wToPY  = (wy) => -wy * GHOST_UNIT_PX() + VH * 0.5;
    const W = VW, H = VH;
    const orthoH = 4.4 * (VH / BASE_H);
    const aspect = VW / VH;
    // Light rendering (BC_PERF, BotCommand.html): the canvas covers the whole
    // window, so its pixel count is the cost. Draw it at 1x without MSAA
    // there; on a high-DPI screen MSAA adds little the extra pixels don't.
    const _perfLite = !!(window.BC_PERF && window.BC_PERF.lite && window.BC_PERF.lite());
    const dpr = _perfLite ? 1 : Math.min(window.devicePixelRatio || 1, 2);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(
      -orthoH * aspect / 2,  orthoH * aspect / 2,
       orthoH / 2,          -orthoH / 2,
      0.1, 100
    );
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !_perfLite && dpr < 1.5, powerPreference: 'high-performance' });
    renderer.setPixelRatio(dpr);
    renderer.setSize(VW, VH);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = [
      'display:block', 'position:absolute', 'inset:0',
      'width:100%', 'height:100%', 'pointer-events:none',
    ].join(';') + ';';

    // ── Texture loader ─────────────────────────────────────
    // Load the PNG as a transparent texture. Premultiplied alpha is
    // turned off so semi-transparent edges of the artwork don't
    // double-darken when blended.
    const texLoader = new THREE.TextureLoader();
    texLoader.crossOrigin = 'anonymous';
    let ghostTex = null;
    let ghostBackTex = null;
    let texReady = false;
    const tryLoad = (url, onDone) => {
      texLoader.load(
        url,
        (tex) => {
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = 4;
          tex.premultiplyAlpha = false;
          tex.needsUpdate = true;
          ghostTex = tex;
          texReady = true;
          if (bodyMat) {
            bodyMat.uniforms.uMap.value = tex;
            bodyMat.needsUpdate = true;
          }
          onDone && onDone();
        },
        undefined,
        () => { /* swallow — fallback CSS img will show via parent */ }
      );
    };
    // Pre-load the back-facing texture so the swap is instant
    texLoader.load(
      GHOST_BACK_IMG_URL,
      (tex) => {
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = 4;
        tex.premultiplyAlpha = false;
        tex.needsUpdate = true;
        ghostBackTex = tex;
      },
      undefined,
      () => { /* back texture unavailable — will fall back to flipped front */ }
    );

    // ── Plane geometry — densely subdivided so the cloth shader has
    // enough vertices to deform smoothly without faceting. The plane
    // matches the source image's 725:506 aspect ratio (roughly 4:3 tall),
    // sized in world units so the head sits ~y=+1.6 and the hem ~y=-1.7.
    const PLANE_W = 3.5;
    const PLANE_H = 4.0;
    const SEGS_X  = 96;
    const SEGS_Y  = 128;
    const planeGeo = new THREE.PlaneGeometry(PLANE_W, PLANE_H, SEGS_X, SEGS_Y);

    // ── Body shader ─────────────────────────────────────────
    // The vertex shader is what makes this feel real. Each layer of
    // distortion is hem-weighted with smoothstep so the head barely
    // moves while the bottom 50% flutters with increasing amplitude.
    const bodyUniforms = {
      uMap:     { value: null },          // populated when texture loads
      uTime:    { value: 0 },
      uOpacity: { value: 0 },
      uHasTex:  { value: 0 },
      // Ripple — fires on click. uRippleT counts seconds since the
      // ripple started (or -1 when idle). uRippleCenter is in plane-
      // local UV (0..1) so the wave radiates from where the cursor
      // touched the ghost.
      uRippleT:      { value: -1 },
      uRippleCenter: { value: new THREE.Vector2(0.5, 0.5) },
      // Smoke dissolve / portal — both are alpha cutouts driven by
      // the same UV-space noise so the body can either evaporate
      // upward (smoke_out) or collapse inward (portal_out).
      uDissolve:     { value: 0 },        // 0 = solid, 1 = fully gone
      uDissolveMode: { value: 0 },        // 0=smoke (vertical), 1=portal (radial)
      uFlipX:        { value: 0 },        // 0=facing front, 1=facing back (mirrors UV.x)
      uTurnAmt:      { value: 0 },
      uBackAmt:      { value: 0 },        // 0..1 — 1 = fully back-facing, drives stronger cloth ripple
    };
    const bodyMat = new THREE.ShaderMaterial({
      uniforms: bodyUniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      vertexShader: `
        uniform float uTime;
        uniform float uRippleT;
        uniform float uFlipX;
        uniform float uTurnAmt;
        uniform float uBackAmt;
        uniform vec2  uRippleCenter;
        varying vec2  vUv;
        varying float vFold;
        varying float vRipple;

        // Layered sine "noise" — cheap, smooth, plenty good for cloth.
        float wob(vec2 p, float t){
          return sin(p.x*1.9 + t*0.85)*0.5
               + sin(p.y*1.4 + t*0.55 + 1.3)*0.5
               + sin((p.x+p.y)*2.4 + t*1.05 + 2.7)*0.35;
        }

        void main(){
          // Turn: mirror UV.x when facing back. No geometry squeeze —
          // the transition is handled purely via opacity fade in/out so
          // there's never an ugly side-on sliver frame.
          float flipUvX = mix(uv.x, 1.0 - uv.x, uFlipX);
          vUv = vec2(flipUvX, uv.y);
          vec3 pos = position;

          // Subtle breathing pulse
          float breathPulse = uTurnAmt * 0.025;
          pos.x *= (1.0 + breathPulse);
          pos.y *= (1.0 + breathPulse * 0.4);

          // Hem weight: 0 above the waist (uv.y > 0.55, since uv.y=1 is
          // top), ramps to 1 at the very bottom. uv.y here is flipped
          // because the texture is upright on the plane: uv.y=0 = bottom.
          // We want the bottom of the texture (uv.y close to 0) to
          // flutter most.
          float hemW = smoothstep(0.55, 0.0, uv.y);

          // Whole-body sway — head moves a tiny bit too.
          float swayW = (1.0 - uv.y) * 0.5 + 0.05;

          // Per-x phase offset so adjacent strips move out of sync.
          float xPhase = position.x * 4.5;
          float n  = wob(position.xy * 1.5 + vec2(uTime * 0.2),  uTime + xPhase);
          float n2 = wob(position.xy * 2.6 - vec2(uTime * 0.3),  uTime * 1.3 + xPhase * 0.7);
          float n3 = wob(position.xy * 3.8 + vec2(uTime * 0.4),  uTime * 1.7 + xPhase * 1.3);

          // uBackAmt: 0=front baseline, 1=back-facing. Subtle extra ripple
          // on the back — more than front but not wild. Reads as cloth
          // catching wind without looking glitchy.
          float backBoost = 1.0 + uBackAmt * 0.85;  // max 1.85× — professional
          float n4 = wob(position.xy * 4.8 + vec2(uTime * 0.45), uTime * 1.9 + xPhase * 1.6);

          // Lateral sway — gently amplified when back-facing.
          pos.x += sin(uTime * 0.6 + position.y * 1.2) * 0.05 * swayW * backBoost;
          pos.y += cos(uTime * 0.5 + position.x * 0.8) * 0.025 * swayW * backBoost;

          // Hem flutter — amplified when back-facing.
          pos.x += n  * 0.10 * hemW * backBoost;
          pos.y += n2 * 0.06 * hemW * backBoost;

          // Micro-ripple — slightly more when back.
          float microW = smoothstep(0.30, 0.0, uv.y);
          pos.x += n3 * 0.04 * microW * backBoost;
          // Subtle back-only flutter: one extra layer, modest amplitude.
          pos.x += n4 * 0.025 * microW * uBackAmt;
          pos.y += n4 * 0.012 * hemW   * uBackAmt;

          // Z-pucker — slightly deeper when back-facing.
          pos.z += sin(uTime * 0.8 + position.x * 2.5) * 0.05 * hemW * backBoost;
          pos.z += cos(uTime * 1.1 - position.y * 1.4 + xPhase) * 0.03 * hemW * backBoost;
          pos.z += n4 * 0.032 * hemW * uBackAmt;  // gentle extra depth ripple

          // Breathing — same when back-facing.
          float breath = sin(uTime * 0.9) * 0.012;
          pos.x *= (1.0 + breath);
          pos.y *= (1.0 + breath * 0.6);

          vFold = n * 0.5 + 0.5;

          // ── Click ripple ─────────────────────────────────
          // Radial sine wave radiating from uRippleCenter (UV space).
          // Window function (1 - t/dur) damps it to zero. Wave thickness
          // in UV is ~0.18; speed gives a single full ring pass over ~1.2s.
          float rippleAmp = 0.0;
          if (uRippleT >= 0.0) {
            float rDist  = distance(uv, uRippleCenter);
            float wave   = sin((rDist * 22.0) - uRippleT * 14.0);
            float front  = uRippleT * 0.85;       // ring centre in UV
            float band   = exp(-pow((rDist - front) / 0.09, 2.0));
            float decay  = clamp(1.0 - uRippleT / 1.2, 0.0, 1.0);
            rippleAmp    = wave * band * decay;
            pos.z += rippleAmp * 0.18;
            pos.x += rippleAmp * 0.04 * sign(uv.x - uRippleCenter.x);
            pos.y += rippleAmp * 0.04 * sign(uv.y - uRippleCenter.y);
          }
          vRipple = rippleAmp;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uMap;
        uniform float uOpacity;
        uniform float uHasTex;
        uniform float uDissolve;
        uniform float uDissolveMode;
        uniform float uFlipX;
        varying vec2  vUv;
        varying float vFold;
        varying float vRipple;

        // Cheap smooth pseudo-noise for the dissolve mask.
        float hash(vec2 p){
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float vnoise(vec2 p){
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main(){
          vec4 tex = texture2D(uMap, vUv);
          if (uHasTex < 0.5) discard;

          // Fold-driven self-shadow + ripple highlight (whitens crests
          // briefly so the click pulse reads as light catching cloth).
          float fold = mix(0.92, 1.04, vFold);
          vec3  rgb  = tex.rgb * fold;
          rgb       += vec3(0.18, 0.20, 0.24) * max(vRipple, 0.0);

          // ── Dissolve (smoke / portal) ───────────────────────
          // Smoke mode (0): mask drifts upward, edge erodes from the
          // bottom up so the ghost evaporates from the hem.
          // Portal mode (1): mask is a radial sweep from a centred
          // ring outward, so the ghost collapses into a vortex.
          float dAlpha = 1.0;
          if (uDissolve > 0.001) {
            float n = vnoise(vUv * 6.0 + vec2(0.0, -uOpacity)) * 0.6
                    + vnoise(vUv * 14.0) * 0.4;
            float thresh;
            if (uDissolveMode < 0.5) {
              // Smoke: weight noise by inverse height so bottom goes first.
              float heightBias = 1.0 - vUv.y;
              thresh = uDissolve * (0.55 + heightBias * 0.6);
            } else {
              // Portal: distance from centre, so it collapses inward.
              float rd = distance(vUv, vec2(0.5));
              thresh = uDissolve * (0.35 + (0.55 - rd) * 0.9);
            }
            dAlpha = smoothstep(thresh, thresh - 0.12, n);
            // Edge glow — a thin band at the dissolve front catches
            // light, selling smoke wisps / portal energy.
            float edge = smoothstep(thresh - 0.14, thresh - 0.05, n)
                       - smoothstep(thresh - 0.05, thresh, n);
            vec3 edgeCol = mix(vec3(0.78, 0.78, 0.85),  // smoke white
                               vec3(0.55, 0.40, 0.95),  // portal violet
                               uDissolveMode);
            rgb = mix(rgb, edgeCol, clamp(edge * 0.9, 0.0, 1.0));
          }

          gl_FragColor = vec4(rgb, tex.a * uOpacity * dAlpha);
        }
      `,
    });

    const bodyMesh = new THREE.Mesh(planeGeo, bodyMat);
    bodyMesh.renderOrder = 2;

    // ── Expressive eyes overlay ─────────────────────────────
    // A second plane sits in front of the ghost body and shares the
    // same cloth-distortion math (so the face "sticks" to the fabric
    // and ripples with it instead of floating). The fragment shader
    // procedurally draws two large, glossy, anime-style black eyes
    // peering out from under the hood, plus a tiny pink mouth hint.
    //   • slow pupil drift (looking around)
    //   • occasional blink (lid drops over the eye)
    //   • muted contrast vs the dirt-grey ghost — no glow, just dark
    //     highlights so they read as ink/paint on cloth, not LEDs
    const EYE_PLANE_W = 2.6;           // wide enough for both eyes + mouth
    const EYE_PLANE_H = 1.6;           // tall enough for eyes + mouth band
    const EYE_SEGS    = 32;
    const eyeGeo = new THREE.PlaneGeometry(EYE_PLANE_W, EYE_PLANE_H, EYE_SEGS, EYE_SEGS);

    // ── Eye uniforms (continuous morphing parameters) ────────
    // Every parameter is a continuous float so emotions blend by
    // smoothly retargeting them — no shape replacement, just shape
    // morphing. The eye is rendered the OLD way: solid dark circles
    // with dimmed catch-lights, no white sclera, no procedural mouth.
    // Emotions flex this single aesthetic — they don't replace it.
    //   • lidUpper / lidLower  — top & bottom lid Y positions
    //   • archTop / archBot    — lid bowing (positive bows up → happy
    //                             crescents; negative bows down → sad)
    //   • pupilScale           — overall dark-eye size (small=scared)
    //   • irisShine            — catch-light brightness
    //   • brow                 — corner-shadow tilt (V or ^)
    //   • tear                 — streak + wet shimmer
    //   • blush / blushHue     — under-eye dusty mauve / red
    //   • shake                — high-frequency tremor
    //   • heart / swirl        — overlay FX (love / dizzy)
    //   • sweat / exclaim      — anime accent marks
    const eyeUniforms = {
      uTime:        { value: 0 },
      uOpacity:     { value: 0 },
      uBlink:       { value: 0 },                       // 0 open → 1 closed
      uLook:        { value: new THREE.Vector2(0, 0) }, // gaze offset (-1..1)
      uLidUpper:    { value: 0 },                       // 0 open → 1 fully down
      uLidLower:    { value: 0 },                       // 0 open → 1 fully up
      uArchTop:     { value: 0 },                       // -1 sad arch → +1 happy arch
      uArchBot:     { value: 0 },                       // +1 = bottom bows up (happy crescent)
      uPupilScale:  { value: 1 },                       // 1 = normal, >1 dilated, <1 pinpoint
      uIrisShine:   { value: 1 },                       // 0 dull → 1 glossy catch-light
      uBrow:        { value: 0 },                       // -1 sad ^ → +1 angry V
      uTear:        { value: 0 },                       // 0 dry → 1 streaming
      uBlush:       { value: 0.5 },                     // base blush
      uBlushHue:    { value: 0 },                       // 0 pink → 1 red (angry/embarrassed)
      uShake:       { value: 0 },                       // 0..1 tremor
      uHeart:       { value: 0 },                       // 0..1 love-eye overlay
      uSwirl:       { value: 0 },                       // 0..1 dizzy-eye spiral
      uSweat:       { value: 0 },                       // 0..1 anime sweat-drop on temple
      uExclaim:     { value: 0 },                       // 0..1 surprise mark
      // ── New: per-emotion micro-flexes ─────────────────────
      uPupilOffsetY:{ value: 0 },                       // vertical pupil shift (sad/angry push down)
      uBlushOffsetY:{ value: 0 },                       // raise blush toward eyes (happy)
      uBlushOffsetX:{ value: 0 },                       // spread blush outward (embarrassed)
      uBlushPulse:  { value: 0 },                       // happy red pulse intensity
      uTearAltL:    { value: -1 },                      // -1 = no drop; 0..1 = drop life phase
      uTearAltR:    { value: -1 },                      // -1 = no drop; 0..1 = drop life phase
      uExclaimStyle:{ value: 0 },                       // 0 = old yellow, 1 = burgundy outlined
      uSweatStream: { value: 0 },                       // 0..1 streaming/running scared sweat
      uStressMarks: { value: 0 },                       // 0..1 southpark ( ) around outer eyes
      uHeartPixel:  { value: 0 },                       // 0..1 pixelated love hearts
      uHeartScale:  { value: 1 },                       // overlay heart size variance
      uHeartClipOut:{ value: 0 },                       // 0..1 let hearts extend past eye
      uSwirlBoost:  { value: 0 },                       // 0..1 boost dizzy contrast/visibility
      uZzzAmt:      { value: 0 },                       // 0..1 sleepy zzz overlay
      uEyeVisible:  { value: 1 },                       // 1=visible, 0=hidden (back-facing)
      // ── Eye layers (real pupil/sclera/highlights model) ───
      // The eye is now a real 4-layer stack instead of one dark disc:
      //   1. Sclera (white) — full eye disc, off-white by default
      //   2. Pupil  (black) — smaller disc inside, size = uPupilFill
      //   3. Highlights    — up to 4 catch-lights inside the pupil
      //   4. Outline       — thin rim of the eye (alpha-controlled)
      // Each layer has its own color + brightness uniforms so the user
      // can tune any part independently.
      //
      // uPupilFill: 0=tiny pinprick pupil, 1=pupil fills entire eye
      //             (sclera completely hidden — "all pupil" mode).
      uPupilFill:    { value: 0.55 },
      // Sclera (white-of-eye) layer
      uScleraColor:  { value: new THREE.Vector3(0.98, 0.98, 1.00) },
      uScleraBright: { value: 1.00 },
      uScleraGrad:   { value: 0.18 },                   // 0..1, vertical depth gradient
      // Pupil (dark) layer
      uPupilColor:   { value: new THREE.Vector3(0.00, 0.00, 0.00) },
      uPupilBright:  { value: 1.00 },                   // 1=full color (i.e. pure black), 0=transparent
      // Outline (rim) layer
      uOutlineColor: { value: new THREE.Vector3(0.04, 0.04, 0.06) },
      uOutlineAlpha: { value: 0.55 },                   // 0=off, 1=hard rim
      uOutlineWidth: { value: 0.020 },                  // in plane units
      // Highlight (catch-light) layer — global controls
      uHiColor:      { value: new THREE.Vector3(1.00, 1.00, 1.00) },
      uHiBright:     { value: 1.00 },                   // multiplies highlight opacity
      uPupilSizeMul: { value: 1 },                      // 0.4..1.8 highlight size multiplier
      uPupilPosX:    { value: 0 },                      // -1..1 horizontal nudge of the cluster
      uPupilPosY:    { value: 0 },                      // -1..1 vertical nudge
      uGlintRestX:   { value: -0.32 },                  // base cluster X (anime upper-outer)
      uGlintRestY:   { value: -0.30 },                  // base cluster Y
      uLidAware:     { value: 1 },                      // soft-fade glints near lids
      // Per-glint array — up to 4 highlights, each fully draggable.
      // x, y are in eye-radius units relative to the cluster centre
      // (so they nudge with the rest position). size is a multiplier
      // of the primary radius. shape: 0=round, 1=oval-tall, 2=oval-wide,
      //                              3=slit, 4=heart, 5=star, 6=crescent.
      // bright multiplies uHiBright. on=1 enables, on=0 disables.
      uG0Pos:    { value: new THREE.Vector2(0.00, 0.00) },
      uG0Cfg:    { value: new THREE.Vector4(1.00, 0, 1.00, 1.0) }, // size, shape, bright, on
      uG1Pos:    { value: new THREE.Vector2(1.40, 1.30) },
      uG1Cfg:    { value: new THREE.Vector4(0.45, 0, 1.00, 1.0) },
      uG2Pos:    { value: new THREE.Vector2(0.00, 0.00) },
      uG2Cfg:    { value: new THREE.Vector4(0.30, 0, 1.00, 0.0) },
      uG3Pos:    { value: new THREE.Vector2(0.00, 0.00) },
      uG3Cfg:    { value: new THREE.Vector4(0.30, 0, 1.00, 0.0) },
      // Effects layer toggles (kept compatible with old UI).
      uGloss:        { value: 0 },
      uSparkle:      { value: 0 },
      uGlisten:      { value: 0 },
      uCrossShine:   { value: 0 },
      // Legacy compatibility — kept so any older code paths reading these
      // don't crash. New shader doesn't need them, but the per-frame
      // updater still mirrors values into them.
      uPupilShape:   { value: 0 },
      uGlintPattern: { value: 1 },
      uEyeBrightness:{ value: 0.0 },
    };
    const eyeMat = new THREE.ShaderMaterial({
      uniforms: eyeUniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: `
        precision highp float;
        uniform float uTime;
        uniform float uShake;
        varying vec2 vUv;

        void main(){
          vUv = uv;
          vec3 pos = position;

          // Ride along with the body's whole-body sway. Reduced amplitude
          // so the eyes never blur — they should feel attached, not
          // wobbling independently.
          float swayW = 0.04;
          pos.x += sin(uTime * 0.6 + position.y * 1.2) * 0.05 * swayW;
          pos.y += cos(uTime * 0.5 + position.x * 0.8) * 0.025 * swayW;

          // Tremor — high-frequency tiny offset, used by scared/angry/laughing.
          if (uShake > 0.001) {
            pos.x += (sin(uTime * 38.0 + position.y * 12.0)) * 0.012 * uShake;
            pos.y += (cos(uTime * 41.0 + position.x * 11.0)) * 0.010 * uShake;
          }

          // Tiny breathing scale.
          float breath = sin(uTime * 0.9) * 0.008;
          pos.x *= (1.0 + breath);
          pos.y *= (1.0 + breath * 0.6);

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uOpacity;
        uniform float uBlink;
        uniform float uEyeVisible;
        uniform float uLidUpper;
        uniform float uLidLower;
        uniform float uArchTop;
        uniform float uArchBot;
        uniform float uPupilScale;
        uniform float uIrisShine;
        uniform float uBrow;
        uniform float uTear;
        uniform float uBlush;
        uniform float uBlushHue;
        uniform float uHeart;
        uniform float uSwirl;
        uniform float uSweat;
        uniform float uExclaim;
        uniform float uPupilOffsetY;
        uniform float uBlushOffsetY;
        uniform float uBlushOffsetX;
        uniform float uBlushPulse;
        uniform float uTearAltL;
        uniform float uTearAltR;
        uniform float uExclaimStyle;
        uniform float uSweatStream;
        uniform float uStressMarks;
        uniform float uHeartPixel;
        uniform float uHeartScale;
        uniform float uHeartClipOut;
        uniform float uSwirlBoost;
        uniform float uZzzAmt;
        uniform vec2  uLook;
        // ── Eye-layer uniforms (real sclera/pupil/highlights) ───
        uniform float uPupilFill;
        uniform vec3  uScleraColor;
        uniform float uScleraBright;
        uniform float uScleraGrad;
        uniform vec3  uPupilColor;
        uniform float uPupilBright;
        uniform vec3  uOutlineColor;
        uniform float uOutlineAlpha;
        uniform float uOutlineWidth;
        uniform vec3  uHiColor;
        uniform float uHiBright;
        // Highlight cluster controls (nudges + base/rest position)
        uniform float uPupilSizeMul;
        uniform float uPupilPosX;
        uniform float uPupilPosY;
        uniform float uGlintRestX;
        uniform float uGlintRestY;
        uniform float uLidAware;
        // Per-glint array — 4 glints, each (x,y) + (size, shape, bright, on)
        uniform vec2  uG0Pos;  uniform vec4 uG0Cfg;
        uniform vec2  uG1Pos;  uniform vec4 uG1Cfg;
        uniform vec2  uG2Pos;  uniform vec4 uG2Cfg;
        uniform vec2  uG3Pos;  uniform vec4 uG3Cfg;
        // Effects toggles
        uniform float uGloss;
        uniform float uSparkle;
        uniform float uGlisten;
        uniform float uCrossShine;
        // Legacy stubs — kept to avoid breaking older paths
        uniform float uPupilShape;
        uniform float uGlintPattern;
        uniform float uEyeBrightness;
        varying vec2  vUv;

        // ── Shape primitives ────────────────────────────────────────
        float sdHeart(vec2 p, float s){
          p /= s;
          p.x = abs(p.x);
          if (p.y + p.x > 1.0)
            return (sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0)/4.0) * s;
          return (sqrt(min(
            dot(p - vec2(0.00, 1.00), p - vec2(0.00, 1.00)),
            dot(p - 0.5*max(p.x + p.y, 0.0), p - 0.5*max(p.x + p.y, 0.0))
          )) * sign(p.x - p.y)) * s;
        }

        // ── per-glint SDF helper ───────────────────────────────
        // Returns a 0..1 mask for one highlight at offset gPos (in primary-
        // radius units, relative to cluster centre), with size mult and
        // shape index. shape: 0=round, 1=oval-tall, 2=oval-wide, 3=slit,
        // 4=heart, 5=star, 6=crescent.
        float glintMask(vec2 pHi, vec2 gPos, float gSize, float shape, float hr1){
          vec2 pp = pHi - gPos * hr1;
          float r = hr1 * gSize;
          float d = 9999.0;
          int s = int(floor(shape + 0.5));
          if (s == 0) {
            d = length(pp) - r;
          } else if (s == 1) {
            vec2 q = pp; q.x *= 1.55;
            d = length(q) - r;
          } else if (s == 2) {
            vec2 q = pp; q.y *= 1.55;
            d = length(q) - r;
          } else if (s == 3) {
            vec2 q = pp; q.x *= 3.0;
            d = length(q) - r * 0.95;
          } else if (s == 4) {
            d = sdHeart(pp, r * 1.2);
          } else if (s == 5) {
            float ang = atan(pp.y, pp.x);
            float rad = length(pp);
            float starR = r * (0.78 + 0.30 * cos(5.0 * ang));
            d = rad - starR;
          } else if (s == 6) {
            // Crescent — outer disc minus offset inner disc.
            float dOuter = length(pp) - r;
            float dInner = length(pp - vec2(0.0, -r * 0.45)) - r * 0.92;
            d = max(dOuter, -dInner);
          }
          return smoothstep(0.006, -0.004, d);
        }

        // singleEye: builds a per-eye 4-layer stack.
        //   • Full eye disc  (sclera-bounding circle)
        //   • Pupil disc     (smaller dark circle inside, size = uPupilFill)
        //   • Highlights     (up to 4 glints, only inside the pupil)
        //   • Lid edge       (subtle outline where lid meets eye)
        // Output (all 0..1):
        //   .x = full eye disc mask (sclera + pupil together)
        //   .y = pupil mask (the dark inner)
        //   .z = highlights mask (catch-lights, fully inside pupil)
        //   .w = lid edge mask
        vec4 singleEye(vec2 p, float rEye, float lookSign){
          // Gaze offset — small, since the whole eye drifts (no separate
          // pupil to slide around inside a sclera). This matches the
          // old behaviour: pupil offset shifted catch-lights, not
          // pupil position. Both eyes get the same offset (no per-eye
          // flip) so they look in the same direction together.
          vec2 look = uLook * 0.03;

          // ── Lid Y positions ────────────────────────────────────
          float topY = rEye - rEye * 1.95 * max(uLidUpper, uBlink * 0.5);
          float botY = -rEye + rEye * 1.95 * max(uLidLower, uBlink * 0.5);

          // Bowing — uArchTop bends top lid, uArchBot bends bottom.
          float xn = clamp(p.x / rEye, -1.0, 1.0);
          float archProfile = 1.0 - xn * xn;
          float topShift = uArchTop * rEye * 0.55 * archProfile;
          float botShift = uArchBot * rEye * 0.55 * archProfile;
          float topLine = topY + topShift;
          float botLine = botY + botShift;

          // Lid mask — 1 where eye is open, 0 where covered.
          float feather = 0.012;
          float openTop = smoothstep(topLine, topLine - feather, p.y);
          float openBot = smoothstep(botLine - feather, botLine, p.y);
          float lidOpen = openTop * openBot;

          // ── Full eye disc (sclera-bounding circle) ────────────
          // Slight horizontal squash so it reads as a natural almond.
          // Scaled by uPupilScale so emotions can shrink/grow the eye.
          // uPupilOffsetY shifts the disc vertically for sad/angry.
          float r = rEye * uPupilScale;
          vec2 q = p - vec2(0.0, uPupilOffsetY * rEye);
          q.y *= 1.05;
          float dEye = length(q) - r;
          float fullMask = smoothstep(0.012, -0.012, dEye) * lidOpen;

          // ── Pupil disc ─────────────────────────────────────────
          // Size driven by uPupilFill: 0=tiny pinprick, 1=fills entire eye
          // (sclera invisible — "all pupil" mode). The pupil sits at the
          // cluster centre so highlights stay inside it as they move.
          // Pupil follows gaze too so it looks alive.
          vec2 ppOff = vec2(uPupilPosX, uPupilPosY);
          vec2 restOff = vec2(uGlintRestX, uGlintRestY);
          vec2 totalOff = ppOff + restOff;
          float toLen = length(totalOff);
          if (toLen > 0.55) totalOff *= 0.55 / toLen;
          // Pupil centre: sits at the cluster centre, plus gaze drift.
          // We use a softer offset for the pupil itself (50% of cluster
          // offset) so the pupil never reaches the eye rim.
          vec2 pupilC = totalOff * r * 0.50
                      + vec2(0.0, uPupilOffsetY * rEye)
                      - look * 0.5;
          // Pupil radius — clamped so even at uPupilFill=1 it slightly
          // overshoots the disc (so sclera completely disappears).
          // At fill=0 it's ~10% of eye for a pinprick look.
          float pupilR = r * mix(0.10, 1.05, clamp(uPupilFill, 0.0, 1.0));
          float dPup = length(p - pupilC) - pupilR;
          // Pupil is hard-clipped to the full disc so it can't bulge out.
          float pupilMask = smoothstep(0.010, -0.010, dPup) * fullMask;

          // ── Highlights (catch-lights inside the pupil) ────────
          // Cluster centre matches pupil centre so dragging position
          // moves highlights AND pupil together — feels alive.
          vec2 hiCenter = pupilC;
          // Primary radius — scaled to pupil size so highlights don't
          // overflow when pupil is tiny.
          float hr1 = pupilR * 0.30 * uPupilSizeMul;

          // Each glint: position is in primary-radius units relative to
          // cluster centre. We add a small per-glint Y bias so default
          // arrangements read correctly. Each cfg = (size, shape, bright, on).
          float hi0 = (uG0Cfg.w > 0.5) ? glintMask(p - hiCenter, uG0Pos, uG0Cfg.x, uG0Cfg.y, hr1) * uG0Cfg.z : 0.0;
          float hi1 = (uG1Cfg.w > 0.5) ? glintMask(p - hiCenter, uG1Pos, uG1Cfg.x, uG1Cfg.y, hr1) * uG1Cfg.z : 0.0;
          float hi2 = (uG2Cfg.w > 0.5) ? glintMask(p - hiCenter, uG2Pos, uG2Cfg.x, uG2Cfg.y, hr1) * uG2Cfg.z : 0.0;
          float hi3 = (uG3Cfg.w > 0.5) ? glintMask(p - hiCenter, uG3Pos, uG3Cfg.x, uG3Cfg.y, hr1) * uG3Cfg.z : 0.0;
          float hRaw = max(max(hi0, hi1), max(hi2, hi3));

          // ── Effects layer ─────────────────────────────────────
          vec2 pHi = p - hiCenter;
          // gloss: tight horizontal crescent strip on top of primary.
          if (uGloss > 0.001) {
            vec2 gp = pHi;
            gp.y += hr1 * 0.55;
            gp.y *= 3.2;
            float dGloss = length(gp) - hr1 * 0.85;
            float gloss = smoothstep(0.005, -0.003, dGloss);
            hRaw = max(hRaw, gloss * uGloss);
          }
          // crossShine: diamond cross spike radiating from primary.
          if (uCrossShine > 0.001) {
            float armLen = hr1 * 2.6;
            float armTh  = hr1 * 0.16;
            float dHrz = max(abs(pHi.x) - armLen, abs(pHi.y) - armTh);
            float dVrt = max(abs(pHi.y) - armLen, abs(pHi.x) - armTh);
            float arm = max(
              smoothstep(0.004, -0.002, dHrz),
              smoothstep(0.004, -0.002, dVrt)
            );
            float fade = 1.0 - clamp(length(pHi) / armLen, 0.0, 1.0);
            hRaw = max(hRaw, arm * fade * uCrossShine);
          }
          // sparkle: animated 4-point twinkle on enabled glints (1..3).
          if (uSparkle > 0.001) {
            for (int i = 1; i < 4; i++) {
              vec2 gp = vec2(0.0); float gOn = 0.0; float gSz = 0.0;
              if (i == 1) { gp = uG1Pos; gOn = uG1Cfg.w; gSz = uG1Cfg.x; }
              else if (i == 2) { gp = uG2Pos; gOn = uG2Cfg.w; gSz = uG2Cfg.x; }
              else { gp = uG3Pos; gOn = uG3Cfg.w; gSz = uG3Cfg.x; }
              if (gOn > 0.5) {
                vec2 cs = hiCenter + gp * hr1;
                vec2 ds = p - cs;
                float twk = 0.5 + 0.5 * sin(uTime * (4.5 + float(i) * 0.4) + float(i) * 1.3);
                float sz  = hr1 * (gSz * 1.55) * (0.6 + 0.55 * twk);
                float k   = abs(ds.x) + abs(ds.y);
                float spike = smoothstep(0.006, -0.003, k - sz);
                hRaw = max(hRaw, spike * (0.55 + 0.45 * twk) * uSparkle);
              }
            }
          }
          // glisten: gentle pulse on every glint.
          if (uGlisten > 0.001) {
            float pulse = 0.85 + 0.15 * sin(uTime * 2.3);
            hRaw *= mix(1.0, pulse, uGlisten);
          }

          // ── Lid-aware fade ────────────────────────────────────
          float lidBand = max(hr1 * 1.6, 0.001);
          float dTop = topLine - p.y;
          float dBot = p.y - botLine;
          float lidFade = smoothstep(0.0, lidBand, min(dTop, dBot));
          float aware = clamp(uLidAware, 0.0, 1.0);
          float lidShape = mix(1.0, lidFade, aware);

          // Crescent suppression — happy arch swallows the catch-lights.
          float crescent = smoothstep(0.4, 0.9, max(uArchBot, 0.0))
                         * smoothstep(0.3, 0.8, uLidUpper);

          // Highlights: must be inside pupil, scaled by shine, suppressed
          // by crescent, optionally lid-faded.
          float hiMask = hRaw * pupilMask * uIrisShine * (1.0 - crescent) * lidShape;

          // ── Lid edge — subtle eyeliner ────────────────────────
          float topEdge = smoothstep(0.012, 0.0, abs(p.y - topLine)) * step(p.x*p.x, rEye*rEye*1.05);
          float botEdge = smoothstep(0.010, 0.0, abs(p.y - botLine)) * step(p.x*p.x, rEye*rEye*1.05);
          float edgeMask = max(topEdge, botEdge) * lidOpen;

          return vec4(fullMask, pupilMask, hiMask, edgeMask);
        }

        void main(){
          // Centre UVs and aspect-correct.
          vec2 uv = vUv - 0.5;
          uv.x *= ${(EYE_PLANE_W / EYE_PLANE_H).toFixed(4)};

          // ── Eye centres (printed face row) ─────────────────
          vec2 eyeL = vec2(-0.23,  0.06);
          vec2 eyeR = vec2( 0.23,  0.06);

          float rEye = 0.19;
          vec2 pL = uv - eyeL;
          vec2 pR = uv - eyeR;

          vec4 eL = singleEye(pL, rEye,  1.0);
          vec4 eR = singleEye(pR, rEye, -1.0);

          // ── Brow tilt (subtle inner/outer corner shadow) ────
          // Angry: inner corners come down (V-shape). Sad: outer corners
          // drop (^-shape). Soft shadow over the upper quadrant of each
          // eye — kept light so it reads as a flex of the same painted
          // eye, not a separate brow line.
          float browAngry = max(uBrow, 0.0);
          float browSad   = max(-uBrow, 0.0);
          float angryL = smoothstep(0.0, 0.18, pL.x) * smoothstep(0.0, 0.16, pL.y) * browAngry;
          float angryR = smoothstep(0.0, 0.18,-pR.x) * smoothstep(0.0, 0.16, pR.y) * browAngry;
          float sadL   = smoothstep(0.0, 0.18,-pL.x) * smoothstep(0.0, 0.16, pL.y) * browSad;
          float sadR   = smoothstep(0.0, 0.18, pR.x) * smoothstep(0.0, 0.16, pR.y) * browSad;
          float browDarkL = max(angryL, sadL) * 0.40;
          float browDarkR = max(angryR, sadR) * 0.40;

          // ── Tear ───────────────────────────────────────────
          // Each eye is a single self-contained falling drop, fully
          // driven by a continuous phase value (uTearAltL / uTearAltR)
          // computed in JS. Phase 0..1 is one full drop's lifetime;
          // negative or >1 means "no drop right now" so the shader
          // draws nothing and there's no flicker.
          float tearStreakL = 0.0;
          float tearStreakR = 0.0;
          if (uTear > 0.001) {
            float tearLen = 0.40;     // fixed travel distance, no length jitter
            float tearW   = 0.011;    // narrow & consistent

            // LEFT eye drop
            if (uTearAltL >= 0.0 && uTearAltL <= 1.0) {
              float ph = uTearAltL;
              vec2  tStart = eyeL + vec2(-0.05, -rEye * 0.85);
              float headY  = tStart.y - ph * tearLen;
              vec2  pos    = vec2(tStart.x, headY);
              vec2  d      = uv - pos;
              // Tear-drop SDF: round bottom + pointy top
              float bulge = length(d - vec2(0.0, -0.004)) - tearW;
              float point = -d.y - 0.018 + abs(d.x) * 1.4;
              float dropSDF = max(bulge, point);
              float drop = smoothstep(0.005, -0.005, dropSDF);
              // Fade in at start of life, fade out before clipping out
              float lifeFade = smoothstep(0.0, 0.10, ph)
                             * (1.0 - smoothstep(0.78, 1.0, ph));
              tearStreakL = drop * lifeFade;
            }

            // RIGHT eye drop
            if (uTearAltR >= 0.0 && uTearAltR <= 1.0) {
              float ph = uTearAltR;
              vec2  tStart = eyeR + vec2( 0.05, -rEye * 0.85);
              float headY  = tStart.y - ph * tearLen;
              vec2  pos    = vec2(tStart.x, headY);
              vec2  d      = uv - pos;
              float bulge = length(d - vec2(0.0, -0.004)) - tearW;
              float point = -d.y - 0.018 + abs(d.x) * 1.4;
              float dropSDF = max(bulge, point);
              float drop = smoothstep(0.005, -0.005, dropSDF);
              float lifeFade = smoothstep(0.0, 0.10, ph)
                             * (1.0 - smoothstep(0.78, 1.0, ph));
              tearStreakR = drop * lifeFade;
            }
          }

          // ── Heart-eye overlay (love) ───────────────────────
          // Hearts can extend slightly past the eye rim (uHeartClipOut)
          // instead of being trimmed to the dark eye mask, so they feel
          // like they're popping out.
          float heartL = 0.0, heartR = 0.0;
          if (uHeart > 0.001) {
            float pulse = 1.0 + sin(uTime * 4.5) * 0.10 * uHeart;
            float scaleVar = uHeartScale;          // varies in JS over time
            float hSize = rEye * 1.05 * pulse * scaleVar;

            heartL = smoothstep(0.014, -0.005, sdHeart(pL * vec2(1.0, -1.0), hSize));
            heartR = smoothstep(0.014, -0.005, sdHeart(pR * vec2(1.0, -1.0), hSize));

            // Clip behaviour: blend between strict-clip (heart * eyeMask) and
            // free (extends past the rim). uHeartClipOut=1 → fully free.
            float clipL = mix(eL.x, 1.0, uHeartClipOut);
            float clipR = mix(eR.x, 1.0, uHeartClipOut);
            heartL *= clipL;
            heartR *= clipR;
          }

          // Tiny extra hearts — small detached hearts drifting up around
          // the ghost when in love (subtle, only sometimes via JS scale).
          // Two emit points, alternating phase.
          float extraHearts = 0.0;
          if (uHeart > 0.001) {
            float driftT = uTime * 0.45;
            // Heart 1 — left side, slow vertical climb with sway
            float p1 = fract(driftT);
            vec2  hp1 = vec2(-0.50 + sin(driftT * 1.4) * 0.04, -0.35 + p1 * 0.95);
            float h1 = smoothstep(0.012, -0.004, sdHeart((uv - hp1) * vec2(1.0, -1.0), 0.028));
            // Fade in/out across the lifetime.
            float a1 = smoothstep(0.0, 0.15, p1) * (1.0 - smoothstep(0.75, 1.0, p1));
            // Heart 2 — right side, offset phase
            float p2 = fract(driftT + 0.55);
            vec2  hp2 = vec2( 0.48 + sin(driftT * 1.1 + 1.7) * 0.04, -0.30 + p2 * 0.95);
            float h2 = smoothstep(0.012, -0.004, sdHeart((uv - hp2) * vec2(1.0, -1.0), 0.022));
            float a2 = smoothstep(0.0, 0.15, p2) * (1.0 - smoothstep(0.75, 1.0, p2));
            extraHearts = max(h1 * a1, h2 * a2) * uHeart * 0.7;
          }

          // ── Dizzy swirl overlay ────────────────────────────
          // Two rotating spiral arms with sharper contrast so the swirl
          // reads clearly over the dark eye fill. uSwirlBoost lifts the
          // arm brightness and widens the band slightly.
          float swirlL = 0.0, swirlR = 0.0;
          if (uSwirl > 0.001) {
            float aL = atan(pL.y, pL.x);
            float aR = atan(pR.y, pR.x);
            float rL = length(pL) / rEye;
            float rR = length(pR) / rEye;
            // Spin a bit faster + 2 arms (3.0 → 2.0 winding for crisper bands).
            float spiralL = sin(aL * 2.0 + rL * 16.0 - uTime * 6.0);
            float spiralR = sin(aR * 2.0 + rR * 16.0 - uTime * 6.0);
            float band = mix(0.55, 0.30, uSwirlBoost);   // wider band when boosted
            float bandHi = mix(0.95, 0.85, uSwirlBoost);
            swirlL = smoothstep(band, bandHi, spiralL) * eL.x;
            swirlR = smoothstep(band, bandHi, spiralR) * eR.x;
            // Add a faint inner dot at each eye centre for the classic
            // hypnosis-target look.
            float dotL = smoothstep(0.025, 0.0, length(pL) - rEye * 0.10) * eL.x;
            float dotR = smoothstep(0.025, 0.0, length(pR) - rEye * 0.10) * eR.x;
            swirlL = max(swirlL, dotL * 0.9 * uSwirl);
            swirlR = max(swirlR, dotR * 0.9 * uSwirl);
          }

          // ── Pink under-eye blush ───────────────────────────
          // Tighter and closer to the eye since eyes are smaller.
          // BlushHue shifts dusty pink → red for angry / embarrassed.
          // uBlushOffsetY raises the blush toward the eye for happy,
          // and uBlushPulse tints it warmer in time with a soft heartbeat.
          float happyPulse = 0.5 + 0.5 * sin(uTime * 2.6);   // 0..1
          float pulseAmt   = uBlushPulse * happyPulse * 0.35;
          float effHue     = clamp(uBlushHue + pulseAmt, 0.0, 1.0);
          float blushY     = -0.22 + uBlushOffsetY * 0.07;   // raise up to ~7% of plane
          float blushX     = uBlushOffsetX * 0.06;           // spread outward
          vec2 blushL = vec2(eyeL.x - blushX,  eyeL.y + blushY);
          vec2 blushR = vec2(eyeR.x + blushX,  eyeR.y + blushY);
          float dbL = length(uv - blushL) - 0.06;
          float dbR = length(uv - blushR) - 0.06;
          float blushBoost = uBlushPulse * (0.04 + happyPulse * 0.06);
          float blushMask = max(
            smoothstep(0.05, -0.02, dbL),
            smoothstep(0.05, -0.02, dbR)
          ) * (0.40 + uBlush * 0.45 + blushBoost);

          // ── Sweat drop (anime nervous) ─────────────────────
          // Two modes:
          //   • Default (embarrassed): a single drop on the temple.
          //   • uSweatStream (scared): drop slides down the side of
          //     the head with a dark outline so it reads against the
          //     ghost cloth.
          float sweatMask = 0.0;
          float sweatOutline = 0.0;
          if (uSweat > 0.001) {
            // Streaming run distance — scared makes it travel down further.
            float runY = uSweatStream * (0.10 + 0.20 * fract(uTime * 0.6));
            vec2 sCenter = vec2(0.45, 0.30 - uSweat * 0.18 - runY);
            vec2 ps = uv - sCenter;
            float bulge = length(ps - vec2(0.0, -0.01)) - 0.030;
            float point = ps.y - 0.02 + abs(ps.x) * 1.6;
            float dropSDF = max(bulge, point);
            sweatMask = smoothstep(0.006, -0.006, dropSDF) * uSweat;
            // Outline ring just outside the drop, only when streaming.
            sweatOutline = smoothstep(0.014, 0.006, dropSDF)
                         * (1.0 - smoothstep(0.006, -0.006, dropSDF))
                         * uSweatStream;
          }

          // ── Exclaim mark (surprise) ────────────────────────
          // Two visual modes:
          //   • style 0 → original yellow ! (kept for any legacy use)
          //   • style 1 → burgundy ! with a thin dark outline and a
          //     soft drop shadow so it reads cleanly over the ghost.
          float exclaimMask = 0.0;
          float exclaimOutline = 0.0;
          float exclaimShadow = 0.0;
          if (uExclaim > 0.001) {
            vec2 ex = uv - vec2(0.0, 0.42);
            vec2 d = abs(ex) - vec2(0.018, 0.060);
            float rect = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
            float bar  = smoothstep(0.005, 0.0, rect);
            float dotR = length(ex - vec2(0.0, -0.10));
            float dot  = smoothstep(0.014, 0.010, dotR);
            exclaimMask = max(bar, dot) * uExclaim;

            // Outline — slightly larger silhouette, keep only the rim.
            float barOut = smoothstep(0.010, 0.005, rect);
            float dotOut = smoothstep(0.018, 0.014, dotR);
            float full   = max(barOut, dotOut);
            exclaimOutline = max(0.0, full - exclaimMask) * uExclaimStyle * uExclaim;

            // Soft drop shadow — same shape, offset down-right, blurred.
            vec2 sx = ex - vec2(0.012, -0.014);
            vec2 sd = abs(sx) - vec2(0.018, 0.060);
            float sRect = length(max(sd, 0.0)) + min(max(sd.x, sd.y), 0.0);
            float sBar  = smoothstep(0.020, 0.0, sRect);
            float sDot  = smoothstep(0.028, 0.012, length(sx - vec2(0.0, -0.10)));
            exclaimShadow = max(sBar, sDot) * 0.35 * uExclaimStyle * uExclaim;
          }

          // ── Stress parens (scared, Southpark-style) ────────
          // ")" sits just outside the LEFT eye on its left side;
          // "(" sits just outside the RIGHT eye on its right side.
          // Each is a thin arc — a slice of a circle whose center is
          // placed further OUT so the arc curves AROUND the eye.
          float stressMask = 0.0;
          if (uStressMarks > 0.001) {
            float arcR = rEye * 1.20;       // arc radius
            float arcW = 0.008;             // line thickness
            float gap  = 0.012;             // gap between eye rim and arc

            // ")" — its circle center is to the LEFT of the visible arc.
            // Visible arc sits at pL.x ≈ -(rEye + gap); circle center
            // therefore at pL.x = -(rEye + gap + arcR). We display the
            // right half of that circle (rp.x > 0 in circle-local coords).
            vec2 rCenter = vec2(-(rEye + gap + arcR), 0.0);
            vec2 rp = pL - rCenter;
            float ringR = abs(length(rp) - arcR);
            float arcRr = smoothstep(arcW + 0.004, arcW - 0.001, ringR)
                        * smoothstep(0.0, 0.06, rp.x);   // right half only

            // "(" — circle center to the RIGHT of the visible arc.
            // Visible arc at pR.x ≈ (rEye + gap); circle center at
            // pR.x = (rEye + gap + arcR). Display the LEFT half (lp.x < 0).
            vec2 lCenter = vec2( (rEye + gap + arcR), 0.0);
            vec2 lp = pR - lCenter;
            float ringL = abs(length(lp) - arcR);
            float arcLl = smoothstep(arcW + 0.004, arcW - 0.001, ringL)
                        * smoothstep(0.0, 0.06, -lp.x);  // left half only

            stressMask = max(arcLl, arcRr) * uStressMarks;
          }

          // ── ZZZ (sleepy) ───────────────────────────────────
          // Three small Z's drift up and slightly right, starting from
          // above the right side of the head. Positions chosen so they
          // stay well inside the plane bounds (uv.y goes -0.5..+0.5,
          // uv.x roughly -0.81..+0.81 with this aspect).
          float zzzMask = 0.0;
          if (uZzzAmt > 0.001) {
            for (int i = 0; i < 3; i++) {
              float fi = float(i);
              float ph = fract(uTime * 0.35 + fi * 0.33);
              // Start lower and to the right; travel up just a bit so
              // the whole letter stays comfortably inside the plane.
              vec2 zc = vec2(0.20 + fi * 0.07 + ph * 0.08,
                             0.05 + fi * 0.07 + ph * 0.18);
              vec2 zp = uv - zc;
              // Z size shrinks as it floats up
              float sz = 0.060 * (1.0 - ph * 0.30);
              vec2 zq = zp / sz;
              // Z-shape: top bar, diagonal, bottom bar — bound to a
              // square cell so strokes stay attached.
              float top = smoothstep(0.18, 0.06, abs(zq.y - 0.5))
                        * step(abs(zq.x), 0.5);
              float bot = smoothstep(0.18, 0.06, abs(zq.y + 0.5))
                        * step(abs(zq.x), 0.5);
              float diag = smoothstep(0.18, 0.06, abs(zq.x + zq.y))
                         * step(abs(zq.x), 0.5)
                         * step(abs(zq.y), 0.5);
              float zMask = max(top, max(bot, diag));
              float fade = (1.0 - smoothstep(0.7, 1.0, ph)) * smoothstep(0.0, 0.15, ph);
              zzzMask = max(zzzMask, zMask * fade);
            }
            zzzMask *= uZzzAmt;
          }

          // ── Compose ────────────────────────────────────────
          // New 4-layer palette: sclera (white), pupil (black), highlights
          // (white), outline (rim). Each driven by user uniforms so all
          // colors and brightness are controllable in the dashboard.
          // Sclera color (scaled by brightness multiplier).
          vec3 scleraCol = uScleraColor * clamp(uScleraBright, 0.0, 1.5);
          // Pupil color (scaled by brightness; 1=full color, 0=transparent).
          vec3 pupilCol  = uPupilColor  * clamp(uPupilBright, 0.0, 1.5);
          // Highlight color (scaled by brightness multiplier).
          vec3 hiCol     = uHiColor     * clamp(uHiBright, 0.0, 1.5);
          // Outline color (alpha controls visibility).
          vec3 outCol    = uOutlineColor;
          vec3 pinkCol  = mix(vec3(0.55, 0.36, 0.40),    // dusty pink
                              vec3(0.78, 0.30, 0.32),    // angry red
                              effHue);
          vec3 tearCol  = vec3(0.78, 0.86, 0.95);
          vec3 heartCol = vec3(0.78, 0.28, 0.40);   // muted heart, sits in palette
          // Dizzy swirl — soft hue cycle so it's visible on the pupil.
          vec3 swirlA   = vec3(0.85, 0.78, 0.55);   // pale gold
          vec3 swirlB   = vec3(0.62, 0.78, 0.92);   // soft blue
          vec3 swirlC   = vec3(0.92, 0.70, 0.78);   // soft pink
          float swirlT  = uTime * 0.6;
          vec3 swirlCol = mix(
            mix(swirlA, swirlB, 0.5 + 0.5 * sin(swirlT)),
            swirlC,
            0.5 + 0.5 * sin(swirlT * 0.7 + 1.3)
          );
          vec3 sweatCol = vec3(0.78, 0.92, 0.98);
          vec3 sweatOutCol = vec3(0.10, 0.12, 0.16);
          // Old ! is yellow; new burgundy variant blends in with the palette.
          vec3 exclColYellow = vec3(0.95, 0.85, 0.30);
          vec3 exclColBurg   = vec3(0.45, 0.10, 0.18);
          vec3 exclCol  = mix(exclColYellow, exclColBurg, uExclaimStyle);
          vec3 exclOutCol = vec3(0.05, 0.04, 0.06);
          vec3 stressCol = vec3(0.06, 0.06, 0.08);
          vec3 clothMid = vec3(0.46, 0.48, 0.54);

          float eyeMask  = max(eL.x, eR.x);    // full eye disc (sclera + pupil)
          float pupilMask = max(eL.y, eR.y);   // pupil disc (the dark inner)
          float hiMask   = max(eL.z, eR.z);    // highlights (catch-lights)
          float browMask = max(browDarkL, browDarkR);
          float tearMask = max(tearStreakL, tearStreakR);
          float heartM   = max(heartL, heartR);
          float swirlM   = max(swirlL, swirlR);

          vec3 col = vec3(0.0);
          float alpha = 0.0;

          // Layer order (back → front):
          //   exclaim shadow → blush → SCLERA → PUPIL → HIGHLIGHTS →
          //   OUTLINE → brow shadow → heart/swirl → tear → exclaim → sweat → stress
          col   = mix(col, vec3(0.0), exclaimShadow);
          alpha = max(alpha, exclaimShadow * 0.5);

          col   = mix(col, pinkCol, blushMask * 0.9);
          alpha = max(alpha, blushMask * 0.85);

          // ── SCLERA (white-of-eye) ─────────────────────────────
          // Subtle vertical depth gradient on the sclera so the bottom
          // is slightly darker — adds dimensionality without anyone
          // consciously noticing it. Driven by uScleraGrad (0=flat).
          float gradT = clamp((uv.y - eyeL.y + 0.10) / 0.30 + 0.5, 0.0, 1.0);
          vec3 scleraGradCol = mix(scleraCol * 0.85, scleraCol, gradT);
          vec3 paintedSclera = mix(scleraCol, scleraGradCol, clamp(uScleraGrad, 0.0, 1.0));
          col   = mix(col, paintedSclera, eyeMask);
          alpha = max(alpha, eyeMask * 0.97);

          // ── PUPIL (the black inner disc — controllable size) ─
          // Painted ON TOP of the sclera. uPupilFill drives the radius
          // (in singleEye), so dragging the slider to 1.0 makes the
          // pupil cover the entire eye → no sclera visible.
          col   = mix(col, pupilCol, pupilMask);

          // ── HIGHLIGHTS (catch-lights inside the pupil) ────────
          // Full-strength now (was hiMask*0.65 in the old code) — the
          // user controls brightness via uHiBright on the color side.
          col   = mix(col, hiCol, hiMask);

          // ── OUTLINE (rim around the eye) ──────────────────────
          // Thin ring at the eye boundary. Width controlled by
          // uOutlineWidth, opacity by uOutlineAlpha.
          float outerR = max(length(pL - vec2(0.0, uPupilOffsetY * rEye) * 0.0), 0.0);
          // Use a per-eye outline computed inline — distance to nearer eye edge.
          float dEdgeL = abs(length((pL - vec2(0.0, uPupilOffsetY * rEye)) * vec2(1.0, 1.05)) - rEye * uPupilScale);
          float dEdgeR = abs(length((pR - vec2(0.0, uPupilOffsetY * rEye)) * vec2(1.0, 1.05)) - rEye * uPupilScale);
          float dEdge  = min(dEdgeL, dEdgeR);
          float outRing = (1.0 - smoothstep(0.0, max(uOutlineWidth, 0.001), dEdge)) * eyeMask;
          col   = mix(col, outCol, outRing * uOutlineAlpha);

          // Brow shadow — darken inside the eye where the brow sits.
          col   = mix(col, vec3(0.02, 0.02, 0.03), browMask * eyeMask);

          // Wet sheen — when crying, a faint shimmer on the lower rim.
          if (uTear > 0.001) {
            float rimL = smoothstep(0.0, 0.4, -pL.y / rEye) * eL.x * uTear;
            float rimR = smoothstep(0.0, 0.4, -pR.y / rEye) * eR.x * uTear;
            col = mix(col, hiCol, max(rimL, rimR) * 0.25);
          }

          // Heart overlay (love) — sits on top of the dark eye,
          // muted enough that it still feels painted on the cloth.
          col   = mix(col, heartCol, heartM);
          alpha = max(alpha, heartM * 0.96);

          // Tiny detached hearts drifting around the ghost (love)
          col   = mix(col, heartCol, extraHearts);
          alpha = max(alpha, extraHearts * 0.9);

          // Swirl overlay (dizzy) — uses the hue-cycling swirl colour
          col   = mix(col, swirlCol, swirlM);
          alpha = max(alpha, swirlM * 0.96);

          // Tear streak
          col   = mix(col, tearCol, tearMask * 0.85);
          alpha = max(alpha, tearMask * 0.85);

          // Exclaim — outline first, then fill on top
          col   = mix(col, exclOutCol, exclaimOutline);
          alpha = max(alpha, exclaimOutline * 0.95);
          col   = mix(col, exclCol, exclaimMask);
          alpha = max(alpha, exclaimMask * 0.95);

          // Sweat — outline first, then drop on top
          col   = mix(col, sweatOutCol, sweatOutline);
          alpha = max(alpha, sweatOutline * 0.9);
          col   = mix(col, sweatCol, sweatMask);
          alpha = max(alpha, sweatMask * 0.95);

          // Stress parens (scared)
          col   = mix(col, stressCol, stressMask);
          alpha = max(alpha, stressMask * 0.9);

          // ZZZ (sleepy)
          col   = mix(col, vec3(0.10, 0.12, 0.18), zzzMask);
          alpha = max(alpha, zzzMask * 0.92);

          // Cloth desaturation — pull most pixels toward the ghost's
          // muted blue-grey midtone so the face reads as painted on,
          // NOT the highlights though — they need to stay bright/pure.
          float protect = max(hiMask, 0.0);
          col = mix(col, clothMid, 0.10 * (1.0 - protect));
          col *= mix(0.92, 1.0, protect);

          gl_FragColor = vec4(col, alpha * uOpacity * uEyeVisible);
        }
      `,
    });

    const eyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
    eyeMesh.renderOrder = 3;
    // Position the eye band over the head area of the ghost. Source
    // PNG analysis: eyes sit ~20% down from the top of the ghost
    // shape, where the ghost body plane is 4.0 tall and centred on y=0.
    // y=+1.20 lands exactly on the printed face row. Z is nudged
    // forward so eyes always render in front of the body.
    eyeMesh.position.set(0, 1.00, 0.02);

    const ghost = new THREE.Group();
    ghost.add(bodyMesh);
    ghost.add(eyeMesh);
    // Subtle Y-axis turn so the ghost reads as looking sideways/three-
    // quarter, never straight front-on. Combined with the printed eyes
    // on the source PNG, this gives a "looking to the side" feel.
    ghost.rotation.y = -0.18;

    // Floor shadow — same as before.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext('2d');
    const sgrad = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    sgrad.addColorStop(0,   'rgba(0,0,0,0.55)');
    sgrad.addColorStop(0.6, 'rgba(0,0,0,0.18)');
    sgrad.addColorStop(1,   'rgba(0,0,0,0)');
    sctx.fillStyle = sgrad;
    sctx.fillRect(0, 0, 128, 128);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0 });
    const shadowGeo = new THREE.PlaneGeometry(2.4, 0.5);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.set(0, -2.05, -0.5);
    scene.add(shadow);

    scene.add(ghost);

    // Kick off texture load. Once it arrives the shader flips uHasTex
    // and the ghost fades in via the entry tween.
    tryLoad(GHOST_IMG_URL, () => {
      bodyUniforms.uHasTex.value = 1;
    });

    // ── Entry animation ─────────────────────────────────────
    // Ghost materialises once on first load: rises from below into its
    // default home position (just above the briefing ticker, in the
    // "far away" lower region of the stage). Scales from 0.45→HOME_SCALE
    // with gentle overshoot, fades 0→1. Total 1.8s.
    const ENTRY_MS   = 1800;
    // Evaluated here — before startTime — so startTime can reference it.
    const _skipEntry = _ghostSession.hasPlayed && _ghostSession.posX !== null;
    // When restoring a previous session, backdate startTime so that
    // elapsed >= ENTRY_MS on the very first tick — the entry tween
    // is skipped entirely and the ghost is already at its restored position.
    const startTime  = _skipEntry ? (performance.now() - ENTRY_MS - 1) : performance.now();

    // ── Default home: TOP-LEFT of the chat panel area ─────────
    // The ghost is the first thing the user sees when they land on
    // the empty dashboard, so we anchor it in the upper-left corner
    // of the chat-panel area — it acts as a friendly mascot greeting
    // them without colonising the centre of the screen, which is now
    // owned by the widget grid.
    //
    // World-coord math (orthographic camera, pixels-per-unit ≈ 72.7):
    // Ghost home: dynamically repositioned to the centre of .bcw-ghost-reserve
    // by MsgList's ResizeObserver via window.__ghostCtl.setHome(). The values
    // here are the initial mount defaults (overwritten within one frame).
    // x=-6.20, y=+5.09 ≈ docked reserve cell centre at 1920×1080.
    // When mode is 'centered' (fresh login / empty board), seed to screen centre
    // so the entry animation rises into the right place, not the top-left corner.
    // Determine the initial board mode synchronously from localStorage so
    // GHOST_HOME_DEFAULT is correct on first mount — reading window.__bcwMode
    // is unreliable because WidgetDashboardOverlay (which sets it) mounts
    // after EmptyChatAvatar in the React tree, so the value is always null
    // by the time this useEffect runs.
    const _initMode = (() => {
      try {
        // v8 blob: { layout: [...], zOrder: {...} }
        const raw = localStorage.getItem('bc.dashboard.widgets.v8');
        if (raw) {
          const blob = JSON.parse(raw);
          if (blob && Array.isArray(blob.layout)) return blob.layout.length === 0 ? 'centered' : 'docked';
          if (Array.isArray(blob)) return blob.length === 0 ? 'centered' : 'docked';
        }
        // v7 legacy: raw array
        const rawV7 = localStorage.getItem('bc.dashboard.widgets.v7');
        if (rawV7) {
          const arr = JSON.parse(rawV7);
          if (Array.isArray(arr)) return arr.length === 0 ? 'centered' : 'docked';
        }
      } catch (_) {}
      // No LS at all → fresh login → empty board → centered
      return 'centered';
    })();
    let GHOST_HOME_DEFAULT = _initMode === 'centered'
      ? { x: 0, y: 1.5 }       // viewport centre, comfortably above mid-screen
      : { x: -6.20, y: 5.09 }; // docked top-left (overwritten by first setHome call)
    // HOME_SCALE = the "far / docked" base size of the ghost. New default
    // 0.46 matches the dashboard dock the ghost now lives in.
    // GHOST_MAX_SCALE = how big the ghost gets when it walks fully close.
    // Both persist in localStorage so layout updates (which used to hard-
    // reset HOME_SCALE every time the dock rect changed) don't blow them
    // away. The dock recalculator only updates X / Y from now on.
    //
    // v1 stored a single `home` value; v2 splits it into homeDocked + homeCenter
    // so the ghost can feel closer when the dashboard is empty (no widgets) and
    // recede to its top-left dock when widgets are visible. Old v1 layouts are
    // honored by mapping legacy `home` → `homeDocked` and seeding `homeCenter`
    // at homeDocked + 0.16.
    const SCALE_CAL_LS_KEY = 'ghostScaleCal_v1';
    const _scaleCal = (() => {
      try {
        const raw = localStorage.getItem(SCALE_CAL_LS_KEY);
        if (raw) {
          const o = JSON.parse(raw);
          if (o && typeof o === 'object') {
            const docked = o.homeDocked != null ? +o.homeDocked
                         : (o.home != null ? +o.home : 0.46);
            const center = o.homeCenter != null ? +o.homeCenter : (docked + 0.16);
            return {
              homeDocked: docked,
              homeCenter: center,
              max:        o.max != null ? +o.max : 0.59,
            };
          }
        }
      } catch (_) {}
      return { homeDocked: 0.46, homeCenter: 0.62, max: 0.59 };
    })();
    // HOME_SCALE is the *active* scale — flips between homeDocked and
    // homeCenter based on the widget-board mode. The dock pusher in MsgList
    // selects the correct one when calling setHome(); the ghost effect just
    // reads HOME_SCALE / GHOST_MAX_SCALE from local closure each frame.
    let HOME_SCALE = _scaleCal.homeDocked;
    let GHOST_MAX_SCALE = Math.max(HOME_SCALE + 0.05, _scaleCal.max);
    // Tracks which docking mode the ghost currently considers active.
    // Updated by __ghostCtl.setActiveMode(...). The dock pusher in MsgList
    // sets this in response to bcw:mode-change events from the widget board.
    let _activeGhostMode = 'docked';
    // Mode-aware getters used by the dock pusher.
    const getHomeForMode = (m) => (m === 'centered' ? _scaleCal.homeCenter : _scaleCal.homeDocked);
    const saveScaleCal = () => {
      try {
        localStorage.setItem(SCALE_CAL_LS_KEY, JSON.stringify({
          homeDocked: _scaleCal.homeDocked,
          homeCenter: _scaleCal.homeCenter,
          max: GHOST_MAX_SCALE,
          // Keep legacy field for any reader that still expects it.
          home: _scaleCal.homeDocked,
        }));
      } catch (_) {}
    };

    // ── Entry / restore ─────────────────────────────────────────
    // On first-ever mount: play the full rise-in entry animation.
    // On remount (user returned from a chat): restore the ghost's last
    // known position instantly — no animation — so it never replays.
    // (_skipEntry is declared above near ENTRY_MS so startTime can use it.)
    if (_skipEntry) {
      // Teleport to last known position — no rise-in animation.
      ghost.position.x = _ghostSession.posX;
      ghost.position.y = _ghostSession.posY;
      ghost.position.z = 0;
      ghost.rotation.z = 0;
      ghost.scale.setScalar(_ghostSession.scale != null ? _ghostSession.scale : HOME_SCALE);
      bodyUniforms.uOpacity.value = _ghostSession.opacity;
      shadowMat.opacity = 0.30;
      // Signal that ghostHome should be restored from _ghostSession.homeX/Y
      // (deferred until ghostHome variable is declared below).
      _ghostSession._restoreHome = true;
    } else {
      ghost.scale.setScalar(HOME_SCALE * 0.60);  // entry starts smaller
      ghost.position.x    = GHOST_HOME_DEFAULT.x;
      ghost.position.y    = GHOST_HOME_DEFAULT.y - 1.4;  // rise from below into home
      ghost.position.z    = 0;
      ghost.rotation.z    = 0;
      bodyUniforms.uOpacity.value = 0;
      shadowMat.opacity   = 0;
    }

    // Shared easing helpers (used both in entry and action tick)
    const easeOutCubic  = t => 1 - Math.pow(1 - Math.max(0,Math.min(1,t)), 3);
    const easeOutBack   = t => { t=Math.max(0,Math.min(1,t)); const c1=1.70158,c3=c1+1; return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2); };

    // ── Emotion presets ─────────────────────────────────────
    // Every preset is a target snapshot of the eye uniforms. When an
    // emotion is set, the per-frame tick eases the live uniform values
    // toward these targets with critically-damped springs — so any
    // change is a smooth morph, never a swap.
    const PRESETS = {
      // Baseline — gentle, settled. The "chill ghost" personality.
      // Every other emotion is a small flex away from these values.
      chill: {
        lidUpper: 0.05, lidLower: 0.05, archTop: 0.05, archBot: 0.0,
        pupilScale: 1.0, irisShine: 1.0, brow: 0.0, tear: 0.0,
        blush: 0.5, blushHue: 0.0, shake: 0.0,
        heart: 0.0, swirl: 0.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: 0.0, blushOffsetY: 0.0, blushOffsetX: 0.0, blushPulse: 0.0,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Soft happy — eyes squint up into a gentle crescent, blush warmer,
      // blush sits higher (closer to the eye) and pulses a touch redder.
      happy: {
        lidUpper: 0.35, lidLower: 0.18, archTop: 0.30, archBot: 0.55,
        pupilScale: 0.95, irisShine: 1.1, brow: 0.0, tear: 0.0,
        blush: 0.95, blushHue: 0.05, shake: 0.0,
        heart: 0.0, swirl: 0.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: 0.0, blushOffsetY: 1.0, blushOffsetX: 0.0, blushPulse: 0.6,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Laughing — deeper crescent, faint joy-tear, light shake.
      // Vertical eye bounce is driven from the JS look offset.
      laughing: {
        lidUpper: 0.55, lidLower: 0.20, archTop: 0.40, archBot: 0.70,
        pupilScale: 0.90, irisShine: 1.0, brow: 0.0, tear: 0.0,
        blush: 1.0, blushHue: 0.05, shake: 0.20,
        heart: 0.0, swirl: 0.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: 0.0, blushOffsetY: 0.6, blushOffsetX: 0.0, blushPulse: 0.3,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Sad — top lids drop a little, lid corners sag, dimmer shine.
      // Pupils are nudged down so they peek below the heavy lid.
      sad: {
        lidUpper: 0.25, lidLower: 0.0, archTop: -0.30, archBot: -0.10,
        pupilScale: 1.0, irisShine: 0.65, brow: -0.45, tear: 0.0,
        blush: 0.35, blushHue: 0.05, shake: 0.0,
        heart: 0.0, swirl: 0.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: -0.18, blushOffsetY: 0.0, blushOffsetX: 0.0, blushPulse: 0.0,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Crying — sad + active tear streaks (gated independently per eye
      // by JS so they alternate), slight tremor.
      crying: {
        lidUpper: 0.40, lidLower: 0.10, archTop: -0.40, archBot: -0.05,
        pupilScale: 1.05, irisShine: 0.75, brow: -0.55, tear: 1.0,
        blush: 0.55, blushHue: 0.15, shake: 0.15,
        heart: 0.0, swirl: 0.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: -0.18, blushOffsetY: 0.0, blushOffsetX: 0.0, blushPulse: 0.0,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Angry — lids narrow, inner-corner shadow (V brow), warmer blush.
      // Pupils nudged down so they're not clipped by narrowed lids.
      angry: {
        lidUpper: 0.30, lidLower: 0.18, archTop: 0.0, archBot: 0.0,
        pupilScale: 0.85, irisShine: 0.7, brow: 0.6, tear: 0.0,
        blush: 0.7, blushHue: 0.85, shake: 0.15,
        heart: 0.0, swirl: 0.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: -0.12, blushOffsetY: 0.0, blushOffsetX: 0.0, blushPulse: 0.0,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Surprised — wider open, slightly larger eye, burgundy outlined !.
      surprised: {
        lidUpper: 0.0, lidLower: 0.0, archTop: -0.05, archBot: -0.10,
        pupilScale: 1.10, irisShine: 1.2, brow: 0.0, tear: 0.0,
        blush: 0.5, blushHue: 0.0, shake: 0.0,
        heart: 0.0, swirl: 0.0, sweat: 0.0, exclaim: 1.0,
        pupilOffsetY: 0.0, blushOffsetY: 0.0, blushOffsetX: 0.0, blushPulse: 0.0,
        exclaimStyle: 1.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Suspicious — lids close in from both sides, slight V brow.
      // Used as the proximity-driven idle drift (cursor close to ghost).
      suspicious: {
        lidUpper: 0.40, lidLower: 0.30, archTop: 0.0, archBot: 0.0,
        pupilScale: 0.90, irisShine: 0.85, brow: 0.30, tear: 0.0,
        blush: 0.40, blushHue: 0.05, shake: 0.0,
        heart: 0.0, swirl: 0.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: 0.0, blushOffsetY: 0.0, blushOffsetX: 0.0, blushPulse: 0.0,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Sleepy — heavy upper lid, dim shine. JS drives drift in/out
      // of full sleep with ZZZ overlay.
      sleepy: {
        lidUpper: 0.60, lidLower: 0.10, archTop: -0.15, archBot: -0.05,
        pupilScale: 1.0, irisShine: 0.65, brow: -0.10, tear: 0.0,
        blush: 0.40, blushHue: 0.0, shake: 0.0,
        heart: 0.0, swirl: 0.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: 0.0, blushOffsetY: 0.0, blushOffsetX: 0.0, blushPulse: 0.0,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Love — smooth heart overlay clips outside the eye, full pink
      // blush, eyes a hair wider so the heart reads.
      love: {
        lidUpper: 0.10, lidLower: 0.05, archTop: 0.10, archBot: 0.0,
        pupilScale: 1.05, irisShine: 1.3, brow: 0.0, tear: 0.0,
        blush: 1.0, blushHue: 0.0, shake: 0.0,
        heart: 1.0, swirl: 0.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: 0.0, blushOffsetY: 0.3, blushOffsetX: 0.0, blushPulse: 0.4,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 1.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Dizzy — bright spiral overlay replaces the solid eye, light tremor.
      // JS drives a robotic blink cadence under hypnosis.
      dizzy: {
        lidUpper: 0.05, lidLower: 0.05, archTop: 0.0, archBot: 0.0,
        pupilScale: 1.0, irisShine: 0.6, brow: 0.0, tear: 0.0,
        blush: 0.6, blushHue: 0.05, shake: 0.10,
        heart: 0.0, swirl: 1.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: 0.0, blushOffsetY: 0.0, blushOffsetX: 0.0, blushPulse: 0.0,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 1.0, zzzAmt: 0.0,
      },
      // Scared — eyes shrink, heavy tremor + streaming sweat with outline,
      // stress parens framing the eyes (Southpark style).
      scared: {
        lidUpper: 0.0, lidLower: 0.0, archTop: 0.10, archBot: -0.10,
        pupilScale: 0.65, irisShine: 1.0, brow: -0.20, tear: 0.0,
        blush: 0.25, blushHue: 0.0, shake: 0.55,
        heart: 0.0, swirl: 0.0, sweat: 0.95, exclaim: 0.0,
        pupilOffsetY: 0.0, blushOffsetY: 0.0, blushOffsetX: 0.0, blushPulse: 0.0,
        exclaimStyle: 0.0, sweatStream: 1.0, stressMarks: 1.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Embarrassed — red blush, slight squint, tiny sweat drop (no run).
      embarrassed: {
        lidUpper: 0.20, lidLower: 0.25, archTop: -0.10, archBot: 0.10,
        pupilScale: 0.95, irisShine: 0.95, brow: -0.15, tear: 0.0,
        blush: 1.0, blushHue: 0.5, shake: 0.0,
        heart: 0.0, swirl: 0.0, sweat: 0.4, exclaim: 0.0,
        pupilOffsetY: 0.0, blushOffsetY: 0.7, blushOffsetX: 1.0, blushPulse: 0.0,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
      // Determined — steady focused squint, V brow.
      determined: {
        lidUpper: 0.25, lidLower: 0.15, archTop: 0.0, archBot: 0.0,
        pupilScale: 0.85, irisShine: 1.0, brow: 0.45, tear: 0.0,
        blush: 0.4, blushHue: 0.05, shake: 0.0,
        heart: 0.0, swirl: 0.0, sweat: 0.0, exclaim: 0.0,
        pupilOffsetY: 0.0, blushOffsetY: 0.0, blushOffsetX: 0.0, blushPulse: 0.0,
        exclaimStyle: 0.0, sweatStream: 0.0, stressMarks: 0.0,
        heartPixel: 0.0, heartClipOut: 0.0, swirlBoost: 0.0, zzzAmt: 0.0,
      },
    };

    // ── Emotion engine state ────────────────────────────────
    // `cur` and `tgt` mirror each preset key. Each frame we ease cur
    // toward tgt with a critically-damped spring; the eye uniforms read
    // from cur. Every uniform is a continuous float so the morph between
    // any two emotions is fully smooth.
    const EMO_KEYS = Object.keys(PRESETS.chill);
    const emo = {
      cur: { ...PRESETS.chill },
      tgt: { ...PRESETS.chill },
      // Emotion-driven blink dynamics: laughing/scared blink rapidly,
      // sleepy holds half-shut, others use chill cadence.
      blinkRateMul: 1.0,
      // Override pupil look behaviour by emotion (e.g. dizzy=swirl, no
      // saccade). null = follow current saccade scheduler.
      lookOverride: null,
    };
    // emoSubState — emotion-specific sub-state mirror that exists from
    // the start (eyeState is declared a bit later). setEmotion writes
    // resets here; the per-frame tick later mirrors them onto eyeState.
    const emoSubReset = { pending: false };
    const setEmotion = (name, opts) => {
      // Composer-friendly aliases — the ghost composer asks for symbolic
      // emotions ('listening', 'thinking') that we fold onto the closest
      // existing preset rather than introducing new uniform targets.
      // Any unknown name falls back to 'chill' inside PRESETS lookup below.
      const ALIASES = {
        listening: 'chill',
        thinking:  'determined',
        speaking:  'happy',
      };
      if (ALIASES[name]) name = ALIASES[name];
      const p = PRESETS[name] || PRESETS.chill;
      EMO_KEYS.forEach(k => { emo.tgt[k] = p[k]; });
      emo.blinkRateMul = (
        name === 'laughing' ? 2.4 :
        name === 'scared'   ? 2.8 :
        name === 'sleepy'   ? 0.45 :
        name === 'sad'      ? 0.5 :
        name === 'angry'    ? 1.6 :
        name === 'crying'   ? 1.8 : 1.0
      );
      emo.currentName = name;
      // Optional: per-emotion gaze override
      if (name === 'dizzy' || name === 'sleepy') emo.lookOverride = 'still';
      else emo.lookOverride = null;
      // Mark sub-state machines for reset; the per-frame tick consumes
      // this flag once eyeState exists.
      emoSubReset.pending = true;
    };
    setEmotion('chill');
    Object.assign(emo.cur, emo.tgt); // start at chill, no fade-in

    // ── Saccade / blink schedulers ──────────────────────────
    const eyeState = {
      lookX: 0, lookY: 0,
      tgtX:  0, tgtY:  0,
      nextSaccadeAt: 0.6 + Math.random() * 0.8,
      nextBlinkAt:   2.5 + Math.random() * 3.5,
      blinksLeft:    0,
      blinkStart:   -1,
      blinkDur:      0.32,
      // Emotion-specific micro-state (gated by current emotion):
      //   • crySub: 'crying' | 'sad-pause' — toggles tear flow on/off
      //   • crySubUntil: time at which crySub flips
      //   • cryLeftUntil / cryRightUntil: per-eye independent tear gates
      //   • sleepStage: 'drowsy' | 'asleep' — sleepy cycles in and out
      //   • sleepStageUntil: time at which the next stage transition fires
      //   • lastPokeAt: timestamp of last cursor activity (wakes him up)
      //   • surpriseSquintUntil: brief eye-half-squint pulses for surprise
      //   • emoLookX / emoLookY: extra per-emotion look offset (added on
      //     top of saccade target — used for laughing bounce, sad sweep,
      //     scared darting, embarrassed scanning, etc.)
      crySub: 'crying',
      crySubUntil: 0,
      cryLeftUntil: 0,
      cryRightUntil: 0,
      cryLeftStart: -1,
      cryRightStart: -1,
      sleepStage: 'drowsy',
      sleepStageUntil: 0,
      lastPokeAt: 0,
      surpriseSquintUntil: 0,
      surpriseSquintAmt: 0,
      emoLookX: 0,
      emoLookY: 0,
      // External gaze override — set by ctl.setLookAtElement(selector).
      // While set, the saccade scheduler retargets tgtX/tgtY at the
      // element's screen rect (re-read each frame so it tracks the live
      // composer position). Cleared by ctl.clearLookAt(). Skipped when
      // emotion lookOverride is 'still' (sleepy/dizzy keep their lock).
      lookAtSel: null,
      lookAtSmoothX: 0,
      lookAtSmoothY: 0,
      // Heart variance for love
      heartScaleVar: 1.0,
      heartScaleNextAt: 0,
      // Suspicious glance — when mouse-tracking, the ghost periodically
      // darts its GAZE away from the cursor (quick "pretending not to
      // look") even though the highlights still follow. Phases:
      //   'watch'      — gaze tracks the cursor (long phase, 1.5..3s)
      //   'glance'     — gaze darts AWAY (opposite quadrant, 0.35..0.7s)
      //   'recover'    — brief pause looking at neutral (0.15..0.35s)
      // Switches off when mouseTrack is disabled or mouse leaves.
      suspPhase: 'watch',
      suspUntil: 0,
      suspGlanceX: 0,
      suspGlanceY: 0,
    };

    // ── Mouse tracking ──────────────────────────────────────
    // Capture cursor in (a) viewport-normalised coords for general gaze
    // (b) ghost-local pixel coords for proximity & ripple click.
    // mouseAbs holds the cursor's last absolute screen position so the
    // per-frame driver can re-derive mouseLocal as the GHOST moves —
    // otherwise mouseLocal would only update on mousemove and the eyes
    // would drift off the cursor as the ghost roams around.
    const mouseAbs   = { x: 0, y: 0, active: false };
    const mouseNorm  = { x: 0, y: 0, active: false };
    const mouseLocal = { x: 0, y: 0, dist: 9999, inside: false, active: false };
    let suspicion = 0;       // 0..1 — eased toward proximity-driven target
    // Recompute mouseLocal from current ghost world pos + last cursor
    // position. Called both on mousemove (so it's responsive when cursor
    // moves) AND every frame in the tick (so it stays correct when the
    // ghost itself moves while the cursor is still).
    const recomputeMouseLocal = () => {
      if (!mouseAbs.active) return;
      const gpx = wToPX(ghost.position.x);
      const gpy = wToPY(ghost.position.y);
      const s__ = ghost.scale.x;
      const halfW = 130 * (VH / BASE_H) * s__;
      const halfH = 160 * (VH / BASE_H) * s__;
      mouseLocal.x = mouseAbs.x - gpx;
      mouseLocal.y = mouseAbs.y - gpy;
      mouseLocal.dist   = Math.hypot(mouseLocal.x / Math.max(halfW, 1), mouseLocal.y / Math.max(halfH, 1));
      mouseLocal.inside = mouseLocal.dist < 1.0;
      mouseLocal.active = true;
    };
    const onMouseMove = (e) => {
      // Stash absolute cursor position for per-frame recompute.
      mouseAbs.x = e.clientX;
      mouseAbs.y = e.clientY;
      mouseAbs.active = true;
      // Viewport-normalised coords (for general gaze direction)
      const dx = (e.clientX - VW * 0.5) / Math.max(VW * 0.5, 1);
      const dy = (e.clientY - VH * 0.5) / Math.max(VH * 0.5, 1);
      mouseNorm.x = Math.max(-1, Math.min(1, dx));
      mouseNorm.y = Math.max(-1, Math.min(1, dy));
      mouseNorm.active = true;
      // Recompute ghost-local immediately so the eyes feel responsive on
      // the very first cursor move (don't wait for next frame).
      recomputeMouseLocal();
      if (mouseLocal.dist < 1.4) {
        eyeState.lastPokeAt = performance.now() / 1000;
      }
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    // ── DOM element awareness ─────────────────────────────────
    const domRegistry = { elements: [], lastScan: 0, contactRightPx: 0 };
    const SCAN_INTERVAL_MS = 800;
    const ELEMENT_SELECTORS = [
      { sel: '[data-msgpane] > *:first-child', label: 'contact list', kind: 'contact_panel' },
      { sel: '[data-ghost-ui="briefing"]',     label: 'briefing',     kind: 'briefing'      },
      { sel: 'input, textarea',                label: 'text field',   kind: 'input'  },
      { sel: '[role=dialog]',                  label: 'dialog',       kind: 'modal'  },
    ];
    const scanDOM = () => {
      const nowMs = performance.now();
      if (nowMs - domRegistry.lastScan < SCAN_INTERVAL_MS) return;
      domRegistry.lastScan = nowMs;
      domRegistry.elements = [];
      domRegistry.contactRightPx = 0;
      for (const { sel, label, kind } of ELEMENT_SELECTORS) {
        try {
          document.querySelectorAll(sel).forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) return;
            if (r.right < 0 || r.bottom < 0 || r.left > VW || r.top > VH) return;
            if (kind === 'contact_panel') {
              domRegistry.contactRightPx = Math.max(domRegistry.contactRightPx, r.right);
              return;
            }
            domRegistry.elements.push({
              label, kind,
              wx: pxToWX(r.left + r.width  * 0.5),
              wy: pxToWY(r.top  + r.height * 0.5),
              // half-size in world units — used to scale repulsion radius
              hwx: (r.width  * 0.5) / GHOST_UNIT_PX(),
              hwy: (r.height * 0.5) / GHOST_UNIT_PX(),
            });
          });
        } catch (_) {}
      }
    };
    const nearestElement = () => {
      let best = null, bestD = Infinity;
      for (const el of domRegistry.elements) {
        const dx = el.wx - ghost.position.x;
        const dy = el.wy - ghost.position.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) { bestD = d; best = { ...el, dist: d }; }
      }
      return best;
    };

    // applyElementAwareness — soft repulsion from contact panel + other elements.
    // Called after computing target actionX/actionY in each movement action.
    const applyElementAwareness = (x, y, bnd) => {
      // 1. Hard wall: right edge of contact panel + margin
      if (domRegistry.contactRightPx > 0) {
        const panelEdgeWX = pxToWX(domRegistry.contactRightPx);
        const wallX = panelEdgeWX + 0.35;
        if (x < wallX) x = wallX + (wallX - x) * 0.6;
      }

      // 2. Per-element soft repulsion
      for (const el of domRegistry.elements) {
        const dx = x - el.wx, dy = y - el.wy;
        const d  = Math.hypot(dx, dy);
        // Radius based on element size + ghost personal space
        const baseR = el.kind === 'briefing'
          ? Math.max(el.hwx||0.5, el.hwy||0.3) + 1.2  // bubble: element half-diag + 1.2WU halo
          : 0.7;
        if (d < baseR && d > 0.001) {
          const t_ = 1 - (d / baseR);
          const f  = t_*t_ * (el.kind === 'briefing' ? 0.60 : 0.28);
          x += (dx / d) * f;
          y += (dy / d) * f;
        }
      }

      return {
        x: Math.max(bnd.minX, Math.min(bnd.maxX, x)),
        y: Math.max(bnd.minY, Math.min(bnd.maxY, y)),
      };
    };

    // ── Ghost hit-div (silhouette pointer-events) ──────────────
    // Full-viewport canvas is pointer-events:none. We create a
    // transparent absolutely-positioned div shaped like the ghost
    // silhouette. It follows the ghost each frame.
    //
    // Critical: the silhouette uses clip-path to define the click target
    // shape, but `touch-action: none` is required so touch drags don't
    // fight the browser's default scroll/pinch handling. Without it,
    // mobile/trackpad drags would be cancelled by the browser as soon
    // as the pointer crossed a few pixels.
    // ── Precise hit-div polygon from PNG alpha ─────────────────
    // We sample the ghost PNG into an off-screen canvas and trace the
    // alpha channel at multiple Y-scan-lines to extract a contour that
    // closely hugs the actual painted shape. Transparent margins (tails,
    // gaps between bumps, outer air) are excluded — only opaque pixels
    // are clickable/draggable. Falls back to a conservative hand-crafted
    // silhouette if the PNG can't be cross-origin sampled.
    const ghostHitDiv = document.createElement('div');
    const HITDIV_BASE_CSS = [
      'position:fixed', 'pointer-events:auto', 'cursor:grab',
      'z-index:7998', 'will-change:transform', 'touch-action:none',
      'user-select:none', '-webkit-user-select:none',
      '-webkit-tap-highlight-color:transparent',
    ].join(';') + ';';
    ghostHitDiv.style.cssText = HITDIV_BASE_CSS;

    // hitCal — fine-tuning offsets for hit-div alignment with the rendered
    // ghost. The geometric formula (PLANE_W × scale × ppu) is correct in
    // theory, but the cloth shader, Y-rotation, and PNG margins can shift
    // the visual centre. These are user-settable via the dev panel and
    // persisted to localStorage; the user nudges them so the cyan dashed
    // box in the editor lines up with the rendered ghost.
    const hitCal = (() => {
      try {
        const raw = localStorage.getItem('ghostHitCal_v1');
        if (raw) {
          const o = JSON.parse(raw);
          if (o && typeof o === 'object') {
            return {
              offsetX: +o.offsetX || 0,
              offsetY: +o.offsetY || 0,
              scaleX:  o.scaleX  != null ? +o.scaleX  : 1,
              scaleY:  o.scaleY  != null ? +o.scaleY  : 1,
            };
          }
        }
      } catch (_) {}
      return { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
    })();

    // Precise ghost silhouette — hand-traced via the in-app polygon
    // editor. Coordinates are in UV space (0..1, top-left origin)
    // matching the plane's UVs and the source PNG.
    const GHOST_POLY_UV = [
      [0.500,0.040],[0.720,0.080],[0.816,0.259],[0.848,0.400],
      [0.880,0.620],[0.850,0.840],[0.620,0.920],[0.380,0.920],
      [0.209,0.853],[0.120,0.620],[0.196,0.426],[0.244,0.239],
      [0.280,0.080],
    ];

    // Apply the polygon. We also try to refine it asynchronously by
    // sampling the actual PNG pixels once it loads (CORS permitting).
    const applyGhostPolygon = (pts) => {
      const poly = pts.map(([u,v]) => `${(u*100).toFixed(1)}% ${(v*100).toFixed(1)}%`).join(',');
      ghostHitDiv.style.clipPath = `polygon(${poly})`;
    };
    // Track whether a user-edited polygon is in force. When true, the
    // async PNG-trace below must NOT overwrite it.
    let userPolyActive = false;
    // Prefer a user-saved polygon (from the dev-panel hitbox editor) if
    // one exists in localStorage. Falls back to the hand-traced default.
    try {
      const saved = localStorage.getItem('ghostHitPolyUV_v3');
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length >= 3
            && arr.every(p => Array.isArray(p) && p.length === 2 && isFinite(p[0]) && isFinite(p[1]))) {
          applyGhostPolygon(arr);
          userPolyActive = true;
        } else {
          applyGhostPolygon(GHOST_POLY_UV);
        }
      } else {
        applyGhostPolygon(GHOST_POLY_UV);
      }
    } catch (_) {
      applyGhostPolygon(GHOST_POLY_UV);
    }

    // Async refinement: draw PNG into a canvas and trace the alpha contour.
    // Only fires if the image is already cached / same-origin.
    // Skip entirely if the user has a saved hand-edited polygon active —
    // we don't want the trace to clobber their work.
    (async () => {
      if (userPolyActive) return;
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((res, rej) => {
          img.onload = res; img.onerror = rej;
          img.src = GHOST_IMG_URL + '?_c=' + Math.floor(Date.now()/60000);
        });
        const SAMPLE_W = 64, SAMPLE_H = 80;
        const c = document.createElement('canvas');
        c.width = SAMPLE_W; c.height = SAMPLE_H;
        const cx2 = c.getContext('2d');
        cx2.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
        const px = cx2.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
        const ALPHA_THRESH = 38; // 0-255
        // Trace left and right edge of opacity at each scan-line (every 2px).
        const left = [], right = [];
        for (let y = 0; y < SAMPLE_H; y += 2) {
          let lo = -1, hi = -1;
          for (let x = 0; x < SAMPLE_W; x++) {
            if (px[(y*SAMPLE_W+x)*4+3] > ALPHA_THRESH) { if (lo<0) lo=x; hi=x; }
          }
          if (lo >= 0) { left.push([lo/SAMPLE_W, y/SAMPLE_H]); right.push([hi/SAMPLE_W, y/SAMPLE_H]); }
        }
        if (left.length < 8) return; // too sparse — keep hand-traced poly
        if (userPolyActive) return;   // user has set their own — never overwrite
        // Build polygon: left edge top→bottom, right edge bottom→top
        const refined = [...left, ...[...right].reverse()];
        applyGhostPolygon(refined);
      } catch (_) { /* keep hand-traced polygon */ }
    })();

    ghostHitDiv.classList.add('ghost-overlay-layer');
    document.body.appendChild(ghostHitDiv);

    // ── Drag state ─────────────────────────────────────────────
    // The drag system uses POINTER CAPTURE so the drag continues even when
    // the cursor leaves the silhouette (which it constantly does — the hit
    // shape is small and rapidly-moving cursors slip outside it). Without
    // capture, fast drags would silently abort and the ghost would feel
    // sticky / unresponsive — exactly the "blocked to a box" symptom.
    // ghostHome is the idle anchor — where the ghost drifts when not active.
    // On restore, use the saved home position if the user moved the ghost;
    // otherwise fall back to GHOST_HOME_DEFAULT (set by layout).
    const _savedHomeX = (_ghostSession._restoreHome && _ghostSession.homeX !== null)
      ? _ghostSession.homeX : GHOST_HOME_DEFAULT.x;
    const _savedHomeY = (_ghostSession._restoreHome && _ghostSession.homeY !== null)
      ? _ghostSession.homeY : GHOST_HOME_DEFAULT.y;
    _ghostSession._restoreHome = false; // consumed
    const ghostHome   = { x: _savedHomeX, y: _savedHomeY };
    const drag        = { enabled: true, active: false,
                          startGX: 0, startGY: 0, startPX: 0, startPY: 0,
                          velX: 0, velY: 0, lastPX: 0, lastPY: 0, lastT: 0,
                          pointerId: -1, savedAction: null };
    const dropSpring  = { active: false, tx: 0, ty: 0 };

    const onPointerDown = (e) => {
      if (!drag.enabled) { return; }
      // Only respond to primary pointer (left mouse / single touch / pen tip)
      if (e.button !== undefined && e.button !== 0) { return; }
      e.preventDefault();
      // Capture this pointer to the hit-div so subsequent move/up events
      // come to us regardless of where the cursor goes (over iframes,
      // outside window, over other DOM with pointer-events).
      drag.pointerId = e.pointerId;
      drag.active = true;
      drag.startGX = ghost.position.x; drag.startGY = ghost.position.y;
      drag.startPX = e.clientX;        drag.startPY = e.clientY;
      drag.lastPX  = e.clientX;        drag.lastPY  = e.clientY;
      drag.lastT   = performance.now();
      drag.velX = 0; drag.velY = 0;
      ghostHitDiv.style.cursor = 'grabbing';
      dropSpring.active = false;
      // Force-show: if a previous exit action left him hidden, picking him
      // up brings him back instantly — feels right.
      bodyAction.hidden = false;
      // Remember any looping action so we can restore it on release. If
      // we wiped it now, the user's "wander" toggle would be lost.
      drag.savedAction = (bodyAction.loop && bodyAction.kind) ? bodyAction.kind : null;
      bodyAction.kind = null;
      bodyAction.loop = false;
      // Tiny "happy" reaction for being grabbed — feels like he likes it.
      eyeState.lastPokeAt = performance.now() / 1000;
    };
    const onPointerMoveDoc = (e) => {
      if (!drag.active) return;
      if (drag.pointerId !== -1 && e.pointerId !== drag.pointerId) return;
      const now_ = performance.now();
      const dt_  = Math.max(0.001, (now_ - drag.lastT) / 1000);
      const newGX = drag.startGX + pxToWX(e.clientX) - pxToWX(drag.startPX);
      const newGY = drag.startGY + pxToWY(e.clientY) - pxToWY(drag.startPY);
      const instVX = (newGX - ghost.position.x) / dt_;
      const instVY = (newGY - ghost.position.y) / dt_;
      drag.velX = drag.velX * 0.55 + instVX * 0.45;
      drag.velY = drag.velY * 0.55 + instVY * 0.45;
      ghost.position.x = newGX;
      ghost.position.y = newGY;
      ghostHome.x = newGX; ghostHome.y = newGY;
      drag.lastPX = e.clientX; drag.lastPY = e.clientY; drag.lastT = now_;
      // Throttled drag-move log (every 30 frames)
      if (!onPointerMoveDoc._logThrottle) onPointerMoveDoc._logThrottle = 0;
      onPointerMoveDoc._logThrottle++;
      if (onPointerMoveDoc._logThrottle % 30 === 0) {
      }
    };
    const onPointerUpDoc = (e) => {
      if (!drag.active) return;
      if (drag.pointerId !== -1 && e && e.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
      drag.active = false;
      try { if (e && e.pointerId !== undefined) ghostHitDiv.releasePointerCapture(e.pointerId); } catch (_) {}
      drag.pointerId = -1;
      ghostHitDiv.style.cursor = 'grab';
      // Stale-velocity guard: if the last move was >120ms ago, the user
      // paused before lifting — don't throw, just settle in place.
      const idleMs = performance.now() - drag.lastT;
      if (idleMs > 120) { drag.velX = 0; drag.velY = 0; }
      const curOrthoH_ = 4.4 * (VH / BASE_H);
      const curOrthoW_ = curOrthoH_ * (VW / VH);
      dropSpring.active = true;
      dropSpring.tx = Math.max(-curOrthoW_ * 0.46, Math.min(curOrthoW_ * 0.46,
        ghost.position.x + drag.velX * 0.04));
      dropSpring.ty = Math.max(-curOrthoH_ * 0.46, Math.min(curOrthoH_ * 0.46,
        ghost.position.y + drag.velY * 0.04));
      ghostHome.x = dropSpring.tx; ghostHome.y = dropSpring.ty;
      // Mark the ghost as user-moved so layout recalculations (setHome calls
      // from the dock ResizeObserver) don't pull it back to the dock.
      // Threshold: >0.5 world units from the dock to avoid marking on tiny taps.
      const _dragDist = Math.hypot(
        dropSpring.tx - GHOST_HOME_DEFAULT.x,
        dropSpring.ty - GHOST_HOME_DEFAULT.y
      );
      if (_dragDist > 0.5) {
        _ghostSession.userMoved = true;
        _ghostSession.homeX = dropSpring.tx;
        _ghostSession.homeY = dropSpring.ty;
        _ghostSession.flushToLS();
      }
      // Resume any looping action that was running when we picked him up.
      // Small delay via requestAnimationFrame so dropSpring gets a frame
      // to apply first — feels less abrupt than instant reload.
      if (drag.savedAction) {
        const saved = drag.savedAction;
        drag.savedAction = null;
        setTimeout(() => {
          // Only resume if user hasn't started a new action in the meantime
          if (!bodyAction.kind) playAction(saved);
        }, 250);
      }
    };
    const onPointerCancelDoc = (e) => {
      // Pointer cancel (e.g. browser intercepts, system gesture) — same
      // as pointerup but no throw velocity.
      if (!drag.active) return;
      drag.velX = 0; drag.velY = 0;
      onPointerUpDoc(e);
    };
    ghostHitDiv.addEventListener('pointerdown', onPointerDown);
    // Listen on the hit-div itself (because of pointer capture) AND on
    // window as a fallback for browsers/cases where capture lapses.
    ghostHitDiv.addEventListener('pointermove', onPointerMoveDoc, { passive: true });
    ghostHitDiv.addEventListener('pointerup',   onPointerUpDoc);
    ghostHitDiv.addEventListener('pointercancel', onPointerCancelDoc);
    window.addEventListener('pointermove', onPointerMoveDoc, { passive: true });
    window.addEventListener('pointerup',   onPointerUpDoc);
    window.addEventListener('pointercancel', onPointerCancelDoc);
    // If the window loses focus mid-drag (alt-tab, OS dialog), end the drag
    // gracefully so we don't end up stuck in an active-drag state.
    const onBlurEndDrag = () => { if (drag.active) onPointerCancelDoc({ pointerId: drag.pointerId }); };
    window.addEventListener('blur', onBlurEndDrag);

    // Gaze state for DOM-element pupil tracking
    const gazeState = { wx: 0, wy: 0, amt: 0, targetAmt: 0 };

    // ── Catch-light eye config ────────────────────────────────
    // User-controlled state for the inner-glint editor. Driven by the
    // dev panel's Eyes tab. When mouseTrack=true, the catch-light
    // follows the cursor; when false, manualX/Y drive directly.
    // Catch-light config — controls the bright glint INSIDE the original
    // dark eye (treated as the user-visible "pupil"). The dark eye disc
    // itself is never modified by these. Persisted to localStorage so
    // settings survive reloads. Note: an older format had a `style`
    // field for an "anime sclera" mode that has been removed; any saved
    // value is silently ignored on load.
    // Eye config — v2 schema (4-layer eye: sclera/pupil/highlights/outline).
    // Migrates v1 forward on first load. v1 had only "the dark eye disc"
    // and a glint pattern preset; v2 has independent layers + a per-glint
    // array (up to 4 highlights, each fully positionable & styled).
    //
    // Default values are the user-tuned "all-pupil" look — pupil fills
    // ~91% of the eye, charcoal sclera with strong gradient, dual oval
    // / slit highlights on the upper-left, full opaque outline. Values
    // come straight from the user's logged config (May 2026).
    const DEFAULT_GLINTS = [
      { x: 0.000,  y:  0.000, size: 0.05, shape: 0, bright: 1.00, on: false },
      { x: 2.008,  y: -0.866, size: 0.48, shape: 0, bright: 0.54, on: true  },
      { x: -0.851, y:  0.629, size: 2.32, shape: 0, bright: 0.54, on: true  },
      { x: 1.118,  y:  1.280, size: 0.30, shape: 0, bright: 1.00, on: false },
    ];
    const DEFAULT_EYE_CFG = {
      // Highlight cluster — global controls.
      sizeMul:    0.90,
      mouseTrack: false,
      manualX:    0.120,
      manualY:   -0.030,
      restX:      0.090,
      restY:     -0.340,
      lidAware:   true,
      // Layered eye colors / brightness.
      pupilFill:    0.910,
      scleraColor:  '#7D7D7D',
      scleraBright: 1.500,
      scleraGrad:   0.490,
      pupilColor:   '#000000',
      pupilBright:  1.500,
      hiColor:      '#C9C9C9',
      hiBright:     1.500,
      outlineColor: '#0A0A10',
      outlineAlpha: 1.000,
      outlineWidth: 0.0290,
      // Per-glint array (up to 4).
      glints: DEFAULT_GLINTS.map(g => ({...g})),
      // Effects toggles.
      gloss: false, sparkle: false, glisten: false, crossShine: false,
      // Active preset id (display only — not used by shader).
      activePreset: 'all-pupil',
    };
    // Hex → vec3 helper for color uniforms.
    const hexToVec3 = (hex) => {
      const s = String(hex || '#FFFFFF').replace(/^#/, '');
      const v = s.length === 3
        ? s.split('').map(c => parseInt(c+c, 16))
        : [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)];
      return [
        Math.max(0, Math.min(1, (v[0]||0) / 255)),
        Math.max(0, Math.min(1, (v[1]||0) / 255)),
        Math.max(0, Math.min(1, (v[2]||0) / 255)),
      ];
    };
    const eyeCfg = (() => {
      // Try v4 first (current schema with the latest tuned all-pupil defaults).
      try {
        const raw4 = localStorage.getItem('ghostEyeCfg_v4');
        if (raw4) {
          const o = JSON.parse(raw4);
          if (o && typeof o === 'object') {
            const merged = {...DEFAULT_EYE_CFG, ...o};
            if (!Array.isArray(merged.glints) || merged.glints.length !== 4) {
              merged.glints = DEFAULT_GLINTS.map(g => ({...g}));
            } else {
              merged.glints = merged.glints.map((g, i) => ({...DEFAULT_GLINTS[i], ...g}));
            }
            return merged;
          }
        }
      } catch (_) {}
      // v3 / v2 → v4: drop old baselines so users pick up the new tuned
      // defaults. User-saved presets are stored separately in
      // ghostEyePresets_v1 and are NOT touched.
      try { localStorage.removeItem('ghostEyeCfg_v3'); } catch (_) {}
      try { localStorage.removeItem('ghostEyeCfg_v2'); } catch (_) {}
      // Fall back to v1 migration if present (legacy single-disc users).
      try {
        const raw1 = localStorage.getItem('ghostEyeCfg_v1');
        if (raw1) {
          const o = JSON.parse(raw1);
          if (o && typeof o === 'object') {
            return {
              ...DEFAULT_EYE_CFG,
              sizeMul:     o.sizeMul    != null ? +o.sizeMul     : DEFAULT_EYE_CFG.sizeMul,
              lidAware:    o.lidAware != null ? !!o.lidAware : true,
              gloss:       !!o.gloss,
              sparkle:     !!o.sparkle,
              glisten:     !!o.glisten,
              crossShine:  !!o.crossShine,
              activePreset: 'all-pupil',
            };
          }
        }
      } catch (_) {}
      // Fresh defaults.
      return JSON.parse(JSON.stringify(DEFAULT_EYE_CFG));
    })();
    const saveEyeCfg = () => {
      try { localStorage.setItem('ghostEyeCfg_v4', JSON.stringify(eyeCfg)); } catch (_) {}
    };
    // Smoothed catch-light position so cursor tracking eases instead of snapping.
    const eyePupil = { x: 0, y: 0 };

    // ── Facing state machine ──────────────────────────────────
    // Ghost organically turns to show its back during movement, holds,
    // then turns front again. The turn animation is a smooth X-squeeze
    // (card-flip metaphor). Eyes fade out BEFORE the UV flip so you
    // never see floating eyes during the transition.
    //
    // Key improvements over previous version:
    //  • Eye fade leads the squeeze by ~30% so eyes are gone well before
    //    the texture flips — eliminates the uncanny floating-eye frame
    //  • Turn speed is slow and organic (0.6 units/s) — feels deliberate
    //  • Back-hold is long: 5–14s. Ghost stays back-facing for a real chunk
    //    of its wander, not just a flash
    //  • heading: each movement action writes its current travel direction
    //    (radians) here. The state machine uses it to trigger turns that
    //    feel motivated — ghost turns when moving away from viewer
    //  • backOffset: a small XY nudge applied while back-facing so the
    //    ghost doesn't snap to the same spot it turned at (it drifts
    //    slightly, continuing its journey)
    const facing = {
      state:    'front',
      amt:      0,
      eyeV:     1,
      holdT:    0,
      holdDur:  0,
      nextTurn: 99999,
      lastSide: 0,
      bkDriftX: 0, bkDriftY: 0,
      bkSeedX:  0, bkSeedY:  0,
      turnOpacity: 1,
      // turnScaleX: drives the horizontal squeeze during turn transitions.
      // 1 = full width (normal), 0 = edge-on (texture swap point), back to 1.
      // Ghost is NEVER invisible — it's always visible, just momentarily thin.
      // Eyes are tied to this value so they vanish exactly when ghost turns edge-on.
      turnScaleX: 1,
      heading:  0,
      velMag:   0,
      planLookAwayAt:  99999,
      planLookFrontAt: 99999,
      testTurnActive: false,
    };

    const scheduleTurn = (_t) => {};

        // ── Click → ripple + happy burst ────────────────────────
    const clickState = { rippleStart: -1, happyUntil: -1 };
    const onClick = (e) => {
      eyeState.lastPokeAt = performance.now() / 1000;
      // Compute UV relative to the ghost body's actual screen position.
      const s_ = ghost.scale.x;
      const sc  = VH / BASE_H * s_;
      const bPxW_ = 260 * sc;
      const bPxH_ = 320 * sc;
      const gpx_ = wToPX(ghost.position.x);
      const gpy_ = wToPY(ghost.position.y);
      const cu = (e.clientX - (gpx_ - bPxW_ * 0.5)) / bPxW_;
      const cv = 1.0 - (e.clientY - (gpy_ - bPxH_ * 0.5)) / bPxH_;
      bodyUniforms.uRippleCenter.value.set(Math.max(0, Math.min(1, cu)), Math.max(0, Math.min(1, cv)));
      bodyUniforms.uRippleT.value = 0;
      clickState.rippleStart = performance.now();
      // Same clock as the tick's `t` (seconds since mount). This used to be
      // performance.now()/1000, which is always far larger than `t`, so a
      // click held the "happy" override for as long as the page had been
      // open before the ghost mounted (hours after a remount).
      clickState.happyUntil = (performance.now() - startTime) / 1000 + 2.6;
      setEmotion('happy');
      // Tell the dashboard composer to surface and focus — clicking the
      // ghost should drop you straight into chat-with-the-ghost mode.
      try { window.dispatchEvent(new CustomEvent('bcw:ghost-click', {detail:{x:e.clientX,y:e.clientY}})); } catch(_){}
    };
    // Click target is the ghostHitDiv (silhouette-shaped), not the renderer canvas.
    // Canvas stays pointer-events:none so it never blocks UI below it.
    // UV for ripple is computed relative to the ghost body's screen position.
    const onHitClick = (e) => {
      // Only fire as click if pointer didn't travel far (not a drag release)
      if (Math.abs(e.clientX - drag.startPX) > 8 || Math.abs(e.clientY - drag.startPY) > 8) return;
      onClick(e);
    };
    ghostHitDiv.addEventListener('click', onHitClick);

    // ── Body actions (intro / exit / movement) ──────────────
    // Each action drives a separate tween that runs alongside the
    // ambient-float baseline. Only one body action runs at a time.
    //
    // Movement actions (float_around / patrol / wander / peek_corner) can
    // be "looping" — when toggled on they cycle indefinitely with random
    // organic re-seeding each cycle (so each loop looks different) until
    // the user toggles them OFF (clicking the same button again) or fires
    // a different action / Reset Home. This is the "don't stop until I
    // unclick the button" behaviour the user wants.
    const bodyAction = {
      kind: null, start: 0, duration: 1.0,
      loop: false, cycle: 0, hidden: false,
      data: {},   // per-action scratch (replaces individual _xxx fields)
    };

    const LOOPING = new Set(['drift','patrol','orbit','peek']);

    // ── Steering velocity model ──────────────────────────────────
    // All movement actions accumulate force into this shared velocity
    // instead of lerping directly to position. This gives natural
    // acceleration, organic deceleration, and arc-through-corners for free.
    const steerVel = { x: 0, y: 0 };
    // Ghost movement bob — persistent phase so oscillation is continuous
    const ghostBob = {
      phase: 0,          // accumulated sine phase
      vertPhase: 0,      // vertical bob phase (slower)
      wobAmt: 0,         // smoothed lateral wobble amplitude
    };

    // Clamp vector magnitude in-place, return magnitude.
    const clampMag = (v, max) => {
      const m = Math.hypot(v.x, v.y);
      if (m > max && m > 0) { v.x = v.x/m*max; v.y = v.y/m*max; }
      return Math.min(m, max);
    };

    // Arrival steering: desired velocity toward target, scaled down
    // inside slowingRadius so the ghost glides to a stop rather than
    // snapping. Returns {x,y} desired velocity (not yet clamped).
    const arrivalSteer = (px, py, tx, ty, maxSpd, slowR) => {
      const dx = tx - px, dy = ty - py;
      const d  = Math.hypot(dx, dy) || 0.0001;
      const spd = d < slowR ? maxSpd * (d / slowR) : maxSpd;
      return { x: dx/d*spd, y: dy/d*spd };
    };

    // Banking state — smoothed heading-change-derived tilt.
    const bankState = { angle: 0, prevHeading: 0, headingInit: false };

    // Catmull-Rom interpolation between p1 and p2 (p0/p3 are tangent guides).
    const catmullRom = (p0, p1, p2, p3, tt) => {
      const t2=tt*tt, t3=t2*tt;
      return {
        x: 0.5*((2*p1.x)+(-p0.x+p2.x)*tt+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        y: 0.5*((2*p1.y)+(-p0.y+p2.y)*tt+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
      };
    };

    // getSafeBounds — computes the screen-aware movement box.
    // The contact list occupies the left side (panelW px). We read it
    // live from the DOM so resizes are automatically respected.
    const getSafeBounds = () => {
      const oH  = 4.4 * (VH / BASE_H);
      const oW  = oH  * (VW / VH);
      // Contact panel right edge — prefer live DOM value, fall back to registry
      let contactWPx = domRegistry.contactRightPx;
      if (!contactWPx) {
        const panelEl = document.querySelector('[data-msgpane]');
        if (panelEl && panelEl.children[0]) {
          contactWPx = panelEl.children[0].getBoundingClientRect().right;
          domRegistry.contactRightPx = contactWPx;
        }
      }
      const contactWW = contactWPx / GHOST_UNIT_PX();
      // Body margin: ghost is ~1.8 WU tall at scale 1. Use half-height
      // plus a comfortable padding so it never clips any screen edge.
      const scl = ghost.scale.x || 0.78;
      const bodyHW = 0.90 * scl;   // half-width in world units
      const bodyHH = 1.10 * scl;   // half-height
      const MARGIN = 0.20;
      const minX = -oW*0.5 + contactWW + bodyHW + MARGIN;
      const maxX =  oW*0.5 - bodyHW - MARGIN;
      const minY = -oH*0.5 + bodyHH + MARGIN;
      const maxY =  oH*0.5 - bodyHH - MARGIN;
      // Safety: ensure min < max even if viewport is tiny
      const safeMinX = Math.min(minX, 0);
      const safeMaxX = Math.max(maxX, 0);
      const safeMinY = Math.min(minY, 0);
      const safeMaxY = Math.max(maxY, 0);
      return {
        minX: safeMinX, maxX: safeMaxX,
        minY: safeMinY, maxY: safeMaxY,
        cx: (safeMinX + safeMaxX) * 0.5,
        cy: (safeMinY + safeMaxY) * 0.5,
      };
    };

    const playAction = (kind, opts = {}) => {
      // Composer feedback aliases — 'nod' and 'shake' aren't bona-fide
      // body actions in this rig; we surface them as a brief emotion
      // pulse so the ghost reacts to command outcomes without needing
      // a new animation pipeline. They don't replace the user's current
      // emotion — we restore the previous one after the pulse.
      if (kind === 'nod' || kind === 'shake') {
        const prev = emo.currentName || 'chill';
        setEmotion(kind === 'nod' ? 'happy' : 'sad');
        setTimeout(() => setEmotion(prev), 700);
        return;
      }
      // Toggle looping actions off if already running
      if (LOOPING.has(kind) && bodyAction.kind === kind && bodyAction.loop) {
        bodyAction.kind = null;
        bodyAction.loop = false;
        bodyAction.data = {};
        dropSpring.active = true;
        dropSpring.tx = GHOST_HOME_DEFAULT.x; dropSpring.ty = GHOST_HOME_DEFAULT.y;
        ghostHome.x   = GHOST_HOME_DEFAULT.x; ghostHome.y   = GHOST_HOME_DEFAULT.y;
        return;
      }
      const DURATIONS = {
        rise_in:1.8, drop_in:1.4, fade_in:1.0, portal_in:1.6,
        fade_out:1.0, rise_out:1.4, shrink_out:1.2, portal_out:1.6,
        drift:9.0, patrol:16.0, orbit:14.0, peek:3.5,
        fly_to_element:1.8,
      };
      bodyAction.kind     = kind;
      bodyAction.start    = performance.now() / 1000;
      bodyAction.duration = DURATIONS[kind] ?? 1.0;
      bodyAction.cycle    = 0;
      bodyAction.loop     = LOOPING.has(kind);
      bodyAction.data     = { opts };
      // Show ghost for any appearing action
      if (['rise_in','drop_in','fade_in','portal_in'].includes(kind) || LOOPING.has(kind)) {
        bodyAction.hidden = false;
      }
      // Reset dissolve shader for portal actions
      bodyUniforms.uDissolveMode.value = (kind === 'portal_in' || kind === 'portal_out') ? 1 : 0;
      bodyUniforms.uDissolve.value = 0;
    };

    // ── Live window resize ───────────────────────────────────
    // renderer.setSize() reallocates the full-window WebGL drawing buffer
    // and clears it, so calling it on every step of an edge drag was a GPU
    // reallocation per frame (and a blank canvas until the next render).
    // For the drag the canvas keeps its size in pixels and is only moved,
    // so its centre stays on the window's centre — the camera is centred,
    // and pixels-per-world-unit don't depend on the window size, so this is
    // exactly where a real resize would draw the ghost. One real resize
    // when the drag ends.
    let liveHold = null;   // { w, h } while held
    const liveEl = renderer.domElement;
    const onLiveResize = (e) => {
      const on = !!(e && e.detail && e.detail.active);
      if (on && !liveHold) {
        liveHold = { w: VW, h: VH };
        liveEl.style.width  = `${VW}px`;
        liveEl.style.height = `${VH}px`;
        liveEl.style.right  = 'auto';
        liveEl.style.bottom = 'auto';
      } else if (!on && liveHold) {
        liveHold = null;
        liveEl.style.transform = '';
        liveEl.style.width  = '100%';
        liveEl.style.height = '100%';
        liveEl.style.right  = '';
        liveEl.style.bottom = '';
        onResize();
      }
    };
    window.addEventListener('bc:live-resize', onLiveResize);
    // Declared below; wrapped so the listener can be added here.
    const onLiveViewport = () => { if (liveHold) onResize(); };
    window.addEventListener('bc:live-viewport', onLiveViewport);

    // Resize: rebuild camera and resize renderer to new viewport.
    const onResize = () => {
      const vp = bcViewport();
      if (liveHold) {
        const dx = Math.round((vp.w - liveHold.w) / 2);
        const dy = Math.round((vp.h - liveHold.h) / 2);
        liveEl.style.transform = (dx || dy) ? `translate3d(${dx}px,${dy}px,0)` : '';
        return;
      }
      // Same size (e.g. the WebView handed back after an oversized drag):
      // setSize would still reallocate and clear the canvas for nothing.
      if (vp.w === VW && vp.h === VH && liveEl.style.width === `${VW}px`) return;
      VW = vp.w; VH = vp.h;
      renderer.setSize(VW, VH);
      const newOrthoH = 4.4 * (VH / BASE_H);
      const newAspect = VW / VH;
      camera.left   = -newOrthoH * newAspect / 2;
      camera.right  =  newOrthoH * newAspect / 2;
      camera.top    =  newOrthoH / 2;
      camera.bottom = -newOrthoH / 2;
      camera.updateProjectionMatrix();
      // Clamp ghost + home to new viewport bounds so a window-shrink
      // doesn't leave the ghost stranded off-screen.
      const maxX = newOrthoH * newAspect / 2 * 0.92;
      const maxY = newOrthoH / 2 * 0.92;
      ghost.position.x = Math.max(-maxX, Math.min(maxX, ghost.position.x));
      ghost.position.y = Math.max(-maxY, Math.min(maxY, ghost.position.y));
      // Clamp ghostHome to the new viewport bounds after resize.
      // The ghost re-anchors to the clamped position naturally over
      // 1-2 float cycles — no complex proportional rescaling needed.
      ghostHome.x = Math.max(-maxX, Math.min(maxX, ghostHome.x));
      ghostHome.y = Math.max(-maxY, Math.min(maxY, ghostHome.y));
      if (dropSpring.active) {
        dropSpring.tx = Math.max(-maxX, Math.min(maxX, dropSpring.tx));
        dropSpring.ty = Math.max(-maxY, Math.min(maxY, dropSpring.ty));
      }
    };
    window.addEventListener('resize', onResize);

    // ── MOOD DIRECTOR — the ghost's own day ────────────────────
    // Almost every emotion, the sleep/zzz machine, the surprise mark and
    // the gaze override above existed but nothing drove them outside the
    // dev panel, so on the dashboard the ghost sat in 'chill' forever.
    // This small director gives him a believable routine without ever
    // taking over from the operator:
    //
    //   • relaxed by default — calm, slow looks around (see the chill
    //     saccade), now and then a contented little smile;
    //   • sometimes gets curious and follows the cursor with his eyes
    //     (and a hint of a lean) for a few seconds, then loses interest;
    //   • occasionally glances at where you click;
    //   • gets heavy-lidded in the evening and properly sleepy at night —
    //     dozes off, zzz, breathes slowly, sinks a little;
    //   • during the day he can nod off at random (more likely when you've
    //     left the screen alone), often catching himself with a little jolt;
    //   • wakes groggily when the cursor comes close, instantly (with a
    //     brief "!") when a new contact messages, and just stirs in his
    //     sleep for ordinary messages;
    //   • a message from someone new while he's awake gets a small,
    //     subtle surprise and a look towards the inbox; a message from a
    //     known contact at most gets a glance (rate-limited).
    //
    // Rules that keep it from being annoying:
    //   • It only ever starts something from plain 'chill'. Any emotion set
    //     by someone else (click, chat, dev panel) wins immediately and the
    //     director stands down (see the ownership check in runMood).
    //   • Nothing happens while he's being dragged, flying an action, is
    //     turned away, or is sitting in his own chat (no dozing there).
    //   • Every beat has a cooldown.
    //
    // All times in here are seconds on the performance clock (now/1000),
    // NOT the tick's `t` (seconds since mount) — except blink timing,
    // which belongs to the eye scheduler and uses `t`.
    //
    // Console helpers (via window.__ghostCtl):
    //   __ghostCtl.autoMood = false         // switch the director off/on (persisted)
    //   __ghostCtl.testMood('sleep')        // 'doze' | 'sleep' | 'nod' | 'surprise' | 'watch' | 'peek' | 'content' | 'wake'
    //   __ghostCtl.setMoodHour(23)          // pretend it's 23:00 (null = real clock)
    //   __ghostCtl.getMood()                // live state readout
    const MOOD_LS_KEY = 'ghostAutoMood_v1';
    const _moodBoot = performance.now() / 1000;
    const mood = {
      enabled: (() => { try { return localStorage.getItem(MOOD_LS_KEY) !== '0'; } catch (_) { return true; } })(),
      owns: null,            // emotion the director set and still holds
      phase: 'awake',        // awake | drowsy | nod | jolt | asleep | waking | startled | content
      phaseStart: 0,
      phaseUntil: 0,
      nextDozeCheck: _moodBoot + 30 + Math.random() * 30,
      wakeGraceUntil: _moodBoot + 45,
      nextContentAt: _moodBoot + 120 + Math.random() * 180,
      watchUntil: 0,
      nextWatchAt: _moodBoot + 8 + Math.random() * 10,
      glance: null,          // { kind:'contacts'|'point', x, y, until }
      lastPointGlanceAt: -99,
      lastPeekAt: -99,
      lastSurpriseAt: -99,
      lastUserAt: _moodBoot,
      lastMouseAt: 0,
      pending: null,         // inbound waiting for the next frame
      stirUntil: 0,
      hourOverride: null,
      tired: 0, tiredTgt: 0, tiredCheckAt: 0, tiredInit: false,
      sink: 0, sinkTgt: 0,   // body droop, 0..~1.2
      hop: 0, hopKick: 0, hopApplied: 0,
      lean: 0, leanTgt: 0,
      side: 1,               // which way he tilts when dozing
      breath: 0,             // 0..1, slow sleep-breathing amount
      lidAdd: 0,             // extra upper-lid weight on top of the emotion
      gaze: null,            // look-space target for this frame, or null
      gazeKind: '',
    };

    // Time-of-day tiredness, 0 (bright-eyed) .. 1 (should be asleep).
    // Piecewise-linear by local hour: groggy early morning, alert day, a
    // small after-lunch dip, winding down through the evening.
    const MOOD_TIRED_CURVE = [
      [0, 1.0], [5, 1.0], [7, 0.30], [8.5, 0.05], [13, 0.05], [14, 0.22],
      [15.5, 0.06], [20, 0.08], [22, 0.60], [23, 1.0], [24, 1.0],
    ];
    const moodTiredAtHour = (h) => {
      h = ((+h % 24) + 24) % 24;
      for (let i = 1; i < MOOD_TIRED_CURVE.length; i++) {
        const [h1, v1] = MOOD_TIRED_CURVE[i];
        if (h <= h1) {
          const [h0, v0] = MOOD_TIRED_CURVE[i - 1];
          return v0 + (v1 - v0) * ((h - h0) / Math.max(0.001, h1 - h0));
        }
      }
      return 1;
    };
    const moodClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const moodSet = (name) => { setEmotion(name); mood.owns = name; };
    // Hand the face back. Only resets to chill if the director still owns
    // the current emotion — never stomps something another caller set.
    const moodRelease = () => {
      const mine = !!mood.owns && emo.currentName === mood.owns;
      mood.owns = null;
      if (mine) setEmotion('chill');
    };
    const moodPhase = (p, nowS, dur) => {
      mood.phase = p;
      mood.phaseStart = nowS;
      mood.phaseUntil = nowS + (dur || 0);
    };
    const moodBlink = (n, t) => {
      const es = eyeState;
      if (es.blinkStart >= 0) return;
      es.blinksLeft = n;
      es.blinkStart = t + 0.05;
      es.blinkDur = 0.30;
    };
    const moodWake = (nowS, how) => {
      mood.sinkTgt = 0;
      mood.stirUntil = 0;
      if (how === 'quiet') {
        moodRelease();
        moodPhase('awake', nowS, 0);
      } else {
        // Groggy wake — stays 'sleepy' while the lids slowly lift.
        if (mood.owns !== 'sleepy') moodSet('sleepy');
        moodPhase('waking', nowS, how === 'poke' ? 1.3 : 2.4);
        mood.hopKick = Math.max(mood.hopKick, how === 'poke' ? 0.35 : 0.15);
      }
      const tired = mood.tired > 0.6;
      mood.wakeGraceUntil = nowS + (tired ? 30 + Math.random() * 40 : 100 + Math.random() * 140);
      mood.nextDozeCheck = Math.max(mood.nextDozeCheck, mood.wakeGraceUntil);
    };
    const moodStartDoze = (nowS) => {
      moodSet('sleepy');
      mood.side = Math.random() < 0.5 ? -1 : 1;
      moodPhase('drowsy', nowS, 5 + Math.random() * (5 + 7 * mood.tired));
    };
    const moodSleepFor = () => (
      mood.tired > 0.6
        ? 45 + Math.random() * 110       // night: a real nap
        : 14 + Math.random() * 30        // day: forty winks
    );

    // Screen point → eye look-space (-1..1, +y = down), measured from the
    // eyes rather than the body centre so near targets read correctly.
    const moodLookAt = (px, py, gain) => {
      const ppu = GHOST_UNIT_PX();
      const gpx = wToPX(ghost.position.x);
      const gpy = wToPY(ghost.position.y) - 1.0 * ghost.scale.y * ppu;
      const half = Math.max(200, VH * 0.5);
      return {
        x: moodClamp(((px - gpx) / half) * gain, -1, 1),
        y: moodClamp(((py - gpy) / half) * gain * 0.9, -0.6, 0.95),
      };
    };
    // Where new conversations land: the top of the contact list.
    const moodContactsPoint = () => {
      try {
        const el = document.querySelector('[data-msgpane] > *:first-child');
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 4 && r.height > 4) {
            return { x: r.left + r.width * 0.5, y: r.top + Math.min(120, r.height * 0.2) };
          }
        }
      } catch (_) {}
      return null;
    };

    // Activity tracking — anything the operator does counts as "around".
    const onMoodActivity = (e) => {
      const nowS = performance.now() / 1000;
      mood.lastUserAt = nowS;
      if (!e) return;
      if (e.type === 'mousemove') { mood.lastMouseAt = nowS; return; }
      if (e.type === 'pointerdown' && e.target !== ghostHitDiv) {
        // Now and then, glance at where the click landed.
        if (nowS - mood.lastPointGlanceAt > 6 && Math.random() < 0.35) {
          mood.lastPointGlanceAt = nowS;
          mood.glance = { kind: 'point', x: e.clientX, y: e.clientY, until: nowS + 1.1 };
        }
      }
    };
    window.addEventListener('mousemove',   onMoodActivity, { passive: true });
    window.addEventListener('pointerdown', onMoodActivity, { passive: true });
    window.addEventListener('keydown',     onMoodActivity, { passive: true });
    window.addEventListener('wheel',       onMoodActivity, { passive: true });

    // Inbound message signal from MSGS_STORE.onIncoming (bot-stores.jsx).
    // Consumed on the next frame; dropped if the tab was asleep so a stale
    // message doesn't cause a surprise minutes later.
    const onMoodInbound = (e) => {
      const d = (e && e.detail) || {};
      const wasNew = !!(mood.pending && mood.pending.isNew);
      mood.pending = { isNew: !!d.isNew || wasNew, at: performance.now() / 1000 };
    };
    window.addEventListener('bc:inbound', onMoodInbound);

    const moodHandleInbound = (p, nowS, busy) => {
      const dozing = mood.phase === 'asleep' || mood.phase === 'drowsy' || mood.phase === 'nod';
      if (p.isNew) {
        if (nowS - mood.lastSurpriseAt < 8) { if (dozing) moodWake(nowS, 'poke'); return; }
        const free = emo.currentName === 'chill' || (!!mood.owns && emo.currentName === mood.owns);
        if (!free || busy) return;
        mood.lastSurpriseAt = nowS;
        mood.sinkTgt = 0;
        mood.stirUntil = 0;
        moodSet('surprised');
        // Subtle: a small, soft "!" rather than the full mark.
        emo.tgt.exclaim = dozing ? 0.6 : 0.4;
        mood.hopKick = Math.max(mood.hopKick, dozing ? 1.0 : 0.55);
        moodPhase('startled', nowS, dozing ? 1.5 : 1.15);
        const cp = moodContactsPoint();
        mood.glance = cp ? { kind: 'contacts', x: cp.x, y: cp.y, until: nowS + 1.8 } : null;
        mood.wakeGraceUntil = nowS + 90 + Math.random() * 90;
        mood.nextDozeCheck = Math.max(mood.nextDozeCheck, mood.wakeGraceUntil);
        return;
      }
      // A known contact. Asleep: stir, don't wake. Drowsy: rouses.
      if (mood.phase === 'asleep') { mood.stirUntil = nowS + 0.9; return; }
      if (mood.phase === 'drowsy') { moodWake(nowS, 'poke'); return; }
      if (emo.currentName !== 'chill' || busy || mood.phase !== 'awake') return;
      if (nowS - mood.lastPeekAt < 25) return;
      mood.lastPeekAt = nowS;
      const cp = moodContactsPoint();
      if (cp) mood.glance = { kind: 'contacts', x: cp.x, y: cp.y, until: nowS + 1.1 };
    };

    const runMood = (nowS, t, dt, entryDone) => {
      mood.gaze = null;
      mood.gazeKind = '';
      mood.leanTgt = 0;

      // Time of day — re-read twice a minute, eased so 20:59→21:00 isn't a step.
      if (nowS >= mood.tiredCheckAt) {
        mood.tiredCheckAt = nowS + 30;
        let h;
        if (mood.hourOverride != null) h = mood.hourOverride;
        else { const d = new Date(); h = d.getHours() + d.getMinutes() / 60; }
        mood.tiredTgt = moodTiredAtHour(h);
        if (!mood.tiredInit) { mood.tired = mood.tiredTgt; mood.tiredInit = true; }
      }
      mood.tired += (mood.tiredTgt - mood.tired) * (1 - Math.exp(-0.2 * dt));

      // Ownership: someone else changed the face → stand down at once.
      if (mood.owns && emo.currentName !== mood.owns) {
        mood.owns = null;
        if (mood.phase !== 'awake') {
          moodPhase('awake', nowS, 0);
          mood.sinkTgt = 0;
          mood.stirUntil = 0;
          mood.wakeGraceUntil = Math.max(mood.wakeGraceUntil, nowS + 60);
        }
      }

      const inGhostChat = !!document.body && document.body.getAttribute('data-bcw-ghost') === '1';
      const busy = !entryDone || drag.active || !!bodyAction.kind || bodyAction.hidden
        || dropSpring.active || facing.state !== 'front' || !!eyeState.lookAtSel;
      const dozing = mood.phase === 'drowsy' || mood.phase === 'nod' || mood.phase === 'asleep';

      if (!mood.enabled) {
        if (mood.owns) moodRelease();
        if (mood.phase !== 'awake') moodPhase('awake', nowS, 0);
        mood.sinkTgt = 0; mood.glance = null; mood.pending = null; mood.watchUntil = 0;
      } else {
        if (dozing && (busy || inGhostChat)) moodWake(nowS, 'quiet');

        if (mood.pending) {
          const p = mood.pending;
          mood.pending = null;
          if (nowS - p.at < 5 && nowS - _moodBoot > 8) moodHandleInbound(p, nowS, busy);
        }

        const cursorClose = mouseLocal.active && mouseLocal.dist < 1.35 && (nowS - mood.lastMouseAt) < 0.6;
        const prog = moodClamp((nowS - mood.phaseStart) / Math.max(0.01, mood.phaseUntil - mood.phaseStart), 0, 1);

        switch (mood.phase) {
          case 'startled':
          case 'content':
            if (nowS >= mood.phaseUntil) {
              const wasStartled = mood.phase === 'startled';
              moodRelease();
              moodPhase('awake', nowS, 0);
              moodBlink(wasStartled ? 2 : 1, t);
            }
            break;

          case 'drowsy':
            mood.sinkTgt = 0.30 + 0.35 * prog;
            if (cursorClose) { moodWake(nowS, 'poke'); break; }
            if (nowS >= mood.phaseUntil) {
              // Either drifts off properly, or nods and catches himself.
              if (Math.random() < 0.30 + 0.55 * mood.tired) {
                moodPhase('asleep', nowS, moodSleepFor());
              } else {
                moodPhase('nod', nowS, 0.9);
              }
            }
            break;

          case 'nod':
            mood.sinkTgt = 1.25;
            if (nowS >= mood.phaseUntil) {
              // …and snaps back awake.
              moodRelease();
              moodPhase('jolt', nowS, 0.9);
              mood.sinkTgt = 0;
              mood.hopKick = Math.max(mood.hopKick, 0.9);
              // After a nod he's likelier to go again soon at night.
              mood.wakeGraceUntil = nowS + (mood.tired > 0.6 ? 15 + Math.random() * 25 : 70 + Math.random() * 90);
              mood.nextDozeCheck = Math.max(mood.nextDozeCheck, mood.wakeGraceUntil);
            }
            break;

          case 'jolt':
            if (nowS >= mood.phaseUntil) { moodPhase('awake', nowS, 0); moodBlink(2, t); }
            break;

          case 'asleep':
            mood.sinkTgt = 1;
            if (cursorClose) { moodWake(nowS, 'poke'); break; }
            if (nowS >= mood.phaseUntil) moodWake(nowS, 'natural');
            break;

          case 'waking':
            mood.sinkTgt = 0.25 * (1 - prog);
            if (nowS >= mood.phaseUntil) {
              moodRelease();
              moodPhase('awake', nowS, 0);
              moodBlink(2, t);
            }
            break;

          default: {
            // ── Awake. Only plain chill is ours to play with. ──
            if (emo.currentName !== 'chill' || busy) break;
            const idle = nowS - mood.lastUserAt;

            // Nodding off.
            if (nowS >= mood.nextDozeCheck) {
              mood.nextDozeCheck = nowS + 20 + Math.random() * 25;
              if (!inGhostChat && nowS >= mood.wakeGraceUntil && suspicion < 0.1) {
                const idleBoost = idle > 120 ? 3.0 : idle > 45 ? 1.6 : idle > 10 ? 1.0 : 0.45;
                const p = (0.012 + mood.tired * 0.30) * idleBoost;
                if (Math.random() < Math.min(0.85, p)) { moodStartDoze(nowS); break; }
              }
            }

            // A contented little smile, rarely, while someone's around.
            if (nowS >= mood.nextContentAt) {
              mood.nextContentAt = nowS + 180 + Math.random() * 240;
              if (mood.tired < 0.5 && idle < 60 && suspicion < 0.1 && Math.random() < 0.4) {
                moodSet('happy');
                moodPhase('content', nowS, 1.6 + Math.random() * 0.8);
                break;
              }
            }

            // Curious about the cursor for a few seconds, then bored of it.
            const mouseFresh = (nowS - mood.lastMouseAt) < 1.2;
            if (mood.watchUntil > nowS) {
              if (nowS - mood.lastMouseAt > 2.5) {
                mood.watchUntil = nowS;                    // cursor parked — lost interest
              } else if (mouseAbs.active) {
                mood.gaze = moodLookAt(mouseAbs.x, mouseAbs.y, 0.9);
                mood.gazeKind = 'watch';
                const gpx = wToPX(ghost.position.x);
                mood.leanTgt = -moodClamp((mouseAbs.x - gpx) / 700, -1, 1) * 0.028;
              }
            } else if (mouseFresh && nowS >= mood.nextWatchAt) {
              mood.nextWatchAt = nowS + (14 + Math.random() * 30) * (1 + mood.tired);
              if (Math.random() < 0.65) mood.watchUntil = nowS + (3 + Math.random() * 5) * (1 - 0.4 * mood.tired);
            }
          }
        }

        // Glances (click point / inbox) — while awake-chill or startled.
        if (mood.glance) {
          if (nowS >= mood.glance.until) mood.glance = null;
          else if (!busy && (emo.currentName === 'chill' || mood.phase === 'startled')
                   && (mood.phase === 'awake' || mood.phase === 'startled')) {
            mood.gaze = moodLookAt(mood.glance.x, mood.glance.y, 1.0);
            mood.gazeKind = 'glance';
          }
        }
      }

      // ── Ease the body layer ──
      const sinkRate = mood.phase === 'nod' ? 5 : (mood.phase === 'jolt' || mood.phase === 'startled') ? 6 : 0.7;
      mood.sink += (mood.sinkTgt - mood.sink) * (1 - Math.exp(-sinkRate * dt));
      // Hop = quick rise, soft fall.
      mood.hopKick *= Math.exp(-4.0 * dt);
      mood.hop += (mood.hopKick - mood.hop) * (1 - Math.exp(-14 * dt));
      mood.lean += (mood.leanTgt - mood.lean) * (1 - Math.exp(-2.5 * dt));
      mood.breath = mood.phase === 'asleep'
        ? Math.min(1, mood.breath + dt * 0.5)
        : Math.max(0, mood.breath - dt * 1.5);

      // ── Eyelid weight on top of the emotion ──
      // Evening/night tiredness makes the relaxed face heavy-lidded; the
      // jolt after a nod pops the eyes wide for a moment.
      let lidTgt = 0;
      if (mood.enabled && emo.currentName === 'chill') {
        lidTgt = mood.phase === 'jolt' ? -0.06 : 0.24 * mood.tired;
        emo.blinkRateMul = 1.0 - 0.4 * mood.tired;   // slower, lazier blinks when tired
      }
      mood.lidAdd += (lidTgt - mood.lidAdd) * (1 - Math.exp(-(mood.phase === 'jolt' ? 10 : 2.5) * dt));
    };

    // ── Imperative controller surface ──────────────────────
    // Exposed via the React ref so the floating dev popup can drive
    // the ghost. Keeping this here (inside the effect) means it has
    // direct closure access to all uniforms / state without React re-
    // render churn.
    ghostCtlRef.current = {
      // Live position read — used by the dashboard layout debugger to
      // log the ghost's current screen-space coords and detect any
      // widget/ghost collisions. Returns null until the ghost has
      // mounted; safe to call at any time after that.
      getScreenRect(){
        try {
          const ppu = GHOST_UNIT_PX();
          const cx  = wToPX(ghost.position.x);
          const cy  = wToPY(ghost.position.y);
          // approximate sprite size: body plane is ~3.6 wide × 4.0 tall,
          // multiplied by current scale and pixels-per-unit.
          const s   = ghost.scale.x;
          const w   = 3.6 * s * ppu;
          const h   = 4.0 * s * ppu;
          return { cx, cy, w, h, scale: s,
                   left: cx - w/2, right: cx + w/2,
                   top:  cy - h/2, bottom: cy + h/2,
                   wx: ghost.position.x, wy: ghost.position.y };
        } catch(_) { return null; }
      },
      // Whether the user has dragged the ghost away from its dock.
      // Used by the widget board to compute an exclusion zone for new
      // widget placement so they never drop on top of the ghost.
      get isUserMoved() { return _ghostSession.userMoved; },
      // Called by onModeChange when the dashboard switches between centered
      // and docked. A mode switch (0↔1+ widgets) always moves the ghost —
      // userMoved only applies within a given mode.
      clearUserMoved() {
        _ghostSession.userMoved = false;
        _ghostSession.homeX = null;
        _ghostSession.homeY = null;
        _ghostSession.flushToLS();
      },
      setEmotion,
      playAction,
      // ── Mood director controls (see MOOD DIRECTOR above) ──
      get autoMood() { return mood.enabled; },
      set autoMood(v) {
        mood.enabled = !!v;
        try { localStorage.setItem(MOOD_LS_KEY, v ? '1' : '0'); } catch (_) {}
      },
      // Pretend it's a given hour (0..24) to preview day/night behaviour.
      // null / nothing = back to the real clock.
      setMoodHour(h) {
        mood.hourOverride = (h == null || h === '' || isNaN(+h)) ? null : +h;
        mood.tiredCheckAt = 0;
        mood.tiredInit = false;
      },
      getMood() {
        const nowS = performance.now() / 1000;
        return {
          enabled: mood.enabled, phase: mood.phase, owns: mood.owns,
          emotion: emo.currentName, tired: +mood.tired.toFixed(2),
          hourOverride: mood.hourOverride,
          watching: mood.watchUntil > nowS,
          nextDozeCheckIn: Math.max(0, Math.round(mood.nextDozeCheck - nowS)),
          wakeGraceFor: Math.max(0, Math.round(mood.wakeGraceUntil - nowS)),
          idleFor: Math.round(nowS - mood.lastUserAt),
        };
      },
      // Fire a beat on demand: 'doze' | 'sleep' | 'nod' | 'surprise' |
      // 'peek' | 'watch' | 'content' | 'wake'.
      testMood(kind) {
        const nowS = performance.now() / 1000;
        const fromChill = () => { if (emo.currentName !== 'chill') setEmotion('chill'); mood.owns = null; };
        switch (kind) {
          case 'doze':    fromChill(); moodStartDoze(nowS); break;
          case 'sleep':   fromChill(); moodSet('sleepy'); mood.side = Math.random() < 0.5 ? -1 : 1;
                          moodPhase('asleep', nowS, moodSleepFor()); break;
          case 'nod':     fromChill(); moodSet('sleepy'); mood.side = Math.random() < 0.5 ? -1 : 1;
                          moodPhase('nod', nowS, 0.9); break;
          case 'surprise': mood.lastSurpriseAt = -99; moodHandleInbound({ isNew: true }, nowS, false); break;
          case 'peek':    mood.lastPeekAt = -99; moodHandleInbound({ isNew: false }, nowS, false); break;
          case 'watch':   fromChill(); moodPhase('awake', nowS, 0); mood.lastMouseAt = nowS; mood.watchUntil = nowS + 6; break;
          case 'content': fromChill(); moodSet('happy'); moodPhase('content', nowS, 2.0); break;
          case 'wake':    moodWake(nowS, 'poke'); break;
          default: break;
        }
        return mood.phase;
      },
      get dragEnabled()  { return drag.enabled; },
      set dragEnabled(v) {
        drag.enabled = v;
        ghostHitDiv.style.cursor = v ? 'grab' : 'default';
        ghostHitDiv.style.pointerEvents = v ? 'auto' : 'none';
        // If turning drag off mid-drag, end gracefully.
        if (!v && drag.active) onPointerCancelDoc({ pointerId: drag.pointerId });
      },
      flyToElement(selector) {
        try {
          const el = document.querySelector(selector);
          if (!el) return false;
          const r  = el.getBoundingClientRect();
          playAction('fly_to_element', {
            wx: pxToWX(r.left + r.width  * 0.5),
            wy: pxToWY(r.top  + r.height * 0.5),
            startX: ghost.position.x,
            startY: ghost.position.y,
          });
          return true;
        } catch (_) { return false; }
      },
      // ── Gaze override ──────────────────────────────────────
      // Asks the ghost to LOOK AT a DOM element with its eyes (no body
      // movement). The saccade scheduler reads eyeState.lookAtSel each
      // frame, computes the element's screen rect, translates to eye
      // space, and retargets tgtX/tgtY accordingly. Used by the dashboard
      // composer so the ghost watches the input while the user types.
      // Skipped during 'still' emotion locks (sleepy/dizzy) so it doesn't
      // override those rare cases. Pass null/empty to clear.
      setLookAtElement(selector) {
        if (!selector || typeof selector !== 'string') {
          eyeState.lookAtSel = null;
          return false;
        }
        // Initialize smoothing state from the current gaze so the
        // transition into the override is seamless rather than snapping.
        eyeState.lookAtSmoothX = eyeState.lookX;
        eyeState.lookAtSmoothY = eyeState.lookY;
        eyeState.lookAtSel = selector;
        return true;
      },
      clearLookAt() {
        eyeState.lookAtSel = null;
      },
      // Stop any running action (looping or not). Spring the ghost back
      // to centre so the next interaction starts from a known position.
      stop() {
        bodyAction.kind = null;
        bodyAction.loop = false;
        dropSpring.active = true;
        dropSpring.tx = GHOST_HOME_DEFAULT.x;
        dropSpring.ty = GHOST_HOME_DEFAULT.y;
        ghostHome.x = GHOST_HOME_DEFAULT.x;
        ghostHome.y = GHOST_HOME_DEFAULT.y;
      },
      // Live status read-back for UI badges
      get state(){
        return {
          emotion: emo.currentName,
          action:  bodyAction.kind,
          looping: bodyAction.loop,
          hidden:  bodyAction.hidden,
          home: { x: GHOST_HOME_DEFAULT.x, y: GHOST_HOME_DEFAULT.y },
        };
      },
      // Direct-pulse helpers
      pulseRipple(u, v){
        bodyUniforms.uRippleCenter.value.set(u ?? 0.5, v ?? 0.5);
        bodyUniforms.uRippleT.value = 0;
        clickState.rippleStart = performance.now();
      },
      reset(){
        setEmotion('chill');
        bodyAction.kind = null;
        bodyAction.loop = false;
        bodyAction.hidden = false;
        // Clear user-moved so layout updates (setHome) can move the ghost again.
        _ghostSession.userMoved = false;
        _ghostSession.flushToLS();
        // Ask MsgList's dock-pusher to immediately re-read the reserve rect and
        // call setHome() with fresh coordinates. setHome() will then activate
        // dropSpring to the correct dock position (userMoved is now false).
        // We also pre-spring to GHOST_HOME_DEFAULT as a fallback in case the
        // event fires before MsgList has mounted its listener.
        try { window.dispatchEvent(new CustomEvent('ghost:return-to-dock')); } catch(_){}
        _ghostSession.homeX = GHOST_HOME_DEFAULT.x;
        _ghostSession.homeY = GHOST_HOME_DEFAULT.y;
        ghostHome.x = GHOST_HOME_DEFAULT.x;
        ghostHome.y = GHOST_HOME_DEFAULT.y;
        dropSpring.active = true;
        dropSpring.tx = GHOST_HOME_DEFAULT.x;
        dropSpring.ty = GHOST_HOME_DEFAULT.y;
        // Clear any in-flight tween extras
        bodyUniforms.uDissolve.value = 0;
        bodyUniforms.uOpacity.value  = 1;
      },
      // Test the front→back→front flip transition imperatively.
      // Forces turning_back immediately, then auto-returns to front after holdDur.
      testTurn(){
        if (facing.state !== 'front') {
          facing.state = 'front'; facing.turnOpacity = 1; facing.turnScaleX = 1; facing.eyeV = 1;
          facing.testTurnActive = false;
          return;
        }
        facing.state = 'turning_back';
        facing.turnOpacity = 1;
        facing.turnScaleX = 1;
        facing.lastSide = facing.lastSide >= 0 ? -1 : 1;
        facing.bkSeedX = facing.lastSide * (0.10 + Math.random() * 0.08);
        facing.bkSeedY = (Math.random() - 0.5) * 0.10;
        facing.bkDriftX = 0; facing.bkDriftY = 0;
        facing.testTurnActive = true;
        facing.planLookFrontAt = (performance.now() - startTime) / 1000 + 1.8 + Math.random() * 1.0;
        facing.planLookAwayAt = 99999;
      },
      // Live position/scale calibration — dev panel Position tab calls this.
      // If `scale` is omitted (or null), HOME_SCALE is preserved — used by
      // the dock-update path which only knows about position, not depth.
      // When a scale IS passed, it also lands in the per-mode store so the
      // dev panel sliders can edit either docked or centered scale and have
      // the value persist correctly.
      setHome(x, y, scale, opts){
        const prevDefaultX = GHOST_HOME_DEFAULT.x;
        const prevDefaultY = GHOST_HOME_DEFAULT.y;
        GHOST_HOME_DEFAULT.x = x;
        GHOST_HOME_DEFAULT.y = y;
        if (scale != null && !isNaN(+scale)) {
          HOME_SCALE = +scale;
          // opts.noPersist: apply the scale live without writing it into the
          // docked/centered calibration. Used by anchors whose box size has
          // nothing to do with the dashboard's own scale (e.g. the small
          // ghost-chat empty-state slot) — persisting there would corrupt
          // the board's normal docked/centered sizing.
          if (!opts || !opts.noPersist) {
            // Mirror into the active mode bucket so persistence is per-mode.
            if (_activeGhostMode === 'centered') _scaleCal.homeCenter = HOME_SCALE;
            else                                  _scaleCal.homeDocked = HOME_SCALE;
            // Keep MAX above HOME by a comfortable margin.
            if (GHOST_MAX_SCALE < HOME_SCALE + 0.05) GHOST_MAX_SCALE = HOME_SCALE + 0.05;
            saveScaleCal();
          }
        }
        // Only move the ghost if the user hasn't placed it somewhere deliberately.
        // _ghostSession.userMoved is set on pointer-up after a drag and cleared
        // only by reset() or a deliberate "return to dock" action.
        if (!_ghostSession.userMoved) {
          ghostHome.x = x;
          ghostHome.y = y;
          _ghostSession.homeX = x;
          _ghostSession.homeY = y;
          // Spring to new dock position only when ghost is still "owned" by layout.
          if (bodyAction.data) bodyAction.data.planned = false;
          if (bodyAction.loop) { bodyAction.kind = null; bodyAction.loop = false; }
          dropSpring.active = true;
          dropSpring.tx = x;
          dropSpring.ty = y;
        }
        // Even when user-moved, keep GHOST_HOME_DEFAULT current so
        // reset() and stop() can spring back to the dock correctly.
      },
      // Switch between 'centered' and 'docked'. Updates HOME_SCALE to the
      // stored value for that mode. Position is updated by the next
      // setHome() call from the dock pusher (it observes the reserve rect).
      setActiveMode(mode){
        const m = (mode === 'centered') ? 'centered' : 'docked';
        _activeGhostMode = m;
        const next = (m === 'centered') ? _scaleCal.homeCenter : _scaleCal.homeDocked;
        if (!isNaN(+next)) {
          HOME_SCALE = +next;
          if (GHOST_MAX_SCALE < HOME_SCALE + 0.05) GHOST_MAX_SCALE = HOME_SCALE + 0.05;
        }
      },
      // Direct per-mode scale setter (dev panel calls this for the
      // 'Centered scale' slider so it can edit the inactive mode too).
      setHomeScaleForMode(mode, scale){
        if (isNaN(+scale)) return;
        const m = (mode === 'centered') ? 'centered' : 'docked';
        if (m === 'centered') _scaleCal.homeCenter = +scale;
        else                  _scaleCal.homeDocked = +scale;
        // If we're editing the active mode, apply it live.
        if (_activeGhostMode === m) {
          HOME_SCALE = +scale;
          if (GHOST_MAX_SCALE < HOME_SCALE + 0.05) GHOST_MAX_SCALE = HOME_SCALE + 0.05;
        }
        saveScaleCal();
      },
      // Set max approach scale — dev panel 'Max Closeness' slider calls this.
      setMaxScale(v){
        GHOST_MAX_SCALE = Math.max(HOME_SCALE + 0.05, Math.min(2.0, +v));
        saveScaleCal();
      },
      // Read current scale calibration (dev panel uses this on first sync).
      getScaleCal(){
        return {
          home: HOME_SCALE,
          max: GHOST_MAX_SCALE,
          homeDocked: _scaleCal.homeDocked,
          homeCenter: _scaleCal.homeCenter,
          mode: _activeGhostMode,
        };
      },
      // ── Hitbox editor support ────────────────────────────────
      // Set the click-area polygon at runtime. `pts` is an array of
      // [u,v] pairs in 0..1 space (top-left origin). Marks the user
      // polygon as active so the async PNG-trace won't clobber it.
      setHitPolygon(pts){
        if (!Array.isArray(pts) || pts.length < 3) return;
        try {
          applyGhostPolygon(pts);
          userPolyActive = true;
        } catch (_) {}
      },
      // Read the live screen-space rect of the hit-div, used by the
      // editor to size its overlay to match the on-screen ghost.
      getHitRect(){
        try {
          const r = ghostHitDiv.getBoundingClientRect();
          if (!r || (r.width === 0 && r.height === 0)) return null;
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        } catch (_) { return null; }
      },
      // Freeze the ghost in place so the user can edit the silhouette
      // without the target moving. We:
      //   • centre to home position
      //   • cancel any running action / drag
      //   • pause the rAF tick (running flag) — that stops cloth physics
      //     too, so the silhouette is rock-steady while editing.
      freezeForEditor(on){
        if (on) {
          if (drag.active) {
            try { onPointerCancelDoc({ pointerId: drag.pointerId }); } catch (_) {}
          }
          bodyAction.kind = null;
          bodyAction.loop = false;
          bodyAction.hidden = false;
          ghost.position.x = GHOST_HOME_DEFAULT.x;
          ghost.position.y = GHOST_HOME_DEFAULT.y;
          ghostHome.x = GHOST_HOME_DEFAULT.x;
          ghostHome.y = GHOST_HOME_DEFAULT.y;
          dropSpring.active = false;
          // Force one final position update so the hit-div is at home,
          // THEN pause. We invoke a partial of the rect-update logic.
          // Sizing math matches the per-frame tick — uses actual plane
          // dimensions × world→pixel ratio, plus hitCal calibration.
          try {
            const scl_ = HOME_SCALE;
            const ppu  = GHOST_UNIT_PX();
            const baseW = PLANE_W * scl_ * ppu;
            const baseH = PLANE_H * scl_ * ppu;
            const bPxW = baseW * hitCal.scaleX;
            const bPxH = baseH * hitCal.scaleY;
            const gpx_ = wToPX(ghost.position.x);
            const gpy_ = wToPY(ghost.position.y);
            ghostHitDiv.style.left   = `${gpx_ - bPxW * 0.5 + hitCal.offsetX * bPxW}px`;
            ghostHitDiv.style.top    = `${gpy_ - bPxH * 0.5 + hitCal.offsetY * bPxH}px`;
            ghostHitDiv.style.width  = `${bPxW}px`;
            ghostHitDiv.style.height = `${bPxH}px`;
            ghostHitDiv.style.display = 'block';
          } catch (_) {}
          running = false;
        } else {
          running = true;
          lastT = performance.now();
          wakeTick();
        }
      },
      // hit-div alignment calibration — for tuning when geometric sizing
      // doesn't perfectly match the rendered ghost. offsetX/Y are
      // fractions of the hit-div size; scaleX/Y are multipliers on the
      // plane-derived size. Persisted to localStorage.
      getHitCal(){
        return { offsetX: hitCal.offsetX, offsetY: hitCal.offsetY,
                 scaleX:  hitCal.scaleX,  scaleY:  hitCal.scaleY };
      },
      setHitCal(o){
        if (!o || typeof o !== 'object') return;
        if (o.offsetX != null && isFinite(+o.offsetX)) hitCal.offsetX = +o.offsetX;
        if (o.offsetY != null && isFinite(+o.offsetY)) hitCal.offsetY = +o.offsetY;
        if (o.scaleX  != null && isFinite(+o.scaleX))  hitCal.scaleX  = Math.max(0.2, Math.min(3, +o.scaleX));
        if (o.scaleY  != null && isFinite(+o.scaleY))  hitCal.scaleY  = Math.max(0.2, Math.min(3, +o.scaleY));
        try { localStorage.setItem('ghostHitCal_v1', JSON.stringify(hitCal)); } catch (_) {}
      },
      // ── Eye config (4-layer eye + per-glint array) ──────────
      getEyeCfg(){
        return JSON.parse(JSON.stringify(eyeCfg));
      },
      setEyeCfg(o){
        if (!o || typeof o !== 'object') return;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, +v));
        // Highlight cluster.
        if (o.sizeMul    != null) eyeCfg.sizeMul    = clamp(o.sizeMul, 0.2, 3.5);
        if (o.mouseTrack != null) eyeCfg.mouseTrack = !!o.mouseTrack;
        if (o.manualX    != null) eyeCfg.manualX    = clamp(o.manualX, -1, 1);
        if (o.manualY    != null) eyeCfg.manualY    = clamp(o.manualY, -1, 1);
        if (o.restX      != null) eyeCfg.restX      = clamp(o.restX, -1, 1);
        if (o.restY      != null) eyeCfg.restY      = clamp(o.restY, -1, 1);
        if (o.lidAware   != null) eyeCfg.lidAware   = !!o.lidAware;
        // Layer colors / brightness.
        if (o.pupilFill    != null) eyeCfg.pupilFill    = clamp(o.pupilFill, 0, 1);
        if (o.scleraColor  != null) eyeCfg.scleraColor  = String(o.scleraColor);
        if (o.scleraBright != null) eyeCfg.scleraBright = clamp(o.scleraBright, 0, 1.5);
        if (o.scleraGrad   != null) eyeCfg.scleraGrad   = clamp(o.scleraGrad, 0, 1);
        if (o.pupilColor   != null) eyeCfg.pupilColor   = String(o.pupilColor);
        if (o.pupilBright  != null) eyeCfg.pupilBright  = clamp(o.pupilBright, 0, 1.5);
        if (o.hiColor      != null) eyeCfg.hiColor      = String(o.hiColor);
        if (o.hiBright     != null) eyeCfg.hiBright     = clamp(o.hiBright, 0, 1.5);
        if (o.outlineColor != null) eyeCfg.outlineColor = String(o.outlineColor);
        if (o.outlineAlpha != null) eyeCfg.outlineAlpha = clamp(o.outlineAlpha, 0, 1);
        if (o.outlineWidth != null) eyeCfg.outlineWidth = clamp(o.outlineWidth, 0, 0.05);
        // Per-glint array.
        if (Array.isArray(o.glints)) {
          for (let i = 0; i < 4; i++) {
            if (o.glints[i]) {
              const g = o.glints[i];
              const cur = eyeCfg.glints[i] || {};
              eyeCfg.glints[i] = {
                x:      g.x      != null ? clamp(g.x, -3, 3)        : (cur.x      != null ? cur.x      : 0),
                y:      g.y      != null ? clamp(g.y, -3, 3)        : (cur.y      != null ? cur.y      : 0),
                size:   g.size   != null ? clamp(g.size, 0.05, 2.5) : (cur.size   != null ? cur.size   : 1),
                shape:  g.shape  != null ? Math.max(0, Math.min(6, Math.floor(+g.shape))) : (cur.shape != null ? cur.shape : 0),
                bright: g.bright != null ? clamp(g.bright, 0, 1.5)  : (cur.bright != null ? cur.bright : 1),
                on:     g.on     != null ? !!g.on                   : !!cur.on,
              };
            }
          }
        }
        // Effects.
        if (o.gloss      != null) eyeCfg.gloss      = !!o.gloss;
        if (o.sparkle    != null) eyeCfg.sparkle    = !!o.sparkle;
        if (o.glisten    != null) eyeCfg.glisten    = !!o.glisten;
        if (o.crossShine != null) eyeCfg.crossShine = !!o.crossShine;
        // Active preset id (for UI bookkeeping only).
        if (o.activePreset != null) eyeCfg.activePreset = String(o.activePreset);
        saveEyeCfg();
      },
      // Live catch-light readback for UI logging (post-smoothing position).
      getPupilLive(){
        return { x: eyePupil.x, y: eyePupil.y };
      },
    };
    // Publish globally so the widget dashboard layout debugger can read
    // the ghost's live screen rect and avoid widget/ghost collisions.
    // Cleared in the cleanup function below alongside ghostCtlRef.
    if (typeof window !== 'undefined') {
      window.__ghostCtl = ghostCtlRef.current;
      // Signal MsgList's ResizeObserver to update ghost home now that the
      // controller is available (it may have run before the ghost mounted).
      window.dispatchEvent(new CustomEvent('ghost:ready'));
    }
    let rafId = 0;
    let lastT = startTime;
    let running = true;
    let loopDisposed = false;
    // Restart the frame loop after a pause. The loop stops requesting frames
    // while paused (hidden tab, board hidden behind a chat) instead of
    // spinning an empty callback every frame; anything that sets
    // running = true calls this so it resumes on the very next frame.
    const wakeTick = () => {
      if (loopDisposed || !running || rafId) return;
      lastT = performance.now();
      rafId = requestAnimationFrame(tick);
    };
    // Pause tick when the tab is hidden OR when a chat is open (body[data-bcw-hidden=1]).
    // This prevents the ghost from drifting/springing while invisible,
    // so it's always exactly where it was when the user returns.
    // The ghost's own chat is the one case where the board is hidden but
    // the ghost must keep ticking: the spring is what carries him to the
    // landing slot in the empty state. Frozen, setHome() only moves an
    // invisible target and he never actually goes anywhere — which is
    // exactly the "he doesn't show up in the chat" symptom.
    const isBcwHidden = () =>
      !!document.body
      && document.body.getAttribute('data-bcw-hidden') === '1'
      && document.body.getAttribute('data-bcw-ghost') !== '1';
    // The tick is what keeps the invisible, click-catching hit area in step
    // with the ghost. While paused it used to stay exactly where it was —
    // display:block, pointer-events:auto, z-index 7998 — sitting on top of
    // the open chat, so clicks on messages grabbed a ghost nobody could see
    // and opened ghost chat. Take it out of play whenever the tick stops;
    // the first frame after resuming puts it back.
    const syncHitDivToRunning = () => {
      if (!running) ghostHitDiv.style.display = 'none';
    };
    const onVisChange = () => {
      running = !document.hidden && !isBcwHidden();
      if (running) { lastT = performance.now(); wakeTick(); }
      syncHitDivToRunning();
    };
    // MutationObserver watches data-bcw-hidden on body
    const bcwHiddenObs = (typeof MutationObserver !== 'undefined')
      ? new MutationObserver(() => {
          const shouldRun = !document.hidden && !isBcwHidden();
          if (shouldRun !== running) {
            running = shouldRun;
            if (running) { lastT = performance.now(); wakeTick(); }
          }
          syncHitDivToRunning();
        })
      : null;
    if (bcwHiddenObs) {
      bcwHiddenObs.observe(document.body, { attributes: true, attributeFilter: ['data-bcw-hidden', 'data-bcw-ghost'] });
    }
    document.addEventListener('visibilitychange', onVisChange);

    let _tickCount = 0;
    // Frame budget. A 120/144 Hz screen asked for 120-144 full-window WebGL
    // draws a second, which is wasted on a figure that drifts slowly; cap at
    // ~60 fps, and at ~30 fps in light rendering. Physics use real elapsed
    // time (dt), so skipped frames change nothing but the cost.
    const tick = (now) => {
      if (!running || loopDisposed) { rafId = 0; return; }
      rafId = requestAnimationFrame(tick);
      const _minGap = (document.documentElement.getAttribute('data-perf') === 'lite') ? 31 : 15;
      if (lastT && now - lastT < _minGap) return;
      _tickCount++;
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;
      const t = (now - startTime) / 1000;
      const elapsed = now - startTime;

      bodyUniforms.uTime.value = t;
      eyeUniforms.uTime.value  = t;

      // Mood director — picks this frame's autonomous beat (MOOD DIRECTOR).
      runMood(now / 1000, t, dt, elapsed >= ENTRY_MS);

      // ── Mouse-proximity suspicion ──────────────────────────
      // Suspicion target ramps up smoothly the closer the cursor gets.
      // dist=0 → 1 (very close), dist≥1.2 → 0 (far). Runs every frame
      // even when no mousemove event fires this frame.
      const proximity = !mouseLocal.active
        ? 0
        : Math.max(0, 1 - mouseLocal.dist / 1.2);
      // Override target if action / preset wants something else.
      let suspicionTgt = (clickState.happyUntil > t) ? 0 : proximity;
      // Don't trigger suspicion during exit transitions
      if (bodyAction.kind === 'portal_out' || bodyAction.kind === 'fade_out' ||
          bodyAction.kind === 'rise_out'   || bodyAction.kind === 'shrink_out') {
        suspicionTgt = 0;
      }
      const suspK = 1 - Math.exp(-3.5 * dt);
      suspicion += (suspicionTgt - suspicion) * suspK;

      // Auto-emotion gate: when the user hasn't manually overridden via
      // the controller's recent click/setEmotion, blend in the
      // suspicion preset proportionally.
      const happyHold = clickState.happyUntil > t;
      if (!happyHold && suspicion > 0.15 && emo.currentName === 'chill') {
        // Drift toward suspicious as proximity grows
        EMO_KEYS.forEach(k => {
          emo.tgt[k] = PRESETS.chill[k] * (1 - suspicion) + PRESETS.suspicious[k] * suspicion;
        });
      } else if (!happyHold && emo.currentName === 'chill' && suspicion <= 0.15) {
        // Relax back to chill targets
        EMO_KEYS.forEach(k => { emo.tgt[k] = PRESETS.chill[k]; });
      } else if (happyHold && t > clickState.happyUntil - 0.05) {
        // Happy burst is ending; fall back to chill
        clickState.happyUntil = -1;
        setEmotion('chill');
      }

      // ── Ease emotion uniforms toward targets ────────────────
      // Uniform-specific spring rates so e.g. mouth-curve feels lively
      // while pupil-scale feels soft.
      const RATE = {
        lidUpper: 9, lidLower: 9, archTop: 8, archBot: 8,
        pupilScale: 7, irisShine: 6, brow: 7, tear: 5,
        blush: 4, blushHue: 4, shake: 12, heart: 6,
        swirl: 5, sweat: 4, exclaim: 10,
        pupilOffsetY: 6, blushOffsetY: 5, blushOffsetX: 5, blushPulse: 4,
        exclaimStyle: 12, sweatStream: 5, stressMarks: 7,
        heartPixel: 6, heartClipOut: 6, swirlBoost: 5, zzzAmt: 4,
      };
      EMO_KEYS.forEach(k => {
        const r = RATE[k] || 6;
        const kk = 1 - Math.exp(-r * dt);
        emo.cur[k] += (emo.tgt[k] - emo.cur[k]) * kk;
      });

      // Push to uniforms
      eyeUniforms.uLidUpper.value   = Math.max(0, Math.min(1, emo.cur.lidUpper + mood.lidAdd));
      eyeUniforms.uLidLower.value   = emo.cur.lidLower;
      eyeUniforms.uArchTop.value    = emo.cur.archTop;
      eyeUniforms.uArchBot.value    = emo.cur.archBot;
      eyeUniforms.uPupilScale.value = emo.cur.pupilScale;
      eyeUniforms.uIrisShine.value  = emo.cur.irisShine;
      eyeUniforms.uBrow.value       = emo.cur.brow;
      eyeUniforms.uTear.value       = emo.cur.tear;
      eyeUniforms.uBlush.value      = emo.cur.blush;
      eyeUniforms.uBlushHue.value   = emo.cur.blushHue;
      eyeUniforms.uShake.value      = emo.cur.shake;
      eyeUniforms.uHeart.value      = emo.cur.heart;
      eyeUniforms.uSwirl.value      = emo.cur.swirl;
      eyeUniforms.uSweat.value      = emo.cur.sweat;
      eyeUniforms.uExclaim.value    = emo.cur.exclaim;
      eyeUniforms.uPupilOffsetY.value = emo.cur.pupilOffsetY;
      eyeUniforms.uBlushOffsetY.value = emo.cur.blushOffsetY;
      eyeUniforms.uBlushOffsetX.value = emo.cur.blushOffsetX;
      eyeUniforms.uBlushPulse.value   = emo.cur.blushPulse;
      eyeUniforms.uExclaimStyle.value = emo.cur.exclaimStyle;
      eyeUniforms.uSweatStream.value  = emo.cur.sweatStream;
      eyeUniforms.uStressMarks.value  = emo.cur.stressMarks;
      eyeUniforms.uHeartPixel.value   = emo.cur.heartPixel;
      eyeUniforms.uHeartClipOut.value = emo.cur.heartClipOut;
      eyeUniforms.uSwirlBoost.value   = emo.cur.swirlBoost;
      eyeUniforms.uZzzAmt.value       = emo.cur.zzzAmt;

      // ── Saccade + gaze ──────────────────────────────────────
      // Per-emotion gaze flavour layered on top of the chill saccade:
      //   • laughing  — bouncy vertical motion (eyes hop)
      //   • sad       — slow left/right sweep, biased downward
      //   • angry     — sharp twitchy darts, never centred
      //   • suspicious— deliberate left/right scan
      //   • scared    — panicked rapid darts, looking around for safety
      //   • embarrassed — wandering scan, like checking who saw
      //   • surprised — mostly fixed but occasional half-squint pulses
      //   • sleepy/dizzy — held still (eyes don't roam under hypnosis/sleep)
      const es = eyeState;
      const emoName = emo.currentName || 'chill';

      // Consume any pending sub-state reset queued by setEmotion.
      if (emoSubReset.pending) {
        es.crySubUntil = 0;
        es.crySub = 'crying';
        es.cryLeftUntil = 0;
        es.cryRightUntil = 0;
        es.cryLeftStart = -1;
        es.cryRightStart = -1;
        es.sleepStageUntil = 0;
        es.sleepStage = 'drowsy';
        es.surpriseSquintUntil = 0;
        es.surpriseSquintAmt = 0;
        es.heartScaleNextAt = 0;
        es.heartScaleVar = 1.0;
        emoSubReset.pending = false;
      }

      // Sleepy state machine — drift in/out, fall fully asleep, wake on poke.
      // We override the eye uniforms in this branch so the JS controls
      // the closed-eye and ZZZ overlay independently of the lid easing.
      let sleepBlinkOverride = -1;       // -1 = use normal blink scheduler
      let sleepLidUpper = null;          // override lidUpper if set
      let sleepZzz = null;               // override zzz target if set
      if (emoName === 'sleepy' && mood.owns === 'sleepy' && mood.phase !== 'awake') {
        // Director-driven sleep (MOOD DIRECTOR): the stage comes from the
        // director's phase rather than the free-running cycle below.
        const nowS_ = now / 1000;
        const pr = Math.max(0, Math.min(1,
          (nowS_ - mood.phaseStart) / Math.max(0.01, mood.phaseUntil - mood.phaseStart)));
        if (mood.phase === 'asleep') {
          if (nowS_ < mood.stirUntil) {
            // Stirs at a message: lids flutter half open, zzz dims.
            sleepBlinkOverride = 0.55 + 0.25 * Math.sin(nowS_ * 9.0);
            sleepLidUpper = 0.85;
            sleepZzz = 0.35;
          } else {
            sleepBlinkOverride = 1;
            sleepLidUpper = 1.0;
            sleepZzz = 1.0;
          }
        } else if (mood.phase === 'nod') {
          // Eyes slide shut as the head drops.
          sleepBlinkOverride = Math.min(1, pr * 1.8);
          sleepLidUpper = 0.95;
          sleepZzz = 0.0;
        } else if (mood.phase === 'waking') {
          // Eyes creak open, lids lift slowly.
          sleepBlinkOverride = pr < 0.3 ? 1 - pr / 0.3 : -1;
          sleepLidUpper = 0.85 - 0.45 * pr;
          sleepZzz = 0.0;
        } else {
          // Drowsy — heavier and heavier, fighting it with slow flutters.
          sleepLidUpper = 0.50 + 0.30 * pr + 0.07 * Math.sin(nowS_ * 0.9);
          sleepZzz = 0.0;
        }
      } else if (emoName === 'sleepy') {
        if (es.sleepStageUntil === 0) {
          es.sleepStage = 'drowsy';
          es.sleepStageUntil = t + 4 + Math.random() * 4;
        }
        // Wake on recent poke if asleep too long or just touched.
        // lastPokeAt is stamped with performance.now()/1000, so compare on
        // that clock (comparing with `t` meant a poke never registered).
        const justPoked = (now / 1000 - es.lastPokeAt) < 0.4;
        if (es.sleepStage === 'asleep' && justPoked) {
          es.sleepStage = 'drowsy';
          es.sleepStageUntil = t + 5 + Math.random() * 4;
        }
        if (t >= es.sleepStageUntil) {
          if (es.sleepStage === 'drowsy') {
            es.sleepStage = 'asleep';
            // Sleep up to 10s, but he'll wake earlier if poked.
            es.sleepStageUntil = t + 5 + Math.random() * 5;
          } else {
            es.sleepStage = 'drowsy';
            es.sleepStageUntil = t + 4 + Math.random() * 5;
          }
        }
        if (es.sleepStage === 'asleep') {
          sleepBlinkOverride = 1;        // fully closed
          sleepLidUpper = 1.0;
          sleepZzz = 1.0;
        } else {
          // Drowsy — slow nodding lid amplitude, no zzz
          const nod = 0.5 + 0.5 * Math.sin(t * 0.9);
          sleepLidUpper = 0.55 + nod * 0.30;   // 0.55..0.85 sleepy-heavy
          sleepZzz = 0.0;
        }
      } else {
        // Reset zzz immediately when leaving sleepy
        sleepZzz = 0.0;
      }
      // Apply zzz override (sleepy controls it, otherwise emo target wins)
      if (sleepZzz !== null) {
        emo.tgt.zzzAmt = sleepZzz;
      }
      // Apply sleep lid override
      if (sleepLidUpper !== null) {
        emo.tgt.lidUpper = sleepLidUpper;
      }

      // Crying ↔ sad sub-state machine. While crying, each eye emits
      // discrete drops at staggered intervals; occasionally we pause
      // tears entirely (drift toward sad) for ~1.5–3s, then resume.
      // Each eye has a single in-flight drop with a fixed lifetime; we
      // pass its 0..1 phase to the shader directly — no flickering gate.
      const TEAR_LIFE = 1.6;            // seconds for a drop to fall
      if (emoName === 'crying') {
        if (es.crySubUntil === 0) {
          es.crySub = 'crying';
          es.crySubUntil = t + 4 + Math.random() * 5;
          es.cryLeftUntil = t + 0.10;       // first L drop ~now
          es.cryRightUntil = t + 0.55;      // first R drop staggered
        }
        if (t >= es.crySubUntil) {
          if (es.crySub === 'crying') {
            es.crySub = 'sad-pause';
            es.crySubUntil = t + 1.5 + Math.random() * 1.5;
          } else {
            es.crySub = 'crying';
            es.crySubUntil = t + 3 + Math.random() * 4;
            // Re-arm drops with a small offset so they don't all fire on resume
            es.cryLeftUntil = t + 0.20;
            es.cryRightUntil = t + 0.80;
          }
        }
        if (es.crySub === 'crying') {
          // LEFT eye: if no drop in flight, schedule next drop
          //   cryLeftStart  = time the current drop began (-1 if none)
          //   cryLeftUntil  = time at which next drop should start
          if (es.cryLeftStart === undefined) es.cryLeftStart = -1;
          if (es.cryLeftStart < 0 && t >= es.cryLeftUntil) {
            es.cryLeftStart = t;
          }
          if (es.cryLeftStart >= 0) {
            const ph = (t - es.cryLeftStart) / TEAR_LIFE;
            if (ph >= 1.0) {
              es.cryLeftStart = -1;
              // Schedule the next L drop — random gap so eyes desync
              es.cryLeftUntil = t + 0.6 + Math.random() * 1.8;
              eyeUniforms.uTearAltL.value = -1;
            } else {
              eyeUniforms.uTearAltL.value = ph;
            }
          } else {
            eyeUniforms.uTearAltL.value = -1;
          }

          // RIGHT eye: same pattern, independent timing
          if (es.cryRightStart === undefined) es.cryRightStart = -1;
          if (es.cryRightStart < 0 && t >= es.cryRightUntil) {
            es.cryRightStart = t;
          }
          if (es.cryRightStart >= 0) {
            const ph = (t - es.cryRightStart) / TEAR_LIFE;
            if (ph >= 1.0) {
              es.cryRightStart = -1;
              es.cryRightUntil = t + 0.5 + Math.random() * 2.0;
              eyeUniforms.uTearAltR.value = -1;
            } else {
              eyeUniforms.uTearAltR.value = ph;
            }
          } else {
            eyeUniforms.uTearAltR.value = -1;
          }
          // Hold crying shape uniforms
          emo.tgt.brow   = PRESETS.crying.brow;
          emo.tgt.tear   = 1.0;
          emo.tgt.shake  = PRESETS.crying.shake;
        } else {
          // Sad-pause: stop emitting any drops, let in-flight ones finish out
          // by NOT updating phase (but if any was active, let it finish then go cold).
          // Simple approach: clear in-flight drops so we cleanly switch to sad shape.
          es.cryLeftStart = -1;
          es.cryRightStart = -1;
          eyeUniforms.uTearAltL.value = -1;
          eyeUniforms.uTearAltR.value = -1;
          emo.tgt.brow   = PRESETS.sad.brow;
          emo.tgt.tear   = 0.0;
          emo.tgt.shake  = 0.0;
        }
      } else if (emoName === 'laughing' && emo.cur.tear > 0.05) {
        // Laughing joy-tear — one slow drop per eye, gently looping.
        // Use deterministic time-based phase so it never flickers.
        const phL = ((t * 0.55) % 1.0);
        const phR = (((t * 0.55) + 0.45) % 1.0);
        eyeUniforms.uTearAltL.value = phL;
        eyeUniforms.uTearAltR.value = phR;
        es.crySubUntil = 0;
        es.cryLeftStart = -1;
        es.cryRightStart = -1;
      } else {
        // Not crying/laughing — no drops, clean state
        eyeUniforms.uTearAltL.value = -1;
        eyeUniforms.uTearAltR.value = -1;
        es.crySubUntil = 0;
        es.cryLeftStart = -1;
        es.cryRightStart = -1;
      }

      // Surprise — random brief half-squint pulses
      if (emoName === 'surprised') {
        if (t >= es.surpriseSquintUntil) {
          es.surpriseSquintUntil = t + 0.8 + Math.random() * 1.6;
          es.surpriseSquintAmt = Math.random() < 0.55 ? 0.32 : 0.0;
        }
        // Apply over the surprised preset (which keeps lids fully open)
        const sq = es.surpriseSquintAmt * (0.4 + 0.6 * Math.sin(t * 5.0) * 0.5 + 0.5);
        emo.tgt.lidUpper = PRESETS.surprised.lidUpper + sq;
        emo.tgt.lidLower = PRESETS.surprised.lidLower + sq * 0.6;
      } else {
        es.surpriseSquintAmt = 0;
      }

      // Heart scale variance for love
      if (emoName === 'love') {
        if (t >= es.heartScaleNextAt) {
          // Vary slightly to keep it alive
          es.heartScaleVar = 0.85 + Math.random() * 0.30;
          es.heartScaleNextAt = t + 0.6 + Math.random() * 1.2;
        }
        eyeUniforms.uHeartScale.value +=
          (es.heartScaleVar - eyeUniforms.uHeartScale.value) * (1 - Math.exp(-4 * dt));
      } else {
        eyeUniforms.uHeartScale.value +=
          (1.0 - eyeUniforms.uHeartScale.value) * (1 - Math.exp(-4 * dt));
      }

      // Per-emotion saccade scheduling and emoLook offset
      if (emo.lookOverride === 'still') {
        // Dizzy/sleepy — eyes don't roam
        es.tgtX = 0; es.tgtY = 0;
        es.emoLookX = 0; es.emoLookY = 0;
      } else if (es.lookAtSel) {
        // ── Eye-tracking override ─────────────────────────────
        // Composer (or any caller of ctl.setLookAtElement) is asking
        // the ghost to look at a specific DOM element. Re-read each
        // frame so we follow it as it moves (the composer slides
        // around as the user types and the dashboard mode changes).
        // We translate the element's screen-center into a normalized
        // gaze offset relative to the ghost's own screen position.
        try {
          const el = document.querySelector(es.lookAtSel);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 4 && r.height > 4) {
              // Ghost screen center
              const gpx = wToPX(ghost.position.x);
              const gpy = wToPY(ghost.position.y);
              // Element center
              const ex = r.left + r.width  * 0.5;
              const ey = r.top  + r.height * 0.5;
              // Normalize delta to eye-space (-1..1). Eye-space units
              // are loosely a screen-half so divide by ~half viewport.
              const half = Math.max(200, window.innerHeight * 0.5);
              const nx = (ex - gpx) / half;
              const ny = (ey - gpy) / half;
              // Clamp + apply gentle gain so the eyes look TOWARD the
              // target without rolling fully to the edges. Vertical bias
              // is positive (looking down) since the composer sits below.
              const tx = Math.max(-1.0, Math.min(1.0, nx * 0.85));
              const ty = Math.max(-0.4, Math.min(1.05, ny * 0.95));
              // Smooth so retargets between focus/blur don't snap.
              es.lookAtSmoothX += (tx - es.lookAtSmoothX) * (1 - Math.exp(-8 * dt));
              es.lookAtSmoothY += (ty - es.lookAtSmoothY) * (1 - Math.exp(-8 * dt));
              es.tgtX = es.lookAtSmoothX;
              es.tgtY = es.lookAtSmoothY;
              es.emoLookX = 0; es.emoLookY = 0;
              // Schedule a saccade slightly into the future so when the
              // override clears, the next regular saccade doesn't fire
              // immediately (avoids a snap-back).
              es.nextSaccadeAt = t + 0.6 + Math.random() * 0.5;
            }
          }
        } catch (_) {}
      } else if (eyeCfg.mouseTrack && mouseNorm.active) {
        // ── Suspicious-glance gaze cycle ──────────────────────
        // When mouse-tracking is on, the ghost looks AT the cursor
        // most of the time, then briefly darts AWAY (as if pretending
        // not to be caught looking), then resumes watching. Highlights
        // still follow the cursor independently (via pupTgtX/Y below)
        // so it reads as "his eyes drift but the focus stays on you."
        // Tracking strength scales by suspicion + distance so close-up
        // = locked on, far away = looser.
        const trackS = Math.max(0.55, suspicion);
        const watchTgtX = mouseNorm.x * 0.85 * trackS;
        const watchTgtY = mouseNorm.y * 0.55 * trackS;
        if (t >= es.suspUntil) {
          // Phase advance
          if (es.suspPhase === 'watch') {
            // After watching, glance AWAY — opposite quadrant of where
            // the cursor is, with a small randomisation so it doesn't
            // feel mechanical.
            const awayX = -Math.sign(mouseNorm.x || (Math.random() - 0.5)) * (0.55 + Math.random() * 0.30);
            const awayY = (mouseNorm.y < 0 ? 0.20 : -0.30) + (Math.random() - 0.5) * 0.30;
            es.suspGlanceX = Math.max(-1, Math.min(1, awayX));
            es.suspGlanceY = Math.max(-1, Math.min(1, awayY));
            es.suspPhase = 'glance';
            es.suspUntil = t + 0.35 + Math.random() * 0.35;
          } else if (es.suspPhase === 'glance') {
            // After glance, brief recover (look slightly elsewhere) then back to watch.
            es.suspGlanceX = (Math.random() - 0.5) * 0.20;
            es.suspGlanceY = (Math.random() - 0.5) * 0.15;
            es.suspPhase = 'recover';
            es.suspUntil = t + 0.15 + Math.random() * 0.20;
          } else {
            // Back to watching the cursor for a longer span.
            es.suspPhase = 'watch';
            es.suspUntil = t + 1.5 + Math.random() * 1.5;
          }
        }
        if (es.suspPhase === 'watch') {
          es.tgtX = watchTgtX;
          es.tgtY = watchTgtY;
        } else {
          // 'glance' or 'recover' — gaze pinned to the away point.
          es.tgtX = es.suspGlanceX;
          es.tgtY = es.suspGlanceY;
        }
        es.emoLookX = 0; es.emoLookY = 0;
      } else if (mood.gaze && (emoName === 'chill' || emoName === 'surprised')) {
        // Mood director is looking at something on purpose — the cursor
        // while he's curious, a click point, or the inbox on a message.
        es.tgtX = mood.gaze.x;
        es.tgtY = mood.gaze.y;
        es.emoLookX = 0; es.emoLookY = 0;
        // Don't snap to a random saccade the instant the look ends.
        es.nextSaccadeAt = t + 0.7 + Math.random() * 0.8;
      } else if (suspicion > 0.45 && mouseNorm.active && emoName === 'chill') {
        // Legacy chill cursor-tracking (kept for when mouseTrack=off but
        // suspicion still wants to gently follow).
        es.tgtX = mouseNorm.x * 0.85 * suspicion;
        es.tgtY = mouseNorm.y * 0.55 * suspicion;
        es.emoLookX = 0; es.emoLookY = 0;
      } else if (t >= es.nextSaccadeAt) {
        // Per-emotion saccade flavour
        switch (emoName) {
          case 'laughing': {
            // Bouncy: alternate small up/down saccades
            es.tgtX = (Math.random() - 0.5) * 0.30;
            es.tgtY = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.25);
            es.nextSaccadeAt = t + 0.18 + Math.random() * 0.18;
            break;
          }
          case 'sad': {
            // Slow contemplative L/R sweep, biased down
            es.tgtX = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.30);
            es.tgtY = 0.30 + Math.random() * 0.20;     // looking down
            es.nextSaccadeAt = t + 1.6 + Math.random() * 1.6;
            break;
          }
          case 'crying': {
            // Crying — similar to sad but a touch more agitated
            es.tgtX = (Math.random() - 0.5) * 1.4;
            es.tgtY = 0.20 + Math.random() * 0.30;
            es.nextSaccadeAt = t + 0.9 + Math.random() * 1.1;
            break;
          }
          case 'angry': {
            // Sharp wide darts, alternating sides quickly
            const sign = (Math.random() < 0.5 ? -1 : 1);
            es.tgtX = sign * (0.55 + Math.random() * 0.40);
            es.tgtY = (Math.random() - 0.5) * 0.30;
            es.nextSaccadeAt = t + 0.25 + Math.random() * 0.45;
            break;
          }
          case 'suspicious': {
            // Deliberate L/R scan — alternate sides, pause at the extreme.
            // We pick a target near full-extent on one side, hold for a
            // beat, then drift the OTHER way with a longer hold.
            const sign = (es._suspLastSign === 1 ? -1 : 1);
            es._suspLastSign = sign;
            es.tgtX = sign * (0.85 + Math.random() * 0.10);
            // Slight downward bias when locked on something
            es.tgtY = -0.05 + Math.random() * 0.18;
            // Pause longer at the extreme — that's the "suspicious hold"
            es.nextSaccadeAt = t + 1.4 + Math.random() * 1.2;
            break;
          }
          case 'scared': {
            // Panicked tiny rapid darts
            es.tgtX = (Math.random() - 0.5) * 1.7;
            es.tgtY = (Math.random() - 0.5) * 0.9;
            es.nextSaccadeAt = t + 0.12 + Math.random() * 0.20;
            break;
          }
          case 'embarrassed': {
            // Wandering scan — checking who saw — varies in pace and arc
            const wide = Math.random() < 0.6;
            es.tgtX = (Math.random() * 2 - 1) * (wide ? 0.95 : 0.4);
            es.tgtY = (Math.random() * 2 - 1) * 0.45;
            es.nextSaccadeAt = t + (wide
              ? 0.45 + Math.random() * 0.5
              : 0.20 + Math.random() * 0.25);
            break;
          }
          case 'surprised': {
            // Mostly fixed forward — small idle drifts
            es.tgtX = (Math.random() - 0.5) * 0.30;
            es.tgtY = (Math.random() - 0.5) * 0.20;
            es.nextSaccadeAt = t + 1.2 + Math.random() * 1.2;
            break;
          }
          case 'love': {
            // Soft drifty gaze — looking at the loved thing
            es.tgtX = (Math.random() - 0.5) * 0.45;
            es.tgtY = (Math.random() - 0.5) * 0.30 - 0.05;
            es.nextSaccadeAt = t + 1.0 + Math.random() * 1.4;
            break;
          }
          case 'happy': {
            // Lively — quick small saccades, biased up slightly
            es.tgtX = (Math.random() * 2 - 1) * 0.55;
            es.tgtY = (Math.random() * 2 - 1) * 0.30 - 0.10;
            es.nextSaccadeAt = t + 0.4 + Math.random() * 0.6;
            break;
          }
          default: {
            if (emoName === 'chill') {
              // Chill — relaxed: long easy holds, mostly near the middle,
              // an occasional wider look and a rare quick double-take.
              // Slower still when he's tired.
              const r = Math.random();
              if (r < 0.30) {
                es.tgtX = (Math.random() - 0.5) * 0.24;
                es.tgtY = (Math.random() - 0.5) * 0.20;
              } else if (r < 0.85) {
                es.tgtX = (Math.random() * 2 - 1) * 0.60;
                es.tgtY = (Math.random() * 2 - 1) * 0.35;
              } else {
                es.tgtX = (Math.random() * 2 - 1) * 0.85;
                es.tgtY = (Math.random() * 2 - 1) * 0.50;
              }
              const quick = Math.random() < 0.18;
              es.nextSaccadeAt = t + (quick
                ? 0.5 + Math.random() * 0.5
                : 1.8 + Math.random() * 2.8) * (1 + 0.6 * mood.tired);
              break;
            }
            // Other emotions without their own flavour — original behaviour
            if (Math.random() < 0.18) {
              es.tgtX = (Math.random() - 0.5) * 0.25;
              es.tgtY = (Math.random() - 0.5) * 0.25;
            } else {
              es.tgtX = (Math.random() * 2 - 1) * 0.85;
              es.tgtY = (Math.random() * 2 - 1) * 0.55;
            }
            const longHold = Math.random() < 0.45;
            es.nextSaccadeAt = t + (longHold
              ? 1.5 + Math.random() * 2.0
              : 0.4 + Math.random() * 0.5);
          }
        }
      }

      // Continuous emoLook layer — adds smooth periodic motion for
      // emotions whose flavour is rhythm-based rather than sample-based.
      let emoOffX = 0, emoOffY = 0;
      if (emoName === 'laughing') {
        // Eyes bob up and down with a slight sway, like he's chuckling
        emoOffY = Math.sin(t * 7.5) * 0.55;
        emoOffX = Math.cos(t * 5.8) * 0.10;
      } else if (emoName === 'sad') {
        // Slow horizontal sweep with downward bias; superimposed on the
        // saccade target so it feels like ruminating.
        emoOffX = Math.sin(t * 0.7) * 0.55;
        emoOffY = 0.25 + Math.sin(t * 0.5) * 0.05;
      } else if (emoName === 'angry') {
        // Tight tremor on top of darting saccades
        emoOffX = Math.sin(t * 22.0) * 0.06;
        emoOffY = Math.cos(t * 19.0) * 0.04;
      } else if (emoName === 'suspicious') {
        // Tiny micro-tremor only — the saccade does the actual scanning,
        // so the continuous layer stays near zero (eyes "lock" between sweeps).
        emoOffX = Math.sin(t * 1.8) * 0.04;
        emoOffY = 0;
      } else if (emoName === 'scared') {
        // Jittery look-around
        emoOffX = Math.sin(t * 4.5) * 0.55 + Math.sin(t * 11.7) * 0.20;
        emoOffY = Math.cos(t * 5.1) * 0.30;
      } else if (emoName === 'embarrassed') {
        // Furtive scan — varies pace
        emoOffX = Math.sin(t * 1.6) * 0.50 + Math.sin(t * 0.7) * 0.20;
        emoOffY = Math.sin(t * 1.3) * 0.20;
      }
      es.emoLookX += (emoOffX - es.emoLookX) * (1 - Math.exp(-6 * dt));
      es.emoLookY += (emoOffY - es.emoLookY) * (1 - Math.exp(-6 * dt));

      // Choose ease rate per emotion
      let easeRate = (suspicion > 0.45) ? 5 : 12;
      if (emoName === 'sad' || emoName === 'sleepy' || emoName === 'love') easeRate = 4;
      else if (emoName === 'suspicious') easeRate = 3.5;
      else if (emoName === 'laughing' || emoName === 'angry' || emoName === 'scared') easeRate = 18;
      else if (emoName === 'embarrassed') easeRate = 7;
      // Director looks: an easy follow for cursor-watching, a bit brisker
      // for a glance.
      if (mood.gaze && (emoName === 'chill' || emoName === 'surprised')) {
        easeRate = mood.gazeKind === 'watch' ? 6 : 9;
      }

      const k = 1 - Math.exp(-easeRate * dt);
      es.lookX += (es.tgtX - es.lookX) * k;
      es.lookY += (es.tgtY - es.lookY) * k * 0.85;

      // Final look = saccade target + continuous emoLook layer, clamped.
      const finalLookX = Math.max(-1.2, Math.min(1.2, es.lookX + es.emoLookX));
      const finalLookY = Math.max(-1.0, Math.min(1.0, es.lookY + es.emoLookY));
      eyeUniforms.uLook.value.set(finalLookX, finalLookY);

      // ── Eye driver ────────────────────────────────────────
      // Push the entire 4-layer eye config + per-glint array each frame.
      // All cheap assignments; THREE updates the GPU on next render.
      eyeUniforms.uPupilSizeMul.value  = eyeCfg.sizeMul;
      eyeUniforms.uGlintRestX.value    = eyeCfg.restX;
      eyeUniforms.uGlintRestY.value    = eyeCfg.restY;
      eyeUniforms.uLidAware.value      = eyeCfg.lidAware ? 1 : 0;
      // Layer colors / brightness.
      eyeUniforms.uPupilFill.value     = eyeCfg.pupilFill;
      const _sc = hexToVec3(eyeCfg.scleraColor);
      eyeUniforms.uScleraColor.value.set(_sc[0], _sc[1], _sc[2]);
      eyeUniforms.uScleraBright.value  = eyeCfg.scleraBright;
      eyeUniforms.uScleraGrad.value    = eyeCfg.scleraGrad;
      const _pc = hexToVec3(eyeCfg.pupilColor);
      eyeUniforms.uPupilColor.value.set(_pc[0], _pc[1], _pc[2]);
      eyeUniforms.uPupilBright.value   = eyeCfg.pupilBright;
      const _hc = hexToVec3(eyeCfg.hiColor);
      eyeUniforms.uHiColor.value.set(_hc[0], _hc[1], _hc[2]);
      eyeUniforms.uHiBright.value      = eyeCfg.hiBright;
      const _oc = hexToVec3(eyeCfg.outlineColor);
      eyeUniforms.uOutlineColor.value.set(_oc[0], _oc[1], _oc[2]);
      eyeUniforms.uOutlineAlpha.value  = eyeCfg.outlineAlpha;
      eyeUniforms.uOutlineWidth.value  = eyeCfg.outlineWidth;
      // Per-glint array — 4 slots, each (pos:vec2, cfg:vec4).
      const _gs = eyeCfg.glints || [];
      const setG = (slot, posU, cfgU) => {
        const g = _gs[slot] || {};
        posU.value.set(+g.x || 0, +g.y || 0);
        cfgU.value.set(
          +g.size || 0,
          +g.shape || 0,
          +g.bright || 0,
          g.on ? 1 : 0
        );
      };
      setG(0, eyeUniforms.uG0Pos, eyeUniforms.uG0Cfg);
      setG(1, eyeUniforms.uG1Pos, eyeUniforms.uG1Cfg);
      setG(2, eyeUniforms.uG2Pos, eyeUniforms.uG2Cfg);
      setG(3, eyeUniforms.uG3Pos, eyeUniforms.uG3Cfg);
      // Effects.
      eyeUniforms.uGloss.value         = eyeCfg.gloss      ? 1 : 0;
      eyeUniforms.uSparkle.value       = eyeCfg.sparkle    ? 1 : 0;
      eyeUniforms.uGlisten.value       = eyeCfg.glisten    ? 1 : 0;
      eyeUniforms.uCrossShine.value    = eyeCfg.crossShine ? 1 : 0;

      // Re-derive ghost-local cursor offset every frame using the latest
      // ghost.position. Without this, the eyes lose contact when the
      // ghost moves while the cursor is still — mouseLocal would only
      // refresh on actual mousemove events.
      recomputeMouseLocal();
      // Catch-light target position — either mouse-tracked or manual.
      let pupTgtX, pupTgtY;
      if (eyeCfg.mouseTrack && mouseLocal.active) {
        // mouseLocal.x/y are pixels relative to ghost centre in screen-
        // space. Normalise by a generous radius so the catch-light reaches
        // its extreme well before the cursor leaves the bubble area, but
        // doesn't snap immediately. Then clamp to (-1..1).
        const halfW = 220, halfH = 280;
        pupTgtX = Math.max(-1, Math.min(1, mouseLocal.x / halfW));
        pupTgtY = Math.max(-1, Math.min(1, -mouseLocal.y / halfH));  // invert Y so cursor up = catch-light up
      } else {
        pupTgtX = eyeCfg.manualX;
        pupTgtY = eyeCfg.manualY;
      }
      // Smooth — ~10Hz exponential ease.
      const epK = 1 - Math.exp(-10 * dt);
      eyePupil.x += (pupTgtX - eyePupil.x) * epK;
      eyePupil.y += (pupTgtY - eyePupil.y) * epK;
      eyeUniforms.uPupilPosX.value = eyePupil.x;
      eyeUniforms.uPupilPosY.value = eyePupil.y;

      // ── Blinks ─────────────────────────────────────────────
      // Dizzy gets a robotic, perfectly metronomic blink (under hypnosis).
      // Sleepy 'asleep' stage is held closed; otherwise schedule normally.
      if (emoName === 'dizzy') {
        // Robotic: fixed cadence, sharp on/off (square-ish ramp)
        const period = 1.6;
        const phase = (t % period) / period;
        let rb = 0;
        if (phase < 0.10) rb = phase / 0.10;            // close
        else if (phase < 0.22) rb = 1.0;                // hold closed
        else if (phase < 0.32) rb = 1.0 - (phase - 0.22) / 0.10;  // open
        eyeUniforms.uBlink.value = rb;
        // Reset normal scheduler so it doesn't fire when dizzy ends.
        es.blinksLeft = 0;
        es.blinkStart = -1;
        es.nextBlinkAt = t + 1.5;
      } else if (sleepBlinkOverride >= 0) {
        // Sleep stages hold the lids — fully closed when asleep, partly
        // while nodding off / stirring / waking.
        eyeUniforms.uBlink.value = Math.min(1, sleepBlinkOverride);
        es.blinksLeft = 0;
        es.blinkStart = -1;
        es.nextBlinkAt = t + 0.5;
      } else {
        if (es.blinksLeft <= 0 && es.blinkStart < 0 && t >= es.nextBlinkAt) {
          const r = Math.random();
          es.blinksLeft = r < 0.78 ? 1 : (r < 0.97 ? 2 : 3);
          es.blinkStart = t;
          es.blinkDur   = (0.28 + Math.random() * 0.12) / Math.max(emo.blinkRateMul, 0.4);
        }
        let blink = 0;
        if (es.blinkStart >= 0) {
          const bt = (t - es.blinkStart) / es.blinkDur;
          if (bt >= 1) {
            es.blinksLeft -= 1;
            if (es.blinksLeft > 0) {
              es.blinkStart = t + 0.09 + Math.random() * 0.07;
              es.blinkDur   = (0.22 + Math.random() * 0.10) / Math.max(emo.blinkRateMul, 0.4);
            } else {
              es.blinkStart = -1;
              const baseGap = (Math.random() < 0.20) ? (9 + Math.random() * 5) : (4 + Math.random() * 5);
              es.nextBlinkAt = t + baseGap / Math.max(emo.blinkRateMul, 0.4);
            }
          } else if (bt >= 0) {
            if (bt < 0.4) blink = Math.sin((bt / 0.4) * (Math.PI * 0.5));
            else          blink = Math.sin((1 - (bt - 0.4) / 0.6) * (Math.PI * 0.5));
          }
        }
        eyeUniforms.uBlink.value = blink;
      }

      // ── Body ripple decay ───────────────────────────────────
      if (clickState.rippleStart > 0) {
        const rt = (now - clickState.rippleStart) / 1000;
        if (rt > 1.4) {
          bodyUniforms.uRippleT.value = -1;
          clickState.rippleStart = -1;
        } else {
          bodyUniforms.uRippleT.value = rt;
        }
      }

      // ── Action + entry tween ──────────────────────────────────
      // All position/scale/opacity changes accumulated here, applied once.
      // Z axis is never modified — keeps ghost in ortho camera frustum.
      let actionX = 0, actionY = 0;
      let actionScale = HOME_SCALE, actionRotZ = 0, actionOpacity = 1;
      let isMovement = false;

      const eo3 = x => 1 - Math.pow(1-Math.max(0,Math.min(1,x)),3);
      const ei3 = x => Math.pow(Math.max(0,Math.min(1,x)),3);
      const eio = x => { x=Math.max(0,Math.min(1,x)); return x<0.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2; };
      const eob = x => { x=Math.max(0,Math.min(1,x)); return 1+2.70158*Math.pow(x-1,3)+1.70158*Math.pow(x-1,2); };

      // Entry tween — runs once on first load, parallel to any action
      const entryDone = elapsed >= ENTRY_MS;
      if (!entryDone) {
        const p  = elapsed / ENTRY_MS;
        const p1 = Math.min(1, p * 1.4);
        const p2 = Math.min(1, p * 1.1);
        actionOpacity = eo3(p1) * (texReady ? 1 : 0);
        // Rise from 1.2 units below home into home position.
        actionY       = (GHOST_HOME_DEFAULT.y - 1.4) + 1.4 * eob(p2);
        // Scale from ~60% of HOME_SCALE → HOME_SCALE with overshoot
        actionScale   = HOME_SCALE * (0.60 + eob(p2) * 0.40);
        actionRotZ    = (1 - eo3(p)) * 0.04;
        shadowMat.opacity = eo3(Math.max(0, p*1.6-0.4)) * 0.30;
      } else {
        shadowMat.opacity = 0.30;
        // Mark the intro as played once entry is done so future remounts skip it.
        if (!_ghostSession.hasPlayed) _ghostSession.hasPlayed = true;
      }

      // Body actions — only run after entry tween completes
      if (bodyAction.kind && entryDone) {
        const ap  = Math.max(0, Math.min(1, (t - bodyAction.start) / (bodyAction.duration || 1.0)));
        const bnd = getSafeBounds();

        try { switch (bodyAction.kind) {

          case 'fade_out': {
            actionOpacity = 1 - eo3(ap);
            if (ap >= 1) { bodyAction.hidden = true; bodyAction.kind = null; }
            break;
          }
          case 'rise_out': {
            actionOpacity = 1 - eo3(ap);
            actionY       = eo3(ap) * 1.8;
            actionScale   = 1 - eo3(ap) * 0.12;
            if (ap >= 1) { bodyAction.hidden = true; bodyAction.kind = null; }
            break;
          }
          case 'shrink_out': {
            actionOpacity = 1 - eo3(ap);
            actionScale   = Math.max(0.01, 1 - eo3(ap) * 0.98);
            if (ap >= 1) { bodyAction.hidden = true; bodyAction.kind = null; }
            break;
          }
          case 'portal_out': {
            bodyUniforms.uDissolveMode.value = 1;
            bodyUniforms.uDissolve.value     = eo3(ap);
            actionScale   = Math.max(0.01, 1 - ei3(ap) * 0.95);
            actionRotZ    = ap * Math.PI * 2.0;
            actionOpacity = 1 - eo3(Math.max(0, ap*1.5-0.5));
            if (ap >= 1) { bodyAction.hidden = true; bodyUniforms.uDissolve.value = 0; bodyAction.kind = null; }
            break;
          }

          case 'rise_in': {
            bodyAction.hidden = false;
            actionOpacity = eo3(Math.min(1, ap*1.6));
            actionY       = -1.4 * (1 - eob(ap));
            actionScale   = 0.65 + eob(ap) * 0.35;
            if (ap >= 1) bodyAction.kind = null;
            break;
          }
          case 'drop_in': {
            bodyAction.hidden = false;
            const dnb = x => {
              x=Math.max(0,Math.min(1,x));
              if(x<1/2.75)  return 7.5625*x*x;
              if(x<2/2.75)  {x-=1.5/2.75;  return 7.5625*x*x+0.75;}
              if(x<2.5/2.75){x-=2.25/2.75; return 7.5625*x*x+0.9375;}
              x-=2.625/2.75; return 7.5625*x*x+0.984375;
            };
            actionOpacity = eo3(Math.min(1, ap*2.0));
            actionY       = 2.0*(1-dnb(ap));
            actionScale   = 0.8 + dnb(ap)*0.2;
            if (ap >= 1) bodyAction.kind = null;
            break;
          }
          case 'fade_in': {
            bodyAction.hidden = false;
            actionOpacity = eo3(ap);
            actionScale   = 0.9 + eo3(ap)*0.1;
            if (ap >= 1) bodyAction.kind = null;
            break;
          }
          case 'portal_in': {
            bodyAction.hidden = false;
            bodyUniforms.uDissolveMode.value = 1;
            bodyUniforms.uDissolve.value     = Math.max(0, 1 - eo3(ap));
            actionScale   = 0.02 + eob(ap)*0.98;
            actionRotZ    = (1-eo3(ap)) * -Math.PI*2.0;
            actionOpacity = eo3(Math.min(1, ap*1.8));
            if (ap >= 1) { bodyUniforms.uDissolve.value = 0; bodyAction.kind = null; }
            break;
          }

          case 'drift':
          case 'patrol':
          case 'orbit': {
            // ── UNIFIED PRE-PLANNED PATH SYSTEM ──────────────────
            // Path is generated once per cycle. Each segment has
            // pre-baked timing and optional facing events so the
            // ghost turns away at exactly the right dramatic moment.
            isMovement = true;
            const d = bodyAction.data;

            if (!d.planned || d.planCycle !== bodyAction.cycle) {
              d.planCycle = bodyAction.cycle;
              const _emo = emo.currentName || 'chill';

              const _spdMul = {
                chill:0.50,happy:0.60,laughing:0.70,sad:0.30,crying:0.34,
                angry:0.85,surprised:0.68,suspicious:0.44,sleepy:0.20,
                love:0.38,dizzy:0.56,scared:0.92,embarrassed:0.48,determined:0.72,
              }[_emo]||0.50;
              d.baseSpd = (0.45+Math.random()*0.20)*_spdMul;

              const _holdMul = {
                chill:1.0,happy:0.8,laughing:0.6,sad:2.2,crying:1.8,
                angry:0.3,surprised:0.5,suspicious:2.4,sleepy:3.5,
                love:2.0,dizzy:0.7,scared:0.3,embarrassed:1.1,determined:0.4,
              }[_emo]||1.0;

              const _stops = {
                chill:3,happy:4,laughing:4,sad:2,crying:2,
                angry:4,surprised:3,suspicious:3,sleepy:2,
                love:2,dizzy:3,scared:4,embarrassed:3,determined:4,
              }[_emo]||3;

              const _homeProb = {
                chill:0.50,happy:0.28,laughing:0.18,sad:0.60,crying:0.55,
                angry:0.08,surprised:0.20,suspicious:0.72,sleepy:0.75,
                love:0.50,dizzy:0.18,scared:0.10,embarrassed:0.35,determined:0.12,
              }[_emo]||0.40;

              const _cb2 = getSafeBounds();
              const _cx2=(_cb2.minX+_cb2.maxX)*0.5, _cy2=(_cb2.minY+_cb2.maxY)*0.5;
              const _hw2=(_cb2.maxX-_cb2.minX)*0.5*0.80, _hh2=(_cb2.maxY-_cb2.minY)*0.5*0.80;

              const _pool = [
                {x:_cx2+_hw2*0.72,y:_cy2+_hh2*0.68},
                {x:_cx2-_hw2*0.68,y:_cy2+_hh2*0.62},
                {x:_cx2+_hw2*0.48,y:_cy2-_hh2*0.52},
                {x:_cx2-_hw2*0.52,y:_cy2-_hh2*0.58},
                {x:_cx2+_hw2*0.18,y:_cy2+_hh2*0.38},
                {x:_cx2-_hw2*0.22,y:_cy2+_hh2*0.48},
              ];

              const _shuffled = _pool.slice().sort(()=>Math.random()-0.5).slice(0,_stops);
              if (Math.random()<_homeProb) {
                const _ins=1+Math.floor(Math.random()*Math.max(1,_shuffled.length));
                _shuffled.splice(_ins,0,{x:GHOST_HOME_DEFAULT.x,y:GHOST_HOME_DEFAULT.y});
              }

              const _sp = {
                x:Math.max(_cb2.minX,Math.min(_cb2.maxX,ghost.position.x)),
                y:Math.max(_cb2.minY,Math.min(_cb2.maxY,ghost.position.y)),
              };
              d.wps=[_sp,..._shuffled,{x:GHOST_HOME_DEFAULT.x,y:GHOST_HOME_DEFAULT.y}];
              d.wps=d.wps.map(p=>({
                x:Math.max(_cb2.minX,Math.min(_cb2.maxX,p.x)),
                y:Math.max(_cb2.minY,Math.min(_cb2.maxY,p.y)),
              }));

              // Pre-compute segment timing + facing events
              d.segs=[];
              let _clk=t;
              const FACE_AWAY_MIN = 1.1; // WU of depth DECREASE (toward home=far) to justify turning away
              for (let _i=0;_i<d.wps.length-1;_i++) {
                const _p1=d.wps[_i], _p2=d.wps[_i+1];
                const _dist=Math.hypot(_p2.x-_p1.x,_p2.y-_p1.y);
                const _trav=_dist/Math.max(0.04,d.baseSpd);
                const _hold=(_i<d.wps.length-2)?(0.8+Math.random()*2.6)*_holdMul:0.5;
                const _d1=Math.hypot(_p1.x-GHOST_HOME_DEFAULT.x,_p1.y-GHOST_HOME_DEFAULT.y);
                const _d2=Math.hypot(_p2.x-GHOST_HOME_DEFAULT.x,_p2.y-GHOST_HOME_DEFAULT.y);
                const _dd=_d2-_d1;
                let _fe=null;
                // Only turn away when moving AWAY from home (depth increasing).
                // Face away only when flying TOWARD home (shrinking = going far into distance).
                // _dd < 0 means dist-from-home is DECREASING = ghost gets smaller = flying away.
                // _dd > 0 means dist-from-home INCREASING = ghost gets bigger = coming closer = NEVER face away.
                if (_dd <= -FACE_AWAY_MIN && _trav>1.6 && _dist>0.8) {
                  _fe={
                    lookAwayAt:  _clk+_trav*0.12,  // turn 12% into journey
                    lookFrontAt: _clk+_trav*0.62,  // face front 62% through (comedy beat)
                  };
                }
                d.segs.push({p1:_p1,p2:_p2,startT:_clk,travelT:_trav,
                  endTravelT:_clk+_trav,endT:_clk+_trav+_hold,fe:_fe});
                _clk+=_trav+_hold;
              }
              d.planned=true; d.segIdx=0; d.planEndT=_clk;

              // Prime the first facing event
              facing.planLookAwayAt=99999; facing.planLookFrontAt=99999;
              for (const _s of d.segs) {
                if (_s.fe){ facing.planLookAwayAt=_s.fe.lookAwayAt; facing.planLookFrontAt=_s.fe.lookFrontAt; break; }
              }
            }

            // Advance segment
            while (d.segIdx<d.segs.length-1 && t>=d.segs[d.segIdx].endT) {
              d.segIdx++;
              const _ns=d.segs[d.segIdx];
              if (_ns && _ns.fe) {
                facing.planLookAwayAt=_ns.fe.lookAwayAt;
                facing.planLookFrontAt=_ns.fe.lookFrontAt;
              } else {
                // No facing event on this segment — cancel any pending look-away
                // so the ghost doesn't turn away on an approaching/neutral segment.
                facing.planLookAwayAt=99999;
                // If already back-facing, bring it front immediately
                if (facing.state==='back'||facing.state==='turning_back') {
                  facing.planLookFrontAt=t+0.15;
                } else {
                  facing.planLookFrontAt=99999;
                }
              }
            }

            // Position on current segment (smooth ease-in-out)
            const _sg=d.segs[Math.min(d.segIdx,d.segs.length-1)];
            if (!_sg){bodyAction.kind=null;break;}

            let _tp;
            if (t>=_sg.endTravelT) {
              _tp=1.0;
            } else {
              _tp=Math.max(0,Math.min(1,(t-_sg.startT)/Math.max(0.01,_sg.travelT)));
              _tp=_tp<0.5?2*_tp*_tp:-1+(4-2*_tp)*_tp; // smooth ease in-out
            }

            const _ix=_sg.p1.x+(_sg.p2.x-_sg.p1.x)*_tp;
            const _iy=_sg.p1.y+(_sg.p2.y-_sg.p1.y)*_tp;
            const _wa=applyElementAwareness(_ix,_iy,bnd);
            actionX=_wa.x; actionY=_wa.y;

            facing.heading=Math.atan2(_sg.p2.y-_sg.p1.y,_sg.p2.x-_sg.p1.x);
            facing.velMag=_tp>=1?0:d.baseSpd*0.08;

            { const _dd2=Math.hypot(actionX-GHOST_HOME_DEFAULT.x,actionY-GHOST_HOME_DEFAULT.y);
              actionScale=HOME_SCALE+Math.min(1,_dd2/3.5)*(GHOST_MAX_SCALE-HOME_SCALE); }

            if (t>=d.planEndT) {
              if (bodyAction.loop){bodyAction.start=t;bodyAction.cycle++;bodyAction.data={};}
              else{bodyAction.kind=null;ghostHome.x=GHOST_HOME_DEFAULT.x;ghostHome.y=GHOST_HOME_DEFAULT.y;}
            }
            break;
          }
          case 'peek': {
            // Darts to the corner furthest from current position with
            // easeOutBack overshoot, holds, then springs back.
            // Uses direct position assignment (not steering integrator).
            isMovement = false;  // direct position — skip steer integrator
            const d = bodyAction.data;
            if (d.peekCycle !== bodyAction.cycle) {
              d.peekCycle = bodyAction.cycle;
              const corners = [
                {x:bnd.minX+0.2, y:bnd.maxY-0.2},  // bottom-left  (close)
                {x:bnd.maxX-0.2, y:bnd.maxY-0.2},  // bottom-right (close)
                {x:bnd.minX+0.2, y:bnd.minY+0.2},  // top-left     (far)
                {x:bnd.maxX-0.2, y:bnd.minY+0.2},  // top-right    (far)
              ];
              let best=corners[0], bestD=-1;
              for (const c of corners) {
                const dd=Math.hypot(c.x-ghost.position.x, c.y-ghost.position.y);
                if (dd>bestD) { bestD=dd; best=c; }
              }
              d.tx=best.x; d.ty=best.y;
              d.hx=ghost.position.x; d.hy=ghost.position.y;
            }
            let px_, py_;
            if (ap<0.48) {
              const p2=ap/0.48;
              px_=d.hx+(d.tx-d.hx)*eob(p2);
              py_=d.hy+(d.ty-d.hy)*eob(p2);
            } else if (ap<0.68) {
              px_=d.tx; py_=d.ty;
            } else {
              const p2=(ap-0.68)/0.32;
              px_=d.tx+(d.hx-d.tx)*eo3(p2);
              py_=d.ty+(d.hy-d.ty)*eo3(p2);
            }
            const adj = applyElementAwareness(px_, py_, bnd);
            // Direct position assignment — peek overrides steering.
            ghost.position.x = adj.x; ghost.position.y = adj.y;
            steerVel.x = 0; steerVel.y = 0;
            actionRotZ = Math.sin(ap*Math.PI*3)*0.10;
            facing.heading = Math.atan2(d.ty-d.hy, d.tx-d.hx);
            facing.velMag  = ap<0.5 ? 0.12 : 0.06;
            { const _d = Math.hypot(adj.x-GHOST_HOME_DEFAULT.x, adj.y-GHOST_HOME_DEFAULT.y);
              actionScale = HOME_SCALE + Math.min(1,_d/3.5)*(GHOST_MAX_SCALE-HOME_SCALE) + Math.sin(ap*Math.PI)*0.03; }
            if (ap>=1) { if(bodyAction.loop){bodyAction.start=t;bodyAction.cycle++;bodyAction.data={};}else bodyAction.kind=null; }
            break;
          }

          case 'fly_to_element': {
            isMovement = true;
            const o=bodyAction.data.opts||{};
            const tx_=o.wx??0,ty_=o.wy??0;
            const sx_=o.startX??ghost.position.x, sy_=o.startY??ghost.position.y;
            actionX=sx_+(tx_-sx_)*eio(ap);
            actionY=sy_+(ty_-sy_)*eio(ap)+Math.sin(ap*Math.PI)*0.3;
            { const _fx=o.startX??ghost.position.x, _fy=o.startY??ghost.position.y;
              const _tx2=o.wx??0, _ty2=o.wy??0;
              const _cx=_fx+(_tx2-_fx)*eio(ap), _cy=_fy+(_ty2-_fy)*eio(ap);
              const _df=Math.hypot(_cx-GHOST_HOME_DEFAULT.x,_cy-GHOST_HOME_DEFAULT.y);
              actionScale=(HOME_SCALE+Math.min(1,_df/3.5)*(GHOST_MAX_SCALE-HOME_SCALE))*(1-Math.sin(ap*Math.PI)*0.04); }
            actionRotZ=Math.sin(ap*Math.PI*2)*0.08;
            if (ap>=1) { ghostHome.x=tx_;ghostHome.y=ty_;bodyAction.kind=null; }
            break;
          }

        } } catch (err) {
          console.error('[ghost] action error:', bodyAction.kind, err);
          bodyAction.kind = null;
        }
      }

      // Opacity — written here for idle/entry; facing state machine overwrites during turns
      if (facing.state === 'front' && facing.turnOpacity >= 1) {
        bodyUniforms.uOpacity.value = actionOpacity * (bodyAction.hidden ? 0 : 1);
        eyeUniforms.uOpacity.value  = actionOpacity * (bodyAction.hidden ? 0 : 1);
      }

      ghost.position.z = 0;

      // ── Emotion speed constants — hoisted so facing state machine
      // can reference MAX_SPEED safely regardless of isMovement branch.
      const _emoNameG = emo.currentName || 'chill';
      const _emoSpdG = {
        chill:0.85, happy:1.0, laughing:1.1, sad:0.55, crying:0.60,
        angry:1.35, surprised:1.2, suspicious:0.70, sleepy:0.40,
        love:0.65, dizzy:0.95, scared:1.45, embarrassed:0.80, determined:1.10,
      }[_emoNameG] || 0.85;
      const MAX_SPEED_G = 1.4 * _emoSpdG;

      // Position
      if (drag.active) {
        steerVel.x = 0; steerVel.y = 0;
        bankState.headingInit = false;
        ghost.rotation.z = Math.sin(t*1.2)*0.03;
        // Live depth scale while dragging — same field as idle/movement so
        // pulling ghost out of the far zone smoothly enlarges it and pushing
        // it back in shrinks it, all in real time.
        { const _dd = Math.hypot(ghost.position.x - GHOST_HOME_DEFAULT.x, ghost.position.y - GHOST_HOME_DEFAULT.y);
          actionScale = HOME_SCALE + Math.min(1, _dd / 3.5) * (GHOST_MAX_SCALE - HOME_SCALE); }
      } else if (isMovement) {
        // ── Steering integration ──────────────────────────────
        // Compute desired velocity toward the action's target using arrival
        // steering (slows as it approaches). Derive a steering force =
        // desired - current, clamp it, then integrate into position.
        // This replaces the flat (1-exp(-18*dt)) spring — the ghost now
        // accelerates, rounds corners, and decelerates organically.
        // Inertia: low MAX_FORCE = can't snap direction, must arc through corners.
        // High SLOW_R = starts decelerating early, glides gracefully into waypoints.
        const MAX_SPEED  = MAX_SPEED_G;
        const MAX_FORCE  = 1.4 * _emoSpdG;  // was 2.8 — much softer, more ghostly inertia
        const SLOW_R     = 1.40;             // was 0.90 — begins gliding in much earlier

        const desired = arrivalSteer(ghost.position.x, ghost.position.y, actionX, actionY, MAX_SPEED, SLOW_R);
        const steerF  = { x: desired.x - steerVel.x, y: desired.y - steerVel.y };
        clampMag(steerF, MAX_FORCE);
        steerVel.x += steerF.x * dt;
        steerVel.y += steerF.y * dt;
        clampMag(steerVel, MAX_SPEED);

        // ── Ghost bob oscillation ─────────────────────────────
        // Two superimposed sinusoids perpendicular to travel direction
        // give the ghost its characteristic weaving float. Amplitude
        // scales with speed so a hovering ghost barely moves, but a
        // ghost at full speed has a visible, organic side-to-side drift.
        const _velM = Math.hypot(steerVel.x, steerVel.y);
        const _speedNorm = Math.min(1, _velM / Math.max(0.01, MAX_SPEED));

        // Lateral bob — perpendicular to heading
        const _hdg = Math.atan2(steerVel.y, steerVel.x);
        const _perpX = -Math.sin(_hdg);  // unit perpendicular
        const _perpY =  Math.cos(_hdg);
        // Phase accumulates with speed so faster = more cycles
        ghostBob.phase += dt * (1.8 + _speedNorm * 2.2);
        ghostBob.vertPhase += dt * (0.9 + _speedNorm * 0.8);
        // Wobble amplitude eases up when moving, eases down when stopped
        const _wobTarget = _speedNorm * 0.055;  // max ±0.055 WU lateral
        ghostBob.wobAmt += (_wobTarget - ghostBob.wobAmt) * (1 - Math.exp(-5 * dt));
        // Primary lateral sine + subtler second harmonic for organic feel
        const _latOff = Math.sin(ghostBob.phase) * ghostBob.wobAmt
                      + Math.sin(ghostBob.phase * 1.618) * ghostBob.wobAmt * 0.35;
        // Vertical bob — always present but stronger when moving
        const _vertAmp = 0.018 + _speedNorm * 0.032;
        const _vertOff = Math.sin(ghostBob.vertPhase) * _vertAmp
                       + Math.sin(ghostBob.vertPhase * 0.618) * _vertAmp * 0.4;

        ghost.position.x += (steerVel.x + _perpX * _latOff) * dt;
        ghost.position.y += (steerVel.y + _perpY * _latOff + _vertOff) * dt;

        // ── Physics banking ───────────────────────────────────
        // Derive heading from velocity; rate-of-heading-change gives bank.
        const curHeading = Math.atan2(steerVel.y, steerVel.x);
        if (!bankState.headingInit) { bankState.prevHeading = curHeading; bankState.headingInit = true; }
        let dH = curHeading - bankState.prevHeading;
        // Unwrap to [-π, π] to avoid 2π wraps on reversal
        if (dH >  Math.PI) dH -= Math.PI*2;
        if (dH < -Math.PI) dH += Math.PI*2;
        bankState.prevHeading = curHeading;
        const velMag_  = Math.hypot(steerVel.x, steerVel.y);
        const bankTarget = -dH / Math.max(dt, 0.008) * 0.012 * Math.min(velMag_ / MAX_SPEED, 1);
        const BANK_CLAMP = 0.14;  // lighter tilt — feels more ethereal
        const bankClamped = Math.max(-BANK_CLAMP, Math.min(BANK_CLAMP, bankTarget));
        // Underdamped spring toward bank target — settles with one overshoot
        // wobble (ω=9, ζ=0.55) so arrival feels like landing, not stopping.
        const omega = 9.0, zeta = 0.55;
        const bankErr = bankClamped - bankState.angle;
        // Simple critically-damped approximation each frame is enough:
        bankState.angle += bankErr * (1 - Math.exp(-omega * zeta * dt));
        // Add a tiny heading-driven lean on top for directional tilt feel
        // Lean driven by bank + lateral bob (tilts into the oscillation)
        const leanTilt = -Math.sin(curHeading) * Math.min(velMag_ / MAX_SPEED, 1) * 0.05;
        const bobTilt  = Math.sin(ghostBob.phase) * ghostBob.wobAmt * 0.8;  // tilt with bob
        ghost.rotation.z = bankState.angle + leanTilt + bobTilt + actionRotZ;
      } else if (dropSpring.active && !bodyAction.hidden) {
        steerVel.x *= Math.pow(0.1, dt); steerVel.y *= Math.pow(0.1, dt);
        bankState.headingInit = false;
        ghost.position.x += (dropSpring.tx-ghost.position.x)*(1-Math.exp(-14*dt));
        ghost.position.y += (dropSpring.ty-ghost.position.y)*(1-Math.exp(-14*dt));
        if(Math.abs(ghost.position.x-dropSpring.tx)<0.004&&Math.abs(ghost.position.y-dropSpring.ty)<0.004) dropSpring.active=false;
        ghost.rotation.z = actionRotZ+Math.sin(t*0.7)*0.022;
        // Same depth field as idle — consistent scale whether drifting or springing.
        { const distToHome = Math.hypot(ghost.position.x - GHOST_HOME_DEFAULT.x, ghost.position.y - GHOST_HOME_DEFAULT.y);
          const t__ = Math.min(1, distToHome / 3.5);
          actionScale = HOME_SCALE + t__ * (GHOST_MAX_SCALE - HOME_SCALE);
        }
      } else {
        steerVel.x *= Math.pow(0.04, dt); steerVel.y *= Math.pow(0.04, dt);
        bankState.headingInit = false;
        // Slow ethereal bob — barely perceptible at home, ghost feels weightless.
        // Float settles down while he sleeps.
        const _fa = 0.038 * (1 - 0.45 * mood.breath);
        const floatY = Math.sin(t*0.6180)*_fa + Math.sin(t*0.2718)*(_fa*0.45);
        const floatX = Math.sin(t*0.3819)*(_fa*0.60) + Math.sin(t*0.5772)*(_fa*0.25);
        const extraY = entryDone ? 0 : actionY-(ghostHome.y+floatY);
        // Mood droop — sinks a little when dozing (≈4% of his height, a
        // touch more on the nod itself). Eased by the home spring below.
        const _moodY = -mood.sink * 0.04 * PLANE_H * ghost.scale.y;
        ghost.position.x += (ghostHome.x+floatX-ghost.position.x)*(1-Math.exp(-1.4*dt));
        ghost.position.y += (ghostHome.y+floatY+extraY+_moodY-ghost.position.y)*(1-Math.exp(-1.4*dt));
        // Dozing tilt (to one side, chosen per doze) + curious lean toward
        // the cursor while watching it.
        ghost.rotation.z  = Math.sin(t*0.4236)*0.012 + Math.sin(t*0.7071)*0.006 + actionRotZ
                          + mood.sink * 0.035 * mood.side + mood.lean;
        if (entryDone) {
          const _distH = Math.hypot(ghost.position.x-GHOST_HOME_DEFAULT.x, ghost.position.y-GHOST_HOME_DEFAULT.y);
          actionScale = HOME_SCALE + Math.min(1,_distH/3.5)*(GHOST_MAX_SCALE-HOME_SCALE);
          // Slow sleep breathing.
          actionScale *= 1 + 0.010 * Math.sin((now / 1000) * 1.35) * mood.breath;
        }
      }

      // Mood hop (startle / jolt after a nod) — applied as a delta so it
      // rides on top of whichever branch placed the ghost this frame and
      // takes itself back off as it decays. Quick rise, soft fall.
      {
        const _hopWU = drag.active ? 0 : mood.hop * 0.035 * PLANE_H * ghost.scale.y;
        ghost.position.y += _hopWU - mood.hopApplied;
        mood.hopApplied = _hopWU;
      }

      // Scale — applied once here after position+idle scale are both resolved.
      // actionScale is now the correct value whether from entry, action, dropspring, or idle.
      ghost.scale.setScalar(Math.max(0.30, Math.min(GHOST_MAX_SCALE, actionScale)));

      // ── Position clamp — NaN guard + safe-bounds enforcement ──
      { if (!isFinite(ghost.position.x)||!isFinite(ghost.position.y)) {
          ghost.position.x=GHOST_HOME_DEFAULT.x; ghost.position.y=GHOST_HOME_DEFAULT.y;
          steerVel.x=0; steerVel.y=0;
        }
        // Use live safe bounds (body-size-aware) to clamp position.
        const _cb = getSafeBounds();
        ghost.position.x = Math.max(_cb.minX, Math.min(_cb.maxX, ghost.position.x));
        ghost.position.y = Math.max(_cb.minY, Math.min(_cb.maxY, ghost.position.y));
        // Clamp steerVel against walls: zero out the wall-hitting component
        // so the ghost doesn't pile up momentum against a boundary.
        if (ghost.position.x <= _cb.minX && steerVel.x < 0) steerVel.x = 0;
        if (ghost.position.x >= _cb.maxX && steerVel.x > 0) steerVel.x = 0;
        if (ghost.position.y <= _cb.minY && steerVel.y < 0) steerVel.y = 0;
        if (ghost.position.y >= _cb.maxY && steerVel.y > 0) steerVel.y = 0;
      }

      // ── Facing state machine ─────────────────────────────────
      // Transition: smooth eased opacity dissolve — fast-dip crossfade.
      // Uses quick ease-in fade-out then ease-out fade-in so the ghost spends
      // almost no time at low opacity. Eyes fade slightly ahead of the body
      // (face disappears first, body second) for ghostly realism.
      // Texture swaps at opacity=0. No squeeze, no side-profile artefact.
      {
        const _fn = emo.currentName || 'chill';
        const _spd = {
          chill:3.2,happy:3.8,laughing:4.2,sad:2.0,crying:2.2,
          angry:5.0,surprised:5.5,suspicious:2.8,sleepy:1.6,
          love:2.0,dizzy:4.4,scared:5.5,embarrassed:3.2,determined:4.2,
        }[_fn]||3.2;
        const FADE_OUT = _spd * 2.4;
        const FADE_IN  = _spd * 1.6;

        if ((isMovement || facing.testTurnActive) && entryDone) {
          if (facing.state==='front' && t>=facing.planLookAwayAt) {
            facing.planLookAwayAt=99999;
            const _toHomeX=GHOST_HOME_DEFAULT.x-ghost.position.x;
            const _toHomeY=GHOST_HOME_DEFAULT.y-ghost.position.y;
            const _toHomeDist=Math.hypot(_toHomeX,_toHomeY)||1;
            const _dotToHome=(steerVel.x*_toHomeX+steerVel.y*_toHomeY)/_toHomeDist;
            if (_dotToHome>0.05) {
              facing.state='turning_back'; facing.turnOpacity=1; facing.turnScaleX=1;
              facing.lastSide=facing.lastSide>=0?-1:1;
              facing.bkSeedX=facing.lastSide*(0.10+Math.random()*0.08);
              facing.bkSeedY=(Math.random()-0.5)*0.10;
              facing.bkDriftX=0; facing.bkDriftY=0;
            }
          }
          if (facing.state==='back' && t>=facing.planLookFrontAt) {
            facing.planLookFrontAt=99999;
            facing.state='turning_front'; facing.turnOpacity=1; facing.turnScaleX=1;
            facing.bkDriftX=0; facing.bkDriftY=0;
          }

          switch(facing.state){
            case 'front':{
              facing.turnOpacity=Math.min(1, facing.turnOpacity + dt*FADE_IN*1.5);
              facing.eyeV=Math.min(1, facing.eyeV + dt*FADE_IN*2.0);
              facing.bkDriftX=0; facing.bkDriftY=0;
              break;
            }
            case 'turning_back':{
              { const _abH=GHOST_HOME_DEFAULT;
                const _abDist=Math.hypot(_abH.x-ghost.position.x,_abH.y-ghost.position.y)||1;
                const _abDot=(steerVel.x*(_abH.x-ghost.position.x)+steerVel.y*(_abH.y-ghost.position.y))/_abDist;
                if (_abDot<-0.10) {
                  facing.state='front'; facing.turnOpacity=1; facing.turnScaleX=1; facing.eyeV=1; facing.testTurnActive=false;
                  if (ghostTex) { bodyUniforms.uMap.value=ghostTex; bodyMat.needsUpdate=true; }
                  break;
                }
              }
              // Eyes fade slightly ahead (face disappears first — ghostly realism)
              facing.eyeV    = Math.max(0, facing.eyeV    - dt*FADE_OUT*1.8);
              facing.turnOpacity = Math.max(0, facing.turnOpacity - dt*FADE_OUT);
              if(facing.turnOpacity<=0){
                const _bt = ghostBackTex || ghostTex;
                if (_bt) { bodyUniforms.uMap.value=_bt; bodyMat.needsUpdate=true; }
                facing.state='back'; facing.holdT=t; facing.turnOpacity=0;
              }
              break;
            }
            case 'back':{
              facing.turnOpacity=Math.min(1, facing.turnOpacity + dt*FADE_IN);
              facing.eyeV=0;
              const _bd=0.012+facing.velMag*0.03;
              facing.bkDriftX+=Math.sin(t*0.27+facing.bkSeedX*5)*_bd*dt;
              facing.bkDriftY+=Math.cos(t*0.20+facing.bkSeedY*5)*_bd*dt;
              facing.bkDriftX=Math.max(-0.14,Math.min(0.14,facing.bkDriftX));
              facing.bkDriftY=Math.max(-0.09,Math.min(0.09,facing.bkDriftY));
              break;
            }
            case 'turning_front':{
              facing.bkDriftX*=Math.pow(0.75,60*dt); facing.bkDriftY*=Math.pow(0.75,60*dt);
              facing.turnOpacity = Math.max(0, facing.turnOpacity - dt*FADE_OUT);
              facing.eyeV=0;
              if(facing.turnOpacity<=0){
                if (ghostTex) { bodyUniforms.uMap.value=ghostTex; bodyMat.needsUpdate=true; }
                facing.state='fade_in_front'; facing.bkDriftX=0; facing.bkDriftY=0;
              }
              break;
            }
            case 'fade_in_front':{
              facing.turnOpacity = Math.min(1, facing.turnOpacity + dt*FADE_IN*1.1);
              // Eyes appear after body is ~35% visible (body leads, eyes follow)
              const _eyeLag = Math.max(0, (facing.turnOpacity - 0.35) / 0.65);
              facing.eyeV = Math.min(1, facing.eyeV + _eyeLag * dt * FADE_IN * 2.5);
              if(facing.turnOpacity>=1){ facing.state='front'; facing.eyeV=1; facing.testTurnActive=false; }
              break;
            }
          }

        } else {
          if (facing.state==='back'||facing.state==='turning_back') {
            facing.state='turning_front'; facing.turnOpacity=Math.min(1, facing.turnOpacity);
            facing.planLookAwayAt=99999; facing.planLookFrontAt=99999;
            facing.testTurnActive=false;
          }
          if (facing.state==='turning_front') {
            facing.bkDriftX*=Math.pow(0.75,60*dt); facing.bkDriftY*=Math.pow(0.75,60*dt);
            facing.turnOpacity = Math.max(0, facing.turnOpacity - dt*FADE_OUT);
            facing.eyeV=0;
            if(facing.turnOpacity<=0){
              if (ghostTex) { bodyUniforms.uMap.value=ghostTex; bodyMat.needsUpdate=true; }
              facing.state='fade_in_front'; facing.bkDriftX=0; facing.bkDriftY=0;
            }
          } else if (facing.state==='fade_in_front') {
            facing.turnOpacity = Math.min(1, facing.turnOpacity + dt*FADE_IN*1.5);
            const _eyeLag = Math.max(0, (facing.turnOpacity - 0.35) / 0.65);
            facing.eyeV = Math.min(1, facing.eyeV + _eyeLag * dt * FADE_IN * 2.5);
            if(facing.turnOpacity>=1){ facing.state='front'; facing.eyeV=1; facing.testTurnActive=false; }
          } else {
            facing.state='front';
            facing.turnOpacity = Math.min(1, facing.turnOpacity + dt*FADE_IN);
            facing.eyeV = Math.min(1, facing.eyeV + dt*FADE_IN*2.0);
            facing.bkDriftX=0; facing.bkDriftY=0;
          }
        }

        if (facing.state==='back' && (isMovement || dropSpring.active)) {
          ghost.position.x += facing.bkDriftX * dt * 0.4;
          ghost.position.y += facing.bkDriftY * dt * 0.4;
        }

        // No scaleX squeeze — uniform scale on X
        ghost.scale.x = ghost.scale.y;

        bodyUniforms.uFlipX.value   = 0;
        bodyUniforms.uTurnAmt.value  = 0;
        const _backTarget = (facing.state === 'back' || facing.state === 'turning_front') ? 1.0 : 0.0;
        const _backRate   = _backTarget > bodyUniforms.uBackAmt.value ? 2.8 : 1.4;
        bodyUniforms.uBackAmt.value += (_backTarget - bodyUniforms.uBackAmt.value) * (1 - Math.exp(-_backRate * dt));
        const tOp = Math.max(0, Math.min(1, facing.turnOpacity));
        bodyUniforms.uOpacity.value  = (actionOpacity * (bodyAction.hidden ? 0 : 1)) * tOp;
        eyeUniforms.uOpacity.value   = (actionOpacity * (bodyAction.hidden ? 0 : 1)) * tOp;
        eyeUniforms.uEyeVisible.value= Math.max(0, Math.min(1, facing.eyeV));

      } // end facing state machine block

      ghost.rotation.y = -0.18+Math.sin(t*0.43)*0.05;

      // Shadow — subtler when ghost is far/small (near home), stronger when close.
      { const scl=ghost.scale.x;
        const bobN=(ghost.position.y+0.15)/0.30;
        const sS=(0.85+(1-Math.max(0,Math.min(1,bobN)))*0.35)*Math.max(scl*0.55+0.45,0.2);
        shadow.scale.set(sS,sS,1);
        shadow.position.x=ghost.position.x*0.5;
        // Max shadow opacity scales with ghost scale — small/far ghost casts faint shadow
        const maxShadow = 0.20 + (scl - HOME_SCALE)  / (GHOST_MAX_SCALE - HOME_SCALE) * 0.28;
        shadowMat.opacity=(entryDone?Math.max(0.10, Math.min(0.45, maxShadow)):shadowMat.opacity)*(bodyAction.hidden?0:1)*Math.max(scl*0.7+0.3,0.2);
      }

      // ── Depth layer swap ──────────────────────────────────────
      // When scale < 0.80 the ghost reads as "far away" — move the
      // canvas into the far layer (z=7200, behind the briefing bubble).
      // When scale >= 0.80 it's "close" — move to near layer (z=8400,
      // in front). Since default home is at HOME_SCALE (0.64), ghost
      // naturally sits behind the UI at rest and only comes forward when
      // wandering toward the viewer.
      {
        const scl_ = ghost.scale.x;
        const targetMount = (scl_ < 0.80 && mountNear && mountFar)
          ? mountFar : (mountNear || mountFar);
        const domEl = renderer.domElement;
        if (domEl.parentElement !== targetMount && targetMount) {
          targetMount.appendChild(domEl);
        }
      }

      renderer.render(scene, camera);

      // Persist position/scale so remounts (dashboard → chat → dashboard)
      // can restore exactly where the ghost was without replaying rise_in.
      if (_ghostSession.hasPlayed) {
        _ghostSession.posX    = ghost.position.x;
        _ghostSession.posY    = ghost.position.y;
        _ghostSession.scale   = ghost.scale.x;
        _ghostSession.opacity = bodyUniforms.uOpacity.value;
        // Save ghostHome when idle (not mid-action — actions redirect ghostHome
        // to waypoints temporarily; don't persist those).
        if (!bodyAction.kind) {
          _ghostSession.homeX = ghostHome.x;
          _ghostSession.homeY = ghostHome.y;
        }
        // Throttled LS flush — only when user-moved (dock position is
        // recalculated from DOM on every mount, no need to persist it).
        if (_ghostSession.userMoved) {
          _ghostSession.flushToLS();
        }
      }

      scanDOM();

      // Gaze — nudge pupils toward nearest DOM element
      const near_=nearestElement();
      if(near_&&near_.dist<1.8){
        const dx_=near_.wx-ghost.position.x,dy_=near_.wy-ghost.position.y;
        const nm_=Math.hypot(dx_,dy_)||1,mg=0.32;
        gazeState.wx=Math.max(-mg,Math.min(mg,dx_/nm_*mg));
        gazeState.wy=Math.max(-mg,Math.min(mg,dy_/nm_*mg));
        gazeState.targetAmt=Math.min(1,(1.8-near_.dist)/1.4);
      } else { gazeState.targetAmt=0; }
      gazeState.amt+=(gazeState.targetAmt-gazeState.amt)*(1-Math.exp(-2.5*dt));
      eyeUniforms.uPupilOffsetY.value=emo.cur.pupilOffsetY+gazeState.wy*gazeState.amt*0.22;

      // Ghost hit-div: reposition over ghost body each frame.
      //
      // SIZING — compute from actual plane geometry, not legacy 260/320.
      // Plane is PLANE_W × PLANE_H world-units at scale=1. World→pixel
      // conversion = GHOST_UNIT_PX() (constant ≈ 72.73px/wu given the
      // ortho-camera's height-relative scaling). At ghost.scale=scl_ the
      // on-screen plane is (PLANE_W * scl_ * px_per_wu) wide. This makes
      // the hit-div the SAME size as the rendered ghost plane, so polygon
      // UVs (0..1) map 1:1 to plane UVs and the silhouette aligns exactly.
      //
      // hitCal offsets let the user dial in fine corrections (offsetX/Y in
      // px-fraction-of-hit-div, scaleX/Y multipliers) when the geometric
      // sizing doesn't perfectly match the rendered ghost — which can happen
      // due to cloth-shader vertex distortion, the ghost group's Y-rotation,
      // PNG transparent margins, etc.
      {
        const scl_ = ghost.scale.x;
        const ppu  = GHOST_UNIT_PX();
        const baseW = PLANE_W * scl_ * ppu;
        const baseH = PLANE_H * scl_ * ppu;
        const bPxW = baseW * hitCal.scaleX;
        const bPxH = baseH * hitCal.scaleY;
        const gpx_ = wToPX(ghost.position.x);
        const gpy_ = wToPY(ghost.position.y);
        // offsetX/Y are fractions of the (post-scale) hit-div size — so a
        // tweak that corrects 10% to the right is offsetX = 0.10. This way
        // the calibration scales with depth: a fix tuned at HOME_SCALE keeps
        // working at MAX_SCALE because the offset is proportional.
        ghostHitDiv.style.left    = `${gpx_ - bPxW * 0.5 + hitCal.offsetX * bPxW}px`;
        ghostHitDiv.style.top     = `${gpy_ - bPxH * 0.5 + hitCal.offsetY * bPxH}px`;
        ghostHitDiv.style.width   = `${bPxW}px`;
        ghostHitDiv.style.height  = `${bPxH}px`;
        ghostHitDiv.style.display = (bodyAction.hidden || bodyUniforms.uOpacity.value < 0.05)
          ? 'none' : 'block';
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      loopDisposed = true;
      cancelAnimationFrame(rafId);
      rafId = 0;
      document.removeEventListener('visibilitychange', onVisChange);
      if (bcwHiddenObs) bcwHiddenObs.disconnect();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('bc:live-resize', onLiveResize);
      window.removeEventListener('bc:live-viewport', onLiveViewport);
      window.removeEventListener('pointermove', onPointerMoveDoc);
      window.removeEventListener('pointerup',   onPointerUpDoc);
      window.removeEventListener('pointercancel', onPointerCancelDoc);
      window.removeEventListener('blur', onBlurEndDrag);
      window.removeEventListener('mousemove',   onMoodActivity);
      window.removeEventListener('pointerdown', onMoodActivity);
      window.removeEventListener('keydown',     onMoodActivity);
      window.removeEventListener('wheel',       onMoodActivity);
      window.removeEventListener('bc:inbound',  onMoodInbound);
      try { ghostHitDiv.removeEventListener('pointerdown',   onPointerDown); } catch (_) {}
      try { ghostHitDiv.removeEventListener('pointermove',   onPointerMoveDoc); } catch (_) {}
      try { ghostHitDiv.removeEventListener('pointerup',     onPointerUpDoc); } catch (_) {}
      try { ghostHitDiv.removeEventListener('pointercancel', onPointerCancelDoc); } catch (_) {}
      try { ghostHitDiv.removeEventListener('click',         onHitClick); } catch (_) {}
      try { document.body.removeChild(ghostHitDiv); } catch (_) {}
      ghostCtlRef.current = null;
      if (typeof window !== 'undefined') window.__ghostCtl = null;
      try {
        planeGeo.dispose();
        bodyMat.dispose();
        eyeGeo.dispose();
        eyeMat.dispose();
        if (ghostTex) ghostTex.dispose();
        if (ghostBackTex) ghostBackTex.dispose();
        shadowGeo.dispose();
        shadowMat.dispose();
        shadowTex.dispose();
        renderer.dispose();
        // dispose() frees three.js resources but NOT the GL context itself.
        // Browsers cap live contexts (~16) and drop the oldest when exceeded,
        // so every logout/login used to leak one until the ghost went blank.
        try { renderer.forceContextLoss(); } catch (_) {}
        if (renderer.domElement && renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement);
        }
      } catch (_) { /* swallow */ }
    };
  }, [hasThree]);


  const lines = linesRef.current && linesRef.current.length ? linesRef.current : buildLines();
  const currentLine = lines[lineIdx % lines.length] || '';
  // Suppress unused-var warning for tick — it's only here to force re-render.
  void tick;

  return (
    <div style={{
      flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      gap:22, position:'relative', overflow:'hidden', padding:'0 24px'
    }}>
      <style>{`
        /* CSS-fallback cloth animation — multi-keyframe transform that
           combines a vertical bob, a slight side-to-side drift, a small
           skewX wobble for "head looking sideways" feel, and a breathing
           scale. Used both for the no-WebGL <img> fallback and as a
           gentle outer wrapper motion on the WebGL stage. */
        @keyframes ghostBob {
          0%   { transform: translate3d(0,    0px, 0) rotateZ(-1deg) skewX(-2deg) scale(1.00); }
          25%  { transform: translate3d(-3px, -4px, 0) rotateZ(-0.2deg) skewX(-0.5deg) scale(1.005); }
          50%  { transform: translate3d(0,   -8px, 0) rotateZ(1deg)    skewX(2deg)  scale(1.01); }
          75%  { transform: translate3d(3px, -4px, 0) rotateZ(0.2deg)  skewX(0.5deg) scale(1.005); }
          100% { transform: translate3d(0,    0px, 0) rotateZ(-1deg) skewX(-2deg) scale(1.00); }
        }
        @keyframes ghostShadowPulse {
          0%, 100% { transform: scaleX(1)    scaleY(1);   opacity: 0.55; }
          50%      { transform: scaleX(0.9)  scaleY(0.85); opacity: 0.35; }
        }
        @keyframes ghostOrbDrift {
          0%   { transform: translate(0, 0)   scale(1);   opacity: 0; }
          15%  { opacity: 0.5; }
          85%  { opacity: 0.5; }
          100% { transform: translate(var(--dx), var(--dy)) scale(1.4); opacity: 0; }
        }
        @keyframes ghostBubbleIn {
          0%   { opacity: 0; transform: translateY(14px) scale(0.96); filter: blur(6px); }
          60%  { filter: blur(0px); }
          100% { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0px); }
        }
        @keyframes ghostDotsIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 0.5; transform: translateY(0); }
        }
        @keyframes ghostStageIn {
          0%   { opacity: 0; transform: scale(0.92); }
          100% { opacity: 1; transform: scale(1); }
        }
        .ghost-stage { animation: ghostStageIn 700ms ease-out both; }
        .ghost-img-fallback {
          width: 100%;
          height: 100%;
          object-fit: contain;
          animation: ghostBob 6.5s ease-in-out infinite;
          transform-origin: 50% 35%;
          will-change: transform, filter;
          filter: drop-shadow(0 8px 18px rgba(0,0,0,0.35));
        }
        .ghost-shadow-svg { animation: ghostShadowPulse 6.5s ease-in-out infinite; transform-origin: 50% 50%; }
        .ghost-bubble {
          transition: opacity 420ms ease, transform 420ms ease;
          animation: ghostBubbleIn 900ms cubic-bezier(0.22,1,0.36,1) 600ms both;
        }
        .ghost-dots { animation: ghostDotsIn 700ms ease-out 1100ms both; }
      `}</style>

      {/* ── floating ambient orbs (depth cue) ───────────────────── */}
      {[
        {left:'18%', top:'28%', size:5,  dx:'14px',  dy:'-30px', delay:'0s',   col:'rgba(255,255,255,0.18)'},
        {left:'74%', top:'22%', size:3,  dx:'-10px', dy:'-22px', delay:'1.4s', col:'rgba(255,255,255,0.14)'},
        {left:'28%', top:'70%', size:4,  dx:'8px',   dy:'-26px', delay:'2.8s', col:'rgba(255,255,255,0.16)'},
        {left:'80%', top:'64%', size:3,  dx:'-6px',  dy:'-18px', delay:'0.7s', col:'rgba(255,255,255,0.13)'},
      ].map((o,i) => (
        <div key={i} style={{
          position:'absolute', left:o.left, top:o.top,
          width:o.size, height:o.size, borderRadius:'50%',
          background:o.col, boxShadow:`0 0 ${o.size*3}px ${o.col}`,
          ['--dx']:o.dx, ['--dy']:o.dy,
          animation:`ghostOrbDrift 7s ease-in-out ${o.delay} infinite`,
          pointerEvents:'none',
        }}/>
      ))}

      {/* ── ghost figure — dual-layer fixed overlay ────────────────
           Two stacked fixed divs share the same Three.js canvas.
           ghostOverlayRef (z=7200) sits BEHIND the briefing bubble
           (z≈auto/flow). A second ref at z=8400 sits in FRONT.
           The tick loop switches the canvas between them based on
           the ghost's current depth (scale): small/far → behind bubble,
           large/close → in front. This lets the ghost naturally pass
           behind and in front of the UI as it moves. */}
      <div
        ref={ghostOverlayRef}
        className="ghost-stage ghost-overlay-layer"
        style={{position:'fixed', inset:0, pointerEvents:'none', zIndex:7200, overflow:'visible'}}
      >
        {!hasThree && (
          <img src={GHOST_IMG_URL} alt="" className="ghost-img-fallback" draggable={false}
               style={{position:'absolute',left:'50%',top:'40%',transform:'translate(-50%,-50%)',
                       width:220,height:'auto',pointerEvents:'none',
                       filter:'drop-shadow(0 8px 18px rgba(0,0,0,0.35))'}}
               onError={(e)=>{ e.currentTarget.style.display='none'; }}/>
        )}
      </div>
      {/* Near layer — in front of briefing bubble when ghost is "close" */}
      <div
        ref={ghostOverlayNearRef}
        className="ghost-overlay-layer"
        style={{position:'fixed', inset:0, pointerEvents:'none', zIndex:8400, overflow:'visible'}}
      />

      {/* ── briefing ticker — moved into the contact list panel
          (above the search input). We publish the live line + fade to
          a window event so the contact list's BriefingPill component
          can render it without prop-drilling through the chat tree. ── */}
      {(() => {
        React.useEffect(() => {
          window.__briefing = { currentLine, fade };
          window.dispatchEvent(new CustomEvent('__briefing-update'));
        }, [currentLine, fade]);
        return null;
      })()}

      {/* ── floating dev/test popup ──────────────────────────────
           Rendered via a portal into document.body so that CSS
           transforms on ancestor elements (ghostStageIn animation,
           will-change, etc.) do not create a new containing block
           that traps the position:fixed panel and limits its drag range. */}
      {ReactDOM.createPortal(
        <GhostDevPanel
          open={devOpen}
          setOpen={setDevOpen}
          ctlRef={ghostCtlRef}
          emo={devEmo}        setEmo={setDevEmo}
          intro={devIntro}    setIntro={setDevIntro}
          exit={devExit}      setExit={setDevExit}
          inChat={inChat}
        />,
        document.body
      )}
    </div>
  );
};
// Memoized: the WebGL dashboard is always mounted and used to re-render on
// every inbox event. It now redraws only when the briefing counts or the
// in-chat flag change (MsgList hands it a count-stable list reference).
const EmptyChatAvatar = React.memo(EmptyChatAvatarView);

// ── MESSAGES LIST — Telegram-style split pane ─────────────────
// Section fold state + first-seen bookkeeping for the contact list.
// GROUPS_LS_KEY  — which sections the operator has folded away.
// _rowFirstSeen  — when each conversation first appeared in the panel,
//                  so a newly-arrived row can shimmer its avatar while
//                  the real picture is still being fetched.
const GROUPS_LS_KEY = 'bc.contacts.folded.v1';
const AVA_FRESH_MS  = 2200;
const _rowFirstSeen = new Map();
const _rowSeenPrimed = { done: false };

// Recency value for a conversation row, in epoch milliseconds.
//
// `m.ts` is maintained by MSGS_STORE on every inbound / outbound / media
// write and hydrated from the server's updated_ts on load, so it's the
// real answer and almost always present.
//
// The fallback only matters for rows built by older code paths that never
// learned to set `ts`. It resolves the "HH:MM" display stamp against
// today's date, treating a future-looking stamp as yesterday's — without
// that rollover, at 00:04 every row stamped 23:xx last night would claim
// to be ~24 hours newer than the message that just arrived.
const msgTimeVal = (m) => {
  if (!m) return 0;
  if (Number.isFinite(m.ts) && m.ts > 0) return m.ts;
  const r = /^(\d{1,2}):(\d{2})/.exec(String(m.t || ''));
  if (!r) return 0;
  const d = new Date();
  d.setHours(+r[1], +r[2], 0, 0);
  let v = d.getTime();
  if (v > Date.now() + 60000) v -= 86400000;
  return v;
};

// Section definitions. Hoisted to module scope for the same reason
// STAGE_BADGE is — it's read once per render by the list body and once
// more by the reorder signature, and reallocating it each time buys
// nothing. Order here IS the priority order the sections paint in.
const SECTIONS = [
  {key:'escalated', label:'Escalated', accent:'rgba(212,146,112,0.85)'},
  {key:'customers', label:'Customers', accent:'rgba(126,184,154,0.78)'},
  {key:'incoming',  label:'Incoming',  accent:'rgba(160,168,180,0.70)'},
];

// ── CONTACT-LIST REORDER ANIMATION (FLIP) ─────────────────────
// When a conversation jumps to the top of its section, React reconciles
// by key and the row simply *is* somewhere else on the next paint — no
// motion, so the operator loses track of which chat moved and why the
// list suddenly looks different.
//
// FLIP fixes that without giving up on letting layout do the layout:
//   First   — the row's position before the update (kept from last pass)
//   Last    — its position after React has committed the new order
//   Invert  — translate it back to where it was, so nothing looks moved
//   Play    — animate that translate to zero
// The row is never absolutely positioned and the list never goes out of
// document flow; we only ever paint a compositor transform on top of the
// real layout, which is why this stays smooth with a long inbox.
// ── Panel-resize suspension ───────────────────────────────────
// While the operator is dragging the contact panel's edge, the panel's
// width changes every frame. Everything that measures the panel reacts to
// that: the FLIP bookkeeping re-reads a bounding rect for every visible
// row, and the ghost anchor spawns a multi-frame tracking loop. None of it
// is wrong, but a drag turns each into per-frame work that has to finish
// before the next frame can be painted — which is exactly what the drag
// felt like. A drag is a deliberate layout change by the operator, not
// something to follow, so the measuring stands down for the duration and
// takes one accurate reading when the pointer is released.
const PANEL_RESIZE = { active: false };

// ── ONE-PANE LAYOUT (narrow windows) ─────────────────────────────────
// Telegram-style. When the window is too narrow for the contact list and
// a usable chat side by side, the inbox shows ONE of them at full width:
//   • no chat open  → just the contact list;
//   • a chat open   → just the chat (its Back arrow returns to the list).
// Widening the window past the threshold brings both columns back at
// once, exactly as they were — nothing is unmounted by the switch, so
// scroll positions, drafts and the list's state all survive it.
//
// The threshold is "the narrowest list we'd show + the narrowest chat we'd
// show". Before that point the list yields width to the chat (a CSS
// max-width, so it costs no JavaScript per frame while the window is
// resized) and only then does the layout fold to one pane.
//
// MSG_LAYOUT mirrors the current mode for the non-React measuring code
// (the ghost-anchor tracker and the row FLIP bookkeeping), which stands
// down while its subject is hidden instead of measuring it every frame.
const MSG_LAYOUT = { single: false, listHidden: false };
// The size the page should treat as "the window". Normally the viewport;
// during an oversized edge drag (BotCommand.html, OVERSIZED DRAG) the
// WebView is monitor-sized and this is the part actually on screen.
// A function declaration so it's usable anywhere in this file.
function bcViewport() {
  try {
    if (window.BC_LIVE_RESIZE && typeof window.BC_LIVE_RESIZE.viewport === 'function') {
      return window.BC_LIVE_RESIZE.viewport();
    }
  } catch (_) {}
  return { w: window.innerWidth || 1, h: window.innerHeight || 1 };
}
// The contact list's width when you haven't sized it: ~28% of the window.
function bcAutoListW() {
  const w = bcViewport().w || 1280;
  return Math.round(Math.max(300, Math.min(400, w * 0.28)));
}
const PANE_CHAT_MIN_W = 400;   // narrowest chat column beside the list
const PANE_LIST_MIN_W = 260;   // narrowest full-row list before folding
const PANE_RAIL_BELOW = 110;   // same as MsgList's COLLAPSED_THRESHOLD
// Width the inbox needs to show list + chat side by side, for a given
// saved list width. The avatar rail keeps its own width (64).
const paneSplitMinWidth = (panelW) =>
  (panelW < PANE_RAIL_BELOW ? panelW : Math.min(panelW, PANE_LIST_MIN_W)) + PANE_CHAT_MIN_W;
// Moving between the list and a chat in one-pane mode is a short
// shared-axis slide: the outgoing pane fades out quickly, then the
// incoming one slides in from the side it lives on. Transform and opacity
// only, so it runs on the compositor even while the chat is still
// mounting on the main thread.
const PANE_IN_MS    = 300;
const PANE_OUT_MS   = 110;
const PANE_SHIFT_PX = 32;
const paneMotionOK = () => {
  try {
    if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return false;
    if (document.documentElement.getAttribute('data-motion') === 'reduced') return false;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch (_) {}
  return true;
};
// [data-pane-snap]: set for the one frame in which the layout folds or
//   unfolds, so the list's own width / rail transitions don't replay the
//   switch as an animation — a layout change lands; only navigation moves.
// [data-pane-leaving]: keeps the outgoing pane painted for its fade-out
//   (its React style already says hidden, which is where it ends up).
//
// How a pane steps aside (PANE_HIDDEN). visibility alone is not enough:
// it is inherited, and plenty of blocks inside both panes set their own
// `visibility: visible` (the list's folds, the dashboard wrapper), which
// would show straight through a hidden parent. content-visibility:hidden
// skips the whole subtree — nothing in it paints, lays out or takes a
// click — while keeping its rendering state, so the list comes back at
// the scroll position it was left at, and quickly. visibility:hidden on
// the pane itself hides its own glass box; pointer-events is belt and
// braces.
const PANE_HIDDEN = { visibility: 'hidden', contentVisibility: 'hidden', pointerEvents: 'none' };
const ensurePaneStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-pane-style')) return;
  const st = document.createElement('style');
  st.id = 'bc-pane-style';
  st.textContent = `
[data-pane-snap="1"], [data-pane-snap="1"] * { transition: none !important; }
[data-pane-leaving="1"] { visibility: visible !important; content-visibility: visible !important; }`;
  document.head.appendChild(st);
};
// Contact list <-> avatar rail. Every moving part of the collapse (panel
// width, row padding, the search header, section headers, the rail gear)
// uses this one duration and curve, so they move as one piece instead of
// several animations finishing at different moments. The curve starts
// quickly and settles long and soft — the part the eye reads as smooth.
const RAIL_MS   = 280;
const RAIL_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
// A block that folds to nothing and back without ever being unmounted:
// grid rows 0fr <-> 1fr animates to the block's own natural height, so
// nothing needs measuring and nothing below it jumps.
const railFold = (open, extra = {}) => ({
  display: 'grid',
  gridTemplateRows: open ? '1fr' : '0fr',
  opacity: open ? 1 : 0,
  transition: `grid-template-rows ${RAIL_MS}ms ${RAIL_EASE}, opacity ${open ? 200 : 120}ms ease ${open ? 80 : 0}ms, visibility 0s linear ${open ? 0 : RAIL_MS}ms`,
  visibility: open ? 'visible' : 'hidden',
  ...extra,
});
const RAIL_FOLD_INNER = { overflow: 'hidden', minHeight: 0 };

// ── CHAT DURING A PANEL RESIZE ───────────────────────────────────────
// Outside a chat, the space beside the contact panel is fixed-position
// dashboard layers, so resizing the panel moves almost nothing. Inside a
// chat, every frame of the resize used to re-lay-out and repaint the whole
// conversation: the thread scroller changed width, which re-rasterised its
// edge-fade mask and everything under it (bubbles, shadows, every picture,
// downscaled again), and on narrower windows the message column re-wrapped,
// firing the caption and pin-to-bottom observers along the way.
//
// While the panel is moving (a drag, a snap or a double-click collapse):
//   • the message column is held at its width. It only ever gets NARROWER
//     mid-motion, and only when the room it will have demands it, so text
//     re-wraps at most once instead of every frame (usually not at all —
//     the column is capped at the chat-width setting);
//   • the column is lifted onto its own compositor layer, so re-centring it
//     is a GPU move, not a repaint of every bubble and picture;
//   • the 18px edge fades on the thread are dropped for the duration — the
//     mask is what forced the full re-raster — and come back on release.
// Released, everything returns to plain CSS and settles in one layout pass.
const CHAT_PANEL_MOTION = {
  active: false,
  root: null,
  locks: [],
  panelStart: 0,
  seq: 0,          // bumped by every begin(), so a stale end() can stand down
  // Window-resize mode (beginWindow): same hold, but the room the chat
  // gets is driven by the window's width instead of the panel's.
  byWindow: false,
  winStart: 0,
  ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById('bc-panel-motion-style')) return;
    const s = document.createElement('style');
    s.id = 'bc-panel-motion-style';
    s.textContent = `
[data-panel-motion="1"] .ipc-thread,
[data-panel-motion="1"] .cwin-thread { -webkit-mask-image: none !important; mask-image: none !important; }
[data-panel-motion="1"] .ipc-body { will-change: transform; }`;
    document.head.appendChild(s);
  },
  // root: the [data-msgpane] element. panelNow: the panel's current width.
  // panelTarget (optional): where it is heading, when that's known.
  begin(root, panelNow, panelTarget) {
    if (!root) return;
    this.seq++;
    if (!this.active) {
      const threads = root.querySelectorAll('.ipc-thread');
      if (!threads.length) return;          // no chat open — nothing to hold
      this.ensureStyles();
      this.locks = [];
      // One read pass, then one write pass — no layout interleaving.
      threads.forEach(t => {
        const body = t.querySelector(':scope > .ipc-body');
        if (!body) return;
        const cs = getComputedStyle(t);
        const avail = t.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        this.locks.push({
          t, body, avail,
          width: body.getBoundingClientRect().width,
          prevWidth: body.style.width, prevMax: body.style.maxWidth,
        });
      });
      this.locks.forEach(l => { l.body.style.width = `${Math.floor(l.width)}px`; l.body.style.maxWidth = 'none'; });
      this.root = root;
      this.panelStart = panelNow;
      this.active = true;
      root.setAttribute('data-panel-motion', '1');
    }
    if (panelTarget != null) this.update(panelTarget);
  },
  // The panel is about to be `panelW` wide. A held column that wouldn't fit
  // the room it will have steps down to fit; it never grows mid-motion.
  update(panelW) {
    if (!this.active) return;
    const delta = this.panelStart - panelW;   // + when the chat gets wider
    this.locks.forEach(l => {
      const room = Math.floor(l.avail + delta);
      if (room > 0 && room < l.width) {
        l.width = room;
        l.body.style.width = `${room}px`;
      }
    });
  },
  // The window is being resized by its edge. A column that re-wraps on
  // every step is the single most expensive thing in a chat — every
  // bubble, caption and picture re-measured and redrawn per frame — so it
  // is held exactly as for a panel drag and settles once at the end.
  // Returns false (and holds nothing) if no chat is open or a panel drag
  // already owns the hold.
  beginWindow(root) {
    if (this.active || !root) return false;
    this.begin(root, 0);
    if (!this.active) return false;
    this.byWindow = true;
    this.winStart = bcViewport().w;
    return true;
  },
  // Per resize step. The chat gains or loses what the window does, less
  // the change in the thread's side padding (--thread-pad-x follows the
  // window width), so a held column is never wider than its room.
  updateWindow() {
    if (!this.active || !this.byWindow) return;
    const pad = (w) => Math.min(64, Math.max(16, w * 0.04));
    const w = bcViewport().w || this.winStart;
    // During an oversized drag the page holds the padding still.
    const held = document.documentElement.hasAttribute('data-host-oversize');
    const gain = (w - this.winStart) - (held ? 0 : 2 * (pad(w) - pad(this.winStart)));
    this.update(this.panelStart - gain);
  },
  end() {
    if (!this.active) return;
    this.byWindow = false;
    this.locks.forEach(l => { l.body.style.width = l.prevWidth; l.body.style.maxWidth = l.prevMax; });
    this.locks = [];
    if (this.root) this.root.removeAttribute('data-panel-motion');
    this.root = null;
    this.active = false;
  },
};

const FLIP_MIN_MS = 340;
const FLIP_MAX_MS = 620;
// Long, soft decel with no bounce — the curve iOS uses for sheet motion.
// Overshoot reads as "springy/toy" on stacked rows of text; this reads as
// weight, which is the feel we're after.
const FLIP_EASE   = 'cubic-bezier(0.32, 0.72, 0, 1)';

const useFlipReorder = (scrollRef, orderSig, layoutSig) => {
  const nodes     = React.useRef(new Map());  // id → row element
  const refCbs    = React.useRef(new Map());  // id → stable ref callback
  const prevY     = React.useRef(new Map());  // id → content-space top
  const running   = React.useRef(new Map());  // id → in-flight Animation
  const primed    = React.useRef(false);
  const lastW     = React.useRef(0);
  const lastLayout= React.useRef(layoutSig);

  // One stable callback per id. Returning a fresh arrow from register()
  // would make React detach/reattach every row's ref on every render.
  const register = React.useCallback((id) => {
    let cb = refCbs.current.get(id);
    if (!cb) {
      cb = (el) => { if (el) nodes.current.set(id, el); else nodes.current.delete(id); };
      refCbs.current.set(id, cb);
    }
    return cb;
  }, []);

  // Re-record positions without animating. Used when something that isn't
  // a reorder changes the geometry (window resize), so the next genuine
  // reorder measures against a truthful baseline instead of replaying a
  // resize as if every row had moved on its own.
  const resync = React.useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    // Mid-drag the width is still moving, so a reading taken now is stale
    // before it is stored. The drag end calls this once, which is the only
    // reading that was ever going to be true.
    if (PANEL_RESIZE.active) return;
    // Hidden behind a full-width chat (one-pane mode): its width follows
    // the window, but nobody can see it. Showing it again re-reads it.
    if (MSG_LAYOUT.listHidden) return;
    const bRect = box.getBoundingClientRect();
    const originY = bRect.top - box.scrollTop;
    const next = new Map();
    nodes.current.forEach((el, id) => next.set(id, el.getBoundingClientRect().top - originY));
    prevY.current = next;
    lastW.current = bRect.width;
  }, [scrollRef]);

  React.useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const ro = new ResizeObserver(resync);
    ro.observe(box);
    // The observer fires during a panel drag too, but resync() stands down
    // for the duration (see above), so the last size change of the drag is
    // one it deliberately ignored. Without a reading afterwards the stored
    // baseline stays at the pre-drag width and the first genuine reorder
    // after a resize reads every row as having moved. This is that reading.
    window.addEventListener('bcw:panel-resize-end', resync);
    return () => {
      ro.disconnect();
      window.removeEventListener('bcw:panel-resize-end', resync);
    };
  }, [resync, scrollRef]);

  React.useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;

    // A resize drag changes layoutSig on every frame, and this pass is the
    // expensive one: a forced layout plus a getBoundingClientRect() per
    // visible row, inside the commit. It would be thrown away anyway — a
    // width change always sets `skip` below — so it is skipped outright
    // while the drag runs. lastLayout is still advanced so the first real
    // reorder after the drag doesn't mistake the resize for movement, and
    // the drag end resyncs the baseline positions.
    if (PANEL_RESIZE.active) { lastLayout.current = layoutSig; return; }
    // Same while the list is hidden behind a one-pane chat: no one can
    // see a reorder, and the list is re-measured when it comes back.
    if (MSG_LAYOUT.listHidden) { lastLayout.current = layoutSig; return; }

    const reduce = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Stop anything still travelling and remember how far it had got.
    // getBoundingClientRect() reports the *transformed* box, so measuring
    // while an animation runs would capture a position the row is only
    // passing through — and the error would compound on the next update.
    // Carrying the offset forward instead lets a row that's interrupted
    // mid-flight continue from where it visually is, with no snap.
    const carry = new Map();
    running.current.forEach((anim, id) => {
      const el = nodes.current.get(id);
      if (el) {
        const t = window.getComputedStyle(el).transform;
        if (t && t !== 'none') {
          try {
            const m = new DOMMatrixReadOnly(t);
            if (m.m42) carry.set(id, m.m42);
          } catch (_) {}
        }
      }
      anim.cancel();
    });
    running.current.clear();

    // Content-space coordinates, not viewport ones. Subtracting the
    // container's origin and adding back its scroll offset means the
    // operator scrolling between two updates doesn't read as every row
    // having moved by the scroll distance.
    const bRect   = box.getBoundingClientRect();
    const originY = bRect.top - box.scrollTop;
    const next    = new Map();
    nodes.current.forEach((el, id) => next.set(id, el.getBoundingClientRect().top - originY));

    const widthChanged  = Math.abs(bRect.width - lastW.current) > 0.5;
    const layoutChanged = layoutSig !== lastLayout.current;
    lastW.current      = bRect.width;
    lastLayout.current = layoutSig;

    // Cases where motion would be wrong rather than missing:
    //   • first paint — the entire inbox would fly in on load
    //   • a panel resize or section fold — that's the operator moving the
    //     furniture, not a message arriving; rows should just be there
    //   • reduced-motion — honour the OS setting
    const skip = !primed.current || reduce || widthChanged || layoutChanged;
    primed.current = true;

    if (!skip) {
      next.forEach((nowY, id) => {
        const el = nodes.current.get(id);
        if (!el) return;
        const wasY = prevY.current.get(id);

        // No previous position = this conversation is new to the list.
        //
        // Choreographed in three layers rather than one fade of the whole
        // row, which is what made it feel like a repaint:
        //   1. the row settles down into its slot (short travel, long soft
        //      decel) a beat after the rows below have started making room;
        //   2. the avatar blooms in from a slightly smaller, softened state
        //      with a barely-there settle — this is the whole entrance in
        //      the collapsed rail, where the avatar is all there is;
        //   3. the name and preview slide in after it, so the eye lands on
        //      the face first and reads the text second.
        // A faint accent wash then fades off the row, so a new arrival is
        // noticed without anything flashing. Everything is transform /
        // opacity except the wash, which is a single row for ~1s.
        if (wasY == null) {
          const ENTER_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
          const anim = el.animate([
            {opacity:0, transform:'translate3d(0,-6px,0)'},
            {opacity:1, transform:'translate3d(0,0,0)'},
          ], {duration:560, delay:70, easing:ENTER_EASE, fill:'backwards'});
          running.current.set(id, anim);
          anim.finished.then(()=>{ if (running.current.get(id)===anim) running.current.delete(id); }, ()=>{});

          const ava = el.querySelector('.bc-crow-ava');
          if (ava) {
            ava.animate([
              {opacity:0, transform:'scale(0.72)', filter:'blur(2.5px)'},
              {opacity:1, transform:'scale(1.025)', filter:'blur(0px)', offset:0.62},
              {opacity:1, transform:'scale(1)',     filter:'blur(0px)'},
            ], {duration:680, delay:90, easing:ENTER_EASE, fill:'backwards'});
          }
          const txt = el.querySelector('.bc-crow-txt');
          if (txt) {
            txt.animate([
              {opacity:0, transform:'translate3d(-8px,0,0)'},
              {opacity:1, transform:'translate3d(0,0,0)'},
            ], {duration:520, delay:170, easing:ENTER_EASE, fill:'backwards'});
          }
          el.animate([
            {boxShadow:'inset 0 0 0 100vmax rgba(var(--acc-rgb, 108,99,255), 0.10)'},
            {boxShadow:'inset 0 0 0 100vmax rgba(var(--acc-rgb, 108,99,255), 0)'},
          ], {duration:1300, delay:260, easing:'cubic-bezier(0.4,0,0.2,1)', fill:'backwards'});
          return;
        }

        const dy = (wasY + (carry.get(id) || 0)) - nowY;
        if (Math.abs(dy) < 1) return;   // sub-pixel drift, not a reorder

        const dist = Math.abs(dy);
        // Longer trips take longer, but sub-linearly and within bounds —
        // a row crossing the whole panel shouldn't feel slow, and a
        // one-place nudge shouldn't be over before it registers.
        const dur  = Math.max(FLIP_MIN_MS, Math.min(FLIP_MAX_MS, 300 + dist * 0.55));

        // Depth cue: rows making a long trip lift fractionally off the
        // surface as they travel, which is what makes the movement read
        // as deliberate rather than as a repaint. Short hops stay pure
        // translate — scaling text a row or two is just blur for nothing.
        const lift  = dist > 60 ? Math.min(1.012, 1 + dist * 0.00004) : 1;
        const frames = lift > 1
          ? [
              {transform:`translate3d(0,${dy}px,0) scale(1)`,             offset:0},
              {transform:`translate3d(0,${dy*0.38}px,0) scale(${lift})`,  offset:0.42},
              {transform:'translate3d(0,0,0) scale(1)',                   offset:1},
            ]
          : [
              {transform:`translate3d(0,${dy}px,0)`},
              {transform:'translate3d(0,0,0)'},
            ];

        // Travelling rows paint above their neighbours so the lift doesn't
        // slide under an adjacent row's hairline border.
        el.style.zIndex     = '2';
        el.style.willChange = 'transform';
        const anim = el.animate(frames, {duration:dur, easing:FLIP_EASE});
        running.current.set(id, anim);
        const settle = () => {
          if (running.current.get(id) === anim) running.current.delete(id);
          el.style.zIndex = '';
          el.style.willChange = '';
        };
        anim.finished.then(settle, settle);
      });
    }

    prevY.current = next;
  }, [orderSig, layoutSig, scrollRef]);

  return register;
};

// ── TYPING IN THE CONTACT LIST ─────────────────────────────────────
// Only a REAL "user is typing" report from the platform bridge counts
// (INBOUND_TRACKER.onUserTyping) — never the engine's guess from message
// tempo — so the indicator appears only for chats that can actually report
// typing, and never claims someone is typing when they aren't.
//
// It ends at whichever comes first:
//   • the platform's typing window lapses (the bridge re-reports every few
//     seconds while they keep typing, which keeps it alive);
//   • their message lands — an inbound newer than the latest typing report
//     means they finished, so the preview comes straight back with the new
//     message instead of the dots lingering on top of it.
// One subscription per row; each row only redraws for its own chat.
// What the platform says they are doing, as the contact list words it.
const TYPING_LABEL = {
  typing: 'typing', record_voice: 'recording voice', upload_voice: 'sending voice',
  upload_photo: 'sending photo', record_video: 'recording video', upload_video: 'sending video',
  record_round: 'recording video', upload_round: 'sending video', upload_document: 'sending file',
  choose_sticker: 'choosing sticker', choose_contact: 'choosing contact', geo: 'sharing location',
};
// Who is typing in a conversation, and what the contact list should say.
//   { who: 'contact' | 'agent' | '', label }
// The contact wins when both are: that is the one the operator can act on,
// and the engine holds its own send while the customer types anyway.
const TYPING_NONE = { who: '', label: '' };
const convTyping = (convId) => {
  try {
    if (typeof INBOUND_TRACKER === 'undefined' || !INBOUND_TRACKER.state) return TYPING_NONE;
    const st = INBOUND_TRACKER.state.get(convId);
    if (!st) return TYPING_NONE;
    const now = Date.now();
    let contact = '';
    if (st.typingUntil > now && !(st.typingAt && st.last && st.last >= st.typingAt)
        && !(st.typingAction && /cancel/i.test(st.typingAction))) {
      contact = TYPING_LABEL[st.typingAction] || 'typing';
    }
    if (contact) return { who: 'contact', label: contact };
    if (st.agentTypingUntil > now) return { who: 'agent', label: 'typing' };
    return TYPING_NONE;
  } catch (_) { return TYPING_NONE; }
};
// Kept for any caller that only wants the contact's label.
const convTypingLabel = (convId) => { const t = convTyping(convId); return t.who === 'contact' ? t.label : ''; };
const useConvTyping = (convId) => {
  const [state, setState] = React.useState(() => convTyping(convId));
  React.useEffect(() => {
    if (!convId || typeof INBOUND_TRACKER === 'undefined' || !INBOUND_TRACKER.sub) return;
    let timer = null;
    const sync = () => {
      const t = convTyping(convId);
      setState(prev => (prev.who === t.who && prev.label === t.label) ? prev : t);
      clearTimeout(timer);
      // Nothing is notified when a window simply runs out, so the row
      // checks again itself just after the soonest one does.
      if (t.who) {
        let until = 0;
        try {
          const st = INBOUND_TRACKER.state.get(convId) || {};
          const ends = [st.typingUntil, st.agentTypingUntil].filter(x => x > Date.now());
          until = ends.length ? Math.min(...ends) : 0;
        } catch (_) {}
        timer = setTimeout(sync, Math.max(50, until - Date.now() + 40));
      }
    };
    sync();
    const unsub = INBOUND_TRACKER.sub((cid) => { if (cid === convId) sync(); });
    return () => { clearTimeout(timer); if (typeof unsub === 'function') unsub(); };
  }, [convId]);
  return state;
};

// The agent's mark: a small four-point spark, the same glyph family the app
// uses for AI elsewhere. It replaces nothing — it sits in front of the same
// dots, so "someone is typing" reads identically and the spark alone says
// which side.
const AgentTypingGlyph = ({size = 9}) => (
  <svg className="bc-typing-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.5c.5 4.6 2.4 6.6 7 7.2v.6c-4.6.6-6.5 2.6-7 7.2h-.6c-.5-4.6-2.4-6.6-7-7.2v-.6c4.6-.6 6.5-2.6 7-7.2z" fill="currentColor"/>
  </svg>
);

// Everything the contact list paints on hover or while someone types lives
// in one injected stylesheet. Two reasons it's CSS rather than inline:
//   • Hover. Rows used to write their background from onMouseEnter /
//     onMouseLeave and ease it over 100ms, so sweeping the pointer down the
//     list left a trail of rows still fading behind it — the "sticky" feel.
//     :hover is resolved by the browser in the same frame the pointer moves,
//     comes on instantly, and only the release gets a short fade.
//   • Typing. The dots animate transform/opacity only, so they run on the
//     compositor and never repaint the row (or the blurred panel under it).
const ensureTypingStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-typing-style')) return;
  const st = document.createElement('style');
  st.id = 'bc-typing-style';
  st.textContent = `
.bc-crow { background-color: transparent; padding: 9px 14px 9px 12px;
  transition-property: background-color, padding;
  transition-duration: 70ms, ${RAIL_MS}ms;
  transition-timing-function: ease-out, ${RAIL_EASE}; }
/* Rail <-> full list. The text block is never unmounted: it fades out
   quickly as the panel starts to narrow (so nothing is seen being cut in
   half) and fades back in a beat after the panel starts to widen (so it
   appears into room that is already opening). Opacity only — composited,
   no layout. */
.bc-crow-txt { opacity: 1; transition: opacity 200ms ease 90ms; }
/* Rail styling hangs off the PANEL's data-collapsed, not a prop on every
   row: crossing into the rail then re-renders no rows at all — the whole
   switch is one attribute and a handful of CSS transitions. */
[data-collapsed="1"] .bc-crow { padding-left: 9px; }
[data-collapsed="1"] .bc-crow-txt { opacity: 0; pointer-events: none; transition: opacity 110ms ease 0ms; }
[data-collapsed="0"] .bc-rail-only { display: none !important; }
.bc-crow[data-esc="1"] { background-color: rgba(168,82,96,0.05); }
.bc-cgrp { background-color: transparent; transition: background-color 70ms ease-out; }
@media (hover: hover) {
  .bc-crow:hover { background-color: rgba(255,255,255,0.035); transition-duration: 0s, ${RAIL_MS}ms; }
  .bc-crow[data-esc="1"]:hover { background-color: rgba(168,82,96,0.09); }
  .bc-cgrp:hover { background-color: rgba(255,255,255,0.03); transition-duration: 0s; }
}
.bc-crow[data-active="1"], .bc-crow[data-active="1"]:hover { background-color: rgba(150,148,200,0.13); }
/* Phones and tablets: roomier rows, a slightly larger avatar and text. */
@media (pointer: coarse), (max-width: 640px) {
  [data-collapsed="0"] .bc-crow { padding: 13px 18px 13px 16px; gap: 14px !important; }
  [data-collapsed="0"] .bc-crow-ava { transform: scale(1.12); transform-origin: left center; margin-right: 5px; }
  .bc-crow-name { font-size: 15px !important; }
  .bc-crow-txt .bc-cprev { font-size: 13.5px !important; }
}

/* ── Avatar status marks ───────────────────────────────────────
   Quiet by default. Status is carried by small, desaturated marks seated
   on the avatar's rim with a cut-out ring in the panel colour, so they
   read as part of the avatar, not stickers on top of it.
     escalated → a 9px muted-rose dot, bottom-right, plus a hairline ring
     customer  → an 11px sage disc with a fine tick, bottom-right
     unread    → a small glass pill, top-right (rail) / after the preview */
.bc-ava-badge { position: absolute; z-index: 2; border-radius: 50%; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 0 2px rgba(15,16,26,0.96); }
.bc-ava-badge[data-kind="esc"] { width: 9px; height: 9px; right: 2px; bottom: 2px;
  background: #c77a86; }
.bc-ava-badge[data-kind="cust"] { width: 11px; height: 11px; right: 1px; bottom: 1px;
  color: rgba(236,248,240,0.95); background: #4f9c78; }
.bc-ava-badge svg { display: block; }

/* Escalation ring: one hairline just off the avatar, low contrast,
   breathing slowly on opacity only. */
.bc-ava-ring { position: absolute; inset: -3px; border-radius: 50%; pointer-events: none;
  border: 1px solid rgba(206,132,144,0.5);
  animation: bc-esc-breathe 4s cubic-bezier(0.45,0,0.55,1) infinite; }
@keyframes bc-esc-breathe { 0%, 100% { opacity: .35; } 50% { opacity: .85; } }
.bc-crow[data-active="1"] .bc-ava-ring { animation: none; opacity: .6; }

/* Unread count. Neutral glass with the accent in the numeral only, so a
   column of unread chats reads as information, not alarm. Tabular digits
   keep the pill from twitching as the count changes; each change replays
   a short settle (see key={unread}). */
.bc-unread { flex-shrink: 0; box-sizing: border-box;
  min-width: 16px; height: 16px; padding: 0 5px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 9.5px; font-weight: 600; line-height: 1; letter-spacing: 0;
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--acc, #6c63ff) 45%, #eceaf6);
  background: rgba(var(--acc-rgb, 108,99,255), 0.14);
  box-shadow: inset 0 0 0 0.5px rgba(var(--acc-rgb, 108,99,255), 0.32);
  animation: bc-unread-in 420ms cubic-bezier(0.22,1,0.36,1) both; }
.bc-unread[data-esc="1"] { color: #e7c3c9; background: rgba(199,122,134,0.14);
  box-shadow: inset 0 0 0 0.5px rgba(199,122,134,0.34); }
.bc-unread-rail { position: absolute; top: -2px; right: -4px; z-index: 2;
  min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px; font-size: 8.5px;
  background: rgba(34,35,54,0.96);
  box-shadow: 0 0 0 2px rgba(15,16,26,0.96), inset 0 0 0 0.5px rgba(var(--acc-rgb, 108,99,255), 0.40);
  transform-origin: 30% 70%; }
.bc-unread-rail[data-esc="1"] { background: rgba(46,32,40,0.96);
  box-shadow: 0 0 0 2px rgba(15,16,26,0.96), inset 0 0 0 0.5px rgba(199,122,134,0.42); }
@keyframes bc-unread-in {
  0%   { opacity: 0; transform: scale(0.55); }
  60%  { opacity: 1; transform: scale(1.06); }
  100% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .bc-ava-ring { animation: none; opacity: .6; }
  .bc-unread { animation: none; }
}

.bc-cprev-last { grid-area: 1 / 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: opacity .2s ease, transform .3s cubic-bezier(0.22,1,0.36,1); }
.bc-cprev[data-typing="1"] .bc-cprev-last { opacity: 0; transform: translateY(-3px); }

/* The label is a soft tint of the accent, the dots carry it at full
   strength — the colour says "live" without the line shouting. */
.bc-typing { grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden;
  color: rgba(var(--acc-rgb, 108,99,255), 0.9);
  color: color-mix(in srgb, var(--acc, #6c63ff) 55%, #ecebf5);
  font-weight: 500; letter-spacing: -0.003em;
  opacity: 0; transform: translateY(3px);
  transition: opacity .2s ease, transform .3s cubic-bezier(0.22,1,0.36,1); }
.bc-cprev[data-typing="1"] .bc-typing { opacity: 1; transform: none; transition-delay: .04s; }
.bc-typing-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.bc-typing-dots { display: inline-flex; align-items: center; gap: 2.5px; flex-shrink: 0; height: 1em;
  /* Centre on the lowercase x-height, not the line box, so the dots sit
     level with the word beside them rather than a hair above it. */
  transform: translateY(0.5px);
  color: rgb(var(--acc-rgb, 108,99,255));
  color: color-mix(in srgb, var(--acc, #6c63ff) 82%, #ffffff); }
.bc-typing-dots i { display: block; width: 3px; height: 3px; border-radius: 50%; background: currentColor;
  opacity: .28; transform: scale(.82);
  animation: bcTypingWave 1.5s cubic-bezier(0.45,0,0.55,1) infinite;
  animation-play-state: paused; }
.bc-typing-dots i:nth-child(2) { animation-delay: .2s; }
.bc-typing-dots i:nth-child(3) { animation-delay: .4s; }
/* Only rows that are actually typing spend frames on the wave. */
.bc-cprev[data-typing="1"] .bc-typing-dots i,
.bc-typing-badge[data-on="1"] i { animation-play-state: running; }
@keyframes bcTypingWave {
  0%, 64%, 100% { opacity: .28; transform: translateY(0) scale(.82); }
  30%           { opacity: 1;   transform: translateY(-1.5px) scale(1); }
}

/* Avatar rail: there's no preview line to take over, so a small pill
   tucks under the avatar's lower-left edge instead. */
.bc-typing-badge { position: absolute; left: -3px; bottom: -2px; height: 12px; padding: 0 4px;
  display: inline-flex; align-items: center; gap: 2px; border-radius: 6px; pointer-events: none;
  background: rgba(18,19,30,0.96);
  box-shadow: 0 0 0 1.5px rgba(14,15,22,0.95), inset 0 0 0 0.5px rgba(var(--acc-rgb, 108,99,255), 0.35);
  color: rgb(var(--acc-rgb, 108,99,255));
  color: color-mix(in srgb, var(--acc, #6c63ff) 82%, #ffffff);
  opacity: 0; transform: scale(.6); transform-origin: 25% 75%;
  transition: opacity .18s ease, transform .3s cubic-bezier(0.34,1.36,0.64,1); }
.bc-typing-badge[data-on="1"] { opacity: 1; transform: none; }
.bc-typing-badge i { display: block; width: 2.5px; height: 2.5px; border-radius: 50%; background: currentColor;
  opacity: .28; transform: scale(.82);
  animation: bcTypingWave 1.5s cubic-bezier(0.45,0,0.55,1) infinite; animation-play-state: paused; }
.bc-typing-badge i:nth-child(2) { animation-delay: .2s; }
.bc-typing-badge i:nth-child(3) { animation-delay: .4s; }

/* The agent typing. Same dots, same motion, same line — the spark in
   front is what says which side it is, so it is sized and lit to be seen:
   11px, a bright cyan with a faint glow, against the contact's plain
   accent dots. */
.bc-typing-glyph { flex-shrink: 0; display: block; color: #9fe0ff;
  filter: drop-shadow(0 0 3px rgba(120,205,255,0.55)); }
.bc-cprev[data-who="agent"] .bc-typing { gap: 5px; color: rgba(170,215,238,0.9); font-weight: 500; }
.bc-cprev[data-who="agent"] .bc-typing-dots { color: #8fd6f5; }
.bc-typing-badge[data-who="agent"] { gap: 1.5px; padding: 0 4px 0 3px;
  color: #8fd6f5;
  box-shadow: 0 0 0 1.5px rgba(14,15,22,0.95), inset 0 0 0 0.5px rgba(120,205,245,0.45); }
.bc-typing-badge .bc-typing-glyph { margin-right: 1px; filter: none; }

@media (prefers-reduced-motion: reduce) {
  .bc-typing-dots i, .bc-typing-badge i { animation-name: bcTypingCalm; transform: none; }
  .bc-cprev-last, .bc-typing, .bc-typing-badge { transform: none !important; }
  @keyframes bcTypingCalm { 0%, 64%, 100% { opacity: .3; } 30% { opacity: .95; } }
}`;
  document.head.appendChild(st);
};

// The preview line: the last message, or — while they type — the typing
// indicator. Both sit in the same grid cell and cross-fade, so the row never
// changes height or reflows and the switch reads as one line changing its
// mind rather than as content jumping. The dots stay mounted through the
// fade-out (they used to vanish on the first frame, which pulled the label
// sideways while it was still visible) and simply stop animating.
const ContactPreview = ({last, typing, unread}) => {
  // Keep the last label and side while the indicator fades out, so the
  // words and the spark don't vanish a frame before the fade does.
  const heldRef = React.useRef({ who: 'contact', label: 'typing' });
  const on = !!(typing && typing.who);
  if (on) heldRef.current = typing;
  const held = heldRef.current;
  return (
    <span className="bc-cprev" data-typing={on ? '1' : '0'} data-who={held.who}
      style={{display:'grid', flex:1, minWidth:0, fontSize:11.5}}>
      <span className="bc-cprev-last" aria-hidden={on ? 'true' : undefined} style={{
        color: unread>0 ? 'var(--t2)' : 'var(--t3)', fontWeight: unread>0 ? 500 : 400}}><BcPreviewText text={last}/></span>
      <span className="bc-typing" aria-hidden={on ? undefined : 'true'}
        aria-label={on ? (held.who === 'agent' ? 'Agent is typing' : `Contact is ${held.label}`) : undefined}>
        {held.who === 'agent' && <AgentTypingGlyph size={11}/>}
        <span className="bc-typing-dots" aria-hidden="true"><i/><i/><i/></span>
        <span className="bc-typing-label">{held.label}</span>
      </span>
    </span>
  );
};

// ── CONTACT ROW (memoized) ─────────────────────────────────────
// MsgList re-renders on every store notify — any message in any chat, AI
// status flips, typing. Each row used to rebuild its whole subtree (avatar,
// badges, previews) every time. Rows now redraw only when something they
// paint changed. Conversation objects are mutated in place by the store, so
// the comparison runs on the painted VALUES, never on object identity, and
// clicks resolve the live conversation from the store at click time.
// How long the pointer has to REST on a row (no movement) before its chat
// is warmed. It used to be 90ms from entering, which a slow sweep down the
// list cleared on nearly every row — each one fired two requests and, when
// they landed, a store notify that redrew the whole list mid-sweep. That
// was a large part of the list feeling heavy under the pointer. Passing
// over rows now costs nothing; stopping on one still gets it prefetched
// well before a click could land.
const CONTACT_PREFETCH_MS = 150;
const ContactRow = React.memo(function ContactRow({
  m, id, name, col, avatar, last, t, unread, stage, escalated,
  isActive, isCollapsed, lastInGroup, avaLoading, rowRef, onOpen,
}) {
  const mRef = React.useRef(m);
  mRef.current = m;
  const typing = useConvTyping(id);
  ensureTypingStyles();
  const resolve = () => {
    try {
      const live = MSGS_STORE.list.find(x => x && x.id === id);
      if (live) return live;
    } catch (_) {}
    return mRef.current;
  };
  // Intent prefetch: a pointer that rests on a row for a beat almost always
  // clicks it. History and the customer record start loading now, so the
  // chat opens already populated. Cheap when already cached (both calls
  // are idempotent and de-duplicated).
  const prefetchTimer = React.useRef(null);
  // Re-armed on every move, so it only fires once the pointer settles.
  const armPrefetch = () => {
    if (isActive) return;
    // Direct chats load from DM_STORE, not the platform history endpoint.
    if (mRef.current && mRef.current.__direct) {
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
      prefetchTimer.current = setTimeout(() => {
        prefetchTimer.current = null;
        try { DM_STORE.loadThread(mRef.current.threadId).catch(() => {}); } catch (_) {}
      }, CONTACT_PREFETCH_MS);
      return;
    }
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    prefetchTimer.current = setTimeout(() => {
      prefetchTimer.current = null;
      try { if (MSGS_STORE.prefetchThread) MSGS_STORE.prefetchThread(id); } catch (_) {}
      try { if (typeof prefetchEndUserRecord === 'function') prefetchEndUserRecord(id); } catch (_) {}
    }, CONTACT_PREFETCH_MS);
  };
  const disarmPrefetch = () => {
    if (prefetchTimer.current) { clearTimeout(prefetchTimer.current); prefetchTimer.current = null; }
  };
  React.useEffect(() => disarmPrefetch, []);   // no timer outlives the row
  // Right-click, or press and hold on a touch screen: the contact's menu.
  const openCtx = (e) => window.dispatchEvent(new CustomEvent('ctx', {detail: {e, msg: resolve()}}));
  const hold = (typeof useLongPress === 'function') ? useLongPress(openCtx) : null;

  const isCustomer = stage==='customer'||stage==='vip';
  const isEsc = !!(escalated || stage==='escalated' || stage==='needs_help');
  const isLastInGroup = lastInGroup;
  return (
      <button
        ref={rowRef}
        className="bc-crow"
        data-active={isActive ? '1' : '0'}
        data-esc={isEsc ? '1' : '0'}
        onClick={()=>onOpen(resolve())}
        onContextMenu={e=>{ e.preventDefault(); if (hold && hold.recent()) return; openCtx(e); }}
        {...(hold ? hold.handlers : null)}
        data-name={name}
        style={{
          width:'100%', position:'relative', display:'flex', alignItems:'center',
          // ONE GEOMETRY FOR BOTH MODES. The rail used to be a different
          // layout (no gap, 6px vertical padding, avatar centred), so the
          // moment the list crossed into it every row changed height and
          // every avatar jumped sideways — the glitch in the collapse. Now
          // the row keeps its height and its left-aligned avatar in both
          // modes; only the left padding eases 12px → 9px, which puts the
          // 42px avatar dead-centre in the 64px rail. The text block stays
          // mounted and simply fades, and the panel's overflow clips it.
          gap: 11,
          justifyContent: 'flex-start',
          overflow: 'hidden',
          textAlign:'left',
          // Background (rest, hover, active, escalated) comes from the
          // .bc-crow rules in ensureTypingStyles — see the note there.
          borderLeft: isActive ? '2px solid rgba(180,176,230,0.85)' : (isEsc ? '2px solid rgba(168,82,96,0.55)' : '2px solid transparent'),
          borderTop:'none', borderRight:'none',
          borderBottom: isLastInGroup ? 'none' : '1px solid rgba(255,255,255,0.035)',
          cursor:'pointer',
          // padding and gap are the only geometry that changes between the
          // full row and the avatar rail, and both are animatable — so the
          // avatar slides into its centred position over the same 180ms the
          // panel takes to narrow, instead of jumping there on frame one.
          // justify-content is not animatable, but at these two widths the
          // avatar's resting x differs by about a pixel, so it does not need
          // to be. Outside the collapse flip neither property ever changes,
          // so this costs nothing in normal use.
          // (The transition itself is in the .bc-crow rule, alongside the
          // hover background it has to be listed with.)
          boxSizing:'border-box',
        }}
        onMouseEnter={armPrefetch}
        onMouseMove={armPrefetch}
        onMouseLeave={disarmPrefetch}
        // The press itself starts the history fetch — the click lands a
        // beat later, and that beat is time the chat no longer waits.
        onPointerDown={() => {
          disarmPrefetch();
          if (mRef.current && mRef.current.__direct) return;
          try { if (MSGS_STORE.prefetchThread) MSGS_STORE.prefetchThread(id); } catch (_) {}
        }}>

        {/* Avatar — escalation pulse ring takes precedence over the
            customer tick when both apply, since "needs help" is
            higher-priority than "verified buyer". */}
        <div className="bc-crow-ava" data-esc={isEsc ? '1' : '0'}
          style={{position:'relative',flexShrink:0}}>
          {/* Escalation: a hairline ring set 2.5px off the avatar, breathing
              very slowly, instead of a pulsing blob. Drawn under the badge. */}
          {isEsc && <span className="bc-ava-ring" aria-hidden="true"/>}
          <Ava name={name} col={col} sz={42} src={avatar} loading={avaLoading}/>
          <span className="bc-typing-badge bc-rail-only" data-on={typing.who ? '1' : '0'}
            data-who={typing.who || 'contact'} aria-hidden="true">
            {typing.who === 'agent' && <AgentTypingGlyph size={8}/>}<i/><i/><i/></span>
          {/* Status badge, seated exactly on the avatar's rim at 45°, with a
              cut-out ring in the panel colour. Escalated outranks customer. */}
          {isEsc ? (
            <span className="bc-ava-badge" data-kind="esc" title="Escalated — needs help" aria-label="Escalated"/>
          ) : isCustomer ? (
            <span className="bc-ava-badge" data-kind="cust" title="Customer">
              <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9.5 16.5 4 11"/></svg>
            </span>
          ) : null}
          {/* Rail only: the unread count rides the avatar's top-right rim.
              Keyed on the count so a new message replays its settle. */}
          {unread > 0 && (
            <span key={unread} className="bc-unread bc-unread-rail bc-rail-only" data-esc={isEsc ? '1' : '0'}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </div>

        {/* Text block — kept mounted in the rail and faded out (see the
            [data-collapsed] rules), so collapsing never rebuilds rows. */}
        {<div className="bc-crow-txt" style={{flex:1,minWidth:0}}>
          {/* Name + time row */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3,gap:6}}>
            <div style={{display:'flex',alignItems:'center',gap:5,minWidth:0,flex:1}}>
              <span className="bc-crow-name" style={{
                fontSize:13, fontWeight: unread>0 ? 600 : 500,
                color: isActive ? '#fff' : 'var(--t1)',
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
              }}>{name}</span>
            </div>
            <span style={{
              fontSize:10, flexShrink:0,
              color: unread>0 ? 'rgba(108,99,255,0.7)' : 'var(--t4)',
              fontWeight: unread>0 ? 600 : 400,
            }}>{t}</span>
          </div>

          {/* Preview + unread row */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:5}}>
            <ContactPreview last={last} typing={typing} unread={unread}/>

            {unread>0&&(
              // Keyed on the count so each new message replays the small
              // settle animation: the number feels live, not repainted.
              <span key={unread} className="bc-unread" data-esc={isEsc ? '1' : '0'}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
        </div>}
      </button>
  );
}, (p, n) =>
  p.id === n.id && p.name === n.name && p.col === n.col && p.avatar === n.avatar
  && p.last === n.last && p.t === n.t && p.unread === n.unread && p.stage === n.stage
  && p.escalated === n.escalated && p.isActive === n.isActive
  && p.lastInGroup === n.lastInGroup && p.avaLoading === n.avaLoading
  && p.rowRef === n.rowRef && p.onOpen === n.onOpen);

// ── PEOPLE RESULT — find a BotCommand account by @username ──────────
// Typing "@name" (or a bare username) in the contact search looks up that
// exact account. Exact match only, on purpose: nobody can scroll through
// the user base by typing one letter at a time. Opening the result starts
// (or returns to) an end-to-end encrypted direct chat.
// ── People search result ─────────────────────────────────────────────
// Someone found by username in the contact list's search: a quiet row with
// their photo, name and @username, and a small "Message" action on the
// right. `note` is the list's own line ("No conversations match …"),
// shown only when no person is shown in its place.
let _dmPeopleCss = false;
const ensureDmPeopleStyles = () => {
  if (_dmPeopleCss || typeof document === 'undefined') return;
  _dmPeopleCss = true;
  const st = document.createElement('style');
  st.id = 'bc-dm-people-css';
  st.textContent = `
.dmpr-head{display:flex;align-items:center;gap:8px;padding:12px 14px 6px}
.dmpr-head span{font-size:10px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:rgba(160,164,184,.42)}
.dmpr-head i{flex:1;height:1px;background:rgba(255,255,255,.04)}
.dmpr-row{display:flex;align-items:center;gap:10px;width:calc(100% - 12px);margin:0 6px 4px;padding:7px 10px 7px 8px;
  box-sizing:border-box;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;
  transition:background-color .14s ease}
.dmpr-row:hover:not(:disabled){background:rgba(255,255,255,.03)}
.dmpr-row:disabled{cursor:default}
.dmpr-row:focus-visible{outline:none;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.18)}
.dmpr-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dmpr-name{font-size:12.5px;font-weight:500;letter-spacing:-.005em;color:rgba(238,238,245,.9);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmpr-user{font-size:11px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmpr-go{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--t3);opacity:.55;
  transition:opacity .14s ease,color .14s ease}
.dmpr-go svg{transition:transform .14s ease}
.dmpr-row:hover:not(:disabled) .dmpr-go,.dmpr-row:focus-visible .dmpr-go{opacity:1;color:var(--t2)}
.dmpr-row:hover:not(:disabled) .dmpr-go svg{transform:translateX(1px)}
.dmpr-go-t{opacity:0;transition:opacity .14s ease}
.dmpr-row:hover:not(:disabled) .dmpr-go-t,.dmpr-row:focus-visible .dmpr-go-t{opacity:1}
.dmpr-go[data-self="1"]{opacity:1}
.dmpr-note{padding:6px 16px 14px;font-size:11.5px;line-height:1.5;color:var(--t3)}
.dmpr-empty{padding:20px 16px;text-align:center;font-size:11.5px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dmpr-spin{width:10px;height:10px;border-radius:50%;border:1.5px solid rgba(255,255,255,.12);border-top-color:rgba(255,255,255,.45);
  animation:dmpr-spin .8s linear infinite;flex-shrink:0}
@keyframes dmpr-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dmpr-spin{animation-duration:2.4s}}
`;
  document.head.appendChild(st);
};
const DmPeopleResult = ({q, onOpen, isCollapsed, note = null}) => {
  ensureDmPeopleStyles();
  const raw = String(q || '').trim();
  const at = raw.startsWith('@');
  const name = raw.replace(/^@/, '');
  const valid = /^[A-Za-z0-9_.\-]{3,60}$/.test(name);
  const [res, setRes] = React.useState(null);     // { name, user, err }
  const [busy, setBusy] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  React.useEffect(() => {
    setRes(null);
    if (!valid || typeof DM_STORE === 'undefined') { setBusy(false); return; }
    setBusy(true);
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const r = await DM_STORE.lookup(name);
        if (!dead) setRes({ name, user: r.user, err: r.err || '' });
      } catch (e) { if (!dead) setRes({ name, user: null, err: String(e && e.message || e) }); }
      finally { if (!dead) setBusy(false); }
    }, 320);
    return () => { dead = true; clearTimeout(t); };
  }, [name, valid]);
  if (isCollapsed) return null;
  const noteEl = note ? <div className="dmpr-empty">{note}</div> : null;
  if (!valid) return noteEl;
  const settled = res && res.name === name;
  const u = settled ? res.user : null;
  // Bare words only show a person when there is one; "@…" always answers.
  if (!at && !u) return (busy || !settled) ? null : noteEl;

  const head = <div className="dmpr-head"><span>People</span><i/></div>;
  if (!settled) {
    return busy ? (
      <>{head}<div className="dmpr-note" style={{display:'flex', alignItems:'center', gap:8}}>
        <span className="dmpr-spin" aria-hidden="true"/>Looking up @{name}</div></>
    ) : null;
  }
  if (res.err) return <>{head}<div className="dmpr-note">{res.err}</div></>;
  if (!u) return <>{head}<div className="dmpr-note">No one found with @{name}</div></>;
  const display = u.display_name || u.username;
  const open = async () => {
    if (u.self || opening) return;
    setOpening(true);
    try { const conv = await DM_STORE.openWith(u); onOpen(conv); }
    catch (e) { bcToast(String(e && e.message || e), 'err'); }
    finally { setOpening(false); }
  };
  return (
    <>
      {head}
      <button type="button" className="dmpr-row" onClick={open} disabled={u.self}
        title={u.self ? 'That’s you' : `Message @${u.username}`}>
        <Ava name={display} col={dmColFor(u.username)} sz={32} src={u.avatar || undefined}/>
        <span className="dmpr-txt">
          <span className="dmpr-name">{display}</span>
          <span className="dmpr-user">@{u.username}</span>
        </span>
        {u.self ? (
          <span className="dmpr-go" data-self="1">You</span>
        ) : (
          <span className="dmpr-go" aria-hidden="true">
            {opening ? 'Opening…' : <span className="dmpr-go-t">Message</span>}
            {!opening && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>}
          </span>
        )}
      </button>
    </>
  );
};

const MsgList = ({openInPage, inPageChat, goBackInPage, chatHistory, onOpenSettings, tweaks: tweaksProp, setTweak: setTweakProp}) => {
  const liveMsgs = useMsgs(); // re-renders when store updates
  // Direct (encrypted) chats live in their own store and are only merged
  // in for the list itself — the engine, ghost and dashboard never see them.
  const dmStore = (typeof useDm === 'function') ? useDm() : null;
  const dmConvs = dmStore ? dmStore.convs : [];
  const [q,          setQ]         = React.useState('');
  // Folded sections. The section headers are the list's only control
  // surface now — the All / Active / Unread / Escalated chip row is gone,
  // since the grouping already says everything those filters did.
  const [foldedGroups, setFoldedGroups] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(GROUPS_LS_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  });
  const toggleGroup = React.useCallback((key) => {
    setFoldedGroups(prev => {
      const next = {...prev, [key]: !prev[key]};
      try { localStorage.setItem(GROUPS_LS_KEY, JSON.stringify(next)); } catch (_) {}
      return next;
    });
  }, []);
  const [, bumpFresh] = React.useReducer(x => x + 1, 0);
  // Persist panel width across reloads. Below COLLAPSED_THRESHOLD the list
  // collapses to an avatar-only rail, like Telegram's narrow mode.
  // Until you size it yourself (drag or double-click the edge) it follows
  // the window: about 28% of it, 300–400px. 320 was the old fixed default,
  // saved by every install, so a saved 320 counts as never chosen.
  const panelUserSized = React.useRef(false);
  const [panelW,     setPanelW]    = React.useState(() => {
    try {
      const v = parseInt(localStorage.getItem('bc.contactlist.w') || '', 10);
      const chosen = localStorage.getItem('bc.contactlist.wset') === '1' || v !== 320;
      if (Number.isFinite(v) && v >= 64 && v <= 520 && chosen) { panelUserSized.current = true; return v; }
    } catch(e) {}
    return bcAutoListW();
  });
  const markPanelSized = React.useCallback((on) => {
    panelUserSized.current = on;
    try { if (on) localStorage.setItem('bc.contactlist.wset', '1'); else localStorage.removeItem('bc.contactlist.wset'); } catch (_) {}
  }, []);
  React.useEffect(() => {
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (!panelUserSized.current && !PANEL_RESIZE.active) setPanelW(w => (w < 110 ? w : bcAutoListW())); });
    };
    window.addEventListener('resize', fit);
    return () => { window.removeEventListener('resize', fit); cancelAnimationFrame(raf); };
  }, []);
  // (The write itself is debounced further down, alongside the resize drag.)

  // ── One-pane layout (see MSG_LAYOUT) ──
  // `single` only changes when the window crosses the threshold, so a
  // window resize re-renders nothing here until it actually matters.
  // Seeded from the window width so the first paint is already right.
  const [single, setSingle] = React.useState(() => {
    try {
      const w = window.innerWidth || 0;
      return w > 0 && w < paneSplitMinWidth(panelW);
    } catch (_) { return false; }
  });
  // Going back to the list keeps the chat on screen for its fade-out, so
  // the exit is the chat leaving rather than the dashboard flashing past.
  // Derived during render (React's "adjust state on prop change" pattern)
  // so the chat is never unmounted and remounted in between.
  const [exitChat, setExitChat] = React.useState(null);
  const [seenChat, setSeenChat] = React.useState(inPageChat);
  if (seenChat !== inPageChat) {
    setSeenChat(inPageChat);
    setExitChat((single && !inPageChat && seenChat && paneMotionOK()) ? seenChat : null);
  }
  const shownChat = inPageChat || exitChat;
  // 'split' | 'list' | 'chat'
  const paneView = single ? (inPageChat ? 'chat' : 'list') : 'split';
  const paneRef      = React.useRef(null);
  const chatPaneRef  = React.useRef(null);
  const paneViewRef  = React.useRef(paneView);
  const paneAnimsRef = React.useRef([]);
  ensurePaneStyles();

  const [resizing,   setResizing]  = React.useState(false);
  // True while the pointer is inside the collapse zone, where the width no
  // longer tracks it 1:1 but snaps between the rail (64) and the narrowest
  // full row (140). Free dragging must have no width transition or the panel
  // lags behind the cursor; a snap is the opposite — it is a jump the panel
  // makes on its own, and without a transition it simply teleports. So the
  // transition is turned back on for exactly that part of the drag.
  const [snapAnim,   setSnapAnim]  = React.useState(false);
  const [gripHover,  setGripHover] = React.useState(false);
  // Settings: which section window is open. The only entry point in this
  // column is the gear at the left end of the search field (top of the
  // rail when collapsed); the window carries its own section switcher.
  const setPop = useSettingsPopupCtl();
  const settingsOn = !!setPop.activeRow && !setPop.popClosing;
  const auth = (typeof useAuth === 'function') ? useAuth() : {account: null};
  const account = auth && auth.account || null;
  // Chatting without an account: one conversation, none of the workspace.
  const isGuest = !!(account && account.guest);
  // Appearance tweaks are owned by App (persisted, and applied to --acc on
  // the document root). This component used to keep a private copy, so the
  // Preferences controls changed a value nothing else read — which is why
  // accent colour and chat width appeared to do nothing. The local state is
  // only a fallback for a MsgList mounted without App.
  const MSG_TWEAK_FALLBACK = { accentColor: '#6c63ff', chatWidth: 680, compactTable: false };
  const [localTweaks, setLocalTweaks] = React.useState(MSG_TWEAK_FALLBACK);
  const setLocalTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null
      ? keyOrEdits : { [keyOrEdits]: val };
    setLocalTweaks(prev => ({ ...prev, ...edits }));
  }, []);
  const tweaks   = tweaksProp || localTweaks;
  const setTweak = setTweakProp || setLocalTweak;
  const COLLAPSED_THRESHOLD = 110;
  // A full-width one-pane list always shows full rows, whatever the saved
  // width; the rail comes back with the second column.
  const isCollapsed = !single && panelW < COLLAPSED_THRESHOLD;

  const resizeRef  = React.useRef(null);
  const contactRef = React.useRef(null);

  // Which layout fits. Watches the inbox's own width; the list width only
  // matters through the threshold, so this re-arms when it changes.
  React.useLayoutEffect(() => {
    const root = paneRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const need = paneSplitMinWidth(panelW);
    const check = () => {
      const w = root.clientWidth;
      if (w > 0) setSingle(w < need);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(root);
    return () => ro.disconnect();
  }, [panelW]);

  const stopPaneAnims = React.useCallback(() => {
    paneAnimsRef.current.forEach(a => { try { a.cancel(); } catch (_) {} });
    paneAnimsRef.current = [];
    [contactRef.current, chatPaneRef.current].forEach(el => { if (el) el.removeAttribute('data-pane-leaving'); });
  }, []);

  // Layout / navigation changes. Runs before paint, so nothing is ever
  // drawn in a half-switched state.
  React.useLayoutEffect(() => {
    MSG_LAYOUT.single     = paneView !== 'split';
    MSG_LAYOUT.listHidden = paneView === 'chat';
    const prev = paneViewRef.current;
    if (prev === paneView) return;
    paneViewRef.current = paneView;
    stopPaneAnims();
    const listEl = contactRef.current;
    const chatEl = chatPaneRef.current;
    // Crossing the one-pane threshold during a window drag changes the
    // chat's room by the list's whole width in one step, which the held
    // column's step-by-step estimate can't know. Measure it again.
    if (liveResizeRef.current && CHAT_PANEL_MOTION.byWindow) {
      CHAT_PANEL_MOTION.end();
      CHAT_PANEL_MOTION.beginWindow(paneRef.current);
    }

    if (prev === 'split' || paneView === 'split') {
      // The window crossed the threshold: a layout change, not a
      // navigation — land in the new layout in this frame, no motion.
      if (listEl) {
        listEl.setAttribute('data-pane-snap', '1');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (paneViewRef.current === paneView) listEl.removeAttribute('data-pane-snap');
        }));
      }
      if (paneView === 'split') setExitChat(null);
    } else if (listEl && chatEl && paneMotionOK()) {
      // One-pane navigation: list -> chat (forward) or chat -> list.
      const forward = paneView === 'chat';
      const inEl  = forward ? chatEl : listEl;
      const outEl = forward ? listEl : chatEl;
      const dir   = forward ? 1 : -1;
      outEl.setAttribute('data-pane-leaving', '1');
      const outA = outEl.animate([
        { opacity: 1, transform: 'translate3d(0,0,0)' },
        { opacity: 0, transform: `translate3d(${-dir * 12}px,0,0)` },
      ], { duration: PANE_OUT_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
      const inA = inEl.animate([
        { opacity: 0, transform: `translate3d(${dir * PANE_SHIFT_PX}px,0,0)`, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        { opacity: 0, offset: 0.2, easing: 'cubic-bezier(0, 0, 0.2, 1)' },
        { opacity: 1, transform: 'translate3d(0,0,0)' },
      ], { duration: PANE_IN_MS, fill: 'backwards' });
      paneAnimsRef.current = [outA, inA];
      outA.onfinish = () => {
        outEl.removeAttribute('data-pane-leaving');
        try { outA.cancel(); } catch (_) {}
        // The chat that was held for its exit can go now.
        if (!forward) setExitChat(null);
      };
      inA.onfinish = () => {
        paneAnimsRef.current = paneAnimsRef.current.filter(a => a !== inA && a !== outA);
      };
    } else {
      setExitChat(null);
    }

    // The list is on screen again (or back beside the chat): let the row
    // bookkeeping and the ghost anchor take the one reading they skipped.
    if (paneView !== 'chat') {
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('bcw:panel-resize-end')));
    }
  }, [paneView, stopPaneAnims]);

  React.useEffect(() => () => {
    stopPaneAnims();
    MSG_LAYOUT.single = false;
    MSG_LAYOUT.listHidden = false;
  }, [stopPaneAnims]);

  // ── Live window resize (see LIVE WINDOW RESIZE in BotCommand.html) ──
  // While a window edge is being dragged:
  //   • an open chat's message column is held (CHAT_PANEL_MOTION), so the
  //     thread doesn't re-wrap and re-measure every bubble on every step;
  //   • the measuring passes that follow the layout — the row FLIP
  //     bookkeeping and the ghost-anchor tracker — stand down, exactly as
  //     for a panel drag (PANEL_RESIZE);
  // and on release everything takes one reading and settles, the ghost
  // gliding to its new home. Only holds what nothing else is holding.
  const liveResizeRef = React.useRef(false);
  React.useEffect(() => {
    let ownsSuspend = false;
    const release = () => {
      if (!liveResizeRef.current) return;
      liveResizeRef.current = false;
      if (CHAT_PANEL_MOTION.byWindow) CHAT_PANEL_MOTION.end();
      if (ownsSuspend) {
        ownsSuspend = false;
        PANEL_RESIZE.active = false;
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('bcw:panel-resize-end')));
      }
    };
    const onLive = (e) => {
      const on = !!(e && e.detail && e.detail.active);
      if (!on) { release(); return; }
      if (liveResizeRef.current || dragRef.current) return;   // a panel drag owns the geometry
      liveResizeRef.current = true;
      if (!PANEL_RESIZE.active) { PANEL_RESIZE.active = true; ownsSuspend = true; }
      CHAT_PANEL_MOTION.beginWindow(paneRef.current);
    };
    const onResize = () => { if (liveResizeRef.current) CHAT_PANEL_MOTION.updateWindow(); };
    window.addEventListener('bc:live-resize', onLive);
    window.addEventListener('resize', onResize);
    // During an oversized drag the visible size changes with no resize
    // event at all; the page announces it instead.
    window.addEventListener('bc:live-viewport', onResize);
    return () => {
      window.removeEventListener('bc:live-resize', onLive);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('bc:live-viewport', onResize);
      release();
    };
  }, []);


  // In the rail the name is only a hover tooltip. Rows no longer re-render
  // when the list changes mode (that is what keeps the switch smooth), so
  // the tooltip is set on the existing buttons directly — after the
  // animation, off the critical frames — and rows that arrive while the
  // rail is open are covered by the same pass on their next mode change.
  React.useEffect(() => {
    const el = contactRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      el.querySelectorAll('.bc-crow').forEach(b => {
        if (isCollapsed) b.setAttribute('title', b.getAttribute('data-name') || '');
        else b.removeAttribute('title');
      });
    }, RAIL_MS + 40);
    return () => clearTimeout(t);
  }, [isCollapsed]);

  // Measure the contact list's actual right edge and set --bcw-left on :root.
  // Then read the .bcw-ghost-reserve cell's screen rect and push the ghost home
  // position into that cell's centre via window.__ghostCtl.setHome().
  // Both updates happen together so the grid left edge and ghost home are
  // always in sync regardless of sidebar/panel width or window resize.
  //
  // ALSO: listens for the bcw:mode-change event the widget overlay fires when
  // the dashboard transitions between centered (empty board) and docked
  // (board has at least one widget). On mode change we (a) tell the ghost
  // controller to flip its active depth — so the ghost feels closer when
  // centered, recedes when docked — and (b) re-read the reserve rect so the
  // ghost glides to the new home position alongside the CSS transition.
  // We also observe the .bcw-ghost-reserve element itself, not just the
  // contacts list, so the reserve's transition (which animates left/top
  // over ~480ms) keeps the WebGL ghost in sync the whole way through.
  React.useEffect(()=>{
    const el = contactRef.current;
    if (!el) return;

    // Hoisted so both updateLayout and event listeners can call it.
    // Coalesced: many triggers in one frame (resize + RO + a drive tick)
    // do the measurement once.
    let ghostUpdateQueued = false;
    const scheduleGhostUpdate = () => {
      if (ghostUpdateQueued || disposed) return;
      ghostUpdateQueued = true;
      loopFrame(() => {
        ghostUpdateQueued = false;
        // The ghost's home is wherever its anchor element currently is —
        // the spring does the rest, which is why moving it reads as the
        // ghost gliding rather than teleporting.
        //
        // .bcw-ghost-slot takes priority when present. That's the empty
        // state of the ghost chat, and the ghost belongs IN it: the chat
        // used to show a flat PNG of him in that spot while the real one
        // hovered somewhere else entirely, so there were two ghosts on
        // screen and only one of them was alive. Now there's one, and it
        // travels to the slot when the chat opens and back to the board
        // when it closes.
        const slotEl    = document.querySelector('.bcw-ghost-slot');
        const reserveEl = slotEl || document.querySelector('.bcw-ghost-reserve');
        if (!reserveEl) return;
        const r = reserveEl.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        const cx = r.left + r.width  * 0.5;
        const cy = r.top  + r.height * 0.5;
        const vpNow = bcViewport();
        const vw = vpNow.w;
        const vh = vpNow.h;
        const unitPx = 320 / 4.4; // BASE_H / 4.4 ≈ 72.73px per world unit
        const wx = (cx - vw * 0.5) / unitPx;
        const wy = -(cy - vh * 0.5) / unitPx;
        const ctl = window.__ghostCtl;
        if (!ctl || !ctl.setHome) return;
        if (slotEl) {
          // Ghost-chat empty state: the slot is a small fixed box (see
          // GhostSlot in bot-ui-shared.jsx) with no relation to the
          // dashboard's docked/centered scale. Size the ghost to actually
          // fit inside it — this used to inherit whatever HOME_SCALE the
          // board happened to be using, which could render 2x the box
          // (PLANE_H * boardScale * unitPx vs. a ~96px slot) and made the
          // ghost look oversized/clipped on this screen.
          const PLANE_W_ = 3.5, PLANE_H_ = 4.0;
          const FIT_MARGIN = 0.86; // a little breathing room inside the slot
          const fitScale = Math.min(
            (r.width  * FIT_MARGIN) / (PLANE_W_ * unitPx),
            (r.height * FIT_MARGIN) / (PLANE_H_ * unitPx)
          );
          ctl.setHome(wx, wy, fitScale, { noPersist: true });
        } else {
          // Back on the plain dashboard reserve (no slot). setHome() with
          // no scale argument PRESERVES whatever HOME_SCALE is currently
          // live — which, right after leaving the ghost-chat slot above,
          // is still that slot's small fitScale. Nothing else re-applies
          // the dashboard's own scale on the way out, so the ghost stayed
          // shrunk to chat-slot size back on the homepage. Explicitly pass
          // the persisted docked/centered scale for the active mode so it
          // resets to its normal homepage size every time we land here.
          const cal = ctl.getScaleCal ? ctl.getScaleCal() : null;
          const restoreScale = cal
            ? (cal.mode === 'centered' ? cal.homeCenter : cal.homeDocked)
            : undefined;
          ctl.setHome(wx, wy, restoreScale);
        }
      });
    };

    // Forward the dashboard mode into the ghost controller. Mode tells
    // the controller which persisted scale ('homeCenter' vs 'homeDocked')
    // to use as its active HOME_SCALE — that's how depth follows the
    // dock when the user toggles widgets on/off.
    const onModeChange = (e) => {
      const mode = e && e.detail;
      const ctl = window.__ghostCtl;
      if (ctl && ctl.setActiveMode) ctl.setActiveMode(mode);
      // Mode change = layout fundamentally changed (0↔1+ widgets).
      // Clear userMoved so the ghost relocates to the new mode's anchor.
      // User positioning only persists within a mode, not across mode switches.
      if (ctl && ctl.clearUserMoved) ctl.clearUserMoved();
      // Track the animated CSS reserve across the full 480ms transition.
      // scheduleGhostUpdate reads the reserve's live getBoundingClientRect()
      // each rAF so the ghost spring follows the sliding reserve precisely.
      let n = 0;
      const driveTick = () => {
        scheduleGhostUpdate();
        n++;
        if (n < 24) loopFrame(driveTick); // ~400ms @ 60fps
      };
      loopFrame(driveTick);
    };

    // Drive scheduleGhostUpdate across a whole CSS transition rather than
    // reading once. This is the fix for the ghost sitting off-centre:
    // updateLayout sets --bcw-left, but the reserve cell it feeds is
    // repositioned by a ~480ms CSS transition. Reading the reserve's rect a
    // single frame later measured it MID-FLIGHT (or before it had moved at
    // all), so the ghost was homed to a stale centre and stayed there until
    // something else happened to nudge it. Sampling every frame for the
    // duration lands it on the final position and makes it glide there.
    // Every rAF loop this effect starts is tracked here and cancelled on
    // unmount. Previously only trackRaf was, so the attach-poll, the
    // mode-change drive and the anchor-change drive could keep running (and
    // calling into a disposed ghost controller) after MsgList unmounted —
    // the attach-poll forever, if the reserve never appeared.
    let disposed = false;
    const loopRafs = new Set();
    const loopFrame = (fn) => {
      if (disposed) return 0;
      const id = requestAnimationFrame((ts) => { loopRafs.delete(id); if (!disposed) fn(ts); });
      loopRafs.add(id);
      return id;
    };
    let trackRaf = null;
    const trackReserve = (frames = 32) => {
      if (trackRaf) cancelAnimationFrame(trackRaf);
      let n = 0;
      const tick = () => {
        scheduleGhostUpdate();
        if (++n < frames) trackRaf = requestAnimationFrame(tick);
        else trackRaf = null;
      };
      trackRaf = requestAnimationFrame(tick);
    };

    let lastBcwLeft = '';
    const updateLayout = () => {
      // --bcw-left lives on :root, and every element in the document
      // inherits custom properties — so writing it restyles the WHOLE page,
      // including an open chat's entire thread. Its only reader is the
      // dashboard board, which is display:none while a chat is open. So
      // mid-resize with a chat open it waits for the release (the resize-end
      // reading below writes it), and it is never rewritten unchanged.
      if (PANEL_RESIZE.active && document.body.getAttribute('data-bcw-hidden') === '1') return;
      // One-pane mode: the board is hidden and the list's edge is the
      // window's edge, so there is nothing to tell it. Returning to two
      // columns re-reads it (the list's width changes, and the layout
      // switch fires bcw:panel-resize-end).
      if (!MSG_LAYOUT.single) {
        const rect = el.getBoundingClientRect();
        const nextLeft = `${Math.round(rect.right)}px`;
        if (nextLeft !== lastBcwLeft) {
          lastBcwLeft = nextLeft;
          document.documentElement.style.setProperty('--bcw-left', nextLeft);
        }
      }
      // Mid-drag this fires on every frame, and trackReserve() starts a
      // 32-frame loop that measures the reserve and drives the WebGL ghost
      // — so a one-second drag used to queue tens of thousands of those,
      // each cancelling the last and none of them describing where the
      // panel was going to end up. The CSS variable above is cheap and does
      // need to stay live (the dashboard grid tracks it), so it still runs;
      // the ghost waits for the release and then glides once, which is what
      // it looked like it was trying to do anyway.
      if (PANEL_RESIZE.active) return;
      // Any width change (sidebar drag, collapse, window resize) moves the
      // reserve, so follow it the whole way.
      trackReserve();
    };

    updateLayout();
    // FIRST PAINT. .bcw-ghost-reserve is mounted by the widget overlay,
    // which may not exist yet on the very first frame after login — the
    // early `if (!reserveEl) return` in scheduleGhostUpdate meant the
    // initial centring was simply skipped, which is why the ghost looked
    // off-centre until the first resize. Re-run on a couple of longer
    // delays so it self-corrects once the overlay has mounted, and once
    // more after fonts/layout settle.
    const bootTimers = [
      setTimeout(() => trackReserve(20), 120),
      setTimeout(() => trackReserve(20), 500),
      setTimeout(() => trackReserve(12), 1200),
    ];
    const ro = new ResizeObserver(updateLayout);
    ro.observe(el);

    // Also observe the ghost reserve directly — its CSS-driven transition
    // between docked and centered fires width/height/position changes that
    // ResizeObserver picks up over the full ~480ms duration. This makes
    // the WebGL ghost track the moving reserve frame-by-frame instead of
    // snapping to the final position.
    const reserveRO = new ResizeObserver(() => trackReserve(8));
    // Find the reserve once it exists (it's mounted by the widget overlay,
    // which may not have mounted yet on first paint). Try every animation
    // frame until found, then attach.
    let reserveAttached = false;
    const tryAttachReserve = () => {
      if (reserveAttached) return;
      const reserveEl = document.querySelector('.bcw-ghost-reserve');
      if (reserveEl) {
        reserveRO.observe(reserveEl);
        reserveAttached = true;
        // The reserve has only just appeared, so this is the first chance
        // to measure it at all — track it rather than take one sample.
        trackReserve(20);
      } else {
        loopFrame(tryAttachReserve);
      }
    };
    tryAttachReserve();

    window.addEventListener('resize', updateLayout);
    // The one reading that matters after a resize drag: the edge has come
    // to rest, so measure it properly and let the ghost glide to its new
    // home in a single move.
    const onResizeEnd = () => { updateLayout(); trackReserve(24); };
    window.addEventListener('bcw:panel-resize-end', onResizeEnd);
    // Ghost may mount after this effect runs — re-push home when it's ready.
    // Named so cleanup can actually remove it (the old inline arrow could
    // not be removed, and cleanup was removing a different function).
    const onGhostReady = () => trackReserve(20);
    window.addEventListener('ghost:ready', onGhostReady);
    // When ghost.reset() fires (user clicked "Reset" in ghost dev panel or
    // widget reset), re-push the real reserve rect so GHOST_HOME_DEFAULT and
    // the dropSpring target are both correct for this viewport/layout.
    window.addEventListener('ghost:return-to-dock', scheduleGhostUpdate);
    // The chat slot appearing or disappearing is a home change with no
    // resize behind it, so nothing else would notice. Drive the follow for
    // a stretch so the ghost tracks the slot through the panel's own
    // transition instead of aiming at where it was on frame one.
    const onAnchorChange = () => {
      // setHome() is deliberately ignored once the operator has dragged the
      // ghost somewhere themselves — otherwise a sidebar resize would keep
      // snatching it back. But opening its chat is a change of context, not
      // a layout nudge, and a ghost pinned to the corner of the board would
      // simply never arrive. Same call the dashboard's own mode switch
      // makes, and the same trade: a hand-placed position holds within a
      // context, not across one.
      const ctl = window.__ghostCtl;
      if (ctl && ctl.clearUserMoved) ctl.clearUserMoved();
      let n = 0;
      const tick = () => { scheduleGhostUpdate(); if (++n < 30) loopFrame(tick); };
      loopFrame(tick);
    };
    window.addEventListener('ghost:anchor-change', onAnchorChange);
    window.addEventListener('bcw:mode-change', onModeChange);
    return () => {
      ro.disconnect();
      reserveRO.disconnect();
      // Don't leave a rAF loop or boot timers running against an unmounted
      // component — they'd keep calling into a disposed ghost controller.
      disposed = true;
      if (trackRaf) cancelAnimationFrame(trackRaf);
      loopRafs.forEach(cancelAnimationFrame);
      loopRafs.clear();
      bootTimers.forEach(clearTimeout);
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('bcw:panel-resize-end', onResizeEnd);
      window.removeEventListener('ghost:ready', onGhostReady);
      window.removeEventListener('ghost:return-to-dock', scheduleGhostUpdate);
      window.removeEventListener('ghost:anchor-change', onAnchorChange);
      window.removeEventListener('bcw:mode-change', onModeChange);
    };
  }, []);

  // ── CLICK THE GHOST → OPEN THE GHOST CHAT ───────────────────────────
  // The WebGL ghost dispatches bcw:ghost-click from its silhouette hitbox
  // (see the onClick handler in the ghost rig). Previously GhostComposer
  // caught this and focused its floating one-line input; now we open a
  // real chat pane instead. The composer's listener was reduced to an
  // emotion beat so the two don't fight over focus.
  //
  // Guarded on inPageChat so clicking the ghost while it's already open
  // is a no-op rather than pushing a duplicate onto the back-stack.
  React.useEffect(() => {
    const onGhostClick = () => {
      if (inPageChat && inPageChat.__ghost) return;
      openInPage(GHOST_CHAT_CONV);
    };
    window.addEventListener('bcw:ghost-click', onGhostClick);
    return () => window.removeEventListener('bcw:ghost-click', onGhostClick);
  }, [inPageChat, openInPage]);

  // ── Resize drag ──────────────────────────────────────────────────────
  // Three things used to happen once per pointer event, and a mouse reports
  // far more often than the screen refreshes:
  //   • getBoundingClientRect() on the pane, to find its left edge — a
  //     forced layout in the middle of the move handler;
  //   • setPanelW(), so React re-rendered the whole pane, which re-ran the
  //     FLIP pass over every contact row and the ghost-anchor tracker;
  //   • the width landed in localStorage, a synchronous write per pixel.
  // So a fast drag queued several full layout passes per frame and the
  // panel edge arrived late and in steps.
  //
  // Now: the left edge is measured once at the start, the pointer position
  // is stored raw and converted at most once per animation frame, the
  // expensive observers stand down for the duration (PANEL_RESIZE), and the
  // save is debounced. The width itself is still ordinary React state, so
  // nothing about how the panel is styled or how it behaves changes — it
  // simply updates in step with the display instead of ahead of it.
  const dragRef = React.useRef(null);
  const suspendRef = React.useRef(null);

  // The panel's width animates in two situations that are not a drag: the
  // 180ms collapse transition a drag hands off to when it is released inside
  // the snap zone, and the same transition fired by a double-click. During
  // either, the panel's ResizeObserver fires every frame, and the FLIP
  // bookkeeping answers it by re-reading a bounding rect for every visible
  // row — per-frame O(rows) work for the whole length of the animation,
  // which is what made the collapse stutter. The measuring stands down for
  // the duration and takes one reading at the end, exactly as it does for a
  // drag; PANEL_RESIZE is the same switch, just held down a little longer.
  const suspendPanelMeasuring = React.useCallback((ms) => {
    PANEL_RESIZE.active = true;
    if (suspendRef.current) clearTimeout(suspendRef.current);
    suspendRef.current = setTimeout(() => {
      suspendRef.current = null;
      PANEL_RESIZE.active = false;
      CHAT_PANEL_MOTION.end();
      window.dispatchEvent(new CustomEvent('bcw:panel-resize-end'));
    }, ms);
  }, []);

  React.useEffect(() => () => {
    if (suspendRef.current) clearTimeout(suspendRef.current);
    PANEL_RESIZE.active = false;
    CHAT_PANEL_MOTION.end();
  }, []);

  // Pointer position -> panel width. Called at most once per animation frame
  // while the drag runs, and once more on release so the last few pixels of
  // the movement are not dropped along with the cancelled frame.
  const applyResizeFrame = React.useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    d.raf = 0;
    // Allow shrinking to 64px (avatar-only). Snap to 64 below 84,
    // jump to 140 between 84-140 so it locks cleanly out of collapsed.
    // The snap test reads the RAW pointer width, not the clamped result:
    // dragging straight past the zone in one frame lands on 64 either way,
    // and comparing the two numbers would call that "not a snap" and skip
    // the animation in exactly the case that needs it most.
    const rawW = d.x - d.left;
    let newW;
    if (rawW < 84)       newW = 64;
    else if (rawW < 140) newW = 140;
    else                 newW = Math.min(520, rawW);
    // The chat keeps at least PANE_CHAT_MIN_W beside the list. Where even
    // the narrowest full list wouldn't leave that, only the rail fits.
    if (newW > d.maxW) newW = d.maxW >= 140 ? d.maxW : 64;
    const snapped = rawW < 140;
    d.snapped = snapped;
    // Before the width commits, so a held chat column is already narrow
    // enough for the room it's about to have.
    CHAT_PANEL_MOTION.update(newW);
    // THE DRAG WRITES THE WIDTH STRAIGHT TO THE PANEL. Routing every frame
    // through setPanelW re-rendered the whole contact list 60 times a
    // second — and re-ran the row bookkeeping each time — which is where
    // the drag's lag came from. React only hears about the width when the
    // list actually changes MODE (full list <-> rail) and once on release;
    // in between, only the one style property moves. (React leaves the
    // DOM alone on unrelated re-renders, because the width it last wrote
    // hasn't changed.)
    const el = contactRef.current;
    if (snapped !== d.snapState) {
      d.snapState = snapped;
      // Set on the element in the same tick as the width, so the very first
      // snapped frame animates instead of teleporting while React catches up.
      if (el) el.style.transition = snapped ? `width ${RAIL_MS}ms ${RAIL_EASE}` : 'none';
      setSnapAnim(snapped);
    }
    if (d.w !== newW) {
      d.w = newW;
      if (el) el.style.width = `${newW}px`;
      const coll = newW < COLLAPSED_THRESHOLD;
      if (coll !== d.coll) { d.coll = coll; setPanelW(newW); }
    }
  }, []);

  const endResize = React.useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    applyResizeFrame();               // settle on the final pointer position
    const wasSnapped = !!d.snapped;
    dragRef.current = null;
    // Hand the final width back to React (saved, and used for layout from
    // here on). It matches what is already on screen, so nothing moves.
    if (Number.isFinite(d.w)) { setPanelW(d.w); if (d.moved !== false) markPanelSized(true); }
    document.body.style.userSelect = d.prevUserSelect || '';
    document.body.style.cursor     = d.prevCursor || '';
    setResizing(false);
    setSnapAnim(false);   // the panel owns its transition again
    if (wasSnapped) {
      // Released inside the snap zone: the panel is about to animate to its
      // resting width on its own. Stay suspended until it lands, then take
      // the one reading that describes where it actually ended up.
      suspendPanelMeasuring(RAIL_MS + 60);
    } else {
      // The edge is already where it was let go. One truthful reading, but
      // not until React has committed that final width -- measuring now
      // would record the edge a frame short of where it ends up.
      PANEL_RESIZE.active = false;
      // A press that never moved (the first half of a double-click, usually)
      // keeps the chat held a moment longer, so the double-click's collapse
      // reuses it instead of promoting the column all over again.
      const seq = CHAT_PANEL_MOTION.seq;
      const release = () => { if (CHAT_PANEL_MOTION.seq === seq) CHAT_PANEL_MOTION.end(); };
      if (d.moved) requestAnimationFrame(release); else setTimeout(release, 320);
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('bcw:panel-resize-end'));
      });
    }
  }, [applyResizeFrame, suspendPanelMeasuring]);

  const startResize = React.useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const container = resizeRef.current && resizeRef.current.closest('[data-msgpane]');
    if (!container) return;
    // Hold an open chat still for the drag (see CHAT_PANEL_MOTION). Done on
    // press, a frame before anything moves, so lifting the message column
    // onto its own layer never lands in the same frame as the first resize.
    // The width actually on screen: in a narrow window the list may be
    // yielding width to the chat (its max-width), so it can be less than
    // the saved panelW.
    const curW = contactRef.current
      ? Math.round(contactRef.current.getBoundingClientRect().width) : panelW;
    CHAT_PANEL_MOTION.begin(container, curW);
    const cRect = container.getBoundingClientRect();   // measured once
    dragRef.current = {
      left: cRect.left,
      maxW: Math.floor(cRect.width - PANE_CHAT_MIN_W),
      x: e.clientX,
      raf: 0,
      w: curW,                            // width currently on screen
      coll: panelW < COLLAPSED_THRESHOLD, // mode currently rendered
      snapState: false,
      prevUserSelect: document.body.style.userSelect,
      prevCursor:     document.body.style.cursor,
    };
    // Grabbing the edge again within 240ms of a collapse would otherwise
    // leave that transition's timer pending, and it would lift the
    // suspension part-way through this new drag.
    if (suspendRef.current) { clearTimeout(suspendRef.current); suspendRef.current = null; }
    PANEL_RESIZE.active = true;
    // The pointer spends most of the drag outside the 6px strip. Capturing
    // it keeps every move on this element, which also stops the rows
    // underneath firing hover enter/leave the whole way across.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    // Without this a drag selects the contact names it passes over, and the
    // cursor flickers between col-resize and text.
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'col-resize';
    setResizing(true);
  }, [panelW]);

  const onResizeMove = React.useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    if (e.clientX !== d.x) d.moved = true;
    d.x = e.clientX;
    if (d.raf) return;                 // a frame is already queued
    d.raf = requestAnimationFrame(applyResizeFrame);
  }, [applyResizeFrame]);

  // Releasing outside the window, or the browser taking the pointer away
  // (an alt-tab, a context menu), must end the drag too — otherwise the
  // observers stay suspended and the panel keeps following the mouse.
  React.useEffect(() => {
    if (!resizing) return;
    window.addEventListener('pointerup', endResize);
    window.addEventListener('pointercancel', endResize);
    window.addEventListener('blur', endResize);
    return () => {
      window.removeEventListener('pointerup', endResize);
      window.removeEventListener('pointercancel', endResize);
      window.removeEventListener('blur', endResize);
    };
  }, [resizing, endResize]);

  React.useEffect(() => endResize, [endResize]);

  // Persist panel width — debounced, so a drag writes once when it settles
  // rather than once per pixel. localStorage is synchronous.
  React.useEffect(() => {
    if (!panelUserSized.current) return;
    const t = setTimeout(() => {
      try { localStorage.setItem('bc.contactlist.w', String(panelW)); } catch(e) {}
    }, 200);
    return () => clearTimeout(t);
  }, [panelW]);

  // Prime the first-seen ledger on the very first render so an existing
  // inbox doesn't shimmer wholesale on mount — only rows that arrive
  // afterwards count as new.
  if (!_rowSeenPrimed.done) {
    _rowSeenPrimed.done = true;
    liveMsgs.forEach(m => _rowFirstSeen.set(m.id, 0));
  }
  // Register arrivals, then schedule one re-render so the avatar
  // shimmer retires on time even if the store goes quiet.
  const rowIdsKey = liveMsgs.map(m => m.id).join('|');
  React.useEffect(() => {
    const now = Date.now();
    let fresh = false;
    liveMsgs.forEach(m => {
      if (!_rowFirstSeen.has(m.id)) { _rowFirstSeen.set(m.id, now); fresh = true; }
    });
    if (!fresh) return;
    const id = setTimeout(bumpFresh, AVA_FRESH_MS + 150);
    return () => clearTimeout(id);
  }, [rowIdsKey]);

  // Memo'd derived state. Without it the whole conversation list
  // re-derives on every notify (which fires several times per second
  // during AI replies and typing), causing dropped frames.
  const rows = React.useMemo(()=>{
    const lq = q ? q.toLowerCase() : '';
    const lqAt = lq.replace(/^@/, '');
    const plat = liveMsgs.filter(m=>{
      if(lq && !((m.name||'').toLowerCase().includes(lq) || (m.last||'').toLowerCase().includes(lq))) return false;
      return true;
    });
    const dms = dmConvs.filter(m => !lq
      || (m.name||'').toLowerCase().includes(lqAt)
      || (m.handle||'').toLowerCase().includes(lqAt)
      || (m.last||'').toLowerCase().includes(lq));
    return dms.length ? plat.concat(dms) : plat;
  },[liveMsgs, dmConvs, q]);
  // Newest first, full stop. Priority now lives in the section order
  // (Escalated → Customers → Incoming), so inside a section the only
  // thing that should decide position is recency.
  const sortedRows = React.useMemo(()=>{
    const seq = new Map(rows.map((m,i)=>[m.id,i]));
    return [...rows].sort((a,b)=>{
      const d = msgTimeVal(b) - msgTimeVal(a);
      return d !== 0 ? d : (seq.get(a.id)||0) - (seq.get(b.id)||0);
    });
  },[rows]);
  // Grouped buckets, in priority order: Escalated (needs a human),
  // then verified Customers, then everyone else as Incoming. Each is
  // independently foldable from its header.
  const groupedRows = React.useMemo(() => {
    // Direct chats sort into the same sections as every other chat (their
    // escalated / customer flags come from DM_AI.flagsFor).
    const buckets = {escalated:[], customers:[], incoming:[]};
    sortedRows.forEach(m => {
      if (m.escalated || m.stage==='escalated' || m.stage==='needs_help') buckets.escalated.push(m);
      else if (m.stage==='customer' || m.stage==='vip') buckets.customers.push(m);
      else buckets.incoming.push(m);
    });
    return buckets;
  }, [sortedRows]);

  // ── Reorder animation wiring ──
  // orderSig changes only when the rendered sequence of rows actually
  // changes, so the measure/animate pass doesn't run on the several
  // notifies-per-second the store fires while an AI reply is streaming.
  // Both modes now paint the same sequence (see the list body), so the
  // signature no longer forks on isCollapsed — which also means collapsing
  // is not counted as a reorder, because nothing reorders.
  const orderSig = React.useMemo(() => (
    SECTIONS.map(s => groupedRows[s.key].map(m => m.id).join(',')).join('|')
  ), [groupedRows]);
  // layoutSig covers the changes that move rows for reasons that aren't a
  // reorder — folding a section, dragging the panel, collapsing to the
  // avatar rail. Those re-measure but deliberately don't animate.
  const layoutSig = React.useMemo(
    () => `${panelW}|${isCollapsed?1:0}|${single?1:0}|${JSON.stringify(foldedGroups)}`,
    [panelW, isCollapsed, single, foldedGroups]
  );
  const rowsScrollRef = React.useRef(null);
  const flipRef = useFlipReorder(rowsScrollRef, orderSig, layoutSig);

  // Stable handlers so the memoized chat panels only redraw for real changes.
  const closeChat = React.useCallback(() => openInPage(null), [openInPage]);
  // In one-pane mode the chat's Back arrow goes to the list, Telegram
  // style — the list IS the way between chats there.
  const hasBack   = !single && !!(chatHistory && chatHistory.length);
  const backProp  = hasBack ? goBackInPage : null;
  const backTarget = hasBack ? chatHistory[chatHistory.length - 1] : null;

  // The dashboard briefing only reads counts from the conversation list
  // (total, unread, escalated, per-platform). Hand it a list reference that
  // changes only when those counts do, so the memoized WebGL dashboard is
  // not re-rendered for every message that arrives.
  const briefSig = React.useMemo(() => {
    let unread = 0, esc = 0;
    const plat = {};
    for (const m of liveMsgs) {
      if (m.unread) unread++;
      if (m.stage === 'escalated' || m.stage === 'needs_help') esc++;
      const p = m.p || 'other';
      plat[p] = (plat[p] || 0) + 1;
    }
    return `${liveMsgs.length}|${unread}|${esc}|${Object.keys(plat).sort().map(k => k + ':' + plat[k]).join(',')}`;
  }, [liveMsgs]);
  const briefMsgs = React.useMemo(() => liveMsgs, [briefSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // The list's top inset follows what sits first under the search divider.
  // A section header carries its own top padding, so the rows container
  // adds a small breath above it; a contact row (no headers shown — e.g. a
  // DM list with a single section — or the avatar rail, where headers fold
  // away) sits flush against the divider, with no stray gap above it.
  const listStartsWithRow = (() => {
    if (q) return false;                           // the People result leads
    const liveSecs = SECTIONS.filter(s => groupedRows[s.key].length > 0);
    if (!liveSecs.length) return false;            // empty state has its own spacing
    const heads = liveSecs.length > 1 || liveSecs[0].key === 'escalated';
    return !heads || isCollapsed;
  })();

  return (
    <div ref={paneRef} data-msgpane="1" data-layout={paneView} style={{display:'flex',flexDirection:'row',height:'100%',overflow:'hidden',position:'relative'}}>
      <style>{`
        @keyframes cust-esc-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(212,146,112,0.55); }
          50%      { box-shadow: 0 0 0 5px rgba(212,146,112,0); }
        }
      `}</style>
      {/* ── LEFT CONTACT LIST ── */}
      <div ref={contactRef} data-collapsed={isCollapsed?'1':'0'}
        aria-hidden={paneView === 'chat' ? 'true' : undefined} style={{
        width:panelW, flexShrink:0, display:'flex', flexDirection:'column',
        // Beside a chat the list yields width before the chat does, down
        // to the point where the layout folds to one pane (MSG_LAYOUT).
        maxWidth:`calc(100% - ${PANE_CHAT_MIN_W}px)`,
        background: 'rgba(12,13,22,0.34)',
        // The app background is animated, so this blur is recomputed every
        // frame for the full height of the panel, and its cost grows with
        // the radius. At 44px it ate most of each frame's budget, leaving
        // too little for hover to keep up with the pointer. 22px — the same
        // radius the settings sheet already uses — looks the same over a
        // 0.34 fill at about a quarter of the work.
        backdropFilter: 'blur(22px) saturate(180%)',
        WebkitBackdropFilter: 'blur(22px) saturate(180%)',
        borderRight:'0.5px solid rgba(255,255,255,0.06)',
        boxShadow:'inset 1px 0 0 rgba(255,255,255,0.04), inset 0 0.5px 0 rgba(255,255,255,0.05), 1px 0 24px rgba(0,0,0,0.18)',
        overflow:'hidden', position:'relative',
        transition: (resizing && !snapAnim)
          ? 'none'
          : `width ${RAIL_MS}ms ${RAIL_EASE}`,
        // One pane: the list fills the inbox, and steps aside (still laid
        // out, so its scroll position is kept) while a chat is open.
        ...(single ? {
          position:'absolute', top:0, left:0, right:0, bottom:0,
          width:'auto', maxWidth:'none', transition:'none',
          borderRight:'none',
          zIndex: paneView === 'list' ? 2 : 1,
        } : null),
        ...(paneView === 'chat' ? PANE_HIDDEN : null),
      }}>

        <div style={{display:'flex', flexDirection:'column', flex:1, minHeight:0}}>
        {/* Profile + search. Folds away (never unmounts) as the list
            becomes the rail, so the rows below glide up with it instead of
            jumping when it used to vanish in a single frame. */}
        <div style={railFold(!isCollapsed, {flexShrink:0})} aria-hidden={isCollapsed ? 'true' : undefined}>
        <div style={RAIL_FOLD_INNER}>
        <div style={{
          padding: '9px 12px 0',
          // Laid out at its full-list width even while the panel narrows,
          // so the search field folds away intact rather than squashing.
          minWidth: 200,
        }}>
          {/* The signed-in account — one quiet header line above the search
              (replaces the briefing / weather ticker and the account card
              that used to head the settings menu). Sign out lives here. */}
          <ContactListProfile account={account} big={single}/>
          {isGuest ? <GuestCard/> : (
          /* Search bar — muted glass, matches widget surface. The settings
              gear sits at its right end, inset 4px from the top, bottom and
              right edges, after a hairline. */
          <div style={{
            display:'flex', alignItems:'center', gap:8,
            height:32, boxSizing:'border-box',
            background:'rgba(255,255,255,0.025)',
            border:'0.5px solid rgba(255,255,255,0.055)',
            borderRadius:10, padding:'0 4px 0 11px', marginBottom:10,
            transition:'border-color 0.15s, background 0.15s',
          }}
            onFocus={e=>{ if (e.target.tagName === 'INPUT') e.currentTarget.style.borderColor='rgba(150,148,200,0.35)'; }}
            onBlur={e=>{ if (e.target.tagName === 'INPUT') e.currentTarget.style.borderColor='rgba(255,255,255,0.055)'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--t3)',flexShrink:0,opacity:0.85}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              style={{flex:1,minWidth:0,background:'transparent',border:'none',fontSize:12,color:'var(--t1)',outline:'none',letterSpacing:'-0.005em'}}
              placeholder="Search, or find @username…"
              data-contact-search="1"
              value={q}
              onChange={e=>setQ(e.target.value)}
            />
            {q&&<button onClick={()=>setQ('')} style={{fontSize:11,color:'var(--t3)',lineHeight:1,padding:0,background:'none',border:'none',cursor:'pointer',opacity:.6}}>✕</button>}
            <span className="sset-search-sep" aria-hidden="true"/>
            {typeof DmShareButton !== 'undefined' && <DmShareButton/>}
            <SettingsGearButton on={settingsOn} onClick={setPop.toggle}/>
          </div>
          )}

        </div>
        </div>
        </div>

        {/* Divider under the search field. The collapsed rail has no search
            field (its gear lives at the bottom now), so no line up here —
            a line with nothing above it was the first of two stacked
            separators at the top of the rail. */}
        <div style={{height:1,background:'var(--ln)',margin:'0 0 0 0',flexShrink:0,
          opacity: isCollapsed ? 0 : 1, transition: `opacity ${RAIL_MS}ms ease`}}/>

        {/* Contact rows */}
        <div style={{flex:1, minHeight:0, position:'relative', display:'flex', flexDirection:'column'}}>
        <div ref={rowsScrollRef} style={{flex:1,overflowY:'auto',overflowX:'hidden',
          paddingTop: listStartsWithRow ? 0 : 4,
          transition: `padding-top ${RAIL_MS}ms ${RAIL_EASE}`}}>
          {(() => {
            // Helper that renders a single contact row (button). Pulled
            // out so the grouped layout can call it once per row across
            // multiple sections without duplicating 60-odd lines of JSX.
            const renderRow = (m, opts={}) => {
              // A row that has just appeared and has no picture yet shows
              // the avatar's loading shimmer until the fetch lands.
              const seenAt = _rowFirstSeen.get(m.id);
              // Direct chats have no picture to wait for — initials only.
              const avaLoading = !m.__direct && !m.avatar && (seenAt == null || (Date.now() - seenAt) < AVA_FRESH_MS);
              return (
                <ContactRow key={m.id} m={m} id={m.id}
                  name={m.name} col={m.col} avatar={m.avatar} last={m.last} t={m.t}
                  unread={m.unread} stage={m.stage} escalated={!!m.escalated}
                  isActive={inPageChat?.id === m.id} isCollapsed={isCollapsed}
                  lastInGroup={!!opts.lastInGroup} avaLoading={avaLoading}
                  rowRef={flipRef(m.id)} onOpen={openInPage}/>
              );
            };

            // Section header — now the list's control surface. Clicking it
            // folds the section away and the choice persists, which is what
            // replaced the All / Active / Unread / Escalated chip row: the
            // groups already carried that information, the chips just said
            // it twice.
            // In the rail, the first section gets no separator at all (there
            // is nothing above it to separate from); later sections get one
            // hairline between groups.
            // Both forms are always mounted and cross-fold into each other
            // (railFold), so crossing into the rail no longer changes every
            // header's height in one frame — which used to shunt every row
            // below it up or down mid-animation.
            const groupHeader = (sec, count, folded, first) => (
              <>
              {!first && (
                <div style={railFold(isCollapsed)} aria-hidden="true">
                  <div style={RAIL_FOLD_INNER}>
                    <div style={{padding:'8px 8px'}}><div style={{height:1,background:'rgba(255,255,255,0.06)'}}/></div>
                  </div>
                </div>
              )}
              <div style={railFold(!isCollapsed)} aria-hidden={isCollapsed ? 'true' : undefined}>
              <div style={RAIL_FOLD_INNER}>
              <button
                tabIndex={isCollapsed ? -1 : 0}
                onClick={()=>toggleGroup(sec.key)}
                aria-expanded={!folded}
                title={folded ? `Show ${sec.label.toLowerCase()}` : `Hide ${sec.label.toLowerCase()}`}
                style={{
                  width:'100%', display:'flex', alignItems:'center', gap:8,
                  padding: first ? '9px 12px 7px' : '13px 12px 7px',
                  border:'none',
                  borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.045)',
                  cursor:'pointer', textAlign:'left', userSelect:'none',
                }}
                className="bc-cgrp"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"
                  style={{
                    color:sec.accent, flexShrink:0, opacity:0.85,
                    transform: folded ? 'rotate(-90deg)' : 'none',
                    transition:'transform 0.18s cubic-bezier(0.22,1,0.36,1)',
                  }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                <span style={{
                  fontSize:9.5, fontWeight:700, color:sec.accent,
                  letterSpacing:'0.10em', textTransform:'uppercase', whiteSpace:'nowrap',
                }}>{sec.label}</span>
                <span style={{
                  fontSize:9, fontWeight:700, color:'var(--t3)',
                  fontVariantNumeric:'tabular-nums', lineHeight:'13px',
                  padding:'0 5px', borderRadius:999, flexShrink:0,
                  background:'rgba(255,255,255,0.05)',
                  border:'0.5px solid rgba(255,255,255,0.06)',
                }}>{count}</span>
                <span style={{
                  flex:1, minWidth:8, height:1,
                  background:`linear-gradient(90deg, ${sec.accent.replace(/[\d.]+\)$/,'0.16)')} 0%, transparent 100%)`,
                }}/>
              </button>
              </div>
              </div>
              </>
            );

            // Always grouped, always in priority order. Each section can
            // be folded shut from its header; collapsed (avatar-only) mode
            // draws the headers as hairline separators instead.
            //
            // ONE TREE SHAPE, BOTH MODES. Collapsed used to render a flat
            // sortedRows.map() straight into this container while expanded
            // rendered a Fragment per section. React reconciles siblings by
            // position and type, so crossing the collapse threshold matched
            // nothing: every row was unmounted and a new one mounted in its
            // place, which meant every avatar remounted (and re-fetched its
            // image) in the single frame the width was also changing. That
            // is the stall — the animation was not slow, it was starved.
            //
            // Rendering the same structure in both modes means the flip is
            // a prop change on rows that stay put: their DOM nodes, their
            // avatars and their scroll position all survive it. The row SET
            // is identical either way (groupedRows is a partition of
            // sortedRows), and keeping the section order in both modes also
            // means collapsing no longer reshuffles the avatars — they stay
            // exactly where the operator was just looking at them.
            const live = SECTIONS.filter(s => groupedRows[s.key].length > 0);
            // Headers only when they tell you something: two or more kinds
            // of chat to tell apart, or chats that need you (Escalated).
            // One plain list otherwise — a new account's few chats don't
            // need an "Incoming" label over them.
            const showHeads = live.length > 1 || (live.length === 1 && live[0].key === 'escalated');

            const people = q ? (
              <DmPeopleResult q={q} isCollapsed={isCollapsed}
                onOpen={(conv) => { setQ(''); openInPage(conv); }}/>
            ) : null;

            if (!live.length) {
              // The avatar rail has no room for words: it simply stays empty.
              if (isCollapsed) return people;
              // A guest's one conversation is on its way (or couldn't open).
              if (isGuest) {
                return (
                  <div style={{padding:'40px 24px', textAlign:'center', fontSize:11.5, lineHeight:1.5, color:'var(--t3)'}}>
                    {dmStore && dmStore.loaded ? 'Your conversation isn’t available right now.' : 'Opening your conversation…'}
                  </div>
                );
              }
              // Searching: one quiet line under any people found. An
              // @username being typed gets a hint until it's long enough to
              // look up (the People result answers from then on).
              if (q) {
                const t = q.trim();
                const nm = t.replace(/^@/, '');
                const note = t.startsWith('@')
                  ? (/^[A-Za-z0-9_.\-]{3,60}$/.test(nm) ? null : 'Type their username to find them')
                  : `No conversations match “${t}”`;
                // The person found (if any) stands in for the "no match" line.
                return (
                  <DmPeopleResult q={q} isCollapsed={isCollapsed} note={note}
                    onOpen={(conv) => { setQ(''); openInPage(conv); }}/>
                );
              }
              // Nothing yet: a small mark, one line of context and a way to
              // start — it puts @ in the search box, where people are found.
              const startNew = () => {
                setQ('@');
                requestAnimationFrame(() => {
                  try {
                    const el = document.querySelector('input[data-contact-search]');
                    if (el) { el.focus(); const n = el.value.length; el.setSelectionRange(n, n); }
                  } catch (_) {}
                });
              };
              return (
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',textAlign:'center',
                  padding:'64px 24px 24px'}}>
                  <span aria-hidden="true" style={{width:36,height:36,borderRadius:10,display:'grid',placeItems:'center',
                    color:'var(--t3)',background:'rgba(255,255,255,0.03)',border:'0.5px solid rgba(255,255,255,0.07)',
                    boxShadow:'inset 0 1px 0 rgba(255,255,255,0.03)'}}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l2-5.3A8.4 8.4 0 1 1 21 11.5z"/>
                    </svg>
                  </span>
                  <div style={{marginTop:14,fontSize:12.5,fontWeight:500,letterSpacing:'-0.01em',color:'var(--t2)'}}>
                    No conversations yet
                  </div>
                  <div style={{marginTop:4,maxWidth:210,fontSize:11.5,lineHeight:1.5,color:'var(--t3)'}}>
                    Your chats will appear here.
                  </div>
                  <button type="button" onClick={startNew}
                    style={{marginTop:16,display:'inline-flex',alignItems:'center',gap:6,height:28,padding:'0 11px 0 9px',
                      borderRadius:8,fontSize:11.5,fontWeight:500,color:'var(--t2)',cursor:'pointer',
                      background:'rgba(255,255,255,0.035)',border:'0.5px solid rgba(255,255,255,0.08)',
                      transition:'background 0.14s, color 0.14s, border-color 0.14s'}}
                    onMouseEnter={e => { const b = e.currentTarget; b.style.background = 'rgba(255,255,255,0.06)'; b.style.color = 'var(--t1)'; b.style.borderColor = 'rgba(255,255,255,0.12)'; }}
                    onMouseLeave={e => { const b = e.currentTarget; b.style.background = 'rgba(255,255,255,0.035)'; b.style.color = 'var(--t2)'; b.style.borderColor = 'rgba(255,255,255,0.08)'; }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9"/>
                    </svg>
                    Find someone
                  </button>
                </div>
              );
            }

            return (
              <>
                {people}
                {live.map((s, si) => {
                  const bucket = groupedRows[s.key];
                  // Folding is a control that only exists on the expanded
                  // headers — the avatar rail has none to click, so it keeps
                  // showing every conversation, as it always has.
                  const folded = showHeads && !isCollapsed && !!foldedGroups[s.key];
                  // Folded rows stay mounted inside a fold (railFold), so
                  // folding a section — or the rail un-folding every section
                  // at once as it opens — slides smoothly instead of popping
                  // rows in and out, and their avatars never reload.
                  return (
                    <React.Fragment key={s.key}>
                      {showHeads ? groupHeader(s, bucket.length, folded, si === 0) : null}
                      <div style={railFold(!folded)} aria-hidden={folded ? 'true' : undefined}>
                        <div style={RAIL_FOLD_INNER}>
                          {bucket.map((m,i) => renderRow(m, {lastInGroup: i===bucket.length-1}))}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </>
            );
          })()}
        </div>

        </div>{/* end rows */}

        {/* Collapsed rail: settings gear pinned to the bottom, one circle the
            same size as the contact avatars, on the same centre line. */}
        <div style={railFold(isCollapsed, {flexShrink:0})} aria-hidden={isCollapsed ? undefined : 'true'}>
          <div style={RAIL_FOLD_INNER}>
            <div className="sset-rbot sset-rbot-stack" style={{width:64}}>
              {!isGuest && typeof DmShareButton !== 'undefined' && <DmShareButton/>}
              {!isGuest && <SettingsGearButton on={settingsOn} onClick={setPop.toggle}/>}
            </div>
          </div>
        </div>
        </div>{/* end contact content */}

        {/* Resize grip — right edge. Not in one-pane mode: there is no
            second column to trade width with. */}
        {!single && <div
          ref={resizeRef}
          onPointerDown={startResize}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onDoubleClick={(e)=>{
            // Same width transition as a snap, so the same suspension.
            const pane = e.currentTarget.closest('[data-msgpane]');
            // Opening from the rail never takes more than the chat can spare.
            let target = panelW < COLLAPSED_THRESHOLD ? bcAutoListW() : 64;
            // Collapsing is your choice (kept); opening again follows the window.
            markPanelSized(target === 64);
            if (target > 64 && pane) {
              const maxW = Math.floor(pane.getBoundingClientRect().width - PANE_CHAT_MIN_W);
              if (maxW < 140) return;
              target = Math.min(target, maxW);
            }
            // Hold the chat first, then start the transition on the next
            // frame, so the layer promotion and the first frame of motion
            // are never paid for in the same frame.
            const curW = contactRef.current
              ? Math.round(contactRef.current.getBoundingClientRect().width) : panelW;
            CHAT_PANEL_MOTION.begin(pane, curW, target);
            suspendPanelMeasuring(RAIL_MS + (CHAT_PANEL_MOTION.active ? 80 : 60));
            if (CHAT_PANEL_MOTION.active) requestAnimationFrame(() => setPanelW(target));
            else setPanelW(target);
          }}
          title="Drag to resize · double-click to collapse"
          style={{
            position:'absolute', top:0, right:0, height:'100%',
            width: 6,
            cursor:'col-resize',
            zIndex: 10,
            background: (resizing || gripHover) ? 'rgba(150,148,200,0.30)' : 'transparent',
            transition:'background 0.15s, width 0.15s',
          }}
          onMouseEnter={()=>setGripHover(true)}
          onMouseLeave={()=>setGripHover(false)}
        >
          {/* Visual grip dots — hover and drag only. `resizing` keeps them
              up mid-drag, when the pointer has usually left the strip. */}
          <div style={{
            position:'absolute', top:'50%', left:'50%',
            transform:'translate(-50%,-50%)',
            display:'flex', flexDirection:'column', gap:3,
            opacity: (resizing || gripHover) ? 0.9 : 0,
            transition:'opacity 0.15s',
            pointerEvents:'none',
          }}>
            {[0,1,2,3,4].map(i=>(
              <div key={i} style={{width:2,height:2,borderRadius:'50%',background:'rgba(180,184,200,0.7)'}}/>
            ))}
          </div>
        </div>}
      </div>

      {/* ── SETTINGS SIDE POPUP ──
          Rendered here (sibling to the contact panel, outside its overflow:hidden)
          so it isn't clipped. backdrop-filter on .sset-sheet traps position:fixed
          children, so the popup must live outside that ancestor entirely. */}
      {setPop.activeRow && (
        <TopLayer>
          <SettingsSubPanelPopup
            activeRow={setPop.activeRow}
            popClosing={setPop.popClosing}
            tweaks={tweaks}
            setTweak={setTweak}
            onClose={setPop.closeNow}
            onPick={setPop.pick}
          />
        </TopLayer>
      )}

      {/* ── RIGHT CHAT PANEL ──
          Both EmptyChatAvatar and InPageChat are always mounted.
          Toggling via display:none (not conditional rendering) prevents:
            • Ghost entry animation re-playing on dashboard return
            • ipc-hdr layout jump on every chat open/close
            • InPageChat scroll position loss between back-nav hops
          EmptyChatAvatar uses position:absolute so it doesn't participate
          in flex layout when a chat is open (InPageChat owns the space). */}
      <div ref={chatPaneRef} aria-hidden={paneView === 'list' ? 'true' : undefined} style={{
        flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden',position:'relative',
        // One pane: the chat fills the inbox; with no chat open this
        // column steps aside for the full-width list.
        ...(single ? {
          position:'absolute', top:0, left:0, right:0, bottom:0,
          zIndex: paneView === 'chat' ? 2 : 1,
        } : null),
        ...(paneView === 'list' ? PANE_HIDDEN : null),
      }}>
        {/* EmptyChatAvatar — always mounted, hidden behind InPageChat when a chat is open */}
        <div style={{
          position: shownChat ? 'absolute' : 'relative',
          inset: 0,
          display: 'flex', flexDirection: 'column',
          visibility: shownChat ? 'hidden' : 'visible',
          // pointer-events off while hidden so clicks don't land on the ghost
          pointerEvents: shownChat ? 'none' : 'auto',
          zIndex: 0,
        }}>
          {/* inChat also covers one-pane mode: there the dashboard is hidden
              behind the full-width list, and the chips it owns (payment
              activity + notifications, portalled to the top-right corner)
              would otherwise sit on top of the list's header. */}
          {isGuest ? <GuestEmptyPane/> : <EmptyChatAvatar liveMsgs={briefMsgs} inChat={!!inPageChat || single}/>}
        </div>
        {/* InPageChat — mounted once a msg is known, hidden when returning to dashboard.
            Uses position:absolute to overlay the EmptyChatAvatar slot exactly. */}
        {shownChat && (
          <div style={{
            position:'absolute', inset:0,
            display:'flex', flexDirection:'column',
            zIndex: 1,
          }}>
            {/* The ghost gets its own component rather than a flag threaded
                through InPageChat. InPageChat is built entirely around a real
                conversation — MSGS_STORE threads, DRAFT_STORE, BotBridge
                sends, agent assignment, the customer-record panel — and none
                of it applies to the ghost. GhostChat reuses the same .ipc
                CSS classes and ChatBubbleRow so the layout is identical. */}
            {shownChat.__ghost ? (
              <GhostChat
                onClose={closeChat}
                onBack={backProp}
                backTarget={backTarget}
                chatWidth={tweaks.chatWidth}
              />
            ) : shownChat.__direct ? (
              // Encrypted account-to-account chat: its own view, fed by
              // DM_STORE, so no platform/AI code path can touch it.
              <DirectChat
                msg={shownChat}
                onClose={closeChat}
                onBack={backProp}
                backTarget={backTarget}
                chatWidth={tweaks.chatWidth}
              />
            ) : (
              <InPageChat
                msg={shownChat}
                onClose={closeChat}
                onBack={backProp}
                backTarget={backTarget}
                chatWidth={tweaks.chatWidth}
              />
            )}
          </div>
        )}
      </div>
      {/* ── Widget dashboard overlay — lives HERE at MsgList level, NOT inside
          EmptyChatAvatar, so it is never unmounted when inPageChat toggles.
          It is position:fixed so it has no effect on this flex layout.
          We pass `hidden` while a chat is open so the dashboard, widgets,
          ghost composer and ghost overlay canvases are visually suppressed
          (via body[data-bcw-hidden="1"] CSS) without losing their state. ── */}
      {/* One-pane mode has no room for the dashboard, so it stays hidden
          (and the ghost paused) there even with no chat open. */}
      {!isGuest && <BcwOverlayMount hidden={!!inPageChat || single} ghost={!!(inPageChat && inPageChat.__ghost)}/>}
      {/* Guest chat: "Create account" and "End session" windows. */}
      {typeof GuestPromptsHost !== 'undefined' && <GuestPromptsHost/>}
    </div>
  );
};

// ── DASHBOARD ────────────────────────────────────────────────

// Glass card style helper
// Note: previously used backdrop-filter blur(24px) on every card. With ~7
// cards on the Dashboard each one allocated its own offscreen blur surface,
// which slowed paint significantly on lower-end GPUs. Switched to a flat
// translucent fill — at the opacity used here you can't visually tell the
// difference, and the dashboard now scrolls fluidly.
// Unified premium surface — used on every page so panels look identical.
// Solid enough that the aurora doesn't bleed through and wash out labels;
// gentle blur+saturate to keep the glassy feel; soft drop shadow + 1px inset
// highlight seat the panel forward off the background.
const G = {
  card: {
    background:'rgba(20,22,42,0.82)',
    backdropFilter:'blur(20px) saturate(160%)',
    WebkitBackdropFilter:'blur(20px) saturate(160%)',
    border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:13,
    boxShadow:'0 4px 32px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.05) inset',
  },
  cardInner: {
    background:'rgba(255,255,255,0.03)',
    border:'1px solid rgba(255,255,255,0.06)',
    borderRadius:10,
  },
};

const Sparkline = ({data, color='#6c63ff', w=70, h=28}) => {
  if(!data||data.length<2) return null;
  const max=Math.max(...data), min=Math.min(...data);
  const range=max-min||1;
  const px=(i)=>(i/(data.length-1))*w;
  const py=(v)=>h-((v-min)/range)*(h*0.78)-h*0.1;
  const pts=data.map((v,i)=>[px(i),py(v)]);
  const line=pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const area=`${line}L${w},${h}L0,${h}Z`;
  const id=`sp${Math.abs(color.split('').reduce((a,c)=>a+c.charCodeAt(0),0))}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:'block',overflow:'visible',flexShrink:0}}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`}/>
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

const SalesChart = ({series, labels}) => {
  const ref = React.useRef(null);
  const [size, setSize] = React.useState({w:0, h:120});
  React.useEffect(()=>{
    if(!ref.current) return;
    const ro = new ResizeObserver(e=>{
      const {width,height} = e[0].contentRect;
      setSize({w:Math.max(1,width), h:Math.max(1,height)});
    });
    ro.observe(ref.current);
    return ()=>ro.disconnect();
  },[]);

  const {w:W, h:H} = size;
  const PAD_L=44, PAD_R=14, PAD_T=18, PAD_B=26;
  const cW=W-PAD_L-PAD_R, cH=H-PAD_T-PAD_B;

  const allVals=series.flatMap(s=>s.data);
  const max=Math.max(...allVals), minV=Math.min(...allVals)*0.85;
  const range=max-minV||1;
  const n=series[0].data.length;
  const tx=i=>PAD_L+(i/(n-1))*cW;
  const ty=v=>PAD_T+cH-((v-minV)/range)*cH;
  const yTicks=[0,0.33,0.66,1].map(t=>minV+t*range);

  return (
    <div ref={ref} style={{width:'100%',height:'100%',minHeight:0}}>
      {W>0&&H>0&&(
        <svg width={W} height={H} style={{display:'block',overflow:'visible'}}>
          <defs>
            {series.map(s=>(
              <linearGradient key={s.key} id={`cg3-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.22"/>
                <stop offset="100%" stopColor={s.color} stopOpacity="0"/>
              </linearGradient>
            ))}
          </defs>
          {yTicks.map((v,i)=>{
            const y=ty(v);
            return (
              <g key={i}>
                <line x1={PAD_L} y1={y} x2={W-PAD_R} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3,5"/>
                <text x={PAD_L-6} y={y+3.5} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.28)" fontFamily="JetBrains Mono,monospace">
                  {v>=1000?`$${(v/1000).toFixed(1)}k`:Math.round(v)}
                </text>
              </g>
            );
          })}
          {series.map(s=>{
            const pts=s.data.map((v,i)=>[tx(i),ty(v)]);
            const lp=pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
            const baseY=ty(minV);
            const ap=`${lp}L${pts[pts.length-1][0].toFixed(1)},${baseY}L${pts[0][0].toFixed(1)},${baseY}Z`;
            return (
              <g key={s.key}>
                <path d={ap} fill={`url(#cg3-${s.key})`}/>
                <path d={lp} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="3.5" fill={s.color} stroke="rgba(13,14,23,0.8)" strokeWidth="1.5"/>
              </g>
            );
          })}
          {labels.map((l,i)=>(
            <text key={i} x={tx(i)} y={H-4} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.28)" fontFamily="JetBrains Mono,monospace">{l}</text>
          ))}
        </svg>
      )}
    </div>
  );
};

// ── DONUT CHART ───────────────────────────────────────────────
const DonutChart = ({segments}) => {
  const containerRef = React.useRef(null);
  const [dims, setDims] = React.useState({w:0,h:0});
  React.useEffect(()=>{
    if(!containerRef.current) return;
    const ro = new ResizeObserver(e=>{
      const {width,height} = e[0].contentRect;
      setDims({w:Math.floor(width), h:Math.floor(height)});
    });
    ro.observe(containerRef.current);
    return ()=>ro.disconnect();
  },[]);

  const total = segments.reduce((a,s)=>a+s.val,0)||1;
  const converted = segments.find(s=>s.key==='customer');
  const pct = converted ? Math.round((converted.val/total)*100) : 0;

  // Size the donut to fill available height, capped so legend always fits beside it
  const LEGEND_W = 112;
  const GAP = 14;
  const size = dims.h > 0 ? Math.min(dims.h, dims.w - LEGEND_W - GAP) : 0;
  const cx=size/2, cy=size/2;
  const r=size*0.42, inner=size*0.27;

  let angle=-Math.PI/2;
  const paths = size > 0 ? segments.map(s=>{
    const slice=(s.val/total)*Math.PI*2;
    const a0=angle, a1=angle+slice-0.025;
    const x1=cx+r*Math.cos(a0), y1=cy+r*Math.sin(a0);
    const x2=cx+r*Math.cos(a1), y2=cy+r*Math.sin(a1);
    const xi1=cx+inner*Math.cos(a0), yi1=cy+inner*Math.sin(a0);
    const xi2=cx+inner*Math.cos(a1), yi2=cy+inner*Math.sin(a1);
    const large=slice>Math.PI?1:0;
    const d=`M${xi1.toFixed(2)},${yi1.toFixed(2)} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r},0,${large},1,${x2.toFixed(2)},${y2.toFixed(2)} L${xi2.toFixed(2)},${yi2.toFixed(2)} A${inner},${inner},0,${large},0,${xi1.toFixed(2)},${yi1.toFixed(2)}Z`;
    angle+=slice;
    return {d, color:s.color, label:s.label, val:s.val, key:s.key};
  }) : [];

  const centerFontSize = Math.max(12, Math.round(size * 0.155));
  const labelFontSize  = Math.max(9,  Math.round(size * 0.072));

  return (
    <div ref={containerRef} style={{flex:1,minHeight:0,display:'flex',alignItems:'center',width:'100%',overflow:'hidden'}}>
      {size > 0 && (
        <>
          {/* Donut SVG */}
          <div style={{position:'relative',flexShrink:0,width:size,height:size}}>
            <svg width={size} height={size} style={{display:'block'}}>
              {paths.map((p,i)=>(
                <path key={i} d={p.d} fill={p.color} opacity="0.90"/>
              ))}
            </svg>
            <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',textAlign:'center',pointerEvents:'none',lineHeight:1}}>
              <div style={{fontSize:centerFontSize,fontWeight:700,color:'rgba(255,255,255,0.93)',fontFamily:'var(--mono)',lineHeight:1}}>{pct}%</div>
              <div style={{fontSize:Math.max(7,centerFontSize*0.48),color:'rgba(255,255,255,0.35)',marginTop:3,letterSpacing:'0.07em'}}>CONV</div>
            </div>
          </div>

          {/* Legend — right side, vertically centered */}
          <div style={{flex:1,minWidth:0,paddingLeft:GAP,display:'flex',flexDirection:'column',justifyContent:'center',gap:Math.max(5, Math.round(size*0.055))}}>
            {segments.map((s,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:7}}>
                <div style={{width:6,height:6,borderRadius:'50%',background:s.color,flexShrink:0,boxShadow:`0 0 4px ${s.color}80`}}/>
                <span style={{fontSize:labelFontSize,color:'rgba(255,255,255,0.52)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.label}</span>
                <span style={{fontSize:labelFontSize,fontWeight:600,color:'rgba(255,255,255,0.75)',fontFamily:'var(--mono)',flexShrink:0}}>{s.val}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const ACTIVITY = [
  {text:'Bot replied to Alex Chen',           sub:'Sales Bot · Telegram',       col:'#6c63ff', t:'2m'},
  {text:'Nina Patel purchased Business plan', sub:'$199 · conversion',           col:'#43c98a', t:'14m'},
  {text:'Emma Wilson escalated to human',     sub:'Support Bot · needs help',    col:'#e87550', t:'18m'},
  {text:'James Brown stage → Prospect',       sub:'Sales Bot updated',            col:'#e8a844', t:'1h'},
  {text:'Mike Johnson resolved',              sub:'Support Bot · satisfied',      col:'#43c98a', t:'2h'},
  {text:'Olivia Park upgraded to annual',     sub:'VIP Bot · $948/yr',            col:'#e8883a', t:'3h'},
  {text:'Bot replied to Ryan Scott',          sub:'Sales Bot · Discord',          col:'#6c63ff', t:'3h'},
  {text:'Chloe Wang renewed subscription',    sub:'VIP Bot · retention',          col:'#d060d0', t:'4h'},
  {text:'David Lee requested demo',           sub:'Sales Bot · booked',           col:'#5b9cf0', t:'5h'},
  {text:'Sarah Martinez converted to Pro',    sub:'$79 · conversion',             col:'#43c98a', t:'6h'},
];

const PURCHASES = [
  {id:1, name:'Alex Chen',     pkg:'Pro',        price:'$79',  t:'2m',  col:'#7c6ef5'},
  {id:2, name:'Nina Patel',    pkg:'Business',   price:'$199', t:'14m', col:'#e060c0'},
  {id:3, name:'Olivia Park',   pkg:'Pro + Analytics+', price:'$98', t:'1h', col:'#e8883a'},
  {id:4, name:'James Brown',   pkg:'Starter',    price:'$29',  t:'2h',  col:'#9b7ff0'},
  {id:5, name:'Chloe Wang',    pkg:'Business',   price:'$199', t:'3h',  col:'#d060d0'},
  {id:6, name:'Tom Harris',    pkg:'Agent Studio','price':'$39', t:'5h', col:'#45c98a'},
];

const Dashboard = ({openChat}) => {
  const LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const [chartMode, setChartMode] = React.useState('revenue');
  const [gearOpen,  setGearOpen]  = React.useState(false);
  const gearRef = React.useRef(null);
  React.useEffect(()=>{
    if(!gearOpen) return;
    const h=e=>{ if(gearRef.current&&!gearRef.current.contains(e.target)) setGearOpen(false); };
    window.addEventListener('mousedown',h);
    return()=>window.removeEventListener('mousedown',h);
  },[gearOpen]);

  const CHART_MODES = {
    revenue:  {label:'Revenue & Conversations', series:[
      {key:'rev',  data:[1240,1580,1390,1720,2140,1680,1950], color:'#6c63ff', label:'Revenue ($)'},
      {key:'conv', data:[220,310,260,350,420,310,390],         color:'#43c98a', label:'Conversations'},
    ]},
    platforms:{label:'Telegram vs Discord', series:[
      {key:'tg', data:[140,195,162,218,268,198,248], color:'#2AABEE', label:'Telegram'},
      {key:'dc', data:[80, 115,98, 132,152,112,142], color:'#5865F2', label:'Discord'},
    ]},
    stages:   {label:'Stage Distribution', series:[
      {key:'cust', data:[12,14,13,16,18,15,17], color:'#43c98a', label:'Customers'},
      {key:'pros', data:[8, 10,9, 12,14,11,13], color:'#e8a844', label:'Prospects'},
      {key:'new',  data:[22,28,24,32,38,28,34], color:'#5b9cf0', label:'New Leads'},
    ]},
    products: {label:'Product Sales', series:[
      {key:'pro',  data:[14,18,16,20,26,19,22], color:'#6c63ff', label:'Pro'},
      {key:'biz',  data:[8, 10,9, 12,15,11,13], color:'#43c98a', label:'Business'},
      {key:'str',  data:[6, 8, 7, 9, 11,8, 10], color:'#32ade6', label:'Starter'},
    ]},
  };

  const chartSeries = CHART_MODES[chartMode].series;

  const stats = [
    {label:'Revenue',       value:'$14.7k', delta:'+18%', up:true,  c:'#8b83ff', spark:[820,950,1100,980,1240,1580,1390,1720,2140,1680,1950]},
    {label:'Conversations', value:'2,261',  delta:'+12%', up:true,  c:'#43c98a', spark:[180,220,200,260,310,260,350,420,310,390,380]},
    {label:'AI Replies',    value:'1,847',  delta:'+28%', up:true,  c:'#32ade6', spark:[120,150,140,180,210,180,240,300,220,280,260]},
    {label:'Resolution',    value:'83%',    delta:'+5%',  up:true,  c:'#e8c040', spark:[72,75,78,74,79,81,80,83,85,82,83]},
  ];
  const bestSellers = [
    {name:'Pro',          price:'$79/mo',  sales:43, pct:100, c:'#6c63ff'},
    {name:'Business',     price:'$199/mo', sales:28, pct:65,  c:'#43c98a'},
    {name:'Starter',      price:'$29/mo',  sales:22, pct:51,  c:'#32ade6'},
    {name:'Agent Studio', price:'$39/mo',  sales:18, pct:42,  c:'#e8a844'},
    {name:'Analytics+',   price:'$19/mo',  sales:14, pct:33,  c:'#e060c0'},
  ];
  const donutSegments = [
    {key:'customer',    label:'Customers',  val:5,  color:'#43c98a'},
    {key:'purchasing',  label:'Purchasing', val:2,  color:'#9b7ff0'},
    {key:'prospect',    label:'Prospect',   val:2,  color:'#e8a844'},
    {key:'new',         label:'New Leads',  val:2,  color:'#5b9cf0'},
    {key:'needs_help',  label:'Needs Help', val:2,  color:'#e87550'},
    {key:'churned',     label:'Churned',    val:1,  color:'#44445c'},
  ];

  return (
    <div style={{padding:'10px 12px', display:'flex', flexDirection:'column', gap:8, height:'100%', boxSizing:'border-box', overflow:'hidden'}}>

      {/* ── ROW 1: 4 STAT CARDS ── */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, flexShrink:0}}>
        {stats.map((s,i)=>(
          <div key={i} style={{...G.card, padding:'16px 18px', display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:9,fontWeight:700,color:'rgba(255,255,255,0.30)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:7}}>{s.label}</div>
              <div style={{fontSize:28,fontWeight:700,color:s.c,letterSpacing:'-0.03em',fontFamily:'var(--mono)',lineHeight:1,marginBottom:6}}>{s.value}</div>
              <div style={{fontSize:10.5,fontWeight:600,color:s.up?'#43c98a':'#e87550'}}>{s.delta} <span style={{color:'rgba(255,255,255,0.20)',fontWeight:400}}>vs last wk</span></div>
            </div>
            <Sparkline data={s.spark} color={s.c} w={72} h={36}/>
          </div>
        ))}
      </div>

      {/* ── ROW 2: CONVERSION | CHART | PURCHASES ── */}
      <div style={{display:'grid', gridTemplateColumns:'220px 1fr 240px', gap:8, flexShrink:0, height:320, overflow:'hidden'}}>

        {/* Conversion Donut — LEFT anchor */}
        <div style={{...G.card, padding:'16px 16px', display:'flex', flexDirection:'column', overflow:'hidden'}}>
          <div style={{fontSize:9,fontWeight:700,color:'rgba(255,255,255,0.30)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10,flexShrink:0}}>Conversion</div>
          <DonutChart segments={donutSegments}/>
        </div>

        {/* Chart — hero, fills all middle space */}
        <div style={{...G.card, padding:'16px 18px', display:'flex', flexDirection:'column', overflow:'hidden'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,flexShrink:0}}>
            <div>
              <div style={{fontSize:13.5,fontWeight:600,color:'rgba(255,255,255,0.92)',letterSpacing:'-0.02em'}}>{CHART_MODES[chartMode].label}</div>
              <div style={{fontSize:9.5,color:'rgba(255,255,255,0.28)',marginTop:2}}>Last 7 days</div>
            </div>
            <div style={{display:'flex',gap:14,alignItems:'center'}}>
              {chartSeries.map(s=>(
                <div key={s.key} style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{width:20,height:2.5,borderRadius:2,background:s.color}}/>
                  <span style={{fontSize:10,color:'rgba(255,255,255,0.38)'}}>{s.label}</span>
                </div>
              ))}
              <div style={{position:'relative'}} ref={gearRef}>
                <button onClick={()=>setGearOpen(o=>!o)} style={{width:26,height:26,borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',background:gearOpen?'rgba(108,99,255,0.2)':'rgba(255,255,255,0.06)',border:`1px solid ${gearOpen?'rgba(108,99,255,0.4)':'rgba(255,255,255,0.09)'}`,cursor:'pointer',color:'rgba(255,255,255,0.4)',transition:'all 0.12s'}}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
                {gearOpen&&(
                  <div style={{position:'absolute',top:'calc(100% + 6px)',right:0,zIndex:50,background:'rgba(14,15,28,0.97)',backdropFilter:'blur(20px)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'5px',minWidth:190,boxShadow:'0 12px 40px rgba(0,0,0,0.6)'}}>
                    {Object.entries(CHART_MODES).map(([key,mode])=>(
                      <button key={key} onClick={()=>{setChartMode(key);setGearOpen(false);}} style={{width:'100%',textAlign:'left',padding:'7px 10px',borderRadius:7,fontSize:11,fontWeight:500,cursor:'pointer',transition:'all 0.1s',background:chartMode===key?'rgba(108,99,255,0.18)':'transparent',color:chartMode===key?'rgba(168,156,247,0.95)':'rgba(255,255,255,0.45)',border:chartMode===key?'1px solid rgba(108,99,255,0.3)':'1px solid transparent',display:'flex',alignItems:'center',gap:8}}>
                        {chartMode===key?<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>:<span style={{width:8,display:'inline-block'}}/>}
                        {mode.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={{flex:1,minHeight:0}}>
            <SalesChart series={chartSeries} labels={LABELS}/>
          </div>
        </div>

        {/* Recent Purchases — RIGHT anchor */}
        <div style={{...G.card, padding:'16px 16px', display:'flex', flexDirection:'column', overflow:'hidden'}}>
          <div style={{fontSize:9,fontWeight:700,color:'rgba(255,255,255,0.30)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:12,flexShrink:0}}>Recent Purchases</div>
          <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'space-between'}}>
            {PURCHASES.slice(0,5).map((p,idx)=>(
              <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'5px 0',borderBottom:idx<4?'1px solid rgba(255,255,255,0.05)':'none'}}>
                <Ava name={p.name} col={p.col} sz={28}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:500,color:'rgba(255,255,255,0.88)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                  <div style={{fontSize:9,color:'rgba(255,255,255,0.30)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.pkg}</div>
                </div>
                <span style={{fontSize:10,fontWeight:700,fontFamily:'var(--mono)',padding:'3px 7px',borderRadius:20,background:'rgba(67,201,138,0.12)',border:'1px solid rgba(67,201,138,0.26)',color:'rgba(67,201,138,0.90)',flexShrink:0,whiteSpace:'nowrap'}}>{p.price}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── ROW 3: CONVERSATIONS | ACTIVITY | BEST SELLERS ── */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 280px', gap:8, flex:1, minHeight:0, overflow:'hidden'}}>

        {/* Recent Conversations */}
        <div style={{...G.card, padding:'14px 16px', display:'flex', flexDirection:'column', overflow:'hidden'}}>
          <div style={{fontSize:9,fontWeight:700,color:'rgba(255,255,255,0.30)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10,flexShrink:0}}>Recent Conversations</div>
          <div style={{display:'flex',flexDirection:'column',flex:1,overflowY:'auto',gap:0}}>
            {MSGS.map((m)=>{
              const ais=AISTATUS[m.ai]||AISTATUS.paused;
              return (
                <div key={m.id} onClick={()=>openChat(m)}
                  style={{display:'flex',alignItems:'center',gap:10,padding:'8px 6px',borderRadius:8,cursor:'pointer',transition:'background 0.1s',borderBottom:'1px solid rgba(255,255,255,0.05)'}}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.04)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <div style={{position:'relative',flexShrink:0}}>
                    <Ava name={m.name} col={m.col} sz={28} src={m.avatar}/>
                    <span className="status-dot" style={{'--sc':ais.col,'--pulse':ais.pulse?1:0,position:'absolute',bottom:0,right:0,boxShadow:'0 0 0 1.5px rgba(13,14,23,0.9)'}}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:2}}>
                      <span style={{fontSize:11.5,fontWeight:500,color:'rgba(255,255,255,0.88)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name}</span>
                      {m.stage==='needs_help'&&<span style={{fontSize:7.5,fontWeight:700,letterSpacing:'0.06em',padding:'1px 5px',borderRadius:3,background:'rgba(232,117,80,0.1)',border:'1px solid rgba(232,117,80,0.22)',color:'rgba(232,140,100,0.85)',flexShrink:0}}>HELP</span>}
                    </div>
                    <div style={{fontSize:9.5,color:'rgba(255,255,255,0.30)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><BcPreviewText text={m.last}/></div>
                  </div>
                  <span style={{fontSize:9,color:'rgba(255,255,255,0.22)',fontFamily:'var(--mono)',flexShrink:0}}>{m.t}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div style={{...G.card, padding:'14px 16px', display:'flex', flexDirection:'column', overflow:'hidden'}}>
          <div style={{fontSize:9,fontWeight:700,color:'rgba(255,255,255,0.30)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10,flexShrink:0}}>Recent Activity</div>
          <div style={{display:'flex',flexDirection:'column',flex:1,overflowY:'auto',gap:0}}>
            {ACTIVITY.map((a,i)=>(
              <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'9px 6px',borderRadius:8,borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                <div style={{width:7,height:7,borderRadius:'50%',background:a.col,flexShrink:0,marginTop:3,boxShadow:`0 0 6px ${a.col}90`}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11.5,color:'rgba(255,255,255,0.72)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>{a.text}</div>
                  <div style={{fontSize:9.5,color:'rgba(255,255,255,0.30)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.sub}</div>
                </div>
                <span style={{fontSize:9,color:'rgba(255,255,255,0.25)',fontFamily:'var(--mono)',flexShrink:0,marginTop:1}}>{a.t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Best Sellers */}
        <div style={{...G.card, padding:'16px 18px', display:'flex', flexDirection:'column', overflow:'hidden'}}>
          <div style={{fontSize:9,fontWeight:700,color:'rgba(255,255,255,0.30)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:14,flexShrink:0}}>Best Sellers</div>
          <div style={{display:'flex',flexDirection:'column',justifyContent:'space-between',flex:1}}>
            {bestSellers.map((p,i)=>(
              <div key={i}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:7}}>
                  <span style={{fontSize:12.5,fontWeight:500,color:'rgba(255,255,255,0.88)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,marginRight:10}}>{p.name}</span>
                  <span style={{fontSize:12,fontWeight:700,color:p.c,fontFamily:'var(--mono)',flexShrink:0}}>{p.sales}</span>
                </div>
                <div style={{height:5,background:'rgba(255,255,255,0.07)',borderRadius:5}}>
                  <div style={{height:'100%',width:`${p.pct}%`,background:`linear-gradient(90deg,${p.c}ee,${p.c}44)`,borderRadius:5,transition:'width 0.3s ease'}}/>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );

};

// ── AGENTS VIEW — Two-pane: list left, tabbed config right ──
const RESPONSE_STYLES = [
  {id:'human',  label:'Human (Natural)', desc:'Pauses, typos, varied length'},
  {id:'pro',    label:'Professional',     desc:'Concise, polished, business tone'},
  {id:'casual', label:'Casual & Friendly',desc:'Conversational, warm, light emoji'},
  {id:'expert', label:'Technical Expert', desc:'Precise, detailed, references docs'},
  {id:'concise',label:'Ultra Concise',    desc:'One-line replies, no fluff'},
];
const TONES = ['Friendly','Neutral','Formal','Playful','Empathetic','Confident'];

// ── Inline toggle switch ──────────────────────────────────────
// Rendered as a span: every place it's used sits inside a clickable card
// or row that already handles the click, and a <button> nested in a
// <button> is invalid HTML that some engines split apart.
const InlineToggle = ({value}) => (
  <span aria-hidden="true" className="bc-switch" data-on={value ? '1' : '0'}/>
);

// ── Slim toggle row ───────────────────────────────────────────
const ToggleRow = ({label, hint, value, onChange}) => {
  const on = !!value;
  return (
    <div className="sset-form-row" style={{cursor:'pointer'}} onClick={()=>onChange(!on)}
      role="switch" aria-checked={on} tabIndex={0}
      onKeyDown={e=>{ if (e.key===' '||e.key==='Enter') { e.preventDefault(); onChange(!on); } }}>
      <label className="sset-form-label" style={{pointerEvents:'none'}}>
        {label}
        {hint && <span className="sset-form-hint">{hint}</span>}
      </label>
      <div className="sset-form-row-ctl">
        <span className="bc-switch" data-on={on ? '1' : '0'} aria-hidden="true"/>
      </div>
    </div>
  );
};

// ── Agent card in the list ────────────────────────────────────
// Status is the switch on the right; the row itself dims when the agent is
// paused. "Outside reply hours" is a detail, so it lives in the grey line
// under the name rather than in a coloured badge.
const AgentListItem = ({agent, selected, onClick, onToggle}) => {
  const initial = ((agent.name||'?').trim().charAt(0) || '?').toUpperCase();
  const offHours = agent.active && agent.schedule && agent.schedule.enabled && !SCHEDULE_GATE.isOpen(agent.schedule);
  return (
    <div role="button" tabIndex={0} onClick={onClick}
      onKeyDown={e=>{ if (e.target===e.currentTarget && (e.key==='Enter'||e.key===' ')) { e.preventDefault(); onClick(); } }}
      className="sset-list-row" data-on={selected?'1':'0'} data-off={agent.active?'0':'1'}
      style={{padding:'9px 11px'}}>
      <span style={{width:32,height:32,borderRadius:9,flexShrink:0,
        background:'linear-gradient(135deg,rgba(60,62,82,0.95),rgba(40,42,62,0.95))',
        border:'1px solid rgba(255,255,255,0.08)',
        display:'flex',alignItems:'center',justifyContent:'center',
        fontSize:12.5,fontWeight:600,color:'var(--t1)',letterSpacing:'-0.01em',
        opacity:agent.active?1:0.55}}>{initial}</span>
      <span style={{flex:1,minWidth:0,display:'block'}}>
        <span style={{display:'block',fontSize:12,fontWeight:600,color:'var(--t1)',letterSpacing:'-0.005em',
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{agent.name||'Untitled'}</span>
        <span style={{display:'block',fontSize:10.5,color:'#8a8aa8',marginTop:2,
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}
          title={agent.schedule && agent.schedule.enabled ? 'Reply hours: ' + SCHEDULE_GATE.describe(agent.schedule) : undefined}>
          <span style={{fontFamily:'var(--mono)',fontSize:10}}>{agent.model}</span>
          {!agent.active ? ' · Paused' : offHours ? ' · Outside hours' : ''}
        </span>
      </span>
      <button type="button" className="bc-switch" role="switch" aria-checked={!!agent.active}
        data-on={agent.active ? '1' : '0'}
        aria-label={agent.active ? `Pause ${agent.name||'agent'}` : `Activate ${agent.name||'agent'}`}
        title={agent.active ? 'Active — click to pause' : 'Paused — click to activate'}
        onClick={e=>{ e.stopPropagation(); if (onToggle) onToggle(agent); }}/>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--t4)',flexShrink:0,opacity:0.55}}><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  );
};

// ── Section card ─────────────────────────────────────────────
const AgCard = ({children, style={}, compact=false}) => {
  // Compact (popup) presentation: an uppercase section label sitting above
  // a single grouped card — the same rhythm every other settings popup
  // uses. The first child, if it is an AgCardHead, becomes that label.
  if (compact) {
    const kids = React.Children.toArray(children);
    const hasHead = kids.length > 0 && kids[0] && kids[0].type === AgCardHead;
    const head = hasHead ? kids[0] : null;
    const body = hasHead ? kids.slice(1) : kids;
    return (
      <div className="sset-pop-section" style={style}>
        {head}
        <div style={{
          background:'rgba(255,255,255,0.022)',
          border:'1px solid rgba(255,255,255,0.055)',
          borderRadius:10, padding:'10px 12px',
          display:'flex', flexDirection:'column', gap:10,
        }}>{body}</div>
      </div>
    );
  }
  return (
    <div className="ag-card" style={{
      background:'rgba(12,13,26,0.52)',
      backdropFilter:'blur(20px) saturate(160%)',
      WebkitBackdropFilter:'blur(20px) saturate(160%)',
      border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:13,
      padding:'14px 18px',
      display:'flex', flexDirection:'column', gap:12,
      ...style}}>
      {children}
    </div>
  );
};

// ── Card heading row ──────────────────────────────────────────
// Two presentations:
//   • Default (full-page): icon chip + title + subtitle, with bottom border.
//   • Compact (embed): subtle uppercase label only — matches the Catalog
//     popup's section style ("PRICING & AVAILABILITY" / "FEATURES") so
//     all popup sections share the same understated rhythm.
const AgCardHead = ({icon, title, subtitle, compact=false}) => {
  // In the popup the subtitle only restated the label ("Identity / Name,
  // model and status"), so compact mode shows the label alone. A null
  // title renders nothing — used when the tab name already says it.
  if (compact) {
    return title ? <div className="sset-pop-section-label">{title}</div> : null;
  }
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,paddingBottom:10,borderBottom:'1px solid rgba(255,255,255,0.05)',marginBottom:0}}>
      <div style={{width:24,height:24,borderRadius:7,flexShrink:0,
        background:'rgba(255,255,255,0.05)',
        border:'1px solid rgba(255,255,255,0.10)',
        display:'flex',alignItems:'center',justifyContent:'center',color:'var(--t2)'}}>
        {icon}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,fontWeight:600,color:'var(--t1)',letterSpacing:'-0.01em'}}>{title}</div>
        {subtitle && <div style={{fontSize:10.5,color:'var(--t3)',marginTop:1,lineHeight:1.3}}>{subtitle}</div>}
      </div>
    </div>
  );
};

// ── Field label ───────────────────────────────────────────────
const Field = ({label, hint, children}) => (
  <div className="sset-field">
    {label && <label className="sset-field-label">{label}</label>}
    {children}
    {hint && <span className="sset-form-hint" style={{marginTop:0}}>{hint}</span>}
  </div>
);

// ── SectionDivider (still used by ProductsView & SettingsView) ─
const SectionDivider = ({label}) => (
  <div style={{display:'flex',alignItems:'center',gap:10,paddingTop:2}}>
    <span style={{fontSize:9.5,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'0.1em'}}>{label}</span>
    <span style={{flex:1,height:1,background:'rgba(255,255,255,0.06)'}}/>
  </div>
);

// ── Task chip ─────────────────────────────────────────────────
const TaskChip = ({label, active, onClick, compact=false}) => {
  const [hov,setHov] = React.useState(false);
  return (
    <button onClick={onClick} aria-pressed={!!active}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{padding:compact?'3px 9px':'5px 11px',fontSize:compact?11.5:12,fontWeight:500,borderRadius:20,cursor:'pointer',
        transition:'all 0.12s',
        background:active?'rgba(255,255,255,0.08)':hov?'rgba(255,255,255,0.06)':'rgba(255,255,255,0.04)',
        color:active?'var(--t1)':'var(--t2)',
        border:`1px solid ${active?'rgba(255,255,255,0.18)':'var(--ln)'}`}}>
      {label}
    </button>
  );
};

// ── WPM slider ────────────────────────────────────────────────
const TypingSpeedSlider = ({value, onChange}) => {
  const MIN=20, MAX=150;
  const trackRef = React.useRef(null);
  const [drag,setDrag] = React.useState(false);
  const pct = ((value-MIN)/(MAX-MIN))*100;
  const desc = value<40?'Slow & deliberate':value<65?'Casual':value<95?'Average human':value<125?'Fast typist':'Lightning fast';
  const fromEv = e => {
    const t=trackRef.current; if(!t) return;
    const r=t.getBoundingClientRect();
    const x=Math.max(0,Math.min(r.width,e.clientX-r.left));
    onChange(Math.max(MIN,Math.min(MAX,Math.round((MIN+(x/r.width)*(MAX-MIN))/5)*5)));
  };
  React.useEffect(()=>{
    if(!drag) return;
    const mv=e=>fromEv(e), up=()=>setDrag(false);
    window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
    return()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); };
  },[drag]);
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <Field label="Typing Speed"><span/></Field>
        <div style={{display:'flex',alignItems:'baseline',gap:4,padding:'3px 9px',
          background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.10)',borderRadius:6,marginTop:-22}}>
          <span style={{fontSize:15,fontWeight:700,color:'var(--t1)',fontFamily:'var(--mono)',lineHeight:1}}>{value}</span>
          <span style={{fontSize:9,fontWeight:600,color:'var(--t3)',fontFamily:'var(--mono)',letterSpacing:'0.08em'}}>WPM</span>
          <span style={{fontSize:10,color:'var(--t3)',marginLeft:3}}>· {desc}</span>
        </div>
      </div>
      <div ref={trackRef} onMouseDown={e=>{setDrag(true);fromEv(e);}}
        style={{position:'relative',height:20,cursor:'pointer',userSelect:'none',marginTop:-6}}>
        <div style={{position:'absolute',top:'50%',left:0,right:0,height:5,marginTop:-2.5,
          borderRadius:5,background:'rgba(255,255,255,0.05)',border:'1px solid var(--ln)'}}/>
        <div style={{position:'absolute',top:'50%',left:0,height:5,marginTop:-2.5,
          width:`${pct}%`,borderRadius:5,
          background:'rgba(255,255,255,0.30)',transition:drag?'none':'width 0.1s'}}/>
        <div style={{position:'absolute',top:'50%',left:`${pct}%`,width:16,height:16,
          marginLeft:-8,marginTop:-8,borderRadius:'50%',background:'rgba(40,42,62,0.98)',
          border:'2px solid rgba(255,255,255,0.45)',pointerEvents:'none',
          boxShadow:drag?'0 0 0 5px rgba(255,255,255,0.06)':'none',
          transition:drag?'box-shadow 0.1s':'left 0.1s,box-shadow 0.1s'}}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:5,
        fontSize:9.5,color:'var(--t4)',fontFamily:'var(--mono)'}}>
        <span>Slow</span><span>Fast</span>
      </div>
    </div>
  );
};

// ── Dual-thumb range pair ─────────────────────────────────────
const RangePair = ({label, hint, minVal, maxVal, floor=0, ceil=60, unit='s', onChange}) => {
  const trackRef = React.useRef(null);
  const [drag,setDrag] = React.useState(null);
  const span=ceil-floor;
  const loPct=((minVal-floor)/span)*100;
  const hiPct=((maxVal-floor)/span)*100;
  const fromEv = e => {
    const t=trackRef.current; if(!t) return null;
    const r=t.getBoundingClientRect();
    return Math.round(floor+(Math.max(0,Math.min(r.width,e.clientX-r.left))/r.width)*span);
  };
  React.useEffect(()=>{
    if(!drag) return;
    const mv=e=>{ const v=fromEv(e); if(v==null) return;
      if(drag==='lo') onChange(Math.max(floor,Math.min(v,maxVal)),maxVal);
      else onChange(minVal,Math.min(ceil,Math.max(v,minVal))); };
    const up=()=>setDrag(null);
    window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
    return()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); };
  },[drag,minVal,maxVal]);
  return (
    <div>
      {label && (
      <div title={hint||undefined} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:12}}>
        <Field label={label}><span/></Field>
        <div style={{display:'flex',alignItems:'center',gap:3,height:20,padding:'0 7px',flexShrink:0,
          background:'rgba(11,12,20,0.55)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:6,
          fontFamily:'var(--mono)',fontVariantNumeric:'tabular-nums'}}>
          <span style={{fontSize:11.5,fontWeight:600,color:'var(--t2)',lineHeight:1}}>{minVal}</span>
          <span style={{fontSize:9,color:'var(--t4)'}}>–</span>
          <span style={{fontSize:11.5,fontWeight:600,color:'var(--t2)',lineHeight:1}}>{maxVal}</span>
          <span style={{fontSize:8.5,fontWeight:600,color:'var(--t3)',letterSpacing:'0.08em'}}>{unit.toUpperCase()}</span>
        </div>
      </div>
      )}
      <div ref={trackRef} style={{position:'relative',height:20,cursor:'pointer',userSelect:'none'}}
        onMouseDown={e=>{
          const v=fromEv(e); if(v==null) return;
          if(Math.abs(v-minVal)<=Math.abs(v-maxVal)){ onChange(Math.min(v,maxVal),maxVal); setDrag('lo'); }
          else { onChange(minVal,Math.max(v,minVal)); setDrag('hi'); }
        }}>
        <div style={{position:'absolute',top:'50%',left:0,right:0,height:5,marginTop:-2.5,
          borderRadius:5,background:'rgba(255,255,255,0.05)',border:'1px solid var(--ln)'}}/>
        <div style={{position:'absolute',top:'50%',left:`${loPct}%`,width:`${hiPct-loPct}%`,height:5,marginTop:-2.5,
          borderRadius:5,background:'rgba(255,255,255,0.30)'}}/>
        {[{p:loPct,w:'lo'},{p:hiPct,w:'hi'}].map(({p,w})=>(
          <div key={w} style={{position:'absolute',top:'50%',left:`${p}%`,width:16,height:16,
            marginLeft:-8,marginTop:-8,borderRadius:'50%',background:'rgba(40,42,62,0.98)',
            border:'2px solid rgba(255,255,255,0.45)',pointerEvents:'none',
            boxShadow:drag===w?'0 0 0 5px rgba(255,255,255,0.06)':'none'}}/>
        ))}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:5,
        fontSize:9.5,color:'var(--t4)',fontFamily:'var(--mono)'}}>
        <span>{floor}{unit}</span><span>{ceil}{unit}</span>
      </div>
    </div>
  );
};

// ── NumRow ────────────────────────────────────────────────────
// Inline numeric input with label/hint on the left, value on the right.
// Used for spam cooldown, repetition window, etc. Matches ToggleRow's
// row look so they stack cleanly inside the same AgCard.
const NumRow = ({label, hint, value, onChange, min=0, max=9999, step=1, unit='', disabled=false}) => {
  const [text, setText] = React.useState(String(value ?? ''));
  React.useEffect(()=>{ setText(String(value ?? '')); },[value]);
  const commit = () => {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n)) { setText(String(value ?? '')); return; }
    const clamped = Math.max(min, Math.min(max, n));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <div title={hint||undefined} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,
      padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.045)',
      opacity:disabled?0.45:1}}>
      <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:5}}>
        <div style={{fontSize:12,color:'var(--t1)',fontWeight:500,lineHeight:1.3}}>{label}</div>
        {hint && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--t4)',flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:6,
        background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',
        borderRadius:7,padding:'5px 10px',minWidth:90}}>
        <input
          type="number" disabled={disabled}
          value={text} min={min} max={max} step={step}
          onChange={e=>setText(e.target.value)}
          onBlur={commit}
          onKeyDown={e=>{ if (e.key==='Enter'){ e.preventDefault(); commit(); e.target.blur(); } }}
          style={{background:'transparent',border:'none',outline:'none',color:'var(--t1)',
            fontFamily:'var(--mono)',fontSize:13,fontWeight:600,width:54,textAlign:'right',
            MozAppearance:'textfield'}}
        />
        {unit && <span style={{fontSize:10.5,color:'#8a8aa8',fontFamily:'var(--mono)',letterSpacing:'0.04em'}}>{unit}</span>}
      </div>
    </div>
  );
};

// ── PercentSlider ─────────────────────────────────────────────
// Single-value 0..max slider. Used for hesitation %, self-correction %,
// typo rate. Visually compact (label + readout above, slider below). The
// `disabled` prop greys out the row + ignores drag — used to lock typo
// controls when style is 'pro'/'expert'/'concise'.
const PercentSlider = ({label, hint, value, onChange, max=100, disabled=false, disabledNote=''}) => {
  const trackRef = React.useRef(null);
  const [drag, setDrag] = React.useState(false);
  const v = Math.max(0, Math.min(max, Number(value)||0));
  const pct = (v/max)*100;
  const fromEv = e => {
    const t=trackRef.current; if(!t) return;
    const r=t.getBoundingClientRect();
    const x=Math.max(0,Math.min(r.width,e.clientX-r.left));
    onChange(Math.round((x/r.width)*max));
  };
  React.useEffect(()=>{
    if(!drag) return;
    const mv=e=>fromEv(e), up=()=>setDrag(false);
    window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
    return()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); };
  },[drag]);
  return (
    <div style={{opacity:disabled?0.45:1}}>
      <div title={hint||undefined} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:12}}>
        <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:5}}>
          <label style={{fontSize:11,fontWeight:600,color:'rgba(136,136,160,0.85)',letterSpacing:'0.01em'}}>{label}</label>
          {hint && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--t4)',flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
          {disabled && disabledNote && <span style={{fontSize:10,color:'rgba(255,180,90,0.75)',fontStyle:'italic'}}>{disabledNote}</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:3,height:20,padding:'0 7px',flexShrink:0,
          background:'rgba(11,12,20,0.55)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:6,
          fontFamily:'var(--mono)',fontVariantNumeric:'tabular-nums'}}>
          <span style={{fontSize:12,fontWeight:600,color:'var(--t1)',lineHeight:1}}>{v}</span>
          <span style={{fontSize:8.5,fontWeight:600,color:'var(--t3)',letterSpacing:'0.08em'}}>%</span>
        </div>
      </div>
      <div ref={trackRef}
        onMouseDown={disabled?undefined:e=>{setDrag(true);fromEv(e);}}
        style={{position:'relative',height:20,cursor:disabled?'not-allowed':'pointer',userSelect:'none'}}>
        <div style={{position:'absolute',top:'50%',left:0,right:0,height:5,marginTop:-2.5,
          borderRadius:5,background:'rgba(255,255,255,0.05)',border:'1px solid var(--ln)'}}/>
        <div style={{position:'absolute',top:'50%',left:0,height:5,marginTop:-2.5,
          width:`${pct}%`,borderRadius:5,
          background:'rgba(255,255,255,0.30)',transition:drag?'none':'width 0.1s'}}/>
        <div style={{position:'absolute',top:'50%',left:`${pct}%`,width:16,height:16,
          marginLeft:-8,marginTop:-8,borderRadius:'50%',background:'rgba(40,42,62,0.98)',
          border:'2px solid rgba(255,255,255,0.45)',pointerEvents:'none',
          boxShadow:drag?'0 0 0 5px rgba(255,255,255,0.06)':'none'}}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:5,
        fontSize:9.5,color:'var(--t4)',fontFamily:'var(--mono)'}}>
        <span>off</span><span>{max}%</span>
      </div>
    </div>
  );
};

// ── REPLY HOURS ───────────────────────────────────────────────
// Per-agent schedule editor: one or more blocks of days + times, the zone
// they're read in, and what happens to messages outside them. Lives in the
// Identity tab under Status because it's the same question — "when does
// this agent answer?" — and stays a single row until it's switched on or
// opened. All maths lives in SCHEDULE_GATE (bot-stores.jsx) so the editor,
// the reply engine and the ghost can never disagree about what a schedule
// means.

const AGS_DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const AGS_DAY_2     = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const AGS_MODES = [
  { v:'pause',   l:'Stay quiet',       hint:'Replies only if the customer writes again during these hours.' },
  { v:'queue',   l:'Reply at opening', hint:'Answers waiting chats when the hours start, a few seconds apart.' },
  { v:'offline', l:'Appear offline',   hint:'Stays quiet, then its first reply comes slowly, like someone back on their phone.' },
];

// Zone list with GMT offsets, built once on first open (~400 Intl calls).
let _agsZoneOptions = null;
const agsZoneOptions = () => {
  if (_agsZoneOptions) return _agsZoneOptions;
  const now = new Date();
  _agsZoneOptions = SCHEDULE_GATE.allTimeZones().map(z => {
    let off = '';
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(now);
      off = (p.find(x => x.type === 'timeZoneName') || {}).value || '';
    } catch (_) {}
    return { v: z, l: z.replace(/_/g, ' ') + (off ? ` (${off})` : '') };
  });
  return _agsZoneOptions;
};

// Switch — same track/knob as ToggleRow so every toggle in the popup reads
// as one control. A real button with role="switch" for keyboard + AT.
const AgsSwitch = ({on, onChange, label}) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label}
    className="ags-switch" data-on={on ? '1' : '0'}
    onClick={e => { e.stopPropagation(); onChange(!on); }}>
    <span className="ags-switch-knob"/>
  </button>
);

// Time picker — portalled list so the popup body can't clip it.
//   kind='start' → every 30 minutes from 12am.
//   kind='end'   → every 30 minutes AFTER the start, with the length of the
//                  block beside each, ending in "All day". Picking a time
//                  earlier than the start is how you make an overnight block,
//                  and the durations make that obvious.
// The field at the top takes any typed time ("9:45", "9:45pm", "21:45").
const AgsTimeSelect = ({kind, value, startMin, allDay=false, onChange, h12, label}) => {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos]   = React.useState({ left:0, top:0, up:false });
  const [typed, setTyped] = React.useState('');
  const [hi, setHi] = React.useState(-1);
  const trigRef = React.useRef(null), menuRef = React.useRef(null), listRef = React.useRef(null);

  const options = React.useMemo(() => {
    if (kind === 'start') {
      const out = [];
      for (let m = 0; m < 1440; m += 30) out.push({ v: m, l: SCHEDULE_GATE.fmtTime(m, { h12 }) });
      if (value % 30 !== 0) out.push({ v: value, l: SCHEDULE_GATE.fmtTime(value, { h12 }) });
      return out.sort((a, b) => a.v - b.v);
    }
    const out = [];
    for (let k = 1; k <= 47; k++) {
      const m = (startMin + k * 30) % 1440;
      const dur = k * 30;
      out.push({ v: m, l: SCHEDULE_GATE.fmtTime(m, { h12, isEnd: true }),
        d: `${Math.floor(dur / 60) ? Math.floor(dur / 60) + 'h' : ''}${dur % 60 ? (dur >= 60 ? ' ' : '') + '30m' : ''}` });
    }
    out.push({ v: 'allday', l: 'All day', d: '24h' });
    return out;
  }, [kind, startMin, value, h12]);

  const selIndex = options.findIndex(o => (allDay && kind === 'end') ? o.v === 'allday' : o.v === value);

  React.useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigRef.current && trigRef.current.getBoundingClientRect();
      if (!r) return;
      const MENU_H = 260;
      const up = r.bottom + 4 + MENU_H > window.innerHeight - 8 && r.top > MENU_H;
      setPos({ left: Math.min(r.left, window.innerWidth - 180), top: up ? r.top - 4 : r.bottom + 4, up });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const close = e => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (trigRef.current && trigRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', close), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', close);
    };
  }, [open]);

  // Scroll the current value into the middle of the list on open.
  React.useEffect(() => {
    if (!open) return;
    setHi(selIndex);
    requestAnimationFrame(() => {
      const el = listRef.current && listRef.current.querySelector('[data-sel="1"]');
      if (el && listRef.current) listRef.current.scrollTop = el.offsetTop - listRef.current.clientHeight / 2 + el.clientHeight / 2;
    });
    // eslint-disable-next-line
  }, [open]);

  const pick = (o) => { onChange(o.v === 'allday' ? 'allday' : o.v); setOpen(false); setTyped(''); trigRef.current && trigRef.current.focus(); };
  const commitTyped = () => {
    const m = SCHEDULE_GATE.parseTime(typed);
    if (m == null) return false;
    onChange(m); setOpen(false); setTyped('');
    trigRef.current && trigRef.current.focus();
    return true;
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigRef.current && trigRef.current.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(0, Math.min(options.length - 1, (hi < 0 ? selIndex : hi) + (e.key === 'ArrowDown' ? 1 : -1)));
      setHi(n);
      const el = listRef.current && listRef.current.children[n];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (typed.trim()) { commitTyped(); return; }
      if (hi >= 0 && options[hi]) pick(options[hi]);
    }
  };

  const shown = (allDay && kind === 'end') ? (h12 ? 'Midnight' : '24:00')
    : SCHEDULE_GATE.fmtTime(value, { h12, isEnd: kind === 'end' });
  const badTyped = typed.trim() && SCHEDULE_GATE.parseTime(typed) == null;

  return (
    <>
      <button ref={trigRef} type="button" className="ags-time" data-open={open ? '1' : '0'}
        aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${shown}`}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        <span className="ags-time-ico"><SelIco name="clock" size={12}/></span>
        <span>{shown}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && ReactDOM.createPortal(
        <div ref={menuRef} className="ags-menu" data-up={pos.up ? '1' : '0'}
          style={{ left: pos.left, top: pos.top }} onKeyDown={onKey}>
          <input className="ags-menu-input" autoFocus value={typed}
            data-bad={badTyped ? '1' : '0'}
            onChange={e => setTyped(e.target.value)}
            placeholder={h12 ? 'Type a time, e.g. 9:45am' : 'Type a time, e.g. 09:45'}
            aria-label={`Type a ${label.toLowerCase()}`}/>
          <div ref={listRef} className="ags-menu-list" role="listbox" aria-label={label}>
            {options.map((o, i) => {
              const sel = i === selIndex;
              return (
                <button key={String(o.v) + i} type="button" role="option" aria-selected={sel}
                  className="ags-menu-opt" data-sel={sel ? '1' : '0'} data-hi={i === hi ? '1' : '0'}
                  onMouseEnter={() => setHi(i)} onClick={() => pick(o)}>
                  <span>{o.l}</span>
                  {o.d && <span className="ags-menu-dur">{o.d}</span>}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// Week at a glance — seven 24-hour bars, Monday first, filled where the
// agent answers, with a marker at "now" in the schedule's zone. Reads the
// same coverage mask the engine's status uses, so overnight blocks spill
// into the next row exactly as they behave.
const AgsWeekStrip = ({schedule, h12, tick}) => {
  const mask = React.useMemo(() => SCHEDULE_GATE.weekMask(schedule), [JSON.stringify(schedule.windows)]);
  const now = React.useMemo(() => SCHEDULE_GATE._localNow(SCHEDULE_GATE.isValidTz(schedule.tz) ? schedule.tz : ''), [schedule.tz, tick]);
  const rows = SCHEDULE_GATE.DAY_ORDER.map(d => {
    const segs = [];
    let s = -1;
    const base = d * 1440;
    for (let m = 0; m <= 1440; m++) {
      const onM = m < 1440 && mask[base + m] === 1;
      if (onM && s < 0) s = m;
      if (!onM && s >= 0) { segs.push([s, m]); s = -1; }
    }
    return { d, segs };
  });
  const ticks = h12 ? ['12am', '6am', '12pm', '6pm', '12am'] : ['00', '06', '12', '18', '24'];
  return (
    <div className="ags-week" aria-hidden="true">
      {rows.map(({d, segs}) => {
        const today = now && now.weekday === d;
        return (
          <div key={d} className="ags-week-row" data-today={today ? '1' : '0'}>
            <span className="ags-week-day">{AGS_DAY_2[d]}</span>
            <span className="ags-week-bar">
              {segs.map(([a, b]) => (
                <span key={a} className="ags-week-seg"
                  style={{ left: `${a / 14.4}%`, width: `${Math.max(0.6, (b - a) / 14.4)}%` }}
                  title={`${SCHEDULE_GATE.DAY_SHORT[d]} ${SCHEDULE_GATE.fmtTime(a, { h12, compact: true })}–${SCHEDULE_GATE.fmtTime(b % 1440, { h12, compact: true, isEnd: true })}`}/>
              ))}
              {today && <span className="ags-week-now" style={{ left: `${now.minutes / 14.4}%` }}/>}
            </span>
          </div>
        );
      })}
      <div className="ags-week-ticks">
        <span className="ags-week-day"/>
        <span className="ags-week-tickrow">{ticks.map((t, i) => <span key={i}>{t}</span>)}</span>
      </div>
    </div>
  );
};

const AgentReplyHours = ({draft, update, agentKey, open, setOpen}) => {
  const G = SCHEDULE_GATE;
  const sch = React.useMemo(() => G.normalize(draft.schedule), [draft.schedule]);
  const on = sch.enabled;
  const h12 = G.uses12h();
  const [tick, setTick] = React.useState(0);
  const innerRef = React.useRef(null);
  const [innerH, setInnerH] = React.useState(0);
  // Keep "Replying until…" honest while the popup sits open.
  React.useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, [on]);

  const expanded = on && open;
  // Content stays mounted through the collapse so it slides shut instead of
  // vanishing, then unmounts (the zone list is ~400 options).
  const [mounted, setMounted] = React.useState(expanded);
  React.useEffect(() => {
    if (expanded) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), 280);
    return () => clearTimeout(t);
  }, [expanded]);
  const render = expanded || mounted;
  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setInnerH(el.scrollHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [render]);

  const write = (patch) => update('schedule', G.normalize({ ...sch, ...patch }));
  const setWin = (i, patch) => write({ windows: sch.windows.map((w, j) => j === i ? { ...w, ...patch } : w) });

  const toggleOn = (v) => {
    write({ enabled: v });
    setOpen(v);
  };
  const onHead = () => { if (!on) toggleOn(true); else setOpen(o => !o); };

  const changeStart = (i, v) => {
    const w = sch.windows[i];
    // All day → the new start runs until midnight.
    if (w.startMin === w.endMin) { setWin(i, { startMin: v, endMin: 0 }); return; }
    const wasOvernight = w.endMin < w.startMin && w.endMin !== 0;
    const crossesEnd   = w.endMin !== 0 && v >= w.endMin;
    if (v === w.endMin || (!wasOvernight && crossesEnd)) {
      // Moving the start onto or past the end would silently turn the block
      // into a night shift (or all day) — carry the end along instead,
      // keeping the block's length.
      const dur = w.endMin === 0 ? 1440 - w.startMin : (w.endMin - w.startMin + 1440) % 1440;
      let end = (v + (dur || 60)) % 1440;
      if (end === v) end = (v + 60) % 1440;
      setWin(i, { startMin: v, endMin: end });
    } else {
      setWin(i, { startMin: v });
    }
  };
  const changeEnd = (i, v) => {
    if (v === 'allday') setWin(i, { startMin: 0, endMin: 0 });
    else setWin(i, { endMin: v === sch.windows[i].startMin ? (v + 30) % 1440 : v });
  };
  const toggleDay = (i, d) => {
    const days = sch.windows[i].days;
    setWin(i, { days: days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort((a, b) => a - b) });
  };
  const addBlock = () => {
    const used = new Set(sch.windows.flatMap(w => w.days));
    let days = [1,2,3,4,5].filter(d => !used.has(d));
    if (!days.length) days = [6, 0].filter(d => !used.has(d));
    const last = sch.windows[sch.windows.length - 1] || G.DEFAULT_WINDOW;
    write({ windows: [...sch.windows, { days, startMin: last.startMin, endMin: last.endMin }] });
  };
  const removeBlock = (i) => write({ windows: sch.windows.filter((_, j) => j !== i) });

  // ── status line ──
  const st = on ? G.status(sch) : { state: 'always' };
  const whenLabel = (at, inMin) => {
    const t = G.fmtTime(at.minutes, { h12, compact: true, isEnd: true });
    const nowL = G._localNow(G.isValidTz(sch.tz) ? sch.tz : '');
    if (!nowL || inMin == null) return t;
    const dayDiff = Math.floor((nowL.minutes + inMin) / 1440);
    if (dayDiff === 0) return t;
    if (dayDiff === 1) return `tomorrow ${t}`;
    return `${G.DAY_SHORT[at.weekday]} ${t}`;
  };
  let tone = 'mute', status = '';
  if (on) {
    if (draft.active === false)      { tone = 'mute'; status = 'Agent paused'; }
    else if (st.state === 'badtz')   { tone = 'err';  status = 'Unknown time zone'; }
    else if (st.state === 'empty')   { tone = 'err';  status = 'No days picked'; }
    else if (st.state === 'open')    { tone = 'ok';   status = st.changeIn == null ? 'Replying all week' : `Replying until ${whenLabel(st.changeAt, st.changeIn)}`; }
    else if (st.state === 'closed')  { tone = 'warn'; status = `Off until ${whenLabel(st.changeAt, st.changeIn)}`; }
  }
  const summary = on ? G.describe(sch, { h12 }) : 'Replies any time';

  const zones = render ? agsZoneOptions() : [];
  const device = G.deviceTz();
  const tzKnown = !sch.tz || zones.some(z => z.v === sch.tz);
  const mode = AGS_MODES.find(m => m.v === sch.mode) || AGS_MODES[0];

  return (
    <div className="ags" data-on={on ? '1' : '0'} data-open={expanded ? '1' : '0'}>
      {/* Whole row is the click target; the inner button carries keyboard
          focus and aria-expanded, and the switch stops propagation so
          flipping it never also toggles the panel twice. */}
      <div className="ags-head" onClick={onHead}>
        <button type="button" className="ags-head-main"
          aria-expanded={on ? expanded : undefined}
          aria-label={on ? `Reply hours: ${summary}. ${expanded ? 'Hide' : 'Edit'} hours` : 'Reply hours: replies any time. Turn on to set hours'}>
        <span className="ags-ico" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>
        </span>
        <span className="ags-head-text">
          <span className="ags-title-row">
            <span className="ags-title">Reply hours</span>
            {status && <span className="ags-status" data-tone={tone}><i/>{status}</span>}
          </span>
          <span className="ags-summary" title={summary}>{summary}{on && sch.tz ? ` (${sch.tz.split('/').pop().replace(/_/g, ' ')})` : ''}</span>
        </span>
        </button>
        <AgsSwitch on={on} onChange={toggleOn} label="Only reply during set hours"/>
        <span className="ags-chev" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      </div>

      <div className="ags-body" style={{ height: expanded ? innerH : 0 }} aria-hidden={!expanded}>
        {render && (
          <div ref={innerRef} className="ags-inner">
            <AgsWeekStrip schedule={sch} h12={h12} tick={tick}/>

            <div className="ags-blocks">
              {sch.windows.map((w, i) => {
                const allDay = w.startMin === w.endMin;
                const overnight = !allDay && w.endMin < w.startMin && w.endMin !== 0;
                return (
                  <div key={i} className="ags-block">
                    <div className="ags-block-time">
                      <AgsTimeSelect kind="start" label="Start time" h12={h12} allDay={allDay}
                        value={allDay ? 0 : w.startMin} startMin={allDay ? 0 : w.startMin}
                        onChange={v => changeStart(i, v)}/>
                      <span className="ags-dash" aria-hidden="true">–</span>
                      <AgsTimeSelect kind="end" label="End time" h12={h12} allDay={allDay}
                        value={allDay ? 0 : w.endMin} startMin={allDay ? 0 : w.startMin}
                        onChange={v => changeEnd(i, v)}/>
                      {allDay    && <span className="ags-note">all day</span>}
                      {overnight && <span className="ags-note">next day</span>}
                      <span className="ags-spacer"/>
                      {sch.windows.length > 1 && (
                        <button type="button" className="ags-x" onClick={() => removeBlock(i)}
                          aria-label={`Remove ${G.windowLabel(w, { h12 })}`} title="Remove these hours">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      )}
                    </div>
                    <div className="ags-days" role="group" aria-label="Days">
                      {G.DAY_ORDER.map(d => {
                        const dOn = w.days.includes(d);
                        return (
                          <button key={d} type="button" className="ags-day" aria-pressed={dOn}
                            data-on={dOn ? '1' : '0'} title={AGS_DAY_NAMES[d]} aria-label={AGS_DAY_NAMES[d]}
                            onClick={() => toggleDay(i, d)}>{AGS_DAY_2[d]}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <button type="button" className="sset-ghost-btn ags-add" onClick={addBlock}
              disabled={sch.windows.length >= G.MAX_WINDOWS}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add hours
            </button>

            <div className="ags-row">
              <label className="ags-label" htmlFor={`ags-tz-${agentKey}`}>Time zone</label>
              <span className="sset-select-wrap ags-tz-wrap" data-icon="1">
              <span className="sset-select-wrap-icon"><SelIco name="globe"/></span>
              <select id={`ags-tz-${agentKey}`} className="sset-select ags-tz" value={sch.tz}
                onChange={e => write({ tz: e.target.value })}>
                <option value="">This device{device ? ` (${device.replace(/_/g, ' ')})` : ''}</option>
                {!tzKnown && <option value={sch.tz}>{sch.tz}</option>}
                {zones.map(z => <option key={z.v} value={z.v}>{z.l}</option>)}
              </select>
              </span>
            </div>

            <div className="ags-outside">
              <span className="ags-label">Outside these hours</span>
              <div className="ags-seg" role="radiogroup" aria-label="Outside these hours">
                {AGS_MODES.map(m => (
                  <button key={m.v} type="button" role="radio" aria-checked={sch.mode === m.v}
                    data-on={sch.mode === m.v ? '1' : '0'} onClick={() => write({ mode: m.v })}>{m.l}</button>
                ))}
              </div>
              <span className="ags-hint">{mode.hint}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Tab definitions ───────────────────────────────────────────
// Ids are kept from the old tab names (other code opens 'identity').
const AGENT_TABS = [
  {id:'identity',     label:'Profile'},
  {id:'behaviour',    label:'Personality'},
  {id:'capabilities', label:'Permissions'},
  {id:'realism',      label:'Realism'},
];

// ── Model picker — custom dropdown for the Agent's LLM model ─
// Shows the provider logo (Gemini / OpenAI / Anthropic) next to each
// model. Portalled to document.body so it can't be clipped by the
// settings popup body. Mirrors the ActiveLlmPicker / CoinPicker pattern.
const MODEL_PROVIDER = (id) => {
  const s = (id || '').toLowerCase();
  if (s.startsWith('gemini') || s.startsWith('gem')) return 'gemini';
  if (s.startsWith('gpt') || s.startsWith('o1') || s.startsWith('o3') || s.startsWith('o4')) return 'openai';
  if (s.startsWith('claude') || s.startsWith('anthropic')) return 'claude';
  return null;
};
const ModelIcon = ({id, s=14}) => {
  const p = MODEL_PROVIDER(id);
  const def = LLM_PROVIDERS.find(x => x.id === p);
  if (def) return <def.Icon s={s}/>;
  return <span style={{width:s,height:s,borderRadius:'50%',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.10)',display:'inline-block',flexShrink:0}}/>;
};

const ModelPicker = ({value, options, onChange, bare = false}) => {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos]   = React.useState({left:0, top:0, width:0});
  const triggerRef = React.useRef(null);
  const menuRef    = React.useRef(null);

  React.useEffect(()=>{
    if (!open) return;
    const update = ()=>{
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const close = (e) => {
      if (!menuRef.current || !triggerRef.current) return;
      if (menuRef.current.contains(e.target) || triggerRef.current.contains(e.target)) return;
      setOpen(false);
    };
    setTimeout(()=>document.addEventListener('mousedown', close), 0);
    return ()=>{
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      document.removeEventListener('mousedown', close);
    };
  }, [open]);

  // Group models by provider for the dropdown — mirrors how the user
  // thinks about the catalogue ("which Gemini model?", "which Claude?").
  const groups = React.useMemo(()=>{
    const out = { gemini:[], openai:[], claude:[], other:[] };
    options.forEach(m => { (out[MODEL_PROVIDER(m) || 'other']).push(m); });
    return out;
  }, [options]);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={()=>setOpen(o=>!o)}
        className={bare ? 'agx-model' : undefined} aria-haspopup="listbox" aria-expanded={open}
        style={bare ? undefined : {
          width:'100%',display:'flex',alignItems:'center',gap:8,
          padding:'8px 11px',
          background: open ? 'rgba(255,255,255,0.052)' : 'rgba(255,255,255,0.03)',
          border:`1px solid ${open ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius:8,cursor:'pointer',transition:'all 0.12s',textAlign:'left',
          fontFamily:'var(--font)',color:'var(--t1)',fontSize:12.5,
        }}>
        <ModelIcon id={value} s={14}/>
        <span style={{flex:1,minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontWeight:500,letterSpacing:'-0.005em'}}>{value || 'Choose a model…'}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--t3)',transition:'transform 0.16s',transform:open?'rotate(180deg)':'none',flexShrink:0}}><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && ReactDOM.createPortal(
        <div ref={menuRef} style={{
          position:'fixed', left:pos.left, top:pos.top, width:Math.max(pos.width, 220),
          zIndex: 9999,
          padding:5, maxHeight:320, overflow:'auto',
          background:'rgba(20,22,42,0.98)',
          backdropFilter:'blur(24px) saturate(170%)',
          WebkitBackdropFilter:'blur(24px) saturate(170%)',
          border:'1px solid rgba(255,255,255,0.10)',
          borderRadius:10,
          boxShadow:'0 16px 48px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.04) inset',
        }}>
          {[
            {id:'gemini', label:'Google Gemini'},
            {id:'openai', label:'OpenAI'},
            {id:'claude', label:'Anthropic'},
            {id:'other',  label:'Other'},
          ].map(g => groups[g.id] && groups[g.id].length > 0 && (
            <div key={g.id}>
              <div style={{fontSize:9,fontWeight:700,color:'var(--t4)',textTransform:'uppercase',letterSpacing:'0.08em',padding:'6px 10px 3px'}}>{g.label}</div>
              {groups[g.id].map(m => {
                const sel = value === m;
                return (
                  <button key={m} type="button" onClick={()=>{ onChange(m); setOpen(false); }}
                    style={{
                      display:'flex',alignItems:'center',gap:9,width:'100%',
                      padding:'7px 10px',border:'none',borderRadius:7,textAlign:'left',
                      background: sel ? 'rgba(255,255,255,0.076)' : 'transparent',
                      cursor:'pointer',transition:'background 0.10s',
                      fontFamily:'var(--font)',
                    }}
                    onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='rgba(255,255,255,0.04)'; }}
                    onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='transparent'; }}>
                    <ModelIcon id={m} s={14}/>
                    <span style={{flex:1,fontSize:12,fontWeight:500,color:'var(--t1)',letterSpacing:'-0.005em',fontFamily:'var(--mono)'}}>{m}</span>
                    {sel && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

// ── AGENT EDITOR (popup) ─────────────────────────────────────
// One vocabulary for every tab of the agent editor, the same one the
// Catalog and Licenses & payments lists use: a plain sentence-case heading,
// then one bordered group of rows split by hairlines. Every row is
// "what it is" on the left (one short line, plus a one-line hint when
// the name alone isn't enough) and its control on the right. Wide
// controls (text, model, schedule) drop underneath with data-stack.
const ensureAgxStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('agx-style')) return;
  const st = document.createElement('style');
  st.id = 'agx-style';
  st.textContent = `
.agx { display: flex; flex-direction: column; gap: 20px; min-width: 0; padding: 2px 0 6px; }
.agx-sec { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.agx-sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-width: 0; }
.agx-sec-title { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: -0.006em; color: var(--t1, #eeeef5); }
.agx-sec-aside { font-size: 11px; color: rgba(160,164,184,0.66); white-space: nowrap; }
.agx-fold { appearance: none; display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0; margin: 0; padding: 2px 0;
  font: inherit; text-align: left; color: inherit; background: none; border: none; cursor: pointer; border-radius: 6px; }
.agx-fold:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.agx-fold .agx-sec-title { flex: 0 0 auto; }
@media (hover: hover) { .agx-fold:hover .agx-sec-title { color: #fff; } .agx-fold:hover .fold-chev { color: var(--t1, #eeeef5); } }
.agx-fold-sum { margin-left: auto; min-width: 0; font-size: 11px; color: rgba(160,164,184,0.66); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agx-sec[data-fold="shut"] { gap: 0; padding: 9px 12px; border: 1px solid rgba(255,255,255,0.055); border-radius: 10px; background: rgba(255,255,255,0.01); }
.agx-sec[data-fold="shut"] .agx-fold { padding: 0; }
.fold-chev { flex: 0 0 auto; color: rgba(160,164,184,0.6); transition: transform 160ms cubic-bezier(0.22,1,0.36,1), color 120ms ease; }
.fold-chev[data-open="1"] { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .fold-chev { transition: none; } }
.agx-sec-hint { margin: -3px 0 1px; font-size: 11px; line-height: 1.45; color: rgba(160,164,184,0.66); max-width: 62ch; }
.agx-group { border: 1px solid rgba(255,255,255,0.065); border-radius: 10px; overflow: hidden;
  background: rgba(255,255,255,0.012); }
.agx-row { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 52px; margin: 0;
  padding: 10px 14px; box-sizing: border-box; font: inherit; color: inherit; text-align: left;
  background: transparent; border: none; border-top: 1px solid rgba(255,255,255,0.05); }
.agx-group > .agx-row:first-child, .agx-group > :first-child { border-top: none; }
.agx-row[data-stack="1"] { flex-direction: column; align-items: stretch; gap: 9px; padding-top: 12px; padding-bottom: 12px; }
.agx-row[data-nested="1"] { padding-left: 28px; background: rgba(255,255,255,0.012); min-height: 46px; }
button.agx-row { cursor: pointer; transition: background-color 120ms ease; }
@media (hover: hover) { button.agx-row:hover:not(:disabled) { background: rgba(255,255,255,0.025); } }
button.agx-row:focus-visible { outline: none; background: rgba(255,255,255,0.03);
  box-shadow: inset 2px 0 0 color-mix(in oklab, var(--acc, #6c63ff) 75%, #fff); }
button.agx-row:disabled { cursor: default; }
.agx-row[data-off="1"] .agx-row-txt, .agx-row[data-off="1"] .agx-row-ctl { opacity: 0.45; }
.agx-row-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.agx-row-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 12.5px; font-weight: 500;
  line-height: 1.3; letter-spacing: -0.006em; color: var(--t1, #eeeef5); }
.agx-row-hint { font-size: 11px; line-height: 1.4; color: rgba(160,164,184,0.66); }
.agx-row-ctl { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-width: 0; }
.agx-row[data-stack="1"] .agx-row-ctl { flex: 1 1 auto; }
.agx-row[data-stack="1"] .agx-row-ctl > * { flex: 1 1 auto; min-width: 0; }
.agx-head2 { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.agx-val { font-size: 11.5px; color: rgba(214,216,232,0.9); font-variant-numeric: tabular-nums; white-space: nowrap; }
.agx-val small { font-size: 11px; color: rgba(160,164,184,0.6); margin-left: 4px; }
.agx-note { font-size: 10.5px; font-weight: 500; color: rgb(222,168,92); white-space: nowrap; }
.agx-link { appearance: none; background: none; border: none; padding: 0; margin: 0; font: inherit; font-size: 11.5px;
  font-weight: 500; color: color-mix(in oklab, var(--acc, #6c63ff) 45%, #eeeef5); cursor: pointer; white-space: nowrap; }
.agx-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.agx-link:focus-visible { outline: none; text-decoration: underline; text-underline-offset: 3px; }

/* Text fields */
.agx .slw-input.agx-ta { height: auto; min-height: 132px; padding: 9px 10px; line-height: 1.55; resize: vertical; font-size: 12px; }
.agx-count { font-size: 10.5px; color: rgba(160,164,184,0.6); font-variant-numeric: tabular-nums; }
.agx-count[data-warn="1"] { color: rgb(236,130,124); }
.agx-preview { font-size: 11px; color: rgba(160,164,184,0.7); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agx-preview b { font-weight: 600; color: var(--t1, #eeeef5); }
.agx .sset-select-wrap { width: auto; min-width: 150px; }
.agx .sset-select { height: var(--ctl-h, 30px); padding-top: 0; padding-bottom: 0; }
.agx-row[data-stack="1"] .sset-select-wrap { width: 100%; }

/* Seconds range: "2 to 9 sec" as two small number fields */
.agx-span { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: rgba(160,164,184,0.7); }
.agx-num { width: 46px; height: var(--ctl-h, 30px); box-sizing: border-box; padding: 0 6px; margin: 0; text-align: center;
  font: inherit; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--t1, #eeeef5);
  background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--ctl-r, 8px);
  outline: none; -moz-appearance: textfield; transition: border-color 120ms ease; }
.agx-num::-webkit-outer-spin-button, .agx-num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.agx-num:focus { border-color: color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); background: rgba(255,255,255,0.05); }

/* Slider (native, so it works with keys and screen readers) */
.agx-range { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 18px; margin: 0;
  background: transparent; cursor: pointer; --p: 50%; }
.agx-range:disabled { cursor: default; opacity: 0.45; }
.agx-range::-webkit-slider-runnable-track { height: 4px; border-radius: 4px;
  background: linear-gradient(to right, color-mix(in oklab, var(--acc, #6c63ff) 70%, #fff 8%) var(--p), rgba(255,255,255,0.09) var(--p)); }
.agx-range::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 50%;
  background: #f3f3f7; border: none; box-shadow: 0 1px 3px rgba(0,0,0,0.45); }
.agx-range::-moz-range-track { height: 4px; border-radius: 4px; background: rgba(255,255,255,0.09); }
.agx-range::-moz-range-progress { height: 4px; border-radius: 4px; background: color-mix(in oklab, var(--acc, #6c63ff) 70%, #fff 8%); }
.agx-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #f3f3f7; border: none; box-shadow: 0 1px 3px rgba(0,0,0,0.45); }
.agx-range:focus-visible { outline: none; }
.agx-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px color-mix(in oklab, var(--acc, #6c63ff) 35%, transparent); }
.agx-range:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 4px color-mix(in oklab, var(--acc, #6c63ff) 35%, transparent); }
.agx-scale { display: flex; justify-content: space-between; font-size: 10.5px; color: rgba(160,164,184,0.5); margin-top: 2px; }

/* Overall feel: three choices, one line each */
.agx-feel { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.agx-feel-opt { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; margin: 0;
  padding: 11px 12px 12px; box-sizing: border-box; font: inherit; text-align: left; color: inherit; cursor: pointer;
  background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px;
  transition: border-color 120ms ease, background-color 120ms ease; }
@media (hover: hover) { .agx-feel-opt:hover { background: rgba(255,255,255,0.035); border-color: rgba(255,255,255,0.12); } }
.agx-feel-opt[aria-checked="true"] { background: color-mix(in oklab, var(--acc, #6c63ff) 11%, transparent);
  border-color: color-mix(in oklab, var(--acc, #6c63ff) 62%, transparent); }
.agx-feel-opt:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.agx-feel-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; margin-bottom: 3px; }
.agx-feel-bars i { width: 3px; border-radius: 1px; background: rgba(255,255,255,0.14); }
.agx-feel-bars i:nth-child(1) { height: 5px; } .agx-feel-bars i:nth-child(2) { height: 8px; } .agx-feel-bars i:nth-child(3) { height: 12px; }
.agx-feel-bars i[data-on="1"] { background: color-mix(in oklab, var(--acc, #6c63ff) 55%, #fff 20%); }
.agx-feel-name { font-size: 12.5px; font-weight: 600; letter-spacing: -0.008em; color: var(--t1, #eeeef5); }
.agx-feel-sub { font-size: 10.5px; line-height: 1.4; color: rgba(160,164,184,0.66); }
.agx-custom { font-size: 11px; color: rgba(160,164,184,0.7); }

/* Reply hours and the scheduling queue sit inside a group like any row */
.agx-group > .ags { margin: 0; padding: 12px 14px; border-top: none; }
.agx-queue { padding: 10px 14px 12px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 6px; }
.agx-queue-title { font-size: 11.5px; font-weight: 500; color: var(--t2, #c8c9d8); }

@media (max-width: 460px) { .agx-feel { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { button.agx-row, .agx-feel-opt, .agx-num { transition: none; } }

/* ── Inside a settings window ────────────────────────────────────────
   The agent editor speaks the product editor's language here, so an
   agent and a product feel like the same kind of page: quiet text tabs
   under the window edge, small grey captions instead of bold headings,
   filled groups with inset hairlines, 12px row insets throughout, and
   the same footer (status switch, delete icon, one primary button). */
.agx-tabs { flex-shrink: 0; display: flex; align-items: flex-end; gap: 20px; height: 38px; box-sizing: border-box;
  padding: 0 var(--gutter, 16px); border-bottom: 1px solid rgba(255,255,255,0.055);
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.agx-tabs::-webkit-scrollbar { display: none; }
.agx-tab { position: relative; flex: 0 0 auto; appearance: none; background: none; border: none; margin: 0;
  padding: 0 0 10px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 500; letter-spacing: -0.006em;
  white-space: nowrap; color: rgba(160,164,184,0.7); transition: color 140ms ease; }
.agx-tab::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; border-radius: 2px 2px 0 0;
  background: transparent; transition: background-color 160ms ease; }
@media (hover: hover) { .agx-tab:hover { color: rgba(226,228,240,0.92); } }
.agx-tab[aria-selected="true"] { color: var(--t1, #eeeef5); }
.agx-tab[aria-selected="true"]::after { background: color-mix(in oklab, var(--acc, #6c63ff) 75%, #fff); }
.agx-tab:focus-visible { outline: none; color: var(--t1, #eeeef5); }
.agx-tab:focus-visible::after { background: color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }

.agx-scroll { flex: 1 1 auto; }
.sset-subpop .agx-body { padding: 14px var(--gutter, 16px) 18px; }
.sset-subpop .agx { gap: 16px; padding: 0; }

/* Captions */
.sset-subpop .agx .agx-sec { gap: 6px; }
.sset-subpop .agx .agx-sec-head { padding: 0 2px; align-items: baseline; }
.sset-subpop .agx .agx-sec-title { font-size: 11px; font-weight: 550; letter-spacing: -0.003em; color: rgba(172,176,198,0.72); }
.sset-subpop .agx .agx-sec-aside { font-size: 10.5px; color: rgba(160,164,184,0.5); }
.sset-subpop .agx .agx-sec-hint { margin: 0 0 2px; padding: 0 2px; max-width: none; font-size: 10.5px; line-height: 1.45; color: rgba(160,164,184,0.62); }

/* Groups: filled, no border, hairlines inset 12px like .wz-row */
.sset-subpop .agx .agx-group { border: none; border-radius: 10px; background: rgba(255,255,255,0.035);
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); transition: box-shadow 160ms ease; }
.sset-subpop .agx .agx-group > * + *, .sset-subpop .agx .wz-group > .wz-row + .agx-row, .sset-subpop .agx .agx-group > .agx-row + .wz-row {
  border-top: none !important;
  background-image: linear-gradient(rgba(255,255,255,0.055), rgba(255,255,255,0.055));
  background-size: calc(100% - 12px) 1px; background-position: 12px 0; background-repeat: no-repeat; }
.sset-subpop .agx .agx-group > .wz-row + *::before, .sset-subpop .agx .agx-group > * + .wz-row::before { display: none; }
.sset-subpop .agx .agx-group:focus-within:has(input:focus, textarea:focus) {
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07), 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }

/* Rows */
.sset-subpop .agx .agx-row { min-height: 44px; padding: 8px 12px; gap: 12px; }
.sset-subpop .agx .agx-row[data-stack="1"] { padding: 10px 12px 12px; gap: 8px; }
.sset-subpop .agx .agx-row[data-nested="1"] { padding-left: 24px; min-height: 40px; background-color: rgba(255,255,255,0.015); }
.sset-subpop .agx .agx-row-txt { gap: 2px; }
.sset-subpop .agx .agx-row-title { font-size: 12.5px; font-weight: 500; letter-spacing: -0.008em; }
.sset-subpop .agx .agx-row-hint { font-size: 10.5px; line-height: 1.4; color: rgba(160,164,184,0.66); }
.sset-subpop .agx .agx-row-ctl { gap: 6px; }
@media (hover: hover) { .sset-subpop .agx button.agx-row:hover:not(:disabled) { background-color: rgba(255,255,255,0.03); } }
.sset-subpop .agx .agx-val { font-size: 11.5px; }
.sset-subpop .agx .agx-group > .ags { padding: 0; margin: 0; }
.sset-subpop .agx .ags-head { min-height: 44px; padding: 8px 12px; box-sizing: border-box; gap: 8px; }
.sset-subpop .agx .ags-head-main { gap: 0; }
.sset-subpop .agx .ags-ico { display: none; }
.sset-subpop .agx .ags-title { font-size: 12.5px; letter-spacing: -0.008em; }
.sset-subpop .agx .ags-head > .ags-chev { order: 1; }
.sset-subpop .agx .ags-head > .ags-switch { order: 2; }
.sset-subpop .agx .ags[data-on="0"] .ags-chev { display: none; }
.sset-subpop .agx .ags-inner { padding: 2px 12px 12px; }
.sset-subpop .agx .agx-queue { padding: 10px 12px 12px; }
.sset-subpop .agx .agx-preview { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: rgba(160,164,184,0.66); }
.sset-subpop .agx .agx-preview b { font-weight: 550; color: rgba(214,216,232,0.92); }

/* Label + value rows (Name, Model, Display name) */
.sset-subpop .agx-body .agx .wz-row-label { flex: 0 0 84px; white-space: nowrap; }
.sset-subpop .agx .wz-row { min-height: 40px; }
.sset-subpop .agx .wz-input { height: 40px; }
.agx-model { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0; margin: 0;
  border: none; background: transparent; cursor: pointer; text-align: left; font: inherit; font-size: 12.5px;
  font-weight: 500; letter-spacing: -0.008em; color: var(--t1, #eeeef5); }
.agx-model > span { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500 !important; }
.agx-model > svg:last-child { color: rgba(160,164,184,0.6) !important; }
.agx-model:focus-visible { outline: none; }
.sset-subpop .agx .wz-group:has(.agx-model:focus-visible, .agx-model[aria-expanded="true"]) {
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07), 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }

/* Two-way choice on the right of a row */
.sset-subpop .agx .agx-seg { flex: 0 0 auto; width: 188px; }
.sset-subpop .agx .agx-seg button { height: 24px; font-size: 11.5px; }

/* Instructions: the text area fills its group, no second frame */
.sset-subpop .agx .agx-row:has(> .agx-ta) { padding: 0; }
.sset-subpop .agx .slw-input.agx-ta { min-height: 124px; padding: 10px 12px; margin: 0; font-size: 12.5px; line-height: 1.55;
  border: none !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; }

/* Folding sections read as one row until opened (like Features in a product) */
.sset-subpop .agx .agx-fold { gap: 8px; }
.sset-subpop .agx .agx-fold .agx-sec-title { flex: 1 1 auto; min-width: 0; }
.sset-subpop .agx .agx-fold .fold-chev { order: 3; margin-left: 2px; }
.sset-subpop .agx .agx-fold .agx-fold-sum, .sset-subpop .agx .agx-fold .agx-sec-aside { margin-left: 0 !important; flex: 0 1 auto; }
.sset-subpop .agx .agx-sec[data-fold="open"] > .agx-fold { padding: 0 2px; }
.sset-subpop .agx .agx-sec[data-fold="shut"] { padding: 0; border: none; border-radius: 10px; background: rgba(255,255,255,0.035);
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); }
.sset-subpop .agx .agx-sec[data-fold="shut"] > .agx-fold { height: 40px; padding: 0 12px; border-radius: 10px; }
.sset-subpop .agx .agx-sec[data-fold="shut"] .agx-sec-title { font-size: 12.5px; font-weight: 500; letter-spacing: -0.008em; color: var(--t1, #eeeef5); }
.sset-subpop .agx .agx-sec[data-fold="shut"] .agx-fold-sum { font-size: 11.5px; color: rgba(160,164,184,0.6); }
@media (hover: hover) { .sset-subpop .agx .agx-sec[data-fold="shut"] > .agx-fold:hover { background: rgba(255,255,255,0.03); } }

/* Realism presets: the group fill, accent only on the chosen one */
.sset-subpop .agx .agx-group:has(> * > .agx-feel) { background: none; box-shadow: none; border-radius: 0; overflow: visible; }
.sset-subpop .agx .agx-group > div:has(> .agx-feel) { padding: 0 !important; }
.sset-subpop .agx .agx-feel { gap: 6px; }
.sset-subpop .agx .agx-feel-opt { padding: 10px 11px 11px; border: none; border-radius: 10px; background: rgba(255,255,255,0.035);
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); }
@media (hover: hover) { .sset-subpop .agx .agx-feel-opt:hover { background: rgba(255,255,255,0.055); } }
.sset-subpop .agx .agx-feel-opt[aria-checked="true"] { background: color-mix(in oklab, var(--acc, #6c63ff) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.sset-subpop .agx .agx-feel-name { font-size: 12px; }
`;
  document.head.appendChild(st);
};

// Open / closed state of collapsible groups, remembered per group so a
// section you opened once stays open next time.
const bcFoldRead = (key, def) => {
  try { const v = window.localStorage.getItem('bc.fold.' + key); return v == null ? def : v === '1'; } catch (_) { return def; }
};
const bcFoldWrite = (key, on) => { try { window.localStorage.setItem('bc.fold.' + key, on ? '1' : '0'); } catch (_) {} };
const useFold = (key, def) => {
  const [open, setOpen] = React.useState(() => (key ? bcFoldRead(key, def) : true));
  const toggle = () => setOpen(o => { const n = !o; if (key) bcFoldWrite(key, n); return n; });
  return [open, toggle];
};
const FoldChev = ({open}) => (
  <svg className="fold-chev" data-open={open ? '1' : '0'} width="10" height="10" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
);

// collapse="key" makes the heading a disclosure; `summary` says what's set
// while it's closed, so nobody has to open it just to check.
const AgxSection = ({title, hint, aside, children, collapse, defaultOpen = false, summary}) => {
  const [open, toggle] = useFold(collapse, defaultOpen);
  if (collapse) {
    return (
      <section className="agx-sec" data-fold={open ? 'open' : 'shut'}>
        <button type="button" className="agx-fold" aria-expanded={open} onClick={toggle}>
          <FoldChev open={open}/>
          <span className="agx-sec-title">{title}</span>
          {!open && summary && <span className="agx-fold-sum">{summary}</span>}
          {open && aside && <span className="agx-sec-aside" style={{marginLeft:'auto'}}>{aside}</span>}
        </button>
        {open && hint && <p className="agx-sec-hint">{hint}</p>}
        {open && <div className="agx-group">{children}</div>}
      </section>
    );
  }
  return (
    <section className="agx-sec">
      {(title || aside) && (
        <div className="agx-sec-head">
          {title && <h3 className="agx-sec-title">{title}</h3>}
          {aside && <span className="agx-sec-aside">{aside}</span>}
        </div>
      )}
      {hint && <p className="agx-sec-hint">{hint}</p>}
      <div className="agx-group">{children}</div>
    </section>
  );
};

// A fold for any editor body: a caption that opens the extras below it.
const BcFold = ({title, summary, foldKey, defaultOpen = false, children}) => {
  ensureAgxStyles();
  const [open, toggle] = useFold(foldKey, defaultOpen);
  return (
    <div className="bc-fold" data-fold={open ? 'open' : 'shut'}>
      <button type="button" className="agx-fold" aria-expanded={open} onClick={toggle}>
        <FoldChev open={open}/>
        <span className="agx-sec-title">{title}</span>
        {!open && summary && <span className="agx-fold-sum">{summary}</span>}
      </button>
      {open && children}
    </div>
  );
};

// A row with its control on the right (or underneath, with stack).
const AgxRow = ({title, hint, note, stack = false, nested = false, off = false, children}) => (
  <div className="agx-row" data-stack={stack ? '1' : undefined} data-nested={nested ? '1' : undefined} data-off={off ? '1' : undefined}>
    <div className="agx-row-txt">
      <div className="agx-row-title">{title}{note && <span className="agx-note">{note}</span>}</div>
      {hint && <div className="agx-row-hint">{hint}</div>}
    </div>
    {children != null && <div className="agx-row-ctl">{children}</div>}
  </div>
);

// The whole row is the switch: one click target, one focus stop.
const AgxSwitch = ({title, hint, note, on, onChange, disabled = false, nested = false}) => (
  <button type="button" role="switch" aria-checked={!!on} className="agx-row"
    data-nested={nested ? '1' : undefined} data-off={disabled ? '1' : undefined}
    disabled={disabled} onClick={() => { if (!disabled) onChange(!on); }}>
    <span className="agx-row-txt">
      <span className="agx-row-title">{title}{note && <span className="agx-note">{note}</span>}</span>
      {hint && <span className="agx-row-hint">{hint}</span>}
    </span>
    <span className="agx-row-ctl"><span className="bc-switch" data-on={on ? '1' : '0'} aria-hidden="true"/></span>
  </button>
);

// − value + (the same stepper the wallet editor uses).
const AgxStepper = ({value, onChange, min = 0, max = 99, step = 1, label, suffix}) => {
  const v = Number.isFinite(Number(value)) ? Number(value) : min;
  const set = (n) => onChange(Math.max(min, Math.min(max, n)));
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:7}}>
      <span className="slw-step" role="group" aria-label={label}>
        <button type="button" aria-label={`Less ${label || ''}`.trim()} disabled={v <= min} onClick={() => set(v - step)}>−</button>
        <output aria-live="polite">{v}</output>
        <button type="button" aria-label={`More ${label || ''}`.trim()} disabled={v >= max} onClick={() => set(v + step)}>+</button>
      </span>
      {suffix && <span className="agx-span">{suffix}</span>}
    </span>
  );
};

// "2 to 9 sec" — both ends typed directly, tidied on blur so the low end
// never ends up above the high end.
const AgxSeconds = ({lo, hi, onChange, min = 0, max = 60, label}) => {
  const [a, setA] = React.useState(String(lo));
  const [b, setB] = React.useState(String(hi));
  React.useEffect(() => { setA(String(lo)); }, [lo]);
  React.useEffect(() => { setB(String(hi)); }, [hi]);
  const commit = () => {
    let x = parseInt(a, 10), y = parseInt(b, 10);
    if (!Number.isFinite(x)) x = lo;
    if (!Number.isFinite(y)) y = hi;
    x = Math.max(min, Math.min(max, x)); y = Math.max(min, Math.min(max, y));
    if (x > y) [x, y] = [y, x];
    setA(String(x)); setB(String(y));
    if (x !== lo || y !== hi) onChange(x, y);
  };
  const key = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } };
  return (
    <span className="agx-span">
      <input className="agx-num" type="number" inputMode="numeric" min={min} max={max} value={a}
        aria-label={`${label}, shortest in seconds`} onChange={e => setA(e.target.value)} onBlur={commit} onKeyDown={key}/>
      <span>to</span>
      <input className="agx-num" type="number" inputMode="numeric" min={min} max={max} value={b}
        aria-label={`${label}, longest in seconds`} onChange={e => setB(e.target.value)} onBlur={commit} onKeyDown={key}/>
      <span>sec</span>
    </span>
  );
};

// Native slider with the filled part drawn from --p.
const AgxRange = ({value, onChange, min = 0, max = 100, step = 1, label, disabled = false}) => {
  const v = Math.max(min, Math.min(max, Number(value) || 0));
  const p = ((v - min) / (max - min || 1)) * 100;
  return (
    <input type="range" className="agx-range" min={min} max={max} step={step} value={v}
      disabled={disabled} aria-label={label} style={{'--p': p + '%'}}
      onChange={e => onChange(Number(e.target.value))}/>
  );
};

// How often a "sometimes" behaviour happens, in words first.
const agxHowOften = (v, max) => {
  const n = Number(v) || 0;
  if (n <= 0) return 'Never';
  const r = n / max;
  return r <= 0.2 ? 'Rarely' : r <= 0.5 ? 'Sometimes' : 'Often';
};
const AgxChance = ({title, hint, value, onChange, max, disabled = false, note}) => (
  <div className="agx-row" data-stack="1" data-off={disabled ? '1' : undefined}>
    <div className="agx-head2">
      <div className="agx-row-txt">
        <div className="agx-row-title">{title}{note && <span className="agx-note">{note}</span>}</div>
        {hint && <div className="agx-row-hint">{hint}</div>}
      </div>
      <span className="agx-val">{disabled ? 'Off' : agxHowOften(value, max)}{!disabled && Number(value) > 0 && <small>{value}%</small>}</span>
    </div>
    <AgxRange value={disabled ? 0 : value} onChange={onChange} min={0} max={max} label={title} disabled={disabled}/>
  </div>
);

// ── Realism presets ───────────────────────────────────────────
// Same three presets the assistant uses when it sets an agent up in chat
// (bot-engine.jsx → REALISM PRESETS), so "Balanced" means one thing
// everywhere. Picking one fills every timing and typing setting below;
// changing any of those afterwards shows the choice as custom.
const AGX_FEEL = [
  { id:'instant',  name:'Instant',  bars:1, sub:'Answers right away. Reads like a bot.',
    v:{ wpm:200, typoRate:0, selfCorrectPct:0, hesitationPct:0, lowercaseDrift:false, delay:'instant',
        readDelayMin:0, readDelayMax:1, msgGapMin:0, msgGapMax:1, typingIndicator:false, waitForUserTyping:false } },
  { id:'balanced', name:'Balanced', bars:2, sub:'Quick, with short natural pauses.',
    v:{ wpm:90, typoRate:1, selfCorrectPct:8, hesitationPct:6, lowercaseDrift:false, delay:'natural',
        readDelayMin:2, readDelayMax:7, msgGapMin:1, msgGapMax:3, typingIndicator:true, waitForUserTyping:true } },
  { id:'human',    name:'Human',    bars:3, sub:'Types like a person, small slips included.',
    v:{ wpm:62, typoRate:3, selfCorrectPct:22, hesitationPct:18, lowercaseDrift:true, delay:'natural',
        readDelayMin:3, readDelayMax:14, msgGapMin:2, msgGapMax:6, typingIndicator:true, waitForUserTyping:true } },
];
const agxFeelOf = (d) => {
  const val = (k, def) => (d[k] == null ? def : d[k]);
  const cur = {
    wpm: val('wpm', 75), typoRate: val('typoRate', 0), selfCorrectPct: val('selfCorrectPct', 0),
    hesitationPct: val('hesitationPct', 0), lowercaseDrift: !!val('lowercaseDrift', false),
    delay: ['quick','thoughtful','instant'].includes(d.delay) ? d.delay : 'natural',
    readDelayMin: val('readDelayMin', 2), readDelayMax: val('readDelayMax', 9),
    msgGapMin: val('msgGapMin', 1), msgGapMax: val('msgGapMax', 4),
    typingIndicator: val('typingIndicator', true) !== false, waitForUserTyping: val('waitForUserTyping', true) !== false,
  };
  const hit = AGX_FEEL.find(f => Object.keys(f.v).every(k => {
    const a = f.v[k], b = cur[k];
    return typeof a === 'boolean' ? a === !!b : String(a) === String(b);
  }));
  return hit ? hit.id : null;
};
const agxWpmWord = (w) => w < 40 ? 'slow' : w < 65 ? 'relaxed' : w < 95 ? 'average' : w < 125 ? 'fast' : 'very fast';

const RealismTab = ({draft, update, onOpenHours}) => {
  const feel = agxFeelOf(draft);
  const applyFeel = (f) => Object.keys(f.v).forEach(k => update(k, f.v[k]));
  const style = draft.style || 'human';
  const styleName = (RESPONSE_STYLES.find(s => s.id === style) || {}).label || style;
  const typoLocked = ['pro','expert','concise'].includes(style);
  const lcLocked = ['pro','expert'].includes(style);
  const wpm = draft.wpm == null ? 75 : draft.wpm;
  const spamOn = draft.spamThrottle ?? true;
  const repOn = draft.repetitionGuard ?? true;
  const sch = SCHEDULE_GATE.normalize(draft.schedule);
  const awayVal = ['quick','thoughtful'].includes(draft.delay) ? draft.delay : 'natural';
  return (
    <div className="agx">
      <AgxSection title="Overall feel" aside={feel ? null : <span className="agx-custom">Custom settings</span>}
        hint="Pick a starting point. It fills in the timing and typing settings below, which you can still adjust.">
        <div style={{padding:10}}>
          <div className="agx-feel" role="radiogroup" aria-label="Overall feel">
            {AGX_FEEL.map(f => (
              <button key={f.id} type="button" role="radio" aria-checked={feel === f.id} className="agx-feel-opt"
                onClick={() => applyFeel(f)}>
                <span className="agx-feel-bars" aria-hidden="true">
                  {[1,2,3].map(i => <i key={i} data-on={i <= f.bars ? '1' : '0'}/>)}
                </span>
                <span className="agx-feel-name">{f.name}</span>
                <span className="agx-feel-sub">{f.sub}</span>
              </button>
            ))}
          </div>
        </div>
      </AgxSection>

      <AgxSection title="Timing">
        <AgxRow title="Wait before replying" hint="How long it “reads” a message before it starts typing">
          <AgxSeconds label="Wait before replying" lo={draft.readDelayMin ?? 2} hi={draft.readDelayMax ?? 9}
            onChange={(lo, hi) => { update('readDelayMin', lo); update('readDelayMax', hi); }}/>
        </AgxRow>
        <AgxRow title="Pause between messages" hint="When one reply is sent as a few separate messages">
          <AgxSeconds label="Pause between messages" lo={draft.msgGapMin ?? 1} hi={draft.msgGapMax ?? 4}
            onChange={(lo, hi) => { update('msgGapMin', lo); update('msgGapMax', hi); }}/>
        </AgxRow>
        <div className="agx-row" data-stack="1">
          <div className="agx-head2">
            <div className="agx-row-txt">
              <div className="agx-row-title">Typing speed</div>
              <div className="agx-row-hint">Longer replies take longer to type</div>
            </div>
            <span className="agx-val">{wpm} words a minute<small>{agxWpmWord(wpm)}</small></span>
          </div>
          <AgxRange value={wpm} onChange={v => update('wpm', v)} min={20} max={150} step={5} label="Typing speed"/>
        </div>
        <AgxRow title="Coming back to a quiet chat" hint="How long it takes to pick up a chat that went quiet">
          <SsetSelect icon="moon" value={awayVal} onChange={v => update('delay', v)} aria-label="Coming back to a quiet chat"
            options={[{value:'quick',label:'Quickly'},{value:'natural',label:'Normally'},{value:'thoughtful',label:'Slowly'}]}/>
        </AgxRow>
        {onOpenHours && (
          <AgxRow title="Reply hours" hint={sch.enabled ? SCHEDULE_GATE.describe(sch) : 'Replies at any time'}>
            <button type="button" className="agx-link" onClick={onOpenHours}>Change in Profile</button>
          </AgxRow>
        )}
      </AgxSection>

      <AgxSection title="Typing" collapse="agx.typing"
        summary={[(draft.typingIndicator ?? true) ? 'Shows typing' : 'No typing shown',
          (!typoLocked && (draft.typoRate || 0) > 0) ? 'typos ' + agxHowOften(draft.typoRate, 10).toLowerCase() : null].filter(Boolean).join(', ')}>
        <AgxSwitch title="Show “typing…”" hint="Customers see it typing before each message"
          on={draft.typingIndicator ?? true} onChange={v => update('typingIndicator', v)}/>
        <AgxChance title="Stop and start typing" hint="On longer replies, “typing…” pauses for a moment"
          max={50} value={draft.hesitationPct || 0} onChange={v => update('hesitationPct', v)}/>
        <AgxChance title="Typos" hint="Small spelling slips, never more than two a message" max={10}
          value={draft.typoRate || 0} onChange={v => update('typoRate', v)}
          disabled={typoLocked} note={typoLocked ? `Off for the ${styleName} style` : null}/>
        <AgxChance title="Fix its own words" hint="Follows up with a quick correction, like “*tomorrow”"
          max={25} value={draft.selfCorrectPct || 0} onChange={v => update('selfCorrectPct', v)}/>
        <AgxSwitch title="Casual lowercase" hint="Short replies skip the capital letter and full stop"
          on={!lcLocked && (draft.lowercaseDrift ?? false)} onChange={v => update('lowercaseDrift', v)}
          disabled={lcLocked} note={lcLocked ? `Off for the ${styleName} style` : null}/>
      </AgxSection>

      <AgxSection title="Chat manners" collapse="agx.manners"
        summary={`${[draft.waitForUserTyping ?? true, !!draft.readReceipts, draft.stopAfterSale ?? false].filter(Boolean).length} of 3 on`}>
        <AgxSwitch title="Wait while they type" hint="Holds its reply if the customer starts typing again"
          on={draft.waitForUserTyping ?? true} onChange={v => update('waitForUserTyping', v)}/>
        <AgxSwitch title="Mark messages as read" hint="Shows “seen” to the customer. Telegram user accounts only."
          on={!!draft.readReceipts} onChange={v => update('readReceipts', v)}/>
        {/* "Skip replies that aren't needed" was removed — it's always on
            now (see agent.silenceMode in bot-engine.jsx). An agent never
            answers a bare "ok", 👍 or plain thank-you. */}
        <AgxSwitch title="Go quiet after a sale" hint="Sends the delivery message, then leaves the chat to you"
          on={draft.sellCatalog !== false && (draft.stopAfterSale ?? false)} onChange={v => update('stopAfterSale', v)}
          disabled={draft.sellCatalog === false} note={draft.sellCatalog === false ? 'This agent doesn’t sell' : null}/>
      </AgxSection>

      <AgxSection title="Protection" collapse="agx.protect"
        summary={`${[spamOn, repOn].filter(Boolean).length} of 2 on`}>
        <AgxSwitch title="Slow down for spammers" hint="Stops replying for a while to people who flood the chat"
          on={spamOn} onChange={v => update('spamThrottle', v)}/>
        {spamOn && (
          <AgxRow nested title="Pause for" hint="Doubles each time they do it again">
            <AgxStepper label="pause" value={draft.spamCooldownSec ?? 60} min={5} max={1800} step={15}
              onChange={v => update('spamCooldownSec', v)} suffix="sec"/>
          </AgxRow>
        )}
        <AgxSwitch title="Avoid repeating itself" hint="Rewrites a reply that starts the same way as a recent one"
          on={repOn} onChange={v => update('repetitionGuard', v)}/>
        {repOn && (
          <AgxRow nested title="Compare with" hint="Between 4 and 8 works well">
            <AgxStepper label="replies" value={draft.repetitionWindow ?? 6} min={2} max={20}
              onChange={v => update('repetitionWindow', v)} suffix="last replies"/>
          </AgxRow>
        )}
      </AgxSection>
    </div>
  );
};

// ── Profile ──
// Built from the product editor's parts (.wz-group / .wz-row / .pe-cap):
// label-and-value rows for the basics, then one group for what customers
// see, then reply hours. Nothing is framed twice and every row starts on
// the same 12px inset.
const AgentProfileTab = ({draft, update, tg, dc, models, hoursOpen, setHoursOpen, agentKey}) => {
  const tgName = (tg && tg.connected) ? (tg.botName || (tg.username||'').replace(/^@/,'')) : '';
  const dcName = (dc && dc.connected) ? (dc.botName || (dc.username||'').replace(/^@/,'')) : '';
  const accounts = [tgName, dcName].filter(Boolean);
  const isSelf = (draft.identityMode || 'agent') === 'self';
  const shownName = isSelf
    ? ((draft.selfName || '').trim() || accounts.join(', '))
    : (draft.name || '').trim();
  return (
    <div className="agx">
      <section className="agx-sec">
        <div className="wz-group" data-field="1">
          <label className="wz-row">
            <span className="wz-row-label">Name</span>
            <input className="wz-input" value={draft.name} onChange={e => update('name', e.target.value)}
              placeholder="e.g. Sales assistant" maxLength={80}/>
          </label>
          <div className="wz-row" title="Only models you have an API key for are listed">
            <span className="wz-row-label">Model</span>
            <ModelPicker bare value={draft.model} options={models} onChange={m => update('model', m)}/>
          </div>
        </div>
      </section>

      <AgxSection title="In chats">
        <div className="agx-row">
          <div className="agx-row-txt">
            <div className="agx-row-title">Shown as</div>
            <div className="agx-row-hint agx-preview">
              {shownName
                ? <>Customers see <b>{shownName}</b></>
                : (isSelf ? 'Connect Telegram or Discord, or type a name' : 'Give the agent a name above')}
            </div>
          </div>
          <div className="agx-row-ctl">
            <div className="wz-seg agx-seg" role="radiogroup" aria-label="Name shown in chats">
              {[{v:'agent', l:'Agent name'},{v:'self', l:'My account'}].map(o => {
                const sel = (draft.identityMode || 'agent') === o.v;
                return (
                  <button key={o.v} type="button" role="radio" aria-checked={sel}
                    onClick={() => update('identityMode', o.v)}>{o.l}</button>
                );
              })}
            </div>
          </div>
        </div>
        {isSelf && (
          <label className="wz-row agx-field">
            <span className="wz-row-label">Display name</span>
            <input className="wz-input" type="text" value={draft.selfName || ''} maxLength={200}
              onChange={e => update('selfName', e.target.value)}
              placeholder={accounts.length ? `${accounts[0]} (account name)` : 'Your account name'}/>
          </label>
        )}
        <AgxSwitch title="Admit it’s an AI when asked"
          hint={draft.revealAi ? 'Says it’s an AI if a customer asks' : 'Only if your instructions allow it'}
          on={!!draft.revealAi} onChange={v => update('revealAi', v)}/>
      </AgxSection>

      <AgxSection title="When it replies">
        <AgentReplyHours draft={draft} update={update} agentKey={agentKey} open={hoursOpen} setOpen={setHoursOpen}/>
      </AgxSection>
    </div>
  );
};

// ── Personality ──
const AgentPersonalityTab = ({draft, update}) => {
  const len = (draft.persona || '').length;
  const style = RESPONSE_STYLES.find(s => s.id === draft.style);
  return (
    <div className="agx">
      <AgxSection title="Instructions" aside={len > 3000 ? <span className="agx-count" data-warn={len > 3800 ? '1' : undefined}>{len} / 4000</span> : null}
        hint={draft.sellCatalog === false
          ? 'Tell it who it is, what it helps with and any rules to follow. Plain sentences work best.'
          : 'Tell it who it is, what you sell and any rules to follow. Plain sentences work best.'}>
        <div className="agx-row" data-stack="1">
          <textarea className="slw-input agx-ta" rows={6} value={draft.persona || ''} aria-label="Instructions"
            onChange={e => update('persona', e.target.value)}
            placeholder={'You’re the friendly assistant for Acme.\nKeep replies short.\nSend refund questions to a person.'}/>
        </div>
      </AgxSection>

      <AgxSection title="Voice">
        <AgxRow title="Writing style" hint={style ? style.desc : null}>
          <SsetSelect icon="pen" value={draft.style || 'human'} onChange={v => update('style', v)} aria-label="Writing style"
            options={RESPONSE_STYLES.map(s => ({value:s.id, label:s.label}))}/>
        </AgxRow>
        <AgxRow title="Tone" hint="The mood of its replies">
          <SsetSelect icon="smile" value={draft.tone || 'Friendly'} onChange={v => update('tone', v)} aria-label="Tone"
            options={TONES}/>
        </AgxRow>
        <AgxSwitch title="Use emoji" hint="Adds the odd emoji where it fits" on={draft.emoji ?? true} onChange={v => update('emoji', v)}/>
      </AgxSection>

      <AgxSection title="Handing over to you" collapse="agx.handover"
        summary={({'On request':'When the customer asks','3 failures':'After 3 missed answers','5 failures':'After 5 missed answers','Never':'Never'})[draft.escalate || '3 failures']}>
        <AgxRow title="Pass the chat to you" hint="It stops replying and flags the chat for you">
          <SsetSelect icon="hand" value={draft.escalate || '3 failures'} onChange={v => update('escalate', v)} aria-label="Pass the chat to you"
            options={[
              {value:'On request', label:'When the customer asks'},
              {value:'3 failures', label:'After 3 missed answers'},
              {value:'5 failures', label:'After 5 missed answers'},
              {value:'Never',      label:'Never'},
            ]}/>
        </AgxRow>
      </AgxSection>
    </div>
  );
};

// ── Permissions ──
// ── Profile DMs rows (Permissions → Where it replies) ────────────────
// Direct messages people send to your BotCommand profile. They are the
// only chats that can be answered with every browser closed; Telegram and
// Discord run in the desktop app. Both switches are account-wide and take
// effect at once, after their approval notice, not on "Save changes".
const dmAgo = (sec) => sec == null ? '' : sec < 60 ? 'just now' : sec < 3600 ? `${Math.round(sec / 60)} min ago`
  : sec < 86400 ? `${Math.round(sec / 3600)} h ago` : `${Math.round(sec / 86400)} d ago`;
const AgentDmRows = ({agentId, draft}) => {
  if (typeof useDm === 'function') useDm();
  if (typeof useDmAi === 'function') useDmAi();
  const [busy, setBusy] = React.useState(false);
  const [consent, setConsent] = React.useState(null);
  React.useEffect(() => { try { if (typeof DM_AI !== 'undefined') DM_AI.load(); } catch (_) {} }, []);
  if (typeof DM_AI === 'undefined' || typeof DM_KEYS === 'undefined' || !DM_KEYS.acc) return null;

  const id = Number(agentId) || 0;
  const autoId = Number(DM_AI.auto) || 0;
  const mine = !!id && autoId === id;
  const other = autoId && !mine ? DM_AI.agentById(autoId) : null;
  const offOn = !!DM_AI.offline;
  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { bcToast(String((e && e.message) || e), 'err'); }
    finally { setBusy(false); }
  };
  const askAuto = async () => {
    const ag = DM_AI.agentById(id) || { ...draft, id };
    try { await DM_AI.load(); } catch (_) {}
    setConsent({ agent: ag });
  };

  // How offline replies are doing, only while they're on.
  let st = null;
  if (offOn) {
    const o = DM_AI.offlineStatus || {};
    if (o.key_ok === false) st = { t: 'Offline replies stopped', s: 'Turn them off and on again', warn: true };
    else if (o.last_error) st = { t: 'Last offline reply failed', s: o.last_error + (o.last_ago != null ? ` (${dmAgo(o.last_ago)})` : ''), warn: true };
    else if (!autoId) st = { t: 'Only chats with an agent', s: 'Turn on Profile DMs to include new chats' };
    else if (o.last_ago != null) st = { t: 'Offline replies working', s: `Last one ${dmAgo(o.last_ago)}` };
  }

  return (
    <>
      <AgxSwitch title="Profile DMs"
        hint={other ? `Now answered by ${other.name}` : 'People who message you from your profile link'}
        note={!id ? 'Save the agent first' : null}
        on={mine} disabled={!id || busy}
        onChange={v => { if (v) askAuto(); else run(() => DM_AI.setAuto(0)); }}/>
      <AgxSwitch nested title="Reply while you’re offline"
        hint={DM_AI.offlineSupported || offOn ? 'Profile DMs only, even with every browser closed' : 'Needs PHP 7.3+ with OpenSSL on your server'}
        note={!DM_AI.offlineSupported && !offOn ? 'Not available' : null}
        on={offOn} disabled={busy || DM_KEYS.state !== 'ready' || (!offOn && !DM_AI.offlineSupported)}
        onChange={v => { if (v) setConsent({ offline: true }); else run(() => DM_AI.setOffline(false)); }}/>
      {st && <AgxRow nested title={st.t} hint={st.s} note={st.warn ? 'Check' : null}/>}
      {consent && consent.offline && typeof DmAiConsentPopup !== 'undefined' && (
        <DmAiConsentPopup scope="offline" onConfirm={() => DM_AI.setOffline(true, true)} onClose={() => setConsent(null)}/>
      )}
      {consent && consent.agent && typeof DmAiConsentPopup !== 'undefined' && (
        <DmAiConsentPopup agent={consent.agent} llm={DM_AI.describe(consent.agent.id)} scope="all"
          onConfirm={() => DM_AI.setAuto(consent.agent.id, true)} onClose={() => setConsent(null)}/>
      )}
    </>
  );
};

const AgentPermissionsTab = ({draft, update, agentId}) => {
  const schedOn = !!draft.allowScheduling;
  const custOn = schedOn && !!draft.allowCustomerScheduling;
  const inGroups = !!draft.replyGroups || !!draft.replyChannels;
  const sells = draft.sellCatalog !== false;
  return (
    <div className="agx">
      <AgxSection title="Selling">
        <AgxSwitch title="Sell from your catalog"
          hint={sells ? 'Offers products, quotes prices and sends invoices' : 'Never mentions products or prices, or takes payment'}
          on={sells} onChange={v => { update('sellCatalog', v); if (!v) update('stopAfterSale', false); }}/>
      </AgxSection>

      <AgxSection title="Where it replies" hint="Telegram and Discord reply while the desktop app is open.">
        <AgxSwitch title="Answer new chats" hint="Off: it only replies in chats you switch on yourself"
          on={draft.autoReply ?? true} onChange={v => update('autoReply', v)}/>
        <AgxSwitch title="Direct messages" hint="One-to-one Telegram and Discord chats" on={!!draft.replyPrivate} onChange={v => update('replyPrivate', v)}/>
        <AgxSwitch title="Groups and servers" hint="Telegram groups and Discord servers" on={!!draft.replyGroups} onChange={v => update('replyGroups', v)}/>
        <AgxSwitch title="Channels" hint="Telegram channels" on={!!draft.replyChannels} onChange={v => update('replyChannels', v)}/>
        <AgxSwitch nested title="Only when mentioned" hint="In groups and channels, waits for an @mention or a reply to it"
          on={!!draft.replyOnlyIfMentioned} onChange={v => update('replyOnlyIfMentioned', v)}
          disabled={!inGroups} note={!inGroups ? 'Turn on groups or channels first' : null}/>
        <AgentDmRows agentId={agentId} draft={draft}/>
        <AgxSwitch title="Message people first" hint="Can start a conversation instead of waiting to be asked"
          on={!!draft.proactive} onChange={v => update('proactive', v)}/>
      </AgxSection>

      <AgxSection title="Follow-ups" collapse="agx.follow"
        summary={!schedOn ? 'Off' : custOn ? 'On, customers can book' : 'On'}>
        <AgxSwitch title="Plan messages for later" hint="For example “remind Marco in 10 minutes”"
          on={schedOn} onChange={v => { update('allowScheduling', v); if (!v) update('allowCustomerScheduling', false); }}/>
        <AgxSwitch title="Let customers book a callback" hint="A customer can say “message me tomorrow at 6”"
          on={custOn} disabled={!schedOn} note={!schedOn ? 'Needs the option above' : null}
          onChange={v => update('allowCustomerScheduling', v)}/>
        {custOn && (<>
          <AgxRow nested title="Open requests per customer">
            <AgxStepper label="open requests" min={1} max={10} value={draft.custSchedMaxPending == null ? 3 : draft.custSchedMaxPending}
              onChange={v => update('custSchedMaxPending', v)}/>
          </AgxRow>
          <AgxRow nested title="New requests per day">
            <AgxStepper label="requests a day" min={1} max={20} value={draft.custSchedMaxPerDay == null ? 5 : draft.custSchedMaxPerDay}
              onChange={v => update('custSchedMaxPerDay', v)}/>
          </AgxRow>
          <AgxRow nested title="Furthest ahead">
            <AgxStepper label="days" min={1} max={365} value={draft.custSchedMaxDays == null ? 60 : draft.custSchedMaxDays}
              onChange={v => update('custSchedMaxDays', v)} suffix="days"/>
          </AgxRow>
          <AgxSwitch nested title="No messages at night" hint="Anything between 10pm and 8am moves to the morning"
            on={draft.custSchedQuietHours !== false} onChange={v => update('custSchedQuietHours', v)}/>
        </>)}
        {schedOn && typeof SchedQueue !== 'undefined' && (
          <div className="agx-queue">
            <span className="agx-queue-title">Coming up</span>
            <SchedQueue agentId={agentId} emptyText="Nothing planned yet."/>
          </div>
        )}
      </AgxSection>

      {/* "Change licenses" and "Change unpaid invoices" were removed. Fixing
          or cancelling an unpaid invoice is simply part of selling now (the
          agent could already swap an unpaid order for a corrected one), and
          hand-made licence changes — issuing one manually, free days,
          pausing a key — are left to you. The server enforces both; see
          "RETIRED" near the migrations in api.php. */}
      <AgxSection title="Customer accounts" collapse="agx.accounts"
        summary={draft.allowAiRenewals !== false ? 'Renewals on' : 'Renewals off'}
        hint="Paid orders always get their license automatically. Anything else about a license is handed over to you.">
        <AgxSwitch title="Renew expired licenses" hint="When a customer pays again, their existing serial key is extended and works again instead of a new one being made"
          on={draft.allowAiRenewals !== false}
          onChange={v => update('allowAiRenewals', v)}/>
      </AgxSection>
    </div>
  );
};

const AgentsView = ({_embed} = {}) => {
  const agents = useAgents();
  const [tg, dc] = useConn();
  const agentCreds = useCreds();
  const [loading, setLoading] = React.useState(!AGENTS_STORE.loaded);
  const [selectedId, setSelectedId] = React.useState(null);
  const [creating, setCreating]     = React.useState(false);
  const [tab, setTab]               = React.useState('identity');
  const [agentQ, setAgentQ]         = React.useState('');
  const [agentFilter, setAgentFilter] = React.useState('all');
  ensureAgxStyles();
  // Open agent's name floats above the window (see useSsetCrumb).
  {
    const openAgent = !creating && selectedId != null ? (agents || []).find(a => a.id === selectedId) : null;
    useSsetCrumb(_embed && (creating || openAgent) ? 'Agents' : null,
      creating ? 'New agent' : (openAgent ? (openAgent.name || 'Untitled') : ''),
      () => { setCreating(false); setSelectedId(null); });
  }

  React.useEffect(()=>{
    if (AGENTS_STORE.loaded) {
      // Full-page mode auto-selects the first agent so the editor is
      // visible. Embedded mode (slideout sub-popup) shows the list first
      // — operator picks an agent or "+ New" to enter the editor.
      if (!_embed && AGENTS_STORE.list.length && selectedId==null) setSelectedId(AGENTS_STORE.list[0].id);
      setLoading(false); return;
    }
    apiGet('get_agents').then(res=>{
      AGENTS_STORE.load(res.agents || []);
      if (!_embed && AGENTS_STORE.list.length) setSelectedId(AGENTS_STORE.list[0].id);
      setLoading(false);
    });
  // eslint-disable-next-line
  },[]);

  const MODELS = [
    'gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite',
    'gemini-3-pro-preview','gemini-3-flash-preview',
    'gpt-5.4','gpt-5.4-mini','gpt-5.4-nano','gpt-5.3','gpt-4.1','gpt-4.1-mini','gpt-4.1-nano',
    'claude-opus-4-7','claude-opus-4-6','claude-sonnet-4-6','claude-haiku-4-5-20251001',
  ];

  const selected = creating ? null : agents.find(a=>a.id===selectedId);
  const blank = {
    name:'',model:'gemini-2.5-flash',persona:'',tasks:[],plat:[],active:true,
    wpm:75,delay:'natural',style:'human',tone:'Friendly',
    escalate:'3 failures',emoji:true,proactive:false,replies:0,conv:0,
    autoReply:true,typingIndicator:true,
    readDelayMin:2,readDelayMax:9,msgGapMin:1,msgGapMax:4,
    replyPrivate:true,replyGroups:false,replyChannels:false,replyOnlyIfMentioned:true,
    // Paid renewals of an existing serial. ON by default: a customer whose
    // key has run out can pay again and keep the SAME key.
    allowAiRenewals:true,
    // Deferred actions. Both default OFF: scheduling lets the agent act
    // while nobody is watching, and customer scheduling exposes a (tiny)
    // slice of that to the public, so neither is switched on for an
    // existing agent without the operator saying so.
    allowScheduling:false, allowCustomerScheduling:false,
    custSchedMaxPending:3, custSchedMaxPerDay:5, custSchedMaxDays:60,
    custSchedQuietHours:true,
    identityMode:'agent', selfName:'',
    // Off by default: the agent never brings up being an AI unless this is
    // on or its instructions tell it to.
    revealAi:false,
    // On by default: the agent sells from the catalogue. Off for support,
    // community or info agents that should never mention products or prices.
    sellCatalog:true,
    stopAfterSale:false,
    schedule: SCHEDULE_GATE.normalize(null),
  };
  const [draft, setDraft] = React.useState(blank);
  const [saved, setSaved] = React.useState(false);
  // Fix #3: the "custom name" override is tucked away behind a slideout so it
  // isn't visible by default (it looked cluttered always-open). Opens only
  // when the operator taps "Set a custom name", or stays open if a custom
  // name is already saved on the agent so they can see/edit it.
  const [showCustomName, setShowCustomName] = React.useState(false);
  React.useEffect(()=>{
    setShowCustomName(!!((draft && draft.selfName || '').trim()));
  }, [selectedId, creating]);

  // Reply hours panel — collapsed by default so the popup opens compact.
  // Held here (not inside the editor) so it survives switching tabs, and so
  // the Realism tab's "Reply hours" row can open it.
  const [hoursOpen, setHoursOpen] = React.useState(false);

  React.useEffect(()=>{
    setHoursOpen(false);
    if (creating) { setDraft(blank); setTab('identity'); }
    else if (selected) { setDraft({...selected}); setTab('identity'); }
  },[selectedId, creating]);

  const update = (k,v) => setDraft(d=>({...d,[k]:v}));
  const tog    = (k,v) => setDraft(d=>({...d,[k]:d[k].includes(v)?d[k].filter(x=>x!==v):[...d[k],v]}));

  // "Answer new BotCommand messages" chosen in the wizard. It isn't part
  // of the agent record: once the agent exists, the approval notice asks.
  const [dmConsent, setDmConsent] = React.useState(null);
  const saveAgent = () => {
    const { _dmAuto, ...body } = draft;
    if (creating) {
      // Returned so the new-agent wizard can show "Creating…" until done.
      return apiFetch('save_agent', body).then(res=>{
        if (res.error) { bcToast('Couldn’t create the agent — ' + res.error, 'err'); return; }
        if (!res.id)   { bcToast('Couldn’t create the agent — the server didn’t confirm it', 'err'); return; }
        const newAgent = {...body, id: parseInt(res.id,10)};
        AGENTS_STORE.upsert(newAgent);
        setCreating(false); setSelectedId(newAgent.id);
        bcToast('Agent created', 'ok', { detail: draft.name || undefined });
        if (_dmAuto && typeof DM_AI !== 'undefined') {
          const ask = () => setDmConsent(newAgent);
          try { Promise.resolve(DM_AI.load()).then(ask, ask); } catch (_) { ask(); }
        }
      }).catch(e => bcToast('Couldn’t create the agent — ' + ((e && e.message) || 'network error'), 'err'));
    } else {
      apiFetch('save_agent', body).then(res=>{
        if (res.error) { bcToast('Couldn’t save changes — ' + res.error, 'err'); return; }
        AGENTS_STORE.upsert({...body, id: selectedId});
        setSaved(true); setTimeout(()=>setSaved(false), 2000);
        bcToast('Changes saved', 'ok', { detail: draft.name || undefined });
      }).catch(e => bcToast('Couldn’t save changes — ' + ((e && e.message) || 'network error'), 'err'));
    }
  };

  const deleteAgent = () => {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.name}"?`)) return;
    const gone = selected;
    apiFetch('delete_agent',{id:selected.id}).then(res => {
      if (res && res.error) { AGENTS_STORE.upsert(gone); bcToast('Couldn’t delete ' + (gone.name || 'the agent') + ' — ' + res.error, 'err'); }
      else bcToast('Agent deleted', 'ok', { detail: gone.name || undefined });
    }).catch(() => { AGENTS_STORE.upsert(gone); bcToast('Network error — ' + (gone.name || 'the agent') + ' was not deleted', 'err'); });
    AGENTS_STORE.remove(selectedId);
    const remaining = AGENTS_STORE.list;
    setSelectedId(remaining[0]?.id);
  };

  // Pause / activate straight from the list or the editor footer. Written
  // from the STORED agent, not the draft, so flipping status never commits
  // unsaved edits; the draft just mirrors the new value.
  const toggleActive = (a) => {
    if (!a) return;
    const next = {...a, active: !a.active};
    AGENTS_STORE.upsert(next);
    if (a.id === selectedId) setDraft(d => ({...d, active: next.active}));
    apiFetch('save_agent', next).then(res => {
      if (res && res.error) {
        AGENTS_STORE.upsert(a);
        if (a.id === selectedId) setDraft(d => ({...d, active: a.active}));
        bcToast('Couldn’t update ' + (a.name || 'the agent') + ' — ' + res.error, 'err');
      } else {
        bcToast(next.active ? 'Agent is replying' : 'Agent paused', 'ok', { detail: a.name || undefined });
      }
    });
  };
  const flipDraftActive = () => {
    if (creating || !selected) { update('active', !draft.active); return; }
    toggleActive(selected);
  };

  const hasDraft = draft && selected;

  // New agents are set up with a guided wizard in the popup; the tabbed
  // editor below is for agents that already exist.
  if (_embed && creating) {
    return (
      <AgentWizard draft={draft} update={update} models={MODELS} tg={tg} dc={dc}
        onFinish={saveAgent} onCancel={() => { setCreating(false); setSelectedId(null); }}/>
    );
  }

  // ── render ──────────────────────────────────────────────────
  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden',background:'transparent'}}>

      {/* ── LEFT: agent list ────────────────────────────────── */}
      {/* In embed (sheet) mode, hide the list when an editor is open so the
          narrow sheet can use its full width for the form. A "‹ Agents" back
          button is added to the editor header to return to the list. */}
      {/* Popup landing — same tabs, search and list as Catalog and
          Licenses & payments (SsetLandHead / SsetLandTabs in
          bot-ui-settings.jsx), so switching sections never re-lays-out.
          The tabs render as the symbol pill above the window. */}
      {_embed && !selected && !creating && (() => {
        const nActive = agents.filter(a => a.active).length;
        const nPaused = agents.length - nActive;
        const inTab = agents.filter(a => agentFilter === 'all' || (agentFilter === 'active' ? a.active : !a.active));
        const found = inTab.filter(a => bcMatch(agentQ, a.name, a.model));
        const startNew = () => { setCreating(true); setSelectedId(null); };
        return (
          <div className="lnd" style={{flex:'1 1 auto',minWidth:0}}>
            <SsetLandHead title="Agents"
              stats={agents.length ? [
                {n:nActive, label:'replying', tone: nActive ? 'ok' : undefined},
                nPaused ? {n:nPaused, label:'paused'} : null,
              ] : [{label:'None yet'}]}/>
            <SsetLandTabs label="Filter agents" value={agentFilter} onChange={setAgentFilter} tabs={[
              {id:'all', label:'All', n:agents.length},
              {id:'active', label:'Replying', n:nActive},
              {id:'paused', label:'Paused', n:nPaused},
            ]}/>
            <div className="sl-bar">
              <BcSearch value={agentQ} onChange={setAgentQ} placeholder="Search by name or model"/>
              <SsetLandAdd label="New agent" onClick={startNew}/>
            </div>
            <div className="sl-scroll">
              <div className="sl-list">
                {loading ? (
                  <div className="sl-empty"><div className="sl-empty-sub">Loading…</div></div>
                ) : found.length === 0 ? (
                  <SsetLandEmpty
                    title={!agents.length ? 'No agents yet' : agentQ ? 'No agents match your search' : agentFilter === 'paused' ? 'No paused agents' : 'No agents replying'}
                    sub={!agents.length ? 'An agent answers your customers for you. Set one up in a few steps.' : agentQ ? 'Try a different name or model.' : 'Open an agent to switch it on or off.'}
                    action={!agents.length ? {label:'New agent', onClick:startNew} : null}/>
                ) : found.map(a => {
                  const offHours = a.active && a.schedule && a.schedule.enabled && !SCHEDULE_GATE.isOpen(a.schedule);
                  const initial = ((a.name||'?').trim().charAt(0) || '?').toUpperCase();
                  const open = () => { setCreating(false); setSelectedId(a.id); };
                  return (
                    <div key={a.id} role="button" tabIndex={0} className="sl-row" data-off={a.active ? '0' : '1'}
                      onClick={open}
                      onKeyDown={e=>{ if (e.target===e.currentTarget && (e.key==='Enter'||e.key===' ')) { e.preventDefault(); open(); } }}>
                      <span className="sl-row-media"><SlTile letter={initial}/></span>
                      <span className="sl-row-main">
                        <span className="sl-row-title">{a.name || 'Untitled'}</span>
                        <span className="sl-row-meta">
                          <span className="sl-stat" data-s={!a.active ? 'cancelled' : offHours ? 'expiring' : 'active'}>
                            <i aria-hidden="true"/>{!a.active ? 'Paused' : offHours ? 'Outside hours' : 'Replying'}
                          </span>
                        </span>
                      </span>
                      <span className="sl-row-trail"><svg className="sl-row-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {!_embed && (
      <div style={{
        width: _embed ? '100%' : 210, flexShrink:0, display:'flex', flexDirection:'column',
        borderRight: _embed ? 'none' : '0.5px solid rgba(255,255,255,0.06)',
        background: _embed ? 'transparent' : 'linear-gradient(180deg, rgba(13,14,24,0.65) 0%, rgba(11,12,20,0.7) 100%)',
      }}>
        <div style={{padding: _embed?'16px 18px 8px':'14px 12px 8px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <span style={{fontSize:_embed?11:10.5,fontWeight:_embed?600:700,color: _embed?'var(--t2)':'var(--t3)',textTransform:_embed?'none':'uppercase',letterSpacing:_embed?'-0.005em':'0.08em'}}>
            {_embed ? `${agents.length} agent${agents.length===1?'':'s'}` : 'Agents'}
          </span>
          {_embed ? (
            <button onClick={()=>{setCreating(true);setSelectedId(null);}} className="sset-ghost-btn">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New
            </button>
          ) : (
            <span style={{fontSize:10,color:'var(--t4)',fontFamily:'var(--mono)'}}>{agents.length}</span>
          )}
        </div>

        <div style={{flex: _embed?'1 1 auto':'0 1 auto',overflowY:'auto',padding: _embed?'0 18px 18px':'0 6px',display:'flex',flexDirection:'column',gap: _embed?5:2}}>
          {loading ? (
            <div className="sset-pop-empty" style={{border:'none',background:'none'}}>
              <div className="sset-pop-empty-sub">Loading…</div>
            </div>
          ) : agents.length === 0 ? (
            <div className="sset-pop-empty">
              <div className="sset-pop-empty-title">No agents yet</div>
              <div className="sset-pop-empty-sub">Create one to start replying to customers.</div>
            </div>
          ) : agents.map(a=>(
            <AgentListItem key={a.id} agent={a}
              selected={!creating && a.id===selectedId}
              onClick={()=>{setCreating(false);setSelectedId(a.id);}}
              onToggle={toggleActive}/>
          ))}
        </div>

        {/* Full-mode bottom "New Agent" button — embed mode uses inline ghost button at top */}
        {!_embed && (
        <div style={{padding:'10px 6px 14px',borderTop:'0.5px solid rgba(255,255,255,0.05)'}}>
          <button onClick={()=>{setCreating(true);setSelectedId(null);}}
            style={{
              width:'100%', padding:'8px 12px', borderRadius:8, fontSize:12.5, fontWeight:500,
              display:'flex', alignItems:'center', gap:7, justifyContent:'center',
              cursor:'pointer', transition:'all 0.12s',
              background:creating?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.04)',
              color:creating?'var(--t1)':'var(--t2)',
              border:`1px solid ${creating?'rgba(255,255,255,0.16)':'rgba(255,255,255,0.07)'}`,
            }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Agent
          </button>
        </div>
        )}
      </div>
      )}

      {/* ── RIGHT: config panel ─────────────────────────────── */}
      {(selected || creating) ? (
        <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,overflow:'hidden'}}>

          {/* Header bar — full mode only. Embed mode (in the popup) has
              no header at all; the back button + name live as a slim
              breadcrumb above the tab bar instead. */}
          {!_embed && (
          <div style={{
            height:48, flexShrink:0, display:'flex', alignItems:'center',
            justifyContent:'space-between', padding:'0 20px',
            borderBottom:'1px solid var(--ln)',
            background:'rgba(10,11,20,0.55)',backdropFilter:'blur(16px) saturate(160%)',WebkitBackdropFilter:'blur(16px) saturate(160%)',
          }}>
            <div style={{display:'flex',alignItems:'center',gap:9}}>
              <div style={{width:7,height:7,borderRadius:'50%',flexShrink:0,
                background:draft.active?'var(--ok)':'var(--t4)',
                boxShadow:'none'}}/>
              <span style={{fontSize:13.5,fontWeight:600,color:'var(--t1)',letterSpacing:'-0.01em'}}>
                {creating?'New Agent':(draft.name||'Untitled')}
              </span>
            </div>
            <div/>
          </div>
          )}

          {/* Embed-only back-nav strip — headerless multi-page popup style.
              Just a back link on the left; no title/name (already known from
              the row that opened the popup) so the form starts immediately. */}
          {/* Tab bar — in the popup the "back to all agents" button sits at
              the start of the same row, saving a whole strip of height. */}
          {_embed ? (
            <div className="agx-tabs" role="tablist" aria-label="Agent settings"
              onKeyDown={e => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const i = AGENT_TABS.findIndex(t => t.id === tab);
                const next = AGENT_TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + AGENT_TABS.length) % AGENT_TABS.length];
                setTab(next.id);
                const b = e.currentTarget.querySelector(`[data-tab="${next.id}"]`);
                if (b) b.focus({ preventScroll: true });
              }}>
              {AGENT_TABS.map(t=>(
                <button key={t.id} type="button" role="tab" className="agx-tab" data-tab={t.id}
                  aria-selected={tab===t.id} tabIndex={tab===t.id ? 0 : -1}
                  onClick={()=>setTab(t.id)}>{t.label}</button>
              ))}
            </div>
          ) : (
            <div style={{display:'flex',alignItems:'center',gap:0,padding:'0 20px',
              borderBottom:'1px solid var(--ln)',background:'rgba(8,9,18,0.45)',backdropFilter:'blur(12px)',WebkitBackdropFilter:'blur(12px)',flexShrink:0}}>
              {AGENT_TABS.map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)}
                  style={{padding:'12px 14px 11px',fontSize:12.5,cursor:'pointer',
                    color:tab===t.id?'var(--t1)':'var(--t3)',
                    fontWeight:tab===t.id?600:400,
                    background:'none',border:'none',letterSpacing:'-0.01em',
                    borderBottom:`2px solid ${tab===t.id?'rgba(255,255,255,0.45)':'transparent'}`,
                    marginBottom:'-1px',transition:'color 0.15s, border-color 0.15s'}}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Scrollable tab body */}
          <div key={_embed ? tab : undefined} className={_embed ? 'pe-scroll agx-scroll' : undefined}
            style={_embed ? undefined : {flex:'0 1 auto',minHeight:0,overflowY:'auto',padding:'24px 24px 48px'}}>
            <div className={_embed ? 'wz agx-body' : undefined} style={_embed ? undefined : {maxWidth:620}}>
              {tab==='identity' && (
                <AgentProfileTab draft={draft} update={update} tg={tg} dc={dc}
                  models={(() => {
                    // Only providers with a key saved, plus whatever the
                    // agent already uses so it is never blank.
                    const v = agentCreds.values || {};
                    const keyed = LLM_PROVIDERS.filter(p => v['llm_' + p.id]).map(p => p.id);
                    if (!agentCreds.loaded || !keyed.length) return MODELS;
                    const list = MODELS.filter(m => keyed.includes(MODEL_PROVIDER(m)));
                    return draft.model && !list.includes(draft.model) ? [draft.model, ...list] : list;
                  })()}
                  hoursOpen={hoursOpen} setHoursOpen={setHoursOpen}
                  agentKey={creating ? 'new' : String(selectedId)}/>
              )}
              {tab==='behaviour' && <AgentPersonalityTab draft={draft} update={update}/>}
              {tab==='capabilities' && <AgentPermissionsTab draft={draft} update={update} agentId={creating ? null : selectedId}/>}
              {tab==='realism' && <RealismTab draft={draft} update={update} onOpenHours={()=>{ setTab('identity'); setHoursOpen(true); }}/>}
            </div>
          </div>

          {/* Footer action bar — Delete and Save Changes / Create Agent
              both right-aligned and uniform size. Replaces the cluttered
              header so the title row stays clean. */}
          {_embed ? (
          <div className="pe-foot">
            <button type="button" className="pe-avail" role="switch" aria-checked={!!draft.active}
              data-on={draft.active ? '1' : undefined} onClick={flipDraftActive}
              title={draft.active ? 'Replying to customers. Click to pause.' : 'Paused. Click to turn on.'}>
              <span className="bc-switch" data-on={draft.active ? '1' : '0'} aria-hidden="true"/>
              <span>{draft.active ? 'Replying' : 'Paused'}</span>
            </button>
            <span className="pe-foot-sp"/>
            {!creating && (
              <button type="button" className="pe-icon-btn" data-tone="danger" onClick={deleteAgent}
                aria-label="Delete agent" title="Delete agent">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            )}
            <button type="button" className="wz-btn" data-kind="primary" onClick={saveAgent}>
              <WzSvg name="check" size={13} stroke={2.4}/>
              <span>{saved ? 'Saved' : creating ? 'Create agent' : 'Save changes'}</span>
            </button>
          </div>
          ) : (
          <div style={{
            flexShrink:0,
            display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,
            padding:'10px 20px',
            borderTop:'1px solid var(--ln)',
            background:'rgba(10,11,20,0.55)',
            backdropFilter:'blur(16px) saturate(160%)',
            WebkitBackdropFilter:'blur(16px) saturate(160%)',
          }}>
            <button type="button" className="bc-status" role="switch" aria-checked={!!draft.active}
              onClick={flipDraftActive}
              title={draft.active ? 'Replying to customers. Click to pause.' : 'Paused. Click to turn on.'}>
              <span className="bc-switch" data-on={draft.active ? '1' : '0'} aria-hidden="true"/>
              <span>{draft.active ? 'Replying' : 'Paused'}</span>
            </button>
            <span style={{flex:1}}/>
            {!creating && (
              <button onClick={deleteAgent} className="sg-btn sg-btn-danger">Delete</button>
            )}
            <button onClick={saveAgent}
              className={`sg-btn ${saved?'sg-btn-saved':'sg-btn-primary'}`}
              style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,minWidth:110}}>
              {saved
                ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Saved</>
                : creating ? 'Create agent' : 'Save changes'
              }
            </button>
          </div>
          )}
        </div>
      ) : !_embed ? (
        <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--t3)',fontSize:12.5}}>
          Select an agent or create a new one
        </div>
      ) : null}

      {/* Save confirmation: the shared status pill (bcToast), shown by saveAgent. */}
      {dmConsent && typeof DmAiConsentPopup !== 'undefined' && (
        <DmAiConsentPopup agent={dmConsent} llm={DM_AI.describe(dmConsent.id)} scope="all"
          onConfirm={() => DM_AI.setAuto(dmConsent.id, true)} onClose={() => setDmConsent(null)}/>
      )}
    </div>
  );
};

// ── PRODUCTS VIEW — List + Detail Editor ─────────────────────
// Opens the license test page as a centred, page-sized popup. In the
// desktop app the host (Form1.vb) catches this and shows its own centred
// window; in a plain browser the features below do the same job.
const bcOpenLicenseTest = (url) => {
  try {
    const w = Math.min(600, (window.screen && window.screen.availWidth) || 600);
    const h = Math.min(780, Math.round(((window.screen && window.screen.availHeight) || 780) * 0.9));
    const sx = (window.screen && (window.screen.availLeft || 0)) || 0;
    const sy = (window.screen && (window.screen.availTop || 0)) || 0;
    const left = Math.round(sx + (((window.screen && window.screen.availWidth) || w) - w) / 2);
    const top  = Math.round(sy + (((window.screen && window.screen.availHeight) || h) - h) / 2);
    const win = window.open(url, 'bc-license-check', `popup=yes,width=${w},height=${h},left=${left},top=${top},noopener`);
    if (win) { try { win.opener = null; } catch (_) {} }
  } catch (_) {}
};
const TYPE_LABEL = {prod:'Product', pkg:'Package', add:'Add-on'};

// ── CurrencyAmountInput ───────────────────────────────────────────────
// Amount field with the active currency symbol sitting inside it.
//
// Two things this gets right that the previous inline version didn't:
//   1. The symbol is centred by a full-height flex box, not by
//      top:50% + translateY(-50%). The transform version resolves to a
//      half-pixel offset on odd-height inputs, and a glyph rendered on a
//      half-pixel is what produced the blurry, faintly doubled "$".
//   2. Left padding is measured from the DOM rather than guessed from
//      symbol.length. Symbols here range from one narrow glyph ("$") to
//      three wide ones ("NZ$"), and a fixed per-character estimate either
//      overlapped the text or left a visible gap.
const CurrencyAmountInput = ({prefix, value, onChange, className, placeholder = '29 or 29/mo'}) => {
  const prefixRef = React.useRef(null);
  const [padLeft, setPadLeft] = React.useState(20);

  React.useLayoutEffect(() => {
    const el = prefixRef.current;
    if (!el) return;
    // getBoundingClientRect gives the true rendered width including any
    // font fallback, which matters for the non-Latin symbols (₹, ₩, ¥).
    const w = el.getBoundingClientRect().width;
    // 9px inset + measured glyph + 5px gap, rounded to a whole pixel so
    // the text baseline can't land on a fraction either.
    setPadLeft(Math.round(9 + w + 5));
  }, [prefix]);

  return (
    <div style={{position:'relative'}}>
      <span ref={prefixRef}
        style={{
          position:'absolute', left:9, top:0, bottom:0,
          display:'flex', alignItems:'center',
          fontSize:11, color:'#8a8aa8', fontFamily:'var(--mono)',
          pointerEvents:'none', whiteSpace:'nowrap',
        }}>{prefix}</span>
      <input className={className}
        value={value}
        onChange={e=>onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        // Inside a popup the shared control rule sets padding with
        // !important, which silently beat this inline paddingLeft and drew
        // the "$" on top of the number. The padding now travels as a
        // variable that a matching !important rule reads.
        data-prefixed="1"
        style={{paddingLeft: padLeft, '--pfx-pad': padLeft + 'px'}}/>
    </div>
  );
};

const ProductsView = ({_embedTab, _embed} = {}) => {
  const products = useProducts();
  const [tab, setTab]     = React.useState(_embedTab || 'prod');
  const [selId, setSelId] = React.useState(null);
  const [creating, setCreating] = React.useState(false);

  const shown = products.filter(p => p.type === tab);
  // Popup list: search + paging so a large catalog stays quick to scan.
  const [q, setQ] = React.useState('');
  const found = React.useMemo(() => shown.filter(p => bcMatch(q, p.name, p.sku, p.price, p.desc)), [shown, q]);
  const paged = useBcPaged(found, tab + '|' + q);
  const blank = ()=>({type:tab, name:'', sku:'', price:'', priceCurrency:'USD', billing:'monthly', stock:'∞', expiry:'', img:'', desc:'', feats:[], products:[], media:[], postPaymentText:'', manualTasks:[], enabledForAi:true, allowUsername:false, allowSerial:false, allowAccountCreation:false, allowRefund:false, stockMode:false, stockLabel:'', stockWhenEmpty:'hide', stockPending:[]});
  const selected = creating ? null : products.find(p => p.id === selId);
  const [draft, setDraft] = React.useState(blank());

  // Re-seed the editor draft whenever the selected product's UNDERLYING
  // DATA changes — not just when selId/creating/tab change. The product
  // list loads asynchronously at bootstrap and is replaced wholesale after
  // every save / re-fetch, so the `selected` object identity (and the
  // media/post-payment/manualTasks it carries) can arrive or change AFTER
  // the editor was first opened. Previously the effect only depended on
  // [selId, creating, tab], so a draft seeded from an early snapshot (one
  // that pre-dated the media upload, or a lighter bootstrap payload) was
  // never refreshed — the operator reopened a product and saw an empty
  // Media list even though the files were saved on the server and still
  // delivered on payment. Keying the effect on a signature of the selected
  // row (id + a stable hash of its media/delivery fields) forces a re-seed
  // the moment the real data is present.
  //
  // We also deep-copy `media` (and its nested entries) the same way feats /
  // products / manualTasks are copied, so editing a media row in the draft
  // never mutates the shared store object in place.
  const selectedSig = creating ? 'new' : (selected
    ? selected.id + '|' + JSON.stringify({
        m: (selected.media || []).map(x => x && x.id),
        ppt: selected.postPaymentText || '',
        mt: selected.manualTasks || [],
      })
    : 'none');

  React.useEffect(()=>{
    if (creating) { setDraft(blank()); return; }
    if (selected) {
      setDraft({
        ...selected,
        feats:       [...(selected.feats||[])],
        products:    [...(selected.products||[])],
        manualTasks: [...(selected.manualTasks||[])],
        // Deep-copy each media entry so inline edits in the draft don't
        // mutate the shared PRODS_STORE row before the operator saves.
        media:       (selected.media||[]).map(m => ({...m})),
      });
    }
    // eslint-disable-next-line
  },[selId, creating, tab, selectedSig]);

  React.useEffect(()=>{ setSelId(null); setCreating(false); },[tab]);

  const upd = (k,v) => setDraft(d => ({...d, [k]:v}));
  const togProduct = pid => setDraft(d => ({...d, products: (d.products||[]).includes(pid) ? d.products.filter(x=>x!==pid) : [...(d.products||[]), pid]}));

  const save = async () => {
    if (!draft.name.trim()) { bcToast('Give it a name first', 'warn'); return; }
    const kind = TYPE_LABEL[draft.type] || 'Product';
    // The stock list's items have their own actions: never posted with the
    // product (a list can be thousands long). Counts are read-only.
    const {stockPending, stockCount, ...fields} = draft;
    let res;
    if (creating) {
      // allowMailingSite is retired (the lefty.pro/mailing push is no longer
      // used). Sent as false on every save so a product that still had it on
      // is cleared the next time it's saved instead of staying on invisibly.
      res = await PRODS_STORE.saveOne({...fields, allowMailingSite: false, id: 0});
      if (res && res.ok) {
        // Items pasted in the wizard go in now that the item has an id.
        const pend = draft.stockMode && Array.isArray(stockPending) ? stockPending : [];
        if (pend.length) {
          const r = await apiFetch('stock_add', {product_id: res.product.id, items: pend});
          if (r && !r.error) stockSyncCounts(res.product.id, r.counts);
          else bcToast('Created, but the ' + (String(draft.stockLabel || '').trim().toLowerCase() || 'code') + 's couldn’t be added — ' + ((r && r.error) || 'no response') + '. Paste them again under Keys and codes.', 'err');
        }
        setCreating(false);
        setSelId(res.product.id);
      }
    } else {
      res = await PRODS_STORE.saveOne({...fields, stockCount: (products.find(p => p.id === selId) || {}).stockCount, allowMailingSite: false, id: selId});
    }
    if (res && !res.ok) {
      // Surface the failure — without this the Create button looks broken
      // when the request silently fails (oversize body, server error, etc).
      bcToast('Couldn’t save ' + kind.toLowerCase() + ' — ' + (res.error || 'unknown error'), 'err');
    } else if (res) {
      bcToast(creating ? kind + ' created' : 'Changes saved', 'ok', { detail: draft.name.trim() });
    } else {
      bcToast('Couldn’t save ' + kind.toLowerCase() + ' — no response from the server', 'err');
    }
  };

  const del = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.name}"?`)) return;
    const name = selected.name;
    const kind = TYPE_LABEL[selected.type] || 'Product';
    try {
      const r = await PRODS_STORE.deleteOne(selId);
      if (r && r.ok === false) { bcToast('Couldn’t delete ' + name + ' — ' + (r.error || 'unknown error'), 'err'); return; }
      bcToast(kind + ' deleted', 'ok', { detail: name });
    } catch (e) {
      bcToast('Network error — ' + name + ' was not deleted', 'err'); return;
    }
    setSelId(null);
  };

  // Inline AI-enable toggle from the list — operator can flip a product's
  // availability to the agent without opening the editor. Optimistic update,
  // reverts on API failure.
  const toggleEnabled = async (p, e) => {
    if (e) e.stopPropagation();
    const next = !(p.enabledForAi !== false);   // unset counts as on
    const updated = {...p, enabledForAi: next};
    PRODS_STORE.list = PRODS_STORE.list.map(x => x.id === p.id ? updated : x);
    PRODS_STORE.notify();
    const res = await apiFetch('set_product_enabled', { id: p.id, on: next ? 1 : 0 });
    if (res && res.error) {
      // Revert
      PRODS_STORE.list = PRODS_STORE.list.map(x => x.id === p.id ? p : x);
      PRODS_STORE.notify();
      bcToast('Couldn’t update ' + (p.name || 'it') + ' — ' + res.error, 'err');
    } else {
      bcToast(next ? 'Available to agents' : 'Hidden from agents', 'ok', { detail: p.name || undefined });
    }
  };

  // Editor footer switch: saved immediately for an existing item (same
  // endpoint as the list switch), so it behaves like the list does.
  const setEnabledFromEditor = (next) => {
    upd('enabledForAi', next);
    if (!creating && selected && (selected.enabledForAi !== false) !== next) toggleEnabled(selected);
  };

  const startNew = () => { setCreating(true); setSelId(null); };

  // Quick stats for the catalogue header — lets the operator see at-a-glance
  // how much of their catalogue the AI can actually talk about.
  const enabledCount = products.filter(p=>p.enabledForAi).length;
  const totalCount   = products.length;

  const isEmbed = (_embedTab||_embed);

  return (
    <div className={isEmbed ? 'sset-pop-page' : ''} style={isEmbed ? {} : {padding:'24px 20px 32px', height:'100%', overflow:'auto', background:'transparent'}}>
      <div style={isEmbed ? {flex:'1 1 auto',minHeight:0,display:'flex',flexDirection:'column'} : {maxWidth:1100, margin:'0 auto', display:'flex', flexDirection:'column', gap:18}}>

        {/* Popup landing: the same tabs and search as Agents and
            Licenses & payments (SsetLandHead / SsetLandTabs; the tabs are
            the symbol pill above the window). Hidden while an item is
            open — the editor has its own tabs and the trail pill. */}
        {isEmbed && !(creating || selected) && (<>
          <SsetLandHead title="Catalog"
            stats={totalCount ? [
              {n: totalCount, label: totalCount === 1 ? 'item' : 'items'},
              {n: enabledCount, label: 'offered by agents', tone: enabledCount ? 'ok' : undefined},
            ] : [{label: 'Nothing for sale yet'}]}/>
          <SsetLandTabs label="Item type" value={tab} onChange={setTab} tabs={[
            {id:'prod', label:'Products', n: products.filter(p=>p.type==='prod').length},
            {id:'pkg',  label:'Packages', n: products.filter(p=>p.type==='pkg').length},
            {id:'add',  label:'Add-ons',  n: products.filter(p=>p.type==='add').length},
          ]}/>
        </>)}
        {!isEmbed && (
        <div style={{display:'flex',alignItems:'center',gap:0,borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
          {[{id:'prod',label:'Products'},{id:'pkg',label:'Packages'},{id:'add',label:'Add-ons'}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:'10px 16px',fontSize:12,fontWeight:600,letterSpacing:'-0.01em',background:'transparent',border:'none',cursor:'pointer',color:tab===t.id?'var(--t1)':'var(--t3)',borderBottom:tab===t.id?'2px solid rgba(255,255,255,0.45)':'2px solid transparent',marginBottom:-1,transition:'color 0.12s'}}>
              {t.label}
              <span style={{marginLeft:7,fontSize:10,color:'var(--t4)',fontFamily:'var(--mono)'}}>{products.filter(p=>p.type===t.id).length}</span>
            </button>
          ))}
        </div>
        )}

        {/* List + editor — single column in embed (page-swap), two-column in full */}
        {isEmbed ? (
          // EMBED: show either the list OR the editor, never both at once
          (!creating && !selected) ? (
            // Same list design as Payments → Wallets and Invoices (.bc-* in
            // bot-ui-settings.jsx): fixed toolbar, one bordered group of
            // 56px rows — image, name + billing, price, availability switch.
            <div style={{flex:'1 1 auto',minHeight:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div className="sl-bar">
                <BcSearch value={q} onChange={setQ}
                  placeholder={`Search ${TYPE_LABEL[tab] === 'Add-on' ? 'add-ons' : TYPE_LABEL[tab].toLowerCase() + 's'} by name or price`}/>
                <SsetLandAdd label={`New ${TYPE_LABEL[tab].toLowerCase()}`} onClick={startNew}/>
              </div>
              <div className="sl-scroll">
                {found.length===0 ? (
                  <div className="sl-list">
                    <SsetLandEmpty
                      title={shown.length ? `No ${TYPE_LABEL[tab].toLowerCase()}s match your search` : `No ${TYPE_LABEL[tab].toLowerCase()}s yet`}
                      sub={shown.length ? 'Try a different name.'
                        : tab === 'pkg' ? 'A package bundles several products at one price.'
                        : tab === 'add' ? 'Add-ons are extras a customer can buy on top of a product.'
                        : 'Add what you sell. Your agents can then offer it in chat.'}
                      action={shown.length ? null : {label:`New ${TYPE_LABEL[tab].toLowerCase()}`, onClick:startNew}}/>
                  </div>
                ) : (
                  <div className="sl-list">
                    {paged.shown.map(p => {
                      const enabled = p.enabledForAi !== false;
                      const name = String(p.name || '').trim();
                      // The period is part of the price (one-time items have none).
                      const per = {monthly:'/mo', yearly:'/yr'}[p.billing] || '';
                      const price = fmtProdPrice(p) || p.price || '';
                      const open = () => { setCreating(false); setSelId(p.id); };
                      return (
                        <div key={p.id} role="button" tabIndex={0}
                          onClick={open}
                          onKeyDown={e=>{ if (e.target===e.currentTarget && (e.key==='Enter'||e.key===' ')) { e.preventDefault(); open(); } }}
                          className="sl-row" data-off={enabled?'0':'1'}>
                          <span className="sl-row-media"><SlTile img={p.img}><TabIco name={p.type === 'pkg' || p.type === 'add' ? p.type : 'prod'} size={15}/></SlTile></span>
                          <span className="sl-row-main">
                            <span className="sl-row-title">{name || <em style={{fontStyle:'normal',opacity:0.55}}>Untitled</em>}</span>
                            <span className="sl-row-meta">
                              <span className="sl-stat" data-s={enabled ? 'active' : 'cancelled'}>
                                <i aria-hidden="true"/>{enabled ? 'Available' : 'Hidden'}
                              </span>
                            </span>
                          </span>
                          {(price || p.stockMode) && (
                            <span className="sl-row-value">
                              {price && <span className="sl-row-amt">{price}{per && <span className="sl-row-per">{per}</span>}</span>}
                              {/* Keys and codes: what's left on the list */}
                              {p.stockMode && (() => {
                                const s = stockSummary(p);
                                return <span className="sl-row-amt-sub" style={s.tone === 'out' ? {color:'rgb(240,140,134)'} : s.tone === 'low' ? {color:'rgb(236,190,120)'} : undefined}>{s.text}</span>;
                              })()}
                            </span>
                          )}
                          <span className="sl-row-trail"><svg className="sl-row-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></span>
                        </div>
                      );
                    })}
                    <BcMore rest={paged.rest} onMore={paged.more}/>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{flex:'1 1 auto',minHeight:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <ProductEditor
                _embed={true}
                draft={draft} upd={upd}
                creating={creating} selectedName={selected?.name}
                onSave={save} onDelete={del}
                onBack={()=>{ setCreating(false); setSelId(null); }}
                allProducts={products.filter(p=>p.type==='prod')}
                togProduct={togProduct}
                onToggleEnabled={setEnabledFromEditor}
              />
            </div>
          )
        ) : (
          // FULL MODE: two-column grid
          <div style={{display:'grid',gridTemplateColumns:'320px 1fr',gap:18,minHeight:520}}>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <button onClick={startNew} style={{padding:'11px 12px',fontSize:12,fontWeight:600,color:'var(--t2)',background:'rgba(255,255,255,0.035)',border:'1px dashed rgba(255,255,255,0.13)',borderRadius:9,cursor:'pointer',transition:'all 0.12s',display:'flex',alignItems:'center',justifyContent:'center',gap:7,letterSpacing:'-0.01em'}}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>New {TYPE_LABEL[tab]}</span>
              </button>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {shown.map(p => {
                  const isSel = !creating && p.id === selId;
                  const enabled = p.enabledForAi !== false;
                  return (
                    <button key={p.id} onClick={()=>{setCreating(false); setSelId(p.id);}}
                      style={{padding:'10px 11px',display:'flex',alignItems:'center',gap:10,background:isSel?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.025)',border:`1px solid ${isSel?'rgba(255,255,255,0.16)':'rgba(255,255,255,0.06)'}`,borderRadius:9,cursor:'pointer',transition:'all 0.12s',textAlign:'left'}}>
                      <ProductThumb src={p.img} size={42}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color:enabled?'var(--t1)':'var(--t3)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name}</div>
                        <div style={{fontSize:10.5,color:'#8a8aa8',marginTop:2}}><span style={{fontFamily:'var(--mono)',fontSize:10}}>{p.price}</span>{p.expiry ? ` · Expires ${String(p.expiry).slice(0,10)}` : ''}</div>
                      </div>
                      <span className="bc-switch" role="switch" aria-checked={enabled}
                        data-on={enabled ? '1' : '0'}
                        title={enabled ? 'Available to agents — click to hide' : 'Hidden from agents — click to make available'}
                        onClick={e=>toggleEnabled(p,e)}/>
                    </button>
                  );
                })}
                {shown.length===0 && !creating && (
                  <div style={{padding:'14px 12px',textAlign:'center',fontSize:11,color:'var(--t3)',border:'1px dashed rgba(255,255,255,0.08)',borderRadius:9}}>No {TYPE_LABEL[tab].toLowerCase()}s yet</div>
                )}
              </div>
            </div>
            <div style={{background:'rgba(20,22,42,0.82)',backdropFilter:'blur(20px) saturate(160%)',WebkitBackdropFilter:'blur(20px) saturate(160%)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:13,minHeight:520,overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 4px 32px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.05) inset'}}>
              {!selected && !creating ? (
                <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'var(--t3)',padding:'48px 16px',textAlign:'center'}}>
                  <div style={{width:48,height:48,borderRadius:12,background:'rgba(255,255,255,0.04)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                  </div>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--t2)'}}>Select an item to edit</div>
                  <div style={{fontSize:11.5}}>Or create a new {TYPE_LABEL[tab].toLowerCase()} from the list on the left</div>
                </div>
              ) : (
                <div style={{flex:'0 1 auto',minHeight:0,display:'flex',flexDirection:'column'}}>
                  <ProductEditor
                    _embed={false}
                    draft={draft} upd={upd}
                    creating={creating} selectedName={selected?.name}
                    onSave={save} onDelete={del}
                    onBack={()=>{ setCreating(false); setSelId(null); }}
                    allProducts={products.filter(p=>p.type==='prod')}
                    togProduct={togProduct}
                    onToggleEnabled={setEnabledFromEditor}
                  />
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

const ProductThumb = ({src, size=42, rounded=9}) => {
  const [err, setErr] = React.useState(false);
  React.useEffect(()=>setErr(false),[src]);
  if (!src || err) {
    return (
      <div style={{width:size,height:size,borderRadius:rounded,background:'linear-gradient(135deg, rgba(255,255,255,0.092), rgba(255,255,255,0.036))',border:'1px solid rgba(255,255,255,0.1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,color:'rgba(190,192,210,0.85)'}}>
        <svg width={Math.round(size*0.45)} height={Math.round(size*0.45)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </div>
    );
  }
  return <img src={src} alt="" onError={()=>setErr(true)} style={{width:size,height:size,borderRadius:rounded,objectFit:'cover',flexShrink:0,border:'1px solid rgba(255,255,255,0.08)'}}/>;
};

// Compact toggle row used in the catalog product Settings tab.
// Defined OUTSIDE ProductEditor so its identity is stable across renders —
// an inline component definition creates a new type on every parent render,
// causing React to unmount+remount on every draft state change which breaks
// click events in WebView2's composited stacking context.
const ProdTogRow = ({tkey, label, hint, accentOn, draft, upd}) => {
  const on = !!draft[tkey];
  return (
    <div className="sset-form-row" style={{cursor:'pointer',userSelect:'none'}}
      role="switch" aria-checked={on} tabIndex={0}
      onKeyDown={e=>{ if (e.key===' '||e.key==='Enter') { e.preventDefault(); upd(tkey, !on); } }}
      onClick={()=>upd(tkey, !on)}>
      <label className="sset-form-label" style={{pointerEvents:'none'}}>
        {label}
        {hint && <span className="sset-form-hint">{hint}</span>}
      </label>
      <div className="sset-form-row-ctl">
        <span className="bc-switch" data-on={on ? '1' : '0'} aria-hidden="true"/>
      </div>
    </div>
  );
};

const ProductEditorLegacy = ({_embed, draft, upd, creating, selectedName, onSave, onDelete, onBack, allProducts, togProduct, onToggleEnabled}) => {
  const fileRef = React.useRef(null);
  const [edTab, setEdTab] = React.useState('basic');
  const onFile = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => upd('img', reader.result);
    reader.readAsDataURL(f);
  };

  const aiOn = draft.enabledForAi !== false;
  const flipAi = () => { if (onToggleEnabled) onToggleEnabled(!aiOn); else upd('enabledForAi', !aiOn); };
  // One status control, same place as the Agents and Payments editors.
  const statusSwitch = (
    <button type="button" className="bc-status" role="switch" aria-checked={aiOn} onClick={flipAi}
      title={aiOn ? 'Agents can offer this — click to hide' : 'Hidden from agents — click to make available'}>
      <span className="bc-switch" data-on={aiOn ? '1' : '0'} aria-hidden="true"/>
      <span>{aiOn ? 'Available' : 'Hidden'}</span>
    </button>
  );
  const imgSize = _embed ? 78 : 80;

  // Inner tab bar shared by both full and embed modes
  const ED_TABS = [
    {id:'basic',    label:'Basic'},
    {id:'pricing',  label:'Pricing'},
    {id:'delivery', label:'Delivery'},
    {id:'settings', label:'Settings'},
    ...(draft.type==='pkg' ? [{id:'bundle', label:'Bundle'}] : []),
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',flex: _embed?'1 1 auto':'0 1 auto',minHeight:0,overflow:'hidden'}}>

      {/* ── Header row ── */}
      <div className={_embed ? 'sset-back-strip' : ''} style={_embed ? {} : {display:'flex',alignItems:'center',gap:8,padding:'10px 14px 0',flexShrink:0}}>
        {onBack && (
          <button onClick={onBack} className="sset-back-chev" title={`Back to ${TYPE_LABEL[draft.type].toLowerCase()}s`}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        <span style={{flex:1,fontSize:12,fontWeight:600,color:'var(--t1)',letterSpacing:'-0.01em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          {creating ? `New ${TYPE_LABEL[draft.type]}` : (selectedName || '')}
        </span>
        {!_embed && statusSwitch}
        {!_embed && !creating && <button onClick={onDelete} className="sg-btn sg-btn-danger" style={{padding:'4px 10px',fontSize:11}}>Delete</button>}
        {!_embed && <button onClick={onSave} className="sg-btn sg-btn-primary" style={{padding:'4px 12px',fontSize:11}}>{creating?'Create':'Save'}</button>}
      </div>

      {/* ── Inner tab bar ── */}
      {_embed ? (
        <div className="sset-pop-tabs" role="tablist">
          {ED_TABS.map(t=>(
            <button key={t.id} role="tab" aria-selected={edTab===t.id} onClick={()=>setEdTab(t.id)}>{t.label}</button>
          ))}
        </div>
      ) : (
        <div style={{display:'flex',gap:0,padding:'8px 14px 0',borderBottom:'1px solid rgba(255,255,255,0.06)',flexShrink:0}}>
          {ED_TABS.map(t=>(
            <button key={t.id} onClick={()=>setEdTab(t.id)}
              style={{padding:'5px 10px',fontSize:11,fontWeight:600,background:'transparent',border:'none',cursor:'pointer',
                color: edTab===t.id ? 'var(--t1)' : 'var(--t3)',
                borderBottom: edTab===t.id ? '2px solid rgba(255,255,255,0.5)' : '2px solid transparent',
                marginBottom:-1, transition:'color 0.12s', letterSpacing:'-0.01em', whiteSpace:'nowrap'}}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Tab content ── */}
      <div style={{flex: _embed?'1 1 auto':'0 1 auto',minHeight:0,overflowY:'auto',padding:_embed?'10px 18px 14px':'12px 14px',display:'flex',flexDirection:'column',gap:10}}>

        {/* ── BASIC ── */}
        {edTab==='basic' && (<>
          <div style={{display:'grid',gridTemplateColumns:`${imgSize}px 1fr`,gap:10,alignItems:'start'}}>
            {/* Image — tap to upload; the URL field sits under the name so the
                tile and fields end on the same line. */}
            <div style={{position:'relative',width:imgSize,height:imgSize,borderRadius:9,background:'rgba(255,255,255,0.03)',border:'1px dashed rgba(255,255,255,0.12)',overflow:'hidden',cursor:'pointer'}}
              onClick={()=>fileRef.current?.click()} title="Upload an image">
              {draft.img ? (
                <img src={draft.img} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
              ) : (
                <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,color:'var(--t3)'}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  <span style={{fontSize:9.5}}>Image</span>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{display:'none'}}/>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6,minWidth:0}}>
              <ProdField label="Name">
                <input className={_embed?'sset-input':'fi'} value={draft.name} onChange={e=>upd('name',e.target.value)} placeholder="e.g. Pro Plan"/>
              </ProdField>
              <input className={_embed?'sset-input':'fi'} placeholder="…or paste an image URL" value={draft.img||''}
                onChange={e=>upd('img',e.target.value)} aria-label="Image URL"/>
            </div>
          </div>

          {/* Description — full width and roomy. This is the copy the agent
              quotes to customers, so it gets its own block rather than a
              cramped column beside the thumbnail. */}
          <ProdField label="Description">
            <textarea className={_embed?'sset-input':'fi fta'} rows={_embed?4:7} value={draft.desc}
              onChange={e=>upd('desc',e.target.value)}
              placeholder="What the customer gets, in the words your agent should use…"
              style={{minHeight:_embed?88:156,lineHeight:1.55,resize:'vertical'}}/>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,marginTop:5}}>
              <span style={{fontSize:10.5,color:'#8a8aa8',lineHeight:1.45}}>Your agent quotes this word for word.</span>
              <span style={{fontSize:10.5,fontFamily:'var(--mono)',color:'#8a8aa8',flexShrink:0}}>{(draft.desc||'').length}</span>
            </div>
          </ProdField>
          <EdSection title="Features" hint="Short points your agent can list.">
            <FeatureList items={draft.feats||[]} onChange={feats=>upd('feats',feats)}/>
          </EdSection>
        </>)}

        {/* ── PRICING ── */}
        {edTab==='pricing' && (() => {
          const curCode = draft.priceCurrency || 'USD';
          const curMeta = FIAT_BY_CODE[curCode];
          const curPrefix = curMeta ? curMeta.symbol : curCode;
          return (<>
          <EdSection title="Price">
          <div style={{display:'grid',gridTemplateColumns:'92px 1fr 110px',gap:8}}>
            <ProdField label="Currency">
              <PriceCurrencyPicker
                value={curCode}
                onChange={v => upd('priceCurrency', v)}/>
            </ProdField>
            <ProdField label="Amount">
              {/* The prefix used to be centred with top:50% + translateY(-50%).
                  On an odd-height input that lands the glyph on a half-pixel,
                  which is what made the "$" look blurry/doubled. A full-height
                  flex box centres it on whole pixels instead.

                  Padding was also a guess (symbol.length * 7), which is wrong
                  for anything that isn't a single narrow glyph — "NZ$", "CHF"
                  and "₹" all mis-measure, so the amount either collided with
                  the symbol or floated too far right. We measure the rendered
                  prefix instead and pad to its actual width. */}
              <CurrencyAmountInput
                prefix={curPrefix}
                value={draft.price}
                onChange={v=>upd('price', v)}
                className={_embed?'sset-input':'fi'}/>
            </ProdField>
            <ProdField label="Billing">
              {_embed
                ? <SsetSelect icon="repeat" aria-label="Billing" value={draft.billing||'monthly'} onChange={v=>upd('billing',v)}
                    options={[{value:'one-time',label:'One-time'},{value:'monthly',label:'Monthly'},{value:'yearly',label:'Yearly'},{value:'custom',label:'Custom'}]}/>
                : <select className="fi" value={draft.billing||'monthly'} onChange={e=>upd('billing',e.target.value)}>
                    <option value="one-time">One-time</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom</option>
                  </select>}
            </ProdField>
          </div>
          </EdSection>

          <EdSection title="Availability" hint="Blank stock means unlimited.">
          <div style={{display:'grid',gridTemplateColumns:'130px 1fr',gap:8}}>
            <ProdField label="Stock">
              <input className={_embed?'sset-input':'fi'} value={draft.stock||'∞'} onChange={e=>upd('stock',e.target.value)} placeholder="∞ or 50"/>
            </ProdField>
            <ProdField label="Expires">
              {_embed
                ? <SsetDate value={draft.expiry||''} onChange={v=>upd('expiry',v)}/>
                : <input className="fi" type="date" value={draft.expiry||''} onChange={e=>upd('expiry',e.target.value)}/>}
            </ProdField>
          </div>
          </EdSection>
          </>);
        })()}

        {/* ── DELIVERY ── */}
        {edTab==='delivery' && (<>
          {/* Order follows what the buyer receives: the message first, then
              files, then any links found in it. Manual setup is optional and
              folds away. */}
          <EdSection title="Message after payment" flush
            hint="Sent word for word as soon as payment clears, before paid files.">
            <PostPaymentEditor
              value={draft.postPaymentText || ''}
              onChange={v => upd('postPaymentText', v)}
              hasPaidMedia={(draft.media || []).some(m => m && !m.showcase)}
              allowSerial={!!draft.allowSerial}
            />
          </EdSection>

          <EdSection title="Files & media" flush
            hint="Showcase items can be shown before payment. The rest are sent after.">
            <MediaList items={draft.media || []} onChange={media => upd('media', media)}/>
          </EdSection>

          {/* Links embedded in the message above, as editable rows — only
              shown when there are some. */}
          {/(https?:\/\/[^\s<>()'"]+)/i.test(draft.postPaymentText || '') && (
            <EdSection title="Download links" flush hint="Found in the message above.">
              <DeliveryLinksEditor
                text={draft.postPaymentText || ''}
                onChange={v => upd('postPaymentText', v)}
              />
            </EdSection>
          )}

          <PopMore title="Manual setup (optional)"
            sub={(draft.manualTasks || []).length ? `${(draft.manualTasks || []).length} step${(draft.manualTasks || []).length === 1 ? '' : 's'}` : 'None'}
            defaultOpen={(draft.manualTasks || []).length > 0}>
            <ManualSetupEditor
              value={draft.manualTasks || []}
              onChange={v => upd('manualTasks', v)}
              feats={draft.feats || []}
            />
          </PopMore>
        </>)}

        {/* ── SETTINGS ── */}
        {edTab==='settings' && (<>
          <EdSection title="Purchase flow">
          <div style={{display:'flex',flexDirection:'column',gap:0}}>
            <ProdTogRow tkey="allowUsername"        label="Ask for a username"     hint="For forum or app logins"        draft={draft} upd={upd}/>
            <ProdTogRow tkey="allowSerial"          label="Issue a serial key"    hint="A unique key per purchase" draft={draft} upd={upd}/>
            <ProdTogRow tkey="allowAccountCreation" label="Help create an account" hint="The agent walks the buyer through it"      draft={draft} upd={upd}/>
            <ProdTogRow tkey="allowRefund"          label="Refundable"          hint="On: the agent asks why, then hands it to you"             draft={draft} upd={upd}/>
          </div>
          </EdSection>
        </>)}

        {/* ── BUNDLE (pkg only) ── */}
        {edTab==='bundle' && draft.type==='pkg' && (() => {
          const picked = draft.products || [];
          return (
          <EdSection title="Products in this package" flush
            hint="Ticked products are delivered together."
            aside={allProducts.length > 0
              ? <span className="sset-pill" data-dot="0">{picked.length} of {allProducts.length}</span>
              : null}>
            {allProducts.length === 0 ? (
              <div className="sset-pop-empty">
                <div className="sset-pop-empty-title">No products yet</div>
                <div className="sset-pop-empty-sub">Add products first, then bundle them here.</div>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:5}}>
                {allProducts.map(p => {
                  const on = picked.includes(p.id);
                  return (
                    <button key={p.id} onClick={()=>togProduct(p.id)} className="sset-list-row"
                      data-on={on?'1':'0'} style={{padding:'9px 11px'}}>
                      <ProductThumb src={p.img} size={30} rounded={8}/>
                      <span style={{flex:1,minWidth:0,display:'block',textAlign:'left'}}>
                        <span style={{display:'block',fontSize:12,fontWeight:600,color:on?'var(--t1)':'var(--t2)',letterSpacing:'-0.005em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name}</span>
                        <span style={{display:'block',fontSize:10,color:'#8a8aa8',fontFamily:'var(--mono)',marginTop:2}}>{fmtProdPrice(p) || p.price}</span>
                      </span>
                      <span style={{width:17,height:17,borderRadius:5,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',
                        background:on?'var(--acc)':'rgba(255,255,255,0.04)',
                        border:`1px solid ${on?'transparent':'rgba(255,255,255,0.12)'}`,
                        transition:'background 0.12s, border-color 0.12s'}}>
                        {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </EdSection>
          );
        })()}

      </div>

      {/* Footer action bar — same position and vocabulary as the Agents
          and Licenses editors so every popup saves in the same place. */}
      {_embed && (
        <div className="sset-pop-footer">
          {statusSwitch}
          <span style={{flex:1}}/>
          {!creating && <button onClick={onDelete} className="sset-btn" data-variant="danger">Delete</button>}
          <button onClick={onSave} className="sset-btn" data-variant="primary">{creating?`Create ${TYPE_LABEL[draft.type].toLowerCase()}`:'Save changes'}</button>
        </div>
      )}
    </div>
  );
};

// ── Product image optimisation ─────────────────────────────────────
// Uploaded images are stored inline on the product, so they are resized
// and re-encoded in the browser before they are saved: longest side at
// most 1000px, JPEG at 85% (PNG only when the image really uses
// transparency). A typical phone photo goes from ~4 MB to ~120 KB.
// Small images that already fit are kept byte-for-byte. JPEG/PNG rather
// than WebP so the picture can be sent to customers on any platform.
const PROD_IMG_MAX = 1000;
const readAsDataUrl = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(new Error('The file could not be read.'));
  r.readAsDataURL(blob);
});
const optimizeProductImage = async (file) => {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Choose an image file (JPG, PNG, WebP or GIF).');
  // Vector and animated images can't be resized without losing what they are.
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    if (file.size > 1.5 * 1024 * 1024) throw new Error('That image is over 1.5 MB. Use a smaller file or paste a link instead.');
    return readAsDataUrl(file);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That image could not be opened.'));
      i.src = url;
    });
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const scale = Math.min(1, PROD_IMG_MAX / Math.max(w0, h0));
    if (scale === 1 && file.size <= 200 * 1024) return readAsDataUrl(file);
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    let alpha = false;
    if (file.type === 'image/png' || file.type === 'image/webp') {
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < d.length; i += 4) { if (d[i] < 255) { alpha = true; break; } }
    }
    if (!alpha) {
      // JPEG has no transparency: paint on white so nothing turns black.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    const out = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
    // Never make it bigger than the original.
    if (scale === 1 && out.length * 0.75 > file.size) return readAsDataUrl(file);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
};
const dataUrlBytes = (s) => {
  const m = /^data:[^,]*,/.exec(s || '');
  return m ? Math.round((s.length - m[0].length) * 0.75) : 0;
};
const fmtBytes = (n) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// Small line icons used by the product editor.
const PROD_ICON = {
  message: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5z"/>,
  media:   <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
  links:   <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71"/></>,
  manual:  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>,
  user:    <><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></>,
  key:     <><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M17 6l3 3M15 8l2 2"/></>,
  userplus:<><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M19 8v6M16 11h6"/></>,
  refund:  <><polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/></>,
};
const ProdIco = ({name}) => (
  <span className="slp-ico-tile" aria-hidden="true">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{PROD_ICON[name]}</svg>
  </span>
);
// Numeric value of a price string ("$29/mo" → 29), or NaN.
const prodPriceNum = (p) => { const m = String((p && p.price) || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
const PROD_BILLING = {'one-time':'One-time', monthly:'Monthly', yearly:'Yearly', custom:'Custom'};
const PROD_PER = {monthly:' / month', yearly:' / year'};

// Tag field: chips and the text box share one control. Enter adds,
// Backspace in an empty box removes the last tag. Used for Features and
// Manual setup so both read and behave the same.
const ProdTagField = ({items, onChange, placeholder, emptyPlaceholder, label}) => {
  const [val, setVal] = React.useState('');
  const inputRef = React.useRef(null);
  const add = (raw) => {
    const v = String(raw != null ? raw : val).trim();
    if (v && !items.some(x => String(x).toLowerCase() === v.toLowerCase())) onChange([...items, v]);
    setVal('');
  };
  return (
    <div className="slp-tagfield" onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current && inputRef.current.focus(); } }}>
      {items.map((f, i) => (
        <span key={i} className="slp-tag-chip">
          <svg className="slp-tag-check" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <span className="slp-chip-t">{f}</span>
          <button type="button" aria-label={`Remove ${f}`} title="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </span>
      ))}
      <input ref={inputRef} className="slp-tagfield-input" value={val} aria-label={label}
        placeholder={items.length ? placeholder : (emptyPlaceholder || placeholder)}
        onChange={e => setVal(e.target.value)}
        onBlur={() => { if (val.trim()) add(); }}
        onKeyDown={e => {
          if (e.key === 'Enter' || (e.key === ',' && val.trim())) { e.preventDefault(); add(); }
          else if (e.key === 'Backspace' && !val && items.length) onChange(items.slice(0, -1));
        }}/>
    </div>
  );
};
const ProdFeatures = ({items, onChange}) => (
  <ProdTagField items={items} onChange={onChange} label="Features"
    placeholder="Add another" emptyPlaceholder="e.g. Unlimited messages, then press Enter"/>
);

// Collapsible section (Delivery tab): a one-line header with a summary of
// what's inside, so the tab reads as an overview until you open one.
const ProdCollapse = ({title, icon, summary, set, open, onToggle, children}) => (
  <div className="slp-acc" data-open={open ? '1' : undefined}>
    <button type="button" className="slp-acc-head" aria-expanded={!!open} onClick={onToggle}>
      {icon && <ProdIco name={icon}/>}
      <span className="slp-acc-title">{title}</span>
      <span className="slp-acc-sum"><span className="slp-pill" data-on={set ? '1' : undefined}><i aria-hidden="true"/>{summary}</span></span>
      <svg className="slp-acc-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    {open && <div className="slp-acc-body">{children}</div>}
  </div>
);

// Titled group used on every editor tab.
const ProdGroup = ({title, hint, aside, children, grow}) => (
  <div className="slw-group" style={grow ? {flex:'1 1 auto', minHeight:0} : undefined}>
    {(title || aside) && (
      <div className="slp-group-head">
        <span className="slw-group-title">{title}</span>
        {aside}
      </div>
    )}
    {hint && <span className="slw-hint slp-group-hint">{hint}</span>}
    {children}
  </div>
);

// Switch row (Checkout tab).
const ProdSwitchRow = ({title, hint, on, onChange, icon}) => (
  <div className="slw-setrow" data-on={on ? '1' : undefined}>
    {icon && <ProdIco name={icon}/>}
    <span className="slw-setrow-txt">
      <span className="slw-setrow-title">{title}</span>
      <span className="slw-hint">{hint}</span>
    </span>
    <button type="button" className="bc-switch" role="switch" aria-checked={!!on} aria-label={title}
      data-on={on ? '1' : '0'} onClick={() => onChange(!on)}/>
  </div>
);

// Image picker: preview, link field, Upload and remove on one row. Drop a
// file anywhere on the row, or paste one into the link field. Uploads are
// optimised by optimizeProductImage before they are stored.
const ProdImageField = ({value, onChange, onBusy, label = 'Image', optional = false}) => {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [broken, setBroken] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const fileRef = React.useRef(null);
  const img = String(value || '');
  const isData = img.startsWith('data:');
  React.useEffect(() => { setBroken(false); }, [img]);
  const take = async (file) => {
    if (!file) return;
    setErr(''); setBusy(true); if (onBusy) onBusy(true);
    try { onChange(await optimizeProductImage(file)); }
    catch (e) { setErr(e.message || 'That image could not be used.'); }
    finally { setBusy(false); if (onBusy) onBusy(false); }
  };
  const pick = () => fileRef.current && fileRef.current.click();
  return (
    <div className="slw-field">
      <span className="slw-label slp-label-row">
        <span>{label}{optional && <small>Optional</small>}</span>
        {(err || img) && (
          <span className="slp-img-note" data-err={err || broken ? '1' : undefined}>
            {err || (isData ? `Uploaded · ${fmtBytes(dataUrlBytes(img))}` : broken ? 'Link does not load' : 'Linked')}
          </span>
        )}
      </span>
      <div className="slp-img" data-drag={drag ? '1' : undefined}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
        <button type="button" className="slp-img-tile" data-empty={img ? undefined : '1'} onClick={pick}
          aria-label={img ? 'Replace image' : 'Upload image'} title={img ? 'Replace image' : 'Upload or drop an image'}>
          {img && !broken
            ? <img src={img} alt="" onError={() => setBroken(true)}/>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}
        </button>
        <input className="slw-input" value={isData ? '' : img} aria-label="Image link"
          placeholder={isData ? 'Uploaded image in use' : 'Paste an image link, or drop a file here'}
          onChange={e => { setErr(''); onChange(e.target.value.trim()); }}
          onPaste={e => {
            const f = e.clipboardData && Array.from(e.clipboardData.files || []).find(x => /^image\//.test(x.type));
            if (f) { e.preventDefault(); take(f); }
          }}/>
        <button type="button" className="sset-btn" onClick={pick} disabled={busy}>{busy ? 'Optimising…' : 'Upload'}</button>
        {img && (
          <button type="button" className="sl-act" onClick={() => { onChange(''); setErr(''); }} aria-label="Remove image" title="Remove image">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden
          onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; take(f); }}/>
      </div>
    </div>
  );
};

// Pick-list of catalog products for a package (wizard and Bundle tab).
const ProdBundlePicker = ({allProducts, picked, togProduct, draft, hideValue = false}) => {
  const [q, setQ] = React.useState('');
  const list = allProducts.filter(p => bcMatch(q, p.name, p.sku));
  const sum = allProducts.filter(p => picked.includes(p.id)).reduce((t, p) => t + (prodPriceNum(p) || 0), 0);
  const own = prodPriceNum(draft);
  const sym = (FIAT_BY_CODE[draft.priceCurrency || 'USD'] || {}).symbol || '';
  const save = own > 0 && sum > own ? Math.round((1 - own / sum) * 100) : 0;
  return (
    <div className="slw-field">
      {allProducts.length > 8 && <BcSearch value={q} onChange={setQ} placeholder={`Search ${allProducts.length} products`}/>}
      <div className="sl-list">
        {allProducts.length === 0 ? (
          <div className="sl-empty">
            <div className="sl-empty-title">No products</div>
            <div className="sl-empty-sub">Add products in the Products tab, then include them here.</div>
          </div>
        ) : list.length === 0 ? (
          <div className="sl-empty"><div className="sl-empty-sub">No products match.</div></div>
        ) : list.map(p => {
          const on = picked.includes(p.id);
          return (
            <div key={p.id} role="checkbox" aria-checked={on} tabIndex={0} className="sl-row"
              onClick={() => togProduct(p.id)}
              onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); togProduct(p.id); } }}>
              <span className="sl-row-media"><SlTile img={p.img}><TabIco name={p.type === 'pkg' || p.type === 'add' ? p.type : 'prod'} size={15}/></SlTile></span>
              <span className="sl-row-main">
                <span className="sl-row-title">{p.name || 'Untitled'}</span>
                <span className="sl-row-meta"><span className="sl-grow">{TYPE_LABEL[p.type] || 'Product'}</span></span>
              </span>
              <span className="sl-row-value"><span className="sl-row-amt">{fmtProdPrice(p) || p.price || '—'}</span></span>
              <span className="sl-row-trail"><span className="slp-check" data-on={on ? '1' : undefined} aria-hidden="true">
                {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </span></span>
            </div>
          );
        })}
      </div>
      {!hideValue && picked.length > 0 && sum > 0 && (
        <div className="slp-value">
          <span>Worth <strong>{sym}{sum.toLocaleString('en-US', {maximumFractionDigits: 2})}</strong> bought separately</span>
          {save > 0 && <span className="slp-pill" data-on="1"><i aria-hidden="true"/>Saves {save}%</span>}
        </div>
      )}
    </div>
  );
};

// ── Setup wizard shell ─────────────────────────────────────────────
// Shared by the new product / package / add-on, new agent and new wallet
// wizards. One question per screen, laid out to stay short: a compact
// header row (step glyph, title, one short line), then the fields as
// grouped lists or choice tiles. Back, page dots and the main action sit
// along the bottom, with symbols doing most of the talking.
//
// The popup window has no fixed height while a wizard is showing
// (useSsetFit): the step's own content decides it. The scrolling area is
// given the measured height of its content and animates to each new
// height, so the window grows and shrinks smoothly from step to step and
// only scrolls once a step is taller than the screen allows.
//
// steps: [{id, icon, title, sub, hero?, need?, needMsg?, optional?, filled?}]
//   hero            → replaces the glyph (e.g. the chosen coin)
//   need === false  → the step blocks Continue (needMsg says why)
//   optional        → Continue reads "Skip" until the step is filled
const WZ_ICON = {
  box:     <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
  text:    <><path d="M4 6h16M4 11h16M4 16h10"/></>,
  tag:     <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></>,
  stack:   <><path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></>,
  cart:    <><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6"/></>,
  send:    <><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></>,
  wrench:  <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z"/></>,
  bolt:    <><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></>,
  check:   <><path d="M20 6 9 17l-5-5"/></>,
  person:  <><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 16 0v1"/></>,
  badge:   <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 10h3M15 14h3"/></>,
  doc:     <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></>,
  wave:    <><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/></>,
  bubble:  <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
  globe:   <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
  clock:   <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  spark:   <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></>,
  image:   <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>,
  hash:    <><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></>,
  users:   <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-.5A5.5 5.5 0 0 1 8 14h2a5.5 5.5 0 0 1 5.5 5.5v.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14a5.5 5.5 0 0 1 3 5v1"/></>,
  megaphone:<><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></>,
  at:      <><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></>,
  hand:    <><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.3L2.8 16.4a2 2 0 0 1 2.8-2.8L7 15"/></>,
  smile:   <><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></>,
  moon:    <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
  robot:   <><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/></>,
  key:     <><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M17 6l3 3M15 8l2 2"/></>,
  eye:     <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  x:       <><path d="M18 6 6 18M6 6l12 12"/></>,
  chevL:   <><polyline points="15 18 9 12 15 6"/></>,
  chevR:   <><polyline points="9 18 15 12 9 6"/></>,
  skip:    <><path d="m6 17 5-5-5-5M13 17l5-5-5-5"/></>,
  store:   <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></>,
  lifebuoy:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M14.8 9.2l3.6-3.6M5.6 18.4l3.6-3.6"/></>,
  link:    <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></>,
  wallet:  <><path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2"/><path d="M22 11h-5a2 2 0 0 0 0 4h5z"/></>,
  shield:  <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></>,
  pen:     <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
  calendar:<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
  paste:   <><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></>,
  play:    <><circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/></>,
  star:    <><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></>,
  plus:    <><path d="M12 5v14M5 12h14"/></>,
  list:    <><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></>,
  sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></>,
  ticket:  <><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M9 6v2M9 11v2M9 16v2"/></>,
};
const WzSvg = ({name, size = 14, stroke = 1.9}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{WZ_ICON[name] || PROD_ICON[name]}</svg>
);
const WzGlyph = ({name}) => <span className="wz-glyph" aria-hidden="true"><WzSvg name={name} size={15} stroke={1.9}/></span>;
const WzTick = () => (
  <svg className="wz-tick" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
);
const WzChev = () => (
  <svg className="wz-row-chev" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
);
// Signal-style bars for graded choices (reply feel, confirmations).
const WzBars = ({n = 1, of = 3}) => (
  <span className="wz-bars" aria-hidden="true">
    {Array.from({length: of}, (_, i) => <i key={i} data-on={i < n ? '1' : undefined} style={{height: `${5 + i * 3}px`}}/>)}
  </span>
);

// A titled group: caption above, grouped rows, optional footnote below.
// collapse="key" folds the section behind its caption (for the steps'
// optional extras); `summary` shows what's set while it's closed.
const WzSec = ({cap, aside, note, children, bare = false, field = false, collapse, defaultOpen = false, summary, icon}) => {
  const [open, toggle] = useFold(collapse, defaultOpen);
  if (collapse) {
    return (
      <div className="wz-sec" data-fold={open ? 'open' : 'shut'}>
        <button type="button" className="wz-fold" aria-expanded={open} onClick={toggle}>
          {icon ? <span className="wz-fold-ico"><WzSvg name={icon} size={13}/></span> : null}
          <span className="wz-fold-cap">{cap}</span>
          {!open && summary && <span className="wz-fold-sum">{summary}</span>}
          {open && aside}
          <FoldChev open={open}/>
        </button>
        {open && (bare ? children : <div className="wz-group" data-field={field ? '1' : undefined}>{children}</div>)}
        {open && note && <div className="wz-note">{note}</div>}
      </div>
    );
  }
  return (
    <div className="wz-sec">
      {(cap || aside) && <div className="wz-cap"><span>{cap}</span>{aside}</div>}
      {bare ? children : <div className="wz-group" data-field={field ? '1' : undefined}>{children}</div>}
      {note && <div className="wz-note">{note}</div>}
    </div>
  );
};

// Whole row is the switch.
const WzSwitchRow = ({icon, title, hint, on, onChange, disabled}) => (
  <div className="wz-row" role="switch" aria-checked={!!on} aria-disabled={disabled ? 'true' : undefined}
    tabIndex={disabled ? -1 : 0} data-ico={icon ? '1' : undefined} data-on={on ? '1' : undefined}
    onClick={() => { if (!disabled) onChange(!on); }}
    onKeyDown={e => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange(!on); } }}>
    {icon && <span className="wz-ico"><WzSvg name={icon}/></span>}
    <span className="wz-row-txt">
      <span className="wz-row-title">{title}</span>
      {hint && <span className="wz-row-hint">{hint}</span>}
    </span>
    <span className="bc-switch" data-on={on ? '1' : '0'} aria-hidden="true"/>
  </div>
);

// Single choice list with a trailing check mark.
const WzChoice = ({value, onChange, options, label}) => (
  <div className="wz-group" role="radiogroup" aria-label={label}>
    {options.map(o => {
      const sel = value === o.value;
      return (
        <div key={String(o.value)} className="wz-row" role="radio" aria-checked={sel} tabIndex={0}
          data-ico={o.icon ? '1' : undefined}
          onClick={() => onChange(o.value)}
          onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(o.value); } }}>
          {o.icon && <span className="wz-ico"><WzSvg name={o.icon}/></span>}
          <span className="wz-row-txt">
            <span className="wz-row-title">{o.label}</span>
            {o.hint && <span className="wz-row-hint">{o.hint}</span>}
          </span>
          <WzTick/>
        </div>
      );
    })}
  </div>
);

// Choice tiles: the options side by side, so a question with two to four
// answers takes one short band instead of a tall list.
//   Single choice: value + onChange(value).
//   Toggles:       each option carries its own on + onChange(bool).
//   layout="stack" puts the symbol above a short label (3–4 columns).
const WzTiles = ({value, onChange, options, label, cols, layout, multi = false}) => {
  const n = cols || Math.min(options.length, layout === 'stack' ? 4 : 2);
  return (
    <div className="wz-tiles" role={multi ? 'group' : 'radiogroup'} aria-label={label}
      data-layout={layout} style={{'--wz-cols': n}}>
      {options.map(o => {
        const sel = multi ? !!o.on : value === o.value;
        const act = () => { if (o.disabled) return; multi ? o.onChange(!o.on) : onChange(o.value); };
        return (
          <button key={String(o.value != null ? o.value : o.label)} type="button" className="wz-tile"
            role={multi ? 'checkbox' : 'radio'} aria-checked={sel} disabled={o.disabled}
            title={o.title || undefined} onClick={act}>
            <span className="wz-tile-ico">{o.glyph || <WzSvg name={o.icon} size={15}/>}</span>
            <span className="wz-tile-txt">
              <span className="wz-tile-label">{o.label}</span>
              {o.hint && <span className="wz-tile-hint">{o.hint}</span>}
            </span>
            <span className="wz-tile-mark" aria-hidden="true">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </span>
          </button>
        );
      })}
    </div>
  );
};

// Segmented control. Options may carry an icon.
const WzSeg = ({value, onChange, options, label}) => (
  <div className="wz-seg" role="radiogroup" aria-label={label}>
    {options.map(o => (
      <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value}
        onClick={() => onChange(o.value)}>{o.icon && <WzSvg name={o.icon} size={12}/>}{o.label}</button>
    ))}
  </div>
);

// Pop-up menu inside a row: the value shows on the right, the native menu
// covers the whole row so a click anywhere on it opens the list.
const WzSelect = ({value, onChange, options: rawOptions, label, align, hint, icon = 'list'}) => {
  // One entry per value (the crypto list repeats a ticker once per network).
  const seen = new Set();
  const options = rawOptions.filter(o => (seen.has(o.value) ? false : (seen.add(o.value), true)));
  const cur = options.find(o => o.value === value);
  const groups = [];
  options.forEach(o => {
    const g = o.group || '';
    let bucket = groups.find(x => x.g === g);
    if (!bucket) { bucket = {g, items: []}; groups.push(bucket); }
    bucket.items.push(o);
  });
  const opt = o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>;
  return (
    <span className="wz-select" data-align={align}>
      {icon ? <span className="wz-select-ico">{typeof icon === 'string' ? <SelIco name={icon}/> : icon}</span> : null}
      <span className="wz-select-val">{cur ? (cur.short || cur.label) : 'Choose'}</span>
      {hint && <span className="wz-row-note">{hint}</span>}
      <svg width="9" height="12" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 5l3-3 3 3M2 9l3 3 3-3"/>
      </svg>
      <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
        {groups.map(b => b.g ? <optgroup key={b.g} label={b.g}>{b.items.map(opt)}</optgroup> : b.items.map(opt))}
      </select>
    </span>
  );
};

// Review row: label, value, chevron; the whole row goes back to its step.
// (Kept for pages outside the wizards.)
const WzReviewRow = ({k, v, dim, onClick}) => (
  <button type="button" className="wz-row" onClick={onClick}>
    <span className="wz-row-label">{k}</span>
    <span className="wz-row-val" data-dim={dim ? '1' : undefined}>{v}</span>
    <WzChev/>
  </button>
);

// Final page of every wizard: one compact two-column summary (each cell
// jumps back to its step) and the single "go live" switch underneath.
// Same parts, same order and the same height budget in all three.
//   items: [{icon, k, v, dim?, step}]   live: {icon, title, on, onChange}
const WzReview = ({items, go, live}) => (
  <>
    <div className="wz-sum" role="list">
      {items.filter(Boolean).map(it => (
        <button key={it.k} type="button" role="listitem" className="wz-sum-cell" onClick={() => go(it.step)}
          title={`Change ${it.k.toLowerCase()}`}>
          <span className="wz-sum-ico"><WzSvg name={it.icon} size={12}/></span>
          <span className="wz-sum-txt">
            <span className="wz-sum-k">{it.k}</span>
            <span className="wz-sum-v" data-dim={it.dim ? '1' : undefined}>{it.v}</span>
          </span>
        </button>
      ))}
    </div>
    {live && (
      <div className="wz-group">
        <WzSwitchRow icon={live.icon} title={live.title} on={live.on} onChange={live.onChange}/>
      </div>
    )}
  </>
);

const SetupWizard = ({steps, step, onStep, onCancel, onFinish, finishLabel, busyLabel, label, render}) => {
  useSsetFit(true);
  const idx = Math.max(0, Math.min(steps.length - 1, step));
  const cur = steps[idx];
  const last = idx === steps.length - 1;
  const blocked = cur.need === false;
  const [dir, setDir] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [nudge, setNudge] = React.useState(false);
  const aliveRef = React.useRef(true);
  React.useEffect(() => () => { aliveRef.current = false; }, []);

  // ── Height follows content ────────────────────────────────────
  const viewRef = React.useRef(null);
  const innerRef = React.useRef(null);
  const [h, setH] = React.useState(null);
  const [anim, setAnim] = React.useState(false);
  const [settling, setSettling] = React.useState(false);
  const prevH = React.useRef(null);
  const settleT = React.useRef(0);
  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    // offsetHeight, not getBoundingClientRect: the window opens with a
    // scale-in, and a transformed measurement would be too small.
    const measure = () => setH(el.offsetHeight);
    measure();
    // Animate only after the first size has been painted.
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setAnim(true)); });
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); if (ro) ro.disconnect(); clearTimeout(settleT.current); };
  }, []);
  // No scrollbar flash while the height is still moving.
  React.useLayoutEffect(() => {
    if (anim && prevH.current != null && h !== prevH.current) {
      setSettling(true);
      clearTimeout(settleT.current);
      settleT.current = setTimeout(() => { if (aliveRef.current) setSettling(false); }, 420);
    }
    prevH.current = h;
  }, [h, anim]);

  // New step: back to the top, first field focused.
  React.useLayoutEffect(() => {
    if (viewRef.current) viewRef.current.scrollTop = 0;
    setNudge(false);
    const f = innerRef.current && innerRef.current.querySelector('[data-wz-focus]');
    if (f) { try { f.focus({preventScroll: true}); } catch (_) {} }
  }, [idx]);
  React.useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(false), 2600);
    return () => clearTimeout(t);
  }, [nudge]);

  const reachable = (i) => steps.slice(0, i).every(s => s.need !== false);
  const go = (i) => {
    if (i === idx || i < 0 || i >= steps.length) return;
    if (i > idx && !reachable(i)) return;
    setDir(i > idx ? 1 : -1);
    onStep(i);
  };
  const next = async () => {
    if (saving) return;
    if (blocked) { setNudge(true); return; }
    if (!last) { go(idx + 1); return; }
    setSaving(true);
    try { await onFinish(); } finally { if (aliveRef.current) setSaving(false); }
  };
  const onKey = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented) return;
    const t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.type === 'checkbox' || t.type === 'file') return;
    if (t.classList.contains('slp-tagfield-input') || (t.closest && t.closest('[data-wz-noenter]'))) return;
    e.preventDefault(); next();
  };

  const skip = cur.optional && !cur.filled && !last;
  const primary = last ? (saving ? (busyLabel || 'Creating…') : finishLabel) : (skip ? 'Skip' : 'Continue');
  const primaryIco = last ? (saving ? null : 'check') : (skip ? 'skip' : 'chevR');

  return (
    <div className="wz" onKeyDown={onKey} role="group" aria-label={label}>
      <div className="wz-view" ref={viewRef}
        style={h == null ? undefined : {height: h}}
        data-anim={anim ? '1' : undefined} data-settling={settling ? '1' : undefined}>
        <div className="wz-inner" ref={innerRef}>
          <div key={cur.id} className="wz-stage" data-dir={dir > 0 ? 'f' : dir < 0 ? 'b' : undefined}>
            <header className="wz-head">
              {cur.hero || <WzGlyph name={cur.icon}/>}
              <span className="wz-head-txt">
                <h3 className="wz-title">{cur.title}</h3>
                {cur.sub && <p className="wz-sub">{cur.sub}</p>}
              </span>
            </header>
            <div className="wz-body">{render(cur, go)}</div>
          </div>
        </div>
      </div>

      <footer className="wz-foot">
        <button type="button" className="wz-btn" data-kind="plain"
          aria-label={idx === 0 ? 'Cancel' : 'Back'} title={idx === 0 ? 'Cancel' : 'Back'}
          onClick={idx === 0 ? onCancel : () => go(idx - 1)}>
          <WzSvg name={idx === 0 ? 'x' : 'chevL'} size={14} stroke={2.2}/>
          <span>{idx === 0 ? 'Cancel' : 'Back'}</span>
        </button>
        {nudge && blocked
          ? <span className="wz-need" role="status">{cur.needMsg}</span>
          : (
            <div className="wz-dots" aria-label={`Step ${idx + 1} of ${steps.length}`}>
              {steps.map((s, i) => (
                <button key={s.id} type="button" className="wz-dot"
                  data-s={i < idx ? 'done' : i === idx ? 'cur' : undefined}
                  aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === idx ? 'step' : undefined}
                  title={s.title}
                  disabled={i === idx || (i > idx && !reachable(i))}
                  onClick={() => go(i)}/>
              ))}
            </div>
          )}
        <button type="button" className="wz-btn" data-kind={skip ? 'tinted' : 'primary'}
          aria-disabled={blocked || saving ? 'true' : undefined}
          title={blocked ? cur.needMsg : undefined}
          onClick={next}>
          {last && primaryIco && <WzSvg name={primaryIco} size={13} stroke={2.4}/>}
          <span>{primary}</span>
          {!last && <WzSvg name={primaryIco} size={13} stroke={2.4}/>}
        </button>
      </footer>
    </div>
  );
};

// ── Image tile (product wizard) ───────────────────────────────────
// Sits beside the name row, the same height as it.
// The picture itself is the control: click to browse, or drop a file on
// it. Uploads are optimised by optimizeProductImage before they are kept.
const WzImageWell = ({value, onChange, onBusy, onErr}) => {
  const [busy, setBusy] = React.useState(false);
  const [broken, setBroken] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const fileRef = React.useRef(null);
  const img = String(value || '');
  React.useEffect(() => { setBroken(false); if (onErr) onErr(''); }, [img]);
  const take = async (file) => {
    if (!file) return;
    if (onErr) onErr('');
    setBusy(true); if (onBusy) onBusy(true);
    try { onChange(await optimizeProductImage(file)); }
    catch (e) { if (onErr) onErr(e.message || 'That image could not be used.'); }
    finally { setBusy(false); if (onBusy) onBusy(false); }
  };
  const pick = () => fileRef.current && fileRef.current.click();
  return (
    <span className="wz-well-wrap">
      <button type="button" className="wz-well" data-drag={drag ? '1' : undefined} data-has={img && !broken ? '1' : undefined}
        onClick={pick} aria-label={img ? 'Change image' : 'Add an image'} title={img ? 'Change image' : 'Add an image (or drop one here)'}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
        {img && !broken
          ? <img src={img} alt="" onError={() => { setBroken(true); if (onErr) onErr('That link does not load'); }}/>
          : <span className="wz-well-empty"><WzSvg name="image" size={17} stroke={1.7}/><small>Image</small></span>}
        {busy && <span className="wz-well-busy">…</span>}
      </button>
      {img && (
        <button type="button" className="wz-well-x" aria-label="Remove image" title="Remove image"
          onClick={() => { onChange(''); if (onErr) onErr(''); }}>
          <WzSvg name="x" size={9} stroke={3}/>
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden
        onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; take(f); }}/>
    </span>
  );
};

// ── Photos and videos (wizard and editor) ─────────────────────────
// The pictures a customer sees BEFORE buying. The first is the cover
// (draft.img, the catalogue thumbnail); the rest are showcase entries in
// draft.media (showcase: true). Photos are uploaded (and compressed);
// video is never uploaded — it goes in as a YouTube link (kind: 'link'),
// which the agent sends as a link the platform previews, and which the
// chat draws as a playable card (YouTubeCard in bot-ui-shared.jsx). Your agent sends any of them when a
// customer asks to see the item. Files delivered AFTER payment live in
// the "After payment" section instead (BuyerFiles), so the two never mix.
const GALLERY_MAX = 12;
const galIsImageUrl = (u) => /^data:image\//i.test(u) || /\.(png|jpe?g|webp|gif|svg|avif)(\?|#|$)/i.test(u);
const galIsVideo = (m) => m && (/^video\//i.test(m.mime || '') || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(m.url || ''));
const galId = () => 'med_' + Math.random().toString(36).slice(2, 12);
const galBase = (n) => String(n || '').replace(/\.[^.]+$/, '');

const WzGallery = ({draft, upd, onBusy}) => {
  const media = draft.media || [];
  const cover = String(draft.img || '');
  const shows = media.map((m, i) => ({m, i})).filter(x => x.m && x.m.showcase);
  const count = (cover ? 1 : 0) + shows.length;
  const [busy, setBusy] = React.useState(0);
  const [err, setErr] = React.useState('');
  const [drag, setDrag] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkVal, setLinkVal] = React.useState('');
  const [broken, setBroken] = React.useState({});
  const fileRef = React.useRef(null);
  React.useEffect(() => { if (onBusy) onBusy(busy > 0); }, [busy > 0]);

  const take = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setErr('');
    let img = cover;
    const add = [];
    let room = GALLERY_MAX - count;
    setBusy(b => b + 1);
    try {
      for (const f of list) {
        if (room <= 0) { setErr(`Up to ${GALLERY_MAX} photos and videos`); break; }
        const type = f.type || '';
        try {
          if (/^image\//.test(type)) {
            const url = await optimizeProductImage(f);
            if (!img) img = url;
            else add.push({id: galId(), kind: 'image', url, label: galBase(f.name), desc: '', showcase: true, filename: f.name, mime: type});
            room--;
          } else if (/^video\//.test(type)) {
            setErr('Videos are too large to upload. Paste a YouTube link instead.');
            setLinkOpen(true);
          } else {
            setErr('Photos only here. Files for buyers go under After payment.');
          }
        } catch (e) { setErr(e.message || 'That file could not be used'); }
      }
    } finally { setBusy(b => b - 1); }
    if (img !== cover) upd('img', img);
    if (add.length) upd('media', [...media, ...add]);
  };

  const addLink = () => {
    const u = linkVal.trim();
    if (!/^https?:\/\//i.test(u)) { setErr('Paste a full link starting with https://'); return; }
    if (count >= GALLERY_MAX) { setErr(`Up to ${GALLERY_MAX} photos and videos`); return; }
    setErr('');
    const yt = bcYouTubeId(u);
    if (!yt && !galIsImageUrl(u)) { setErr('That link isn’t a YouTube video or a photo. Use a YouTube link, or a direct photo link ending in .jpg, .png, .webp or .gif'); return; }
    if (!yt && !cover) upd('img', u);
    else {
      let label = yt ? 'YouTube video' : u;
      if (!yt) { try { label = new URL(u).hostname.replace(/^www\./, ''); } catch (_) {} }
      upd('media', [...media, {id: galId(), kind: yt ? 'link' : 'image', url: u, label, desc: '', showcase: true, filename: '', mime: ''}]);
    }
    setLinkVal(''); setLinkOpen(false);
  };

  // Cover removed: the next photo moves up to take its place.
  const removeCover = () => {
    const next = shows.find(x => x.m.kind === 'image' && x.m.url);
    if (next) {
      upd('img', next.m.url);
      upd('media', media.filter((_, i) => i !== next.i));
    } else upd('img', '');
  };
  const removeAt = (i) => upd('media', media.filter((_, j) => j !== i));
  // Swap a photo with the cover.
  const makeCover = (i) => {
    const m = media[i];
    if (!m || m.kind !== 'image') return;
    const rest = media.slice();
    if (cover) rest[i] = {id: galId(), kind: 'image', url: cover, label: 'Photo', desc: '', showcase: true, filename: '', mime: ''};
    else rest.splice(i, 1);
    upd('img', m.url);
    upd('media', rest);
  };

  const tileBody = (url, m) => {
    if (m && m.kind === 'link' && bcYouTubeId(m.url)) {
      return (<>
        <img src={`https://i.ytimg.com/vi/${bcYouTubeId(m.url)}/mqdefault.jpg`} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden'; }}/>
        <span className="gal-yt" aria-hidden="true"><BcYtLogo s={16}/></span>
      </>);
    }
    if (m && m.kind === 'link') return <span className="gal-ico"><WzSvg name="link" size={15}/><small>{m.label || 'Link'}</small></span>;
    if (m && galIsVideo(m)) return <span className="gal-ico"><WzSvg name="play" size={15}/><small>Video</small></span>;
    if (broken[url]) return <span className="gal-ico" data-bad="1"><WzSvg name="image" size={15}/><small>Won’t load</small></span>;
    return <img src={url} alt="" onError={() => setBroken(b => ({...b, [url]: true}))}/>;
  };

  const pick = () => fileRef.current && fileRef.current.click();
  const dropProps = {
    onDragOver: e => { e.preventDefault(); setDrag(true); },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); },
    onDrop: e => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files); },
  };

  return (
    <div className="gal" data-drag={drag ? '1' : undefined} {...dropProps}>
      {count === 0 ? (
        <button type="button" className="gal-empty" onClick={pick}>
          <span className="gal-empty-ico"><WzSvg name="image" size={18} stroke={1.7}/></span>
          <span className="gal-empty-txt">
            <strong>{busy ? 'Adding…' : 'Add photos'}</strong>
            <small>Choose several at once, or drop them here. You can also paste a YouTube or photo link below.</small>
          </span>
        </button>
      ) : (
        <div className="gal-grid">
          {cover && (
            <div className="gal-tile" data-cover="1">
              {tileBody(cover)}
              <span className="gal-badge">Cover</span>
              <button type="button" className="gal-x" aria-label="Remove cover photo" title="Remove" onClick={removeCover}><WzSvg name="x" size={9} stroke={3}/></button>
            </div>
          )}
          {shows.map(({m, i}) => (
            <div key={m.id || i} className="gal-tile" title={m.label || m.filename || ''}>
              {tileBody(m.url, m)}
              {m.kind === 'image' && !broken[m.url] && (
                <button type="button" className="gal-star" aria-label="Make cover" title="Make cover" onClick={() => makeCover(i)}>
                  <WzSvg name="star" size={10} stroke={2.4}/>
                </button>
              )}
              <button type="button" className="gal-x" aria-label="Remove" title="Remove" onClick={() => removeAt(i)}><WzSvg name="x" size={9} stroke={3}/></button>
            </div>
          ))}
          {count < GALLERY_MAX && (
            <button type="button" className="gal-add" onClick={pick} aria-label="Add photos" title="Add photos">
              {busy ? <small>…</small> : <WzSvg name="plus" size={16} stroke={2}/>}
            </button>
          )}
        </div>
      )}
      <div className="gal-foot">
        <span className="gal-note">
          <WzSvg name="bubble" size={11}/>
          Your agent shows these when asked to see it.
        </span>
        {linkOpen ? null : (
          <button type="button" className="wz-chip" onClick={() => setLinkOpen(true)}
            title="Paste a YouTube link or a direct link to a photo" aria-label="Add a YouTube or photo link">
            <WzSvg name="link" size={11}/>YouTube or photo link
          </button>
        )}
        {count > 0 && <span className="gal-count">{count}/{GALLERY_MAX}</span>}
      </div>
      {linkOpen && (
        <div className="wz-group" data-field="1">
          <div className="wz-row" data-ico="1">
            <span className="wz-ico">{bcYouTubeId(linkVal.trim()) ? <BcYtLogo s={13}/> : <WzSvg name="link" size={13}/>}</span>
            <input className="wz-input" autoFocus value={linkVal} placeholder="Paste a YouTube link or a photo link (https://…)"
              data-wz-noenter="1"
              onChange={e => setLinkVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } if (e.key === 'Escape') { e.stopPropagation(); setLinkOpen(false); } }}/>
            <button type="button" className="wz-chip" onClick={addLink} disabled={!linkVal.trim()}><WzSvg name="plus" size={11}/>Add</button>
            <button type="button" className="gal-close" aria-label="Cancel" onClick={() => { setLinkOpen(false); setLinkVal(''); }}><WzSvg name="x" size={10} stroke={2.6}/></button>
          </div>
        </div>
      )}
      {err && <div className="wz-note" data-warn="1">{err}</div>}
      <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden
        onChange={e => { const fs = e.target.files; take(fs); e.target.value = ''; }}/>
    </div>
  );
};

// Files and links delivered after payment: only the non-showcase entries
// of draft.media. Showcase photos are kept as they are around the edit.
const BuyerFiles = ({media, onChange}) => {
  const list = media || [];
  const shows = list.filter(m => m && m.showcase);
  const paid = list.filter(m => m && !m.showcase);
  return <MediaList items={paid} audience="paid" onChange={p => onChange([...shows, ...p.map(m => ({...m, showcase: false}))])}/>;
};

// ── KEYS AND CODES (stock list) ─────────────────────────────────────
// A product can hand out one item per sale from a list the operator pastes
// in: licence keys bought in bulk, gift or voucher codes, account logins,
// seat numbers. The server gives each paying buyer the next unused item
// and never the same item twice (bc_product_stock in api.php).
//
// Used in two places:
//   • the product editor (existing item): the list lives on the server and
//     every change is saved at once (stock_add / stock_remove);
//   • the new-item wizard (pending): pasted items are held on the draft as
//     stockPending and added right after the item is created.
// The settings (on/off, what an item is called, what happens when it runs
// out) are ordinary product fields, saved with the item.
const STOCK_LABELS = ['License key', 'Gift card', 'Voucher code', 'Account login', 'Download link'];

const ensureStockStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bc-stock-style')) return;
  const st = document.createElement('style');
  st.id = 'bc-stock-style';
  // Built from the wizard's own parts (.wz-group / .wz-row / .wz-cap /
  // .wz-note, 10px corners); only the few pieces those don't cover are
  // defined here. Works in the product editor's fold-out panel (narrow,
  // indented) and in the new-item wizard (full width).
  st.textContent = `
/* Layout. Everything sits in the wizard's own parts; these rules only
   size them for this page. The doubled class outranks the compact wizard
   rules (.sset-subpop .wz …) without !important. The editor is a size
   container, so its bars re-flow to the space the panel really has. */
.stk { display: flex; flex-direction: column; gap: 14px; min-width: 0; container: stk / inline-size; }
.stk.stk .wz-sec { gap: 6px; min-width: 0; }
.stk.stk .wz-row .wz-select { max-width: 62%; }
.stk.stk .wz-row .wz-input-end { flex: 0 1 180px; min-width: 0; }
/* Hints wrap to a second line here rather than lose their ending. */
.stk.stk .wz-row .wz-row-hint { white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.4; }
.stk.stk .wz-note { line-height: 1.5; }
.stk.stk .wz-note[data-warn="1"] { color: rgb(236,190,120); }

/* Captions: the title always shows in full; the note on the right gives way. */
.stk.stk .wz-cap { align-items: center; min-height: 18px; }
.stk.stk .wz-cap > span:first-child { flex: 0 0 auto; white-space: nowrap; }
.stk-cap-end { flex: 0 1 auto; min-width: 0; display: inline-flex; align-items: center; justify-content: flex-end; gap: 10px; }
.stk-cap-end small { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stk.stk .stk-cap-end .wz-link { flex: 0 0 auto; font-size: 11px; font-weight: 500; color: rgba(236,122,116,0.82); }
@media (hover: hover) { .stk.stk .stk-cap-end .wz-link:hover:not(:disabled) { color: rgb(246,140,134); } }
.stk.stk .stk-cap-end .wz-link:disabled { opacity: 0.4; cursor: default; text-decoration: none; }
.stk.stk .stk-cap-warn { color: rgb(236,190,120); }

/* Paste box: borderless, grows with what is pasted, scrolls past ~12 lines. */
.sset-subpop .wz textarea.wz-textarea.stk-ta, .wz textarea.wz-textarea.stk-ta {
  min-height: 76px !important; max-height: 240px !important; padding: 10px 12px !important; resize: none !important; overflow-y: auto;
  font-family: var(--mono, ui-monospace, monospace) !important; font-size: 11.5px !important; line-height: 1.6 !important; letter-spacing: 0;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
.sset-subpop .wz textarea.wz-textarea.stk-ta::placeholder, .wz textarea.wz-textarea.stk-ta::placeholder {
  font-family: var(--mono, ui-monospace, monospace); color: rgba(160,164,184,0.36); }

/* Bar under the paste box: how items are separated, then the one action. */
.stk-addbar { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 6px 6px 8px;
  border-top: 1px solid rgba(255,255,255,0.055); }
.stk.stk .stk-addbar .wz-seg { flex: 0 1 auto; min-width: 0; }
.stk.stk .stk-addbar .wz-seg button { flex: 0 1 auto; min-width: 0; display: block; height: 24px; padding: 0 10px;
  line-height: 24px; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Small buttons: one filled action per block, icon buttons on rows. */
.stk-go { flex: 0 0 auto; margin-left: auto; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 26px; min-width: 62px; padding: 0 11px; border: none; border-radius: 7px; font: inherit; font-size: 11.5px; font-weight: 600;
  letter-spacing: -0.005em; white-space: nowrap; font-variant-numeric: tabular-nums; color: #fff; background: var(--acc, #6c63ff);
  cursor: pointer; transition: background-color 140ms ease, color 140ms ease; }
@media (hover: hover) { .stk-go:hover:not(:disabled) { background: color-mix(in oklab, var(--acc, #6c63ff) 86%, #ffffff); } }
.stk-go:disabled { color: rgba(170,174,194,0.5); background: rgba(255,255,255,0.055); cursor: default; }
.stk-go:focus-visible, .stk-ib:focus-visible, .stk-expand:focus-visible { outline: none;
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.stk.stk .wz-row .stk-go { margin-left: 0; }
.stk-ib { flex: 0 0 auto; width: 24px; height: 24px; padding: 0; margin: 0; border: none; border-radius: 6px; display: inline-flex;
  align-items: center; justify-content: center; background: transparent; color: rgba(172,176,198,0.6); cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease; }
@media (hover: hover) { .stk-ib:hover:not(:disabled) { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.07); }
  .stk-ib[data-tone="danger"]:hover:not(:disabled) { color: rgb(240,130,124); background: rgba(230,110,104,0.1); } }
.stk-ib:disabled { opacity: 0.35; cursor: default; }
.stk-ib[data-done="1"] { color: rgb(110,200,150); }

/* Left / Given out / Waiting, each with its count as a quiet figure. */
.stk.stk .stk-filter .wz-seg button { flex: 1 1 auto; min-width: 0; padding: 0 8px; gap: 6px; overflow: hidden; }
.stk-seg-l { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stk-n { flex: 0 0 auto; font-size: 10.5px; font-weight: 500; color: rgba(160,164,184,0.58); font-variant-numeric: tabular-nums; }
.stk.stk .stk-filter .wz-seg button[aria-checked="true"] .stk-n { color: rgba(214,216,232,0.8); }

/* Search strip over long lists */
.stk.stk .stk-tools .wz-row { min-height: 36px; gap: 8px; padding: 0 6px 0 10px; }
.stk.stk .stk-tools .wz-ico { width: 18px; background: transparent; color: rgba(160,164,184,0.6); }
.stk.stk .stk-tools .wz-input { height: 36px; font-size: 12px; }
.stk-hits { flex: 0 0 auto; font-size: 10.5px; color: rgba(160,164,184,0.6); font-variant-numeric: tabular-nums; white-space: nowrap; }
.stk-tools-acts { flex: 0 0 auto; display: inline-flex; align-items: center; }

/* The list. Rows top-align, so a login that runs over two lines keeps its
   number and buttons level with its first line. --stk-idx is the width of
   the widest number shown, set from the row count. */
.stk.stk .stk-list { max-height: min(420px, 50vh); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
.stk-list::-webkit-scrollbar, .stk-ta::-webkit-scrollbar { width: 6px; }
.stk-list::-webkit-scrollbar-thumb, .stk-ta::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
.stk.stk .stk-list .wz-row { align-items: flex-start; min-height: 34px; gap: 8px; padding: 0 6px 0 10px; transition: background-color 120ms ease; }
@media (hover: hover) { .stk.stk .stk-list .wz-row[data-k]:hover { background: rgba(255,255,255,0.022); } }
.stk.stk .stk-list .wz-row + .wz-row::before { left: calc(18px + var(--stk-idx, 14px)); }
.stk.stk .stk-list .wz-row-txt { padding: 8px 0; gap: 2px; }
.stk-idx { flex: 0 0 var(--stk-idx, 14px); padding-top: 8px; text-align: right; font-size: 10px; line-height: 17px;
  color: rgba(160,164,184,0.42); font-variant-numeric: tabular-nums; white-space: nowrap; }
.stk-act { flex: 0 0 auto; display: inline-flex; align-items: center; margin-top: 5px; }
.stk-item { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
  font-family: var(--mono, ui-monospace, monospace); font-size: 11.5px; line-height: 17px; letter-spacing: 0; color: var(--t1, #eeeef5);
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; }
.stk-item[data-open="1"] { display: block; -webkit-line-clamp: unset; }
.stk-expand { align-self: flex-start; padding: 0; margin: 1px 0 0; border: none; border-radius: 3px; background: none; font: inherit;
  font-size: 10.5px; font-weight: 500; color: color-mix(in oklab, var(--acc, #6c63ff) 45%, #c4c6dc); cursor: pointer; }
@media (hover: hover) { .stk-expand:hover { text-decoration: underline; text-underline-offset: 2px; } }
.stk-list .wz-row[data-k="given"] .stk-item { color: rgba(186,190,212,0.62); }
.stk-list .wz-row[data-k="owed"] .stk-item { font-family: inherit; color: rgb(236,190,120); }
.stk.stk .stk-list .stk-more { align-items: center; justify-content: center; gap: 6px; }
.stk.stk .stk-list .stk-more .wz-link { font-size: 11.5px; }
.stk-dot { color: rgba(160,164,184,0.4); }
.stk-empty { padding: 16px 14px; text-align: center; font-size: 11.5px; line-height: 1.45; color: rgba(160,164,184,0.62); }

/* Waiting customers: the one row that needs attention */
.stk.stk .wz-row[data-tone="warn"] .wz-ico { color: rgb(236,190,120); background: rgba(222,168,92,0.14); }
.stk.stk .stk-wait .wz-row { align-items: center; }
.stk.stk .stk-wait .wz-row-txt { padding: 8px 0; }
.stk-em { font-weight: 600; color: rgba(214,216,232,0.92); }
.stk .wz-note code { font-family: var(--mono, ui-monospace, monospace); font-size: 10px; padding: 1px 4px; border-radius: 4px;
  background: rgba(255,255,255,0.07); color: rgba(214,216,232,0.9); white-space: nowrap; }
.stk.stk .stk-tip { margin-top: -4px; }

/* Narrow panels: the separator choice takes the full width and the
   Add button sits under it. */
@container stk (max-width: 300px) {
  .stk-addbar { flex-wrap: wrap; }
  .stk.stk .stk-addbar .wz-seg { flex: 1 1 100%; }
  .stk.stk .stk-addbar .wz-seg button { flex: 1 1 0; padding: 0 6px; }
  .stk-go { flex: 1 1 100%; margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) { .stk-go, .stk-ib, .stk.stk .stk-list .wz-row { transition: none; } }
`;
  document.head.appendChild(st);
};

// Pasted text → items. 'line': one per line. 'block': groups separated by a
// blank line (logins, multi-line codes).
const stockParse = (text, mode) => {
  const t = String(text || '').replace(/\r\n?/g, '\n').replace(/[\u200B\uFEFF]/g, '');
  const parts = mode === 'block' ? t.split(/\n[ \t]*\n+/) : t.split('\n');
  return parts.map(s => s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '').trim()).filter(Boolean);
};
const stockKey = (s) => String(s || '').trim().replace(/\s+/g, ' ');
// Blank lines between groups that span several lines → probably logins.
const stockLooksBlocky = (text) => /\S\n[^\n]*\S[^\n]*\n[ \t]*\n/.test(String(text || '').replace(/\r\n?/g, '\n') + '\n');
const stockZero = () => ({available: 0, given: 0, owed: 0, unsent: 0});

// Push fresh counts into the catalogue store so list rows and the editor's
// summaries update without reloading every product.
const stockSyncCounts = (pid, counts) => {
  if (!pid || !counts || typeof PRODS_STORE === 'undefined') return;
  let hit = false;
  PRODS_STORE.list = PRODS_STORE.list.map(p => {
    if (String(p.id) !== String(pid)) return p;
    hit = true;
    return {...p, stockCount: {...stockZero(), ...counts}};
  });
  if (hit) PRODS_STORE.notify();
};

// Summary for the editor row and the catalogue list.
const stockSummary = (p) => {
  if (!p || !p.stockMode) return {text: 'Off', set: false, tone: ''};
  const c = {...stockZero(), ...(p.stockCount || {})};
  const pend = Array.isArray(p.stockPending) ? p.stockPending.length : 0;
  const avail = c.available + pend;
  if (!avail) return {text: c.owed ? `Sold out · ${c.owed} waiting` : 'Sold out', set: true, tone: 'out'};
  return {text: `${avail.toLocaleString()} left`, set: true, tone: avail <= 3 ? 'low' : ''};
};

// Tell customers who paid while the list was empty that theirs is here.
// Chats the app can't send to (direct chats, bots the server answers) are
// returned so the operator can copy the message across by hand.
const stockSendWaiting = async (pid) => {
  const r = await apiFetch('stock_fulfil_owed', {product_id: pid});
  if (!r || r.error) return {error: (r && r.error) || 'No response from the server', sent: [], manual: []};
  const sent = [], manual = [];
  for (const s of (r.send || [])) {
    const conv = ((typeof MSGS_STORE !== 'undefined' && MSGS_STORE.list) || []).find(m => m && m.id === s.conv_id);
    const canSend = !!(conv && conv.chatId && window.BotBridge && typeof window.BotBridge.sendMessage === 'function' && !String(conv.id).startsWith('dm_'));
    if (!canSend) { manual.push(s); continue; }
    let text = s.text || `${s.label}: ${s.item}`;
    if (typeof AGENT_VOICE !== 'undefined') {
      try {
        text = await AGENT_VOICE.say(conv.id, 'stock_backorder', {
          brief: `Earlier this customer paid for ${s.product || 'their order'} while it was out of stock, and you told them it was on its way. It is here now. TEXT TO ADAPT is what they should get: keep it exactly, and only add a few words of your own at the very start saying it's in now. No greeting, no apology speech, no sign-off.`,
          sourceText: text, mustInclude: [s.item], multiline: true, maxLen: Math.round(text.length * 1.4) + 160, timeoutMs: 12000,
        }, text);
      } catch (_) { /* the operator's text stands */ }
    }
    try {
      window.BotBridge.sendMessage(conv.p, conv.chatId, text);
      MSGS_STORE.onOutbound(conv.id, conv.chatId, conv.p, text, {role: 'bot', agent: 'System'});
      sent.push(s);
    } catch (_) { manual.push(s); }
  }
  if (sent.length) { try { await apiFetch('stock_mark_sent', {ids: sent.map(s => s.id)}); } catch (_) {} }
  return {sent, manual, filled: r.filled || 0, counts: r.counts};
};

// Copy one item, with a tick for a moment afterwards.
const StockCopyBtn = ({text}) => {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1200); return () => clearTimeout(t); }, [done]);
  return (
    <button type="button" className="stk-ib" data-done={done ? '1' : undefined} aria-label="Copy" title={done ? 'Copied' : 'Copy'}
      onClick={() => { try { navigator.clipboard.writeText(String(text)); setDone(true); } catch (_) {} }}>
      <WzSvg name={done ? 'check' : 'paste'} size={13}/>
    </button>
  );
};

const StockEditor = ({draft, upd, pending = false, onCounts}) => {
  ensureStockStyles();
  const pid = draft && draft.id > 0 ? draft.id : 0;
  const on = !!draft.stockMode;
  const label = String(draft.stockLabel || '').trim();
  const fallback = draft.allowSerial ? 'License key' : 'Code';
  const shownLabel = label || fallback;
  const lower = shownLabel.toLowerCase();
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
  const presets = ['Code', ...STOCK_LABELS];
  const preset = presets.find(x => x.toLowerCase() === shownLabel.toLowerCase());
  const [customName, setCustomName] = React.useState(() => !!label && !preset);
  const hold = draft.stockWhenEmpty === 'hold';

  const [items, setItems] = React.useState(null);           // server rows (null = loading)
  const [counts, setCounts] = React.useState(() => ({...stockZero(), ...(draft.stockCount || {})}));
  const [loadErr, setLoadErr] = React.useState('');
  const [text, setText] = React.useState('');
  const [mode, setMode] = React.useState('line');
  const [modeTouched, setModeTouched] = React.useState(false);
  const [busy, setBusy] = React.useState('');
  const [filter, setFilter] = React.useState('available');
  const [q, setQ] = React.useState('');
  const [manual, setManual] = React.useState([]);            // back-orders to send by hand
  const [openRow, setOpenRow] = React.useState(null);        // a long item shown in full
  const taRef = React.useRef(null);

  // The paste box grows with what's in it (CSS caps it and scrolls past
  // that). Inline !important, because the popup's textarea rule is one.
  React.useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('height', Math.ceil(el.scrollHeight + 1) + 'px', 'important');
  }, [text, mode, on]);

  const applyCounts = (c) => {
    if (!c) return;
    const next = {...stockZero(), ...c};
    setCounts(next);
    stockSyncCounts(pid, next);
    if (onCounts) onCounts(next);
  };

  const load = React.useCallback(async () => {
    if (pending || !pid) return;
    const r = await apiFetch('stock_list', {product_id: pid});
    if (!r || r.error) { setLoadErr((r && r.error) || 'Couldn’t load the list.'); setItems([]); return; }
    setLoadErr(r.unavailable ? 'Stock lists aren’t set up on the server yet. Upload the new api.php, then reopen this item.' : '');
    setItems(r.items || []);
    applyCounts(r.counts);
    // eslint-disable-next-line
  }, [pid, pending]);
  React.useEffect(() => { if (on) load(); }, [on, load]);

  // What the paste box holds, checked against the list before adding.
  const parsed = React.useMemo(() => stockParse(text, mode), [text, mode]);
  const known = React.useMemo(() => {
    const m = new Map();
    if (pending) (draft.stockPending || []).forEach(s => m.set(stockKey(s), 'available'));
    else (items || []).forEach(it => { if (it.status !== 'owed') m.set(stockKey(it.item), it.status); });
    return m;
  }, [items, pending, draft.stockPending]);
  const check = React.useMemo(() => {
    const seen = new Set(); let fresh = 0, listed = 0, given = 0, repeat = 0;
    parsed.forEach(s => {
      const k = stockKey(s);
      if (seen.has(k)) { repeat++; return; }
      seen.add(k);
      const st = known.get(k);
      if (st === 'given') given++; else if (st) listed++; else fresh++;
    });
    return {fresh, listed, given, repeat};
  }, [parsed, known]);

  const onPaste = (v) => {
    setText(v);
    if (!modeTouched) setMode(stockLooksBlocky(v) ? 'block' : 'line');
  };

  const add = async () => {
    if (!check.fresh || busy) return;
    if (pending) {
      const have = new Set((draft.stockPending || []).map(stockKey));
      const next = [...(draft.stockPending || [])];
      parsed.forEach(s => { const k = stockKey(s); if (!have.has(k)) { have.add(k); next.push(s); } });
      upd('stockPending', next);
      setText(''); setModeTouched(false);
      return;
    }
    setBusy('add');
    const r = await apiFetch('stock_add', {product_id: pid, items: parsed});
    setBusy('');
    if (!r || r.error) { bcToast('Couldn’t add them — ' + ((r && r.error) || 'no response from the server'), 'err'); return; }
    const skipped = [r.in_list ? `${r.in_list} already listed` : '', r.given ? `${r.given} already given out` : '', r.too_long ? `${r.too_long} too long` : ''].filter(Boolean).join(', ');
    bcToast(`Added ${plural(r.added || 0, lower)}`, 'ok', skipped ? {detail: 'Skipped ' + skipped} : undefined);
    setText(''); setModeTouched(false);
    applyCounts(r.counts);
    setFilter('available');
    load();
  };

  const removeIds = async (ids, all = false) => {
    if (pending) {
      const drop = new Set(ids);
      upd('stockPending', all ? [] : (draft.stockPending || []).filter((_, i) => !drop.has(i)));
      return;
    }
    setBusy('remove');
    const r = await apiFetch('stock_remove', all ? {product_id: pid, all: 1} : {product_id: pid, ids});
    setBusy('');
    if (!r || r.error) { bcToast('Couldn’t remove — ' + ((r && r.error) || 'no response from the server'), 'err'); return; }
    bcToast(`Removed ${plural(r.removed || 0, lower)}`, 'ok');
    applyCounts(r.counts);
    load();
  };

  const sendWaiting = async () => {
    if (!pid || busy) return;
    setBusy('send');
    const r = await stockSendWaiting(pid);
    setBusy('');
    if (r.error) { bcToast('Couldn’t send — ' + r.error, 'err'); return; }
    applyCounts(r.counts);
    setManual(r.manual || []);
    if (r.sent.length) bcToast(`Sent to ${plural(r.sent.length, 'customer')}`, 'ok');
    else if (!r.manual.length) bcToast(`No ${lower}s left to send. Add more first.`, 'warn');
    load();
  };
  const markManualSent = async (s) => {
    try { await apiFetch('stock_mark_sent', {ids: [s.id]}); } catch (_) {}
    setManual(m => m.filter(x => x.id !== s.id));
    load();
  };

  const c = pending ? {...stockZero(), available: (draft.stockPending || []).length} : counts;
  const total = c.available + c.given + c.owed;
  const waiting = c.owed + c.unsent;
  const view = pending ? 'available' : filter;

  const rows = React.useMemo(() => {
    if (pending) {
      const list = (draft.stockPending || []).map((s, i) => ({id: i, item: s, status: 'available'}));
      return q ? list.filter(x => bcMatch(q, x.item)) : list;
    }
    const all = items || [];
    const by = view === 'given' ? all.filter(x => x.status === 'given').slice().reverse()
      : view === 'owed' ? all.filter(x => x.status === 'owed')
      : all.filter(x => x.status === 'available');
    return q ? by.filter(x => bcMatch(q, x.item, x.customer, x.handle)) : by;
  }, [items, view, q, pending, draft.stockPending]);
  // Long lists: 200 rows at a time, "Show all" up to a few thousand, and a
  // search that covers every row (not only the ones on screen).
  const STOCK_PAGE = 200;
  const [limit, setLimit] = React.useState(STOCK_PAGE);
  React.useEffect(() => { setLimit(STOCK_PAGE); }, [view, q, pending]);
  const shown = rows.length > limit ? rows.slice(0, limit) : rows;
  const rest = Math.max(0, rows.length - limit);
  const exportRows = (how) => {
    const list = rows.filter(r => r.status !== 'owed');
    if (!list.length) return;
    if (how === 'copy') {
      try { navigator.clipboard.writeText(list.map(r => r.item).join(list.some(r => String(r.item).includes('\n')) ? '\n\n' : '\n')); bcToast(`Copied ${plural(list.length, lower)}`, 'ok'); }
      catch (_) { bcToast('Couldn’t copy', 'err'); }
      return;
    }
    const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = view === 'given' ? ['item', 'customer', 'handle', 'given_at'] : ['item', 'added'];
    const body = list.map(r => (view === 'given' ? [r.item, r.customer, r.handle, r.at] : [r.item, r.added]).map(cell).join(','));
    const csv = '\uFEFF' + [head.join(','), ...body].join('\r\n');
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
      a.download = `${String(draft.name || 'stock').replace(/[^\w\- ]+/g, '').trim() || 'stock'} - ${view === 'given' ? 'given out' : 'left'}.csv`;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (_) { bcToast('Couldn’t download', 'err'); }
  };

  // Saved state differs from the switch: say what Save will do.
  const saved = (!pending && pid > 0 && typeof PRODS_STORE !== 'undefined' && PRODS_STORE.list.find(p => p.id === pid)) || null;
  const unsaved = saved && !!saved.stockMode !== on;

  // The Add button already counts what's new; the caption only speaks up
  // about lines that will be skipped.
  const skips = [
    check.listed ? `${check.listed.toLocaleString()} already listed` : '',
    check.given ? `${check.given.toLocaleString()} already given out` : '',
    check.repeat ? `${check.repeat.toLocaleString()} repeated` : '',
  ].filter(Boolean);
  const skipNote = skips.length ? `Skips ${skips.join(', ')}` : '';

  // The filter carries the counts when it shows, so the caption doesn't repeat them.
  const showFilter = !pending && (c.given > 0 || c.owed > 0);
  const listNote = !c.available ? (hold ? 'Empty, still selling' : 'Empty, shown as sold out')
    : showFilter ? '' : `${c.available.toLocaleString()} left`;
  const canClear = view === 'available' && c.available > 1 && !q;
  const segLabel = (word, n) => <><span className="stk-seg-l">{word}</span><span className="stk-n">{n.toLocaleString()}</span></>;
  // Room for the widest row number on screen (10px tabular figures).
  const idxW = Math.max(12, Math.ceil(Math.max(1, shown.length).toLocaleString().length * 6.2));

  return (
    <div className="stk">
      {/* Settings: the switch, what one item is called, what happens at zero */}
      <div className="wz-sec">
        <div className="wz-group">
          <WzSwitchRow icon="ticket" title="Hand out from a list" hint="One per sale, never the same one twice"
            on={on} onChange={v => upd('stockMode', v)}/>
          {on && (<>
            <div className="wz-row" data-ico="1">
              <span className="wz-ico"><WzSvg name="tag"/></span>
              <span className="wz-row-title wz-grow">Each one is a</span>
              <WzSelect label="Each one is a" icon={null} value={customName ? '__custom' : (preset || fallback)}
                onChange={v => { if (v === '__custom') { setCustomName(true); } else { setCustomName(false); upd('stockLabel', v); } }}
                options={[...presets.map(x => ({value: x, label: x})), {value: '__custom', label: 'Other name…'}]}/>
            </div>
            {customName && (
              <label className="wz-row" data-ico="1">
                <span className="wz-ico"><WzSvg name="pen"/></span>
                <span className="wz-row-title wz-grow">Name</span>
                <input className="wz-input wz-input-end" data-align="end" value={draft.stockLabel || ''} maxLength={40} autoFocus
                  placeholder="e.g. Seat number" onChange={e => upd('stockLabel', e.target.value)}/>
              </label>
            )}
            <div className="wz-row" data-ico="1">
              <span className="wz-ico"><WzSvg name="box"/></span>
              <span className="wz-row-title wz-grow">When it runs out</span>
              <WzSelect label="When it runs out" icon={null} value={hold ? 'hold' : 'hide'} onChange={v => upd('stockWhenEmpty', v)}
                options={[{value: 'hide', label: 'Show as sold out'}, {value: 'hold', label: 'Keep selling'}]}/>
            </div>
          </>)}
        </div>
        {unsaved && <div className="wz-note" data-warn="1">{on ? 'Save changes to start handing these out.' : 'Save changes to stop. The list is kept.'}</div>}
        {!unsaved && !on && <div className="wz-note">Paste keys, codes or logins. Each buyer gets the next one.</div>}
      </div>

      {on && loadErr && <div className="sl-alert" data-tone="danger"><span>{loadErr}</span></div>}

      {/* Customers who paid while it was sold out */}
      {on && !pending && waiting > 0 && (
        <div className="wz-group stk-wait">
          <div className="wz-row" data-ico="1" data-tone="warn">
            <span className="wz-ico"><WzSvg name="clock"/></span>
            <span className="wz-row-txt wz-grow">
              <span className="wz-row-title">{c.owed > 0 ? `${plural(c.owed, 'customer')} waiting` : `${plural(c.unsent, lower)} not sent yet`}</span>
              <span className="wz-row-hint">{c.owed > 0 && !c.available ? `Paid while sold out. Add ${lower}s to send theirs.` : 'Paid while sold out'}</span>
            </span>
            <button type="button" className="stk-go" onClick={sendWaiting} disabled={!!busy || (!c.available && !c.unsent)}>
              {busy === 'send' ? 'Sending…' : 'Send now'}
            </button>
          </div>
          {manual.map(s => (
            <div key={s.id} className="wz-row" data-ico="1">
              <span className="wz-ico"><WzSvg name="person"/></span>
              <span className="wz-row-txt wz-grow">
                <span className="wz-row-title">{s.customer || 'Customer'}</span>
                <span className="wz-row-hint">Can’t message this chat from here. Copy it across, then mark it sent.</span>
              </span>
              <StockCopyBtn text={s.text || s.item}/>
              <button type="button" className="stk-ib" aria-label="Mark sent" title="Mark sent" onClick={() => markManualSent(s)}><WzSvg name="check" size={13}/></button>
            </div>
          ))}
        </div>
      )}

      {/* Add */}
      {on && (
        <div className="wz-sec">
          <div className="wz-cap">
            <span>Add {lower}s</span>
            {skipNote && <span className="stk-cap-end"><small className="stk-cap-warn" title={skipNote}>{skipNote}</small></span>}
          </div>
          <div className="wz-group" data-field="1">
            <textarea ref={taRef} className="wz-textarea stk-ta" value={text} spellCheck={false} aria-label={`Add ${lower}s`}
              onChange={e => onPaste(e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); add(); } }}
              placeholder={mode === 'block'
                ? 'user: alex@example.com\npassword: hunter2\n\nuser: sam@example.com\npassword: letmein'
                : 'AAAA-BBBB-CCCC-DDDD\nEEEE-FFFF-GGGG-HHHH'}/>
            <div className="stk-addbar">
              <WzSeg label="How they are separated" value={mode} onChange={v => { setMode(v); setModeTouched(true); }}
                options={[{value: 'line', label: 'One per line'}, {value: 'block', label: 'Empty line between'}]}/>
              <button type="button" className="stk-go" onClick={add} disabled={!check.fresh || !!busy}
                title={check.fresh ? `Add ${plural(check.fresh, lower)} (Ctrl+Enter)` : undefined}>
                <WzSvg name="plus" size={11} stroke={2.6}/>
                <span>{busy === 'add' ? 'Adding…' : check.fresh ? `Add ${check.fresh.toLocaleString()}` : 'Add'}</span>
              </button>
            </div>
          </div>
          {/* Says in plain words how the box is being read, right where it matters. */}
          <div className="wz-note">
            {mode === 'block'
              ? <>A {lower} can run over several lines. <b className="stk-em">Leave an empty line</b> between one {lower} and the next.</>
              : <>Each line is one {lower}. For {lower}s that run over several lines, like logins, pick <b className="stk-em">Empty line between</b>.</>}
          </div>
        </div>
      )}

      {/* The list */}
      {on && (
        <div className="wz-sec">
          <div className="wz-cap">
            <span>{pending ? 'Ready to hand out' : 'Your list'}</span>
            {(listNote || canClear) && (
              <span className="stk-cap-end">
                {listNote && <small className={!c.available ? 'stk-cap-warn' : undefined}>{listNote}</small>}
                {canClear && (
                  <button type="button" className="wz-link" disabled={!!busy} title={`Remove all ${plural(c.available, lower)}`} onClick={() => {
                    if (window.confirm(`Remove all ${plural(c.available, lower)} nobody has received yet?${pending ? '' : '\n\nOnes already given out stay on record.'}`)) removeIds([], true);
                  }}>Remove all</button>
                )}
              </span>
            )}
          </div>
          {showFilter && (
            <div className="stk-filter">
              <WzSeg label="Show" value={filter} onChange={setFilter} options={[
                {value: 'available', label: segLabel('Left', c.available)},
                {value: 'given', label: segLabel('Given out', c.given)},
                ...(c.owed ? [{value: 'owed', label: segLabel('Waiting', c.owed)}] : []),
              ]}/>
            </div>
          )}
          {(pending ? c.available : total) > 8 && (
            <div className="wz-group stk-tools" data-field="1">
              <label className="wz-row" data-ico="1">
                <span className="wz-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span>
                <input className="wz-input" value={q} onChange={e => setQ(e.target.value)} spellCheck={false}
                  onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }}
                  placeholder={view === 'given' ? 'Find a code or customer' : `Find a ${lower}`}/>
                {q && <span className="stk-hits">{rows.length.toLocaleString()} found</span>}
                <span className="stk-tools-acts">
                  <button type="button" className="stk-ib" aria-label="Copy all shown" title={`Copy all ${rows.length.toLocaleString()}`}
                    onClick={() => exportRows('copy')} disabled={!rows.length}><WzSvg name="paste" size={13}/></button>
                  <button type="button" className="stk-ib" aria-label="Download as CSV" title="Download as CSV"
                    onClick={() => exportRows('csv')} disabled={!rows.length}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
                  </button>
                </span>
              </label>
            </div>
          )}
          <div className="wz-group stk-list" style={{'--stk-idx': idxW + 'px'}}>
            {items === null && !pending ? <div className="stk-empty">Loading…</div>
              : rows.length === 0 ? (
                <div className="stk-empty">{q ? 'Nothing matches.'
                  : view === 'given' ? 'None given out yet. Each one shows here with who got it.'
                  : view === 'owed' ? 'Nobody is waiting.'
                  : `No ${lower}s yet. Paste some above.`}</div>
              ) : shown.map((it, i) => {
                const who = [it.customer, it.handle && it.handle !== it.customer ? it.handle : ''].filter(Boolean).join(' ');
                const meta = pending || it.status === 'available' ? ''
                  : [who || 'Customer', it.at ? bcWhen(it.at) : '', it.unsent ? 'not sent yet' : ''].filter(Boolean).join(' · ');
                const str = String(it.item == null ? '' : it.item);
                const lines = it.status === 'owed' ? 1 : str.split('\n').length;
                const extra = lines > 2 ? lines - 2 : 0;
                const open = extra > 0 && openRow === it.id;
                return (
                  <div key={it.id} className="wz-row" data-k={it.status}
                    title={!pending && it.status === 'available' && it.added ? `Added ${bcWhen(it.added, false)}` : undefined}>
                    <span className="stk-idx">{(i + 1).toLocaleString()}</span>
                    <span className="wz-row-txt wz-grow">
                      <span className="stk-item" data-open={open ? '1' : undefined}
                        title={!extra && str.length > 48 ? str : undefined}>
                        {it.status === 'owed' ? `Waiting for a ${lower}` : str}
                      </span>
                      {extra > 0 && (
                        <button type="button" className="stk-expand" aria-expanded={open}
                          onClick={() => setOpenRow(open ? null : it.id)}>
                          {open ? 'Show less' : `${extra} more line${extra === 1 ? '' : 's'}`}
                        </button>
                      )}
                      {meta && <span className="wz-row-hint">{meta}</span>}
                    </span>
                    {it.status !== 'owed' && (
                      <span className="stk-act">
                        <StockCopyBtn text={str}/>
                        {it.status === 'available' && (
                          <button type="button" className="stk-ib" data-tone="danger" aria-label="Remove" title="Remove"
                            onClick={() => removeIds([it.id])} disabled={!!busy}><WzSvg name="x" size={12} stroke={2.2}/></button>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            {rest > 0 && (
              <div className="wz-row stk-more">
                <button type="button" className="wz-link" onClick={() => setLimit(l => l + STOCK_PAGE)}>Show {Math.min(rest, STOCK_PAGE).toLocaleString()} more</button>
                {rest > STOCK_PAGE && rows.length <= 5000 && <>
                  <span className="stk-dot" aria-hidden="true">·</span>
                  <button type="button" className="wz-link" onClick={() => setLimit(rows.length)}>Show all {rows.length.toLocaleString()}</button>
                </>}
              </div>
            )}
          </div>
        </div>
      )}

      {on && <div className="wz-note stk-tip">Put <code>{'{ITEM}'}</code> in the message to the buyer to place it there; otherwise it goes on its own line.</div>}
    </div>
  );
};

// ── New product / package / add-on wizard ─────────────────────────
// What a sale needs first comes first: name and picture, then the price,
// then (for a package) what it includes, then the description, checkout
// options, what the buyer receives, any setup you do by hand, and a
// review with the switch that puts it on offer.
const ProductWizard = ({draft, upd, onSave, onBack, allProducts, togProduct}) => {
  const [step, setStep] = React.useState(0);
  const [imgBusy, setImgBusy] = React.useState(false);
  const [manual, setManual] = React.useState(() => ((draft.manualTasks || []).length ? 'yes' : null));
  const t = (TYPE_LABEL[draft.type] || 'Product').toLowerCase();
  const isPkg = draft.type === 'pkg';
  const name = String(draft.name || '').trim();
  const priceSet = !!String(draft.price || '').trim();
  const picked = draft.products || [];
  const media = draft.media || [];
  const tasks = draft.manualTasks || [];
  const img = String(draft.img || '');
  const curCode = draft.priceCurrency || 'USD';
  const curMeta = FIAT_BY_CODE[curCode];
  const sym = curMeta ? curMeta.symbol : curCode;
  const priceText = priceSet ? (fmtProdPrice(draft) || String(draft.price)) : '';
  const descSet = !!String(draft.desc || '').trim();
  const featsSet = (draft.feats || []).length > 0;
  const shows = media.filter(m => m && m.showcase);
  const buyerFiles = media.filter(m => m && !m.showcase);
  const photoCount = (img ? 1 : 0) + shows.length;
  const msgText = String(draft.postPaymentText || '');
  const msgLinks = (msgText.match(/https?:\/\/[^\s<>()'"]+/gi) || []).length;

  const STEPS = [
    {id:'basics', icon:'box', title:`Name your ${t}`, sub:'Shown to customers and your agents.',
      need: !!name, needMsg: 'Enter a name'},
    {id:'photos', icon:'image', title:'Photos and videos', sub:'What customers see before they buy.',
      optional: true, filled: photoCount > 0, need: imgBusy ? false : undefined, needMsg: 'Still adding…'},
    {id:'price', icon:'tag', title:'Price', sub:'What the customer pays and how often.',
      need: priceSet, needMsg:'Enter a price'},
    ...(isPkg ? [{id:'bundle', icon:'stack', title:'Included products', sub:'Delivered together with this package.',
      optional: true, filled: picked.length > 0}] : []),
    {id:'describe', icon:'text', title:'Description', sub:'Your agent quotes this word for word.',
      optional: true, filled: descSet || featsSet},
    {id:'checkout', icon:'cart', title:'Checkout', sub:'Extras handled during the sale.'},
    {id:'stock', icon:'ticket', title:'Keys and codes', sub:'Hand out one from your own list with each sale.',
      optional: true, filled: !!draft.stockMode && (draft.stockPending || []).length > 0,
},
    {id:'delivery', icon:'send', title:'After payment', sub:'Sent to the buyer once payment clears.',
      optional: true, filled: !!msgText.trim() || buyerFiles.length > 0},
    {id:'manual', icon:'wrench', title:'Manual setup', sub:'Anything you do by hand after a sale?',
      need: manual === 'no' || (manual === 'yes' && tasks.length > 0),
      needMsg: manual === 'yes' ? 'Add at least one step' : 'Choose an option'},
    {id:'review', icon:'check', title:'Review', sub:'Select any item to change it.'},
  ];
  const at = (id) => STEPS.findIndex(x => x.id === id);

  const chooseManual = (v) => {
    setManual(v);
    if (v === 'no') upd('manualTasks', []);
  };

  const render = (cur, go) => {
    switch (cur.id) {
      case 'basics': return (
        <div className="wz-group" data-field="1">
          <label className="wz-row">
            <span className="wz-row-label">Name</span>
            <input className="wz-input" data-wz-focus value={draft.name || ''} onChange={e => upd('name', e.target.value)}
              placeholder={isPkg ? 'Pro package' : draft.type === 'add' ? 'Priority support' : 'Pro plan'}/>
          </label>
        </div>
      );

      case 'photos': return <WzGallery draft={draft} upd={upd} onBusy={setImgBusy}/>;

      case 'price': return (<>
        <div className="wz-group" data-field="1">
          <div className="wz-amount" onClick={e => { const i = e.currentTarget.querySelector('input'); if (i && e.target !== i) i.focus(); }}>
            <span className="wz-amount-sym">{sym}</span>
            <input data-wz-focus inputMode="decimal" value={draft.price || ''} placeholder="0"
              aria-label="Price" onChange={e => upd('price', e.target.value)}
              style={{width: `${Math.max(2, String(draft.price || '').length || 1) + 0.6}ch`}}/>
          </div>
          <div className="wz-amount-seg">
            <WzSeg label="Billing" value={draft.billing || 'monthly'} onChange={v => upd('billing', v)}
              options={[{value:'one-time',label:'Once'},{value:'monthly',label:'Monthly'},{value:'yearly',label:'Yearly'},{value:'custom',label:'Custom'}]}/>
          </div>
        </div>
        <WzSec cap="Currency, stock, end date" icon="sliders" collapse="wz.prod.more"
          summary={[curCode, draft.stock && draft.stock !== '∞' ? `${draft.stock} in stock` : '∞ stock', draft.expiry ? `ends ${draft.expiry}` : null].filter(Boolean).join(' · ')}>
          <label className="wz-row" data-ico="1">
            <span className="wz-ico"><CurrencyGlyph code={curCode}/></span>
            <span className="wz-row-title wz-grow">Currency</span>
            <WzSelect label="Currency" icon={null} value={curCode} onChange={v => upd('priceCurrency', v)}
              options={[
                ...FIAT_CURRENCIES.map(f => ({value: f.code, label: `${f.symbol} ${f.code}`, group: 'Currencies'})),
                ...CRYPTAPI_COINS.map(c => ({value: c.ticker, label: cryptoLabel(c.ticker), group: 'Crypto'})),
              ]}/>
          </label>
          <label className="wz-row" data-ico="1">
            <span className="wz-ico"><WzSvg name="box"/></span>
            <span className="wz-row-title wz-grow">Stock</span>
            <input className="wz-input wz-input-end" data-align="end" inputMode="numeric" value={draft.stock === '∞' ? '' : (draft.stock || '')}
              onChange={e => upd('stock', e.target.value.trim() === '' ? '∞' : e.target.value)} placeholder="Unlimited"/>
          </label>
          <label className="wz-row" data-ico="1">
            <span className="wz-ico"><WzSvg name="calendar"/></span>
            <span className="wz-row-title wz-grow">Offer ends</span>
            <input className="wz-input wz-input-end" type="date" value={draft.expiry || ''} onChange={e => upd('expiry', e.target.value)}/>
          </label>
        </WzSec>
      </>);

      case 'bundle': return (
        <WzSec bare aside={allProducts.length ? <small>{picked.length} of {allProducts.length}</small> : null} cap={allProducts.length ? 'Products' : null}>
          <ProdBundlePicker allProducts={allProducts} picked={picked} togProduct={togProduct} draft={draft} hideValue/>
        </WzSec>
      );

      case 'describe': return (<>
        <div className="wz-group" data-field="1">
          <textarea className="wz-textarea" data-wz-focus value={draft.desc || ''} onChange={e => upd('desc', e.target.value)}
            placeholder="What the customer gets, in the words your agent should use."/>
        </div>
        <WzSec cap="Features" icon="list" collapse="wz.prod.feats" summary={(draft.feats || []).length ? `${draft.feats.length} added` : 'Optional'} bare>
          <ProdFeatures items={draft.feats || []} onChange={feats => upd('feats', feats)}/>
        </WzSec>
      </>);

      case 'checkout': return (
        <WzTiles multi label="Checkout options" options={[
          {icon:'user',     label:'Username',     hint:'Ask for a login',     on: !!draft.allowUsername,        onChange: v => upd('allowUsername', v)},
          {icon:'key',      label:'Serial key',   hint: draft.stockMode ? 'From your list' : 'One per purchase',    on: !!draft.allowSerial,          onChange: v => upd('allowSerial', v)},
          {icon:'userplus', label:'Account help', hint:'Guide sign-up',       on: !!draft.allowAccountCreation, onChange: v => upd('allowAccountCreation', v)},
          {icon:'refund',   label:'Refundable',   hint: draft.allowRefund === true ? 'Asks why, then to you' : 'Sales are final', on: draft.allowRefund === true, onChange: v => upd('allowRefund', v)},
        ]}/>
      );

      case 'stock': return <StockEditor draft={draft} upd={upd} pending/>;

      case 'delivery': return (<>
        <WzSec bare cap="Message to the buyer">
          <PostPaymentEditor value={msgText} onChange={v => upd('postPaymentText', v)}
            hasPaidMedia={buyerFiles.length > 0} allowSerial={!!draft.allowSerial} stockMode={!!draft.stockMode}/>
          {msgLinks > 0 && <DeliveryLinksEditor text={msgText} onChange={v => upd('postPaymentText', v)}/>}
        </WzSec>
        <WzSec bare cap="Files for the buyer" aside={buyerFiles.length ? <small>{buyerFiles.length}</small> : null}>
          <BuyerFiles media={media} onChange={m => upd('media', m)}/>
        </WzSec>
      </>);

      case 'manual': return (<>
        <WzTiles label="Manual setup" value={manual} onChange={chooseManual} options={[
          {value:'no',  icon:'bolt',   label:'Automatic', hint:'Nothing to do by hand'},
          {value:'yes', icon:'wrench', label:'By hand',   hint:'I finish the setup'},
        ]}/>
        {manual === 'yes' && (
          <WzSec bare cap="Your steps">
            <ManualSetupEditor value={tasks} onChange={v => upd('manualTasks', v)} feats={draft.feats || []}/>
          </WzSec>
        )}
      </>);

      case 'review': {
        const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
        const checkout = [
          draft.allowUsername && 'Username',
          draft.allowSerial && 'Serial',
          draft.allowAccountCreation && 'Account',
          draft.allowRefund === true && 'Refundable',
        ].filter(Boolean).join(', ');
        const after = [
          msgText.trim() ? 'Message' : '',
          buyerFiles.length ? plural(buyerFiles.length, 'file') : '',
        ].filter(Boolean).join(' + ');
        const per = PROD_BILLING[draft.billing || 'monthly'];
        const limited = draft.stock && draft.stock !== '∞';
        const items = [
            {icon:'box',    k:'Name',   v: name || `Untitled ${t}`, step: at('basics')},
            {icon:'image',  k:'Photos', v: photoCount ? `${photoCount} shown on request` : 'None', dim: !photoCount, step: at('photos')},
            {icon:'tag',    k:'Price',  v: priceText ? [priceText, per, limited ? `${draft.stock} left` : ''].filter(Boolean).join(' · ') : '—', dim: !priceText, step: at('price')},
            isPkg && {icon:'stack', k:'Includes', v: picked.length ? plural(picked.length, 'product') : 'Nothing', dim: !picked.length, step: at('bundle')},
            {icon:'text',   k:'Description', v: descSet ? plural((draft.desc || '').length, 'char') : 'None', dim: !descSet, step: at('describe')},
            {icon:'cart',   k:'Checkout', v: checkout || 'Standard', dim: !checkout, step: at('checkout')},
            {icon:'ticket', k:'Keys and codes', v: draft.stockMode ? `${(draft.stockPending || []).length.toLocaleString()} ready` : 'Off', dim: !draft.stockMode, step: at('stock')},
            {icon:'send',   k:'After payment', v: after || 'Nothing', dim: !after, step: at('delivery')},
            {icon:'wrench', k:'Setup', v: tasks.length ? plural(tasks.length, 'step') : 'Automatic', dim: !tasks.length, step: at('manual')},
        ].filter(Boolean);
        // Keep the grid even: an odd count gets the offer end date.
        if (items.length % 2) items.push({icon:'calendar', k:'Offer ends', v: draft.expiry ? bcWhen(draft.expiry, false) : 'Never', dim: !draft.expiry, step: at('price')});
        return (
          <WzReview go={go} items={items}
            live={{icon:'eye', title:'Offer to customers now', on: draft.enabledForAi !== false, onChange: v => upd('enabledForAi', v)}}/>
        );
      }
      default: return null;
    }
  };

  return (
    <SetupWizard label={`New ${t}`} steps={STEPS} step={step} onStep={setStep}
      onCancel={onBack} onFinish={onSave} finishLabel={`Create ${t}`} busyLabel="Creating…"
      render={render}/>
  );
};

// Model catalog from the server (get_llm_models), fetched once and shared.
// It also says whether the built-in AI (the site's own key, set up by the
// administrator) can be chosen, and its model; refresh() re-reads it when
// the Connections page opens, since the administrator can switch it.
const LLM_CATALOG = {
  v: null, p: null, subs: new Set(),
  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  load(force) {
    if (this.v && !force) return Promise.resolve(this.v);
    if (!this.p) {
      this.p = apiFetch('get_llm_models', {})
        .then(r => { this.p = null; if (r && !r.error) { this.v = r; this.subs.forEach(fn => { try { fn(r); } catch (_) {} }); } return this.v; })
        .catch(() => { this.p = null; return this.v; });
    }
    return this.p;
  },
  refresh() { return this.load(true); },
};
// The built-in AI when it can be chosen: {provider, model, label}, else null.
const llmBuiltin = (cat) => {
  const b = cat && cat.builtin;
  return b && b.available ? b : null;
};
// The catalog, kept current (re-renders when it's refreshed).
const useLlmCatalog = (refresh) => {
  const [cat, setCat] = React.useState(LLM_CATALOG.v);
  React.useEffect(() => {
    let dead = false;
    const off = LLM_CATALOG.sub(v => { if (!dead) setCat(v); });
    (refresh ? LLM_CATALOG.refresh() : LLM_CATALOG.load()).then(v => { if (!dead && v) setCat(v); });
    return () => { dead = true; off(); };
  }, []);
  return cat;
};
// Models the operator can actually use: only providers with an API key
// saved, the active provider first. Labels and notes come from the server
// catalog; until it arrives, the agent editor's own list stands in.
const useAvailableModels = (fallbackModels) => {
  const creds = useCreds();
  const cat = useLlmCatalog();
  const vals = creds.values || {};
  const active = vals.llm_active || '';
  const keyed = LLM_PROVIDERS.filter(p => vals['llm_' + p.id])
    .sort((a, b) => (b.id === active) - (a.id === active));
  const options = [];
  // On the built-in AI every agent runs the model the site set, whatever
  // the agent says — so that one model is what there is to choose.
  const bi = active === 'builtin' ? llmBuiltin(cat) : null;
  if (bi) {
    const pv = LLM_PROVIDERS.find(p => p.id === bi.provider);
    options.push({value: bi.model, label: `${bi.label || bi.model}  (built-in AI)`, short: bi.label || bi.model,
      group: 'Built-in AI', provider: bi.provider});
    const providers = pv ? [{...pv, label: 'Built-in AI', full: 'Built-in AI'}] : [];
    return {loaded: !!creds.loaded, options, preferred: bi.model, providers, builtin: true};
  }
  keyed.forEach(p => {
    const list = cat && cat.catalog && Array.isArray(cat.catalog[p.id]) && cat.catalog[p.id].length
      ? cat.catalog[p.id]
      : (fallbackModels || []).filter(m => MODEL_PROVIDER(m) === p.id).map(m => ({id: m, label: m}));
    list.forEach(m => {
      const note = m.note ? String(m.note).split('·')[0].trim() : '';
      options.push({value: m.id, label: note ? `${m.label || m.id}  (${note})` : (m.label || m.id), short: m.label || m.id,
        group: p.full || p.label, provider: p.id});
    });
  });
  const preferred = (() => {
    const pid = keyed.length ? keyed[0].id : '';
    const want = cat && pid ? ((cat.selected || {})[pid] || (cat.defaults || {})[pid]) : '';
    return options.some(o => o.value === want) ? want : (options[0] ? options[0].value : '');
  })();
  return {loaded: !!creds.loaded, options, preferred, providers: keyed};
};

// ── New agent wizard ──────────────────────────────────────────────
// Same shell as the product wizard. Order follows what a new agent needs
// first: a name and a model, what it is for (selling from the catalogue
// or something else), its instructions, where it answers, how it
// introduces itself, how it sounds, how it behaves in a chat, when it is
// on, then the review. Timing details keep their natural defaults and
// are tuned later from the Realism tab.
const AgentWizard = ({draft, update, models, tg, dc, onFinish, onCancel}) => {
  const [step, setStep] = React.useState(0);
  const [hoursOpen, setHoursOpen] = React.useState(false);
  const name = String(draft.name || '').trim();
  const persona = String(draft.persona || '');
  const sells = draft.sellCatalog !== false;
  const tgName = (tg && tg.connected) ? (tg.botName || (tg.username || '').replace(/^@/, '')) : '';
  const dcName = (dc && dc.connected) ? (dc.botName || (dc.username || '').replace(/^@/, '')) : '';
  const accounts = [tgName, dcName].filter(Boolean);
  const isSelf = (draft.identityMode || 'agent') === 'self';
  const shownName = isSelf ? ((draft.selfName || '').trim() || accounts.join(', ')) : name;
  const anyPlace = !!(draft.replyPrivate || draft.replyGroups || draft.replyChannels || draft._dmAuto);
  const inGroups = !!(draft.replyGroups || draft.replyChannels);
  const sch = SCHEDULE_GATE.normalize(draft.schedule);
  // BotCommand direct messages: only offered to a signed-in account.
  if (typeof useDmAi === 'function') useDmAi();
  const dmOk = typeof DM_KEYS !== 'undefined' && !!DM_KEYS.acc && typeof DM_AI !== 'undefined';
  const dmOther = dmOk && DM_AI.auto ? DM_AI.agentById(DM_AI.auto) : null;

  const avail = useAvailableModels(models);
  const modelOpts = avail.options;
  const noModels = avail.loaded && modelOpts.length === 0;
  // Start on a model that is actually available (the provider's chosen or
  // default model), and move off one whose key has since been removed.
  const optsKey = modelOpts.map(o => o.value).join('|');
  React.useEffect(() => {
    if (!modelOpts.length) return;
    if (!modelOpts.some(o => o.value === draft.model)) update('model', avail.preferred);
    // eslint-disable-next-line
  }, [optsKey]);
  const curModel = modelOpts.find(o => o.value === draft.model);
  const openAiSettings = () => { try { window.dispatchEvent(new CustomEvent('sset:open', {detail: 'llm'})); } catch (_) {} };
  const SPEEDS = [{value: 45, label: 'Relaxed'}, {value: 75, label: 'Average'}, {value: 110, label: 'Quick'}];
  const speed = SPEEDS.reduce((b, s) => Math.abs(s.value - (draft.wpm || 75)) < Math.abs(b.value - (draft.wpm || 75)) ? s : b, SPEEDS[1]).value;
  const HANDOVER = [
    {value:'Never', label:'Never'},
    {value:'3 failures', label:'After 3 misses', short:'3 misses'},
    {value:'5 failures', label:'After 5 misses', short:'5 misses'},
    {value:'On request', label:'When asked'},
  ];
  const STYLE_ICON = {human:'person', pro:'badge', casual:'smile', expert:'wrench', concise:'text'};
  const FEEL_HINT = {instant:'No delay', balanced:'Short pauses', human:'Types like a person'};

  // Selling agents need no extra step; the choice itself is step two.
  const chooseSells = (v) => {
    update('sellCatalog', v);
    if (!v) update('stopAfterSale', false);
  };

  const STEPS = [
    {id:'name', icon:'robot', title:'Name & model', sub:'How you will recognise it, and the AI it runs on.',
      need: !!name && !noModels && !!curModel,
      needMsg: noModels ? 'Add an AI provider key first' : !name ? 'Enter a name' : 'Choose a model'},
    {id:'purpose', icon:'store', title:'What is it for?', sub:'You can change this later.'},
    {id:'instructions', icon:'doc', title:'Instructions', sub:'Brief it like a new colleague.',
      optional: true, filled: !!persona.trim()},
    {id:'where', icon:'globe', title:'Where it replies', sub:'The chats it answers in.',
      need: anyPlace, needMsg:'Turn on at least one'},
    {id:'identity', icon:'badge', title:'Identity', sub:'The name customers see.',
      need: isSelf && !shownName ? false : undefined, needMsg:'Connect a platform or enter a name'},
    {id:'voice', icon:'wave', title:'Voice', sub:'Writing style and tone.'},
    {id:'replies', icon:'bubble', title:'In a chat', sub:'Timing, hand-over and follow-ups.'},
    {id:'hours', icon:'clock', title:'Reply hours', sub:'Leave off to reply at any time.',
      optional: true, filled: !!sch.enabled},
    {id:'review', icon:'check', title:'Review', sub:'Select any item to change it.'},
  ];
  const at = (id) => STEPS.findIndex(x => x.id === id);

  const render = (cur, go) => {
    switch (cur.id) {
      case 'name': {
        const prov = curModel ? avail.providers.find(p => p.id === curModel.provider) : null;
        return (
          <WzSec note={noModels
            ? <>No AI provider yet. <button type="button" className="wz-link" onClick={openAiSettings}>Add an API key</button></>
            : null}>
            <label className="wz-row">
              <span className="wz-row-label">Name</span>
              <input className="wz-input" data-wz-focus value={draft.name || ''} onChange={e => update('name', e.target.value)}
                placeholder="Support agent"/>
            </label>
            <label className="wz-row" aria-disabled={noModels ? 'true' : undefined}>
              <span className="wz-row-label">Model</span>
              {noModels
                ? <span className="wz-row-val" data-dim="1" style={{marginLeft: 0}}>None available</span>
                : modelOpts.length
                  ? <WzSelect align="start" label="Model" icon={draft.model ? <ModelIcon id={draft.model} s={13}/> : 'chip'} value={curModel ? draft.model : ''} onChange={v => update('model', v)} options={modelOpts}
                      hint={prov ? prov.label : ''}/>
                  : <span className="wz-row-val" data-dim="1" style={{marginLeft: 0}}>Loading…</span>}
            </label>
          </WzSec>
        );
      }

      case 'purpose': return (<>
        <WzTiles label="What the agent is for" value={sells} onChange={chooseSells} options={[
          {value: true,  icon:'store',    label:'Sells',        hint:'Catalog, prices, invoices'},
          {value: false, icon:'lifebuoy', label:'Doesn’t sell', hint:'Support, community, info'},
        ]}/>
        {!sells && <div className="wz-note">It won’t mention products or prices, or take payments.</div>}
      </>);

      case 'instructions': return (
        <WzSec field
          aside={persona.length > 3000 ? <small style={{color: persona.length > 3800 ? 'rgb(240,130,124)' : undefined}}>{persona.length.toLocaleString()}</small> : null}>
          <textarea className="wz-textarea" data-wz-focus value={persona} onChange={e => update('persona', e.target.value)}
            placeholder={sells
              ? 'You’re the friendly sales assistant for Acme.\nKeep replies short.\nSend billing questions to a person.'
              : 'You’re the support assistant for Acme.\nAnswer from the FAQ, keep it short.\nPass anything urgent to a person.'}/>
        </WzSec>
      );

      case 'where': return (<>
        <WzTiles multi layout="stack" cols={3} label="Where it replies" options={[
          {icon:'bubble', label:'Direct',   on: !!draft.replyPrivate,  onChange: v => update('replyPrivate', v), title:'One-to-one Telegram and Discord chats'},
          {icon:'users',  label:'Groups',   on: !!draft.replyGroups,   onChange: v => update('replyGroups', v), title:'Telegram groups and Discord servers'},
          {icon:'hash',   label:'Channels', on: !!draft.replyChannels, onChange: v => update('replyChannels', v), title:'Telegram channels'},
        ]}/>
        <div className="wz-group">
          <WzSwitchRow icon="at" title="Only when mentioned" hint={inGroups ? 'In groups and channels' : 'Needs groups or channels'}
            disabled={!inGroups} on={!!draft.replyOnlyIfMentioned} onChange={v => update('replyOnlyIfMentioned', v)}/>
          {dmOk && (
            <WzSwitchRow icon="send" title="Profile DMs"
              hint={dmOther ? `Now answered by ${dmOther.name}` : 'From your profile link'}
              on={!!draft._dmAuto} onChange={v => update('_dmAuto', v)}/>
          )}
        </div>
      </>);

      case 'identity': return (<>
        <WzTiles label="Reply as" value={isSelf ? 'self' : 'agent'} onChange={v => update('identityMode', v)} options={[
          {value:'agent', icon:'robot',  label:'Agent name', hint: name || 'The name you chose'},
          {value:'self',  icon:'person', label:'My account', hint: accounts.length ? accounts.join(', ') : 'Telegram or Discord'},
        ]}/>
        <div className="wz-group" data-field={isSelf ? '1' : undefined}>
          {isSelf && (
            <label className="wz-row">
              <span className="wz-row-label">Show as</span>
              <input className="wz-input" data-wz-focus value={draft.selfName || ''} maxLength={200}
                onChange={e => update('selfName', e.target.value)} placeholder={accounts[0] ? `${accounts[0]} (default)` : 'Your name'}/>
            </label>
          )}
          <WzSwitchRow icon="robot" title="Can say it’s an AI" hint="Only when someone asks" on={!!draft.revealAi} onChange={v => update('revealAi', v)}/>
        </div>
      </>);

      case 'voice': return (<>
        <div className="wz-group">
          <label className="wz-row" data-ico="1">
            <span className="wz-ico"><WzSvg name={STYLE_ICON[draft.style] || 'pen'}/></span>
            <span className="wz-row-title wz-grow">Style</span>
            <WzSelect label="Style" icon={null} value={draft.style} onChange={v => update('style', v)}
              options={RESPONSE_STYLES.map(s => ({value: s.id, label: `${s.label} — ${s.desc}`, short: s.label}))}/>
          </label>
          <div className="wz-row" data-ico="1">
            <span className="wz-ico"><WzSvg name="clock"/></span>
            <span className="wz-row-title wz-grow">Typing</span>
            <span className="wz-row-seg"><WzSeg label="Typing speed" value={speed} onChange={v => update('wpm', v)} options={SPEEDS}/></span>
          </div>
          <label className="wz-row" data-ico="1">
            <span className="wz-ico"><WzSvg name="bubble"/></span>
            <span className="wz-row-title wz-grow">Tone</span>
            <WzSelect label="Tone" icon={null} value={draft.tone} onChange={v => update('tone', v)}
              options={TONES.map(x => ({value: x, label: x}))}/>
          </label>
          <WzSwitchRow icon="smile" title="Emoji" on={!!draft.emoji} onChange={v => update('emoji', v)}/>
        </div>
      </>);

      case 'replies': return (<>
        <WzTiles label="Reply feel" layout="stack" cols={3} value={agxFeelOf(draft) || ''}
          onChange={id => { const f = AGX_FEEL.find(x => x.id === id); if (f) Object.keys(f.v).forEach(k => update(k, f.v[k])); }}
          options={AGX_FEEL.map(f => ({value: f.id, glyph: <WzBars n={f.bars} of={3}/>, label: f.name, hint: FEEL_HINT[f.id] || null}))}/>
        <div className="wz-group">
          <label className="wz-row" data-ico="1">
            <span className="wz-ico"><WzSvg name="hand"/></span>
            <span className="wz-row-title wz-grow">Hand over to you</span>
            <WzSelect label="Hand over to you" icon={null} value={draft.escalate} onChange={v => update('escalate', v)} options={HANDOVER}/>
          </label>
          <WzSwitchRow icon="megaphone" title="Message people first" on={!!draft.proactive} onChange={v => update('proactive', v)}/>
          {sells && (
            <WzSwitchRow icon="moon" title="Go quiet after a sale" on={!!draft.stopAfterSale} onChange={v => update('stopAfterSale', v)}/>
          )}
        </div>
        <WzSec cap="Follow-ups" icon="spark" collapse="wz.agent.follow"
          summary={!draft.allowScheduling ? 'Off' : draft.allowCustomerScheduling ? 'On · callbacks' : 'On'}>
          <WzSwitchRow icon="clock" title="Plan messages for later" hint="“Remind Marco in 10 minutes”"
            on={!!draft.allowScheduling}
            onChange={v => { update('allowScheduling', v); if (!v) update('allowCustomerScheduling', false); }}/>
          <WzSwitchRow icon="users" title="Customers book callbacks" hint="“Message me tomorrow at 6”"
            disabled={!draft.allowScheduling}
            on={!!draft.allowScheduling && !!draft.allowCustomerScheduling} onChange={v => update('allowCustomerScheduling', v)}/>
        </WzSec>
      </>);

      case 'hours': return (
        <WzSec bare>
          <AgentReplyHours draft={draft} update={update} agentKey="new" open={hoursOpen} setOpen={setHoursOpen}/>
        </WzSec>
      );

      case 'review': {
        const styleLabel = (RESPONSE_STYLES.find(s => s.id === draft.style) || {}).label || draft.style;
        const feelLabel = (AGX_FEEL.find(f => f.id === agxFeelOf(draft)) || {}).name || 'Custom';
        const where = [draft.replyPrivate && 'Direct', draft.replyGroups && 'Groups', draft.replyChannels && 'Channels', draft._dmAuto && 'Profile DMs'].filter(Boolean).join(', ');
        const follow = [draft.allowScheduling && 'Follow-ups', draft.allowCustomerScheduling && 'Callbacks'].filter(Boolean).join(', ');
        return (
          <WzReview go={go} items={[
            {icon:'robot',  k:'Model',        v: curModel ? curModel.short : (draft.model || '—'), step: at('name')},
            {icon: sells ? 'store' : 'lifebuoy', k:'Purpose', v: sells ? 'Sells from catalog' : 'Doesn’t sell', step: at('purpose')},
            {icon:'doc',    k:'Instructions', v: persona.trim() ? `${persona.length.toLocaleString()} chars` : 'None', dim: !persona.trim(), step: at('instructions')},
            {icon:'globe',  k:'Replies in',   v: where || 'Nowhere', dim: !where, step: at('where')},
            {icon:'badge',  k:'Shown as',     v: shownName || 'Account name', dim: !shownName, step: at('identity')},
            {icon:'wave',   k:'Voice',        v: `${styleLabel}, ${draft.tone}`, step: at('voice')},
            {icon:'bubble', k:'Feel',         v: feelLabel + (follow ? ` · ${follow}` : ''), step: at('replies')},
            {icon:'clock',  k:'Hours',        v: sch.enabled ? SCHEDULE_GATE.describe(sch) : 'Any time', dim: !sch.enabled, step: at('hours')},
          ]} live={{icon:'bolt', title:'Start replying now', on: !!draft.active, onChange: v => update('active', v)}}/>
        );
      }
      default: return null;
    }
  };

  return (
    <SetupWizard label="New agent" steps={STEPS} step={step} onStep={setStep}
      onCancel={onCancel} onFinish={onFinish} finishLabel="Create agent" busyLabel="Creating…"
      render={render}/>
  );
};

// ── Product editor (settings popup) ────────────────────────────────
// One page instead of five tabs: everything about a product, package or
// add-on in the order a sale uses it, built from the same parts as the
// setup wizard so the two feel like one product.
//   identity   name
//   price      amount + billing on one line, currency / stock / end date below
//   includes   (packages) the products delivered with it
//   details    description and features
//   checkout   four toggle tiles
//   delivery   message, files, links and manual setup as rows that open
//              in place, each showing what is set while closed
// Footer: availability (saved at once), delete, save.
const PeRow = ({icon, title, summary, set, open, onToggle, children}) => (
  <div className="pe-disc" data-open={open ? '1' : undefined}>
    <button type="button" className="wz-row" data-ico="1" aria-expanded={open} onClick={onToggle}>
      <span className="wz-ico"><WzSvg name={icon}/></span>
      <span className="wz-row-title wz-grow">{title}</span>
      <span className="pe-sum" data-set={set ? '1' : undefined}>{summary}</span>
      <FoldChev open={open}/>
    </button>
    {open && <div className="pe-panel">{children}</div>}
  </div>
);

const ProductEditor = (props) => {
  const {_embed, draft, upd, creating, selectedName, onSave, onDelete, onBack, allProducts, togProduct, onToggleEnabled} = props;
  const [imgBusy, setImgBusy] = React.useState(false);
  const [open, setOpen] = React.useState('');
  {
    const tl = TYPE_LABEL[draft.type] || 'Product';
    useSsetCrumb(_embed ? (draft.type === 'add' ? 'Add-ons' : tl + 's') : null,
      creating ? `New ${tl.toLowerCase()}` : (selectedName || draft.name || 'Untitled'), onBack);
  }
  if (!_embed) return <ProductEditorLegacy {...props}/>;
  // New items are created through a short guided wizard; this page is for
  // items that already exist.
  if (creating) return <ProductWizard {...props}/>;

  const typeLabel = TYPE_LABEL[draft.type] || 'Product';
  const t = typeLabel.toLowerCase();
  const isPkg = draft.type === 'pkg';
  const canSave = !!String(draft.name || '').trim();
  const media = draft.media || [];
  const paid = media.filter(m => m && !m.showcase).length;
  const photoCount = (draft.img ? 1 : 0) + media.filter(m => m && m.showcase).length;
  const picked = draft.products || [];
  const tasks = draft.manualTasks || [];
  const feats = draft.feats || [];
  const msg = String(draft.postPaymentText || '');
  const linkCount = (msg.match(/https?:\/\/[^\s<>()'"]+/gi) || []).length;
  const curCode = draft.priceCurrency || 'USD';
  const curMeta = FIAT_BY_CODE[curCode];
  const sym = curMeta ? curMeta.symbol : curCode;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const toggle = (id) => setOpen(o => (o === id ? '' : id));
  const aiOn = draft.enabledForAi !== false;
  const flipAi = () => { if (onToggleEnabled) onToggleEnabled(!aiOn); else upd('enabledForAi', !aiOn); };
  // Live counts come from the catalogue store (kept current by the stock
  // editor and by each sale), not the draft, which is only a snapshot.
  const liveRow = (typeof PRODS_STORE !== 'undefined' && PRODS_STORE.list.find(p => p.id === draft.id)) || draft;
  const [stockLive, setStockLive] = React.useState(null);
  React.useEffect(() => { setStockLive(null); }, [draft.id]);
  const stock = stockSummary({...draft, stockCount: stockLive || liveRow.stockCount || draft.stockCount});
  const openStock = () => setOpen('stock');

  return (
    <div className="pe">
      <div className="pe-scroll">
        <div className="wz pe-body">

          {/* Identity */}
          <div className="pe-sec">
            <div className="wz-group" data-field="1">
              <label className="wz-row">
                <span className="wz-row-label">Name</span>
                <input className="wz-input" value={draft.name || ''} onChange={e => upd('name', e.target.value)}
                  placeholder={isPkg ? 'Pro package' : draft.type === 'add' ? 'Priority support' : 'Pro plan'}/>
              </label>
            </div>
          </div>

          {/* What customers see before buying */}
          <div className="pe-sec">
            <div className="pe-cap"><span>Photos and videos</span></div>
            <WzGallery draft={draft} upd={upd} onBusy={setImgBusy}/>
          </div>

          {/* Price */}
          <div className="pe-sec">
            <div className="pe-cap">Price</div>
            <div className="wz-group" data-field="1">
              <div className="pe-price">
                <label className="pe-amount">
                  <span className="pe-amount-sym">{sym}</span>
                  <input inputMode="decimal" value={draft.price || ''} placeholder="0" aria-label="Price"
                    onChange={e => upd('price', e.target.value)}/>
                </label>
                <WzSeg label="Billing" value={draft.billing || 'monthly'} onChange={v => upd('billing', v)}
                  options={[{value:'one-time',label:'Once'},{value:'monthly',label:'Monthly'},{value:'yearly',label:'Yearly'},{value:'custom',label:'Custom'}]}/>
              </div>
              <div className="pe-split">
                <label className="pe-cell" title="Currency">
                  <span className="wz-ico"><CurrencyGlyph code={curCode}/></span>
                  <WzSelect label="Currency" icon={null} value={curCode} onChange={v => upd('priceCurrency', v)}
                    options={[
                      ...FIAT_CURRENCIES.map(f => ({value: f.code, label: `${f.symbol} ${f.code}`, short: f.code, group: 'Currencies'})),
                      ...CRYPTAPI_COINS.map(c => ({value: c.ticker, label: cryptoLabel(c.ticker), short: c.ticker, group: 'Crypto'})),
                    ]}/>
                </label>
                {draft.stockMode ? (
                  // Counted from the Keys and codes list, not typed.
                  <button type="button" className="pe-cell" title="Counted from Keys and codes. Click to manage the list." onClick={openStock}
                    style={{appearance:'none', border:'none', background:'transparent', font:'inherit', color:'inherit', textAlign:'left'}}>
                    <span className="wz-ico"><WzSvg name="ticket"/></span>
                    <span className="wz-input" style={{display:'inline-flex', alignItems:'center', color: stock.tone === 'out' ? 'rgb(240,140,134)' : undefined}}>{stock.text}</span>
                  </button>
                ) : (
                <label className="pe-cell" title="Stock. Leave empty for unlimited.">
                  <span className="wz-ico"><WzSvg name="box"/></span>
                  <input className="wz-input" inputMode="numeric" aria-label="Stock"
                    value={draft.stock === '∞' ? '' : (draft.stock || '')} placeholder="∞ stock"
                    onChange={e => upd('stock', e.target.value.trim() === '' ? '∞' : e.target.value)}/>
                </label>
                )}
                <label className="pe-cell" title={`Offer ends. After this date agents stop offering this ${t}.`}>
                  <span className="wz-ico"><WzSvg name="calendar"/></span>
                  <input className="wz-input" type="date" aria-label="Offer ends" value={draft.expiry || ''}
                    data-empty={draft.expiry ? undefined : '1'} onChange={e => upd('expiry', e.target.value)}/>
                </label>
              </div>
            </div>
          </div>

          {/* What a package includes */}
          {isPkg && (
            <div className="pe-sec">
              <div className="pe-cap"><span>Includes</span>
                {allProducts.length > 0 && <small>{picked.length} of {allProducts.length}</small>}</div>
              <div className="pe-bundle">
                <ProdBundlePicker allProducts={allProducts} picked={picked} togProduct={togProduct} draft={draft} hideValue/>
              </div>
            </div>
          )}

          {/* Description */}
          <div className="pe-sec">
            <div className="pe-cap"><span>Description</span>
              {(draft.desc || '').length > 0 && <small>{(draft.desc || '').length.toLocaleString()}</small>}</div>
            <div className="wz-group" data-field="1">
              <textarea className="wz-textarea" value={draft.desc || ''} onChange={e => upd('desc', e.target.value)}
                placeholder="What the customer gets. Your agent quotes this word for word."/>
            </div>
            <div className="wz-group">
              <PeRow icon="list" title="Features" open={open === 'feats'} onToggle={() => toggle('feats')}
                set={feats.length > 0} summary={feats.length ? plural(feats.length, 'feature') : 'None'}>
                <ProdFeatures items={feats} onChange={v => upd('feats', v)}/>
              </PeRow>
            </div>
          </div>

          {/* Checkout */}
          <div className="pe-sec">
            <div className="pe-cap">Checkout</div>
            <WzTiles multi label="Checkout options" options={[
              {icon:'user',     label:'Username',     hint:'Ask for a login',  on: !!draft.allowUsername,        onChange: v => upd('allowUsername', v)},
              {icon:'key',      label:'Serial key',   hint: draft.stockMode ? 'From your list' : 'One per purchase', on: !!draft.allowSerial,          onChange: v => upd('allowSerial', v)},
              {icon:'userplus', label:'Account help', hint:'Guide sign-up',    on: !!draft.allowAccountCreation, onChange: v => upd('allowAccountCreation', v)},
              {icon:'refund',   label:'Refundable',   hint: draft.allowRefund !== false ? 'Asks why, then to you' : 'Sales are final',
                on: draft.allowRefund !== false, onChange: v => upd('allowRefund', v)},
            ]}/>
          </div>

          {/* After payment: only what the buyer receives */}
          <div className="pe-sec">
            <div className="pe-cap"><span>After payment</span><small>Only the buyer gets these</small></div>
            <div className="wz-group">
              <PeRow icon="message" title="Message to the buyer" open={open === 'message'} onToggle={() => toggle('message')}
                set={!!msg.trim()} summary={msg.trim() ? (linkCount ? plural(linkCount, 'link') : 'Set') : 'None'}>
                <PostPaymentEditor value={msg} onChange={v => upd('postPaymentText', v)} hasPaidMedia={paid > 0} allowSerial={!!draft.allowSerial} stockMode={!!draft.stockMode}/>
                {linkCount > 0 && <DeliveryLinksEditor text={msg} onChange={v => upd('postPaymentText', v)}/>}
              </PeRow>
              <PeRow icon="ticket" title="Keys and codes" open={open === 'stock'} onToggle={() => toggle('stock')}
                set={stock.set} summary={stock.text}>
                <StockEditor draft={draft} upd={upd} onCounts={setStockLive}/>
              </PeRow>
              <PeRow icon="doc" title="Files for the buyer" open={open === 'media'} onToggle={() => toggle('media')}
                set={paid > 0} summary={paid ? plural(paid, 'file') : 'None'}>
                <BuyerFiles media={media} onChange={m => upd('media', m)}/>
              </PeRow>
              <PeRow icon="manual" title="Manual setup" open={open === 'manual'} onToggle={() => toggle('manual')}
                set={tasks.length > 0} summary={tasks.length ? plural(tasks.length, 'step') : 'Automatic'}>
                <ManualSetupEditor value={tasks} onChange={v => upd('manualTasks', v)} feats={feats}/>
              </PeRow>
            </div>
          </div>

        </div>
      </div>

      <div className="pe-foot">
        {/* Available / Hidden: saved at once, like the agent's Replying switch. */}
        <button type="button" className="pe-avail" role="switch" aria-checked={aiOn} data-on={aiOn ? '1' : undefined} onClick={flipAi}
          title={aiOn ? 'Agents can offer this. Click to hide.' : 'Hidden from agents. Click to make available.'}>
          <span className="bc-switch" data-on={aiOn ? '1' : '0'} aria-hidden="true"/>
          <span>{aiOn ? 'Available' : 'Hidden'}</span>
        </button>
        <span className="pe-foot-sp"/>
        <button type="button" className="pe-icon-btn" data-tone="danger" onClick={onDelete} aria-label={`Delete ${t}`} title={`Delete ${t}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
        <button type="button" className="wz-btn" data-kind="primary" onClick={onSave}
          aria-disabled={!canSave || imgBusy ? 'true' : undefined} disabled={!canSave || imgBusy}
          title={!canSave ? 'Enter a name first' : imgBusy ? 'Image still processing' : undefined}>
          <WzSvg name="check" size={13} stroke={2.4}/><span>Save changes</span>
        </button>
      </div>
    </div>
  );
};

const ProdField = ({label, children}) => (
  <div style={{display:'flex',flexDirection:'column',gap:6,minWidth:0}}>
    <label className="sset-field-label">{label}</label>
    {children}
  </div>
);

// ── Editor section ───────────────────────────────────────────────────
// Every catalog-editor tab is built from these: a titled section with an
// optional one-line explanation, and its controls inside a single grouped
// card. Before this, the Delivery tab was four unlabelled editors stacked
// behind hairline dividers, which is what made it read as clutter — you
// could not tell where one concern ended and the next began.
const EdSection = ({title, hint, children, flush=false, aside=null}) => (
  <div className="sset-pop-section">
    <div style={{display:'flex',alignItems:'baseline',gap:8}}>
      <div className="sset-pop-section-label" style={{flex:1}}>{title}</div>
      {aside}
    </div>
    {hint && <div className="sset-pop-section-hint">{hint}</div>}
    {flush ? children : (
      <div style={{
        background:'rgba(255,255,255,0.022)',
        border:'1px solid rgba(255,255,255,0.055)',
        borderRadius:10, padding:'10px 12px',
        display:'flex', flexDirection:'column', gap:10,
      }}>{children}</div>
    )}
  </div>
);

const FeatureList = ({items, onChange}) => {
  const [val, setVal] = React.useState('');
  const add = () => { const v = val.trim(); if (!v) return; onChange([...items, v]); setVal(''); };
  const remove = i => onChange(items.filter((_,idx)=>idx!==i));
  return (
    <div style={{display:'flex',flexDirection:'column',gap:7}}>
      {items.length > 0 && <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
        {items.map((f,i)=>(
          <span key={i} style={{display:'inline-flex',alignItems:'center',gap:7,padding:'5px 7px 5px 10px',fontSize:11.5,
            background:'rgba(255,255,255,0.04)',border:'0.5px solid rgba(255,255,255,0.09)',
            color:'var(--t1)',borderRadius:7,letterSpacing:'-0.005em'}}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(127,211,166,0.9)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            {f}
            <button onClick={()=>remove(i)} title="Remove" style={{display:'flex',alignItems:'center',justifyContent:'center',width:15,height:15,borderRadius:4,background:'transparent',border:'none',color:'var(--t3)',cursor:'pointer',padding:0,fontSize:13,lineHeight:1}}>×</button>
          </span>
        ))}
      </div>}
      <div style={{display:'flex',gap:6}}>
        <input className="fi" value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault(); add();} }} placeholder="e.g. Unlimited messages" style={{flex:1}}/>
        <button onClick={add} className="sset-btn" disabled={!val.trim()}>Add</button>
      </div>
    </div>
  );
};

// ── ManualSetupEditor ────────────────────────────────────────────────
// Lets the operator declare the things they personally need to do by hand
// AFTER a payment lands for this product/package (e.g. "add the SMTPs",
// "provision the server", "create the forum account"). The agent uses these
// to send a realistic, in-persona "I'll get X set up for you" follow-up once
// the product has been delivered — and, when the agent is set to go quiet
// after a sale, to frame its sign-off around that specific task with a
// natural excuse (at work / heading home). Items can be picked from the
// product's own feature list or typed freely. Stored as a string[] on
// draft.manualTasks. Leave empty → the agent just continues the conversation
// normally after the sale (no manual-setup message).
const ManualSetupEditor = ({value, onChange, feats}) => {
  const items = Array.isArray(value) ? value : [];
  // Features not already added as a step, offered as one-click suggestions.
  const suggestions = (Array.isArray(feats) ? feats : [])
    .filter(f => f && !items.some(x => x.toLowerCase() === String(f).toLowerCase()))
    .slice(0, 6);
  return (
    <div className="slw-field">
      <ProdTagField items={items} onChange={onChange} label="Manual setup steps"
        placeholder="Add another" emptyPlaceholder="e.g. Set up the server, then press Enter"/>
      {suggestions.length > 0 && (
        <div className="slp-suggest">
          <span className="slw-hint">From features</span>
          {suggestions.map((f, i) => (
            <button key={i} type="button" className="slp-suggest-chip" onClick={() => onChange([...items, String(f)])}>+ {f}</button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── MEDIA LIBRARY (per product) ────────────────────────────────
// Lets the operator attach images, files, and links to a product so the
// AI agent can hand them out. Two visibility tiers:
//   • Showcase  — preview content. AI may share with anyone interested
//                 (sales screenshots, demo videos, public docs).
//   • Customers only — delivery payload. AI may only share with end-users
//                 who have a confirmed purchase of THIS product (licence
//                 download links, install bundles, gated PDFs).
// The server validates the gate on every reply (cross-checks against the
// end-user's purchases / completed transactions) so the AI cannot leak
// gated content even if a customer prompt-injects it.
//
// Storage shape per entry (matches api.php sanitiser):
//   { id, kind: 'image'|'file'|'link', url, label, desc, showcase, filename, mime }
const MEDIA_KINDS = [
  {id:'image', label:'Image',
   icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>},
  {id:'file',  label:'File',
   icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>},
  {id:'link',  label:'Link',
   icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71"/></svg>},
];
const MEDIA_KIND_META = MEDIA_KINDS.reduce((m,k)=>(m[k.id]=k,m),{});

// ── DELIVERY LINKS (embedded in post-payment text) ────────────────
// Scans the post-payment text for URLs and presents each as an editable
// row. This is the missing piece behind "the product sends a file but I
// can't see/replace it": when the deliverable is a hosted download link
// pasted into the post-payment message (e.g. https://host/BlackMail.zip)
// rather than an uploaded media-library file, there was no visible control
// for it — the URL just lived as plain text inside the textarea. Here we
// pull those URLs out, show them with their filename, and let the operator
// replace or remove each one in place. Editing a row rewrites the exact
// substring in the text (first occurrence), so the rest of the message is
// untouched. Non-destructive: if the text has no URLs, the panel hides.
const DeliveryLinksEditor = ({text, onChange}) => {
  const URL_RE = /(https?:\/\/[^\s<>()'"]+)/gi;
  // Collect unique URLs in order of first appearance.
  const urls = React.useMemo(() => {
    const seen = [];
    const t = String(text || '');
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(t)) !== null) {
      // Trim trailing punctuation that commonly follows a pasted URL.
      const cleaned = m[1].replace(/[).,;]+$/, '');
      if (!seen.includes(cleaned)) seen.push(cleaned);
    }
    return seen;
  }, [text]);

  const [editIdx, setEditIdx] = React.useState(null);
  const [editVal, setEditVal] = React.useState('');

  if (!urls.length) return null;

  const fileNameOf = (u) => {
    try {
      const path = u.split('?')[0].split('#')[0];
      const last = path.split('/').filter(Boolean).pop() || u;
      return decodeURIComponent(last);
    } catch (_) { return u; }
  };
  const looksLikeFile = (u) => /\.(zip|rar|7z|tar|gz|exe|dmg|pkg|apk|msi|pdf|docx?|xlsx?|csv|txt|mp4|mov|mp3|wav|png|jpe?g|gif|webp|iso|bin|json|key|lic|dat)(\?|#|$)/i.test(u);

  const startEdit = (idx) => { setEditIdx(idx); setEditVal(urls[idx]); };
  const cancelEdit = () => { setEditIdx(null); setEditVal(''); };
  const commitEdit = (idx) => {
    const oldUrl = urls[idx];
    const next = (editVal || '').trim();
    if (!next || next === oldUrl) { cancelEdit(); return; }
    // Replace the FIRST occurrence of the exact old URL with the new one.
    const t = String(text || '');
    const at = t.indexOf(oldUrl);
    if (at === -1) { cancelEdit(); return; }
    const updated = t.slice(0, at) + next + t.slice(at + oldUrl.length);
    onChange(updated);
    cancelEdit();
  };
  const removeUrl = (idx) => {
    const oldUrl = urls[idx];
    if (!window.confirm(`Remove this download link from the post-payment message?\n\n${oldUrl}\n\nThe text around it stays — only the link is deleted. Customers will no longer receive it.`)) return;
    const t = String(text || '');
    const at = t.indexOf(oldUrl);
    if (at === -1) return;
    // Remove the URL and tidy any now-empty "Label:" leftover on its line.
    let updated = t.slice(0, at) + t.slice(at + oldUrl.length);
    updated = updated
      .replace(/[ \t]+\n/g, '\n')          // trailing spaces
      .replace(/\n{3,}/g, '\n\n');          // collapse blank runs
    onChange(updated);
  };

  const linkIcon = (isFile) => isFile
    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71"/></svg>;
  return (
    <div className="sl-list">
      {urls.map((u, idx) => {
        const isEditing = editIdx === idx;
        return (
          <div key={u} className="slp-item">
            <div className="sl-row" data-static="1">
              <span className="sl-row-media"><span className="slp-ico">{linkIcon(looksLikeFile(u))}</span></span>
              <span className="sl-row-main">
                <span className="sl-row-title">{fileNameOf(u)}</span>
                <span className="sl-row-meta"><span className="sl-grow sl-row-mono">{u.replace(/^https?:\/\//,'')}</span></span>
              </span>
              {!isEditing && (
                <span className="sl-row-trail">
                  <BcMenu label="Link actions" items={[
                    {label:'Replace link', onClick: () => startEdit(idx)},
                    {sep:true},
                    {label:'Remove link', tone:'danger', onClick: () => removeUrl(idx)},
                  ]}/>
                </span>
              )}
            </div>
            {isEditing && (
              <div className="slp-rowedit">
                <input className="slw-input slw-mono" autoFocus value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(idx); if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); } }}
                  placeholder="https://your-host/new-file.zip"/>
                <div className="slp-rowedit-actions">
                  <button type="button" className="sset-btn" onClick={cancelEdit}>Cancel</button>
                  <button type="button" className="sset-btn" data-variant="primary" onClick={() => commitEdit(idx)}>Save link</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const PostPaymentEditor = ({value, onChange, hasPaidMedia, allowSerial, stockMode}) => {
  const charCount = (value || '').length;
  const cap = 4000;
  // Detect placeholder usage so we can surface a tiny hint when the
  // operator references {SERIAL} but hasn't enabled serial issuance.
  const usesSerial  = /\{SERIAL\}/i.test(value || '');
  const usesExpires = /\{EXPIRES\}/i.test(value || '');
  const usesProduct = /\{PRODUCT\}/i.test(value || '');

  const insertPlaceholder = (token) => {
    const next = (value || '') + (value && !value.endsWith(' ') && !value.endsWith('\n') ? ' ' : '') + token;
    onChange(next.slice(0, cap));
  };

  const TOKENS = [
    ...(stockMode ? [{token:'{ITEM}', hint:'The key, code or login this buyer gets from your Keys and codes list'}] : []),
    {token:'{SERIAL}',  hint:"The buyer's serial key (needs serial keys turned on)"},
    {token:'{EXPIRES}', hint:'When the license ends. Blank if it never does.'},
    {token:'{PRODUCT}', hint:"This product's name."},
  ];
  return (
    <div className="slw-field">
      <textarea className="slw-input slp-ta" rows={5}
        placeholder={"e.g. Thanks for your order! Your key: {SERIAL}\nValid until {EXPIRES}"}
        value={value || ''}
        onChange={e => onChange(e.target.value.slice(0, cap))}/>
      <div className="slp-ta-foot">
        <span className="slp-tokens">
          <span className="slw-hint">Insert</span>
          {TOKENS.map(p => (
            <button key={p.token} type="button" className="slp-token" title={p.hint} onClick={() => insertPlaceholder(p.token)}>{p.token}</button>
          ))}
        </span>
        <span className="slp-count" data-warn={charCount > cap * 0.9 ? '1' : undefined}>{charCount.toLocaleString()} / {cap.toLocaleString()}</span>
      </div>
      {hasPaidMedia && !value && (
        <div className="sl-alert"><span>This product has customer-only files. A short message here tells the buyer what is on its way.</span></div>
      )}
      {usesSerial && !allowSerial && !stockMode && (
        <div className="sl-alert" data-tone="danger"><span>The message uses {'{SERIAL}'} but serial keys are off in Checkout, so it will be blank.</span></div>
      )}
    </div>
  );
};


// audience="paid": the list only holds files for buyers (After payment),
// so every entry is customers-only and the Showcase choice is not offered.
const MediaList = ({items, onChange, audience}) => {
  const fixed = audience === 'paid';
  const defShow = !fixed;
  const [adding, setAdding] = React.useState(null);     // null | 'image' | 'file' | 'link'
  const [editing, setEditing] = React.useState(null);   // index of row being edited inline
  const [draft,   setDraft]   = React.useState({label:'', desc:'', url:'', showcase:defShow, filename:'', mime:''});
  const fileRef = React.useRef(null);

  const startAdd = (kind) => {
    setAdding(kind);
    setDraft({label:'', desc:'', url:'', showcase:defShow, filename:'', mime:''});
    if (kind === 'image' || kind === 'file') {
      // Defer click until the input mounts (next tick).
      setTimeout(()=>fileRef.current?.click(), 0);
    }
  };

  const onPickFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) { if (!draft.url) setAdding(null); return; }
    // Soft cap so the operator doesn't accidentally upload a 200MB
    // installer (the server caps at 5MB per field anyway).
    if (f.size > 5 * 1024 * 1024) {
      bcToast(`That file is ${(f.size/1024/1024).toFixed(1)}MB — host it elsewhere and add it as a link instead`, 'warn');
      setAdding(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDraft(d => ({
        ...d,
        url: reader.result,
        filename: f.name,
        mime: f.type || '',
        label: d.label || f.name.replace(/\.[^.]+$/,''),
      }));
    };
    reader.readAsDataURL(f);
  };

  const commit = () => {
    const url   = (draft.url   || '').trim();
    const label = (draft.label || '').trim();
    if (!url && !label) { setAdding(null); return; }
    if (adding === 'link' && !url) { bcToast('Paste a link first, or cancel', 'warn'); return; }
    if ((adding === 'image' || adding === 'file') && !url) { bcToast('Choose a file first, or cancel', 'warn'); return; }
    const entry = {
      id: 'med_' + Math.random().toString(36).slice(2, 12),
      kind: adding,
      url,
      label: label || (adding === 'link' ? url : 'Untitled'),
      desc: (draft.desc || '').trim(),
      showcase: fixed ? false : !!draft.showcase,
      filename: draft.filename || '',
      mime: draft.mime || '',
    };
    onChange([...(items||[]), entry]);
    setAdding(null);
    setDraft({label:'', desc:'', url:'', showcase:defShow, filename:'', mime:''});
  };
  const cancelAdd = () => { setAdding(null); setDraft({label:'', desc:'', url:'', showcase:defShow, filename:'', mime:''}); };

  const removeAt = (idx) => onChange(items.filter((_,i)=>i!==idx));
  const patchAt  = (idx, patch) => onChange(items.map((m,i)=> i===idx ? {...m, ...patch} : m));

  const sizeLabel = (m) => {
    if (m.kind !== 'image' && m.kind !== 'file') return '';
    if (!m.url || !String(m.url).startsWith('data:')) return '';
    // Rough decoded size from the base64 length.
    const b64 = String(m.url).split(',')[1] || '';
    const bytes = Math.floor(b64.length * 0.75);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1024/1024).toFixed(1)} MB`;
  };

  const SHOW_OPTS = [{v:true, l:'Showcase'}, {v:false, l:'Customers only'}];
  const thumb = (m) => m.kind === 'image' && m.url
    ? <img className="slp-thumb" src={m.url} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden'; }}/>
    : <span className="slp-ico">{(MEDIA_KIND_META[m.kind] || MEDIA_KIND_META.file).icon}</span>;
  return (
    <div className="slw-field">
      {items && items.length > 0 && (
        <div className="sl-list">
          {items.map((m, idx) => {
            const isEditing = editing === idx;
            const detail = m.kind === 'link' ? (m.url || '').replace(/^https?:\/\//, '') : (m.filename || '');
            return (
              <div key={m.id || idx} className="slp-item">
                <div className="sl-row" data-static="1">
                  <span className="sl-row-media">{thumb(m)}</span>
                  <span className="sl-row-main">
                    <span className="sl-row-title">{m.label || m.filename || 'Untitled'}</span>
                    <span className="sl-row-meta">
                      {!fixed && <span className="slp-tag" data-show={m.showcase ? '1' : '0'}>{m.showcase ? 'Showcase' : 'Customers only'}</span>}
                      {detail && <>{!fixed && <span className="sl-sep">·</span>}<span className="sl-grow">{detail}</span></>}
                      {sizeLabel(m) && <><span className="sl-sep">·</span><span>{sizeLabel(m)}</span></>}
                    </span>
                  </span>
                  <span className="sl-row-trail">
                    <BcMenu label="File actions" items={[
                      {label: isEditing ? 'Close editor' : 'Edit details', onClick: () => setEditing(isEditing ? null : idx)},
                      ...(fixed ? [] : [{label: m.showcase ? 'Make customers only' : 'Make showcase', onClick: () => patchAt(idx, {showcase: !m.showcase})}]),
                      {sep:true},
                      {label:'Remove', tone:'danger', onClick: () => { if (editing === idx) setEditing(null); removeAt(idx); }},
                    ]}/>
                  </span>
                </div>
                {isEditing && (
                  <div className="slp-rowedit">
                    <input className="slw-input" placeholder="Label" value={m.label || ''} onChange={e => patchAt(idx, {label: e.target.value})}/>
                    <input className="slw-input" placeholder="Short description (helps the agent know when to send it)" value={m.desc || ''} onChange={e => patchAt(idx, {desc: e.target.value})}/>
                    {m.kind === 'link' && (
                      <input className="slw-input slw-mono" placeholder="https://…" value={m.url || ''} onChange={e => patchAt(idx, {url: e.target.value})}/>
                    )}
                    {!fixed && (
                      <div className="slw-seg" role="radiogroup" aria-label="Who can receive this">
                        {SHOW_OPTS.map(o => (
                          <button key={String(o.v)} type="button" role="radio" aria-checked={!!m.showcase === o.v}
                            onClick={() => patchAt(idx, {showcase: o.v})}>{o.l}</button>
                        ))}
                      </div>
                    )}
                    <div className="slp-rowedit-actions">
                      <span className="slw-hint" style={{marginRight:'auto'}}>
                        {fixed ? 'Sent only after payment clears.' : m.showcase ? 'Can be shared with anyone asking about the product.' : 'Only sent to customers with a confirmed purchase.'}
                      </span>
                      <button type="button" className="sset-btn" onClick={() => setEditing(null)}>Done</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <div className="sl-list">
          <div className="slp-rowedit" style={{borderTop:'none'}}>
            <span className="slw-group-title">{adding === 'link' ? 'New link' : adding === 'image' ? 'New image' : 'New file'}</span>
            {adding === 'link' && (
              <input className="slw-input slw-mono" autoFocus placeholder="https://…" value={draft.url} onChange={e => setDraft(d => ({...d, url: e.target.value}))}/>
            )}
            {(adding === 'image' || adding === 'file') && (
              draft.url ? (
                <div className="sl-row" data-static="1" style={{height:48,padding:0}}>
                  <span className="sl-row-media">{adding === 'image' ? <img className="slp-thumb" src={draft.url} alt=""/> : <span className="slp-ico">{MEDIA_KIND_META.file.icon}</span>}</span>
                  <span className="sl-row-main"><span className="sl-row-title">{draft.filename || 'Uploaded'}</span>
                    <span className="sl-row-meta"><span>{sizeLabel({kind: adding, url: draft.url})}</span></span></span>
                  <span className="sl-row-trail"><button type="button" className="sset-btn" onClick={() => fileRef.current && fileRef.current.click()}>Change</button></span>
                </div>
              ) : (
                <button type="button" className="sset-btn" style={{alignSelf:'flex-start'}} onClick={() => fileRef.current && fileRef.current.click()}>Choose {adding}</button>
              )
            )}
            <input className="slw-input" placeholder={adding === 'link' ? 'Label, e.g. Download page' : 'Label, e.g. Setup guide'} value={draft.label} onChange={e => setDraft(d => ({...d, label: e.target.value}))}/>
            <input className="slw-input" placeholder="Short description (optional)" value={draft.desc} onChange={e => setDraft(d => ({...d, desc: e.target.value}))}/>
            {!fixed && (
              <div className="slw-seg" role="radiogroup" aria-label="Who can receive this">
                {SHOW_OPTS.map(o => (
                  <button key={String(o.v)} type="button" role="radio" aria-checked={!!draft.showcase === o.v}
                    onClick={() => setDraft(d => ({...d, showcase: o.v}))}>{o.l}</button>
                ))}
              </div>
            )}
            <div className="slp-rowedit-actions">
              <button type="button" className="sset-btn" onClick={cancelAdd}>Cancel</button>
              <button type="button" className="sset-btn" data-variant="primary" onClick={commit}>Add {adding}</button>
            </div>
          </div>
        </div>
      )}

      {!adding && (
        <div className="slp-addrow">
          {MEDIA_KINDS.map(k => (
            <button key={k.id} type="button" className="sset-btn" onClick={() => startAdd(k.id)}>
              {k.icon}<span>Add {k.label.toLowerCase()}</span>
            </button>
          ))}
        </div>
      )}
      <input ref={fileRef} type="file" accept={adding === 'image' ? 'image/*' : '*/*'} onChange={onPickFile} hidden/>
    </div>
  );
};


// ── LICENSES VIEW ──────────────────────────────────────────────
// Active products / packages issued to end-users across every conversation.
// Two tabs:
//   "Licenses" — searchable / filterable table of every per-user purchase.
//                Click a row to open a detail popup that mirrors the slideout
//                sub-popup chrome (so it visually slots in beside the main
//                sheet). Lets the operator change status, expiry, serial.
//   "API"      — surfaces this account's verify_license API key + usage docs
//                so the operator can paste it into external sites.
// Filter chips borrow the badge vocabulary rather than their own hexes.
// ── Shared license data ──────────────────────────────────────
// Licenses used to live in LicensesView's own state. Licenses & payments
// now shows them in three places (Overview, Licenses, the tab counts), so
// they are held once here and every view reads the same list.
const LIC_CACHE = {
  list: [], loaded: false, acct: null, _p: null, subs: new Set(),
  sub(f) { this.subs.add(f); return () => this.subs.delete(f); },
  notify() { this.subs.forEach(f => { try { f(); } catch (_) {} }); },
  update(fn) { this.list = fn(this.list) || []; this.notify(); },
  isDemo() { return !!(AUTH_STORE.account && AUTH_STORE.account.email === 'demo@botcommand.app'); },
  load() {
    const acct = (AUTH_STORE.account && AUTH_STORE.account.email) || '';
    if (acct !== this.acct) { this.acct = acct; this.list = []; this.loaded = false; this._p = null; this.notify(); }
    if (this._p) return this._p;
    if (this.isDemo()) {
      // Demo: a few rows made from the demo customer data.
      const demo = (typeof DEMO_END_USER_DATA !== 'undefined' && DEMO_END_USER_DATA.purchases) || [];
      this.list = demo.map((p, i) => ({
        id: p.id || (i+1),
        product_name: p.product_name || `Product #${p.product_id}`,
        product_sku:  p.product_sku  || '',
        product_price:p.product_price|| '',
        product_type: p.product_type || 'pkg',
        customer_name:'Demo Customer', customer_handle:'demo', customer_avatar:'',
        purchased_at: p.purchased_at, expires_at: p.expires_at,
        status: p.status || 'active', serial_key: p.serial_key || '', username: p.username || '',
      }));
      this.loaded = true; this.notify();
      return (this._p = Promise.resolve(this.list));
    }
    this._p = apiGet('get_active_licenses', '').then(res => {
      if (res && !res.error) this.list = res.licenses || [];
      this.loaded = true; this.notify();
      return this.list;
    }).catch(() => { this.loaded = true; this.notify(); return this.list; })
      .finally(() => { setTimeout(() => { this._p = null; }, 0); });
    return this._p;
  },
};
// Every view that shows licenses refreshes them when it opens, and keeps
// what it had on screen while the request is out.
const useLicenseList = () => {
  const [, bump] = React.useState(0);
  React.useEffect(() => LIC_CACHE.sub(() => bump(n => n + 1)), []);
  React.useEffect(() => { LIC_CACHE.load(); }, []);
  return { list: LIC_CACHE.list, loading: !LIC_CACHE.loaded, isDemo: LIC_CACHE.isDemo() };
};
// A row that says "active" but whose date has passed is shown as expired —
// the same rule the public verify_license endpoint uses.
const licEffStatus = (l) => {
  if (l.status !== 'active' || !l.expires_at) return l.status;
  const exp = Date.parse(l.expires_at + 'T23:59:59');
  return (isFinite(exp) && exp < Date.now()) ? 'expired' : 'active';
};
// Days until expiry; negative once past it; null when it never expires.
const licDaysLeft = (l) => {
  if (!l.expires_at) return null;
  const exp = Date.parse(l.expires_at + 'T23:59:59');
  if (!isFinite(exp)) return null;
  return Math.floor((exp - Date.now()) / 86400000);
};
const licMatches = (l, q) => bcMatch(q, l.product_name, l.product_sku, l.customer_name, l.customer_handle,
  l.customer_email, l.serial_key, l.username);
const LIC_STATUS_LABEL = { active:'Active', expired:'Expired', cancelled:'Cancelled', suspended:'Paused', pending:'Pending' };

// One license in a list — Licenses and the Overview use the same row.
const LicenseRow = ({l, onOpen}) => {
  const eff = licEffStatus(l);
  const dl  = licDaysLeft(l);
  const expSoon = eff === 'active' && dl !== null && dl >= 0 && dl <= 14;
  const sKey = expSoon ? 'expiring' : eff;
  const initial = ((l.customer_name || l.customer_handle || '?').trim().charAt(0) || '?').toUpperCase();
  const name = l.customer_name || (l.customer_handle ? '@' + String(l.customer_handle).replace(/^@/,'') : 'Unknown customer');
  const open = () => onOpen && onOpen(l);
  return (
    <div role="button" tabIndex={0} className="sl-row" onClick={open}
      onKeyDown={e=>{ if (e.target===e.currentTarget && (e.key==='Enter'||e.key===' ')) { e.preventDefault(); open(); } }}>
      <span className="sl-row-media"><SlTile img={l.customer_avatar} letter={initial}/></span>
      <span className="sl-row-main">
        <span className="sl-row-title">{name}</span>
        <span className="sl-row-meta">
          <span className="sl-stat" data-s={sKey}><i aria-hidden="true"/>{expSoon ? 'Ends soon' : (LIC_STATUS_LABEL[eff] || eff)}</span>
        </span>
      </span>
      <span className="sl-row-value" data-text="1">
        <span className="sl-row-amt">{l.product_name || `Product #${l.product_id}`}</span>
      </span>
      <span className="sl-row-trail"><svg className="sl-row-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></span>
    </div>
  );
};

const LIC_FILTER_STATE = {
  active:'ok', expiring:'busy', expired:'err', cancelled:'err',
};
const LIC_TAB_KEY = 'bc.licenses.tab';
const LIC_TAB_IDS = ['all', 'active', 'expiring', 'inactive', 'api'];

// ── License API (Licenses window) ─────────────────────────────────
// What a website needs to check a customer's license, laid out in the
// same rows as every list in these windows: a tile, a name, one quiet
// line, and small actions on the right.
//   Connection   endpoint · API key (show / copy) · rotate
//   Test         open the test page · copy the test link
//   Developer reference (folded)   request · response · limits
const LAPI_GLYPH = {
  link:  <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></>,
  copy:  <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>,
  done:  <polyline points="20 6 9 17 4 12"/>,
  eye:   <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff:<><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>,
  out:   <><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></>,
  test:  <><circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16 9.5"/></>,
  share: <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/></>,
  chev:  <polyline points="9 6 15 12 9 18"/>,
};
const LapiIco = ({name, size = 14}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{LAPI_GLYPH[name]}</svg>
);
// A small square action button; `done` briefly shows a tick after a copy.
const LapiBtn = ({icon, label, onClick, disabled}) => (
  <button type="button" className="lapi-ib" onClick={onClick} disabled={disabled} aria-label={label} data-tip={label}>
    <LapiIco name={icon}/>
  </button>
);
const useCopied = () => {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => { if (!on) return; const t = setTimeout(() => setOn(false), 1400); return () => clearTimeout(t); }, [on]);
  const copy = (text) => { try { navigator.clipboard.writeText(text); setOn(true); } catch (_) {} };
  return [on, copy];
};
const LicenseApiPage = ({apiUrl, apiKey, isDemo, keyShown, setKeyShown, keyBusy, onRotate}) => {
  const endpoint = `${apiUrl}?action=verify_license`;
  const testUrl = apiKey
    ? `${apiUrl}?action=verify_license&format=html&api_key=${encodeURIComponent(apiKey)}`
    : `${apiUrl}?action=verify_license&format=html`;
  const [epDone, copyEp] = useCopied();
  const [keyDone, copyKey] = useCopied();
  const [linkDone, copyLink] = useCopied();
  const [ref, setRef] = React.useState(false);
  const masked = apiKey ? (keyShown ? apiKey : '•'.repeat(Math.min(28, apiKey.length))) : '';
  return (
    <div className="lapi">
      <section className="lapi-sec">
        <div className="lapi-cap">
          <span>Connection</span>
          <button type="button" className="lapi-cap-link" onClick={onRotate} disabled={keyBusy || isDemo || !apiKey}
            title="Makes a new key. The current one stops working at once.">{keyBusy ? 'Rotating…' : 'Rotate key'}</button>
        </div>
        <div className="sl-list">
          <div className="sl-row" data-static="1">
            <span className="sl-row-media"><SlTile><LapiIco name="link" size={15}/></SlTile></span>
            <span className="sl-row-main">
              <span className="sl-row-title">Endpoint</span>
              <span className="lapi-val" title={endpoint}>{endpoint}</span>
            </span>
            <span className="sl-row-trail">
              <LapiBtn icon={epDone ? 'done' : 'copy'} label={epDone ? 'Copied' : 'Copy endpoint'} onClick={() => copyEp(endpoint)}/>
            </span>
          </div>
          <div className="sl-row" data-static="1">
            <span className="sl-row-media"><SlTile><TabIco name="licenses" size={15}/></SlTile></span>
            <span className="sl-row-main">
              <span className="sl-row-title">API key</span>
              {apiKey
                ? <span className="lapi-val" data-secret={keyShown ? undefined : '1'}>{masked}</span>
                : <span className="lapi-val" data-plain="1">{isDemo ? 'Not available in the demo' : 'Loading…'}</span>}
            </span>
            <span className="sl-row-trail">
              <LapiBtn icon={keyShown ? 'eyeOff' : 'eye'} label={keyShown ? 'Hide key' : 'Show key'}
                onClick={() => setKeyShown(v => !v)} disabled={!apiKey}/>
              <LapiBtn icon={keyDone ? 'done' : 'copy'} label={keyDone ? 'Copied' : 'Copy key'}
                onClick={() => copyKey(apiKey)} disabled={!apiKey}/>
            </span>
          </div>
        </div>
        <p className="lapi-note">Your website sends the key with each check. Keep it private.</p>
      </section>

      <section className="lapi-sec">
        <div className="lapi-cap"><span>Test</span></div>
        <div className="sl-list">
          <button type="button" className="sl-row"
            onClick={() => bcOpenLicenseTest(testUrl)}>
            <span className="sl-row-media"><SlTile><LapiIco name="test" size={15}/></SlTile></span>
            <span className="sl-row-main"><span className="sl-row-title">Open the test page</span></span>
            <span className="sl-row-trail"><span className="lapi-trail-ico"><LapiIco name="out" size={13}/></span></span>
          </button>
          <button type="button" className="sl-row" onClick={() => copyLink(testUrl)}>
            <span className="sl-row-media"><SlTile><LapiIco name="share" size={15}/></SlTile></span>
            <span className="sl-row-main"><span className="sl-row-title">{linkDone ? 'Link copied' : 'Copy the test link'}</span></span>
            <span className="sl-row-trail"><span className="lapi-trail-ico"><LapiIco name={linkDone ? 'done' : 'copy'} size={13}/></span></span>
          </button>
        </div>
        <p className="lapi-note">Up to 60 checks a minute per key.</p>
      </section>

      <section className="lapi-sec">
        <button type="button" className="lapi-fold" aria-expanded={ref} onClick={() => setRef(v => !v)}>
          <span className="lapi-fold-chev"><LapiIco name="chev" size={12}/></span>
          <span>Developer reference</span>
        </button>
        {ref && (
          <div className="lapi-ref">
            <div className="lapi-code-cap">Browser (GET)</div>
            <pre className="lapi-code" data-wrap="1">{`${endpoint}&api_key=YOUR_KEY&serial=ABCD-1234`}</pre>
            <div className="lapi-code-cap">JSON request (POST)</div>
            <pre className="lapi-code">{`{
  "api_key":     "YOUR_KEY",
  "username":    "alice",
  "serial":      "ABCD-1234",
  "email":       "a@b.com",
  "reveal":      false
}`}</pre>
            <p className="lapi-note">Send any one of <code>username</code>, <code>serial</code> or <code>email</code>. <code>reveal: true</code> also returns the customer's details. Use POST, or <code>Accept: application/json</code>, to get JSON back.</p>
            <div className="lapi-code-cap">Response</div>
            <pre className="lapi-code">{`{
  "ok": true,
  "valid": true,
  "status": "active",
  "product": { "name": "Pro Plan" },
  "purchased_at":   "2025-01-15 12:34:56",
  "expires_at":     "2026-01-15",
  "days_remaining": 254
}`}</pre>
            <p className="lapi-note">More than 60 checks a minute returns HTTP 429.</p>
          </div>
        )}
      </section>
    </div>
  );
};

const LicensesView = ({_embed, _billing, view, query: qProp, setQuery: setQProp, openReq, onDetailClose} = {}) => {
  // Inside Licenses & payments (_billing) the tabs, search text and "open
  // this license" requests come from BillingView; on its own it keeps them.
  const {list: licenses, loading, isDemo} = useLicenseList();
  const setLicenses = (fn) => LIC_CACHE.update(fn);
  const [tabState, setTab]    = React.useState('list');
  // The Licenses window (_embed on its own): one tab pill does both jobs —
  // the list filters, then (after a hairline) the License API page.
  //   All · Active · Ending soon · Inactive  |  License API
  const winTabs = !!_embed && !_billing;
  const [ltab, setLtabRaw] = React.useState(() => {
    try { const v = window.localStorage.getItem(LIC_TAB_KEY); if (LIC_TAB_IDS.includes(v)) return v; } catch (_) {}
    return 'all';
  });
  const setLtab = (t) => { setLtabRaw(t); try { window.localStorage.setItem(LIC_TAB_KEY, t); } catch (_) {} };
  const tab = _billing ? (view || 'list') : winTabs ? (ltab === 'api' ? 'api' : 'list') : tabState;
  const [filterState, setFilter] = React.useState('all'); // all | active | expiring | expired | cancelled
  const filter = winTabs ? (ltab === 'api' ? 'all' : ltab) : filterState;
  const [qState,   setQState]   = React.useState('');
  const query    = setQProp ? (qProp || '') : qState;
  const setQuery = setQProp || setQState;
  const [selected, setSelectedRaw] = React.useState(null); // license row for detail popup
  const setSelected = (v) => {
    setSelectedRaw(v);
    if (v == null && onDetailClose) onDetailClose();
  };
  const [apiKey,   setApiKey]   = React.useState('');
  const [keyBusy,  setKeyBusy]  = React.useState(false);
  const [keyShown, setKeyShown] = React.useState(false);
  const [linkCopied, setLinkCopied] = React.useState(false);
  React.useEffect(() => { if (!linkCopied) return; const t = setTimeout(() => setLinkCopied(false), 1600); return () => clearTimeout(t); }, [linkCopied]);
  const products = useProducts();

  // Open a license picked elsewhere (the Overview), once the list has it.
  // Layout effect, so the list never flashes up before the license.
  React.useLayoutEffect(() => {
    if (!openReq || openReq.id == null) return;
    const hit = licenses.find(l => String(l.id) === String(openReq.id));
    if (hit) setSelectedRaw(hit);
  // eslint-disable-next-line
  }, [openReq && openReq.n, licenses.length]);

  // Hydrate the API key only when the operator opens the API tab — no
  // sense fetching a credential until the user actually needs to see it.
  React.useEffect(() => {
    if (tab !== 'api' || apiKey || isDemo) return;
    apiGet('get_license_api_key', '').then(r => {
      if (r && r.api_key) setApiKey(r.api_key);
    });
  }, [tab, apiKey, isDemo]);

  const regenKey = async () => {
    if (isDemo) return;
    if (!window.confirm('Generate a new API key? The current key will stop working immediately on every site that uses it.')) return;
    setKeyBusy(true);
    const r = await apiFetch('regen_license_api_key', {});
    setKeyBusy(false);
    if (r && r.api_key) setApiKey(r.api_key);
  };

  const fmtDate = iso => iso ? (iso+'').slice(0,10) : '—';

  const effStatus = licEffStatus;
  const daysLeft  = licDaysLeft;

  const filtered = React.useMemo(() => {
    let out = licenses;
    if (filter === 'active')    out = out.filter(l => effStatus(l) === 'active');
    if (filter === 'expiring')  out = out.filter(l => { const d = daysLeft(l); return effStatus(l)==='active' && d!==null && d <= 14; });
    if (filter === 'expired')   out = out.filter(l => effStatus(l) === 'expired');
    if (filter === 'cancelled') out = out.filter(l => l.status === 'cancelled' || l.status === 'suspended');
    if (filter === 'inactive')  out = out.filter(l => effStatus(l) !== 'active');
    if (query.trim()) out = out.filter(l => licMatches(l, query));
    return out;
  }, [licenses, filter, query]);

  const counts = React.useMemo(() => {
    const c = {all: licenses.length, active:0, expiring:0, expired:0, cancelled:0, inactive:0};
    for (const l of licenses) {
      const eff = effStatus(l);
      if (eff === 'active')   c.active++; else c.inactive++;
      if (eff === 'expired')  c.expired++;
      if (l.status === 'cancelled' || l.status === 'suspended') c.cancelled++;
      const d = daysLeft(l);
      if (eff === 'active' && d !== null && d <= 14) c.expiring++;
    }
    return c;
  }, [licenses]);
  const licPaged = useBcPaged(filtered, filter + '|' + query);

  const STATUS_COL = {
    active: '#30d158', expired: '#ff453a', cancelled: '#8888a0',
    suspended: '#e8a844', pending: '#5b9cf0',
  };
  const STATUS_LABEL = {
    active: 'Active', expired: 'Expired', cancelled: 'Cancelled',
    suspended: 'Suspended', pending: 'Pending',
  };
  const fmtRel = (iso) => {
    if (!iso) return '';
    const t = Date.parse((iso+'').replace(' ','T'));
    if (!isFinite(t)) return '';
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <  1) return 'today';
    if (days <  2) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days/30)}mo ago`;
    return `${Math.floor(days/365)}y ago`;
  };
  // Build the absolute URL to api.php for the "Quick check" link. We
  // can't use a bare 'api.php' relative URL here because the link is
  // opened in a new tab — and we can't use just window.location.origin
  // either, because the app is typically served from a sub-path
  // (e.g. /myresponder/), so the absolute URL needs origin + the
  // current page's directory.
  const apiUrl = (() => {
    if (typeof window === 'undefined' || !window.location) return '/api.php';
    const origin = window.location.origin.replace(/\/$/, '');
    const path   = (window.location.pathname || '/').replace(/[^/]*$/, '');   // strip filename, keep dir
    return origin + path + 'api.php';
  })();

  return (
    <div className={_embed ? 'sset-pop-page' : ''} style={_embed ? {height:'100%'} : {padding:'24px 20px 32px',height:'100%',overflow:'auto'}}>
      <div style={_embed ? {flex:'1 1 auto',minHeight:0,display:'flex',flexDirection:'column'} : {maxWidth:1100,margin:'0 auto',display:'flex',flexDirection:'column',gap:18}}>

        {/* ── Tab strip — uses the unified .sset-pop-tabs primitive in
            embed mode so the chrome matches every other slideout. */}
        {!selected && !_billing && (
          _embed ? (
            <SsetLandTabs label="Licenses" value={ltab} onChange={setLtab} tabs={[
              {id:'all',      label:'All licenses', icon:'licenses', n: counts.all},
              {id:'active',   label:'Active',       n: counts.active},
              {id:'expiring', label:'Ending soon',  n: counts.expiring, dot: counts.expiring ? 'warn' : undefined},
              {id:'inactive', label:'Inactive',     n: counts.inactive},
              {id:'api',      label:'License API',  gap: true},
            ]}/>
          ) : (
            <div style={{display:'flex',alignItems:'center',gap:0,borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
              {[{id:'list',label:'Customers',n:licenses.length},{id:'api',label:'Verification API'}].map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)}
                  style={{padding:'10px 16px',fontSize:12,fontWeight:600,letterSpacing:'-0.01em',background:'transparent',border:'none',cursor:'pointer',color:tab===t.id?'var(--t1)':'var(--t3)',borderBottom:tab===t.id?'2px solid rgba(255,255,255,0.45)':'2px solid transparent',marginBottom:-1,transition:'color 0.12s'}}>
                  {t.label}
                  {typeof t.n === 'number' && <span style={{marginLeft:7,fontSize:10,color:'var(--t4)',fontFamily:'var(--mono)'}}>{t.n}</span>}
                </button>
              ))}
            </div>
          )
        )}

        {/* No back-strip — back chevron is inline inside LicenseDetail. */}

        {/* ── LIST TAB ──────────────────────────────────────────────── */}
        {/* Popup list — same design as Catalog, Wallets and Invoices
            (.bc-* in bot-ui-settings.jsx): search, text filters, then one
            bordered group of 56px rows, paged 50 at a time. */}
        {_embed && !selected && tab === 'list' && (
          <div style={{display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden',flex:1}}>
            <div className="sl-bar">
              <BcSearch value={query} onChange={setQuery} placeholder="Search customers, products or serial keys"/>
            </div>
            {!winTabs && <div className="sl-bar sl-bar-2">
              <div className="sl-filters" role="group" aria-label="Filter licenses">
                {[
                  {id:'all',label:'All'},{id:'active',label:'Active'},{id:'expiring',label:'Ending soon'},
                  {id:'expired',label:'Ended'},{id:'cancelled',label:'Cancelled or paused'},
                ].map(f => (
                  <button key={f.id} type="button" className="sl-filter" aria-pressed={filter===f.id}
                    onClick={()=>setFilter(f.id)}>{f.label}<span>{counts[f.id]}</span></button>
                ))}
              </div>
            </div>}
            <div className="sl-scroll">
              <div className="sl-list">
                {loading && licenses.length === 0 ? (
                  <div className="sl-empty"><div className="sl-empty-sub">Loading…</div></div>
                ) : filtered.length === 0 ? (
                  <SsetLandEmpty
                    title={licenses.length === 0 ? 'No licenses yet'
                      : query.trim() ? 'No licenses match your search'
                      : ({active:'No active licenses', expiring:'Nothing ending in the next 14 days', inactive:'No inactive licenses'}[filter] || 'No licenses match')}
                    sub={licenses.length === 0 ? 'A license is created for the customer each time an order is paid.' : query.trim() ? 'Try a customer, product or serial key.' : null}/>
                ) : (<>
                  {licPaged.shown.map(l => <LicenseRow key={l.id} l={l} onOpen={setSelected}/>)}
                  <BcMore rest={licPaged.rest} onMore={licPaged.more}/>
                </>)}
              </div>
            </div>
          </div>
        )}

        {!_embed && !selected && tab === 'list' && (
          <div style={_embed ? {display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden',flex:1} : {display:'flex',flexDirection:'column',gap:12}}>

            {/* Search + filter chips. Compact horizontal layout — chips
                wrap below if they don't fit beside the input. */}
            <div style={{display:'flex',flexDirection:'column',gap:8,padding:_embed?'16px 18px 8px':0,flexShrink:0}}>
              <div className="sset-search">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
                </svg>
                <input className={_embed?'sset-input':'fi'} placeholder="Search customer, product, serial…"
                  value={query} onChange={e=>setQuery(e.target.value)}/>
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                {[
                  {id:'all',      label:'All',       col:null},
                  {id:'active',   label:'Active',    col:STATUS_COL.active},
                  {id:'expiring', label:'Expiring',  col:'#e8a844'},
                  {id:'expired',  label:'Expired',   col:STATUS_COL.expired},
                  {id:'cancelled',label:'Cancelled', col:STATUS_COL.cancelled},
                ].map(f => {
                  const on = filter === f.id;
                  const n  = counts[f.id];
                  return (
                    <button key={f.id} onClick={()=>setFilter(f.id)} className="sset-pill"
                      data-dot="0" aria-pressed={on}>
                      {f.label}
                      <span style={{opacity:0.6,fontVariantNumeric:'tabular-nums'}}>{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Result list. Each row is a self-contained card with clear
                hierarchy: customer → product → status pill → expiry. */}
            <div style={_embed ? {flex:'1 1 auto',overflow:'auto',padding:'4px 18px 18px',display:'flex',flexDirection:'column',gap:6,minHeight:0} : {display:'flex',flexDirection:'column',gap:6,maxHeight:600,overflow:'auto'}}>
              {loading && (
                <div style={{padding:'40px 0',textAlign:'center',color:'var(--t3)',fontSize:12}}>Loading…</div>
              )}
              {!loading && filtered.length === 0 && (
                <div style={{padding:'40px 16px',textAlign:'center',color:'var(--t3)',fontSize:12,lineHeight:1.6}}>
                  {licenses.length === 0
                    ? <>No customers yet.<br/><span style={{color:'var(--t4)',fontSize:11}}>They show up here when someone buys.</span></>
                    : 'No customers match the current filter.'}
                </div>
              )}
              {!loading && filtered.map(l => {
                const eff = effStatus(l);
                const dl  = daysLeft(l);
                const col = STATUS_COL[eff] || STATUS_COL.cancelled;
                const initial = ((l.customer_name || l.customer_handle || '?').trim().charAt(0) || '?').toUpperCase();
                const expSoon = eff === 'active' && dl !== null && dl >= 0 && dl <= 14;
                return (
                  <button key={l.id} onClick={()=>setSelected(l)}
                    className="sset-list-row"
                    style={{padding: _embed?'9px 11px':'11px 12px'}}>
                    {/* Avatar */}
                    {l.customer_avatar ? (
                      <img src={l.customer_avatar} alt="" style={{width:_embed?32:36,height:_embed?32:36,borderRadius:'50%',flexShrink:0,objectFit:'cover',border:'0.5px solid rgba(255,255,255,0.08)'}} onError={e=>{e.currentTarget.style.display='none';}}/>
                    ) : (
                      <div style={{width:_embed?32:36,height:_embed?32:36,borderRadius:'50%',flexShrink:0,background:'linear-gradient(135deg,rgba(60,62,82,0.95),rgba(40,42,62,0.95))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:_embed?12:13.5,fontWeight:600,color:'var(--t1)',border:'0.5px solid rgba(255,255,255,0.08)'}}>{initial}</div>
                    )}

                    {/* Body — customer name top, product+expiry bottom */}
                    <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:2}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
                        <span style={{fontSize:12,fontWeight:600,color:'var(--t1)',letterSpacing:'-0.005em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0,flex:'0 1 auto'}}>
                          {l.customer_name || l.customer_handle || 'Unknown customer'}
                        </span>
                        {l.customer_handle && l.customer_name && (
                          <span style={{fontSize:10,color:'#8a8aa8',fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>@{l.customer_handle}</span>
                        )}
                      </div>
                      <div style={{fontSize:10.5,color:'var(--t3)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                        <span style={{color:'var(--t2)'}}>{l.product_name || `Product #${l.product_id}`}</span>
                        {l.expires_at && (
                          <>
                            <span style={{opacity:0.4,margin:'0 5px'}}>·</span>
                            <span style={{color: expSoon ? 'var(--t2)' : 'var(--t3)'}}>
                              {dl !== null && dl >= 0 ? `${dl}d left` : (dl !== null ? `${Math.abs(dl)}d ago` : `Expires ${fmtDate(l.expires_at)}`)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right: status pill + chevron — same row anatomy as
                        the Agents and Catalog lists. */}
                    <span className="bc-state" data-state={eff==='active'?(expSoon?'warn':'ok'):(eff==='expired'?'err':(eff==='suspended'?'warn':'mute'))}>
                      <i aria-hidden="true"/>{expSoon ? 'Expiring' : (STATUS_LABEL[eff]||eff)}
                    </span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--t4)',flexShrink:0,opacity:0.55}}><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── DETAIL POPUP ── */}
        {selected && (
          <LicenseDetail
            license={selected}
            isDemo={isDemo}
            onClose={()=>setSelected(null)}
            onChange={(patch)=>{
              setLicenses(ls => ls.map(x => x.id === selected.id ? {...x, ...patch} : x));
              setSelected(s => s ? {...s, ...patch} : s);
            }}
            onDelete={()=>{
              setLicenses(ls => ls.filter(x => x.id !== selected.id));
              setSelected(null);
            }}
          />
        )}

        {/* ── API TAB — designed for non-developers. The "Quick check"
            link is the no-code way to verify a license; the request
            samples below are the developer fallback. */}
        {_embed && !selected && tab === 'api' && (
          <LicenseApiPage apiUrl={apiUrl} apiKey={apiKey} isDemo={isDemo}
            keyShown={keyShown} setKeyShown={setKeyShown} keyBusy={keyBusy} onRotate={regenKey}/>
        )}
        {!_embed && !selected && tab === 'api' && (
          <div className={_embed ? 'wd wd-api' : 'wd'} style={_embed ? undefined : {display:'flex',flexDirection:'column',gap:16}}>
            {(() => {
              const testUrl = apiKey
                ? `${apiUrl}?action=verify_license&format=html&api_key=${encodeURIComponent(apiKey)}`
                : `${apiUrl}?action=verify_license&format=html`;
              const shownKey = apiKey ? (keyShown ? apiKey : '•'.repeat(Math.min(32, apiKey.length))) : (isDemo ? 'Not available in the demo' : 'Loading…');
              return (<>
                <div className="wz-sec">
                  <div className="wz-cap">
                    <span>API key</span>
                    <button type="button" className="wz-link" data-tone="danger" onClick={regenKey} disabled={keyBusy || isDemo}
                      title="Makes a new key. The old one stops working right away.">{keyBusy ? 'Rotating…' : 'Rotate key'}</button>
                  </div>
                  <div className="wz-group">
                    <div className="wd-addr-row">
                      <span className="wd-addr-val wd-mono" style={{userSelect: keyShown ? 'all' : 'none'}}>{shownKey}</span>
                      <span className="wd-addr-icons">
                        <button type="button" className="wd-ibtn" onClick={() => setKeyShown(v => !v)} disabled={!apiKey}
                          aria-label={keyShown ? 'Hide key' : 'Show key'} title={keyShown ? 'Hide' : 'Show'}>
                          <WdIcon d={keyShown
                            ? <><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>
                            : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>}/>
                        </button>
                        {apiKey && <LicCopy text={apiKey} label="Copy key"/>}
                      </span>
                    </div>
                  </div>
                  <div className="wz-note">Your website sends this key to check whether a customer's license is active. Keep it private.</div>
                </div>

                <div className="wz-sec">
                  <div className="wz-cap"><span>Try it</span></div>
                  <div className="wz-group">
                    <button type="button" className="wz-row" data-ico="1"
                      onClick={() => bcOpenLicenseTest(testUrl)}>
                      <span className="wz-ico"><WzSvg name="check"/></span>
                      <span className="wz-row-txt">
                        <span className="wz-row-title">Open the test page</span>
                        <span className="wz-row-hint">Check any license in your browser. Your key is filled in.</span>
                      </span>
                      <WdIcon d={WD_ICON.out}/>
                    </button>
                    <button type="button" className="wz-row" data-ico="1"
                      onClick={() => { try { navigator.clipboard.writeText(testUrl); setLinkCopied(true); } catch (_) {} }}>
                      <span className="wz-ico"><WzSvg name="send"/></span>
                      <span className="wz-row-txt">
                        <span className="wz-row-title">{linkCopied ? 'Link copied' : 'Copy the test link'}</span>
                        <span className="wz-row-hint">Send it to whoever looks after your website.</span>
                      </span>
                      <WdIcon d={linkCopied ? <path d="M20 6 9 17l-5-5"/> : WD_ICON.copy}/>
                    </button>
                  </div>
                  <div className="wz-note">Limited to 60 checks a minute per key.</div>
                </div>
              </>);
            })()}

            <PopMore title="Developer details" sub="Endpoint, request, response">
            {/* Endpoint reference */}
            <div className="sset-pop-section">
              <div className="sset-pop-section-label">Endpoint</div>
              <div style={{padding:'9px 12px',background:'rgba(0,0,0,0.28)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:7,fontFamily:'var(--mono)',fontSize:11,color:'var(--t1)',wordBreak:'break-all',lineHeight:1.55}}>
                <span style={{color:'#5edd83',fontWeight:600,marginRight:8}}>GET</span>
                <span style={{color:'#3ec1d3',fontWeight:600,marginRight:8}}>POST</span>
                {apiUrl}?action=verify_license
              </div>
              <div style={{fontSize:10.5,color:'var(--t3)',marginTop:6,lineHeight:1.5}}>
                GET works in a browser. Use POST (or <span style={{fontFamily:'var(--mono)'}}>Accept: application/json</span>) to get JSON back.
              </div>
            </div>

            {/* Request samples — collapsed into a compact grid */}
            <div className="sset-pop-section">
              <div className="sset-pop-section-label">Request</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr',gap:8}}>
                <div>
                  <div style={{fontSize:10,color:'#8a8aa8',marginBottom:4,fontFamily:'var(--mono)'}}>Browser URL</div>
                  <pre style={{padding:'9px 12px',margin:0,background:'rgba(0,0,0,0.28)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:7,fontFamily:'var(--mono)',fontSize:10.5,color:'var(--t2)',lineHeight:1.55,overflow:'auto',whiteSpace:'pre-wrap',wordBreak:'break-all'}}>{`${apiUrl}?action=verify_license&api_key=YOUR_KEY&serial=ABCD-1234`}</pre>
                </div>
                <div>
                  <div style={{fontSize:10,color:'#8a8aa8',marginBottom:4,fontFamily:'var(--mono)'}}>JSON body (POST)</div>
                  <pre style={{padding:'9px 12px',margin:0,background:'rgba(0,0,0,0.28)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:7,fontFamily:'var(--mono)',fontSize:10.5,color:'var(--t2)',lineHeight:1.55,overflow:'auto'}}>{`{
  "api_key":     "YOUR_KEY",
  "username":    "alice",
  "serial":      "ABCD-1234",
  "email":       "a@b.com",
  "reveal":      false
}`}</pre>
                </div>
              </div>
              <div style={{fontSize:10.5,color:'var(--t3)',marginTop:6,lineHeight:1.5}}>
                Provide any one of <span style={{fontFamily:'var(--mono)',color:'var(--t2)'}}>username</span>, <span style={{fontFamily:'var(--mono)',color:'var(--t2)'}}>serial</span>, or <span style={{fontFamily:'var(--mono)',color:'var(--t2)'}}>email</span>. <span style={{fontFamily:'var(--mono)',color:'var(--t2)'}}>reveal:true</span> returns customer details (off by default).
              </div>
            </div>

            {/* Response */}
            <div className="sset-pop-section">
              <div className="sset-pop-section-label">Response (JSON)</div>
              <pre style={{padding:'9px 12px',margin:0,background:'rgba(0,0,0,0.28)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:7,fontFamily:'var(--mono)',fontSize:10.5,color:'var(--t2)',lineHeight:1.55,overflow:'auto'}}>{`{
  "ok": true,
  "valid": true,
  "status": "active",
  "product": { "name": "Pro Plan" },
  "purchased_at":   "2025-01-15 12:34:56",
  "expires_at":     "2026-01-15",
  "days_remaining": 254
}`}</pre>
            </div>

            {/* Footnote — rate limit + tip */}
            <div style={{padding:'9px 12px',background:'rgba(255,255,255,0.025)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:7,fontSize:10.5,color:'#8a8aa8',lineHeight:1.55}}>
              <strong style={{color:'var(--t2)'}}>Rate limit:</strong> 60 requests per minute, per API key. Exceeding returns HTTP 429.
            </div>
            </PopMore>
          </div>
        )}
      </div>
    </div>
  );
};

// Copy icon button used on the license page rows.
const LicCopy = ({text, label}) => {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1400); return () => clearTimeout(t); }, [done]);
  return (
    <button type="button" className="wd-ibtn" data-done={done ? '1' : undefined} aria-label={label} title={done ? 'Copied' : label}
      onClick={e => { e.preventDefault(); e.stopPropagation(); try { navigator.clipboard.writeText(String(text)); setDone(true); } catch (_) {} }}>
      <WdIcon d={done ? <path d="M20 6 9 17l-5-5"/> : WD_ICON.copy}/>
    </button>
  );
};

// ── LICENSE DETAIL POPUP ───────────────────────────────────────
// Compact editor for a single license row. Uses the same field aesthetic
// as the rest of the slideout sub-popups (.fi inputs, slim buttons, dim
// labels). All edits persist via update_end_user_purchase; the parent
// receives the patch back through onChange so the list stays in sync
// without a full reload.
const LicenseDetail = ({license, isDemo, onClose, onChange, onDelete}) => {
  const fmtDate = iso => iso ? (iso+'').slice(0,10) : '';
  const base = {
    status:     license.status     || 'active',
    expires_at: fmtDate(license.expires_at),
    serial_key: license.serial_key || '',
    username:   license.username   || '',
    notes:      license.notes      || '',
  };
  const [draft, setDraft] = React.useState(base);
  const [busy,  setBusy]  = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [err,   setErr]   = React.useState('');
  useSsetCrumb('Licenses', (license.customer_name || (license.customer_handle ? '@' + String(license.customer_handle).replace(/^@/, '') : 'Customer'))
    + (license.product_name ? ' · ' + license.product_name : ''), onClose);
  React.useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 1600); return () => clearTimeout(t); }, [saved]);
  const set = (k, v) => { setErr(''); setDraft(d => ({...d, [k]: v})); };

  const dirty = Object.keys(base).some(k => String(draft[k] || '') !== String(base[k] || ''));

  const save = async () => {
    if (isDemo || !dirty) return;
    setBusy(true); setErr('');
    const payload = { id: license.id };
    Object.keys(base).forEach(k => { if (String(draft[k] || '') !== String(base[k] || '')) payload[k] = draft[k] || ''; });
    const res = await apiFetch('update_end_user_purchase', payload);
    setBusy(false);
    if (res && res.error) { setErr(res.error); bcToast('Couldn’t save the license — ' + res.error, 'err'); return; }
    onChange({...draft});
    setSaved(true);
    bcToast('License saved', 'ok', { detail: license.product_name || undefined });
  };

  const del = async () => {
    if (isDemo) return;
    if (!window.confirm(`Delete this license for "${license.product_name||'this product'}"? This cannot be undone.`)) return;
    setBusy(true);
    const res = await apiFetch('delete_end_user_purchase', {id: license.id});
    setBusy(false);
    if (res && res.error) { setErr(res.error); bcToast('Couldn’t delete the license — ' + res.error, 'err'); return; }
    bcToast('License deleted', 'ok', { detail: license.product_name || undefined });
    onDelete();
  };

  const genSerial = () => {
    // Readable XXXX-XXXX-XXXX-XXXX key; no 0/1/O/I.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i=0;i<16;i++) bytes[i] = Math.floor(Math.random()*256);
    let out = '';
    for (let i=0;i<16;i++) { if (i && i%4 === 0) out += '-'; out += chars[bytes[i] % chars.length]; }
    set('serial_key', out);
  };

  // Expiry shortcuts extend from the later of today and the current expiry.
  const extend = (days) => {
    const cur = Date.parse((draft.expires_at || '') + 'T12:00:00');
    const from = isFinite(cur) && cur > Date.now() ? new Date(cur) : new Date();
    from.setDate(from.getDate() + days);
    set('expires_at', from.toISOString().slice(0,10));
  };

  const STATUS_LABEL = { active:'Active', expired:'Expired', cancelled:'Cancelled', suspended:'Suspended', pending:'Pending' };
  const STATUS_OPTS = ['active','suspended','cancelled','expired'].concat(base.status === 'pending' || draft.status === 'pending' ? ['pending'] : []);
  const expTs = draft.expires_at ? Date.parse(draft.expires_at + 'T23:59:59') : NaN;
  const eff = (draft.status === 'active' && isFinite(expTs) && expTs < Date.now()) ? 'expired' : draft.status;
  const dl  = isFinite(expTs) ? Math.floor((expTs - Date.now()) / 86400000) : null;
  const sKey = eff === 'active' && dl !== null && dl <= 14 ? 'expiring' : eff;

  const name = license.customer_name || (license.customer_handle ? '@' + String(license.customer_handle).replace(/^@/,'') : 'Unknown customer');
  const handle = license.customer_handle ? '@' + String(license.customer_handle).replace(/^@/,'') : '';
  const platform = license.platform ? String(license.platform).charAt(0).toUpperCase() + String(license.platform).slice(1) : '';
  const conv = license.conv_id && typeof MSGS_STORE !== 'undefined' ? MSGS_STORE.list.find(m => m.id === license.conv_id) : null;
  const openConv = () => { if (!conv) return; try { window.dispatchEvent(new CustomEvent('bc-open-conv', { detail: { msg: conv } })); } catch(_){} };

  // The payment that issued this license, when there is one: the server
  // row (amount, reference) plus the matching invoice, if it is still on
  // file, for the coin and transaction.
  const inv = license.payment_reference && typeof PAYMENTS_STORE !== 'undefined'
    ? (PAYMENTS_STORE.invoices || []).find(i => i.id === license.payment_reference) : null;
  const invTicker = inv ? String(inv.coin || '').split('/').pop().toUpperCase() : '';
  const paid = license.payment_amount
    ? `${license.payment_amount} ${license.payment_currency || ''}`.trim()
    : (inv && inv.amount_fiat ? `${inv.amount_fiat} ${inv.fiat || 'USD'}` : '');
  const txIn = inv ? (inv.txid || inv.txid_in || '') : '';

  const expiryText = dl === null ? 'No expiry'
    : dl < 0 ? `Expired ${Math.abs(dl)} day${Math.abs(dl)===1?'':'s'} ago`
    : dl === 0 ? 'Expires today'
    : `${dl} day${dl===1?'':'s'} left`;

  const initial = ((license.customer_name || license.customer_handle || '?').trim().charAt(0) || '?').toUpperCase();
  const pillLabel = sKey === 'expiring' ? 'Expiring soon' : (STATUS_LABEL[eff] || eff);
  const copyIcon = (text, label) => text ? <LicCopy text={text} label={label}/> : null;
  const expDate = draft.expires_at ? bcWhen(draft.expires_at, false) : '';

  return (
    <div className="slw-ed wd">
      <div className="sl-scroll wd-scroll">
        <div className="wd-body">

          <section className="wd-card" aria-label="License summary">
            <div className="wd-card-top">
              {license.customer_avatar
                ? <img className="wd-avatar" src={license.customer_avatar} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden'; }}/>
                : <span className="wd-avatar" aria-hidden="true">{initial}</span>}
              <span className="wd-card-id">
                <span className="wd-card-name">{name}</span>
                <span className="wd-card-sub">
                  <span className="wd-lic-pill" data-s={sKey}><i aria-hidden="true"/>{pillLabel}</span>
                  {(platform || (handle && handle !== name)) && <span className="wd-card-net">{[handle !== name ? handle : '', platform].filter(Boolean).join(', ')}</span>}
                </span>
              </span>
              <span className="wd-exp">
                <span className="wd-exp-big">{expiryText}</span>
                <span className="wd-exp-sub">{expDate ? `Until ${expDate}` : 'Lifetime access'}</span>
              </span>
            </div>
            <div className="wd-stats">
              <span><small>Product</small><strong title={license.product_name}>{license.product_name || `Product #${license.product_id}`}</strong></span>
              <span><small>{paid ? 'Paid' : 'List price'}</small><strong>{paid || license.product_price || '—'}</strong></span>
              <span><small>Purchased</small><strong>{bcWhen(license.purchased_at, false) || '—'}</strong></span>
            </div>
          </section>

          <div className="wz-sec">
            <div className="wz-cap"><span>Status</span></div>
            <WzSeg label="License status" value={draft.status} onChange={v => set('status', v)}
              options={STATUS_OPTS.map(st => ({value: st, label: STATUS_LABEL[st]}))}/>
            <div className="wz-note">
              {draft.status === 'active' ? 'Passes verification until it expires.'
                : draft.status === 'suspended' ? 'Verification fails until you make it active again.'
                : draft.status === 'cancelled' ? 'Permanently revoked.'
                : draft.status === 'expired' ? 'Verification fails. Set a new date and make it active to renew.'
                : 'Awaiting activation.'}
            </div>
          </div>

          <div className="wz-sec">
            <div className="wz-cap"><span>Expiry</span></div>
            <div className="wz-group" data-field="1">
              <label className="wz-row">
                <span className="wz-row-label">Expires</span>
                <input className="wz-input" type="date" value={draft.expires_at} aria-label="Expiry date"
                  onChange={e => set('expires_at', e.target.value)}/>
              </label>
              <div className="wd-quick" role="group" aria-label="Quick expiry">
                <button type="button" onClick={() => extend(30)}>+30 days</button>
                <button type="button" onClick={() => extend(90)}>+90 days</button>
                <button type="button" onClick={() => extend(365)}>+1 year</button>
                {draft.expires_at && <button type="button" onClick={() => set('expires_at', '')}>No expiry</button>}
              </div>
            </div>
            <div className="wz-note">Extending starts from today or the current expiry, whichever is later.</div>
          </div>

          {(license.allowSerial || draft.serial_key || license.allowUsername || draft.username) && (
            <div className="wz-sec">
              <div className="wz-cap"><span>Access</span></div>
              <div className="wz-group" data-field="1">
                {(license.allowSerial || draft.serial_key) && (
                  <div className="wz-row">
                    <span className="wz-row-label">Serial key</span>
                    <input className="wz-input wd-mono" value={draft.serial_key} spellCheck={false} aria-label="Serial key"
                      onChange={e => set('serial_key', e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX"/>
                    <button type="button" className="wd-ibtn" onClick={genSerial} aria-label="Generate a new key" title="Generate a new key">
                      <WdIcon d={WD_ICON.refresh}/>
                    </button>
                    {copyIcon(draft.serial_key, 'Copy serial key')}
                  </div>
                )}
                {(license.allowUsername || draft.username) && (
                  <label className="wz-row">
                    <span className="wz-row-label">Account</span>
                    <input className="wz-input" value={draft.username} spellCheck={false} aria-label="Linked account"
                      onChange={e => set('username', e.target.value)} placeholder="Username it is tied to"/>
                  </label>
                )}
              </div>
            </div>
          )}

          <div className="wz-sec">
            <div className="wz-cap"><span>Customer</span></div>
            <div className="wz-group">
              <div className="wz-row">
                <span className="wz-row-label">Name</span>
                <span className="wd-kv-val">{name}</span>
                {conv && <button type="button" className="wz-link" onClick={openConv} style={{marginLeft: 4}}>Open chat</button>}
              </div>
              {handle && handle !== name && (
                <div className="wz-row"><span className="wz-row-label">Username</span><span className="wd-kv-val">{handle}</span>{copyIcon(handle, 'Copy username')}</div>
              )}
              {platform && <div className="wz-row"><span className="wz-row-label">Platform</span><span className="wd-kv-val">{platform}</span></div>}
              {license.customer_email && (
                <div className="wz-row"><span className="wz-row-label">Email</span><span className="wd-kv-val">{license.customer_email}</span>{copyIcon(license.customer_email, 'Copy email')}</div>
              )}
              {license.customer_phone && (
                <div className="wz-row"><span className="wz-row-label">Phone</span><span className="wd-kv-val">{license.customer_phone}</span>{copyIcon(license.customer_phone, 'Copy phone')}</div>
              )}
            </div>
          </div>

          <div className="wz-sec">
            <div className="wz-cap"><span>Purchase</span></div>
            <div className="wz-group">
              <div className="wz-row"><span className="wz-row-label">Product</span>
                <span className="wd-kv-val">{license.product_name || `Product #${license.product_id}`}</span></div>
              {paid && <div className="wz-row"><span className="wz-row-label">Paid</span><span className="wd-kv-val">{paid}{inv ? <small>  in {invTicker}</small> : null}</span></div>}
              <div className="wz-row"><span className="wz-row-label">Purchased</span><span className="wd-kv-val">{bcWhen(license.purchased_at) || '—'}</span></div>
              {license.delivered_at && <div className="wz-row"><span className="wz-row-label">Delivered</span><span className="wd-kv-val">{bcWhen(license.delivered_at)}</span></div>}
              {txIn && (
                <div className="wz-row"><span className="wz-row-label">Transaction</span>
                  <span className="wd-kv-val wd-mono" title={txIn}>{bcShort(txIn)}</span>
                  {txExplorerUrl(inv.coin, txIn) && (
                    <button type="button" className="wd-ibtn" aria-label="View on explorer" title="View on explorer"
                      onClick={() => { try { window.open(txExplorerUrl(inv.coin, txIn), '_blank', 'noopener'); } catch (_) {} }}>
                      <WdIcon d={WD_ICON.out}/>
                    </button>
                  )}
                  {copyIcon(txIn, 'Copy transaction ID')}
                </div>
              )}
              {license.payment_reference && (
                <div className="wz-row"><span className="wz-row-label">Invoice</span><span className="wd-kv-val wd-mono" title={license.payment_reference}>{license.payment_reference}</span>{copyIcon(license.payment_reference, 'Copy invoice ID')}</div>
              )}
              <div className="wz-row"><span className="wz-row-label">License ID</span><span className="wd-kv-val wd-mono">#{license.id}</span>{copyIcon(String(license.id), 'Copy license ID')}</div>
            </div>
          </div>

          <div className="wz-sec">
            <div className="wz-cap"><span>Notes</span><small>Only your team sees these</small></div>
            <div className="wz-group" data-field="1">
              <textarea className="wz-textarea" value={draft.notes} aria-label="Internal notes"
                onChange={e => set('notes', e.target.value)} placeholder="Add a note"/>
            </div>
          </div>

          {err && <div className="wd-err" role="alert">{err}</div>}
        </div>
      </div>

      <div className="slw-foot">
        {!isDemo && <button type="button" className="slw-link-danger" onClick={del} disabled={busy}>Delete license</button>}
        <span className="slw-foot-sp"/>
        {saved && <span className="wd-saved">Saved</span>}
        {dirty && <button type="button" className="sset-btn" onClick={() => { setDraft(base); setErr(''); }}>Discard</button>}
        <button type="button" className="sset-btn" data-variant="primary" onClick={save}
          disabled={busy || isDemo || !dirty} title={!dirty ? 'No changes to save' : undefined}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );

};