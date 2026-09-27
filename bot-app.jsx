// ───────────────────────────────────────────────────────────────────
// bot-app.jsx — Top-level App component, demo seed, payments view, mount
// The thinnest file. This is what you edit when you want to wire a new
// page into the sidebar / settings sheet, or change the boot sequence.
//     TWEAK_DEFAULTS                   — design-tweaks edit-mode markers
//     seedDemoMessages                 — populates MSGS_STORE for the demo account
//     PaymentsView (+ CoinBadge / CoinPicker / PaymentWalletEditor / PaymentInvoicesPanel)
//                                      — Wallets + Invoices tabs
//     App                              — root component, owns view-routing,
//                                        chat-popup state, settings-sheet open state
//     ReactDOM.createRoot(...).render(<App/>)   — final mount
// ───────────────────────────────────────────────────────────────────

// ── APP ───────────────────────────────────────────────────────
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentColor": "#8b8fa3",
  "chatWidth": 680,
  "compactTable": false
}/*EDITMODE-END*/;

// ── DEMO MESSAGES SEED ──────────────────────────────────────
// Populates MSGS_STORE with sample conversations + threads when running in
// the design preview (no backing API). Only fires when the active account
// is the demo account; real users fetch their own data from get_conversations.
const seedDemoMessages = () => {
  if (MSGS_STORE.list.length) return;          // don't double-seed
  const t = (h, m) => String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  const conversations = [
    { id:'tg_1001', chatId:'1001', p:'telegram', name:'Maya Lindqvist', handle:'@mayalind', avatar:'',
      chatType:'private', col:'#7c6ef5', stage:'prospect', last:'Do you ship to Sweden?', t:t(14,32),
      ai:'replying', agent:'Sales Bot', unread:2, agent_id:null, auto_reply:true, memSummary:'Interested in mid-tier subscription. EU customer.' },
    { id:'tg_1002', chatId:'1002', p:'telegram', name:'Daniel Okafor', handle:'@danokafor', avatar:'',
      chatType:'private', col:'#e8a844', stage:'needs_help', last:"This pricing page link is broken", t:t(14,18),
      ai:'waiting', agent:'Support Bot', unread:1, agent_id:null, auto_reply:false, memSummary:'Reported broken link in onboarding flow.' },
    { id:'dc_2001', chatId:'2001', p:'discord', name:'Riley Chen', handle:'riley_c', avatar:'',
      chatType:'private', col:'#43c98a', stage:'customer', last:'You: Glad it worked! Let me know if anything else comes up.', t:t(13,55),
      ai:'paused', agent:'Sales Bot', unread:0, agent_id:null, auto_reply:true, memSummary:'Pro plan since March. Renewal in 4 months.' },
    { id:'tg_1003', chatId:'1003', p:'telegram', name:'Sofia Marchetti', handle:'@sofiam', avatar:'',
      chatType:'private', col:'#d060d0', stage:'vip', last:"Can we hop on a call tomorrow?", t:t(13,40),
      ai:'paused', agent:'VIP Bot', unread:0, agent_id:null, auto_reply:false, memSummary:'Enterprise lead. 200+ seat contract under negotiation.' },
    { id:'dc_2002', chatId:'2002', p:'discord', name:'Jamal Reeves', handle:'jamalr', avatar:'',
      chatType:'private', col:'#5b9cf0', stage:'new', last:'Hey just discovered this from twitter', t:t(13,12),
      ai:'waiting', agent:'Sales Bot', unread:3, agent_id:null, auto_reply:true, memSummary:'' },
    { id:'tg_1004', chatId:'1004', p:'telegram', name:'Aisha Patel', handle:'@aishap', avatar:'',
      chatType:'private', col:'#6c63ff', stage:'prospect', last:'Sounds good, send me the doc', t:t(11,48),
      ai:'paused', agent:'Sales Bot', unread:0, agent_id:null, auto_reply:true, memSummary:'Comparing against two competitors.' },
    { id:'dc_2003', chatId:'2003', p:'discord', name:'Tom Eriksen', handle:'tom_e', avatar:'',
      chatType:'private', col:'#e87550', stage:'customer', last:"Thanks, that fixed it!", t:t(10,22),
      ai:'paused', agent:'Support Bot', unread:0, agent_id:null, auto_reply:true, memSummary:'Power user. Filed 3 useful bug reports last quarter.' },
  ];
  const threads = {
    tg_1001: [
      { r:'in',  c:'Hi! Saw your post on indie hackers — looks great', t:t(14,28), mt:'', mu:'' },
      { r:'bot', c:"Thanks Maya! Happy to walk you through it. What stack are you on?", t:t(14,28), mt:'', mu:'', agent:'Sales Bot' },
      { r:'in',  c:'Mostly Postgres + Next.js. Solo founder', t:t(14,29), mt:'', mu:'' },
      { r:'in',  c:"Quick q — do you ship to Sweden? Pricing page didn't say", t:t(14,32), mt:'', mu:'' },
    ],
    tg_1002: [
      { r:'in',  c:'hey the link in the welcome email 404s', t:t(14,15), mt:'', mu:'' },
      { r:'in',  c:'this one — https://app.example.com/onboarding/start', t:t(14,16), mt:'', mu:'' },
      { r:'out', c:"Thanks for flagging — looking into it now.", t:t(14,17), mt:'', mu:'' },
      { r:'in',  c:'cool. also the pricing page link is broken', t:t(14,18), mt:'', mu:'' },
    ],
    dc_2001: [
      { r:'in',  c:"Got it working — turned out to be a CORS thing on my end", t:t(13,52), mt:'', mu:'' },
      { r:'out', c:"Glad it worked! Let me know if anything else comes up.", t:t(13,55), mt:'', mu:'' },
    ],
    tg_1003: [
      { r:'in',  c:'The team loved the pilot 🎉', t:t(13,38), mt:'', mu:'' },
      { r:'in',  c:'Can we hop on a call tomorrow? Want to discuss enterprise pricing', t:t(13,40), mt:'', mu:'' },
    ],
    dc_2002: [
      { r:'in',  c:'Hey just discovered this from twitter', t:t(13,10), mt:'', mu:'' },
      { r:'in',  c:'is the free tier still a thing or did u sunset it', t:t(13,11), mt:'', mu:'' },
      { r:'in',  c:'asking bc the landing page kinda implied yes but the docs say no lol', t:t(13,12), mt:'', mu:'' },
    ],
    tg_1004: [
      { r:'in',  c:"Got time for a quick comparison vs Acme + Globex?", t:t(11,40), mt:'', mu:'' },
      { r:'bot', c:'Sure — main difference is our usage-based pricing vs their seat licensing. Want me to send a one-pager?', t:t(11,41), mt:'', mu:'', agent:'Sales Bot' },
      { r:'in',  c:'Sounds good, send me the doc', t:t(11,48), mt:'', mu:'' },
    ],
    dc_2003: [
      { r:'in',  c:'Webhook retries are still firing after 24h, expected?', t:t(10,15), mt:'', mu:'' },
      { r:'out', c:"That's the configured backoff window — you can lower it under Settings → Webhooks → Retry policy.", t:t(10,18), mt:'', mu:'' },
      { r:'in',  c:'Thanks, that fixed it!', t:t(10,22), mt:'', mu:'' },
    ],
  };
  MSGS_STORE.list = conversations;
  MSGS_STORE.threads = threads;
  MSGS_STORE.notify();
};

