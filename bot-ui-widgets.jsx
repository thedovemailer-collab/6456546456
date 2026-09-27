// ─────────────────────────────────────────────────────────────
// bot-ui-widgets.jsx
// Free-placement, post-it style widget board.
//
// Each widget:
//   • Has a fixed default size (cannot grow past it).
//   • Is resizable down to a per-widget minimum.
//   • Is draggable by its header (post-it board behavior).
//   • Lives in absolute coordinates within the board area.
//   • Uses muted, dim colors only (no bright saturated accents).
//
// Ghost docking reserve in the top-left is preserved.
// Persists positions/sizes/active set to localStorage.
//
// Exposes: window.WidgetDashboardOverlay, window.WidgetLauncherButton,
//          window.MinimalTicker
// ─────────────────────────────────────────────────────────────

const WIDGET_LS_KEY    = 'bc.dashboard.widgets.v8';
const WIDGET_LS_KEY_V7 = 'bc.dashboard.widgets.v7'; // migration source

// ── DUMMY DATA ───────────────────────────────────────────────
const W_CONTACTS = [
  { id:1, name:'Alex Chen',     handle:'@alexc',   online:true,  initials:'AC' },
  { id:2, name:'Nina Patel',    handle:'@ninap',   online:true,  initials:'NP' },
  { id:3, name:'Sam Rivera',    handle:'@samr',    online:false, initials:'SR' },
  { id:4, name:'Yuki Tanaka',   handle:'@yukit',   online:true,  initials:'YT' },
  { id:5, name:'Marco Bianchi', handle:'@marcob',  online:false, initials:'MB' },
  { id:6, name:'Priya Singh',   handle:'@priyas',  online:true,  initials:'PS' },
  { id:7, name:'Liam Walsh',    handle:'@liamw',   online:false, initials:'LW' },
  { id:8, name:'Zara Khan',     handle:'@zarak',   online:true,  initials:'ZK' },
];

// All "muted" — single low-saturation indigo with hue variation, never bright.
const MUTED_AVA = 'linear-gradient(135deg, rgba(150,148,200,0.32), rgba(110,108,160,0.42))';

const W_INBOX = [
  { id:1, name:'Alex Chen',  last:'will the licence work on a windows server too?', t:'2m',  tag:'customer',  unread:true  },
  { id:2, name:'Nina Patel', last:'sent a screenshot — agent stopped mid-reply',     t:'14m', tag:'support',   unread:true  },
  { id:3, name:'Sam Rivera', last:'thanks for the upgrade pricing',                  t:'48m', tag:'prospect',  unread:false },
  { id:4, name:'Yuki Tanaka',last:'are there volume discounts for 50+ seats?',       t:'1h',  tag:'prospect',  unread:false },
  { id:5, name:'Marco B.',   last:'just renewed for another year',                   t:'2h',  tag:'customer',  unread:false },
  { id:6, name:'Priya S.',   last:'invoice #1042 paid — confirming receipt',         t:'3h',  tag:'customer',  unread:false },
];

const W_FEED = [
  { id:1, name:'Internal Updates', handle:'@updates', initials:'IU', body:'Release 2.4 ships smoother typo recovery and per-platform tone profiles.', t:'12m' },
  { id:2, name:'Sales Team',       handle:'@sales',   initials:'ST', body:'Q2 closeout — Pro plan conversions up 28% week-over-week. Top region: APAC.', t:'1h' },
  { id:3, name:'Engineering',      handle:'@eng',     initials:'EN', body:'Telegram bridge throughput tuned. Median reply latency 720ms → 380ms.', t:'3h' },
  { id:4, name:'Product',          handle:'@product', initials:'PD', body:'Roadmap: dashboard widgets now live for everyone on Pro and above.', t:'5h' },
];

const W_CAL = [
  { h:'10:30', m:'AM', title:'Pipeline review',         sub:'Sales · Zoom' },
  { h:'12:00', m:'PM', title:'Lunch with Marco',        sub:'Renewal chat' },
  { h:'2:15',  m:'PM', title:'Agent realism deep-dive', sub:'Engineering · Meet' },
  { h:'4:30',  m:'PM', title:'1:1 with Priya',          sub:'Mentoring' },
];

// Seed data — Tasks list is now backed by a tiny pub/sub store so the
// ghost composer (and any other surface) can push new tasks into it and
// have the widget reflect them immediately. The store also auto-enables
// the Tasks widget if it isn't currently in the layout — see
// WidgetDashboardOverlay below for the wiring.
const W_TASKS_SEED = [
  { id:1, t:'Review Q3 pricing tier proposal', tag:'TODAY', done:false },
  { id:2, t:'Approve agent v2.4 rollout',      tag:'TODAY', done:false },
  { id:3, t:'Send renewal quote to Marco',     tag:'PIPE',  done:true  },
  { id:4, t:'Draft EU compliance brief',       tag:'WEEK',  done:false },
  { id:5, t:'Reply to Yuki re: volume tiers',  tag:'TODAY', done:false },
];

// Singleton — survives across remounts of TasksWidget. The ghost composer
// imports through window.__bcwTasks; same shape as the AUTH_STORE pattern
// elsewhere in the codebase (subs Set + notify).
const TASKS_STORE = {
  list: W_TASKS_SEED.map(t => ({...t})),
  _seq: 1000,
  subs: new Set(),
  sub(fn){ this.subs.add(fn); return ()=>this.subs.delete(fn); },
  notify(){ this.subs.forEach(fn => { try { fn(this.list); } catch(_){} }); },
  add({text, tag, due, assignee}){
    const t = {
      id: ++this._seq,
      t: String(text || '').trim() || 'Untitled task',
      tag: (tag || 'TODAY').toUpperCase().slice(0, 6),
      done: false,
      due: due || null,
      assignee: assignee || null,
      created: Date.now(),
    };
    // Newest first — matches user expectation when they just typed it.
    this.list = [t, ...this.list];
    this.notify();
    return t;
  },
  toggle(id){
    this.list = this.list.map(t => t.id === id ? {...t, done: !t.done} : t);
    this.notify();
  },
  complete(idOrMatch){
    let target = null;
    if (typeof idOrMatch === 'number') {
      target = this.list.find(t => t.id === idOrMatch);
    } else {
      const q = String(idOrMatch || '').toLowerCase();
      target = this.list.find(t => !t.done && t.t.toLowerCase().includes(q));
    }
    if (target) { target.done = true; this.list = [...this.list]; this.notify(); }
    return !!target;
  },
  remove(id){
    this.list = this.list.filter(t => t.id !== id);
    this.notify();
  },
};
if (typeof window !== 'undefined') window.__bcwTasks = TASKS_STORE;

const useTasks = () => {
  const [list, setList] = React.useState(TASKS_STORE.list);
  React.useEffect(() => TASKS_STORE.sub(setList), []);
  return list;
};

const W_PIPE = [
  { stage:'New',        count:14, value:18400 },
  { stage:'Qualified',  count:9,  value:32100 },
  { stage:'Proposal',   count:6,  value:48200 },
  { stage:'Negotiation',count:3,  value:62500 },
  { stage:'Closing',    count:2,  value:24800 },
];

const W_ASSISTANT = [
  { label:'Live agents',  val:'4',     meta:'2 idle' },
  { label:'Avg response', val:'380ms', meta:'-340 vs base' },
  { label:'Resolved 24h', val:'128',   meta:'83% auto' },
  { label:'Escalated',    val:'4',     meta:'2 pending' },
];

// 24h hourly revenue series
const W_REVENUE = [
  120,145,88,92,178,210,260,330,410,380,290,420,
  510,460,380,540,580,460,390,310,220,180,140,95,
];

// 7×24 activity heatmap
const W_HEAT = (() => {
  const rows = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return rows.map((r,ri) => Array.from({length:24}, (_,h)=>{
    const work = h>=9 && h<=18 ? 0.75 : 0.15;
    const wknd = ri>=5 ? 0.4 : 1;
    return Math.max(0, Math.min(1, (work*wknd) * (0.5 + Math.random()*0.7)));
  }));
})();

const W_CRYPTO_TX = [
  { id:101, asset:'BTC',  usd:248, status:'confirmed', customer:'Alex Chen',     pkg:'Pro Plan',         t:'2m'  },
  { id:102, asset:'USDC', usd:199, status:'confirmed', customer:'Nina Patel',    pkg:'Business Plan',    t:'14m' },
  { id:103, asset:'ETH',  usd:184, status:'pending',   customer:'Sam Rivera',    pkg:'Pro + AI Add-on',  t:'34m' },
  { id:104, asset:'BTC',  usd:489, status:'confirmed', customer:'Yuki Tanaka',   pkg:'Enterprise Seat',  t:'1h'  },
  { id:105, asset:'USDT', usd:79,  status:'confirmed', customer:'Marco Bianchi', pkg:'Annual Renewal',   t:'2h'  },
  { id:106, asset:'ETH',  usd:71,  status:'failed',    customer:'Liam Walsh',    pkg:'Starter Add-on',   t:'3h'  },
  { id:107, asset:'USDC', usd:299, status:'confirmed', customer:'Priya Singh',   pkg:'Business + Vision',t:'5h'  },
];

// Muted asset colors (never bright)
const ASSET_META = {
  BTC:  { col:'rgba(195,170,120,0.65)', sym:'₿' },
  ETH:  { col:'rgba(150,154,180,0.65)', sym:'Ξ' },
  USDC: { col:'rgba(140,160,190,0.65)', sym:'$' },
  USDT: { col:'rgba(140,180,150,0.65)', sym:'$' },
};