// ── PAYMENTS VIEW ─────────────────────────────────────────────
// Two tabs: "Wallets" (configure CryptAPI callback addresses per coin) and
// "Invoices" (operator-visible log of pending/confirmed payments). The AI
// agent reads from PAYMENTS_STORE.wallets server-side via the credentials
// API — when a customer asks "do you accept BTC?" the bot can answer yes
// and hand out the address. New invoices the AI generates are persisted
// here so the operator can confirm/refund/check status.
// Inside Licenses & payments (_billing) the tab, the search text, the open
// invoice and "New wallet" all come from BillingView, and this view draws
// no tab strip of its own.
const PaymentsView = ({_embed, _billing, tab: tabProp, query, setQuery, walletQuery, setWalletQuery,
                       invOpen: invOpenProp, setInvOpen: setInvOpenProp, newReq, invFilter, invNotice} = {}) => {
  const pay = usePayments();
  const products = useProducts();
  const [tabState, setTab] = React.useState('wallets');
  const tab = _billing ? (tabProp || 'wallets') : tabState;
  // Invoice open in the detail page (popup only); hides the tab strip the
  // same way an open wallet does.
  const [invOpenState, setInvOpenState] = React.useState(null);
  const invOpen    = setInvOpenProp ? invOpenProp : invOpenState;
  const setInvOpen = setInvOpenProp || setInvOpenState;
  const [selCoin, setSelCoin] = React.useState(null);
  const [creating, setCreating] = React.useState(false);
  const [wqState, setWqState] = React.useState('');
  const wq  = setWalletQuery ? (walletQuery || '') : wqState;
  const setWq = setWalletQuery || setWqState;

  const walletList = React.useMemo(()=>(
    Object.entries(pay.wallets).map(([coin, data])=>({coin, ...data}))
  ),[pay.wallets]);

  const blank = ()=>({coin:'btc', address:'', label:'', callback:'', min_confirmations:1, enabled:true});
  const selected = creating ? null : walletList.find(w => w.coin === selCoin);
  const [draft, setDraft] = React.useState(blank());
  const [coinPicker, setCoinPicker] = React.useState('btc');
  const [customCoin, setCustomCoin]  = React.useState('');

  React.useEffect(()=>{
    if (creating) {
      setDraft(blank());
      // Pre-select the first currency that doesn't have a wallet yet.
      const firstFree = CRYPTAPI_COINS.find(c => !pay.wallets[c.id]);
      setCoinPicker(firstFree ? firstFree.id : '__custom__');
      setCustomCoin('');
    } else if (selected) {
      setDraft({...selected});
    }
  // eslint-disable-next-line
  },[selCoin, creating]);

  const upd = (k,v) => setDraft(d => ({...d, [k]:v}));

  const startNew = () => { setCreating(true); setSelCoin(null); };
  // Changing tab from outside closes any open wallet. Declared BEFORE the
  // new-wallet request below: "New wallet" on the Invoices tab switches to
  // Wallets and asks for a new one in the same click, and effects run in
  // order — the other way round, this reset cancelled the new wallet.
  React.useEffect(() => { if (_billing) { setSelCoin(null); setCreating(false); } }, [_billing, tabProp]);
  // "New wallet" from Payments' alert bumps newReq.
  const newSeen = React.useRef(newReq || 0);
  React.useEffect(() => {
    if (!newReq || newReq === newSeen.current) return;
    newSeen.current = newReq;
    startNew();
  // eslint-disable-next-line
  }, [newReq]);

  const save = async () => {
    const coin = creating
      ? (coinPicker === '__custom__' ? customCoin.trim().toLowerCase() : coinPicker)
      : draft.coin;
    if (!coin) { bcToast('Pick a coin first', 'warn'); return; }
    if (!draft.address.trim()) { bcToast('Add the wallet address first', 'warn'); return; }
    const wasNew = creating;
    try {
      await PAYMENTS_STORE.saveWallet(coin, draft);
    } catch (e) {
      bcToast('Couldn’t save the wallet — ' + ((e && e.message) || 'network error'), 'err');
      throw e;
    }
    setCreating(false);
    setSelCoin(coin);
    bcToast(wasNew ? 'Wallet added' : 'Wallet saved', 'ok', { detail: coin.toUpperCase() });
  };

  const del = async () => {
    if (!selected) return;
    if (!window.confirm(`Remove ${selected.coin.toUpperCase()} wallet?`)) return;
    const c = selected.coin.toUpperCase();
    try { await PAYMENTS_STORE.deleteWallet(selected.coin); }
    catch (e) { bcToast('Couldn’t remove the ' + c + ' wallet — ' + ((e && e.message) || 'network error'), 'err'); return; }
    setSelCoin(null);
    bcToast('Wallet removed', 'ok', { detail: c });
  };

  const toggleEnabled = async (w, e) => {
    if (e) e.stopPropagation();
    const on = w.enabled === false;
    try {
      await PAYMENTS_STORE.saveWallet(w.coin, {...w, enabled: on});
      bcToast(on ? 'Now accepting ' + w.coin.toUpperCase() : 'Stopped accepting ' + w.coin.toUpperCase(), 'ok');
    } catch (err) { bcToast('Couldn’t update the ' + w.coin.toUpperCase() + ' wallet', 'err'); }
  };
  // Footer switch in the editor. Saved straight away for an existing wallet
  // (same as the list switch) so it never waits on the Save button.
  const setWalletEnabled = async (next) => {
    upd('enabled', next);
    if (!creating && selected) {
      try {
        await PAYMENTS_STORE.saveWallet(selected.coin, {...selected, enabled: next});
        bcToast(next ? 'Now accepting ' + selected.coin.toUpperCase() : 'Stopped accepting ' + selected.coin.toUpperCase(), 'ok');
      } catch (err) { bcToast('Couldn’t update the ' + selected.coin.toUpperCase() + ' wallet', 'err'); }
    }
  };

  const enabledCount = walletList.filter(w => w.enabled !== false).length;

  return (
    <div className={_embed ? 'sset-pop-page' : ''} style={_embed ? {height:'100%'} : {padding:'24px 20px 32px', height:'100%', overflow:'auto', background:'transparent'}}>
      <div style={_embed ? {flex:1,minHeight:0,display:'flex',flexDirection:'column'} : {maxWidth:1100, margin:'0 auto', display:'flex', flexDirection:'column', gap:18}}>
        {_embed ? (
          (!_billing && !creating && !selected && !(tab === 'invoices' && invOpen)) && (
            <div className="sset-pop-tabs" role="tablist">
              {[{id:'wallets',label:'Wallets'},{id:'invoices',label:'Invoices'}].map(t=>(
                <button key={t.id} role="tab" aria-selected={tab===t.id}
                  onClick={()=>{ setTab(t.id); setSelCoin(null); setCreating(false); setInvOpen(null); }}>
                  {t.label}
                  <span className="sset-pop-tabs-count">{t.id==='wallets' ? walletList.length : pay.invoices.length}</span>
                </button>
              ))}
            </div>
          )
        ) : (
          <div style={{display:'flex',alignItems:'center',gap:0,borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
            {[{id:'wallets',label:'Wallets'},{id:'invoices',label:'Invoices'}].map(t=>(
              <button key={t.id} onClick={()=>{ setTab(t.id); setSelCoin(null); setCreating(false); }}
                style={{padding:'10px 16px',fontSize:12,fontWeight:600,letterSpacing:'-0.01em',background:'transparent',border:'none',cursor:'pointer',color: tab===t.id?'var(--t1)':'var(--t3)',borderBottom: tab===t.id?'2px solid rgba(255,255,255,0.45)':'2px solid transparent',marginBottom:-1, transition:'color 0.12s'}}>
                {t.label}
                <span style={{marginLeft:7,fontSize:10,color:'var(--t4)',fontFamily:'var(--mono)'}}>
                  {t.id==='wallets' ? walletList.length : pay.invoices.length}
                </span>
              </button>
            ))}
            <div style={{flex:1}}/>
            <div style={{fontSize:10.5,color:'var(--t3)',fontFamily:'var(--mono)',paddingRight:4}}>
              {tab==='wallets'
                ? <span><span style={{color:'rgba(120,200,150,0.85)'}}>{enabledCount}</span> / {walletList.length} ACCEPTING</span>
                : <span>{pay.invoices.filter(i=>i.status==='pending').length} PENDING</span>}
            </div>
          </div>
        )}

        {tab === 'wallets' ? (
          <div style={{display:'grid',gridTemplateColumns: _embed ? '1fr' : '320px 1fr', gap: _embed?0:18, minHeight: _embed?0:520, flex:_embed?1:'initial', overflow:_embed?'hidden':'visible'}}>
            {/* LEFT: wallet list + new. In embed mode, hidden when an
                editor is open so the popup shows one screen at a time. */}
            {/* Popup: same list design as Catalog and Invoices (.bc-* in
                bot-ui-settings.jsx) — fixed toolbar, one bordered group of
                56px rows: coin, name + address, confirmations, switch. */}
            {_embed && !creating && !selected && (
            <div style={{display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}}>
              {_billing ? (
                <div className="sl-bar">
                  <BcSearch value={wq} onChange={setWq} placeholder="Search wallets by coin, name or address"/>
                  <SsetLandAdd label="New wallet" onClick={startNew}/>
                </div>
              ) : (
              <div className="sl-bar">
                <span className="sl-bar-count">{walletList.length} wallet{walletList.length===1?'':'s'}</span>
                <button type="button" onClick={startNew} className="sl-bar-add">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  <span>New wallet</span>
                </button>
              </div>
              )}
              <div className="sl-scroll">
                <div className="sl-list">
                  {(() => {
                    const shownWallets = wq.trim()
                      ? walletList.filter(w => { const m = CRYPTAPI_COINS.find(c => c.id === w.coin); return bcMatch(wq, w.label, w.coin, w.address, m && m.label, m && m.ticker); })
                      : walletList;
                    if (!shownWallets.length) {
                      return typeof SsetLandEmpty !== 'undefined' ? (
                        <SsetLandEmpty
                          title={walletList.length ? 'No wallets match' : 'No wallets yet'}
                          sub={walletList.length ? 'Try a coin name or part of the address.' : 'A wallet is where customer payments are sent. Add one for each coin you accept.'}
                          action={walletList.length ? null : {label:'New wallet', onClick:startNew}}/>
                      ) : (
                        <div className="sl-empty">
                          <div className="sl-empty-title">No wallets</div>
                          <div className="sl-empty-sub">Add a wallet to accept crypto payments.</div>
                        </div>
                      );
                    }
                    return shownWallets.map(w => {
                    const enabled = w.enabled !== false;
                    const meta = CRYPTAPI_COINS.find(c => c.id === w.coin);
                    const ticker = (meta?.ticker || (w.coin||'').split('/').pop()).toUpperCase();
                    const open = () => { setCreating(false); setSelCoin(w.coin); };
                    return (
                      <div key={w.coin} role="button" tabIndex={0}
                        onClick={open}
                        onKeyDown={e=>{ if (e.target===e.currentTarget && (e.key==='Enter'||e.key===' ')) { e.preventDefault(); open(); } }}
                        className="sl-row" data-off={enabled?'0':'1'}>
                        <span className="sl-row-media"><SlTile coin><CoinBadge coin={w.coin} sz={20}/></SlTile></span>
                        <span className="sl-row-main">
                          <span className="sl-row-title">{w.label || (meta ? meta.label : ticker)}</span>
                          <span className="sl-row-meta">
                            <span className="sl-stat" data-s={enabled ? 'active' : 'cancelled'}>
                              <i aria-hidden="true"/>{enabled ? 'Accepting' : 'Paused'}
                            </span>
                          </span>
                        </span>
                        <span className="sl-row-trail"><svg className="sl-row-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></span>
                      </div>
                    );
                  });
                  })()}
                </div>
              </div>
            </div>
            )}

            {!_embed && (
            <div style={_embed ? {display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'} : {display:'flex',flexDirection:'column',gap:8}}>
              <div style={_embed ? {padding:'12px 18px 8px',display:'flex',flexDirection:'column',gap:8,flexShrink:0} : {display:'contents'}}>
                <button onClick={startNew}
                  className={_embed?'sset-ghost-btn':''}
                  style={_embed ? {alignSelf:'flex-start'} : {padding:'11px 12px',fontSize:12,fontWeight:600,color:'var(--t2)',background:'rgba(255,255,255,0.035)',border:'1px dashed rgba(255,255,255,0.13)',borderRadius:9,cursor:'pointer',transition:'all 0.12s',display:'flex',alignItems:'center',justifyContent:'center',gap:7,letterSpacing:'-0.01em'}}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  <span>New Wallet</span>
                </button>
              </div>

              <div style={_embed ? {padding:'2px 18px 18px',overflow:'auto',flex:1,display:'flex',flexDirection:'column',gap:5,minHeight:0} : {display:'flex',flexDirection:'column',gap:6}}>
                {walletList.map(w => {
                  const isSel = !creating && w.coin === selCoin;
                  const enabled = w.enabled !== false;
                  const meta = CRYPTAPI_COINS.find(c => c.id === w.coin);
                  return (
                    <button key={w.coin} onClick={()=>{ setCreating(false); setSelCoin(w.coin); }}
                      className={_embed ? 'sset-list-row' : ''}
                      data-on={isSel?'1':'0'}
                      style={_embed ? {padding:'8px 11px'} : {padding:'10px 11px',display:'flex',alignItems:'center',gap:10,background:isSel?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.025)',border:`1px solid ${isSel?'rgba(255,255,255,0.16)':'rgba(255,255,255,0.06)'}`,borderRadius:9,cursor:'pointer',transition:'all 0.12s',textAlign:'left'}}>
                      <CoinBadge coin={w.coin} sz={_embed?28:36}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color: enabled ? 'var(--t1)' : 'var(--t3)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                          {w.label || (meta ? meta.label : w.coin.toUpperCase())}
                        </div>
                        <div style={{fontSize:9.5,color:'var(--t3)',fontFamily:'var(--mono)',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                          {w.address || '—'}
                        </div>
                      </div>
                      {/* Accepting switch — same control as agents and catalog. */}
                      <span className="bc-switch" role="switch" aria-checked={enabled}
                        aria-label={enabled ? 'Accepting payments' : 'Not accepting payments'}
                        data-on={enabled ? '1' : '0'}
                        onClick={e=>toggleEnabled(w, e)}
                        title={enabled ? 'Accepting — click to stop offering this coin' : 'Not offered — click to accept this coin'}/>
                    </button>
                  );
                })}
                {walletList.length===0 && !creating && (
                  <div style={{padding:'30px 12px',textAlign:'center',fontSize:11,color:'var(--t3)',border:'0.5px dashed rgba(255,255,255,0.08)',borderRadius:9}}>
                    No wallets yet — add one to start accepting crypto
                  </div>
                )}
              </div>
            </div>
            )}

            {/* RIGHT: editor — when embedded the popup itself is the
                surface, so we drop the inner glass to avoid nested chrome.
                Headerless back-strip is part of the wrapper; the editor
                body gets proper padding so fields aren't crammed. */}
            {_embed && (creating || selected) && (
              <div style={{display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden',flex:1}}>
                <PaymentWalletEditor
                  _embed={_embed}
                  draft={draft} upd={upd}
                  creating={creating}
                  coinPicker={coinPicker} setCoinPicker={setCoinPicker}
                  customCoin={customCoin} setCustomCoin={setCustomCoin}
                  selectedCoin={selected?.coin}
                  usedCoins={walletList.map(w => w.coin)}
                  original={selected} invoices={pay.invoices}
                  onSave={save} onDelete={del}
                  onToggleEnabled={setWalletEnabled}
                  onBack={()=>{ setCreating(false); setSelCoin(null); }}
                />
              </div>
            )}
            {!_embed && (
            <div style={{background:'rgba(20,22,42,0.82)',backdropFilter:'blur(20px) saturate(160%)',WebkitBackdropFilter:'blur(20px) saturate(160%)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:13, padding:'22px 24px', minHeight:520, boxShadow:'0 4px 32px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.05) inset'}}>
              {!selected && !creating ? (
                <div style={{height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'var(--t3)',padding:'48px 16px',textAlign:'center'}}>
                  <div style={{width:48,height:48,borderRadius:12,background:'rgba(255,255,255,0.04)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                  </div>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--t2)'}}>Select a wallet to edit</div>
                  <div style={{fontSize:11.5}}>Or add a new coin from the list on the left</div>
                </div>
              ) : (
                <PaymentWalletEditor
                  _embed={_embed}
                  draft={draft} upd={upd}
                  creating={creating}
                  coinPicker={coinPicker} setCoinPicker={setCoinPicker}
                  customCoin={customCoin} setCustomCoin={setCustomCoin}
                  selectedCoin={selected?.coin}
                  onSave={save} onDelete={del}
                  onToggleEnabled={setWalletEnabled}
                />
              )}
            </div>
            )}
          </div>
        ) : (
          <PaymentInvoicesPanel _embed={_embed} invoices={pay.invoices} products={products} wallets={pay.wallets}
            openId={invOpen} setOpenId={setInvOpen}
            query={_billing ? query : undefined} setQuery={_billing ? setQuery : undefined}
            filter={invFilter} notice={invNotice}/>
        )}
      </div>
    </div>
  );
};

// ── PAYMENTS ──────────────────────────────────────────────────
// The Payments window: the invoices your agents send, and the wallets
// they are paid into. Its tab pill works like Agents' and Licenses':
// the invoice filters first, then (after a hairline) the setup page.
//   All · Awaiting · Paid · Not paid  |  Wallets
// Licenses have their own window now (LicensesView in bot-ui-views.jsx).
const BILLING_TAB_KEY = 'bc.billing.tab';
const BILLING_INV_TABS = ['all', 'pending', 'confirmed', 'unpaid'];
const BILLING_TAB_IDS = [...BILLING_INV_TABS, 'wallets'];
// Older tab ids (and "open payments on …" requests) → today's tabs.
const BILLING_TAB_ALIAS = { overview:'all', invoices:'all', licenses:'all', api:'all' };
const bcTime = (v) => {
  if (v == null || v === '') return 0;
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v).replace(' ', 'T'));
  return isFinite(t) ? t : 0;
};
const billingTab = (v) => {
  const t = BILLING_TAB_ALIAS[v] || v;
  return BILLING_TAB_IDS.includes(t) ? t : null;
};
const BillingView = () => {
  const pay = usePayments();
  const crumb = useSsetCrumbValue();
  const [tab, setTabRaw] = React.useState(() => {
    try { const v = billingTab(window.localStorage.getItem(BILLING_TAB_KEY)); if (v) return v; } catch (_) {}
    return 'all';
  });
  const setTab = React.useCallback((t) => {
    setTabRaw(t);
    try { window.localStorage.setItem(BILLING_TAB_KEY, t); } catch (_) {}
  }, []);
  const [q, setQ] = React.useState('');          // invoices
  const [wq, setWq] = React.useState('');        // wallets have their own
  const [invOpen, setInvOpen] = React.useState(null);
  const [newWallet, setNewWallet] = React.useState(0);

  // "Open payments" from elsewhere in the app lands on the right tab.
  React.useEffect(() => {
    const take = () => { const t = billingTab(BILLING_NAV.take()); if (t) setTab(t); };
    take();
    return BILLING_NAV.sub(take);
  }, [setTab]);

  const goTab = (t) => { setInvOpen(null); setTab(t); };

  const invoices = pay.invoices || [];
  const walletList = Object.entries(pay.wallets || {}).map(([coin, w]) => ({coin, ...w}));
  const accepting = walletList.filter(w => w.enabled !== false).length;
  const nOf = (s) => invoices.filter(i => s === 'all' ? i.status !== 'cancelled'
    : s === 'unpaid' ? ['expired', 'failed', 'cancelled'].includes(i.status) : i.status === s).length;
  const awaiting = nOf('pending');

  // Symbol pill above the window (SsetLandTabs): names and counts are on
  // each circle's hover label; a dot flags what wants attention.
  const tabs = [
    {id:'all',       label:'All invoices', icon:'invoices', n: nOf('all')},
    {id:'pending',   label:'Awaiting payment', icon:'expiring', n: awaiting, dot: awaiting ? 'warn' : undefined},
    {id:'confirmed', label:'Paid', icon:'active', n: nOf('confirmed')},
    {id:'unpaid',    label:'Not paid', icon:'inactive', n: nOf('unpaid')},
    {id:'wallets',   label:'Wallets', n: walletList.length, gap: true,
      dot: accepting === 0 ? 'err' : undefined},
  ];

  // Agents can't invoice until a wallet is on — said once, above the
  // invoice list, with the one thing to do about it.
  const walletNotice = accepting === 0 ? (
    <div className="lnd-callout">
      <div className="lnd-callout-txt">
        <span className="lnd-callout-title">{walletList.length ? 'No wallet is accepting payments' : 'Add a wallet to get paid'}</span>
        <span className="lnd-callout-sub">Your agents can’t send an invoice until at least one wallet is on.</span>
      </div>
      <SsetLandAdd label={walletList.length ? 'Open wallets' : 'New wallet'}
        onClick={() => { goTab('wallets'); if (!walletList.length) setNewWallet(n => n + 1); }}/>
    </div>
  ) : null;

  const invTab = tab !== 'wallets';
  return (
    <div className="lnd sset-pop-page">
      {!crumb && <SsetLandTabs label="Payments" value={tab} onChange={goTab} tabs={tabs}/>}
      <PaymentsView _embed _billing tab={invTab ? 'invoices' : 'wallets'}
        invFilter={invTab ? tab : undefined} invNotice={invTab ? walletNotice : null}
        query={q} setQuery={setQ} walletQuery={wq} setWalletQuery={setWq}
        invOpen={invOpen} setInvOpen={setInvOpen} newReq={newWallet}/>
    </div>
  );
};

// ── Coin badge — colored circle with ticker monogram. Used as the
// visual marker for a crypto throughout the Payments UI. ──
// ── Coin logos ────────────────────────────────────────────────
// Official colour logos, embedded so they work offline and inside the
// desktop host without any network request. Source: the
// `cryptocurrency-icons` package (CC0 licence).
const COIN_LOGOS = {
  btc: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0Y3OTMxQSIvPjxwYXRoIGZpbGw9IiNGRkYiIGZpbGwtcnVsZT0ibm9uemVybyIgZD0iTTIzLjE4OSAxNC4wMmMuMzE0LTIuMDk2LTEuMjgzLTMuMjIzLTMuNDY1LTMuOTc1bC43MDgtMi44NC0xLjcyOC0uNDMtLjY5IDIuNzY1Yy0uNDU0LS4xMTQtLjkyLS4yMi0xLjM4NS0uMzI2bC42OTUtMi43ODNMMTUuNTk2IDZsLS43MDggMi44MzljLS4zNzYtLjA4Ni0uNzQ2LS4xNy0xLjEwNC0uMjZsLjAwMi0uMDA5LTIuMzg0LS41OTUtLjQ2IDEuODQ2czEuMjgzLjI5NCAxLjI1Ni4zMTJjLjcuMTc1LjgyNi42MzguODA1IDEuMDA2bC0uODA2IDMuMjM1Yy4wNDguMDEyLjExLjAzLjE4LjA1N2wtLjE4My0uMDQ1LTEuMTMgNC41MzJjLS4wODYuMjEyLS4zMDMuNTMxLS43OTMuNDEuMDE4LjAyNS0xLjI1Ni0uMzEzLTEuMjU2LS4zMTNsLS44NTggMS45NzggMi4yNS41NjFjLjQxOC4xMDUuODI4LjIxNSAxLjIzMS4zMThsLS43MTUgMi44NzIgMS43MjcuNDMuNzA4LTIuODRjLjQ3Mi4xMjcuOTMuMjQ1IDEuMzc4LjM1N2wtLjcwNiAyLjgyOCAxLjcyOC40My43MTUtMi44NjZjMi45NDguNTU4IDUuMTY0LjMzMyA2LjA5Ny0yLjMzMy43NTItMi4xNDYtLjAzNy0zLjM4NS0xLjU4OC00LjE5MiAxLjEzLS4yNiAxLjk4LTEuMDAzIDIuMjA3LTIuNTM4em0tMy45NSA1LjUzOGMtLjUzMyAyLjE0Ny00LjE0OC45ODYtNS4zMi42OTVsLjk1LTMuODA1YzEuMTcyLjI5MyA0LjkyOS44NzIgNC4zNyAzLjExem0uNTM1LTUuNTY5Yy0uNDg3IDEuOTUzLTMuNDk1Ljk2LTQuNDcuNzE3bC44Ni0zLjQ1Yy45NzUuMjQzIDQuMTE4LjY5NiAzLjYxIDIuNzMzeiIvPjwvZz48L3N2Zz4=',
  eth: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzYyN0VFQSIvPjxnIGZpbGw9IiNGRkYiIGZpbGwtcnVsZT0ibm9uemVybyI+PHBhdGggZmlsbC1vcGFjaXR5PSIuNjAyIiBkPSJNMTYuNDk4IDR2OC44N2w3LjQ5NyAzLjM1eiIvPjxwYXRoIGQ9Ik0xNi40OTggNEw5IDE2LjIybDcuNDk4LTMuMzV6Ii8+PHBhdGggZmlsbC1vcGFjaXR5PSIuNjAyIiBkPSJNMTYuNDk4IDIxLjk2OHY2LjAyN0wyNCAxNy42MTZ6Ii8+PHBhdGggZD0iTTE2LjQ5OCAyNy45OTV2LTYuMDI4TDkgMTcuNjE2eiIvPjxwYXRoIGZpbGwtb3BhY2l0eT0iLjIiIGQ9Ik0xNi40OTggMjAuNTczbDcuNDk3LTQuMzUzLTcuNDk3LTMuMzQ4eiIvPjxwYXRoIGZpbGwtb3BhY2l0eT0iLjYwMiIgZD0iTTkgMTYuMjJsNy40OTggNC4zNTN2LTcuNzAxeiIvPjwvZz48L2c+PC9zdmc+',
  ltc: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxjaXJjbGUgY3g9IjE2IiBjeT0iMTYiIHI9IjE2IiBmaWxsPSIjQkZCQkJCIi8+PHBhdGggZmlsbD0iI0ZGRiIgZD0iTTEwLjQyNyAxOS4yMTRMOSAxOS43NjhsLjY4OC0yLjc1OSAxLjQ0NC0uNThMMTMuMjEzIDhoNS4xMjlsLTEuNTE5IDYuMTk2IDEuNDEtLjU3MS0uNjggMi43NS0xLjQyNy41NzEtLjg0OCAzLjQ4M0gyM0wyMi4xMjcgMjRIOS4yNTJ6Ii8+PC9nPjwvc3ZnPg==',
  bch: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiBmaWxsPSIjOGRjMzUxIiByPSIxNiIvPjxwYXRoIGQ9Ik0yMS4yMDcgMTAuNTM0Yy0uNzc2LTEuOTcyLTIuNzIyLTIuMTUtNC45ODgtMS43MWwtLjgwNy0yLjgxMy0xLjcxMi40OTEuNzg2IDIuNzRjLS40NS4xMjgtLjkwOC4yNy0xLjM2My40MWwtLjc5LTIuNzU4LTEuNzExLjQ5LjgwNSAyLjgxM2MtLjM2OC4xMTQtLjczLjIyNi0xLjA4NS4zMjhsLS4wMDMtLjAxLTIuMzYyLjY3Ny41MjUgMS44M3MxLjI1OC0uMzg4IDEuMjQzLS4zNThjLjY5NC0uMTk5IDEuMDM1LjEzOSAxLjIuNDY4bC45MiAzLjIwNGMuMDQ3LS4wMTMuMTEtLjAyOS4xODQtLjA0bC0uMTgxLjA1MiAxLjI4NyA0LjQ5Yy4wMzIuMjI3LjAwNC42MTItLjQ4Ljc1Mi4wMjcuMDEzLTEuMjQ2LjM1Ni0xLjI0Ni4zNTZsLjI0NyAyLjE0MyAyLjIyOC0uNjRjLjQxNS0uMTE3LjgyNS0uMjI3IDEuMjI2LS4zNGwuODE3IDIuODQ1IDEuNzEtLjQ5LS44MDctMi44MTVhNjUuNzQgNjUuNzQgMCAwMDEuMzcyLS4zOGwuODAyIDIuODAzIDEuNzEzLS40OTEtLjgxNC0yLjg0YzIuODMxLS45OTEgNC42MzgtMi4yOTQgNC4xMTMtNS4wNy0uNDIyLTIuMjM0LTEuNzI0LTIuOTEyLTMuNDcxLTIuODM2Ljg0OC0uNzkgMS4yMTMtMS44NTguNjQyLTMuM3ptLS42NSA2Ljc3Yy42MSAyLjEyNy0zLjEgMi45MjktNC4yNiAzLjI2M2wtMS4wODEtMy43N2MxLjE2LS4zMzMgNC43MDQtMS43MSA1LjM0LjUwOHptLTIuMzIyLTUuMDljLjU1NCAxLjkzNS0yLjU0NyAyLjU4LTMuNTE0IDIuODU3bC0uOTgtMy40MTljLjk2Ni0uMjc3IDMuOTE1LTEuNDU1IDQuNDk0LjU2M3oiIGZpbGw9IiNmZmYiIGZpbGwtcnVsZT0ibm9uemVybyIvPjwvZz48L3N2Zz4=',
  doge: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0MzQTYzNCIvPjxwYXRoIGZpbGw9IiNGRkYiIGQ9Ik0xMy4yNDggMTQuNjFoNC4zMTR2Mi4yODZoLTQuMzE0djQuODE4aDIuNzIxYzEuMDc3IDAgMS45NTgtLjE0NSAyLjY0NC0uNDM3LjY4Ni0uMjkxIDEuMjI0LS42OTQgMS42MTUtMS4yMWE0LjQgNC40IDAgMDAuNzk2LTEuODE1IDExLjQgMTEuNCAwIDAwLjIxLTIuMjUyIDExLjQgMTEuNCAwIDAwLS4yMS0yLjI1MiA0LjM5NiA0LjM5NiAwIDAwLS43OTYtMS44MTVjLS4zOTEtLjUxNi0uOTMtLjkxOS0xLjYxNS0xLjIxLS42ODYtLjI5Mi0xLjU2Ny0uNDM3LTIuNjQ0LS40MzdoLTIuNzIxdjQuMzI1em0tMi43NjYgMi4yODZIOXYtMi4yODVoMS40ODJWOGg2LjU0OWMxLjIxIDAgMi4yNTcuMjEgMy4xNDIuNjI3Ljg4NS40MTkgMS42MDcuOTkgMi4xNjggMS43MTUuNTYuNzI0Ljk3NyAxLjU3MiAxLjI1IDIuNTQzLjI3My45NzEuNDA5IDIuMDEuNDA5IDMuMTE1YTExLjQ3IDExLjQ3IDAgMDEtLjQxIDMuMTE1Yy0uMjcyLjk3LS42ODkgMS44MTktMS4yNSAyLjU0My0uNTYuNzI1LTEuMjgyIDEuMjk2LTIuMTY3IDEuNzE1LS44ODUuNDE4LTEuOTMzLjYyNy0zLjE0Mi42MjdoLTYuNTQ5di03LjEwNHoiLz48L2c+PC9zdmc+',
  xmr: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0Y2MCIvPjxwYXRoIGZpbGw9IiNGRkYiIGZpbGwtcnVsZT0ibm9uemVybyIgZD0iTTE1Ljk3IDUuMjM1YzUuOTg1IDAgMTAuODI1IDQuODQgMTAuODI1IDEwLjgyNGExMS4wNyAxMS4wNyAwIDAxLS41NTggMy40MzJoLTMuMjI2di05LjA5NGwtNy4wNCA3LjA0LTcuMDQtNy4wNHY5LjA5NEg1LjcwNGExMS4wNyAxMS4wNyAwIDAxLS41NTctMy40MzJjMC01Ljk4NCA0Ljg0LTEwLjgyNCAxMC44MjQtMTAuODI0ek0xNC4zNTggMTkuMDJMMTYgMjAuNjM1bDEuNjEzLTEuNjE0IDMuMDUxLTMuMDh2NS43Mmg0LjU0N2ExMC44MDYgMTAuODA2IDAgMDEtOS4yNCA1LjE5MmMtMy45MDIgMC03LjMzNC0yLjA4Mi05LjI0LTUuMTkyaDQuNTQ2di01LjcybDMuMDggMy4wOHoiLz48L2c+PC9zdmc+',
  usdt: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzI2QTE3QiIvPjxwYXRoIGZpbGw9IiNGRkYiIGQ9Ik0xNy45MjIgMTcuMzgzdi0uMDAyYy0uMTEuMDA4LS42NzcuMDQyLTEuOTQyLjA0Mi0xLjAxIDAtMS43MjEtLjAzLTEuOTcxLS4wNDJ2LjAwM2MtMy44ODgtLjE3MS02Ljc5LS44NDgtNi43OS0xLjY1OCAwLS44MDkgMi45MDItMS40ODYgNi43OS0xLjY2djIuNjQ0Yy4yNTQuMDE4Ljk4Mi4wNjEgMS45ODguMDYxIDEuMjA3IDAgMS44MTItLjA1IDEuOTI1LS4wNnYtMi42NDNjMy44OC4xNzMgNi43NzUuODUgNi43NzUgMS42NTggMCAuODEtMi44OTUgMS40ODUtNi43NzUgMS42NTdtMC0zLjU5di0yLjM2Nmg1LjQxNFY3LjgxOUg4LjU5NXYzLjYwOGg1LjQxNHYyLjM2NWMtNC40LjIwMi03LjcwOSAxLjA3NC03LjcwOSAyLjExOCAwIDEuMDQ0IDMuMzA5IDEuOTE1IDcuNzA5IDIuMTE4djcuNTgyaDMuOTEzdi03LjU4NGM0LjM5My0uMjAyIDcuNjk0LTEuMDczIDcuNjk0LTIuMTE2IDAtMS4wNDMtMy4zMDEtMS45MTQtNy42OTQtMi4xMTciLz48L2c+PC9zdmc+',
  bnb: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGcgZmlsbD0ibm9uZSI+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiNGM0JBMkYiLz48cGF0aCBmaWxsPSIjRkZGIiBkPSJNMTIuMTE2IDE0LjQwNEwxNiAxMC41MmwzLjg4NiAzLjg4NiAyLjI2LTIuMjZMMTYgNmwtNi4xNDQgNi4xNDQgMi4yNiAyLjI2ek02IDE2bDIuMjYtMi4yNkwxMC41MiAxNmwtMi4yNiAyLjI2TDYgMTZ6bTYuMTE2IDEuNTk2TDE2IDIxLjQ4bDMuODg2LTMuODg2IDIuMjYgMi4yNTlMMTYgMjZsLTYuMTQ0LTYuMTQ0LS4wMDMtLjAwMyAyLjI2My0yLjI1N3pNMjEuNDggMTZsMi4yNi0yLjI2TDI2IDE2bC0yLjI2IDIuMjZMMjEuNDggMTZ6bS0zLjE4OC0uMDAyaC4wMDJWMTZMMTYgMTguMjk0bC0yLjI5MS0yLjI5LS4wMDQtLjAwNC4wMDQtLjAwMy40MDEtLjQwMi4xOTUtLjE5NUwxNiAxMy43MDZsMi4yOTMgMi4yOTN6Ii8+PC9nPjwvc3ZnPg==',
  matic: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIj48Y2lyY2xlIGZpbGw9IiM2RjQxRDgiIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIvPjxwYXRoIGQ9Ik0yMS4wOTIgMTIuNjkzYy0uMzY5LS4yMTUtLjg0OC0uMjE1LTEuMjU0IDBsLTIuODc5IDEuNjU0LTEuOTU1IDEuMDc4LTIuODc5IDEuNjUzYy0uMzY5LjIxNi0uODQ4LjIxNi0xLjI1NCAwbC0yLjI4OC0xLjI5NGMtLjM2OS0uMjE1LS42MjctLjYxLS42MjctMS4wNDJWMTIuMTljMC0uNDMxLjIyMS0uODI2LjYyNy0xLjA0MmwyLjI1LTEuMjU4Yy4zNy0uMjE2Ljg1LS4yMTYgMS4yNTYgMGwyLjI1IDEuMjU4Yy4zNy4yMTYuNjI4LjYxMS42MjggMS4wNDJ2MS42NTRsMS45NTUtMS4xMTV2LTEuNjUzYTEuMTYgMS4xNiAwIDAwLS42MjctMS4wNDJsLTQuMTctMi4zNzJjLS4zNjktLjIxNi0uODQ4LS4yMTYtMS4yNTQgMGwtNC4yNDQgMi4zNzJBMS4xNiAxLjE2IDAgMDA2IDExLjA3NnY0Ljc4YzAgLjQzMi4yMjEuODI3LjYyNyAxLjA0M2w0LjI0NCAyLjM3MmMuMzY5LjIxNS44NDkuMjE1IDEuMjU0IDBsMi44NzktMS42MTggMS45NTUtMS4xMTQgMi44NzktMS42MTdjLjM2OS0uMjE2Ljg0OC0uMjE2IDEuMjU0IDBsMi4yNTEgMS4yNThjLjM3LjIxNS42MjcuNjEuNjI3IDEuMDQydjIuNTUyYzAgLjQzMS0uMjIuODI2LS42MjcgMS4wNDJsLTIuMjUgMS4yOTRjLS4zNy4yMTYtLjg1LjIxNi0xLjI1NSAwbC0yLjI1MS0xLjI1OGMtLjM3LS4yMTYtLjYyOC0uNjExLS42MjgtMS4wNDJ2LTEuNjU0bC0xLjk1NSAxLjExNXYxLjY1M2MwIC40MzEuMjIxLjgyNy42MjcgMS4wNDJsNC4yNDQgMi4zNzJjLjM2OS4yMTYuODQ4LjIxNiAxLjI1NCAwbDQuMjQ0LTIuMzcyYy4zNjktLjIxNS42MjctLjYxLjYyNy0xLjA0MnYtNC43OGExLjE2IDEuMTYgMCAwMC0uNjI3LTEuMDQybC00LjI4LTIuNDA5eiIgZmlsbD0iI0ZGRiIvPjwvZz48L3N2Zz4=',
  sol: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIj48Y2lyY2xlIGZpbGw9IiM2NkY5QTEiIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIvPjxwYXRoIGQ9Ik05LjkyNSAxOS42ODdhLjU5LjU5IDAgMDEuNDE1LS4xN2gxNC4zNjZhLjI5LjI5IDAgMDEuMjA3LjQ5N2wtMi44MzggMi44MTVhLjU5LjU5IDAgMDEtLjQxNS4xNzFINy4yOTRhLjI5MS4yOTEgMCAwMS0uMjA3LS40OThsMi44MzgtMi44MTV6bTAtMTAuNTE3QS41OS41OSAwIDAxMTAuMzQgOWgxNC4zNjZjLjI2MSAwIC4zOTIuMzE0LjIwNy40OThsLTIuODM4IDIuODE1YS41OS41OSAwIDAxLS40MTUuMTdINy4yOTRhLjI5MS4yOTEgMCAwMS0uMjA3LS40OTdMOS45MjUgOS4xN3ptMTIuMTUgNS4yMjVhLjU5LjU5IDAgMDAtLjQxNS0uMTdINy4yOTRhLjI5MS4yOTEgMCAwMC0uMjA3LjQ5OGwyLjgzOCAyLjgxNWMuMTEuMTA5LjI2LjE3LjQxNS4xN2gxNC4zNjZhLjI5MS4yOTEgMCAwMC4yMDctLjQ5OGwtMi44MzgtMi44MTV6IiBmaWxsPSIjRkZGIi8+PC9nPjwvc3ZnPg==',
  trx: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIj48Y2lyY2xlIGZpbGw9IiNFRjAwMjciIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIvPjxwYXRoIGQ9Ik0yMS45MzIgOS45MTNMNy41IDcuMjU3bDcuNTk1IDE5LjExMiAxMC41ODMtMTIuODk0LTMuNzQ2LTMuNTYyem0tLjIzMiAxLjE3bDIuMjA4IDIuMDk5LTYuMDM4IDEuMDkzIDMuODMtMy4xOTJ6bS01LjE0MiAyLjk3M2wtNi4zNjQtNS4yNzggMTAuNDAyIDEuOTE0LTQuMDM4IDMuMzY0em0tLjQ1My45MzRsLTEuMDM4IDguNThMOS40NzIgOS40ODdsNi42MzMgNS41MDJ6bS45Ni40NTVsNi42ODctMS4yMS03LjY3IDkuMzQzLjk4My04LjEzM3oiIGZpbGw9IiNGRkYiLz48L2c+PC9zdmc+',
};
// Network of a token id like 'trc20/usdt' → the chain's own logo, shown as
// a small badge on the token so USDT on Tron and USDT on Ethereum can be
// told apart at a glance.
const COIN_NETWORK = {
  trc20:  {logo:'trx', label:'TRC20'},
  erc20:  {logo:'eth', label:'ERC20'},
  bep20:  {logo:'bnb', label:'BEP20'},
  polygon:{logo:'matic', label:'Polygon'},
};
const coinParts = (coin) => {
  const id = String(coin || '').toLowerCase();
  const bits = id.split('/');
  const token = bits[bits.length - 1];
  const chain = bits.length > 1 ? bits[0] : '';
  return { id, token, chain, net: COIN_NETWORK[chain] || (chain ? {logo:'', label:chain.toUpperCase()} : null) };
};

const CoinBadge = ({coin, sz=24}) => {
  const meta = CRYPTAPI_COINS.find(c => c.id === coin);
  const {token, net} = coinParts(coin);
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => setBroken(false), [coin]);
  const src = !broken && COIN_LOGOS[token];
  const netLogo = net && net.logo && net.logo !== token ? COIN_LOGOS[net.logo] : '';
  const nb = Math.max(9, Math.round(sz * 0.44));
  const tk = (meta?.ticker || token.toUpperCase() || '?').slice(0,4);
  return (
    <span style={{position:'relative',display:'inline-flex',width:sz,height:sz,flexShrink:0}}>
      {src ? (
        <img src={src} alt="" width={sz} height={sz} draggable={false} onError={()=>setBroken(true)}
          style={{width:sz,height:sz,borderRadius:'50%',display:'block'}}/>
      ) : (
        // Unknown coin: neutral monogram in the same circle.
        <span style={{
          display:'inline-flex',alignItems:'center',justifyContent:'center',
          width:sz,height:sz,borderRadius:'50%',boxSizing:'border-box',
          background: meta?.tint ? `color-mix(in oklab, ${meta.tint} 22%, rgba(255,255,255,0.04))` : 'rgba(255,255,255,0.06)',
          border:'1px solid rgba(255,255,255,0.10)', color:'var(--t2)',
          fontFamily:'var(--font)', fontWeight:700, fontSize: sz <= 20 ? 8.5 : sz <= 26 ? 9.5 : 10.5,
          letterSpacing:'-0.02em',
        }}>{tk.length <= 3 ? tk : tk.slice(0,3)}</span>
      )}
      {netLogo && (
        <img src={netLogo} alt="" width={nb} height={nb} draggable={false}
          style={{position:'absolute',right:-2,bottom:-2,width:nb,height:nb,borderRadius:'50%',
            boxShadow:'0 0 0 1.5px rgba(16,17,30,0.95)'}}/>
      )}
    </span>
  );
};

// ── Coin picker — custom dropdown replacing the native <select>. Shows
// a coin badge + label per row, supports the "Other…" custom-ticker
// escape hatch from CRYPTAPI_COINS. Renders into a portal-like fixed
// overlay so it isn't clipped by the popup body. ──
const CoinPicker = ({value, onChange, customCoin, setCustomCoin}) => {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos]   = React.useState({left:0, top:0, width:0});
  const triggerRef = React.useRef(null);
  const menuRef    = React.useRef(null);
  const isCustom = value === '__custom__';
  const meta = CRYPTAPI_COINS.find(c => c.id === value);

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
    const click = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const trig = {
    display:'flex',alignItems:'center',gap:9,
    width:'100%',height:32,padding:'0 9px',
    background:'rgba(255,255,255,0.03)',
    border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:7,cursor:'pointer',
    transition:'border-color 0.12s, background 0.12s',
    color:'var(--t1)',fontSize:11.5,
  };

  return (
    <>
      <button ref={triggerRef} type="button"
        onClick={()=>setOpen(o=>!o)}
        style={{...trig, borderColor: open ? 'rgba(108,99,255,0.45)' : trig.border}}>
        {isCustom ? (
          <>
            <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:20,height:20,borderRadius:'50%',background:'rgba(255,255,255,0.06)',border:'1px dashed rgba(255,255,255,0.18)',color:'var(--t3)',fontSize:10,flexShrink:0}}>?</span>
            <span style={{flex:1,textAlign:'left',color:'var(--t2)'}}>Other ticker…</span>
          </>
        ) : meta ? (
          <>
            <CoinBadge coin={value} sz={20}/>
            <span style={{flex:1,textAlign:'left',color:'var(--t1)',fontWeight:500}}>{meta.label}</span>
            <span style={{fontSize:10,color:'var(--t3)',fontFamily:'var(--mono)',letterSpacing:'0.04em'}}>{meta.ticker}</span>
          </>
        ) : (
          <span style={{flex:1,textAlign:'left',color:'var(--t3)'}}>Select a coin…</span>
        )}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          style={{color:'var(--t3)',flexShrink:0,transition:'transform 0.16s',transform:open?'rotate(180deg)':'none'}}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Custom-ticker input shows immediately below the trigger when
          "__custom__" is selected. */}
      {isCustom && (
        <input type="text" value={customCoin || ''} onChange={e=>setCustomCoin(e.target.value)}
          placeholder="e.g. xrp, ada, dash, trc20/usdt"
          style={{
            marginTop:6,width:'100%',height:36,padding:'0 11px',
            fontSize:12,fontFamily:'var(--mono)',color:'var(--t1)',
            background:'rgba(255,255,255,0.03)',
            border:'1px solid rgba(255,255,255,0.08)',
            borderRadius:8,outline:'none',
          }}/>
      )}

      {open && ReactDOM.createPortal((
        <div ref={menuRef}
          style={{
            position:'fixed', left:pos.left, top:pos.top, width:pos.width,
            zIndex:9999,
            background:'rgba(20,22,42,0.98)',
            backdropFilter:'blur(28px) saturate(170%)',
            WebkitBackdropFilter:'blur(28px) saturate(170%)',
            border:'1px solid rgba(255,255,255,0.10)',
            borderRadius:10,
            boxShadow:'0 16px 40px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4)',
            maxHeight:300, overflow:'auto',
            padding:4,
            scrollbarWidth:'thin',
            scrollbarColor:'rgba(255,255,255,0.10) transparent',
          }}>
          {CRYPTAPI_COINS.map(c => {
            const sel = c.id === value;
            return (
              <button key={c.id} type="button" onClick={()=>{ onChange(c.id); setOpen(false); }}
                style={{
                  display:'flex',alignItems:'center',gap:9,width:'100%',
                  padding:'6px 8px',border:'none',cursor:'pointer',
                  background: sel ? 'rgba(108,99,255,0.14)' : 'transparent',
                  borderRadius:6,textAlign:'left',color:'var(--t1)',
                  transition:'background 0.10s',
                }}
                onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='rgba(255,255,255,0.04)'; }}
                onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='transparent'; }}>
                <CoinBadge coin={c.id} sz={20}/>
                <span style={{flex:1,fontSize:11.5,fontWeight:500,letterSpacing:'-0.005em'}}>{c.label}</span>
                <span style={{fontSize:10,color:'var(--t3)',fontFamily:'var(--mono)',letterSpacing:'0.04em'}}>{c.ticker}</span>
                {sel && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            );
          })}
          <div style={{height:1,background:'rgba(255,255,255,0.06)',margin:'4px 0'}}/>
          <button type="button" onClick={()=>{ onChange('__custom__'); setOpen(false); }}
            style={{
              display:'flex',alignItems:'center',gap:9,width:'100%',
              padding:'6px 8px',border:'none',cursor:'pointer',
              background: isCustom ? 'rgba(108,99,255,0.14)' : 'transparent',
              borderRadius:6,textAlign:'left',color:'var(--t2)',
              transition:'background 0.10s',
            }}
            onMouseEnter={e=>{ if(!isCustom) e.currentTarget.style.background='rgba(255,255,255,0.04)'; }}
            onMouseLeave={e=>{ if(!isCustom) e.currentTarget.style.background='transparent'; }}>
            <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:20,height:20,borderRadius:'50%',background:'rgba(255,255,255,0.06)',border:'1px dashed rgba(255,255,255,0.18)',color:'var(--t3)',fontSize:10,flexShrink:0}}>+</span>
            <span style={{flex:1,fontSize:11.5,fontWeight:500,letterSpacing:'-0.005em'}}>Other ticker…</span>
          </button>
        </div>
      ), document.body)}
    </>
  );
};

const PaymentWalletEditor = ({_embed, draft, upd, creating, coinPicker, setCoinPicker, customCoin, setCustomCoin, selectedCoin, usedCoins, original, invoices, onSave, onDelete, onBack, onToggleEnabled}) => {
  {
    const m = CRYPTAPI_COINS.find(c => c.id === selectedCoin);
    useSsetCrumb(_embed ? 'Wallets' : null,
      creating ? 'New wallet' : (draft.label || (m ? m.label : String(selectedCoin || '').toUpperCase())), onBack);
  }
  const flipEnabled = () => {
    const next = draft.enabled === false;
    if (onToggleEnabled) onToggleEnabled(next); else upd('enabled', next);
  };
  const inputStyle = {
    width:'100%', padding: _embed ? '8px 11px' : '9px 11px', fontSize:12.5, color:'var(--t1)',
    background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:8, fontFamily:'var(--font)', transition:'border-color 0.12s',
  };
  const labelStyle = { fontSize:10.5, fontWeight:600, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6, display:'block' };
  // Compact label used in embed mode — sentence case, smaller, paired
  // tightly with its field. Replaces the all-caps stack-spacers.
  const labelEmbed = { fontSize:10.5, fontWeight:600, color:'var(--t3)', letterSpacing:'-0.005em', marginBottom:5, display:'flex', alignItems:'center', gap:6 };

  const coin = creating
    ? (coinPicker === '__custom__' ? customCoin.trim().toLowerCase() : coinPicker)
    : draft.coin;
  // Preview of the /create/ request that will fire when the AI generates
  // an invoice for this coin. Each invoice gets a unique invoice_id GET
  // param appended to the callback so CryptAPI mints a fresh address_in.
  const previewCreateUrl = (() => {
    if (!coin || !draft.address) return '';
    const sampleId = 'inv_xxxxxx';
    const baseCb = (draft.callback && /^https?:\/\//i.test(draft.callback))
      ? draft.callback : 'https://botcommand.app/cryptapi-noop';
    const cb = `${baseCb}${baseCb.includes('?')?'&':'?'}invoice_id=${sampleId}`;
    const params = new URLSearchParams();
    params.set('callback', cb);
    params.set('address',  draft.address);
    params.set('pending',  '1');
    const c = parseInt(draft.min_confirmations, 10);
    if (Number.isFinite(c) && c >= 1) params.set('confirmations', String(c));
    return `https://api.cryptapi.io/${coin}/create/?${params.toString()}`;
  })();

  // ── Popup layout ───────────────────────────────────────────
  // One screen, no hidden sections: currency, payout address, an
  // optional name, then the two settings that matter (confirmations and
  // whether the coin is offered). The webhook field is gone from the
  // popup — invoices are tracked by polling when none is set, and any
  // webhook already saved on a wallet is kept as it is.
  // ── Popup ─────────────────────────────────────────────────
  // New wallets are set up with the guided wizard; an existing wallet
  // opens its detail page (balance, address, settings, transactions).
  if (_embed) {
    if (creating) {
      return (
        <WalletWizard draft={draft} upd={upd} coinPicker={coinPicker} setCoinPicker={setCoinPicker}
          customCoin={customCoin} setCustomCoin={setCustomCoin} usedCoins={usedCoins}
          onSave={onSave} onBack={onBack}/>
      );
    }
    return (
      <WalletDetail coin={selectedCoin} draft={draft} upd={upd} original={original} invoices={invoices}
        onSave={onSave} onDelete={onDelete}
        onToggleEnabled={(v) => { if (onToggleEnabled) onToggleEnabled(v); else upd('enabled', v); }}/>
    );
  }

  // ── Full-page (legacy) layout — unchanged ──────────────────
  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
        <div>
          <div style={{fontSize:15,fontWeight:600,letterSpacing:'-0.01em',color:'var(--t1)'}}>
            {creating ? 'Add Wallet' : (draft.label || (coin||'').toUpperCase())}
          </div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>
            Your agents offer this when a customer wants to pay
          </div>
        </div>
        <button type="button" className="bc-status" role="switch" aria-checked={draft.enabled !== false} onClick={flipEnabled}
          title={draft.enabled !== false ? 'Agents offer this coin' : 'Agents will not offer this coin'}>
          <span className="bc-switch" data-on={draft.enabled !== false ? '1' : '0'} aria-hidden="true"/>
          <span>Accepting</span>
        </button>
      </div>

      <SectionDivider label="Coin"/>
      {creating ? (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <select value={coinPicker} onChange={e=>setCoinPicker(e.target.value)} style={{...inputStyle, cursor:'pointer'}}>
            {CRYPTAPI_COINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            <option value="__custom__">Other (type ticker)…</option>
          </select>
          {coinPicker === '__custom__' && (
            <input type="text" value={customCoin} onChange={e=>setCustomCoin(e.target.value)}
              placeholder="e.g. xrp, ada, dash, trc20/usdt" style={inputStyle}/>
          )}
          <div style={{fontSize:10.5,color:'var(--t3)',lineHeight:1.5}}>
            For tokens add the network, like <span style={{fontFamily:'var(--mono)',color:'var(--t2)'}}>trc20/usdt</span>.
          </div>
        </div>
      ) : (
        <div style={{padding:'9px 11px',fontSize:12.5,color:'var(--t1)',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:8,fontFamily:'var(--mono)',letterSpacing:'0.04em'}}>
          {(selectedCoin||'').toUpperCase()}
        </div>
      )}

      <SectionDivider label="Receive Address"/>
      <div>
        <label style={labelStyle}>Address</label>
        <input type="text" value={draft.address} onChange={e=>upd('address', e.target.value)}
          placeholder="The wallet address customers send funds to"
          style={{...inputStyle, fontFamily:'var(--mono)', fontSize:11.5}}/>
        <div style={{fontSize:10.5,color:'var(--t3)',marginTop:6,lineHeight:1.5}}>
          Your own wallet. Each invoice gets its own payment address, and the money is forwarded here once it confirms.
        </div>
      </div>

      <div>
        <label style={labelStyle}>Display Label</label>
        <input type="text" value={draft.label} onChange={e=>upd('label', e.target.value)}
          placeholder="What the AI calls this wallet (optional)" style={inputStyle}/>
      </div>

      <SectionDivider label="CryptAPI Settings"/>
      <div>
        <label style={labelStyle}>Webhook URL <span style={{color:'var(--t4)',fontWeight:400,textTransform:'none',letterSpacing:0}}>(optional)</span></label>
        <input type="text" value={draft.callback} onChange={e=>upd('callback', e.target.value)}
          placeholder="https://yourdomain.com/api/cryptapi-webhook"
          style={{...inputStyle, fontFamily:'var(--mono)', fontSize:11.5}}/>
        <div style={{fontSize:10.5,color:'var(--t3)',marginTop:6,lineHeight:1.5}}>
          Optional — your server endpoint for CryptAPI to POST payment events to.
          If blank, a placeholder is used and we poll <span style={{fontFamily:'var(--mono)',color:'var(--t2)'}}>/logs/</span> every 60s instead. Either way, payments are tracked.
        </div>
      </div>

      <div>
        <label style={labelStyle}>Min. Confirmations</label>
        <input type="number" min={0} max={10} value={draft.min_confirmations}
          onChange={e=>upd('min_confirmations', parseInt(e.target.value)||0)}
          style={{...inputStyle, width:120}}/>
        <div style={{fontSize:10.5,color:'var(--t3)',marginTop:6,lineHeight:1.5}}>
          How many network confirmations before a payment counts as paid.
        </div>
      </div>

      {previewCreateUrl && (
        <>
          <SectionDivider label="Per-Invoice /create/ Request"/>
          <div style={{padding:'10px 12px',background:'rgba(108,99,255,0.06)',border:'1px solid rgba(108,99,255,0.18)',borderRadius:8,display:'flex',alignItems:'center',gap:8}}>
            <code style={{flex:1,fontSize:10.5,color:'rgba(178,168,255,0.95)',fontFamily:'var(--mono)',wordBreak:'break-all'}}>{previewCreateUrl}</code>
            <button onClick={()=>{ navigator.clipboard?.writeText(previewCreateUrl); }}
              style={{padding:'5px 9px',fontSize:10,fontWeight:600,color:'var(--t2)',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:6,cursor:'pointer',flexShrink:0}}>
              Copy
            </button>
          </div>
          <div style={{fontSize:10.5,color:'var(--t3)',lineHeight:1.5,marginTop:-4}}>
            Each invoice replaces <span style={{fontFamily:'var(--mono)',color:'var(--t2)'}}>inv_xxxxxx</span> with a unique id, so CryptAPI returns a fresh forwarding address per payment.
          </div>
        </>
      )}

      <div style={{display:'flex',gap:10,marginTop:8,paddingTop:14,borderTop:'1px solid rgba(255,255,255,0.06)'}}>
        <button onClick={onSave}
          style={{padding:'10px 18px',fontSize:12.5,fontWeight:600,color:'#fff',background:'var(--acc)',border:'none',borderRadius:8,cursor:'pointer',transition:'opacity 0.12s'}}>
          {creating ? 'Add Wallet' : 'Save Changes'}
        </button>
        {!creating && (
          <button onClick={onDelete}
            style={{padding:'10px 18px',fontSize:12.5,fontWeight:600,color:'rgba(255,90,90,0.95)',background:'transparent',border:'1px solid rgba(255,90,90,0.25)',borderRadius:8,cursor:'pointer',transition:'all 0.12s'}}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
};

// ── Wallet activity (block explorers) ──────────────────────────────
// Recent on-chain transactions and the balance of a payout address, read
// from free public explorers. Each request goes straight to the explorer
// first; if the browser blocks it (CORS, WebView rules, a network hiccup)
// it is retried through api.php's explorer_get passthrough, which only
// talks to the hosts listed there. Results are cached for a minute per
// coin and address, so opening the same wallet twice costs nothing.
//
// Every provider returns the same shape:
//   { balance, received, count, txs: [{id, amount, time, confirmed, confs}] }
//   amount is signed (+ in, − out) in whole coins; time is ms or null.
const WALLET_TX = (() => {
  const cache = new Map();
  const USDT_ERC20 = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

  const direct = async (url, post) => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 12000) : 0;
    try {
      const r = await fetch(url, post
        ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(post), signal: ctl && ctl.signal}
        : {headers: {'Accept': 'application/json'}, signal: ctl && ctl.signal});
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return await r.json();
    } finally { if (t) clearTimeout(t); }
  };
  const viaServer = async (url, post) => {
    if (typeof apiFetch !== 'function') throw new Error('unreachable');
    const res = await apiFetch('explorer_get', post ? {url, post} : {url});
    if (!res || res.error) throw new Error((res && res.error) || 'unreachable');
    if (res.status >= 400) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    return res.data;
  };
  const getJson = async (url, post) => {
    try { return await direct(url, post); }
    catch (e) {
      // A clear "no such address" answer is final; anything else (blocked
      // by CORS, timeout, rate limit) gets one more try via the server.
      if (e && (e.status === 400 || e.status === 404)) throw e;
      return viaServer(url, post);
    }
  };

  // Base58 → hex (Tron addresses are base58 in the UI, hex in raw txs).
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58hex = (s) => {
    try {
      let n = 0n;
      for (const ch of String(s)) { const i = B58.indexOf(ch); if (i < 0) return ''; n = n * 58n + BigInt(i); }
      let hex = n.toString(16);
      if (hex.length % 2) hex = '0' + hex;
      return hex.slice(0, -8).toLowerCase();      // drop the 4-byte checksum
    } catch (_) { return ''; }
  };
  const num = (v, dec) => { const n = Number(v); return isFinite(n) ? n / Math.pow(10, dec) : 0; };

  // Bitcoin and Litecoin: Esplora API (mempool.space and its Litecoin twin).
  const esplora = (base) => async (addr) => {
    const [info, txs, tip] = await Promise.all([
      getJson(`${base}/api/address/${addr}`),
      getJson(`${base}/api/address/${addr}/txs`),
      getJson(`${base}/api/blocks/tip/height`).catch(() => null),
    ]);
    const a = String(addr).toLowerCase();
    const cs = info.chain_stats || {}, ms = info.mempool_stats || {};
    const tipH = Number(tip) || null;
    return {
      balance: num((cs.funded_txo_sum || 0) - (cs.spent_txo_sum || 0) + (ms.funded_txo_sum || 0) - (ms.spent_txo_sum || 0), 8),
      received: num((cs.funded_txo_sum || 0) + (ms.funded_txo_sum || 0), 8),
      count: (cs.tx_count || 0) + (ms.tx_count || 0),
      txs: (Array.isArray(txs) ? txs : []).map(tx => {
        let v = 0;
        (tx.vout || []).forEach(o => { if (String(o.scriptpubkey_address || '').toLowerCase() === a) v += o.value || 0; });
        (tx.vin || []).forEach(i => { if (i.prevout && String(i.prevout.scriptpubkey_address || '').toLowerCase() === a) v -= i.prevout.value || 0; });
        const st = tx.status || {};
        return {
          id: tx.txid, amount: num(v, 8), time: st.block_time ? st.block_time * 1000 : null,
          confirmed: !!st.confirmed, confs: st.confirmed && tipH && st.block_height ? tipH - st.block_height + 1 : 0,
        };
      }),
    };
  };

  // Bitcoin Cash and Dogecoin: Blockchair dashboards.
  const blockchair = (chain) => async (addr) => {
    const res = await getJson(`https://api.blockchair.com/${chain}/dashboards/address/${encodeURIComponent(addr)}?transaction_details=true&limit=25`);
    const d = res && res.data ? Object.values(res.data)[0] : null;
    if (!d) throw new Error('No data');
    const tip = res.context && Number(res.context.state);
    const ad = d.address || {};
    return {
      balance: num(ad.balance, 8), received: num(ad.received, 8), count: ad.transaction_count ?? null,
      txs: (d.transactions || []).map(t => ({
        id: t.hash, amount: num(t.balance_change, 8),
        time: t.time ? Date.parse(String(t.time).replace(' ', 'T') + 'Z') : null,
        confirmed: t.block_id > 0, confs: t.block_id > 0 && tip ? tip - t.block_id + 1 : 0,
      })),
    };
  };

  // Ethereum-style chains: Blockscout v2 (native coin or one ERC-20 token).
  const blockscout = (base, token) => async (addr) => {
    const a = String(addr).toLowerCase();
    const hashOf = (x) => String((x && (x.hash || x)) || '').toLowerCase();
    if (!token) {
      const [info, list, counters] = await Promise.all([
        getJson(`${base}/api/v2/addresses/${addr}`),
        getJson(`${base}/api/v2/addresses/${addr}/transactions`),
        getJson(`${base}/api/v2/addresses/${addr}/counters`).catch(() => null),
      ]);
      return {
        balance: num(info && info.coin_balance, 18), received: null,
        count: counters && counters.transactions_count != null ? Number(counters.transactions_count) : null,
        txs: ((list && list.items) || []).map(t => {
          const v = num(t.value, 18);
          const inbound = hashOf(t.to) === a, outbound = hashOf(t.from) === a;
          const pending = t.result === 'pending' || t.block == null && t.block_number == null;
          return {
            id: t.hash, amount: inbound && !outbound ? v : outbound && !inbound ? -v : 0,
            time: t.timestamp ? Date.parse(t.timestamp) : null,
            confirmed: !pending && t.status !== 'error', failed: t.status === 'error', confs: Number(t.confirmations) || 0,
          };
        }),
      };
    }
    const [bals, list] = await Promise.all([
      getJson(`${base}/api/v2/addresses/${addr}/token-balances`).catch(() => []),
      getJson(`${base}/api/v2/addresses/${addr}/token-transfers?type=ERC-20&token=${token}`),
    ]);
    const bal = (Array.isArray(bals) ? bals : []).find(b => hashOf(b.token && (b.token.address_hash || b.token.address)) === token);
    return {
      balance: bal ? num(bal.value, Number(bal.token.decimals) || 6) : 0, received: null, count: null,
      txs: ((list && list.items) || []).map(t => {
        const dec = Number(t.total && t.total.decimals) || 6;
        const v = num(t.total && t.total.value, dec);
        const inbound = hashOf(t.to) === a;
        return {
          id: t.transaction_hash || t.tx_hash, amount: inbound ? v : -v,
          time: t.timestamp ? Date.parse(t.timestamp) : null, confirmed: true, confs: 0,
        };
      }),
    };
  };

  // Tron: TronGrid (TRX transfers, or USDT TRC-20 transfers).
  const trongrid = (usdt) => async (addr) => {
    const base = 'https://api.trongrid.io/v1/accounts/' + addr;
    const acct = await getJson(base).catch(() => null);
    const row = acct && Array.isArray(acct.data) ? acct.data[0] : null;
    if (usdt) {
      const list = await getJson(`${base}/transactions/trc20?limit=25&contract_address=${USDT_TRC20}`);
      const held = row && Array.isArray(row.trc20) ? row.trc20.find(x => x && x[USDT_TRC20] != null) : null;
      return {
        balance: held ? num(held[USDT_TRC20], 6) : 0, received: null, count: null,
        txs: ((list && list.data) || []).map(t => {
          const dec = Number(t.token_info && t.token_info.decimals) || 6;
          const v = num(t.value, dec);
          return { id: t.transaction_id, amount: t.to === addr ? v : -v, time: t.block_timestamp || null, confirmed: true, confs: 0 };
        }),
      };
    }
    const list = await getJson(`${base}/transactions?limit=25`);
    const me = b58hex(addr);
    return {
      balance: row ? num(row.balance, 6) : 0, received: null, count: null,
      txs: ((list && list.data) || []).map(t => {
        const c = t.raw_data && t.raw_data.contract && t.raw_data.contract[0];
        const p = (c && c.parameter && c.parameter.value) || {};
        let v = 0;
        if (c && c.type === 'TransferContract') {
          const amt = num(p.amount, 6);
          v = String(p.to_address || '').toLowerCase() === me ? amt : String(p.owner_address || '').toLowerCase() === me ? -amt : 0;
        }
        const ret = t.ret && t.ret[0] && t.ret[0].contractRet;
        return { id: t.txID, amount: v, time: t.block_timestamp || null, confirmed: !ret || ret === 'SUCCESS', failed: !!ret && ret !== 'SUCCESS', confs: 0 };
      }).filter(t => t.amount !== 0),
    };
  };

  // Solana: public RPC. Amounts come from the balance change of the address.
  const solana = async (addr) => {
    const RPC = 'https://api.mainnet-beta.solana.com';
    const rpc = (method, params) => getJson(RPC, {jsonrpc: '2.0', id: 1, method, params});
    const [bal, sigs] = await Promise.all([rpc('getBalance', [addr]), rpc('getSignaturesForAddress', [addr, {limit: 15}])]);
    const list = (sigs && sigs.result) || [];
    let amounts = {};
    try {
      const batch = list.slice(0, 10).map((s, i) => ({jsonrpc: '2.0', id: i, method: 'getTransaction',
        params: [s.signature, {encoding: 'json', maxSupportedTransactionVersion: 0}]}));
      const res = batch.length ? await getJson(RPC, batch) : [];
      (Array.isArray(res) ? res : []).forEach(r => {
        const tx = r && r.result; if (!tx) return;
        const keys = ((tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || []).map(k => typeof k === 'string' ? k : k.pubkey);
        const i = keys.indexOf(addr);
        if (i >= 0 && tx.meta) amounts[list[r.id].signature] = num((tx.meta.postBalances[i] || 0) - (tx.meta.preBalances[i] || 0), 9);
      });
    } catch (_) { amounts = {}; }
    return {
      balance: num(bal && bal.result && bal.result.value, 9), received: null, count: null,
      txs: list.map(s => ({
        id: s.signature, amount: amounts[s.signature] != null ? amounts[s.signature] : null,
        time: s.blockTime ? s.blockTime * 1000 : null, confirmed: !s.err && s.confirmationStatus !== 'processed',
        failed: !!s.err, confs: 0,
      })),
    };
  };

  const PROVIDERS = {
    'btc':           esplora('https://mempool.space'),
    'ltc':           esplora('https://litecoinspace.org'),
    'bch':           blockchair('bitcoin-cash'),
    'doge':          blockchair('dogecoin'),
    'eth':           blockscout('https://eth.blockscout.com'),
    'erc20/usdt':    blockscout('https://eth.blockscout.com', USDT_ERC20),
    'polygon/matic': blockscout('https://polygon.blockscout.com'),
    'trx':           trongrid(false),
    'trc20/usdt':    trongrid(true),
    'sol':           solana,
  };

  return {
    supported: (coin) => !!PROVIDERS[String(coin || '').toLowerCase()],
    async load(coin, addr, force) {
      const c = String(coin || '').toLowerCase(), a = String(addr || '').trim();
      const p = PROVIDERS[c];
      if (!p || !a) return null;
      const key = c + '|' + a;
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < 60000) return hit.value;
      const value = await p(a);
      value.txs = (value.txs || []).filter(t => t && t.id)
        .sort((x, y) => (y.confirmed === false) - (x.confirmed === false) || (y.time || 0) - (x.time || 0));
      cache.set(key, {at: Date.now(), value});
      return value;
    },
  };
})();

// Explorer page for an address.
const addrExplorerUrl = (coin, addr) => {
  if (!addr) return '';
  const a = encodeURIComponent(addr);
  switch (String(coin || '').toLowerCase()) {
    case 'btc':           return 'https://mempool.space/address/' + a;
    case 'ltc':           return 'https://litecoinspace.org/address/' + a;
    case 'bch':           return 'https://blockchair.com/bitcoin-cash/address/' + a;
    case 'doge':          return 'https://blockchair.com/dogecoin/address/' + a;
    case 'eth':           return 'https://etherscan.io/address/' + a;
    case 'erc20/usdt':    return 'https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7?a=' + a;
    case 'bnb':           return 'https://bscscan.com/address/' + a;
    case 'bep20/usdt':    return 'https://bscscan.com/token/0x55d398326f99059ff775485246999027b3197955?a=' + a;
    case 'polygon/matic': return 'https://polygonscan.com/address/' + a;
    case 'trx':           return 'https://tronscan.org/#/address/' + a;
    case 'trc20/usdt':    return 'https://tronscan.org/#/address/' + a + '/transfers';
    case 'sol':           return 'https://solscan.io/account/' + a;
    default: {
      const {chain} = coinParts(coin);
      if (chain === 'erc20') return 'https://etherscan.io/address/' + a;
      if (chain === 'bep20') return 'https://bscscan.com/address/' + a;
      if (chain === 'trc20') return 'https://tronscan.org/#/address/' + a;
      if (chain === 'polygon') return 'https://polygonscan.com/address/' + a;
      return '';
    }
  }
};

// Quick format check for a payout address. Only used to warn — a valid
// address in a format this doesn't know is never blocked.
const walletAddrLooksValid = (coin, addr) => {
  const a = String(addr || '').trim();
  if (!a) return true;
  const {chain, token} = coinParts(coin);
  const net = chain || token;
  const B58 = '[1-9A-HJ-NP-Za-km-z]';
  const RX = {
    btc:  new RegExp(`^(bc1[0-9a-z]{11,71}|[13]${B58}{25,34})$`, 'i'),
    ltc:  new RegExp(`^(ltc1[0-9a-z]{11,71}|[LM3]${B58}{25,34})$`, 'i'),
    bch:  new RegExp(`^((bitcoincash:)?[qp][0-9a-z]{41}|[13]${B58}{25,34})$`, 'i'),
    doge: new RegExp(`^[DA9]${B58}{25,34}$`),
    xmr:  new RegExp(`^[48]${B58}{94,105}$`),
    trx: new RegExp(`^T${B58}{33}$`), trc20: new RegExp(`^T${B58}{33}$`),
    sol:  new RegExp(`^${B58}{32,44}$`),
  };
  const evm = /^0x[0-9a-fA-F]{40}$/;
  if (['eth', 'erc20', 'bnb', 'bep20', 'bsc', 'polygon', 'matic'].includes(net)) return evm.test(a);
  return RX[net] ? RX[net].test(a) : true;
};

// Amount → "0.0012", trimmed; stablecoins to two places.
const fmtCoinAmt = (n, ticker) => {
  if (n == null || !isFinite(n)) return '—';
  const stable = /^USD[TC]$/i.test(String(ticker || ''));
  const abs = Math.abs(n);
  const dp = stable ? 2 : abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  let s = abs.toLocaleString('en-US', {minimumFractionDigits: stable ? 2 : 0, maximumFractionDigits: dp});
  if (!stable && abs > 0 && s === '0') s = abs.toExponential(2);
  return s;
};
const fmtAgo = (ms) => {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) { const d = Math.floor(s / 86400); return d === 1 ? 'Yesterday' : `${d} days ago`; }
  return bcWhen(ms, false);
};
const walletCoinInfo = (coin) => {
  const meta = CRYPTAPI_COINS.find(c => c.id === coin);
  const {net} = coinParts(coin);
  const ticker = (meta?.ticker || String(coin || '').split('/').pop()).toUpperCase();
  const name = meta ? meta.label : ticker;
  const network = net ? net.label : (meta ? meta.label.replace(/\s*\(.*\)$/, '') : ticker);
  return {meta, ticker, name, network, tint: (meta && meta.tint) || '#6c63ff'};
};