// ── ICONS ────────────────────────────────────────────────────
const WIcon = ({name, size=13}) => {
  const p = {width:size, height:size, viewBox:'0 0 24 24', fill:'none',
    stroke:'currentColor', strokeWidth:2, strokeLinecap:'round', strokeLinejoin:'round'};
  switch(name) {
    case 'msg':       return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
    case 'users':     return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case 'feed':      return <svg {...p}><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>;
    case 'clock':     return <svg {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case 'cloud':     return <svg {...p}><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>;
    case 'cal':       return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case 'sliders':   return <svg {...p}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>;
    case 'coins':     return <svg {...p}><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="M16.71 13.88l.7.71-2.82 2.82"/></svg>;
    case 'chart':     return <svg {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
    case 'check':     return <svg {...p}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
    case 'pipeline':  return <svg {...p}><path d="M3 6h18M6 12h12M9 18h6"/></svg>;
    case 'bot':       return <svg {...p}><rect x="4" y="6" width="16" height="14" rx="3"/><circle cx="9" cy="13" r="1.5" fill="currentColor"/><circle cx="15" cy="13" r="1.5" fill="currentColor"/><path d="M12 2v4"/><path d="M9 20v2M15 20v2"/></svg>;
    case 'grid':      return <svg {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>;
    case 'bell':      return <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
    case 'wallet':    return <svg {...p}><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>;
    case 'trend':     return <svg {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
    case 'alert':     return <svg {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
    case 'chev':      return <svg {...p}><polyline points="6 9 12 15 18 9"/></svg>;
    default: return null;
  }
};

// ── COMMON ───────────────────────────────────────────────────
const WHead = ({icon, title, meta, right, onMouseDown}) => (
  <div className="bcw-head" onMouseDown={onMouseDown}>
    <div className="bcw-icon"><WIcon name={icon} size={11}/></div>
    <div className="bcw-title">{title}</div>
    <div className="bcw-spacer"/>
    {meta && <div className="bcw-meta">{meta}</div>}
    {right}
  </div>
);

const Avatar = ({initials, size=26, dot, dotMuted=true}) => (
  <div style={{position:'relative', flexShrink:0}}>
    <div className="bcw-ava" style={{
      width:size, height:size, fontSize:Math.round(size*0.36),
      background: MUTED_AVA,
    }}>{initials}</div>
    {dot && <span style={{
      position:'absolute', bottom:-1, right:-1, width:7, height:7, borderRadius:'50%',
      background: dotMuted ? 'rgba(140,180,140,0.85)' : 'rgba(180,184,200,0.5)',
      boxShadow:'0 0 0 1.5px rgba(10,11,18,0.95)',
    }}/>}
  </div>
);

const WSparkline = ({data, w, h, color='rgba(180,184,200,0.65)'}) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const rng = (max - min) || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v,i) => `${i*step},${h - ((v-min)/rng)*(h-2)-1}`).join(' ');
  const areaPts = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:'block'}}>
      <polygon points={areaPts} fill={color} opacity="0.10"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

// ── INBOX (replaces messages) ──────────────────────────────
const InboxWidget = () => {
  const [tab, setTab] = React.useState('all');
  const filtered = React.useMemo(() => {
    if (tab === 'all') return W_INBOX;
    if (tab === 'unread') return W_INBOX.filter(i => i.unread);
    return W_INBOX.filter(i => i.tag === tab);
  }, [tab]);
  const unread = W_INBOX.filter(i => i.unread).length;
  return (
    <>
      <div className="bcw-body">
        <div className="bcw-inbox-tabs">
          <button className={`bcw-inbox-tab ${tab==='all'?'on':''}`} onClick={()=>setTab('all')}>All<span className="bcw-tab-count">{W_INBOX.length}</span></button>
          <button className={`bcw-inbox-tab ${tab==='unread'?'on':''}`} onClick={()=>setTab('unread')}>Unread<span className="bcw-tab-count">{unread}</span></button>
          <button className={`bcw-inbox-tab ${tab==='customer'?'on':''}`} onClick={()=>setTab('customer')}>Customer</button>
          <button className={`bcw-inbox-tab ${tab==='prospect'?'on':''}`} onClick={()=>setTab('prospect')}>Prospect</button>
        </div>
        {filtered.slice(0, 5).map(m => (
          <div key={m.id} className="bcw-row">
            <Avatar initials={m.name.split(' ').map(n=>n[0]).join('').slice(0,2)} size={26} dot={m.unread}/>
            <div className="bcw-row-main">
              <div className="bcw-row-name">{m.name}</div>
              <div className="bcw-row-sub"><BcPreviewText text={m.last}/></div>
            </div>
            <div className="bcw-row-time">{m.t}</div>
          </div>
        ))}
      </div>
    </>
  );
};

// ── PIPELINE ──────────────────────────────────────────────
const PipelineWidget = () => {
  const max = Math.max(...W_PIPE.map(p=>p.value));
  const total = W_PIPE.reduce((s,p)=>s+p.value, 0);
  return (
    <div className="bcw-body">
      <div className="bcw-rev-head">
        <div className="bcw-rev-total">${(total/1000).toFixed(1)}k</div>
        <div className="bcw-rev-delta">+12% vs last week</div>
      </div>
      <div className="bcw-rev-sub">{W_PIPE.reduce((s,p)=>s+p.count,0)} open deals</div>
      <div className="bcw-pipe">
        {W_PIPE.map(p => (
          <div key={p.stage} className="bcw-pipe-row">
            <div className="bcw-pipe-name">{p.stage}</div>
            <div className="bcw-pipe-bar">
              <div className="bcw-pipe-bar-fill" style={{
                width:`${(p.value/max)*100}%`,
                background:'linear-gradient(90deg, rgba(150,148,200,0.55), rgba(150,148,200,0.20))',
              }}/>
            </div>
            <div className="bcw-pipe-val">${(p.value/1000).toFixed(1)}k</div>
            <div className="bcw-pipe-count">{p.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── REVENUE (24h chart) ───────────────────────────────────
const RevenueWidget = () => {
  const total = W_REVENUE.reduce((s,v)=>s+v, 0);
  const max = Math.max(...W_REVENUE);
  return (
    <div className="bcw-body">
      <div className="bcw-rev-head">
        <div className="bcw-rev-total">${(total/1000).toFixed(2)}k</div>
        <div className="bcw-rev-delta">+18%</div>
      </div>
      <div className="bcw-rev-sub">Last 24h · {W_REVENUE.filter(v=>v>0).length} txns</div>
      <div style={{display:'flex', alignItems:'flex-end', gap:2, flex:1, minHeight:60, marginTop:4}}>
        {W_REVENUE.map((v,i)=>(
          <div key={i} style={{
            flex:1,
            height:`${(v/max)*100}%`,
            minHeight:2,
            borderRadius:'2px 2px 0 0',
            background:'linear-gradient(180deg, rgba(180,184,200,0.55), rgba(150,148,200,0.18))',
          }}/>
        ))}
      </div>
      <div style={{display:'flex', justifyContent:'space-between', marginTop:6,
        fontSize:8.5, fontFamily:'var(--bcw-mono)', color:'var(--bcw-t4)',
        letterSpacing:'0.05em'}}>
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>now</span>
      </div>
    </div>
  );
};

// ── ASSISTANT STATUS ─────────────────────────────────────
const AssistantWidget = () => (
  <div className="bcw-body">
    <div className="bcw-as-grid">
      {W_ASSISTANT.map(a => (
        <div key={a.label} className="bcw-as-cell">
          <div className="bcw-as-label">{a.label}</div>
          <div className="bcw-as-val">{a.val}</div>
          <div className="bcw-as-meta">{a.meta}</div>
        </div>
      ))}
    </div>
  </div>
);

// ── CONTACTS ─────────────────────────────────────────────
const ContactsWidget = () => (
  <div className="bcw-body">
    <div className="bcw-contact-grid">
      {W_CONTACTS.slice(0, 8).map(c => (
        <div key={c.id} className="bcw-contact-cell" title={c.name}>
          <Avatar initials={c.initials} size={28} dot={c.online}/>
          <div className="bcw-contact-name">{c.name.split(' ')[0]}</div>
        </div>
      ))}
    </div>
  </div>
);

// ── INTERNAL FEED ────────────────────────────────────────
const FeedWidget = () => (
  <div className="bcw-body">
    {W_FEED.slice(0, 3).map(f => (
      <div key={f.id} className="bcw-feed-item">
        <div className="bcw-feed-head">
          <Avatar initials={f.initials} size={20}/>
          <span className="bcw-feed-name">{f.name}</span>
          <span className="bcw-feed-handle">{f.handle}</span>
          <div style={{flex:1}}/>
          <span className="bcw-row-time">{f.t}</span>
        </div>
        <div className="bcw-feed-body" style={{WebkitLineClamp:2}}>{f.body}</div>
      </div>
    ))}
  </div>
);

// ── CALENDAR ─────────────────────────────────────────────
const CalendarWidget = () => (
  <div className="bcw-body">
    {W_CAL.map((e,i)=>(
      <div key={i} className="bcw-cal-event">
        <div className="bcw-cal-time">
          <div className="bcw-cal-time-h">{e.h}</div>
          <div className="bcw-cal-time-m">{e.m}</div>
        </div>
        <div className="bcw-cal-bar"/>
        <div className="bcw-cal-main">
          <div className="bcw-cal-title">{e.title}</div>
          <div className="bcw-cal-sub">{e.sub}</div>
        </div>
      </div>
    ))}
  </div>
);

// ── TASKS ────────────────────────────────────────────────
// Reads from TASKS_STORE so newly-created tasks (e.g. ones the ghost
// composer adds via window.__ghostCmd) appear immediately and survive
// remounts when the widget is hidden + re-enabled.
const TasksWidget = () => {
  const tasks = useTasks();
  const open = tasks.filter(t => !t.done).length;
  return (
    <div className="bcw-body">
      <div className="bcw-rev-sub" style={{marginBottom:6}}>{open} open · {tasks.length-open} done</div>
      {tasks.map(t => (
        <div key={t.id} className="bcw-task" data-done={t.done?'1':'0'} onClick={()=>TASKS_STORE.toggle(t.id)}>
          <div className="bcw-task-check"/>
          <div className="bcw-task-text">{t.t}</div>
          <div className="bcw-task-tag">{t.tag}</div>
        </div>
      ))}
    </div>
  );
};

// ── CRYPTO ───────────────────────────────────────────────
const CryptoWidget = () => {
  const total = W_CRYPTO_TX.filter(t=>t.status==='confirmed').reduce((s,t)=>s+t.usd, 0);
  const pending = W_CRYPTO_TX.filter(t=>t.status==='pending').length;
  const byAsset = {};
  W_CRYPTO_TX.forEach(t => {
    if (t.status==='confirmed') byAsset[t.asset] = (byAsset[t.asset]||0) + t.usd;
  });
  const totalAsset = Object.values(byAsset).reduce((s,v)=>s+v, 0) || 1;
  const sortedAssets = Object.entries(byAsset).sort((a,b)=>b[1]-a[1]);
  return (
    <div className="bcw-body">
      <div className="bcw-rev-head">
        <div className="bcw-crypto-total">${total.toLocaleString()}</div>
        <div className="bcw-rev-delta">{W_CRYPTO_TX.length} txns</div>
      </div>
      <div className="bcw-crypto-sub">{pending} pending · 24h</div>
      <div className="bcw-crypto-stack">
        {sortedAssets.map(([a, v]) => (
          <div key={a} className="bcw-crypto-stack-seg" title={`${a} · $${v}`}
            style={{flex:v, background:ASSET_META[a]?.col || 'rgba(180,184,200,0.5)'}}/>
        ))}
      </div>
      <div className="bcw-crypto-stack-legend">
        {sortedAssets.map(([a, v]) => (
          <span key={a}>
            <span className="bcw-dot" style={{background:ASSET_META[a]?.col}}/>
            {a} · {Math.round(v/totalAsset*100)}%
          </span>
        ))}
      </div>
      <div style={{borderTop:'0.5px solid var(--bcw-stroke-soft)', paddingTop:4, marginTop:8}}>
        {W_CRYPTO_TX.slice(0, 3).map(t => (
          <div key={t.id} className="bcw-row">
            <div className="bcw-asset-pill">
              <span style={{fontWeight:700}}>{ASSET_META[t.asset]?.sym}</span> {t.asset}
            </div>
            <div className="bcw-row-main">
              <div className="bcw-row-name">{t.customer}</div>
              <div className="bcw-row-sub">{t.pkg}</div>
            </div>
            <div style={{textAlign:'right', flexShrink:0}}>
              <div style={{fontSize:11, fontFamily:'var(--bcw-mono)', color:'var(--bcw-t1)', fontWeight:500}}>
                ${t.usd}
              </div>
              <div style={{display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end', marginTop:1}}>
                <span className="bcw-dot" style={{
                  background: t.status==='confirmed' ? 'rgba(140,180,140,0.7)'
                    : t.status==='pending' ? 'rgba(195,170,120,0.7)'
                    : 'rgba(200,135,125,0.7)',
                  width:5, height:5,
                }}/>
                <span style={{fontSize:8.5, fontFamily:'var(--bcw-mono)', color:'var(--bcw-t4)', textTransform:'uppercase', letterSpacing:'0.05em'}}>
                  {t.t}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── CLOCK ────────────────────────────────────────────────
const ClockWidget = () => {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(()=>{
    const id = setInterval(()=>setNow(new Date()), 15000);
    return ()=>clearInterval(id);
  },[]);
  const time = now.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  const date = now.toLocaleDateString([], {weekday:'long', month:'short', day:'numeric'});
  return (
    <div className="bcw-body" style={{justifyContent:'flex-end'}}>
      <div className="bcw-clock-time">{time}</div>
      <div className="bcw-clock-date">{date}</div>
    </div>
  );
};

// ── WEATHER (with hourly strip) ──────────────────────────
const WeatherWidget = () => {
  const hours = [
    {t:'NOW', v:'68°'},
    {t:'1PM', v:'70°'},
    {t:'2PM', v:'71°'},
    {t:'3PM', v:'70°'},
    {t:'4PM', v:'68°'},
  ];
  return (
    <div className="bcw-body" style={{justifyContent:'flex-end'}}>
      <div className="bcw-weather-temp">68°</div>
      <div className="bcw-weather-desc">Partly cloudy</div>
      <div className="bcw-weather-loc">San Francisco</div>
      <div className="bcw-weather-strip">
        {hours.map(h => (
          <div key={h.t} className="bcw-weather-hour">
            <div className="bcw-weather-hour-t">{h.t}</div>
            <div className="bcw-weather-hour-v">{h.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── ACTIVITY HEATMAP (7×24) ─────────────────────────────
const ActivityWidget = () => {
  const labels = ['M','T','W','T','F','S','S'];
  return (
    <div className="bcw-body">
      <div className="bcw-rev-sub" style={{marginBottom:8}}>Last 7 days · per-hour activity</div>
      {W_HEAT.map((row, ri) => (
        <div key={ri} style={{display:'flex', alignItems:'center', gap:6, marginBottom:3}}>
          <div style={{width:10, fontSize:8.5, color:'var(--bcw-t4)', fontFamily:'var(--bcw-mono)', flexShrink:0}}>{labels[ri]}</div>
          <div className="bcw-heat" style={{flex:1}}>
            {row.map((v, hi) => (
              <div key={hi} className="bcw-heat-cell" style={{
                background:`rgba(150,148,200,${0.05 + v*0.40})`,
                borderColor:`rgba(255,255,255,${0.02 + v*0.04})`,
              }} title={`${labels[ri]} ${hi}:00 · ${Math.round(v*100)}%`}/>
            ))}
          </div>
        </div>
      ))}
      <div style={{display:'flex', justifyContent:'space-between', marginTop:8,
        fontSize:8, fontFamily:'var(--bcw-mono)', color:'var(--bcw-t4)', letterSpacing:'0.05em'}}>
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
    </div>
  );
};

// ── REGISTRY ─────────────────────────────────────────────
//
// Each widget has:
//   default (w, h)  — initial size, also the MAX (cannot grow past)
//   min     (w, h)  — minimum resizable size
const WIDGETS = {
  inbox:     { name:'Inbox',           desc:'Conversations, filters by stage',  icon:'msg',      default:{w:340,h:300}, min:{w:240,h:180}, render:InboxWidget },
  pipeline:  { name:'Sales Pipeline',  desc:'Open deals by stage with values',  icon:'pipeline', default:{w:340,h:240}, min:{w:240,h:180}, render:PipelineWidget },
  revenue:   { name:'Revenue (24h)',   desc:'Hourly revenue chart',             icon:'chart',    default:{w:340,h:200}, min:{w:240,h:160}, render:RevenueWidget },
  assistant: { name:'Assistant Status',desc:'Live agent metrics',               icon:'bot',      default:{w:280,h:180}, min:{w:240,h:140}, render:AssistantWidget },
  contacts:  { name:'Contacts',        desc:'Frequent contacts',                icon:'users',    default:{w:300,h:200}, min:{w:220,h:160}, render:ContactsWidget },
  feed:      { name:'Internal Feed',   desc:'Team posts',                       icon:'feed',     default:{w:340,h:240}, min:{w:240,h:180}, render:FeedWidget },
  calendar:  { name:'Calendar',        desc:'Today\'s events',                  icon:'cal',      default:{w:280,h:240}, min:{w:220,h:180}, render:CalendarWidget },
  tasks:     { name:'Tasks',           desc:'Today\'s checklist',               icon:'check',    default:{w:280,h:260}, min:{w:220,h:180}, render:TasksWidget },
  crypto:    { name:'Crypto Payments', desc:'Recent on-chain transactions',     icon:'coins',    default:{w:340,h:280}, min:{w:260,h:200}, render:CryptoWidget },
  clock:     { name:'Clock',           desc:'Time and date',                    icon:'clock',    default:{w:200,h:140}, min:{w:160,h:120}, render:ClockWidget },
  weather:   { name:'Weather',         desc:'Now + hourly forecast',            icon:'cloud',    default:{w:240,h:180}, min:{w:200,h:140}, render:WeatherWidget },
  activity:  { name:'Activity Heatmap',desc:'7×24 activity density',            icon:'grid',     default:{w:340,h:220}, min:{w:260,h:160}, render:ActivityWidget },
};

// ── DEFAULT LAYOUT (free-placement coordinates) ──────────
// Three-column-ish grid sized for ~1280-1700px wide stages. Top-left
// ~320px reserved for the ghost. Y-rows are sized to clear the tallest
// widget in the previous row + a 20px gutter, so nothing overlaps on
// first paint.
const DEFAULT_LAYOUT = [
  // Row 1
  { key:'revenue',   x: 360, y:  10, w:340, h:200 },
  { key:'pipeline',  x: 720, y:  10, w:340, h:240 },
  { key:'crypto',    x:1080, y:  10, w:340, h:280 },
  // Row 2 — clears 280 + 20
  { key:'inbox',     x: 360, y: 310, w:340, h:300 },
  { key:'contacts',  x: 720, y: 270, w:300, h:200 },
  { key:'weather',   x:1040, y: 310, w:240, h:180 },
  { key:'tasks',     x:1300, y: 310, w:280, h:260 },
  // Row 3
  { key:'assistant', x: 720, y: 490, w:280, h:180 },
  { key:'calendar',  x:1020, y: 510, w:280, h:240 },
  { key:'feed',      x: 360, y: 630, w:340, h:240 },
  // Row 4
  { key:'activity',  x: 720, y: 690, w:340, h:220 },
  { key:'clock',     x:1080, y: 770, w:200, h:140 },
];

// Returns true if rectangle a (x,y,w,h) overlaps rectangle b. Used by
// sanitize() and toggle() to find a non-colliding spot when the user
// adds a widget back to the board.
const bcwOverlaps = (a, b) => !(
  a.x + a.w + 4 <= b.x || b.x + b.w + 4 <= a.x ||
  a.y + a.h + 4 <= b.y || b.y + b.h + 4 <= a.y
);

// ── bcwGetGhostBoardRect ────────────────────────────────────────────────────
// Returns the ghost's bounding rect in board-relative pixel coordinates,
// with a generous padding so new widgets don't crowd the ghost.
// Returns null when the ghost is at its dock (not user-moved) because the
// CSS reserve at left:12 top:12 is already excluded by X_START=340 below.
const bcwGetGhostBoardRect = (boardEl) => {
  try {
    const ctl = window.__ghostCtl;
    if (!ctl || !ctl.isUserMoved) return null; // ghost at dock — CSS reserve handles it
    const sr = ctl.getScreenRect();
    if (!sr) return null;
    const br = boardEl ? boardEl.getBoundingClientRect()
                       : { left: 0, top: 0 };
    const PAD = 40; // extra breathing room around the ghost
    return {
      x: (sr.left - br.left) - PAD,
      y: (sr.top  - br.top)  - PAD,
      w: (sr.right - sr.left) + PAD * 2,
      h: (sr.bottom - sr.top) + PAD * 2,
    };
  } catch (_) { return null; }
};

// ── bcwFindFreeSlot ─────────────────────────────────────────────────────────
// Find a free (x,y) slot for a new widget of size (w,h). Coarse grid scan
// biased toward top-left of the board, skipping the ghost CSS reserve zone
// (hardcoded as the first 320px from the left) and any extra exclusions
// (e.g. the ghost's actual board-relative rect when user has moved it).
// `extras` is an optional array of {x,y,w,h} rects to also avoid.
const bcwFindFreeSlot = (w, h, others, extras = []) => {
  const STEP    = 20;
  // X_START skips the ghost CSS reserve (left:12, width:220 + padding).
  // When the ghost is at its dock this is always sufficient.
  const X_START = 340;
  const X_END   = 1700;
  const Y_END   = 1400;
  const obstacles = [...others, ...extras.filter(Boolean)];
  for (let y = 10; y < Y_END; y += STEP) {
    for (let x = X_START; x < X_END - w; x += STEP) {
      const rect = { x, y, w, h };
      if (!obstacles.some(o => bcwOverlaps(rect, o))) return { x, y };
    }
    // Also try left of X_START on each row (only matters when ghost is
    // user-moved away from the top-left corner).
    if (extras.length > 0) {
      for (let x = 10; x < X_START; x += STEP) {
        const rect = { x, y, w, h };
        if (!obstacles.some(o => bcwOverlaps(rect, o))) return { x, y };
      }
    }
  }
  // Fallback: stagger past rightmost widget
  return { x: X_START + (others.length % 5) * 30, y: 20 + (others.length % 7) * 30 };
};

// ── DRAG/RESIZE HOOKS ────────────────────────────────────
const useDragOrResize = (item, onUpdate, mode) => {
  const start = React.useRef(null);
  const onDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    start.current = {
      mx: e.clientX, my: e.clientY,
      x: item.x, y: item.y, w: item.w, h: item.h,
      mode,
    };
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      if (!start.current) return;
      const dx = ev.clientX - start.current.mx;
      const dy = ev.clientY - start.current.my;
      onUpdate(start.current, dx, dy);
    };
    const onUp = () => {
      start.current = null;
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onUpdate(null); // signal end
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return onDown;
};

// ── WIDGET CARD ──────────────────────────────────────────
const WidgetCard = ({item, editing, onRemove, onUpdate, boardRef, zIndex, onFocus}) => {
  const def = WIDGETS[item.key];
  if (!def) return null;
  const Render = def.render;
  const [active, setActive] = React.useState(null); // 'drag' | 'resize' | null

  const handleMove = (mode) => (startData, dx, dy) => {
    if (startData === null) {
      setActive(null);
      onUpdate(item.key, null, true); // commit
      return;
    }
    setActive(mode);
    if (mode === 'drag') {
      const board = boardRef.current?.getBoundingClientRect();
      const maxX = (board?.width  || 1200) - startData.w;
      const maxY = (board?.height || 700)  - startData.h;
      const nx = Math.max(0, Math.min(maxX, startData.x + dx));
      const ny = Math.max(0, Math.min(maxY, startData.y + dy));
      onUpdate(item.key, { x: nx, y: ny });
    } else if (mode === 'resize') {
      // Cannot grow beyond default. Can shrink to min.
      const nw = Math.max(def.min.w, Math.min(def.default.w, startData.w + dx));
      const nh = Math.max(def.min.h, Math.min(def.default.h, startData.h + dy));
      onUpdate(item.key, { w: nw, h: nh });
    }
  };

  const onHeadDown = useDragOrResize(item, handleMove('drag'), 'drag');
  const onResizeDown = useDragOrResize(item, handleMove('resize'), 'resize');

  return (
    <div
      className={`bcw-card ${editing ? 'bcw-editing' : ''}`}
      data-screen-label={`widget:${item.key}`}
      data-dragging={active==='drag' ? '1' : '0'}
      data-resizing={active==='resize' ? '1' : '0'}
      style={{
        left: item.x, top: item.y,
        width: item.w, height: item.h,
        zIndex: zIndex,
      }}
      onMouseDown={onFocus}
    >
      {editing && (
        <button
          className="bcw-card-x"
          onClick={(e) => { e.stopPropagation(); onRemove(item.key); }}
          title="Remove widget"
        >×</button>
      )}
      <WHead
        icon={def.icon}
        title={def.name}
        onMouseDown={onHeadDown}
      />
      <Render/>
      <div className="bcw-resize-h" onMouseDown={onResizeDown} title="Resize"/>
    </div>
  );
};

// ── EDIT PANEL ───────────────────────────────────────────
const WidgetEditPanel = ({layout, onToggle, onClose, onClearAll, onResetDefault}) => {
  const enabled = new Set(layout.map(l => l.key));
  return (
    <div className="bcw-edit-panel" onClick={e=>e.stopPropagation()}>
      <div className="bcw-edit-head">
        <WIcon name="sliders" size={13}/>
        <div className="bcw-edit-title">Widgets</div>
        <button className="bcw-edit-done" onClick={onClose}>Done</button>
      </div>
      <div className="bcw-edit-list">
        {Object.entries(WIDGETS).map(([key, w]) => {
          const on = enabled.has(key);
          return (
            <div key={key} className="bcw-edit-item" onClick={()=>onToggle(key)}>
              <div className="bcw-edit-icon"><WIcon name={w.icon} size={13}/></div>
              <div className="bcw-edit-text">
                <div className="bcw-edit-name">{w.name}</div>
                <div className="bcw-edit-desc">{w.desc}</div>
              </div>
              <div className="bcw-edit-tgl" data-on={on?'1':'0'}/>
            </div>
          );
        })}
      </div>
      <div className="bcw-edit-foot">
        <span className="bcw-edit-mini">{layout.length} of {Object.keys(WIDGETS).length} on</span>
        <div style={{display:'flex', gap:14}}>
          <button className="bcw-edit-mini" onClick={onClearAll}>Clear</button>
          <button className="bcw-edit-mini" style={{color:'rgba(180,184,200,0.95)'}} onClick={onResetDefault}>Reset</button>
        </div>
      </div>
    </div>
  );
};

// ── MINIMAL TICKER ───────────────────────────────────────
const MinimalTicker = ({lines, lineIdx, fade, currentLine}) => {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(()=>{
    const id = setInterval(()=>setNow(new Date()), 60000);
    return ()=>clearInterval(id);
  },[]);
  return (
    <div className="bcw-ticker" data-ghost-ui="briefing">
      <span className="bcw-ticker-pulse"/>
      <span className="bcw-ticker-label">Briefing</span>
      <span className="bcw-ticker-divider"/>
      <span className="bcw-ticker-line" style={{opacity:fade?1:0}}>{currentLine}</span>
      <span className="bcw-ticker-divider"/>
      <span className="bcw-ticker-time">{now.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</span>
    </div>
  );
};

// ── GHOST COMPOSER ───────────────────────────────────────
// The wavy-bottomed input the ghost speaks through. Rendered inside the
// widget overlay so it lives in the same coordinate space as the ghost
// docking reserve and inherits the same mode-driven repositioning.
//
// Positioning rules:
//   • In 'centered' mode it sits below the ghost reserve at the center
//     of the board (default visible at low opacity — feels like a calm
//     command surface).
//   • In 'docked' mode it hides until the cursor enters the ghost's
//     proximity zone (or the user presses ⌘K / ⌃K).
//
// Submission flow:
//   • Calls window.__ghostCmd(text, ctx) — populated by bot-engine.jsx —
//     and dispatches the [[ACTION:…]] sentinels the engine returns.
//   • Destructive verbs come back wrapped in a confirm-nonce flow which
//     swaps the input row for a Confirm / Cancel strip.
//   • Ghost emotion choreography is driven by window.__ghostCtl.
// The "ask the ghost" line and the rotating "try: …" hints that used to sit
// under the ghost have been removed — the ghost itself is the way in (click
// it), and so are ⌘K / ⌃K and simply starting to type on the dashboard. All
// three go through this one helper so they can't drift apart. A typed
// character is carried across so the sentence starts in the chat intact.
const openGhostChatFromBoard = (seedChar) => {
  if (seedChar) { try { seedGhostInput(seedChar); } catch(_){} }
  try { window.dispatchEvent(new CustomEvent('bcw:ghost-click', {detail:{via:'composer'}})); } catch(_){}
};

// Width budget for the live-mode floating text. We measure the typed
// content with a hidden span so the input can grow with what's typed
// without ever overflowing. Centralised so the JSX stays tidy.
const measureTextWidth = (text, font) => {
  if (typeof document === 'undefined') return 0;
  const c = measureTextWidth._c || (measureTextWidth._c = document.createElement('canvas'));
  const ctx = c.getContext('2d');
  ctx.font = font;
  return ctx.measureText(text || '').width;
};

// ── TYPING-DRIVEN EMOTION CLASSIFIER ─────────────────────
// Lightweight client-side classifier — no LLM round trip. Maps the
// current input text to a target emotion + mood-ring HSL so the ghost
// reacts in real time as the user types. The mood ring is a CSS
// variable triplet pushed onto .bcw-board so the composer underline,
// caret tint, and reply chip color can all morph together.
//
// Categories (priority order — higher rules win):
//   1. destructive intent (refund/revoke/cancel/delete) → determined
//   2. punctuation cues   (!! → surprised, ?? → suspicious)
//   3. greetings / thanks → happy
//   4. long unbroken word → thinking
//   5. ALL CAPS shouting  → surprised
//   6. empty + idle 8s    → sleepy
//   7. default            → chill / listening
const GHOST_MOOD_BY_EMOTION = {
  // hue / saturation / lightness / alpha for the underline glow + tint
  chill:       { h: 250, s: 20,  l: 68, a: 0.55 },
  listening:   { h: 245, s: 28,  l: 70, a: 0.62 },
  thinking:    { h: 220, s: 22,  l: 65, a: 0.55 },
  happy:       { h: 145, s: 30,  l: 70, a: 0.65 },
  laughing:    { h: 150, s: 38,  l: 72, a: 0.70 },
  sad:         { h: 215, s: 18,  l: 60, a: 0.45 },
  angry:       { h:   8, s: 38,  l: 60, a: 0.65 },
  determined:  { h:  30, s: 28,  l: 65, a: 0.62 },
  surprised:   { h: 195, s: 32,  l: 72, a: 0.70 },
  suspicious:  { h: 280, s: 22,  l: 60, a: 0.55 },
  sleepy:      { h: 240, s: 12,  l: 55, a: 0.30 },
  embarrassed: { h: 340, s: 30,  l: 72, a: 0.55 },
  scared:      { h: 270, s: 26,  l: 62, a: 0.55 },
  love:        { h: 340, s: 38,  l: 75, a: 0.65 },
};

const classifyTypingEmotion = (text, opts) => {
  opts = opts || {};
  const focused  = !!opts.focused;
  const idleMs   = +opts.idleMs || 0;
  const t = (text || '').trim();
  if (!t) {
    if (focused && idleMs > 8000) return 'sleepy';
    return focused ? 'listening' : 'chill';
  }
  const low = t.toLowerCase();
  // 1. destructive intent
  if (/\b(refund|revoke|cancel|delete|remove|kill|wipe|erase|terminate|destroy)\b/.test(low)) {
    return 'determined';
  }
  // 2. emphatic punctuation
  if (/!{2,}/.test(t) || /\bwow\b|\bomg\b|\bwhoa\b/.test(low)) return 'surprised';
  if (/\?{2,}/.test(t)) return 'suspicious';
  // 3. greetings / gratitude
  if (/^(hi|hey|hello|yo|sup|morning|gm|good\s+\w+)\b/.test(low)) return 'happy';
  if (/\b(thanks|thank\s+you|thx|ty|appreciate|please|love\s+(it|that)|nice|awesome|great|good\s+job|amazing)\b/.test(low)) return 'happy';
  // 4. confused / asking
  if (/^(how|why|what|when|where|who)\b/.test(low) || /\?$/.test(t)) return 'thinking';
  // 5. ALL CAPS shouting (length >=4 chars, all letters upper)
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) return 'surprised';
  // 6. long unbroken word
  if (/\S{20,}/.test(t)) return 'thinking';
  // 7. negative sentiment
  if (/\b(sorry|broken|bug|error|fail|wrong|stupid|hate)\b/.test(low)) return 'sad';
  // default while focused/typing
  return 'listening';
};

const GhostComposer = ({mode, boardRef, onLayoutAction}) => {
  const composerRef = React.useRef(null);
  // No visible input any more (see openGhostChatFromBoard). The ref stays
  // because the confirm / error paths below still null-check it.
  const inputRef    = React.useRef(null);
  const [text, setText]       = React.useState('');
  const [state, setState]     = React.useState('idle'); // idle|near|focused|sending|success|error
  const [status, setStatus]   = React.useState({kind:'', msg:''});
  const [confirm, setConfirm] = React.useState(null); // {nonce, summary, sub, verb, attrs}
  // Reply chip — last spoken line from the ghost. Auto-fades after a beat.
  const [reply, setReply]     = React.useState({msg:'', kind:'info', show:false});
  const replyTimerRef  = React.useRef(null);
  // Saved reply for focus-restore: when the window blurs we freeze the chip
  // so it doesn't time out while the operator is away. On refocus we restore
  // it if still within the grace window (90 s); after that it silently expires.
  const savedReplyRef  = React.useRef(null);  // {msg, kind, remainingMs, blurAt}
  const REPLY_MAX_AWAY_MS = 90_000;
  // Session id for LLM memory. Persisted in IDB_STORE (IndexedDB) so it
  // survives Ctrl+Shift+Z / tab close / LS wipes. Falls back to sessionStorage
  // for environments where IDB is blocked. Tab-scoped via per-tab random suffix
  // stored in sessionStorage so tabs don't share the same session ID.
  const sessionIdRef = React.useRef(null);
  if (sessionIdRef.current === null) {
    // Synchronous read from sessionStorage for the tab-local pointer.
    let sid = '';
    try { sid = sessionStorage.getItem('bcw.ghost.session') || ''; } catch (_) {}
    sessionIdRef.current = sid; // Will be overwritten by IDB read below if different
    // Async IDB read — updates the ref once resolved. The first LLM call
    // is deferred anyway (user has to type something) so this race is benign.
    if (typeof IDB_STORE !== 'undefined') {
      IDB_STORE.get('ghost.session').then(v => {
        if (v && typeof v === 'string') {
          sessionIdRef.current = v;
          try { sessionStorage.setItem('bcw.ghost.session', v); } catch (_) {}
        }
      }).catch(() => {});
    }
  }
  // Tracks last keystroke time for sleepy / idle emotion
  const lastKeyTimeRef    = React.useRef(0);

  const emotionDebounceRef = React.useRef(null);
  const lastEmotionRef     = React.useRef('chill');
  const sendingLockRef     = React.useRef(false);
  // Whether component is still mounted — prevents state updates after unmount
  const mountedRef         = React.useRef(true);
  // Cleanup ref for flashStatus timer (prevents leaked timeouts on rapid submits)
  const statusTimerRef     = React.useRef(null);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Release lock on unmount so remount doesn't start permanently stuck.
      sendingLockRef.current = false;
      if (replyTimerRef.current)  clearTimeout(replyTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      if (emotionDebounceRef.current) clearTimeout(emotionDebounceRef.current);
    };
  }, []);
  // Live mode = user is engaged (focused, typing, sending, just-replied).
  // Drives the "dissolve the box, float the text under the ghost" look.
  const live = (
    state === 'focused' || state === 'sending' ||
    state === 'success' || state === 'error'   ||
    !!confirm || (text && text.length > 0)
  );

  // ── PROXIMITY DETECTION ─────────────────────────────────
  // Single mousemove on the board; we toggle [data-bcw-state="near"]
  // when the cursor enters an inflated rect around the composer + ghost.
  React.useEffect(() => {
    const PAD_X = 200;
    const PAD_Y = 160;
    let near = false;
    const onMove = (e) => {
      const c = composerRef.current;
      if (!c) return;
      const reserve = document.querySelector('.bcw-ghost-reserve');
      const rr = reserve ? reserve.getBoundingClientRect() : c.getBoundingClientRect();
      const r  = c.getBoundingClientRect();
      const haveComposer = r.width > 4 && r.height > 4;
      const top    = Math.min(rr.top,    haveComposer ? r.top    : rr.top)    - PAD_Y;
      const bottom = Math.max(rr.bottom, haveComposer ? r.bottom : rr.bottom) + PAD_Y;
      const left   = Math.min(rr.left,   haveComposer ? r.left   : rr.left)   - PAD_X;
      const right  = Math.max(rr.right,  haveComposer ? r.right  : rr.right)  + PAD_X;
      const inside = e.clientX >= left && e.clientX <= right && e.clientY >= top && e.clientY <= bottom;
      if (inside !== near) {
        near = inside;
        setState(prev => {
          if (prev === 'focused' || prev === 'sending' || prev === 'success' || prev === 'error') return prev;
          return inside ? 'near' : 'idle';
        });
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // ── HOTKEY: ⌘K / ⌃K — focus from anywhere ──────────────
  // Also: type-anywhere-on-dashboard. If the user starts typing while
  // the dashboard is in view and nothing else is focused, redirect the
  // keystroke into the ghost composer so the floating text just appears
  // under the ghost as they type. Matches the "no boxy composer" intent.
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        const t = e.target;
        const tn = t && t.tagName;
        if (tn === 'INPUT' || tn === 'TEXTAREA' || (t && t.isContentEditable)) {
          if (t !== inputRef.current) return;
        }
        e.preventDefault();
        // Straight into the ghost chat — there is no board input to focus
        // any more. Only while the dashboard is on screen, same as before
        // (the old input was display:none behind an open chat).
        if (document.body.getAttribute('data-bcw-hidden') === '1') return;
        openGhostChatFromBoard();
        return;
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current.blur();
        return;
      }
      // Type-anywhere capture. Only fire when:
      //   • a printable character was pressed (not modifier-only),
      //   • no input/textarea/contentEditable is currently focused,
      //   • the dashboard board is on screen,
      //   • no popup or sheet has its own focus trap (we use document.activeElement),
      //   • not a navigation/system key.
      const t = e.target;
      const ae = document.activeElement;
      const aeTag = ae && ae.tagName;
      const inField = aeTag === 'INPUT' || aeTag === 'TEXTAREA' || (ae && ae.isContentEditable);
      if (inField) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Single printable char (letters/numbers/punctuation/space).
      if (e.key.length !== 1) return;
      // Need the dashboard to be visible & the composer mounted.
      if (!composerRef.current) return;
      // GhostComposer lives inside .bcw-composer-layer which is a SIBLING of
      // .bcw-board — closest('.bcw-board') returns null. Use boardRef instead.
      if (document.body.getAttribute('data-bcw-hidden') === '1') return;
      const board = (boardRef && boardRef.current) || document.querySelector('.bcw-board');
      if (!board) return;
      const r = board.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      // OK — redirect. Opens the ghost chat and carries this first
      // character across (it used to be swallowed by the hidden trigger,
      // so a sentence typed on the board lost its first letter).
      e.preventDefault();
      openGhostChatFromBoard(e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── CLICK-ON-GHOST → open the full ghost chat ───────────
  // PREVIOUSLY: clicking the ghost focused this composer, so the entire
  // conversation happened through a one-line floating input with replies
  // shown as a chip that faded after a few seconds. Nothing was kept.
  //
  // NOW: the click is owned by MsgList, which opens a real GhostChat view
  // (persistent thread, scrollback, inline confirms). We deliberately do
  // NOT focus the composer here any more — doing both would fight for
  // focus with the chat's textarea the moment the pane mounts.
  //
  // The composer is still fully functional for quick one-off commands and
  // is still reachable via ⌘K / ⌃K (see the hotkey effect below). If you
  // want the ghost to be chat-only, delete the GhostComposer mount in
  // WidgetDashboardOverlay's render — nothing else depends on it.
  //
  // We keep a listener purely for the emotion beat, so the ghost still
  // reacts visibly at the moment it's clicked while the chat pane opens.
  React.useEffect(() => {
    const onGhostClick = () => {
      setEmotion('happy');
      setTimeout(() => setEmotion('chill'), 900);
    };
    window.addEventListener('bcw:ghost-click', onGhostClick);
    return () => window.removeEventListener('bcw:ghost-click', onGhostClick);
  }, []);

  // ── AUTO-WIDTH — grow the composer with what's typed ────
  // Sets a CSS variable on the composer element so the existing
  // transition can animate the width change. Capped to the CSS max.
  React.useEffect(() => {
    if (!composerRef.current) return;
    if (!live) {
      composerRef.current.style.removeProperty('--bcw-live-w');
      return;
    }
    const sample = text || '';
    const w = measureTextWidth(sample, '500 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto');
    // Add padding for caret + breathing room. Floor at 280 so the
    // floating text never reads as a tiny chip; cap at 720.
    const target = Math.min(720, Math.max(280, Math.round(w + 80)));
    composerRef.current.style.setProperty('--bcw-live-w', target + 'px');
  }, [text, live, mode]);

  // ── DYNAMIC POSITIONING — anchor under the ghost silhouette ───
  // Reads the live ghost screen rect every frame (rAF loop) so the
  // composer + reply bubble track the ghost in real time as it drifts,
  // hovers, gets dragged, or transitions between docked/centered modes.
  //
  // Composer now lives on a fixed layer SIBLING of the board (not a
  // child) so positions are viewport-absolute, not board-relative. This
  // also lets the composer escape the board's overflow:hidden + isolation
  // so its z-index can sit above the ghost's near layer.
  //
  // Spacing rule: the composer top sits at (ghost_bottom + gap), where
  // gap scales with the ghost's current scale so depth-changes feel
  // natural — bigger ghost = bigger gap. The reply bubble (positioned
  // BELOW the composer input) is therefore always well clear of the
  // ghost silhouette regardless of depth.
  React.useEffect(() => {
    if (!composerRef.current) return;
    let raf = 0;
    let smoothX = null, smoothY = null;
    let mounted = true;

    const tick = () => {
      if (!mounted) return;
      raf = requestAnimationFrame(tick);
      const c = composerRef.current;
      if (!c) return;

      // Read the live ghost rect from the WebGL controller. This is the
      // tight bbox of the rendered silhouette in screen-space — accounts
      // for current position, scale (depth), and any in-flight drift.
      let bottomY = null;
      let centerX = null;
      let scale   = 1;
      try {
        const ctl = window.__ghostCtl;
        if (ctl && typeof ctl.getScreenRect === 'function') {
          const sr = ctl.getScreenRect();
          if (sr && sr.w > 4 && sr.h > 4) {
            bottomY = sr.bottom;
            centerX = sr.cx;
            scale   = sr.scale || 1;
          }
        }
      } catch (_) {}
      if (bottomY == null) {
        // Fallback to reserve rect if controller isn't ready yet.
        const rEl = document.querySelector('.bcw-ghost-reserve');
        if (rEl) {
          const r = rEl.getBoundingClientRect();
          bottomY = r.top + r.height * 0.78;
          centerX = r.left + r.width * 0.5;
          scale = 1;
        }
      }
      if (bottomY == null || centerX == null) return;

      // Depth-aware gap — bigger ghost gets a bigger gap so the composer
      // doesn't crowd the silhouette when zoomed in. Clamp so it stays
      // sensible at any scale.
      const gap = Math.max(14, Math.min(48, 16 + scale * 18));

      // Viewport-absolute target coords (composer is on a fixed layer).
      const targetX = centerX;
      const targetY = bottomY + gap;

      // Smooth toward target — exponential ease so dragging the ghost
      // feels natural rather than rubber-banding. Higher k = snappier.
      if (smoothX === null) { smoothX = targetX; smoothY = targetY; }
      const k = 0.22;
      smoothX += (targetX - smoothX) * k;
      smoothY += (targetY - smoothY) * k;

      c.style.left = Math.round(smoothX) + 'px';
      c.style.top  = Math.round(smoothY) + 'px';
    };
    raf = requestAnimationFrame(tick);

    return () => {
      mounted = false;
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // ── EYE-TRACKING — ghost looks down at the input while user types ───
  // Asks the ghost controller to retarget its gaze at the composer DOM
  // element while focused/typing/sending. On blur we release so the
  // ghost goes back to its idle saccade.
  React.useEffect(() => {
    const wantTrack = (state === 'focused' || state === 'sending');
    try {
      const ctl = window.__ghostCtl;
      if (!ctl) return;
      if (wantTrack && typeof ctl.setLookAtElement === 'function') {
        ctl.setLookAtElement('.bcw-composer');
      } else if (!wantTrack && typeof ctl.clearLookAt === 'function') {
        ctl.clearLookAt();
      }
    } catch (_) {}
    return () => {
      try {
        const ctl = window.__ghostCtl;
        if (ctl && typeof ctl.clearLookAt === 'function') ctl.clearLookAt();
      } catch (_) {}
    };
  }, [state]);

  // ── GHOST EMOTION HOOK-UP ───────────────────────────────
  const setEmotion = (e) => {
    try { if (window.__ghostCtl && window.__ghostCtl.setEmotion) window.__ghostCtl.setEmotion(e); } catch(_) {}
    lastEmotionRef.current = e;
    // Push the matching mood ring HSL into the composer layer so the
    // underline / caret / reply chip color all morph together. Falls
    // back to chill. Composer-layer is the new parent (sibling of board).
    try {
      const layer = composerRef.current && composerRef.current.closest('.bcw-composer-layer');
      const target = layer || (composerRef.current && composerRef.current.closest('.bcw-board'));
      if (!target) return;
      const m = GHOST_MOOD_BY_EMOTION[e] || GHOST_MOOD_BY_EMOTION.chill;
      target.style.setProperty('--bcw-mood-hue',   String(m.h));
      target.style.setProperty('--bcw-mood-sat',   m.s + '%');
      target.style.setProperty('--bcw-mood-light', m.l + '%');
      target.style.setProperty('--bcw-mood-alpha', String(m.a));
    } catch (_) {}
  };
  const playAction = (a) => {
    try { if (window.__ghostCtl && window.__ghostCtl.playAction) window.__ghostCtl.playAction(a); } catch(_) {}
  };

  // ── TYPING-DRIVEN EMOTION (debounced) ──────────────────
  // Reclassifies emotion ~180ms after the last keystroke. Manual emotion
  // overrides from the dev panel (or sending/success/error states) are
  // not touched — we only nudge during 'focused' state with no flag.
  React.useEffect(() => {
    lastKeyTimeRef.current = Date.now();
    if (state !== 'focused') return;
    if (sendingLockRef.current) return;
    if (emotionDebounceRef.current) clearTimeout(emotionDebounceRef.current);
    emotionDebounceRef.current = setTimeout(() => {
      const idleMs = Date.now() - lastKeyTimeRef.current;
      const next = classifyTypingEmotion(text, { focused: true, idleMs });
      if (next !== lastEmotionRef.current) setEmotion(next);
    }, 180);
    return () => { if (emotionDebounceRef.current) clearTimeout(emotionDebounceRef.current); };
  }, [text, state]);

  // Sleepy-on-idle — every 4s while focused with empty input, re-evaluate.
  React.useEffect(() => {
    if (state !== 'focused') return;
    const id = setInterval(() => {
      if (sendingLockRef.current) return;
      const idleMs = Date.now() - lastKeyTimeRef.current;
      const next = classifyTypingEmotion(text, { focused: true, idleMs });
      if (next !== lastEmotionRef.current) setEmotion(next);
    }, 4000);
    return () => clearInterval(id);
  }, [state, text]);

  // ── REPLY CHIP ──────────────────────────────────────────
  // Drives the floating "spoken line" above the input in live mode.
  // Auto-hides after `ms`, but the input itself stays focused so the
  // user can keep going without re-clicking.
  const showReply = (msg, kind = 'info', ms = 5200) => {
    if (!mountedRef.current) return;
    if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
    replyTimerRef.current = null;
    savedReplyRef.current = null;   // new message supersedes any saved state
    setReply({msg: msg || '', kind, show: !!msg});
    if (msg && ms > 0) {
      // Record when the dismiss is due so the blur handler can compute
      // how much time is left if the operator switches away mid-countdown.
      const dueAt = Date.now() + ms;
      replyTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setReply(r => ({...r, show: false}));
        savedReplyRef.current = null;
      }, ms);
      // Stash enough info to restore if the window blurs before dismiss.
      savedReplyRef.current = { msg, kind, dueAt };
    }
  };

  // ── FOCUS / BLUR REPLY PERSISTENCE ─────────────────────────────────────
  // Freeze the reply chip while the operator is away so it doesn't silently
  // time out. On return, restore it for however long it had left (capped at
  // REPLY_MAX_AWAY_MS total away time — after that the chip quietly expires).
  React.useEffect(() => {
    const onBlur = () => {
      const saved = savedReplyRef.current;
      if (!saved) return;
      // Pause the dismiss timer.
      if (replyTimerRef.current) { clearTimeout(replyTimerRef.current); replyTimerRef.current = null; }
      // Capture remaining display time and when we left.
      const remainingMs = Math.max(0, saved.dueAt - Date.now());
      savedReplyRef.current = { ...saved, remainingMs, blurAt: Date.now() };
    };
    const onFocus = () => {
      const saved = savedReplyRef.current;
      if (!saved || !saved.blurAt) return;
      const awayMs = Date.now() - saved.blurAt;
      // Expired while away — clear silently, no jarring flash.
      if (awayMs >= REPLY_MAX_AWAY_MS || saved.remainingMs <= 0) {
        savedReplyRef.current = null;
        if (mountedRef.current) setReply(r => ({...r, show: false}));
        return;
      }
      // Still fresh — restore the chip and resume the countdown.
      const resumeMs = Math.max(1200, saved.remainingMs - awayMs);
      if (mountedRef.current) setReply({ msg: saved.msg, kind: saved.kind, show: true });
      savedReplyRef.current = { ...saved, dueAt: Date.now() + resumeMs };
      replyTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setReply(r => ({...r, show: false}));
        savedReplyRef.current = null;
      }, resumeMs);
    };
    // Named so it can be removed — the inline arrow this replaces was never
    // cleaned up, leaking one listener (and this closure) per mount.
    const onVis = () => { if (document.hidden) onBlur(); else onFocus(); };
    window.addEventListener('blur',  onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur',  onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── SUBMISSION ──────────────────────────────────────────
  const flashStatus = (kind, msg, ms = 2400) => {
    if (!mountedRef.current) return;
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus({kind, msg});
    if (ms > 0) {
      statusTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setStatus({kind:'', msg:''});
      }, ms);
    }
  };

  // ── ACTION RESULT LISTENER ──────────────────────────────
  // ghostActionHandler fires bcGhostResult events for async verbs
  // (message_send, invoice_create, de_escalate, escalate, product_*).
  // We listen here so the reply chip can be updated with the real outcome.
  //
  // pendingActionsRef holds a count per verb so a batch of N message_sends
  // is tracked correctly — the previous Set-based version collapsed
  // multiple identical verbs into one entry, so "message Alice and Bob"
  // resolved after the first response and ignored the second.
  const pendingActionsRef = React.useRef({ counts: {}, total: 0, done: 0, failed: 0, lastReport: '' });
  // WATCHDOG. The chip shows a persistent "Working…" (timeout 0) while a
  // batch is in flight and only the result event clears it, so a verb that
  // never reports left the ghost shimmering indefinitely with no way back
  // short of sending another command. The composer in the ghost chat has
  // had one of these for a while; the dashboard bar never did.
  const pendingTimerRef = React.useRef(null);
  const clearPendingWatchdog = () => {
    if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
  };
  React.useEffect(() => {
    const onResult = (e) => {
      if (!mountedRef.current) return;
      const d = e && e.detail;
      if (!d) return;
      // A scheduled job firing reports on this same event, but it belongs
      // to no batch typed here. Counting it against the live batch closed
      // that batch early — with the scheduled job's report in its place.
      if (d._scheduled) return;
      const p = pendingActionsRef.current;
      if (!p.total) return;
      const verb = d.kind;
      if (!p.counts[verb]) return;
      p.counts[verb] = Math.max(0, p.counts[verb] - 1);
      p.done += 1;
      const failure = d.resolved === false;
      if (failure) p.failed += 1;
      // Prefer the explicit report from the engine — falls back to
      // reason / generic phrasing only when nothing structured arrived.
      const detail = d.report || d.reason || (failure ? 'Action failed' : 'Done');
      p.lastReport = detail;

      const remaining = p.total - p.done;
      if (remaining > 0) {
        // Mid-batch — show progress so the operator can see the ghost is
        // working through a list rather than stuck.
        const tag = failure ? 'err' : 'info';
        const msg = `${detail} · ${p.done}/${p.total}`;
        showReply(msg, tag, 0); // 0 = persistent, replaced on next event
        flashStatus(tag, msg, 0);
        setEmotion(failure ? 'sad' : 'thinking');
      } else {
        // Batch complete — final status.
        if (p.failed && p.failed === p.total) {
          showReply(detail, 'err', 6000);
          flashStatus('err', detail, 5200);
          setEmotion('sad');
          playAction('shake');
          setState('error');
        } else if (p.failed) {
          const msg = `${p.done - p.failed}/${p.total} done · ${p.failed} failed: ${detail}`;
          showReply(msg, 'err', 7000);
          flashStatus('err', msg, 6000);
          setEmotion('suspicious');
          playAction('shake');
          setState('error');
        } else {
          showReply(detail, 'ok', 5000);
          flashStatus('ok', detail, 4000);
          setEmotion('happy');
          playAction('nod');
          setState('success');
        }
        // Settle back to focused/idle after the success/error pulse so the
        // shimmer hairline doesn't stay locked at the result colour.
        setTimeout(() => {
          if (!mountedRef.current) return;
          setState(document.activeElement === inputRef.current ? 'focused' : 'idle');
          setEmotion('chill');
        }, 1600);
        // Reset bookkeeping so the next submit starts clean.
        clearPendingWatchdog();
        pendingActionsRef.current = { counts: {}, total: 0, done: 0, failed: 0, lastReport: '' };
      }
    };
    window.addEventListener('bcGhostResult', onResult);
    return () => {
      window.removeEventListener('bcGhostResult', onResult);
      clearPendingWatchdog();
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const dispatchActions = (actions) => {
    if (!actions || !actions.length) return false;
    let any = false;
    // Async verbs that fire bcGhostResult.
    const ASYNC_VERBS = new Set([
      'message_send', 'invoice_create', 'escalate', 'de_escalate',
      'product_create', 'product_update', 'product_delete', 'product_toggle',
      // Wallet verbs resolve through CRED_STORE.set() and announce their
      // outcome via bcGhostResult, same as the product verbs above.
      'wallet_add', 'wallet_update', 'wallet_delete',
  // agent_create/update now really call save_agent, so their outcome
  // arrives on bcGhostResult like the product and wallet verbs.
  'agent_create', 'agent_update_prompt',
      // Reply-hours edits save through save_agent too.
      'agent_schedule',
      // Assigning/unassigning an agent on a chat round-trips through
      // assign_agent before it can be reported.
      'agent_assign', 'agent_unassign',
      'invoice_cancel',
    ]);
    const p = pendingActionsRef.current;
    for (const a of actions) {
      try {
        const r = onLayoutAction && onLayoutAction(a);
        if (r) {
          any = true;
          if (ASYNC_VERBS.has(a.verb)) {
            p.counts[a.verb] = (p.counts[a.verb] || 0) + 1;
            p.total += 1;
          }
        }
      } catch (e) { console.warn('[ghost] action failed', a, e); }
    }
    return any;
  };

  const persistSession = (sid) => {
    if (!sid) return;
    sessionIdRef.current = sid;
    try { sessionStorage.setItem('bcw.ghost.session', sid); } catch (_) {}
    // Primary storage: IndexedDB — survives Ctrl+Shift+Z / LS clears.
    if (typeof IDB_STORE !== 'undefined') {
      IDB_STORE.set('ghost.session', sid).catch(() => {});
    }
  };

  const submit = async (override) => {
    const t = (override != null ? override : text).trim();
    if (!t) return;
    // Hard guard — if lock is already held (e.g. previous Enter still in
    // flight) reject immediately. The input is also disabled in the render
    // during 'sending' state so this is belt-and-braces.
    if (sendingLockRef.current) return;

    // __ghostCmd is registered by bot-engine.jsx at module load. If it isn't
    // present yet (e.g. engine file failed to load), surface a clear error
    // and restore the input so the user isn't stuck.
    if (!window.__ghostCmd) {
      flashStatus('err', 'Command engine not ready — reload the page');
      showReply('Command engine not ready', 'err', 4000);
      setState('error');
      setTimeout(() => {
        if (mountedRef.current) setState('focused');
        // Ensure input gets focus back so user can try again
        setTimeout(() => { try { inputRef.current && inputRef.current.focus(); } catch(_){} }, 0);
      }, 1400);
      return;
    }

    // Acquire lock and clear any stale pending-action tracking from a
    // previous submit that may not have received its bcGhostResult.
    sendingLockRef.current = true;
    pendingActionsRef.current = { counts: {}, total: 0, done: 0, failed: 0, lastReport: '' };
    setState('sending');
    setEmotion('thinking');

    // Helper that always releases the lock and guards post-unmount updates.
    // Call this on every exit path — success, failure, or thrown error.
    const releaseLock = () => { sendingLockRef.current = false; };
    const safeSet = (fn) => { if (mountedRef.current) fn(); };

    try {
      const ctx = {
        layout_keys: (window.__bcwLayoutKeys && window.__bcwLayoutKeys()) || [],
        view: 'dashboard',
        session_id: sessionIdRef.current || '',
      };
      const res = await window.__ghostCmd(t, ctx);
      if (res && res.session_id) persistSession(res.session_id);

      if (!res || res.error) {
        const raw = (res && res.error) || 'Something went wrong';
        // Translate common backend errors into clearer prose.
        let msg = raw;
        if (/timeout/i.test(raw)) {
          msg = 'The model took too long to respond. Try a shorter command, or retry.';
        } else if (/rate limit/i.test(raw)) {
          msg = raw.replace(/^Rate limit:\s*/i, '');   // already informative
        } else if (/no.*api.*key|missing.*key|api key/i.test(raw)) {
          msg = 'No LLM API key on file. Add one in Settings → AI providers.';
        } else if (/network|failed to fetch|fetch failed/i.test(raw)) {
          msg = 'Network blip — try again in a moment.';
        }
        safeSet(() => {
          flashStatus('err', msg);
          showReply(msg, 'err', 5200);
          setState('error');
          setEmotion('sad');
          playAction('shake');
        });
        setTimeout(() => {
          releaseLock();
          safeSet(() => {
            setState(document.activeElement === inputRef.current ? 'focused' : 'idle');
            setEmotion('chill');
            // Re-focus so user can correct and retry immediately
            try { inputRef.current && inputRef.current.focus(); } catch(_){}
          });
        }, 1400);
        return;
      }

      // Confirm-nonce flow for destructive verbs.
      const confirmAct = (res.actions || []).find(a => a.verb === 'confirm');
      if (confirmAct) {
        safeSet(() => {
          showReply('', 'info', 0);
          setConfirm({
            nonce:   confirmAct.attrs.nonce || '',
            summary: confirmAct.attrs.summary || 'Confirm action?',
            sub:     confirmAct.attrs.sub || '',
            verb:    confirmAct.attrs.verb || '',
            attrs:   confirmAct.attrs,
            danger:  confirmAct.attrs.danger === '1' || confirmAct.attrs.danger === 'true',
          });
          setEmotion('suspicious');
          setState('focused');
        });
        releaseLock();
        setTimeout(() => { try { inputRef.current && inputRef.current.focus(); } catch(_){} }, 0);
        return;
      }

      const did = dispatchActions(res.actions || []);
      const speak = res.speak || '';
      const droppedVerbs = Array.isArray(res.dropped_verbs) ? res.dropped_verbs : [];

      // Always clear input on successful round-trip.
      safeSet(() => setText(''));

      // Async actions in-flight — show "Sending…" and release lock so user
      // can type again. The bcGhostResult listener will update the chip.
      const pTotal = pendingActionsRef.current.total;
      const hasAsyncPending = pTotal > 0;
      if (did && hasAsyncPending) {
        // Be specific about what's happening — "Sending 3 messages…" reads
        // as the system actually working, not just a spinner.
        let baseMsg = speak;
        if (!baseMsg) {
          const counts = pendingActionsRef.current.counts;
          const labels = [];
          if (counts.message_send)   labels.push(counts.message_send + ' message' + (counts.message_send > 1 ? 's' : ''));
          if (counts.invoice_create) labels.push(counts.invoice_create + ' invoice'  + (counts.invoice_create > 1 ? 's' : ''));
          if (counts.escalate)       labels.push(counts.escalate + ' escalation' + (counts.escalate > 1 ? 's' : ''));
          if (counts.de_escalate)    labels.push((counts.de_escalate > 1 ? counts.de_escalate + ' de-escalations' : 'de-escalation'));
          if (counts.product_create || counts.product_update || counts.product_delete || counts.product_toggle) {
            const n = (counts.product_create||0) + (counts.product_update||0) + (counts.product_delete||0) + (counts.product_toggle||0);
            labels.push(n + ' product update' + (n > 1 ? 's' : ''));
          }
          if (counts.agent_create || counts.agent_update_prompt || counts.agent_schedule) {
            const n = (counts.agent_create||0) + (counts.agent_update_prompt||0) + (counts.agent_schedule||0);
            labels.push(n + ' agent update' + (n > 1 ? 's' : ''));
          }
          baseMsg = labels.length ? ('Working on ' + labels.join(', ') + '…') : 'Working…';
        }
        safeSet(() => {
          flashStatus('info', baseMsg, 0);   // 0 = persistent until result lands
          showReply(baseMsg, 'info', 0);
          setState('sending');                // keep premium shimmer running
          setEmotion('thinking');
        });
        // Give up after the same 45s the ghost chat uses, and say only what
        // we know: the action may well have landed, we just never heard.
        clearPendingWatchdog();
        pendingTimerRef.current = setTimeout(() => {
          pendingTimerRef.current = null;
          const q = pendingActionsRef.current;
          if (!q.total) return;                       // already settled
          const left = q.total - q.done;
          const msg = q.done
            ? `${q.done}/${q.total} confirmed — stopped waiting on the rest.`
            : `Stopped waiting on ${left === 1 ? 'that' : `${left} actions`} — ${left === 1 ? 'it' : 'they'} may still have gone through.`;
          pendingActionsRef.current = { counts: {}, total: 0, done: 0, failed: 0, lastReport: '' };
          if (!mountedRef.current) return;
          showReply(msg, 'err', 6500);
          flashStatus('err', msg, 5600);
          setEmotion('suspicious');
          setState('idle');
        }, BCW_GHOST_ACTION_TIMEOUT_MS);
        releaseLock();
        setTimeout(() => { try { inputRef.current && inputRef.current.focus(); } catch(_){} }, 0);
        return;
      }

      if (did && !hasAsyncPending) {
        const msg = speak || 'Done';
        safeSet(() => {
          flashStatus('ok', msg);
          showReply(msg, 'ok');
          setState('success');
          setEmotion('happy');
          playAction('nod');
        });
        setTimeout(() => {
          releaseLock();
          safeSet(() => {
            setState(document.activeElement === inputRef.current ? 'focused' : 'idle');
            setEmotion('chill');
          });
        }, 1400);
        return;
      }

      // No actions dispatched — pure conversation / clarify / dropped verbs.
      releaseLock();
      if (speak && speak.length) {
        safeSet(() => {
          flashStatus('info', '', 0);
          showReply(speak, 'info', 7000);
          setState('focused');
          setEmotion('chill');
        });
      } else if (res.clarify) {
        safeSet(() => {
          flashStatus('info', '', 0);
          showReply(res.clarify, 'info', 6000);
          setState('focused');
          setEmotion('thinking');
        });
      } else if (droppedVerbs.length) {
        const v = droppedVerbs[0];
        // Never show the raw verb id — it's an internal identifier, and the
        // ghost quoting one back reads like a crash, not an answer.
        const phrase = (typeof ghostVerbPhrase === 'function')
          ? ghostVerbPhrase(v)
          : `that (${String(v || '').replace(/_/g, ' ')})`;
        const msg = `I couldn't ${phrase} — that isn't something I can do yet.`;
        safeSet(() => {
          flashStatus('info', '', 0);
          showReply(msg, 'info', 5000);
          setState('focused');
          setEmotion('thinking');
        });
      } else {
        safeSet(() => {
          flashStatus('info', '', 0);
          showReply("I'm not sure how to handle that — try rephrasing?", 'info', 4000);
          setState('focused');
          setEmotion('suspicious');
        });
      }
      setTimeout(() => { try { inputRef.current && inputRef.current.focus(); } catch(_){} }, 0);

    } catch (e) {
      console.warn('[ghost] submit error', e);
      releaseLock();
      safeSet(() => {
        flashStatus('err', 'Network error');
        showReply('Network error — check connection', 'err', 4000);
        setState('error');
        setEmotion('sad');
        playAction('shake');
      });
      setTimeout(() => {
        safeSet(() => {
          setState('idle');
          setEmotion('chill');
          // Re-focus after error so user can retry without clicking
          try { inputRef.current && inputRef.current.focus(); } catch(_){}
        });
      }, 1400);
    }
  };

  const onConfirm = async () => {
    if (!confirm) return;
    sendingLockRef.current = true;
    setState('sending');
    setEmotion('thinking');
    const releaseLock = () => { sendingLockRef.current = false; };
    const safeSet = (fn) => { if (mountedRef.current) fn(); };
    try {
      const res = await window.__ghostCmd('', {
        confirm_nonce: confirm.nonce,
        session_id: sessionIdRef.current || '',
      });
      if (res && res.session_id) persistSession(res.session_id);
      if (!res || res.error) {
        const msg = (res && res.error) || 'Confirm failed';
        releaseLock();
        safeSet(() => {
          flashStatus('err', msg);
          showReply(msg, 'err', 4200);
          setState('error');
          setEmotion('sad');
          playAction('shake');
          setConfirm(null);
        });
        setTimeout(() => {
          safeSet(() => {
            setState('idle');
            setEmotion('chill');
            try { inputRef.current && inputRef.current.focus(); } catch(_){}
          });
        }, 1400);
        return;
      }
      dispatchActions(res.actions || []);
      const msg = res.speak || 'Done';
      safeSet(() => {
        flashStatus('ok', msg);
        showReply(msg, 'ok');
        setState('success');
        setEmotion('happy');
        playAction('nod');
        setConfirm(null);
        setText('');
      });
      setTimeout(() => {
        releaseLock();
        safeSet(() => {
          setState('idle');
          setEmotion('chill');
        });
      }, 1400);
    } catch (e) {
      releaseLock();
      safeSet(() => {
        flashStatus('err', 'Network error');
        showReply('Network error', 'err', 3200);
        setState('error');
        setEmotion('sad');
        setConfirm(null);
      });
      setTimeout(() => {
        safeSet(() => {
          setState('idle');
          setEmotion('chill');
          try { inputRef.current && inputRef.current.focus(); } catch(_){}
        });
      }, 1400);
    }
  };

  const onCancelConfirm = () => {
    setConfirm(null);
    setState('focused');
    setEmotion('chill');
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  };

  return (
    <div
      className="bcw-composer"
      ref={composerRef}
      data-bcw-state={state}
      data-bcw-live={live ? '1' : '0'}
      data-sending={state === 'sending' ? '1' : '0'}
      aria-label="Ghost command input"
    >
      {/* Reply chip — floats above the input in live mode. */}
      <div
        className="bcw-composer-reply"
        data-show={reply.show ? '1' : '0'}
        data-kind={reply.kind || 'info'}
        data-pulse={(state === 'sending' && reply.show && reply.kind === 'info') ? '1' : '0'}
        aria-live="polite"
      >{reply.msg || '\u00A0'}</div>

      {/* Only the destructive-confirm strip is ever drawn here now. The
          "ask the ghost" trigger line, its hairline and the rotating
          "try: …" hint used to sit permanently under the ghost; they're
          gone (the ghost is clicked to talk, or ⌘K / just start typing).
          The centred ghost reserve in bot-ui-widgets.css was lowered to
          make up for the space they took. */}
      {confirm && (
        <div className="bcw-composer-shell">
          <div className="bcw-composer-confirm">
            <div className="bcw-composer-confirm-text">
              {confirm.summary}
              {confirm.sub && <div className="bcw-composer-confirm-sub">{confirm.sub}</div>}
            </div>
            <button className="bcw-composer-btn" onClick={onCancelConfirm}>Cancel</button>
            <button
              className="bcw-composer-btn"
              data-primary="1"
              data-danger={confirm.danger ? '1' : '0'}
              onClick={onConfirm}
            >Confirm</button>
          </div>
        </div>
      )}
      <div
        className="bcw-composer-status"
        data-show={status.msg ? '1' : '0'}
        data-kind={status.kind || 'info'}
      >{status.msg || '\u00A0'}</div>
    </div>
  );
};

// (Old wavy-bottomed SVG silhouette removed — the composer now uses a
// minimal CSS-only glass wisp that dissolves into a floating-text mode
// the moment the user engages. See .bcw-composer in bot-ui-widgets.css.)

// ── MAIN OVERLAY ─────────────────────────────────────────
const WidgetDashboardOverlay = ({editing, setEditing}) => {
  const boardRef = React.useRef(null);
  // ── Layout + z-order persistence ─────────────────────────────────────────
  // Saved as a single JSON blob: { layout: [...], zOrder: {...} }.
  // v7 stored layout array directly — migrated transparently below.
  const sanitize = (parsed) => {
    // Malformed data → empty board (safe default, not the full 12-widget layout).
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(l => l && WIDGETS[l.key])
      .map(l => {
        const def = WIDGETS[l.key];
        return {
          key: l.key,
          x: typeof l.x === 'number' ? l.x : 20,
          y: typeof l.y === 'number' ? l.y : 20,
          w: Math.max(def.min.w, Math.min(def.default.w, l.w || def.default.w)),
          h: Math.max(def.min.h, Math.min(def.default.h, l.h || def.default.h)),
        };
      });
  };

  const _loadPersistedState = () => {
    try {
      // v8: blob with layout + zOrder
      const raw = localStorage.getItem(WIDGET_LS_KEY);
      if (raw) {
        const blob = JSON.parse(raw);
        // v8 blob is { layout, zOrder }
        if (blob && blob.layout) {
          return { layout: sanitize(blob.layout), zOrder: blob.zOrder || {} };
        }
        // v8 blob might be a raw array (shouldn't happen, but guard it)
        if (Array.isArray(blob)) {
          return { layout: sanitize(blob), zOrder: {} };
        }
      }
    } catch (_) {}
    try {
      // Migrate from v7 (raw layout array)
      const rawV7 = localStorage.getItem(WIDGET_LS_KEY_V7);
      if (rawV7) {
        const parsed = JSON.parse(rawV7);
        return { layout: sanitize(parsed), zOrder: {} };
      }
    } catch (_) {}
    // No saved state and no v7 migration data → first use.
    // Start with an empty board so the user chooses their own layout.
    // DEFAULT_LAYOUT is available via the Reset button in the edit panel.
    return { layout: [], zOrder: {} };
  };

  const _initialState = _loadPersistedState();
  const [layout, setLayout]   = React.useState(_initialState.layout);
  const [zOrder, setZOrder]   = React.useState(_initialState.zOrder);

  // Throttled persistence — batch layout + zOrder into one write.
  // Using a ref so the flush callback always captures the latest values
  // without adding them to any dependency array.
  const _layoutRef  = React.useRef(layout);
  const _zOrderRef  = React.useRef(zOrder);
  const _flushTidRef = React.useRef(null);
  React.useEffect(() => { _layoutRef.current = layout; }, [layout]);
  React.useEffect(() => { _zOrderRef.current = zOrder; }, [zOrder]);

  const _scheduleFlush = React.useCallback(() => {
    if (_flushTidRef.current) return;
    _flushTidRef.current = setTimeout(() => {
      _flushTidRef.current = null;
      try {
        localStorage.setItem(WIDGET_LS_KEY, JSON.stringify({
          layout:  _layoutRef.current,
          zOrder:  _zOrderRef.current,
        }));
      } catch (_) {}
    }, 400);
  }, []);

  // Flush on every layout or zOrder change.
  React.useEffect(() => { _scheduleFlush(); }, [layout, zOrder, _scheduleFlush]);

  // Derived: ghost docking mode. Empty layout → centered; otherwise → docked.
  // Broadcast as a window event so the MsgList ResizeObserver knows to
  // re-read the .bcw-ghost-reserve rect and update the WebGL ghost home.
  const mode = layout.length === 0 ? 'centered' : 'docked';
  React.useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('bcw:mode-change', {detail: mode})); } catch(_){}
  }, [mode]);

  // Expose a tiny helper so the engine / ghost composer can read which
  // widgets are visible without needing prop wiring.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__bcwLayoutKeys = () => layout.map(l => l.key);
    window.__bcwMode = mode; // 'centered' | 'docked' — read by ghost rig on mount
    return () => {
      try { delete window.__bcwLayoutKeys; } catch(_){}
      try { delete window.__bcwMode; } catch(_){}
    };
  }, [layout]);

  // Close edit panel on outside click
  React.useEffect(()=>{
    if (!editing) return;
    const h = (e) => {
      if (e.target.closest('.bcw-edit-panel')) return;
      if (e.target.closest('.bcw-card')) return;
      if (e.target.closest('[data-bcw-launcher]')) return;
      // Don't close edit panel just because the user clicked the ghost
      // composer — it's part of the dashboard, not "outside".
      if (e.target.closest('.bcw-composer')) return;
      setEditing(false);
    };
    window.addEventListener('mousedown', h);
    return ()=>window.removeEventListener('mousedown', h);
  }, [editing, setEditing]);

  const toggle = (key) => {
    setLayout(arr => {
      if (arr.find(l => l.key === key)) return arr.filter(l => l.key !== key);
      const def = WIDGETS[key];
      // Pass the ghost's current board-relative rect as an extra obstacle
      // when the user has moved the ghost away from its dock, so new widgets
      // never land on top of it.
      const ghostRect = bcwGetGhostBoardRect(boardRef.current);
      const slot = bcwFindFreeSlot(def.default.w, def.default.h, arr, ghostRect ? [ghostRect] : []);
      return [...arr, { key, x:slot.x, y:slot.y, w:def.default.w, h:def.default.h }];
    });
  };
  const remove = (key) => setLayout(arr => arr.filter(l => l.key !== key));

  // Update widget; partial = patch fields, commit just persists
  const update = (key, patch) => {
    if (patch === null) return; // commit hook — no-op (state already current)
    setLayout(arr => arr.map(l => l.key === key ? { ...l, ...patch } : l));
  };

  const focus = (key) => {
    setZOrder(zo => {
      const max = Math.max(0, ...Object.values(zo));
      return { ...zo, [key]: max + 1 };
    });
  };

  // Add a widget if it isn't already present. Used by the ghost composer
  // (e.g. task_create auto-enables the Tasks widget so the result is
  // visible immediately) and by direct widget_show actions.
  const ensureWidget = React.useCallback((key) => {
    if (!WIDGETS[key]) return false;
    let added = false;
    setLayout(arr => {
      if (arr.find(l => l.key === key)) return arr;
      const def = WIDGETS[key];
      const ghostRect = bcwGetGhostBoardRect(boardRef.current);
      const slot = bcwFindFreeSlot(def.default.w, def.default.h, arr, ghostRect ? [ghostRect] : []);
      added = true;
      return [...arr, { key, x:slot.x, y:slot.y, w:def.default.w, h:def.default.h }];
    });
    return added;
  }, []);

  // Action dispatcher for the ghost composer. Handles the layout-only verbs
  // (widget_show / widget_hide / navigate / task_create) directly here;
  // anything else bubbles to the engine via window.__ghostActionHandler.
  const onLayoutAction = React.useCallback((act) => {
    if (!act || !act.verb) return false;
    const v = act.verb;
    const a = act.attrs || {};
    if (v === 'widget_show') {
      if (a.key && WIDGETS[a.key]) { ensureWidget(a.key); return true; }
      return false;
    }
    if (v === 'widget_hide') {
      if (a.key) { remove(a.key); return true; }
      return false;
    }
    if (v === 'task_create') {
      if (typeof window !== 'undefined' && window.__bcwTasks) {
        window.__bcwTasks.add({
          text: a.text || a.t || '',
          tag:  a.tag,
          due:  a.due,
          assignee: a.assignee,
        });
        ensureWidget('tasks');
        return true;
      }
      return false;
    }
    if (v === 'task_complete') {
      if (typeof window !== 'undefined' && window.__bcwTasks) {
        return window.__bcwTasks.complete(a.id ? +a.id : (a.match || a.text || ''));
      }
      return false;
    }
    if (v === 'navigate') {
      try { window.dispatchEvent(new CustomEvent('bcw:navigate', {detail: {view: a.view}})); } catch(_){}
      return true;
    }
    // Any other verb: hand off to the engine handler if registered.
    try {
      if (typeof window !== 'undefined' && typeof window.__ghostActionHandler === 'function') {
        return !!window.__ghostActionHandler(act);
      }
    } catch (e) { console.warn('[ghost] handler failed', e); }
    return false;
  }, [ensureWidget]);

  // ── EXPOSE THE DISPATCHER ───────────────────────────────────
  // GhostChat (bot-ui-shared.jsx) runs the exact same verb pipeline as
  // this composer, but lives in a completely different part of the tree
  // (inside MsgList's chat pane) with no prop path back to here. Rather
  // than duplicate the widget/task/navigate handling, we publish the
  // dispatcher on window — same pattern already used for __bcwLayoutKeys
  // and __bcwTasks above.
  //
  // The fallback in GhostChat is __ghostActionHandler alone, which still
  // handles every engine-side verb; without this hook it would just lose
  // the four UI-only verbs (widget_show/hide, task_create/complete,
  // navigate) when the dashboard overlay happens to be unmounted.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__bcwLayoutAction = onLayoutAction;
    return () => { try { delete window.__bcwLayoutAction; } catch(_){} };
  }, [onLayoutAction]);

  return (
    <>
      <div
        ref={boardRef}
        className="bcw-board"
        data-bcw-edit={editing ? '1' : '0'}
        data-bcw-mode={mode}
        data-ghost-moved={
          // Re-evaluate every render: read isUserMoved from the controller
          // (available after first ghost mount) or fall back to the persisted
          // localStorage flag so the attribute is correct on first paint too.
          (() => {
            try {
              const ctl = window.__ghostCtl;
              if (ctl) return ctl.isUserMoved ? '1' : '0';
            } catch (_) {}
            try {
              const ls = JSON.parse(localStorage.getItem('bc.ghost.pos.v1') || 'null');
              return (ls && ls.userMoved) ? '1' : '0';
            } catch (_) {}
            return '0';
          })()
        }
      >
        <div className="bcw-ghost-reserve" aria-hidden="true"/>
        {layout.map(item => (
          <WidgetCard
            key={item.key}
            item={item}
            editing={editing}
            onRemove={remove}
            onUpdate={update}
            boardRef={boardRef}
            zIndex={(zOrder[item.key] || 1) + 1}
            onFocus={() => focus(item.key)}
          />
        ))}
      </div>
      {/* Composer lives on its own fixed layer ABOVE the ghost's near
          layer (z=8400) so the floating text + reply bubble are never
          occluded by the ghost regardless of its drift / depth / scale.
          Position is driven by an rAF loop reading the live ghost rect. */}
      <div className="bcw-composer-layer" data-bcw-mode={mode}>
        <GhostComposer mode={mode} boardRef={boardRef} onLayoutAction={onLayoutAction}/>
      </div>
      {editing && (
        <WidgetEditPanel
          layout={layout}
          onToggle={toggle}
          onClose={()=>setEditing(false)}
          onClearAll={()=>setLayout([])}
          onResetDefault={()=>{
            setLayout(DEFAULT_LAYOUT);
            setZOrder({});
            // Return ghost to its dock when the user resets to the default layout.
            try {
              const ctl = window.__ghostCtl;
              if (ctl && ctl.reset) ctl.reset();
            } catch (_) {}
          }}
        />
      )}
    </>
  );
};

// ── LAUNCHER BUTTON ──────────────────────────────────────
// ── TOP-RIGHT STATUS BUBBLES ─────────────────────────────
// Two chips that live beside the "widgets" / "ghost" launchers at the
// top of the home board:
//   • NotificationsBubble — bell + count, opens a grouped activity feed
//     (payments, new customers, escalations, replies).
//   • ProfitBubble        — money-taken readout, opens a range
//     breakdown (today / 24h / 7 days / all time) with a 24h strip.
// Both read live app data where it exists (PAYMENTS_STORE invoices,
// MSGS_STORE conversations) and fall back to the module's seeded demo
// set so a fresh install still shows a populated surface.
// The dropdowns are portalled to <body>: the launcher cluster sits in a
// low stacking context inside the ghost stage, so a nested panel would
// otherwise paint under the widget board (z=2400).

const BCW_SEEN_LS  = 'bc.notif.seen.v1';
const BCW_RANGE_LS = 'bc.profit.range.v1';
const BCW_FEE_RATE = 0.012;   // network + processing estimate

// Dropdown widths — shared by useBcwAnchor's clamp math AND the popup's own
// `width` style. These must match: the anchor hook clamps `left` so a box
// of this width stays on-screen, but if the box that actually renders is
// wider than what the hook was told, the clamp is protecting the wrong
// rectangle and the real popup can still hang off the right edge.
// Narrower than it was. The rows are a circle, two short lines and a
// timestamp — 360px left the sub-line stretching most of a screen-width
// before it ever needed to truncate, which just spread the content thin.
const BCW_NOTIF_POP_W  = 296;
// Same width as the notifications panel — two panels hanging off adjacent
// chips that differ by 24px look like a mistake rather than a decision.
const BCW_PROFIT_POP_W = 296;

const BCW_RANGES = [
  {id:'today', label:'Today',    sub:'since midnight', short:'today'},
  {id:'d1',    label:'24 hours', sub:'rolling window', short:'24h'},
  {id:'d7',    label:'7 days',   sub:'rolling window', short:'7d'},
  {id:'all',   label:'All time', sub:'every payment',  short:'total'},
];

const bcwMoney = (n, compact) => {
  const v = Math.abs(Number(n) || 0);
  const s = (Number(n) || 0) < 0 ? '−' : '';
  if (compact && v >= 1000) {
    if (v >= 1e6) return s + '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
    return s + '$' + (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'k';
  }
  return s + '$' + v.toLocaleString('en-US', {maximumFractionDigits: v < 100 ? 2 : 0});
};

// Chip figures stay fully written out — "$1,298" reads as money,
// "$1.3k" reads as an estimate. Only six-figure sums compact.
const bcwChipMoney = (n) => bcwMoney(n, Math.abs(Number(n) || 0) >= 1e5);

const bcwCaret = (dir) => (
  <svg width="7" height="7" viewBox="0 0 10 10" aria-hidden="true"
    style={{transform: dir === 'up' ? 'none' : 'rotate(180deg)'}}>
    <path d="M5 1.5 9 8H1z" fill="currentColor"/>
  </svg>
);

const bcwAgo = (sec) => {
  if (!sec) return '';
  const d = Math.max(0, Math.round(Date.now() / 1000 - sec));
  if (d < 90)    return 'now';
  if (d < 3600)  return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
};

// "14:32" (the shape MSGS_STORE stores) to epoch seconds today. If the
// result lands in the future the clock has rolled past midnight, so the
// stamp belongs to yesterday.
const bcwHmSec = (hm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || ''));
  if (!m) return 0;
  const d = new Date(); d.setHours(+m[1], +m[2], 0, 0);
  let s = Math.floor(d.getTime() / 1000);
  if (s > Date.now() / 1000 + 60) s -= 86400;
  return s;
};

// "2m" / "1h" / "3d" (the seeded demo labels) to epoch seconds.
const bcwRelSec = (label) => {
  const m = /^(\d+)([mhd])$/.exec(String(label || '').trim());
  const now = Math.floor(Date.now() / 1000);
  if (!m) return now;
  const mult = m[2] === 'm' ? 60 : m[2] === 'h' ? 3600 : 86400;
  return now - (+m[1]) * mult;
};

// Is this the seeded demo workspace? The demo payment set used to fill in
// whenever there were no confirmed invoices, which meant a real operator
// who simply hadn't sold anything yet saw invented revenue in the chip and
// invented payments in the feed. Numbers the operator can't trust are worse
// than an empty state, so the fallback is now gated on the demo account the
// rest of the app already recognises.
const bcwIsDemo = () => {
  try { return !!(AUTH_STORE.account && AUTH_STORE.account.email === 'demo@botcommand.app'); }
  catch (_) { return false; }
};

// Recency for a conversation, in epoch seconds. Prefers the real numeric
// stamp the message store maintains; the "HH:MM" display string is only a
// fallback for rows written by older code paths, since it carries no date.
const bcwConvSec = (c) => {
  if (!c) return 0;
  if (Number.isFinite(c.ts) && c.ts > 0) return Math.floor(c.ts / 1000);
  return bcwHmSec(c.t);
};

// Invoices, resolved against the stores that hold the names. An invoice row
// stores conv_id and product_id — not the customer's name or the product's
// title — so without this join every payment in the UI read "Customer" and
// "Payment". Pending invoices are kept (flagged, not dropped) because money
// that's waiting on confirmations is exactly what an operator wants to see.
const bcwPaymentRows = (convs, products, demo) => {
  const convById = new Map((convs || []).map(c => [c.id, c]));
  const prodById = new Map((products || []).map(p => [String(p.id), p]));
  let rows = [];
  try {
    const inv = (typeof PAYMENTS_STORE !== 'undefined' && PAYMENTS_STORE.invoices) || [];
    rows = inv
      .filter(i => i && (i.status === 'confirmed' || i.status === 'pending'))
      .map((i, n) => {
        // A direct chat's invoice names its customer through the chat list
        // (bcConvLookup) or, failing that, the name saved on the invoice.
        const conv = i.conv_id ? (convById.get(i.conv_id) || (typeof bcConvLookup === 'function' ? bcConvLookup(i.conv_id) : null)) : null;
        const prod = i.product_id != null ? prodById.get(String(i.product_id)) : null;
        return {
          id:       'inv:' + (i.id || i.address || n),
          // amount_fiat is a free-form string ("85", "0.50", and on older or
          // hand-entered rows "$35" / "1,234.56"). Number() returns NaN for
          // any of those with a symbol or separator in them, which silently
          // became 0 here — a payment worth real money counted as nothing in
          // the row AND in every revenue total built from these rows.
          usd:      (typeof INVOICE_PROCESSOR !== 'undefined' && INVOICE_PROCESSOR.parseFiatAmount)
                      ? (INVOICE_PROCESSOR.parseFiatAmount(i.amount_fiat) || 0)
                      : (Number(i.amount_fiat) || 0),
          fiat:     i.fiat || 'USD',
          asset:    String(i.coin || '').split('/').pop().toUpperCase(),
          status:   i.status,
          conf:     Number(i.confirmations) || 0,
          minConf:  Number(i.min_confirmations) || 1,
          convId:   i.conv_id || null,
          customer: (conv && conv.name) || i.customer || 'Unknown contact',
          // The contact was erased ("Delete + wipe"): its payments stay in the
          // books but no longer raise notifications — except one that only
          // confirmed afterwards, which is news.
          wiped:    !!i.wiped_at && !(i.status === 'confirmed' && Number(i.confirmed_at) > Number(i.wiped_at)),
          // Every line, in order, not just the first — a combined invoice
          // that reads as one product in the Payments panel is how an $85
          // Bronze + Silver order looks like a $35 Bronze one. Falls back to
          // the recorded order summary for a row that never got itemised,
          // then to the linked product, then to the note.
          // Same shortening the chat separators use (shared words factored
          // out, repeats counted), with a higher cap because a table row has
          // more room than a separator line. Every line is still represented.
          pkg:      (i.basket_unresolved ? (String(i.order_label || i.description || '').trim() || 'Order') : '')
                    || ((typeof compactItemList !== 'undefined' && typeof INVOICE_ITEMS !== 'undefined')
                          ? compactItemList(INVOICE_ITEMS.itemsOf(i) || [], { max: 4 })
                          : '')
                    || (prod && prod.name) || i.description || 'Payment',
          // True when the invoice knowingly asks for more than its lines
          // cover: auto-delivery will be short and the operator must top it
          // up by hand before the customer pays.
          partial:  !!i.basket_unresolved,
          sec:      Number(i.created) || 0,
        };
      });
  } catch (_) {}
  if (!rows.length && demo) {
    rows = W_CRYPTO_TX.filter(t => t.status === 'confirmed').map(t => ({
      id:'demo:' + t.id, usd:t.usd, fiat:'USD', asset:t.asset, status:'confirmed',
      conf:1, minConf:1, convId:null, customer:t.customer, pkg:t.pkg, sec:bcwRelSec(t.t),
    }));
  }
  return rows.sort((a, b) => b.sec - a.sec);
};

const bcwProfit = (rows) => {
  const now = Date.now() / 1000;
  const midnight = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime() / 1000; })();
  const sum = (pred) => rows.reduce((s, r) => (pred(r) ? s + r.usd : s), 0);
  const gross = {
    today: sum(r => r.sec >= midnight),
    d1:    sum(r => r.sec >= now - 86400),
    d7:    sum(r => r.sec >= now - 7 * 86400),
    all:   sum(() => true),
  };
  const prev = {
    today: sum(r => r.sec >= midnight - 86400 && r.sec < midnight),
    d1:    sum(r => r.sec >= now - 2 * 86400 && r.sec < now - 86400),
    d7:    sum(r => r.sec >= now - 14 * 86400 && r.sec < now - 7 * 86400),
    all:   null,
  };
  const inRange = {
    today: rows.filter(r => r.sec >= midnight),
    d1:    rows.filter(r => r.sec >= now - 86400),
    d7:    rows.filter(r => r.sec >= now - 7 * 86400),
    all:   rows.slice(),
  };
  const count = {today:inRange.today.length, d1:inRange.d1.length, d7:inRange.d7.length, all:inRange.all.length};
  // Biggest single payment in the window — an average alone hides whether
  // the window was one large sale or twenty small ones.
  const best = {};
  Object.keys(inRange).forEach(k => {
    best[k] = inRange[k].reduce((m, r) => (r.usd > m ? r.usd : m), 0);
  });
  return {gross, prev, count, best, inRange};
};

// 24 hourly buckets of taken revenue, oldest to newest.
const bcwHourly = (rows) => {
  const now = Date.now() / 1000;
  const b = new Array(24).fill(0);
  rows.forEach(r => {
    const h = Math.floor((now - r.sec) / 3600);
    if (h >= 0 && h < 24) b[23 - h] += r.usd;
  });
  return b;
};

// What, if anything, a conversation is currently asking of the operator.
//
// This is the piece that decides whether something is worth a notification
// at all, and it exists because the previous version had no such notion:
// every conversation with an unread message raised a row and bumped the
// badge, so a customer the AI was already handling perfectly well generated
// exactly as much noise as one that had escalated. A busy inbox produced a
// feed of "X sent 1 message" that told the operator nothing and buried the
// two rows that mattered.
//
// The rule is: does the operator have to DO something?
//   escalated                     → yes, always. A human was asked for.
//   unread, and no AI covering it → yes. Nobody is answering this.
//   unread, but AI is replying    → no. Worth recording, not worth a badge.
//   anything else with history    → no. Plain recent activity.
//
// `loud` is what drives the badge and the "Needs you" group; quiet rows
// still appear in the feed so the operator can see activity, they just
// don't demand attention.
//
// There used to be a fourth kind here — "X started a conversation", raised
// whenever stage was 'new'. It had to go: stage is set to 'new' when a
// conversation is created and only ever advances if the AI classifies it,
// so for most contacts it is simply the permanent default. The result was
// a feed where nearly every row said the same thing about a conversation
// that had been running for days.
const bcwConvState = (c) => {
  const esc    = !!(c.escalated || c.stage === 'escalated' || c.stage === 'needs_help');
  const unread = Number(c.unread) || 0;
  // "Covered" means an agent is assigned AND auto-reply is on for this
  // conversation — the two flags the operator uses to hand a chat to the
  // AI. An escalation overrides it: the AI has already given up.
  const covered = !esc && !!c.auto_reply && !!c.agent_id;
  if (esc)        return {kind:'alert',   loud:true};
  if (unread > 0) return covered ? {kind:'reply', loud:false} : {kind:'waiting', loud:true};
  if (c.last)     return {kind:'recent',  loud:false};
  return null;
};

// ── MACHINE TOKENS OUT OF THE FEED ────────────────────────────
// Escalations carry TWO fields: `message`, the human sentence the AI wrote
// for the operator, and `reason`, a short code the prompt explicitly asks
// for so the rest of the system can match on it. The feed was reading the
// code, so an alert read "user_repeated_escalation" — a value that exists
// for software to compare, shown to a person as if it were an explanation.
//
// bcwHuman is the general net for anything else of that shape reaching a
// sub-line. The guard is deliberately narrow: a string containing a SPACE
// is prose someone wrote and is passed through untouched, so a real message
// preview can never be reworded. Only a bare single token with underscores,
// hyphens or camelCase humps — which is what a machine value looks like and
// what a human sentence never looks like — gets rewritten.
const BCW_REASON_WORDS = {
  ghost_escalation: 'Raised from the dashboard',
  user_requested_human: 'Asked for a human',
  repeated_question: 'Kept asking the same thing',
  angry_customer: 'Customer is upset',
};

const bcwHuman = (s) => {
  const t = String(s || '').trim();
  if (!t) return '';
  if (BCW_REASON_WORDS[t.toLowerCase()]) return BCW_REASON_WORDS[t.toLowerCase()];
  if (/\s/.test(t)) return t;                               // prose — leave it
  if (!/[_-]/.test(t) && !/[a-z0-9][A-Z]/.test(t)) return t; // one plain word
  const words = t
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return t;
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// What an escalation should SAY. The AI's own sentence first, because it was
// written for exactly this purpose; the code only as a fallback, humanised;
// then the handoff kind, which at least says what sort of problem it is.
const BCW_ESC_KIND = {refund: 'Refund request', help: 'Asked for a human'};

const bcwEscLine = (c) => {
  const e = (c && c.escalation) || {};
  const msg = String(e.message || '').trim();
  if (msg) return msg;
  const reason = bcwHuman(e.reason);
  if (reason) return reason;
  return BCW_ESC_KIND[String(e.kind || '').toLowerCase()] || '';
};

// Trim a message preview. Long previews were the other half of the clutter
// problem — a wrapped paragraph in a 10px meta line reads as a smear.
const bcwSnip = (s, n = 58) => {
  const t = (typeof bcPreviewPlain === 'function' ? bcPreviewPlain(s) : String(s || '')).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// Cap on quiet rows. Loud ones are never dropped — if forty conversations
// need the operator, forty is the honest answer. Quiet ones are context,
// and past a dozen they stop being context and start being a wall.
const BCW_QUIET_MAX = 8;

// How long the dashboard ghost bar waits for an action to report back
// before it stops shimmering and says so. Matches GHOST_ACTION_TIMEOUT_MS
// in the ghost chat so both surfaces behave the same way.
const BCW_GHOST_ACTION_TIMEOUT_MS = 45000;

// ── WHERE A FEED ROW ACTUALLY POINTS ──────────────────────────────────
// Opening the conversation is only half of what a notification promises.
// A row that says "Marco needs a human" should land the operator ON the
// escalation, not at the bottom of a 400-message thread with the reason
// somewhere above the fold. Each row therefore carries an anchor — the
// same { ts, text, role, match } shape the profile popup already uses for
// 'bc:jumpToMessage' — describing the bubble it is talking about:
//
//   alert            the customer message that triggered the escalation
//                    (escalation time, newest bubble at or before it)
//   waiting / reply  the FIRST unread inbound message, so the operator
//                    starts reading where they stopped, not at the end
//   payment/pending  whatever was being said when the money moved
//   recent           the latest message
//
// The thread may not be loaded in this browser yet (threads are fetched
// when a chat is opened), so every anchor falls back to the row's own
// timestamp. That still resolves correctly: the jump is parked and re-run
// by the thread view once the messages arrive.
const bcwMsgTs = (m) => {
  const v = m && m.ts ? +new Date(m.ts) : 0;
  return isFinite(v) ? v : 0;
};
// Each anchor describes the target in terms the chat resolves EXACTLY
// against its real, fully loaded thread when the jump runs — never against
// whatever slice of the thread happened to be cached in this browser when
// the feed rendered (often just the latest message, which is how a
// "waiting" row used to land on the last bubble instead of the first
// unread one):
//
//   firstUnread: N  the Nth customer message from the end
//   last: true      the newest bubble
//   target: {id}    a specific server message (the escalation's own)
//   ts / match      only a fallback when none of the above can resolve
const bcwRowAnchor = (c, kind, sec) => {
  const fallback = sec ? { ts: sec * 1000, match: 'before' } : null;

  if (kind === 'payment' || kind === 'pending') return fallback;

  if (kind === 'alert') {
    const e = (c && c.escalation) || {};
    const raised = e.raised || e.raised_at || e.at || e.ts || null;
    const rid = Number(e.raised_msg_id || e.msg_id || 0);
    // 'before' because the stamp is when the AI NOTICED, which is always
    // just after the customer message that caused it.
    if (rid > 0 || raised) {
      return { target: rid > 0 ? { id: rid } : null, ts: raised || (sec ? sec * 1000 : undefined),
               role: 'in', match: 'before' };
    }
    return fallback ? { ...fallback, role: 'in' } : null;
  }

  if (kind === 'waiting' || kind === 'reply') {
    const unread = Math.max(1, Number(c && c.unread) || 1);
    return { firstUnread: unread, role: 'in', ts: sec ? sec * 1000 : undefined, match: 'before' };
  }

  return { last: true, ts: sec ? sec * 1000 : undefined, match: 'before' };
};
// The anchor as of RIGHT NOW. Worked out on click rather than when the row
// was rendered, so it uses the conversation's current unread count and
// escalation, not a snapshot from minutes ago.
const bcwAnchorNow = (convs, item) => {
  if (!item) return null;
  const conv = (convs || []).find(c => c && c.id === item.convId);
  try { return bcwRowAnchor(conv, item.kind, item.sec) || item.anchor || null; }
  catch (_) { return item.anchor || null; }
};

// The activity feed. One row per conversation, never one per message.
//
// `isSeen` applies only to payments: they're discrete events with no other
// read-state, so the panel has to remember them. Conversation rows are
// derived live from unread/escalation instead, which means they clear
// themselves the moment the operator actually reads the chat — no ledger to
// drift out of sync, and no way for a row to sit there claiming attention
// after it's been dealt with.
const bcwActivity = (convs, payments, isSeen, isMuted) => {
  const items = [];

  (payments || []).filter(p => !p.wiped).slice(0, 24).forEach(p => {
    const pending = p.status === 'pending';
    items.push({
      id: p.id,
      kind: pending ? 'pending' : 'payment',
      sec: p.sec,
      convId: p.convId,
      loud: !isSeen(p.id),
      title: pending ? `Payment pending · ${p.customer}` : `${p.customer} paid`,
      sub: pending
        ? `${p.conf}/${p.minConf} confirmed · ${bcwHuman(p.pkg)}`
        : [bcwHuman(p.pkg), p.asset].filter(Boolean).join(' · '),
      amount: bcwChipMoney(p.usd),
      anchor: bcwRowAnchor(
        (convs || []).find(c => c && c.id === p.convId),
        pending ? 'pending' : 'payment', p.sec),
    });
  });

  (convs || []).forEach(c => {
    if (!c || isMuted(c.id)) return;          // muted contacts raise nothing
    const st = bcwConvState(c);
    if (!st) return;
    const unread = Number(c.unread) || 0;
    const snip   = bcwSnip(c.last);
    // ONE line of supporting text, as a single string.
    //
    // This was a dot-separated list of parts laid out with flexbox, and it
    // never worked: the parts competed for the same width, so the trailing
    // one ("Telegram") was the thing that got chopped — the least useful
    // fragment surviving as "Telegra…" while the message it was qualifying
    // had room to spare. One string with one ellipsis, truncating at the
    // end where truncation belongs. The platform is gone; it was never
    // worth the width it was costing.
    const sub = bcwHuman({
      alert:   bcwSnip(bcwEscLine(c) || c.last),
      waiting: unread > 1 ? `${unread} unread · ${snip}` : snip,
      reply:   snip,
      recent:  snip,
    }[st.kind]);

    items.push({
      // Stable per conversation and state — a second message arriving does
      // not mint a new row, it updates this one.
      id:     st.kind + ':' + c.id,
      kind:   st.kind,
      sec:    bcwConvSec(c),
      convId: c.id,
      loud:   st.loud,
      title: {
        alert:   `${c.name} needs a human`,
        waiting: `${c.name} is waiting`,
        reply:   `${c.name} replied`,
        // Plain history needs no verb — the name and the last line say it.
        recent:  c.name,
      }[st.kind],
      sub,
      anchor: bcwRowAnchor(c, st.kind, bcwConvSec(c)),
    });
  });

  items.sort((a, b) => b.sec - a.sec);
  const loud  = items.filter(i => i.loud);
  const quiet = items.filter(i => !i.loud).slice(0, BCW_QUIET_MAX);
  return loud.concat(quiet).sort((a, b) => b.sec - a.sec);
};

// Groups the feed. Anything asking for the operator is lifted out of the
// timeline into its own section at the top — an escalation from two hours
// ago outranks chatter from two minutes ago, and strict reverse-chronology
// buries exactly the rows the panel exists to surface. Everything else
// keeps the Today / Yesterday / Earlier split.
const bcwGroups = (items) => {
  const midnight = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime() / 1000; })();
  const loud = items.filter(i => i.loud);
  const rest = items.filter(i => !i.loud);
  const days = [
    {label:'Today',     items:[]},
    {label:'Yesterday', items:[]},
    {label:'Earlier',   items:[]},
  ];
  rest.forEach(i => {
    if (i.sec >= midnight)              days[0].items.push(i);
    else if (i.sec >= midnight - 86400) days[1].items.push(i);
    else                                days[2].items.push(i);
  });
  const out = [];
  if (loud.length) out.push({label:'Needs you', items:loud, urgent:true});
  days.forEach(g => { if (g.items.length) out.push(g); });
  return out;
};

const BCW_KIND = {
  payment: {icon:'wallet', label:'Payment', tint:'ok'},
  pending: {icon:'clock',  label:'Pending', tint:'warn'},
  alert:   {icon:'alert',  label:'Alert',   tint:'err'},
  waiting: {icon:'msg',    label:'Waiting', tint:'warn'},
  reply:   {icon:'msg',    label:'Reply',   tint:'idle'},
  recent:  {icon:'users',  label:'Recent',  tint:'info'},
};

// Anchors a portalled panel under a chip, re-placing it on resize.
const useBcwAnchor = (open, anchorRef, width) => {
  const [pos, setPos] = React.useState(null);
  React.useEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const el = anchorRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({
        left: Math.max(12, Math.min(window.innerWidth - width - 12, r.right - width)),
        top:  Math.round(r.bottom + 9),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, width, anchorRef]);
  return pos;
};

// Outside-click + Escape dismissal shared by both bubbles.
const useBcwDismiss = (open, close, refs) => {
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (refs.some(r => r.current && r.current.contains(e.target))) return;
      close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
};

// Re-render when PAYMENTS_STORE changes. Both bubbles read invoices, and
// neither used to subscribe — the money chip derived its figure once on
// mount with an empty dependency list, so a payment confirming never moved
// it off whatever it said at boot. This is that subscription.
// Shared frozen empty array. Returning a fresh [] on the miss path would
// hand back a new identity every render, and since these values are used
// as memo dependencies that would defeat the memoisation the subscription
// exists to make correct.
const BCW_NONE = [];

const useBcwPayments = () => {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    if (typeof PAYMENTS_STORE === 'undefined' || !PAYMENTS_STORE.sub) return;
    return PAYMENTS_STORE.sub(force);
  }, []);
  try { return PAYMENTS_STORE.invoices || BCW_NONE; } catch (_) { return BCW_NONE; }
};

const useBcwProducts = () => {
  const [list, setList] = React.useState(() => {
    try { return PRODS_STORE.list || BCW_NONE; } catch (_) { return BCW_NONE; }
  });
  React.useEffect(() => {
    if (typeof PRODS_STORE === 'undefined' || !PRODS_STORE.sub) return;
    return PRODS_STORE.sub(setList);
  }, []);
  return list;
};

// Opens a conversation in the chat pane AND scrolls to the message the row
// is about. The app listens for 'bc-open-conv' (bot-app.jsx); the thread
// view listens for 'bc:jumpToMessage' (bot-ui-shared.jsx) and parks a
// request it can't satisfy yet, which is what makes this work on a chat
// that isn't open — the open, the mount and the message fetch all have to
// happen first.
//
// Both halves are needed. The parked request covers the cold path (chat
// not open); the delayed event covers the warm one (already open and
// rendered, so nothing re-renders and nothing would consume the park).
const bcwOpenConv = (convs, convId, anchor) => {
  if (!convId) return false;
  const conv = (convs || []).find(c => c.id === convId)
    || (typeof bcConvLookup === 'function' ? bcConvLookup(convId) : null);
  if (!conv) return false;
  convId = conv.id;
  const detail = anchor ? { convId, ...anchor } : null;
  if (detail) {
    try { window.__bcPendingJump = { ...detail, __expires: Date.now() + 15000 }; } catch (_) {}
  }
  try { window.dispatchEvent(new CustomEvent('bc-open-conv', {detail:{msg: conv, jump: detail}})); }
  catch (_) { return false; }
  if (detail) {
    setTimeout(() => {
      try { window.dispatchEvent(new CustomEvent('bc:jumpToMessage', { detail })); } catch (_) {}
    }, 260);
  }
  return true;
};

const bcwPortal = (node) => {
  if (typeof document === 'undefined' || !window.ReactDOM || !window.ReactDOM.createPortal) return node;
  return window.ReactDOM.createPortal(node, document.body);
};

const NotificationsBubble = () => {
  const convs    = useMsgs();
  const invoices = useBcwPayments();
  const products = useBcwProducts();
  const [open, setOpen] = React.useState(false);
  // Read-ledger for PAYMENTS only — see bcwActivity for why conversation
  // rows deliberately don't use one.
  const [seen, setSeen] = React.useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(BCW_SEEN_LS) || '[]')); }
    catch (_) { return new Set(); }
  });
  const [, tick] = React.useReducer(x => x + 1, 0);
  // Muted contacts raise nothing, so the feed has to re-derive when a mute
  // is toggled from the contact list's context menu.
  const [, bumpMute] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    if (typeof BLOCK_STORE === 'undefined' || !BLOCK_STORE.sub) return;
    return BLOCK_STORE.sub(bumpMute);
  }, []);
  const btnRef = React.useRef(null);
  const popRef = React.useRef(null);
  const close  = React.useCallback(() => setOpen(false), []);
  useBcwDismiss(open, close, [btnRef, popRef]);
  const pos = useBcwAnchor(open, btnRef, BCW_NOTIF_POP_W);

  // Keeps the relative timestamps honest without re-rendering constantly.
  React.useEffect(() => { const id = setInterval(tick, 60000); return () => clearInterval(id); }, []);

  // Read at render rather than inside the memo so a sign-in that changes
  // which workspace this is actually invalidates the derived rows.
  const demo = bcwIsDemo();
  const payments = React.useMemo(
    () => bcwPaymentRows(convs, products, demo),
    [convs, products, invoices, demo]
  );
  const isSeen  = React.useCallback((id) => seen.has(id), [seen]);
  const isMuted = React.useCallback(
    (id) => { try { return BLOCK_STORE.isMuted(id); } catch (_) { return false; } }, []);

  const items = React.useMemo(
    () => bcwActivity(convs, payments, isSeen, isMuted),
    [convs, payments, isSeen, isMuted]
  );
  // The badge counts what's asking for the operator, not how many messages
  // arrived. A conversation the AI is handling contributes nothing, and a
  // conversation that needs a human contributes exactly one however many
  // times the customer writes.
  const unread = items.filter(i => i.loud).length;
  const tone   = items.some(i => i.loud && i.kind === 'alert') ? 'alert' : 'calm';

  // Opening the panel retires the payment events — they're one-time facts
  // and the operator has now seen them. Conversation rows are untouched:
  // they stop being loud when the chat is actually read.
  const payIdsRef = React.useRef([]);
  payIdsRef.current = items.filter(i => i.kind === 'payment' || i.kind === 'pending').map(i => i.id);
  React.useEffect(() => {
    if (!open) return;
    setSeen(prev => {
      const next = new Set(prev);
      payIdsRef.current.forEach(id => next.add(id));
      // Cap the ledger so it can't grow without bound in localStorage.
      const capped = new Set([...next].slice(-400));
      try { localStorage.setItem(BCW_SEEN_LS, JSON.stringify([...capped])); } catch (_) {}
      return capped;
    });
  }, [open]);

  // One ordering for everything: whatever needs the operator floats to a
  // group at the top, the rest falls into the timeline beneath it.
  const days = bcwGroups(items);

  return (
    <>
      <button
        ref={btnRef}
        className="bcw-chip bcw-chip-icon"
        data-on={open ? '1' : '0'}
        aria-label={unread ? `Activity, ${unread} needing attention` : 'Activity'}
        title={unread ? `${unread} needs you` : 'Activity — nothing needs you'}
        onClick={() => setOpen(o => !o)}
      >
        <WIcon name="bell" size={14}/>
        {unread > 0 && (
          <span className="bcw-chip-count" data-tone={tone}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && pos && bcwPortal(
        <div ref={popRef} className="bcw-pop" style={{left:pos.left, top:pos.top, width:BCW_NOTIF_POP_W}} role="dialog">
          {/* No header, no tabs. Both were saying what the list already
              says: the header's "N needs you" duplicated the count on the
              NEEDS YOU group heading, and every tab was a filter over an
              ordering that already puts the urgent things first and the
              rest in time order. Removing them means the panel opens
              straight onto its content. */}
          <div className="bcw-pop-scroll" data-bare="1">
            {!days.length ? (
              <div className="bcw-pop-empty">
                <div className="bcw-pop-empty-t">Nothing needs you</div>
                <div className="bcw-pop-empty-s">Escalations, unanswered customers and payments appear here. Chats the AI is handling stay out of the way.</div>
              </div>
            ) : days.map(g => (
              <React.Fragment key={g.label}>
                <div className="bcw-nday" data-urgent={g.urgent ? '1' : '0'}>
                  {g.label}
                  {g.urgent && <span className="bcw-ndayc">{g.items.length}</span>}
                </div>
                {g.items.map(i => {
                  const k = BCW_KIND[i.kind] || BCW_KIND.reply;
                  const canOpen = !!i.convId;
                  return (
                    <button
                      key={i.id}
                      type="button"
                      className="bcw-nrow"
                      data-fresh={i.loud ? '1' : '0'}
                      data-act={canOpen ? '1' : '0'}
                      disabled={!canOpen}
                      title={canOpen ? (i.anchor ? 'Open this conversation at this message' : 'Open this conversation') : undefined}
                      onClick={() => { if (bcwOpenConv(convs, i.convId, bcwAnchorNow(convs, i))) setOpen(false); }}
                    >
                      <span className="bcw-nrow-ico" data-tint={k.tint}><WIcon name={k.icon} size={11}/></span>
                      <span className="bcw-nrow-text">
                        <span className="bcw-nrow-title">{i.title}</span>
                        {!!i.sub && <span className="bcw-nrow-sub">{i.sub}</span>}
                      </span>
                      <span className="bcw-nrow-right">
                        {i.amount && <span className="bcw-nrow-amt" data-kind={i.kind}>{i.amount}</span>}
                        <span className="bcw-nrow-t">{bcwAgo(i.sec)}</span>
                      </span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

// ── NET CHIP: FIGURE THAT COUNTS ──────────────────────────────────────
// The chip's amount rolls from its old value to the new one instead of
// jumping, eased out so it lands softly. Written straight to the text node
// each frame (no React render per frame), and at the precision the final
// figure will have, so the digits don't flicker between "12.3" and "12.35"
// on the way. Reduced motion: it just changes.
const bcwReduceMotion = () => {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (_) { return false; }
};
const BcwCountMoney = ({ value, className }) => {
  const ref = React.useRef(null);
  const shownRef = React.useRef(null);        // null until the first paint
  const rafRef = React.useRef(0);
  const target = Number(value) || 0;
  const fmtAt = React.useCallback((v, final) => {
    // Round the in-between values to the final figure's own precision.
    const cents = Math.abs(final) < 100;
    const r = cents ? Math.round(v * 100) / 100 : Math.round(v);
    return bcwChipMoney(r);
  }, []);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(rafRef.current);
    // The very first value counts up from zero — that's the intro on load.
    // After that, every change counts from whatever is on screen.
    const from = shownRef.current == null ? 0 : shownRef.current;
    if (from === target || bcwReduceMotion() || !isFinite(from)) {
      shownRef.current = target;
      el.textContent = bcwChipMoney(target);
      return;
    }
    // Bigger changes take a little longer, never long enough to wait on.
    const dist = Math.abs(target - from);
    const dur = Math.max(480, Math.min(1100, 420 + Math.log10(dist + 1) * 170));
    if (!el.textContent) el.textContent = fmtAt(from, target);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 4);       // ease-out quart: quick start, soft landing
      const v = from + (target - from) * e;
      shownRef.current = v;
      el.textContent = p < 1 ? fmtAt(v, target) : bcwChipMoney(target);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else shownRef.current = target;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, fmtAt]);
  // Rendered empty: the text is owned by the effect above, so React never
  // fights it for the node.
  return <span ref={ref} className={className} aria-hidden="true"/>;
};

// How long the amount stays out after a payment lands, and after load.
const BCW_NET_INTRO_MS   = 3200;
const BCW_NET_PAYMENT_MS = 4600;
const BCW_NET_BUMP_MS    = 1800;
const BCW_NET_LEAVE_MS   = 320;   // grace after the pointer leaves

// `sheet`: the phone version (see the Payments section of the settings
// sheet, bot-ui-settings.jsx). The chip is a plain wallet button, and the
// breakdown opens as a full-screen sheet with a title bar and a close
// button instead of a dropdown under the chip.
const ProfitBubble = ({sheet = false}) => {
  const convs    = useMsgs();
  const invoices = useBcwPayments();
  const products = useBcwProducts();
  const [open,  setOpen]  = React.useState(false);
  const [range, setRange] = React.useState(() => {
    try { const v = localStorage.getItem(BCW_RANGE_LS); return BCW_RANGES.some(r => r.id === v) ? v : 'today'; }
    catch (_) { return 'today'; }
  });
  const [, tick] = React.useReducer(x => x + 1, 0);
  const btnRef = React.useRef(null);
  const popRef = React.useRef(null);
  const close  = React.useCallback(() => setOpen(false), []);
  useBcwDismiss(open, close, [btnRef, popRef]);
  const pos = useBcwAnchor(open, btnRef, BCW_PROFIT_POP_W);

  React.useEffect(() => { const id = setInterval(tick, 60000); return () => clearInterval(id); }, []);

  // Every one of these recomputes when an invoice lands. They previously
  // had an empty dependency list, which is why the chip sat at its boot
  // value for the life of the session.
  const demo      = bcwIsDemo();
  const rows      = React.useMemo(() => bcwPaymentRows(convs, products, demo), [convs, products, invoices, demo]);
  const confirmed = React.useMemo(() => rows.filter(r => r.status === 'confirmed'), [rows]);
  const pending   = React.useMemo(() => rows.filter(r => r.status === 'pending'),   [rows]);
  const p         = React.useMemo(() => bcwProfit(confirmed), [confirmed]);
  const hourly    = React.useMemo(() => bcwHourly(confirmed), [confirmed]);
  const hourMax   = Math.max(1, ...hourly);

  const pick = (id) => {
    setRange(id);
    try { localStorage.setItem(BCW_RANGE_LS, id); } catch (_) {}
  };

  const gross = p.gross[range] || 0;
  const fees  = gross * BCW_FEE_RATE;
  const net   = gross - fees;
  const prev  = p.prev[range];
  const delta = (prev == null || prev === 0) ? null : ((gross - prev) / prev) * 100;
  const meta  = BCW_RANGES.find(r => r.id === range) || BCW_RANGES[0];
  const n     = p.count[range] || 0;
  const avg   = n ? gross / n : 0;
  const pendingTotal = pending.reduce((s, r) => s + r.usd, 0);
  const last  = confirmed[0] || null;
  const recent = (p.inRange[range] || []).slice(0, sheet ? 8 : 3);

  // ── WHEN THE AMOUNT SHOWS ─────────────────────────────────────────
  // At rest the chip is just the wallet glyph. The figure slides out:
  //   • once on load, when the payments have actually arrived (counting up
  //     from zero), then tucks away again;
  //   • while the pointer or keyboard focus is on it;
  //   • while its breakdown is open;
  //   • when a new payment confirms — it opens, counts up to the new
  //     total with a brief green lift, then tucks away.
  let loaded = demo;
  try { loaded = loaded || !!(typeof PAYMENTS_STORE !== 'undefined' && PAYMENTS_STORE.loaded); } catch (_) {}
  const [hover, setHover]   = React.useState(false);
  const [pulse, setPulse]   = React.useState(false);
  const [bump,  setBump]    = React.useState(false);
  const timers = React.useRef({});
  const later = React.useCallback((k, ms, fn) => {
    clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(fn, ms);
  }, []);
  React.useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  // Intro: waits for the data, so it never shows a placeholder $0 that
  // then jumps. If loading stalls, it shows whatever it has after 4s.
  const introDone = React.useRef(false);
  const runIntro = React.useCallback(() => {
    if (introDone.current) return;
    introDone.current = true;
    setPulse(true);
    later('pulse', BCW_NET_INTRO_MS, () => setPulse(false));
  }, [later]);
  React.useEffect(() => {
    if (loaded) { runIntro(); return; }
    later('introFallback', 4000, runIntro);
  }, [loaded, runIntro, later]);

  // New payments. The confirmed set at load is the baseline; anything that
  // confirms after it is news. An invoice that was already pending at load
  // and confirms later counts too (it wasn't in the CONFIRMED baseline).
  // Money going DOWN (a refund, a range switch) is shown but not announced.
  const seenRef = React.useRef(null);
  const confirmedSig = confirmed.map(r => r.id).join('|');
  React.useEffect(() => {
    // Signed out / switching workspace: the next load is a new baseline,
    // not a flood of "new" payments.
    if (!loaded) { seenRef.current = null; return; }
    const ids = confirmed.map(r => r.id);
    if (!seenRef.current) { seenRef.current = new Set(ids); return; }
    const fresh = ids.filter(id => !seenRef.current.has(id));
    ids.forEach(id => seenRef.current.add(id));
    if (!fresh.length) return;
    introDone.current = true;               // a payment beats the intro
    setPulse(true);
    setBump(true);
    later('pulse', BCW_NET_PAYMENT_MS, () => setPulse(false));
    later('bump', BCW_NET_BUMP_MS, () => setBump(false));
  }, [confirmedSig, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const enter = () => { clearTimeout(timers.current.leave); setHover(true); };
  const leave = () => later('leave', BCW_NET_LEAVE_MS, () => setHover(false));
  const expanded = open || hover || pulse;

  // The reveal animates to the figure's real width, measured, so it fits
  // the amount exactly as the amount changes (and follows it while it
  // counts). A plain max-width trick would ease over the wrong distance.
  const innerRef = React.useRef(null);
  const [innerW, setInnerW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.ceil(el.scrollWidth);
      setInnerW(prev => (prev === w ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const netLabel = `Net ${meta.label ? meta.label.toLowerCase() : ''}: ${bcwChipMoney(net)}`.replace(/\s+:/, ':');

  // The breakdown itself — the same in the dropdown and the sheet.
  const panel = (
    <>
          {/* The "Money taken" header is gone, the same way the
              notifications header went: the hero figure is right underneath
              it labelled "net taken", so the title was naming something the
              content already named. The payment count moved down into the
              hero's own meta line, where it sits next to the number it
              describes instead of above it in separate chrome.

              The range strip STAYS, unlike the notification tabs. Those were
              filters over an ordering that already surfaced everything; these
              change which figures the panel is showing, and there's no way to
              express "last 7 days" by sorting. It doubles as the top edge now
              that nothing sits above it. */}
          <div className="bcw-pop-tabs" data-bare="1">
            {BCW_RANGES.map(r => (
              <button key={r.id} onClick={() => pick(r.id)} aria-selected={range === r.id}>
                {r.label}
              </button>
            ))}
          </div>

          <div className="bcw-pf-hero">
            <div className="bcw-pf-val">{bcwMoney(net)}</div>
            <div className="bcw-pf-herometa">
              <span className="bcw-pf-herolbl">
                net taken · {n} payment{n === 1 ? '' : 's'}
              </span>
              {delta != null && (
                <span className="bcw-pf-delta" data-dir={delta >= 0 ? 'up' : 'down'}>
                  {bcwCaret(delta >= 0 ? 'up' : 'down')}
                  {Math.abs(delta).toFixed(1)}%
                  <span className="bcw-pf-deltanote">vs prev</span>
                </span>
              )}
            </div>
          </div>

          <div className="bcw-pf-chart">
            <div className="bcw-pf-bars" title="Revenue by hour, last 24 hours">
              {hourly.map((v, i) => (
                <span key={i} className="bcw-pf-bar" data-zero={v === 0 ? '1' : '0'}
                  style={{height: `${Math.max(3, (v / hourMax) * 100)}%`}}/>
              ))}
            </div>
            <div className="bcw-pf-axis">
              <span>24h ago</span>
              <span>hourly</span>
              <span>now</span>
            </div>
          </div>

          {/* Four figures the single net number can't carry on its own:
              what came in before fees, what the fees cost, what's still
              waiting on confirmations, and the shape of the sales. */}
          <div className="bcw-pf-grid">
            <div className="bcw-pf-cell">
              <span className="bcw-pf-k">Gross</span>
              <span className="bcw-pf-v">{bcwMoney(gross)}</span>
            </div>
            <div className="bcw-pf-cell">
              <span className="bcw-pf-k">Est. fees · 1.2%</span>
              <span className="bcw-pf-v" data-tone="neg">−{bcwMoney(fees)}</span>
            </div>
            <div className="bcw-pf-cell">
              <span className="bcw-pf-k">Pending{pending.length ? ` · ${pending.length}` : ''}</span>
              <span className="bcw-pf-v" data-tone={pendingTotal ? 'warn' : ''}>{bcwMoney(pendingTotal)}</span>
            </div>
            <div className="bcw-pf-cell">
              <span className="bcw-pf-k">Avg · best</span>
              <span className="bcw-pf-v">{bcwMoney(avg)} · {bcwMoney(p.best[range] || 0)}</span>
            </div>
          </div>

          {recent.length > 0 ? (
            <div className="bcw-pf-recent">
              <div className="bcw-pf-rechead">
                <span>Recent</span>
                {last && <span className="bcw-pf-recago">last {bcwAgo(last.sec)} ago</span>}
              </div>
              {recent.map(r => (
                <button key={r.id} type="button" className="bcw-pf-recrow"
                  data-act={r.convId ? '1' : '0'} disabled={!r.convId}
                  title={r.convId ? 'Open this conversation' : undefined}
                  onClick={() => { if (bcwOpenConv(convs, r.convId)) setOpen(false); }}>
                  <span className="bcw-pf-recwho">
                    <span className="bcw-pf-recname">{r.customer}</span>
                    <span className="bcw-pf-recpkg">{[r.pkg, r.asset].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="bcw-pf-recamt" data-pending={r.status === 'pending' ? '1' : '0'}>
                    {bcwChipMoney(r.usd)}
                  </span>
                </button>
              ))}
            </div>
          ) : sheet ? (
            <div className="bcw-pf-none">No payments {meta.label ? meta.label.toLowerCase() : 'yet'}</div>
          ) : null}
    </>
  );

  // The dashboard chip only earns its place once there's somewhere for
  // money to go: no wallet address yet, no chip (Payments → Wallets is where
  // one is added). The Payments sheet's own button always shows.
  let hasWallet = demo;
  try {
    const ws = (typeof PAYMENTS_STORE !== 'undefined' && PAYMENTS_STORE.wallets) || {};
    hasWallet = hasWallet || Object.values(ws).some(w => w && String(w.address || '').trim());
  } catch (_) {}
  if (!sheet && !hasWallet) return null;

  if (sheet) {
    return (
      <>
        {/* The wallet glyph and the net figure, so it reads as money (the
            Payments tabs beside it already have a wallets icon). */}
        <button ref={btnRef} type="button" className="bcw-sheet-btn" data-on={open ? '1' : '0'}
          data-bump={bump ? '1' : '0'}
          aria-label={`Earnings — ${netLabel}`} title="Earnings"
          onClick={() => setOpen(true)}>
          <WIcon name="wallet" size={13}/>
          <span className="bcw-sheet-btn-fig">{bcwChipMoney(net)}</span>
        </button>
        {open && bcwPortal(
          <div ref={popRef} className="bcw-pop bcw-pop-sheet" role="dialog" aria-modal="true" aria-label="Earnings"
            onClick={e => e.stopPropagation()}>
            <div className="bcw-sheet-hd">
              <span className="bcw-sheet-title">Earnings</span>
              <button type="button" className="bcw-sheet-x" onClick={close} aria-label="Close earnings">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="bcw-sheet-body">{panel}</div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        className="bcw-chip bcw-chip-read bcw-chip-net"
        data-on={open ? '1' : '0'}
        data-open={expanded ? '1' : '0'}
        data-bump={bump ? '1' : '0'}
        data-zero={net === 0 ? '1' : '0'}
        aria-label={`${netLabel} — open the breakdown`}
        title={expanded ? 'Click for the full breakdown' : netLabel}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
      >
        <span className="bcw-chip-glyph"><WIcon name="wallet" size={13}/></span>
        <span className="bcw-chip-reveal" style={{ width: expanded ? innerW : 0 }} aria-hidden={!expanded}>
          <span className="bcw-chip-reveal-in" ref={innerRef}>
            <span className="bcw-chip-rule"/>
            <BcwCountMoney value={net} className="bcw-chip-fig"/>
          </span>
        </span>
      </button>

      {open && pos && bcwPortal(
        <div ref={popRef} className="bcw-pop" style={{left:pos.left, top:pos.top, width:BCW_PROFIT_POP_W}} role="dialog">
          {panel}
        </div>
      )}
    </>
  );
};

const WidgetLauncherButton = ({editing, onToggle, style}) => (
  <button
    onClick={onToggle}
    title="Edit dashboard widgets"
    data-bcw-launcher
    className="bcw-launch-btn"
    data-on={editing?'1':'0'}
    style={style}
  >
    <WIcon name="sliders" size={10}/>
    widgets
  </button>
);

// expose globally
window.WidgetDashboardOverlay = WidgetDashboardOverlay;
window.WidgetLauncherButton  = WidgetLauncherButton;
window.MinimalTicker         = MinimalTicker;
window.NotificationsBubble   = NotificationsBubble;
window.ProfitBubble          = ProfitBubble;