const WdIcon = ({d, size = 13}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const WD_ICON = {
  copy:   <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>,
  out:    <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></>,
  edit:   <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
  refresh:<><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></>,
  down:   <><path d="M12 5v14M5 12l7 7 7-7"/></>,
  up:     <><path d="M12 19V5M5 12l7-7 7 7"/></>,
  clock:  <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  x:      <><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></>,
};

// ── Wallet detail (popup) ──────────────────────────────────────────
// Opened from the wallet list. The coin and its live balance at the top,
// the payout address with copy and explorer links, the wallet's settings,
// then the address's recent transactions. Transactions that came from one
// of your invoices are labelled with the order.
const WalletDetail = ({coin, draft, upd, original, invoices, onSave, onDelete, onToggleEnabled}) => {
  const info = walletCoinInfo(coin);
  const addr = String((original && original.address) || draft.address || '').trim();
  const enabled = draft.enabled !== false;
  const [editAddr, setEditAddr] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const [act, setAct] = React.useState({state: 'idle', data: null, err: ''});
  const [, tick] = React.useState(0);
  const rates = React.useSyncExternalStore
    ? React.useSyncExternalStore(CRYPTO_RATES_STORE.sub, () => CRYPTO_RATES_STORE.updatedAt)
    : 0;
  React.useEffect(() => { try { CRYPTO_RATES_STORE.ensure(); } catch (_) {} }, []);

  const supported = WALLET_TX.supported(coin);
  const load = React.useCallback((force) => {
    if (!supported || !addr) return;
    setAct(a => ({state: a.data ? 'refreshing' : 'loading', data: a.data, err: ''}));
    WALLET_TX.load(coin, addr, force)
      .then(data => setAct({state: 'ready', data, err: ''}))
      .catch(e => setAct(a => ({state: 'error', data: a.data, err: (e && e.message) || 'Could not reach the explorer'})));
  }, [coin, addr, supported]);
  React.useEffect(() => { setAct({state: 'idle', data: null, err: ''}); load(false); }, [load]);
  // Keep it current while the window is open, and keep "5 min ago" honest.
  React.useEffect(() => {
    if (!supported) return;
    const t = setInterval(() => { load(true); tick(x => x + 1); }, 60000);
    return () => clearInterval(t);
  }, [load, supported]);
  React.useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(t); }, [copied]);

  const confs = Math.max(0, Math.min(10, parseInt(draft.min_confirmations, 10) || 0));
  const setConfs = (n) => upd('min_confirmations', Math.max(0, Math.min(10, n)));
  const dirty = !!original && (
    String(draft.label || '') !== String(original.label || '') ||
    String(draft.address || '').trim() !== String(original.address || '').trim() ||
    (parseInt(draft.min_confirmations, 10) || 0) !== (parseInt(original.min_confirmations, 10) || 0));
  const addrOk = walletAddrLooksValid(coin, draft.address);
  const canSave = dirty && !!String(draft.address || '').trim() && !saving;
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try { await onSave(); setSavedAt(Date.now()); setEditAddr(false); } catch (_) { /* the pill already said why */ } finally { setSaving(false); }
  };
  React.useEffect(() => { if (!savedAt) return; const t = setTimeout(() => setSavedAt(0), 1800); return () => clearTimeout(t); }, [savedAt]);

  // Invoices paid into this wallet, keyed by their payout transaction.
  const mine = (invoices || []).filter(i => i && i.coin === coin);
  const byTx = {};
  mine.forEach(i => { if (i.txid_out) byTx[String(i.txid_out).toLowerCase()] = i; });
  const invLabel = (i) => i.order_label || i.description || 'Invoice';
  const paidInvoices = mine.filter(i => i.status === 'confirmed')
    .sort((x, y) => Date.parse(String(y.confirmed_at || y.created || '').replace(' ', 'T')) - Date.parse(String(x.confirmed_at || x.created || '').replace(' ', 'T')));

  const data = act.data;
  const toUsd = (n) => { try { return CRYPTO_RATES_STORE.toUsd(Math.abs(n), info.ticker); } catch (_) { return null; } };
  const balUsd = data && data.balance != null ? toUsd(data.balance) : null;
  // Only money coming in matters here: payouts from invoices and other
  // deposits. Outgoing transfers from the address are left out.
  const inTxs = data && data.txs ? data.txs.filter(t => t.amount == null || t.amount > 0 || t.failed) : [];
  const lastTime = inTxs.length ? (inTxs.find(t => t.time) || {}).time : null;
  const explorer = addrExplorerUrl(coin, addr);
  const openUrl = (u) => { if (u) try { window.open(u, '_blank', 'noopener'); } catch (_) {} };
  const copy = () => { try { navigator.clipboard.writeText(addr); setCopied(true); } catch (_) {} };
  const txList = inTxs.slice(0, 25);

  const txRow = (t) => {
    const inv = byTx[String(t.id).toLowerCase()];
    const dirn = t.failed ? 'failed' : !t.confirmed ? 'pending' : 'in';
    const usd = t.amount != null ? toUsd(t.amount) : null;
    const url = txExplorerUrl(coin, t.id);
    const title = inv ? invLabel(inv) : dirn === 'failed' ? 'Failed' : dirn === 'pending' ? 'Incoming payment' : 'Payment received';
    const sub = [
      t.time ? fmtAgo(t.time) : (t.confirmed ? '' : 'In mempool'),
      bcShort(t.id, 6, 4),
    ].filter(Boolean).join('  ·  ');
    return (
      <button key={t.id} type="button" className="wd-tx" data-k={dirn} onClick={() => openUrl(url)} disabled={!url}
        title={t.time ? bcWhen(t.time) : t.id}>
        <span className="wd-tx-ico">
          <WdIcon d={WD_ICON[dirn === 'pending' ? 'clock' : dirn === 'failed' ? 'x' : 'down']}/>
        </span>
        <span className="wd-tx-main">
          <span className="wd-tx-title">{title}{inv && <span className="wd-tx-tag">Invoice</span>}</span>
          <span className="wd-tx-sub">{sub}</span>
        </span>
        <span className="wd-tx-val">
          <span className="wd-tx-amt">
            {t.amount == null ? '—' : `+${fmtCoinAmt(t.amount, info.ticker)} ${info.ticker}`}
          </span>
          <span className="wd-tx-fiat">
            {!t.confirmed && !t.failed ? 'Pending'
              : t.confs > 0 && t.confs < 6 ? `${t.confs} confirmation${t.confs === 1 ? '' : 's'}`
              : usd != null ? fmtUsd(usd) : 'Confirmed'}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="slw-ed wd" style={{'--wd-tint': info.tint}}>
      <div className="sl-scroll wd-scroll">
        <div className="wd-body">

          <section className="wd-card" aria-label="Wallet summary">
            <div className="wd-card-top">
              <CoinBadge coin={coin} sz={34}/>
              <span className="wd-card-id">
                <span className="wd-card-name">{draft.label || info.name}</span>
                <span className="wd-card-sub">
                  <span className="wd-card-net">{info.ticker}{info.network && info.network !== info.ticker && info.network !== info.name ? ` on ${info.network}` : ''}</span>
                  <button type="button" className="wd-status" data-on={enabled ? '1' : undefined} role="switch" aria-checked={enabled}
                    onClick={() => onToggleEnabled(!enabled)}
                    title={enabled ? 'Agents can invoice in this currency. Click to pause.' : 'Paused. Click to accept payments again.'}>
                    <i aria-hidden="true"/>{enabled ? 'Accepting' : 'Paused'}
                  </button>
                </span>
              </span>
              <span className="wd-bal" title="Current balance of the payout address">
                <span className="wd-bal-label">Balance</span>
                {!supported ? (
                  <span className="wd-bal-na">Not available</span>
                ) : data && data.balance != null ? (<>
                  <span className="wd-bal-num">{fmtCoinAmt(data.balance, info.ticker)}<small>{info.ticker}</small></span>
                  {balUsd != null && <span className="wd-bal-fiat">≈ {fmtUsd(balUsd)}</span>}
                </>) : act.state === 'error' ? (
                  <span className="wd-bal-na">Unavailable</span>
                ) : (
                  <span className="wd-skel wd-skel-bal" aria-label="Loading"/>
                )}
              </span>
            </div>
            <div className="wd-stats">
              <span><small>Payments</small>
                <strong>{data ? `${inTxs.length}${data.txs.length >= 25 ? '+' : ''}` : supported ? '—' : paidInvoices.length}</strong></span>
              <span><small>{data && data.received != null ? 'Total received' : 'Invoices paid'}</small>
                <strong>{data && data.received != null ? `${fmtCoinAmt(data.received, info.ticker)} ${info.ticker}` : paidInvoices.length}</strong></span>
              <span><small>Last payment</small><strong>{lastTime ? fmtAgo(lastTime) : data ? 'None yet' : '—'}</strong></span>
            </div>
          </section>

          <div className="wz-sec">
            <div className="wz-cap"><span>Payout address</span></div>
            <div className="wz-group wd-addr" data-field={editAddr ? '1' : undefined}>
              {editAddr ? (
                <div className="wd-addr-row">
                  <input className="wz-input wd-mono wd-addr-in" value={draft.address || ''} autoFocus spellCheck={false} autoComplete="off"
                    aria-label="Payout address" onChange={e => upd('address', e.target.value.trim())}
                    onKeyDown={e => { if (e.key === 'Enter') save(); }}/>
                  <button type="button" className="wz-link" onClick={() => { upd('address', original ? original.address : ''); setEditAddr(false); }}>Cancel</button>
                </div>
              ) : (
                <div className="wd-addr-row">
                  <span className="wd-addr-val wd-mono" title={addr}>{addr || <em>No address</em>}</span>
                  <span className="wd-addr-icons">
                    <button type="button" className="wd-ibtn" onClick={copy} disabled={!addr} aria-label="Copy address" title={copied ? 'Copied' : 'Copy'} data-done={copied ? '1' : undefined}>
                      <WdIcon d={copied ? <path d="M20 6 9 17l-5-5"/> : WD_ICON.copy}/>
                    </button>
                    {explorer && <button type="button" className="wd-ibtn" onClick={() => openUrl(explorer)} aria-label="View on explorer" title="View on explorer"><WdIcon d={WD_ICON.out}/></button>}
                    <button type="button" className="wd-ibtn" onClick={() => setEditAddr(true)} aria-label="Change address" title="Change address"><WdIcon d={WD_ICON.edit}/></button>
                  </span>
                </div>
              )}
            </div>
            <div className="wz-note" data-warn={editAddr && !addrOk ? '1' : undefined}>
              {editAddr && !addrOk
                ? `This does not look like a ${info.ticker} address. Check it before saving.`
                : 'Each invoice gets its own deposit address. Payments are forwarded here once confirmed.'}
            </div>
          </div>

          <div className="wz-sec">
            <div className="wz-cap"><span>Settings</span></div>
            <div className="wz-group">
              <label className="wz-row">
                <span className="wz-row-label">Name</span>
                <input className="wz-input" data-align="end" value={draft.label || ''} placeholder={info.name}
                  onChange={e => upd('label', e.target.value)}/>
              </label>
              <div className="wz-row">
                <span className="wz-row-txt">
                  <span className="wz-row-title">Confirmations</span>
                  <span className="wz-row-hint">Needed before an invoice counts as paid.</span>
                </span>
                <span className="slw-step" role="group" aria-label="Confirmations required" style={{marginLeft:'auto'}}>
                  <button type="button" onClick={() => setConfs(confs - 1)} disabled={confs <= 0} aria-label="Fewer">−</button>
                  <output aria-live="polite">{confs}</output>
                  <button type="button" onClick={() => setConfs(confs + 1)} disabled={confs >= 10} aria-label="More">+</button>
                </span>
              </div>
            </div>
          </div>

          <div className="wz-sec">
            <div className="wz-cap">
              <span>Recent payments</span>
              {supported && addr && (
                <button type="button" className="wd-refresh" onClick={() => load(true)} data-spin={act.state === 'loading' || act.state === 'refreshing' ? '1' : undefined}
                  aria-label="Refresh payments" title="Refresh">
                  <WdIcon d={WD_ICON.refresh} size={12}/>
                </button>
              )}
            </div>
            <div className="wz-group wd-txs">
              {!addr ? (
                <div className="wd-empty">Add a payout address to see its activity.</div>
              ) : supported && (act.state === 'loading' || act.state === 'idle') && !data ? (
                [0, 1, 2].map(i => (
                  <div key={i} className="wd-tx" data-skel="1" aria-hidden="true">
                    <span className="wd-skel wd-skel-ico"/>
                    <span className="wd-tx-main"><span className="wd-skel" style={{width: '46%'}}/><span className="wd-skel" style={{width: '30%', height: 8}}/></span>
                    <span className="wd-skel" style={{width: 70}}/>
                  </div>
                ))
              ) : supported && data && txList.length ? (
                txList.map(t => txRow(t))
              ) : supported && data ? (
                <div className="wd-empty">
                  <strong>No payments yet</strong>
                  <span>Payments forwarded to this address will show up here.</span>
                </div>
              ) : (
                // No live data (unsupported chain, or the explorer failed):
                // fall back to what the invoices recorded.
                <>
                  <div className="wd-empty" data-compact={paidInvoices.length ? '1' : undefined}>
                    <strong>{act.state === 'error' ? 'Could not load live activity' : `Live activity is not available for ${info.ticker}`}</strong>
                    <span>{act.state === 'error'
                      ? 'The block explorer did not respond.'
                      : coin === 'xmr' ? 'Monero transactions are private and cannot be looked up by address.' : 'Open the explorer to see every transaction.'}
                      {paidInvoices.length ? ' Payments from your invoices are listed below.' : ''}</span>
                    {act.state === 'error' && <button type="button" className="wz-link" onClick={() => load(true)}>Try again</button>}
                  </div>
                  {paidInvoices.slice(0, 15).map(i => {
                    const amt = parseFloat(i.amount_forwarded_coin || i.amount_coin);
                    const t = Date.parse(String(i.confirmed_at || i.created || '').replace(' ', 'T'));
                    return txRow({id: i.txid_out || i.txid || i.txid_in || i.id, amount: isFinite(amt) ? amt : null,
                      time: isFinite(t) ? t : null, confirmed: true, confs: 0});
                  })}
                </>
              )}
            </div>
            {supported && data && explorer && (
              <div className="wz-note wd-foot-note">
                <span>{act.state === 'error' ? 'Showing the last loaded activity.' : 'Updates every minute.'}</span>
                <button type="button" className="wz-link" onClick={() => openUrl(explorer)}>View all on explorer</button>
              </div>
            )}
          </div>

        </div>
      </div>

      <div className="slw-foot">
        <button type="button" className="slw-link-danger" onClick={onDelete}>Remove wallet</button>
        <span className="slw-foot-sp"/>
        {savedAt ? <span className="wd-saved">Saved</span> : null}
        <button type="button" className="sset-btn" data-variant="primary" onClick={save} disabled={!canSave}
          title={!dirty ? 'No changes to save' : undefined}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
};

// ── New wallet wizard ──────────────────────────────────────────────
// Same shell and look as the product and agent wizards (SetupWizard in
// bot-ui-views.jsx): currency, payout address and name, confirmations,
// then the shared review page with the switch to start accepting.
const WalletWizard = ({draft, upd, coinPicker, setCoinPicker, customCoin, setCustomCoin, usedCoins, onSave, onBack}) => {
  const [step, setStep] = React.useState(0);
  const used = new Set(usedCoins || []);
  const coin = coinPicker === '__custom__' ? String(customCoin || '').trim().toLowerCase() : coinPicker;
  const info = walletCoinInfo(coin);
  const addr = String(draft.address || '').trim();
  const addrOk = walletAddrLooksValid(coin, addr);
  const taken = !!coin && used.has(coin);
  const confs = parseInt(draft.min_confirmations, 10);
  const nameOf = (c) => {
    const {net} = coinParts(c.id);
    return net && c.ticker !== 'MATIC' ? {name: c.ticker, net: net.label} : {name: c.label, net: c.ticker};
  };
  // The chosen coin stands in for the step glyph once there is one.
  const coinHero = coin ? <span className="wz-coinhero"><CoinBadge coin={coin} sz={30}/></span> : null;
  const canPaste = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText;
  const paste = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) upd('address', t.trim()); } catch (_) {}
  };

  const STEPS = [
    {id: 'coin', icon: 'wallet', title: 'Currency', sub: 'What customers pay in. Add more later.',
      need: !!coin && !taken,
      needMsg: taken ? 'You already have this wallet' : coinPicker === '__custom__' ? 'Enter a ticker' : 'Choose a currency'},
    {id: 'address', icon: 'wallet', title: 'Payout address', sub: `Your own ${info.ticker} address.`,
      hero: coinHero, need: !!addr, needMsg: 'Enter your payout address'},
    {id: 'confs', icon: 'shield', title: 'Confirmations', sub: 'Needed before an order counts as paid.',
      hero: coinHero},
    {id: 'review', icon: 'check', title: 'Review', sub: 'Select any item to change it.'},
  ];

  const CONF_OPTS = [
    {value: 1, label: '1', hint: 'Fastest', glyph: <WzBars n={1} of={4}/>},
    {value: 2, label: '2', hint: 'Quick',   glyph: <WzBars n={2} of={4}/>},
    {value: 3, label: '3', hint: 'Safer',   glyph: <WzBars n={3} of={4}/>},
    {value: 6, label: '6', hint: 'Safest',  glyph: <WzBars n={4} of={4}/>},
  ];
  if (isFinite(confs) && !CONF_OPTS.some(o => o.value === confs)) {
    CONF_OPTS.push({value: confs, label: String(confs), hint: 'Current', glyph: <WzBars n={4} of={4}/>});
  }

  const render = (cur, go) => {
    switch (cur.id) {
      case 'coin': return (<>
        <div className="wz-coins" role="radiogroup" aria-label="Currency">
          {CRYPTAPI_COINS.map(c => {
            const on = coinPicker === c.id;
            const isTaken = used.has(c.id);
            const n = nameOf(c);
            return (
              <button key={c.id} type="button" role="radio" aria-checked={on} className="wz-coin" disabled={isTaken}
                title={isTaken ? 'You already have a wallet for this currency' : c.label}
                onClick={() => setCoinPicker(c.id)}
                onDoubleClick={() => { if (!isTaken) { setCoinPicker(c.id); go(1); } }}>
                <CoinBadge coin={c.id} sz={20}/>
                <span className="wz-coin-txt">
                  <span className="wz-coin-name">{n.name}</span>
                  <span className="wz-coin-net">{isTaken ? 'Added' : n.net}</span>
                </span>
              </button>
            );
          })}
          <button type="button" role="radio" aria-checked={coinPicker === '__custom__'} className="wz-coin"
            onClick={() => setCoinPicker('__custom__')}>
            <span className="wz-coin-other" aria-hidden="true">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </span>
            <span className="wz-coin-txt">
              <span className="wz-coin-name">Other</span>
              <span className="wz-coin-net">Any ticker</span>
            </span>
          </button>
        </div>
        {coinPicker === '__custom__' && (
          <WzSec field note="For tokens, put the network first: trc20/usdc">
            <label className="wz-row" data-ico="1">
              <span className="wz-ico"><WzSvg name="hash"/></span>
              <input className="wz-input wd-mono" data-wz-focus value={customCoin || ''} spellCheck={false} autoComplete="off"
                onChange={e => setCustomCoin(e.target.value)} placeholder="xrp or trc20/usdc"/>
            </label>
          </WzSec>
        )}
      </>);

      case 'address': return (<>
        <div className="wz-sec">
          <div className="wz-group" data-field="1">
            <textarea className="wz-textarea wd-mono wd-addr-input" data-wz-focus rows={2} value={draft.address || ''}
              spellCheck={false} autoComplete="off" placeholder={`Your ${info.ticker} address`}
              onChange={e => upd('address', e.target.value.replace(/\s+/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}/>
          </div>
          <div className="wz-mini">
            {canPaste && <button type="button" className="wz-chip" onClick={paste}><WzSvg name="paste" size={11}/>Paste</button>}
            <span className="wz-note" data-warn={addr && !addrOk ? '1' : undefined}>
              {addr && !addrOk ? `Doesn’t look like a ${info.ticker} address. Check it.` : 'Wrong addresses can’t be recovered.'}
            </span>
          </div>
        </div>
        <WzSec field>
          <label className="wz-row" data-ico="1">
            <span className="wz-ico"><WzSvg name="tag"/></span>
            <input className="wz-input" value={draft.label || ''} placeholder={`Name (optional), e.g. ${info.name}`}
              onChange={e => upd('label', e.target.value)}/>
          </label>
        </WzSec>
      </>);

      case 'confs': return (
        <WzTiles label="Confirmations" layout="stack" cols={Math.min(CONF_OPTS.length, 5)}
          value={isFinite(confs) ? confs : 1} onChange={v => upd('min_confirmations', v)} options={CONF_OPTS}/>
      );

      case 'review': {
        const enabled = draft.enabled !== false;
        const n = isFinite(confs) ? confs : 1;
        return (
          <WzReview go={go} items={[
            {icon:'wallet', k:'Currency', v: `${info.name}${info.network && info.network !== info.name && info.network !== info.ticker ? `, ${info.network}` : ''}`, step: 0},
            {icon:'send',   k:'Address',  v: bcShort(addr, 8, 6), step: 1},
            {icon:'tag',    k:'Name',     v: draft.label || 'None', dim: !draft.label, step: 1},
            {icon:'shield', k:'Confirmations', v: `${n} confirmation${n === 1 ? '' : 's'}`, step: 2},
          ]} live={{icon:'bolt', title:'Accept payments now', on: enabled, onChange: v => upd('enabled', v)}}/>
        );
      }
      default: return null;
    }
  };

  return (
    <SetupWizard label="New wallet" steps={STEPS} step={step} onStep={setStep}
      onCancel={onBack} onFinish={onSave} finishLabel="Add wallet" busyLabel="Adding…" render={render}/>
  );
};

// ── Invoice detail (popup) ─────────────────────────────────────
// Everything recorded about one invoice, in the same frame as the wallet
// editor: toolbar (back · item · status), grouped facts, footer actions.
const INV_STATUS_LABEL = {pending:'Awaiting payment', confirmed:'Paid', expired:'Expired', failed:'Failed', cancelled:'Cancelled'};
const INV_PRICE_SOURCE = {
  catalogue_fallback:  'Catalog price',
  catalogue_corrected: 'Catalog price (agent price corrected)',
  ai_within_drift:     'Agent price, matches catalog',
  ai_only:             'Set by agent',
  unset:               'Not set',
  none:                'Not set',
};
const INV_DELIVERY_FAIL = {
  product_not_found:   'The product no longer exists.',
  no_media_configured: 'The product has nothing set up to deliver.',
  no_product:          'No product is linked to this invoice.',
};
// Block-explorer page for a transaction, where one exists for the chain.
const txExplorerUrl = (coin, tx) => {
  if (!tx) return '';
  const {chain, token} = coinParts(coin);
  const net = chain || token;
  const t = encodeURIComponent(tx);
  switch (net) {
    case 'btc':     return 'https://mempool.space/tx/' + t;
    case 'ltc':     return 'https://blockchair.com/litecoin/transaction/' + t;
    case 'bch':     return 'https://blockchair.com/bitcoin-cash/transaction/' + t;
    case 'doge':    return 'https://blockchair.com/dogecoin/transaction/' + t;
    case 'eth': case 'erc20':   return 'https://etherscan.io/tx/' + t;
    case 'bnb': case 'bep20': case 'bsc': return 'https://bscscan.com/tx/' + t;
    case 'trx': case 'trc20':   return 'https://tronscan.org/#/transaction/' + t;
    case 'polygon': case 'matic': return 'https://polygonscan.com/tx/' + t;
    case 'sol':     return 'https://solscan.io/tx/' + t;
    default:        return '';
  }
};

// Status → the pill colours the license popup already uses, so an invoice
// and a license read as the same family: green = done, amber = waiting,
// red = didn't happen, grey = withdrawn.
const INV_PILL = {confirmed:'active', pending:'expiring', expired:'expired', failed:'expired', cancelled:''};

// WHY THIS INVOICE EXISTS. The agent's own one-line reason (purpose= on the
// invoice sentinel) when it gave one, plus what the invoice's own fields
// say about it — a renewal of a key they already hold, several on one key
// or on separate keys, an invoice that replaced (or was replaced by)
// another. Plain facts, no guessing.
const invPurpose = (inv, products, title) => {
  const tags = [];
  const lines = Array.isArray(inv.items) ? inv.items : [];
  if (inv.renew_license_id || inv.renew_serial) {
    const k = String(inv.renew_serial || '').split(',').filter(Boolean);
    tags.push(k.length ? `Renews ${k.length === 1 ? 'key ' + k[0] : k.length + ' keys'}` : 'Renews an existing license');
  }
  lines.forEach(l => {
    if (!l || !(l.qty > 1)) return;
    const nm = l.name || ((products || []).find(p => p.id === l.product_id) || {}).name || 'Item';
    tags.push(`${l.qty} × ${nm}, ${l.same_key ? 'on one key' : 'separate keys'}`);
  });
  const shortId = (id) => '…' + String(id).slice(-5).toUpperCase();
  const reps = Array.isArray(inv.replaces_ids) ? inv.replaces_ids : [];
  if (reps.length) tags.push(`Replaces ${reps.map(shortId).join(', ')}`);
  if (inv.replaced_by) tags.push(`Replaced by ${shortId(inv.replaced_by)}`);
  if (inv.failed_reason === 'below_network_minimum') tags.push('Held: below the coin\u2019s network minimum');
  // Older invoices (from before the agent recorded a reason) fall back to
  // their own label when it says more than the item name does.
  let text = String(inv.purpose || '').trim();
  const label = String(inv.description || '').trim();
  if (!text && label && label !== title) text = label;
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
  return {text, tags};
};

// One read-only line in the license popup's list style: label on the left,
// value right-aligned, optional icon buttons (copy, explorer) after it.
// Module-level so the copy buttons keep their "Copied" tick across
// re-renders of the popup.
const InvRow = ({k, children, mono, title, after}) => (
  <div className="wz-row">
    <span className="wz-row-label">{k}</span>
    <span className={'wd-kv-val' + (mono ? ' wd-mono' : '')} title={title}>{children}</span>
    {after}
  </div>
);

// ── KEYS AND CODES ON INVOICES ────────────────────────────────
// Keys, codes and logins handed out from a product's "Keys and codes" list
// are not licences, so they are not shown in Licenses. They belong to the
// sale: each invoice lists what it gave the customer, and the invoice
// search finds an invoice by the key itself ("who got this code?").
// The server is the record (get_invoice_keys): {<invoice id>: [{id,
// product_id, product, label, item, status: given|owed, pending_send, at,
// unit}]}. Held once here for the invoice popup and the invoice search.
const INV_KEYS = {
  map: {}, loaded: false, acct: null, _p: null, _at: 0, ver: 0, subs: new Set(),
  sub(f) { this.subs.add(f); return () => this.subs.delete(f); },
  notify() { this.ver++; this.subs.forEach(f => { try { f(); } catch (_) {} }); },
  isDemo() { return !!(typeof AUTH_STORE !== 'undefined' && AUTH_STORE.account && AUTH_STORE.account.email === 'demo@botcommand.app'); },
  of(id) { const l = this.map[String(id || '')]; return Array.isArray(l) ? l : []; },
  load(force) {
    const acct = (typeof AUTH_STORE !== 'undefined' && AUTH_STORE.account && AUTH_STORE.account.email) || '';
    if (acct !== this.acct) { this.acct = acct; this.map = {}; this.loaded = false; this._p = null; this._at = 0; this.notify(); }
    if (!acct || this.isDemo()) {
      if (!this.loaded) { this.loaded = true; this.notify(); }
      return Promise.resolve(this.map);
    }
    if (this._p) return this._p;
    if (!force && this.loaded && Date.now() - this._at < 20000) return Promise.resolve(this.map);
    this._p = apiFetch('get_invoice_keys', {}).then(res => {
      if (res && !res.error && res.invoices && typeof res.invoices === 'object') {
        const next = Array.isArray(res.invoices) ? {} : res.invoices;
        if (JSON.stringify(next) !== JSON.stringify(this.map)) { this.map = next; this.loaded = true; this._at = Date.now(); this.notify(); return this.map; }
      }
      this._at = Date.now();
      if (!this.loaded) { this.loaded = true; this.notify(); }
      return this.map;
    }).catch(() => { if (!this.loaded) { this.loaded = true; this.notify(); } return this.map; })
      .finally(() => { setTimeout(() => { this._p = null; }, 0); });
    return this._p;
  },
};
// A sale that just handed out an item (or a back-order that was filled)
// refreshes the list, once something has asked for it.
try {
  window.addEventListener('bcEvent', (e) => {
    const ev = e && e.detail && e.detail.event;
    if ((ev === 'invoiceKeysChanged' || ev === 'licensesChanged') && INV_KEYS.loaded) setTimeout(() => INV_KEYS.load(true), 1200);
  });
} catch (_) {}
const useInvoiceKeys = (fresh) => {
  const [, bump] = React.useState(0);
  React.useEffect(() => INV_KEYS.sub(() => bump(n => n + 1)), []);
  React.useEffect(() => { INV_KEYS.load(!!fresh); }, []);
  return INV_KEYS;
};

// One key, code or login on the invoice: what it is, where it stands, the
// item itself and a copy button. A multi-line item (a login) is shown in
// full on its own lines under the heading.
const InvKeyRow = ({k, showProduct}) => {
  const item = String(k.item || '');
  const multi = item.includes('\n');
  const label = String(k.label || 'Code');
  const heading = label + (showProduct && k.product ? ' \u00b7 ' + k.product : '');
  const when = k.at ? bcWhen(k.at) : '';
  const state = k.status === 'owed'
    ? {s: 'expiring', t: 'Waiting for stock', hint: 'Goes to the customer as soon as you add more to the list'}
    : k.pending_send
      ? {s: 'expiring', t: 'Ready to send', hint: 'Not sent to the customer yet. Use Send to waiting customers in the catalog'}
      : {s: 'active', t: 'Given', hint: when ? 'Given to the customer ' + when : 'Given to the customer'};
  const copy = (item && typeof LicCopy !== 'undefined') ? <LicCopy text={item} label={'Copy ' + label.toLowerCase()}/> : null;
  return (
    <div className="wz-row" style={{alignItems: multi ? 'flex-start' : 'center', flexWrap: multi ? 'wrap' : 'nowrap', paddingTop: 2, paddingBottom: multi ? 10 : 2}}>
      <span className="wz-row-txt">
        <span className="wz-row-title" style={{display: 'flex', alignItems: 'center', gap: 7, minWidth: 0}}>
          <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{heading}</span>
          {state.s !== 'active' && <span className="wd-lic-pill" data-s={state.s}><i aria-hidden="true"/>{state.t}</span>}
        </span>
        <span className="wz-row-hint">{state.hint}{k.unit ? ' \u00b7 unit ' + String(k.unit).replace(/^#/, '') : ''}</span>
      </span>
      {!multi && (
        <span className="wd-kv-val wd-mono" title={item || undefined} style={{flex: '0 1 auto', maxWidth: '55%', userSelect: 'all'}}>
          {item || <small>Not given yet</small>}
        </span>
      )}
      {copy}
      {multi && (
        <pre className="wd-mono" style={{flex: '1 0 100%', margin: '0', padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.22)',
          boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.06)', fontSize: 11.5, lineHeight: 1.5, color: 'rgba(214,216,232,0.92)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'all'}}>{item}</pre>
      )}
    </div>
  );
};

const InvoiceDetail = ({inv, products, wallets, busy, onBack, onCheck, onMarkPaid, onDelete}) => {
  const prod = products.find(p => p.id === inv.product_id);
  const lines = Array.isArray(inv.items) ? inv.items : [];
  const itemsLabel = (lines.length && typeof INVOICE_ITEMS !== 'undefined') ? INVOICE_ITEMS.label(inv) : '';
  const title = itemsLabel || inv.order_label || (prod ? prod.name : (inv.description || 'Payment'));
  useSsetCrumb('Invoices', title, onBack);
  // Keys and codes this sale handed out, fresh from the server on open and
  // again once the payment is confirmed / delivered.
  useInvoiceKeys(true);
  React.useEffect(() => { if (inv.status === 'confirmed') INV_KEYS.load(true); }, [inv.status, inv.delivered]);
  const keys = INV_KEYS.of(inv.id);
  const keyShowProduct = keys.length > 0 && (new Set(keys.map(k => k.product_id)).size > 1 || lines.length > 1);
  const status = INV_STATUS_LABEL[inv.status] ? inv.status : 'pending';
  const meta = CRYPTAPI_COINS.find(c => c.id === inv.coin);
  const {net} = coinParts(inv.coin);
  const ticker = (meta?.ticker || String(inv.coin || '').split('/').pop()).toUpperCase();
  const coinName = (meta ? meta.label : ticker) + (net && ticker !== 'MATIC' && !(meta && /\(/.test(meta.label)) ? ' (' + net.label + ')' : '');
  const tint = (typeof walletCoinInfo === 'function' ? walletCoinInfo(inv.coin).tint : '') || '#6c63ff';
  const w = wallets[inv.coin];
  const required = inv.min_confirmations || w?.min_confirmations || 1;
  const conv = inv.conv_id ? bcConvLookup(inv.conv_id) : null;
  // The customer's name as saved on the invoice when the chat isn't loaded
  // (or the contact was erased): direct-chat invoices carry it.
  const convName = conv ? (conv.name || conv.username || conv.chatId || '') : String(inv.customer || '');
  const convHandle = conv ? (bcAtHandle(conv.handle) || bcAtHandle(conv.username)) : (inv.customer_handle ? bcAtHandle(inv.customer_handle) : '');
  const agentName = inv.agent_name || (() => {
    try {
      const a = conv && conv.agent_id && typeof AGENTS_STORE !== 'undefined' ? AGENTS_STORE.byId(conv.agent_id) : null;
      return a ? a.name : '';
    } catch (_) { return ''; }
  })();
  const fiat = inv.fiat || 'USD';
  const txIn = inv.txid || inv.txid_in || '';
  const drift = typeof inv.payment_drift === 'number' ? inv.payment_drift : null;
  const openConv = () => {
    if (!conv) return;
    try { window.dispatchEvent(new CustomEvent('bc-open-conv', { detail: { msg: conv } })); } catch(_){}
  };
  const quotedNum = parseFloat(inv.amount_coin_quoted);
  const minNum = parseFloat(inv.minimum_coin);
  const belowMin = isFinite(quotedNum) && isFinite(minNum) && minNum > 0 && quotedNum < minNum;
  const delivery = inv.status !== 'confirmed' ? null
    : inv.delivered ? (inv.delivery_failed_reason === 'no_media_configured' ? 'Nothing to deliver'
        : inv.delivery_failed_reason === 'product_not_found' ? 'Skipped' : 'Delivered')
    : (inv.delivery_attempts ? `Retrying (${inv.delivery_attempts} of 6)` : 'In progress');
  const purpose = invPurpose(inv, products, title);
  const copy = (text, label) => (text && typeof LicCopy !== 'undefined') ? <LicCopy text={text} label={label}/> : null;
  const explorer = (tx) => {
    const url = txExplorerUrl(inv.coin, tx);
    return url ? (
      <button type="button" className="wd-ibtn" aria-label="View on explorer" title="View on explorer"
        onClick={() => { try { window.open(url, '_blank', 'noopener'); } catch (_) {} }}>
        <WdIcon d={WD_ICON.out}/>
      </button>
    ) : null;
  };
  const Row = InvRow;
  const custLabel = convName || convHandle;
  const amountBig = inv.amount_fiat ? `${inv.amount_fiat} ${fiat}` : '—';
  const amountSub = (inv.amount_coin || inv.amount_coin_quoted) ? `${inv.amount_coin || inv.amount_coin_quoted} ${ticker}` : ticker;
  // Third stat follows the invoice's life: confirmations while it waits,
  // delivery once paid, the closing date otherwise.
  const stat3 = inv.status === 'confirmed' ? {k: 'Delivery', v: delivery || '—'}
    : inv.status === 'pending' ? {k: 'Confirmations', v: `${inv.confirmations || 0} of ${required}`}
    : inv.status === 'cancelled' ? {k: 'Cancelled', v: bcWhen(inv.cancelled_at, false) || '—'}
    : inv.status === 'expired' ? {k: 'Expired', v: bcWhen(inv.expired_at, false) || '—'}
    : {k: 'Status', v: INV_STATUS_LABEL[status]};

  return (
    <div className="slw-ed wd" style={{'--wd-tint': tint}}>
      <div className="sl-scroll wd-scroll">
        <div className="wd-body">

          <section className="wd-card" aria-label="Invoice summary">
            <div className="wd-card-top">
              <span className="wd-avatar" aria-hidden="true" style={{background: 'transparent', boxShadow: 'none'}}><CoinBadge coin={inv.coin} sz={34}/></span>
              <span className="wd-card-id">
                <span className="wd-card-name" title={title}>{title}</span>
                <span className="wd-card-sub">
                  <span className="wd-lic-pill" data-s={INV_PILL[status] || undefined}><i aria-hidden="true"/>{INV_STATUS_LABEL[status]}</span>
                  {custLabel && <span className="wd-card-net">{custLabel}</span>}
                </span>
              </span>
              <span className="wd-exp">
                <span className="wd-exp-big">{amountBig}</span>
                <span className="wd-exp-sub">{amountSub}</span>
              </span>
            </div>
            <div className="wd-stats">
              <span><small>Created</small><strong>{bcWhen(inv.created, false) || '—'}</strong></span>
              <span><small>Paid</small><strong>{inv.confirmed_at ? bcWhen(inv.confirmed_at, false) : '—'}</strong></span>
              <span><small>{stat3.k}</small><strong>{stat3.v}</strong></span>
            </div>
          </section>

          {(purpose.text || purpose.tags.length > 0) && (
            <div className="wz-sec">
              <div className="wz-cap"><span>Purpose</span></div>
              <div className="wz-group inv-purpose">
                {purpose.text && <p className="inv-purpose-text">{purpose.text}</p>}
                {purpose.tags.length > 0 && (
                  <div className="inv-purpose-tags">
                    {purpose.tags.map((t, i) => <span key={i} className="inv-tag">{t}</span>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {keys.length > 0 && (
            <div className="wz-sec">
              <div className="wz-cap"><span>Keys and codes</span>{keys.length > 1 && <small>{keys.length}</small>}</div>
              <div className="wz-group">
                {keys.map(k => <InvKeyRow key={k.id} k={k} showProduct={keyShowProduct}/>)}
              </div>
              <div className="wz-note">Handed out from the product{keyShowProduct ? 's\u2019' : '\u2019s'} Keys and codes list for this sale. Search invoices by any key or code to find who received it.</div>
            </div>
          )}

          {(drift !== null || inv.delivery_failed_reason || belowMin || inv.basket_unresolved || inv.addr_mode === 'fail') && (
            <div className="slw-group">
              {drift !== null && Math.abs(drift) > 0.01 && (
                <div className="sl-alert" data-tone={drift < 0 ? 'danger' : undefined}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
                  <span>{drift < 0 ? 'Underpaid' : 'Overpaid'} by {(Math.abs(drift) * 100).toFixed(1)}%. {drift < 0
                    ? 'The order was still delivered; follow up with the customer if the shortfall matters.'
                    : 'Refund or credit the difference if needed.'}</span>
                </div>
              )}
              {inv.delivery_failed_reason && INV_DELIVERY_FAIL[inv.delivery_failed_reason] && inv.delivery_failed_reason !== 'no_media_configured' && (
                <div className="sl-alert" data-tone="danger">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
                  <span>Delivery failed. {INV_DELIVERY_FAIL[inv.delivery_failed_reason]}</span>
                </div>
              )}
              {belowMin && inv.status === 'pending' && (
                <div className="sl-alert">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
                  <span>The amount is below the network minimum of {inv.minimum_coin} {ticker}. A payment this small will not be forwarded to your wallet.</span>
                </div>
              )}
              {inv.basket_unresolved && (
                <div className="sl-alert">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
                  <span>Some items in this order are not linked to catalog products and will not be delivered automatically.</span>
                </div>
              )}
              {inv.addr_mode === 'fail' && (
                <div className="sl-alert" data-tone="danger">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
                  <span>No deposit address could be created for this invoice.</span>
                </div>
              )}
            </div>
          )}

          <div className="wz-sec">
            <div className="wz-cap"><span>Order</span></div>
            <div className="wz-group">
              <div className="wz-row">
                <span className="wz-row-label">Customer</span>
                <span className="wd-kv-val">{(conv || convName || convHandle) ? <>{convName || convHandle}{convHandle && convName && convHandle !== convName ? <small>  {convHandle}</small> : null}</> : <small>Not linked</small>}</span>
                {conv && <button type="button" className="wz-link" onClick={openConv} style={{marginLeft: 4}}>Open chat</button>}
              </div>
              {agentName && <Row k="Agent">{agentName}</Row>}
              {lines.length > 1 && lines.map((l, i) => (
                <Row key={i} k={i === 0 ? 'Items' : ''}>{(l.name || (products.find(p => p.id === l.product_id) || {}).name || 'Item')}{l.qty > 1 ? <small>  × {l.qty}</small> : null}</Row>
              ))}
              {inv.description && inv.description !== title && inv.purpose && <Row k="Label" title={inv.description}>{inv.description}</Row>}
              {delivery && <Row k="Delivery">{delivery}{inv.delivered_at ? <small>  {bcWhen(inv.delivered_at)}</small> : null}</Row>}
              {inv.status === 'confirmed' && <Row k="Customer notified">{inv.customer_confirmed_msg_sent ? 'Yes' : 'Not yet'}</Row>}
            </div>
          </div>

          <div className="wz-sec">
            <div className="wz-cap"><span>Amount</span></div>
            <div className="wz-group">
              <Row k="Total">{amountBig}</Row>
              {inv.amount_coin_quoted != null && inv.amount_coin_quoted !== '' && (
                <Row k="Quoted" title={inv.rate_used ? `1 ${ticker} = ${inv.rate_used} ${fiat}` : undefined}>
                  {inv.amount_coin_quoted} {ticker}
                  {inv.rate_used ? <small>  at {Number(inv.rate_used).toLocaleString('en-US', {maximumFractionDigits: 2})} {fiat}</small> : null}
                </Row>
              )}
              {inv.amount_coin && <Row k="Received">{inv.amount_coin} {ticker}</Row>}
              {inv.amount_forwarded_coin && <Row k="Forwarded to you">{inv.amount_forwarded_coin} {ticker}</Row>}
              {inv.price_source && <Row k="Price">{INV_PRICE_SOURCE[inv.price_source] || inv.price_source}</Row>}
            </div>
          </div>

          <div className="wz-sec">
            <div className="wz-cap"><span>Payment</span></div>
            <div className="wz-group">
              <div className="wz-row">
                <span className="wz-row-label">Currency</span>
                <span className="wd-kv-val">{coinName}</span>
              </div>
              <Row k="Deposit address" mono title={inv.address} after={copy(inv.address, 'Copy address')}>
                {inv.address ? bcShort(inv.address, 10, 8) : <small>None</small>}
              </Row>
              <Row k="Confirmations">{inv.confirmations || 0} of {required}</Row>
              {txIn && <Row k="Transaction" mono title={txIn} after={<>{explorer(txIn)}{copy(txIn, 'Copy transaction ID')}</>}>{bcShort(txIn)}</Row>}
              {inv.txid_out && <Row k="Payout" mono title={inv.txid_out} after={<>{explorer(inv.txid_out)}{copy(inv.txid_out, 'Copy payout transaction ID')}</>}>{bcShort(inv.txid_out)}</Row>}
              <Row k="Created">{bcWhen(inv.created) || '—'}</Row>
              {inv.first_seen_at && <Row k="Payment detected">{bcWhen(inv.first_seen_at)}</Row>}
              {inv.confirmed_at && <Row k="Paid">{bcWhen(inv.confirmed_at)}{inv.manual_confirmed ? <small>  marked manually</small> : null}</Row>}
              {inv.cancelled_at && <Row k="Cancelled">{bcWhen(inv.cancelled_at)}{inv.cancelled_by ? <small>  by {inv.cancelled_by === 'ghost' ? 'assistant' : inv.cancelled_by}</small> : null}</Row>}
              {inv.expired_at && <Row k="Expired">{bcWhen(inv.expired_at)}</Row>}
              {inv.last_checked && <Row k="Last checked">{bcWhen(inv.last_checked)}</Row>}
              <Row k="Invoice ID" mono title={inv.id} after={copy(inv.id, 'Copy invoice ID')}>{inv.id}</Row>
            </div>
          </div>

        </div>
      </div>

      <div className="slw-foot">
        <button type="button" className="slw-link-danger" onClick={onDelete}>Delete invoice</button>
        <span className="slw-foot-sp"/>
        <button type="button" className="sset-btn" onClick={onCheck} disabled={busy}>
          {busy ? 'Checking…' : 'Check status'}
        </button>
        {inv.status !== 'confirmed' && inv.status !== 'cancelled' && (
          <button type="button" className="sset-btn" data-variant="primary" onClick={onMarkPaid}>Mark as paid</button>
        )}
      </div>
    </div>
  );
};

// ── Shared invoice helpers ───────────────────────────────────
// What an operator would type to find an invoice: the item, customer,
// coin, amount, address or transaction id. Used by Invoices and by the
// Overview in Licenses & payments.
const bcInvoiceMatches = (inv, q, products) => {
  if (!String(q || '').trim()) return true;
  const prod = (products || []).find(p => p.id === inv.product_id);
  const conv = inv.conv_id ? bcConvLookup(inv.conv_id) : null;
  const items = (Array.isArray(inv.items) && inv.items.length && typeof INVOICE_ITEMS !== 'undefined') ? INVOICE_ITEMS.label(inv) : '';
  // Keys and codes the sale handed out, so "who got this code?" is a search.
  const keys = (typeof INV_KEYS !== 'undefined') ? INV_KEYS.of(inv.id).map(k => k.item).filter(Boolean) : [];
  return bcMatch(q, items, prod && prod.name, inv.description, inv.coin, inv.amount_fiat, inv.amount_coin,
    inv.address, inv.txid, inv.id, conv && conv.name, conv && conv.username, conv && conv.handle, inv.customer, inv.customer_handle, ...keys);
};

// One invoice in a list (Invoices and the Overview): what was bought,
// its status and the amount. Everything else is on the invoice's page.
// Money the same way the catalog shows prices: the currency's own symbol
// in front ($9.99, A$49), the code after only when it has no symbol.
const bcMoney = (amount, code) => {
  const c = String(code || 'USD').toUpperCase();
  const meta = (typeof FIAT_BY_CODE !== 'undefined') ? FIAT_BY_CODE[c] : null;
  const n = String(amount).trim().replace(/^[^0-9.-]+/, '');
  return (meta && meta.symbol) ? meta.symbol + n : n + ' ' + c;
};
const InvoiceRow = ({inv, products, onOpen}) => {
  const prod = (products || []).find(p => p.id === inv.product_id);
  const itemsLabel = (Array.isArray(inv.items) && inv.items.length && typeof INVOICE_ITEMS !== 'undefined')
    ? INVOICE_ITEMS.label(inv) : '';
  const status = INV_STATUS_LABEL[inv.status] ? inv.status : 'pending';
  const open = () => onOpen && onOpen(inv);
  return (
    <div className="sl-row" role="button" tabIndex={0} onClick={open}
      onKeyDown={e=>{ if (e.target===e.currentTarget && (e.key==='Enter'||e.key===' ')) { e.preventDefault(); open(); } }}>
      <span className="sl-row-media"><SlTile coin><CoinBadge coin={inv.coin} sz={20}/></SlTile></span>
      <span className="sl-row-main">
        <span className="sl-row-title">{itemsLabel || (prod ? prod.name : (inv.description || 'Payment'))}</span>
        <span className="sl-row-meta">
          <span className="sl-stat" data-s={status}><i aria-hidden="true"/>{INV_STATUS_LABEL[status]}</span>
        </span>
      </span>
      {inv.amount_fiat ? (
        <span className="sl-row-value">
          <span className="sl-row-amt">{bcMoney(inv.amount_fiat, inv.fiat)}</span>
        </span>
      ) : null}
      <span className="sl-row-trail"><svg className="sl-row-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></span>
    </div>
  );
};

const PaymentInvoicesPanel = ({_embed, invoices, products, wallets, openId, setOpenId, query, setQuery, filter: filterProp, notice}) => {
  // In the Payments window the filter is the tab pill's (filterProp) and
  // the strip of filter words below the search is not drawn.
  const [filterState, setFilter] = React.useState('all');
  const filter = filterProp || filterState;
  const [busy, setBusy] = React.useState(null);
  const [qState, setQState] = React.useState('');
  const q  = setQuery ? (query || '') : qState;
  const setQ = setQuery || setQState;
  // Keys and codes per invoice, for the search.
  const invKeys = useInvoiceKeys(false);

  const byStatus = invoices.filter(inv => {
    // "All" means all LIVE invoices. Cancelled ones are deliberately
    // excluded here: the common case for a cancellation is that the
    // operator invoiced the wrong item, and a dead row sitting next to
    // the corrected one is clutter you have to mentally skip past every
    // time you open this panel.
    //
    // They are not lost — the Cancelled tab shows them. (Most cancelled-
    // by-mistake invoices are removed outright by the ghost's
    // invoice_cancel; only ones with real chain activity are kept, and
    // those are exactly the ones you'd want to still be able to find.)
    if (filter === 'all') return inv.status !== 'cancelled';
    if (filter === 'unpaid') return ['expired', 'failed', 'cancelled'].includes(inv.status);
    return inv.status === filter;
  });
  // Search across what an operator would type: item, customer, coin,
  // amount, address or transaction id. Newest first.
  const filtered = React.useMemo(() => {
    const qq = q.trim();
    return !qq ? byStatus : byStatus.filter(inv => bcInvoiceMatches(inv, qq, products));
  // eslint-disable-next-line
  }, [invoices, filter, q, products, invKeys.ver]);
  const paged = useBcPaged(filtered, filter + '|' + q);

  const STATUS_META = {
    pending:   { color:'rgba(255,170,80,0.95)',  bg:'rgba(255,170,80,0.1)',  border:'rgba(255,170,80,0.3)',  dot:'rgb(255,170,80)' },
    confirmed: { color:'rgba(67,201,138,0.95)',  bg:'rgba(67,201,138,0.1)',  border:'rgba(67,201,138,0.3)',  dot:'rgb(67,201,138)' },
    expired:   { color:'rgba(180,180,200,0.85)', bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.1)', dot:'rgba(180,180,200,0.6)' },
    failed:    { color:'rgba(255,90,90,0.95)',   bg:'rgba(255,90,90,0.1)',   border:'rgba(255,90,90,0.3)',   dot:'rgb(255,90,90)' },
    cancelled: { color:'rgba(180,180,200,0.85)', bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.1)', dot:'rgba(180,180,200,0.6)' },
  };

  const checkStatus = async (inv) => {
    if (!inv.callback) { bcToast('This invoice can’t be checked — it was made before status checks existed', 'warn'); return; }
    const url = PAYMENTS_STORE.buildStatusUrl(inv.coin, inv.callback);
    if (!url) { bcToast('Can’t check this invoice — its coin or callback is missing', 'warn'); return; }
    setBusy(inv.id);
    try {
      const r = await fetch(url, { method:'GET' });
      const j = await r.json();
      if (!j || j.status !== 'success') {
        bcToast('No payment seen yet', 'info', { detail: j?.error || 'the address may not have received anything' });
        return;
      }
      // CryptAPI shape per docs: { status, callbacks: [{ txid_in, txid_out,
      //   value_coin, value_forwarded_coin, confirmations, last_update, … }] }
      const cb = INVOICE_PROCESSOR.pickLatestCallback(j.callbacks) || {};
      const confs = cb.confirmations || 0;
      const required = inv.min_confirmations || 1;
      // Never demote a confirmed invoice. One the operator confirmed by hand
      // usually still has 0 on-chain confirmations; flipping it back to
      // pending here would re-open a paid order, re-arm the poller and make
      // the agent treat the customer as still waiting.
      const newStatus = (confs >= required || inv.status === 'confirmed') ? 'confirmed' : 'pending';
      await PAYMENTS_STORE.updateInvoice(inv.id, {
        confirmations: confs,
        status: newStatus,
        txid: cb.txid_in || inv.txid,
        txid_out: cb.txid_out || inv.txid_out,
        amount_coin: cb.value_coin || inv.amount_coin,
        amount_forwarded_coin: cb.value_forwarded_coin || inv.amount_forwarded_coin,
        last_checked: Math.floor(Date.now()/1000),
      });
      bcToast(newStatus === 'confirmed' ? 'Payment confirmed' : 'Payment seen, waiting for confirmations', newStatus === 'confirmed' ? 'ok' : 'info',
        { detail: `${confs}/${required} confirmation${required === 1 ? '' : 's'}` });
    } catch (e) {
      bcToast('Status check failed — ' + ((e && e.message) || 'network error'), 'err');
    } finally {
      setBusy(null);
    }
  };

  const markStatus = async (inv, status) => {
    // A hand-confirmation is recorded as such, so nothing downstream reads
    // the (still zero) on-chain confirmation count as "not paid yet".
    await PAYMENTS_STORE.updateInvoice(inv.id, status === 'confirmed'
      ? { status, manual_confirmed: true, manual_confirmed_at: Math.floor(Date.now()/1000) }
      : { status });
    bcToast(status === 'confirmed' ? 'Marked as paid — sending their order' : 'Invoice marked ' + status, 'ok');
    // When the operator manually confirms an invoice here, run the SAME
    // post-payment flow a real on-chain confirmation triggers: the paced
    // customer confirmation line, product/file delivery, and the manual-setup
    // follow-up (and the go-offline wind-down if the agent is set to). Without
    // this, manual confirm silently flipped the pill but the customer got
    // nothing until the watchdog happened to re-fire. Idempotency flags
    // (customer_confirmed_msg_sent / manual_msg_sent / delivered) stop any
    // double-send if the watchdog also fires.
    if (status === 'confirmed') {
      const row = PAYMENTS_STORE.invoices.find(i => i.id === inv.id) || inv;
      try {
        window.dispatchEvent(new CustomEvent('bcEvent', {
          detail: { event: 'invoiceConfirmed', data: { ...row, status: 'confirmed' } }
        }));
      } catch(_){}
    }
  };
  const remove = async (inv) => {
    if (!window.confirm('Delete this invoice?')) return;
    await PAYMENTS_STORE.deleteInvoice(inv.id);
    if (setOpenId && openId === inv.id) setOpenId(null);
  };

  // ── Filter chips (shared) ────────────────────────────────
  const FILTERS = [
    {id:'all',label:'All'},
    {id:'pending',label:'Pending'},
    {id:'confirmed',label:'Confirmed'},
    {id:'expired',label:'Expired'},
    {id:'failed',label:'Failed'},
    // Only offered once something has actually been cancelled — an empty
    // tab that never lights up is just noise in a narrow filter strip.
    ...(invoices.some(i => i.status === 'cancelled') ? [{id:'cancelled',label:'Cancelled'}] : []),
  ];

  // ── EMBED LAYOUT — compact, scrollable invoice rows ──────
  // The popup is a fixed-height window, so this branch owns exactly two
  // bands: a non-scrolling filter strip and ONE scroll region for the
  // list. Rows are single-line (26px badge, 40px box) because a busy
  // account can have dozens of invoices — actions are icon buttons on
  // the right rather than three full-width text buttons per row.
  const openInv = _embed && openId ? invoices.find(i => i.id === openId) : null;
  if (openInv) {
    return (
      <InvoiceDetail inv={openInv} products={products} wallets={wallets}
        busy={busy === openInv.id}
        onBack={() => setOpenId(null)}
        onCheck={() => checkStatus(openInv)}
        onMarkPaid={() => markStatus(openInv, 'confirmed')}
        onDelete={() => remove(openInv)}/>
    );
  }

  if (_embed) {
    // Same list design as Catalog and Wallets (.bc-* in bot-ui-settings.jsx):
    // a toolbar of text filters, then one bordered group of 56px rows —
    // coin, item + status/customer, amount, and row actions that appear on
    // hover (always visible on touch screens).
    return (
      <div style={{display:'flex',flexDirection:'column',flex:'1 1 auto',minHeight:0}}>
        <div className="sl-bar">
          <BcSearch value={q} onChange={setQ}
            placeholder={setQuery ? 'Search items, customers, keys, amounts or transaction IDs' : `Search ${invoices.length} invoice${invoices.length===1?'':'s'}`}/>
        </div>
        {!filterProp && <div className="sl-bar sl-bar-2">
          <div className="sl-filters" role="group" aria-label="Filter invoices">
            {FILTERS.map(f => {
              const count = f.id==='all'
                ? invoices.filter(i => i.status !== 'cancelled').length
                : invoices.filter(i => i.status === f.id).length;
              return (
                <button key={f.id} type="button" className="sl-filter"
                  aria-pressed={filter===f.id} onClick={()=>setFilter(f.id)}>
                  {f.id==='confirmed' ? 'Paid' : f.id==='pending' ? 'Awaiting payment' : f.label}<span>{count}</span>
                </button>
              );
            })}
          </div>
        </div>}

        <div className="sl-scroll">
          {notice}
          <div className="sl-list">
          {filtered.length === 0 ? (
            typeof SsetLandEmpty !== 'undefined' ? (
              <SsetLandEmpty
                title={invoices.length===0 ? 'No invoices yet' : 'No invoices match'}
                sub={invoices.length===0 ? 'Your agents create an invoice whenever a customer is ready to pay.' : 'Try another search or filter.'}/>
            ) : (
              <div className="sl-empty">
                <div className="sl-empty-title">{invoices.length===0 ? 'No invoices' : 'No matching invoices'}</div>
              </div>
            )
          ) : paged.shown.map(inv => (
            <InvoiceRow key={inv.id} inv={inv} products={products}
              onOpen={() => setOpenId && setOpenId(inv.id)}/>
          ))}
          <BcMore rest={paged.rest} onMore={paged.more}/>
          </div>
        </div>
      </div>
    );
  }

  // ── FULL-PAGE LEGACY LAYOUT ─────────────────────────────
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        {FILTERS.map(f => (
          <button key={f.id} onClick={()=>setFilter(f.id)}
            style={{padding:'5px 11px',fontSize:11.5,fontWeight:500,borderRadius:20,cursor:'pointer',transition:'all 0.12s',
              background:filter===f.id?'rgba(108,99,255,0.18)':'rgba(255,255,255,0.04)',
              color:filter===f.id?'rgba(178,168,255,0.98)':'var(--t2)',
              border:`1px solid ${filter===f.id?'rgba(108,99,255,0.4)':'var(--ln)'}`}}>
            {f.label}
            <span style={{marginLeft:6,fontSize:10,color:'var(--t4)',fontFamily:'var(--mono)'}}>
              {f.id==='all' ? invoices.length : invoices.filter(i=>i.status===f.id).length}
            </span>
          </button>
        ))}
      </div>

      <div style={{background:'rgba(20,22,42,0.82)',backdropFilter:'blur(20px) saturate(160%)',WebkitBackdropFilter:'blur(20px) saturate(160%)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:13,overflow:'hidden',boxShadow:'0 4px 32px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.05) inset'}}>
        {filtered.length === 0 ? (
          <div style={{padding:'56px 16px',textAlign:'center',color:'var(--t3)'}}>
            <div style={{width:48,height:48,margin:'0 auto 12px',borderRadius:12,background:'rgba(255,255,255,0.04)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
            </div>
            <div style={{fontSize:13,fontWeight:600,color:'var(--t2)'}}>No invoices yet</div>
            <div style={{fontSize:11.5,marginTop:4}}>Payment requests from your agents show up here</div>
          </div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'1fr',gap:0}}>
            <div style={{display:'grid',gridTemplateColumns:'90px 1fr 110px 110px 130px 200px',gap:0,padding:'10px 16px',fontSize:9.5,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'0.08em',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
              <span>Coin</span><span>Address / Product</span><span>Amount</span><span>Confirms</span><span>Status</span><span style={{textAlign:'right'}}>Actions</span>
            </div>
            {filtered.map(inv => {
              const meta = STATUS_META[inv.status] || STATUS_META.pending;
              const prod = products.find(p => p.id === inv.product_id);
              const itemsLabel = (Array.isArray(inv.items) && inv.items.length && typeof INVOICE_ITEMS !== 'undefined')
                ? INVOICE_ITEMS.label(inv) : '';
              const w = wallets[inv.coin];
              const required = w?.min_confirmations || 1;
              const conv = inv.conv_id ? bcConvLookup(inv.conv_id) : null;
              const convLabel = conv ? (conv.name || conv.username || conv.chatId || '') : String(inv.customer || '');
              return (
                <div key={inv.id} style={{display:'grid',gridTemplateColumns:'90px 1fr 110px 110px 130px 200px',gap:0,padding:'14px 16px',alignItems:'center',borderBottom:'1px solid rgba(255,255,255,0.04)',fontSize:12}}>
                  <span style={{fontFamily:'var(--mono)',fontWeight:600,color:'var(--t1)',letterSpacing:'0.04em'}}>{(inv.coin||'').toUpperCase()}</span>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,color:'var(--t1)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {itemsLabel || (prod ? prod.name : (inv.description || 'Payment'))}
                      {convLabel && <span style={{marginLeft:8,fontSize:10,color:'var(--t3)',fontWeight:400}}>· {convLabel}</span>}
                    </div>
                    <div style={{fontSize:10,color:'var(--t3)',fontFamily:'var(--mono)',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {inv.address || '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--t1)'}}>{inv.amount_fiat ? `${inv.fiat || '$'}${inv.amount_fiat}` : '—'}</div>
                    {inv.amount_coin && <div style={{fontSize:10,color:'var(--t3)',fontFamily:'var(--mono)',marginTop:2}}>{inv.amount_coin}</div>}
                  </div>
                  <div style={{fontSize:11.5,color:'var(--t2)',fontFamily:'var(--mono)'}}>
                    {inv.confirmations || 0} / {required}
                  </div>
                  <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 8px',fontSize:10,fontWeight:700,letterSpacing:'0.05em',textTransform:'uppercase',borderRadius:5,background:meta.bg,color:meta.color,border:`1px solid ${meta.border}`,width:'fit-content'}}>
                    <span style={{width:5,height:5,borderRadius:'50%',background:meta.dot}}/>
                    {inv.status}
                  </span>
                  <div style={{display:'flex',justifyContent:'flex-end',gap:6}}>
                    <button onClick={()=>checkStatus(inv)} disabled={busy===inv.id}
                      title="Poll CryptAPI for current status"
                      style={{padding:'5px 9px',fontSize:10.5,fontWeight:600,color:'var(--t2)',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:6,cursor: busy===inv.id?'wait':'pointer',opacity: busy===inv.id?0.5:1}}>
                      {busy===inv.id ? '…' : 'Check'}
                    </button>
                    {inv.status !== 'confirmed' && (
                      <button onClick={()=>markStatus(inv,'confirmed')}
                        title="Mark as confirmed manually"
                        style={{padding:'5px 9px',fontSize:10.5,fontWeight:600,color:'rgba(67,201,138,0.95)',background:'rgba(67,201,138,0.08)',border:'1px solid rgba(67,201,138,0.25)',borderRadius:6,cursor:'pointer'}}>
                        ✓
                      </button>
                    )}
                    <button onClick={()=>remove(inv)}
                      style={{padding:'5px 9px',fontSize:10.5,fontWeight:600,color:'rgba(255,90,90,0.85)',background:'transparent',border:'1px solid rgba(255,90,90,0.2)',borderRadius:6,cursor:'pointer'}}>
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{padding:'12px 14px',background:'rgba(108,99,255,0.05)',border:'1px solid rgba(108,99,255,0.16)',borderRadius:9,fontSize:11,color:'var(--t2)',lineHeight:1.6}}>
        <div style={{fontWeight:600,color:'rgba(178,168,255,0.95)',marginBottom:4,fontSize:11.5}}>How it works</div>
        Configure a wallet under the <span style={{color:'var(--t1)',fontWeight:500}}>Wallets</span> tab. When a customer asks the AI about payment options, the AI lists every enabled coin and shares the address. Each invoice the AI creates lands here — click <span style={{fontFamily:'var(--mono)',color:'var(--t1)'}}>Check</span> to poll CryptAPI for confirmations or <span style={{fontFamily:'var(--mono)',color:'rgba(67,201,138,0.95)'}}>✓</span> to confirm manually.
      </div>
    </div>
  );
};

// ── Persisted appearance tweaks ─────────────────────────────
// Preferences → Appearance writes here. Values live in localStorage so the
// accent and chat width survive a reload, and the accent is also written to
// the document root: popups are portalled to <body>, outside .app, so a
// variable set only on .app never reached them.
const BC_TWEAKS_LS = 'bc.tweaks.v2';
// Bumped whenever the SHIPPED appearance defaults change. A saved blob
// stamped with an older revision keeps the operator's layout choices
// (chat width, compact table) but takes the new look once, so a new
// default isn't invisible to everyone who has ever opened Appearance.
const BC_TWEAKS_REV = 4;
const BC_CHAT_W_MIN = 480;
const BC_CHAT_W_MAX = 1200;
const bcCleanTweaks = (defaults, raw) => {
  const out = {...defaults};
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accentColor)) out.accentColor = raw.accentColor;
  const w = Number(raw.chatWidth);
  if (Number.isFinite(w)) out.chatWidth = Math.round(Math.min(BC_CHAT_W_MAX, Math.max(BC_CHAT_W_MIN, w)));
  if (typeof raw.compactTable === 'boolean') out.compactTable = raw.compactTable;
  // Theme keys (Preferences → Appearance). Each is checked against the
  // catalogue in bot-ui-settings.jsx so a stale or hand-edited value can
  // never leave the background in a state the CSS doesn't know.
  const TH = (typeof BC_THEME !== 'undefined') ? BC_THEME : null;
  if (TH) {
    const oneOf = (k, list) => { if (list.some(o => o.id === raw[k])) out[k] = raw[k]; };
    const num   = (k, lo, hi) => { const v = Number(raw[k]); if (Number.isFinite(v)) out[k] = Math.round(Math.min(hi, Math.max(lo, v))); };
    const bool  = (k) => { if (typeof raw[k] === 'boolean') out[k] = raw[k]; };
    oneOf('bgStyle', TH.styles);
    oneOf('bgPalette', TH.palettes);
    oneOf('bgSpeed', TH.speeds);
    num('bgIntensity', 20, 100);
    if (typeof raw.bgSolid === 'string' && /^#[0-9a-f]{6}$/i.test(raw.bgSolid)) out.bgSolid = raw.bgSolid;
    bool('bgVignette'); bool('bgGrain');
    oneOf('chatSurface', TH.surfaces);
    num('chatSurfaceStrength', 0, 100);
    oneOf('glass', TH.glass);
    bool('reduceMotion');
  }
  out.__rev = BC_TWEAKS_REV;
  return out;
};
// Reads the stored blob, dropping appearance keys saved against an older
// set of shipped defaults.
const bcReadStoredTweaks = () => {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(BC_TWEAKS_LS) || 'null'); } catch (_) { raw = null; }
  if (!raw || typeof raw !== 'object') return null;
  if (raw.__rev === BC_TWEAKS_REV) return raw;
  const keep = {};
  ['chatWidth','compactTable'].forEach(k => { if (raw[k] !== undefined) keep[k] = raw[k]; });
  return keep;
};
const bcTweakDefaults = () => ({
  ...TWEAK_DEFAULTS,
  ...((typeof BC_THEME !== 'undefined') ? BC_THEME.defaults : {}),
});
const useBcTweaks = (defaults) => {
  const [values, setValues] = React.useState(() => {
    try {
      const next = bcCleanTweaks(defaults, bcReadStoredTweaks());
      // Re-stamp straight away so the migration runs exactly once.
      try { localStorage.setItem(BC_TWEAKS_LS, JSON.stringify(next)); } catch (_) {}
      return next;
    }
    catch (_) { return bcCleanTweaks(defaults, null); }
  });
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null ? keyOrEdits : { [keyOrEdits]: val };
    setValues(prev => {
      const next = bcCleanTweaks(defaults, {...prev, ...edits});
      try { localStorage.setItem(BC_TWEAKS_LS, JSON.stringify(next)); } catch (_) {}
      return next;
    });
    try { window.parent && window.parent !== window && window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*'); } catch (_) {}
  // eslint-disable-next-line
  }, []);
  return [values, setTweak];
};
const bcApplyAccent = (hex) => {
  const root = document.documentElement;
  if (!root || !/^#[0-9a-f]{6}$/i.test(hex || '')) return;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  root.style.setProperty('--acc', hex);
  root.style.setProperty('--acc-rgb', `${r},${g},${b}`);
  root.style.setProperty('--acc2', `rgba(${r},${g},${b},0.12)`);
};

// Writes the theme onto the document root: data attributes pick the CSS
// variant (see "THEME" in BotCommand.html) and custom properties carry the
// colours and strengths. Runs before paint so a reload never flashes the
// default background first.
const bcApplyTheme = (t) => {
  const root = document.documentElement;
  if (!root || typeof BC_THEME === 'undefined') return;
  const pal = bcPalette(t.bgPalette, t.accentColor);
  const ds = root.dataset;
  ds.bg        = t.bgStyle;
  ds.fxSpeed   = t.bgSpeed;
  ds.vignette  = t.bgVignette ? '1' : '0';
  ds.grain     = t.bgGrain ? '1' : '0';
  ds.chatSurface = t.chatSurface || 'none';
  // Chat patterns were removed; clear attributes an older build may have left.
  delete ds.chatBg; delete ds.chatScale; delete ds.chatMotion;
  ds.glass     = t.glass;
  ds.motion    = t.reduceMotion ? 'reduced' : 'full';
  const st = root.style;
  pal.c.forEach((c, i) => st.setProperty(`--fx${i + 1}`, c));
  pal.base.forEach((c, i) => st.setProperty(`--fxb${i + 1}`, c));
  st.setProperty('--fx-int', String((t.bgIntensity || 60) / 100));
  st.setProperty('--fx-solid', t.bgSolid || '#0b0d17');
  st.setProperty('--chat-surf', String((t.chatSurfaceStrength == null ? 50 : t.chatSurfaceStrength) / 100));
  const base = document.querySelector('.bg-base');
  if (base) { base.classList.add('fxl'); base.setAttribute('data-bg', t.bgStyle); }
  // Snapshot for the boot script in BotCommand.html, which restores it
  // before React/Babel have loaded so a reload doesn't flash the default.
  try {
    const vars = {};
    ['--fx1','--fx2','--fx3','--fx4','--fxb1','--fxb2','--fxb3','--fx-int','--fx-solid',
     '--chat-surf','--acc'].forEach(k => { vars[k] = st.getPropertyValue(k); });
    localStorage.setItem('bc.theme.boot', JSON.stringify({ rev: BC_TWEAKS_REV, ds: {...ds}, vars }));
  } catch (_) {}
};

// ── Desktop window frame ───────────────────────────────────────────────
// The desktop host (Form1.vb) draws its own title bar. Its colours come
// from here: the accent for the title bar's mark, the background's base
// tones for the bar itself, so the frame always matches
// Preferences → Appearance. Only sent when something actually changed.
let bcWinThemeSent = '';
let bcWinThemeRaf = 0;
let bcHexCtx = null;
const bcToHex = (c) => {
  const v = String(c || '').trim();
  if (!v) return '';
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  try {
    if (!bcHexCtx) bcHexCtx = document.createElement('canvas').getContext('2d');
    bcHexCtx.fillStyle = '#000000';
    bcHexCtx.fillStyle = v;
    const o = String(bcHexCtx.fillStyle);
    return /^#[0-9a-f]{6}$/i.test(o) ? o.toLowerCase() : '';
  } catch (_) { return ''; }
};
// Deferred to the next frame and coalesced: both theme layout effects call
// this, and reading getComputedStyle() right after they write the CSS
// variables forced a full-document style recalculation each time (twice
// per colour-picker step). By the next frame the browser has already
// computed the new styles, so the read is free, and a burst of changes
// sends one message to the host instead of one per step.
const bcSendWindowTheme = () => {
  if (bcWinThemeRaf) return;
  if (!(window.chrome && window.chrome.webview)) return;
  const run = () => { bcWinThemeRaf = 0; bcSendWindowThemeNow(); };
  bcWinThemeRaf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(run) : setTimeout(run, 16);
};
const bcSendWindowThemeNow = () => {
  try {
    const B = window.BotBridge;
    if (!B || typeof B.send !== 'function' || !(window.chrome && window.chrome.webview)) return;
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const v = (k) => bcToHex(cs.getPropertyValue(k));
    const solid = root.dataset.bg === 'solid';
    const msg = {
      accent: v('--acc'),
      base1: solid ? v('--fx-solid') : v('--fxb1'),
      base2: solid ? v('--fx-solid') : v('--fxb2'),
      base3: solid ? v('--fx-solid') : v('--fxb3'),
    };
    if (!msg.accent || !msg.base1) return;
    // Edge colour: what the page actually shows at the middle of its right
    // edge — the edge a growing window uncovers (see bcEdgeColors in
    // BotCommand.html). The host fills any strip the page hasn't painted
    // yet with it, so the strip blends into the page.
    const ec = (typeof window.bcEdgeColors === 'function')
      ? window.bcEdgeColors(msg.base1, msg.base2, msg.base3, root.dataset.vignette !== '0',
                            window.innerWidth || 1280, window.innerHeight || 800)
      : null;
    if (ec) msg.edge = ec.mid;
    else {
      const rgb = (h) => { h = h || msg.base1; return [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)); };
      const c1 = rgb(msg.base1), c2 = rgb(msg.base2), c3 = rgb(msg.base3);
      msg.edge = '#' + [0, 1, 2].map(i =>
        Math.round((c1[i] + c2[i] + c3[i]) / 3).toString(16).padStart(2, '0')).join('');
    }
    // The same colour fills the area outside the page while the host has
    // the WebView oversized for an edge drag (see OVERSIZED DRAG).
    if (root.style.getPropertyValue('--bc-edge') !== msg.edge) root.style.setProperty('--bc-edge', msg.edge);
    const key = JSON.stringify(msg);
    if (key === bcWinThemeSent) return;
    bcWinThemeSent = key;
    B.send('windowTheme', msg);
  } catch (_) {}
};

const App = () => {
  const [inPageChat, setInPageChat]= React.useState(null);
  // ── Back-stack of recently visited in-page chats. Pushed onto when the
  //    operator opens a different chat while one is already in-page; the
  //    Back button on the chat header pops from here so they return to
  //    the previous conversation instead of jumping all the way back to
  //    the message list.
  const [chatHistory, setChatHistory] = React.useState([]);
  const [ctx,        setCtx]       = React.useState(null);
  const [t,          setTweak]     = useBcTweaks(bcTweakDefaults());
  React.useLayoutEffect(() => { bcApplyAccent(t.accentColor); bcSendWindowTheme(); }, [t.accentColor]);
  React.useLayoutEffect(() => { bcApplyTheme(t); bcSendWindowTheme(); }, [
    t.accentColor, t.bgStyle, t.bgPalette, t.bgSpeed, t.bgIntensity, t.bgSolid, t.bgVignette, t.bgGrain,
    t.chatSurface, t.chatSurfaceStrength, t.glass, t.reduceMotion,
  ]);
  React.useLayoutEffect(() => {
    document.documentElement.style.setProperty('--msg-col-w', `${t.chatWidth}px`);
  }, [t.chatWidth]);
  const auth = useAuth();
  // Your public contact page (api.php?u=you) is drawn in your Appearance:
  // accent, background, palette and glass. The theme lives in this browser,
  // so a copy goes to the server whenever it changes (and once after
  // signing in, if this browser hasn't sent it yet).
  React.useEffect(() => {
    const acc = auth.account;
    // A guest has no contact page of its own.
    if (!acc || !acc.id || acc.guest || acc.email === 'demo@botcommand.app') return;
    if (typeof apiFetch !== 'function' || typeof BC_THEME === 'undefined' || typeof bcPalette !== 'function') return;
    let theme;
    try {
      const pal = bcPalette(t.bgPalette, t.accentColor);
      theme = {
        accent: t.accentColor, bg: t.bgStyle, c: pal.c, base: pal.base,
        int: t.bgIntensity, solid: t.bgSolid, vig: !!t.bgVignette, grain: !!t.bgGrain,
        glass: t.glass, speed: t.bgSpeed,
      };
    } catch (_) { return; }
    const key = JSON.stringify(theme);
    const lsk = 'bc.pageTheme.sent.' + acc.id;
    try { if (localStorage.getItem(lsk) === key) return; } catch (_) {}
    const tm = setTimeout(() => {
      Promise.resolve(apiFetch('dm_page_theme', { theme }))
        .then(r => { if (r && !r.error) { try { localStorage.setItem(lsk, key); } catch (_) {} } })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(tm);
  }, [auth.account && auth.account.id, auth.account && auth.account.guest, t.accentColor, t.bgStyle, t.bgPalette, t.bgIntensity, t.bgSolid,
      t.bgVignette, t.bgGrain, t.glass, t.bgSpeed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bootstrap: check who's signed in. Runs once on mount; if a session
  //    cookie is already present we get the account back immediately and
  //    proceed straight to the app. If NOT signed in, fall through to the
  //    LoginRegister screen — we never silently auto-sign into the demo,
  //    because that hides the login form for real operators whose session
  //    has just expired (cookie gone after server restart, log-out from
  //    another tab, etc.). The demo is still reachable via the "Try the
  //    demo" button on the LoginRegister screen.
  React.useEffect(()=>{
    // Guard: if the user clicks "Try the demo" while whoami is in-flight,
    // AUTH_STORE.account will already be set — don\'t overwrite it.
    let cancelled = false;
    const _demoUnsub = AUTH_STORE.sub((account) => {
      if (account && account.email === 'demo@botcommand.app') cancelled = true;
    });
    try { window.bcBoot && window.bcBoot.step('Checking your session…', 0.22); } catch (_) {}
    apiGet('auth_whoami').then(async res=>{
      if (cancelled) return;
      if (res && res.account) {
        AUTH_STORE.set(res.account);
      } else {
        // A guest whose session lapsed comes back to their chat on this
        // device (see GUEST in bot-stores.jsx).
        const back = (typeof GUEST !== 'undefined') ? await GUEST.resume() : null;
        if (cancelled) return;
        if (back) { AUTH_STORE.set(back); return; }
        // No session — let LoginRegister render, but only if demo wasn\'t
        // already activated mid-flight.
        if (!AUTH_STORE.account) AUTH_STORE.signOut();
      }
    }).catch(()=>{
      if (!cancelled && !AUTH_STORE.account) AUTH_STORE.signOut();
    }).finally(()=>{ _demoUnsub && _demoUnsub(); });
  },[]);

  // ── Boot loader ─────────────────────────────────────────────────────
  // Up from the first paint (BotCommand.html). Signed out → drop it and
  // show the login form. Signed in (refresh, or just logged in) → keep it
  // up until the inbox has loaded and painted, so the workspace appears
  // complete instead of filling in piece by piece.
  const bootLoader = (typeof window !== 'undefined' && window.bcBoot) || null;
  React.useLayoutEffect(() => {
    if (!bootLoader || !auth.checked) return;
    if (!auth.account) { bootLoader.hide(); return; }
    // Signing in from the login form: the loader is gone by now, bring it
    // back before this frame paints.
    const guest = !!auth.account.guest;
    if (!bootLoader.visible()) bootLoader.show(guest ? 'Opening your chat…' : 'Signing you in…');
    else bootLoader.step(guest ? 'Opening your chat…' : 'Signed in — opening your workspace…', 0.3);
  }, [auth.checked, auth.account && auth.account.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Per-account data load — runs whenever the active account changes
  //    (initial sign-in, or post-logout sign-in as a different user). All
  //    in-memory caches were cleared by AUTH_STORE.logout so we don't risk
  //    showing stale data from the previous account.
  React.useEffect(()=>{
    if (!auth.account) return;
    // A guest's app is its one conversation (DM_STORE loads it): none of
    // the workspace's conversations, agents, products or settings.
    if (auth.account.guest) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { window.bcBoot && window.bcBoot.hide(); } catch (_) {}
      }));
      return;
    }
    let bootDone = false;
    const finishBoot = () => {
      if (bootDone) return;
      bootDone = true;
      // Two frames: the inbox has rendered and painted under the loader.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { window.bcBoot && window.bcBoot.hide(); } catch (_) {}
      }));
    };
    const bootFailsafe = setTimeout(finishBoot, 8000);
    // What the loader says while it waits: the first thing still loading,
    // in this order, and a bar that moves as each one lands.
    const BOOT_STEPS = [
      ['conv',   'Loading your conversations…'],
      ['agents', 'Waking up your agents…'],
      ['prods',  'Stocking the product catalogue…'],
      ['creds',  'Unlocking keys & settings…'],
    ];
    const bootLeft = new Set(BOOT_STEPS.map(x => x[0]));
    const bootReport = () => {
      const done = BOOT_STEPS.length - bootLeft.size;
      const next = BOOT_STEPS.find(x => bootLeft.has(x[0]));
      try {
        window.bcBoot && window.bcBoot.step(next ? next[1] : 'Setting up your workspace…',
          0.3 + 0.66 * (done / BOOT_STEPS.length));
      } catch (_) {}
    };
    const bootDoneStep = (k) => {
      if (!bootLeft.delete(k)) return;
      bootReport();
      if (!bootLeft.size) finishBoot();
    };
    bootReport();
    apiGet('get_conversations').then(res=>{
      if(res && res.conversations && res.conversations.length) {
        MSGS_STORE.load(res.conversations);
        // Eagerly populate BLOCK_STORE so the inbound gate is correct even
        // before the operator opens the profile panel for each conversation.
        // get_conversations now joins bc_end_users and includes is_blocked /
        // is_muted on every row.
        res.conversations.forEach(r=>{
          if (r.is_blocked || r.is_muted) {
            BLOCK_STORE.set(r.id, {
              blocked: !!Number(r.is_blocked),
              muted:   !!Number(r.is_muted),
            });
          }
        });
      } else if (auth.account && auth.account.email === 'demo@botcommand.app') {
        seedDemoMessages();
      }
      // Warm the newest few threads in the background so the first open
      // of any of them is instant.
      try { MSGS_STORE.warmThreads && MSGS_STORE.warmThreads(8); } catch (_) {}
    }).catch(()=>{
      if (auth.account && auth.account.email === 'demo@botcommand.app') seedDemoMessages();
    }).finally(() => bootDoneStep('conv'));
    apiGet('get_agents').then(res=>{
      AGENTS_STORE.load((res && res.agents) || []);
    }).catch(()=>{}).finally(() => bootDoneStep('agents'));
    apiGet('get_products').then(res=>{
      // No more seed-on-first-run: each operator builds their own catalogue
      // from the Products tab. Empty list is the correct first-time state.
      PRODS_STORE.load((res && res.products) || []);
    }).catch(()=>{}).finally(() => bootDoneStep('prods'));
    CRED_STORE.load().then(()=>{
      AI_MASTER.hydrate({ values: CRED_STORE.values });
      PAYMENTS_STORE.hydrateFromCreds();
      if (typeof PLATFORM_ACCOUNTS !== 'undefined') PLATFORM_ACCOUNTS.hydrate();
      if (typeof PREFS_STORE !== 'undefined') PREFS_STORE.hydrateFromCreds();
      INVOICE_PROCESSOR.resumePending();
    }).catch(()=>{}).finally(() => bootDoneStep('creds'));
    const unsubCreds = CRED_STORE.sub(()=>AI_MASTER.hydrate({ values: CRED_STORE.values }));
    return ()=>{ clearTimeout(bootFailsafe); unsubCreds && unsubCreds(); };
    // guest: creating an account from a guest chat loads the workspace.
  },[auth.account && auth.account.id, auth.account && auth.account.guest]);

  // ── Always-on connection supervisor ──────────────────────────────
  // Mounted at the app root for the whole session, so Telegram/Discord
  // auto-reconnect happens on application start, after re-login, AND
  // whenever the connection drops — WITHOUT the operator ever needing to
  // open the Settings popup. Gated by the "Auto-connect" toggle
  // (tg_auto_reconnect, default on).
  //
  // ROOT-CAUSE NOTE: the previous version gated on a `netReadyForBoot` flag
  // derived from the one-shot `dotNetReady` event. That event can fire before
  // React subscribes, leaving the flag stuck false forever — so the whole
  // supervisor early-returned and nothing ever auto-connected. We now key off
  // window.BotBridge.isWebView2() directly (with a retry poll), so bridge
  // readiness timing can never wedge it. BotBridge also queues any calls made
  // before its message pipe is flushed, so an early connect is safe.
  const credsLoaded = useCreds().loaded;
  React.useEffect(() => {
    if (!credsLoaded) return;   // need credentials available first

    // ── RESTORATION MODEL ─────────────────────────────────────────────
    // What used to go wrong after the internet dropped and came back:
    //   • nothing listened for the network at all — the supervisor only
    //     reacted to status events from the host, and a host whose socket
    //     died quietly never sent one, so it sat "connected" and deaf;
    //   • a host that said "reconnecting" and then stalled was trusted
    //     forever — the supervisor stood down with no time limit;
    //   • the retry clock stayed parked at its 30s ceiling after a long
    //     outage, so even a good recovery waited out the old backoff.
    // Now:
    //   • NET_MONITOR probes reachability and detects sleep/resume;
    //   • going offline pauses connect attempts (they can only fail) and
    //     logs it; coming back resets the backoff and performs a clean
    //     RESTART of each platform — disconnect, then connect — because a
    //     client that claims to be connected after an outage cannot be
    //     trusted to still be receiving;
    //   • "reconnecting" from the host is honoured for 45s, then the
    //     supervisor takes over;
    //   • once a platform is connected again after an outage, the page
    //     asks the host to catch up on missed messages and the AI engine
    //     re-runs every conversation the outage interrupted.
    const autoOn   = () => CRED_STORE.get('tg_auto_reconnect') !== '0';
    const wv2Ready = () => { try { return !!(window.BotBridge && window.BotBridge.isWebView2 && window.BotBridge.isWebView2()); } catch (_) { return false; } };
    const authBusy = () => { try { return !!(TG_AUTH_STORE && TG_AUTH_STORE.state && TG_AUTH_STORE.state.open); } catch (_) { return false; } };
    const netUp    = () => (typeof NET_MONITOR === 'undefined') || NET_MONITOR.online !== false;
    const PLATS = ['telegram', 'discord'];
    const timers   = { telegram: null, discord: null };
    const backoffN = { telegram: 0, discord: 0 };
    // Operator-initiated Disconnect posts a status with an EMPTY error; we
    // record that so the supervisor doesn't immediately reconnect them.
    const cleanOff = { telegram: false, discord: false };
    // Supervisor-initiated restart in progress: its own disconnect must not
    // be mistaken for the operator's.
    const restarting = { telegram: 0, discord: 0 };
    // Host said it is retrying on its own, since when.
    const hostRetrySince = { telegram: 0, discord: 0 };
    // Set when a platform drops or the network goes, cleared on the first
    // good "connected" afterwards — which is when recovery runs.
    const outageSince = { telegram: 0, discord: 0 };
    const backoff = [2000, 4000, 8000, 15000, 30000];
    const log = (p, level, msg) => { try { CONN_STORE.addLog(p, level, msg); } catch (_) {} };

    const hasCreds = (p) => {
      if (p === 'discord') return !!(CRED_STORE.get('dc_bot_token') || '').trim();
      return !!((CRED_STORE.get('tg_bot_token') || '').trim()
        || ((CRED_STORE.get('tg_api_id') || '').trim() && (CRED_STORE.get('tg_api_hash') || '').trim() && (CRED_STORE.get('tg_phone') || '').trim()));
    };
    const canAct = (p) => autoOn() && wv2Ready() && netUp() && !CONN_SUPPRESS[p] && !cleanOff[p]
      && !(p === 'telegram' && authBusy()) && hasCreds(p);

    const connect = (p, force) => {
      if (!canAct(p)) return;
      if (!force && CONN_STORE[p].connected) return;
      if (p === 'telegram') {
        const tok  = (CRED_STORE.get('tg_bot_token') || '').trim();
        const id   = (CRED_STORE.get('tg_api_id')    || '').trim();
        const hash = (CRED_STORE.get('tg_api_hash')  || '').trim();
        const phone= (CRED_STORE.get('tg_phone')     || '').trim();
        if (tok) { console.log('[reconnect] telegram bot'); window.BotBridge.connectTelegram(tok); }
        else if (id && hash && phone) { console.log('[reconnect] telegram user'); window.BotBridge.connectTelegramUser(id, hash, phone); }
      } else {
        const tok = (CRED_STORE.get('dc_bot_token') || '').trim();
        if (tok) { console.log('[reconnect] discord'); window.BotBridge.connectDiscord(tok); }
      }
    };
    const sched = (p) => {
      if (timers[p] || cleanOff[p] || !autoOn()) return;
      const d = backoff[Math.min(backoffN[p], backoff.length - 1)]; backoffN[p]++;
      timers[p] = setTimeout(() => { timers[p] = null; connect(p); }, d);
    };
    const clearTimer = (p) => { if (timers[p]) { clearTimeout(timers[p]); timers[p] = null; } };

    // Clean restart: drop whatever socket the host holds (it may be a
    // zombie) and connect fresh. The disconnect's status echo is ignored
    // for a few seconds via `restarting`.
    const restart = (p, why) => {
      if (!canAct(p)) return;
      clearTimer(p);
      backoffN[p] = 0;
      hostRetrySince[p] = 0;
      if (!outageSince[p]) outageSince[p] = Date.now();
      restarting[p] = Date.now();
      log(p, 'info', 'Refreshing connection (' + why + ')');
      if (CONN_STORE[p].connected) {
        try { p === 'telegram' ? window.BotBridge.disconnectTelegram() : window.BotBridge.disconnectDiscord(); } catch (_) {}
        setTimeout(() => connect(p, true), 1800);
      } else {
        connect(p, true);
      }
      // Safety net: if the fresh connect never reports back, the normal
      // backoff takes over.
      setTimeout(() => { if (restarting[p] && !CONN_STORE[p].connected) { restarting[p] = 0; sched(p); } }, 20000);
    };

    const onConnected = (p) => {
      backoffN[p] = 0; cleanOff[p] = false; CONN_SUPPRESS[p] = false;
      restarting[p] = 0; hostRetrySince[p] = 0;
      clearTimer(p);
      if (outageSince[p]) {
        const since = outageSince[p];
        outageSince[p] = 0;
        log(p, 'ok', 'Connection restored');
        // Ask the host to replay what arrived while we were away. Hosts
        // without this action ignore it (unknown actions are dropped), so
        // this is safe to send before the host implements it.
        try { window.BotBridge.send('syncMissed', { platform: p, since }); } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('bc:platform-restored', { detail: { platform: p, since } })); } catch (_) {}
      }
    };

    const h = e => {
      const { event, data } = e.detail;
      // .NET just came online — kick a connect right away.
      if (event === 'dotNetReady') { setTimeout(() => { PLATS.forEach(p => connect(p)); }, 250); return; }
      const p = event === 'telegramStatus' ? 'telegram' : event === 'discordStatus' ? 'discord' : '';
      if (!p) return;
      if (data && data.connected) { onConnected(p); return; }
      if (!outageSince[p]) outageSince[p] = Date.now();
      if (data && data.reconnecting) {
        // .NET host is retrying this drop itself — let it, for a while.
        if (!hostRetrySince[p]) hostRetrySince[p] = Date.now();
        return;
      }
      hostRetrySince[p] = 0;
      const clean = !!(data && (data.error === '' || data.error == null));
      // Our own restart's disconnect echo — not the operator.
      if (clean && restarting[p] && Date.now() - restarting[p] < 10000) return;
      cleanOff[p] = clean;          // operator Disconnect ⇒ stay off
      if (clean) { outageSince[p] = 0; return; }
      sched(p);                     // real drop / failed connect ⇒ retry live
    };
    window.addEventListener('bcEvent', h);

    // Network transitions.
    const onNet = (e) => {
      const d = (e && e.detail) || {};
      if (d.online === false) {
        PLATS.forEach(p => {
          clearTimer(p);
          if (!outageSince[p] && hasCreds(p)) outageSince[p] = Date.now();
          log(p, 'warn', 'Network connection lost — will reconnect automatically');
        });
        return;
      }
      // Back online, or resumed from sleep: anything longer than a blip
      // gets a clean restart; a blip just resumes the normal retry.
      const long = d.why === 'resume' || (d.downForMs || 0) > 4000;
      setTimeout(() => {
        PLATS.forEach(p => {
          if (!hasCreds(p) || cleanOff[p] || CONN_SUPPRESS[p]) return;
          if (long) restart(p, d.why === 'resume' ? 'woke from sleep' : 'network restored');
          else { backoffN[p] = 0; if (!CONN_STORE[p].connected) connect(p); }
        });
      }, 1500);
    };
    window.addEventListener('bc:net', onNet);
    try { if (typeof NET_MONITOR !== 'undefined') NET_MONITOR.start(); } catch (_) {}

    // Initial connect attempt shortly after mount (covers app start &
    // re-login with no Settings popup needed).
    const bootKick = setTimeout(() => { PLATS.forEach(p => connect(p)); }, 800);

    // Self-heal poll — retries until connected, and puts a time limit on
    // the host's own reconnect loop.
    const poll = setInterval(() => {
      if (!autoOn() || !netUp()) return;
      PLATS.forEach(p => {
        if (CONN_STORE[p].connected || cleanOff[p] || timers[p]) return;
        if (p === 'telegram' && authBusy()) return;
        if (restarting[p] && Date.now() - restarting[p] < 20000) return;
        if (hostRetrySince[p]) {
          if (Date.now() - hostRetrySince[p] < 45000) return;
          restart(p, 'host retry stalled');
          return;
        }
        connect(p);
      });
    }, 6000);

    return () => {
      window.removeEventListener('bcEvent', h);
      window.removeEventListener('bc:net', onNet);
      PLATS.forEach(clearTimer);
      clearTimeout(bootKick);
      clearInterval(poll);
    };
  }, [credsLoaded, auth.account && auth.account.id]);

  React.useEffect(()=>{
    const h=e=>setCtx({x:e.detail.e.clientX,y:e.detail.e.clientY,msg:e.detail.msg,inChat:!!e.detail.inChat});
    window.addEventListener('ctx',h); return()=>window.removeEventListener('ctx',h);
  },[]);

  // (Effect that cleared in-page chat when leaving messages view removed —
  // messages is now the only view, so there's nothing to leave.)

  // Open a conversation in the in-page chat view. If one is already open
  // we push it onto the back-stack so the chat header's Back button can
  // walk the user back through their visited chats. Tapping the same
  // conv that's already open closes it (existing toggle behaviour).
  //
  // STABLE IDENTITY: both navigation callbacks read the current chat and
  // back-stack through refs, so their identity never changes. That lets
  // the memoized contact rows and chat panels skip re-rendering, and it
  // fixes window listeners that captured the FIRST render's version (the
  // 'bc-open-conv' handler below always saw inPageChat === null, so opening
  // a chat from Settings never recorded back-history).
  const inPageRef  = React.useRef(inPageChat);
  const historyRef = React.useRef(chatHistory);
  inPageRef.current  = inPageChat;
  historyRef.current = chatHistory;
  const openInPage = React.useCallback(msg => {
    if (!msg) {
      inPageRef.current = null; historyRef.current = [];
      setInPageChat(null); setChatHistory([]);
      return;
    }
    const cur = inPageRef.current;
    // Already viewing this contact — do nothing. Previously this toggled the
    // view closed, which caused clicks in the contact list to unexpectedly
    // return the operator to the empty home screen.
    if (cur && cur.id === msg.id) return;
    if (cur) {
      const next = historyRef.current.filter(m => m.id !== cur.id);
      next.push(cur);
      historyRef.current = next.slice(-20);
      setChatHistory(historyRef.current);
    }
    // Updated eagerly so a second call in the same tick sees this chat.
    inPageRef.current = msg;
    setInPageChat(msg);
  }, []);

  // Back button on the chat header: pop the most recent previous chat
  // off the stack and switch to it. If the stack is empty we close the
  // in-page view entirely (returns to the message list).
  const goBackInPage = React.useCallback(() => {
    const h = historyRef.current;
    if (!h.length) { inPageRef.current = null; setInPageChat(null); return; }
    const prev = h[h.length - 1];
    historyRef.current = h.slice(0, -1);
    inPageRef.current = prev;
    setChatHistory(historyRef.current);
    setInPageChat(prev);
  }, []);

  // A contact was deleted (MSGS_STORE.removeConversation). Drop it from the
  // Back history straight away so Back can never land on a contact that no
  // longer exists. If its chat is the one on screen, InPageChat plays its
  // exit transition and closes itself; the timer here is only a safety net
  // for the cases where that view isn't mounted (ghost chat, a layout that
  // shows the chat elsewhere) so the operator is never left on a dead chat.
  React.useEffect(() => {
    let t = null;
    const onRemoved = (e) => {
      const id = e && e.detail && e.detail.convId;
      if (!id) return;
      const h = historyRef.current;
      if (h.some(m => m && m.id === id)) {
        historyRef.current = h.filter(m => m && m.id !== id);
        setChatHistory(historyRef.current);
      }
      const cur = inPageRef.current;
      if (cur && cur.id === id) {
        clearTimeout(t);
        t = setTimeout(() => {
          const still = inPageRef.current;
          if (still && still.id === id) openInPage(null);
        }, 600);
      }
    };
    window.addEventListener('bc-conv-removed', onRemoved);
    return () => { clearTimeout(t); window.removeEventListener('bc-conv-removed', onRemoved); };
  }, [openInPage]);


  // (useMsgs() was subscribed here without its value ever being read, which
  // re-rendered the entire app on every store event. MsgList subscribes
  // where the data is actually used.)

  // ── Settings sheet open state — Telegram-style overlay over contacts column.
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  // Listen for cross-component requests to open a conversation popup —
  // e.g. clicking a customer's name on an invoice card inside Settings.
  // Closes the settings sheet (so the chat is visible) and opens the chat.
  React.useEffect(()=>{
    let t = null;
    const h = (e) => {
      const msg = e?.detail?.msg;
      if (!msg) return;
      setSettingsOpen(false);
      // Defer so the settings overlay finishes closing before the chat opens.
      clearTimeout(t);
      t = setTimeout(()=>{ t = null; openInPage(msg); }, 50);
    };
    window.addEventListener('bc-open-conv', h);
    return ()=>{ clearTimeout(t); window.removeEventListener('bc-open-conv', h); };
    // eslint-disable-next-line
  },[]);

  // ── Auth gate ─────────────────────────────────────────────
  // While we're still asking the server who is signed in we show a thin
  // splash so the login form doesn't flash for already-signed-in users.
  // The boot loader in BotCommand.html covers this whole phase (it is on
  // screen from the first paint, before scripts compile), so nothing is
  // drawn here.
  if (!auth.checked) {
    return <div className="app" style={{height:'100vh'}}/>;
  }
  if (!auth.account) {
    return <LoginRegister/>;
  }

  return (
    <div className="app" style={{'--acc':t.accentColor,'--cw':`${t.chatWidth}px`}}>
      <div className="main" style={{minWidth:0}}>
        <div key="messages" className="content view-enter">
          <MsgList openInPage={openInPage} inPageChat={inPageChat} goBackInPage={goBackInPage} chatHistory={chatHistory} onOpenSettings={()=>setSettingsOpen(true)} settingsOpen={settingsOpen} onCloseSettings={()=>setSettingsOpen(false)} account={auth.account} tweaks={t} setTweak={setTweak}/>
        </div>
      </div>

      {ctx&&<TopLayer><CtxMenu x={ctx.x} y={ctx.y} msg={ctx.msg} inChat={ctx.inChat} onClose={()=>setCtx(null)} onOpen={msg=>{openInPage(msg);setCtx(null);}}/></TopLayer>}

      {/* Telegram User-API OTP / 2FA modal — opens automatically when .NET asks. */}
      <TgAuthModal/>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>)